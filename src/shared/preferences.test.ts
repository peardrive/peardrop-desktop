import { describe, expect, it } from 'vitest'
import { DEFAULT_PREFERENCES, mergePreferences, sanitizePreferences, themeScheme } from './preferences'
import { UI_SCALE_DEFAULT_STEP, uiScaleFactor } from './ui-scale'

describe('preferences', () => {
  it('fills defaults from garbage', () => {
    expect(sanitizePreferences(null)).toEqual(DEFAULT_PREFERENCES)
    expect(sanitizePreferences({ appearance: { theme: 'neon' }, list: { view: 'tiles' } })).toEqual(DEFAULT_PREFERENCES)
  })
  it('maps the old table/grid layout ids onto the three layouts', () => {
    expect(sanitizePreferences({ list: { view: 'table' } }).list.view).toBe('list')
    expect(sanitizePreferences({ list: { view: 'grid' } }).list.view).toBe('grid')
    expect(sanitizePreferences({ list: { view: 'expanded' } }).list.view).toBe('expanded')
    expect(sanitizePreferences({ list: { tileSize: 'huge' } }).list.tileSize).toBe('medium')
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
  it('clamps the interface size step and the sidebar width', () => {
    expect(sanitizePreferences({ appearance: { uiScale: 7.6 } }).appearance.uiScale).toBe(8)
    expect(sanitizePreferences({ appearance: { uiScale: 99 } }).appearance.uiScale).toBe(20)
    expect(sanitizePreferences({ appearance: { uiScale: -3 } }).appearance.uiScale).toBe(0)
    expect(sanitizePreferences({ appearance: { uiScale: 'big' } }).appearance.uiScale).toBe(DEFAULT_PREFERENCES.appearance.uiScale)
    expect(sanitizePreferences({ layout: { sidebarWidth: 9999 } }).layout.sidebarWidth).toBe(320)
    expect(sanitizePreferences({ layout: { sidebarWidth: 10 } }).layout.sidebarWidth).toBe(140)
    expect(sanitizePreferences({ layout: { sidebarWidth: 211.4 } }).layout.sidebarWidth).toBe(211)
  })
  it('maps steps to zoom factors around the original 100% at step 2', () => {
    expect(uiScaleFactor(0)).toBeCloseTo(0.9)
    expect(uiScaleFactor(2)).toBeCloseTo(1)
    expect(uiScaleFactor(UI_SCALE_DEFAULT_STEP)).toBeCloseTo(1.1)
    expect(uiScaleFactor(20)).toBeCloseTo(1.9)
    expect(uiScaleFactor(2.5)).toBeCloseTo(1.025)
  })
  it('merges section by section', () => {
    const p = mergePreferences(DEFAULT_PREFERENCES, { list: { view: 'expanded' } })
    expect(p.list).toEqual({ ...DEFAULT_PREFERENCES.list, view: 'expanded' })
    expect(p.appearance).toEqual(DEFAULT_PREFERENCES.appearance)
  })
})
