import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from '../stores/toast-store'

/**
 * Copy text and show the confirmation ON the button that was pressed
 * ("Copied!" for 2s) instead of making the user look for a toast.
 *
 * @example const { copied, copy } = useCopy(); <Button onClick={() => copy(link)}>{copied ? 'Copied!' : 'Copy Link'}</Button>
 */
export function useCopy(resetMs = 2000) {
  const [copied, setCopied] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), [])
  const copy = useCallback(
    async (text: string | null | undefined) => {
      if (!text) return false
      try {
        await navigator.clipboard.writeText(text)
        setCopied(true)
        if (timer.current) clearTimeout(timer.current)
        timer.current = setTimeout(() => setCopied(false), resetMs)
        return true
      } catch {
        toast.error('Failed to copy')
        return false
      }
    },
    [resetMs]
  )
  return { copied, copy }
}
