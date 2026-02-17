2# OUTCRY — Build Plan

## Overview

**What:** A real-time live auction protocol on Solana, powered by MagicBlock Ephemeral Rollups.
**Deadline:** February 27, 2026 (12 days from Feb 15)
**Target Bounties:** MagicBlock ($5K) + Exchange Art ($5K) + Tapestry ($5K) + DRiP ($2.5K) + Overall prizes

---

## Architecture Decisions

### 1. Standard Anchor, Not BOLT ECS

Auctions are **state machines**, not game entities. BOLT ECS (Entity Component System) is designed for games with many entities sharing behaviors. An auction has a single state that transitions through a lifecycle: Created → Live → Ended → Settled. Standard Anchor with well-defined account structures and instructions is the right abstraction.

### 2. Deposit-Then-Bid Model (Shield Poker Pattern)

This is the critical architectural insight borrowed from MagicBlock's Shield Poker:

- **AuctionVault** (holds SOL) → **stays on L1**. Value custody never leaves the base layer.
- **AuctionState** (tracks bids, timer, status) → **delegates to Ephemeral Rollup** for sub-50ms bidding.

The flow:
1. Bidders **deposit SOL** into AuctionVault on L1 *before* the auction goes live
2. AuctionState is **delegated to ER** when auction starts
3. On ER, `place_bid` only updates bid tracking (no SOL movement) — validates bid amount ≤ bidder's deposit
4. When auction ends, state **commits back to L1**
5. `settle_auction` on L1 moves SOL from vault based on final ER state

**Why not move SOL on ER?** The ER is ephemeral — it exists only while the auction is live. SOL in an ER account is technically safe (it commits back), but the security model is stronger when value never leaves L1. This also means if the ER crashes or has issues, deposited SOL is always recoverable on L1.

### 3. Deposit Tracking on ER

Challenge: `place_bid` on ER needs to know each bidder's deposit, but `BidderDeposit` accounts are on L1.

Solution: **Embed deposit amounts in AuctionState before delegation.**

```
AuctionState.deposits: Vec<(Pubkey, u64)>  // max ~20 bidders for hackathon
```

When a bidder deposits on L1, their entry is added/updated in AuctionState.deposits. When AuctionState delegates to ER, the deposit info travels with it. On ER, `place_bid` validates against this embedded data.

Limitation: New deposits can't happen mid-auction (AuctionState is on ER, not L1). For the hackathon MVP, this is acceptable — bidders must deposit before the auction goes live. Post-hackathon, a commit-deposit-recommit cycle could enable mid-auction deposits.

### 4. NFT Handling

**MVP: Standard SPL Token NFTs only.** Transfer via `spl_token::transfer` into an escrow PDA.

**Stretch: Programmable NFTs (pNFTs).** Transfer via Metaplex Token Metadata CPI with authorization rules. This is significantly more complex (requires Token Auth Rules program integration) but is what Exchange Art cares about for their bounty.

### 5. Badge Minting — Client-Side via Umi

Bubblegum cNFT minting will be triggered **client-side** after settlement, not via CPI from the Anchor program. Reasons:
- CPI to Bubblegum from Anchor is complex and adds program size
- Client-side Umi + mpl-bubblegum is well-documented and fast to implement
- The settlement transaction already does a lot (transfer NFT, distribute SOL, royalties) — adding CPI bloats it
- Client-side minting with the program's PDA as tree authority still works

### 6. No Custom Backend

The Magic Router provides WebSocket subscriptions to ER state changes. The frontend subscribes to AuctionState account changes and gets real-time updates. Tapestry is a REST API called directly from the frontend. No Express/Fastify server needed.

### 7. Frontend: Next.js 15 + App Router

Standard modern Next.js setup. Server components for SEO/discovery pages, client components for the auction room (needs WebSocket, wallet, real-time state).

---

## MVP Feature Set (Must Ship)

1. **English Auction** with anti-sniping timer extension
2. **Real-time bidding** via MagicBlock Ephemeral Rollups (sub-50ms)
3. **NFT escrow** → auction → settlement (atomic)
4. **Tapestry social profiles** — display in auction room, follow artists
5. **Tapestry content** — auction results posted to social feed
6. **Compressed NFT badges** via Bubblegum (Present, Contender, Victor)
7. **Beautiful auction room UI** — countdown, live bid feed, artwork display
8. **Auction discovery page** — browse active/upcoming/past auctions

## Stretch Goals (If Time Permits)

1. Dutch auction format
2. pNFT support with royalty enforcement (Exchange Art bounty boost)
3. Session keys for gasless rapid bidding
4. Sound design (bid tick, outbid alert, gavel hammer)
5. Sealed-bid auction via TEE Private Ephemeral Rollups
6. Tapestry comments/reactions in auction room
7. Bidder reputation scoring

