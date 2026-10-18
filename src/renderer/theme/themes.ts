/**
 * Theme definitions.
 *
 * A theme is a flat map of design tokens. Colour tokens are hex strings and
 * become `--pd-<token>` CSS variables holding "r g b" channels, which the
 * Tailwind config maps to utilities (`bg-panel`, `text-muted`, `border-line`,
 * `bg-accent/15` …). Effect tokens (glass, shadows) are passed through as-is.
 *
 * To add a theme: add an entry to THEMES (and its id to THEME_IDS in
 * @shared/preferences). No component changes are needed.
 */
import type { ThemeId } from '@shared/preferences'

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
}

export interface Theme {
  id: ThemeId
  label: string
  /** Whether native controls/scrollbars should render dark. */
  scheme: 'dark' | 'light'
  colors: ThemeColors
  effects: ThemeEffects
}

export const THEMES: Record<ThemeId, Theme> = {
  dark: {
    id: 'dark',
    label: 'Dark',
    scheme: 'dark',
    colors: {
      canvas: '#000000',
      panel: '#1a1a20',
      tabs: '#2e2e34',
      raised: '#26262d',
      field: '#2a2a31',
      line: '#3a3a42',
      fg: '#ffffff',
      muted: '#9a9aa4',
      subtle: '#6b6b75',
      accent: '#a8ce38',
      'accent-strong': '#b6da4c',
      'on-accent': '#10140a',
      success: '#6ac168',
      warning: '#f0b840',
      danger: '#ef4a5f',
      info: '#4a9eff',
      folder: '#6ee0d3',
      star: '#f5c518'
    },
    effects: {
      // Amir's tuned "best glass": light tint + gentle blur keeps shapes behind readable.
      glass: 'rgba(180, 184, 195, 0.22)',
      'glass-blur': 'blur(6px) saturate(150%)',
      'glass-border': 'rgba(255, 255, 255, 0.10)',
      overlay: 'rgba(0, 0, 0, 0.35)',
      'shadow-modal': 'inset 0 1px 0 rgba(255, 255, 255, 0.10)',
      'shadow-menu': '0 14px 36px rgba(0, 0, 0, 0.55)'
    }
  },
  light: {
    id: 'light',
    label: 'Light',
    scheme: 'light',
    colors: {
      canvas: '#e6e6eb',
      panel: '#f8f8fa',
      tabs: '#dcdce3',
      raised: '#ffffff',
      field: '#ffffff',
      line: '#dadae1',
      fg: '#17171b',
      muted: '#5f5f69',
      subtle: '#8d8d97',
      accent: '#a8ce38',
      'accent-strong': '#56730b',
      'on-accent': '#10140a',
      success: '#2d8f3f',
      warning: '#b06f12',
      danger: '#d42f4a',
      info: '#2f7de1',
      folder: '#27a99a',
      star: '#dfa400'
    },
    effects: {
      glass: 'rgba(250, 250, 252, 0.82)',
      'glass-blur': 'blur(14px) saturate(160%)',
      'glass-border': 'rgba(0, 0, 0, 0.08)',
      overlay: 'rgba(24, 24, 32, 0.28)',
      'shadow-modal': '0 24px 60px rgba(20, 20, 40, 0.18), inset 0 1px 0 rgba(255, 255, 255, 0.7)',
      'shadow-menu': '0 14px 36px rgba(20, 20, 40, 0.18)'
    }
  }
}

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
