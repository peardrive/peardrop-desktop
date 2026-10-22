/**
 * StateIcon — the ~100px rounded-square badge used by empty, error and
 * confirmation states, tinted by severity.
 *
 * @example <StateIcon icon="wifi-off" tone="warning" />
 */
import { cn } from '../../lib/cn'
import { Icon, type IconName } from './Icon'

const TONES = {
  accent: 'text-accent-strong bg-accent/10',
  warning: 'text-warning bg-warning/10',
  danger: 'text-danger bg-danger/10',
  muted: 'text-muted bg-fg/[0.06]'
}

export function StateIcon({ icon, tone = 'muted', className }: { icon: IconName; tone?: keyof typeof TONES; className?: string }) {
  return (
    <div className={cn('flex h-24 w-24 items-center justify-center rounded-[28px] shadow-[inset_0_2px_10px_rgba(0,0,0,0.25)]', TONES[tone], className)}>
      <Icon name={icon} className="h-10 w-10" />
    </div>
  )
}
