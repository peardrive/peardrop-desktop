/**
 * ReceiveQueue — remembers every share link the user asked to download until
 * that download has finished, and keeps working on it in the background.
 *
 *   paste link ─► task (persisted) ─► discovery attempt ──► sender reached ─► engine drive + download
 *                        ▲                  │ not found
 *                        └── backoff ◄──────┘
 *
 * - A task survives restarts (receive-queue.json). Before, a link whose
 *   sender was offline lived only in renderer memory and vanished on quit.
 * - Discovery uses the backend's normal `open()`. When the sender is not
 *   found, the half-open session is released (no swarm left dangling) and
 *   the next attempt is scheduled with backoff: 15s, 30s, 1m, 2m, then 5m.
 * - Once the sender is reached the engine persists the drive itself; the
 *   task keeps its `driveId` and stays queued until `files-downloaded`, so a
 *   download that was reached but did not complete continues after a
 *   restart instead of parking as "Disconnected".
 * - Runs entirely in the main process, so it keeps going while the window is
 *   hidden in the tray.
 *
 * Talks to transfers only through EngineHost/TransferBackend, so it works
 * with any backend.
 */
import { EventEmitter } from 'node:events'
import { extractShareLink, describeInvalidLink } from '@shared/links'
import {
  restoredReceiveQueue,
  retryDelayMs,
  sanitizeReceiveQueue,
  type ReceiveAddResult,
  type ReceiveQueueData,
  type ReceiveTask
} from '@shared/receive'
import type { DownloadResult, OpenResult, SimpleResult, TransferEvent } from '@shared/transfer'
import type { EngineHost } from '@engine/engine-host'
import type { Logger } from '../logger'
import { JsonStore } from '../stores/json-store'

/** Sender answered but its file list has not replicated yet: try again soon. */
const UNSYNCED_RETRY_MS = 5_000
/** How often a reached-but-unfinished download is checked on. */
const OWNED_CHECK_MS = 45_000
/** Progress newer than this means the download is alive; leave it alone. */
const PROGRESS_FRESH_MS = 30_000
/** At most this many DHT lookups at once. */
const MAX_PARALLEL_SEARCHES = 3

type QueueEngine = Pick<EngineHost, 'withBackend' | 'publish' | 'on'>

export interface ReceiveQueueOptions {
  file: string
  engine: QueueEngine
  log: Logger
}

export class ReceiveQueue extends EventEmitter {
  private readonly store: JsonStore<ReceiveQueueData>
  private readonly engine: QueueEngine
  private readonly log: Logger
  private readonly timers = new Map<string, NodeJS.Timeout>()
  /** Task ids with a discovery attempt in flight. */
  private readonly searching = new Set<string>()
  /** Drive ids with a queue-started download call in flight. */
  private readonly downloading = new Set<string>()
  /** driveId → last time our own download made progress. */
  private readonly lastProgress = new Map<string, number>()
  private running = false

  constructor(opts: ReceiveQueueOptions) {
    super()
    this.engine = opts.engine
    this.log = opts.log
    this.store = new JsonStore(opts.file, sanitizeReceiveQueue, opts.log)
    // A lookup that was running when the app quit is not running any more.
    const loaded = this.store.get()
    if (loaded.tasks.some((t) => t.phase === 'searching')) void this.store.set(restoredReceiveQueue(loaded))
    this.store.on('change', (data: ReceiveQueueData) => this.emit('change', data.tasks))
    this.engine.on('event', (e: TransferEvent) => this.onEngineEvent(e))
  }

  list(): ReceiveTask[] {
    return this.store.get().tasks
  }

  /** Begin working through the queue (call once the engine is starting). */
  start(): void {
    if (this.running) return
    this.running = true
    const tasks = this.list()
    if (tasks.length) this.log.info('Resuming receive queue', { tasks: tasks.length })
    tasks.forEach((t, i) => {
      // Owned downloads: the engine resumes them at init and announces
      // drive-ready-to-download; check on them later in case it does not.
      if (t.driveId) this.schedule(t.id, OWNED_CHECK_MS)
      else this.schedule(t.id, 1500 + i * 750)
    })
  }

  stop(): void {
    this.running = false
    for (const t of this.timers.values()) clearTimeout(t)
    this.timers.clear()
  }

  // ───────────────────────────── commands ─────────────────────────────

