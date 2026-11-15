/**
 * WindowDropZone — drop files ANYWHERE in the window to share them: shows a
 * full-window hint while a file drag is over the window, then opens Send
 * with the files staged (or adds them to the list when Send is already
 * open). Also stops Electron from navigating to a dropped file.
 *
 * The hint may exist only while a file drag is live over this window. Three
 * things guarantee it goes away:
 *   • a capture-phase `drop` listener, so a child that claims the drop with
 *     stopPropagation (the Add Files card) cannot strand it;
 *   • `dragleave` towards nothing (relatedTarget null = the drag left the
 *     window), independent of the enter/leave depth counter;
 *   • a watchdog: Chromium fires `dragover` every ~350 ms while a drag is over
 *     the window, so silence means the drag ended somewhere we got no event
 *     for (Escape, dropped on another app, released on the menu bar …).
 *
 * @example <WindowDropZone /> // once, at the app root
 */
import { useEffect, useRef, useState } from 'react'
import { handleWindowDrop } from '../../controllers/share'
import { useUiStore } from '../../stores/ui-store'
import { Icon } from '../../components/ui/Icon'

const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes('Files')

/** Longest gap between two `dragover` events of a live drag (spec: 350 ms ± 200 ms). */
const DRAG_SILENCE_MS = 800

export function WindowDropZone() {
  const [active, setActive] = useState(false)
  const sendOpen = useUiStore((s) => s.modals.some((m) => m.type === 'send'))
  const depth = useRef(0)
  const watchdog = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    const off = () => {
      depth.current = 0
      if (watchdog.current) clearTimeout(watchdog.current)
      watchdog.current = null
      setActive(false)
    }
    const kick = () => {
      if (watchdog.current) clearTimeout(watchdog.current)
      watchdog.current = setTimeout(off, DRAG_SILENCE_MS)
    }
    const enter = (e: DragEvent) => {
      if (!hasFiles(e)) return
      depth.current++
      kick()
      setActive(true)
    }
    const leave = (e: DragEvent) => {
      if (!hasFiles(e)) return
      if (e.relatedTarget === null || --depth.current <= 0) off()
    }
    const over = (e: DragEvent) => {
      e.preventDefault()
      if (hasFiles(e)) kick()
    }
    // Capture phase: runs before any target's own handler, so the hint is
    // cleared even when that handler stops propagation.
    const dropCapture = () => off()
    const drop = (e: DragEvent) => {
      e.preventDefault()
      // Targets with their own drop handling (Add Files card) stop propagation
      // before this runs and stage the files themselves.
      const files = Array.from(e.dataTransfer?.files ?? [])
      if (files.length) handleWindowDrop(files)
    }
    window.addEventListener('dragenter', enter)
    window.addEventListener('dragleave', leave)
    window.addEventListener('dragover', over)
    window.addEventListener('dragend', off)
    window.addEventListener('drop', dropCapture, true)
    window.addEventListener('drop', drop)
    return () => {
      window.removeEventListener('dragenter', enter)
      window.removeEventListener('dragleave', leave)
      window.removeEventListener('dragover', over)
      window.removeEventListener('dragend', off)
      window.removeEventListener('drop', dropCapture, true)
      window.removeEventListener('drop', drop)
      off()
    }
  }, [])

  if (!active) return null
  // Above the modal layer (z-900): with Send open the hint still reads "drop anywhere".
  return (
    <div className="pointer-events-none fixed inset-3 z-[950] flex items-center justify-center rounded-[16px] border-[3px] border-dashed border-accent/70 bg-accent/10 animate-fade-in">
      <div className="glass flex items-center gap-3 rounded-full px-4 py-3 text-[14px] font-bold">
        <Icon name="arrow-up" className="h-5 w-5 text-accent-strong" /> {sendOpen ? 'Drop to add' : 'Drop to share'}
      </div>
    </div>
  )
}
