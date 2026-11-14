/**
 * DriveRowActions — the contextual buttons right of a card: Open / Retry /
 * Resume ▶ + Cancel ✕ / Share + Clear, as decided by `rowActions()`.
 *
 * @example <DriveRowActions drive={drive} onAction={(a) => runRowAction(a, drive)} />
 */
import type { MouseEvent } from 'react'
import { cn } from '../../lib/cn'
import { rowActions, type DriveView, type RowAction } from '../../lib/drive-model'
import { Button } from '../ui/Button'
import { IconButton } from '../ui/IconButton'

export interface DriveRowActionsProps {
  drive: DriveView
  onAction: (action: RowAction) => void
  /** Actions not to draw here (the expanded and grid layouts open by click, so they skip "Open"). */
  exclude?: RowAction[]
  className?: string
}

export function DriveRowActions({ drive, onAction, exclude, className }: DriveRowActionsProps) {
  const actions = rowActions(drive).filter((a) => !exclude?.includes(a))
  if (actions.length === 0) return null
  const partial = drive.kind === 'download' && drive.status === 'inactive'
  const stop = (fn: () => void) => (e: MouseEvent) => {
    e.stopPropagation()
    fn()
  }
  return (
    <div className={cn('flex shrink-0 items-center gap-1.5', className)}>
      {actions.map((a) => {
        switch (a) {
          case 'resume':
            return <IconButton key={a} icon="play" label="Resume" tone="accent" ringed size="sm" onClick={stop(() => onAction(a))} />
          case 'search':
            return <IconButton key={a} icon="refresh" label="Look for the sender now" tone="accent" ringed size="sm" onClick={stop(() => onAction(a))} />
          case 'cancel':
            return (
              <IconButton key={a} icon="close" label={drive.receive ? 'Forget this link' : 'Cancel'} tone="danger" ringed size="sm" onClick={stop(() => onAction(a))} />
            )
          case 'retry':
            return (
              <Button key={a} size="xs" variant="danger-outline" onClick={stop(() => onAction(a))}>
                {partial ? 'Resume' : 'Retry'}
              </Button>
            )
          case 'reshare':
            return (
              <Button key={a} size="xs" variant="outline" onClick={stop(() => onAction(a))}>
                Share
              </Button>
            )
          case 'clear':
            return (
              <Button key={a} size="xs" variant="danger-outline" onClick={stop(() => onAction(a))}>
                Clear
              </Button>
            )
          case 'open':
            return (
              <Button key={a} size="xs" variant="outline" onClick={stop(() => onAction(a))}>
                Open
              </Button>
            )
        }
      })}
    </div>
  )
}
