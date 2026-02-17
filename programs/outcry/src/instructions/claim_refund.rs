use anchor_lang::prelude::*;

use crate::{
    constants::*,
    errors::OutcryError,
    events::RefundClaimed,
    state::{AuctionState, AuctionStatus, AuctionVault},
};

#[derive(Accounts)]
pub struct ClaimRefund<'info> {
    #[account(mut)]
    pub bidder: Signer<'info>,

    #[account(
        mut,
        constraint = auction_state.status == AuctionStatus::Settled
            || auction_state.status == AuctionStatus::Cancelled
            @ OutcryError::RefundNotAvailable,
    )]
    pub auction_state: Account<'info, AuctionState>,

    #[account(
        mut,
        seeds = [VAULT_SEED, auction_state.key().as_ref()],
        bump = auction_vault.bump,
    )]
    pub auction_vault: Account<'info, AuctionVault>,

    pub system_program: Program<'info, System>,
}

pub fn handle_claim_refund(ctx: Context<ClaimRefund>) -> Result<()> {
    let auction = &mut ctx.accounts.auction_state;
    let bidder_key = ctx.accounts.bidder.key();

    let (idx, refund_amount) = auction
        .find_deposit(&bidder_key)
        .ok_or(OutcryError::NothingToRefund)?;
    require!(refund_amount > 0, OutcryError::NothingToRefund);

    // Zero out the deposit
    auction.deposits[idx].amount = 0;

    // Transfer SOL from vault to bidder
    let vault_info = ctx.accounts.auction_vault.to_account_info();
    let bidder_info = ctx.accounts.bidder.to_account_info();

    **vault_info.try_borrow_mut_lamports()? -= refund_amount;
    **bidder_info.try_borrow_mut_lamports()? += refund_amount;

    emit!(RefundClaimed {
        auction: ctx.accounts.auction_state.key(),
        bidder: bidder_key,
        amount: refund_amount,
    });

    Ok(())
}
