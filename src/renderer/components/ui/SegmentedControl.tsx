/**
 * SegmentedControl — one rounded container; the active segment takes the
 * content-panel colour so it reads as connected to the panel below, the
 * inactive ones stay transparent. Works for any number of segments.
 *
 * @example <SegmentedControl value={tab} onChange={setTab} options={[{ value: 'shares', label: 'Shares' }, { value: 'favorites', label: 'Favorites' }]} />
 */
import type { ReactNode } from 'react'
import { cn } from '../../lib/cn'

export interface SegmentOption<T extends string> {
  value: T
  label: ReactNode
}

export interface SegmentedControlProps<T extends string> {
  value: T
  onChange: (value: T) => void
  options: Array<SegmentOption<T>>
  /** 'tabs' = big top-of-panel tabs; 'pill' = compact inline switch. */
  variant?: 'tabs' | 'pill'
  className?: string
  ariaLabel?: string
}

export function SegmentedControl<T extends string>({ value, onChange, options, variant = 'pill', className, ariaLabel }: SegmentedControlProps<T>) {
  const tabs = variant === 'tabs'
  return (
    <div role="tablist" aria-label={ariaLabel} className={cn('inline-flex bg-tabs', tabs ? 'rounded-t-[14px] p-0' : 'rounded-lg p-0.5', className)}>
      {options.map((o) => {
        const active = o.value === value
        return (
          <button
            key={o.value}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(o.value)}
            className={cn(
              'font-semibold transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/60',
              tabs ? 'rounded-t-[14px] px-5 pb-2 pt-2.5 text-[15px]' : 'rounded-md px-3 py-1 text-[12px]',
              active ? cn('bg-panel text-fg', !tabs && 'shadow-sm') : 'text-muted hover:text-fg'
            )}
          >
            {o.label}
          </button>
        )
      })}
    </div>
  )
}
