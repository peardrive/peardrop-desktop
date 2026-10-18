/**
 * ThemeProvider — applies the active theme to the whole app.
 *
 * Reads the theme preference from the settings store ('dark' | 'light' |
 * 'system'), resolves 'system' against the OS appearance, and writes the
 * theme's tokens as CSS variables on <html>. Every component styles itself
 * with token-based Tailwind classes, so switching theme is one variable swap
 * with no re-render of the tree.
 *
 * Usage: wrap the app once — `<ThemeProvider><App /></ThemeProvider>` — and
 * read the resolved theme anywhere with `useTheme()`.
 */
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { ThemeId } from '@shared/preferences'
import { useSettingsStore } from '../stores/settings-store'
import { applyTheme, THEMES, type Theme } from './themes'

const ThemeContext = createContext<Theme>(THEMES.dark)
const CACHE_KEY = 'peardrop.theme'

function systemTheme(): ThemeId {
  return window.matchMedia?.('(prefers-color-scheme: light)').matches ? 'light' : 'dark'
}

/** Apply the last-used theme before React mounts, to avoid a flash. */
export function applyCachedTheme(): void {
  let id: ThemeId = 'dark'
  try {
    const cached = localStorage.getItem(CACHE_KEY) as ThemeId | null
    if (cached && cached in THEMES) id = cached
  } catch {
    /* storage unavailable */
  }
  applyTheme(THEMES[id])
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const preference = useSettingsStore((s) => s.preferences.appearance.theme)
  const [system, setSystem] = useState<ThemeId>(systemTheme)

  useEffect(() => {
    const mq = window.matchMedia?.('(prefers-color-scheme: light)')
    if (!mq) return
    const onChange = () => setSystem(mq.matches ? 'light' : 'dark')
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])

  const theme = useMemo(() => THEMES[preference === 'system' ? system : preference] ?? THEMES.dark, [preference, system])

  useEffect(() => {
    applyTheme(theme)
    try {
      localStorage.setItem(CACHE_KEY, theme.id)
    } catch {
      /* storage unavailable */
    }
  }, [theme])

  return <ThemeContext.Provider value={theme}>{children}</ThemeContext.Provider>
}

/** The resolved theme (never 'system'). */
export function useTheme(): Theme {
  return useContext(ThemeContext)
}
