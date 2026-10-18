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

export interface AppInfo {
  identity: AppIdentity
  version: string
  platform: string
  arch: string
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
