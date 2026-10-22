/**
 * NetworkMonitor — turns the engine's cumulative network counters into the
 * live figures shown in the sidebar status panel (connected peers, inbound
 * and outbound speed).
 *
 * Samples once a second. Speeds are an exponential moving average over the
 * per-second deltas, so a bursty transfer reads as a steady number instead of
 * flickering between 0 and a spike. An engine reload swaps the backend and
 * resets its counters; the `generation` it reports makes that a clean restart
 * rather than a negative delta.
 */
import { EventEmitter } from 'node:events'
import { EMPTY_NETWORK_STATS, type NetworkStats } from '@shared/engine'
import type { EngineHost } from '@engine/engine-host'

const SAMPLE_MS = 1000
/** Weight of the newest second; ~3 s effective window. */
const ALPHA = 0.45
/** Below this a speed is shown as zero (keep-alives, DHT chatter). */
const IDLE_BPS = 64

export class NetworkMonitor extends EventEmitter {
  private timer: NodeJS.Timeout | null = null
  private stats: NetworkStats = { ...EMPTY_NETWORK_STATS }
  private last: { bytesIn: number; bytesOut: number; generation: number; at: number } | null = null
  private emaIn = 0
  private emaOut = 0

  constructor(private readonly engine: Pick<EngineHost, 'networkCounters'>) {
    super()
  }

  get(): NetworkStats {
    return this.stats
  }

  start(): void {
    if (this.timer) return
    this.timer = setInterval(() => this.sample(), SAMPLE_MS)
    this.timer.unref?.()
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  /** One sampling step (public for tests). */
  sample(now = Date.now()): NetworkStats {
    const c = this.engine.networkCounters()
    const prev = this.last
    let dIn = 0
    let dOut = 0
    let dt = SAMPLE_MS / 1000
    if (prev && prev.generation === c.generation) {
      dIn = Math.max(0, c.bytesIn - prev.bytesIn)
      dOut = Math.max(0, c.bytesOut - prev.bytesOut)
      dt = Math.max(0.25, (now - prev.at) / 1000)
    } else if (prev) {
      // New backend instance: its counters started from zero.
      dIn = c.bytesIn
      dOut = c.bytesOut
    }
    this.last = { bytesIn: c.bytesIn, bytesOut: c.bytesOut, generation: c.generation, at: now }

    this.emaIn = ALPHA * (dIn / dt) + (1 - ALPHA) * this.emaIn
    this.emaOut = ALPHA * (dOut / dt) + (1 - ALPHA) * this.emaOut
    if (c.connections === 0) {
      // Nobody to talk to: decay quickly instead of trailing off for seconds.
      this.emaIn *= 0.3
      this.emaOut *= 0.3
    }

    const next: NetworkStats = {
      peers: c.peers,
      connections: c.connections,
      inbound: this.emaIn < IDLE_BPS ? 0 : Math.round(this.emaIn),
      outbound: this.emaOut < IDLE_BPS ? 0 : Math.round(this.emaOut),
      totalIn: c.bytesIn,
      totalOut: c.bytesOut,
      at: now
    }
    const changed =
      next.peers !== this.stats.peers ||
      next.connections !== this.stats.connections ||
      next.inbound !== this.stats.inbound ||
      next.outbound !== this.stats.outbound
    this.stats = next
    if (changed) this.emit('stats', next)
    return next
  }
}
