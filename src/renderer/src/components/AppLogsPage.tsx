import { useEffect, useMemo, useRef, useState } from 'react'
import {
  BookOpen,
  Check,
  ChevronLeft,
  ChevronRight,
  LoaderCircle,
  RefreshCw,
  SearchX,
  Trash2
} from 'lucide-react'
import type { AppLogEntry, AppLogLevel } from '@shared/types'
import { useI18n } from '../i18n'
import { LogsTabs, type LogView } from './LogsTabs'
import { ConfirmDialog } from './Modal'

type AppLogStatusFilter = 'all' | AppLogLevel
type PageSize = 10 | 20 | 50 | 100 | 200

const PAGE_SIZES: PageSize[] = [10, 20, 50, 100, 200]
const MAX_DELETE_COUNT = 100

export function AppLogsPage({
  notify,
  onNavigate
}: {
  notify: (kind: 'success' | 'error' | 'info', message: string) => void
  onNavigate: (view: LogView) => void
}): React.JSX.Element {
  const { tr, formatDate } = useI18n()
  const [logs, setLogs] = useState<AppLogEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [date, setDate] = useState('')
  const [status, setStatus] = useState<AppLogStatusFilter>('all')
  const [pageSize, setPageSize] = useState<PageSize>(20)
  const [page, setPage] = useState(1)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set())
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false)
  const [confirmClearOpen, setConfirmClearOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [clearing, setClearing] = useState(false)
  const selectAllRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    void load()
  }, [])

  const filtered = useMemo(
    () =>
      logs.filter((entry) => {
        if (date && localDateKey(entry.timestamp) !== date) return false
        if (status !== 'all' && entry.level !== status) return false
        return true
      }),
    [date, logs, status]
  )

  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize))
  const currentPage = Math.min(page, pageCount)
  const visible = filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize)
  const visibleSelectedCount = visible.filter((entry) => selectedIds.has(entry.id)).length
  const allPageSelected = visible.length > 0 && visibleSelectedCount === visible.length
  const somePageSelected = visibleSelectedCount > 0 && !allPageSelected

  useEffect(() => {
    setPage(1)
  }, [date, pageSize, status])

  useEffect(() => {
    if (selectAllRef.current) {
      selectAllRef.current.indeterminate = somePageSelected
    }
  }, [somePageSelected])

  useEffect(() => {
    const available = new Set(logs.map((entry) => entry.id))
    setSelectedIds((current) => {
      const next = new Set([...current].filter((id) => available.has(id)))
      return next.size === current.size ? current : next
    })
  }, [logs])

  async function load(): Promise<void> {
    setLoading(true)
    try {
      setLogs(await window.autologin.app.listAppLogs(500))
    } catch (error) {
      notify(
        'error',
        error instanceof Error
          ? error.message
          : tr('读取软件日志失败', 'Could not read app logs.', '讀取軟體日誌失敗')
      )
    } finally {
      setLoading(false)
    }
  }

  function togglePageSelection(): void {
    if (allPageSelected) {
      setSelectedIds((current) => {
        const next = new Set(current)
        for (const entry of visible) next.delete(entry.id)
        return next
      })
      return
    }

    const remaining = MAX_DELETE_COUNT - selectedIds.size
    if (remaining <= 0) {
      notify(
        'info',
        tr(
          `单次最多删除 ${MAX_DELETE_COUNT} 条日志`,
          `You can delete up to ${MAX_DELETE_COUNT} logs at once.`,
          `單次最多刪除 ${MAX_DELETE_COUNT} 筆日誌`
        )
      )
      return
    }
    const candidates = visible.filter((entry) => !selectedIds.has(entry.id))
    const limited = candidates.slice(0, remaining)
    setSelectedIds((current) => {
      const next = new Set(current)
      for (const entry of limited) next.add(entry.id)
      return next
    })
    if (limited.length < candidates.length) {
      notify(
        'info',
        tr(
          `已选中前 ${MAX_DELETE_COUNT} 条，单次最多删除 ${MAX_DELETE_COUNT} 条`,
          `Selected the first ${MAX_DELETE_COUNT}; the batch limit is ${MAX_DELETE_COUNT}.`,
          `已選取前 ${MAX_DELETE_COUNT} 筆，單次最多刪除 ${MAX_DELETE_COUNT} 筆`
        )
      )
    }
  }

  function toggleSelection(entryId: string): void {
    setSelectedIds((current) => {
      const next = new Set(current)
      if (next.has(entryId)) next.delete(entryId)
      else if (next.size < MAX_DELETE_COUNT) next.add(entryId)
      else {
        notify(
          'info',
          tr(
            `单次最多删除 ${MAX_DELETE_COUNT} 条日志`,
            `You can delete up to ${MAX_DELETE_COUNT} logs at once.`,
            `單次最多刪除 ${MAX_DELETE_COUNT} 筆日誌`
          )
        )
      }
      return next
    })
  }

  async function deleteSelected(): Promise<void> {
    setDeleting(true)
    try {
      const result = await window.autologin.app.deleteAppLogs([...selectedIds])
      setConfirmDeleteOpen(false)
      setSelectedIds(new Set())
      notify(
        'success',
        tr(
          `已删除 ${result.deleted} 条软件日志`,
          `Deleted ${result.deleted} app log entries.`,
          `已刪除 ${result.deleted} 筆軟體日誌`
        )
      )
      await load()
    } catch (error) {
      notify(
        'error',
        error instanceof Error
          ? error.message
          : tr('删除软件日志失败', 'Could not delete app logs.', '刪除軟體日誌失敗')
      )
    } finally {
      setDeleting(false)
    }
  }

  async function clearLogs(): Promise<void> {
    setClearing(true)
    try {
      const result = await window.autologin.app.clearAppLogs()
      setConfirmClearOpen(false)
      setSelectedIds(new Set())
      setLogs([])
      notify(
        'success',
        tr(
          `已清除 ${result.deleted} 条软件日志`,
          `Cleared ${result.deleted} app log entries.`,
          `已清除 ${result.deleted} 筆軟體日誌`
        )
      )
    } catch (error) {
      notify(
        'error',
        error instanceof Error
          ? error.message
          : tr('清除软件日志失败', 'Could not clear app logs.', '清除軟體日誌失敗')
      )
    } finally {
      setClearing(false)
    }
  }

  return (
    <>
      <section className="page-section logs-page app-logs-page">
        <nav className="page-breadcrumb" aria-label={tr('面包屑', 'Breadcrumb', '麵包屑')}>
          <span>{tr('日志', 'Logs', '日誌')}</span>
          <ChevronRight size={12} />
          <h2>{tr('软件日志', 'App logs', '軟體日誌')}</h2>
        </nav>

        <LogsTabs active="appLogs" onChange={onNavigate} />

        <div className="log-filters log-filters--app">
          <label className="field">
            <span className="field__label">{tr('日期', 'Date', '日期')}</span>
            <input
              className="filter-control"
              type="date"
              value={date}
              onChange={(event) => setDate(event.target.value)}
            />
          </label>
          <label className="field">
            <span className="field__label">{tr('状态', 'Status', '狀態')}</span>
            <select
              className="filter-control"
              value={status}
              onChange={(event) => setStatus(event.target.value as AppLogStatusFilter)}
            >
              <option value="all">{tr('全部状态', 'All statuses', '全部狀態')}</option>
              <option value="info">{tr('信息', 'Info', '資訊')}</option>
              <option value="success">{tr('成功', 'Success', '成功')}</option>
              <option value="warning">{tr('警告', 'Warning', '警告')}</option>
              <option value="error">{tr('错误', 'Error', '錯誤')}</option>
            </select>
          </label>
          <label className="field">
            <span className="field__label">{tr('每页条数', 'Rows per page', '每頁筆數')}</span>
            <select
              className="filter-control"
              value={pageSize}
              onChange={(event) => setPageSize(Number(event.target.value) as PageSize)}
            >
              {PAGE_SIZES.map((size) => (
                <option key={size} value={size}>
                  {size}
                </option>
              ))}
            </select>
          </label>
          <div className="log-filters__actions">
            <button className="button button--soft" onClick={() => void load()} disabled={loading}>
              {loading ? <LoaderCircle size={15} className="spin" /> : <RefreshCw size={15} />}
              {tr('刷新', 'Refresh', '重新整理')}
            </button>
            <button
              className="button button--danger-ghost"
              onClick={() => setConfirmClearOpen(true)}
              disabled={logs.length === 0 || loading}
            >
              <Trash2 size={15} />
              {tr('清除全部', 'Clear all', '清除全部')}
            </button>
          </div>
        </div>

        <div className="log-bulk-bar">
          <span>
            {selectedIds.size > 0
              ? tr(
                  `已选择 ${selectedIds.size} 条`,
                  `${selectedIds.size} selected`,
                  `已選取 ${selectedIds.size} 筆`
                )
              : tr(
                  `可勾选当前页，单次最多删除 ${MAX_DELETE_COUNT} 条`,
                  `Select rows for deletion, up to ${MAX_DELETE_COUNT} at once.`,
                  `可勾選目前頁，單次最多刪除 ${MAX_DELETE_COUNT} 筆`
                )}
          </span>
          <div>
            {selectedIds.size > 0 && (
              <button className="text-button" onClick={() => setSelectedIds(new Set())}>
                {tr('取消选择', 'Clear selection', '取消選取')}
              </button>
            )}
            <button
              className="button button--danger-ghost"
              onClick={() => setConfirmDeleteOpen(true)}
              disabled={selectedIds.size === 0 || deleting}
            >
              <Trash2 size={15} />
              {tr('批量删除', 'Delete selected', '批次刪除')}
            </button>
          </div>
        </div>

        {loading ? (
          <div className="logs-empty">
            <LoaderCircle size={22} className="spin" />
            <span>{tr('正在读取软件日志', 'Reading app logs', '正在讀取軟體日誌')}</span>
          </div>
        ) : visible.length === 0 ? (
          <div className="logs-empty">
            <SearchX size={24} />
            <strong>{tr('暂无数据', 'No data', '暫無資料')}</strong>
            <span>
              {tr(
                '调整筛选条件或等待新的软件运行记录。',
                'Adjust the filters or wait for a new app event.',
                '調整篩選條件或等待新的軟體執行記錄。'
              )}
            </span>
          </div>
        ) : (
          <div className="log-table-wrap">
            <div
              className="app-log-table"
              role="table"
              aria-label={tr('软件日志列表', 'App log list', '軟體日誌列表')}
            >
              <div className="app-log-table__header app-log-table__grid" role="row">
                <label className="log-checkbox" onClick={(event) => event.stopPropagation()}>
                  <input
                    ref={selectAllRef}
                    type="checkbox"
                    checked={allPageSelected}
                    onChange={togglePageSelection}
                    aria-label={tr('全选当前页', 'Select current page', '全選目前頁')}
                  />
                  <span aria-hidden="true">
                    <Check size={12} />
                  </span>
                </label>
                <span>{tr('状态', 'Status', '狀態')}</span>
                <span>{tr('分类', 'Category', '分類')}</span>
                <span>{tr('说明', 'Details', '說明')}</span>
                <span>{tr('时间', 'Time', '時間')}</span>
              </div>
              {visible.map((entry) => (
                <article
                  className={`app-log-row app-log-table__grid${
                    selectedIds.has(entry.id) ? ' is-selected' : ''
                  }`}
                  role="row"
                  key={entry.id}
                >
                  <label className="log-checkbox" onClick={(event) => event.stopPropagation()}>
                    <input
                      type="checkbox"
                      checked={selectedIds.has(entry.id)}
                      onChange={() => toggleSelection(entry.id)}
                      aria-label={tr(
                        `选择软件日志 ${entry.message}`,
                        `Select app log ${entry.message}`,
                        `選取軟體日誌 ${entry.message}`
                      )}
                    />
                    <span aria-hidden="true">
                      <Check size={12} />
                    </span>
                  </label>
                  <span className={`app-log-level is-${entry.level}`}>
                    {appLogLevelLabel(entry.level, tr)}
                  </span>
                  <span className="app-log-category">
                    {appLogCategoryLabel(entry.category, tr)}
                  </span>
                  <div className="app-log-row__content">
                    <strong>{entry.message}</strong>
                    {entry.details && <p>{entry.details}</p>}
                  </div>
                  <time dateTime={entry.timestamp}>
                    {formatDate(entry.timestamp, {
                      dateStyle: 'short',
                      timeStyle: 'medium'
                    })}
                  </time>
                </article>
              ))}
            </div>

            <footer className="log-pagination">
              <span>
                {tr(
                  '共 {count} 条，第 {page}/{pages} 页',
                  '{count} records, page {page} of {pages}',
                  '共 {count} 筆，第 {page}/{pages} 頁',
                  { count: filtered.length, page: currentPage, pages: pageCount }
                )}
              </span>
              <div>
                <button
                  className="icon-button icon-button--small"
                  onClick={() => setPage((value) => Math.max(1, value - 1))}
                  disabled={currentPage <= 1}
                  aria-label={tr('上一页', 'Previous page', '上一頁')}
                >
                  <ChevronLeft size={16} />
                </button>
                <button
                  className="icon-button icon-button--small"
                  onClick={() => setPage((value) => Math.min(pageCount, value + 1))}
                  disabled={currentPage >= pageCount}
                  aria-label={tr('下一页', 'Next page', '下一頁')}
                >
                  <ChevronRight size={16} />
                </button>
              </div>
            </footer>
          </div>
        )}
      </section>

      {confirmDeleteOpen && (
        <ConfirmDialog
          title={tr('删除选中的软件日志？', 'Delete selected app logs?', '刪除選取的軟體日誌？')}
          description={tr(
            `将永久删除 ${selectedIds.size} 条本地软件日志，账号、登录日志和网站会话不会受到影响。`,
            `${selectedIds.size} local app logs will be permanently deleted. Accounts, login history and website sessions are unaffected.`,
            `將永久刪除 ${selectedIds.size} 筆本機軟體日誌，帳號、登入日誌和網站工作階段不會受到影響。`
          )}
          confirmLabel={tr('确认删除', 'Delete logs', '確認刪除')}
          danger
          busy={deleting}
          onConfirm={() => void deleteSelected()}
          onClose={() => setConfirmDeleteOpen(false)}
        />
      )}

      {confirmClearOpen && (
        <ConfirmDialog
          title={tr('清除全部软件日志？', 'Clear all app logs?', '清除全部軟體日誌？')}
          description={tr(
            `将永久删除当前 ${logs.length} 条软件日志，不会影响账号、登录日志或网站会话。`,
            `Permanently delete ${logs.length} app log entries. Accounts, login history and website sessions are unaffected.`,
            `將永久刪除目前 ${logs.length} 筆軟體日誌，不會影響帳號、登入日誌或網站工作階段。`
          )}
          confirmLabel={tr('确认清除', 'Clear logs', '確認清除')}
          danger
          busy={clearing}
          onConfirm={() => void clearLogs()}
          onClose={() => setConfirmClearOpen(false)}
        />
      )}
    </>
  )
}

function localDateKey(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function appLogLevelLabel(
  level: AppLogEntry['level'],
  tr: (zhCN: string, en: string, zhTW: string) => string
): string {
  if (level === 'error') return tr('错误', 'Error', '錯誤')
  if (level === 'warning') return tr('警告', 'Warning', '警告')
  if (level === 'success') return tr('成功', 'Success', '成功')
  return tr('信息', 'Info', '資訊')
}

function appLogCategoryLabel(
  category: string,
  tr: (zhCN: string, en: string, zhTW: string) => string
): string {
  const labels: Record<string, [string, string, string]> = {
    startup: ['应用启动', 'Startup', '應用程式啟動'],
    app: ['应用', 'App', '應用'],
    vault: ['保险库', 'Vault', '保險庫'],
    proxy: ['网络代理', 'Proxy', '網路代理'],
    login: ['登录任务', 'Login task', '登入工作'],
    update: ['应用更新', 'App update', '應用程式更新'],
    backup: ['备份', 'Backup', '備份'],
    data: ['数据操作', 'Data', '資料操作'],
    settings: ['设置', 'Settings', '設定']
  }
  const label = labels[category]
  return label ? tr(label[0], label[1], label[2]) : category
}
