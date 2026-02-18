"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { useAnchorWallet } from "@solana/wallet-adapter-react";
import { Connection, PublicKey } from "@solana/web3.js";
import { getProgram } from "@/lib/program";
import { getMagicConnection } from "@/lib/magic-router";
import { DEVNET_RPC } from "@/lib/constants";
import type { AuctionAccount, AuctionStatusLabel } from "./useAuction";
import { parseAuctionStatus } from "./useAuction";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AuctionWithKey {
  publicKey: PublicKey;
  account: AuctionAccount;
}

export interface UseAuctionsReturn {
  auctions: AuctionWithKey[];
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

// ---------------------------------------------------------------------------
// Sorting helpers
// ---------------------------------------------------------------------------

const STATUS_SORT_ORDER: Record<AuctionStatusLabel, number> = {
  Active: 0,
  Created: 1,
  Ended: 2,
  Settled: 3,
  Cancelled: 4,
};

function sortAuctions(a: AuctionWithKey, b: AuctionWithKey): number {
  const aStatus = parseAuctionStatus(a.account.status);
  const bStatus = parseAuctionStatus(b.account.status);
  return (STATUS_SORT_ORDER[aStatus] ?? 99) - (STATUS_SORT_ORDER[bStatus] ?? 99);
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useAuctions(): UseAuctionsReturn {
  // Standard devnet for getProgramAccounts (listing) — Magic Router doesn't support it
  const l1Connection = useMemo(() => new Connection(DEVNET_RPC, "confirmed"), []);
  // Magic Router for individual account fetches (sees ER-delegated state)
  const magicConnection = useMemo(() => getMagicConnection(), []);
  const wallet = useAnchorWallet();

  const [auctions, setAuctions] = useState<AuctionWithKey[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const fetchAuctions = useCallback(async () => {
    if (!wallet) {
      setAuctions([]);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      // Step 1: Get all auction account keys from L1
      const l1Program = getProgram(l1Connection, wallet);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const l1Accounts = await (l1Program.account as any).auctionState.all();

      // Step 2: Re-fetch each account via Magic Router to get latest state
      // (delegated accounts will return ER state, others return L1 state)
      const magicProgram = getProgram(magicConnection, wallet);
      const mapped: AuctionWithKey[] = await Promise.all(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        l1Accounts.map(async (item: any) => {
          try {
            const fresh = await (magicProgram.account as Record<string, { fetch: (key: PublicKey) => Promise<unknown> }>)["auctionState"].fetch(item.publicKey);
            return {
              publicKey: item.publicKey,
              account: fresh as unknown as AuctionAccount,
            };
          } catch {
            // Fallback to L1 data if Magic Router fetch fails
            return {
              publicKey: item.publicKey,
              account: item.account as unknown as AuctionAccount,
            };
          }
        })
      );

      mapped.sort(sortAuctions);

      setAuctions(mapped);
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : "Failed to fetch auctions";
      setError(message);
      setAuctions([]);
    } finally {
      setLoading(false);
    }
  }, [wallet, l1Connection, magicConnection]);

  // Initial fetch
  useEffect(() => {
    fetchAuctions();
  }, [fetchAuctions]);

  return {
    auctions,
    loading,
    error,
    refetch: fetchAuctions,
  };
}
