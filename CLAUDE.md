# OUTCRY — Project Context

## What This Is

OUTCRY is a real-time live auction protocol on Solana for the Graveyard Hackathon (deadline: Feb 27, 2026). Tagline: "Going, going, onchain."

Artists list NFTs, collectors compete in real-time, spectators watch. Every bid is an onchain transaction at sub-50ms latency via MagicBlock Ephemeral Rollups. Social layer via Tapestry. Compressed NFT badges via Bubblegum.

## Target Bounties

- **MagicBlock** ($5K) — First non-gaming use of Ephemeral Rollups (real-time commerce)
- **Exchange Art** ($5K) — Art/NFT project with enforced royalties
- **Tapestry** ($5K) — Social profiles, follows, content, discovery
- **DRiP** ($2.5K) — Compressed NFT badges for auction participants
- **Overall prizes** ($30K pool)

## Architecture — Non-Negotiable Decisions

1. **Standard Anchor** — NOT BOLT ECS. Auctions are state machines, not game entities.
2. **Deposit-then-bid** (Shield Poker pattern) — SOL stays in vault on L1, only AuctionState delegates to ER. The ER never touches money.
3. **English auction only for MVP** — Dutch and Sealed-bid are stretch goals.
4. **Standard NFTs first** — pNFT (Token Auth Rules) royalty enforcement is a stretch goal.
5. **No custom backend** — Magic Router WebSocket for real-time, Tapestry REST for social, Umi for badges.
6. **Session keys are stretch** — MVP requires wallet approval per bid.

## Program Design

### Accounts

- `AuctionState` — Seeds: `[b"auction", seller, nft_mint]`. Delegated to ER during live bidding. Tracks current_bid, highest_bidder, end_time, status, bid_count.
- `AuctionVault` — Seeds: `[b"vault", auction_state]`. NEVER delegated. Holds SOL deposits on L1.
- `BidderDeposit` — Seeds: `[b"deposit", auction_state, bidder]`. Tracks each bidder's deposited SOL. Stays on L1.

### Instructions

| Instruction | Layer | Purpose |
|-------------|-------|---------|
| create_auction | L1 | Init state + vault, escrow NFT |
| deposit | L1 | Bidder deposits SOL to vault |
| start_auction | L1 | Set Active, delegate AuctionState to ER |
| place_bid | ER | Update current_bid + highest_bidder (sub-50ms) |
| end_auction | ER→L1 | Commit + undelegate back to L1 |
| settle_auction | L1 | Transfer NFT to winner, distribute SOL, pay royalties |
| claim_refund | L1 | Losers reclaim deposits |
| cancel_auction | L1 | Seller cancels (only if no bids) |

### Status Flow

Created → Active → Ended → Settled
Created → Cancelled (if no bids)

### Anti-Sniping

If a bid arrives within `extension_window` (default 300s) of `end_time`, extend `end_time` by `extension_seconds` (default 300s).

### Settlement Logic

1. Verify winner's BidderDeposit >= winning bid
2. Read royalty info from Metaplex metadata (seller_fee_basis_points, creators array)
3. Distribute: seller gets (bid - royalties - 2.5% protocol fee), creators get royalties
4. Transfer NFT from escrow to winner
5. Deduct winning bid from winner's deposit

## Tech Stack

