/**
 * Thumbnail service for local files.
 *
 * - Images: main returns a file:// URL (instant, no decode here).
 * - Videos: a poster frame is grabbed with a hidden <video> + canvas, skipping
 *   black leader frames; at most 2 decodes run at once.
 * - Everything else: no preview (the category icon is shown) — OS shell icons
 *   are deliberately not used, they clash with the app's icon language.
 *
 * Results are cached in memory and (successes only) in localStorage, so
 * thumbnails survive restarts without re-decoding videos.
 */
import { api } from '../services/client'
import { isVideoFile } from './file-types'

const STORAGE_KEY = 'peardrop.thumbcache.v4'
const MAX_PERSISTED = 300
const VIDEO_CONCURRENCY = 2
const VIDEO_TIMEOUT_MS = 25000

const cache = new Map<string, string | null>()
const pending = new Map<string, Promise<string | null>>()
let persistTimer: ReturnType<typeof setTimeout> | null = null

;(function loadPersisted() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return
    for (const [k, v] of Object.entries(JSON.parse(raw) as Record<string, string>)) cache.set(k, v)
  } catch {
    /* ignore */
  }
})()

function persistSoon() {
  if (persistTimer) return
  persistTimer = setTimeout(() => {
    persistTimer = null
    try {
      // Only small data: URLs (video posters) are worth persisting; file:// URLs are free to recompute.
      const entries = [...cache.entries()].filter(([, v]) => v && v.startsWith('data:')).slice(-MAX_PERSISTED)
      localStorage.setItem(STORAGE_KEY, JSON.stringify(Object.fromEntries(entries)))
    } catch {
      /* quota */
    }
  }, 1000)
}

// ── video poster frames ───────────────────────────────────────────────────

const queue: Array<{ path: string; resolve: (v: string) => void; reject: (e: Error) => void }> = []
let active = 0

function pump() {
  while (active < VIDEO_CONCURRENCY && queue.length) {
    const job = queue.shift()!
    active++
    grabVideoFrame(job.path)
      .then(job.resolve, job.reject)
      .finally(() => {
        active--
        pump()
      })
  }
}

function queueVideo(path: string): Promise<string> {
  return new Promise((resolve, reject) => {
    queue.push({ path, resolve, reject })
    pump()
  })
}

function fileUrl(path: string): string {
  return (
    'file:///' +
    path
      .replace(/\\/g, '/')
      .replace(/^\/+/, '')
      .split('/')
      .map((seg, i) => (i === 0 && /^[a-zA-Z]:$/.test(seg) ? seg : encodeURIComponent(seg)))
      .join('/')
  )
}

function grabVideoFrame(path: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video')
    video.preload = 'auto'
    video.muted = true
    video.playsInline = true
    Object.assign(video.style, { position: 'fixed', left: '-9999px', width: '1px', height: '1px', opacity: '0' })
    let done = false
    let attempt = 0
    const cleanup = () => {
      try {
        video.removeAttribute('src')
        video.load()
      } catch {
        /* ignore */
      }
      video.remove()
    }
    const finish = (err: Error | null, url?: string) => {
      if (done) return
      done = true
      clearTimeout(timeout)
      cleanup()
      if (err) reject(err)
      else resolve(url!)
    }
    // Films open on black leader; try 10/25/45/65% and skip black grabs.
    const points = () => {
      const d = video.duration
      if (!d || !isFinite(d)) return [1, 3, 6]
      return [0.1, 0.25, 0.45, 0.65].map((f) => Math.min(Math.max(d * f, 0.5), Math.max(d - 0.2, 0.5)))
    }
    const seekNext = () => {
      const pts = points()
      while (attempt < pts.length) {
        const t = pts[attempt++]
        if (Math.abs((video.currentTime || 0) - t) < 0.05) continue
        video.currentTime = t
        return true
      }
      return false
    }
    const draw = () => {
      const size = 112
      const canvas = document.createElement('canvas')
      canvas.width = size
      canvas.height = size
      const ctx = canvas.getContext('2d', { willReadFrequently: true })
      if (!ctx) return finish(new Error('no canvas'))
      const vw = video.videoWidth || 1
      const vh = video.videoHeight || 1
      const scale = Math.max(size / vw, size / vh)
      ctx.fillStyle = '#000'
      ctx.fillRect(0, 0, size, size)
      ctx.drawImage(video, (size - vw * scale) / 2, (size - vh * scale) / 2, vw * scale, vh * scale)
      try {
        const { data } = ctx.getImageData(0, 0, size, size)
        let sum = 0
        for (let i = 0; i < data.length; i += 16) sum += 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]
        if (sum / (data.length / 16) < 12 && seekNext()) return
      } catch {
        /* unreadable canvas — take what we have */
      }
      finish(null, canvas.toDataURL('image/jpeg', 0.72))
    }
    video.addEventListener('loadedmetadata', () => {
      if (!seekNext()) finish(new Error('no seek point'))
    })
    video.addEventListener('seeked', () => {
      const rvfc = (video as HTMLVideoElement & { requestVideoFrameCallback?: (cb: () => void) => void }).requestVideoFrameCallback
      if (rvfc) rvfc.call(video, draw)
      else if (video.readyState >= 2) draw()
      else video.addEventListener('loadeddata', draw, { once: true })
    })
    video.addEventListener('error', () => finish(new Error('video load error')))
    const timeout = setTimeout(() => finish(new Error('video thumb timeout')), VIDEO_TIMEOUT_MS)
    document.body.appendChild(video)
    video.src = fileUrl(path)
  })
}

// ── public API ────────────────────────────────────────────────────────────

/** Cached thumbnail (sync), `undefined` when not resolved yet. */
export function peekThumbnail(path: string): string | null | undefined {
  return cache.get(path)
}

/** Resolve a preview URL for a local file, or null when there is none. */
export function loadThumbnail(path: string, name?: string): Promise<string | null> {
  if (cache.has(path)) return Promise.resolve(cache.get(path)!)
  const inflight = pending.get(path)
  if (inflight) return inflight
  const p = (async () => {
    let src: string | null = null
    try {
      if (isVideoFile(name ?? path)) src = await queueVideo(path)
      else {
        const res = await api().files.thumbnail(path)
        src = res.kind === 'image' ? res.src : null
      }
    } catch {
      src = null
    }
    // Failures are not cached across restarts: a cold-start timeout should get another try.
    cache.set(path, src)
    pending.delete(path)
    if (src) persistSoon()
    return src
  })()
  pending.set(path, p)
  return p
}

/** Forget a broken preview (e.g. the image failed to decode). */
export function invalidateThumbnail(path: string) {
  cache.set(path, null)
  persistSoon()
}
