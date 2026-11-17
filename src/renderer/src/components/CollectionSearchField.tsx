import { useEffect, useRef, useState, type RefObject } from 'react'
import { Search } from 'lucide-react'

export function useCollectionSearch(locale?: string, debounceMs = 300): {
  searchInput: string
  search: string
  searchRef: RefObject<HTMLInputElement | null>
  setSearchInput: (value: string) => void
  clearSearch: () => void
} {
  const [searchInput, setSearchInput] = useState('')
  const [search, setSearch] = useState('')
  const searchRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setSearch(searchInput.trim().toLocaleLowerCase(locale))
    }, debounceMs)
    return () => window.clearTimeout(timeout)
  }, [debounceMs, locale, searchInput])

  function clearSearch(): void {
    setSearchInput('')
    setSearch('')
  }

  return {
    searchInput,
    search,
    searchRef,
    setSearchInput,
    clearSearch
  }
}

export function CollectionSearchField({
  searchRef,
  value,
  onChange,
  onClear,
  placeholder,
  ariaLabel,
  priority = 20
}: {
  searchRef: RefObject<HTMLInputElement | null>
  value: string
  onChange: (value: string) => void
  onClear?: () => void
  placeholder: string
  ariaLabel: string
  priority?: number
}): React.JSX.Element {
  return (
    <label
      className="collection-filter-control filter-control collection-filter-control--search"
    >
      <Search size={15} aria-hidden="true" />
      <input
        ref={searchRef}
        type="search"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        aria-label={ariaLabel}
        aria-keyshortcuts="Control+F"
        data-app-search
        data-app-search-priority={priority}
        onKeyDown={(event) => {
          if (event.key !== 'Escape') return
          if (onClear) {
            onClear()
          } else {
            onChange('')
          }
          event.currentTarget.blur()
        }}
      />
      <kbd>Ctrl F</kbd>
    </label>
  )
}
