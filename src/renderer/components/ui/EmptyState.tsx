/**
 * EmptyState — centred icon + title + body + optional action, for empty
 * lists ("Nothing shared yet"), no search results and error screens
 * (Figma "Nothing shared yet": 40px glyph, 14px title, 12px body).
 *
 * `icon` takes a Vuesax icon (`{ vicon: 'directbox-send-bold' }`) or a
 * name from the app's own Icon set.
 *
 * @example <EmptyState icon={{ vicon: 'directbox-send-bold' }} title="Nothing shared yet" body="Drop files here to share them." />
 */
import type { ReactNode } from 'react'
import { cn } from '../../lib/cn'
import { Icon, type IconName } from './Icon'
import { VIcon, type VIconName } from './VIcon'

export interface EmptyStateProps {
  icon: IconName | { vicon: VIconName }
  tone?: 'accent' | 'warning' | 'danger' | 'muted'
  title: ReactNode
  body?: ReactNode
  action?: ReactNode
  className?: string
}

const TONES = { accent: 'text-accent', warning: 'text-warning', danger: 'text-danger', muted: 'text-fg/75' }

export function EmptyState({ icon, tone = 'muted', title, body, action, className }: EmptyStateProps) {
  return (
    <div className={cn('flex flex-1 flex-col items-center justify-center gap-1 p-4 text-center animate-fade-in', className)}>
      <span className={cn('mb-0.5 flex h-10 w-10 items-center justify-center', TONES[tone])}>
        {typeof icon === 'string' ? <Icon name={icon} className="h-8 w-8" /> : <VIcon name={icon.vicon} size={40} />}
      </span>
      <h3 className="text-[14px] font-semibold leading-5 text-fg/80">{title}</h3>
      {body && <p className="max-w-[260px] whitespace-pre-line text-[12px] font-medium leading-[18px] text-subtle">{body}</p>}
      {action && <div className="mt-3">{action}</div>}
    </div>
  )
}
