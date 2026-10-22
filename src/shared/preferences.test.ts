import { describe, expect, it } from 'vitest'
import { DEFAULT_PREFERENCES, mergePreferences, sanitizePreferences, themeScheme } from './preferences'

describe('preferences', () => {
  it('fills defaults from garbage', () => {
    expect(sanitizePreferences(null)).toEqual(DEFAULT_PREFERENCES)
    expect(sanitizePreferences({ appearance: { theme: 'neon' }, list: { view: 'cards' } })).toEqual(DEFAULT_PREFERENCES)
  })
  it('maps the old dark/light ids onto the theme set', () => {
    expect(sanitizePreferences({ appearance: { theme: 'dark' } }).appearance.theme).toBe('void')
    expect(sanitizePreferences({ appearance: { theme: 'light' } }).appearance.theme).toBe('paper')
    expect(sanitizePreferences({ appearance: { theme: 'synth' } }).appearance.theme).toBe('synth')
    expect(themeScheme('cream')).toBe('light')
    expect(themeScheme('ocean')).toBe('dark')
  })
  it('keeps valid values and trims the bootstrap', () => {
    const p = sanitizePreferences({ appearance: { theme: 'ember' }, network: { bootstrap: '  1.2.3.4:5 ' }, diagnostics: { debug: true } })
    expect(p.appearance.theme).toBe('ember')
    expect(p.network.bootstrap).toBe('1.2.3.4:5')
    expect(p.diagnostics.debug).toBe(true)
  })
  it('merges section by section', () => {
    const p = mergePreferences(DEFAULT_PREFERENCES, { list: { view: 'table' } })
    expect(p.list).toEqual({ ...DEFAULT_PREFERENCES.list, view: 'table' })
    expect(p.appearance).toEqual(DEFAULT_PREFERENCES.appearance)
  })
})