---

## Program Design

### Program ID

Will be generated on `anchor init`. Deployed to devnet.

### Accounts

```rust
// ── Enums ──

#[derive(AnchorSerialize, AnchorDeserialize, Clone, PartialEq, Eq)]
pub enum AuctionType {
    English,        // MVP
    Dutch,          // Stretch
    SealedBid,      // Stretch
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, PartialEq, Eq)]
pub enum AuctionStatus {
    Created,        // Auction initialized, accepting deposits
    Live,           // Delegated to ER, accepting bids
    Ended,          // Timer expired, awaiting settlement
    Settled,        // NFT + SOL distributed
    Cancelled,      // Seller cancelled before going live
}

// ── Deposit entry embedded in AuctionState ──

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct DepositEntry {
    pub bidder: Pubkey,
    pub amount: u64,
}

// ── Core Accounts ──

#[account]
pub struct AuctionState {
    pub seller: Pubkey,                 // 32
    pub nft_mint: Pubkey,               // 32
    pub auction_type: AuctionType,      // 1
    pub status: AuctionStatus,          // 1
    pub reserve_price: u64,             // 8
    pub min_bid_increment: u64,         // 8
    pub current_bid: u64,               // 8
    pub highest_bidder: Pubkey,         // 32
    pub start_time: i64,                // 8
    pub end_time: i64,                  // 8
    pub extension_seconds: u32,         // 4  (default 300 = 5 min)
    pub extension_window: u32,          // 4  (default 300 = 5 min)
    pub bid_count: u32,                 // 4
    pub deposits: Vec<DepositEntry>,    // 4 + (40 * max_bidders)
    pub bump: u8,                       // 1
}
// Space: 8 (discriminator) + 32+32+1+1+8+8+8+32+8+8+4+4+4 + (4 + 40*20) + 1
//      = 8 + 155 + 804 = 967 bytes (with 20 max bidders)

#[account]
pub struct AuctionVault {
    pub auction: Pubkey,                // 32
    pub bump: u8,                       // 1
}
// Space: 8 + 33 = 41 bytes
// This PDA also holds SOL (lamports) as the escrow

#[account]
pub struct NftEscrow {
    pub auction: Pubkey,                // 32
    pub nft_mint: Pubkey,               // 32
    pub bump: u8,                       // 1
}
// Space: 8 + 65 = 73 bytes
// Associated token account holds the actual NFT
```

### PDA Seeds

```
AuctionState:  ["auction", seller, nft_mint]
AuctionVault:  ["vault", auction_state]
NftEscrow:     ["escrow", auction_state]
```

### Instructions

```
┌─────────────────────────────────────────────────────────────┐
│                    INSTRUCTION FLOW                          │
│                                                             │
│  L1 (Solana Devnet)          ER (Ephemeral Rollup)          │
│  ─────────────────          ──────────────────────          │
│                                                             │
│  1. create_auction                                          │
│     → init AuctionState                                     │
│     → init AuctionVault                                     │
│     → escrow NFT into NftEscrow ATA                         │
│     → status = Created                                      │
│                                                             │
│  2. deposit                                                 │
│     → transfer SOL to AuctionVault                          │
│     → add/update DepositEntry in AuctionState.deposits      │
│     → (can be called multiple times per bidder)             │
│                                                             │
│  3. start_auction                                           │
│     → validate start_time reached                           │
│     → delegate AuctionState to ER                           │
│     → status = Live                                         │
│                         ┌───────────────────────────────┐   │
│                         │  4. place_bid (sub-50ms)      │   │
│                         │     → validate bid > current  │   │
│                         │     → validate bid ≤ deposit  │   │
│                         │     → update current_bid      │   │
│                         │     → update highest_bidder   │   │
│                         │     → anti-snipe extension    │   │
│                         │     → increment bid_count     │   │
│                         │                               │   │
│                         │  5. end_auction               │   │
│                         │     → validate timer expired  │   │
│                         │     → status = Ended          │   │
│                         │     → commit + undelegate     │   │
│                         └───────────────────────────────┘   │
│                                                             │
│  6. settle_auction                                          │
│     → validate status = Ended                               │
│     → transfer NFT from escrow to winner                    │
│     → transfer winning bid SOL to seller                    │
│     → distribute royalties to creators                      │
│     → return deposits to losing bidders                     │
│     → status = Settled                                      │
│                                                             │
│  7. claim_refund                                            │
│     → for bidders who lost or if auction cancelled          │
│     → return their deposit from vault                       │
│                                                             │
│  8. cancel_auction                                          │
│     → only seller, only if status = Created                 │
│     → return NFT to seller                                  │
│     → return all deposits                                   │
│     → status = Cancelled                                    │
└─────────────────────────────────────────────────────────────┘
```

