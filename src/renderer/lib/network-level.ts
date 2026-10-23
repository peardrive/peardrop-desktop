/**
 * What the network panel's signal bars say. Three states, by how far the
 * app can actually reach:
 *
 *   Not reachable  no network, or no DHT bootstrap server answers a ping
 *   Reachable      the DHT answers, but no peer is connected
 *   Connected      at least one peer connection is open
 *
 * "Connecting" covers the moments before the first answer: the engine is
 * starting or reloading, or the first DHT ping has not come back yet.
 */
import type { EngineStatus, NetworkStats } from '@shared/engine'

export type NetworkLevel = {
  label: 'Not reachable' | 'Reachable' | 'Connected' | 'Connecting' | 'Starting'
  bars: 0 | 1 | 2 | 3
  tone: 'online' | 'warning' | 'danger' | 'muted'
}

const NOT_REACHABLE: NetworkLevel = { label: 'Not reachable', bars: 0, tone: 'danger' }
const REACHABLE: NetworkLevel = { label: 'Reachable', bars: 2, tone: 'online' }
const CONNECTED: NetworkLevel = { label: 'Connected', bars: 3, tone: 'online' }
const CONNECTING: NetworkLevel = { label: 'Connecting', bars: 1, tone: 'warning' }
const STARTING: NetworkLevel = { label: 'Starting', bars: 0, tone: 'muted' }

export function networkLevel(engine: EngineStatus | null, stats: NetworkStats): NetworkLevel {
  if (!engine) {
    return STARTING
  }

  if (engine.phase === 'error') {
    return NOT_REACHABLE
  }

  if (stats.connections > 0) {
    return CONNECTED
  }

  if (stats.reachable === true) {
    return REACHABLE
  }

  if (stats.reachable === false) {
    return NOT_REACHABLE
  }

  return CONNECTING
}
