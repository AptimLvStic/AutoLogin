import { useEffect, useState } from 'react'
import { Minus, Square, X } from 'lucide-react'
import { useI18n } from '../i18n'

export function WindowControls(): React.JSX.Element {
  const { tr } = useI18n()
  const [maximized, setMaximized] = useState(false)

  useEffect(() => {
    let cancelled = false
    void window.autologin.windowControls.getState().then((state) => {
      if (!cancelled) setMaximized(state.maximized)
    })
    const unsubscribe = window.autologin.windowControls.onMaximizedChange(setMaximized)
    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [])

  return (
    <div
      className="window-chrome"
      onDoubleClick={(event) => {
        if ((event.target as HTMLElement).closest('button')) return
        void window.autologin.windowControls.toggleMaximize()
      }}
    >
      <span className="window-chrome__title">AutoLogin</span>
      <div className="window-chrome__controls">
        <button
          type="button"
          onClick={() => void window.autologin.windowControls.minimize()}
          aria-label={tr('最小化', 'Minimize', '最小化')}
        >
          <Minus size={15} />
        </button>
        <button
          type="button"
          onClick={() => void window.autologin.windowControls.toggleMaximize()}
          aria-label={maximized ? tr('还原窗口', 'Restore window', '還原視窗') : tr('最大化', 'Maximize', '最大化')}
        >
          <Square size={12} className={maximized ? 'is-restore' : ''} />
        </button>
        <button
          type="button"
          className="window-chrome__close"
          onClick={() => void window.autologin.windowControls.close()}
          aria-label={tr('关闭', 'Close', '關閉')}
        >
          <X size={15} />
        </button>
      </div>
    </div>
  )
}
