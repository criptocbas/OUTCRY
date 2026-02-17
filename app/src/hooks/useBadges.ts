"use client";

import { useState, useEffect, useCallback } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { useUmi } from "@/providers/UmiProvider";
import { fetchUserBadges, type Badge } from "@/lib/badges";

/**
 * Hook to fetch OUTCRY compressed NFT badges for the connected wallet
 * or a specific address.
 */
export function useBadges(address?: string) {
  const { publicKey } = useWallet();
  const umi = useUmi();

  const targetAddress = address ?? publicKey?.toBase58() ?? null;

  const [badges, setBadges] = useState<Badge[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    if (!targetAddress) return;

    setLoading(true);
    setError(null);

    try {
      const result = await fetchUserBadges(umi, targetAddress);
      setBadges(result);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to fetch badges";
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, [umi, targetAddress]);

  useEffect(() => {
    refetch();
  }, [refetch]);

  return { badges, loading, error, refetch };
}
