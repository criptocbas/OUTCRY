import { NextRequest, NextResponse } from "next/server";
import { Keypair } from "@solana/web3.js";
import { createUmi } from "@metaplex-foundation/umi-bundle-defaults";
import { keypairIdentity } from "@metaplex-foundation/umi";
import { fromWeb3JsKeypair } from "@metaplex-foundation/umi-web3js-adapters";
import { mintBadge, type BadgeType } from "@/lib/badges";

const HELIUS_RPC =
  process.env.NEXT_PUBLIC_HELIUS_RPC || "https://api.devnet.solana.com";
const BADGE_MERKLE_TREE = process.env.NEXT_PUBLIC_BADGE_MERKLE_TREE || "";
const TREE_AUTHORITY_KEY = process.env.BADGE_TREE_AUTHORITY_KEY || "";

interface MintRecipient {
  address: string;
  badgeType: BadgeType;
  auctionName: string;
  auctionId: string;
  winningBid?: string;
}

export async function POST(req: NextRequest) {
  if (!BADGE_MERKLE_TREE || !TREE_AUTHORITY_KEY) {
    return NextResponse.json(
      { error: "Badge minting not configured" },
      { status: 503 }
    );
  }

  let body: { recipients: MintRecipient[] };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!Array.isArray(body.recipients) || body.recipients.length === 0) {
    return NextResponse.json(
      { error: "recipients array is required" },
      { status: 400 }
    );
  }

  // Cap at 20 recipients per request to avoid timeouts
  if (body.recipients.length > 20) {
    return NextResponse.json(
      { error: "Maximum 20 recipients per request" },
      { status: 400 }
    );
  }

  // Build server-side Umi with deployer keypair
  const keypairBytes = JSON.parse(TREE_AUTHORITY_KEY) as number[];
  const wallet = Keypair.fromSecretKey(Uint8Array.from(keypairBytes));
  const umi = createUmi(HELIUS_RPC);
  umi.use(keypairIdentity(fromWeb3JsKeypair(wallet)));

  const results: Array<{
    address: string;
    badgeType: string;
    success: boolean;
    error?: string;
  }> = [];

  // Mint sequentially — each is independent, failures don't block others
  for (const r of body.recipients) {
    try {
      await mintBadge(
        umi,
        BADGE_MERKLE_TREE,
        r.address,
        r.badgeType,
        r.auctionName,
        r.auctionId,
        r.winningBid
      );
      results.push({ address: r.address, badgeType: r.badgeType, success: true });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`Badge mint failed for ${r.address}:`, msg);
      results.push({
        address: r.address,
        badgeType: r.badgeType,
        success: false,
        error: msg,
      });
    }
  }

  return NextResponse.json({ results });
}
