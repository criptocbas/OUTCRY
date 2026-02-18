import { Connection, Keypair, PublicKey, clusterApiUrl } from "@solana/web3.js";
import { createMint, mintTo, createAssociatedTokenAccount } from "@solana/spl-token";
import fs from "fs";

const recipient = process.argv[2];
if (!recipient) {
  console.error("Usage: npx ts-node scripts/mint-to-wallet.ts <WALLET_ADDRESS>");
  process.exit(1);
}

const connection = new Connection(clusterApiUrl("devnet"), "confirmed");
const raw = fs.readFileSync((process.env.HOME || "") + "/.config/solana/id.json", "utf-8");
const payer = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(raw)));
const to = new PublicKey(recipient);

console.log(`Minting NFT to ${recipient}...`);
const mint = await createMint(connection, payer, payer.publicKey, null, 0);
console.log(`  Mint: ${mint.toBase58()}`);

const ata = await createAssociatedTokenAccount(connection, payer, mint, to);
await mintTo(connection, payer, mint, ata, payer, 1);
console.log(`  Done! NFT in wallet.`);

console.log(`\n  Paste into Create Auction form:`);
console.log(`  ${mint.toBase58()}`);
