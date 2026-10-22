/**
 * SearchField — the list search bar (Figma "Search": frosted bar, Vuesax
 * magnifier), with a clear button and Escape clearing the query (instead of
 * blurring — recovering from a typo should not cost focus).
 *
 * @example <SearchField value={q} onChange={setQ} placeholder="Search" />
 */
import { cn } from '../../lib/cn'
import { IconButton } from './IconButton'
import { VIcon } from './VIcon'

export interface SearchFieldProps {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  autoFocus?: boolean
  className?: string
}

export function SearchField({ value, onChange, placeholder = 'Search', autoFocus, className }: SearchFieldProps) {
  return (
    <label
      className={cn(
        'flex h-[34px] shrink-0 cursor-text items-center gap-1.5 overflow-hidden rounded-[6px] bg-fg/10 px-2 backdrop-blur-[10px] transition-shadow focus-within:ring-1 focus-within:ring-accent/50',
        className
      )}
    >
      <VIcon name="search-normal" size={15} className="text-fg" />
      <input
        type="search"
        value={value}
        autoFocus={autoFocus}
        placeholder={placeholder}
        spellCheck={false}
        autoComplete="off"
        aria-label={placeholder}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape' && value) {
            e.stopPropagation()
            onChange('')
          }
        }}
        className="h-full min-w-0 flex-1 bg-transparent text-[11px] font-semibold text-fg placeholder:text-fg/90 focus:outline-none [&::-webkit-search-cancel-button]:hidden"
      />
      {value && <IconButton icon="close" label="Clear search" size="sm" onClick={() => onChange('')} />}
    </label>
  )
}
