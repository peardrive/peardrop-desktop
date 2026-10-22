/**
 * QR decoding in the renderer (camera frames and image files) via jsQR.
 * jsQR (~250 KB) is loaded on first use, keeping it out of the startup bundle.
 */
type JsQR = typeof import('jsqr').default
let decoder: JsQR | null = null

/** Load the decoder (call before decodeImageData). */
export async function loadQrDecoder(): Promise<JsQR> {
  decoder ??= (await import('jsqr')).default
  return decoder
}

/** Decode a QR code from an image file; null when none is found. */
export async function decodeQrFromFile(file: File): Promise<string | null> {
  const url = URL.createObjectURL(file)
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image()
      i.onload = () => resolve(i)
      i.onerror = () => reject(new Error('Could not read image'))
      i.src = url
    })
    // Large photos decode faster (and as reliably) when scaled down.
    const scale = Math.min(1, 1600 / Math.max(img.naturalWidth, img.naturalHeight))
    const w = Math.max(1, Math.round(img.naturalWidth * scale))
    const h = Math.max(1, Math.round(img.naturalHeight * scale))
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    if (!ctx) return null
    ctx.drawImage(img, 0, 0, w, h)
    await loadQrDecoder()
    return decodeImageData(ctx.getImageData(0, 0, w, h))
  } finally {
    URL.revokeObjectURL(url)
  }
}

/** Decode one frame (after `loadQrDecoder()` has resolved). */
export function decodeImageData(data: ImageData): string | null {
  if (!decoder) return null
  const res = decoder(data.data, data.width, data.height, { inversionAttempts: 'attemptBoth' })
  return res?.data ?? null
}

/** Open a file picker for an image and decode it. Resolves null if cancelled/none. */
export function pickAndDecodeQr(): Promise<{ text: string | null; cancelled: boolean }> {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = 'image/*'
    input.onchange = async () => {
      const file = input.files?.[0]
      if (!file) return resolve({ text: null, cancelled: true })
      try {
        resolve({ text: await decodeQrFromFile(file), cancelled: false })
      } catch {
        resolve({ text: null, cancelled: false })
      }
    }
    input.click()
  })
}
