/**
 * File-system helpers with no P2P knowledge: safe path joins, user path
 * normalization, folder-name sanitizing, unique names and size formatting.
 */
import fs from 'node:fs/promises'
import path from 'node:path'

/** How many "(n)" suffixes to try before giving up on a unique name. */
const MAX_DUPLICATE_SUFFIX = 1000

export interface TruncationHint {
  /** Files the manifest declared. */
  available: number
  /** Files actually listed (the receive cap). */
  shown: number
}

/**
 * Join an untrusted relative path onto a trusted root and guarantee the
 * result stays INSIDE root.
 *
 * Defends against `../` traversal, absolute paths, and leading-slash or
 * drive-letter escapes coming from a remote peer's drive manifest.
 *
 * @returns The contained absolute path, or null if the input would escape
 *   root (or resolve to root itself, which is not a valid file).
 */
export function safeJoin(root: string, relativePath: string): string | null {
  if (typeof relativePath !== 'string' || relativePath.length === 0) {
    return null
  }

  // Treat the path as relative, and drop NUL bytes, which can truncate
  // paths in some syscalls.
  const cleaned = relativePath
    .replace(/\0/g, '')
    .replace(/^[/\\]+/, '')

  if (cleaned.length === 0) {
    return null
  }

  const resolvedRoot = path.resolve(root)
  const target = path.resolve(resolvedRoot, cleaned)

  // Must be strictly below root, never root itself.
  const isInsideRoot = target !== resolvedRoot && target.startsWith(resolvedRoot + path.sep)
  return isInsideRoot ? target : null
}

/**
 * Normalize a path the user handed us (file picker, drag-and-drop, IPC):
 *   - trims whitespace, and throws if nothing is left;
 *   - turns a `file://` URI into a plain path (decoded; the extra slash
 *     before a Windows drive letter in `file:///C:/…` is dropped);
 *   - resolves to an absolute path.
 *
 * This is the single sender-side normalization point: fixes for new OS path
 * quirks belong here.
 *
 * @throws If the input is not a non-empty string after trimming.
 */
export function normalizeUserPath(rawPath: string): string {
  if (typeof rawPath !== 'string') {
    throw new Error(`normalizeUserPath: expected string, got ${typeof rawPath}`)
  }

  let value = rawPath.trim()
  if (value.length === 0) {
    throw new Error('normalizeUserPath: path is empty')
  }

  if (/^file:\/\//i.test(value)) {
    let pathPart = value.replace(/^file:\/\//i, '')

    // `file:///C:/path` leaves `/C:/path`; path.resolve needs `C:/path`.
    if (/^\/[a-zA-Z]:/.test(pathPart)) {
      pathPart = pathPart.slice(1)
    }

    try {
      value = decodeURI(pathPart)
    } catch {
      value = pathPart
    }
  }

  return path.resolve(value)
}

/**
 * Clean a share name from a remote peer's manifest before using it as a
 * folder name. Steps, in order:
 *   1. backslashes become forward slashes;
 *   2. `..` is removed wherever it appears;
 *   3. separators and Windows-reserved characters become `_`;
 *   4. leading dots are removed;
 *   5. whitespace runs collapse to one space, then the result is trimmed.
 *
 * Matches the mobile client's sanitizeFolderName, so both sides produce the
 * same folder name for the same manifest.
 *
 * @returns The cleaned name, or null when nothing is left. Never
 *   `path.join` a null result.
 */
export function sanitizeFolderName(raw: string | null | undefined): string | null {
  if (!raw) {
    return null
  }

  const cleaned = String(raw)
    .replace(/\\/g, '/')
    .replace(/\.\./g, '')
    .replace(/[/:*?"<>|]/g, '_')
    .replace(/^\.+/, '')
    .replace(/\s+/g, ' ')
    .trim()

  return cleaned || null
}

/**
 * Truncation hint for a manifest that declared more files than the receive
 * cap allows. Same shape as the mobile client's `truncated` field.
 *
 * @returns `{ available, shown }` when truncated, otherwise null.
 */
export function computeTruncation(declaredCount: number, maxCount: number): TruncationHint | null {
  if (typeof declaredCount !== 'number' || typeof maxCount !== 'number') {
    return null
  }

  if (declaredCount > maxCount) {
    return { available: declaredCount, shown: maxCount }
  }

  return null
}

async function exists(target: string): Promise<boolean> {
  try {
    await fs.access(target)
    return true
  } catch {
    return false
  }
}

/**
 * A path that does not exist yet, adding " (1)", " (2)", … before the
 * extension when needed (`file.txt` → `file (1).txt`).
 */
export async function getUniqueFilePath(filePath: string): Promise<string> {
  if (!(await exists(filePath))) {
    return filePath
  }

  const dir = path.dirname(filePath)
  const ext = path.extname(filePath)
  const baseName = path.basename(filePath, ext)

  for (let counter = 1; counter <= MAX_DUPLICATE_SUFFIX; counter++) {
    const candidate = path.join(dir, `${baseName} (${counter})${ext}`)
    if (!(await exists(candidate))) {
      return candidate
    }
  }

  throw new Error('Too many duplicate files')
}

/**
 * A folder path that does not exist yet, adding " (1)", " (2)", … when
 * needed (`folder` → `folder (1)`).
 */
export async function getUniqueFolderPath(folderPath: string): Promise<string> {
  if (!(await exists(folderPath))) {
    return folderPath
  }

  const parentDir = path.dirname(folderPath)
  const folderName = path.basename(folderPath)

  for (let counter = 1; counter <= MAX_DUPLICATE_SUFFIX; counter++) {
    const candidate = path.join(parentDir, `${folderName} (${counter})`)
    if (!(await exists(candidate))) {
      return candidate
    }
  }

  throw new Error('Too many duplicate folders')
}

/** Create a directory and its parents if they do not exist. */
export async function ensureDir(dirPath: string): Promise<void> {
  await fs.mkdir(dirPath, { recursive: true })
}

/** "1.5 MB" */
export function formatBytes(bytes: number): string {
  if (bytes === 0) {
    return '0 B'
  }

  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  const value = parseFloat((bytes / Math.pow(k, i)).toFixed(1))

  return `${value} ${sizes[i]}`
}

/** "1.5 MB/s" */
export function formatSpeed(bytesPerSecond: number): string {
  if (!bytesPerSecond) {
    return '0 B/s'
  }

  return `${formatBytes(bytesPerSecond)}/s`
}
