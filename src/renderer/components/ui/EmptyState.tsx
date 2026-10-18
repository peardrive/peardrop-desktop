/**
 * EmptyState — centred icon + title + body + optional action, for empty
 * lists ("Nothing shared yet"), no search results and error screens.
 *
 * @example <EmptyState icon="folder-outline" title="Nothing shared yet" body="Drop files anywhere to share them." action={<Button>Send files</Button>} />
 */
import type { ReactNode } from 'react'
import { cn } from '../../lib/cn'
import type { IconName } from './Icon'
import { StateIcon } from './StateIcon'

export interface EmptyStateProps {
  icon: IconName
  tone?: 'accent' | 'warning' | 'danger' | 'muted'
  title: ReactNode
  body?: ReactNode
  action?: ReactNode
  className?: string
}

export function EmptyState({ icon, tone = 'muted', title, body, action, className }: EmptyStateProps) {
  return (
    <div className={cn('flex flex-col items-center justify-center px-6 py-14 text-center animate-fade-in', className)}>
      <StateIcon icon={icon} tone={tone} />
      <h3 className="mt-6 text-2xl font-bold text-fg">{title}</h3>
      {body && <p className="mt-2 max-w-sm text-[15px] leading-relaxed text-muted">{body}</p>}
      {action && <div className="mt-6">{action}</div>}
    </div>
  )
}
