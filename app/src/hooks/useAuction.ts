"use client";

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { useAnchorWallet } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";
import type { AccountInfo } from "@solana/web3.js";
import { Program } from "@coral-xyz/anchor";
import type BN from "bn.js";
import { getProgram, getReadOnlyProgram } from "@/lib/program";
import { getMagicConnection } from "@/lib/magic-router";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AuctionAccount {
  seller: PublicKey;
  nftMint: PublicKey;
  reservePrice: BN;
  durationSeconds: BN;
  currentBid: BN;
  highestBidder: PublicKey;
  startTime: BN;
  endTime: BN;
  extensionSeconds: number;
  extensionWindow: number;
  minBidIncrement: BN;
  status: AuctionStatusRaw;
  bidCount: number;
  bump: number;
}

/**
 * Anchor 0.32 deserialises Rust enums as objects with a single key whose
 * value is `{}`.  For example: `{ created: {} }`, `{ active: {} }`, etc.
 */
export type AuctionStatusRaw =
  | { created: Record<string, never> }
  | { active: Record<string, never> }
  | { ended: Record<string, never> }
  | { settled: Record<string, never> }
  | { cancelled: Record<string, never> };

export type AuctionStatusLabel =
  | "Created"
  | "Active"
  | "Ended"
  | "Settled"
  | "Cancelled";

/**
 * Converts an Anchor enum object to a human-readable label.
 */
export function parseAuctionStatus(status: AuctionStatusRaw): AuctionStatusLabel {
  const key = Object.keys(status)[0] as string;
  return (key.charAt(0).toUpperCase() + key.slice(1)) as AuctionStatusLabel;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export interface UseAuctionReturn {
  auction: AuctionAccount | null;
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

export function useAuction(auctionPublicKey: string | null): UseAuctionReturn {
  // Use Magic Router so we can read delegated accounts from ER
  const connection = useMemo(() => getMagicConnection(), []);
  const wallet = useAnchorWallet();

  const [auction, setAuction] = useState<AuctionAccount | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  // Keep a ref to the subscription id so we can unsubscribe on unmount or
  // when the auction key changes.
  const subscriptionRef = useRef<number | null>(null);

  // Store the program ref so we can decode account data inside the
  // subscription callback without recreating the subscription on every render.
  const programRef = useRef<Program | null>(null);

  // Track whether we've done the initial fetch so polling doesn't flash loading
  const hasFetchedRef = useRef(false);

  // Overlap guard — prevents concurrent polling fetches
  const fetchingRef = useRef(false);

  const fetchAuction = useCallback(async () => {
    if (!auctionPublicKey) {
      setAuction(null);
      return;
    }

    // Only show loading spinner on first fetch
    if (!hasFetchedRef.current) {
      setLoading(true);
    }
    setError(null);

    fetchingRef.current = true;
    try {
      const program = wallet ? getProgram(connection, wallet) : getReadOnlyProgram(connection);
      programRef.current = program;
      const pubkey = new PublicKey(auctionPublicKey);
      const account = await (program.account as Record<string, { fetch: (key: PublicKey) => Promise<unknown> }>)["auctionState"].fetch(pubkey);
      setAuction(account as unknown as AuctionAccount);
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : "Failed to fetch auction";
      setError(message);
      setAuction(null);
    } finally {
      setLoading(false);
      hasFetchedRef.current = true;
      fetchingRef.current = false;
    }
  }, [auctionPublicKey, wallet, connection]);

  // Initial fetch
  useEffect(() => {
    fetchAuction();
  }, [fetchAuction]);

  // Real-time subscription via onAccountChange (works on L1, may not work on ER)
  useEffect(() => {
    if (!auctionPublicKey) return;

    const program = wallet ? getProgram(connection, wallet) : getReadOnlyProgram(connection);
    programRef.current = program;

    let pubkey: PublicKey;
    try {
      pubkey = new PublicKey(auctionPublicKey);
    } catch {
      return;
    }

    const subId = connection.onAccountChange(
      pubkey,
      (accountInfo: AccountInfo<Buffer>) => {
        try {
          const currentProgram = programRef.current;
          if (!currentProgram) return;
          const decoded = currentProgram.coder.accounts.decode(
            "AuctionState",
            accountInfo.data
          );
          setAuction(decoded as unknown as AuctionAccount);
        } catch {
          // If decoding fails (e.g. account closed), silently ignore.
        }
      },
      "confirmed"
    );

    subscriptionRef.current = subId;

    return () => {
      if (subscriptionRef.current !== null) {
        connection.removeAccountChangeListener(subscriptionRef.current);
        subscriptionRef.current = null;
      }
    };
  }, [auctionPublicKey, wallet, connection]);

  // Polling fallback: Magic Router WebSocket may not relay ER account changes,
  // so poll every 3 seconds to keep the UI in sync during active auctions.
  useEffect(() => {
    if (!auctionPublicKey) return;

    const interval = setInterval(() => {
      if (fetchingRef.current) return;
      fetchAuction();
    }, 3000);

    return () => clearInterval(interval);
  }, [auctionPublicKey, wallet, fetchAuction]);

  return {
    auction,
    loading,
    error,
    refetch: fetchAuction,
  };
}
