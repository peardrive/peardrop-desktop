/**
 * QuitWindow — a small "Closing PearDrop…" window with a progress bar, shown
 * while the engine shuts down so a slow quit does not look like a freeze.
 *
 * It only appears when the quit is still running after SHOW_DELAY_MS, so a
 * fast quit never flashes a window. Once shown it stays up for at least
 * MIN_VISIBLE_MS, long enough to read. The page is a tiny standalone HTML
 * document; progress is pushed into it with executeJavaScript, so it needs
 * no preload or IPC channel.
 */
import { BrowserWindow } from 'electron'
import type { WindowChrome } from '@shared/ipc'
import { identity, resolveIconPath } from './app-identity'

/** A quit faster than this never shows the window. */
const SHOW_DELAY_MS = 300

/** Once shown, the window stays at least this long. */
const MIN_VISIBLE_MS = 600

/** With PEARDROP_QUIT_WINDOW=always, long enough to look at. */
const PREVIEW_VISIBLE_MS = 1500

const WIDTH = 340
const HEIGHT = 116

export interface QuitProgress {
  /** What is happening, e.g. "Stopping shares… 2 of 5". */
  label: string
  /** 0–100 */
  percent: number
}

export interface QuitWindowOptions {
  chrome: WindowChrome
  /** Show on every quit, right away (PEARDROP_QUIT_WINDOW=always). */
  alwaysShow?: boolean
}

export class QuitWindow {
  private win: BrowserWindow | null = null
  private showTimer: NodeJS.Timeout | null = null
  private shownAt = 0
  private loaded = false
  private progress: QuitProgress = { label: 'Stopping…', percent: 0 }

  constructor(private readonly opts: QuitWindowOptions) {}

  /** Start the countdown; the window appears if the quit is still running by then. */
  scheduleShow(): void {
    const delay = this.opts.alwaysShow ? 0 : SHOW_DELAY_MS
    this.showTimer = setTimeout(() => this.open(), delay)
  }

  update(progress: QuitProgress): void {
    this.progress = progress
    this.render()
  }

  /** Close the window, after keeping it up long enough to read if it was shown. */
  async close(): Promise<void> {
    if (this.showTimer) {
      clearTimeout(this.showTimer)
      this.showTimer = null
    }

    const win = this.win
    if (!win || win.isDestroyed()) {
      return
    }

    const minVisible = this.opts.alwaysShow ? PREVIEW_VISIBLE_MS : MIN_VISIBLE_MS
    const remaining = this.shownAt + minVisible - Date.now()
    if (remaining > 0) {
      await new Promise((r) => setTimeout(r, remaining))
    }

    if (!win.isDestroyed()) {
      win.destroy()
    }
    this.win = null
  }

  private open(): void {
    this.showTimer = null

    const win = new BrowserWindow({
      width: WIDTH,
      height: HEIGHT,
      center: true,
      frame: false,
      resizable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      alwaysOnTop: true,
      show: false,
      title: `Closing ${identity.productName}`,
      icon: resolveIconPath() ?? undefined,
      backgroundColor: this.opts.chrome.background,
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true
      }
    })
    this.win = win

    win.webContents.once('did-finish-load', () => {
      this.loaded = true
      this.render()
    })
    win.once('ready-to-show', () => {
      if (win.isDestroyed()) return
      win.show()
      this.shownAt = Date.now()
    })

    // Visible straight away in case ready-to-show is slow; close() measures from here.
    this.shownAt = Date.now()
    void win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(quitPageHtml(this.opts.chrome))}`)
  }

  private render(): void {
    const win = this.win
    if (!win || win.isDestroyed() || !this.loaded) {
      return
    }
    void win.webContents.executeJavaScript(`window.render(${JSON.stringify(this.progress)})`).catch(() => {})
  }
}

/** Relative luminance of a #rrggbb colour (0 = black, 1 = white). */
function luminance(hex: string): number {
  const value = parseInt(hex.slice(1), 16)
  const r = (value >> 16) & 255
  const g = (value >> 8) & 255
  const b = value & 255
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255
}

function quitPageHtml(chrome: WindowChrome): string {
  const dark = luminance(chrome.background) < 0.5
  // Pear green; a deeper green on light backgrounds for contrast.
  const accent = dark ? '#a8cf3a' : '#4d7c0f'
  const track = dark ? 'rgba(255,255,255,0.10)' : 'rgba(0,0,0,0.08)'
  const border = dark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.10)'
  const muted = dark ? 'rgba(255,255,255,0.55)' : 'rgba(0,0,0,0.55)'

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<style>
  html, body { margin: 0; height: 100%; }
  body {
    box-sizing: border-box;
    display: flex; flex-direction: column; justify-content: center; gap: 10px;
    padding: 0 22px;
    background: ${chrome.background}; color: ${chrome.foreground};
    border: 1px solid ${border};
    font: 13px/1.3 system-ui, -apple-system, "Segoe UI", sans-serif;
    user-select: none; cursor: default;
  }
  .title { font-weight: 600; font-size: 14px; }
  .label { color: ${muted}; font-size: 12px; margin-top: -4px; }
  .track { height: 6px; border-radius: 3px; background: ${track}; overflow: hidden; }
  .bar { height: 100%; width: 0%; border-radius: 3px; background: ${accent}; transition: width 200ms ease-out; }
</style>
</head>
<body>
  <div class="title">Closing ${identity.productName}…</div>
  <div class="label" id="label">Stopping…</div>
  <div class="track"><div class="bar" id="bar"></div></div>
  <script>
    window.render = function (p) {
      document.getElementById('label').textContent = p.label
      document.getElementById('bar').style.width = Math.max(0, Math.min(100, p.percent)) + '%'
    }
  </script>
</body>
</html>`
}
