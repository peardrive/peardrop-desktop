/**
 * Bringing drives back after a restart (or a Resume click): shares re-open
 * their storage and seed again; downloads go back to seeking their sender.
 */
import fs from 'node:fs/promises'
import Corestore from 'corestore'
import Hyperdrive from 'hyperdrive'
import type { EngineContext } from './context'
import { resumeSeekingDrive } from './receive'
import { startSeeding } from './seeding'
import { DriveState, type ManifestDriveEntry } from './types'

/**
 * Resume every drive that was ACTIVE or SEEKING when the app last quit.
 *
 * A failure is NOT persisted as ERRORED: it is usually transient (a
 * corestore still locked by a closing instance), and persisting it used to
 * demote good drives for good. The state stays as it is so the next start
 * retries; the failure is kept in memory for the UI only.
 */
export async function resumeActiveDrives(
  ctx: EngineContext,
  resumeErrors: Map<string, { error: string; at: number }>
): Promise<void> {
  const toResume = Object.entries(ctx.store.drives).filter(([, entry]) => {
    return entry.state === DriveState.ACTIVE || entry.state === DriveState.SEEKING
  })

  if (toResume.length === 0) {
    return
  }

  console.log('[HyperdriveManager] Resuming active drives', { count: toResume.length })

  for (const [driveId, entry] of toResume) {
    try {
      await resumeSavedDrive(ctx, driveId, entry)
    } catch (err) {
      const message = (err as Error).message
      console.error('[HyperdriveManager] Failed to resume drive (will retry next boot)', {
        driveId,
        error: message
      })

      resumeErrors.set(driveId, { error: message, at: Date.now() })
      ctx.emitEvent('drive-resume-failed', { driveId, error: message })
    }
  }
}

/** Re-open one saved drive: a seeking download, or a share to seed again. */
export async function resumeSavedDrive(
  ctx: EngineContext,
  driveId: string,
  entry: ManifestDriveEntry
): Promise<void> {
  console.log('[HyperdriveManager] Resuming drive', { driveId, state: entry.state })

  if (entry.state === DriveState.SEEKING && entry.shareLink) {
    console.log('[HyperdriveManager] Resuming download in seeking state', { driveId })

    try {
      await resumeSeekingDrive(ctx, driveId, entry)
    } catch (error) {
      console.error('[HyperdriveManager] Failed to resume seeking download', {
        driveId,
        error: (error as Error).message
      })
      throw error
    }
    return
  }

  await resumeShare(ctx, driveId, entry)
}

async function resumeShare(ctx: EngineContext, driveId: string, entry: ManifestDriveEntry): Promise<void> {
  const drivePath = entry.storagePath as string

  try {
    await fs.access(drivePath)
  } catch {
    throw new Error('Storage directory missing')
  }

  const store = new Corestore(drivePath)
  await store.ready()

  const drive = new Hyperdrive(store, Buffer.from(entry.key as string, 'hex'))
  await drive.ready()

  if (drive.key.toString('hex') !== entry.key) {
    await drive.close()
    await store.close()
    throw new Error('Drive key mismatch')
  }

  const { swarm, trackerHandlers } = startSeeding(ctx, {
    driveId,
    drive,
    store,
    totalBytes: entry.totalBytes,
    resumed: true
  })

  ctx.activeDrives.set(driveId, {
    driveId,
    drive,
    store,
    swarm,
    metadata: entry,
    totalBytes: entry.totalBytes,
    createdAt: entry.createdAt,
    resumedAt: Date.now(),
    trackerHandlers
  })

  console.log('[HyperdriveManager] Drive resumed', {
    driveId,
    files: entry.files?.length,
    totalBytes: entry.totalBytes
  })
}
