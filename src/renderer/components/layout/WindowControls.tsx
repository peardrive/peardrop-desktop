/**
 * Window chrome in the app, per platform (see `useWindowFrame`):
 *
 *  - macOS — `MacWindowControls`: the window is frameless and the app draws
 *    the traffic-light dots (close · minimize · full screen) at the top of
 *    the sidebar, as in the PearDrop Figma title bar. Glyphs show on hover;
 *    the dots go grey while the window is in the background. In the folded
 *    sidebar they stay in a row, as on macOS; the folded sidebar is 76px
 *    wide on Mac (65px elsewhere) to fit the 52px row with even margins. The sidebar's top row and the page
 *    headers are the drag area.
 *  - Windows — `WindowsTitleBar`: the native frame and caption buttons stay;
 *    the app draws the title bar strip under them in the theme colour.
 *  - Linux — nothing: the window manager's frame.
 *
 * Close goes through the normal close path, so with background mode on it
 * hides PearDrop to the tray.
 *
 * @example {frame === 'mac' && <MacWindowControls />}
 * @example {frame === 'windows' && <WindowsTitleBar />}
 */
import { useState } from 'react'
import type { WindowFrame } from '@shared/app-info'
import { WINDOWS_TITLEBAR_HEIGHT, type WindowAction } from '@shared/ipc'
import { cn } from '../../lib/cn'
import { api } from '../../services/client'
import { useSettingsStore } from '../../stores/settings-store'
import { useWindowStore } from '../../stores/window-store'

/**
 * How the window is framed (null until app info has loaded; normally the
 * OS's own style, see `resolveWindowFrame` in main):
 *  - 'mac'     frameless; the app draws the traffic lights in the sidebar
 *  - 'windows' native frame + native caption buttons over an app-drawn,
 *              theme-coloured title bar strip (Window Controls Overlay)
 *  - 'native'  the window manager's own frame (Linux)
 */
export function useWindowFrame(): WindowFrame | null {
  return useSettingsStore((s) => s.appInfo?.windowFrame ?? null)
}

function useWindowAction() {
  const setState = useWindowStore((s) => s.setState)
  return (action: WindowAction) => void api().window.act(action).then(setState).catch(() => undefined)
}

const GLYPHS: Record<'close' | 'minimize' | 'full', string> = {
  close: 'M3.5 3.5l5 5M8.5 3.5l-5 5',
  minimize: 'M3 6h6',
  // Two corner arrows (enter) — shown flipped inwards while in full screen.
  full: 'M3.5 7.5v1h1M8.5 4.5v-1h-1M3.5 8.5l2-2M8.5 3.5l-2 2'
}

function Dot({ color, glyph, label, onClick, flip }: { color: string; glyph: keyof typeof GLYPHS; label: string; onClick: () => void; flip?: boolean }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className="no-drag group/dot flex h-3 w-3 shrink-0 items-center justify-center rounded-full transition-[background-color,filter] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 active:brightness-75"
      style={{ background: color, boxShadow: 'inset 0 0 0 0.5px rgba(0,0,0,0.18)' }}
    >
      <svg viewBox="0 0 12 12" className={cn('h-3 w-3 opacity-0 transition-opacity group-hover/controls:opacity-100', flip && 'rotate-180')} aria-hidden>
        <path d={GLYPHS[glyph]} stroke="rgba(0,0,0,0.6)" strokeWidth="1.2" strokeLinecap="round" fill="none" />
      </svg>
    </button>
  )
}

export function MacWindowControls() {
  const state = useWindowStore((s) => s.state)
  const act = useWindowAction()
  const [hover, setHover] = useState(false)
  // Unfocused windows show neutral dots (hover still reveals the colours).
  const tone = (c: string) => (!state.focused && !hover ? 'rgb(var(--pd-fg) / 0.22)' : c)

  return (
    <div
      role="group"
      aria-label="Window"
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      className="no-drag group/controls flex shrink-0 items-center gap-2"
    >
      <Dot color={tone('#ff5f57')} glyph="close" label="Close" onClick={() => act('close')} />
      <Dot color={tone('#febc2e')} glyph="minimize" label="Minimize" onClick={() => act('minimize')} />
      <Dot
        color={tone('#28c840')}
        glyph="full"
        flip={state.fullScreen}
        label={state.fullScreen ? 'Exit full screen' : 'Full screen'}
        onClick={() => act('toggle-full-screen')}
      />
    </div>
  )
}

// ─── Windows title bar ─────────────────────────────────────────────────────

/**
 * The strip the native Windows caption buttons (Window Controls Overlay) sit
 * on: theme-coloured, draggable, with the app name. Main recolours the
 * buttons' own background to match (see `applyWindowChrome`).
 */
export function WindowsTitleBar() {
  const name = useSettingsStore((s) => s.appInfo?.identity.productName ?? 'PearDrop')
  const profile = useSettingsStore((s) => s.appInfo?.profile)
  const focused = useWindowStore((s) => s.state.focused)
  return (
    <div
      className="titlebar-drag flex shrink-0 select-none items-center bg-canvas pl-3 text-[11px] font-semibold"
      style={{ height: WINDOWS_TITLEBAR_HEIGHT }}
    >
      <span className={cn('truncate transition-colors', focused ? 'text-fg/80' : 'text-fg/40')}>
        {name}
        {profile ? ` — ${profile}` : ''}
      </span>
    </div>
  )
}
