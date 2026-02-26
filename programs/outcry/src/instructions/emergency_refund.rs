use anchor_lang::prelude::*;

use crate::{
    constants::*,
    errors::OutcryError,
    events::RefundClaimed,
    state::{AuctionVault, BidderDeposit},
};

/// Emergency refund for when the auction state is stuck in ER delegation.
///
/// Normal `claim_refund` uses `Account<AuctionState>` which checks the owner,
/// but a delegated account is owned by the delegation program — causing
/// `AccountOwnedByWrongProgram`. This instruction uses `UncheckedAccount` and
/// verifies the delegation condition explicitly.
///
/// Safety:
/// - BidderDeposit PDA seeds include the auction key — cannot be faked.
/// - AuctionVault PDA seeds include the auction key — cannot target wrong vault.
/// - Only refunds what the BidderDeposit records (no over-withdrawal).
/// - Only works when auction_state is NOT owned by our program (delegation stuck).
///   For normal auctions, use `claim_refund` instead.
#[derive(Accounts)]
pub struct EmergencyRefund<'info> {
    #[account(mut)]
    pub bidder: Signer<'info>,

    /// The auction state account — may be owned by the delegation program
    /// when stuck. We use UncheckedAccount and verify manually.
    /// CHECK: Validated via PDA seeds of bidder_deposit and auction_vault.
    /// We also verify it is NOT owned by our program (emergency condition).
    pub auction_state: UncheckedAccount<'info>,

    #[account(
        mut,
        seeds = [DEPOSIT_SEED, auction_state.key().as_ref(), bidder.key().as_ref()],
        bump = bidder_deposit.bump,
        constraint = bidder_deposit.amount > 0 @ OutcryError::NothingToRefund,
        close = bidder,
    )]
    pub bidder_deposit: Account<'info, BidderDeposit>,

    #[account(
        mut,
        seeds = [VAULT_SEED, auction_state.key().as_ref()],
        bump = auction_vault.bump,
    )]
    pub auction_vault: Account<'info, AuctionVault>,

    pub system_program: Program<'info, System>,
}

pub fn handle_emergency_refund(ctx: Context<EmergencyRefund>) -> Result<()> {
    let auction_state_info = &ctx.accounts.auction_state;

    // CRITICAL: Only allow this when the auction state is stuck (not owned by our program).
    // If it's owned by our program, the normal `claim_refund` path should be used.
    require!(
        auction_state_info.owner != &crate::ID,
        OutcryError::InvalidAuctionStatus
    );

    let deposit = &mut ctx.accounts.bidder_deposit;
    let refund_amount = deposit.amount;
    let bidder_key = ctx.accounts.bidder.key();
    let auction_key = ctx.accounts.auction_state.key();

    // Zero out the deposit
    deposit.amount = 0;

    // Transfer SOL from vault to bidder
    let vault_info = ctx.accounts.auction_vault.to_account_info();
    let bidder_info = ctx.accounts.bidder.to_account_info();

    **vault_info.try_borrow_mut_lamports()? -= refund_amount;
    **bidder_info.try_borrow_mut_lamports()? += refund_amount;

    emit!(RefundClaimed {
        auction: auction_key,
        bidder: bidder_key,
        amount: refund_amount,
    });

    Ok(())
}
