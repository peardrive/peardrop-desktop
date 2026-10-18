/**
 * Diagnostics logger for the main process.
 *
 * - One file per local day: ~/.peardrop/logs/peardrop-YYYY-MM-DD.log
 *   (a day that exceeds MAX_FILE_BYTES continues in -YYYY-MM-DD.1.log, …).
 * - Retention: files older than `retentionDays` (default 14) are deleted at
 *   startup and at every day rollover. Deleting whole day-files is O(1) per
 *   file — no rewriting a big log to trim its head.
 * - Every line carries a timestamp with UTC offset, a level and a scope:
 *     2026-10-17 17:21:04.512 +03:30 INFO  [engine:hyperdrive] Drive resumed {"files":3}
 * - Lines are redacted as they are written: share keys are capabilities and a
 *   Windows home path contains the user's real name, so neither ever reaches
 *   disk. File CONTENTS are never logged, only names/sizes/counts.
 * - Writes are buffered and flushed once a second (or on demand / exit), so
 *   logging never stalls a transfer.
 * - `mirrorConsole()` captures raw console output too — the engine and the
 *   Holepunch libraries log through console.log, and that is where the
 *   useful detail lives.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { LogLevel } from '@shared/ipc'

export interface Logger {
  debug(message: string, data?: unknown): void
  info(message: string, data?: unknown): void
  warn(message: string, data?: unknown): void
  error(message: string, data?: unknown): void
  /** Derive a logger with a nested scope, e.g. "engine" → "engine:hyperdrive". */
  child(scope: string): Logger
}

export interface LogManagerOptions {
  dir: string
  retentionDays?: number
  maxFileBytes?: number
  filePrefix?: string
}

const LEVEL_LABEL: Record<LogLevel, string> = { debug: 'DEBUG', info: 'INFO ', warn: 'WARN ', error: 'ERROR' }
const FLUSH_INTERVAL_MS = 1000

const HOME = os.homedir()
const HOME_JSON = HOME.split('\\').join('\\\\')
const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const HOME_RE = new RegExp(escapeRegExp(HOME), 'gi')
const HOME_JSON_RE = new RegExp(escapeRegExp(HOME_JSON), 'gi')

/** Remove secrets/identity from a log line (exported for tests). */
export function redact(text: string): string {
  return text
    .replace(/peardrop:\/\/([a-f0-9]{8})[a-f0-9]{56}/gi, 'peardrop://$1…')
    .replace(/\b([a-f0-9]{8})[a-f0-9]{56}\b/gi, '$1…')
    .replace(HOME_JSON_RE, '~')
    .replace(HOME_RE, '~')
}

const pad = (n: number, w = 2) => String(n).padStart(w, '0')

/** "2026-10-17" in local time. */
export function localDay(d = new Date()): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** "2026-10-17 17:21:04.512 +03:30" — local wall clock plus its offset. */
export function timestamp(d = new Date()): string {
  const off = -d.getTimezoneOffset()
  const sign = off >= 0 ? '+' : '-'
  const abs = Math.abs(off)
  return `${localDay(d)} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)} ${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`
}

function formatData(data: unknown): string {
  if (data === undefined) return ''
  if (data instanceof Error) return ` ${data.message}${data.stack ? `\n${data.stack}` : ''}`
  if (typeof data === 'string') return ` ${data}`
  try {
    return ` ${JSON.stringify(data, (_k, v) => (v instanceof Error ? { message: v.message, stack: v.stack } : typeof v === 'bigint' ? String(v) : v))}`
  } catch {
    return ` ${String(data)}`
  }
}

function formatArgs(args: unknown[]): string {
  return args
    .map((a) => (typeof a === 'string' ? a : formatData(a).slice(1)))
    .join(' ')
}

