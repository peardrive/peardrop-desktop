/**
 * Downloads the files of an open remote drive to disk.
 *
 * Security: every file key comes from the remote peer and goes through
 * safeJoin, so nothing is written outside the download folder.
 * Reliability: the file listing and every file have a stall watchdog, so a
 * sender that disappears mid-transfer fails the download instead of hanging.
 */
import { createWriteStream } from 'node:fs'
import fs from 'node:fs/promises'
import path from 'node:path'
import type { Readable } from 'node:stream'
import type Hyperdrive from 'hyperdrive'
import { EngineError, FileStallError, PathTraversalError } from '../engine-errors'
import {
  ensureDir,
  formatBytes,
  formatSpeed,
  getUniqueFilePath,
  getUniqueFolderPath,
  safeJoin,
  sanitizeFolderName
} from '../file-utils'
import { DRIVE_MANIFEST_PATH } from './drive-manifest'

/** Give up on the file list or a file after this long without data. */
const STALL_TIMEOUT_MS = 60_000

/** Minimum time between two byte-based progress updates. */
const PROGRESS_THROTTLE_MS = 100

export interface DownloaderProgress {
  /** 0–100, or -1 when the total size is unknown. */
  percent: number
  bytesTransferred: number
  totalBytes: number
  speed: number
  bytesFormatted: string
  totalFormatted: string
  speedFormatted: string
}

export interface DownloadedFile {
  name: string
  path: string
  size: number
  /** The in-drive key this file came from, used to resume into the same path. */
  key?: string
}

export interface FailedFile {
  key: string
  error: string
}

export interface DownloadFromDriveResult {
  files: DownloadedFile[]
  failed: FailedFile[]
  totalBytes: number
  duration: number
  /** The folder actually written to (after "(1)" disambiguation). */
  destDir: string
}

export interface DownloadFromDriveOptions {
  destDir: string
  /** Expected total bytes, from the manifest (of the selected files, if any). */
  totalBytes?: number
  shareName?: string | null
  /** When non-empty, only these drive keys are fetched. */
  fileNames?: string[] | null
  onProgress?: (data: DownloaderProgress) => void
  onComplete?: (data: DownloadFromDriveResult) => void
  onError?: (data: { file: string; error: string }) => void
  onPeerConnected?: (data: { shareName: string | null; totalBytes: number }) => void
  /** Called once the destination folder is known, before any file is written. */
  onRoot?: (root: string, isOwnFolder: boolean) => void
  /** Receives an abort function for whatever is in flight right now. */
  registerAborter?: (abort: () => void) => void
  /** Checked before each file and between chunks; true aborts the download. */
  isCancelled?: () => boolean
  /** Drive key → absolute path written by a previous attempt at this drive. */
  resumePaths?: Record<string, string> | null
  /** Folder a previous attempt at this drive wrote into. */
  resumeRoot?: string | null
}

/** Thrown when the download is cancelled; carries what was already written. */
export interface DownloadCancelledError extends Error {
  cancelled: true
  partialFiles?: DownloadedFile[]
  downloadRoot?: string | null
}

function cancelledError(partialFiles?: DownloadedFile[], downloadRoot?: string | null): DownloadCancelledError {
  const err = new Error('Download cancelled') as DownloadCancelledError
  err.cancelled = true
  if (partialFiles !== undefined) err.partialFiles = partialFiles
  if (downloadRoot !== undefined) err.downloadRoot = downloadRoot
  return err
}

function isCancelledError(err: unknown): err is DownloadCancelledError {
  return !!(err as { cancelled?: boolean } | null)?.cancelled
}

