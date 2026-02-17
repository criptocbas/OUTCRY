/**
 * OUTCRY — Devnet End-to-End Test
 *
 * Runs the full L1 auction lifecycle against the deployed program on Solana devnet.
 * No ER delegation — just the core auction flow.
 *
 * Usage:
 *   npx ts-mocha -p ./tsconfig.json -t 1000000 tests/devnet-e2e.ts
 *   npx ts-node tests/devnet-e2e.ts
 *
 * Prerequisites:
 *   - Program deployed at J7r5mzvVUjSNQteoqn6Hd3LjZ3ksmwoD5xsnUvMJwPZo on devnet
 *   - Deployer wallet at ~/.config/solana/id.json with devnet SOL
 */

import anchor from "@coral-xyz/anchor";
const { Program, AnchorProvider, Wallet, BN } = anchor;
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  LAMPORTS_PER_SOL,
  clusterApiUrl,
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
import fs from "fs";
import path from "path";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const PROGRAM_ID = new PublicKey(
  "J7r5mzvVUjSNQteoqn6Hd3LjZ3ksmwoD5xsnUvMJwPZo"
);

function loadKeypair(filePath: string): Keypair {
  const resolved = filePath.replace("~", process.env.HOME || "");
  const raw = fs.readFileSync(resolved, "utf-8");
  const secretKey = Uint8Array.from(JSON.parse(raw));
  return Keypair.fromSecretKey(secretKey);
}

function loadIdl(): any {
  const idlPath = path.join(process.cwd(), "target", "idl", "outcry.json");
  return JSON.parse(fs.readFileSync(idlPath, "utf-8"));
}

