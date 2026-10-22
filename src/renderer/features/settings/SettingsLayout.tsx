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
import { Icon, type IconName } from '../../components/ui/Icon'
import { IconButton } from '../../components/ui/IconButton'

/** Same height and type as the list header, so switching pages does not jump. */
export function PageHeader({ title, onBack }: { title: string; onBack: () => void }) {
  return (
    <header className="drag-region sticky top-0 z-10 flex h-[70px] items-center gap-2 bg-canvas/90 px-4 py-4 backdrop-blur">
      <IconButton icon="chevron-left" label="Back" onClick={onBack} className="no-drag -ml-1" />
      <h1 className="text-[18px] font-semibold leading-7">{title}</h1>
    </header>
  )
}

export function SettingsSection({ title, description, children }: { title: string; description?: ReactNode; children: ReactNode }) {
  return (
    <section className="mt-6 first:mt-1">
      <h2 className="text-[12px] font-semibold text-muted">{title}</h2>
      {description && <p className="mt-0.5 text-[11px] text-subtle">{description}</p>}
      <div className="mt-2 divide-y divide-fg/[0.07] rounded-xl bg-gradient-to-b from-panel to-panel/60 px-3">{children}</div>
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
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-accent/15 text-accent-strong">
          <Icon name={icon} className="h-3.5 w-3.5" />
        </span>
      )}
      <div className="min-w-0 flex-1">
        <div className="text-[12px] font-semibold text-fg">{label}</div>
        {description && <div className="mt-0.5 text-[11px] leading-snug text-muted">{description}</div>}
        {stacked && control && <div className="mt-2">{control}</div>}
      </div>
      {!stacked && control}
      {onClick && !control && <Icon name="chevron-right" className="h-3.5 w-3.5 text-subtle" />}
    </>
  )
  return onClick ? (
    <button type="button" onClick={onClick} className="flex w-full items-center gap-3 py-2.5 text-left transition-opacity hover:opacity-80">
      {body}
    </button>
  ) : (
    <div className={cn('flex gap-3 py-2.5', stacked ? 'items-start' : 'items-center')}>{body}</div>
  )
}
