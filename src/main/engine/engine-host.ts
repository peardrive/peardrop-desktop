/**
 * EngineHost — owns the active TransferBackend and its lifecycle.
 *
 * - Picks the backend from the registry and builds its context (storage
 *   paths + network options).
 * - Resolves which DHT bootstrap nodes to use:
 *     environment (npm run dev) > preferences.network.bootstrap > public DHT
 * - `reload()` tears the backend down (leaving persisted state untouched),
 *   builds a fresh one with the current network options and starts it again.
 *   Shares resume and re-announce on the new swarm instances.
 * - Callers use `withBackend()`, which waits out a start/reload instead of
 *   failing, so an IPC call made mid-reload simply completes afterwards.
 * - Re-emits backend events, and status changes, for the IPC layer.
 */
import { EventEmitter } from 'node:events'
import { formatBootstrapList, parseBootstrapList, type BootstrapNode } from '@shared/bootstrap'
import type { EngineReloadRequest, EngineReloadResult, EngineStatus } from '@shared/engine'
import type { TransferEvent } from '@shared/transfer'
import type { PeardropPaths } from '../../engine/paths'
import type { Logger } from '../logger'
import type { PreferencesStore } from '../stores/preferences-store'
import type { NetworkCounters, TransferBackend } from './backend'
import { BACKENDS, DEFAULT_BACKEND } from './registry'

export interface EngineHostOptions {
  paths: PeardropPaths
  preferences: PreferencesStore
  log: Logger
  envBootstrap: string | null
  backend?: string
}

export class EngineHost extends EventEmitter {
  private backend: TransferBackend | null = null
  private unsubscribe: (() => void) | null = null
  private ready: Promise<void> = Promise.resolve()
  private lifecycle: Promise<unknown> = Promise.resolve()
  private readonly backendId: string
  private readonly log: Logger
  private status: EngineStatus
  /** Bumped for every backend instance, so counter consumers can detect a reset. */
  private generation = 0

  constructor(private readonly opts: EngineHostOptions) {
    super()
    this.backendId = opts.backend && BACKENDS[opts.backend] ? opts.backend : DEFAULT_BACKEND
    this.log = opts.log
    this.status = {
      phase: 'stopped',
      backend: this.backendId,
      backendLabel: BACKENDS[this.backendId].label,
      bootstrap: [],
      bootstrapSource: 'public',
      envBootstrap: opts.envBootstrap,
      startedAt: null,
      error: null,
      stats: { drives: 0, active: 0 }
    }
  }

  getStatus(): EngineStatus {
    const stats = this.backend && this.status.phase === 'ready' ? this.backend.stats() : this.status.stats
    return { ...this.status, stats }
  }

  /** Run `fn` against the live backend, waiting for any start/reload in progress. */
  async withBackend<T>(fn: (backend: TransferBackend) => Promise<T> | T): Promise<T> {
    await this.ready
    if (!this.backend || this.status.phase !== 'ready') {
      throw new Error(this.status.error ? `Engine unavailable: ${this.status.error}` : 'Engine is not running')
    }
    return fn(this.backend)
  }

  /** Network counters of the live backend (zeros while stopped or reloading). */
  networkCounters(): NetworkCounters & { generation: number } {
    const zero = { peers: 0, connections: 0, bytesIn: 0, bytesOut: 0 }
    if (!this.backend || this.status.phase !== 'ready') return { ...zero, generation: this.generation }
    try {
      return { ...this.backend.networkCounters(), generation: this.generation }
    } catch {
      return { ...zero, generation: this.generation }
    }
  }

  /**
   * Emit a transfer event on behalf of a service that sits above the backend
   * (the receive queue), so the renderer hears it on the usual channel.
   */
  publish(event: TransferEvent): void {
    this.emit('event', event)
  }

