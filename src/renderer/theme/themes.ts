/**
 * Theme definitions.
 *
 * A theme is a flat map of design tokens. Colour tokens are hex strings and
 * become `--pd-<token>` CSS variables holding "r g b" channels, which the
 * Tailwind config maps to utilities (`bg-panel`, `text-muted`, `border-line`,
 * `bg-accent/15` …). Effect tokens (glass, shadows) are passed through as-is.
 *
 * Themes are defined as palettes (the PearDrop theme set shared with the
 * mobile app) and expanded into these tokens by `buildTheme`: translucent
 * palette colours are flattened onto the theme background, so every token
 * stays a solid colour that Tailwind opacity modifiers can work with.
 *
 * To add a theme: add a palette below, list it in PALETTES, and add its id to
 * THEME_IDS (and LIGHT_THEME_IDS if it is light) in @shared/preferences. No
 * component changes are needed.
 */
import { LIGHT_THEME_IDS, THEME_IDS, type ThemeId } from '@shared/preferences'

export interface ThemeColors {
  /** Window background behind the content panel. */
  canvas: string
  /** Main content panel / active tab. */
  panel: string
  /** Segmented tab container. */
  tabs: string
  /** Raised surfaces: menus, cards on hover, chips. */
  raised: string
  /** Input fields. */
  field: string
  /** Dividers and outlines. */
  line: string
  fg: string
  muted: string
  subtle: string
  /** Brand pear-green, used for fills and outlines. */
  accent: string
  /** Accent used as TEXT on panel backgrounds (contrast-tuned per theme). */
  'accent-strong': string
  /** Text drawn on top of an accent fill. */
  'on-accent': string
  success: string
  warning: string
  danger: string
  info: string
  folder: string
  star: string
  /** Network status "Connected" (signal bars). */
  online: string
  /** Inbound / download speed accent (outbound uses `accent`). */
  inbound: string
}

export interface ThemeEffects {
  /** Frosted modal fill (rgba). */
  glass: string
  /** backdrop-filter of frosted surfaces. */
  'glass-blur': string
  'glass-border': string
  /** Backdrop behind modals (rgba). Never blurred — the modal blurs. */
  overlay: string
  'shadow-modal': string
  'shadow-menu': string
  /** Fill of the active sidebar list item (rgba). */
  'tab-active': string
}

export interface Theme {
  id: ThemeId
  label: string
  description: string
  /** Whether native controls/scrollbars should render dark. */
  scheme: 'dark' | 'light'
  colors: ThemeColors
  effects: ThemeEffects
}

// ─── palettes ─────────────────────────────────────────────────────────────
// The shared PearDrop theme set (same ids, names and colours as the mobile
// app). Each palette is turned into the desktop's tokens by `buildTheme`.

/** A palette as defined for every PearDrop app. `radius`/`pad` are mobile-only. */
interface Palette {
  id: ThemeId
  label: string
  description: string
  bg: string
  card: string
  cardStrong: string
  border: string
  text: string
  muted: string
  primary: string
  primaryMuted: string
  secondary: string
  secondaryDark: string
  openAccent: string
  danger: string
  onPrimary: string
  surfaceSubtle: string
  tabActiveOverlay: string
  tabBadgeBg: string
  /** Amber "Sharing (NN%)" state colour, per theme so contrast is right on every surface. */
  warning: string
  grabGradient: readonly [string, string]
  /** Modal backdrop wash. */
  scrim: string
  radius: number
  pad: number
}

const voidTheme: Palette = {
  id: 'void',
  label: 'Pear dark',
  description: 'Near-black background and pear green accents.',
  bg: '#08080d',
  card: 'rgba(255,255,255,0.05)',
  cardStrong: 'rgba(255,255,255,0.07)',
  border: 'rgba(255,255,255,0.08)',
  text: '#F3F4F6',
  muted: 'rgba(255,255,255,0.45)',
  primary: '#a8cf3a',
  primaryMuted: '#75bf52',
  secondary: '#489fc1',
  secondaryDark: '#2d6586',
  openAccent: '#60a5fa',
  danger: '#EF4444',
  onPrimary: '#0a140a',
  surfaceSubtle: 'rgba(255,255,255,0.03)',
  tabActiveOverlay: 'rgba(168, 207, 58, 0.12)',
  tabBadgeBg: 'rgba(255,255,255,0.1)',
  warning: '#f59e0b',
  grabGradient: ['#a8cf3a', '#75bf52'] as const,
  scrim: 'rgba(0,0,0,0.5)',
  radius: 16,
  pad: 16,
};

