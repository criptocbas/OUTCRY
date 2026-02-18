/**
 * Mint a test NFT on devnet for testing OUTCRY auctions.
 *
 * Usage:
 *   npx ts-node scripts/mint-test-nft.ts
 *
 * Uses the deployer wallet at ~/.config/solana/id.json.
 * Prints the mint address — use it in the Create Auction form.
 */

import { Connection, Keypair, clusterApiUrl, LAMPORTS_PER_SOL } from "@solana/web3.js";
import {
  createMint,
  mintTo,
  getAssociatedTokenAddress,
  createAssociatedTokenAccount,
} from "@solana/spl-token";
import fs from "fs";

async function main() {
  const connection = new Connection(clusterApiUrl("devnet"), "confirmed");

  // Load wallet
  const walletPath = (process.env.WALLET_PATH || "~/.config/solana/id.json").replace(
    "~",
    process.env.HOME || ""
  );
  const raw = fs.readFileSync(walletPath, "utf-8");
  const wallet = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(raw)));

  console.log(`Wallet: ${wallet.publicKey.toBase58()}`);

  const balance = await connection.getBalance(wallet.publicKey);
  console.log(`Balance: ${(balance / LAMPORTS_PER_SOL).toFixed(4)} SOL`);

  if (balance < 0.01 * LAMPORTS_PER_SOL) {
    console.error("Not enough SOL. Need at least 0.01 SOL for rent.");
    process.exit(1);
  }

  // Create mint (decimals=0 for NFT)
  console.log("\nCreating NFT mint...");
  const mint = await createMint(
    connection,
    wallet,
    wallet.publicKey, // mint authority
    null, // freeze authority
    0 // decimals (NFT)
  );
  console.log(`  Mint: ${mint.toBase58()}`);

  // Create ATA
  const ata = await createAssociatedTokenAccount(
    connection,
    wallet,
    mint,
    wallet.publicKey
  );
  console.log(`  ATA:  ${ata.toBase58()}`);

  // Mint 1 token
  const sig = await mintTo(connection, wallet, mint, ata, wallet, 1);
  console.log(`  Mint TX: ${sig}`);

  console.log("\n========================================");
  console.log(`  NFT MINT ADDRESS (paste into Create Auction form):`);
  console.log(`  ${mint.toBase58()}`);
  console.log("========================================\n");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