### Instruction Details

**create_auction**
```
Accounts:
  - seller (signer, mut)
  - auction_state (init, pda)
  - auction_vault (init, pda)
  - nft_mint
  - seller_nft_ata (mut)           // seller's token account
  - escrow_nft_ata (mut)           // program-owned token account
  - token_program
  - associated_token_program
  - system_program

Args:
  - auction_type: AuctionType
  - reserve_price: u64
  - min_bid_increment: u64
  - start_time: i64
  - duration_seconds: u64
  - extension_seconds: u32         // default 300
  - extension_window: u32          // default 300
```

**deposit**
```
Accounts:
  - bidder (signer, mut)
  - auction_state (mut)
  - auction_vault (mut)
  - system_program

Args:
  - amount: u64

Validation:
  - auction_state.status == Created
  - amount > 0
  - deposits.len() < MAX_BIDDERS (20) or bidder already in list
```

**start_auction**
```
Accounts:
  - payer (signer, mut)            // anyone can start when time arrives
  - auction_state (mut)
  - delegation_program
  - delegation_record
  - delegation_metadata
  - buffer
  - system_program

Validation:
  - status == Created
  - Clock::get().unix_timestamp >= start_time
  - At least one deposit exists

Effect:
  - Calls delegate() on AuctionState via ephemeral-rollups-sdk
  - Sets status = Live
```

**place_bid** (runs on ER)
```
Accounts:
  - bidder (signer)
  - auction_state (mut, delegated)

Args:
  - amount: u64

Validation:
  - status == Live
  - Clock::get().unix_timestamp < end_time
  - amount >= current_bid + min_bid_increment (or >= reserve_price if first bid)
  - bidder exists in deposits vec AND amount <= their deposit amount
  - bidder != seller

Effect:
  - current_bid = amount
  - highest_bidder = bidder
  - bid_count += 1
  - If within extension_window of end_time: end_time += extension_seconds
```

**end_auction** (runs on ER, commits back to L1)
```
Accounts:
  - payer (signer, mut)
  - auction_state (mut, delegated)
  - magic_program
  - magic_context

Validation:
  - status == Live
  - Clock::get().unix_timestamp >= end_time

Effect:
  - status = Ended
  - commit_and_undelegate(auction_state)
```

**settle_auction**
```
Accounts:
  - payer (signer, mut)
  - auction_state (mut)
  - auction_vault (mut)
  - nft_mint
  - nft_metadata                   // Metaplex metadata (for royalties)
  - escrow_nft_ata (mut)
  - winner_nft_ata (mut)
  - seller (mut)                   // receives SOL
  - winner                         // receives NFT
  - creator_1..N (mut, optional)   // royalty recipients
  - token_program
  - associated_token_program
  - system_program

Validation:
  - status == Ended
  - highest_bidder != Pubkey::default() (at least one bid)

Effect:
  - Transfer NFT: escrow_ata → winner_ata
  - Calculate royalties from nft_metadata.seller_fee_basis_points
  - Transfer royalties: vault → each verified creator
  - Transfer remainder: vault → seller
  - Return deposits: vault → each losing bidder
  - status = Settled
```

**claim_refund**
```
Accounts:
  - bidder (signer, mut)
  - auction_state (mut)
  - auction_vault (mut)
  - system_program

Validation:
  - status == Settled || status == Cancelled
  - bidder != highest_bidder (if Settled)
  - bidder exists in deposits vec with amount > 0

Effect:
  - Transfer deposit amount: vault → bidder
  - Set bidder's deposit to 0 in vec
```

**cancel_auction**
```
Accounts:
  - seller (signer, mut)
  - auction_state (mut)
  - auction_vault (mut)
  - nft_mint
  - escrow_nft_ata (mut)
  - seller_nft_ata (mut)
  - token_program
  - system_program

Validation:
  - status == Created (cannot cancel once live)
  - seller == auction_state.seller

Effect:
  - Return NFT: escrow_ata → seller_ata
  - Return all deposits: vault → each depositor
  - status = Cancelled
```

---

## Project Structure