const pearTheme: Palette = {
  id: 'pear',
  label: 'Pear',
  description: 'Light pear-green surface with the brand green as primary.',
  bg: '#f5f9ec',
  card: '#ffffff',
  cardStrong: '#eef5db',
  border: 'rgba(26, 36, 16, 0.14)',
  text: '#1a2410',
  muted: '#556155',
  primary: '#a8cf3a',
  primaryMuted: '#4d7c0f',
  secondary: '#0891b2',
  secondaryDark: '#0e7490',
  openAccent: '#2563eb',
  danger: '#b91c1c',
  onPrimary: '#0a140a',
  surfaceSubtle: 'rgba(26, 36, 16, 0.05)',
  tabActiveOverlay: 'rgba(168, 207, 58, 0.22)',
  tabBadgeBg: 'rgba(26, 36, 16, 0.08)',
  warning: '#b45309',
  grabGradient: ['#a8cf3a', '#4d7c0f'] as const,
  scrim: 'rgba(0,0,0,0.5)',
  radius: 16,
  pad: 16,
};

const oceanTheme: Palette = {
  id: 'ocean',
  label: 'Ocean',
  description: 'Deep blue surfaces with cyan highlights.',
  bg: '#0a1628',
  card: 'rgba(56, 189, 248, 0.06)',
  cardStrong: 'rgba(15, 23, 42, 0.85)',
  border: 'rgba(125, 211, 252, 0.12)',
  text: '#e0f2fe',
  muted: 'rgba(224, 242, 254, 0.55)',
  primary: '#22d3ee',
  primaryMuted: '#06b6d4',
  secondary: '#38bdf8',
  secondaryDark: '#0ea5e9',
  openAccent: '#7dd3fc',
  danger: '#f87171',
  onPrimary: '#042f2e',
  surfaceSubtle: 'rgba(14, 165, 233, 0.08)',
  tabActiveOverlay: 'rgba(34, 211, 238, 0.18)',
  tabBadgeBg: 'rgba(56, 189, 248, 0.2)',
  warning: '#fbbf24',
  grabGradient: ['#22d3ee', '#06b6d4'] as const,
  scrim: 'rgba(0,0,0,0.5)',
  radius: 16,
  pad: 16,
};

const paperTheme: Palette = {
  id: 'paper',
  label: 'Paper',
  description: 'Light background with dark text and pear green actions.',
  bg: '#f4f4f5',
  card: '#ffffff',
  cardStrong: '#fafafa',
  // Contrast audit: bumped border opacity from 0.1 → 0.14 so card outlines
  // remain visible over near-white surfaces.
  border: 'rgba(24, 24, 27, 0.14)',
  text: '#18181b',
  // Contrast audit: muted was #71717a (~4.4:1 on #f4f4f5). Dropping to
  // zinc-600 (#52525b) pushes small-text contrast above WCAG AA (~7:1).
  muted: '#52525b',
  primary: '#84cc16',
  // Contrast audit: WCAG prefers deeper greens for accent text over white
  // cards; primaryMuted moved to #4d7c0f (lime-700) for border/checkbox
  // secondary states.
  primaryMuted: '#4d7c0f',
  secondary: '#0891b2',
  secondaryDark: '#0e7490',
  openAccent: '#2563eb',
  danger: '#b91c1c',
  onPrimary: '#0f172a',
  surfaceSubtle: 'rgba(24, 24, 27, 0.05)',
  tabActiveOverlay: 'rgba(132, 204, 22, 0.22)',
  tabBadgeBg: 'rgba(24, 24, 27, 0.08)',
  warning: '#b45309',
  grabGradient: ['#84cc16', '#4d7c0f'] as const,
  scrim: 'rgba(0,0,0,0.5)',
  radius: 16,
  pad: 16,
};

const emberTheme: Palette = {
  id: 'ember',
  label: 'Ember',
  description: 'Warm browns and amber highlights, easy on the eyes at night.',
  bg: '#14110e',
  card: 'rgba(251, 191, 36, 0.06)',
  cardStrong: 'rgba(68, 64, 60, 0.55)',
  border: 'rgba(251, 191, 36, 0.12)',
  text: '#fafaf9',
  muted: 'rgba(250, 250, 249, 0.5)',
  primary: '#f59e0b',
  primaryMuted: '#d97706',
  secondary: '#fb923c',
  secondaryDark: '#ea580c',
  openAccent: '#fcd34d',
  danger: '#f87171',
  onPrimary: '#1c1410',
  surfaceSubtle: 'rgba(245, 158, 11, 0.07)',
  tabActiveOverlay: 'rgba(245, 158, 11, 0.15)',
  tabBadgeBg: 'rgba(251, 191, 36, 0.12)',
  warning: '#fcd34d',
  grabGradient: ['#f59e0b', '#d97706'] as const,
  scrim: 'rgba(0,0,0,0.5)',
  radius: 16,
  pad: 16,
};

