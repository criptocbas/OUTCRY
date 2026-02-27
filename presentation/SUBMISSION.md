OUTCRY is a real-time live auction protocol on Solana. Artists escrow NFTs, collectors bid in real-time, and every bid lands in under 50 milliseconds using MagicBlock Ephemeral Rollups.

The core idea is a "deposit-then-bid" architecture. Bidders deposit SOL into a vault that lives on L1 and never gets delegated to the rollup. Only the auction state (who's winning, current price, timer) moves to the ER for fast updates. At settlement, back on L1, the program verifies the winner actually has the funds before transferring anything. The rollup never touches money.

Everything was built during the hackathon: the Anchor program (17 instructions), the Next.js frontend, and all integrations.

**MagicBlock:** This is a non-gaming use of Ephemeral Rollups. The AuctionState account delegates to the ER for sub-50ms bidding. We handle the full lifecycle: delegation, real-time bids, end auction on ER, undelegate back to L1, settle. We also implemented session keys, where an ephemeral browser keypair is linked to your real wallet via a SessionToken PDA, so you can rapid-fire bids with zero wallet popups. We built custom blockhash handling because wallet adapters fetch L1 blockhashes that don't work on the ER.

**Exchange Art:** English auction with reserve prices, anti-sniping (bids in the last 5 minutes extend the timer), and anti-shill bidding enforced on-chain (seller can't bid on their own auction). Royalties are enforced at settlement by parsing the NFT's Metaplex metadata. The seller_fee_basis_points and verified creator splits are distributed before the seller gets paid. It's not optional, it's baked into the protocol.

**Tapestry:** Profiles, follows, likes, and comments are all wired up. Every auction has a comment thread. Settlement posts results to Tapestry. The API key is proxied through Next.js API routes so it's never exposed to the client.

**DRiP:** Compressed NFT badges minted via Bubblegum after settlement. Victor badge for the winner, Contender badge for every other bidder. Merkle tree with depth 14 (16K capacity), canopy depth 11. Badges show up on user profiles via Helius DAS API.

The program is deployed to devnet, the frontend is live on Vercel, and the full flow works end-to-end: create, deposit, go live, bid on ER, settle with royalties, claim refunds, mint badges.
