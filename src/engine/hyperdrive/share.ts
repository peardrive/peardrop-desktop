/**
 * Creating a share: copy the files into a new drive, add the PearDrop
 * manifest, then start seeding it.
 */
import { createReadStream } from 'node:fs'
import fs from 'node:fs/promises'
import path from 'node:path'
import Corestore from 'corestore'
import Hyperdrive from 'hyperdrive'
import type { EngineContext } from './context'
import { buildDriveManifest, DRIVE_MANIFEST_PATH } from './drive-manifest'
import { startSeeding } from './seeding'
import { createShareLink } from './share-link'
import {
  DriveState,
  type CreateDriveOptions,
  type CreateDriveResult,
  type DriveFileEntry,
  type DriveSession,
  type ManagerEvents,
  type ManifestDriveEntry,
  type ShareSourceFile
} from './types'

/** Minimum time between two 'share-progress' events while a file is copied. */
const PROGRESS_THROTTLE_MS = 100

/** Thrown when the user cancels a share build. */
export interface ShareCancelledSignal extends Error {
  cancelled: true
}

function shareCancelledError(): ShareCancelledSignal {
  const err = new Error('Share cancelled') as ShareCancelledSignal
  err.cancelled = true
  return err
}

function isCancelled(err: unknown): boolean {
  return !!(err as { cancelled?: boolean } | null)?.cancelled
}

function generateDriveId(): string {
  return `drive_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`
}

/**
 * Build a new share from local files and start seeding it.
 *
 * Emits 'share-started' once, 'share-progress' while copying, then
 * 'drive-created'. A cancelled build (see HyperdriveManager.cancelShare)
 * leaves no trace and rejects with `err.cancelled === true`.
 */
export async function createShare(
  ctx: EngineContext,
  files: ShareSourceFile[],
  options: CreateDriveOptions = {}
): Promise<CreateDriveResult> {
  const driveId = generateDriveId()
  const drivePath = path.join(ctx.drivesDir, driveId)

  console.log('[HyperdriveManager] Creating drive', { driveId, fileCount: files.length })

  // Lets the renderer match this build to the job it already drew: the
  // driveId only becomes known here, and clientJobId is echoed back.
  ctx.emitEvent('share-started', {
    driveId,
    clientJobId: options.clientJobId || null,
    name: options.name || null,
    filesTotal: files.length,
    bytesTotal: options.totalBytes || 0
  })

  const store = new Corestore(drivePath)
  await store.ready()

  const drive = new Hyperdrive(store)
  await drive.ready()

  const key = drive.key.toString('hex')

  // Recorded BEFORE copying files, so an interrupted build can be cleaned up.
  const metadata: ManifestDriveEntry = {
    driveId,
    key,
    discoveryKey: drive.discoveryKey.toString('hex'),
    state: DriveState.CREATING,
    createdAt: Date.now(),
    ttlMs: options.ttlMs || 0,
    expiresAt: options.ttlMs ? Date.now() + options.ttlMs : null,
    name: options.name || `Share ${driveId.slice(0, 8)}`,
    files: [],
    totalBytes: 0,
    storagePath: drivePath
  }

  ctx.store.drives[driveId] = metadata
  ctx.store.stats.totalCreated++
  await ctx.store.save()

  try {
    const { fileEntries, totalBytes } = await copyFilesIntoDrive(ctx, {
      driveId,
      drive,
      files,
      bytesTotal: options.totalBytes || 0
    })

    // Placeholder name for a multi-file share is "Folder": a count would
    // repeat the card's detail row and make every multi-file share look alike.
    const manifest = buildDriveManifest({
      name: options.name || (files.length === 1 ? fileEntries[0].name : 'Folder'),
      files: fileEntries.map((f) => ({ storagePath: f.storagePath as string, name: f.name, size: f.size })),
      totalBytes
    })

    await drive.put(DRIVE_MANIFEST_PATH, Buffer.from(JSON.stringify(manifest)))
    console.log('[HyperdriveManager] Added manifest', { totalBytes, files: fileEntries.length })

    metadata.files = fileEntries
    metadata.totalBytes = totalBytes
    metadata.state = DriveState.ACTIVE
    ctx.store.stats.totalBytesShared += totalBytes
    await ctx.store.save()

    const { swarm, trackerHandlers } = startSeeding(ctx, {
      driveId,
      drive,
      store,
      totalBytes,
      resumed: false
    })

    const session: DriveSession = {
      driveId,
      drive,
      store,
      swarm,
      metadata,
      totalBytes,
      createdAt: Date.now(),
      trackerHandlers
    }
    ctx.activeDrives.set(driveId, session)

    if (options.ttlMs && options.ttlMs > 0) {
      session.expirationTimer = setTimeout(() => {
        console.log('[HyperdriveManager] Drive expired', { driveId })
        void ctx.stopDrive(driveId, { delete: true })
      }, options.ttlMs)
    }

    const shareLink = createShareLink(key)

    console.log('[HyperdriveManager] Drive created and sharing', {
      driveId,
      shareLink,
      files: fileEntries.length,
      totalBytes
    })

    ctx.cancelledShares.delete(driveId)
    ctx.emitEvent('drive-created', { driveId, shareLink, metadata })

    return { driveId, shareLink, key }
  } catch (error) {
    ctx.cancelledShares.delete(driveId)

    if (isCancelled(error)) {
      await discardCancelledShare(ctx, { driveId, drivePath, drive, store })
      throw error
    }

    console.error('[HyperdriveManager] Failed to create drive', error)
    metadata.state = DriveState.ERRORED
    metadata.error = (error as Error).message
    await ctx.store.save()

    await drive.close()
    await store.close()

    throw error
  }
}

