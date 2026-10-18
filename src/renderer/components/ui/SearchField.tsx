/**
 * SearchField — a TextField with a magnifier, a clear button, and Escape
 * clearing the query (instead of blurring — recovering from a typo should
 * not cost focus).
 *
 * @example <SearchField value={q} onChange={setQ} placeholder="Search" />
 */
import { TextField } from './TextField'
import { IconButton } from './IconButton'

export interface SearchFieldProps {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  autoFocus?: boolean
  className?: string
}

export function SearchField({ value, onChange, placeholder = 'Search', autoFocus, className }: SearchFieldProps) {
  return (
    <TextField
      leadingIcon="search"
      value={value}
      autoFocus={autoFocus}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Escape' && value) {
          e.stopPropagation()
          onChange('')
        }
      }}
      containerClassName={className}
      className="placeholder:font-medium"
      trailing={value ? <IconButton icon="close" label="Clear search" size="sm" onClick={() => onChange('')} /> : null}
    />
  )
}
