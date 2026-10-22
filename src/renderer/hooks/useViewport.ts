import { useEffect, useState } from 'react'

/** Below this window width the sidebar folds to icons by itself (and cannot be unfolded). */
export const SIDEBAR_FOLD_WIDTH = 760

/** Window inner width, updated on resize (one shared listener per component). */
export function useViewportWidth(): number {
  const [width, setWidth] = useState(() => window.innerWidth)
  useEffect(() => {
    let frame = 0
    const onResize = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => setWidth(window.innerWidth))
    }
    window.addEventListener('resize', onResize)
    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener('resize', onResize)
    }
  }, [])
  return width
}

/** True when the window is too narrow for the full sidebar. */
export function useNarrowWindow(): boolean {
  return useViewportWidth() < SIDEBAR_FOLD_WIDTH
}
