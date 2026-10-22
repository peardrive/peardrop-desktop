/**
 * Tray / menu-bar presence, so PearDrop keeps sharing and downloading while
 * its window is closed.
 *
 * Menu: Send… · Receive… · Quit PearDrop. Clicking the icon (Windows/Linux)
 * brings the window back. Send/Receive show the window and ask the renderer
 * to open the matching dialog over the `app:command` push channel.
 */
import { app, Menu, nativeImage, Tray, type NativeImage } from 'electron'
import type { AppCommand } from '@shared/ipc'
import { identity, resolveIconPath } from './app-identity'
import type { Logger } from './logger'

export interface AppTrayOptions {
  /** Show (creating if needed) and focus the main window. */
  showWindow: () => void
  /** Show the window, then deliver a command to the renderer. */
  runCommand: (command: AppCommand) => void
  /** Quit for real (bypasses close-to-tray). */
  quit: () => void
  log: Logger
}

function trayImage(): NativeImage {
  const file = resolveIconPath()
  const img = file ? nativeImage.createFromPath(file) : nativeImage.createEmpty()
  if (img.isEmpty()) return img
  // Menu-bar icons are ~18pt on macOS; the Windows notification area uses 16px.
  const size = process.platform === 'darwin' ? 18 : process.platform === 'linux' ? 22 : 16
  return img.resize({ width: size, height: size, quality: 'best' })
}

export class AppTray {
  private tray: Tray | null = null

  constructor(private readonly opts: AppTrayOptions) {}

  create(): void {
    if (this.tray) return
    try {
      this.tray = new Tray(trayImage())
    } catch (err) {
      // Some Linux desktops have no status area; the app still works without it.
      this.opts.log.warn('Tray unavailable', (err as Error).message)
      this.tray = null
      return
    }
    this.tray.setToolTip(identity.productName)
    this.tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: 'Open App', click: () => this.opts.showWindow() },
        { label: 'Send…', click: () => this.opts.runCommand('send') },
        { label: 'Receive…', click: () => this.opts.runCommand('receive') },
        { type: 'separator' },
        { label: `Quit ${identity.productName}`, click: () => this.opts.quit() }
      ])
    )
    // macOS opens the menu on click; elsewhere a click means "show me the app".
    if (process.platform !== 'darwin') this.tray.on('click', () => this.opts.showWindow())
  }

  get available(): boolean {
    return !!this.tray && !this.tray.isDestroyed()
  }

  /** One-time hint after the first close-to-tray. */
  notifyStillRunning(): void {
    if (!this.available) return
    const title = `${identity.productName} is still running`
    const content = 'Shares and downloads continue in the background. Use the tray icon to send, receive or quit.'
    if (process.platform === 'win32') {
      this.tray!.displayBalloon({ title, content, iconType: 'info' })
      return
    }
    void import('electron').then(({ Notification }) => {
      if (Notification.isSupported()) new Notification({ title, body: content, silent: true }).show()
    })
  }

  destroy(): void {
    this.tray?.destroy()
    this.tray = null
  }
}

/** Register/unregister "open at login" (packaged builds only; dev would register electron itself). */
export function applyLoginItem(openAtLogin: boolean, log: Logger): void {
  if (!app.isPackaged) return
  try {
    app.setLoginItemSettings({ openAtLogin, openAsHidden: true, args: ['--hidden'] })
  } catch (err) {
    log.warn('Could not update login item', (err as Error).message)
  }
}

/** Launched by the login item: start in the tray without showing the window. */
export function launchedHidden(): boolean {
  if (process.argv.includes('--hidden')) return true
  try {
    return process.platform === 'darwin' && app.getLoginItemSettings().wasOpenedAsHidden === true
  } catch {
    return false
  }
}
