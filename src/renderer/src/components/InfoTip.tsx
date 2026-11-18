import { useEffect, useId, useRef, useState } from 'react'
import { CircleHelp } from 'lucide-react'
import { useI18n } from '../i18n'

export function InfoTip({
  children
}: {
  children: React.ReactNode
}): React.JSX.Element {
  const { tr } = useI18n()
  const [open, setOpen] = useState(false)
  const [alignRight, setAlignRight] = useState(false)
  const rootRef = useRef<HTMLSpanElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const timerRef = useRef<number | null>(null)
  const tipId = useId()

  function clearTimer(): void {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }

  function showTip(): void {
    const rect = buttonRef.current?.getBoundingClientRect()
    if (rect) {
      setAlignRight(rect.left + 240 > window.innerWidth - 16)
    }
    setOpen(true)
  }

  function hideTip(): void {
    clearTimer()
    setOpen(false)
  }

  useEffect(() => () => clearTimer(), [])

  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      setOpen(false)
      buttonRef.current?.focus()
    }
    const onPointerDown = (event: PointerEvent): void => {
      if (
        event.target instanceof Node &&
        rootRef.current?.contains(event.target)
      ) {
        return
      }
      setOpen(false)
    }
    document.addEventListener('keydown', onKeyDown)
    document.addEventListener('pointerdown', onPointerDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.removeEventListener('pointerdown', onPointerDown)
    }
  }, [open])

  return (
    <span
      ref={rootRef}
      className="info-tip"
      onMouseEnter={() => {
        clearTimer()
        timerRef.current = window.setTimeout(showTip, 300)
      }}
      onMouseLeave={hideTip}
    >
      <button
        ref={buttonRef}
        type="button"
        className="info-tip__trigger"
        aria-label={tr('查看说明', 'Show details', '查看說明')}
        aria-expanded={open}
        aria-describedby={open ? tipId : undefined}
        onFocus={() => {
          if (buttonRef.current?.matches(':focus-visible')) showTip()
        }}
        onBlur={(event) => {
          if (
            event.relatedTarget instanceof Node &&
            rootRef.current?.contains(event.relatedTarget)
          ) {
            return
          }
          hideTip()
        }}
        onClick={() => {
          clearTimer()
          if (open) setOpen(false)
          else showTip()
        }}
      >
        <CircleHelp size={13} />
      </button>
      {open && (
        <span
          id={tipId}
          className={`info-tip__bubble${alignRight ? ' is-align-right' : ''}`}
          role="tooltip"
        >
          {children}
        </span>
      )}
    </span>
  )
}
