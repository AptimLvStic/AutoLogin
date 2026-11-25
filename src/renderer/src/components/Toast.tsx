import { Check, CircleAlert, Info, X } from 'lucide-react'
import { useI18n } from '../i18n'

export type ToastKind = 'success' | 'error' | 'info'

export interface ToastAction {
  label: string
  onClick: () => void
}

export interface ToastState {
  id: number
  kind: ToastKind
  message: string
  actions?: ToastAction[]
}

export type Notify = (kind: ToastKind, message: string, actions?: ToastAction[]) => void

export function Toast({
  toast,
  onClose
}: {
  toast: ToastState
  onClose: () => void
}): React.JSX.Element {
  const { tr } = useI18n()
  const Icon = toast.kind === 'success' ? Check : toast.kind === 'error' ? CircleAlert : Info
  return (
    <div className={'toast toast--' + toast.kind} role="status">
      <span className="toast__icon">
        <Icon size={16} strokeWidth={2.2} />
      </span>
      <span className="toast__message">{toast.message}</span>
      {toast.actions && toast.actions.length > 0 && (
        <span className="toast__actions">
          {toast.actions.map((action) => (
            <button
              key={action.label}
              type="button"
              className="toast__action"
              onClick={() => {
                action.onClick()
                onClose()
              }}
            >
              {action.label}
            </button>
          ))}
        </span>
      )}
      <button
        className="icon-button icon-button--small"
        onClick={onClose}
        aria-label={tr('关闭提示', 'Close notification', '關閉提示')}
      >
        <X size={14} />
      </button>
    </div>
  )
}
