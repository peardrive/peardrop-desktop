/**
 * The renderer's single gateway to the outside world.
 *
 * Components, stores and controllers depend on `PeardropClient` — never on
 * `window.peardrop`, Electron or any engine. In the app the client is the
 * preload API; in a plain browser (design work, tests) a mock client is used.
 * Swapping the P2P backend happens behind the IPC boundary and never touches
 * anything in src/renderer.
 */
import type { PeardropApi } from '@shared/ipc'

export type PeardropClient = PeardropApi

let client: PeardropClient | null = null

/** Install the client once at startup (see main.tsx). */
export function setClient(c: PeardropClient): void {
  client = c
}

/** The active client. Throws if called before `setClient`. */
export function api(): PeardropClient {
  if (!client) throw new Error('PeardropClient not initialised')
  return client
}

/** Absolute path of a dropped/picked File. */
export function pathForFile(file: File): string {
  const legacy = (file as File & { path?: string }).path
  if (legacy) return legacy
  try {
    return api().files.pathForFile(file)
  } catch {
    return ''
  }
}
