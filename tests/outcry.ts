import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Outcry } from "../target/types/outcry";
import {
  Keypair,
  PublicKey,
  SystemProgram,
  LAMPORTS_PER_SOL,
  TransactionInstruction,
  Transaction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  createMint,
  mintTo,
  getAssociatedTokenAddress,
  createAssociatedTokenAccount,
  getAccount,
} from "@solana/spl-token";
import { expect } from "chai";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TOKEN_METADATA_PROGRAM_ID = new PublicKey(
  "metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s"
);

const SYSVAR_RENT = new PublicKey(
  "SysvarRent111111111111111111111111111111111"
);

// ---------------------------------------------------------------------------
// PDA Helpers
// ---------------------------------------------------------------------------

function getAuctionPDA(seller: PublicKey, mint: PublicKey, programId: PublicKey) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("auction"), seller.toBuffer(), mint.toBuffer()],
    programId
  );
}

function getVaultPDA(auctionState: PublicKey, programId: PublicKey) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("vault"), auctionState.toBuffer()],
    programId
  );
}

function getDepositPDA(auctionState: PublicKey, bidder: PublicKey, programId: PublicKey) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("deposit"), auctionState.toBuffer(), bidder.toBuffer()],
    programId
  );
}

function getMetadataPDA(mint: PublicKey) {
  return PublicKey.findProgramAddressSync(
    [
      Buffer.from("metadata"),
      TOKEN_METADATA_PROGRAM_ID.toBuffer(),
      mint.toBuffer(),
    ],
    TOKEN_METADATA_PROGRAM_ID
  );
}

// ---------------------------------------------------------------------------
// Metaplex metadata helper — builds CreateMetadataAccountV3 instruction
// ---------------------------------------------------------------------------