```
outcry/
├── programs/
│   └── outcry/
│       ├── Cargo.toml
│       └── src/
│           ├── lib.rs                    # Program entrypoint + instruction dispatch
│           ├── state/
│           │   ├── mod.rs
│           │   └── auction.rs            # AuctionState, AuctionVault, NftEscrow, enums
│           ├── instructions/
│           │   ├── mod.rs
│           │   ├── create_auction.rs
│           │   ├── deposit.rs
│           │   ├── start_auction.rs      # Delegation to ER
│           │   ├── place_bid.rs          # Runs on ER
│           │   ├── end_auction.rs        # Commit + undelegate
│           │   ├── settle_auction.rs
│           │   ├── claim_refund.rs
│           │   └── cancel_auction.rs
│           ├── errors.rs                 # Custom error codes
│           └── constants.rs              # Seeds, limits, defaults
├── app/                                  # Next.js 15 frontend
│   ├── src/
│   │   ├── app/
│   │   │   ├── layout.tsx                # Root layout + providers
│   │   │   ├── page.tsx                  # Home — discover auctions
│   │   │   ├── auction/
│   │   │   │   ├── [id]/
│   │   │   │   │   └── page.tsx          # Auction Room (the core experience)
│   │   │   │   └── create/
│   │   │   │       └── page.tsx          # Create new auction
│   │   │   └── profile/
│   │   │       └── [address]/
│   │   │           └── page.tsx          # User profile + auction history
│   │   ├── components/
│   │   │   ├── auction/
│   │   │   │   ├── AuctionCard.tsx       # Card for discover grid
│   │   │   │   ├── AuctionRoom.tsx       # Main auction room container
│   │   │   │   ├── ArtworkDisplay.tsx    # Full-bleed NFT media display
│   │   │   │   ├── BidPanel.tsx          # Current price + bid input + bid button
│   │   │   │   ├── BidHistory.tsx        # Scrolling bid feed
│   │   │   │   ├── CountdownTimer.tsx    # Timer with color states
│   │   │   │   ├── AuctionStatus.tsx     # Status badge (Created/Live/Ended/Settled)
│   │   │   │   └── CreateAuctionForm.tsx # Multi-step auction creation
│   │   │   ├── social/
│   │   │   │   ├── ProfileCard.tsx       # Tapestry profile display
│   │   │   │   ├── FollowButton.tsx      # Follow/unfollow via Tapestry
│   │   │   │   ├── AuctionSocialFeed.tsx # Comments + reactions in room
│   │   │   │   └── ParticipantList.tsx   # Who's in the room
│   │   │   ├── layout/
│   │   │   │   ├── Header.tsx            # Nav + logo + wallet
│   │   │   │   └── WalletButton.tsx      # Connect/disconnect wallet
│   │   │   └── ui/                       # Shared primitives (button, input, etc.)
│   │   ├── hooks/
│   │   │   ├── useAuction.ts             # Fetch auction state from chain
│   │   │   ├── useAuctionRoom.ts         # WebSocket subscription to ER state
│   │   │   ├── usePlaceBid.ts            # Build + send bid tx via Magic Router
│   │   │   ├── useDeposit.ts             # Deposit SOL to vault
│   │   │   ├── useCreateAuction.ts       # Create auction tx
│   │   │   ├── useSettleAuction.ts       # Settlement tx
│   │   │   ├── useTapestry.ts            # Tapestry API (profiles, follows, content)
│   │   │   └── useBadges.ts              # Bubblegum cNFT minting
│   │   ├── lib/
│   │   │   ├── program.ts                # Anchor program + IDL setup
│   │   │   ├── magic-router.ts           # MagicBlock connection + WebSocket
│   │   │   ├── tapestry.ts               # Tapestry REST API client
│   │   │   ├── badges.ts                 # Umi + Bubblegum setup
│   │   │   └── constants.ts              # Program ID, endpoints, seeds
│   │   └── providers/
│   │       └── Providers.tsx             # Wallet + connection + query providers
│   ├── public/
│   │   └── ...                           # Logo, favicon, OG images
│   ├── package.json
│   ├── tailwind.config.ts
│   ├── next.config.ts
│   └── tsconfig.json
├── tests/
│   └── outcry.ts                         # Anchor integration tests
├── migrations/
│   └── deploy.ts
├── Anchor.toml
├── Cargo.toml
├── package.json
└── tsconfig.json
```

---

## Tech Stack & Dependencies

### Rust (Program)

```toml
[dependencies]
anchor-lang = "0.32.1"
anchor-spl = "0.32.1"                    # SPL Token + Associated Token
ephemeral-rollups-sdk = "0.3"            # MagicBlock delegation macros
mpl-token-metadata = "5.0"              # Read NFT metadata for royalties (stretch: pNFT CPI)
```

### JavaScript/TypeScript (Frontend + Tests)

