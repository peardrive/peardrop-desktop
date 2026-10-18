/**
 * Building blocks for full-page settings screens.
 *
 * - PageHeader: back arrow + title (leaves room for macOS traffic lights)
 * - SettingsSection: titled group of rows
 * - SettingsRow: icon · label/description · right-hand control
 *
 * @example
 *   <SettingsSection title="Appearance">
 *     <SettingsRow icon="palette" label="Theme" control={<ThemePicker />} />
 *   </SettingsSection>
 */
import type { ReactNode } from 'react'
import { cn } from '../../lib/cn'
import { useSettingsStore } from '../../stores/settings-store'
import { Icon, type IconName } from '../../components/ui/Icon'
import { IconButton } from '../../components/ui/IconButton'

export function PageHeader({ title, onBack }: { title: string; onBack: () => void }) {
  const isMac = useSettingsStore((s) => s.appInfo?.platform === 'darwin')
  return (
    <header className={cn('drag-region sticky top-0 z-10 flex items-center gap-3 bg-panel/90 px-8 pb-4 backdrop-blur', isMac ? 'pt-10' : 'pt-6')}>
      <IconButton icon="chevron-left" label="Back" onClick={onBack} className="no-drag -ml-2" />
      <h1 className="text-[26px] font-bold">{title}</h1>
    </header>
  )
}

export function SettingsSection({ title, description, children }: { title: string; description?: ReactNode; children: ReactNode }) {
  return (
    <section className="mt-8 first:mt-2">
      <h2 className="text-sm font-bold text-muted">{title}</h2>
      {description && <p className="mt-1 text-sm text-subtle">{description}</p>}
      <div className="mt-3 divide-y divide-line/60 rounded-2xl bg-fg/[0.035] px-4">{children}</div>
    </section>
  )
}

export interface SettingsRowProps {
  icon?: IconName
  label: ReactNode
  description?: ReactNode
  control?: ReactNode
  onClick?: () => void
  /** Stack the control under the label (wide inputs). */
  stacked?: boolean
}

export function SettingsRow({ icon, label, description, control, onClick, stacked }: SettingsRowProps) {
  const body = (
    <>
      {icon && (
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-accent/15 text-accent-strong">
          <Icon name={icon} className="h-[18px] w-[18px]" />
        </span>
      )}
      <div className="min-w-0 flex-1">
        <div className="text-[15px] font-semibold text-fg">{label}</div>
        {description && <div className="mt-0.5 text-[13px] leading-snug text-muted">{description}</div>}
        {stacked && control && <div className="mt-3">{control}</div>}
      </div>
      {!stacked && control}
      {onClick && !control && <Icon name="chevron-right" className="h-4 w-4 text-subtle" />}
    </>
  )
  return onClick ? (
    <button type="button" onClick={onClick} className="flex w-full items-center gap-4 py-3.5 text-left transition-opacity hover:opacity-80">
      {body}
    </button>
  ) : (
    <div className={cn('flex gap-4 py-3.5', stacked ? 'items-start' : 'items-center')}>{body}</div>
  )
}
