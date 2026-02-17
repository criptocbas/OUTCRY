use anchor_lang::prelude::*;
use anchor_lang::system_program;

use crate::{
    constants::*,
    errors::OutcryError,
    events::DepositMade,
    state::{AuctionState, AuctionStatus, AuctionVault, DepositEntry},
};

#[derive(Accounts)]
pub struct Deposit<'info> {
    #[account(mut)]
    pub bidder: Signer<'info>,

    #[account(
        mut,
        constraint = auction_state.status == AuctionStatus::Created
            @ OutcryError::InvalidAuctionStatus,
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

pub fn handle_deposit(ctx: Context<Deposit>, amount: u64) -> Result<()> {
    require!(amount > 0, OutcryError::InvalidDepositAmount);

    let auction = &mut ctx.accounts.auction_state;
    let bidder_key = ctx.accounts.bidder.key();

    // Find existing deposit or add new entry
    let total_deposit = if let Some((idx, existing)) = auction.find_deposit(&bidder_key) {
        let new_amount = existing
            .checked_add(amount)
            .ok_or(OutcryError::ArithmeticOverflow)?;
        auction.deposits[idx].amount = new_amount;
        new_amount
    } else {
        // New bidder — check capacity
        require!(auction.deposits.len() < MAX_BIDDERS, OutcryError::AuctionFull);
        auction.deposits.push(DepositEntry {
            bidder: bidder_key,
            amount,
        });
        amount
    };

    // Transfer SOL from bidder to vault
    system_program::transfer(
        CpiContext::new(
            ctx.accounts.system_program.to_account_info(),
            system_program::Transfer {
                from: ctx.accounts.bidder.to_account_info(),
                to: ctx.accounts.auction_vault.to_account_info(),
            },
        ),
        amount,
    )?;

    emit!(DepositMade {
        auction: ctx.accounts.auction_state.key(),
        bidder: bidder_key,
        amount,
        total_deposit,
    });

    Ok(())
}
