/**
 * What every card button and menu item does. Components call
 * `runRowAction` / `runMenuAction` and never reach the client directly.
 */
import { displayTitle, isClearable, isGroup, type DriveView, type MenuAction, type RowAction } from '../lib/drive-model'
import { api } from '../services/client'
import { drivesStore } from '../stores/drives-store'
import { useMetaStore } from '../stores/meta-store'
import { toast } from '../stores/toast-store'
import { uiStore } from '../stores/ui-store'
import { armInitiatingWatchdog, clearInitiatingWatchdog, reconcileMissingFiles } from './library'
import { cancelPlaceholder, redownload, resumeInterrupted, searchNow } from './receive'
import { reshare } from './share'

const UNDO_SECONDS = 5
const deleteTimers = new Map<string, ReturnType<typeof setTimeout>>()

const titleOf = (d: DriveView) => displayTitle(d, useMetaStore.getState().aliases)

export async function copyText(text: string, okMessage = 'Link copied'): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    if (okMessage) toast.success(okMessage)
    return true
  } catch {
    toast.error('Failed to copy')
    return false
  }
}

/** Open a local file, explaining a missing one instead of letting the OS complain. */
export async function openLocalFile(path: string | undefined): Promise<void> {
  if (!path) return toast.error('No local path for this file yet')
  const res = await api().files.open(path)
  if (!res.success) {
    toast.error(res.missing ? 'That file was removed from your disk' : res.error || 'Could not open file')
    if (res.missing) void reconcileMissingFiles()
  }
}

/** Click on a card: folders open their contents, single files open in the OS. */
export function openDrive(d: DriveView): void {
  if (d.isPlaceholder) return
  if (isGroup(d)) {
    uiStore().openModal({ type: 'folder', driveId: d.id })
    return
  }
  if (d.files[0]?.path) void openLocalFile(d.files[0].path)
}

// ── removal with a 5-second undo window ───────────────────────────────────

/** Start the undo countdown; the backend is only called when it expires. */
export function scheduleRemoval(d: DriveView, deleteFiles: boolean) {
  cancelRemoval(d.id)
  const deadline = Date.now() + UNDO_SECONDS * 1000
  drivesStore().setPendingDelete(d.id, { deadline, deleteFiles, executing: false })
  deleteTimers.set(
    d.id,
    setTimeout(async () => {
      deleteTimers.delete(d.id)
      drivesStore().setPendingDelete(d.id, { deadline, deleteFiles, executing: true })
      const res = await api().transfers.remove(d.id, { deleteFiles })
      if (!res.success && res.error) {
        drivesStore().setPendingDelete(d.id, null)
        toast.error(`Delete failed: ${res.error}`)
        return
      }
      // 'drive-removed' takes the card out; make sure it goes even if the
      // entry was already gone.
      drivesStore().remove(d.id)
      if (deleteFiles) toast.success('Removed and deleted from disk')
    }, UNDO_SECONDS * 1000)
  )
}

/** Undo: nothing ran yet, so there is nothing to roll back. */
export function cancelRemoval(id: string) {
  const t = deleteTimers.get(id)
  if (t) clearTimeout(t)
  deleteTimers.delete(id)
  if (drivesStore().pendingDeletes[id] && !drivesStore().pendingDeletes[id].executing) drivesStore().setPendingDelete(id, null)
}

/** Cancel a transfer in flight (no undo — cancelling acts immediately). */
async function cancelTransfer(d: DriveView) {
  const isDownload = d.kind === 'download'
  drivesStore().setCancelling(d.id, true)
  if (d.isPlaceholder) {
    cancelPlaceholder(d.id)
    toast.info('Link removed')
    return
  }
  if (isDownload) {
    // Main stops the loop, deletes partial files and emits drive-removed.
    await api().transfers.cancelDownload(d.id)
  } else {
    await api().transfers.cancelShare(d.id)
    const res = await api().transfers.remove(d.id, { deleteFiles: false })
    if (!res.success && res.error) {
      drivesStore().setCancelling(d.id, false)
      return void toast.error(`Cancel failed: ${res.error}`)
    }
  }
  toast.info(isDownload ? 'Download cancelled' : 'Share cancelled')
}

function confirmCancel(d: DriveView) {
  const isDownload = d.kind === 'download'
  const pct = d.progress != null ? Math.round(d.progress * 100) : null
  uiStore().openModal({
    type: 'confirm',
    title: isDownload ? 'Cancel this download?' : 'Cancel this share?',
    message: `${titleOf(d)}${pct != null && pct > 0 ? ` — currently at ${pct}%` : ''}`,
    buttons: [
      { label: isDownload ? 'Keep downloading' : 'Keep sharing', variant: 'secondary' },
      { label: 'Cancel transfer', variant: 'danger', onSelect: () => void cancelTransfer(d) }
    ]
  })
}

function confirmRemove(d: DriveView) {
  const isDownload = d.kind === 'download'
  uiStore().openModal({
    type: 'confirm',
    title: 'Remove from list?',
    message: titleOf(d),
    // Only downloads have a local copy worth offering to delete; a share's
    // file belongs to the user wherever it lives (main enforces this too).
    checkbox: isDownload ? { label: 'Also delete the downloaded file', hint: 'Permanently removes it from your downloads folder.' } : undefined,
    buttons: [
      { label: 'Cancel', variant: 'secondary' },
      { label: 'Remove', variant: 'danger', onSelect: ({ checked }) => scheduleRemoval(d, checked) }
    ]
  })
}

