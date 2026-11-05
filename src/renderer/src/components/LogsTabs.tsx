import { BookOpen, FileText, Globe2 } from 'lucide-react'
import { useI18n } from '../i18n'

export type LogView = 'loginLogs' | 'accessLogs' | 'appLogs'

export function LogsTabs({
  active,
  onChange
}: {
  active: LogView
  onChange: (view: LogView) => void
}): React.JSX.Element {
  const { tr } = useI18n()

  return (
    <nav
      className="settings-tabs logs-tabs"
      role="tablist"
      aria-label={tr('日志分类', 'Log sections', '日誌分類')}
    >
      <button
        type="button"
        role="tab"
        aria-selected={active === 'loginLogs'}
        className={active === 'loginLogs' ? 'is-active' : ''}
        onClick={() => onChange('loginLogs')}
      >
        <FileText size={14} />
        {tr('登录日志', 'Login history', '登入日誌')}
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={active === 'accessLogs'}
        className={active === 'accessLogs' ? 'is-active' : ''}
        onClick={() => onChange('accessLogs')}
      >
        <Globe2 size={14} />
        {tr('访问日志', 'Access history', '存取日誌')}
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={active === 'appLogs'}
        className={active === 'appLogs' ? 'is-active' : ''}
        onClick={() => onChange('appLogs')}
      >
        <BookOpen size={14} />
        {tr('软件日志', 'App logs', '軟體日誌')}
      </button>
    </nav>
  )
}
