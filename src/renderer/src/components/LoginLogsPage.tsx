import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  Check,
  CircleCheck,
  CircleX,
  Clock3,
  Eye,
  FileText,
  Hand,
  LoaderCircle,
  RefreshCw,
  RotateCcw,
  SearchX,
  Settings,
  TriangleAlert,
  Trash2
} from 'lucide-react'
import type {
  LoginLogEntry,
  Site
} from '@shared/types'
import { useI18n } from '../i18n'
import {
  LogPagination,
  type LogPageSize
} from './LogPagination'
import { LogsTabs, type LogView } from './LogsTabs'
import { CollectionPageHeader } from './CollectionPageHeader'
import { ConfirmDialog, Modal } from './Modal'
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

type LogStatusFilter = 'all' | LoginLogEntry['status']
type LoginLogColumnKey =
  | 'status'
  | 'identity'
  | 'group'
  | 'details'
  | 'time'
  | 'action'

const MAX_DELETE_COUNT = 100

export function LoginLogsPage({
  sites,
  notify,
  onNavigate
}: {
  sites: Site[]
  notify: (kind: 'success' | 'error' | 'info', message: string) => void
  onNavigate: (view: LogView) => void
}): React.JSX.Element {
  const { tr, formatDate, language } = useI18n()
  const [entries, setEntries] = useState<LoginLogEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [openingRawLog, setOpeningRawLog] = useState(false)
  const {
    searchInput,
    search,
    searchRef,
    setSearchInput,
    clearSearch
  } = useCollectionSearch(language)
  const [dateRange, setDateRange] = useState(emptyLogDateRange)
  const [siteId, setSiteId] = useState('all')
  const [status, setStatus] = useState<LogStatusFilter>('all')
  const [moreOpen, setMoreOpen] = useState(false)
  const [pageSize, setPageSize] = useState<LogPageSize>(20)
  const [page, setPage] = useState(1)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set())
  const [detailEntry, setDetailEntry] = useState<LoginLogEntry | null>(null)
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const selectAllRef = useRef<HTMLInputElement>(null)
  const logTableRef = useRef<HTMLDivElement>(null)
  const logColumns = useMemo<TableColumnDefinition<LoginLogColumnKey>[]>(
    () => [
      {
        key: 'status',
        label: tr('状态', 'Status', '狀態'),
        track: 'minmax(92px, 0.65fr)',
        defaultWidth: 96,
        minWidth: 86
      },
      {
        key: 'identity',
        label: tr('站点 / 账号', 'Site / Account', '站點 / 帳號'),
        track: 'minmax(180px, 1.45fr)',
        defaultWidth: 220,
        minWidth: 150
      },
      {
        key: 'group',
        label: tr('分组', 'Group', '分組'),
        track: 'minmax(70px, 0.62fr)',
        defaultWidth: 90,
        minWidth: 60
      },
      {
        key: 'details',
        label: tr('说明', 'Details', '說明'),
        track: 'minmax(160px, 1.45fr)',
        defaultWidth: 220,
        minWidth: 120
      },
      {
        key: 'time',
        label: tr('时间', 'Time', '時間'),
        track: '112px',
        defaultWidth: 112,
        minWidth: 90
      },
      {
        key: 'action',
        label: tr('操作', 'Action', '操作'),
        track: '44px',
        defaultWidth: 44,
        minWidth: 40,
        hideable: false
      }
    ],
    [tr]
  )

  async function load(): Promise<void> {
    setLoading(true)
    setLoadError('')
    try {
      setEntries(await window.autologin.app.listLoginLogs())
    } catch (error) {
      setLoadError(
        error instanceof Error ? error.message : tr('读取登录日志失败', 'Could not read login logs.', '讀取登入日誌失敗')
      )
      notify(
        'error',
        error instanceof Error
          ? error.message
          : tr('读取登录日志失败', 'Could not read login logs.', '讀取登入日誌失敗')
      )
    } finally {
      setLoading(false)
    }
  }

  async function openRawLog(): Promise<void> {
    if (openingRawLog) return
    setOpeningRawLog(true)
    try {
      await window.autologin.app.openFailureLog()
      notify('success', tr('已打开原始日志', 'Raw log opened.', '已開啟原始日誌'))
    } catch (error) {
      notify(
        'error',
        error instanceof Error
          ? error.message
          : tr('无法打开原始日志', 'Could not open the raw log.', '無法開啟原始日誌')
      )
    } finally {
      setOpeningRawLog(false)
    }
  }

  useEffect(() => {
    void load()
  }, [])

  const siteOptions = useMemo(
    () =>
      [...sites].sort((left, right) =>
        left.name.localeCompare(right.name, language)
      ),
    [language, sites]
  )

  const selectedSite = sites.find((site) => site.id === siteId)
  const normalizedSearch = search.trim().toLocaleLowerCase(language)
  const filtered = useMemo(
    () =>
      entries.filter((entry) => {
        if (normalizedSearch) {
          const haystack = [
            entry.siteName,
            entry.accountLabel,
            entry.groupName,
            entry.reason
          ]
            .join(' ')
            .toLocaleLowerCase(language)
          if (!haystack.includes(normalizedSearch)) return false
        }
        if (!matchesLogDateRange(entry.timestamp, dateRange)) return false
        if (
          selectedSite &&
          entry.siteId !== selectedSite.id &&
          entry.siteName !== selectedSite.name
        ) {
          return false
        }
        if (status !== 'all' && entry.status !== status) return false
        return true
      }),
    [dateRange, entries, language, normalizedSearch, selectedSite, status]
  )

  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize))
  const currentPage = Math.min(page, pageCount)
  const visible = filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize)
  const tableColumns = useResizableColumns({
    storageKey: 'autologin.loginLogs.columns.v2',
    columns: logColumns,
    tableRef: logTableRef,
    headerSelector: '.log-table__header',
    rowSelector: '.log-table__row',
    measureKey: visible.map((entry) => entry.id).join('|'),
    menuLabel: tr('登录日志显示列', 'Login log columns', '登入日誌顯示欄位')
  })
  const lastHeaderKey = tableColumns.visibleOrderedColumns[tableColumns.visibleOrderedColumns.length - 1]
  const visibleSelectedCount = visible.filter((entry) => selectedIds.has(entry.id)).length
  const allPageSelected = visible.length > 0 && visibleSelectedCount === visible.length
  const somePageSelected = visibleSelectedCount > 0 && !allPageSelected

  useEffect(() => {
    setPage(1)
  }, [dateRange, pageSize, search, siteId, status])

  useEffect(() => {
    if (!selectAllRef.current) return
    selectAllRef.current.indeterminate = somePageSelected
  }, [somePageSelected])

  useEffect(() => {
    const available = new Set(entries.map((entry) => entry.id))
    setSelectedIds((current) => {
      const next = new Set([...current].filter((id) => available.has(id)))
      return next.size === current.size ? current : next
    })
  }, [entries])

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
    const toSelect = visible.filter((entry) => !selectedIds.has(entry.id))
    const limited = toSelect.slice(0, remaining)
    setSelectedIds((current) => {
      const next = new Set(current)
      for (const entry of limited) next.add(entry.id)
      return next
    })
    if (limited.length < toSelect.length) {
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
      if (next.has(entryId)) {
        next.delete(entryId)
        return next
      }
      if (next.size >= MAX_DELETE_COUNT) {
        notify(
          'info',
          tr(
            `单次最多删除 ${MAX_DELETE_COUNT} 条日志`,
            `You can delete up to ${MAX_DELETE_COUNT} logs at once.`,
            `單次最多刪除 ${MAX_DELETE_COUNT} 筆日誌`
          )
        )
        return current
      }
      next.add(entryId)
      return next
    })
  }

  async function deleteSelected(): Promise<void> {
    if (selectedIds.size === 0) return
    setDeleting(true)
    try {
      const result = await window.autologin.app.deleteLoginLogs([...selectedIds])
      setConfirmDeleteOpen(false)
      setSelectedIds(new Set())
      await load()
      notify(
        'success',
        tr(
          `已删除 ${result.deleted} 条日志`,
          `Deleted ${result.deleted} log${result.deleted === 1 ? '' : 's'}.`,
          `已刪除 ${result.deleted} 筆日誌`
        )
      )
    } catch (error) {
      notify(
        'error',
        error instanceof Error
          ? error.message
          : tr('删除日志失败', 'Could not delete logs.', '刪除日誌失敗')
      )
    } finally {
      setDeleting(false)
    }
  }

  function columnLabel(key: LoginLogColumnKey): string {
    return logColumns.find((column) => column.key === key)?.label ?? key
  }

  function renderHeaderCell(key: LoginLogColumnKey): React.JSX.Element {
    const label = columnLabel(key)
    return (
      <span data-column-key={key} key={key}>
        {label}
        {key === lastHeaderKey && (
          <button
            type="button"
            className="table-column-settings"
            onClick={tableColumns.openMenuFromButton}
            aria-label={tr('列设置', 'Column settings', '欄位設定')}
            title={tr(
              '列设置（也可右键表头）',
              'Column settings (or right-click the header)',
              '欄位設定（也可右鍵表頭）'
            )}
          >
            <Settings size={13} />
          </button>
        )}
        {tableColumns.renderResizer(key, label)}
      </span>
    )
  }

  function renderBodyCell(entry: LoginLogEntry, key: LoginLogColumnKey): ReactNode {
    if (key === 'status') {
      return (
        <span data-column-key={key} key={key}>
          <span className={`log-status is-${entry.status}`}>
            <LoginStatusIcon status={entry.status} />
            {statusLabel(entry.status, tr)}
          </span>
        </span>
      )
    }
    if (key === 'identity') {
      return (
        <div className="log-identity-cell" data-column-key={key} key={key}>
          <strong title={entry.siteName}>{entry.siteName}</strong>
          <span title={entry.accountLabel}>{entry.accountLabel}</span>
        </div>
      )
    }
    if (key === 'group') {
      return (
        <span data-column-key={key} key={key}>
          {displayGroup(entry.groupName, tr)}
        </span>
      )
    }
    if (key === 'details') {
      return (
        <p data-column-key={key} key={key} title={entry.reason}>
          {entry.reason}
        </p>
      )
    }
    if (key === 'time') {
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
      <span className="log-action-cell" data-column-key={key} key={key}>
        <button
          type="button"
          className="button button--ghost button--small button--icon-only"
          onClick={() => setDetailEntry(entry)}
          aria-label={tr('查看详情', 'View details', '查看詳情')}
          title={tr('查看详情', 'View details', '查看詳情')}
        >
          <Eye size={14} />
        </button>
      </span>
    )
  }

  return (
    <>
      <section className="page-section logs-page">
        <CollectionPageHeader
          title={tr('登录日志', 'Login history', '登入日誌')}
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
                label={tr('更多登录日志操作', 'More login log actions', '更多登入日誌操作')}
              >
                <button
                  type="button"
                  role="menuitem"
                  disabled={openingRawLog}
                  onClick={() => {
                    setMoreOpen(false)
                    void openRawLog()
                  }}
                >
                  {openingRawLog ? (
                    <LoaderCircle size={15} className="spin" />
                  ) : (
                    <FileText size={15} />
                  )}
                  <span>
                    {openingRawLog
                      ? tr('打开中…', 'Opening…', '開啟中…')
                      : tr('打开原始日志', 'Open raw log', '開啟原始日誌')}
                  </span>
                </button>
              </PageActionMenu>
            </>
          }
          tabs={<LogsTabs active="loginLogs" onChange={onNavigate} />}
          filters={
            <div className="collection-filter-bar">
              <CollectionSearchField
                searchRef={searchRef}
                value={searchInput}
                onChange={setSearchInput}
                onClear={clearSearch}
                placeholder={tr(
                  '搜索站点、账号或分组',
                  'Search site, account or group',
                  '搜尋站點、帳號或分組'
                )}
                ariaLabel={tr('搜索登录日志', 'Search login history', '搜尋登入日誌')}
              />
              <LogDateFilter
                value={dateRange}
                onChange={setDateRange}
              />
              <CollectionFilterSelect
                value={siteId}
                onChange={setSiteId}
                ariaLabel={tr('站点名称', 'Site', '站點名稱')}
                searchable
                searchPlaceholder={tr('搜索站点', 'Search sites', '搜尋站點')}
                options={[
                  {
                    value: 'all',
                    label: tr('全部站点', 'All sites', '全部站點')
                  },
                  ...siteOptions.map((site) => ({
                    value: site.id,
                    label: site.name
                  }))
                ]}
              />
              <CollectionFilterSelect
                value={status}
                onChange={(next) => setStatus(next as LogStatusFilter)}
                ariaLabel={tr('状态', 'Status', '狀態')}
                options={[
                  {
                    value: 'all',
                    label: tr('全部状态', 'All statuses', '全部狀態')
                  },
                  { value: 'success', label: tr('成功', 'Success', '成功') },
                  { value: 'error', label: tr('失败', 'Failed', '失敗') },
                  { value: 'timeout', label: tr('超时', 'Timed out', '逾時') },
                  {
                    value: 'manual',
                    label: tr('待人工处理', 'Manual action', '待人工處理')
                  }
                ]}
              />
              <button
                type="button"
                className="collection-filter-reset"
                onClick={() => {
                  clearSearch()
                  setDateRange(emptyLogDateRange())
                  setSiteId('all')
                  setStatus('all')
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
              <span>{tr('正在读取本地日志', 'Reading local logs', '正在讀取本機日誌')}</span>
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
                  '调整筛选条件或等待下一次登录记录。',
                  'Adjust the filters or wait for the next login.',
                  '調整篩選條件或等待下一次登入記錄。'
                )}
              </span>
            </div>
          ) : (
            <div
              className="log-table"
              role="table"
              aria-label={tr('登录日志列表', 'Login log list', '登入日誌列表')}
              ref={logTableRef}
            >
              <div
                className="log-table__header log-table__grid"
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
                  className={`log-table__row log-table__grid${
                    selectedIds.has(entry.id) ? ' is-selected' : ''
                  }`}
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
                        `选择 ${entry.siteName} 的日志`,
                        `Select log for ${entry.siteName}`,
                        `選取 ${entry.siteName} 的日誌`
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
          title={tr('删除选中的登录日志？', 'Delete selected login logs?', '刪除選取的登入日誌？')}
          description={tr(
            `将永久删除 ${selectedIds.size} 条本地日志，保险库账号和网站会话不会受到影响。`,
            `${selectedIds.size} local logs will be permanently deleted. Vault accounts and website sessions are unaffected.`,
            `將永久刪除 ${selectedIds.size} 筆本機日誌，保險庫帳號和網站工作階段不會受到影響。`
          )}
          confirmLabel={tr('确认删除', 'Delete logs', '確認刪除')}
          danger
          busy={deleting}
          onConfirm={() => void deleteSelected()}
          onClose={() => setConfirmDeleteOpen(false)}
        />
      )}

      {detailEntry && (
        <Modal
          title={tr('日志详情', 'Log details', '日誌詳情')}
          eyebrow={tr('本地登录记录', 'LOCAL LOGIN RECORD', '本機登入記錄')}
          onClose={() => setDetailEntry(null)}
          width="620px"
          className="log-detail-modal"
        >
          <div className="log-detail-body">
            <div className="log-detail-summary">
              <span className={`log-status is-${detailEntry.status}`}>
                {statusLabel(detailEntry.status, tr)}
              </span>
              <strong>{detailEntry.siteName}</strong>
            </div>
            <dl className="log-detail-grid">
              <div>
                <dt>{tr('站点', 'Site', '站點')}</dt>
                <dd>{detailEntry.siteName}</dd>
              </div>
              <div>
                <dt>{tr('分组', 'Group', '分組')}</dt>
                <dd>{displayGroup(detailEntry.groupName, tr)}</dd>
              </div>
              <div>
                <dt>{tr('账号', 'Account', '帳號')}</dt>
                <dd>{detailEntry.accountLabel}</dd>
              </div>
              <div>
                <dt>{tr('时间', 'Time', '時間')}</dt>
                <dd>{formatDate(detailEntry.timestamp, { dateStyle: 'medium', timeStyle: 'medium' })}</dd>
              </div>
              <div>
                <dt>{tr('任务标识', 'Batch ID', '任務識別碼')}</dt>
                <dd><code>{detailEntry.batchId || '—'}</code></dd>
              </div>
            </dl>
            <div className="log-detail-reason">
              <strong>{tr('完整错误说明', 'Full explanation', '完整錯誤說明')}</strong>
              <p>{detailEntry.reason}</p>
            </div>
            <p className="modal-description log-detail-redaction">
              {tr(
                '日志已在写入时脱敏，不包含密码、Cookie、验证码或带查询参数的完整 URL。',
                'Logs are redacted at write time and never include passwords, cookies, verification codes or full URLs with query parameters.',
                '日誌已在寫入時去識別化，不包含密碼、Cookie、驗證碼或帶查詢參數的完整網址。'
              )}
            </p>
          </div>
        </Modal>
      )}
    </>
  )
}

function statusLabel(
  status: LoginLogEntry['status'],
  tr: (zhCN: string, en: string, zhTW: string) => string
): string {
  if (status === 'success') return tr('成功', 'Success', '成功')
  if (status === 'timeout') return tr('超时', 'Timed out', '逾時')
  if (status === 'manual') return tr('待人工', 'Manual', '待人工')
  return tr('失败', 'Failed', '失敗')
}

function LoginStatusIcon({
  status
}: {
  status: LoginLogEntry['status']
}): React.JSX.Element {
  if (status === 'success') return <CircleCheck size={12} />
  if (status === 'timeout') return <Clock3 size={12} />
  if (status === 'manual') return <Hand size={12} />
  return <CircleX size={12} />
}

function displayGroup(
  value: string,
  tr: (zhCN: string, en: string, zhTW: string) => string
): string {
  return value.trim() || tr('未分组', 'Ungrouped', '未分組')
}