```json
{
  "dependencies": {
    // Solana core
    "@coral-xyz/anchor": "^0.32.1",
    "@solana/web3.js": "^1.98",
    "@solana/wallet-adapter-base": "^0.9",
    "@solana/wallet-adapter-react": "^0.15",
    "@solana/wallet-adapter-react-ui": "^0.9",
    "@solana/wallet-adapter-wallets": "^0.19",
    "@solana/spl-token": "^0.4",

    // MagicBlock
    "@magicblock-labs/ephemeral-rollups-sdk": "latest",

    // Tapestry
    "socialfi": "latest",

    // Metaplex (badges)
    "@metaplex-foundation/umi": "latest",
    "@metaplex-foundation/umi-bundle-defaults": "latest",
    "@metaplex-foundation/mpl-bubblegum": "latest",

    // Frontend
    "next": "^15",
    "react": "^19",
    "react-dom": "^19",
    "tailwindcss": "^4",
    "@tanstack/react-query": "^5",

    // Utilities
    "bn.js": "^5"
  }
}
```

### External Services

| Service | Endpoint | Auth | Purpose |
|---------|----------|------|---------|
| Solana Devnet | `https://api.devnet.solana.com` | None | L1 transactions |
| MagicBlock Router | `https://devnet-router.magicblock.app` | None | ER transaction routing |
| MagicBlock WS | `wss://devnet-router.magicblock.app` | None | Real-time state subscriptions |
| Tapestry API | `https://api.usetapestry.dev/v1/` | API Key (query param) | Social graph |
| Delegation Program | `DELeGGvXpWV2fqJUhqcF5ZSYMS4JTLjteaAMARRSaeSh` | N/A | Account delegation |

---

## Build Phases

### Phase 0: Scaffolding (Day 1 — Feb 15)

**Goal:** Project compiles, frontend loads, wallet connects.

- [ ] Initialize Anchor workspace: `anchor init outcry`
- [ ] Configure Anchor.toml for devnet
- [ ] Set up program directory structure (state/, instructions/, errors.rs, constants.rs)
- [ ] Define all account structs and enums in `state/auction.rs`
- [ ] Define error codes in `errors.rs`
- [ ] Define constants (seeds, max bidders, default extension) in `constants.rs`
- [ ] Scaffold all instruction files with placeholder functions
- [ ] Wire up `lib.rs` with all instruction handlers
- [ ] Verify `anchor build` compiles
- [ ] Initialize Next.js app inside `app/` directory
- [ ] Install frontend dependencies
- [ ] Set up Tailwind with dark theme config
- [ ] Set up wallet adapter provider
- [ ] Create basic layout (Header with logo + wallet button)
- [ ] Create placeholder pages (home, auction room, create, profile)
- [ ] Verify `npm run dev` loads with wallet connection working

**Deliverable:** Compiling Anchor program (empty instructions) + Next.js shell with wallet connection.

### Phase 1: Core Auction Program — L1 Only (Days 2–4 — Feb 16–18)

**Goal:** Complete auction lifecycle works on Solana L1 (no ER yet).

**Day 2 — create_auction + deposit + cancel**
- [ ] Implement `create_auction`: init PDAs, escrow NFT via SPL token transfer
- [ ] Implement `deposit`: transfer SOL to vault, update deposits vec
- [ ] Implement `cancel_auction`: return NFT + deposits, set Cancelled
- [ ] Write tests: create auction, deposit, cancel with refund
- [ ] Test with a real SPL token mint on localnet

**Day 3 — place_bid + end_auction (L1 versions)**
- [ ] Implement `place_bid` (L1 version first, ER macros added later):
  - Validate bid > current + increment, bid ≤ deposit
  - Update current_bid, highest_bidder, bid_count
  - Anti-snipe: extend end_time if bid within window
- [ ] Implement `end_auction` (L1 version): validate timer, set Ended
- [ ] Write tests: full bid sequence, anti-snipe extension, outbid scenarios
- [ ] Test edge cases: bid exactly at reserve, bid at extension boundary

**Day 4 — settle_auction + claim_refund + royalties**
- [ ] Implement `settle_auction`:
  - Transfer NFT from escrow to winner
  - Read royalty info from Metaplex metadata account
  - Calculate and distribute royalties to creators
  - Transfer remainder to seller
  - Set Settled
- [ ] Implement `claim_refund`: return deposits to non-winners
- [ ] Write tests: full lifecycle (create → deposit → bid → end → settle → refund)
- [ ] Test royalty distribution with mock metadata
- [ ] Test: auction with no bids → cancel path
- [ ] Run `anchor test` — all tests pass
- [ ] Deploy to devnet: `anchor deploy`

**Deliverable:** Fully working auction program on L1 devnet. Can create auction, deposit, bid, settle, refund — all tested.

### Phase 2: MagicBlock Ephemeral Rollup Integration (Days 5–6 — Feb 19–20)

