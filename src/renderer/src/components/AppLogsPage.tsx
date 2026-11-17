import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  Check,
  ChevronDown,
  ChevronRight,
  CircleCheck,
  CircleX,
  LoaderCircle,
  RefreshCw,
  RotateCcw,
  SearchX,
  TriangleAlert,
  Trash2
} from 'lucide-react'
import type { AppLogEntry, AppLogLevel } from '@shared/types'
import { useI18n } from '../i18n'
import {
  LogPagination,
  type LogPageSize
} from './LogPagination'
import { LogsTabs, type LogView } from './LogsTabs'
import { CollectionPageHeader } from './CollectionPageHeader'
import { ConfirmDialog } from './Modal'
import { PageActionMenu } from './PageActionMenu'
import {
  emptyLogDateRange,
  LogDateFilter,
  matchesLogDateRange
} from './LogDateFilter'
import {
  CollectionSearchField,
  useCollectionSearch
} from './CollectionSearchField'
import { CollectionFilterSelect } from './CollectionFilterSelect'
import {
  useResizableColumns,
  type TableColumnDefinition
} from './ResizableColumns'

type AppLogLevelFilter = 'all' | AppLogLevel
type AppLogColumnKey = 'level' | 'category' | 'details' | 'time'

const MAX_DELETE_COUNT = 100

