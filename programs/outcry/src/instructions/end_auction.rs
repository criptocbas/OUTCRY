use anchor_lang::prelude::*;

use crate::{
    errors::OutcryError,
    events::AuctionEnded,
    state::{AuctionState, AuctionStatus},
};

#[derive(Accounts)]
pub struct EndAuction<'info> {
    /// Anyone can crank this — permissionless
    pub authority: Signer<'info>,

    #[account(
        mut,
        constraint = auction_state.status == AuctionStatus::Active @ OutcryError::InvalidAuctionStatus,
    )]
    pub auction_state: Account<'info, AuctionState>,
}

pub fn handle_end_auction(ctx: Context<EndAuction>) -> Result<()> {
    let clock = Clock::get()?;
    let auction = &mut ctx.accounts.auction_state;

    require!(
        clock.unix_timestamp >= auction.end_time,
        OutcryError::AuctionStillActive
    );

    auction.status = AuctionStatus::Ended;

    emit!(AuctionEnded {
        auction: auction.key(),
        winner: auction.highest_bidder,
        winning_bid: auction.current_bid,
        total_bids: auction.bid_count,
    });

    Ok(())
}