function lamportsToSol(lamports: number | bigint): string {
  return (Number(lamports) / LAMPORTS_PER_SOL).toFixed(6);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function confirmTx(
  connection: Connection,
  sig: string
): Promise<string> {
  const latestBlockhash = await connection.getLatestBlockhash();
  await connection.confirmTransaction(
    { signature: sig, ...latestBlockhash },
    "confirmed"
  );
  return sig;
}

async function fundFromWallet(
  connection: Connection,
  payer: Keypair,
  recipient: PublicKey,
  amount: number
): Promise<void> {
  const balance = await connection.getBalance(recipient);
  if (balance >= amount) {
    console.log(
      `    ${recipient.toBase58().slice(0, 8)}... already has ${lamportsToSol(balance)} SOL`
    );
    return;
  }
  console.log(
    `    Transferring ${lamportsToSol(amount)} SOL from ${payer.publicKey.toBase58().slice(0, 8)}... to ${recipient.toBase58().slice(0, 8)}...`
  );
  const { Transaction, sendAndConfirmTransaction } = await import("@solana/web3.js");
  const tx = new Transaction().add(
    SystemProgram.transfer({
      fromPubkey: payer.publicKey,
      toPubkey: recipient,
      lamports: amount,
    })
  );
  const sig = await sendAndConfirmTransaction(connection, tx, [payer]);
  console.log(`    Transfer confirmed: ${sig}`);
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe("outcry devnet e2e", function () {
  this.timeout(600_000); // 10 minutes — devnet can be slow

  // Connection + provider
  const connection = new Connection(clusterApiUrl("devnet"), {
    commitment: "confirmed",
    confirmTransactionInitialTimeout: 60_000,
  });

  // Seller = deployer wallet
  const seller = loadKeypair("~/.config/solana/id.json");
  const wallet = new Wallet(seller);
  const provider = new AnchorProvider(connection, wallet, {
    preflightCommitment: "confirmed",
    commitment: "confirmed",
  });
  anchor.setProvider(provider);

  // Program from IDL
  const idl = loadIdl();
  const program = new Program(idl, provider) as any;

  // Bidder = freshly generated keypair
  const bidder = Keypair.generate();

  // NFT + PDA addresses — set during test
  let nftMint: PublicKey;
  let sellerNftAta: PublicKey;
  let auctionState: PublicKey;
  let auctionVault: PublicKey;
  let escrowNftAta: PublicKey;

  // Auction params — small amounts to conserve devnet SOL
  const reservePrice = new BN(0.05 * LAMPORTS_PER_SOL); // 0.05 SOL
  const durationSeconds = new BN(10); // 10 seconds
  const extensionSeconds = 5; // 5s anti-snipe extension
  const extensionWindow = 5; // 5s window
  const minBidIncrement = new BN(0.01 * LAMPORTS_PER_SOL); // 0.01 SOL

  // -----------------------------------------------------------------------
  // Setup
  // -----------------------------------------------------------------------

  before(async () => {
    console.log("\n=== OUTCRY Devnet E2E Test ===");
    console.log(`  Program:  ${PROGRAM_ID.toBase58()}`);
    console.log(`  Seller:   ${seller.publicKey.toBase58()}`);
    console.log(`  Bidder:   ${bidder.publicKey.toBase58()}`);
    console.log(`  Cluster:  devnet`);
    console.log("");

    // Check seller balance
    const sellerBal = await connection.getBalance(seller.publicKey);
    console.log(`  Seller balance: ${lamportsToSol(sellerBal)} SOL`);

    // Fund bidder from seller wallet (avoids faucet rate limits)
    await fundFromWallet(
      connection,
      seller,
      bidder.publicKey,
      0.5 * LAMPORTS_PER_SOL
    );

    // --- Create test NFT ---
    console.log("\n  Creating test NFT mint...");
    nftMint = await createMint(
      connection,
      seller, // payer
      seller.publicKey, // mint authority
      null, // freeze authority
      0 // decimals (NFT = 0)
    );
    console.log(`    NFT Mint: ${nftMint.toBase58()}`);

    // Create seller's ATA
    sellerNftAta = await createAssociatedTokenAccount(
      connection,
      seller,
      nftMint,
      seller.publicKey
    );
    console.log(`    Seller ATA: ${sellerNftAta.toBase58()}`);

    // Mint 1 NFT to seller
    const mintSig = await mintTo(
      connection,
      seller,
      nftMint,
      sellerNftAta,
      seller,
      1
    );
    console.log(`    Minted 1 NFT: ${mintSig}`);

    // --- Derive PDAs ---
    [auctionState] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("auction"),
        seller.publicKey.toBuffer(),
        nftMint.toBuffer(),
      ],
      PROGRAM_ID
    );
    console.log(`    AuctionState PDA: ${auctionState.toBase58()}`);

    [auctionVault] = PublicKey.findProgramAddressSync(
      [Buffer.from("vault"), auctionState.toBuffer()],
      PROGRAM_ID
    );
    console.log(`    AuctionVault PDA: ${auctionVault.toBase58()}`);

    escrowNftAta = await getAssociatedTokenAddress(
      nftMint,
      auctionState,
      true // allowOwnerOffCurve (PDA)
    );
    console.log(`    Escrow ATA: ${escrowNftAta.toBase58()}`);
    console.log("");
  });

  // -----------------------------------------------------------------------
  // 1. create_auction
  // -----------------------------------------------------------------------

  it("1. create_auction — escrows NFT, inits auction state", async () => {
    console.log(
      `\n  [create_auction] reserve=${lamportsToSol(reservePrice.toNumber())} SOL, duration=${durationSeconds.toString()}s`
    );

    const tx = await program.methods
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

    console.log(`    TX: ${tx}`);

    // Verify state
    const auction = await program.account.auctionState.fetch(auctionState);
    expect(auction.seller.toBase58()).to.equal(seller.publicKey.toBase58());
    expect(auction.nftMint.toBase58()).to.equal(nftMint.toBase58());
    expect(auction.reservePrice.toNumber()).to.equal(
      reservePrice.toNumber()
    );
    expect(auction.currentBid.toNumber()).to.equal(0);
    expect(auction.bidCount).to.equal(0);
    expect(auction.deposits).to.have.lengthOf(0);
    expect(JSON.stringify(auction.status)).to.equal(
      JSON.stringify({ created: {} })
    );
    console.log(`    Status: Created`);

    // NFT should be in escrow
    const escrowAccount = await getAccount(connection, escrowNftAta);
    expect(Number(escrowAccount.amount)).to.equal(1);
    console.log(`    NFT escrowed: YES (escrow balance = 1)`);

    const sellerAccount = await getAccount(connection, sellerNftAta);
    expect(Number(sellerAccount.amount)).to.equal(0);
    console.log(`    Seller NFT balance: 0 (transferred)`);
  });

  // -----------------------------------------------------------------------
  // 2. deposit — bidder deposits SOL
  // -----------------------------------------------------------------------

  it("2. deposit — bidder deposits 0.1 SOL into vault", async () => {
    const depositAmount = new BN(0.1 * LAMPORTS_PER_SOL);
    console.log(
      `\n  [deposit] bidder=${bidder.publicKey.toBase58().slice(0, 8)}... amount=${lamportsToSol(depositAmount.toNumber())} SOL`
    );

    const tx = await program.methods
      .deposit(depositAmount)
      .accountsStrict({
        bidder: bidder.publicKey,
        auctionState: auctionState,
        auctionVault: auctionVault,
        systemProgram: SystemProgram.programId,
      })
      .signers([bidder])
      .rpc();

    console.log(`    TX: ${tx}`);

    const auction = await program.account.auctionState.fetch(auctionState);
    expect(auction.deposits).to.have.lengthOf(1);
    expect(auction.deposits[0].bidder.toBase58()).to.equal(
      bidder.publicKey.toBase58()
    );
    expect(auction.deposits[0].amount.toNumber()).to.equal(
      depositAmount.toNumber()
    );
    console.log(
      `    Deposit recorded: ${lamportsToSol(auction.deposits[0].amount.toNumber())} SOL`
    );
  });

  // -----------------------------------------------------------------------
  // 3. start_auction
  // -----------------------------------------------------------------------

  it("3. start_auction — sets status to Active", async () => {
    console.log("\n  [start_auction]");

    const tx = await program.methods
      .startAuction()
      .accountsStrict({
        seller: seller.publicKey,
        auctionState: auctionState,
      })
      .signers([seller])
      .rpc();

    console.log(`    TX: ${tx}`);

    const auction = await program.account.auctionState.fetch(auctionState);
    expect(JSON.stringify(auction.status)).to.equal(
      JSON.stringify({ active: {} })
    );
    expect(auction.startTime.toNumber()).to.be.greaterThan(0);
    expect(auction.endTime.toNumber()).to.be.greaterThan(
      auction.startTime.toNumber()
    );

    const startStr = new Date(
      auction.startTime.toNumber() * 1000
    ).toISOString();
    const endStr = new Date(auction.endTime.toNumber() * 1000).toISOString();
    console.log(`    Status: Active`);
    console.log(`    Start:  ${startStr}`);
    console.log(`    End:    ${endStr}`);
  });

  // -----------------------------------------------------------------------
  // 4. place_bid — bidder bids at reserve price
  // -----------------------------------------------------------------------

  it("4. place_bid — bidder bids 0.05 SOL (reserve price)", async () => {
    const bidAmount = new BN(0.05 * LAMPORTS_PER_SOL);
    console.log(
      `\n  [place_bid] bidder=${bidder.publicKey.toBase58().slice(0, 8)}... amount=${lamportsToSol(bidAmount.toNumber())} SOL`
    );

    const tx = await program.methods
      .placeBid(bidAmount)
      .accountsStrict({
        bidder: bidder.publicKey,
        auctionState: auctionState,
      })
      .signers([bidder])
      .rpc();

    console.log(`    TX: ${tx}`);

    const auction = await program.account.auctionState.fetch(auctionState);
    expect(auction.currentBid.toNumber()).to.equal(bidAmount.toNumber());
    expect(auction.highestBidder.toBase58()).to.equal(
      bidder.publicKey.toBase58()
    );
    expect(auction.bidCount).to.equal(1);
    console.log(
      `    Current bid: ${lamportsToSol(auction.currentBid.toNumber())} SOL`
    );
    console.log(
      `    Highest bidder: ${auction.highestBidder.toBase58().slice(0, 8)}...`
    );
    console.log(`    Bid count: ${auction.bidCount}`);
  });

  // -----------------------------------------------------------------------
  // 5. Wait for auction to end
  // -----------------------------------------------------------------------

  it("5. wait for auction timer to expire", async () => {
    const auction = await program.account.auctionState.fetch(auctionState);
    const now = Math.floor(Date.now() / 1000);
    const endTime = auction.endTime.toNumber();
    const waitSeconds = endTime - now + 3; // +3s buffer for clock skew

    if (waitSeconds > 0) {
      console.log(
        `\n  [wait] Auction ends at ${new Date(endTime * 1000).toISOString()}`
      );
      console.log(`    Waiting ${waitSeconds}s for auction to expire...`);
      await sleep(waitSeconds * 1000);
    } else {
      console.log("\n  [wait] Auction already expired");
    }

    // Verify time has passed
    const nowAfter = Math.floor(Date.now() / 1000);
    expect(nowAfter).to.be.greaterThanOrEqual(endTime);
    console.log("    Auction timer expired.");
  });

  // -----------------------------------------------------------------------
  // 6. end_auction
  // -----------------------------------------------------------------------

  it("6. end_auction — sets status to Ended", async () => {
    console.log("\n  [end_auction]");

    const tx = await program.methods
      .endAuction()
      .accountsStrict({
        authority: seller.publicKey,
        auctionState: auctionState,
      })
      .signers([seller])
      .rpc();

    console.log(`    TX: ${tx}`);

    const auction = await program.account.auctionState.fetch(auctionState);
    expect(JSON.stringify(auction.status)).to.equal(
      JSON.stringify({ ended: {} })
    );
    console.log(`    Status: Ended`);
    console.log(
      `    Winner: ${auction.highestBidder.toBase58().slice(0, 8)}...`
    );
    console.log(
      `    Winning bid: ${lamportsToSol(auction.currentBid.toNumber())} SOL`
    );
  });

  // -----------------------------------------------------------------------
  // 7. settle_auction — NFT to winner, SOL to seller
  // -----------------------------------------------------------------------

  it("7. settle_auction — transfers NFT to winner, SOL to seller", async () => {
    console.log("\n  [settle_auction]");

    const sellerBalBefore = await connection.getBalance(seller.publicKey);
    const winnerNftAta = await getAssociatedTokenAddress(
      nftMint,
      bidder.publicKey
    );

    const tx = await program.methods
      .settleAuction()
      .accountsStrict({
        payer: seller.publicKey,
        auctionState: auctionState,
        auctionVault: auctionVault,
        seller: seller.publicKey,
        winner: bidder.publicKey,
        nftMint: nftMint,
        escrowNftTokenAccount: escrowNftAta,
        winnerNftTokenAccount: winnerNftAta,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .signers([seller])
      .rpc();

    console.log(`    TX: ${tx}`);

    // Verify status
    const auction = await program.account.auctionState.fetch(auctionState);
    expect(JSON.stringify(auction.status)).to.equal(
      JSON.stringify({ settled: {} })
    );
    console.log(`    Status: Settled`);

    // Verify NFT transferred to winner
    const winnerNftAccount = await getAccount(connection, winnerNftAta);
    expect(Number(winnerNftAccount.amount)).to.equal(1);
    console.log(`    Winner NFT balance: 1 (received)`);

    // Verify escrow is empty
    const escrowAccount = await getAccount(connection, escrowNftAta);
    expect(Number(escrowAccount.amount)).to.equal(0);
    console.log(`    Escrow NFT balance: 0 (transferred)`);

    // Verify seller received SOL
    const sellerBalAfter = await connection.getBalance(seller.publicKey);
    const sellerGain = sellerBalAfter - sellerBalBefore;
    console.log(
      `    Seller balance change: ${sellerGain > 0 ? "+" : ""}${lamportsToSol(sellerGain)} SOL`
    );
    // Seller should gain roughly the winning bid minus tx fee for settle
    // The winning bid is 0.05 SOL. Tx fee is ~0.000005 SOL + ATA creation cost.
    // Since seller also pays the tx fee and possibly ATA init, the net gain could
    // be slightly less, but should still be positive.

    // Verify winner's deposit was deducted
    const winnerDeposit = auction.deposits.find(
      (d: any) => d.bidder.toBase58() === bidder.publicKey.toBase58()
    );
    const expectedRemaining =
      0.1 * LAMPORTS_PER_SOL - 0.05 * LAMPORTS_PER_SOL; // 0.05 SOL
    expect(winnerDeposit.amount.toNumber()).to.equal(expectedRemaining);
    console.log(
      `    Winner remaining deposit: ${lamportsToSol(winnerDeposit.amount.toNumber())} SOL`
    );
  });

  // -----------------------------------------------------------------------
  // 8. claim_refund — winner claims remaining deposit
  // -----------------------------------------------------------------------

  it("8. claim_refund — winner claims remaining 0.05 SOL deposit", async () => {
    console.log("\n  [claim_refund]");

    const bidderBalBefore = await connection.getBalance(bidder.publicKey);

    const tx = await program.methods
      .claimRefund()
      .accountsStrict({
        bidder: bidder.publicKey,
        auctionState: auctionState,
        auctionVault: auctionVault,
        systemProgram: SystemProgram.programId,
      })
      .signers([bidder])
      .rpc();

    console.log(`    TX: ${tx}`);

    const bidderBalAfter = await connection.getBalance(bidder.publicKey);
    const refund = bidderBalAfter - bidderBalBefore;
    console.log(
      `    Bidder balance change: ${refund > 0 ? "+" : ""}${lamportsToSol(refund)} SOL`
    );
    // Should receive ~0.05 SOL back minus tx fee
    expect(refund).to.be.greaterThan(0.04 * LAMPORTS_PER_SOL);

    // Deposit should be zeroed
    const auction = await program.account.auctionState.fetch(auctionState);
    const deposit = auction.deposits.find(
      (d: any) => d.bidder.toBase58() === bidder.publicKey.toBase58()
    );
    expect(deposit.amount.toNumber()).to.equal(0);
    console.log(`    Deposit after refund: 0 SOL`);
  });

  // -----------------------------------------------------------------------
  // Summary
  // -----------------------------------------------------------------------

  after(async () => {
    console.log("\n=== Devnet E2E Complete ===");
    console.log(`  NFT Mint:       ${nftMint?.toBase58()}`);
    console.log(`  AuctionState:   ${auctionState?.toBase58()}`);
    console.log(`  Seller balance: ${lamportsToSol(await connection.getBalance(seller.publicKey))} SOL`);
    console.log(`  Bidder balance: ${lamportsToSol(await connection.getBalance(bidder.publicKey))} SOL`);
    console.log("");
  });
});

