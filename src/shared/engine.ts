/**
 * Engine (transfer backend) runtime status, shown in Settings → Network.
 */
import type { BootstrapNode } from './bootstrap'

export type EnginePhase = 'starting' | 'ready' | 'reloading' | 'stopped' | 'error'

export interface EngineStatus {
  phase: EnginePhase
  /** Backend id, e.g. "hyperdrive". */
  backend: string
  backendLabel: string
  /** Bootstrap nodes the current swarm instances were created with (empty = public DHT). */
  bootstrap: BootstrapNode[]
  /** Where the active bootstrap setting came from. */
  bootstrapSource: 'public' | 'preferences' | 'environment'
  /** Environment override (npm run dev), shown read-only in Settings. */
  envBootstrap: string | null
  startedAt: number | null
  error: string | null
  stats: { drives: number; active: number }
}

export interface EngineReloadRequest {
  /** New bootstrap value to persist before reloading; omit to keep the current one. */
  bootstrap?: string
}

export type EngineReloadResult = { success: true; status: EngineStatus } | { success: false; error: string; status: EngineStatus }

/** Live network figures for the sidebar status panel (pushed about once a second). */
export interface NetworkStats {
  /** Distinct remote peers connected right now, across every share and download. */
  peers: number
  /** Open peer connections. */
  connections: number
  /** Bytes per second received (smoothed). */
  inbound: number
  /** Bytes per second sent (smoothed). */
  outbound: number
  /** Bytes received / sent since the engine (re)started. */
  totalIn: number
  totalOut: number
  at: number
}

export const EMPTY_NETWORK_STATS: NetworkStats = { peers: 0, connections: 0, inbound: 0, outbound: 0, totalIn: 0, totalOut: 0, at: 0 }