  async add(raw: string): Promise<ReceiveAddResult> {
    const link = extractShareLink(raw)
    if (!link) return { status: 'invalid', error: describeInvalidLink(String(raw ?? '')) }

    const pending = this.list().find((t) => t.link === link)
    if (pending) {
      // Pasting it again is a good moment to look right away.
      if (!pending.driveId && !this.searching.has(pending.id)) this.schedule(pending.id, 0)
      return { status: 'pending', task: pending }
    }

    try {
      const dup = await this.engine.withBackend((b) => b.checkLink(link))
      if (dup.isDuplicate) return { status: 'duplicate', driveId: dup.driveId, isUpload: dup.existing.isUpload }
    } catch {
      // Engine not up yet: queue it anyway, the attempt waits for the engine.
    }

    const task: ReceiveTask = {
      id: `rx_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      link,
      addedAt: Date.now(),
      phase: 'waiting',
      driveId: null,
      name: null,
      attempts: 0,
      lastAttemptAt: null,
      nextAttemptAt: Date.now(),
      lastError: null
    }
    await this.store.update((q) => ({ ...q, tasks: [task, ...q.tasks] }))
    this.log.info('Link queued', { id: task.id })
    this.schedule(task.id, 0)
    return { status: 'queued', task }
  }

  /** Forget a task that has not reached its sender (✕ on its card). */
  async remove(id: string): Promise<SimpleResult> {
    const task = this.find(id)
    if (!task) return { success: true }
    this.clearTimer(id)
    this.drop(id)
    // A drive the engine already owns goes the normal cancel way.
    if (task.driveId) await this.engine.withBackend((b) => b.cancelDownload(task.driveId!)).catch(() => undefined)
    this.log.info('Queued link removed', { id })
    return { success: true }
  }

  /** "Try now": skip the backoff for one task, or for all of them. */
  retry(id?: string): SimpleResult {
    for (const t of this.list()) {
      if (id && t.id !== id) continue
      if (!this.searching.has(t.id)) this.schedule(t.id, 0)
    }
    return { success: true }
  }

  // ───────────────────────────── work ─────────────────────────────

  private find(id: string) {
    return this.list().find((t) => t.id === id) ?? null
  }

  private byDrive(driveId: string) {
    return this.list().find((t) => t.driveId === driveId) ?? null
  }

  /**
   * Update a task. The in-memory value changes synchronously; the file write
   * is queued by the store (serialized, atomic) and never awaited here, so a
   * slow disk cannot delay discovery.
   */
  private patch(id: string, patch: Partial<ReceiveTask>): void {
    void this.store.update((q) => ({ ...q, tasks: q.tasks.map((t) => (t.id === id ? { ...t, ...patch } : t)) }))
  }

  private drop(id: string): void {
    this.clearTimer(id)
    void this.store.update((q) => ({ ...q, tasks: q.tasks.filter((t) => t.id !== id) }))
  }

  private clearTimer(id: string) {
    const t = this.timers.get(id)
    if (t) clearTimeout(t)
    this.timers.delete(id)
  }

  private schedule(id: string, delayMs: number) {
    if (!this.running) return
    this.clearTimer(id)
    const timer = setTimeout(() => {
      this.timers.delete(id)
      void this.run(id)
    }, delayMs)
    timer.unref?.()
    this.timers.set(id, timer)
    this.patch(id, { nextAttemptAt: Date.now() + delayMs })
  }

  private async run(id: string) {
    const task = this.find(id)
    if (!task || !this.running) return
    if (task.driveId) return this.checkOwned(task)
    if (this.searching.size >= MAX_PARALLEL_SEARCHES) return this.schedule(id, 2000)
    return this.discover(task)
  }

  /** One DHT lookup for a link whose sender has not been reached yet. */
  private async discover(task: ReceiveTask) {
    const id = task.id
    this.searching.add(id)
    const attempts = task.attempts + 1
    this.patch(id, { phase: 'searching', attempts, lastAttemptAt: Date.now(), nextAttemptAt: null })

    let res: OpenResult
    try {
      res = await this.engine.withBackend((b) => b.open(task.link, { force: true }))
    } catch (err) {
      res = { success: false, error: (err as Error).message || 'Engine unavailable' }
    } finally {
      this.searching.delete(id)
    }

    if (!this.find(id)) {
      // Removed while searching: undo whatever the lookup produced.
      if (res.success && !res.isDuplicate) await this.abandon(res.driveId, res.peerConnected && (res.hasManifest || res.files.length > 0))
      return
    }

    if (!res.success) {
      this.patch(id, { phase: 'waiting', lastError: res.error || 'Could not look for the sender' })
      return this.schedule(id, retryDelayMs(attempts))
    }
    if (res.isDuplicate) {
      // Someone else (CLI, another paste) already holds it.
      this.drop(id)
      return
    }

    const synced = res.hasManifest || res.files.length > 0
    if (!res.peerConnected || !synced) {
      await this.engine.withBackend((b) => b.release(res.driveId)).catch(() => undefined)
      this.patch(id, {
        phase: 'waiting',
        lastError: res.peerConnected ? 'Sender found, waiting for the file list' : 'Sender is offline or not reachable yet'
      })
      return this.schedule(id, res.peerConnected ? UNSYNCED_RETRY_MS : retryDelayMs(attempts))
    }

    // Reached: the engine persisted the drive. From here it is a download.
    const driveId = res.driveId
    this.log.info('Sender reached for queued link', { id, driveId, files: res.files.length })
    this.patch(id, { phase: 'downloading', driveId, name: res.shareName, lastError: null, nextAttemptAt: null })
    const record = await this.engine.withBackend((b) => b.get(driveId)).catch(() => null)
    if (record) this.engine.publish({ type: 'drive-added', record })
    void this.download(driveId)
  }

  private async abandon(driveId: string, persisted: boolean) {
    await this.engine
      .withBackend(async (b) => {
        if (persisted) await b.remove(driveId, { deleteFiles: true })
        else await b.release(driveId)
      })
      .catch(() => undefined)
  }

  /** Run the download for a drive this queue owns. */
  private async download(driveId: string) {
    if (this.downloading.has(driveId)) return
    this.downloading.add(driveId)
    let res: DownloadResult
    try {
      res = await this.engine.withBackend((b) => b.download({ driveId }))
    } catch (err) {
      res = { success: false, error: (err as Error).message }
    } finally {
      this.downloading.delete(driveId)
    }

    const task = this.byDrive(driveId)
    if (!task) return
    if (res.success || res.cancelled) return this.drop(task.id)
    if (res.alreadyRunning) return this.schedule(task.id, OWNED_CHECK_MS)
    if (res.notReady) {
      // No live data yet: the backend is reconnecting (or the session never
      // synced); restart discovery for it and look again later.
      void this.engine.withBackend((b) => b.rediscover(driveId)).catch(() => undefined)
      return this.schedule(task.id, OWNED_CHECK_MS)
    }
    const attempts = task.attempts + 1
    const error = res.error || 'Download failed'
    this.log.warn('Queued download failed, will retry', { driveId, error })
    this.patch(task.id, { attempts, lastError: error })
    this.engine.publish({ type: 'download-failed', driveId, error, willRetry: true })
    this.schedule(task.id, retryDelayMs(attempts))
  }

  /** Periodic check on a reached download that has not completed. */
  private async checkOwned(task: ReceiveTask) {
    const driveId = task.driveId!
    const record = await this.engine.withBackend((b) => b.get(driveId)).catch(() => undefined)
    if (record === null) {
      // The drive is gone (removed from the list): nothing left to do.
      return this.drop(task.id)
    }
    if (record && record.state === 'active') return this.drop(task.id)
    const fresh = Date.now() - (this.lastProgress.get(driveId) ?? 0) < PROGRESS_FRESH_MS
    if (this.downloading.has(driveId) || fresh) return this.schedule(task.id, OWNED_CHECK_MS)
    void this.download(driveId)
  }

  private onEngineEvent(e: TransferEvent) {
    switch (e.type) {
      case 'transfer-progress':
        if (e.peerId === 'self') this.lastProgress.set(e.driveId, Date.now())
        return
      case 'files-downloaded':
      case 'drive-removed': {
        const task = this.byDrive(e.driveId)
        this.lastProgress.delete(e.driveId)
        if (task) this.drop(task.id)
        return
      }
      case 'drive-ready-to-download':
        if (this.byDrive(e.driveId)) void this.download(e.driveId)
        return
      case 'library-loaded':
        // Engine (re)started: every live session is new, look again soon.
        if (!this.running) return
        this.list().forEach((t, i) => {
          if (t.driveId) this.schedule(t.id, OWNED_CHECK_MS)
          else if (!this.searching.has(t.id)) this.schedule(t.id, 1000 + i * 750)
        })
        return
    }
  }
}