export class LogManager {
  readonly dir: string
  private readonly retentionDays: number
  private readonly maxFileBytes: number
  private readonly prefix: string
  private buffer: string[] = []
  private timer: NodeJS.Timeout | null = null
  private day = ''
  private file = ''
  private consoleMirrored = false
  private originalConsole: Pick<Console, 'log' | 'info' | 'warn' | 'error' | 'debug'> | null = null
  private enabled = false
  /** When false, debug-level lines are written to the file but not echoed to the terminal. */
  verboseConsole = false

  constructor(opts: LogManagerOptions) {
    this.dir = opts.dir
    this.retentionDays = Math.max(1, opts.retentionDays ?? 14)
    this.maxFileBytes = opts.maxFileBytes ?? 20 * 1024 * 1024
    this.prefix = opts.filePrefix ?? 'peardrop'
  }

  /** Create the folder, prune old days and write a session header. Safe to call twice. */
  init(meta: Record<string, string | number | boolean | null | undefined> = {}): void {
    try {
      fs.mkdirSync(this.dir, { recursive: true })
      this.enabled = true
      this.rollIfNeeded(true)
      const header = Object.entries(meta)
        .map(([k, v]) => `${k}=${v ?? '-'}`)
        .join(' | ')
      this.buffer.push(`\n=== session ${timestamp()} | ${header} ===\n`)
      this.flush()
      process.once('exit', () => this.flush())
    } catch {
      this.enabled = false
    }
  }

  /** Path of the file being written today. */
  currentFile(): string {
    this.rollIfNeeded(false)
    return this.file
  }

  /** Scoped logger. */
  scope(scope: string): Logger {
    const make = (s: string): Logger => ({
      debug: (m, d) => this.write('debug', s, m, d),
      info: (m, d) => this.write('info', s, m, d),
      warn: (m, d) => this.write('warn', s, m, d),
      error: (m, d) => this.write('error', s, m, d),
      child: (sub) => make(`${s}:${sub}`)
    })
    return make(scope)
  }

  /** Write one entry. Also echoes to the (original) console. */
  write(level: LogLevel, scope: string, message: string, data?: unknown): void {
    const line = `${timestamp()} ${LEVEL_LABEL[level]} [${scope}] ${message}${formatData(data)}`
    const out = this.originalConsole ?? console
    if (level !== 'debug' || this.verboseConsole) {
      const fn = level === 'error' ? out.error : level === 'warn' ? out.warn : out.log
      try {
        fn.call(console, line)
      } catch {
        /* a closed stdout must never break the app */
      }
    }
    this.append(line)
  }

  private append(line: string): void {
    if (!this.enabled) return
    this.buffer.push(redact(line) + '\n')
    if (!this.timer) {
      this.timer = setTimeout(() => {
        this.timer = null
        this.flush()
      }, FLUSH_INTERVAL_MS)
      this.timer.unref?.()
    }
  }

  /** Write buffered lines to disk now. */
  flush(): void {
    if (!this.enabled || this.buffer.length === 0) return
    const chunk = this.buffer.join('')
    this.buffer = []
    try {
      this.rollIfNeeded(false)
      fs.appendFileSync(this.file, chunk)
    } catch {
      /* disk full / permissions — stay silent, keep running */
    }
  }

