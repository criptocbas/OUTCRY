use anchor_lang::prelude::*;

use crate::{
    constants::SESSION_SEED,
    state::SessionToken,
};

#[derive(Accounts)]
pub struct CreateSession<'info> {
    /// The real wallet authorizing this session.
    #[account(mut)]
    pub bidder: Signer<'info>,

    /// The auction this session is scoped to. Uses UncheckedAccount because the
    /// auction may be delegated to ER (owner changes to delegation program).
    /// Security: the session_token PDA is seeded with this key, so a fake
    /// address just creates a useless session that won't match any real auction.
    /// CHECK: Validated implicitly via session_token PDA seeds.
    pub auction_state: UncheckedAccount<'info>,

    /// Session token PDA linking ephemeral key → real wallet for this auction.
    /// init_if_needed: safe because PDA is unique per (bidder, auction), only
    /// the bidder can create it, and reinit just updates session_signer (needed
    /// after page refresh when a new ephemeral key is generated).
    #[account(
        init_if_needed,
        payer = bidder,
        space = 8 + SessionToken::INIT_SPACE,
        seeds = [SESSION_SEED, auction_state.key().as_ref(), bidder.key().as_ref()],
        bump,
    )]
    pub session_token: Account<'info, SessionToken>,

    pub system_program: Program<'info, System>,
}

pub fn handle_create_session(ctx: Context<CreateSession>, session_signer: Pubkey) -> Result<()> {
    let session = &mut ctx.accounts.session_token;

    session.auction = ctx.accounts.auction_state.key();
    session.bidder = ctx.accounts.bidder.key();
    session.session_signer = session_signer;
    session.created_at = Clock::get()?.unix_timestamp;
    session.bump = ctx.bumps.session_token;

    Ok(())
}
