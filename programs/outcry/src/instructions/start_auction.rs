use anchor_lang::prelude::*;

use crate::{
    constants::*,
    errors::OutcryError,
    events::AuctionStarted,
    state::{AuctionState, AuctionStatus},
};

#[derive(Accounts)]
pub struct StartAuction<'info> {
    pub seller: Signer<'info>,

    #[account(
        mut,
        seeds = [AUCTION_SEED, seller.key().as_ref(), auction_state.nft_mint.as_ref()],
        bump = auction_state.bump,
        has_one = seller @ OutcryError::UnauthorizedSeller,
        constraint = auction_state.status == AuctionStatus::Created @ OutcryError::InvalidAuctionStatus,
    )]
    pub auction_state: Account<'info, AuctionState>,
}

pub fn handle_start_auction(ctx: Context<StartAuction>) -> Result<()> {
    let clock = Clock::get()?;
    let auction = &mut ctx.accounts.auction_state;

    auction.start_time = clock.unix_timestamp;
    auction.end_time = clock
        .unix_timestamp
        .checked_add(auction.duration_seconds as i64)
        .ok_or(OutcryError::ArithmeticOverflow)?;
    auction.status = AuctionStatus::Active;

    emit!(AuctionStarted {
        auction: auction.key(),
        start_time: auction.start_time,
        end_time: auction.end_time,
    });

    Ok(())
}
