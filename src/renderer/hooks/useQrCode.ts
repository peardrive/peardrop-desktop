import { useEffect, useState } from 'react'
import { api } from '../services/client'

const cache = new Map<string, string>()

/**
 * QR code (data: URL) for a string, generated in main and cached — a link
 * always encodes to the same image. Returns null while generating.
 *
 * @example const qr = useQrCode(link)
 */
export function useQrCode(text: string | null | undefined): string | null {
  const [src, setSrc] = useState<string | null>(() => (text ? cache.get(text) ?? null : null))
  useEffect(() => {
    if (!text) return setSrc(null)
    const hit = cache.get(text)
    if (hit) return setSrc(hit)
    setSrc(null)
    let alive = true
    api()
      .qr.generate(text)
      .then((url) => {
        cache.set(text, url)
        if (alive) setSrc(url)
      })
      .catch(() => undefined)
    return () => {
      alive = false
    }
  }, [text])
  return src
}
