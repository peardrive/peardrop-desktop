/**
 * ThemePicker — every PearDrop theme as a small card with a live mini
 * preview of its palette, plus "System" (Pear dark or Paper, following the
 * OS appearance). Writes `appearance.theme` to preferences.
 *
 * @example <ThemePicker />
 */
import { SYSTEM_THEMES, THEME_IDS, type ThemePreference } from '@shared/preferences'
import { cn } from '../../lib/cn'
import { useSettingsStore } from '../../stores/settings-store'
import { THEMES, type Theme } from '../../theme/themes'
import { Icon } from '../../components/ui/Icon'

function Swatch({ theme }: { theme: Theme }) {
  const c = theme.colors
  return (
    <div className="h-full w-full p-1.5" style={{ background: c.canvas }}>
      <div className="flex h-full flex-col gap-1 rounded-[5px] p-1.5" style={{ background: c.panel }}>
        <div className="h-1.5 w-2/3 rounded-full" style={{ background: c.fg, opacity: 0.85 }} />
        <div className="h-1 w-1/2 rounded-full" style={{ background: c.muted }} />
        <div className="mt-auto flex gap-1">
          <div className="h-2 w-6 rounded-full" style={{ background: c.accent }} />
          <div className="h-2 w-4 rounded-full" style={{ background: c.inbound }} />
        </div>
      </div>
    </div>
  )
}

const OPTIONS: ThemePreference[] = [...THEME_IDS, 'system']

export function ThemePicker() {
  const value = useSettingsStore((s) => s.preferences.appearance.theme)
  const update = useSettingsStore((s) => s.updatePreferences)
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(112px,1fr))] gap-2" role="radiogroup" aria-label="Theme">
      {OPTIONS.map((id) => {
        const active = id === value
        const theme = id === 'system' ? null : THEMES[id]
        return (
          <button
            key={id}
            type="button"
            role="radio"
            aria-checked={active}
            title={theme ? theme.description : 'Pear dark or Paper, following your system appearance.'}
            onClick={() => void update({ appearance: { theme: id } })}
            className={cn(
              'overflow-hidden rounded-lg border text-left transition-colors',
              active ? 'border-accent ring-1 ring-accent' : 'border-fg/10 hover:border-fg/30'
            )}
          >
            <div className="flex h-[44px]">
              {theme ? (
                <Swatch theme={theme} />
              ) : (
                <>
                  <div className="w-1/2 overflow-hidden">
                    <Swatch theme={THEMES[SYSTEM_THEMES.dark]} />
                  </div>
                  <div className="w-1/2 overflow-hidden">
                    <Swatch theme={THEMES[SYSTEM_THEMES.light]} />
                  </div>
                </>
              )}
            </div>
            <div className="flex items-center gap-1.5 px-2 py-1.5 text-[11px] font-semibold">
              {!theme && <Icon name="monitor" className="h-3 w-3 text-muted" />}
              <span className="truncate">{theme ? theme.label : 'System'}</span>
              {active && <Icon name="check" className="ml-auto h-3 w-3 shrink-0 text-accent-strong" />}
            </div>
          </button>
        )
      })}
    </div>
  )
}
