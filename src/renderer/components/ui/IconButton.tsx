/**
 * IconButton — a round, icon-only button with a required accessible label.
 *
 * Tones: neutral (toolbar), accent (resume ▶), danger (cancel ✕), solid
 * (dark filled circle, e.g. the top-bar settings gear).
 *
 * @example <IconButton label="Settings" icon="gear" tone="solid" onClick={openSettings} />
 */
import { forwardRef, type ButtonHTMLAttributes } from 'react'
import { cn } from '../../lib/cn'
import { Icon, type IconName } from './Icon'

export interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  icon: IconName
  /** Accessible name and tooltip. */
  label: string
  tone?: 'neutral' | 'accent' | 'danger' | 'solid'
  size?: 'sm' | 'md' | 'lg'
  /** Outline ring around the icon (row actions). */
  ringed?: boolean
  iconClassName?: string
}

const TONES = {
  neutral: 'text-muted hover:text-fg hover:bg-fg/[0.07]',
  accent: 'text-accent-strong hover:bg-accent/15',
  danger: 'text-danger hover:bg-danger/15',
  solid: 'bg-tabs text-fg hover:brightness-125'
}
const RINGS = { neutral: 'border-2 border-line', accent: 'border-2 border-accent/70', danger: 'border-2 border-danger/70', solid: '' }
const SIZES = { sm: 'h-7 w-7', md: 'h-9 w-9', lg: 'h-11 w-11' }
const ICONS = { sm: 'h-3.5 w-3.5', md: 'h-[18px] w-[18px]', lg: 'h-6 w-6' }

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { icon, label, tone = 'neutral', size = 'md', ringed, className, iconClassName, type = 'button', ...rest },
  ref
) {
  return (
    <button
      ref={ref}
      type={type}
      aria-label={label}
      title={label}
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-full transition-colors duration-150',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60',
        'disabled:pointer-events-none disabled:opacity-40',
        TONES[tone],
        ringed && RINGS[tone],
        SIZES[size],
        className
      )}
      {...rest}
    >
      <Icon name={icon} className={cn(ICONS[size], iconClassName)} />
    </button>
  )
})
