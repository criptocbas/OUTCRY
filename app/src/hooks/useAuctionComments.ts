"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import {
  getComments,
  postComment as apiPostComment,
} from "@/lib/tapestry";
import type { Comment } from "@/lib/tapestry";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface UseAuctionCommentsReturn {
  comments: Comment[];
  loading: boolean;
  error: string | null;
  postComment: (text: string) => Promise<void>;
  refresh: () => Promise<void>;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useAuctionComments(
  auctionId: string,
  userProfileId: string | null
): UseAuctionCommentsReturn {
  const [comments, setComments] = useState<Comment[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Track active fetch so stale responses from a different auctionId
  // don't overwrite state.
  const activeIdRef = useRef<string | null>(null);

  const fetchComments = useCallback(async () => {
    if (!auctionId) {
      setComments([]);
      return;
    }

    activeIdRef.current = auctionId;
    setLoading(true);
    setError(null);

    try {
      const result = await getComments(auctionId, 50, 0);
      if (activeIdRef.current === auctionId) {
        setComments(result.comments);
      }
    } catch (err: unknown) {
      if (activeIdRef.current === auctionId) {
        const message =
          err instanceof Error ? err.message : "Failed to load comments";
        setError(message);
      }
    } finally {
      if (activeIdRef.current === auctionId) {
        setLoading(false);
      }
    }
  }, [auctionId]);

  // Fetch on mount / auctionId change.
  useEffect(() => {
    fetchComments();

    return () => {
      activeIdRef.current = null;
    };
  }, [fetchComments]);

  // Post a new comment and optimistically prepend it.
  const postComment = useCallback(
    async (text: string) => {
      if (!userProfileId || !auctionId || !text.trim()) return;

      try {
        const newComment = await apiPostComment(
          userProfileId,
          auctionId,
          text.trim()
        );
        // Prepend to give immediate feedback (newest first).
        setComments((prev) => [newComment, ...prev]);
      } catch (err: unknown) {
        const message =
          err instanceof Error ? err.message : "Failed to post comment";
        setError(message);
        throw err; // Re-throw so the UI can handle it.
      }
    },
    [userProfileId, auctionId]
  );

  return {
    comments,
    loading,
    error,
    postComment,
    refresh: fetchComments,
  };
}
