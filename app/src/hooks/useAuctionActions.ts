"use client";

import { useCallback, useMemo } from "react";
import {
  useAnchorWallet,
  useWallet,
} from "@solana/wallet-adapter-react";
import { Connection, PublicKey, SystemProgram } from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddress,
} from "@solana/spl-token";
import BN from "bn.js";
import { getProgram, getAuctionPDA, getVaultPDA } from "@/lib/program";
import { getMagicConnection } from "@/lib/magic-router";
import { PROGRAM_ID, DELEGATION_PROGRAM_ID, DEVNET_RPC } from "@/lib/constants";

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

  /** Delegate the AuctionState PDA to the Ephemeral Rollup (seller only). */
  delegateAuction: (auctionStatePubkey: PublicKey, nftMint: PublicKey) => Promise<string>;

  /** Place a bid on an active (possibly ER-delegated) auction. */
  placeBid: (auctionStatePubkey: PublicKey, amount: BN) => Promise<string>;

  /** End an auction (permissionless crank). */
  endAuction: (auctionStatePubkey: PublicKey) => Promise<string>;

  /** Undelegate the AuctionState back to L1 (after ending). */
  undelegateAuction: (auctionStatePubkey: PublicKey) => Promise<string>;

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
// PDA helpers for delegation accounts
// ---------------------------------------------------------------------------

function getDelegationBufferPDA(
  auctionState: PublicKey
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("buffer"), auctionState.toBuffer()],
    PROGRAM_ID
  );
}

function getDelegationRecordPDA(
  auctionState: PublicKey
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("delegation"), auctionState.toBuffer()],
    DELEGATION_PROGRAM_ID
  );
}

function getDelegationMetadataPDA(
  auctionState: PublicKey
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("delegation-metadata"), auctionState.toBuffer()],
    DELEGATION_PROGRAM_ID
  );
}

