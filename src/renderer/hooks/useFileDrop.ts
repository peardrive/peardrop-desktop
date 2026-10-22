import { useCallback, useRef, useState, type DragEvent } from 'react'

/**
 * Drag-and-drop handlers for a drop target, with a depth counter so moving
 * over child elements does not make the highlight flicker.
 *
 * @example const { isOver, bind } = useFileDrop(files => stageFiles(files)); <div {...bind} />
 */
export function useFileDrop(onFiles: (files: File[]) => void) {
  const depth = useRef(0)
  const [isOver, setOver] = useState(false)
  const onDragEnter = useCallback((e: DragEvent) => {
    e.preventDefault()
    depth.current++
    setOver(true)
  }, [])
  const onDragOver = useCallback((e: DragEvent) => {
    e.preventDefault()
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'
  }, [])
  const onDragLeave = useCallback(() => {
    if (--depth.current <= 0) {
      depth.current = 0
      setOver(false)
    }
  }, [])
  const onDrop = useCallback(
    (e: DragEvent) => {
      e.preventDefault()
      e.stopPropagation()
      depth.current = 0
      setOver(false)
      const files = Array.from(e.dataTransfer?.files ?? [])
      if (files.length) onFiles(files)
    },
    [onFiles]
  )
  return { isOver, bind: { onDragEnter, onDragOver, onDragLeave, onDrop } }
}
