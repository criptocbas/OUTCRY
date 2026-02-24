/**
 * Mint a test NFT on devnet for testing OUTCRY auctions.
 * Creates SPL token + Metaplex metadata (required for royalty enforcement at settlement).
 *
 * Usage:
 *   npx ts-node scripts/mint-test-nft.ts [RECIPIENT_WALLET_ADDRESS]
 *
 * If no recipient is given, mints to the deployer wallet (~/.config/solana/id.json).
 */

import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  clusterApiUrl,
  sendAndConfirmTransaction,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import {
  createMint,
  mintTo,
  createAssociatedTokenAccount,
} from "@solana/spl-token";
import * as fs from "fs";

const TOKEN_METADATA_PROGRAM_ID = new PublicKey(
  "metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s"
);
const SYSVAR_RENT = new PublicKey(
  "SysvarRent111111111111111111111111111111111"
);

function getMetadataPDA(mint: PublicKey): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [
      Buffer.from("metadata"),
      TOKEN_METADATA_PROGRAM_ID.toBuffer(),
      mint.toBuffer(),
    ],
    TOKEN_METADATA_PROGRAM_ID
  );
  return pda;
}

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

  const size =
    1 + // instruction discriminator (33 = CreateMetadataAccountV3)
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

  data.writeUInt8(33, offset); offset += 1;

  data.writeUInt32LE(nameBytes.length, offset); offset += 4;
  nameBytes.copy(data, offset); offset += nameBytes.length;

  data.writeUInt32LE(symbolBytes.length, offset); offset += 4;
  symbolBytes.copy(data, offset); offset += symbolBytes.length;

  data.writeUInt32LE(uriBytes.length, offset); offset += 4;
  uriBytes.copy(data, offset); offset += uriBytes.length;

  data.writeUInt16LE(sellerFeeBps, offset); offset += 2;

  if (hasCreators) {
    data.writeUInt8(1, offset); offset += 1;
    data.writeUInt32LE(creators.length, offset); offset += 4;
    for (const c of creators) {
      c.address.toBuffer().copy(data, offset); offset += 32;
      data.writeUInt8(c.verified ? 1 : 0, offset); offset += 1;
      data.writeUInt8(c.share, offset); offset += 1;
    }
  } else {
    data.writeUInt8(0, offset); offset += 1;
  }

  data.writeUInt8(0, offset); offset += 1; // collection: None
  data.writeUInt8(0, offset); offset += 1; // uses: None
  data.writeUInt8(1, offset); offset += 1; // is_mutable: true
  data.writeUInt8(0, offset); offset += 1; // collection_details: None

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

async function main() {
  const rpcUrl = process.env.HELIUS_RPC || process.env.NEXT_PUBLIC_HELIUS_RPC || clusterApiUrl("devnet");
  const connection = new Connection(rpcUrl, "confirmed");

  // Load deployer wallet
  const walletPath = (process.env.WALLET_PATH || "~/.config/solana/id.json").replace(
    "~",
    process.env.HOME || ""
  );
  const raw = fs.readFileSync(walletPath, "utf-8");
  const wallet = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(raw)));

  // Recipient: CLI arg or self
  const recipient = process.argv[2]
    ? new PublicKey(process.argv[2])
    : wallet.publicKey;

  console.log(`Deployer: ${wallet.publicKey.toBase58()}`);
  console.log(`Recipient: ${recipient.toBase58()}`);

  const balance = await connection.getBalance(wallet.publicKey);
  console.log(`Balance: ${(balance / LAMPORTS_PER_SOL).toFixed(4)} SOL`);

  if (balance < 0.05 * LAMPORTS_PER_SOL) {
    console.error("Not enough SOL. Need at least 0.05 SOL for mint + metadata rent.");
    process.exit(1);
  }

  // 1. Create mint (decimals=0 for NFT)
  console.log("\n1. Creating NFT mint...");
  const mint = await createMint(
    connection,
    wallet,
    wallet.publicKey, // mint authority
    null,             // freeze authority
    0                 // decimals (NFT)
  );
  console.log(`   Mint: ${mint.toBase58()}`);

  // 2. Create ATA for recipient
  console.log("2. Creating token account...");
  const ata = await createAssociatedTokenAccount(
    connection,
    wallet,
    mint,
    recipient
  );
  console.log(`   ATA:  ${ata.toBase58()}`);

  // 3. Mint 1 token
  console.log("3. Minting 1 NFT...");
  await mintTo(connection, wallet, mint, ata, wallet, 1);

  // 4. Create Metaplex metadata (required for royalty enforcement)
  console.log("4. Creating Metaplex metadata...");
  const metadataPda = getMetadataPDA(mint);

  const metadataIx = createMetadataV3Instruction(
    metadataPda,
    mint,
    wallet.publicKey,
    wallet.publicKey,
    wallet.publicKey,
    "OUTCRY Auction NFT",
    "OUTCRY",
    "https://raw.githubusercontent.com/criptocbas/outcry/main/scripts/metadata/outcry-nft.json",
    500, // 5% royalties (seller_fee_basis_points)
    [
      {
        address: wallet.publicKey, // deployer as creator (verified since they sign)
        verified: true,
        share: 100,
      },
    ]
  );

  const tx = new Transaction().add(metadataIx);
  const sig = await sendAndConfirmTransaction(connection, tx, [wallet]);
  console.log(`   Metadata TX: ${sig}`);
  console.log(`   Metadata PDA: ${metadataPda.toBase58()}`);

  console.log("\n========================================");
  console.log("  NFT MINT ADDRESS (paste into Create Auction form):");
  console.log(`  ${mint.toBase58()}`);
  console.log("========================================");
  console.log(`\n  Owner: ${recipient.toBase58()}`);
  console.log(`  Name: OUTCRY Test NFT`);
  console.log(`  Royalties: 5% to ${recipient.toBase58()}`);
  console.log();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