  /**
   * Capture console.* (engine + libraries). Lines starting with "[Scope]"
   * keep that scope; everything else is filed under "console".
   */
  mirrorConsole(): void {
    if (this.consoleMirrored) return
    this.consoleMirrored = true
    const original = {
      log: console.log.bind(console),
      info: console.info.bind(console),
      warn: console.warn.bind(console),
      error: console.error.bind(console),
      debug: console.debug.bind(console)
    }
    this.originalConsole = original
    const levels: Array<[keyof typeof original, LogLevel]> = [
      ['log', 'info'],
      ['info', 'info'],
      ['debug', 'debug'],
      ['warn', 'warn'],
      ['error', 'error']
    ]
    for (const [method, level] of levels) {
      console[method] = (...args: unknown[]) => {
        original[method](...args)
        try {
          let scope = 'console'
          let rest = args
          if (typeof args[0] === 'string') {
            const m = /^\[([^\]]{1,48})\]\s*(.*)$/s.exec(args[0])
            if (m) {
              scope = m[1]
              rest = m[2] ? [m[2], ...args.slice(1)] : args.slice(1)
            }
          }
          this.append(`${timestamp()} ${LEVEL_LABEL[level]} [${scope}] ${formatArgs(rest)}`)
        } catch {
          /* never recurse into console from here */
        }
      }
    }
    process.on('uncaughtException', (err) => {
      this.append(`${timestamp()} ${LEVEL_LABEL.error} [fatal] uncaughtException${formatData(err)}`)
      this.flush()
    })
    process.on('unhandledRejection', (reason) => {
      this.append(`${timestamp()} ${LEVEL_LABEL.error} [fatal] unhandledRejection${formatData(reason)}`)
      this.flush()
    })
  }

  /** Last `lines` lines across today's file and, if needed, earlier ones. */
  tail(lines = 300): string {
    this.flush()
    const files = this.listLogFiles().reverse() // newest first
    const collected: string[] = []
    for (const f of files) {
      try {
        const text = fs.readFileSync(path.join(this.dir, f), 'utf8')
        const fileLines = text.split('\n')
        collected.unshift(...fileLines)
        if (collected.length >= lines) break
      } catch {
        /* unreadable — skip */
      }
    }
    return collected.slice(-lines).join('\n')
  }

  /** Delete day-files older than the retention window. Returns the deleted names. */
  prune(now = new Date()): string[] {
    const cutoff = new Date(now)
    cutoff.setHours(0, 0, 0, 0)
    cutoff.setDate(cutoff.getDate() - (this.retentionDays - 1))
    const cutoffDay = localDay(cutoff)
    const removed: string[] = []
    for (const f of this.listLogFiles()) {
      const day = this.dayOf(f)
      if (day && day < cutoffDay) {
        try {
          fs.rmSync(path.join(this.dir, f), { force: true })
          removed.push(f)
        } catch {
          /* locked — try again next rollover */
        }
      }
    }
    return removed
  }

  private listLogFiles(): string[] {
    try {
      return fs
        .readdirSync(this.dir)
        .filter((f) => this.dayOf(f) !== null)
        .sort((a, b) => {
          const da = this.dayOf(a)!
          const db = this.dayOf(b)!
          if (da !== db) return da < db ? -1 : 1
          return this.partOf(a) - this.partOf(b)
        })
    } catch {
      return []
    }
  }

  private dayOf(file: string): string | null {
    const m = new RegExp(`^${escapeRegExp(this.prefix)}-(\\d{4}-\\d{2}-\\d{2})(?:\\.(\\d+))?\\.log$`).exec(file)
    return m ? m[1] : null
  }

  private partOf(file: string): number {
    const m = /\.(\d+)\.log$/.exec(file)
    return m ? Number(m[1]) : 0
  }

  /** Switch file on a new day (pruning old ones) or when today's file is full. */
  private rollIfNeeded(force: boolean): void {
    const today = localDay()
    if (force || today !== this.day) {
      this.day = today
      this.file = this.pickFileFor(today)
      this.prune()
      return
    }
    try {
      if (fs.statSync(this.file).size >= this.maxFileBytes) this.file = this.pickFileFor(today)
    } catch {
      /* not created yet */
    }
  }

  private pickFileFor(day: string): string {
    for (let part = 0; part < 1000; part++) {
      const name = part === 0 ? `${this.prefix}-${day}.log` : `${this.prefix}-${day}.${part}.log`
      const full = path.join(this.dir, name)
      try {
        if (fs.statSync(full).size < this.maxFileBytes) return full
      } catch {
        return full
      }
    }
    return path.join(this.dir, `${this.prefix}-${day}.overflow.log`)
  }
}
