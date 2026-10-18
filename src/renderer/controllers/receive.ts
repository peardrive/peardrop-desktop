/**
 * Receiving: link → duplicate check → placeholder card → open → download.
 *
 * Guards ported from the old renderer:
 *  - one download request in flight per drive from this window (main holds
 *    the authoritative guard; this one stops redundant IPC and flicker),
 *  - `userStarted` records drives the user asked to download this session;
 *    a drive the engine resumed at boot parks as "Disconnected" and waits
 *    for Resume instead of silently pulling gigabytes,
 *  - a placeholder cancelled while still connecting cancels the real drive
 *    if the connection lands afterwards.
 */
import { extractShareLink } from '@shared/links'
import type { DriveView } from '../lib/drive-model'
import { api } from '../services/client'
import { drivesStore } from '../stores/drives-store'
import { toast } from '../stores/toast-store'
import { uiStore } from '../stores/ui-store'

const inFlight = new Set<string>()
export const userStarted = new Set<string>()
const cancelledPlaceholders = new Set<string>()

/** Scroll to an existing card and pulse it. */
export function highlightDrive(id: string) {
  const ui = uiStore()
  ui.setPage('main')
  // Make sure the card is actually visible before pointing at it.
  ui.setTab('shares')
  ui.setSearch('')
  ui.setKindFilter('all')
  ui.setStatusFilter('any')
  drivesStore().highlight(id)
  setTimeout(() => {
    if (drivesStore().highlightId === id) drivesStore().highlight(null)
  }, 2200)
}

/** Validate a pasted value, refuse duplicates, then start the download. */
export async function startDownload(raw: string): Promise<void> {
  const link = extractShareLink(raw)
  if (!link) {
    toast.error(
      raw.toLowerCase().includes('peardrop://')
        ? 'Invalid link — the key after peardrop:// must be exactly 64 hex characters.'
        : 'Not a peardrop:// link. Paste the full link starting with peardrop://'
    )
    return
  }

  let dup
  try {
    dup = await api().transfers.checkLink(link)
  } catch (err) {
    toast.error(`Could not start download: ${(err as Error).message || 'engine error'}`)
    return
  }
  // Already in the list (including your OWN share): point at it instead.
  if (dup.isDuplicate) {
    highlightDrive(dup.driveId)
    toast.info(dup.existing.isUpload ? 'This is your own share' : 'Already downloaded')
    return
  }

  const tempId = `dl_${Date.now()}`
  drivesStore().upsert({
    id: tempId,
    name: 'Connecting…',
    kind: 'download',
    status: 'connecting',
    progress: 0,
    speed: 0,
    peers: 0,
    size: 0,
    files: [],
    shareLink: link,
    addedAt: Date.now(),
    isPlaceholder: true
  })

  let open
  try {
    open = await api().transfers.open(link, { force: true })
  } catch (err) {
    open = { success: false as const, error: (err as Error).message || 'engine error' }
  }

  if (cancelledPlaceholders.has(tempId)) {
    cancelledPlaceholders.delete(tempId)
    // The user gave up while we were connecting; clean up what did connect.
    if (open.success && !open.isDuplicate) void api().transfers.cancelDownload(open.driveId)
    return
  }

  if (!open.success) {
    drivesStore().patch(tempId, { status: 'error', name: 'Download failed' })
    toast.error(`Download failed: ${open.error || 'unknown error'}`)
    setTimeout(() => drivesStore().remove(tempId), 5000)
    return
  }
  if (open.isDuplicate) {
    drivesStore().remove(tempId)
    highlightDrive(open.driveId)
    return
  }

  const hasPeer = open.peerConnected
  const hasData = !!open.shareName && open.files.length > 0
  if (!hasPeer && !hasData) {
    drivesStore().patch(tempId, { name: 'Waiting for peer…', status: 'connecting' })
    return
  }

  drivesStore().remove(tempId)
  drivesStore().upsert({
    id: open.driveId,
    name: open.shareName || 'Download',
    kind: 'download',
    status: 'downloading',
    progress: 0,
    speed: 0,
    peers: hasPeer ? 1 : 0,
    size: open.totalBytes || 0,
    files: open.files,
    shareLink: link,
    addedAt: Date.now()
  })
  if (open.truncated) toast.info(`Showing ${open.truncated.shown} of ${open.truncated.available} files`)
  userStarted.add(open.driveId)
  void runDownload(open.driveId)
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

/** ✕ on a placeholder that never connected. */
export function cancelPlaceholder(id: string) {
  cancelledPlaceholders.add(id)
  drivesStore().remove(id)
}
