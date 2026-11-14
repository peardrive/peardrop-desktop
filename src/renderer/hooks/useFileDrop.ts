import { useCallback, useEffect, useRef, useState, type DragEvent } from 'react'

/** Longest gap between two `dragover` events of a live drag (spec: 350 ms ± 200 ms). */
const DRAG_SILENCE_MS = 800

/**
 * Drag-and-drop handlers for a drop target, with a depth counter so moving
 * over child elements does not make the highlight flicker, and a watchdog so
 * the highlight cannot outlive the drag (no `dragover` for a while = the drag
 * ended without telling us).
 *
 * @example const { isOver, bind } = useFileDrop(files => stageFiles(files)); <div {...bind} />
 */
export function useFileDrop(onFiles: (files: File[]) => void) {
  const depth = useRef(0)
  const watchdog = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [isOver, setOver] = useState(false)

  const off = useCallback(() => {
    depth.current = 0
    if (watchdog.current) clearTimeout(watchdog.current)
    watchdog.current = null
    setOver(false)
  }, [])
  const kick = useCallback(() => {
    if (watchdog.current) clearTimeout(watchdog.current)
    watchdog.current = setTimeout(off, DRAG_SILENCE_MS)
  }, [off])
  useEffect(() => off, [off])

  const onDragEnter = useCallback(
    (e: DragEvent) => {
      e.preventDefault()
      depth.current++
      kick()
      setOver(true)
    },
    [kick]
  )
  const onDragOver = useCallback(
    (e: DragEvent) => {
      e.preventDefault()
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'
      kick()
    },
    [kick]
  )
  const onDragLeave = useCallback(() => {
    if (--depth.current <= 0) off()
  }, [off])
  const onDrop = useCallback(
    (e: DragEvent) => {
      e.preventDefault()
      e.stopPropagation()
      off()
      const files = Array.from(e.dataTransfer?.files ?? [])
      if (files.length) onFiles(files)
    },
    [onFiles, off]
  )
  return { isOver, bind: { onDragEnter, onDragOver, onDragLeave, onDrop } }
}