### Rust Program
- anchor-lang 0.32.1 (with init-if-needed feature)
- anchor-spl 0.32.1 (token, associated_token, metadata features)
- ephemeral-rollups-sdk 1.0 (MagicBlock ER macros: #[ephemeral], #[delegate], commit_and_undelegate_accounts)
- mpl-token-metadata 5.0 (read royalty info)

### Frontend
- Next.js 14 (App Router)
- Tailwind CSS (dark premium theme — jet black + warm gold accents)
- @coral-xyz/anchor 0.32.1
- @solana/web3.js ^1.98
- @solana/wallet-adapter-react + wallet-adapter-react-ui
- @magicblock-labs/ephemeral-rollups-sdk (ConnectionMagicRouter)
- @metaplex-foundation/umi + mpl-bubblegum (badge minting)
- socialfi (Tapestry client) OR direct REST calls
- framer-motion (animations)

### Dev Environment
- Anchor CLI: 0.32.1
- Solana CLI: 2.0.0
- Rust: 1.93.0
- Node.js: v25.2.1

## MagicBlock Specifics

- **Delegation Program:** `DELeGGvXpWV2fqJUhqcF5ZSYMS4JTLjteaAMARRSaeSh`
- **Magic Router (devnet):** `https://devnet-router.magicblock.app`
- **Magic Router WebSocket:** `wss://devnet-router.magicblock.app`
- **TEE Validator (sealed bids):** `FnE6VJT5QNZdedZPnCoLsARgBwoE6DeJNjBs2H1gySXA`
- **ConnectionMagicRouter** auto-routes: delegated accounts → ER, non-delegated → L1
- **Delegation lifecycle:** delegate → process on ER → commit_and_undelegate → back on L1
- Use `#[ephemeral]` on program, `#[delegate]` on accounts struct for delegation instructions

## Tapestry Specifics

- **Base URL:** `https://api.usetapestry.dev/v1/`
- **Auth:** API key as query param (`?apiKey=xxx`)
- **Key endpoints:** /profiles, /followers, /follows, /contents, /comments, /likes
- **Execution modes:** FAST_UNCONFIRMED (~1s), QUICK_SIGNATURE (~5s), CONFIRMED_AND_PARSED (~15s)
- **API key must be proxied** — never expose to client. Use Next.js API routes.
- **Stats:** ~938K profiles, 2.3M follow relationships

## Metaplex Specifics

- **Token Metadata Program:** `metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s`
- **Bubblegum Program:** `BGUMAp9Gq7iTEuizy4pqaxsTyUCBK68MDfK752saRPUY`
- **Token Auth Rules (pNFT):** `auth9SigNpDKz4sJJ1DfCTuZrZNSAgh9sFD3rboVmgg`
- Badge tree: depth 14 = 16,384 cNFTs, canopy depth 11
- Badge types: Present (spectator), Contender (bidder), Victor (winner)

## Constants

```
PROTOCOL_FEE_BPS = 250 (2.5%)
DEFAULT_EXTENSION_SECONDS = 300 (5 min)
DEFAULT_EXTENSION_WINDOW = 300 (5 min)
DEFAULT_MIN_BID_INCREMENT = 100_000_000 (0.1 SOL)
MIN_AUCTION_DURATION = 300 (5 min)
MAX_AUCTION_DURATION = 604_800 (7 days)
```

## Build Priority Order

If time runs short, cut from the bottom:
1. Core program (L1 auction lifecycle) — MUST HAVE
2. MagicBlock ER integration — MUST HAVE (it's the whole point)
3. Frontend auction room — MUST HAVE
4. Tapestry social layer — HIGH (for bounty)
5. Bubblegum badges — HIGH (for bounty)
6. Visual polish + animations — MEDIUM
7. Dutch auction format — STRETCH
8. pNFT royalty enforcement — STRETCH
9. Session keys (gasless bidding) — STRETCH
10. Sealed-bid (TEE) — STRETCH
11. Sound design — STRETCH

## Design Language

- Dark theme, jet black backgrounds, warm gold accents
- Serif for auction titles (gravitas), sans-serif for data (precision)
- Art is the hero — full-bleed, generous whitespace
- Timer: white → amber → red with pulse
- Bid flash: golden flash on price update, number rolls up
- Mobile-first responsive

## What NOT To Do

- Don't use BOLT ECS — we already decided against it
- Don't store SOL in ER-delegated accounts — always keep value on L1
- Don't expose Tapestry API key to client — proxy through API routes
- Don't build Dutch/Sealed-bid before English is perfect
- Don't add pNFT complexity before standard NFTs work
- Don't over-engineer the frontend — polish comes last
- Don't skip tests on the program — settlement bugs lose money

## Reference

- Full pitch: `../PITCH.md`
- Build plan: `./BUILD-PLAN.md`
- Hackathon research: `../HACKATHON-RESEARCH.md`
- User's existing Anchor patterns: `../../HiddenHand/`
