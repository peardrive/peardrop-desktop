/**
 * Static facts about the running app, served to the renderer once at boot.
 * Identity fields come from app.config.json (single source for branding).
 */
export interface AppIdentity {
  name: string
  productName: string
  appId: string
  description: string
  author: string
  homepage: string
  copyright: string
  icon: string
  linkScheme: string
}

/**
 * How the window is framed: 'mac' frameless with in-app traffic lights,
 * 'windows' native frame + theme-coloured title bar, 'native' the window
 * manager's frame (Linux). Normally follows the OS; in development
 * `PEARDROP_WINDOW_FRAME` (e.g. `npm run dev:mac`) overrides it.
 */
export type WindowFrame = 'mac' | 'windows' | 'native'

export interface AppInfo {
  identity: AppIdentity
  version: string
  platform: string
  arch: string
  windowFrame: WindowFrame
  versions: { electron: string; chrome: string; node: string }
  /** App logo as a data: URL (from identity.icon) for the About section. */
  iconDataUrl: string | null
  /** True when launched through `npm run dev`. */
  isDev: boolean
  profile: string | null
  paths: {
    root: string
    downloads: string
    logs: string
    preferences: string
  }
}
