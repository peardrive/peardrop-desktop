/**
 * drives-state.json: the persistent list of every drive, shared or
 * downloaded. It is the single source of truth for what resumes on startup.
 *
 * Loading is deliberately simple and never destructive:
 *   1. A valid file is used as it is; entries are never pruned.
 *   2. A missing file means an empty list (first run).
 *   3. A corrupt file is backed up next to itself, then the list starts empty.
 *   4. Drive folders on disk are never touched while loading.
 *
 * Saves are atomic (temp file + rename) and queued one after another.
 */
import fs from 'node:fs/promises'
import path from 'node:path'
import {
  DriveState,
  type DriveFileEntry,
  type DrivesState,
  type DriveStateValue,
  type ManifestDriveEntry
} from './types'

/** What callers pass to add a drive; missing fields get defaults. */
export interface AddDriveEntryInput {
  driveId?: string
  /** Same as driveId; either may be given. */
  id?: string
  key?: string
  discoveryKey?: string
  state?: DriveStateValue
  files?: DriveFileEntry[]
  totalBytes?: number
  localPath?: string | null
  storagePath?: string
  name?: string | null
  shareLink?: string
  createdAt?: number
  isUpload?: boolean
  stats?: Partial<NonNullable<ManifestDriveEntry['stats']>>
  /** Accepted for callers' convenience; not stored. */
  lastAttempt?: number
}

export interface RemoveDriveEntryOptions {
  /** Delete the drive's files on disk (downloads only; callers enforce that). */
  deleteFiles?: boolean
  /** Delete the drive's Corestore folder. */
  deleteStorage?: boolean
}

function emptyState(): DrivesState {
  return {
    drives: {},
    stats: { totalCreated: 0, totalPurged: 0, totalBytesShared: 0 }
  }
}

export class ManifestStore {
  state: DrivesState = emptyState()

  private savePromise: Promise<void> = Promise.resolve()

  constructor(
    private readonly manifestPath: string,
    private readonly drivesDir: string
  ) {}

  get drives(): Record<string, ManifestDriveEntry> {
    return this.state.drives
  }

  get stats(): DrivesState['stats'] {
    return this.state.stats
  }

  async load(): Promise<void> {
    try {
      const data = await fs.readFile(this.manifestPath, 'utf8')
      const parsed = JSON.parse(data) as DrivesState

      if (!parsed || typeof parsed.drives !== 'object' || parsed.drives === null) {
        throw new Error('Invalid manifest structure')
      }

      parsed.stats = parsed.stats || emptyState().stats
      this.state = parsed
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        console.log('[HyperdriveManager] No manifest found - starting fresh')
      } else {
        await this.backUpCorruptFile(error as Error)
      }
      this.state = emptyState()
    }

