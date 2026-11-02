import { useEffect, useId, useRef } from 'react'
import { X } from 'lucide-react'

export function Modal({
  title,
  eyebrow,
  children,
  onClose,
  width = '560px',
  className = ''
}: {
  title: string
  eyebrow?: string
  children: React.ReactNode
  onClose: () => void
  width?: string
  className?: string
}): React.JSX.Element {
  const panelRef = useRef<HTMLDivElement>(null)
  const titleId = useId()

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    const panel = panelRef.current
    const focusable = panel?.querySelector<HTMLElement>(
      'button, input, select, textarea, [tabindex]:not([tabindex="-1"])'
    )
    focusable?.focus()

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        onClose()
      }
      if (event.key !== 'Tab' || !panel) {
        return
      }
      const items = Array.from(
        panel.querySelectorAll<HTMLElement>(
          'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
        )
      ).filter((element) => element.offsetParent !== null)
      if (items.length === 0) {
        return
      }
      const first = items[0]!
      const last = items[items.length - 1]!
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      previous?.focus()
    }
  }, [onClose])

  return (
    <div className="modal-layer" role="presentation">
      <button className="modal-backdrop" aria-label="关闭" onClick={onClose} />
      <div
        className={`modal-panel ${className}`}
        style={{ '--modal-width': width } as React.CSSProperties}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        ref={panelRef}
      >
        <header className="modal-header">
          <div>
            {eyebrow && <span className="eyebrow">{eyebrow}</span>}
            <h2 id={titleId}>{title}</h2>
          </div>
          <button className="icon-button" onClick={onClose} aria-label="关闭">
            <X size={18} />
          </button>
        </header>
        {children}
      </div>
    </div>
  )
}

export function ConfirmDialog({
  title,
  description,
  confirmLabel = '确认',
  danger = false,
  onConfirm,
  onClose,
  busy = false
}: {
  title: string
  description: string
  confirmLabel?: string
  danger?: boolean
  onConfirm: () => void
  onClose: () => void
  busy?: boolean
}): React.JSX.Element {
  return (
    <Modal title={title} onClose={onClose} width="440px" className="confirm-dialog">
      <p className="modal-description">{description}</p>
      <div className="modal-actions">
        <button className="button button--ghost" onClick={onClose} disabled={busy}>
          取消
        </button>
        <button
          className={`button ${danger ? 'button--danger' : 'button--primary'}`}
          onClick={onConfirm}
          disabled={busy}
        >
          {busy ? '处理中…' : confirmLabel}
        </button>
      </div>
    </Modal>
  )
}
