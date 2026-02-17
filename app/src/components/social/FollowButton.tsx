"use client";

import { useWallet } from "@solana/wallet-adapter-react";
import { useFollowStatus } from "@/hooks/useFollowStatus";
import { useState } from "react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface FollowButtonProps {
  targetWallet: string;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function FollowButton({ targetWallet }: FollowButtonProps) {
  const { publicKey } = useWallet();
  const myWallet = publicKey?.toBase58() ?? null;

  const { isFollowing, loading, toggle } = useFollowStatus(
    myWallet,
    targetWallet
  );

  const [hovered, setHovered] = useState(false);

  // Don't render if user is looking at their own profile.
  if (myWallet === targetWallet) return null;

  const disabled = !myWallet || loading;

  // Determine display text.
  let label: string;
  if (loading) {
    label = "";
  } else if (isFollowing) {
    label = hovered ? "Unfollow" : "Following";
  } else {
    label = "Follow";
  }

  // Determine styling.
  const isUnfollowHover = isFollowing && hovered && !loading;

  const baseClasses =
    "flex h-8 items-center justify-center gap-1.5 rounded-md px-4 text-[11px] font-semibold tracking-[0.12em] uppercase transition-all duration-200 disabled:cursor-not-allowed disabled:opacity-40";

  const stateClasses = isFollowing
    ? isUnfollowHover
      ? "border border-red-500/60 bg-red-500/10 text-red-400 hover:border-red-500"
      : "border border-gold bg-gold/10 text-gold"
    : "border border-gold/40 bg-transparent text-gold hover:border-gold hover:bg-gold/5";

  return (
    <button
      onClick={toggle}
      disabled={disabled}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      className={`${baseClasses} ${stateClasses}`}
      style={{ fontFamily: "var(--font-sans)", minWidth: "90px" }}
    >
      {loading ? (
        <Spinner />
      ) : (
        <>
          {isFollowing && !hovered && <CheckIcon />}
          {label}
        </>
      )}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Icons
// ---------------------------------------------------------------------------

function CheckIcon() {
  return (
    <svg
      className="h-3 w-3"
      viewBox="0 0 16 16"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M3 8.5L6.5 12L13 4"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function Spinner() {
  return (
    <svg
      className="h-4 w-4 animate-spin"
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
    >
      <circle
        className="opacity-25"
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="3"
      />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
      />
    </svg>
  );
}
