import { useEffect, useState } from 'react'
import { invalidateThumbnail, loadThumbnail, peekThumbnail } from '../lib/thumbnails'

/**
 * Preview URL for a local file (image or video poster), or null.
 * Resolves lazily and re-renders once ready; cached across the app.
 *
 * @example const src = useThumbnail(file.path, file.name)
 */
export function useThumbnail(path: string | undefined | null, name?: string): { src: string | null; onError: () => void } {
  const [src, setSrc] = useState<string | null>(() => (path ? peekThumbnail(path) ?? null : null))
  useEffect(() => {
    if (!path) return setSrc(null)
    let alive = true
    const cached = peekThumbnail(path)
    if (cached !== undefined) setSrc(cached)
    else void loadThumbnail(path, name).then((s) => alive && setSrc(s))
    return () => {
      alive = false
    }
  }, [path, name])
  return {
    src,
    onError: () => {
      if (path) invalidateThumbnail(path)
      setSrc(null)
    }
  }
}
