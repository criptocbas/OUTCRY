# OUTCRY — 3-Minute Demo Script

## Before You Record

### Pre-Setup Checklist
- [ ] Two browser windows: **Seller wallet** (Window A) and **Bidder wallet** (Window B)
- [ ] Both wallets funded with devnet SOL (5+ SOL each)
- [ ] Bidder has a Tapestry profile created (username visible)
- [ ] Have an NFT minted and ready (mint address copied) — `npx ts-node --skip-project scripts/mint-test-nft.ts <WALLET>`
- [ ] Dev server running (`cd app && npm run dev`)
- [ ] Browser zoom: 100% or 110% (make text readable on video)
- [ ] Close other tabs/notifications — clean screen
- [ ] Screen resolution: 1920x1080 preferred
- [ ] OBS or Loom ready to record

### Pre-Created State (Recommended — Saves Time)
Pre-create an auction that's already Active and delegated to ER. Then you skip the create/start flow and jump straight to the bidding war (the exciting part). You can show creation in a quick cut if needed.

### Bounty Keywords to Hit

| Say This | Hits Bounty |
|---|---|
| "Real-time bids via Ephemeral Rollups" / "First non-gaming use of ER" | **MagicBlock** ($5K) |
| "Royalties enforced from Metaplex metadata at settlement" | **Exchange Art** ($5K) |
| "Tapestry-powered profiles, follows, likes, comments" | **Tapestry** ($5K) |
| "Compressed NFT badges via Bubblegum" | **DRiP** ($2.5K) |

---

## The Script

### INTRO — The Hook (0:00 – 0:20)

> **[Show homepage with auction cards]**
>
> "This is OUTCRY — a real-time live auction protocol on Solana.
>
> The problem with onchain auctions today is speed. Solana's 400-millisecond block times make competitive bidding feel sluggish. OUTCRY solves this with MagicBlock Ephemeral Rollups — bids confirm onchain in a fraction of a second.
>
> But speed alone isn't enough. We built a deposit-then-bid architecture where all SOL stays safely on L1 while only the auction state enters the rollup. The Ephemeral Rollup never touches money."

**Key visual:** Homepage with auction cards, status filters, the design language.

---

### ACT 1 — Create & Go Live (0:20 – 0:50)

> **[Window A — Seller: Click "Create Auction"]**
>
> "Creating an auction is straightforward. Paste your NFT's mint address — we validate it on-chain, show you the preview. Set your reserve price, duration, and bid increment."

**[Fill form quickly — have values ready: mint address, 1 SOL reserve, 10-minute duration, 0.1 SOL increment. Submit.]**

> "The NFT is now escrowed on-chain. One transaction."

**[Click into the new auction. Click "Go Live".]**

> "Go Live does three things in sequence: starts the auction timer, delegates the auction state to MagicBlock's Ephemeral Rollup, and syncs."

**Key visual:** The progress labels cycling ("Starting auction...", "Delegating to ER...", "Syncing..."), then the green "ER Live" badge appearing with its pulsing glow.

> "See that green badge? The auction state is now running on an Ephemeral Rollup. Real-time bidding is live."

---

### ACT 2 — The Bidding War (0:50 – 1:50) **[THE STAR OF THE SHOW]**

> **[Switch to Window B — Bidder]**
>
> "Now let's bid. First, I'll enable Quick Bidding — this is our session key system."

**[Click "Enable Quick Bidding", enter deposit amount (e.g., 3 SOL), approve the single wallet popup.]**

> "One wallet approval. That deposited SOL to the vault, funded an ephemeral signing key, and registered a session on-chain. From now on — zero popups."

**Key visual:** The "Quick Bidding Active" badge appears.

**[Place 3-4 rapid bids in succession. Click, click, click.]**

> "Watch the speed. Every bid — no wallet popup, no waiting."

**Key visuals to call out:**
- The golden bid flash animation on each new bid
- The green MagicBlock ER card showing live round-trip latency (e.g. "325ms")
- The countdown timer (mention anti-sniping if a bid lands near the end)
- The bid amount scaling animation

> "See that green card? That's the round-trip time — from my browser, through MagicBlock's Ephemeral Rollup, and back. An onchain bid confirmed in under half a second. And notice — the SOL I deposited never left L1. The Ephemeral Rollup only tracks who's winning and for how much. Settlement happens back on L1 with full deposit verification."

