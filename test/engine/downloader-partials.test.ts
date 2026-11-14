/**
 * downloadFromDrive's on-disk contract: files are written as `name.part`
 * and renamed onto `name` only when complete; a cancel or a failing stream
 * leaves no partial behind; a resume rewrites the same path; the result's
 * totalBytes and the progress reports count bytes written, not network
 * blocks.
 */
import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { EventEmitter } from 'node:events'
import { Readable } from 'node:stream'
import { downloadFromDrive } from '@engine/hyperdrive/downloader'
import { PARTIAL_SUFFIX, sweepPartialFiles } from '@engine/file-utils'

const CHUNK = Buffer.alloc(64 * 1024, 7)

/** A drive with one file, served as `chunks` chunks; `failAfter` chunks → stream error. */
function makeDrive(opts: { key?: string; chunks: number; failAfter?: number; blocksFromNetwork?: number }) {
  const key = opts.key ?? '/movie.bin'
  const core = new EventEmitter()
  return {
    list() {
      return (async function* () {
        yield { key, value: { blob: { byteLength: CHUNK.length * opts.chunks } } }
      })()
    },
    async getBlobs() {
      return { core }
    },
    createReadStream(k: string) {
      expect(k).toBe(key)
      let sent = 0
      return new Readable({
        read() {
          if (opts.failAfter !== undefined && sent >= opts.failAfter) {
            this.destroy(new Error('peer vanished'))
            return
          }
          if (sent >= opts.chunks) {
            this.push(null)
            return
          }
          sent++
          // Pretend some blocks crossed the network (the rest were local).
          if (sent <= (opts.blocksFromNetwork ?? 0)) core.emit('download', sent, CHUNK.length)
          this.push(CHUNK)
        }
      })
    },
    async get() {
      throw new Error('not used')
    }
  }
}

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'pd-part-'))
}

describe('downloader partial files', () => {
  it('writes name.part, renames on completion, counts bytes written', async () => {
    const dir = tmpDir()
    try {
      const starts: Array<{ key: string; path: string }> = []
      const progress: number[] = []
      const drive = makeDrive({ chunks: 8, blocksFromNetwork: 3 })
      const result = await downloadFromDrive(drive as any, {
        destDir: dir,
        totalBytes: CHUNK.length * 8,
        shareName: 'movie.bin',
        onFileStart: (i) => starts.push(i),
        onProgress: (p) => progress.push(p.bytesTransferred)
      })
      const final = path.join(dir, 'movie.bin')
      expect(result.files).toEqual([{ name: 'movie.bin', path: final, size: CHUNK.length * 8, key: '/movie.bin' }])
      expect(result.totalBytes).toBe(CHUNK.length * 8) // bytes on disk …
      expect(result.bytesFromNetwork).toBe(CHUNK.length * 3) // … not the network count
      expect(fs.statSync(final).size).toBe(CHUNK.length * 8)
      expect(fs.existsSync(final + PARTIAL_SUFFIX)).toBe(false)
      expect(starts).toEqual([{ key: '/movie.bin', path: final }])
      expect(Math.max(...progress)).toBe(CHUNK.length * 8)
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  it('leaves nothing behind when the stream fails mid-file', async () => {
    const dir = tmpDir()
    try {
      const drive = makeDrive({ chunks: 8, failAfter: 3 })
      const result = await downloadFromDrive(drive as any, { destDir: dir, totalBytes: CHUNK.length * 8, shareName: 'movie.bin' })
      expect(result.files).toEqual([])
      // The path it was going to, so a retry keeps the same name; nothing is ON it.
      expect(result.failed).toEqual([{ key: '/movie.bin', error: 'peer vanished', path: path.join(dir, 'movie.bin') }])
      expect(result.totalBytes).toBe(0)
      expect(fs.readdirSync(dir)).toEqual([])
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  it('leaves nothing behind when cancelled mid-file', async () => {
    const dir = tmpDir()
    try {
      let chunks = 0
      const drive = makeDrive({ chunks: 100 })
      const original = drive.createReadStream.bind(drive)
      drive.createReadStream = (k: string) => {
        const rs = original(k)
        rs.on('data', () => chunks++)
        return rs
      }
      await expect(
        downloadFromDrive(drive as any, {
          destDir: dir,
          totalBytes: CHUNK.length * 100,
          shareName: 'movie.bin',
          isCancelled: () => chunks >= 2
        })
      ).rejects.toMatchObject({ cancelled: true })
      expect(fs.readdirSync(dir)).toEqual([])
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  it('a retry rewrites the same path instead of adding " (1)"', async () => {
    const dir = tmpDir()
    try {
      const final = path.join(dir, 'movie.bin')
      fs.writeFileSync(final, Buffer.alloc(10, 1)) // a previous (say, older) copy
      const drive = makeDrive({ chunks: 4 })
      const result = await downloadFromDrive(drive as any, {
        destDir: dir,
        totalBytes: CHUNK.length * 4,
        shareName: 'movie.bin',
        resumePaths: { '/movie.bin': final }
      })
      expect(result.files[0].path).toBe(final)
      expect(fs.readdirSync(dir)).toEqual(['movie.bin'])
      expect(fs.statSync(final).size).toBe(CHUNK.length * 4)
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  it('a fresh attempt next to an unrelated same-named file still disambiguates', async () => {
    const dir = tmpDir()
    try {
      fs.writeFileSync(path.join(dir, 'movie.bin'), Buffer.alloc(10, 1))
      const drive = makeDrive({ chunks: 2 })
      const result = await downloadFromDrive(drive as any, { destDir: dir, totalBytes: CHUNK.length * 2, shareName: 'movie.bin' })
      expect(path.basename(result.files[0].path)).toBe('movie (1).bin')
      expect(fs.readdirSync(dir).sort()).toEqual(['movie (1).bin', 'movie.bin'])
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  it('sweepPartialFiles removes only .part files, into subfolders', async () => {
    const dir = tmpDir()
    try {
      fs.mkdirSync(path.join(dir, 'Folder'))
      fs.writeFileSync(path.join(dir, 'a.mp4.part'), 'x')
      fs.writeFileSync(path.join(dir, 'Folder', 'b.mp4.part'), 'x')
      fs.writeFileSync(path.join(dir, 'keep.mp4'), 'x')
      fs.writeFileSync(path.join(dir, 'Folder', 'keep.part.txt'), 'x')
      const removed = await sweepPartialFiles(dir)
      expect(removed.sort()).toEqual([path.join(dir, 'Folder', 'b.mp4.part'), path.join(dir, 'a.mp4.part')].sort())
      expect(fs.readdirSync(dir).sort()).toEqual(['Folder', 'keep.mp4'])
      expect(fs.readdirSync(path.join(dir, 'Folder'))).toEqual(['keep.part.txt'])
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })
})
