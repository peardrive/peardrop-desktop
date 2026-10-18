/**
 * Sharing: staging files, building shares, cancelling builds.
 *
 * Flow: files are staged (picker, drop anywhere, drop on the Add Files card)
 * → `startShare()` snapshots the staged list, starts a job and calls the
 * backend → on success a solo share opens the Share Link modal, while a
 * multi-share batch keeps its rows in the Send modal so every link can be
 * copied.
 */
import type { ShareSource } from '@shared/transfer'
import type { DriveView } from '../lib/drive-model'
import { api, pathForFile } from '../services/client'
import { jobsStore } from '../stores/share-jobs-store'
import { stagedStore } from '../stores/staged-files-store'
import { toast } from '../stores/toast-store'
import { uiStore } from '../stores/ui-store'
import { drivesStore } from '../stores/drives-store'
import { upsertRecord } from './library'

/** Stat paths in main (expanding folders) and add them to the staged list. */
export async function stagePaths(paths: string[]): Promise<void> {
  const clean = paths.filter(Boolean)
  if (!clean.length) return
  const staged = stagedStore()
  staged.setLoading(true)
  try {
    const stats = await api().files.stat(clean)
    if (!stats.length) toast.error('Could not read those files')
    staged.addFiles(stats)
  } catch {
    toast.error('Error reading files')
  } finally {
    staged.setLoading(false)
  }
}

/** Stage DOM Files from a drop/input. */
export function stageFiles(files: FileList | File[]): Promise<void> {
  return stagePaths(Array.from(files).map(pathForFile))
}

/** Native picker → staged list. */
export async function pickFiles(): Promise<void> {
  const paths = await api().files.pick()
  if (paths.length) await stagePaths(paths)
}

/**
 * A drop anywhere in the window: open Send (stepping aside from a running
 * build's progress screen so the new files are visible) and stage them.
 */
export function handleWindowDrop(files: FileList | File[]): void {
  if (!files.length) return
  yieldForNewFiles()
  if (!uiStore().isOpen('send')) uiStore().openModal({ type: 'send' })
  void stageFiles(files)
}

/**
 * The user wants to send something else while builds run: demote the
 * progress screen to the background pill (a settled batch is dropped — its
 * shares are already in the list with their links).
 */
export function yieldForNewFiles(): void {
  const jobs = jobsStore()
  if (jobs.settled) jobs.reset()
  else if (jobs.jobs.some((j) => j.state === 'building')) jobs.setBackgrounded(true)
}

/** Open the Send modal from the top bar. */
export function openSend(): void {
  yieldForNewFiles()
  if (!uiStore().isOpen('send')) uiStore().openModal({ type: 'send' })
}

const sameSelection = (a: ShareSource[], b: ShareSource[]) => a.length === b.length && a.every((f, i) => f.path === b[i]?.path)

/** Build a share from the staged files. */
export async function startShare(): Promise<void> {
  // Snapshot: the user may stage new files while this build runs.
  const files = stagedStore().files.slice()
  if (!files.length) return
  const name = files.length === 1 ? files[0].name : 'Folder'
  const jobId = jobsStore().begin({
    name,
    bytesTotal: files.reduce((n, f) => n + (f.size || 0), 0),
    filesTotal: files.reduce((n, f) => n + (f.type === 'folder' ? f.fileCount || 0 : 1), 0)
  })
  // Clear now so the modal can take new files; restored on failure below.
  if (sameSelection(stagedStore().files, files)) stagedStore().clear()

  try {
    const result = await api().transfers.share({ sources: files, name, clientJobId: jobId })
    if (result.success) {
      upsertRecord(result.record)
      jobsStore().finish(jobId, result.shareLink)
      const { jobs, settled } = jobsStore()
      // Solo share: hand over to the Share Link modal.
      if (!settled && !jobs.some((j) => j.state === 'building')) {
        uiStore().closeModalsOfType('send')
        uiStore().openModal({ type: 'share-link', link: result.shareLink, title: name })
      }
    } else {
      jobsStore().fail(jobId)
      if (!stagedStore().files.length) stagedStore().setFiles(files)
      if (result.cancelled) toast.info('Share cancelled')
      else toast.error(result.error || 'Share failed')
    }
  } catch (err) {
    jobsStore().fail(jobId)
    if (!stagedStore().files.length) stagedStore().setFiles(files)
    toast.error(`Share failed: ${(err as Error).message}`)
  }
}

/** Cancel one build (its startShare call then resolves as cancelled). */
export async function cancelJob(jobId: string): Promise<void> {
  const job = jobsStore().jobs.find((j) => j.id === jobId)
  if (job?.driveId) await api().transfers.cancelShare(job.driveId)
}

export async function cancelAllJobs(): Promise<void> {
  for (const job of jobsStore().jobs.filter((j) => j.state === 'building')) {
    if (job.driveId) await api().transfers.cancelShare(job.driveId).catch(() => undefined)
  }
}

/**
 * Rebuild a lost share from its source files. The old key died with its
 * storage, so this is honestly a NEW share with a new link.
 */
export async function reshare(drive: DriveView): Promise<void> {
  const files = drive.files.filter((f) => f.path)
  if (!files.length) return toast.error('No file paths recorded for this share')
  let present = files
  try {
    const exists = await api().files.exists(files.map((f) => f.path!))
    present = files.filter((f) => exists[f.path!] !== false)
  } catch {
    /* check unavailable — attempt anyway */
  }
  if (!present.length) return toast.error('Those files are no longer on this computer')
  toast.info(present.length < files.length ? `Re-sharing ${present.length} of ${files.length} files…` : 'Re-sharing…')
  const result = await api().transfers.share({
    sources: present.map((f) => ({ name: f.name, path: f.path!, size: f.size, type: 'file' as const })),
    name: present.length === 1 ? present[0].name : 'Folder'
  })
  if (!result.success) return void toast.error(result.error || 'Could not re-share')
  // Drop the dead row only once the new share exists.
  await api().transfers.remove(drive.id, { deleteFiles: false })
  drivesStore().remove(drive.id)
  upsertRecord(result.record)
  toast.success('Shared again — this is a new link')
}
