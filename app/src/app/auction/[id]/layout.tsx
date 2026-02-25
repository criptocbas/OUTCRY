import type { Metadata } from "next";
import { Connection, PublicKey } from "@solana/web3.js";

const DEVNET_RPC = process.env.NEXT_PUBLIC_SOLANA_RPC_URL || "https://api.devnet.solana.com";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const truncated = `${id.slice(0, 4)}...${id.slice(-4)}`;

  // Try to fetch auction data for richer metadata
  try {
    const connection = new Connection(DEVNET_RPC, "confirmed");
    const accountInfo = await connection.getAccountInfo(new PublicKey(id));
    if (accountInfo?.data) {
      // Basic metadata even without full deserialization
      return {
        title: `Auction ${truncated} — OUTCRY`,
        description: `Live auction on Solana. Bid in real-time with sub-50ms confirmation.`,
        openGraph: {
          title: `Auction ${truncated} — OUTCRY`,
          description: `Live auction on Solana. Bid in real-time with sub-50ms confirmation.`,
          type: "website",
        },
        twitter: {
          card: "summary_large_image",
          title: `Auction ${truncated} — OUTCRY`,
          description: `Live auction on Solana. Real-time bidding powered by MagicBlock.`,
        },
      };
    }
  } catch {
    // Fall through to default metadata
  }

  return {
    title: `Auction ${truncated} — OUTCRY`,
    description: "Live auction on Solana — Going, going, onchain.",
  };
}

export default function AuctionLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
