import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Outcry } from "../target/types/outcry";
import {
  Keypair,
  PublicKey,
  SystemProgram,
  LAMPORTS_PER_SOL,
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

  // Auction params
  const reservePrice = new anchor.BN(1 * LAMPORTS_PER_SOL);
  const durationSeconds = new anchor.BN(5); // 5 seconds — matches MIN_AUCTION_DURATION
  const extensionSeconds = 2;
  const extensionWindow = 2;
  const minBidIncrement = new anchor.BN(0.1 * LAMPORTS_PER_SOL);

  before(async () => {
    // Airdrop SOL to test wallets
    const airdropSeller = await connection.requestAirdrop(
      seller.publicKey,
      10 * LAMPORTS_PER_SOL
    );
    await connection.confirmTransaction(airdropSeller);

    const airdropBidder1 = await connection.requestAirdrop(
      bidder1.publicKey,
      10 * LAMPORTS_PER_SOL
    );
    await connection.confirmTransaction(airdropBidder1);

    const airdropBidder2 = await connection.requestAirdrop(
      bidder2.publicKey,
      10 * LAMPORTS_PER_SOL
    );
    await connection.confirmTransaction(airdropBidder2);

    // Create NFT mint
    nftMint = await createMint(
      connection,
      seller,
      seller.publicKey,
      null,
      0
    );

    // Create seller's ATA and mint 1 NFT
    sellerNftAta = await createAssociatedTokenAccount(
      connection,
      seller,
      nftMint,
      seller.publicKey
    );

    await mintTo(connection, seller, nftMint, sellerNftAta, seller, 1);

    // Derive PDAs
    [auctionState] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("auction"),
        seller.publicKey.toBuffer(),
        nftMint.toBuffer(),
      ],
      program.programId
    );

    [auctionVault] = PublicKey.findProgramAddressSync(
      [Buffer.from("vault"), auctionState.toBuffer()],
      program.programId
    );

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
        nftMint: nftMint,
        sellerNftTokenAccount: sellerNftAta,
        escrowNftTokenAccount: escrowNftAta,
        auctionState: auctionState,
        auctionVault: auctionVault,
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
    expect(auction.deposits).to.have.lengthOf(0);
    expect(JSON.stringify(auction.status)).to.equal(
      JSON.stringify({ created: {} })
    );

    // NFT is in escrow
    const escrowAccount = await getAccount(connection, escrowNftAta);
    expect(Number(escrowAccount.amount)).to.equal(1);

    const sellerAccount = await getAccount(connection, sellerNftAta);
    expect(Number(sellerAccount.amount)).to.equal(0);
  });

  it("accepts deposits from bidders", async () => {
    const depositAmount = new anchor.BN(3 * LAMPORTS_PER_SOL);

    await program.methods
      .deposit(depositAmount)
      .accountsStrict({
        bidder: bidder1.publicKey,
        auctionState: auctionState,
        auctionVault: auctionVault,
        systemProgram: SystemProgram.programId,
      })
      .signers([bidder1])
      .rpc();

    let auction = await program.account.auctionState.fetch(auctionState);
    expect(auction.deposits).to.have.lengthOf(1);
    expect(auction.deposits[0].bidder.toBase58()).to.equal(
      bidder1.publicKey.toBase58()
    );
    expect(auction.deposits[0].amount.toNumber()).to.equal(3 * LAMPORTS_PER_SOL);

    // Bidder2 deposits
    await program.methods
      .deposit(depositAmount)
      .accountsStrict({
        bidder: bidder2.publicKey,
        auctionState: auctionState,
        auctionVault: auctionVault,
        systemProgram: SystemProgram.programId,
      })
      .signers([bidder2])
      .rpc();

    auction = await program.account.auctionState.fetch(auctionState);
    expect(auction.deposits).to.have.lengthOf(2);
    expect(auction.deposits[1].bidder.toBase58()).to.equal(
      bidder2.publicKey.toBase58()
    );
    expect(auction.deposits[1].amount.toNumber()).to.equal(3 * LAMPORTS_PER_SOL);
  });

  it("starts the auction", async () => {
    await program.methods
      .startAuction()
      .accountsStrict({
        seller: seller.publicKey,
        auctionState: auctionState,
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

  it("places bids", async () => {
    // Bidder1 places first bid at reserve price
    await program.methods
      .placeBid(reservePrice)
      .accountsStrict({
        bidder: bidder1.publicKey,
        auctionState: auctionState,
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
        auctionState: auctionState,
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
          auctionState: auctionState,
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
          auctionState: auctionState,
        })
        .signers([seller])
        .rpc();
      expect.fail("Should have thrown");
    } catch (err: any) {
      expect(err.error.errorCode.code).to.equal("SellerCannotBid");
    }
  });

  it("rejects bid exceeding deposit", async () => {
    // Bidder1 deposited 3 SOL, try to bid 5 SOL
    const hugeBid = new anchor.BN(5 * LAMPORTS_PER_SOL);
    try {
      await program.methods
        .placeBid(hugeBid)
        .accountsStrict({
          bidder: bidder1.publicKey,
          auctionState: auctionState,
        })
        .signers([bidder1])
        .rpc();
      expect.fail("Should have thrown");
    } catch (err: any) {
      expect(err.error.errorCode.code).to.equal("InsufficientDeposit");
    }
  });

  it("rejects ending auction before time expires", async () => {
    try {
      await program.methods
        .endAuction()
        .accountsStrict({
          authority: seller.publicKey,
          auctionState: auctionState,
        })
        .signers([seller])
        .rpc();
      expect.fail("Should have thrown");
    } catch (err: any) {
      expect(err.error.errorCode.code).to.equal("AuctionStillActive");
    }
  });

  it("ends auction after time expires", async () => {
    // Wait for auction to expire (5 second duration + anti-snipe extensions)
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
        auctionState: auctionState,
      })
      .signers([seller])
      .rpc();

    const endedAuction = await program.account.auctionState.fetch(auctionState);
    expect(JSON.stringify(endedAuction.status)).to.equal(
      JSON.stringify({ ended: {} })
    );
  });

  it("settles the auction — NFT to winner, SOL to seller", async () => {
    const sellerBalBefore = await connection.getBalance(seller.publicKey);

    const winnerNftAta = await getAssociatedTokenAddress(
      nftMint,
      bidder2.publicKey
    );

    await program.methods
      .settleAuction()
      .accountsStrict({
        payer: seller.publicKey,
        auctionState: auctionState,
        auctionVault: auctionVault,
        seller: seller.publicKey,
        winner: bidder2.publicKey,
        nftMint: nftMint,
        escrowNftTokenAccount: escrowNftAta,
        winnerNftTokenAccount: winnerNftAta,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
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

    // Verify seller received SOL (winning bid = 1.2 SOL)
    const sellerBalAfter = await connection.getBalance(seller.publicKey);
    const sellerGain = sellerBalAfter - sellerBalBefore;
    // Seller gains ~1.2 SOL minus tx fees for the settle instruction
    expect(sellerGain).to.be.greaterThan(1.1 * LAMPORTS_PER_SOL);

    // Verify winner's deposit was deducted (3 SOL - 1.2 SOL = 1.8 SOL)
    const winnerDeposit = auction.deposits.find(
      (d: any) => d.bidder.toBase58() === bidder2.publicKey.toBase58()
    );
    expect(winnerDeposit.amount.toNumber()).to.equal(1.8 * LAMPORTS_PER_SOL);
  });

  it("allows winner to claim remaining deposit", async () => {
    const winnerBalBefore = await connection.getBalance(bidder2.publicKey);

    await program.methods
      .claimRefund()
      .accountsStrict({
        bidder: bidder2.publicKey,
        auctionState: auctionState,
        auctionVault: auctionVault,
        systemProgram: SystemProgram.programId,
      })
      .signers([bidder2])
      .rpc();

    const winnerBalAfter = await connection.getBalance(bidder2.publicKey);
    const refund = winnerBalAfter - winnerBalBefore;
    // Should receive ~1.8 SOL back (minus tx fee)
    expect(refund).to.be.greaterThan(1.7 * LAMPORTS_PER_SOL);

    // Deposit should be zeroed
    const auction = await program.account.auctionState.fetch(auctionState);
    const winnerDeposit = auction.deposits.find(
      (d: any) => d.bidder.toBase58() === bidder2.publicKey.toBase58()
    );
    expect(winnerDeposit.amount.toNumber()).to.equal(0);
  });

  it("allows loser to claim full refund", async () => {
    const loserBalBefore = await connection.getBalance(bidder1.publicKey);

    await program.methods
      .claimRefund()
      .accountsStrict({
        bidder: bidder1.publicKey,
        auctionState: auctionState,
        auctionVault: auctionVault,
        systemProgram: SystemProgram.programId,
      })
      .signers([bidder1])
      .rpc();

    const loserBalAfter = await connection.getBalance(bidder1.publicKey);
    const refund = loserBalAfter - loserBalBefore;
    // Should receive full 3 SOL back (minus tx fee)
    expect(refund).to.be.greaterThan(2.9 * LAMPORTS_PER_SOL);

    const auction = await program.account.auctionState.fetch(auctionState);
    const loserDeposit = auction.deposits.find(
      (d: any) => d.bidder.toBase58() === bidder1.publicKey.toBase58()
    );
    expect(loserDeposit.amount.toNumber()).to.equal(0);
  });

  it("closes settled auction accounts and recovers rent", async () => {
    const sellerBalBefore = await connection.getBalance(seller.publicKey);

    await program.methods
      .closeAuction()
      .accountsStrict({
        seller: seller.publicKey,
        auctionState: auctionState,
        auctionVault: auctionVault,
        nftMint: nftMint,
        escrowNftTokenAccount: escrowNftAta,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([seller])
      .rpc();

    const sellerBalAfter = await connection.getBalance(seller.publicKey);
    const rentRecovered = sellerBalAfter - sellerBalBefore;
    // Should recover rent from AuctionState + AuctionVault + escrow ATA (minus tx fee)
    expect(rentRecovered).to.be.greaterThan(0);

    // AuctionState should no longer exist
    const info = await connection.getAccountInfo(auctionState);
    expect(info).to.be.null;

    // AuctionVault should no longer exist
    const vaultInfo = await connection.getAccountInfo(auctionVault);
    expect(vaultInfo).to.be.null;

    // Escrow ATA should no longer exist
    const escrowInfo = await connection.getAccountInfo(escrowNftAta);
    expect(escrowInfo).to.be.null;
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
        connection,
        cancelSeller,
        cancelSeller.publicKey,
        null,
        0
      );

      cancelSellerNftAta = await createAssociatedTokenAccount(
        connection,
        cancelSeller,
        cancelNftMint,
        cancelSeller.publicKey
      );

      await mintTo(
        connection,
        cancelSeller,
        cancelNftMint,
        cancelSellerNftAta,
        cancelSeller,
        1
      );

      [cancelAuctionState] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("auction"),
          cancelSeller.publicKey.toBuffer(),
          cancelNftMint.toBuffer(),
        ],
        program.programId
      );

      [cancelAuctionVault] = PublicKey.findProgramAddressSync(
        [Buffer.from("vault"), cancelAuctionState.toBuffer()],
        program.programId
      );

      cancelEscrowNftAta = await getAssociatedTokenAddress(
        cancelNftMint,
        cancelAuctionState,
        true
      );

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
      // Seller's NFT should be in escrow
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

      // NFT should be back with seller
      const sellerNft = await getAccount(connection, cancelSellerNftAta);
      expect(Number(sellerNft.amount)).to.equal(1);

      escrow = await getAccount(connection, cancelEscrowNftAta);
      expect(Number(escrow.amount)).to.equal(0);

      const auction = await program.account.auctionState.fetch(
        cancelAuctionState
      );
      expect(JSON.stringify(auction.status)).to.equal(
        JSON.stringify({ cancelled: {} })
      );
    });

    it("closes cancelled auction accounts and recovers rent", async () => {
      const sellerBalBefore = await connection.getBalance(
        cancelSeller.publicKey
      );

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

      const sellerBalAfter = await connection.getBalance(
        cancelSeller.publicKey
      );
      const rentRecovered = sellerBalAfter - sellerBalBefore;
      expect(rentRecovered).to.be.greaterThan(0);

      // All accounts should be closed
      const info = await connection.getAccountInfo(cancelAuctionState);
      expect(info).to.be.null;
    });
  });
});
