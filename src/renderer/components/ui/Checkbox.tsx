/**
 * Checkbox — rounded checkbox with a label and optional hint line.
 *
 * @example <Checkbox checked={del} onChange={setDel} label="Also delete the file" hint="Cannot be undone." />
 */
import { cn } from '../../lib/cn'
import { Icon } from './Icon'

export interface CheckboxProps {
  checked: boolean
  onChange: (next: boolean) => void
  label: string
  hint?: string
  className?: string
}

export function Checkbox({ checked, onChange, label, hint, className }: CheckboxProps) {
  return (
    <label className={cn('flex cursor-pointer items-start gap-3 text-left', className)}>
      <input type="checkbox" className="peer sr-only" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span
        className={cn(
          'mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors peer-focus-visible:ring-2 peer-focus-visible:ring-accent/60',
          checked ? 'border-accent bg-accent text-accent-on' : 'border-line bg-field'
        )}
      >
        {checked && <Icon name="check" className="h-3 w-3" />}
      </span>
      <span className="text-sm font-semibold text-fg">
        {label}
        {hint && <span className="mt-0.5 block text-xs font-normal text-muted">{hint}</span>}
      </span>
    </label>
  )
}
