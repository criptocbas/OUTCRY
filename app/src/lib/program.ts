import { AnchorProvider, Program } from "@coral-xyz/anchor";
import type { Idl } from "@coral-xyz/anchor";
import { Connection, PublicKey } from "@solana/web3.js";
import type { AnchorWallet } from "@solana/wallet-adapter-react";
import { PROGRAM_ID, AUCTION_SEED, VAULT_SEED, DEPOSIT_SEED, TOKEN_METADATA_PROGRAM_ID } from "./constants";
import idl from "./idl.json";

/**
 * Creates an Anchor Program instance for the Outcry auction program.
 *
 * @param connection - Solana RPC connection
 * @param wallet - Wallet adapter wallet (must implement AnchorWallet)
 * @returns Anchor Program instance typed to the Outcry IDL
 */
export function getProgram(
  connection: Connection,
  wallet: AnchorWallet
): Program {
  const provider = new AnchorProvider(connection, wallet, {
    commitment: "confirmed",
    preflightCommitment: "confirmed",
  });
  return new Program(idl as Idl, provider);
}

/**
 * Derives the AuctionState PDA.
 * Seeds: ["auction", seller_pubkey, nft_mint_pubkey]
 */
export function getAuctionPDA(
  seller: PublicKey,
  nftMint: PublicKey
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [AUCTION_SEED, seller.toBuffer(), nftMint.toBuffer()],
    PROGRAM_ID
  );
}

/**
 * Derives the AuctionVault PDA.
 * Seeds: ["vault", auction_state_pubkey]
 */
export function getVaultPDA(
  auctionState: PublicKey
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [VAULT_SEED, auctionState.toBuffer()],
    PROGRAM_ID
  );
}

/**
 * Derives the BidderDeposit PDA.
 * Seeds: ["deposit", auction_state_pubkey, bidder_pubkey]
 */
export function getDepositPDA(
  auctionState: PublicKey,
  bidder: PublicKey
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [DEPOSIT_SEED, auctionState.toBuffer(), bidder.toBuffer()],
    PROGRAM_ID
  );
}

/**
 * Derives the Metaplex Token Metadata PDA for an NFT mint.
 * Seeds: ["metadata", TOKEN_METADATA_PROGRAM_ID, nft_mint]
 */
export function getMetadataPDA(nftMint: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [
      Buffer.from("metadata"),
      TOKEN_METADATA_PROGRAM_ID.toBuffer(),
      nftMint.toBuffer(),
    ],
    TOKEN_METADATA_PROGRAM_ID
  );
}

/**
 * Creator info parsed from Metaplex metadata on-chain data.
 */
export interface MetaplexCreatorInfo {
  address: PublicKey;
  verified: boolean;
  share: number;
}

/**
 * Parse seller_fee_basis_points and creators from raw Metaplex metadata account data.
 * Returns null if the data cannot be parsed.
 */
export function parseMetadataCreators(
  data: Buffer | Uint8Array
): { sellerFeeBps: number; creators: MetaplexCreatorInfo[] } | null {
  try {
    let offset = 65; // key(1) + update_authority(32) + mint(32)

    // Skip 3 Borsh strings: name, symbol, uri
    for (let i = 0; i < 3; i++) {
      if (offset + 4 > data.length) return null;
      const len = data[offset] | (data[offset + 1] << 8) | (data[offset + 2] << 16) | (data[offset + 3] << 24);
      offset += 4 + len;
    }

    // seller_fee_basis_points (u16 LE)
    if (offset + 2 > data.length) return null;
    const sellerFeeBps = data[offset] | (data[offset + 1] << 8);
    offset += 2;

    // Option<Vec<Creator>>
    if (offset + 1 > data.length) return null;
    const hasCreators = data[offset] === 1;
    offset += 1;

    const creators: MetaplexCreatorInfo[] = [];
    if (hasCreators) {
      if (offset + 4 > data.length) return null;
      const count = data[offset] | (data[offset + 1] << 8) | (data[offset + 2] << 16) | (data[offset + 3] << 24);
      offset += 4;

      for (let i = 0; i < count; i++) {
        if (offset + 34 > data.length) return null;
        const address = new PublicKey(data.slice(offset, offset + 32));
        const verified = data[offset + 32] === 1;
        const share = data[offset + 33];
        offset += 34;
        creators.push({ address, verified, share });
      }
    }

    return { sellerFeeBps, creators };
  } catch {
    return null;
  }
}
