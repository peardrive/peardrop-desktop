/**
 * Lazy thumbnails for local files: images are served as file:// URLs
 * (no read, instant); everything else gets the OS-native icon.
 */
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { app } from 'electron'
import type { ThumbnailResult } from '@shared/ipc'

const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.svg', '.ico', '.apng', '.avif'])

export async function thumbnailFor(filePath: string): Promise<ThumbnailResult> {
  try {
    if (!filePath) return { kind: 'none', src: null }
    if (IMAGE_EXTS.has(path.extname(filePath).toLowerCase())) {
      return { kind: 'image', src: pathToFileURL(filePath).href }
    }
    const icon = await app.getFileIcon(filePath, { size: 'normal' })
    return { kind: 'icon', src: icon.toDataURL() }
  } catch {
    return { kind: 'none', src: null }
  }
}
