import { useEffect, type RefObject } from 'react'

/**
 * Call `onDismiss` on an outside pointer-down or Escape while `active`.
 * Uses a capturing document listener (no backdrop element), which works
 * inside any stacking context — see "UI stacking context rules" in CLAUDE.md.
 *
 * @example useDismiss([menuRef, buttonRef], open, () => setOpen(false))
 */
export function useDismiss(refs: Array<RefObject<HTMLElement>>, active: boolean, onDismiss: () => void) {
  useEffect(() => {
    if (!active) return
    const onPointer = (e: PointerEvent) => {
      if (refs.some((r) => r.current?.contains(e.target as Node))) return
      onDismiss()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onDismiss()
      }
    }
    document.addEventListener('pointerdown', onPointer, true)
    document.addEventListener('keydown', onKey, true)
    return () => {
      document.removeEventListener('pointerdown', onPointer, true)
      document.removeEventListener('keydown', onKey, true)
    }
  }, [active, onDismiss, refs])
}