  /** Bootstrap nodes for the next start, and where they came from. */
  private resolveNetwork(): { nodes: BootstrapNode[]; source: EngineStatus['bootstrapSource'] } {
    if (this.opts.envBootstrap) {
      const parsed = parseBootstrapList(this.opts.envBootstrap)
      if (parsed.ok && parsed.nodes.length) return { nodes: parsed.nodes, source: 'environment' }
      this.log.warn('Ignoring invalid PEARDROP_BOOTSTRAP', { value: this.opts.envBootstrap })
    }
    const pref = this.opts.preferences.get().network.bootstrap
    const parsed = parseBootstrapList(pref)
    if (parsed.ok && parsed.nodes.length) return { nodes: parsed.nodes, source: 'preferences' }
    if (!parsed.ok) this.log.warn('Ignoring invalid bootstrap preference', { value: pref, error: parsed.error })
    return { nodes: [], source: 'public' }
  }

  private setStatus(patch: Partial<EngineStatus>) {
    this.status = { ...this.status, ...patch }
    this.emit('status', this.getStatus())
  }

  start(): Promise<void> {
    return this.serialize(() => this.startInternal())
  }

  private async startInternal(): Promise<void> {
    const { nodes, source } = this.resolveNetwork()
    this.setStatus({ phase: this.status.phase === 'reloading' ? 'reloading' : 'starting', bootstrap: nodes, bootstrapSource: source, error: null })
    const entry = BACKENDS[this.backendId]
    const backend = entry.create({ paths: this.opts.paths, network: { bootstrap: nodes }, log: this.log })
    this.backend = backend
    this.generation++
    this.unsubscribe = backend.onEvent((event: TransferEvent) => this.emit('event', event))

    const starting = (async () => {
      try {
        await backend.start()
        this.setStatus({ phase: 'ready', startedAt: Date.now(), error: null })
        this.log.info('Engine ready', { backend: this.backendId, bootstrap: nodes.length ? formatBootstrapList(nodes) : 'public DHT' })
      } catch (err) {
        this.log.error('Engine failed to start', err)
        this.setStatus({ phase: 'error', error: (err as Error).message })
        throw err
      }
    })()
    // withBackend() waits on this, but must not throw from it.
    this.ready = starting.catch(() => undefined)
    await starting
  }

  /** Stop the backend; `persistState:false` leaves drives set to resume next start. */
  stop(): Promise<void> {
    return this.serialize(() => this.stopInternal())
  }

  private async stopInternal(): Promise<void> {
    const backend = this.backend
    if (!backend) return
    try {
      await backend.stop({ persistState: false })
    } catch (err) {
      this.log.error('Engine stop failed', err)
    } finally {
      this.unsubscribe?.()
      this.unsubscribe = null
      this.backend = null
      if (this.status.phase !== 'reloading') this.setStatus({ phase: 'stopped' })
    }
  }

  /**
   * Restart hyperdrive + hyperswarm instances, optionally with a new
   * bootstrap address (persisted to preferences first).
   */
  reload(req: EngineReloadRequest = {}): Promise<EngineReloadResult> {
    return this.serialize(async () => {
      if (req.bootstrap !== undefined) {
        const parsed = parseBootstrapList(req.bootstrap)
        if (!parsed.ok) return { success: false as const, error: parsed.error, status: this.getStatus() }
        await this.opts.preferences.patch({ network: { bootstrap: parsed.nodes.length ? formatBootstrapList(parsed.nodes) : '' } })
      }
      this.log.info('Reloading engine', { bootstrap: req.bootstrap ?? '(unchanged)' })
      let release!: () => void
      // Hold callers of withBackend() until the new backend is up.
      this.ready = new Promise<void>((r) => (release = r))
      this.setStatus({ phase: 'reloading' })
      try {
        await this.stopInternal()
        await this.startInternal()
        return { success: true as const, status: this.getStatus() }
      } catch (err) {
        return { success: false as const, error: (err as Error).message, status: this.getStatus() }
      } finally {
        release()
      }
    })
  }

  /** Run lifecycle operations one at a time. */
  private serialize<T>(op: () => Promise<T>): Promise<T> {
    const next = this.lifecycle.catch(() => undefined).then(op)
    this.lifecycle = next
    return next
  }
}
