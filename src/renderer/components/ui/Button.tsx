/**
 * Button — the app's pill button.
 *
 * Variants follow the desktop v2 spec (bold labels, 2px outlines):
 *  - primary   filled pear-green gradient, dark text (main call to action)
 *  - soft      tinted green fill + green outline (top-bar Send / Receive)
 *  - outline   transparent, green outline + green text (row "Open")
 *  - secondary neutral filled, muted text (Cancel, Done)
 *  - danger / danger-outline, warning-outline, ghost
 *
 * @example <Button variant="primary" onClick={share}>Share</Button>
 * @example <Button variant="soft" leading={<Icon name="arrow-up" />}>Send</Button>
 */
import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react'
import { cn } from '../../lib/cn'
import { Spinner } from './Spinner'

export type ButtonVariant = 'primary' | 'soft' | 'outline' | 'secondary' | 'danger' | 'danger-outline' | 'warning-outline' | 'ghost'
export type ButtonSize = 'xs' | 'sm' | 'md' | 'lg'

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: ButtonSize
  /** Icon or element before the label. */
  leading?: ReactNode
  /** Icon or element after the label. */
  trailing?: ReactNode
  /** Shows a spinner and disables the button. */
  loading?: boolean
  /** Stretch to the container width. */
  block?: boolean
}

const VARIANTS: Record<ButtonVariant, string> = {
  // Figma sidebar buttons: solid pear-green "Send", outlined "Receive" (8px radius, 1px line).
  primary: 'bg-accent text-accent-on border border-transparent hover:brightness-110 active:brightness-95',
  soft: 'bg-accent/10 text-accent-strong border border-accent/70 hover:bg-accent/20 hover:border-accent',
  outline: 'bg-transparent text-accent-strong border border-accent/70 hover:bg-accent/10',
  secondary: 'bg-fg/5 text-fg/85 border border-fg/10 hover:text-fg hover:bg-fg/10',
  danger: 'bg-danger text-white border border-transparent hover:brightness-110',
  'danger-outline': 'bg-transparent text-danger border border-danger/70 hover:bg-danger/10',
  'warning-outline': 'bg-transparent text-warning border border-warning/70 hover:bg-warning/10',
  ghost: 'bg-transparent text-muted border border-transparent hover:text-fg hover:bg-fg/5'
}

const SIZES: Record<ButtonSize, string> = {
  xs: 'h-6 px-2.5 text-[11px] gap-1',
  sm: 'h-7 px-3 text-[12px] gap-1.5',
  md: 'h-8 px-4 text-[13px] gap-1.5',
  lg: 'h-10 px-5 text-sm gap-2'
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', size = 'md', leading, trailing, loading, block, className, children, disabled, type = 'button', ...rest },
  ref
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      className={cn(
        'inline-flex select-none items-center justify-center whitespace-nowrap rounded-lg font-semibold transition-[background,border-color,color,filter,opacity] duration-150',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 focus-visible:ring-offset-2 focus-visible:ring-offset-panel',
        'disabled:pointer-events-none disabled:opacity-45',
        VARIANTS[variant],
        SIZES[size],
        block && 'w-full',
        className
      )}
      {...rest}
    >
      {loading ? <Spinner className="h-4 w-4" /> : leading}
      {children}
      {trailing}
    </button>
  )
})
