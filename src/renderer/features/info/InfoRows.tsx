/**
 * InfoSection / InfoRow — label/value rows grouped under small headings,
 * used by the File Info modal (and reusable for any details panel).
 *
 * @example <InfoSection title="Details"><InfoRow label="Size" value="1.2 GB" /></InfoSection>
 */
import type { ReactNode } from 'react'
import { cn } from '../../lib/cn'

export function InfoSection({ title, children, first }: { title: string; children: ReactNode; first?: boolean }) {
  return (
    <section className={cn(!first && 'mt-4 border-t-2 border-fg/10 pt-4')}>
      <h3 className="mb-2 text-[11px] font-bold uppercase tracking-wider text-subtle">{title}</h3>
      <dl className="space-y-2">{children}</dl>
    </section>
  )
}

export function InfoRow({ label, value, title, wrap }: { label: string; value: ReactNode; title?: string; wrap?: boolean }) {
  return (
    <div className="flex items-baseline gap-4 text-[12px]">
      <dt className="w-28 shrink-0 font-semibold text-muted">{label}</dt>
      <dd className={cn('min-w-0 flex-1 select-text font-semibold text-fg', wrap ? 'break-all' : 'truncate')} title={title}>
        {value}
      </dd>
    </div>
  )
}
