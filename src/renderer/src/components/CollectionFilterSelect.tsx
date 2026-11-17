import { Check, ChevronDown, Search } from 'lucide-react'
import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent
} from 'react'
import { useI18n } from '../i18n'

export interface CollectionFilterOption {
  value: string
  label: string
}

export function CollectionFilterSelect({
  value,
  options,
  onChange,
  ariaLabel,
  searchable = false,
  searchPlaceholder,
  className = ''
}: {
  value: string
  options: CollectionFilterOption[]
  onChange: (value: string) => void
  ariaLabel: string
  searchable?: boolean
  searchPlaceholder?: string
  className?: string
}): React.JSX.Element {
  const { tr } = useI18n()
  const [open, setOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(0)
  const [query, setQuery] = useState('')
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([])
  const listboxId = useId()
  const selectedIndex = Math.max(
    0,
    options.findIndex((option) => option.value === value)
  )
  const selectedOption = options[selectedIndex] ?? options[0]
  const filteredOptions = useMemo(() => {
    const search = query.trim().toLocaleLowerCase()
    if (!search) return options
    return options.filter((option) =>
      option.label.toLocaleLowerCase().includes(search)
    )
  }, [options, query])

  useEffect(() => {
    if (!open) return
    const nextIndex = Math.max(
      0,
      filteredOptions.findIndex((option) => option.value === value)
    )
    setActiveIndex(nextIndex)
    const frame = window.requestAnimationFrame(() => {
      if (searchable) searchRef.current?.focus()
      else optionRefs.current[nextIndex]?.focus()
    })
    const closeOnPointer = (event: PointerEvent): void => {
      if (
        event.target instanceof Node &&
        rootRef.current?.contains(event.target)
      ) {
        return
      }
      setOpen(false)
    }
    const close = (): void => setOpen(false)
    document.addEventListener('pointerdown', closeOnPointer)
    window.addEventListener('blur', close)
    window.addEventListener('resize', close)
    return () => {
      window.cancelAnimationFrame(frame)
      document.removeEventListener('pointerdown', closeOnPointer)
      window.removeEventListener('blur', close)
      window.removeEventListener('resize', close)
    }
    // Resolve the active option when opening; option labels may be rebuilt each render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  function selectOption(option: CollectionFilterOption): void {
    onChange(option.value)
    setOpen(false)
    triggerRef.current?.focus()
  }

  function focusOption(index: number): void {
    if (filteredOptions.length === 0) return
    const next = (index + filteredOptions.length) % filteredOptions.length
    setActiveIndex(next)
    optionRefs.current[next]?.focus()
  }

  function handleListKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      focusOption(activeIndex + 1)
      return
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault()
      focusOption(activeIndex - 1)
      return
    }
    if (event.key === 'Home') {
      event.preventDefault()
      focusOption(0)
      return
    }
    if (event.key === 'End') {
      event.preventDefault()
      focusOption(filteredOptions.length - 1)
      return
    }
    if (event.key === 'Escape') {
      event.preventDefault()
      setOpen(false)
      triggerRef.current?.focus()
      return
    }
    if (event.key === 'Tab') {
      setOpen(false)
    }
  }

  return (
    <div
      ref={rootRef}
      className={`collection-filter-select ${className}`.trim()}
    >
      <button
        ref={triggerRef}
        type="button"
        role="combobox"
        className="collection-filter-control collection-filter-control--select filter-control collection-filter-select__trigger"
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listboxId : undefined}
        onClick={() => {
          if (open) {
            setOpen(false)
            return
          }
          setQuery('')
          setOpen(true)
        }}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault()
            setOpen(true)
          }
        }}
      >
        <span>{selectedOption?.label ?? ''}</span>
        <ChevronDown size={14} aria-hidden="true" />
      </button>
      {open ? (
        <div className="collection-filter-select__popover">
          {searchable ? (
            <label className="collection-filter-select__search">
              <Search size={14} aria-hidden="true" />
              <input
                ref={searchRef}
                type="search"
                value={query}
                placeholder={
                  searchPlaceholder ??
                  tr('搜索选项', 'Search options', '搜尋選項')
                }
                aria-label={
                  searchPlaceholder ??
                  tr('搜索选项', 'Search options', '搜尋選項')
                }
                onChange={(event) => {
                  setQuery(event.target.value)
                  setActiveIndex(0)
                }}
                onKeyDown={(event) => {
                  if (event.key === 'ArrowDown') {
                    event.preventDefault()
                    event.stopPropagation()
                    focusOption(0)
                    return
                  }
                  if (event.key === 'ArrowUp') {
                    event.preventDefault()
                    event.stopPropagation()
                    focusOption(filteredOptions.length - 1)
                    return
                  }
                  if (event.key === 'Escape') {
                    event.preventDefault()
                    event.stopPropagation()
                    setOpen(false)
                    triggerRef.current?.focus()
                    return
                  }
                  if (event.key === 'Enter' && filteredOptions[0]) {
                    event.preventDefault()
                    selectOption(filteredOptions[0])
                    return
                  }
                  if (event.key === 'Tab') {
                    setOpen(false)
                  }
                }}
              />
            </label>
          ) : null}
          <div
            id={listboxId}
            className="collection-filter-select__options"
            role="listbox"
            aria-label={ariaLabel}
            onKeyDown={handleListKeyDown}
          >
            {filteredOptions.length > 0 ? (
              filteredOptions.map((option, index) => {
                const selected = option.value === value
                return (
                  <button
                    key={option.value}
                    ref={(element) => {
                      optionRefs.current[index] = element
                    }}
                    type="button"
                    role="option"
                    tabIndex={-1}
                    aria-selected={selected}
                    className={`${selected ? 'is-selected' : ''}${
                      activeIndex === index ? ' is-active' : ''
                    }`.trim()}
                    onFocus={() => setActiveIndex(index)}
                    onClick={() => selectOption(option)}
                  >
                    <span>{option.label}</span>
                    {selected ? <Check size={14} aria-hidden="true" /> : null}
                  </button>
                )
              })
            ) : (
              <span className="collection-filter-select__empty" role="status">
                {tr('没有匹配项', 'No matches', '沒有符合項目')}
              </span>
            )}
          </div>
        </div>
      ) : null}
    </div>
  )
}
