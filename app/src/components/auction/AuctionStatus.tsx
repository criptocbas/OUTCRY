"use client";

interface AuctionStatusProps {
  status: object;
}

interface StatusConfig {
  label: string;
  dotColor: string;
  pulse: boolean;
}

function getStatusConfig(status: object): StatusConfig {
  if ("active" in status) {
    return { label: "LIVE", dotColor: "#22C55E", pulse: true };
  }
  if ("ended" in status) {
    return { label: "ENDED", dotColor: "#E8A317", pulse: false };
  }
  if ("settled" in status) {
    return { label: "SETTLED", dotColor: "#C6A961", pulse: false };
  }
  if ("cancelled" in status) {
    return { label: "CANCELLED", dotColor: "#DC2626", pulse: false };
  }
  // Default: created
  return { label: "CREATED", dotColor: "#3B82F6", pulse: false };
}

export default function AuctionStatus({ status }: AuctionStatusProps) {
  const config = getStatusConfig(status);

  return (
    <div className="inline-flex items-center gap-1.5 rounded-full border border-[#2A2A2A]/80 bg-[#0D0D0D]/80 px-2.5 py-1 backdrop-blur-sm">
      {/* Dot */}
      <span className="relative flex h-2 w-2">
        {config.pulse && (
          <span
            className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-60"
            style={{ backgroundColor: config.dotColor }}
          />
        )}
        <span
          className="relative inline-flex h-2 w-2 rounded-full"
          style={{ backgroundColor: config.dotColor }}
        />
      </span>

      {/* Label */}
      <span
        className="text-[9px] font-medium tracking-[0.2em] text-[#F5F0E8]/70 uppercase"
        style={{ fontFamily: "'DM Sans', sans-serif" }}
      >
        {config.label}
      </span>
    </div>
  );
}
