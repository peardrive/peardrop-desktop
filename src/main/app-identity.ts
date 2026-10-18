/**
 * App identity from app.config.json (bundled at build time) plus helpers to
 * resolve its icon. Edit app.config.json to rebrand — nothing else.
 */
import fs from 'node:fs'
import path from 'node:path'
import { app, nativeImage } from 'electron'
import identityJson from '../../app.config.json'
import type { AppIdentity } from '@shared/app-info'

const { $comment: _comment, ...rest } = identityJson as typeof identityJson & { $comment?: string }
export const identity: AppIdentity = rest

/** Absolute path of the configured icon (works in dev and when packaged). */
export function resolveIconPath(): string | null {
  const candidates = [path.join(app.getAppPath(), identity.icon), path.join(process.cwd(), identity.icon)]
  return candidates.find((p) => fs.existsSync(p)) ?? null
}

/** Icon as a small data: URL for the renderer (About section). */
export function iconDataUrl(): string | null {
  const iconPath = resolveIconPath()
  if (!iconPath) return null
  const img = nativeImage.createFromPath(iconPath)
  if (img.isEmpty()) return null
  return img.resize({ width: 128, height: 128, quality: 'best' }).toDataURL()
}
