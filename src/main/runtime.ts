/**
 * Process-level runtime configuration, read once at startup from the
 * environment that the npm scripts set:
 *
 *   npm run app       → no overrides (public DHT, default profile)
 *   npm run dev       → PEARDROP_BOOTSTRAP=127.0.0.1:8787 PEARDROP_PROFILE=dev
 *   npm run dev:peer  → same bootstrapper, PEARDROP_PROFILE=dev-peer
 *
 * A profile isolates every piece of state (drives, downloads, preferences,
 * logs) under ~/.peardrop/profiles/<name>, so dev testing never touches the
 * real library and two dev peers can run side by side.
 */
import { app } from 'electron'

export interface RuntimeConfig {
  /** Running under `electron-vite dev` (renderer served by Vite). */
  isDev: boolean
  profile: string | null
  /** Bootstrap override from the environment; wins over preferences. */
  envBootstrap: string | null
  /** Data root override ($PEARDROP_HOME). */
  home: string | undefined
}

export function readRuntimeConfig(env: NodeJS.ProcessEnv = process.env): RuntimeConfig {
  const isDev = !app.isPackaged && !!env.ELECTRON_RENDERER_URL
  const profile = (env.PEARDROP_PROFILE || '').trim() || null
  const envBootstrap = (env.PEARDROP_BOOTSTRAP || '').trim() || null
  return { isDev, profile, envBootstrap, home: env.PEARDROP_HOME || undefined }
}
