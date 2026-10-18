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
  primary: 'bg-gradient-to-b from-accent to-[#8fb52a] text-accent-on border-2 border-transparent hover:brightness-110 active:brightness-95 shadow-[0_6px_18px_-6px_rgb(var(--pd-accent)/0.55)]',
  soft: 'bg-accent/15 text-accent-strong border-2 border-accent/55 hover:bg-accent/25 hover:border-accent/80',
  outline: 'bg-transparent text-accent-strong border-2 border-accent/70 hover:bg-accent/10',
  secondary: 'bg-raised text-muted border-2 border-line hover:text-fg hover:border-subtle',
  danger: 'bg-danger text-white border-2 border-transparent hover:brightness-110',
  'danger-outline': 'bg-transparent text-danger border-2 border-danger/70 hover:bg-danger/10',
  'warning-outline': 'bg-transparent text-warning border-2 border-warning/70 hover:bg-warning/10',
  ghost: 'bg-transparent text-muted border-2 border-transparent hover:text-fg hover:bg-fg/5'
}

const SIZES: Record<ButtonSize, string> = {
  xs: 'h-7 px-3 text-xs gap-1.5',
  sm: 'h-8 px-4 text-[13px] gap-1.5',
  md: 'h-10 px-5 text-sm gap-2',
  lg: 'h-12 px-7 text-[15px] gap-2.5'
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
        'inline-flex select-none items-center justify-center whitespace-nowrap rounded-full font-bold transition-[background,border-color,color,filter,opacity] duration-150',
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
