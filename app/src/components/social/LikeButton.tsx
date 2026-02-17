"use client";

import { motion } from "framer-motion";
import { useAuctionLike } from "@/hooks/useAuctionLike";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface LikeButtonProps {
  auctionId: string;
  userProfileId: string | null;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function LikeButton({
  auctionId,
  userProfileId,
}: LikeButtonProps) {
  const { hasLiked, likeCount, loading, toggle } = useAuctionLike(
    auctionId,
    userProfileId
  );

  const disabled = !userProfileId || loading;

  return (
    <button
      onClick={toggle}
      disabled={disabled}
      className="group flex items-center gap-1.5 rounded-md px-2 py-1.5 transition-colors duration-200 hover:bg-charcoal-light/50 disabled:cursor-not-allowed disabled:opacity-40"
      aria-label={hasLiked ? "Unlike auction" : "Like auction"}
    >
      <motion.div
        whileTap={{ scale: 1.3 }}
        transition={{ type: "spring", stiffness: 500, damping: 15 }}
      >
        {hasLiked ? <HeartFilledIcon /> : <HeartOutlineIcon />}
      </motion.div>

      <span
        className={`text-xs tabular-nums transition-colors duration-200 ${
          hasLiked ? "text-gold" : "text-muted group-hover:text-cream/60"
        }`}
        style={{
          fontFamily: "var(--font-sans)",
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {likeCount}
      </span>
    </button>
  );
}

// ---------------------------------------------------------------------------
// Icons
// ---------------------------------------------------------------------------

function HeartFilledIcon() {
  return (
    <svg
      className="h-4 w-4 text-gold"
      viewBox="0 0 24 24"
      fill="currentColor"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" />
    </svg>
  );
}

function HeartOutlineIcon() {
  return (
    <svg
      className="h-4 w-4 text-muted transition-colors duration-200 group-hover:text-cream/50"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