/** Drive keys compare without their leading slash (mirrors mobile's normalizeKey). */
function normalizeKey(key: string): string {
  return String(key || '').replace(/^\//, '')
}

const noop = () => {}

/**
 * Download every file (or the selected ones) from a drive.
 *
 * @throws DownloadCancelledError when cancelled (with partialFiles/downloadRoot),
 *   FileStallError when the sender never sends the file list, and a
 *   'receive.empty-drive' EngineError when a selection matches nothing.
 */
export async function downloadFromDrive(
  drive: Hyperdrive,
  options: DownloadFromDriveOptions
): Promise<DownloadFromDriveResult> {
  const {
    destDir,
    totalBytes: knownTotalBytes = 0,
    shareName = null,
    fileNames = null,
    onProgress = noop,
    onComplete = noop,
    onError = noop,
    onPeerConnected = noop,
    onRoot = noop,
    registerAborter = noop,
    isCancelled = () => false,
    resumePaths = null,
    resumeRoot = null
  } = options

  const startTime = Date.now()
  const downloadedFiles: DownloadedFile[] = []
  const failedFiles: FailedFile[] = []

  const wantedKeys = Array.isArray(fileNames) && fileNames.length
    ? new Set(fileNames.map(normalizeKey))
    : null

  const fileKeys = await listFilesToDownload(drive, { wantedKeys, isCancelled, registerAborter })

  // A selection was passed but matched nothing. (Without a selection, an
  // empty drive keeps returning an empty result, as before.)
  if (wantedKeys && fileKeys.length === 0) {
    throw new EngineError({
      category: 'receive.empty-drive',
      cause: 'no-files-selected',
      message: 'No files in drive.',
      detail: { requested: fileNames!.length }
    })
  }

  console.log('[Downloader] Starting download:', {
    files: fileKeys.length,
    totalBytes: knownTotalBytes,
    shareName
  })
  onPeerConnected({ shareName, totalBytes: knownTotalBytes })

  const progress = await trackByteProgress(drive, { startTime, knownTotalBytes, onProgress })

  const downloadRoot = await resolveDownloadRoot({ destDir, shareName, fileCount: fileKeys.length, resumeRoot })
  await ensureDir(downloadRoot)

  try {
    onRoot(downloadRoot, downloadRoot !== destDir)
  } catch {
    // A callback failing is never fatal.
  }
  console.log('[Downloader] Download root:', { downloadRoot, shareName })

  const ownFolder = downloadRoot !== destDir ? downloadRoot : null
  let filesCompleted = 0

  for (const key of fileKeys) {
    // Between files: carry what was written so the caller can delete it.
    if (isCancelled()) {
      throw cancelledError(downloadedFiles.slice(), ownFolder)
    }

    // Declared outside the try so the catch can remove a partial file.
    let filePath: string | null = null

    try {
      filePath = await targetPathFor(key, { downloadRoot, resumePaths })
      const size = await streamFileToDisk(drive, key, filePath, { isCancelled, registerAborter })

      downloadedFiles.push({ name: path.basename(filePath), path: filePath, size, key })
      console.log('[Downloader] Downloaded:', path.basename(filePath), formatBytes(size))
    } catch (fileErr) {
      if (isCancelledError(fileErr)) {
        // The partial file never made it into downloadedFiles, so nothing
        // downstream knows it exists: remove it here.
        if (filePath) {
          await removePartialFile(filePath)
        }
        fileErr.partialFiles = downloadedFiles.slice()
        fileErr.downloadRoot = ownFolder
        throw fileErr
      }

      const message = (fileErr as Error).message
      console.error('[Downloader] Failed to download file:', key, message)
      failedFiles.push({ key, error: message })
      onError({ file: key, error: message })
      // Carry on with the other files.
    }

    filesCompleted++

    const speed = progress.speed()
    onProgress({
      percent: Math.round((filesCompleted / fileKeys.length) * 100),
      bytesTransferred: progress.bytes(),
      totalBytes: knownTotalBytes,
      speed,
      bytesFormatted: formatBytes(progress.bytes()),
      totalFormatted: `${filesCompleted}/${fileKeys.length} files`,
      speedFormatted: formatSpeed(speed)
    })
  }

  if (failedFiles.length > 0) {
    console.warn('[Downloader] Some files failed:', failedFiles)
  }

  const result: DownloadFromDriveResult = {
    files: downloadedFiles,
    failed: failedFiles,
    totalBytes: progress.bytes(),
    duration: Date.now() - startTime,
    destDir: downloadRoot
  }

  onComplete(result)
  console.log('[Downloader] Complete:', {
    files: downloadedFiles.length,
    failed: failedFiles.length,
    totalBytes: result.totalBytes,
    duration: result.duration
  })

  return result
}

/**
 * List the drive's files (minus the PearDrop manifest and anything not
 * selected).
 *
 * drive.list() waits for metadata blocks from the peer, so with the sender
 * offline it would block forever. It can be cancelled, and a stall watchdog
 * (reset on every entry, so a slow but live peer is never cut off) stops it
 * after STALL_TIMEOUT_MS of silence.
 */
async function listFilesToDownload(
  drive: Hyperdrive,
  opts: {
    wantedKeys: Set<string> | null
    isCancelled: () => boolean
    registerAborter: (abort: () => void) => void
  }
): Promise<string[]> {
  const listStream = drive.list('/')
  const destroyList = () => {
    try {
      listStream.destroy?.()
    } catch {
      // Already gone.
    }
  }

  opts.registerAborter(destroyList)

  // Destroying the stream ends the for-await instead of throwing, so this
  // flag is what tells us we stopped because of silence.
  let stalled = false
  const watchdog = createWatchdog(STALL_TIMEOUT_MS, () => {
    stalled = true
    destroyList()
  })
  watchdog.arm()

  const keys: string[] = []

  for await (const entry of listStream) {
    watchdog.arm()

    if (opts.isCancelled()) {
      throw cancelledError([], null)
    }
    if (entry.key === DRIVE_MANIFEST_PATH) {
      continue
    }
    if (opts.wantedKeys && !opts.wantedKeys.has(normalizeKey(entry.key))) {
      continue
    }

    keys.push(entry.key)
  }

  watchdog.clear()

  // The peer never sent the file list: fail loudly rather than report a
  // successful download of nothing.
  if (stalled) {
    throw new FileStallError(
      `stalled: no file list for ${STALL_TIMEOUT_MS / 1000}s (sender may be offline)`,
      { phase: 'list', timeoutMs: STALL_TIMEOUT_MS }
    )
  }

  // A cancel that destroyed the stream also ends the loop normally.
  if (opts.isCancelled()) {
    throw cancelledError([], null)
  }

  return keys
}

/**
 * Count bytes arriving on the blobs core and report throttled progress.
 * Returns accessors for the running totals.
 */
async function trackByteProgress(
  drive: Hyperdrive,
  opts: {
    startTime: number
    knownTotalBytes: number
    onProgress: (data: DownloaderProgress) => void
  }
): Promise<{ bytes: () => number; speed: () => number }> {
  let bytesDownloaded = 0
  let lastUpdate = 0

  const speed = () => {
    const elapsedSeconds = (Date.now() - opts.startTime) / 1000
    return elapsedSeconds > 0 ? bytesDownloaded / elapsedSeconds : 0
  }

  try {
    const blobs = await drive.getBlobs()

    if (blobs?.core) {
      console.log('[Downloader] Hooking into blobs core for progress')

      blobs.core.on('download', (_index: number, bytes: number) => {
        bytesDownloaded += bytes

        const now = Date.now()
        if (now - lastUpdate <= PROGRESS_THROTTLE_MS) {
          return
        }
        lastUpdate = now

        const total = opts.knownTotalBytes
        const currentSpeed = speed()
        // Capped at 99: 100 is reported once the last file is on disk.
        const percent = total > 0 ? Math.min(99, Math.round((bytesDownloaded / total) * 100)) : -1

        opts.onProgress({
          percent,
          bytesTransferred: bytesDownloaded,
          totalBytes: total,
          speed: currentSpeed,
          bytesFormatted: formatBytes(bytesDownloaded),
          totalFormatted: total > 0 ? formatBytes(total) : '—',
          speedFormatted: formatSpeed(currentSpeed)
        })
      })
    }
  } catch (err) {
    console.log('[Downloader] Could not hook blobs for progress:', (err as Error).message)
  }

  return { bytes: () => bytesDownloaded, speed }
}

/**
 * Multi-file (folder) shares get their own subfolder named after the share.
 * The name comes from the sender, so it is sanitized first; an empty result
 * means no subfolder.
 */
async function resolveDownloadRoot(opts: {
  destDir: string
  shareName: string | null
  fileCount: number
  resumeRoot: string | null
}): Promise<string> {
  const safeShareName = sanitizeFolderName(opts.shareName)
  const isFolderShare = opts.fileCount > 1 || (!!safeShareName && !safeShareName.includes('.'))

  if (!isFolderShare || !safeShareName) {
    return opts.destDir
  }

  // Resuming: continue in the folder we already filled, instead of
  // creating "name (1)" and fetching everything again.
  if (opts.resumeRoot) {
    console.log('[Downloader] Resuming into existing folder:', opts.resumeRoot)
    return opts.resumeRoot
  }

  // Fresh: two unrelated shares with the same name must not merge.
  return getUniqueFolderPath(path.join(opts.destDir, safeShareName))
}

/**
 * Where to write one file. Rejects keys that would escape the download
 * folder, reuses the path from a previous attempt when it is safely inside
 * this download's folder, and otherwise picks a name that does not exist yet.
 */
async function targetPathFor(
  key: string,
  opts: { downloadRoot: string; resumePaths: Record<string, string> | null }
): Promise<string> {
  const joined = safeJoin(opts.downloadRoot, key)
  if (!joined) {
    throw new PathTraversalError(
      `unsafe path outside download folder: ${key}`,
      { key, root: opts.downloadRoot }
    )
  }

  await ensureDir(path.dirname(joined))

  // RESUME: rewrite the same file instead of creating "movie (1).mkv" next
  // to the partial original. Hyperdrive already has the fetched blocks
  // locally, so this is cheap and leaves one correct file.
  const resumeTarget = opts.resumePaths?.[key]
  if (!resumeTarget) {
    return getUniqueFilePath(joined)
  }

  // Skipping getUniqueFilePath must not let one share overwrite another's
  // file, so the resume path has to be inside this download's folder.
  const rootPrefix = path.resolve(opts.downloadRoot) + path.sep
  if (path.resolve(resumeTarget).startsWith(rootPrefix)) {
    return resumeTarget
  }

  console.warn('[Downloader] Ignoring out-of-root resume path:', resumeTarget)
  return getUniqueFilePath(joined)
}

/**
 * Stream one file from the drive to disk (never loads it into memory).
 *
 * If the peer drops mid-transfer, a hyperdrive read stream waits forever for
 * blocks that never come, so a watchdog fails the file after
 * STALL_TIMEOUT_MS without data. Cancellation is checked between chunks and
 * can also be triggered at once through the registered aborter.
 *
 * @returns The number of bytes written.
 */
async function streamFileToDisk(
  drive: Hyperdrive,
  key: string,
  filePath: string,
  opts: {
    isCancelled: () => boolean
    registerAborter: (abort: () => void) => void
  }
): Promise<number> {
  const readStream: Readable = drive.createReadStream(key)
  const writeStream = createWriteStream(filePath)
  let fileSize = 0

  await new Promise<void>((resolve, reject) => {
    let settled = false

    const finish = (err?: Error) => {
      if (settled) {
        return
      }
      settled = true
      watchdog.clear()

      if (err) {
        readStream.destroy()
        writeStream.destroy()
        reject(err)
      } else {
        resolve()
      }
    }

    const watchdog = createWatchdog(STALL_TIMEOUT_MS, () => {
      finish(new FileStallError(
        `stalled: no data for ${STALL_TIMEOUT_MS / 1000}s (peer may have disconnected)`,
        { file: key, timeoutMs: STALL_TIMEOUT_MS }
      ))
    })

    opts.registerAborter(() => finish(cancelledError()))

    readStream.on('data', (chunk: Buffer) => {
      // Mid-file: without this, cancelling a multi-GB file streamed all of
      // it to disk before stopping.
      if (opts.isCancelled()) {
        finish(cancelledError())
        return
      }

      fileSize += chunk.length
      watchdog.arm()
    })

    readStream.on('error', (e) => finish(e))
    writeStream.on('error', (e) => finish(e))
    writeStream.on('finish', () => finish())

    readStream.pipe(writeStream)

    // Armed right away, in case no data ever arrives.
    watchdog.arm()
  })

  return fileSize
}

/**
 * Delete a partially written file. The write stream closes asynchronously,
 * and Windows refuses to delete an open file (EBUSY), so retry for ~600 ms.
 */
async function removePartialFile(filePath: string): Promise<void> {
  const attempts = 5

  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      await fs.rm(filePath, { force: true })
      console.log('[Downloader] Removed partial file on cancel:', filePath)
      return
    } catch (err) {
      const isLastAttempt = attempt === attempts - 1
      if (isLastAttempt) {
        console.warn('[Downloader] Could not remove partial:', filePath, (err as Error).message)
        return
      }
      await new Promise((r) => setTimeout(r, 120))
    }
  }
}

/** A timer that fires after `ms` of inactivity; `arm()` restarts it. */
function createWatchdog(ms: number, onStall: () => void): { arm: () => void; clear: () => void } {
  let timer: NodeJS.Timeout | null = null

  const clear = () => {
    if (timer) {
      clearTimeout(timer)
      timer = null
    }
  }

  const arm = () => {
    clear()
    timer = setTimeout(onStall, ms)
  }

  return { arm, clear }
}
