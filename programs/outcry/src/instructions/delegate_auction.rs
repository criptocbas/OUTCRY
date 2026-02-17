use anchor_lang::prelude::*;
use ephemeral_rollups_sdk::anchor::delegate;
use ephemeral_rollups_sdk::cpi::DelegateConfig;

use crate::constants::*;

/// Delegates the AuctionState PDA to the MagicBlock Ephemeral Rollup.
/// Called after start_auction. Sends to base layer (L1).
///
/// After delegation, place_bid instructions are sent to the ER endpoint
/// for sub-50ms processing. The AuctionVault (SOL) stays on L1.
#[delegate]
#[derive(Accounts)]
#[instruction(nft_mint: Pubkey)]
pub struct DelegateAuction<'info> {
    #[account(mut)]
    pub seller: Signer<'info>,

    /// CHECK: The AuctionState PDA to delegate. Validated by seeds.
    #[account(
        mut,
        del,
        seeds = [AUCTION_SEED, seller.key().as_ref(), nft_mint.as_ref()],
        bump,
    )]
    pub auction_state: AccountInfo<'info>,
}

pub fn handle_delegate_auction(ctx: Context<DelegateAuction>, nft_mint: Pubkey) -> Result<()> {
    ctx.accounts.delegate_auction_state(
        &ctx.accounts.seller,
        &[
            AUCTION_SEED,
            ctx.accounts.seller.key.as_ref(),
            nft_mint.as_ref(),
        ],
        DelegateConfig::default(),
    )?;

    Ok(())
}
