/**
 * The PearDrop manifest: a small JSON file (`/.peardrop.json`) stored inside
 * every shared drive, listing the share's name and files. Receivers read it
 * to show the file list before downloading.
 */
import path from 'node:path'
import type Hyperdrive from 'hyperdrive'
import { computeTruncation, type TruncationHint } from '../file-utils'
import type { RemoteFile } from './types'

export const DRIVE_MANIFEST_PATH = '/.peardrop.json'
export const DRIVE_MANIFEST_VERSION = 1

/** Larger manifests are ignored: the content comes from a remote peer. */
export const DRIVE_MANIFEST_MAX_SIZE = 64 * 1024

/** At most this many files are listed from a remote manifest. */
export const DRIVE_MANIFEST_MAX_FILES = 1000

export interface DriveManifest {
  version: number
  name: string
  created: number
  files: Array<{ path: string; name: string; size: number }>
  totalBytes: number
  totalFiles: number
}

/** What a receiver knows about a share once its metadata has replicated. */
export interface ShareContents {
  manifest: DriveManifest | null
  files: RemoteFile[]
  shareName: string | null
  totalBytes: number
  truncated: TruncationHint | null
}

/** Build the manifest for a share made of the given files. */
export function buildDriveManifest(opts: {
  name: string
  files: Array<{ storagePath: string; name: string; size: number }>
  totalBytes: number
}): DriveManifest {
  return {
    version: DRIVE_MANIFEST_VERSION,
    name: opts.name,
    created: Date.now(),
    files: opts.files.map((f) => ({
      path: `/${f.storagePath}`,
      name: f.name,
      size: f.size
    })),
    totalBytes: opts.totalBytes,
    totalFiles: opts.files.length
  }
}

/**
 * Read a remote share's name and file list.
 *
 * Uses the PearDrop manifest when it is present, valid and within the size
 * limit; otherwise lists the drive directly. Only call this once a peer has
 * connected: reading earlier waits on data that may never come.
 */
export async function readShareContents(drive: Hyperdrive, log: { driveId: string }): Promise<ShareContents> {
  const fromManifest = await readManifest(drive, log)
  if (fromManifest && fromManifest.files.length > 0) {
    return fromManifest
  }

  const files = await listDriveFiles(drive)
  const totalBytes = files.reduce((sum, f) => sum + f.size, 0)

  return {
    manifest: fromManifest?.manifest ?? null,
    files,
    shareName: fromManifest?.shareName ?? null,
    totalBytes,
    truncated: null
  }
}

async function readManifest(drive: Hyperdrive, log: { driveId: string }): Promise<ShareContents | null> {
  let manifest: DriveManifest

  try {
    const data = await drive.get(DRIVE_MANIFEST_PATH)
    if (!data || data.length > DRIVE_MANIFEST_MAX_SIZE) {
      return null
    }
    manifest = JSON.parse(data.toString())
  } catch (err) {
    console.log('[HyperdriveManager] No manifest, falling back to listing', {
      driveId: log.driveId,
      error: (err as Error).message
    })
    return null
  }

  if (manifest.version !== DRIVE_MANIFEST_VERSION || !Array.isArray(manifest.files)) {
    return null
  }

  // "Showing 1000 of N" instead of silently dropping the overflow.
  const truncated = computeTruncation(manifest.files.length, DRIVE_MANIFEST_MAX_FILES)

  const files: RemoteFile[] = manifest.files
    .slice(0, DRIVE_MANIFEST_MAX_FILES)
    .map((f) => ({
      // The path comes from the peer: strip traversal before anything uses it.
      name: f.path?.replace(/\.\./g, '').replace(/^\/+/, '/') || f.name,
      displayName: f.name,
      size: f.size || 0
    }))

  const totalBytes = manifest.totalBytes || files.reduce((sum, f) => sum + f.size, 0)

  console.log('[HyperdriveManager] Loaded manifest', {
    shareName: manifest.name,
    files: files.length,
    totalBytes
  })

  return { manifest, files, shareName: manifest.name, totalBytes, truncated }
}

/** Every file in the drive except the PearDrop manifest. */
async function listDriveFiles(drive: Hyperdrive): Promise<RemoteFile[]> {
  const files: RemoteFile[] = []

  for await (const entry of drive.list('/')) {
    if (entry.key === DRIVE_MANIFEST_PATH) {
      continue
    }

    files.push({
      name: entry.key,
      displayName: path.basename(entry.key),
      size: entry.value?.blob?.byteLength || 0
    })
  }

  return files
}
