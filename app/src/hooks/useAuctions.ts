"use client";

import { useState, useEffect, useCallback } from "react";
import { useConnection, useAnchorWallet } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";
import { getProgram } from "@/lib/program";
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
  const { connection } = useConnection();
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
      const program = getProgram(connection, wallet);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const accounts = await (program.account as any).auctionState.all();

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const mapped: AuctionWithKey[] = accounts.map((item: any) => ({
        publicKey: item.publicKey,
        account: item.account as unknown as AuctionAccount,
      }));

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
  }, [wallet, connection]);

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
