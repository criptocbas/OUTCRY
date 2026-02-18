"use client";

import { useEffect, useState } from "react";

interface CountdownTimerProps {
  endTime: number;
  status: string;
}

export default function CountdownTimer({ endTime, status }: CountdownTimerProps) {
  const [timeLeft, setTimeLeft] = useState<number>(() =>
    Math.max(0, Math.floor(endTime - Date.now() / 1000))
  );

  useEffect(() => {
    if (status !== "active") return;

    const tick = () => {
      const remaining = Math.max(0, Math.floor(endTime - Date.now() / 1000));
      setTimeLeft(remaining);
    };

    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [endTime, status]);

  if (status !== "active" || timeLeft <= 0) {
    const statusLabel =
      status === "created"
        ? "AWAITING START"
        : status === "settled"
          ? "SETTLED"
          : status === "cancelled"
            ? "CANCELLED"
            : "ENDED";

    const statusColor =
      status === "created"
        ? "text-[#F5F0E8]/60"
        : status === "settled"
          ? "text-emerald-400"
          : status === "cancelled"
            ? "text-red-400/70"
            : "text-[#C6A961]";

    return (
      <div className="flex flex-col items-center">
        <span
          className="mb-1 text-[10px] tracking-[0.25em] text-[#F5F0E8]/40 uppercase"
          style={{ fontFamily: "'DM Sans', sans-serif" }}
        >
          Auction Status
        </span>
        <span
          className={`text-2xl font-bold tracking-wider ${statusColor}`}
          style={{ fontFamily: "'Playfair Display', serif" }}
        >
          {statusLabel}
        </span>
      </div>
    );
  }

  const hours = Math.floor(timeLeft / 3600);
  const minutes = Math.floor((timeLeft % 3600) / 60);
  const seconds = timeLeft % 60;

  const pad = (n: number) => n.toString().padStart(2, "0");

  // Color states
  const isUrgent = timeLeft < 60;
  const isWarning = timeLeft < 300;

  let digitColor = "text-[#F5F0E8]";
  if (isUrgent) digitColor = "text-[#DC2626]";
  else if (isWarning) digitColor = "text-[#E8A317]";

  return (
    <div className="flex flex-col items-center">
      <span
        className="mb-2 text-[10px] tracking-[0.25em] text-[#F5F0E8]/40 uppercase"
        style={{ fontFamily: "'DM Sans', sans-serif" }}
      >
        Time Remaining
      </span>
      <div
        className={`flex items-baseline gap-1 ${isUrgent ? "animate-timer-pulse" : ""}`}
      >
        <TimeSegment value={pad(hours)} label="h" color={digitColor} />
        <Separator color={digitColor} />
        <TimeSegment value={pad(minutes)} label="m" color={digitColor} />
        <Separator color={digitColor} />
        <TimeSegment value={pad(seconds)} label="s" color={digitColor} />
      </div>

    </div>
  );
}

function TimeSegment({
  value,
  label,
  color,
}: {
  value: string;
  label: string;
  color: string;
}) {
  return (
    <div className="flex items-baseline">
      <span
        className={`text-3xl font-semibold tabular-nums ${color}`}
        style={{ fontFamily: "'DM Sans', sans-serif", fontVariantNumeric: "tabular-nums" }}
      >
        {value}
      </span>
      <span
        className="ml-0.5 text-[10px] text-[#F5F0E8]/30 uppercase"
        style={{ fontFamily: "'DM Sans', sans-serif" }}
      >
        {label}
      </span>
    </div>
  );
}

function Separator({ color }: { color: string }) {
  return (
    <span
      className={`mx-0.5 text-xl font-light ${color} opacity-40`}
      style={{ fontFamily: "'DM Sans', sans-serif" }}
    >
      :
    </span>
  );
}
