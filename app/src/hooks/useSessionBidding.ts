"use client";

import { useState, useRef, useCallback, useEffect, useMemo } from "react";
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
} from "@solana/web3.js";
import { useAnchorWallet, useWallet } from "@solana/wallet-adapter-react";
import type { AnchorWallet } from "@solana/wallet-adapter-react";
import BN from "bn.js";
import { getProgram, getVaultPDA, getDepositPDA, getSessionPDA } from "@/lib/program";
import { getMagicConnection } from "@/lib/magic-router";
import {
  PROGRAM_ID,
  DEVNET_RPC,
  MAGIC_ROUTER_RPC,
} from "@/lib/constants";

// Debug logger — suppressed in production
const debugLog =
  process.env.NODE_ENV !== "production"
    ? (...args: unknown[]) => console.log("[session]", ...args)
    : (() => {}) as (...args: unknown[]) => void;

/**
 * Get the correct blockhash for a Magic Router transaction.
 * Copied from useAuctionActions pattern — ER has its own blockhash progression.
 */
async function getMagicBlockhash(
  rpcEndpoint: string,
  tx: Transaction
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
  if (!data.result?.blockhash || typeof data.result.lastValidBlockHeight !== "number") {
    throw new Error("Invalid blockhash response from Magic Router");
  }
  return data.result;
}

// Amount of SOL to fund ephemeral key for ER tx fees (0.005 SOL)
const EPHEMERAL_KEY_FUNDING = 5_000_000;

export interface UseSessionBiddingReturn {
  /** Whether session bidding is active and ready */
  sessionActive: boolean;
  /** Whether session is currently being activated */
  activating: boolean;
  /** Progress label during activation */
  activationProgress: string | null;
  /** Enable session: deposit + fund ephemeral key + create session (one popup) */
  enableSession: (auctionPubkey: PublicKey, depositAmount: number) => Promise<void>;
  /** Place a bid using session key (no popup) */
  sessionBid: (auctionPubkey: PublicKey, amount: number) => Promise<{ signature: string; sendMs: number }>;
  /** Disable session (clear ephemeral key) */
  disableSession: () => void;
}