/** Copy every file into the drive, checking for cancellation as it goes. */
async function copyFilesIntoDrive(
  ctx: EngineContext,
  opts: {
    driveId: string
    drive: Hyperdrive
    files: ShareSourceFile[]
    bytesTotal: number
  }
): Promise<{ fileEntries: DriveFileEntry[]; totalBytes: number }> {
  const { driveId, files } = opts
  const fileEntries: DriveFileEntry[] = []
  let totalBytes = 0

  for (const file of files) {
    // Between files: the only check that matters for many small files.
    if (ctx.cancelledShares.has(driveId)) {
      throw shareCancelledError()
    }

    const fileName = file.name || path.basename(file.path)
    // relativePath keeps folder structure; otherwise just the file name.
    const storagePath = file.relativePath || fileName
    const { size: fileSize } = await fs.stat(file.path)

    await copyOneFile(ctx, {
      driveId,
      drive: opts.drive,
      sourcePath: file.path,
      storagePath,
      onBytes: (fileBytesDone) => ({
        driveId,
        filesDone: fileEntries.length,
        filesTotal: files.length,
        bytesDone: totalBytes + fileBytesDone,
        bytesTotal: opts.bytesTotal,
        currentFile: fileName
      })
    })

    totalBytes += fileSize
    fileEntries.push({ name: fileName, storagePath, size: fileSize, addedAt: Date.now() })

    // Bytes, not file count: one big file among many small ones would park
    // a count-based bar at 99% for most of the wait.
    ctx.emitEvent('share-progress', {
      driveId,
      filesDone: fileEntries.length,
      filesTotal: files.length,
      bytesDone: totalBytes,
      bytesTotal: opts.bytesTotal,
      currentFile: fileName
    })

    console.log('[HyperdriveManager] Added file', { storagePath, size: fileSize })
  }

  return { fileEntries, totalBytes }
}

/**
 * Stream one file into the drive (never loads it into memory), emitting
 * throttled progress so a single large file does not sit at 0% until done.
 */
async function copyOneFile(
  ctx: EngineContext,
  opts: {
    driveId: string
    drive: Hyperdrive
    sourcePath: string
    storagePath: string
    /** Builds the progress event for the bytes copied of this file so far. */
    onBytes: (fileBytesDone: number) => ManagerEvents['share-progress']
  }
): Promise<void> {
  const readStream = createReadStream(opts.sourcePath)
  const writeStream = opts.drive.createWriteStream(`/${opts.storagePath}`)

  let fileBytesDone = 0
  let sentAt = 0

  await new Promise<void>((resolve, reject) => {
    readStream.on('data', (chunk: Buffer | string) => {
      // Mid-file: without this a large file could not be interrupted.
      if (ctx.cancelledShares.has(opts.driveId)) {
        readStream.destroy()
        writeStream.destroy()
        reject(shareCancelledError())
        return
      }

      fileBytesDone += chunk.length

      const now = Date.now()
      if (now - sentAt < PROGRESS_THROTTLE_MS) {
        return
      }
      sentAt = now

      ctx.emitEvent('share-progress', opts.onBytes(fileBytesDone))
    })

    readStream.pipe(writeStream)
    writeStream.on('finish', resolve)
    writeStream.on('error', reject)
    readStream.on('error', reject)
  })
}

/**
 * A cancelled build leaves NO trace: an ERRORED entry would show up as a
 * failed share the user never made.
 */
async function discardCancelledShare(
  ctx: EngineContext,
  opts: { driveId: string; drivePath: string; drive: Hyperdrive; store: Corestore }
): Promise<void> {
  console.log('[HyperdriveManager] Share cancelled, removing partial drive', { driveId: opts.driveId })

  try {
    await opts.drive.close()
  } catch {
    // Already closed.
  }
  try {
    await opts.store.close()
  } catch {
    // Already closed.
  }

  delete ctx.store.drives[opts.driveId]
  await ctx.store.save()

  try {
    await fs.rm(opts.drivePath, { recursive: true, force: true })
  } catch (rmErr) {
    console.warn('[HyperdriveManager] Could not remove cancelled drive folder', (rmErr as Error).message)
  }
}
