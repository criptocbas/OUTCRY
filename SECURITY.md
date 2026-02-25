# OUTCRY — Security Model

This document describes the threat model and security mechanisms built into the OUTCRY on-chain auction protocol.

## Deposit-Then-Bid Architecture (Shield Poker Pattern)

SOL never touches the Ephemeral Rollup. All value lives on Solana L1:

- **BidderDeposit PDAs** (`[b"deposit", auction, bidder]`) hold per-bidder SOL on L1
- **AuctionVault PDA** (`[b"vault", auction]`) aggregates deposits — never delegated
- **AuctionState PDA** (`[b"auction", seller, nft_mint]`) is the only account delegated to ER

If the ER crashes, restarts, or misbehaves, no funds are at risk — deposits and the NFT escrow remain safely on L1.

## Deferred Deposit Validation

`place_bid` on the ER does **not** verify deposits. This is by design:

1. Deposits happen on L1 (vault is never delegated)
2. Bids happen on ER (AuctionState is delegated)
3. Cross-layer reads are impossible during delegation

Validation is deferred to `settle_auction` on L1, which enforces:
```
winner_deposit.amount >= auction_state.current_bid
```

If the winner's deposit is insufficient, `forfeit_auction` returns the NFT to the seller and forfeits the winner's deposit as a penalty, then sets status to Settled so other bidders can claim refunds.

## Anti-Sniping

Bids placed within `extension_window` seconds of `end_time` trigger an automatic extension:

- `end_time += extension_seconds` (default: 300s / 5 min)
- Maximum extension capped at `2 × duration_seconds` to prevent infinite auctions

This prevents last-second sniping while keeping auctions finite.

## Anti-Shill Bidding

On-chain constraint in `place_bid`:
```rust
constraint = bidder.key() != auction_state.seller @ OutcryError::SellerCannotBid
```

The seller cannot bid on their own auction. Enforced at the program level — no frontend bypass possible.

## Forfeit Mechanism

When a winner's deposit is insufficient at settlement time:

1. `forfeit_auction` can be called by the seller
2. NFT is returned to seller (transferred from escrow back to seller's ATA)
3. Winner's entire deposit is forfeited as penalty (stays in vault, goes to seller)
4. Status set to `Settled` so losing bidders can claim refunds
5. Protocol fee (2.5%) is still collected on the forfeited deposit

This incentivizes bidders to deposit enough SOL before bidding.

## Protocol Fee Distribution

- **Rate:** 2.5% (250 basis points), hardcoded in `constants.rs`
- **Treasury:** Hardcoded pubkey in `constants.rs` — not an admin-mutable parameter
- **Collection point:** `settle_auction` and `forfeit_auction`
- **Calculation:** `(winning_bid * PROTOCOL_FEE_BPS) / 10_000`, with overflow checks

## Royalty Distribution

At settlement, `settle_auction` parses the Metaplex Token Metadata account to extract creator royalties:

1. Reads metadata PDA (`[b"metadata", token_metadata_program, nft_mint]`)
2. Parses creator array and `seller_fee_basis_points`
3. Distributes royalties proportionally to verified creators via `remaining_accounts`
4. Each creator's share: `(royalty_total * creator.share) / 100`

Creator accounts are passed as `remaining_accounts` and validated against the on-chain metadata.

## PDA Ownership and Delegation

| Account | Seeds | Delegated to ER? | Holds Value? |
|---------|-------|:-:|:-:|
| AuctionState | `[auction, seller, nft_mint]` | Yes | No |
| AuctionVault | `[vault, auction_state]` | No | Yes (SOL) |
| BidderDeposit | `[deposit, auction_state, bidder]` | No | No (tracks amount) |
| Escrow ATA | (associated token) | No | Yes (NFT) |

Only AuctionState delegates. All value-bearing accounts remain on L1 at all times.

## Access Control

| Instruction | Who Can Call | Status Required |
|-------------|-------------|-----------------|
| `create_auction` | Anyone (becomes seller) | — |
| `deposit` | Any bidder | Any (works during delegation) |
| `start_auction` | Seller only | Created |
| `delegate_auction` | Seller only | Active |
| `place_bid` | Any bidder (not seller) | Active |
| `end_auction` | Anyone | Active + timer expired |
| `undelegate_auction` | Anyone | Ended |
| `settle_auction` | Anyone | Ended (on L1) |
| `forfeit_auction` | Seller only | Ended + insufficient deposit |
| `claim_refund` | Bidder (own deposit) | Settled or Cancelled |
| `cancel_auction` | Seller only | Created + no bids |
| `close_auction` | Seller only | Settled/Cancelled + vault empty |
| `force_close_auction` | Seller only | Settled/Cancelled + 7-day grace |

## Force Close (Stuck Account Recovery)

If a bidder never claims their refund, the seller's AuctionState, AuctionVault, and escrow ATA accounts are locked indefinitely. `force_close_auction` provides an escape hatch:

- **Grace period:** 7 days after `end_time` (Settled) or `start_time` (Cancelled)
- **Effect:** Drains remaining vault lamports to seller, closes all accounts
- **Cancelled before start:** If `start_time == 0`, no grace period (no bids were possible)

This ensures sellers are never permanently locked out of their rent-exempt lamports.

## ER Fallback

The frontend detects when the Magic Router (ER endpoint) is unavailable and automatically falls back to L1:

- Bids confirm at ~400ms instead of sub-50ms
- No user action required — fallback is transparent
- Health check pings ER every 30 seconds; amber banner warns when degraded

## Known Limitations

1. **No session keys (MVP):** Each bid requires wallet approval. Session keys are a stretch goal.
2. **Standard NFTs only:** pNFT (Programmable NFTs with Token Auth Rules) enforcement is a stretch goal.
3. **Single auction per seller+mint:** PDA seeds `[auction, seller, nft_mint]` mean a seller can only have one auction per NFT at a time.
4. **No on-chain indexer:** Auction listing relies on `getProgramAccounts` which doesn't work through Magic Router — uses devnet RPC directly.
