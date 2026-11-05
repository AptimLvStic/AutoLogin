import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Check, ChevronDown } from 'lucide-react'
import { useI18n } from '../i18n'

const VIEWPORT_MARGIN = 8
const TITLEBAR_SAFE_TOP = 48
const MENU_GAP = 6

interface MenuPosition {
  left: number
  top: number
  width: number
}

export function PageSizePicker({
  value,
  options,
  onChange,
  ariaLabel
}: {
  value: number
  options: readonly number[]
  onChange: (value: number) => void
  ariaLabel: string
}): React.JSX.Element {
  const { tr } = useI18n()
  const [open, setOpen] = useState(false)
  const [position, setPosition] = useState<MenuPosition | null>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([])
  const optionIdPrefix = useId()
  const activeIndex = Math.max(0, options.indexOf(value))

  useLayoutEffect(() => {
    if (!open) return

    const updatePosition = (): void => {
      const trigger = triggerRef.current
      const menu = menuRef.current
      if (!trigger || !menu) return
      const triggerRect = trigger.getBoundingClientRect()
      const width = Math.max(104, triggerRect.width)
      const menuHeight = menu.offsetHeight
      const maxLeft = Math.max(
        VIEWPORT_MARGIN,
        window.innerWidth - width - VIEWPORT_MARGIN
      )
      const left = Math.max(
        VIEWPORT_MARGIN,
        Math.min(triggerRect.right - width, maxLeft)
      )
      const top = Math.max(TITLEBAR_SAFE_TOP, triggerRect.top - menuHeight - MENU_GAP)
      setPosition({ left, top, width })
    }

    updatePosition()
    const frame = window.requestAnimationFrame(updatePosition)
    window.addEventListener('resize', updatePosition)
    window.addEventListener('scroll', updatePosition, true)
    return () => {
      window.cancelAnimationFrame(frame)
      window.removeEventListener('resize', updatePosition)
      window.removeEventListener('scroll', updatePosition, true)
    }
  }, [open])

  useEffect(() => {
    if (!open) return

    const selectedOption = optionRefs.current[activeIndex]
    selectedOption?.focus({ preventScroll: true })

    const closeOnPointer = (event: PointerEvent): void => {
      if (
        event.target instanceof Node &&
        (triggerRef.current?.contains(event.target) || menuRef.current?.contains(event.target))
      ) {
        return
      }
      setOpen(false)
    }
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      setOpen(false)
      triggerRef.current?.focus({ preventScroll: true })
    }

    document.addEventListener('pointerdown', closeOnPointer)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('pointerdown', closeOnPointer)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [activeIndex, open])

  function choose(nextValue: number): void {
    onChange(nextValue)
    setOpen(false)
    triggerRef.current?.focus({ preventScroll: true })
  }

  function moveFocus(index: number): void {
    const option = optionRefs.current[index]
    option?.focus({ preventScroll: true })
  }

  return (
    <div className="account-pagination__size page-size-picker">
      <span>{tr('每页条数', 'Rows per page', '每頁筆數')}</span>
      <button
        ref={triggerRef}
        type="button"
        className="page-size-picker__trigger"
        aria-label={ariaLabel}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? `${optionIdPrefix}-menu` : undefined}
        onClick={() => setOpen((current) => !current)}
        onKeyDown={(event) => {
          if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
          event.preventDefault()
          setOpen(true)
        }}
      >
        <span>{tr(`${value} 条`, `${value} rows`, `${value} 筆`)}</span>
        <ChevronDown size={14} aria-hidden="true" />
      </button>
      {open &&
        createPortal(
          <div
            ref={menuRef}
            id={`${optionIdPrefix}-menu`}
            className="page-size-picker__menu"
            role="menu"
            aria-label={ariaLabel}
            style={
              position
                ? { left: position.left, top: position.top, width: position.width }
                : { visibility: 'hidden' }
            }
            onKeyDown={(event) => {
              if (event.key === 'ArrowDown') {
                event.preventDefault()
                moveFocus((activeIndex + 1) % options.length)
              } else if (event.key === 'ArrowUp') {
                event.preventDefault()
                moveFocus((activeIndex - 1 + options.length) % options.length)
              } else if (event.key === 'Home') {
                event.preventDefault()
                moveFocus(0)
              } else if (event.key === 'End') {
                event.preventDefault()
                moveFocus(options.length - 1)
              }
            }}
          >
            {options.map((size, index) => (
              <button
                key={size}
                ref={(element) => {
                  optionRefs.current[index] = element
                }}
                type="button"
                role="menuitemradio"
                aria-checked={size === value}
                className={size === value ? 'is-active' : ''}
                onClick={() => choose(size)}
              >
                <span>{tr(`${size} 条`, `${size} rows`, `${size} 筆`)}</span>
                {size === value && <Check size={14} aria-hidden="true" />}
              </button>
            ))}
          </div>,
          document.body
        )}
    </div>
  )
}
