import { Check, CircleAlert, Info, X } from 'lucide-react'

export type ToastKind = 'success' | 'error' | 'info'

export interface ToastState {
  id: number
  kind: ToastKind
  message: string
}

export function Toast({
  toast,
  onClose
}: {
  toast: ToastState
  onClose: () => void
}): React.JSX.Element {
  const Icon = toast.kind === 'success' ? Check : toast.kind === 'error' ? CircleAlert : Info
  return (
    <div className={`toast toast--${toast.kind}`} role="status">
      <span className="toast__icon">
        <Icon size={16} strokeWidth={2.2} />
      </span>
      <span>{toast.message}</span>
      <button className="icon-button icon-button--small" onClick={onClose} aria-label="关闭提示">
        <X size={14} />
      </button>
    </div>
  )
}
