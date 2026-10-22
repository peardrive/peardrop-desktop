/**
 * VIcon — the Vuesax icons used by the 2026 sidebar/header design (exported
 * from the PearDrop Figma file into assets/icons/vuesax, unmodified).
 *
 * The SVG files are applied as a CSS mask over `currentColor`, so each icon
 * keeps the exact shape from Figma but takes its colour from the text colour
 * like the rest of the UI (`text-accent`, `text-muted` …) and follows the
 * theme. `size` is the icon's design size in px.
 *
 * @example <VIcon name="directbox-send" size={20} className="text-fg" />
 */
import type { CSSProperties } from 'react'
import { cn } from '../../lib/cn'
import arrowDown from '../../assets/icons/vuesax/arrow-down.svg'
import arrowUp from '../../assets/icons/vuesax/arrow-up.svg'
import directboxNotif from '../../assets/icons/vuesax/directbox-notif.svg'
import directboxReceive from '../../assets/icons/vuesax/directbox-receive.svg'
import directboxSendBold from '../../assets/icons/vuesax/directbox-send-bold.svg'
import directboxSend from '../../assets/icons/vuesax/directbox-send.svg'
import downloadSpeed from '../../assets/icons/vuesax/download-speed.svg'
import filterSquare from '../../assets/icons/vuesax/filter-square.svg'
import grid2 from '../../assets/icons/vuesax/grid-2.svg'
import grid4 from '../../assets/icons/vuesax/grid-4.svg'
import more2 from '../../assets/icons/vuesax/more-2.svg'
import profile2user from '../../assets/icons/vuesax/profile-2user.svg'
import rowVertical from '../../assets/icons/vuesax/row-vertical.svg'
import searchNormal from '../../assets/icons/vuesax/search-normal.svg'
import setting2 from '../../assets/icons/vuesax/setting-2.svg'
import sortDescending from '../../assets/icons/vuesax/sort-descending.svg'
import star from '../../assets/icons/vuesax/star.svg'
import uploadSpeed from '../../assets/icons/vuesax/upload-speed.svg'

const SOURCES = {
  'arrow-down': arrowDown,
  'arrow-up': arrowUp,
  'directbox-notif': directboxNotif,
  'directbox-receive': directboxReceive,
  'directbox-send': directboxSend,
  'directbox-send-bold': directboxSendBold,
  'download-speed': downloadSpeed,
  'filter-square': filterSquare,
  'grid-2': grid2,
  /** The sidebar open/close glyph. */
  'grid-4': grid4,
  'more-2': more2,
  'profile-2user': profile2user,
  'row-vertical': rowVertical,
  'search-normal': searchNormal,
  'setting-2': setting2,
  'sort-descending': sortDescending,
  star,
  'upload-speed': uploadSpeed
} as const

export type VIconName = keyof typeof SOURCES

export interface VIconProps {
  name: VIconName
  /** Rendered size in px (square). */
  size?: number
  className?: string
  /** Accessible name; omit for decorative icons. */
  label?: string
  style?: CSSProperties
}

export function VIcon({ name, size = 20, className, label, style }: VIconProps) {
  const url = `url("${SOURCES[name]}")`
  return (
    <span
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      className={cn('vicon', className)}
      style={{ width: size, height: size, WebkitMaskImage: url, maskImage: url, ...style }}
    />
  )
}
