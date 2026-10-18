/**
 * ThemePicker — Dark / Light / System cards with a live mini preview of each
 * theme's palette. Writes `appearance.theme` to preferences.
 *
 * @example <ThemePicker />
 */
import type { ThemePreference } from '@shared/preferences'
import { cn } from '../../lib/cn'
import { useSettingsStore } from '../../stores/settings-store'
import { THEMES, type Theme } from '../../theme/themes'
import { Icon, type IconName } from '../../components/ui/Icon'

function Swatch({ theme }: { theme: Theme }) {
  const c = theme.colors
  return (
    <div className="h-full w-full p-2" style={{ background: c.canvas }}>
      <div className="flex h-full flex-col gap-1.5 rounded-md p-2" style={{ background: c.panel }}>
        <div className="h-2 w-2/3 rounded-full" style={{ background: c.fg, opacity: 0.85 }} />
        <div className="h-1.5 w-1/2 rounded-full" style={{ background: c.muted }} />
        <div className="mt-auto flex gap-1">
          <div className="h-2.5 w-7 rounded-full" style={{ background: c.accent }} />
          <div className="h-2.5 w-5 rounded-full" style={{ background: c.tabs }} />
        </div>
      </div>
    </div>
  )
}

const OPTIONS: Array<{ value: ThemePreference; label: string; icon: IconName }> = [
  { value: 'dark', label: 'Dark', icon: 'moon' },
  { value: 'light', label: 'Light', icon: 'sun' },
  { value: 'system', label: 'System', icon: 'monitor' }
]

export function ThemePicker() {
  const value = useSettingsStore((s) => s.preferences.appearance.theme)
  const update = useSettingsStore((s) => s.updatePreferences)
  return (
    <div className="grid grid-cols-3 gap-3" role="radiogroup" aria-label="Theme">
      {OPTIONS.map((o) => {
        const active = o.value === value
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => void update({ appearance: { theme: o.value } })}
            className={cn('overflow-hidden rounded-xl border-2 text-left transition-colors', active ? 'border-accent' : 'border-line hover:border-subtle')}
          >
            <div className="flex h-[72px]">
              {o.value === 'system' ? (
                <>
                  <div className="w-1/2 overflow-hidden">
                    <Swatch theme={THEMES.dark} />
                  </div>
                  <div className="w-1/2 overflow-hidden">
                    <Swatch theme={THEMES.light} />
                  </div>
                </>
              ) : (
                <Swatch theme={THEMES[o.value]} />
              )}
            </div>
            <div className="flex items-center gap-2 px-3 py-2 text-sm font-bold">
              <Icon name={o.icon} className="h-4 w-4 text-muted" />
              {o.label}
              {active && <Icon name="check" className="ml-auto h-4 w-4 text-accent-strong" />}
            </div>
          </button>
        )
      })}
    </div>
  )
}
