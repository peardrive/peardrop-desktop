import { describe, expect, it } from 'vitest'
import { DEFAULT_PREFERENCES, mergePreferences, sanitizePreferences } from './preferences'

describe('preferences', () => {
  it('fills defaults from garbage', () => {
    expect(sanitizePreferences(null)).toEqual(DEFAULT_PREFERENCES)
    expect(sanitizePreferences({ appearance: { theme: 'neon' }, list: { view: 'cards' } })).toEqual(DEFAULT_PREFERENCES)
  })
  it('keeps valid values and trims the bootstrap', () => {
    const p = sanitizePreferences({ appearance: { theme: 'light' }, network: { bootstrap: '  1.2.3.4:5 ' }, diagnostics: { debug: true } })
    expect(p.appearance.theme).toBe('light')
    expect(p.network.bootstrap).toBe('1.2.3.4:5')
    expect(p.diagnostics.debug).toBe(true)
  })
  it('merges section by section', () => {
    const p = mergePreferences(DEFAULT_PREFERENCES, { list: { view: 'table' } })
    expect(p.list).toEqual({ ...DEFAULT_PREFERENCES.list, view: 'table' })
    expect(p.appearance).toEqual(DEFAULT_PREFERENCES.appearance)
  })
})