// Magic Program addresses (auto-added by #[commit] macro)
const MAGIC_PROGRAM_ID = new PublicKey("Magic11111111111111111111111111111111111111");
const MAGIC_CONTEXT_ID = new PublicKey("MagicContext1111111111111111111111111111111");

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useAuctionActions(): UseAuctionActionsReturn {
  const wallet = useAnchorWallet();
  const { publicKey } = useWallet();

  // Standard devnet connection for L1-only operations (create, deposit, start, settle, refund)
  const l1Connection = useMemo(
    () => new Connection(DEVNET_RPC, "confirmed"),
    []
  );

  // Magic Router for ER-routed operations (placeBid, endAuction, undelegateAuction)
  const magicConnection = useMemo(() => getMagicConnection(), []);

  // L1 program — used for transactions that only touch L1 accounts
  const l1Program = useMemo(() => {
    if (!wallet) return null;
    return getProgram(l1Connection, wallet);
  }, [l1Connection, wallet]);

  // ER program — used for transactions that may route to Ephemeral Rollup
  const erProgram = useMemo(() => {
    if (!wallet) return null;
    return getProgram(magicConnection, wallet);
  }, [magicConnection, wallet]);

  // -----------------------------------------------------------------------
  // createAuction (L1)
  // -----------------------------------------------------------------------
  const createAuction = useCallback(
    async (params: CreateAuctionParams): Promise<string> => {
      if (!l1Program || !publicKey) {
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

      const sig = await l1Program.methods
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
        .rpc({ skipPreflight: true });

      return sig;
    },
    [l1Program, publicKey]
  );

  // -----------------------------------------------------------------------
  // deposit (L1)
  // -----------------------------------------------------------------------
  const deposit = useCallback(
    async (auctionStatePubkey: PublicKey, amount: BN): Promise<string> => {
      if (!l1Program || !publicKey) {
        throw new Error("Wallet not connected");
      }

      const [auctionVault] = getVaultPDA(auctionStatePubkey);

      const sig = await l1Program.methods
        .deposit(amount)
        .accounts({
          bidder: publicKey,
          auctionState: auctionStatePubkey,
          auctionVault,
          systemProgram: SystemProgram.programId,
        })
        .rpc({ skipPreflight: true });

      return sig;
    },
    [l1Program, publicKey]
  );

  // -----------------------------------------------------------------------
  // startAuction (L1)
  // -----------------------------------------------------------------------
  const startAuction = useCallback(
    async (auctionStatePubkey: PublicKey, nftMint: PublicKey): Promise<string> => {
      if (!l1Program || !publicKey) {
        throw new Error("Wallet not connected");
      }

      const sig = await l1Program.methods
        .startAuction()
        .accounts({
          seller: publicKey,
          auctionState: auctionStatePubkey,
        })
        .rpc({ skipPreflight: true });

      return sig;
    },
    [l1Program, publicKey]
  );

  // -----------------------------------------------------------------------
  // delegateAuction (L1 → delegates AuctionState to ER)
  // -----------------------------------------------------------------------
  const delegateAuction = useCallback(
    async (auctionStatePubkey: PublicKey, nftMint: PublicKey): Promise<string> => {
      if (!l1Program || !publicKey) {
        throw new Error("Wallet not connected");
      }

      const [bufferPda] = getDelegationBufferPDA(auctionStatePubkey);
      const [delegationRecord] = getDelegationRecordPDA(auctionStatePubkey);
      const [delegationMetadata] = getDelegationMetadataPDA(auctionStatePubkey);

      const sig = await l1Program.methods
        .delegateAuction(nftMint)
        .accounts({
          seller: publicKey,
          auctionState: auctionStatePubkey,
          bufferAuctionState: bufferPda,
          delegationRecordAuctionState: delegationRecord,
          delegationMetadataAuctionState: delegationMetadata,
          ownerProgram: PROGRAM_ID,
          delegationProgram: DELEGATION_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .rpc({ skipPreflight: true });

      return sig;
    },
    [l1Program, publicKey]
  );

  // -----------------------------------------------------------------------
  // placeBid (auto-routed to ER if delegated)
  // -----------------------------------------------------------------------
  const placeBid = useCallback(
    async (auctionStatePubkey: PublicKey, amount: BN): Promise<string> => {
      if (!erProgram || !publicKey) {
        throw new Error("Wallet not connected");
      }

      const sig = await erProgram.methods
        .placeBid(amount)
        .accounts({
          bidder: publicKey,
          auctionState: auctionStatePubkey,
        })
        .rpc({ skipPreflight: true });

      return sig;
    },
    [erProgram, publicKey]
  );

  // -----------------------------------------------------------------------
  // endAuction (auto-routed to ER if delegated)
  // -----------------------------------------------------------------------
  const endAuction = useCallback(
    async (auctionStatePubkey: PublicKey): Promise<string> => {
      if (!erProgram || !publicKey) {
        throw new Error("Wallet not connected");
      }

      const sig = await erProgram.methods
        .endAuction()
        .accounts({
          authority: publicKey,
          auctionState: auctionStatePubkey,
        })
        .rpc({ skipPreflight: true });

      return sig;
    },
    [erProgram, publicKey]
  );

  // -----------------------------------------------------------------------
  // undelegateAuction (sent to ER → commits state back to L1)
  // -----------------------------------------------------------------------
  const undelegateAuction = useCallback(
    async (auctionStatePubkey: PublicKey): Promise<string> => {
      if (!erProgram || !publicKey) {
        throw new Error("Wallet not connected");
      }

      const sig = await erProgram.methods
        .undelegateAuction()
        .accounts({
          payer: publicKey,
          auctionState: auctionStatePubkey,
          magicProgram: MAGIC_PROGRAM_ID,
          magicContext: MAGIC_CONTEXT_ID,
        })
        .rpc({ skipPreflight: true });

      return sig;
    },
    [erProgram, publicKey]
  );

  // -----------------------------------------------------------------------
  // settleAuction (L1, after undelegation)
  // -----------------------------------------------------------------------
  const settleAuction = useCallback(
    async (
      auctionStatePubkey: PublicKey,
      nftMint: PublicKey,
      seller: PublicKey,
      winner: PublicKey
    ): Promise<string> => {
      if (!l1Program || !publicKey) {
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

      const sig = await l1Program.methods
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
        .rpc({ skipPreflight: true });

      return sig;
    },
    [l1Program, publicKey]
  );

  // -----------------------------------------------------------------------
  // claimRefund (L1)
  // -----------------------------------------------------------------------
  const claimRefund = useCallback(
    async (auctionStatePubkey: PublicKey): Promise<string> => {
      if (!l1Program || !publicKey) {
        throw new Error("Wallet not connected");
      }

      const [auctionVault] = getVaultPDA(auctionStatePubkey);

      const sig = await l1Program.methods
        .claimRefund()
        .accounts({
          bidder: publicKey,
          auctionState: auctionStatePubkey,
          auctionVault,
          systemProgram: SystemProgram.programId,
        })
        .rpc({ skipPreflight: true });

      return sig;
    },
    [l1Program, publicKey]
  );

  return {
    createAuction,
    deposit,
    startAuction,
    delegateAuction,
    placeBid,
    endAuction,
    undelegateAuction,
    settleAuction,
    claimRefund,
    ready: !!l1Program && !!publicKey,
  };
}
