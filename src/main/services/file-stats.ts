/**
 * Stat picked/dropped paths, expanding folders into their files.
 */
import fs from 'node:fs/promises'
import path from 'node:path'
import type { ShareSource } from '@shared/transfer'
import { normalizeUserPath } from '@engine/file-utils'
import type { Logger } from '../logger'

async function enumerate(folder: string, base: string, log: Logger, out: NonNullable<ShareSource['contents']>) {
  let entries: import('node:fs').Dirent[]
  try {
    entries = await fs.readdir(folder, { withFileTypes: true })
  } catch (err) {
    log.warn('Skipping unreadable folder', { folder, error: (err as Error).message })
    return
  }
  for (const entry of entries) {
    const full = path.join(folder, entry.name)
    try {
      if (entry.isDirectory()) await enumerate(full, base, log, out)
      else if (entry.isFile()) {
        const st = await fs.stat(full)
        out.push({ path: full, name: entry.name, relativePath: path.relative(base, full), size: st.size })
      }
    } catch {
      log.debug('Skipping inaccessible entry', { full })
    }
  }
}

export async function statPaths(rawPaths: string[], log: Logger): Promise<ShareSource[]> {
  const results: ShareSource[] = []
  for (const raw of rawPaths || []) {
    let p: string
    try {
      p = normalizeUserPath(raw)
    } catch (err) {
      log.warn('Skipping invalid path', { raw, error: (err as Error).message })
      continue
    }
    try {
      const st = await fs.stat(p)
      if (st.isDirectory()) {
        const contents: NonNullable<ShareSource['contents']> = []
        await enumerate(p, p, log, contents)
        const size = contents.reduce((n, c) => n + c.size, 0)
        results.push({ path: p, name: path.basename(p), size, type: 'folder', fileCount: contents.length, contents })
        log.info('Folder stat', { name: path.basename(p), files: contents.length, size })
      } else {
        results.push({ path: p, name: path.basename(p), size: st.size, type: 'file' })
      }
    } catch (err) {
      log.warn('Failed to stat', { path: p, error: (err as Error).message })
    }
  }
  return results
}

export async function pathsExist(paths: string[]): Promise<Record<string, boolean>> {
  const out: Record<string, boolean> = {}
  await Promise.all(
    (paths || []).filter(Boolean).map(async (p) => {
      try {
        await fs.access(p)
        out[p] = true
      } catch {
        out[p] = false
      }
    })
  )
  return out
}