**Goal:** Auction bidding runs on ER at sub-50ms.

**Day 5 — Program-side ER integration**
- [ ] Add `ephemeral-rollups-sdk` to Cargo.toml
- [ ] Add `#[ephemeral]` attribute to program macro
- [ ] Add `#[delegate]` to `start_auction` accounts struct (AuctionState field)
- [ ] Implement delegation logic in `start_auction`:
  - Call `delegate_account()` from the SDK
  - Pass delegation program + required accounts
- [ ] Modify `end_auction` to use `commit_and_undelegate`:
  - Call `commit_and_undelegate_accounts()` from the SDK
- [ ] Add `#[commit]` attribute where needed
- [ ] Verify `anchor build` still compiles with ER SDK
- [ ] Study MagicBlock devnet deployment requirements
- [ ] Deploy updated program to devnet

**Day 6 — Frontend ER integration**
- [ ] Install `@magicblock-labs/ephemeral-rollups-sdk` in frontend
- [ ] Set up `MagicBlockEngine` / connection to Magic Router in `lib/magic-router.ts`
- [ ] Implement WebSocket subscription to AuctionState account on ER
- [ ] Update `usePlaceBid` hook to route bids through Magic Router
- [ ] Test full ER flow on devnet:
  1. Create auction on L1
  2. Deposit on L1
  3. Start auction (delegates to ER)
  4. Place bids on ER (verify sub-50ms)
  5. End auction (commits back to L1)
  6. Settle on L1
- [ ] Debug any ER-specific issues (account delegation, routing)
- [ ] Document the ER flow for demo narration

**Deliverable:** Bids process at sub-50ms on Ephemeral Rollup. Full delegation → bid → commit → settle lifecycle works on devnet.

### Phase 3: Frontend — Auction Room (Days 7–9 — Feb 21–23)

**Goal:** Beautiful, functional auction room UI that feels like a premium live auction.

**Day 7 — Discovery + Create Auction pages**
- [ ] Home page: grid of auction cards (active, upcoming, recently settled)
- [ ] AuctionCard component: artwork thumbnail, title, current bid, time remaining, bid count
- [ ] Create Auction page:
  - Select NFT from wallet (fetch token accounts, display metadata)
  - Set reserve price, duration, start time
  - Preview before confirming
  - Transaction flow: create_auction
- [ ] Fetch and display auction list from chain (getProgramAccounts with filters)
- [ ] Basic responsive layout

**Day 8 — Auction Room (core)**
- [ ] ArtworkDisplay: full-bleed NFT image/video with metadata
- [ ] CountdownTimer: calm white → warning amber → urgent red with pulse
- [ ] BidPanel: current price display, bid input with suggested increment, bid button
- [ ] BidHistory: scrolling feed of bids (bidder address truncated, amount, timestamp)
- [ ] Deposit flow: if user hasn't deposited, show deposit UI before bid
- [ ] Real-time updates: WebSocket subscription updates all components live
- [ ] Auction status states: pre-auction (deposit phase), live (bidding), ended, settled
- [ ] Outbid notification: visual alert when user is outbid

**Day 9 — Auction Room (polish) + Settlement UI**
- [ ] Anti-snipe timer extension: visual indicator when timer extends
- [ ] Bid confirmation: brief success animation on bid placement
- [ ] Settlement UI: "Auction ended" → settle button (permissionless) → results display
- [ ] Winner celebration state
- [ ] Claim refund UI for losing bidders
- [ ] Mobile responsive pass on auction room
- [ ] Loading states, error states, empty states
- [ ] Test full flow end-to-end in browser on devnet

**Deliverable:** Complete auction UI — from creation through live bidding to settlement. Looks premium. Works on mobile.

### Phase 4: Tapestry Social Integration (Day 10 — Feb 24)

**Goal:** Social profiles, follows, and auction content in the experience.

- [ ] Set up Tapestry API client in `lib/tapestry.ts` (REST calls with API key)
- [ ] `useTapestry` hook: fetch/create profile, follow/unfollow, post content
- [ ] Profile display in auction room: show Tapestry profile (name, avatar, followers) for bidders
- [ ] ProfileCard component: avatar, display name, follower count, auction stats
- [ ] FollowButton: follow artists directly from auction room
- [ ] Post auction results to Tapestry as content when auction settles:
  - "🔨 [artwork name] sold for X SOL to [winner] — Y bids in Z minutes"
- [ ] Profile page (`/profile/[address]`):
  - Tapestry profile info
  - Auctions created (as seller)
  - Auctions won (as buyer)
  - Auction badges (cNFTs)
