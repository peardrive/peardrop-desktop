/**
 * Tiny durable JSON document store.
 *
 * - Reads once, keeps the value in memory.
 * - Every load and every update passes through `sanitize`, so a hand-edited
 *   or older file can never yield an invalid value.
 * - Writes are serialized and atomic (temp file + rename): a crash mid-write
 *   leaves either the old or the new file, never a truncated one.
 * - A corrupt file is backed up next to itself before falling back to defaults.
 */
import fs from 'node:fs'
import path from 'node:path'
import { EventEmitter } from 'node:events'
import type { Logger } from '../logger'

export class JsonStore<T> extends EventEmitter {
  private value: T
  private writeChain: Promise<void> = Promise.resolve()

  constructor(
    private readonly file: string,
    private readonly sanitize: (raw: unknown) => T,
    private readonly log?: Logger
  ) {
    super()
    this.value = this.load()
  }

  get(): T {
    return this.value
  }

  /** Replace the value (sanitized), persist it and emit 'change'. */
  async set(next: T): Promise<T> {
    this.value = this.sanitize(next)
    this.emit('change', this.value)
    const snapshot = JSON.stringify(this.value, null, 2)
    this.writeChain = this.writeChain.catch(() => undefined).then(() => this.writeAtomic(snapshot))
    await this.writeChain
    return this.value
  }

  /** Functional update helper. */
  update(fn: (current: T) => T): Promise<T> {
    return this.set(fn(this.value))
  }

  private load(): T {
    try {
      const raw = fs.readFileSync(this.file, 'utf8')
      return this.sanitize(JSON.parse(raw))
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code
      if (code !== 'ENOENT') {
        const backup = `${this.file}.corrupted.${Date.now()}`
        try {
          fs.copyFileSync(this.file, backup)
          this.log?.warn('Unreadable file, backed up and reset to defaults', { file: this.file, backup })
        } catch {
          this.log?.warn('Unreadable file, reset to defaults', { file: this.file, error: (err as Error).message })
        }
      }
      return this.sanitize({})
    }
  }

  private async writeAtomic(data: string): Promise<void> {
    const tmp = `${this.file}.tmp`
    try {
      await fs.promises.mkdir(path.dirname(this.file), { recursive: true })
      await fs.promises.writeFile(tmp, data)
      await fs.promises.rename(tmp, this.file)
    } catch (err) {
      this.log?.error('Failed to save', { file: this.file, error: (err as Error).message })
      await fs.promises.rm(tmp, { force: true }).catch(() => undefined)
    }
  }
}
