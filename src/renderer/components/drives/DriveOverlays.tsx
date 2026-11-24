/**
 * Overlays drawn on top of a card while it is going away:
 *  - DeleteCountdown: 5-second ring + Undo (backend not called yet), then "Deleting…"
 *  - CancellingOverlay: "Cancelling…" while a cancelled transfer unwinds
 *
 * @example {pending && <DeleteCountdown pending={pending} onUndo={() => cancelRemoval(id)} />}
 */
import { useEffect, useState } from 'react'
import { cn } from '../../lib/cn'
import type { PendingDelete } from '../../stores/drives-store'
import { Button } from '../ui/Button'
import { Spinner } from '../ui/Spinner'

/** `stacked`: ring, label and Undo in a centred column, for narrow tiles. */
export function DeleteCountdown({ pending, onUndo, stacked = false }: { pending: PendingDelete; onUndo: () => void; stacked?: boolean }) {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    if (pending.executing) return
    const t = setInterval(() => setNow(Date.now()), 250)
    return () => clearInterval(t)
  }, [pending.executing])
  const secondsLeft = Math.max(0, Math.ceil((pending.deadline - now) / 1000))
  const total = 5000
  const remaining = Math.max(0, pending.deadline - now)
  return (
    <div
      className={cn(
        'absolute inset-0 z-10 flex items-center rounded-card bg-panel/70 px-4 backdrop-blur-[2px]',
        stacked ? 'flex-col justify-center gap-2' : 'justify-end gap-3'
      )}
      onClick={(e) => e.stopPropagation()}
    >
      {pending.executing ? (
        <span className="mx-auto inline-flex shrink-0 items-center gap-2 whitespace-nowrap rounded-full bg-raised px-4 py-1.5 text-sm font-bold text-fg">
          <Spinner className="h-4 w-4 text-danger" /> Deleting…
        </span>
      ) : (
        <>
          {!stacked && <span className="whitespace-nowrap text-sm font-semibold text-muted">Removing…</span>}
          <span className={cn('relative inline-flex shrink-0 items-center justify-center', stacked ? 'h-12 w-12' : 'h-9 w-9')}>
            <svg viewBox="0 0 36 36" className="absolute inset-0 -rotate-90">
              <circle cx="18" cy="18" r="15.9155" fill="none" strokeWidth="3" className="stroke-fg/15" />
              <circle
                cx="18"
                cy="18"
                r="15.9155"
                fill="none"
                strokeWidth="3"
                strokeLinecap="round"
                className="stroke-danger"
                pathLength={100}
                strokeDasharray={100}
                strokeDashoffset={100 - (remaining / total) * 100}
                style={{ transition: 'stroke-dashoffset 250ms linear' }}
              />
            </svg>
            <span className={cn('tabular font-bold', stacked ? 'text-sm' : 'text-xs')}>{secondsLeft}</span>
          </span>
          {stacked && <span className="whitespace-nowrap text-sm font-semibold text-muted">Removing…</span>}
          <Button size="sm" variant="secondary" className="shrink-0" onClick={onUndo}>
            Undo
          </Button>
        </>
      )}
    </div>
  )
}

export function CancellingOverlay() {
  return (
    <div className="absolute inset-0 z-10 flex items-center justify-center rounded-card bg-panel/70 backdrop-blur-[2px]">
      <span className="inline-flex items-center gap-2 rounded-full bg-raised px-4 py-1.5 text-sm font-bold">
        <Spinner className="h-4 w-4 text-warning" /> Cancelling…
      </span>
    </div>
  )
}