- [ ] Social feed on home page: recent auction results from Tapestry
- [ ] "Watching" indicator: show other connected wallets in the auction room via Tapestry presence

**Deliverable:** Tapestry profiles visible throughout. Follow artists. Auction results posted to social graph. Profile pages show history.

### Phase 5: Compressed NFT Badges + Polish (Day 11 — Feb 25)

**Goal:** Badge system works. Everything is polished for demo.

**Badge System:**
- [ ] Set up Umi + Bubblegum in `lib/badges.ts`
- [ ] Create Merkle tree on devnet (depth 14 = 16,384 cNFTs)
- [ ] Define badge metadata:
  - "Present" — participated in auction
  - "Contender" — placed at least one bid
  - "Victor" — won the auction
- [ ] Mint badges client-side after auction settlement
- [ ] Display badges on profile page
- [ ] `useBadges` hook: mint badge, fetch user's badges

**Polish:**
- [ ] Typography pass: serif for titles, sans-serif for data
- [ ] Color system: jet black bg, warm gold accents (#D4A853), white text
- [ ] Transitions and animations: bid flash, timer pulse, page transitions
- [ ] Error handling: wallet disconnected, transaction failed, network issues
- [ ] Loading skeletons for auction cards and room
- [ ] Favicon, OG image, page titles
- [ ] Final responsive check (desktop, tablet, phone)

**Deliverable:** Badges mint and display. UI is polished and demo-ready.

### Phase 6: Demo & Submission (Day 12 — Feb 26)

**Goal:** Compelling demo video. Clean submission.

- [ ] Seed devnet with 2-3 demo auctions (different states: upcoming, live, settled)
- [ ] Create demo NFTs with real artwork and metadata
- [ ] Script the demo video (3 minutes max):
  1. Open OUTCRY — show discover page with active auctions (15s)
  2. Enter a live auction room — show the experience (30s)
  3. Place bids — show sub-50ms confirmation (30s)
  4. Show anti-snipe extension in action (15s)
  5. Show Tapestry social profile + follow (15s)
  6. Settle auction — show NFT transfer + royalties (20s)
  7. Show badges minted after settlement (15s)
  8. Show profile page with history + badges (10s)
  9. Quick architecture overview slide (15s)
  10. Closing: tagline + tech stack (15s)
- [ ] Record demo video (screen recording + voiceover)
- [ ] Deploy frontend to Vercel
- [ ] Write submission description
- [ ] Submit to hackathon

**Deliverable:** Submitted to hackathon with video, deployed frontend, and devnet program.

---

## Testing Strategy

### Program Tests (Anchor)

Run with `anchor test` against localnet.

```
Test Suite:
  ✓ Creates an auction with correct state
  ✓ Escrows NFT to program PDA
  ✓ Accepts deposits from multiple bidders
  ✓ Rejects deposit when auction is not Created
  ✓ Rejects deposit exceeding MAX_BIDDERS
  ✓ Processes bids correctly (updates current_bid, highest_bidder)
  ✓ Rejects bid below reserve price
  ✓ Rejects bid below current + min_increment
  ✓ Rejects bid exceeding deposit amount
  ✓ Extends timer on bid within anti-snipe window
  ✓ Does NOT extend timer on bid outside anti-snipe window
  ✓ Ends auction when timer expires
  ✓ Rejects end_auction when timer not expired
  ✓ Settles auction: NFT to winner, SOL to seller
  ✓ Distributes royalties correctly
  ✓ Returns deposits to losing bidders
  ✓ Cancels auction: returns NFT + all deposits
  ✓ Rejects cancel when auction is Live
  ✓ Full lifecycle: create → deposit → bid → end → settle → refund
```

### ER Integration Tests (Devnet)

Manual + scripted tests on devnet with MagicBlock ER:

```
  ✓ AuctionState delegates to ER successfully
  ✓ Bids process on ER at sub-50ms
  ✓ Multiple rapid bids process correctly
  ✓ Anti-snipe works on ER
  ✓ end_auction commits state back to L1
  ✓ Committed state matches ER state
  ✓ settle_auction works with committed state
```

### Frontend Tests

Manual testing checklist for each page/flow. No automated frontend tests for hackathon (time trade-off).

---

## Key Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| MagicBlock ER devnet instability | Bids don't process | L1 fallback: program works without ER (just slower). Demo can show ER if it's up. |
| Tapestry API downtime | No social features | Cache profiles client-side. Social is additive, not blocking. |
| ER delegation account size limits | Can't delegate AuctionState | Keep deposits vec small (max 20). If needed, split into separate account. |
| NFT metadata read for royalties | Settlement fails | Test with known metadata format. Fallback: skip royalties in settle, handle manually. |
| Time pressure on Day 11-12 | Unpolished demo | Phase 5 (badges + polish) has clear cut lines. Badges can be cut; polish can be minimal. |
| Clock divergence between ER and L1 | Timer issues | Use relative durations, not absolute timestamps for ER validation. |

---

## Bounty-Specific Checklist

### MagicBlock ($5K — "Best Consumer App using Ephemeral Rollups")
- [ ] Ephemeral Rollups power the core auction bidding experience
- [ ] Sub-50ms bid processing demonstrated in demo
- [ ] Delegation → bidding → commit → undelegate lifecycle
- [ ] Uses `ephemeral-rollups-sdk` Rust crate
- [ ] Uses Magic Router for automatic transaction routing
- [ ] Non-gaming use case (auctions) — shows ER versatility beyond games
- [ ] Clear before/after: L1 auction (400ms) vs ER auction (50ms)

### Exchange Art ($5K — "Artwork / Royalty Protection")
- [ ] Reads and enforces `seller_fee_basis_points` from NFT metadata
- [ ] Distributes royalties to verified creators during settlement
- [ ] Artist-first positioning: zero listing fees, guaranteed royalties
- [ ] (Stretch) pNFT support via Token Metadata CPI + Token Auth Rules

### Tapestry ($5K — "Best use of Tapestry Protocol")
- [ ] User profiles created/fetched via Tapestry API
- [ ] Follow system: follow artists and collectors
- [ ] Auction results posted as Tapestry content
- [ ] Social discovery: see who's bidding, who's in the room
- [ ] Profile page shows auction history + social stats
- [ ] Uses `socialfi` NPM package

### DRiP ($2.5K — "Compressed NFTs")
- [ ] Merkle tree created via Bubblegum
- [ ] Compressed NFT badges minted to auction participants
- [ ] Multiple badge types (Present, Contender, Victor)
- [ ] Badges displayed on user profiles
- [ ] Near-zero cost at scale (16K+ per tree)

---

## Demo Script — 3 Minutes

**[0:00–0:15] Hook**
"Every day, thousands of NFTs sit in marketplace listings, waiting. No excitement. No competition. No crowd. OUTCRY changes that. This is the first live auction house on Solana — where every bid confirms in under 50 milliseconds."

**[0:15–0:45] The Auction Room**
Show a live English auction in progress. The artwork displayed beautifully. The countdown timer ticking. Bids appearing in real-time. Tapestry profiles visible for each bidder. "This is what a Solana auction should feel like."

**[0:45–1:15] Place a Bid**
Connect wallet. Deposit SOL. Place a bid. Show the sub-50ms confirmation. Get outbid. Counter-bid. Show the anti-snipe timer extension. "Every bid is a Solana transaction, processed on MagicBlock's Ephemeral Rollup. No gas fees. No delays. Just pure competitive bidding."

**[1:15–1:45] Settlement**
Timer hits zero. Show the settlement: NFT transfers to winner, SOL goes to seller, royalties auto-distribute to the artist. "Settlement is atomic. The artist gets paid — including royalties, guaranteed by the protocol, not by policy."

**[1:45–2:15] Social Layer + Badges**
Show Tapestry profile with auction history. Show the follow button. Show badges minted after the auction — Present, Contender, Victor. "Every auction is a social event. Your participation is recorded on-chain as compressed NFTs via Bubblegum. Your reputation grows with every auction."

**[2:15–2:45] Architecture Quick Hit**
Brief diagram: "Auction state lives on an Ephemeral Rollup for speed. SOL stays on Solana L1 for security. Settlement commits everything back to the base layer. Built with Anchor, MagicBlock, Tapestry, and Metaplex."

**[2:45–3:00] Close**
"OUTCRY. Going, going, onchain. Built for the Solana Graveyard Hackathon — because the thing that's been dead in crypto auctions... is the auction itself."

---

## Quick Reference

| Item | Value |
|------|-------|
| Anchor version | 0.32.1 |
| Solana CLI | 2.0.0 |
| Rust | 1.93.0 |
| Node.js | v25.2.1 |
| Cluster | Devnet |
| MagicBlock Router | `https://devnet-router.magicblock.app` |
| MagicBlock WS | `wss://devnet-router.magicblock.app` |
| Delegation Program | `DELeGGvXpWV2fqJUhqcF5ZSYMS4JTLjteaAMARRSaeSh` |
| Tapestry API | `https://api.usetapestry.dev/v1/` |
| Tapestry Auth | API key as `?apiKey=` query param |
| Bubblegum Program | `BGUMAp9Gq7iTEuizy4pqaxsTyUCBK68MDfK752saRPUY` |
| Metaplex Token Metadata | `metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s` |
