/**
 * WindowDropZone — drop files ANYWHERE in the window to share them: shows a
 * full-window hint while dragging, then opens Send with the files staged.
 * Also stops Electron from navigating to a dropped file.
 *
 * @example <WindowDropZone /> // once, at the app root
 */
import { useEffect, useRef, useState } from 'react'
import { handleWindowDrop } from '../../controllers/share'
import { Icon } from '../../components/ui/Icon'

const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes('Files')

export function WindowDropZone() {
  const [active, setActive] = useState(false)
  const depth = useRef(0)
  useEffect(() => {
    const enter = (e: DragEvent) => {
      if (!hasFiles(e)) return
      depth.current++
      setActive(true)
    }
    const leave = () => {
      if (--depth.current <= 0) {
        depth.current = 0
        setActive(false)
      }
    }
    const over = (e: DragEvent) => e.preventDefault()
    const drop = (e: DragEvent) => {
      e.preventDefault()
      depth.current = 0
      setActive(false)
      // Targets with their own drop handling (Add Files card) stop propagation.
      const files = Array.from(e.dataTransfer?.files ?? [])
      if (files.length) handleWindowDrop(files)
    }
    window.addEventListener('dragenter', enter)
    window.addEventListener('dragleave', leave)
    window.addEventListener('dragover', over)
    window.addEventListener('drop', drop)
    return () => {
      window.removeEventListener('dragenter', enter)
      window.removeEventListener('dragleave', leave)
      window.removeEventListener('dragover', over)
      window.removeEventListener('drop', drop)
    }
  }, [])
  if (!active) return null
  return (
    <div className="pointer-events-none fixed inset-3 z-[800] flex items-center justify-center rounded-[16px] border-[3px] border-dashed border-accent/70 bg-accent/10 animate-fade-in">
      <div className="glass flex items-center gap-3 rounded-full px-4 py-3 text-[14px] font-bold">
        <Icon name="arrow-up" className="h-5 w-5 text-accent-strong" /> Drop to share
      </div>
    </div>
  )
}
