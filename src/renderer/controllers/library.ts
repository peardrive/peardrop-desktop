/**
 * Library controller: turns engine snapshots/records into cards and keeps
 * two "truthfulness" checks running:
 *
 *  - initiating watchdog: a share that never announces on the DHT is marked
 *    "Not reachable" after 5 minutes (a deliberately generous backstop — a
 *    wrongly-red card is worse than a patient "Initiating").
 *  - missing-file reconciliation: a card whose files were all deleted from
 *    disk says "Files removed" instead of failing when the user clicks Open.
 */
import type { DriveRecord, LibrarySnapshot } from '@shared/transfer'
import { toDriveView, type DriveView } from '../lib/drive-model'
import { api } from '../services/client'
import { drivesStore } from '../stores/drives-store'
import { isQueueOwned } from '../stores/receive-store'

const INITIATING_TIMEOUT_MS = 5 * 60 * 1000
const watchdogs = new Map<string, ReturnType<typeof setTimeout>>()

export function clearInitiatingWatchdog(id: string) {
  const t = watchdogs.get(id)
  if (t) clearTimeout(t)
  watchdogs.delete(id)
}

export function armInitiatingWatchdog(id: string) {
  if (drivesStore().announced.has(id)) return
  clearInitiatingWatchdog(id)
  watchdogs.set(
    id,
    setTimeout(() => {
      watchdogs.delete(id)
      const s = drivesStore()
      if (s.announced.has(id) || s.drives[id]?.status !== 'initiating') return
      s.patch(id, { status: 'unreachable' })
    }, INITIATING_TIMEOUT_MS)
  )
}

/** Share is reachable: promote an "Initiating" card to "Active". */
export function markAnnounced(id: string) {
  const s = drivesStore()
  s.setAnnounced(id, true)
  clearInitiatingWatchdog(id)
  if (s.drives[id]?.status === 'initiating') s.patch(id, { status: 'sharing' })
}

/** Insert or refresh a card from an engine record. */
export function upsertRecord(record: DriveRecord, opts: { resumeError?: { error: string } | null; prepend?: boolean } = {}): DriveView {
  const s = drivesStore()
  const previous = s.drives[record.id] ?? null
  const view = toDriveView(record, { announced: s.announced, resumeError: opts.resumeError, previous })
  // A live transfer status beats the persisted state until the engine says otherwise.
  if (previous && (previous.status === 'downloading' || previous.status === 'connecting') && view.status === 'interrupted') {
    view.status = previous.status
  }
  // The receive queue is still working on it: connecting, not parked.
  if (view.status === 'interrupted' && isQueueOwned(view.id)) view.status = 'connecting'
  s.upsert(view, { prepend: opts.prepend })
  if (view.status === 'initiating') armInitiatingWatchdog(view.id)
  return view
}

/** Replace the list with an engine snapshot (boot, engine reload, UI reload). */
export function applySnapshot(snapshot: LibrarySnapshot) {
  const s = drivesStore()
  // Authoritative: after an engine reload nothing is announced yet, so stale
  // ids must not keep cards green.
  s.resetAnnounced(snapshot.announced)
  const announced = new Set(snapshot.announced)
  const views = snapshot.drives.map((r) => {
    const v = toDriveView(r, { announced, resumeError: snapshot.resumeErrors[r.id] ?? null, previous: s.drives[r.id] ?? null })
    if (v.status === 'interrupted' && isQueueOwned(v.id)) v.status = 'connecting'
    return v
  })
  s.replaceAll(views)
  for (const v of views) {
    if (v.status === 'initiating') armInitiatingWatchdog(v.id)
    else clearInitiatingWatchdog(v.id)
  }
  void reconcileMissingFiles()
}

const SKIP = new Set(['downloading', 'connecting', 'initiating', 'interrupted', 'lost', 'missing'])

/** Mark cards whose every local file is gone as "Files removed". One IPC call. */
export async function reconcileMissingFiles() {
  const s = drivesStore()
  const candidates = Object.values(s.drives).filter((d) => !d.isPlaceholder && !SKIP.has(d.status) && d.files.some((f) => f.path))
  if (!candidates.length) return
  const paths = [...new Set(candidates.flatMap((d) => d.files.map((f) => f.path).filter((p): p is string => !!p)))]
  let exists: Record<string, boolean>
  try {
    exists = await api().files.exists(paths)
  } catch {
    return
  }
  for (const d of candidates) {
    const own = d.files.filter((f) => f.path)
    if (own.length && own.every((f) => exists[f.path!] === false)) drivesStore().patch(d.id, { status: 'missing' })
  }
}
