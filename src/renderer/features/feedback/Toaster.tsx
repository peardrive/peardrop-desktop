/**
 * Toaster — short status messages, bottom-centre, auto-dismissed.
 * Raise one from anywhere with `toast.success(...)` / `toast.error(...)`.
 *
 * @example <Toaster /> // once, at the app root
 */
import { cn } from '../../lib/cn'
import { useToastStore } from '../../stores/toast-store'
import { Icon } from '../../components/ui/Icon'

export function Toaster() {
  const toasts = useToastStore((s) => s.toasts)
  const dismiss = useToastStore((s) => s.dismiss)
  return (
    <div className="pointer-events-none fixed bottom-6 left-1/2 z-[1100] flex -translate-x-1/2 flex-col items-center gap-2" aria-live="polite">
      {toasts.map((t) => (
        <button
          key={t.id}
          type="button"
          onClick={() => dismiss(t.id)}
          className="glass pointer-events-auto flex max-w-[520px] items-center gap-2.5 rounded-full px-4 py-2.5 text-sm font-semibold text-fg shadow-menu animate-slide-up"
        >
          {t.kind !== 'info' && (
            <span className={cn('flex h-5 w-5 shrink-0 items-center justify-center rounded-full', t.kind === 'success' ? 'bg-success/20 text-success' : 'bg-danger/20 text-danger')}>
              <Icon name={t.kind === 'success' ? 'check' : 'close'} className="h-3 w-3" />
            </span>
          )}
          <span className="text-left">{t.message}</span>
        </button>
      ))}
    </div>
  )
}
