/**
 * Receive queue — share links the user asked to download that have not
 * finished yet, persisted as ~/.peardrop/receive-queue.json.
 *
 * Why it exists: the engine only writes a drive to drives-state.json once a
 * sender has actually been reached (no orphan stubs). A link pasted while the
 * sender is offline therefore lived only in memory and was forgotten when the
 * app quit. The queue remembers it, keeps retrying discovery with backoff,
 * and hands it to the engine the moment the sender shows up. A task stays in
 * the queue until its download completes, so a download that was reached but
 * never got going also continues after a restart.
 *
 * The main process owns the file; the renderer reads it over IPC and is told
 * about every change on the `receive:changed` push channel.
 */

export type ReceiveTaskPhase =
  /** Waiting for the next discovery attempt. */
  | 'waiting'
  /** A DHT lookup for the sender is running right now. */
  | 'searching'
  /** Sender reached; the engine owns the drive (`driveId`) and is downloading it. */
  | 'downloading'

export interface ReceiveTask {
  /** Stable id of the task (also the placeholder card id in the UI). */
  id: string
  /** Normalised `peardrop://<64 hex>` link. */
  link: string
  addedAt: number
  phase: ReceiveTaskPhase
  /** Engine drive id once the sender was reached; null while still searching. */
  driveId: string | null
  /** Share name, once known. */
  name: string | null
  attempts: number
  lastAttemptAt: number | null
  /** When the next discovery attempt is due (null while one is running). */
  nextAttemptAt: number | null
  /** Last failure, in user-facing words. */
  lastError: string | null
}

export interface ReceiveQueueData {
  version: 1
  tasks: ReceiveTask[]
}

export const EMPTY_RECEIVE_QUEUE: ReceiveQueueData = { version: 1, tasks: [] }

/** Result of `receive:add`. */
export type ReceiveAddResult =
  | { status: 'queued'; task: ReceiveTask }
  /** The link is already being received; nothing new was queued. */
  | { status: 'pending'; task: ReceiveTask }
  /** Already in the library (a finished download, or your own share). */
  | { status: 'duplicate'; driveId: string; isUpload: boolean }
  | { status: 'invalid'; error: string }

const PHASES: readonly ReceiveTaskPhase[] = ['waiting', 'searching', 'downloading']
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const str = (v: unknown): string | null => (typeof v === 'string' && v ? v : null)

/** Coerce anything read from disk into a valid queue. */
export function sanitizeReceiveQueue(input: unknown): ReceiveQueueData {
  const src = (input && typeof input === 'object' ? input : {}) as Record<string, any>
  const seen = new Set<string>()
  const tasks: ReceiveTask[] = []
  for (const raw of Array.isArray(src.tasks) ? src.tasks : []) {
    if (!raw || typeof raw !== 'object') continue
    const id = str(raw.id)
    const link = str(raw.link)
    if (!id || !link || !/^peardrop:\/\/[a-f0-9]{64}$/.test(link) || seen.has(link)) continue
    seen.add(link)
    const driveId = str(raw.driveId)
    const phase: ReceiveTaskPhase = driveId ? 'downloading' : PHASES.includes(raw.phase) && raw.phase !== 'downloading' ? raw.phase : 'waiting'
    tasks.push({
      id,
      link,
      addedAt: num(raw.addedAt) ?? Date.now(),
      phase,
      driveId,
      name: str(raw.name),
      attempts: Math.max(0, num(raw.attempts) ?? 0),
      lastAttemptAt: num(raw.lastAttemptAt),
      nextAttemptAt: num(raw.nextAttemptAt),
      lastError: str(raw.lastError)
    })
  }
  return { version: 1, tasks }
}

/** A queue read from disk: nothing is searching yet after a restart. */
export function restoredReceiveQueue(input: unknown): ReceiveQueueData {
  const q = sanitizeReceiveQueue(input)
  return { ...q, tasks: q.tasks.map((t) => (t.phase === 'searching' ? { ...t, phase: 'waiting' } : t)) }
}

/** Discovery backoff: 15s, 30s, 1m, 2m, then every 5 minutes. */
export function retryDelayMs(attempts: number): number {
  const steps = [15_000, 30_000, 60_000, 120_000]
  return steps[Math.min(Math.max(attempts - 1, 0), steps.length)] ?? 300_000
}
