/**
 * Switch — iOS-style on/off toggle.
 *
 * @example <Switch checked={debug} onChange={setDebug} label="Verbose logging" />
 */
import { cn } from '../../lib/cn'

export interface SwitchProps {
  checked: boolean
  onChange: (next: boolean) => void
  /** Accessible label. */
  label: string
  disabled?: boolean
}

export function Switch({ checked, onChange, label, disabled }: SwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative inline-flex h-[26px] w-[44px] shrink-0 items-center rounded-full transition-colors duration-200',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 disabled:opacity-45',
        checked ? 'bg-accent' : 'bg-fg/15'
      )}
    >
      <span className={cn('inline-block h-[22px] w-[22px] rounded-full bg-white shadow transition-transform duration-200', checked ? 'translate-x-[20px]' : 'translate-x-[2px]')} />
    </button>
  )
}
