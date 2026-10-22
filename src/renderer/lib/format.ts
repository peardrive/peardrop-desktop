/**
 * Pure formatting helpers shared by every component.
 */

const UNITS = ['B', 'KB', 'MB', 'GB', 'TB']

/** 1536 → "1.5 KB". */
export function formatBytes(bytes: number | null | undefined): string {
  if (!bytes || bytes <= 0) return '0 B'
  const i = Math.min(UNITS.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)))
  return `${parseFloat((bytes / 1024 ** i).toFixed(1))} ${UNITS[i]}`
}

/** Bytes/second → "1.25 MB/s"; '' for 0 (nothing moving). */
export function formatSpeed(bps: number | null | undefined): string {
  if (!bps || bps <= 0) return ''
  if (bps < 1024) return `${Math.round(bps)} B/s`
  const kb = bps / 1024
  if (kb < 100) return `${kb.toFixed(1)} KB/s`
  if (kb < 1000) return `${Math.round(kb)} KB/s`
  const mb = bps / 1024 ** 2
  if (mb < 10) return `${mb.toFixed(2)} MB/s`
  if (mb < 100) return `${mb.toFixed(1)} MB/s`
  return `${Math.round(mb)} MB/s`
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** "Jul 01, 2026", or '—'. */
export function formatDate(ts: number | null | undefined): string {
  if (!ts) return '—'
  const d = new Date(ts)
  if (Number.isNaN(d.getTime())) return '—'
  return `${MONTHS[d.getMonth()]} ${String(d.getDate()).padStart(2, '0')}, ${d.getFullYear()}`
}

/** "12s ago", "3m ago", "2h ago", "5d ago", then a locale date. */
export function timeAgo(ts: number | null | undefined, now = Date.now()): string {
  if (!ts) return '—'
  const s = Math.max(1, Math.floor((now - ts) / 1000))
  if (s < 60) return `${s}s ago`
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  const d = Math.floor(s / 86400)
  if (d < 30) return `${d}d ago`
  return new Date(ts).toLocaleDateString()
}

/** Remaining time for a transfer, e.g. "1m 12s". */
export function formatEta(bytesLeft: number, bytesPerSec: number): string {
  if (!bytesPerSec || bytesPerSec <= 0) return 'Estimating'
  const secs = Math.round(Math.max(0, bytesLeft) / bytesPerSec)
  if (secs < 1) return 'Almost done'
  if (secs < 60) return `${secs}s`
  const m = Math.floor(secs / 60)
  if (m < 60) return `${m}m ${secs % 60}s`
  return `${Math.floor(m / 60)}h ${m % 60}m`
}

/** Keep head and tail of long keys: "a1b2c3d4e5…f6a7b8c9". */
export function truncateMiddle(value: string | null | undefined, head = 10, tail = 8): string {
  if (!value) return '—'
  return value.length <= head + tail + 2 ? value : `${value.slice(0, head)}…${value.slice(-tail)}`
}

export const plural = (n: number, word: string, pluralWord = `${word}s`) => `${n} ${n === 1 ? word : pluralWord}`