function createMetadataV3Instruction(
  metadataPda: PublicKey,
  mint: PublicKey,
  mintAuthority: PublicKey,
  payer: PublicKey,
  updateAuthority: PublicKey,
  name: string,
  symbol: string,
  uri: string,
  sellerFeeBps: number,
  creators: { address: PublicKey; verified: boolean; share: number }[]
): TransactionInstruction {
  const nameBytes = Buffer.from(name);
  const symbolBytes = Buffer.from(symbol);
  const uriBytes = Buffer.from(uri);

  const hasCreators = creators.length > 0;

  // Calculate buffer size
  const size =
    1 + // instruction discriminator (33)
    4 + nameBytes.length +
    4 + symbolBytes.length +
    4 + uriBytes.length +
    2 + // seller_fee_basis_points
    1 + // creators option
    (hasCreators ? 4 + creators.length * 34 : 0) +
    1 + // collection option (None)
    1 + // uses option (None)
    1 + // is_mutable
    1;  // collection_details option (None)

  const data = Buffer.alloc(size);
  let offset = 0;

  // Instruction discriminator: 33 = CreateMetadataAccountV3
  data.writeUInt8(33, offset); offset += 1;

  // name
  data.writeUInt32LE(nameBytes.length, offset); offset += 4;
  nameBytes.copy(data, offset); offset += nameBytes.length;

  // symbol
  data.writeUInt32LE(symbolBytes.length, offset); offset += 4;
  symbolBytes.copy(data, offset); offset += symbolBytes.length;

  // uri
  data.writeUInt32LE(uriBytes.length, offset); offset += 4;
  uriBytes.copy(data, offset); offset += uriBytes.length;

  // seller_fee_basis_points
  data.writeUInt16LE(sellerFeeBps, offset); offset += 2;

  // creators
  if (hasCreators) {
    data.writeUInt8(1, offset); offset += 1; // Some
    data.writeUInt32LE(creators.length, offset); offset += 4;
    for (const c of creators) {
      c.address.toBuffer().copy(data, offset); offset += 32;
      data.writeUInt8(c.verified ? 1 : 0, offset); offset += 1;
      data.writeUInt8(c.share, offset); offset += 1;
    }
  } else {
    data.writeUInt8(0, offset); offset += 1; // None
  }

  // collection: None
  data.writeUInt8(0, offset); offset += 1;
  // uses: None
  data.writeUInt8(0, offset); offset += 1;
  // is_mutable: true
  data.writeUInt8(1, offset); offset += 1;
  // collection_details: None
  data.writeUInt8(0, offset); offset += 1;

  return new TransactionInstruction({
    programId: TOKEN_METADATA_PROGRAM_ID,
    keys: [
      { pubkey: metadataPda, isSigner: false, isWritable: true },
      { pubkey: mint, isSigner: false, isWritable: false },
      { pubkey: mintAuthority, isSigner: true, isWritable: false },
      { pubkey: payer, isSigner: true, isWritable: true },
      { pubkey: updateAuthority, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: SYSVAR_RENT, isSigner: false, isWritable: false },
    ],
    data,
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("outcry", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.Outcry as Program<Outcry>;
  const connection = provider.connection;

  // Test accounts
  const seller = Keypair.generate();
  const bidder1 = Keypair.generate();
  const bidder2 = Keypair.generate();
  let nftMint: PublicKey;
  let sellerNftAta: PublicKey;
  let auctionState: PublicKey;
  let auctionVault: PublicKey;
  let escrowNftAta: PublicKey;
  let nftMetadataPda: PublicKey;

  // Auction params
  const reservePrice = new anchor.BN(1 * LAMPORTS_PER_SOL);
  const durationSeconds = new anchor.BN(5); // matches MIN_AUCTION_DURATION
  const extensionSeconds = 2;
  const extensionWindow = 2;
  const minBidIncrement = new anchor.BN(0.1 * LAMPORTS_PER_SOL);

  before(async () => {
    // Airdrop SOL to test wallets
    for (const kp of [seller, bidder1, bidder2]) {
      const sig = await connection.requestAirdrop(kp.publicKey, 10 * LAMPORTS_PER_SOL);
      await connection.confirmTransaction(sig);
    }

    // Create NFT mint (0 decimals)
    nftMint = await createMint(connection, seller, seller.publicKey, null, 0);

    // Create seller ATA and mint 1 NFT
    sellerNftAta = await createAssociatedTokenAccount(
      connection, seller, nftMint, seller.publicKey
    );
    await mintTo(connection, seller, nftMint, sellerNftAta, seller, 1);

    // Create Metaplex metadata for the NFT (5% royalty, seller is sole creator)
    [nftMetadataPda] = getMetadataPDA(nftMint);
    const createMetaIx = createMetadataV3Instruction(
      nftMetadataPda,
      nftMint,
      seller.publicKey, // mint authority
      seller.publicKey, // payer
      seller.publicKey, // update authority
      "Test NFT",
      "TEST",
      "https://example.com/test.json",
      500, // 5% royalty
      [{ address: seller.publicKey, verified: true, share: 100 }]
    );
    const tx = new Transaction().add(createMetaIx);
    await sendAndConfirmTransaction(connection, tx, [seller]);

    // Derive PDAs
    [auctionState] = getAuctionPDA(seller.publicKey, nftMint, program.programId);
    [auctionVault] = getVaultPDA(auctionState, program.programId);
    escrowNftAta = await getAssociatedTokenAddress(nftMint, auctionState, true);
  });

  it("creates an auction", async () => {
    await program.methods
      .createAuction(
        reservePrice,
        durationSeconds,
        extensionSeconds,
        extensionWindow,
        minBidIncrement
      )
      .accountsStrict({
        seller: seller.publicKey,
        nftMint,
        sellerNftTokenAccount: sellerNftAta,
        escrowNftTokenAccount: escrowNftAta,
        auctionState,
        auctionVault,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .signers([seller])
      .rpc();

    const auction = await program.account.auctionState.fetch(auctionState);
    expect(auction.seller.toBase58()).to.equal(seller.publicKey.toBase58());
    expect(auction.nftMint.toBase58()).to.equal(nftMint.toBase58());
    expect(auction.reservePrice.toNumber()).to.equal(LAMPORTS_PER_SOL);
    expect(auction.currentBid.toNumber()).to.equal(0);
    expect(auction.bidCount).to.equal(0);
    expect(JSON.stringify(auction.status)).to.equal(
      JSON.stringify({ created: {} })
    );

    // NFT is in escrow
    const escrowAccount = await getAccount(connection, escrowNftAta);
    expect(Number(escrowAccount.amount)).to.equal(1);

    const sellerAccount = await getAccount(connection, sellerNftAta);
    expect(Number(sellerAccount.amount)).to.equal(0);
  });

  it("accepts deposits from bidders via BidderDeposit PDAs", async () => {
    const depositAmount = new anchor.BN(3 * LAMPORTS_PER_SOL);

    // Bidder1 deposits
    const [bidder1Deposit] = getDepositPDA(auctionState, bidder1.publicKey, program.programId);
    await program.methods
      .deposit(depositAmount)
      .accountsStrict({
        bidder: bidder1.publicKey,
        auctionState,
        bidderDeposit: bidder1Deposit,
        auctionVault,
        systemProgram: SystemProgram.programId,
      })
      .signers([bidder1])
      .rpc();

    let deposit1 = await program.account.bidderDeposit.fetch(bidder1Deposit);
    expect(deposit1.amount.toNumber()).to.equal(3 * LAMPORTS_PER_SOL);
    expect(deposit1.bidder.toBase58()).to.equal(bidder1.publicKey.toBase58());

    // Bidder2 deposits
    const [bidder2Deposit] = getDepositPDA(auctionState, bidder2.publicKey, program.programId);
    await program.methods
      .deposit(depositAmount)
      .accountsStrict({
        bidder: bidder2.publicKey,
        auctionState,
        bidderDeposit: bidder2Deposit,
        auctionVault,
        systemProgram: SystemProgram.programId,
      })
      .signers([bidder2])
      .rpc();

    let deposit2 = await program.account.bidderDeposit.fetch(bidder2Deposit);
    expect(deposit2.amount.toNumber()).to.equal(3 * LAMPORTS_PER_SOL);
    expect(deposit2.bidder.toBase58()).to.equal(bidder2.publicKey.toBase58());
  });

  it("starts the auction", async () => {
    await program.methods
      .startAuction()
      .accountsStrict({
        seller: seller.publicKey,
        auctionState,
      })
      .signers([seller])
      .rpc();

    const auction = await program.account.auctionState.fetch(auctionState);
    expect(JSON.stringify(auction.status)).to.equal(
      JSON.stringify({ active: {} })
    );
    expect(auction.startTime.toNumber()).to.be.greaterThan(0);
    expect(auction.endTime.toNumber()).to.be.greaterThan(
      auction.startTime.toNumber()
    );
  });

  it("places bids (deposit check deferred to settlement)", async () => {
    // Bidder1 places first bid at reserve price
    await program.methods
      .placeBid(reservePrice)
      .accountsStrict({
        bidder: bidder1.publicKey,
        auctionState,
      })
      .signers([bidder1])
      .rpc();

    let auction = await program.account.auctionState.fetch(auctionState);
    expect(auction.currentBid.toNumber()).to.equal(LAMPORTS_PER_SOL);
    expect(auction.highestBidder.toBase58()).to.equal(
      bidder1.publicKey.toBase58()
    );
    expect(auction.bidCount).to.equal(1);

    // Bidder2 outbids
    const bid2Amount = new anchor.BN(1.2 * LAMPORTS_PER_SOL);
    await program.methods
      .placeBid(bid2Amount)
      .accountsStrict({
        bidder: bidder2.publicKey,
        auctionState,
      })
      .signers([bidder2])
      .rpc();

    auction = await program.account.auctionState.fetch(auctionState);
    expect(auction.currentBid.toNumber()).to.equal(1.2 * LAMPORTS_PER_SOL);
    expect(auction.highestBidder.toBase58()).to.equal(
      bidder2.publicKey.toBase58()
    );
    expect(auction.bidCount).to.equal(2);
  });

  it("rejects bid below minimum increment", async () => {
    const lowBid = new anchor.BN(1.25 * LAMPORTS_PER_SOL);
    try {
      await program.methods
        .placeBid(lowBid)
        .accountsStrict({
          bidder: bidder1.publicKey,
          auctionState,
        })
        .signers([bidder1])
        .rpc();
      expect.fail("Should have thrown");
    } catch (err: any) {
      expect(err.error.errorCode.code).to.equal("BidTooLow");
    }
  });

  it("rejects seller bidding on own auction", async () => {
    const bid = new anchor.BN(2 * LAMPORTS_PER_SOL);
    try {
      await program.methods
        .placeBid(bid)
        .accountsStrict({
          bidder: seller.publicKey,
          auctionState,
        })
        .signers([seller])
        .rpc();
      expect.fail("Should have thrown");
    } catch (err: any) {
      expect(err.error.errorCode.code).to.equal("SellerCannotBid");
    }
  });

  it("rejects ending auction before time expires", async () => {
    try {
      await program.methods
        .endAuction()
        .accountsStrict({
          authority: seller.publicKey,
          auctionState,
        })
        .signers([seller])
        .rpc();
      expect.fail("Should have thrown");
    } catch (err: any) {
      expect(err.error.errorCode.code).to.equal("AuctionStillActive");
    }
  });

  it("ends auction after time expires", async () => {
    const auction = await program.account.auctionState.fetch(auctionState);
    const now = Math.floor(Date.now() / 1000);
    const waitTime = auction.endTime.toNumber() - now + 2;
    if (waitTime > 0) {
      await new Promise((resolve) => setTimeout(resolve, waitTime * 1000));
    }

    await program.methods
      .endAuction()
      .accountsStrict({
        authority: seller.publicKey,
        auctionState,
      })
      .signers([seller])
      .rpc();

    const endedAuction = await program.account.auctionState.fetch(auctionState);
    expect(JSON.stringify(endedAuction.status)).to.equal(
      JSON.stringify({ ended: {} })
    );
  });

  it("settles auction with royalty distribution — NFT to winner, SOL split", async () => {
    const sellerBalBefore = await connection.getBalance(seller.publicKey);

    const [winnerDeposit] = getDepositPDA(auctionState, bidder2.publicKey, program.programId);
    const winnerNftAta = await getAssociatedTokenAddress(nftMint, bidder2.publicKey);

    // seller is the sole creator with 100% share, 5% royalty
    // So royalty = 5% of 1.2 SOL = 0.06 SOL → goes to seller (as creator)
    // seller_receives = 1.2 - 0.06 = 1.14 SOL (as seller)
    // Total to seller = 0.06 + 1.14 = 1.2 SOL (because they're both seller and creator)
    await program.methods
      .settleAuction()
      .accountsStrict({
        payer: seller.publicKey,
        auctionState,
        auctionVault,
        winnerDeposit,
        seller: seller.publicKey,
        winner: bidder2.publicKey,
        nftMint,
        nftMetadata: nftMetadataPda,
        escrowNftTokenAccount: escrowNftAta,
        winnerNftTokenAccount: winnerNftAta,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .remainingAccounts([
        { pubkey: seller.publicKey, isSigner: false, isWritable: true },
      ])
      .signers([seller])
      .rpc();

    // Verify auction settled
    const auction = await program.account.auctionState.fetch(auctionState);
    expect(JSON.stringify(auction.status)).to.equal(
      JSON.stringify({ settled: {} })
    );

    // Verify NFT transferred to winner
    const winnerNftAccount = await getAccount(connection, winnerNftAta);
    expect(Number(winnerNftAccount.amount)).to.equal(1);

    // Verify escrow is empty
    const escrowAccount = await getAccount(connection, escrowNftAta);
    expect(Number(escrowAccount.amount)).to.equal(0);

    // Verify seller received SOL (winning bid = 1.2 SOL, minus tx fees)
    const sellerBalAfter = await connection.getBalance(seller.publicKey);
    const sellerGain = sellerBalAfter - sellerBalBefore;
    // Seller is both seller and sole creator → receives full 1.2 SOL minus tx fee
    expect(sellerGain).to.be.greaterThan(1.1 * LAMPORTS_PER_SOL);

    // Verify winner's deposit was deducted (3 SOL - 1.2 SOL = 1.8 SOL)
    const depositAccount = await program.account.bidderDeposit.fetch(winnerDeposit);
    expect(depositAccount.amount.toNumber()).to.equal(1.8 * LAMPORTS_PER_SOL);
  });

  it("allows winner to claim remaining deposit", async () => {
    const winnerBalBefore = await connection.getBalance(bidder2.publicKey);
    const [bidder2Deposit] = getDepositPDA(auctionState, bidder2.publicKey, program.programId);

    await program.methods
      .claimRefund()
      .accountsStrict({
        bidder: bidder2.publicKey,
        auctionState,
        bidderDeposit: bidder2Deposit,
        auctionVault,
        systemProgram: SystemProgram.programId,
      })
      .signers([bidder2])
      .rpc();

    const winnerBalAfter = await connection.getBalance(bidder2.publicKey);
    const refund = winnerBalAfter - winnerBalBefore;
    // Should receive ~1.8 SOL back (minus tx fee)
    expect(refund).to.be.greaterThan(1.7 * LAMPORTS_PER_SOL);

    // Deposit should be zeroed
    const deposit = await program.account.bidderDeposit.fetch(bidder2Deposit);
    expect(deposit.amount.toNumber()).to.equal(0);
  });

  it("allows loser to claim full refund", async () => {
    const loserBalBefore = await connection.getBalance(bidder1.publicKey);
    const [bidder1Deposit] = getDepositPDA(auctionState, bidder1.publicKey, program.programId);

    await program.methods
      .claimRefund()
      .accountsStrict({
        bidder: bidder1.publicKey,
        auctionState,
        bidderDeposit: bidder1Deposit,
        auctionVault,
        systemProgram: SystemProgram.programId,
      })
      .signers([bidder1])
      .rpc();

    const loserBalAfter = await connection.getBalance(bidder1.publicKey);
    const refund = loserBalAfter - loserBalBefore;
    // Should receive full 3 SOL back (minus tx fee)
    expect(refund).to.be.greaterThan(2.9 * LAMPORTS_PER_SOL);

    const deposit = await program.account.bidderDeposit.fetch(bidder1Deposit);
    expect(deposit.amount.toNumber()).to.equal(0);
  });

  it("closes settled auction accounts and recovers rent", async () => {
    const sellerBalBefore = await connection.getBalance(seller.publicKey);

    await program.methods
      .closeAuction()
      .accountsStrict({
        seller: seller.publicKey,
        auctionState,
        auctionVault,
        nftMint,
        escrowNftTokenAccount: escrowNftAta,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([seller])
      .rpc();

    const sellerBalAfter = await connection.getBalance(seller.publicKey);
    const rentRecovered = sellerBalAfter - sellerBalBefore;
    expect(rentRecovered).to.be.greaterThan(0);

    // AuctionState should no longer exist
    const info = await connection.getAccountInfo(auctionState);
    expect(info).to.be.null;

    // AuctionVault should no longer exist
    const vaultInfo = await connection.getAccountInfo(auctionVault);
    expect(vaultInfo).to.be.null;
  });

  // --- Cancel auction tests (separate auction) ---

  describe("cancel flow", () => {
    const cancelSeller = Keypair.generate();
    let cancelNftMint: PublicKey;
    let cancelSellerNftAta: PublicKey;
    let cancelAuctionState: PublicKey;
    let cancelAuctionVault: PublicKey;
    let cancelEscrowNftAta: PublicKey;

    before(async () => {
      const airdrop = await connection.requestAirdrop(
        cancelSeller.publicKey,
        10 * LAMPORTS_PER_SOL
      );
      await connection.confirmTransaction(airdrop);

      cancelNftMint = await createMint(
        connection, cancelSeller, cancelSeller.publicKey, null, 0
      );

      cancelSellerNftAta = await createAssociatedTokenAccount(
        connection, cancelSeller, cancelNftMint, cancelSeller.publicKey
      );

      await mintTo(connection, cancelSeller, cancelNftMint, cancelSellerNftAta, cancelSeller, 1);

      [cancelAuctionState] = getAuctionPDA(cancelSeller.publicKey, cancelNftMint, program.programId);
      [cancelAuctionVault] = getVaultPDA(cancelAuctionState, program.programId);
      cancelEscrowNftAta = await getAssociatedTokenAddress(cancelNftMint, cancelAuctionState, true);

      await program.methods
        .createAuction(
          reservePrice,
          new anchor.BN(60),
          extensionSeconds,
          extensionWindow,
          minBidIncrement
        )
        .accountsStrict({
          seller: cancelSeller.publicKey,
          nftMint: cancelNftMint,
          sellerNftTokenAccount: cancelSellerNftAta,
          escrowNftTokenAccount: cancelEscrowNftAta,
          auctionState: cancelAuctionState,
          auctionVault: cancelAuctionVault,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([cancelSeller])
        .rpc();
    });

    it("cancels auction and returns NFT", async () => {
      let escrow = await getAccount(connection, cancelEscrowNftAta);
      expect(Number(escrow.amount)).to.equal(1);

      await program.methods
        .cancelAuction()
        .accountsStrict({
          seller: cancelSeller.publicKey,
          auctionState: cancelAuctionState,
          nftMint: cancelNftMint,
          escrowNftTokenAccount: cancelEscrowNftAta,
          sellerNftTokenAccount: cancelSellerNftAta,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([cancelSeller])
        .rpc();

      const sellerNft = await getAccount(connection, cancelSellerNftAta);
      expect(Number(sellerNft.amount)).to.equal(1);

      escrow = await getAccount(connection, cancelEscrowNftAta);
      expect(Number(escrow.amount)).to.equal(0);

      const auction = await program.account.auctionState.fetch(cancelAuctionState);
      expect(JSON.stringify(auction.status)).to.equal(
        JSON.stringify({ cancelled: {} })
      );
    });

    it("closes cancelled auction accounts and recovers rent", async () => {
      const sellerBalBefore = await connection.getBalance(cancelSeller.publicKey);

      await program.methods
        .closeAuction()
        .accountsStrict({
          seller: cancelSeller.publicKey,
          auctionState: cancelAuctionState,
          auctionVault: cancelAuctionVault,
          nftMint: cancelNftMint,
          escrowNftTokenAccount: cancelEscrowNftAta,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([cancelSeller])
        .rpc();

      const sellerBalAfter = await connection.getBalance(cancelSeller.publicKey);
      const rentRecovered = sellerBalAfter - sellerBalBefore;
      expect(rentRecovered).to.be.greaterThan(0);

      const info = await connection.getAccountInfo(cancelAuctionState);
      expect(info).to.be.null;
    });
  });

  // --- Forfeit auction tests (griefing protection) ---

  describe("forfeit flow (underfunded winner)", () => {
    const forfeitSeller = Keypair.generate();
    const griefer = Keypair.generate();
    let forfeitNftMint: PublicKey;
    let forfeitSellerNftAta: PublicKey;
    let forfeitAuctionState: PublicKey;
    let forfeitAuctionVault: PublicKey;
    let forfeitEscrowNftAta: PublicKey;
    let forfeitNftMetadata: PublicKey;

    before(async () => {
      for (const kp of [forfeitSeller, griefer]) {
        const sig = await connection.requestAirdrop(kp.publicKey, 10 * LAMPORTS_PER_SOL);
        await connection.confirmTransaction(sig);
      }

      forfeitNftMint = await createMint(
        connection, forfeitSeller, forfeitSeller.publicKey, null, 0
      );

      forfeitSellerNftAta = await createAssociatedTokenAccount(
        connection, forfeitSeller, forfeitNftMint, forfeitSeller.publicKey
      );

      await mintTo(connection, forfeitSeller, forfeitNftMint, forfeitSellerNftAta, forfeitSeller, 1);

      // Create metadata
      [forfeitNftMetadata] = getMetadataPDA(forfeitNftMint);
      const createMetaIx = createMetadataV3Instruction(
        forfeitNftMetadata,
        forfeitNftMint,
        forfeitSeller.publicKey,
        forfeitSeller.publicKey,
        forfeitSeller.publicKey,
        "Forfeit Test NFT",
        "FORF",
        "https://example.com/forfeit.json",
        0,
        []
      );
      const tx = new Transaction().add(createMetaIx);
      await sendAndConfirmTransaction(connection, tx, [forfeitSeller]);

      [forfeitAuctionState] = getAuctionPDA(forfeitSeller.publicKey, forfeitNftMint, program.programId);
      [forfeitAuctionVault] = getVaultPDA(forfeitAuctionState, program.programId);
      forfeitEscrowNftAta = await getAssociatedTokenAddress(forfeitNftMint, forfeitAuctionState, true);

      // Create auction
      await program.methods
        .createAuction(
          new anchor.BN(1 * LAMPORTS_PER_SOL),
          new anchor.BN(5),
          2,
          2,
          new anchor.BN(0.1 * LAMPORTS_PER_SOL)
        )
        .accountsStrict({
          seller: forfeitSeller.publicKey,
          nftMint: forfeitNftMint,
          sellerNftTokenAccount: forfeitSellerNftAta,
          escrowNftTokenAccount: forfeitEscrowNftAta,
          auctionState: forfeitAuctionState,
          auctionVault: forfeitAuctionVault,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([forfeitSeller])
        .rpc();

      // Griefer deposits only 0.5 SOL (less than the 1 SOL reserve)
      const [grieferDeposit] = getDepositPDA(forfeitAuctionState, griefer.publicKey, program.programId);
      await program.methods
        .deposit(new anchor.BN(0.5 * LAMPORTS_PER_SOL))
        .accountsStrict({
          bidder: griefer.publicKey,
          auctionState: forfeitAuctionState,
          bidderDeposit: grieferDeposit,
          auctionVault: forfeitAuctionVault,
          systemProgram: SystemProgram.programId,
        })
        .signers([griefer])
        .rpc();

      // Start, bid (bid > deposit!), wait, end
      await program.methods
        .startAuction()
        .accountsStrict({
          seller: forfeitSeller.publicKey,
          auctionState: forfeitAuctionState,
        })
        .signers([forfeitSeller])
        .rpc();

      // Griefer bids 1 SOL but only deposited 0.5 SOL
      await program.methods
        .placeBid(new anchor.BN(1 * LAMPORTS_PER_SOL))
        .accountsStrict({
          bidder: griefer.publicKey,
          auctionState: forfeitAuctionState,
        })
        .signers([griefer])
        .rpc();

      // Wait for auction to expire
      const auction = await program.account.auctionState.fetch(forfeitAuctionState);
      const now = Math.floor(Date.now() / 1000);
      const waitTime = auction.endTime.toNumber() - now + 2;
      if (waitTime > 0) {
        await new Promise((resolve) => setTimeout(resolve, waitTime * 1000));
      }

      await program.methods
        .endAuction()
        .accountsStrict({
          authority: forfeitSeller.publicKey,
          auctionState: forfeitAuctionState,
        })
        .signers([forfeitSeller])
        .rpc();
    });

    it("rejects normal settlement when winner deposit is insufficient", async () => {
      const [winnerDeposit] = getDepositPDA(forfeitAuctionState, griefer.publicKey, program.programId);
      const winnerNftAta = await getAssociatedTokenAddress(forfeitNftMint, griefer.publicKey);

      try {
        await program.methods
          .settleAuction()
          .accountsStrict({
            payer: forfeitSeller.publicKey,
            auctionState: forfeitAuctionState,
            auctionVault: forfeitAuctionVault,
            winnerDeposit,
            seller: forfeitSeller.publicKey,
            winner: griefer.publicKey,
            nftMint: forfeitNftMint,
            nftMetadata: forfeitNftMetadata,
            escrowNftTokenAccount: forfeitEscrowNftAta,
            winnerNftTokenAccount: winnerNftAta,
            tokenProgram: TOKEN_PROGRAM_ID,
            associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
          })
          .signers([forfeitSeller])
          .rpc();
        expect.fail("Should have thrown InsufficientDeposit");
      } catch (err: any) {
        expect(err.error.errorCode.code).to.equal("InsufficientDeposit");
      }
    });

    it("forfeits auction — NFT returned to seller, griefer deposit slashed", async () => {
      const sellerBalBefore = await connection.getBalance(forfeitSeller.publicKey);

      const [grieferDeposit] = getDepositPDA(forfeitAuctionState, griefer.publicKey, program.programId);

      await program.methods
        .forfeitAuction()
        .accountsStrict({
          payer: forfeitSeller.publicKey,
          auctionState: forfeitAuctionState,
          auctionVault: forfeitAuctionVault,
          winnerDeposit: grieferDeposit,
          seller: forfeitSeller.publicKey,
          nftMint: forfeitNftMint,
          escrowNftTokenAccount: forfeitEscrowNftAta,
          sellerNftTokenAccount: forfeitSellerNftAta,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([forfeitSeller])
        .rpc();

      // Auction is now Settled
      const auction = await program.account.auctionState.fetch(forfeitAuctionState);
      expect(JSON.stringify(auction.status)).to.equal(
        JSON.stringify({ settled: {} })
      );

      // NFT returned to seller
      const sellerNft = await getAccount(connection, forfeitSellerNftAta);
      expect(Number(sellerNft.amount)).to.equal(1);

      // Escrow is empty
      const escrow = await getAccount(connection, forfeitEscrowNftAta);
      expect(Number(escrow.amount)).to.equal(0);

      // Seller received griefer's 0.5 SOL deposit as penalty
      const sellerBalAfter = await connection.getBalance(forfeitSeller.publicKey);
      const sellerGain = sellerBalAfter - sellerBalBefore;
      // Gain ~0.5 SOL (penalty) minus tx fees
      expect(sellerGain).to.be.greaterThan(0.4 * LAMPORTS_PER_SOL);

      // Griefer's deposit is zeroed (can't claim refund)
      const deposit = await program.account.bidderDeposit.fetch(grieferDeposit);
      expect(deposit.amount.toNumber()).to.equal(0);
    });
  });
});
