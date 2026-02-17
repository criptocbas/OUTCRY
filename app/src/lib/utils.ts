import { LAMPORTS_PER_SOL } from "@solana/web3.js";

/**
 * Truncates a Solana address for display.
 * "Ab1C...xY2z" format.
 */
export function truncateAddress(address: string, chars = 4): string {
  if (address.length <= chars * 2) return address;
  return `${address.slice(0, chars)}...${address.slice(-chars)}`;
}

/**
 * Formats lamports to SOL with 2 decimal places.
 */
export function formatSOL(lamports: number): string {
  const sol = lamports / LAMPORTS_PER_SOL;
  return sol.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/**
 * Formats remaining time from a Unix timestamp (seconds) to a human-readable string.
 * Returns "ENDED" if the time has passed.
 */
export function formatTimeRemaining(endTime: number): string {
  const now = Math.floor(Date.now() / 1000);
  const remaining = endTime - now;

  if (remaining <= 0) return "ENDED";

  const days = Math.floor(remaining / 86400);
  const hours = Math.floor((remaining % 86400) / 3600);
  const minutes = Math.floor((remaining % 3600) / 60);
  const seconds = remaining % 60;

  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m ${seconds}s`;
}

/**
 * Returns a Tailwind CSS text color class for a given auction status string.
 */
export function getStatusColor(status: string): string {
  switch (status.toLowerCase()) {
    case "created":
      return "text-zinc-400";
    case "active":
      return "text-emerald-400";
    case "ended":
      return "text-amber-400";
    case "settled":
      return "text-[#C6A961]";
    case "cancelled":
      return "text-red-400";
    default:
      return "text-zinc-400";
  }
}

/**
 * Converts an Anchor enum object like { created: {} } to a display string "Created".
 * Anchor 0.32 IDL enums are deserialized as objects with a single key.
 */
export function getStatusLabel(status: object): string {
  const key = Object.keys(status)[0];
  if (!key) return "Unknown";
  return key.charAt(0).toUpperCase() + key.slice(1);
}