    console.log('[HyperdriveManager] Manifest loaded', { drives: Object.keys(this.drives).length })
  }

  private async backUpCorruptFile(error: Error): Promise<void> {
    const backupPath = `${this.manifestPath}.corrupted.${Date.now()}`

    try {
      await fs.copyFile(this.manifestPath, backupPath)
      console.warn('[HyperdriveManager] Manifest unreadable - backed up to', backupPath)
    } catch {
      console.warn('[HyperdriveManager] Manifest unreadable - could not back it up', error.message)
    }
  }

  /**
   * Write the list to disk. Saves are queued, so concurrent callers never
   * interleave writes to the temp file; the promise resolves after this
   * caller's write.
   */
  save(): Promise<void> {
    this.savePromise = this.savePromise
      .catch(() => {})
      .then(() => this.writeAtomic())

    return this.savePromise
  }

  /**
   * Write to a temp file, then rename. rename() is atomic on one file
   * system, so a crash can never leave a truncated drives-state.json.
   */
  private async writeAtomic(): Promise<void> {
    const tmpPath = `${this.manifestPath}.tmp`

    try {
      await fs.writeFile(tmpPath, JSON.stringify(this.state, null, 2))
      await fs.rename(tmpPath, this.manifestPath)
    } catch (error) {
      console.error('[HyperdriveManager] Failed to save manifest', error)
      try {
        await fs.rm(tmpPath, { force: true })
      } catch {
        // Nothing left to clean up.
      }
    }
  }

  /** Delete drives left in CREATING by an interrupted share build. */
  async removeIncompleteDrives(): Promise<void> {
    for (const [driveId, entry] of Object.entries(this.drives)) {
      if (entry.state !== DriveState.CREATING) {
        continue
      }

      console.log('[HyperdriveManager] Cleaning up incomplete drive', { driveId })

      try {
        if (entry.storagePath) {
          await fs.rm(entry.storagePath, { recursive: true, force: true })
        }
      } catch {
        // Ignore: the entry goes either way.
      }

      delete this.drives[driveId]
      this.stats.totalPurged++
    }

    await this.save()
  }

  get(driveId: string): ManifestDriveEntry | null {
    return this.drives[driveId] || null
  }

  all(): ManifestDriveEntry[] {
    return Object.values(this.drives)
  }

  /** Find a drive by its key, e.g. to spot a link that was already opened. */
  getByKey(key: string): ManifestDriveEntry | null {
    if (!key) {
      return null
    }

    const wanted = key.toLowerCase()
    return this.all().find((entry) => entry.key?.toLowerCase() === wanted) || null
  }

  /** Add or replace a drive's entry and save. */
  async add(input: AddDriveEntryInput): Promise<ManifestDriveEntry> {
    const driveId = (input.id || input.driveId) as string

    const entry: ManifestDriveEntry = {
      driveId,
      key: input.key,
      discoveryKey: input.discoveryKey,
      state: input.state || DriveState.ACTIVE,

      files: input.files || [],
      totalBytes: input.totalBytes || 0,
      localPath: input.localPath || null,
      storagePath: input.storagePath || path.join(this.drivesDir, driveId),

      name: input.name || 'Untitled Share',
      shareLink: input.shareLink || `peardrop://${input.key}`,

      createdAt: input.createdAt || Date.now(),
      isUpload: input.isUpload || false,

      stats: {
        uploaded: 0,
        downloaded: 0,
        peers: 0,
        ...input.stats
      }
    }

    this.drives[driveId] = entry
    await this.save()

    console.log('[HyperdriveManager] Drive entry added', { id: driveId, name: entry.name })
    return entry
  }

  /** Remove a drive's entry, optionally deleting its storage and files. */
  async remove(driveId: string, opts: RemoveDriveEntryOptions = {}): Promise<boolean> {
    const entry = this.drives[driveId]
    if (!entry) {
      console.log('[HyperdriveManager] Remove entry: not found', { id: driveId })
      return false
    }

    console.log('[HyperdriveManager] Removing drive entry', {
      id: driveId,
      name: entry.name,
      deleteFiles: opts.deleteFiles,
      deleteStorage: opts.deleteStorage
    })

    if (opts.deleteStorage && entry.storagePath) {
      try {
        await fs.rm(entry.storagePath, { recursive: true, force: true })
        console.log('[HyperdriveManager] Storage deleted', { path: entry.storagePath })
      } catch (err) {
        console.warn('[HyperdriveManager] Storage delete failed:', (err as Error).message)
      }
    }

    if (opts.deleteFiles && entry.files) {
      await deleteFiles(entry.files)
    }

    delete this.drives[driveId]
    await this.save()

    console.log('[HyperdriveManager] Drive entry removed completely', { id: driveId })
    return true
  }

  /**
   * Mark a drive as paused. The caller stops the network side with
   * stopDrive, which persists PAUSED itself; this keeps the two consistent.
   */
  async pause(driveId: string): Promise<ManifestDriveEntry | null> {
    const entry = this.drives[driveId]
    if (!entry) {
      return null
    }

    entry.state = DriveState.PAUSED
    entry.pausedAt = Date.now()
    await this.save()

    console.log('[HyperdriveManager] Drive entry paused', { id: driveId, name: entry.name })
    return entry
  }

  /** Whether the first local file of a drive still exists. */
  async hasLocalFiles(driveId: string): Promise<boolean> {
    const firstPath = this.drives[driveId]?.files?.[0]?.path
    if (!firstPath) {
      return false
    }

    try {
      await fs.access(firstPath)
      return true
    } catch {
      return false
    }
  }
}

async function deleteFiles(files: DriveFileEntry[]): Promise<void> {
  for (const file of files) {
    if (!file.path) {
      continue
    }

    try {
      await fs.unlink(file.path)
      console.log('[HyperdriveManager] File deleted', { path: file.path })
    } catch (err) {
      console.warn('[HyperdriveManager] File delete failed:', (err as Error).message)
    }
  }
}
