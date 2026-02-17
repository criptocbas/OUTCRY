"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import {
  checkFollowStatus,
  followUser,
  unfollowUser,
} from "@/lib/tapestry";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface UseFollowStatusReturn {
  isFollowing: boolean;
  loading: boolean;
  toggle: () => Promise<void>;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useFollowStatus(
  myWallet: string | null,
  targetWallet: string | null
): UseFollowStatusReturn {
  const [isFollowing, setIsFollowing] = useState(false);
  const [loading, setLoading] = useState(false);

  // Guard against stale responses when wallets change.
  const activeKeyRef = useRef<string | null>(null);

  // Check follow status on mount / wallet change.
  useEffect(() => {
    if (!myWallet || !targetWallet || myWallet === targetWallet) {
      setIsFollowing(false);
      setLoading(false);
      activeKeyRef.current = null;
      return;
    }

    const key = `${myWallet}:${targetWallet}`;
    activeKeyRef.current = key;

    let cancelled = false;

    async function check() {
      setLoading(true);
      try {
        const status = await checkFollowStatus(myWallet!, targetWallet!);
        if (!cancelled && activeKeyRef.current === key) {
          setIsFollowing(status.isFollowing);
        }
      } catch {
        // Silently ignore -- default to not following.
        if (!cancelled) setIsFollowing(false);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    check();

    return () => {
      cancelled = true;
    };
  }, [myWallet, targetWallet]);

  // Toggle follow / unfollow.
  const toggle = useCallback(async () => {
    if (!myWallet || !targetWallet || myWallet === targetWallet) return;

    setLoading(true);
    try {
      if (isFollowing) {
        await unfollowUser(myWallet, targetWallet);
        setIsFollowing(false);
      } else {
        await followUser(myWallet, targetWallet);
        setIsFollowing(true);
      }
    } catch {
      // Revert on error is implicit -- we only set state on success.
    } finally {
      setLoading(false);
    }
  }, [myWallet, targetWallet, isFollowing]);

  return { isFollowing, loading, toggle };
}
