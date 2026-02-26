import { Connection, PublicKey, Keypair } from "@solana/web3.js";
import { AnchorProvider, Program } from "@coral-xyz/anchor";
import type { Idl } from "@coral-xyz/anchor";
import * as fs from "fs";
import * as path from "path";

const HELIUS =
  "https://devnet.helius-rpc.com/?api-key=d12ec71f-06ab-44b1-b148-18fb2aec707b";
const PROGRAM_ID = new PublicKey(
  "J7r5mzvVUjSNQteoqn6Hd3LjZ3ksmwoD5xsnUvMJwPZo"
);
const idl = JSON.parse(
  fs.readFileSync(path.join(__dirname, "../app/src/lib/idl.json"), "utf-8")
);

async function main() {
  const auctionId =
    process.argv[2] || "Hr1iDC1G19qGaNydq2QV5aazKA6HG9dqi22w3GUV7Vzn";
  const bidderKeypath = process.argv[3];

  if (!bidderKeypath) {
    console.log("Usage: npx ts-node --skip-project scripts/emergency-refund.ts <auction> <bidder-keypair-path>");
    console.log("Example: npx ts-node --skip-project scripts/emergency-refund.ts Hr1iDC1G... ~/.config/solana/id.json");
    process.exit(1);
  }

  const auction = new PublicKey(auctionId);
  const l1 = new Connection(HELIUS, "confirmed");

  const raw = JSON.parse(fs.readFileSync(bidderKeypath, "utf-8"));
  const bidder = Keypair.fromSecretKey(Uint8Array.from(raw));
  console.log("Auction:", auction.toBase58());
  console.log("Bidder:", bidder.publicKey.toBase58());

  // Check balance before
  const balBefore = await l1.getBalance(bidder.publicKey);
  console.log("Bidder balance before:", balBefore / 1e9, "SOL");

  // Derive PDAs
  const [depositPDA] = PublicKey.findProgramAddressSync(
    [Buffer.from("deposit"), auction.toBuffer(), bidder.publicKey.toBuffer()],
    PROGRAM_ID
  );
  const [vaultPDA] = PublicKey.findProgramAddressSync(
    [Buffer.from("vault"), auction.toBuffer()],
    PROGRAM_ID
  );

  console.log("Deposit PDA:", depositPDA.toBase58());
  console.log("Vault PDA:", vaultPDA.toBase58());

  // Check deposit exists
  const depositInfo = await l1.getAccountInfo(depositPDA);
  if (!depositInfo) {
    console.log("No deposit found for this bidder on this auction.");
    process.exit(0);
  }

  const wallet = {
    publicKey: bidder.publicKey,
    signTransaction: async <T extends import("@solana/web3.js").Transaction>(
      tx: T
    ): Promise<T> => {
      tx.partialSign(bidder);
      return tx;
    },
    signAllTransactions: async <
      T extends import("@solana/web3.js").Transaction,
    >(
      txs: T[]
    ): Promise<T[]> => {
      txs.forEach((t) => t.partialSign(bidder));
      return txs;
    },
  };

  const provider = new AnchorProvider(l1, wallet as any, {
    commitment: "confirmed",
  });
  const program = new Program(idl as Idl, provider);

  // Read deposit amount
  const deposit = await (program.account as any).bidderDeposit.fetch(
    depositPDA
  );
  console.log("Deposit amount:", deposit.amount.toString() / 1e9, "SOL");

  console.log("\nSending emergency_refund...");
  try {
    const sig = await (program.methods as any)
      .emergencyRefund()
      .accountsPartial({
        bidder: bidder.publicKey,
        auctionState: auction,
        bidderDeposit: depositPDA,
        auctionVault: vaultPDA,
        systemProgram: new PublicKey("11111111111111111111111111111111"),
      })
      .rpc();

    console.log("Success! Signature:", sig);
    console.log(
      "Explorer:",
      `https://explorer.solana.com/tx/${sig}?cluster=devnet`
    );

    // Check balance after
    const balAfter = await l1.getBalance(bidder.publicKey);
    console.log("Bidder balance after:", balAfter / 1e9, "SOL");
    console.log("Recovered:", (balAfter - balBefore) / 1e9, "SOL");
  } catch (e: any) {
    console.error("Emergency refund failed:", e.message);
    if (e.logs) console.error("Logs:", e.logs.join("\n"));
  }
}

main().catch(console.error);