const forestTheme: Palette = {
  id: 'forest',
  label: 'Forest',
  description: 'Dark green surfaces with emerald action buttons.',
  bg: '#0c1612',
  card: 'rgba(52, 211, 153, 0.07)',
  cardStrong: 'rgba(20, 83, 45, 0.35)',
  border: 'rgba(167, 243, 208, 0.12)',
  text: '#ecfdf5',
  muted: 'rgba(236, 253, 245, 0.5)',
  primary: '#34d399',
  primaryMuted: '#10b981',
  secondary: '#2dd4bf',
  secondaryDark: '#0d9488',
  openAccent: '#6ee7b7',
  danger: '#fb7185',
  onPrimary: '#022c22',
  surfaceSubtle: 'rgba(16, 185, 129, 0.08)',
  tabActiveOverlay: 'rgba(52, 211, 153, 0.16)',
  tabBadgeBg: 'rgba(167, 243, 208, 0.12)',
  warning: '#fbbf24',
  grabGradient: ['#34d399', '#10b981'] as const,
  scrim: 'rgba(0,0,0,0.5)',
  radius: 16,
  pad: 16,
};

const lavenderTheme: Palette = {
  id: 'lavender',
  label: 'Lavender',
  description: 'Cool purple-gray base with soft violet accents.',
  bg: '#13101a',
  card: 'rgba(167, 139, 250, 0.08)',
  cardStrong: 'rgba(76, 29, 149, 0.35)',
  border: 'rgba(196, 181, 253, 0.14)',
  text: '#f5f3ff',
  muted: 'rgba(245, 243, 255, 0.52)',
  primary: '#a78bfa',
  primaryMuted: '#8b5cf6',
  secondary: '#c084fc',
  secondaryDark: '#9333ea',
  openAccent: '#c4b5fd',
  danger: '#f472b6',
  onPrimary: '#1e1b4b',
  surfaceSubtle: 'rgba(139, 92, 246, 0.1)',
  tabActiveOverlay: 'rgba(167, 139, 250, 0.18)',
  tabBadgeBg: 'rgba(196, 181, 253, 0.12)',
  warning: '#fbbf24',
  grabGradient: ['#a78bfa', '#8b5cf6'] as const,
  scrim: 'rgba(0,0,0,0.5)',
  radius: 16,
  pad: 16,
};

const roseTheme: Palette = {
  id: 'rose',
  label: 'Rose',
  description: 'Soft pinks and rose gold accents on a dark plum base.',
  bg: '#181016',
  card: 'rgba(244, 114, 182, 0.07)',
  cardStrong: 'rgba(131, 24, 67, 0.4)',
  border: 'rgba(251, 207, 232, 0.14)',
  text: '#fdf2f8',
  muted: 'rgba(253, 242, 248, 0.52)',
  primary: '#f472b6',
  primaryMuted: '#ec4899',
  secondary: '#fb7185',
  secondaryDark: '#e11d48',
  openAccent: '#fda4af',
  danger: '#fbbf24',
  onPrimary: '#500724',
  surfaceSubtle: 'rgba(244, 114, 182, 0.09)',
  tabActiveOverlay: 'rgba(244, 114, 182, 0.16)',
  tabBadgeBg: 'rgba(251, 207, 232, 0.12)',
  warning: '#fbbf24',
  grabGradient: ['#f472b6', '#ec4899'] as const,
  scrim: 'rgba(0,0,0,0.5)',
  radius: 16,
  pad: 16,
};

const slateTheme: Palette = {
  id: 'slate',
  label: 'Slate',
  description: 'Blue-gray chrome and silver accents on charcoal.',
  bg: '#0f1419',
  card: 'rgba(148, 163, 184, 0.08)',
  cardStrong: 'rgba(51, 65, 85, 0.45)',
  border: 'rgba(148, 163, 184, 0.14)',
  text: '#f1f5f9',
  muted: 'rgba(241, 245, 249, 0.48)',
  primary: '#94a3b8',
  primaryMuted: '#64748b',
  secondary: '#7dd3fc',
  secondaryDark: '#38bdf8',
  openAccent: '#bae6fd',
  danger: '#f87171',
  onPrimary: '#0f172a',
  surfaceSubtle: 'rgba(71, 85, 105, 0.2)',
  tabActiveOverlay: 'rgba(148, 163, 184, 0.18)',
  tabBadgeBg: 'rgba(148, 163, 184, 0.15)',
  warning: '#fbbf24',
  grabGradient: ['#94a3b8', '#64748b'] as const,
  scrim: 'rgba(0,0,0,0.5)',
  radius: 16,
  pad: 16,
};

