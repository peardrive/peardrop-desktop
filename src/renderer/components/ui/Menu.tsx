/**
 * Menu — a frosted popover menu anchored to an element or a point.
 *
 * Rendered in a portal on <body> with fixed positioning, so it can never be
 * trapped under a sibling's stacking context (the bug class CLAUDE.md warns
 * about). Closes on outside click / Escape via a capturing document listener
 * — no backdrop element. Flips to stay inside the window.
 *
 * Use `useMenu()` for the open/anchor state:
 * @example
 *   const menu = useMenu()
 *   <IconButton ref={menu.triggerRef} icon="more-vertical" label="More" onClick={menu.toggleFromTrigger} />
 *   <Menu {...menu.props} items={[{ label: 'Rename', onSelect: rename }, { divider: true }, { label: 'Remove', danger: true, onSelect: remove }]} />
 */
import { useCallback, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { cn } from '../../lib/cn'
import { useDismiss } from '../../hooks/useDismiss'
import { Icon, type IconName } from './Icon'

export type MenuEntry =
  | {
      label: ReactNode
      onSelect: () => void
      icon?: IconName
      danger?: boolean
      /** Shows a check mark (radio/toggle items). */
      checked?: boolean
      /** Right-aligned hint, e.g. a sort direction arrow. */
      hint?: ReactNode
      disabled?: boolean
      divider?: false
      heading?: false
    }
  | { divider: true }
  | { heading: ReactNode; divider?: false }

export type MenuAnchor = { x: number; y: number } | HTMLElement | null

export interface MenuProps {
  open: boolean
  anchor: MenuAnchor
  onClose: () => void
  items: MenuEntry[]
  /** Horizontal alignment relative to an element anchor. */
  align?: 'start' | 'end'
  /** Extra refs that count as "inside" (e.g. the trigger button). */
  insideRefs?: Array<RefObject<HTMLElement>>
  width?: number
}

export function Menu({ open, anchor, onClose, items, align = 'end', insideRefs = [], width = 232 }: MenuProps) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)
  const refs = useMemo(() => [ref as RefObject<HTMLElement>, ...insideRefs], [insideRefs])
  useDismiss(refs, open, onClose)

  useLayoutEffect(() => {
    if (!open || !anchor || !ref.current) return setPos(null)
    const menu = ref.current.getBoundingClientRect()
    const vw = window.innerWidth
    const vh = window.innerHeight
    let left: number
    let top: number
    if (anchor instanceof HTMLElement) {
      const r = anchor.getBoundingClientRect()
      left = align === 'end' ? r.right - menu.width : r.left
      top = r.bottom + 6
      if (top + menu.height > vh - 8) top = r.top - menu.height - 6
    } else {
      left = anchor.x
      top = anchor.y
      if (left + menu.width > vw - 8) left = anchor.x - menu.width
      if (top + menu.height > vh - 8) top = anchor.y - menu.height
    }
    setPos({ left: Math.max(8, Math.min(left, vw - menu.width - 8)), top: Math.max(8, top) })
  }, [open, anchor, align, items.length])

  if (!open) return null
  return createPortal(
    <div
      ref={ref}
      role="menu"
      className="glass fixed z-[1000] rounded-2xl p-1.5 shadow-menu animate-pop-in"
      style={{ width, left: pos?.left ?? -9999, top: pos?.top ?? -9999 }}
    >
      {items.map((item, i) => {
        if ('divider' in item && item.divider) return <div key={i} className="mx-2 my-1 h-px bg-fg/10" />
        if ('heading' in item && item.heading) {
          return (
            <div key={i} className="px-3 pb-1 pt-2 text-[11px] font-bold uppercase tracking-wider text-subtle">
              {item.heading}
            </div>
          )
        }
        const it = item as Extract<MenuEntry, { onSelect: () => void }>
        return (
          <button
            key={i}
            type="button"
            role="menuitem"
            disabled={it.disabled}
            onClick={() => {
              onClose()
              it.onSelect()
            }}
            className={cn(
              'flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-left text-sm font-semibold transition-colors disabled:opacity-40',
              it.danger ? 'text-danger hover:bg-danger/15' : 'text-fg hover:bg-fg/10'
            )}
          >
            {it.icon && <Icon name={it.icon} className="h-4 w-4 shrink-0 opacity-80" />}
            <span className="flex-1 truncate">{it.label}</span>
            {it.hint && <span className="text-xs text-muted">{it.hint}</span>}
            {it.checked && <Icon name="check" className="h-4 w-4 text-accent-strong" />}
          </button>
        )
      })}
    </div>,
    document.body
  )
}

/** Open/anchor state for a Menu. */
export function useMenu() {
  const [open, setOpen] = useState(false)
  const [anchor, setAnchor] = useState<MenuAnchor>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const close = useCallback(() => setOpen(false), [])
  const openAt = useCallback((a: MenuAnchor) => {
    setAnchor(a)
    setOpen(true)
  }, [])
  const toggleFromTrigger = useCallback(() => {
    setAnchor(triggerRef.current)
    setOpen((o) => !o)
  }, [])
  const insideRefs = useMemo(() => [triggerRef as RefObject<HTMLElement>], [])
  return { open, openAt, close, triggerRef, toggleFromTrigger, props: { open, anchor, onClose: close, insideRefs } }
}
