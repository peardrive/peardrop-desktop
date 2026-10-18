/**
 * Turn what the user picked/dropped into the flat file list a share is
 * built from. Backend-agnostic: every engine receives the same input.
 *
 * A share is a flat GROUP OF FILES, not a directory tree: dropped folders are
 * expanded and their sub-folders dissolved, so everything lands at the root
 * of the share (which is what the list shows and what the receiver gets).
 * Name collisions get " (2)", " (3)" … — keyed case-insensitively because
 * Windows and macOS treat A.TXT and a.txt as the same file.
 */
import path from 'node:path'
import type { ShareSource } from '@shared/transfer'
import { normalizeUserPath } from '../../engine/file-utils'
import type { CreateShareInput, ShareFileInput } from '../engine/backend'

export class EmptyShareError extends Error {
  constructor() {
    super('Nothing to share — the folder is empty')
  }
}

export function flattenShareSources(sources: ShareSource[]): ShareFileInput[] {
  const used = new Set<string>()
  const take = (n: string) => {
    used.add(n.toLowerCase())
    return n
  }
  const flatName = (raw: string) => {
    const base = path.basename(raw || 'file')
    if (!used.has(base.toLowerCase())) return take(base)
    const ext = path.extname(base)
    const stem = path.basename(base, ext)
    let n = 2
    let candidate: string
    do candidate = `${stem} (${n++})${ext}`
    while (used.has(candidate.toLowerCase()))
    return take(candidate)
  }

  const out: ShareFileInput[] = []
  for (const src of sources) {
    if (!src || typeof src.path !== 'string') continue
    if (src.type === 'folder' && Array.isArray(src.contents)) {
      for (const c of src.contents) {
        const name = flatName(c.name)
        out.push({ name, path: normalizeUserPath(c.path), size: c.size || 0, relativePath: name })
      }
    } else {
      const name = flatName(src.name)
      let safePath: string
      try {
        safePath = normalizeUserPath(src.path)
      } catch (err) {
        throw new Error(`Invalid path for "${src.name || src.path}": ${(err as Error).message}`)
      }
      out.push({ name, path: safePath, size: src.size || 0, relativePath: name })
    }
  }
  return out
}

/** Build the backend input from a share request. Throws EmptyShareError. */
export function buildShareInput(sources: ShareSource[], opts: { name?: string; clientJobId?: string }): CreateShareInput {
  const files = flattenShareSources(sources)
  if (files.length === 0) throw new EmptyShareError()
  const totalBytes = files.reduce((sum, f) => sum + (f.size || 0), 0)
  // Single dropped folder → its own name; several items → the "Folder" placeholder.
  const name = opts.name || (sources.length === 1 ? sources[0].name : 'Folder')
  const first = sources[0]?.path
  return {
    files,
    name,
    clientJobId: opts.clientJobId ?? null,
    totalBytes,
    localPath: first ? (sources[0].type === 'folder' ? first : path.dirname(first)) : null
  }
}
