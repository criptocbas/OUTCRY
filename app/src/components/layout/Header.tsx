"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { useWallet } from "@solana/wallet-adapter-react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";

export default function Header() {
  const { publicKey } = useWallet();
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 10);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <motion.header
      initial={{ opacity: 0, y: -12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.6, ease: "easeOut" }}
      className={`fixed top-0 left-0 right-0 z-50 border-b transition-all duration-300 ${
        scrolled
          ? "border-[#C6A961]/40 bg-[#050505]/80 backdrop-blur-xl"
          : "border-[#C6A961]/20 bg-[#050505]/95"
      }`}
    >
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-6">
        {/* Left: Logotype */}
        <Link href="/" className="flex flex-col items-start leading-none">
          <span
            className="text-2xl font-bold italic text-[#C6A961]"
            style={{ fontFamily: "'Playfair Display', serif" }}
          >
            OUTCRY
          </span>
          <span
            className="text-[9px] tracking-[0.3em] text-[#F5F0E8]/50 uppercase"
            style={{ fontFamily: "'DM Sans', sans-serif" }}
          >
            Live Auctions
          </span>
        </Link>

        {/* Center: Nav */}
        <nav className="hidden items-center gap-2 sm:flex">
          <NavLink href="/#auctions">Discover</NavLink>
          <NavDot />
          <NavLink href="/auction/create">Create</NavLink>
          {publicKey && (
            <>
              <NavDot />
              <NavLink href={`/profile/${publicKey.toBase58()}`}>
                Profile
              </NavLink>
            </>
          )}
        </nav>

        {/* Right: Wallet */}
        <div className="flex items-center">
          <WalletMultiButton
            style={{
              backgroundColor: "transparent",
              border: "1px solid rgba(198,169,97,0.4)",
              borderRadius: "6px",
              color: "#C6A961",
              fontFamily: "'DM Sans', sans-serif",
              fontSize: "13px",
              fontWeight: 500,
              height: "36px",
              letterSpacing: "0.05em",
              padding: "0 16px",
              textTransform: "uppercase",
              transition: "all 0.2s ease",
            }}
          />
        </div>
      </div>
    </motion.header>
  );
}

function NavDot() {
  return (
    <span className="text-[8px] text-[#C6A961]/60 select-none">&#9679;</span>
  );
}

function NavLink({
  href,
  children,
}: {
  href: string;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className="text-xs tracking-[0.15em] text-[#F5F0E8]/70 uppercase transition-colors duration-200 hover:text-[#C6A961]"
      style={{ fontFamily: "'DM Sans', sans-serif" }}
    >
      {children}
    </Link>
  );
}
