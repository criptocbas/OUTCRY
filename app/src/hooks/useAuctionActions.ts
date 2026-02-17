"use client";

import { useCallback, useMemo } from "react";
import {
  useConnection,
  useAnchorWallet,
  useWallet,
} from "@solana/wallet-adapter-react";
import { PublicKey, SystemProgram } from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddress,
} from "@solana/spl-token";
import BN from "bn.js";
import { getProgram, getAuctionPDA, getVaultPDA } from "@/lib/program";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CreateAuctionParams {
  nftMint: PublicKey;
  reservePrice: BN;
  durationSeconds: BN;
  extensionSeconds: number;
  extensionWindow: number;
  minBidIncrement: BN;
}

export interface UseAuctionActionsReturn {
  /** Create a new auction. Wallet signer is the seller. */
  createAuction: (params: CreateAuctionParams) => Promise<string>;

  /** Deposit SOL into the auction vault as a bidder. */
  deposit: (auctionStatePubkey: PublicKey, amount: BN) => Promise<string>;

  /** Start an auction (seller only). Sets status to Active. */
  startAuction: (auctionStatePubkey: PublicKey, nftMint: PublicKey) => Promise<string>;

  /** Place a bid on an active (possibly ER-delegated) auction. */
  placeBid: (auctionStatePubkey: PublicKey, amount: BN) => Promise<string>;

  /** End an auction (permissionless crank). */
  endAuction: (auctionStatePubkey: PublicKey) => Promise<string>;

  /** Settle an ended auction — transfer NFT + distribute SOL. */
  settleAuction: (
    auctionStatePubkey: PublicKey,
    nftMint: PublicKey,
    seller: PublicKey,
    winner: PublicKey
  ) => Promise<string>;

  /** Claim a refund of deposited SOL (losers, after settlement/cancellation). */
  claimRefund: (auctionStatePubkey: PublicKey) => Promise<string>;

  /** True when the wallet is connected and actions are available. */
  ready: boolean;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useAuctionActions(): UseAuctionActionsReturn {
  const { connection } = useConnection();
  const wallet = useAnchorWallet();
  const { publicKey } = useWallet();

  const program = useMemo(() => {
    if (!wallet) return null;
    return getProgram(connection, wallet);
  }, [connection, wallet]);

  // -----------------------------------------------------------------------
  // createAuction
  // -----------------------------------------------------------------------
  const createAuction = useCallback(
    async (params: CreateAuctionParams): Promise<string> => {
      if (!program || !publicKey) {
        throw new Error("Wallet not connected");
      }

      const {
        nftMint,
        reservePrice,
        durationSeconds,
        extensionSeconds,
        extensionWindow,
        minBidIncrement,
      } = params;

      const [auctionState] = getAuctionPDA(publicKey, nftMint);
      const [auctionVault] = getVaultPDA(auctionState);

      const sellerNftTokenAccount = await getAssociatedTokenAddress(
        nftMint,
        publicKey
      );

      const escrowNftTokenAccount = await getAssociatedTokenAddress(
        nftMint,
        auctionState,
        true // allowOwnerOffCurve — PDA owner
      );

      const sig = await program.methods
        .createAuction(
          reservePrice,
          durationSeconds,
          extensionSeconds,
          extensionWindow,
          minBidIncrement
        )
        .accounts({
          seller: publicKey,
          nftMint,
          sellerNftTokenAccount,
          escrowNftTokenAccount,
          auctionState,
          auctionVault,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      return sig;
    },
    [program, publicKey]
  );

  // -----------------------------------------------------------------------
  // deposit
  // -----------------------------------------------------------------------
  const deposit = useCallback(
    async (auctionStatePubkey: PublicKey, amount: BN): Promise<string> => {
      if (!program || !publicKey) {
        throw new Error("Wallet not connected");
      }

      const [auctionVault] = getVaultPDA(auctionStatePubkey);

      const sig = await program.methods
        .deposit(amount)
        .accounts({
          bidder: publicKey,
          auctionState: auctionStatePubkey,
          auctionVault,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      return sig;
    },
    [program, publicKey]
  );

  // -----------------------------------------------------------------------
  // startAuction
  // -----------------------------------------------------------------------
  const startAuction = useCallback(
    async (auctionStatePubkey: PublicKey, nftMint: PublicKey): Promise<string> => {
      if (!program || !publicKey) {
        throw new Error("Wallet not connected");
      }

      // The IDL derives the PDA from seller + auction_state.nft_mint, but we
      // still pass the explicit auctionState address so Anchor can verify.
      const sig = await program.methods
        .startAuction()
        .accounts({
          seller: publicKey,
          auctionState: auctionStatePubkey,
        })
        .rpc();

      return sig;
    },
    [program, publicKey]
  );

  // -----------------------------------------------------------------------
  // placeBid
  // -----------------------------------------------------------------------
  const placeBid = useCallback(
    async (auctionStatePubkey: PublicKey, amount: BN): Promise<string> => {
      if (!program || !publicKey) {
        throw new Error("Wallet not connected");
      }

      const sig = await program.methods
        .placeBid(amount)
        .accounts({
          bidder: publicKey,
          auctionState: auctionStatePubkey,
        })
        .rpc();

      return sig;
    },
    [program, publicKey]
  );

  // -----------------------------------------------------------------------
  // endAuction
  // -----------------------------------------------------------------------
  const endAuction = useCallback(
    async (auctionStatePubkey: PublicKey): Promise<string> => {
      if (!program || !publicKey) {
        throw new Error("Wallet not connected");
      }

      const sig = await program.methods
        .endAuction()
        .accounts({
          authority: publicKey,
          auctionState: auctionStatePubkey,
        })
        .rpc();

      return sig;
    },
    [program, publicKey]
  );

  // -----------------------------------------------------------------------
  // settleAuction
  // -----------------------------------------------------------------------
  const settleAuction = useCallback(
    async (
      auctionStatePubkey: PublicKey,
      nftMint: PublicKey,
      seller: PublicKey,
      winner: PublicKey
    ): Promise<string> => {
      if (!program || !publicKey) {
        throw new Error("Wallet not connected");
      }

      const [auctionVault] = getVaultPDA(auctionStatePubkey);

      const escrowNftTokenAccount = await getAssociatedTokenAddress(
        nftMint,
        auctionStatePubkey,
        true // allowOwnerOffCurve — PDA owner
      );

      const winnerNftTokenAccount = await getAssociatedTokenAddress(
        nftMint,
        winner
      );

      const sig = await program.methods
        .settleAuction()
        .accounts({
          payer: publicKey,
          auctionState: auctionStatePubkey,
          auctionVault,
          seller,
          winner,
          nftMint,
          escrowNftTokenAccount,
          winnerNftTokenAccount,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      return sig;
    },
    [program, publicKey]
  );

  // -----------------------------------------------------------------------
  // claimRefund
  // -----------------------------------------------------------------------
  const claimRefund = useCallback(
    async (auctionStatePubkey: PublicKey): Promise<string> => {
      if (!program || !publicKey) {
        throw new Error("Wallet not connected");
      }

      const [auctionVault] = getVaultPDA(auctionStatePubkey);

      const sig = await program.methods
        .claimRefund()
        .accounts({
          bidder: publicKey,
          auctionState: auctionStatePubkey,
          auctionVault,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      return sig;
    },
    [program, publicKey]
  );

  return {
    createAuction,
    deposit,
    startAuction,
    placeBid,
    endAuction,
    settleAuction,
    claimRefund,
    ready: !!program && !!publicKey,
  };
}
