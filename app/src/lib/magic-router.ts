/**
 * MagicBlock Ephemeral Rollups — Magic Router connection.
 *
 * ConnectionMagicRouter extends Connection and auto-routes transactions:
 * - Delegated accounts → ER (sub-50ms)
 * - Non-delegated accounts → L1 (Solana devnet)
 *
 * Singleton instance shared across all hooks.
 */

import { ConnectionMagicRouter } from "@magicblock-labs/ephemeral-rollups-sdk";
import { MAGIC_ROUTER_RPC, MAGIC_ROUTER_WS } from "./constants";

let instance: ConnectionMagicRouter | null = null;

export function getMagicConnection(): ConnectionMagicRouter {
  if (!instance) {
    instance = new ConnectionMagicRouter(MAGIC_ROUTER_RPC, {
      wsEndpoint: MAGIC_ROUTER_WS,
      commitment: "confirmed",
    });
  }
  return instance;
}
