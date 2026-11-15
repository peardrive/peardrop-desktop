/**
 * App identity from app.config.json (bundled at build time) plus helpers to
 * resolve its icon. Edit app.config.json to rebrand — nothing else.
 */
import fs from 'node:fs'
import path from 'node:path'
import { app, nativeImage } from 'electron'
import identityJson from '../../app.config.json'
import type { AppIdentity } from '@shared/app-info'

const config = identityJson as typeof identityJson
export const identity: AppIdentity = config

/** 
 * Absolute path of the configured icon.
 * "candidates" makes sure that path works in dev and when packaged. 
*/
export function resolveIconPath(file: string = identity.icon): string | null {
  const candidates = [
    path.join(app.getAppPath(), file),
    path.join(process.cwd(), file)
  ]

  return candidates.find((p) => fs.existsSync(p)) ?? null
}

/**
 * macOS ignores BrowserWindow's `icon`; the Dock shows the bundle's icon. A packaged build has ours,
 * but `npm run dev` runs inside Electron.app, so set the Dock icon by hand there.
 */
export function applyDevDockIcon(): void {
  if (process.platform !== 'darwin' || app.isPackaged) return
  const iconPath = resolveIconPath(config.macIcon)
  if (iconPath) app.dock?.setIcon(iconPath)
}

/**
 * Icon as a small data: URL for the renderer (About section). 
*/
export function iconDataUrl(): string | null {
  const iconPath = resolveIconPath()

  if (!iconPath) { return null }

  const img = nativeImage.createFromPath(iconPath)

  if (img.isEmpty()) { return null }

  return img.resize({ width: 128, height: 128, quality: 'best' }).toDataURL()
}
