/**
 * Bubblegum compressed NFT badge system for OUTCRY.
 *
 * Badge types:
 *  - Present  — spectator who watched the auction
 *  - Contender — bidder who participated
 *  - Victor   — winner of the auction
 *
 * Uses Metaplex Bubblegum V1 via Umi.
 */

import {
  generateSigner,
  publicKey,
  type PublicKey as UmiPublicKey,
  type Umi,
} from "@metaplex-foundation/umi";
import {
  createTree,
  mintV1,
} from "@metaplex-foundation/mpl-bubblegum";
import { none } from "@metaplex-foundation/umi";
import {
  BADGE_TREE_MAX_DEPTH,
  BADGE_TREE_MAX_BUFFER,
  BADGE_TREE_CANOPY_DEPTH,
} from "@/lib/constants";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type BadgeType = "present" | "contender" | "victor";

export interface Badge {
  id: string;
  name: string;
  symbol: string;
  image: string;
  badgeType: BadgeType | "unknown";
  auctionName: string;
  attributes: Array<{ trait_type: string; value: string }>;
}

// ---------------------------------------------------------------------------
// Badge metadata helpers
// ---------------------------------------------------------------------------

const BADGE_NAMES: Record<BadgeType, string> = {
  present: "OUTCRY Present Badge",
  contender: "OUTCRY Contender Badge",
  victor: "OUTCRY Victor Badge",
};

const BADGE_DESCRIPTIONS: Record<BadgeType, (auction: string) => string> = {
  present: (a) =>
    `Proof of attendance at the "${a}" auction on OUTCRY. You were there.`,
  contender: (a) =>
    `Awarded for bidding in the "${a}" auction on OUTCRY. You fought for it.`,
  victor: (a) =>
    `Awarded to the winner of the "${a}" auction on OUTCRY. Going, going, yours.`,
};

/**
 * Build a static metadata URI for a badge.
 * For the hackathon we use a simple JSON-based approach.
 * In production this would upload to Arweave/IPFS.
 */
export function buildBadgeMetadataUri(
  badgeType: BadgeType,
  auctionName: string,
  auctionId: string,
  winningBid?: string
): string {
  // For hackathon: encode metadata directly into a data URI.
  // This avoids needing Irys/Arweave setup while still being valid JSON.
  const metadata = {
    name: `${BADGE_NAMES[badgeType]} - ${auctionName}`,
    symbol: "OUTCRY",
    description: BADGE_DESCRIPTIONS[badgeType](auctionName),
    image: "", // No image for hackathon MVP
    external_url: "https://outcry.art",
    attributes: [
      { trait_type: "Badge Type", value: capitalize(badgeType) },
      { trait_type: "Auction", value: auctionName },
      { trait_type: "Auction ID", value: auctionId },
      { trait_type: "Date", value: new Date().toISOString().split("T")[0] },
      ...(winningBid
        ? [{ trait_type: "Winning Bid", value: winningBid }]
        : []),
    ],
    properties: {
      files: [],
      category: "image",
      creators: [],
    },
  };

  return `data:application/json;base64,${btoa(JSON.stringify(metadata))}`;
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// ---------------------------------------------------------------------------
// Tree creation (one-time admin operation)
// ---------------------------------------------------------------------------

/**
 * Create a new Merkle tree for badge minting.
 * Costs ~0.7-1.0 SOL for rent exemption on devnet.
 * The umi.identity becomes the tree authority.
 */
export async function createBadgeTree(umi: Umi) {
  const merkleTree = generateSigner(umi);

  const builder = await createTree(umi, {
    merkleTree,
    maxDepth: BADGE_TREE_MAX_DEPTH,
    maxBufferSize: BADGE_TREE_MAX_BUFFER,
    canopyDepth: BADGE_TREE_CANOPY_DEPTH,
  });

  const result = await builder.sendAndConfirm(umi);

  return {
    merkleTree: merkleTree.publicKey,
    signature: result.signature,
  };
}

// ---------------------------------------------------------------------------
// Minting
// ---------------------------------------------------------------------------

/**
 * Mint a compressed NFT badge to a participant.
 * Must be called by the tree authority (whoever created the tree).
 */
export async function mintBadge(
  umi: Umi,
  merkleTreeAddress: string,
  recipientAddress: string,
  badgeType: BadgeType,
  auctionName: string,
  auctionId: string,
  winningBid?: string
) {
  const merkleTree = publicKey(merkleTreeAddress);
  const recipient = publicKey(recipientAddress);

  // Bubblegum limits URI to 128 chars. Use empty string for hackathon —
  // badge type and auction info are encoded in the name/symbol on-chain.
  const builder = mintV1(umi, {
    leafOwner: recipient,
    merkleTree,
    metadata: {
      name: `${BADGE_NAMES[badgeType]} - ${auctionName}`.slice(0, 32),
      symbol: "OUTCRY",
      uri: "",
      sellerFeeBasisPoints: 0,
      collection: none(),
      creators: [
        {
          address: umi.identity.publicKey,
          verified: false,
          share: 100,
        },
      ],
    },
  });

  // Use send() instead of sendAndConfirm() to avoid WebSocket issues
  // in the Next.js server environment (bufferutil compatibility).
  const result = await builder.send(umi);

  return {
    signature: result,
  };
}

// ---------------------------------------------------------------------------
// Fetching badges (requires DAS-compatible RPC like Helius)
// ---------------------------------------------------------------------------

/**
 * Fetch all OUTCRY compressed NFT badges owned by a wallet.
 * Requires a DAS-compatible RPC (Helius, Triton, etc).
 */
export async function fetchUserBadges(
  umi: Umi,
  ownerAddress: string
): Promise<Badge[]> {
  const owner = publicKey(ownerAddress);

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const assets = await (umi.rpc as any).getAssetsByOwner({
      owner,
      limit: 100,
      page: 1,
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (assets.items ?? [])
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .filter((asset: any) => {
        const name = asset.content?.metadata?.name ?? "";
        const symbol = asset.content?.metadata?.symbol ?? "";
        return symbol === "OUTCRY" || name.startsWith("OUTCRY");
      })
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .map((asset: any): Badge => {
        const name = asset.content?.metadata?.name ?? "";
        const attributes = asset.content?.metadata?.attributes ?? [];

        // Determine badge type
        let badgeType: Badge["badgeType"] = "unknown";
        const typeAttr = attributes.find(
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (a: any) => a.trait_type === "Badge Type"
        );
        if (typeAttr) {
          badgeType = typeAttr.value.toLowerCase() as Badge["badgeType"];
        } else if (name.includes("Victor")) {
          badgeType = "victor";
        } else if (name.includes("Contender")) {
          badgeType = "contender";
        } else if (name.includes("Present")) {
          badgeType = "present";
        }

        // Extract auction name from attributes or on-chain name
        const auctionAttr = attributes.find(
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (a: any) => a.trait_type === "Auction"
        );
        let auctionName = auctionAttr?.value ?? "";
        if (!auctionName && name.includes(" - ")) {
          // Parse from on-chain name: "OUTCRY Victor Badge - AuctionName"
          auctionName = name.split(" - ").slice(1).join(" - ");
        }

        return {
          id: asset.id,
          name,
          symbol: asset.content?.metadata?.symbol ?? "",
          image:
            asset.content?.links?.image ??
            asset.content?.files?.[0]?.uri ??
            "",
          badgeType,
          auctionName: auctionName || "Unknown Auction",
          attributes,
        };
      });
  } catch {
    // DAS API not available (e.g. standard RPC without DAS support)
    return [];
  }
}
