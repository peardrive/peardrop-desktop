/**
 * StatusText — a status word coloured by tone (green = healthy, amber = in
 * progress / not live yet, red = needs attention).
 *
 * @example <StatusText tone="success">Active</StatusText>
 */
import type { ReactNode } from 'react'
import { cn } from '../../lib/cn'
import type { Tone } from '../../lib/drive-model'

export const TONE_TEXT: Record<Tone, string> = {
  success: 'text-success',
  warning: 'text-warning',
  danger: 'text-danger',
  muted: 'text-muted'
}

export function StatusText({ tone, children, className }: { tone: Tone; children: ReactNode; className?: string }) {
  return <span className={cn('font-semibold', TONE_TEXT[tone], className)}>{children}</span>
}

/**
 * Badge — compact pill label (table view, settings).
 *
 * @example <Badge tone="warning">Sharing (98%)</Badge>
 */
export function Badge({ tone, children, className }: { tone: Tone; children: ReactNode; className?: string }) {
  const bg: Record<Tone, string> = {
    success: 'bg-success/15 text-success',
    warning: 'bg-warning/15 text-warning',
    danger: 'bg-danger/15 text-danger',
    muted: 'bg-fg/10 text-muted'
  }
  return <span className={cn('inline-flex items-center whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-bold', bg[tone], className)}>{children}</span>
}