**[If you have time, switch back to Window A briefly to show the seller's view updating in real-time]**

---

### ACT 3 — Social Layer (1:50 – 2:15)

> **[Still in auction room — scroll to comments section]**
>
> "Every auction has a social layer powered by Tapestry. Bidders see each other's usernames — not just wallet addresses. You can comment on auctions, like them, follow other collectors."

**[Type a quick comment, hit send. Show it appear instantly.]**

**[Click on bidder's profile badge to navigate to their profile]**

> "Each user has a profile with their auction activity, followers, and earned badges."

**Key visual:** Profile page with username, social stats, badge grid.

---

### ACT 4 — Settlement & Badges (2:15 – 2:50)

> **[Back to Window A — Seller. Auction timer has ended (or end it manually).]**
>
> "Auction's over. Settlement is one click — and anyone can trigger it, it's permissionless."

**[Click "Settle Auction". Show the multi-step progress.]**

> "This ends the auction on the rollup, commits the final state back to L1, verifies the winner's deposit covers their bid, transfers the NFT to the winner, distributes SOL to the seller with royalties enforced on-chain, and mints compressed NFT badges via Bubblegum."

**Key visuals:**
- Progress steps cycling through
- Success toast with Explorer link
- Settlement breakdown showing royalty split, protocol fee, and seller proceeds
- "Settled" status badge (gold)

> "Two badge types: Contender for every bidder, Victor for the winner. Compressed NFTs via Bubblegum — permanent onchain proof of participation."

---

### CLOSE — The Vision (2:50 – 3:00)

> "OUTCRY brings MagicBlock Ephemeral Rollups beyond gaming — into real-time commerce. Instant bidding, deposits safe on L1, social identity, and onchain royalty enforcement.
>
> Going, going, onchain."

---

## Timing Cheat Sheet

| Section | Duration | Cumulative |
|---------|----------|------------|
| Hook (homepage, problem, solution) | 20s | 0:20 |
| Create auction + Go Live | 30s | 0:50 |
| Quick Bidding + bidding war | 60s | 1:50 |
| Social layer (comments, profile) | 25s | 2:15 |
| Settlement + badges | 35s | 2:50 |
| Closing line | 10s | 3:00 |

---

## Talking Points If Judges Ask Questions

### "How does the deposit-then-bid pattern work?"
> "Bidders deposit SOL into a vault on L1 before or during the auction. The vault is never delegated to the ER. When you bid on the ER, it only updates who's winning — no SOL moves. At settlement, back on L1, we verify the winner's deposit covers their bid before transferring anything. If they can't pay, the auction auto-forfeits: NFT returns to seller, deposit is slashed as penalty."

### "What happens if the Ephemeral Rollup goes down?"
> "We have multiple safety nets. The ER health check runs every 30 seconds — if it's unavailable, we show a warning and fall back to L1 bidding at normal Solana speed. If an auction gets stuck in delegation, we have an emergency refund instruction that lets bidders recover their deposits directly from L1 without needing the ER at all. And undelegation is permissionless — anyone can trigger it."

### "How are royalties enforced?"
> "At settlement, we parse the NFT's Metaplex metadata on-chain — read the seller_fee_basis_points and the verified creators list. Royalties are distributed proportionally to verified creators before the seller receives their proceeds. It's enforced at the protocol level, not optional."

### "What's the session key system?"
> "An ephemeral Keypair is generated in the browser. One wallet popup creates a SessionToken PDA on-chain linking the ephemeral key to your real wallet. After that, the ephemeral key signs ER transactions directly — no wallet popup needed. The on-chain session ensures the real wallet identity is preserved for settlement: highest_bidder is always your real wallet, not the ephemeral key."

### "Why not BOLT ECS?"
> "Auctions are state machines, not game entities. BOLT ECS is designed for composable game worlds with systems operating over entity components. An auction has a fixed lifecycle (Created → Active → Ended → Settled) with known state transitions. Standard Anchor gives us exactly the account structure and instruction validation we need without the abstraction overhead."

### "What if an auction ends with no bids?"
> "The protocol handles that gracefully. If the timer expires and nobody bid, the seller sees a 'Cancel Auction' button instead of 'Settle.' Cancel returns the escrowed NFT to the seller and sets the status to Cancelled. If the auction was delegated to the ER, the frontend automatically ends it on the rollup, undelegates back to L1, and then cancels — all in one click. No funds are at risk because there are no deposits to refund."

### "What about scalability?"
> "Each auction is an independent state machine with its own PDA. There's no shared global state — auctions don't contend with each other. The ER delegation is per-auction, so you could have hundreds of concurrent live auctions, each with their own Ephemeral Rollup session. Deposits are per-bidder-per-auction PDAs on L1, so they never bottleneck."

### "What's your roadmap?"
> "Integrated NFT minting so artists can upload and auction in one flow. Dutch and sealed-bid auction formats. pNFT royalty enforcement via Token Authorization Rules. And a crank service for automatic settlement so nobody has to click 'Settle' manually."

---

## Things to Avoid

- Don't fumble with wallet popups on camera — have everything pre-connected
- Don't show error states unless you're demonstrating error recovery
- Don't explain the code — show the product
- Don't rush the bidding section — that's your money shot
- Don't forget to mention MagicBlock by name (they're giving you $5K)
- Don't say "hackathon project" — say "protocol"
