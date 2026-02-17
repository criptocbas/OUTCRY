"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import AuctionStatus from "./AuctionStatus";
import CountdownTimer from "./CountdownTimer";

interface AuctionStatus_t {
  created?: Record<string, never>;
  active?: Record<string, never>;
  ended?: Record<string, never>;
  settled?: Record<string, never>;
  cancelled?: Record<string, never>;
}

interface Auction {
  publicKey: string;
  seller: string;
  nftMint: string;
  currentBid: number;
  endTime: number;
  bidCount: number;
  status: AuctionStatus_t;
  reservePrice: number;
}

interface AuctionCardProps {
  auction: Auction;
}

function getStatusKey(status: AuctionStatus_t): string {
  if (status.active !== undefined) return "active";
  if (status.ended !== undefined) return "ended";
  if (status.settled !== undefined) return "settled";
  if (status.cancelled !== undefined) return "cancelled";
  return "created";
}

/**
 * Generate a deterministic hue from a public key string
 * to give each card a subtly unique gradient.
 */
function seedHue(address: string): number {
  let hash = 0;
  for (let i = 0; i < address.length; i++) {
    hash = address.charCodeAt(i) + ((hash << 5) - hash);
  }
  return Math.abs(hash) % 360;
}

function formatSol(lamports: number): string {
  return (lamports / 1_000_000_000).toFixed(2);
}

export default function AuctionCard({ auction }: AuctionCardProps) {
  const statusKey = getStatusKey(auction.status);
  const hue = seedHue(auction.publicKey);

  const displayBid =
    auction.currentBid > 0 ? auction.currentBid : auction.reservePrice;
  const bidLabel = auction.currentBid > 0 ? "Current Bid" : "Reserve";

  return (
    <Link href={`/auction/${auction.publicKey}`}>
      <motion.div
        whileHover={{ scale: 1.02 }}
        transition={{ duration: 0.25, ease: "easeOut" }}
        className="group cursor-pointer overflow-hidden rounded-lg border border-[#2A2A2A] bg-[#1A1A1A] transition-all duration-300 hover:border-[#C6A961]/40 hover:shadow-[0_0_20px_rgba(198,169,97,0.08)]"
      >
        {/* Artwork placeholder */}
        <div
          className="relative aspect-square w-full"
          style={{
            background: `linear-gradient(135deg, hsl(${hue}, 15%, 8%) 0%, hsl(${(hue + 40) % 360}, 20%, 12%) 50%, hsl(${(hue + 80) % 360}, 10%, 6%) 100%)`,
          }}
        >
          {/* Subtle grid overlay */}
          <div className="absolute inset-0 opacity-[0.03]" style={{
            backgroundImage: "linear-gradient(rgba(198,169,97,0.5) 1px, transparent 1px), linear-gradient(90deg, rgba(198,169,97,0.5) 1px, transparent 1px)",
            backgroundSize: "40px 40px",
          }} />

          {/* Status badge overlay */}
          <div className="absolute top-3 left-3">
            <AuctionStatus status={auction.status} />
          </div>
        </div>

        {/* Info section */}
        <div className="px-4 pt-3 pb-4">
          {/* Bid amount */}
          <div className="mb-2 flex items-baseline justify-between">
            <div className="flex flex-col">
              <span
                className="text-[9px] tracking-[0.2em] text-[#F5F0E8]/30 uppercase"
                style={{ fontFamily: "'DM Sans', sans-serif" }}
              >
                {bidLabel}
              </span>
              <div className="flex items-baseline gap-1.5">
                <span
                  className="text-xl font-bold tabular-nums text-[#C6A961]"
                  style={{
                    fontFamily: "'DM Sans', sans-serif",
                    fontVariantNumeric: "tabular-nums",
                  }}
                >
                  {formatSol(displayBid)}
                </span>
                <span
                  className="text-[10px] font-medium text-[#C6A961]/50 uppercase"
                  style={{ fontFamily: "'DM Sans', sans-serif" }}
                >
                  SOL
                </span>
              </div>
            </div>

            {/* Bid count */}
            <div className="flex flex-col items-end">
              <span
                className="text-[9px] tracking-[0.2em] text-[#F5F0E8]/30 uppercase"
                style={{ fontFamily: "'DM Sans', sans-serif" }}
              >
                Bids
              </span>
              <span
                className="text-sm tabular-nums text-[#F5F0E8]/60"
                style={{
                  fontFamily: "'DM Sans', sans-serif",
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                {auction.bidCount}
              </span>
            </div>
          </div>

          {/* Footer: timer */}
          {statusKey === "active" && (
            <div className="border-t border-[#2A2A2A] pt-2">
              <div className="scale-75 origin-left">
                <CountdownTimer endTime={auction.endTime} status={statusKey} />
              </div>
            </div>
          )}
        </div>
      </motion.div>
    </Link>
  );
}