const creamTheme: Palette = {
  id: 'cream',
  label: 'Cream',
  description: 'Warm off-white with terracotta and cocoa text.',
  bg: '#faf7f2',
  card: '#ffffff',
  cardStrong: '#f5efe6',
  // Contrast audit: slight bump for clearer card outlines on warm paper.
  border: 'rgba(68, 52, 44, 0.16)',
  text: '#292524',
  // Contrast audit: muted was #78716c (~4.1:1). Dropping to stone-600
  // (#57534e) puts caption text above WCAG AA (~7.1:1).
  muted: '#57534e',
  primary: '#c2410c',
  primaryMuted: '#7c2d12',
  secondary: '#0d9488',
  secondaryDark: '#0f766e',
  openAccent: '#1d4ed8',
  danger: '#b91c1c',
  onPrimary: '#fffbeb',
  surfaceSubtle: 'rgba(68, 52, 44, 0.06)',
  tabActiveOverlay: 'rgba(194, 65, 12, 0.14)',
  tabBadgeBg: 'rgba(68, 52, 44, 0.09)',
  warning: '#b45309',
  grabGradient: ['#c2410c', '#7c2d12'] as const,
  scrim: 'rgba(0,0,0,0.5)',
  radius: 16,
  pad: 16,
};

const synthTheme: Palette = {
  id: 'synth',
  label: 'Synth',
  description: 'High-contrast neon pink and cyan on a pitch-black stage.',
  bg: '#050508',
  card: 'rgba(236, 72, 153, 0.06)',
  cardStrong: 'rgba(6, 182, 212, 0.08)',
  border: 'rgba(34, 211, 238, 0.15)',
  text: '#fafafa',
  muted: 'rgba(250, 250, 250, 0.45)',
  primary: '#ec4899',
  primaryMuted: '#db2777',
  secondary: '#22d3ee',
  secondaryDark: '#06b6d4',
  openAccent: '#67e8f9',
  danger: '#fbbf24',
  onPrimary: '#1e0424',
  surfaceSubtle: 'rgba(236, 72, 153, 0.06)',
  tabActiveOverlay: 'rgba(236, 72, 153, 0.14)',
  tabBadgeBg: 'rgba(34, 211, 238, 0.12)',
  warning: '#fbbf24',
  grabGradient: ['#ec4899', '#db2777'] as const,
  scrim: 'rgba(0,0,0,0.5)',
  radius: 16,
  pad: 16,
};

// ─── palette → desktop tokens ────────────────────────────────────────────

type Rgba = { r: number; g: number; b: number; a: number }

function parseColor(c: string): Rgba {
  const v = c.trim()
  if (v.startsWith('#')) {
    const h = v.slice(1)
    const full = h.length === 3 ? h.split('').map((x) => x + x).join('') : h
    const n = parseInt(full.slice(0, 6), 16)
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255, a: 1 }
  }
  const m = v.match(/rgba?\(([^)]+)\)/i)
  if (!m) throw new Error(`Unsupported colour: ${c}`)
  const [r, g, b, a = '1'] = m[1].split(',').map((x) => x.trim())
  return { r: +r, g: +g, b: +b, a: +a }
}

const hex = ({ r, g, b }: Pick<Rgba, 'r' | 'g' | 'b'>) => `#${[r, g, b].map((x) => Math.round(x).toString(16).padStart(2, '0')).join('')}`

/** `top` (possibly translucent) painted over an opaque `under`. */
function over(top: string, under: string, alpha?: number): string {
  const t = parseColor(top)
  const u = parseColor(under)
  const a = alpha ?? t.a
  return hex({ r: t.r * a + u.r * (1 - a), g: t.g * a + u.g * (1 - a), b: t.b * a + u.b * (1 - a) })
}

const rgba = (c: string, a: number) => {
  const { r, g, b } = parseColor(c)
  return `rgba(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)}, ${a})`
}

/** How far light surfaces move toward the text colour (0 = palette as-is). */
const LIGHT_DIM = { canvas: 0.085, panel: 0.06, raised: 0.035 }

