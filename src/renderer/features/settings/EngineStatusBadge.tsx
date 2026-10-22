/**
 * EngineStatusBadge — a coloured dot + word for the engine phase.
 *
 * @example <EngineStatusBadge phase="ready" />
 */
import type { EnginePhase } from '@shared/engine'
import { cn } from '../../lib/cn'

const MAP: Record<EnginePhase, { label: string; cls: string }> = {
  ready: { label: 'Running', cls: 'bg-success' },
  starting: { label: 'Starting', cls: 'bg-warning animate-pulse' },
  reloading: { label: 'Reloading', cls: 'bg-warning animate-pulse' },
  stopped: { label: 'Stopped', cls: 'bg-subtle' },
  error: { label: 'Error', cls: 'bg-danger' }
}

export function EngineStatusBadge({ phase }: { phase: EnginePhase }) {
  const m = MAP[phase]
  return (
    <span className="inline-flex items-center gap-2 rounded-full bg-fg/[0.07] px-3 py-1 text-[11px] font-bold">
      <span className={cn('h-2 w-2 rounded-full', m.cls)} />
      {m.label}
    </span>
  )
}
