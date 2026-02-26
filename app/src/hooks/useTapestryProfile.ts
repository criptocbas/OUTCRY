"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { getProfile } from "@/lib/tapestry";
import type { ProfileWithCounts } from "@/lib/tapestry";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface UseTapestryProfileReturn {
  profile: ProfileWithCounts | null;
  loading: boolean;
  error: string | null;
}

// ---------------------------------------------------------------------------
// Module-level cache shared across all hook instances.
// Keyed by wallet address, stores the resolved profile (or null if not found).
// ---------------------------------------------------------------------------

const MAX_CACHE = 200;
const CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes

interface CacheEntry {
  value: ProfileWithCounts | null;
  ts: number;
}

const profileCache = new Map<string, CacheEntry>();

function cacheGet(key: string): ProfileWithCounts | null | undefined {
  const entry = profileCache.get(key);
  if (!entry) return undefined;
  if (Date.now() - entry.ts > CACHE_TTL_MS) {
    profileCache.delete(key);
    return undefined;
  }
  return entry.value;
}

function cacheHas(key: string): boolean {
  return cacheGet(key) !== undefined;
}

function cacheSet(key: string, value: ProfileWithCounts | null) {
  if (profileCache.size >= MAX_CACHE) {
    const oldest = profileCache.keys().next().value;
    if (oldest !== undefined) profileCache.delete(oldest);
  }
  profileCache.set(key, { value, ts: Date.now() });
}

// ---------------------------------------------------------------------------
// Pre-warm: fetch multiple profiles into cache (fire-and-forget, no UI state)
// Deduplicates against cache and in-flight requests.
// ---------------------------------------------------------------------------

const inflight = new Set<string>();

export function prefetchProfiles(addresses: string[]): void {
  for (const addr of addresses) {
    if (cacheHas(addr) || inflight.has(addr)) continue;
    inflight.add(addr);
    getProfile(addr)
      .then((result) => cacheSet(addr, result))
      .catch(() => cacheSet(addr, null))
      .finally(() => inflight.delete(addr));
  }
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useTapestryProfile(
  walletAddress: string | null
): UseTapestryProfileReturn {
  const [profile, setProfile] = useState<ProfileWithCounts | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Track in-flight requests so we can ignore stale responses when the wallet
  // address changes before the fetch completes.
  const activeRequestRef = useRef<string | null>(null);

  const fetchProfile = useCallback(async (address: string) => {
    // Return cached result immediately if available.
    const cached = cacheGet(address);
    if (cached !== undefined) {
      setProfile(cached);
      setLoading(false);
      setError(null);
      return;
    }

    activeRequestRef.current = address;
    setLoading(true);
    setError(null);

    try {
      const result = await getProfile(address);
      // Only apply if this is still the active request.
      if (activeRequestRef.current === address) {
        cacheSet(address, result);
        setProfile(result);
      }
    } catch (err: unknown) {
      if (activeRequestRef.current === address) {
        const message =
          err instanceof Error ? err.message : "Failed to fetch profile";
        setError(message);
        setProfile(null);
      }
    } finally {
      if (activeRequestRef.current === address) {
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    if (!walletAddress) {
      setProfile(null);
      setLoading(false);
      setError(null);
      activeRequestRef.current = null;
      return;
    }

    fetchProfile(walletAddress);

    return () => {
      activeRequestRef.current = null;
    };
  }, [walletAddress, fetchProfile]);

  return { profile, loading, error };
}
