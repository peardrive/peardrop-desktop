/**
 * Receiving: link → receive queue (main) → placeholder card → sender reached
 * → real card + download.
 *
 * The queue lives in the main process (services/receive-queue.ts) and is
 * persisted, so a link whose sender is offline is remembered across restarts
 * and retried in the background until it downloads. This controller only
 * mirrors it: every queued link without a drive yet is a placeholder card,
 * and a reached link turns into the engine's real card.
 *
 * Guards kept from the old renderer:
 *  - one download request in flight per drive from this window (main holds
 *    the authoritative guard; this one stops redundant IPC and flicker),
 *  - `userStarted` records drives the user resumed this session; a drive
 *    the engine resumed at boot parks as "Disconnected" and waits for Resume
 *    instead of silently pulling gigabytes — unless the receive queue owns
 *    it (the user asked for it and it never finished).
 */
import { extractShareLink } from '@shared/links'
import type { ReceiveTask } from '@shared/receive'
import type { DriveView } from '../lib/drive-model'
import { api } from '../services/client'
import { drivesStore } from '../stores/drives-store'
import { receiveStore } from '../stores/receive-store'
import { toast } from '../stores/toast-store'
import { uiStore } from '../stores/ui-store'
import { upsertRecord } from './library'

const inFlight = new Set<string>()
export const userStarted = new Set<string>()

/** Scroll to an existing card and pulse it. */
export function highlightDrive(id: string) {
  const ui = uiStore()
  ui.setPage('main')
  // Make sure the card is actually visible before pointing at it.
  ui.setTab('all')
  ui.setSearch('')
  ui.setStatusFilter('any')
  drivesStore().highlight(id)
  setTimeout(() => {
    if (drivesStore().highlightId === id) drivesStore().highlight(null)
  }, 2200)
}

/**
 * Validate a pasted value and hand it to the receive queue. Returns true
 * when the link is (now) being received.
 */
export async function startDownload(raw: string): Promise<boolean> {
  const link = extractShareLink(raw)
  if (!link) {
    toast.error(
      raw.toLowerCase().includes('peardrop://')
        ? 'Invalid link — the key after peardrop:// must be exactly 64 hex characters.'
        : 'Not a peardrop:// link. Paste the full link starting with peardrop://'
    )
    return false
  }

  let res
  try {
    res = await api().receive.add(link)
  } catch (err) {
    toast.error(`Could not start download: ${(err as Error).message || 'engine error'}`)
    return false
  }
  switch (res.status) {
    case 'invalid':
      toast.error(res.error)
      return false
    case 'duplicate':
      // Already in the list (including your OWN share): point at it instead.
      highlightDrive(res.driveId)
      toast.info(res.isUpload ? 'This is your own share' : 'Already downloaded')
      return false
    case 'pending':
      highlightDrive(res.task.driveId ?? res.task.id)
      toast.info('Already receiving this link')
      return true
    case 'queued':
      // Draw the card now; the push that follows confirms it.
      syncReceiveTasks([res.task, ...receiveStore().tasks.filter((t) => t.id !== res.task.id)])
      return true
  }
}

/** "Link a1b2c3…9f0e" — enough of the key to tell two queued links apart. */
export function shortLinkName(link: string): string {
  const key = link.replace(/^peardrop:\/\//i, '')
  return `Link ${key.slice(0, 6)}…${key.slice(-4)}`
}

const placeholderFor = (t: ReceiveTask): DriveView => ({
  id: t.id,
  name: t.name || shortLinkName(t.link),
  kind: 'download',
  status: 'connecting',
  progress: null,
  speed: 0,
  peers: 0,
  size: 0,
  files: [],
  shareLink: t.link,
  addedAt: t.addedAt,
  isPlaceholder: true,
  receive: { phase: t.phase, attempts: t.attempts, nextAttemptAt: t.nextAttemptAt, lastError: t.lastError }
})

/**
 * Mirror main's receive queue into the list: one placeholder per link still
 * looking for its sender; a link that reached its sender becomes the
 * engine's card (fetched if this window has not seen it yet).
 */
export function syncReceiveTasks(tasks: ReceiveTask[]): void {
  receiveStore().setTasks(tasks)
  const s = drivesStore()
  const waiting = new Set(tasks.filter((t) => !t.driveId).map((t) => t.id))

  // Placeholders whose task is gone or has been reached.
  for (const id of s.order) {
    const d = s.drives[id]
    if (d?.isPlaceholder && d.receive && !waiting.has(id)) s.remove(id)
  }

  for (const t of tasks) {
    if (!t.driveId) {
      s.upsert(placeholderFor(t), { prepend: true })
      continue
    }
    const card = drivesStore().drives[t.driveId]
    if (!card) {
      const driveId = t.driveId
      void api()
        .transfers.get(driveId)
        .then((record) => {
          if (record && receiveStore().ownedDrives.has(driveId)) upsertRecord(record)
        })
        .catch(() => undefined)
    } else if (card.status === 'interrupted' && !inFlight.has(t.driveId)) {
      // The queue is on it: it is reconnecting, not parked.
      s.patch(t.driveId, { status: 'connecting' })
    }
  }
}

/** Run (or continue) the download loop for an opened drive. */
export async function runDownload(driveId: string): Promise<void> {
  if (inFlight.has(driveId)) return
  inFlight.add(driveId)
  try {
    const res = await api().transfers.download({ driveId })
    if (!res.success && res.alreadyRunning) return
    if (!res.success && res.notReady) {
      // Connected but no file list yet: a wait, not a failure.
      drivesStore().patch(driveId, { status: 'connecting', speed: 0 })
      return
    }
    if (res.success) {
      // Provisional; 'files-downloaded' reports whether seeding began.
      drivesStore().patch(driveId, { status: 'complete', progress: 1 })
    } else if (!res.cancelled) {
      drivesStore().patch(driveId, { status: 'error', speed: 0 })
      if (res.error) toast.error(res.error)
    }
  } catch (err) {
    drivesStore().patch(driveId, { status: 'error', speed: 0 })
    toast.error((err as Error).message)
  } finally {
    inFlight.delete(driveId)
  }
}

/** ▶ on an interrupted download: rejoin and continue into the same files. */
export function resumeInterrupted(drive: DriveView) {
  if (!drive.shareLink) return toast.error('No share link for this download')
  drivesStore().patch(drive.id, { status: 'connecting', speed: 0 })
  toast.info('Reconnecting to sender…')
  userStarted.add(drive.id)
  void runDownload(drive.id)
}

/** Retry on a download whose files were deleted: fetch it again from the link. */
export async function redownload(drive: DriveView) {
  if (!drive.shareLink) return toast.error('No share link — this download cannot be recovered')
  await api().transfers.remove(drive.id, { deleteFiles: false })
  drivesStore().remove(drive.id)
  toast.info('Downloading again…')
  await startDownload(drive.shareLink)
}

/** ✕ on a placeholder: forget the queued link. */
export function cancelPlaceholder(id: string) {
  drivesStore().remove(id)
  void api().receive.remove(id)
}

/** ⟳ on a placeholder: look for the sender now instead of waiting. */
export function searchNow(id: string) {
  void api().receive.retry(id)
}
