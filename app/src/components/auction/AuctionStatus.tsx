"use client";

interface AuctionStatusProps {
  status: object;
}

interface StatusConfig {
  label: string;
  dotClass: string;
  pulse: boolean;
}

function getStatusConfig(status: object): StatusConfig {
  if ("active" in status) {
    return { label: "LIVE", dotClass: "bg-emerald-500", pulse: true };
  }
  if ("ended" in status) {
    return { label: "ENDED", dotClass: "bg-amber-500", pulse: false };
  }
  if ("settled" in status) {
    return { label: "SETTLED", dotClass: "bg-gold", pulse: false };
  }
  if ("cancelled" in status) {
    return { label: "CANCELLED", dotClass: "bg-red-600", pulse: false };
  }
  // Default: created
  return { label: "CREATED", dotClass: "bg-blue-500", pulse: false };
}

export default function AuctionStatus({ status }: AuctionStatusProps) {
  const config = getStatusConfig(status);

  return (
    <div className="inline-flex items-center gap-1.5 rounded-full border border-charcoal-light/80 bg-jet/80 px-2.5 py-1 backdrop-blur-sm">
      {/* Dot */}
      <span className="relative flex h-2 w-2">
        {config.pulse && (
          <span
            className={`absolute inline-flex h-full w-full animate-ping rounded-full opacity-60 ${config.dotClass}`}
          />
        )}
        <span
          className={`relative inline-flex h-2 w-2 rounded-full ${config.dotClass}`}
        />
      </span>

      {/* Label */}
      <span className="font-sans text-[9px] font-medium tracking-[0.2em] text-cream/70 uppercase">
        {config.label}
      </span>
    </div>
  );
}
