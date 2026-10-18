/**
 * Modal — the canonical desktop dialog shell.
 *
 * ONE look for every dialog (CLAUDE.md "canonical modal appearance"):
 * frosted glass panel, 22px corners, soft border; the overlay behind it is a
 * plain dim (never blurred itself — the panel's blur needs something sharp
 * behind it). Size presets encode the agreed exceptions:
 *   standard 760×520 (Send, Receive, Folder) · tall 520×760 (File Info)
 *   compact 460×auto (Rename, Share link) · narrow 440×auto (QR scanner, confirms)
 *
 * Escape and backdrop click close only the top-most dialog (`isTop`).
 *
 * @example
 *   <Modal title="Receive" size="standard" onClose={close} isTop>
 *     …content…
 *   </Modal>
 */
import { useEffect, useId, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { cn } from '../../lib/cn'
import { IconButton } from './IconButton'

export type ModalSize = 'standard' | 'tall' | 'compact' | 'narrow'

const SIZES: Record<ModalSize, string> = {
  standard: 'w-[760px] min-h-[min(520px,calc(100vh-40px))] max-h-[min(520px,calc(100vh-40px))]',
  tall: 'w-[520px] h-[min(760px,calc(100vh-40px))]',
  compact: 'w-[460px] max-h-[calc(100vh-40px)]',
  narrow: 'w-[440px] max-h-[calc(100vh-40px)]'
}

export interface ModalProps {
  /** Heading shown top-left; omit for a custom header. */
  title?: ReactNode
  /** Right side of the header, left of the close button. */
  headerExtra?: ReactNode
  size?: ModalSize
  onClose: () => void
  /** Only the top-most dialog reacts to Escape / backdrop clicks. */
  isTop?: boolean
  /** Hide the ✕ (e.g. while an action must be completed). */
  hideClose?: boolean
  /** Disallow closing via backdrop/Escape. */
  dismissible?: boolean
  className?: string
  bodyClassName?: string
  children: ReactNode
  footer?: ReactNode
}

export function Modal({
  title,
  headerExtra,
  size = 'standard',
  onClose,
  isTop = true,
  hideClose,
  dismissible = true,
  className,
  bodyClassName,
  children,
  footer
}: ModalProps) {
  const titleId = useId()
  const panelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!isTop || !dismissible) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !e.defaultPrevented) {
        e.preventDefault()
        onClose()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [isTop, dismissible, onClose])

  // Move focus into the dialog for keyboard users.
  useEffect(() => {
    if (!isTop) return
    const el = panelRef.current
    if (el && !el.contains(document.activeElement)) {
      const focusable = el.querySelector<HTMLElement>('[autofocus], input, textarea, button:not([data-close])')
      ;(focusable ?? el).focus({ preventScroll: true })
    }
  }, [isTop])

  return createPortal(
    <div
      className="fixed inset-0 z-[900] flex items-center justify-center p-5 animate-fade-in"
      style={{ background: 'var(--pd-overlay)' }}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && isTop && dismissible) onClose()
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        tabIndex={-1}
        className={cn('glass relative flex max-w-full flex-col overflow-hidden rounded-modal text-fg outline-none animate-pop-in', SIZES[size], className)}
      >
        {(title || !hideClose || headerExtra) && (
          <div className="flex shrink-0 items-center gap-3 px-6 pb-2 pt-5">
            {title && (
              <h2 id={titleId} className="min-w-0 flex-1 truncate text-[22px] font-bold">
                {title}
              </h2>
            )}
            {!title && <div className="flex-1" />}
            {headerExtra}
            {!hideClose && (
              <IconButton data-close icon="close" label="Close" tone="danger" ringed size="sm" onClick={onClose} className="rounded-lg" />
            )}
          </div>
        )}
        <div className={cn('flex min-h-0 flex-1 flex-col overflow-y-auto px-6 pb-6', bodyClassName)}>{children}</div>
        {footer && <div className="flex shrink-0 items-center justify-end gap-3 border-t border-fg/10 px-6 py-4">{footer}</div>}
      </div>
    </div>,
    document.body
  )
}