export function useSessionBidding(): UseSessionBiddingReturn {
  const wallet = useAnchorWallet();
  const { publicKey } = useWallet();

  // Ephemeral keypair — lives only in memory, never persisted
  const keypairRef = useRef<Keypair | null>(null);
  const [sessionActive, setSessionActive] = useState(false);
  const [activating, setActivating] = useState(false);
  const [activationProgress, setActivationProgress] = useState<string | null>(null);

  // L1 connection for deposit + createSession
  const l1Connection = useMemo(
    () => new Connection(DEVNET_RPC, "confirmed"),
    []
  );

  // Magic Router connection for ER bids
  const magicConnection = useMemo(() => getMagicConnection(), []);

  // L1 program with real wallet
  const l1Program = useMemo(() => {
    if (!wallet) return null;
    return getProgram(l1Connection, wallet);
  }, [l1Connection, wallet]);

  // Reset session when wallet disconnects
  useEffect(() => {
    if (!publicKey) {
      keypairRef.current = null;
      setSessionActive(false);
    }
  }, [publicKey]);

  /**
   * Enable session bidding: builds a single L1 transaction that:
   * 1. Deposits SOL to auction vault (if depositAmount > 0)
   * 2. Funds ephemeral key with 0.005 SOL for ER tx fees
   * 3. Creates SessionToken PDA linking ephemeral key → real wallet
   */
  const enableSession = useCallback(
    async (auctionPubkey: PublicKey, depositAmount: number) => {
      if (!l1Program || !publicKey || !wallet) {
        throw new Error("Wallet not connected");
      }

      setActivating(true);
      setActivationProgress("Preparing session...");

      try {
        // Generate fresh ephemeral keypair
        const ephemeral = Keypair.generate();
        debugLog("Ephemeral key:", ephemeral.publicKey.toBase58());

        // Build combined L1 transaction
        const tx = new Transaction();

        // 1. Deposit (if needed)
        if (depositAmount > 0) {
          setActivationProgress("Building deposit...");
          const [auctionVault] = getVaultPDA(auctionPubkey);
          const [bidderDeposit] = getDepositPDA(auctionPubkey, publicKey);

          const depositIx = await l1Program.methods
            .deposit(new BN(depositAmount))
            .accounts({
              bidder: publicKey,
              auctionState: auctionPubkey,
              bidderDeposit,
              auctionVault,
              systemProgram: SystemProgram.programId,
            })
            .instruction();
          tx.add(depositIx);
        }

        // 2. Fund ephemeral key for ER tx fees
        setActivationProgress("Funding session key...");
        tx.add(
          SystemProgram.transfer({
            fromPubkey: publicKey,
            toPubkey: ephemeral.publicKey,
            lamports: EPHEMERAL_KEY_FUNDING,
          })
        );

        // 3. Create session token on-chain
        setActivationProgress("Creating session...");
        const [sessionToken] = getSessionPDA(auctionPubkey, publicKey);

        const createSessionIx = await l1Program.methods
          .createSession(ephemeral.publicKey)
          .accounts({
            bidder: publicKey,
            auctionState: auctionPubkey,
            sessionToken,
            systemProgram: SystemProgram.programId,
          })
          .instruction();
        tx.add(createSessionIx);

        // Send combined transaction (one wallet popup)
        setActivationProgress("Approve in wallet...");
        tx.feePayer = publicKey;
        const { blockhash, lastValidBlockHeight } =
          await l1Connection.getLatestBlockhash("confirmed");
        tx.recentBlockhash = blockhash;
        tx.lastValidBlockHeight = lastValidBlockHeight;

        const signed = await wallet.signTransaction(tx);
        const sig = await l1Connection.sendRawTransaction(signed.serialize());
        debugLog("Session setup tx:", sig);

        setActivationProgress("Confirming...");
        const confirmation = await l1Connection.confirmTransaction(
          { signature: sig, blockhash, lastValidBlockHeight },
          "confirmed"
        );

        // Check if the transaction actually succeeded on-chain
        if (confirmation.value.err) {
          throw new Error(`Session setup transaction failed: ${JSON.stringify(confirmation.value.err)}`);
        }

        // Store ephemeral key and activate
        keypairRef.current = ephemeral;
        setSessionActive(true);
        debugLog("Session active!");
      } catch (err) {
        debugLog("Session activation failed:", err);
        keypairRef.current = null;
        setSessionActive(false);
        throw err;
      } finally {
        setActivating(false);
        setActivationProgress(null);
      }
    },
    [l1Program, l1Connection, publicKey, wallet]
  );

  /**
   * Place a bid using the ephemeral session key — no wallet popup.
   */
  const sessionBid = useCallback(
    async (
      auctionPubkey: PublicKey,
      amount: number
    ): Promise<{ signature: string; sendMs: number }> => {
      const keypair = keypairRef.current;
      if (!keypair || !publicKey) {
        throw new Error("Session not active");
      }

      // Create a dummy wallet that wraps the ephemeral keypair
      const dummyWallet: AnchorWallet = {
        publicKey: keypair.publicKey,
        signTransaction: async (tx) => tx, // no-op, we sign manually
        signAllTransactions: async (txs) => txs,
      };

      // Build program instance with ephemeral key as "wallet"
      const erProgram = getProgram(magicConnection, dummyWallet);

      const [sessionToken] = getSessionPDA(auctionPubkey, publicKey);

      // Build the place_bid_session transaction
      const tx = await erProgram.methods
        .placeBidSession(new BN(amount))
        .accounts({
          sessionSigner: keypair.publicKey,
          sessionToken,
          auctionState: auctionPubkey,
        })
        .transaction();

      tx.feePayer = keypair.publicKey;

      // Get correct blockhash from Magic Router
      let blockhash: string;
      let lastValidBlockHeight: number;
      let sendConnection: Connection = magicConnection;

      try {
        const result = await getMagicBlockhash(magicConnection.rpcEndpoint, tx);
        blockhash = result.blockhash;
        lastValidBlockHeight = result.lastValidBlockHeight;
      } catch {
        // ER unavailable — fall back to L1 blockhash
        debugLog("ER unavailable for blockhash, falling back to L1");
        const l1Conn = new Connection(DEVNET_RPC, "confirmed");
        const result = await l1Conn.getLatestBlockhash("confirmed");
        blockhash = result.blockhash;
        lastValidBlockHeight = result.lastValidBlockHeight;
        sendConnection = l1Conn;
      }

      tx.recentBlockhash = blockhash;
      tx.lastValidBlockHeight = lastValidBlockHeight;

      // Sign with ephemeral key — NO wallet popup
      tx.sign(keypair);

      // Send raw transaction
      const sendStart = performance.now();
      const sig = await sendConnection.sendRawTransaction(tx.serialize(), {
        skipPreflight: true,
      });
      const sendMs = Math.round(performance.now() - sendStart);
      debugLog(`Bid sent in ${sendMs}ms, sig: ${sig}`);

      // Fire-and-forget confirmation
      sendConnection
        .confirmTransaction(
          { signature: sig, blockhash, lastValidBlockHeight },
          "confirmed"
        )
        .catch((err) => debugLog("Confirmation warning:", err));

      return { signature: sig, sendMs };
    },
    [publicKey, magicConnection]
  );

  const disableSession = useCallback(() => {
    keypairRef.current = null;
    setSessionActive(false);
    debugLog("Session disabled");
  }, []);

  return {
    sessionActive,
    activating,
    activationProgress,
    enableSession,
    sessionBid,
    disableSession,
  };
}