export function AppLogsPage({
  notify,
  onNavigate
}: {
  notify: (kind: 'success' | 'error' | 'info', message: string) => void
  onNavigate: (view: LogView) => void
}): React.JSX.Element {
  const { tr, formatDate, language } = useI18n()
  const [logs, setLogs] = useState<AppLogEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const {
    searchInput,
    search,
    searchRef,
    setSearchInput,
    clearSearch
  } = useCollectionSearch(language)
  const [dateRange, setDateRange] = useState(emptyLogDateRange)
  const [level, setLevel] = useState<AppLogLevelFilter>('all')
  const [category, setCategory] = useState('all')
  const [pageSize, setPageSize] = useState<LogPageSize>(20)
  const [page, setPage] = useState(1)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set())
  const [expandedIds, setExpandedIds] = useState<Set<string>>(() => new Set())
  const [moreOpen, setMoreOpen] = useState(false)
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false)
  const [confirmClearOpen, setConfirmClearOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [clearing, setClearing] = useState(false)
  const selectAllRef = useRef<HTMLInputElement>(null)
  const logTableRef = useRef<HTMLDivElement>(null)
  const logColumns = useMemo<TableColumnDefinition<AppLogColumnKey>[]>(
    () => [
      {
        key: 'level',
        label: tr('级别', 'Level', '層級'),
        track: 'minmax(88px, 0.55fr)',
        defaultWidth: 88,
        minWidth: 82
      },
      {
        key: 'category',
        label: tr('分类', 'Category', '分類'),
        track: 'minmax(88px, 0.65fr)',
        defaultWidth: 108,
        minWidth: 72
      },
      {
        key: 'details',
        label: tr('说明', 'Details', '說明'),
        track: 'minmax(220px, 2fr)',
        defaultWidth: 360,
        minWidth: 140
      },
      {
        key: 'time',
        label: tr('时间', 'Time', '時間'),
        track: '132px',
        defaultWidth: 132,
        minWidth: 104
      }
    ],
    [tr]
  )

  useEffect(() => {
    void load()
  }, [])

  const categoryOptions = useMemo(
    () =>
      [...new Set(logs.map((entry) => entry.category).filter(Boolean))].sort(
        (left, right) =>
          appLogCategoryLabel(left, tr).localeCompare(appLogCategoryLabel(right, tr))
      ),
    [logs, tr]
  )

  const filtered = useMemo(
    () =>
      logs.filter((entry) => {
        if (search) {
          const haystack = [
            entry.message,
            entry.details ?? '',
            entry.category,
            appLogCategoryLabel(entry.category, tr)
          ]
            .join(' ')
            .toLocaleLowerCase()
          if (!haystack.includes(search)) return false
        }
        if (!matchesLogDateRange(entry.timestamp, dateRange)) return false
        if (level !== 'all' && entry.level !== level) return false
        if (category !== 'all' && entry.category !== category) return false
        return true
      }),
    [category, dateRange, level, logs, search, tr]
  )

  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize))
  const currentPage = Math.min(page, pageCount)
  const visible = filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize)
  const tableColumns = useResizableColumns({
    storageKey: 'autologin.appLogs.columns.v2',
    columns: logColumns,
    tableRef: logTableRef,
    headerSelector: '.app-log-table__header',
    rowSelector: '.app-log-row',
    measureKey: visible.map((entry) => entry.id).join('|'),
    menuLabel: tr('软件日志显示列', 'App log columns', '軟體日誌顯示欄位')
  })
  const visibleSelectedCount = visible.filter((entry) => selectedIds.has(entry.id)).length
  const allPageSelected = visible.length > 0 && visibleSelectedCount === visible.length
  const somePageSelected = visibleSelectedCount > 0 && !allPageSelected

  useEffect(() => {
    setPage(1)
  }, [category, dateRange, level, pageSize, search])

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
    setExpandedIds((current) => {
      const next = new Set([...current].filter((id) => available.has(id)))
      return next.size === current.size ? current : next
    })
  }, [logs])

  async function load(): Promise<void> {
    setLoading(true)
    setLoadError('')
    try {
      setLogs(await window.autologin.app.listAppLogs(500))
    } catch (error) {
      setLoadError(
        error instanceof Error ? error.message : tr('读取软件日志失败', 'Could not read app logs.', '讀取軟體日誌失敗')
      )
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
      setExpandedIds(new Set())
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

  function columnLabel(key: AppLogColumnKey): string {
    return logColumns.find((column) => column.key === key)?.label ?? key
  }

  function renderHeaderCell(key: AppLogColumnKey): React.JSX.Element {
    const label = columnLabel(key)
    return (
      <span data-column-key={key} key={key}>
        {label}
        {tableColumns.renderResizer(key, label)}
      </span>
    )
  }

  function renderBodyCell(entry: AppLogEntry, key: AppLogColumnKey): ReactNode {
    if (key === 'level') {
      return (
        <span data-column-key={key} key={key}>
          <span className={`app-log-level is-${entry.level}`}>
            {entry.level === 'error' ? (
              <CircleX size={12} />
            ) : entry.level === 'success' ? (
              <CircleCheck size={12} />
            ) : null}
            {appLogLevelLabel(entry.level, tr)}
          </span>
        </span>
      )
    }
    if (key === 'category') {
      return (
        <span className="app-log-category" data-column-key={key} key={key}>
          {appLogCategoryLabel(entry.category, tr)}
        </span>
      )
    }
    if (key === 'details') {
      const expanded = expandedIds.has(entry.id)
      return (
        <div className="app-log-row__content" data-column-key={key} key={key}>
          <div className="app-log-row__summary">
            <strong title={entry.message}>{entry.message}</strong>
            {entry.details ? (
              <button
                type="button"
                className="app-log-row__expand"
                aria-expanded={expanded}
                aria-label={
                  expanded
                    ? tr('收起日志详情', 'Collapse log details', '收合日誌詳情')
                    : tr('展开日志详情', 'Expand log details', '展開日誌詳情')
                }
                title={
                  expanded
                    ? tr('收起日志详情', 'Collapse log details', '收合日誌詳情')
                    : tr('展开日志详情', 'Expand log details', '展開日誌詳情')
                }
                onClick={() =>
                  setExpandedIds((current) => {
                    const next = new Set(current)
                    if (next.has(entry.id)) next.delete(entry.id)
                    else next.add(entry.id)
                    return next
                  })
                }
              >
                {expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
              </button>
            ) : null}
          </div>
          {expanded && entry.details ? <p>{entry.details}</p> : null}
        </div>
      )
    }
    return (
      <time data-column-key={key} key={key} dateTime={entry.timestamp}>
        {formatDate(entry.timestamp, {
          month: '2-digit',
          day: '2-digit',
          hour: '2-digit',
          minute: '2-digit'
        })}
      </time>
    )
  }

  return (
    <>
      <section className="page-section logs-page app-logs-page">
        <CollectionPageHeader
          title={tr('软件日志', 'App logs', '軟體日誌')}
          actions={
            <>
              <button
                className={`button button--ghost button--small${
                  loading ? ' is-loading' : ''
                }`}
                onClick={() => void load()}
                disabled={loading}
                aria-busy={loading}
              >
                {loading ? <LoaderCircle size={15} className="spin" /> : <RefreshCw size={15} />}
                {tr('刷新', 'Refresh', '重新整理')}
              </button>
              <PageActionMenu
                open={moreOpen}
                onOpenChange={setMoreOpen}
                label={tr('更多软件日志操作', 'More app log actions', '更多軟體日誌操作')}
              >
                <button
                  type="button"
                  role="menuitem"
                  className="is-danger"
                  disabled={logs.length === 0 || loading}
                  onClick={() => {
                    setMoreOpen(false)
                    setConfirmClearOpen(true)
                  }}
                >
                  <Trash2 size={15} />
                  <span>{tr('清除全部', 'Clear all', '清除全部')}</span>
                </button>
              </PageActionMenu>
            </>
          }
          tabs={<LogsTabs active="appLogs" onChange={onNavigate} />}
          filters={
            <div className="collection-filter-bar">
              <CollectionSearchField
                searchRef={searchRef}
                value={searchInput}
                onChange={setSearchInput}
                onClear={clearSearch}
                placeholder={tr(
                  '搜索消息、详情或 URL',
                  'Search messages, details or URLs',
                  '搜尋訊息、詳情或 URL'
                )}
                ariaLabel={tr('搜索软件日志', 'Search app logs', '搜尋軟體日誌')}
              />
              <LogDateFilter
                value={dateRange}
                onChange={setDateRange}
              />
              <CollectionFilterSelect
                value={level}
                onChange={(next) => setLevel(next as AppLogLevelFilter)}
                ariaLabel={tr('级别', 'Level', '層級')}
                options={[
                  {
                    value: 'all',
                    label: tr('全部级别', 'All levels', '全部層級')
                  },
                  { value: 'info', label: tr('信息', 'Info', '資訊') },
                  { value: 'success', label: tr('成功', 'Success', '成功') },
                  { value: 'warning', label: tr('警告', 'Warning', '警告') },
                  { value: 'error', label: tr('错误', 'Error', '錯誤') }
                ]}
              />
              <CollectionFilterSelect
                value={category}
                onChange={setCategory}
                ariaLabel={tr('分类', 'Category', '分類')}
                options={[
                  {
                    value: 'all',
                    label: tr('全部分类', 'All categories', '全部分類')
                  },
                  ...categoryOptions.map((value) => ({
                    value,
                    label: appLogCategoryLabel(value, tr)
                  }))
                ]}
              />
              <button
                type="button"
                className="collection-filter-reset"
                onClick={() => {
                  clearSearch()
                  setDateRange(emptyLogDateRange())
                  setLevel('all')
                  setCategory('all')
                }}
              >
                <RotateCcw size={14} />
                {tr('重置', 'Reset', '重設')}
              </button>
            </div>
          }
        />

        {selectedIds.size > 0 && (
          <div
            className="selection-dock selection-dock--page"
            role="toolbar"
            aria-label={tr('日志批量操作', 'Log batch actions', '日誌批次操作')}
          >
            <span className="selection-dock__count">
              {tr(
                `已选 ${selectedIds.size} 项`,
                `${selectedIds.size} selected`,
                `已選 ${selectedIds.size} 項`
              )}
            </span>
            <button
              type="button"
              className="selection-dock__primary"
              onClick={() => setConfirmDeleteOpen(true)}
              disabled={deleting}
            >
              <Trash2 size={15} />
              {tr('批量删除', 'Delete selected', '批次刪除')}
            </button>
            <button
              type="button"
              className="selection-dock__cancel"
              onClick={() => setSelectedIds(new Set())}
            >
              {tr('取消', 'Cancel', '取消')}
            </button>
          </div>
        )}

        <div className="log-table-wrap">
          {loading ? (
            <div className="logs-empty">
              <LoaderCircle size={22} className="spin" />
              <span>{tr('正在读取软件日志', 'Reading app logs', '正在讀取軟體日誌')}</span>
            </div>
          ) : loadError ? (
            <div className="logs-empty">
              <TriangleAlert size={24} />
              <strong>{tr('读取日志失败', 'Could not read logs', '讀取日誌失敗')}</strong>
              <span>{loadError}</span>
              <button className="button button--soft" onClick={() => void load()}>
                <RefreshCw size={15} />
                {tr('重试', 'Retry', '重試')}
              </button>
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
            <div
              className="app-log-table"
              role="table"
              aria-label={tr('软件日志列表', 'App log list', '軟體日誌列表')}
              ref={logTableRef}
            >
              <div
                className="app-log-table__header app-log-table__grid"
                role="row"
                style={{ gridTemplateColumns: tableColumns.gridTemplateColumns }}
                onContextMenu={tableColumns.openMenu}
              >
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
                {tableColumns.visibleOrderedColumns.map(renderHeaderCell)}
              </div>
              {visible.map((entry) => (
                <article
                  className={`app-log-row app-log-table__grid${
                    selectedIds.has(entry.id) ? ' is-selected' : ''
                  }${expandedIds.has(entry.id) ? ' is-expanded' : ''}`}
                  role="row"
                  key={entry.id}
                  style={{ gridTemplateColumns: tableColumns.gridTemplateColumns }}
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
                  {tableColumns.visibleOrderedColumns.map((key) =>
                    renderBodyCell(entry, key)
                  )}
                </article>
              ))}
            </div>
          )}
          {tableColumns.menu}

          <LogPagination
            count={filtered.length}
            page={currentPage}
            pageCount={pageCount}
            pageSize={pageSize}
            onPageChange={setPage}
            onPageSizeChange={setPageSize}
          />
        </div>
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
    visit: ['书签访问', 'Bookmark visit', '書籤存取'],
    update: ['应用更新', 'App update', '應用程式更新'],
    backup: ['备份', 'Backup', '備份'],
    data: ['数据操作', 'Data', '資料操作'],
    settings: ['设置', 'Settings', '設定'],
    error: ['软件错误', 'Application error', '軟體錯誤']
  }
  const label = labels[category]
  return label ? tr(label[0], label[1], label[2]) : category
}
