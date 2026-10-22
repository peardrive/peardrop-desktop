/**
 * Process-level runtime configuration, read once at startup from the
 * environment that the npm scripts set:
 *
 *   npm run app       → no overrides (public DHT, default profile)
 *   npm run dev       → PEARDROP_BOOTSTRAP=127.0.0.1:8787 PEARDROP_PROFILE=dev
 *   npm run dev:peer  → same bootstrapper, PEARDROP_PROFILE=dev-peer
 *
 */
import { app } from 'electron'

export interface RuntimeConfig {
  /**
   * Running under `electron-vite dev` (renderer served by Vite). 
  */
  isDev: boolean
  /**
   * A profile isolates every piece of state (drives, downloads, preferences,
   * logs) under ~/.peardrop/profiles/<name>, so multiple instances of the app
   * can run side by side.
   */
  profile: string | null
  /**
   * Bootstrap override from the environment; wins over preferences. 
  */
  envBootstrap: string | null
  /**
   * Data root override ($PEARDROP_HOME). 
  */
  home: string | undefined
  /**
   * When the quit window appears ($PEARDROP_QUIT_WINDOW): 'auto' only for a
   * slow quit, 'always' on every quit (to see or test it).
   */
  quitWindow: 'auto' | 'always'
}

export function readRuntimeConfig(env: NodeJS.ProcessEnv = process.env): RuntimeConfig {
  // check if running from source and the React server is running with hot-reload
  const isDev = !app.isPackaged && !!env.ELECTRON_RENDERER_URL

  // root directory for the peardrop app directory.
  const profile = (env.PEARDROP_PROFILE || '').trim() || null

  // check if there is predefined bootstrapper settings for the DHT.
  const envBootstrap = (env.PEARDROP_BOOTSTRAP || '').trim() || null

  return {
    isDev,
    profile,
    envBootstrap,
    home: env.PEARDROP_HOME || undefined,
    quitWindow: (env.PEARDROP_QUIT_WINDOW || '').trim() === 'always' ? 'always' : 'auto'
  }
}