export function buildTheme(p: Palette, scheme: 'dark' | 'light'): Theme {
  const dark = scheme === 'dark'
  // Light palettes are tuned for phones; on a desktop monitor, looked at for
  // hours, pure-white surfaces glare. Every light surface is pulled a few
  // percent toward the theme's own text colour, so it keeps its tint (pear
  // green, cream warmth) and the text/surface contrast only gets softer at
  // the extremes. Text and accent colours are untouched.
  const soften = (surface: string, amount: number) => (dark ? surface : over(p.text, surface, amount))
  const canvas = soften(over(p.bg, '#000000'), LIGHT_DIM.canvas)
  const panel = soften(over(p.card, over(p.bg, '#000000')), LIGHT_DIM.panel)
  const muted = over(p.muted, canvas)
  return {
    id: p.id,
    label: p.label,
    description: p.description,
    scheme,
    colors: {
      canvas,
      panel,
      tabs: over(p.text, canvas, 0.2),
      raised: soften(over(p.cardStrong, panel), LIGHT_DIM.raised),
      field: over(p.text, panel, dark ? 0.1 : 0.06),
      line: over(p.border, panel),
      fg: p.text,
      muted,
      subtle: over(muted, canvas, 0.7),
      accent: p.primary,
      // Accent as text on panels: the brighter primary on dark, the deeper one on light.
      'accent-strong': dark ? p.primary : p.primaryMuted,
      'on-accent': p.onPrimary,
      success: dark ? '#6ac168' : '#2d8f3f',
      warning: p.warning,
      danger: p.danger,
      info: p.openAccent,
      folder: dark ? '#6ee0d3' : '#27a99a',
      star: dark ? '#f5c518' : '#dfa400',
      online: dark ? '#34d399' : '#0f9f6e',
      inbound: p.secondary
    },
    effects: dark
      ? {
          // Light, translucent tint + gentle blur keeps shapes behind readable.
          glass: rgba(over(p.text, canvas, 0.75), 0.22),
          'glass-blur': 'blur(6px) saturate(150%)',
          'glass-border': rgba(p.text, 0.1),
          overlay: p.scrim,
          'shadow-modal': `inset 0 1px 0 ${rgba(p.text, 0.1)}`,
          'shadow-menu': '0 14px 36px rgba(0, 0, 0, 0.55)',
          'tab-active': p.tabActiveOverlay
        }
      : {
          glass: rgba(panel, 0.86),
          'glass-blur': 'blur(14px) saturate(160%)',
          'glass-border': rgba(p.text, 0.08),
          overlay: p.scrim,
          'shadow-modal': '0 24px 60px rgba(20, 20, 40, 0.18), inset 0 1px 0 rgba(255, 255, 255, 0.7)',
          'shadow-menu': '0 14px 36px rgba(20, 20, 40, 0.18)',
          'tab-active': p.tabActiveOverlay
        }
  }
}

const PALETTES: Record<ThemeId, Palette> = {
  void: voidTheme,
  pear: pearTheme,
  ocean: oceanTheme,
  paper: paperTheme,
  ember: emberTheme,
  forest: forestTheme,
  lavender: lavenderTheme,
  rose: roseTheme,
  slate: slateTheme,
  cream: creamTheme,
  synth: synthTheme
}

export const THEMES = Object.fromEntries(
  THEME_IDS.map((id) => [id, buildTheme(PALETTES[id], LIGHT_THEME_IDS.includes(id) ? 'light' : 'dark')])
) as Record<ThemeId, Theme>

const hexToChannels = (hex: string): string => {
  const h = hex.replace('#', '')
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h
  const n = parseInt(full, 16)
  return `${(n >> 16) & 255} ${(n >> 8) & 255} ${n & 255}`
}

/** CSS custom properties for a theme. */
export function themeToCssVars(theme: Theme): Record<string, string> {
  const vars: Record<string, string> = {}
  for (const [k, v] of Object.entries(theme.colors)) vars[`--pd-${k}`] = hexToChannels(v)
  for (const [k, v] of Object.entries(theme.effects)) vars[`--pd-${k}`] = v
  return vars
}

/** Write a theme onto <html> (CSS vars + data attributes + color-scheme). */
export function applyTheme(theme: Theme, root: HTMLElement = document.documentElement): void {
  for (const [k, v] of Object.entries(themeToCssVars(theme))) root.style.setProperty(k, v)
  root.dataset.theme = theme.id
  root.dataset.themeMode = theme.scheme
  root.style.colorScheme = theme.scheme
}
