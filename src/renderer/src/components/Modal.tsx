import { useEffect, useId, useRef } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { useI18n } from '../i18n'

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
  const { tr } = useI18n()
  const panelRef = useRef<HTMLDivElement>(null)
  const onCloseRef = useRef(onClose)
  const titleId = useId()

  useEffect(() => {
    onCloseRef.current = onClose
  }, [onClose])

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    const panel = panelRef.current
    const focusable =
      panel?.querySelector<HTMLElement>(
        '[data-autofocus], input:not([disabled]), select:not([disabled]), textarea:not([disabled])'
      ) ??
      panel?.querySelector<HTMLElement>(
        'button:not([disabled]), [tabindex]:not([tabindex="-1"])'
      )
    focusable?.focus()

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        onCloseRef.current()
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
  }, [])

  return createPortal(
    <div className="modal-layer" role="presentation">
      <button
        className="modal-backdrop"
        aria-label={tr('关闭', 'Close', '關閉')}
        onClick={onClose}
      />
      <div
        className={'modal-panel ' + className}
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
          <button
            className="icon-button"
            onClick={onClose}
            aria-label={tr('关闭', 'Close', '關閉')}
          >
            <X size={18} />
          </button>
        </header>
        {children}
      </div>
    </div>,
    document.body
  )
}

export function ConfirmDialog({
  title,
  description,
  confirmLabel,
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
  const { tr } = useI18n()
  const label = confirmLabel ?? tr('确认', 'Confirm', '確認')
  return (
    <Modal title={title} onClose={onClose} width="440px" className="confirm-dialog">
      <p className="modal-description">{description}</p>
      <div className="modal-actions">
        <button className="button button--ghost" onClick={onClose} disabled={busy}>
          {tr('取消', 'Cancel', '取消')}
        </button>
        <button
          className={'button ' + (danger ? 'button--danger' : 'button--primary')}
          onClick={onConfirm}
          disabled={busy}
        >
          {busy ? tr('处理中…', 'Working…', '處理中…') : label}
        </button>
      </div>
    </Modal>
  )
}
