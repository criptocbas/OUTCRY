import { Connection, PublicKey, Keypair } from "@solana/web3.js";
import { AnchorProvider, Program } from "@coral-xyz/anchor";
import type { Idl } from "@coral-xyz/anchor";
import * as fs from "fs";
import * as path from "path";

const MAGIC = "https://devnet-router.magicblock.app/";
const idl = JSON.parse(
  fs.readFileSync(path.join(__dirname, "../app/src/lib/idl.json"), "utf-8")
);

async function getMagicBlockhash(
  rpcEndpoint: string,
  tx: import("@solana/web3.js").Transaction
): Promise<{ blockhash: string; lastValidBlockHeight: number }> {
  const writableAccounts = new Set<string>();
  if (tx.feePayer) writableAccounts.add(tx.feePayer.toBase58());
  for (const ix of tx.instructions) {
    for (const key of ix.keys) {
      if (key.isWritable) writableAccounts.add(key.pubkey.toBase58());
    }
  }
  const res = await fetch(rpcEndpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "getBlockhashForAccounts",
      params: [Array.from(writableAccounts)],
    }),
  });
  const data = await res.json();
  if (!data.result?.blockhash)
    throw new Error("No blockhash: " + JSON.stringify(data));
  return data.result;
}

async function main() {
  const auctionId =
    process.argv[2] || "Hr1iDC1G19qGaNydq2QV5aazKA6HG9dqi22w3GUV7Vzn";
  const auction = new PublicKey(auctionId);
  console.log("Auction:", auction.toBase58());

  const er = new Connection(MAGIC, "confirmed");
  const raw = JSON.parse(
    fs.readFileSync(
      process.env.HOME + "/.config/solana/id.json",
      "utf-8"
    )
  );
  const payer = Keypair.fromSecretKey(Uint8Array.from(raw));
  console.log("Payer:", payer.publicKey.toBase58());

  const wallet = {
    publicKey: payer.publicKey,
    signTransaction: async <T extends import("@solana/web3.js").Transaction>(
      tx: T
    ): Promise<T> => {
      tx.partialSign(payer);
      return tx;
    },
    signAllTransactions: async <
      T extends import("@solana/web3.js").Transaction,
    >(
      txs: T[]
    ): Promise<T[]> => {
      txs.forEach((t) => t.partialSign(payer));
      return txs;
    },
  };
  const provider = new AnchorProvider(er, wallet as any, { commitment: "confirmed" });
  const program = new Program(idl as Idl, provider);

  // Check current status
  const stateBefore = await (program.account as any).auctionState.fetch(auction);
  console.log("Current status:", JSON.stringify(stateBefore.status));
  console.log(
    "End time:",
    new Date(
      (stateBefore.endTime as { toNumber: () => number }).toNumber() * 1000
    ).toISOString()
  );
  console.log("Now:", new Date().toISOString());

  // Check IDL account names
  const endIx = (idl as { instructions: Array<{ name: string; accounts: Array<{ name: string }> }> }).instructions.find(
    (i) => i.name === "endAuction" || i.name === "end_auction"
  );
  console.log(
    "endAuction account names:",
    endIx?.accounts.map((a) => a.name)
  );

  if ("active" in stateBefore.status) {
    console.log("\n--- Step 1: Ending auction on ER ---");
    const endTx = await program.methods
      .endAuction()
      .accountsPartial({ authority: payer.publicKey, auctionState: auction })
      .transaction();
    endTx.feePayer = payer.publicKey;

    const bh = await getMagicBlockhash(MAGIC, endTx);
    console.log("ER blockhash:", bh.blockhash);
    endTx.recentBlockhash = bh.blockhash;
    endTx.lastValidBlockHeight = bh.lastValidBlockHeight;
    endTx.sign(payer);

    const endSig = await er.sendRawTransaction(endTx.serialize(), {
      skipPreflight: true,
    });
    console.log("End tx:", endSig);

    try {
      await er.confirmTransaction(
        {
          signature: endSig,
          blockhash: bh.blockhash,
          lastValidBlockHeight: bh.lastValidBlockHeight,
        },
        "confirmed"
      );
      console.log("Confirmed!");
    } catch (e) {
      console.log("Confirmation warning:", (e as Error).message);
    }

    await new Promise((r) => setTimeout(r, 3000));

    const stateAfterEnd = await (program.account as any).auctionState.fetch(auction);
    console.log("Status after end:", JSON.stringify(stateAfterEnd.status));

    if (!("ended" in stateAfterEnd.status)) {
      console.error("ERROR: Auction still not ended. Aborting.");
      process.exit(1);
    }
  }

  console.log("\n--- Step 2: Undelegating auction ---");
  const undelegateTx = await program.methods
    .undelegateAuction()
    .accountsPartial({ payer: payer.publicKey, auctionState: auction })
    .transaction();
  undelegateTx.feePayer = payer.publicKey;

  const bh2 = await getMagicBlockhash(MAGIC, undelegateTx);
  console.log("ER blockhash:", bh2.blockhash);
  undelegateTx.recentBlockhash = bh2.blockhash;
  undelegateTx.lastValidBlockHeight = bh2.lastValidBlockHeight;
  undelegateTx.sign(payer);

  const undelegateSig = await er.sendRawTransaction(
    undelegateTx.serialize(),
    { skipPreflight: true }
  );
  console.log("Undelegate tx:", undelegateSig);

  try {
    await er.confirmTransaction(
      {
        signature: undelegateSig,
        blockhash: bh2.blockhash,
        lastValidBlockHeight: bh2.lastValidBlockHeight,
      },
      "confirmed"
    );
    console.log("Confirmed!");
  } catch (e) {
    console.log("Confirmation warning:", (e as Error).message);
  }

  // Poll L1 for delegation record to disappear
  const HELIUS =
    "https://devnet.helius-rpc.com/?api-key=d12ec71f-06ab-44b1-b148-18fb2aec707b";
  const l1 = new Connection(HELIUS, "confirmed");
  const DELEGATION_PROGRAM_ID = new PublicKey(
    "DELeGGvXpWV2fqJUhqcF5ZSYMS4JTLjteaAMARRSaeSh"
  );
  const [delegationRecord] = PublicKey.findProgramAddressSync(
    [Buffer.from("delegation"), auction.toBuffer()],
    DELEGATION_PROGRAM_ID
  );

  console.log("\nWaiting for L1 confirmation...");
  for (let i = 0; i < 15; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    const info = await l1.getAccountInfo(delegationRecord);
    if (info === null) {
      console.log("Delegation record gone - auction is back on L1!");
      return;
    }
    console.log(`  Attempt ${i + 1}/15 - still delegated`);
  }
  console.error("Timed out waiting for undelegation.");
}

main().catch(console.error);
