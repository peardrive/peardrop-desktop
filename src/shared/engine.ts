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
