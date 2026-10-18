/**
 * TextField — single-line input with optional leading icon and trailing
 * slot (e.g. a button inside the field), 2px outline, themed.
 *
 * @example <TextField value={v} onChange={e => setV(e.target.value)} placeholder="Paste link here" trailing={<Button size="sm">Paste</Button>} />
 */
import { forwardRef, type InputHTMLAttributes, type ReactNode } from 'react'
import { cn } from '../../lib/cn'
import { Icon, type IconName } from './Icon'

export interface TextFieldProps extends InputHTMLAttributes<HTMLInputElement> {
  leadingIcon?: IconName
  trailing?: ReactNode
  /** Outline colour reflecting validation. */
  state?: 'default' | 'valid' | 'invalid' | 'warning'
  containerClassName?: string
}

const STATE_BORDER = {
  default: 'border-line focus-within:border-accent/70',
  valid: 'border-accent/70',
  invalid: 'border-danger/70',
  warning: 'border-warning/70'
}

export const TextField = forwardRef<HTMLInputElement, TextFieldProps>(function TextField(
  { leadingIcon, trailing, state = 'default', className, containerClassName, ...rest },
  ref
) {
  return (
    <div className={cn('flex h-11 items-center gap-2 rounded-full border-2 bg-field px-4 transition-colors', STATE_BORDER[state], containerClassName)}>
      {leadingIcon && <Icon name={leadingIcon} className="h-4 w-4 shrink-0 text-subtle" />}
      <input
        ref={ref}
        spellCheck={false}
        autoComplete="off"
        className={cn('h-full min-w-0 flex-1 bg-transparent text-sm text-fg placeholder:text-subtle focus:outline-none', className)}
        {...rest}
      />
      {trailing}
    </div>
  )
})