// ── row & menu actions ────────────────────────────────────────────────────

export function runRowAction(action: RowAction, d: DriveView): void {
  switch (action) {
    case 'open':
      return openDrive(d)
    case 'cancel':
      if (d.isPlaceholder) return void cancelTransfer(d)
      return confirmCancel(d)
    case 'resume':
      return resumeInterrupted(d)
    case 'retry':
      if (d.kind === 'download' && d.status === 'missing') return void redownload(d)
      return void resumeDrive(d)
    case 'reshare':
      return void reshare(d)
    case 'clear':
      return confirmRemove(d)
    case 'search':
      return searchNow(d.id)
  }
}

async function resumeDrive(d: DriveView) {
  // Flip to "Initiating" BEFORE asking: the announce can land while the
  // resume call is still returning, and must not be overwritten afterwards.
  // Resume means seeding (either direction), so it must announce again.
  const previous = d.status
  drivesStore().setAnnounced(d.id, false)
  drivesStore().patch(d.id, { status: 'initiating' })
  armInitiatingWatchdog(d.id)
  const res = await api().transfers.resume(d.id)
  if (!res.success) {
    clearInitiatingWatchdog(d.id)
    drivesStore().patch(d.id, { status: previous })
    toast.error(res.error || 'Could not resume')
  }
}

export async function runMenuAction(action: MenuAction, d: DriveView): Promise<void> {
  const ui = uiStore()
  switch (action) {
    case 'favorite': {
      const now = !useMetaStore.getState().favorites.has(d.id)
      await useMetaStore.getState().setFavorite(d.id, now)
      toast.success(now ? 'Added to Favorites' : 'Removed from Favorites')
      return
    }
    case 'copy-link':
      if (!d.shareLink) return toast.error('No share link yet')
      await copyText(d.shareLink)
      return
    case 'show-qr':
      if (!d.shareLink) return toast.error('No share link yet')
      ui.openModal({ type: 'share-link', link: d.shareLink, title: titleOf(d) })
      return
    case 'rename':
      ui.openModal({ type: 'rename', driveId: d.id })
      return
    case 'properties':
      ui.openModal({ type: 'info', driveId: d.id })
      return
    case 'view-files':
      ui.openModal({ type: 'folder', driveId: d.id })
      return
    case 'show-in-folder': {
      const p = d.files.find((f) => f.path)?.path
      if (p) await api().files.reveal(p)
      return
    }
    case 'resume':
      return resumeDrive(d)
    case 'pause': {
      const res = await api().transfers.pause(d.id)
      if (!res.success) return toast.error(res.error || 'Could not stop sharing')
      drivesStore().setAnnounced(d.id, false)
      clearInitiatingWatchdog(d.id)
      drivesStore().patch(d.id, { status: 'inactive', speed: 0 })
      return
    }
    case 'remove':
      return confirmRemove(d)
  }
}

// ── bulk actions (list options menu) ─────────────────────────────────────

export async function stopAllSharing() {
  const targets = Object.values(drivesStore().drives).filter((d) => d.status === 'sharing' || d.status === 'initiating')
  if (!targets.length) return toast.info('Nothing is being shared')
  let n = 0
  for (const d of targets) {
    const res = await api().transfers.pause(d.id).catch(() => null)
    if (res?.success) {
      drivesStore().setAnnounced(d.id, false)
      clearInitiatingWatchdog(d.id)
      drivesStore().patch(d.id, { status: 'inactive', speed: 0 })
      n++
    }
  }
  toast.success(`Stopped ${n} share${n !== 1 ? 's' : ''}`)
}

export async function resumeAll() {
  const targets = Object.values(drivesStore().drives).filter((d) => d.status === 'inactive')
  if (!targets.length) return toast.info('Nothing to resume')
  for (const d of targets) await resumeDrive(d)
  toast.success(`Resuming ${targets.length} item${targets.length !== 1 ? 's' : ''}`)
}

export function confirmClearCompleted() {
  const clearable = Object.values(drivesStore().drives).filter(isClearable)
  if (!clearable.length) return toast.info('Nothing to clear')
  const shares = clearable.filter((d) => d.kind === 'share').length
  const downloads = clearable.length - shares
  const parts = [downloads && `${downloads} download${downloads !== 1 ? 's' : ''}`, shares && `${shares} share${shares !== 1 ? 's' : ''}`].filter(Boolean)
  uiStore().openModal({
    type: 'confirm',
    title: 'Clear list?',
    message:
      `This removes ${parts.join(' and ')} from the list. Downloaded files stay on disk.` +
      (shares ? ' Shares stop being available to anyone holding their link.' : ''),
    buttons: [
      { label: 'Cancel', variant: 'secondary' },
      {
        label: `Clear ${clearable.length} item${clearable.length !== 1 ? 's' : ''}`,
        variant: shares ? 'danger' : 'primary',
        onSelect: async () => {
          let n = 0
          for (const d of clearable) {
            const res = await api().transfers.remove(d.id, { deleteFiles: false }).catch(() => null)
            if (res?.success !== false) {
              drivesStore().remove(d.id)
              n++
            }
          }
          toast.success(`Cleared ${n} item${n !== 1 ? 's' : ''}`)
        }
      }
    ]
  })
}
