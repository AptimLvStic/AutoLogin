import { useEffect, useRef, type ReactNode } from 'react'
import { Ellipsis, LoaderCircle } from 'lucide-react'

export function PageActionMenu({
  open,
  onOpenChange,
  label,
  children,
  busy = false,
  disabled = false
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  label: string
  children: ReactNode
  busy?: boolean
  disabled?: boolean
}): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const closeOnPointer = (event: PointerEvent): void => {
      if (
        event.target instanceof Node &&
        containerRef.current?.contains(event.target)
      ) {
        return
      }
      onOpenChange(false)
    }
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onOpenChange(false)
    }
    document.addEventListener('pointerdown', closeOnPointer)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('pointerdown', closeOnPointer)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [onOpenChange, open])

  return (
    <div className="page-action-menu" ref={containerRef}>
      <button
        type="button"
        className="button button--ghost button--small button--icon-only page-action-menu__trigger"
        aria-label={label}
        title={label}
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={disabled || busy}
        onClick={() => onOpenChange(!open)}
      >
        {busy ? <LoaderCircle size={15} className="spin" /> : <Ellipsis size={17} />}
      </button>
      {open ? (
        <div className="page-action-menu__panel" role="menu" aria-label={label}>
          {children}
        </div>
      ) : null}
    </div>
  )
}
