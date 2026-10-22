/**
 * Icon — the app's single SVG icon set.
 *
 * Every glyph is a 24×24 path drawn with `currentColor`, so icons inherit
 * text colour from Tailwind classes (`text-accent`, `text-muted` …) and
 * follow the theme automatically.
 *
 * @example <Icon name="arrow-up" className="h-4 w-4 text-accent" />
 */
import type { SVGProps } from 'react'

type Glyph = { d: string | string[]; fill?: boolean; stroke?: number }

const GLYPHS = {
  'arrow-up': { d: ['M12 19V5', 'M5.5 11.5 12 5l6.5 6.5'], stroke: 2.6 },
  'arrow-down': { d: ['M12 5v14', 'M5.5 12.5 12 19l6.5-6.5'], stroke: 2.6 },
  gear: {
    d: 'M19.14 12.94c.04-.31.06-.62.06-.94s-.02-.63-.07-.94l2.03-1.58a.5.5 0 0 0 .12-.62l-1.92-3.32a.5.5 0 0 0-.6-.22l-2.39.96a7.03 7.03 0 0 0-1.62-.94l-.36-2.54A.48.48 0 0 0 13.9 2.4h-3.84a.48.48 0 0 0-.48.41l-.36 2.54c-.59.24-1.13.56-1.62.94l-2.39-.96a.48.48 0 0 0-.6.22L2.69 8.87a.47.47 0 0 0 .12.61l2.03 1.58c-.05.31-.09.64-.09.94s.02.63.07.94l-2.03 1.58a.5.5 0 0 0-.12.62l1.92 3.32c.12.22.37.29.6.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32a.46.46 0 0 0-.12-.62zM12 15.6A3.6 3.6 0 1 1 12 8.4a3.6 3.6 0 0 1 0 7.2z',
    fill: true
  },
  search: { d: ['M10.5 17a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13z', 'm20 20-4.8-4.8'], stroke: 2.2 },
  filter: { d: ['M4 5h16l-6.2 7.6V19l-3.6-1.8v-4.6z'], stroke: 2 },
  'more-triangle': { d: ['M12 6.5h.01', 'M6.5 16.5h.01', 'M17.5 16.5h.01'], stroke: 4.2 },
  'more-vertical': { d: ['M12 5h.01', 'M12 12h.01', 'M12 19h.01'], stroke: 3.4 },
  close: { d: ['M7 7l10 10', 'M17 7 7 17'], stroke: 2.6 },
  check: { d: 'M5 12.5l4.5 4.5L19 7.5', stroke: 2.8 },
  'chevron-left': { d: 'M15 18l-6-6 6-6', stroke: 2.4 },
  'chevron-right': { d: 'M9 6l6 6-6 6', stroke: 2.4 },
  'chevron-down': { d: 'M6 9l6 6 6-6', stroke: 2.4 },
  play: { d: 'M9 6.5l8.5 5.5L9 17.5z', fill: true },
  stop: { d: 'M7 7h10v10H7z', fill: true },
  folder: {
    d: [
      'M3.4 4h4.2a1.6 1.6 0 0 1 1.13.47L10 5.5H3v.1A1.6 1.6 0 0 1 3.4 4z',
      'M2 8.4a1.6 1.6 0 0 1 1.6-1.6h16.8A1.6 1.6 0 0 1 22 8.4v10.2a1.4 1.4 0 0 1-1.4 1.4H3.4A1.4 1.4 0 0 1 2 18.6z'
    ],
    fill: true
  },
  'folder-outline': { d: 'M3 7.5A2.5 2.5 0 0 1 5.5 5h3.6l2 2h7.4A2.5 2.5 0 0 1 21 9.5v8a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 17.5z', stroke: 2 },
  file: { d: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6zm-1 7V3.5L18.5 9H13z', fill: true },
  star: { d: 'M12 2.5l2.9 6.4 7 .7-5.3 4.8 1.6 6.9L12 17.9l-6.2 3.4 1.6-6.9L2.1 9.6l7-.7z', fill: true },
  link: { d: ['M10 14a4.5 4.5 0 0 0 6.4 0l3-3a4.5 4.5 0 0 0-6.4-6.4l-1 1', 'M14 10a4.5 4.5 0 0 0-6.4 0l-3 3a4.5 4.5 0 0 0 6.4 6.4l1-1'], stroke: 2.2 },
  qr: {
    d: ['M3 3h7v7H3z', 'M14 3h7v7h-7z', 'M3 14h7v7H3z', 'M14 14h3v3h-3z', 'M20 14v3', 'M14 20h3', 'M20 20v.01'],
    stroke: 2
  },
  copy: { d: ['M9 9h10v12H9z', 'M5 15V3h10'], stroke: 2 },
  camera: { d: ['M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z', 'M12 17a4 4 0 1 0 0-8 4 4 0 0 0 0 8z'], stroke: 2 },
  image: { d: ['M4 5h16v14H4z', 'M8.5 10a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3z', 'M20 15l-5-5L5 19'], stroke: 2 },
  refresh: { d: ['M20 11a8 8 0 0 0-14.6-4.5L4 8', 'M4 4v4h4', 'M4 13a8 8 0 0 0 14.6 4.5L20 16', 'M20 20v-4h-4'], stroke: 2.2 },
  trash: { d: ['M4 7h16', 'M10 11v6', 'M14 11v6', 'M6 7l1 13h10l1-13', 'M9 7V4h6v3'], stroke: 2 },
  info: { d: ['M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z', 'M12 11v5', 'M12 8h.01'], stroke: 2.2 },
  warning: { d: ['M12 3 2 20h20z', 'M12 10v4', 'M12 17h.01'], stroke: 2.2 },
  'alert-octagon': {
    d: 'M7.8 3.8C9.9 2.6 10.9 2 12 2s2.1.6 4.2 1.8l.7.4c2 1.2 3 1.8 3.6 2.8.6 1 .6 2.2.6 4.6v.8c0 2.4 0 3.6-.6 4.6s-1.6 1.6-3.6 2.8l-.7.4C14.1 21.4 13.1 22 12 22s-2.1-.6-4.2-1.8l-.7-.4c-2-1.2-3-1.8-3.6-2.8C3 16 3 14.8 3 12.4v-.8c0-2.4 0-3.6.6-4.6s1.6-1.6 3.6-2.8zM13 16a1 1 0 1 0-2 0 1 1 0 0 0 2 0m-1-9.75a.75.75 0 0 0-.75.75v6a.75.75 0 0 0 1.5 0V7a.75.75 0 0 0-.75-.75',
    fill: true
  },
  sun: { d: ['M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10z', 'M12 1v2', 'M12 21v2', 'M4.2 4.2l1.4 1.4', 'M18.4 18.4l1.4 1.4', 'M1 12h2', 'M21 12h2', 'M4.2 19.8l1.4-1.4', 'M18.4 5.6l1.4-1.4'], stroke: 2 },
  moon: { d: 'M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z', stroke: 2 },
  monitor: { d: ['M3 4h18v12H3z', 'M8 20h8', 'M12 16v4'], stroke: 2 },
  server: { d: ['M4 4h16v6H4z', 'M4 14h16v6H4z', 'M8 7h.01', 'M8 17h.01'], stroke: 2.2 },
  network: { d: ['M12 4a2 2 0 1 0 0 4 2 2 0 0 0 0-4z', 'M5 16a2 2 0 1 0 0 4 2 2 0 0 0 0-4z', 'M19 16a2 2 0 1 0 0 4 2 2 0 0 0 0-4z', 'M12 8v4', 'M12 12l-6 4', 'M12 12l6 4'], stroke: 2 },
  terminal: { d: ['M4 5h16v14H4z', 'M8 10l3 2-3 2', 'M13 15h4'], stroke: 2 },
  bug: { d: ['M8 9a4 4 0 0 1 8 0v5a4 4 0 0 1-8 0z', 'M12 9v9', 'M4 13h4', 'M16 13h4', 'M5 7l3 2', 'M19 7l-3 2', 'M5 19l3-2', 'M19 19l-3-2', 'M9 5l1.5 1.5', 'M15 5l-1.5 1.5'], stroke: 1.9 },
  palette: {
    d: 'M12 3a9 9 0 0 0 0 18c1 0 1.6-.7 1.6-1.5 0-.4-.2-.8-.4-1.1-.3-.3-.4-.7-.4-1.1 0-.9.7-1.5 1.6-1.5H16a5 5 0 0 0 5-5c0-4.3-4-7.8-9-7.8zM6.5 12a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3zm3-4a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3zm5 0a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3zm3 4a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3z',
    fill: true
  },
  grid: { d: ['M4 4h7v7H4z', 'M13 4h7v7h-7z', 'M4 13h7v7H4z', 'M13 13h7v7h-7z'], stroke: 2 },
  table: { d: ['M4 5h16', 'M4 12h16', 'M4 19h16', 'M8 5v14'], stroke: 2.2 },
  sort: { d: ['M7 4v16', 'M3.5 16.5 7 20l3.5-3.5', 'M17 20V4', 'M13.5 7.5 17 4l3.5 3.5'], stroke: 2 },
  external: { d: ['M14 4h6v6', 'M20 4l-9 9', 'M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5'], stroke: 2 },
  pencil: { d: ['M4 20h4L19 9l-4-4L4 16z', 'M13.5 6.5l4 4'], stroke: 2 },
  log: { d: ['M6 3h9l4 4v14H6z', 'M14 3v5h5', 'M9 12h7', 'M9 16h7'], stroke: 2 },
  plus: { d: ['M12 5v14', 'M5 12h14'], stroke: 2.6 },
  'wifi-off': { d: ['M2 2l20 20', 'M8.5 16.4a5 5 0 0 1 7 0', 'M5 12.9a10 10 0 0 1 5.2-2.8', 'M14.5 10.2A10 10 0 0 1 19 12.9', 'M1.4 9a15 15 0 0 1 4.3-2.6', 'M10.7 5.1A15 15 0 0 1 22.6 9', 'M12 20h.01'], stroke: 2 },
  shield: { d: ['M12 3l8 3v6c0 4.5-3.4 8.3-8 9-4.6-.7-8-4.5-8-9V6z', 'M8.5 12l2.5 2.5 4.5-5'], stroke: 2 },
  bolt: { d: 'M13 2L4 14h7l-1 8 9-12h-7z', fill: true }
} satisfies Record<string, Glyph>

export type IconName = keyof typeof GLYPHS

export interface IconProps extends Omit<SVGProps<SVGSVGElement>, 'name'> {
  name: IconName
  /** Accessible label; omit for decorative icons. */
  label?: string
}

export function Icon({ name, label, className, ...rest }: IconProps) {
  const g: Glyph = GLYPHS[name]
  const paths = Array.isArray(g.d) ? g.d : [g.d]
  return (
    <svg
      viewBox="0 0 24 24"
      className={className ?? 'h-4 w-4'}
      fill={g.fill ? 'currentColor' : 'none'}
      stroke={g.fill ? 'none' : 'currentColor'}
      strokeWidth={g.stroke ?? 2}
      strokeLinecap="round"
      strokeLinejoin="round"
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      {...rest}
    >
      {paths.map((d, i) => (
        <path key={i} d={d} />
      ))}
    </svg>
  )
}
