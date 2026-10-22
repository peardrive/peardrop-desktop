/**
 * ProgressBar / ProgressRing — the ONE progress visual for every transfer
 * (uploads, downloads, share builds), per the "unified progress UI" rule.
 *
 * @example <ProgressBar value={0.42} tone="warning" />
 * @example <ProgressRing percent={73} size={132} />
 */
import type { ReactNode } from 'react'
import { cn } from '../../lib/cn'

const TONE_FILL = {
  accent: 'bg-gradient-to-r from-accent/80 to-accent',
  warning: 'bg-warning',
  danger: 'bg-danger'
}

export interface ProgressBarProps {
  /** 0..1 */
  value: number
  tone?: keyof typeof TONE_FILL
  className?: string
}

export function ProgressBar({ value, tone = 'accent', className }: ProgressBarProps) {
  const pct = Math.max(0, Math.min(100, value * 100))
  return (
    <div className={cn('h-1 w-full overflow-hidden rounded-full bg-fg/10', className)} role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100}>
      <div className={cn('h-full rounded-full transition-[width] duration-300 ease-out', TONE_FILL[tone])} style={{ width: `${pct}%` }} />
    </div>
  )
}

export interface ProgressRingProps {
  /** 0..100 */
  percent: number
  size?: number
  stroke?: number
  children?: ReactNode
  className?: string
}

export function ProgressRing({ percent, size = 120, stroke = 9, children, className }: ProgressRingProps) {
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r
  const p = Math.max(0, Math.min(100, percent))
  return (
    <div className={cn('relative inline-flex items-center justify-center', className)} style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="currentColor" strokeWidth={stroke} className="text-fg/10" />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="currentColor"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - p / 100)}
          className="text-accent transition-[stroke-dashoffset] duration-300 ease-out"
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">{children}</div>
    </div>
  )
}
