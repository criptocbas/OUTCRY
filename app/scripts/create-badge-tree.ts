/**
 * Create a Merkle tree for OUTCRY compressed NFT badges (Bubblegum).
 *
 * The tree authority is the deployer keypair (~/.config/solana/id.json).
 * After creation, set NEXT_PUBLIC_BADGE_MERKLE_TREE in app/.env.local.
 *
 * Usage (from outcry/app):
 *   npx ts-node --skip-project scripts/create-badge-tree.ts
 */

import * as fs from "fs";
import { Keypair, Connection, clusterApiUrl, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { createUmi } from "@metaplex-foundation/umi-bundle-defaults";
import { generateSigner, keypairIdentity } from "@metaplex-foundation/umi";
import { createTree } from "@metaplex-foundation/mpl-bubblegum";
import { fromWeb3JsKeypair } from "@metaplex-foundation/umi-web3js-adapters";

// Tree parameters — matches app/src/lib/constants.ts
const MAX_DEPTH = 14; // 16,384 max badges
const MAX_BUFFER = 64;
const CANOPY_DEPTH = 11;

async function main() {
  const rpcUrl =
    process.env.HELIUS_RPC ||
    process.env.NEXT_PUBLIC_HELIUS_RPC ||
    clusterApiUrl("devnet");

  // Load deployer wallet
  const walletPath = (
    process.env.WALLET_PATH || "~/.config/solana/id.json"
  ).replace("~", process.env.HOME || "");
  const raw = fs.readFileSync(walletPath, "utf-8");
  const wallet = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(raw)));

  console.log(`RPC:      ${rpcUrl}`);
  console.log(`Deployer: ${wallet.publicKey.toBase58()}`);

  // Check balance
  const connection = new Connection(rpcUrl, "confirmed");
  const balance = await connection.getBalance(wallet.publicKey);
  console.log(`Balance:  ${(balance / LAMPORTS_PER_SOL).toFixed(4)} SOL`);

  if (balance < 1.0 * LAMPORTS_PER_SOL) {
    console.error(
      "Need at least ~1 SOL for Merkle tree rent. Request an airdrop or fund the wallet."
    );
    process.exit(1);
  }

  // Create Umi instance with deployer identity
  const umi = createUmi(rpcUrl);
  const umiKeypair = fromWeb3JsKeypair(wallet);
  umi.use(keypairIdentity(umiKeypair));

  // Create the Merkle tree
  console.log(
    `\nCreating Merkle tree (depth=${MAX_DEPTH}, buffer=${MAX_BUFFER}, canopy=${CANOPY_DEPTH})...`
  );
  const merkleTree = generateSigner(umi);

  const builder = await createTree(umi, {
    merkleTree,
    maxDepth: MAX_DEPTH,
    maxBufferSize: MAX_BUFFER,
    canopyDepth: CANOPY_DEPTH,
  });

  const result = await builder.sendAndConfirm(umi);

  console.log(`\nMerkle tree created!`);
  console.log(`  Tree address: ${merkleTree.publicKey}`);
  console.log(`  Signature:    ${Buffer.from(result.signature).toString("base64")}`);
  console.log(`  Authority:    ${wallet.publicKey.toBase58()}`);

  console.log(`\n========================================`);
  console.log(`  Add to app/.env.local:`);
  console.log(`  NEXT_PUBLIC_BADGE_MERKLE_TREE=${merkleTree.publicKey}`);
  console.log(`========================================\n`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
