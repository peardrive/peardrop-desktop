/**
 * Spinner — indeterminate activity indicator that inherits text colour.
 *
 * @example <Spinner className="h-5 w-5 text-accent" />
 */
import { cn } from '../../lib/cn'

export function Spinner({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={cn('h-4 w-4 animate-spin', className)} aria-hidden>
      <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeOpacity="0.2" strokeWidth="3" />
      <path d="M21 12a9 9 0 0 0-9-9" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  )
}
