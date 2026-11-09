import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Check,
  ChevronRight,
  Eye,
  FileText,
  LoaderCircle,
  RefreshCw,
  SearchX,
  TriangleAlert,
  Trash2
} from 'lucide-react'
import type {
  AccountWithSite,
  GroupDefinition,
  LoginLogEntry,
  Site
} from '@shared/types'
import { useI18n } from '../i18n'
import {
  LogPagination,
  type LogPageSize
} from './LogPagination'
import { LogsTabs, type LogView } from './LogsTabs'
import { ConfirmDialog, Modal } from './Modal'

type LogStatusFilter = 'all' | LoginLogEntry['status']

const MAX_DELETE_COUNT = 100

export function LoginLogsPage({
  sites,
  accounts,
  groups,
  notify,
  onNavigate
}: {
  sites: Site[]
  accounts: AccountWithSite[]
  groups: GroupDefinition[]
  notify: (kind: 'success' | 'error' | 'info', message: string) => void
  onNavigate: (view: LogView) => void
}): React.JSX.Element {
  const { tr, formatDate, language } = useI18n()
  const [entries, setEntries] = useState<LoginLogEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [openingRawLog, setOpeningRawLog] = useState(false)
  const [date, setDate] = useState('')
  const [siteId, setSiteId] = useState('all')
  const [groupName, setGroupName] = useState('all')
  const [status, setStatus] = useState<LogStatusFilter>('all')
  const [pageSize, setPageSize] = useState<LogPageSize>(20)
  const [page, setPage] = useState(1)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set())
  const [detailEntry, setDetailEntry] = useState<LoginLogEntry | null>(null)
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const selectAllRef = useRef<HTMLInputElement>(null)

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

  const groupOptions = useMemo(() => {
    const names = new Set<string>()
    for (const group of groups) {
      if (group.path.trim()) names.add(group.path.trim())
    }
    for (const site of sites) {
      if (site.group?.trim()) names.add(site.group.trim())
    }
    for (const account of accounts) {
      if (account.site.group?.trim()) names.add(account.site.group.trim())
    }
    return [...names].sort((left, right) => left.localeCompare(right, language))
  }, [accounts, groups, language, sites])

  const selectedSite = sites.find((site) => site.id === siteId)
  const filtered = useMemo(
    () =>
      entries.filter((entry) => {
        if (date && localDateKey(entry.timestamp) !== date) return false
        if (
          selectedSite &&
          entry.siteId !== selectedSite.id &&
          entry.siteName !== selectedSite.name
        ) {
          return false
        }
        if (groupName !== 'all' && entry.groupName !== groupName) return false
        if (status !== 'all' && entry.status !== status) return false
        return true
      }),
    [date, entries, groupName, selectedSite, status]
  )

  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize))
  const currentPage = Math.min(page, pageCount)
  const visible = filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize)
  const visibleSelectedCount = visible.filter((entry) => selectedIds.has(entry.id)).length
  const allPageSelected = visible.length > 0 && visibleSelectedCount === visible.length
  const somePageSelected = visibleSelectedCount > 0 && !allPageSelected

  useEffect(() => {
    setPage(1)
  }, [date, groupName, pageSize, siteId, status])

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

  return (
    <>
      <section className="page-section logs-page">
        <nav className="page-breadcrumb" aria-label={tr('面包屑', 'Breadcrumb', '麵包屑')}>
          <span>{tr('日志', 'Logs', '日誌')}</span>
          <ChevronRight size={12} />
          <h2>{tr('登录日志', 'Login history', '登入日誌')}</h2>
        </nav>

        <LogsTabs active="loginLogs" onChange={onNavigate} />

        <div className="log-filters log-filters--login">
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
            <span className="field__label">{tr('站点名称', 'Site', '站點名稱')}</span>
            <select
              className="filter-control"
              value={siteId}
              onChange={(event) => setSiteId(event.target.value)}
            >
              <option value="all">{tr('全部站点', 'All sites', '全部站點')}</option>
              {siteOptions.map((site) => (
                <option key={site.id} value={site.id}>
                  {site.name}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span className="field__label">{tr('分组', 'Group', '分組')}</span>
            <select
              className="filter-control"
              value={groupName}
              onChange={(event) => setGroupName(event.target.value)}
            >
              <option value="all">{tr('全部分组', 'All groups', '全部分組')}</option>
              {groupOptions.map((group) => (
                <option key={group} value={group}>
                  {group}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span className="field__label">{tr('状态', 'Status', '狀態')}</span>
            <select
              className="filter-control"
              value={status}
              onChange={(event) => setStatus(event.target.value as LogStatusFilter)}
            >
              <option value="all">{tr('全部状态', 'All statuses', '全部狀態')}</option>
              <option value="success">{tr('成功', 'Success', '成功')}</option>
              <option value="error">{tr('失败', 'Failed', '失敗')}</option>
              <option value="timeout">{tr('超时', 'Timed out', '逾時')}</option>
              <option value="manual">{tr('待人工处理', 'Manual action', '待人工處理')}</option>
            </select>
          </label>
          <div className="log-filters__actions">
            <button className="button button--soft" onClick={() => void load()} disabled={loading}>
              {loading ? <LoaderCircle size={15} className="spin" /> : <RefreshCw size={15} />}
              {tr('刷新', 'Refresh', '重新整理')}
            </button>
            <button
              className="button button--ghost"
              onClick={() => void openRawLog()}
              disabled={openingRawLog}
              aria-busy={openingRawLog}
            >
              {openingRawLog ? (
                <LoaderCircle size={15} className="spin" />
              ) : (
                <FileText size={15} />
              )}
              {openingRawLog
                ? tr('打开中…', 'Opening…', '開啟中…')
                : tr('打开原始日志', 'Open raw log', '開啟原始日誌')}
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
            <span>{tr('调整筛选条件或等待下一次登录记录。', 'Adjust the filters or wait for the next login.', '調整篩選條件或等待下一次登入記錄。')}</span>
          </div>
        ) : (
          <div className="log-table-wrap">
            <div
              className="log-table"
              role="table"
              aria-label={tr('登录日志列表', 'Login log list', '登入日誌列表')}
            >
              <div className="log-table__header log-table__grid" role="row">
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
                <span>{tr('账号', 'Account', '帳號')}</span>
                <span>{tr('站点', 'Site', '站點')}</span>
                <span>{tr('分组', 'Group', '分組')}</span>
                <span>{tr('说明', 'Details', '說明')}</span>
                <span>{tr('时间', 'Time', '時間')}</span>
                <span>{tr('操作', 'Action', '操作')}</span>
              </div>
              {visible.map((entry) => (
                <article
                  className={`log-table__row log-table__grid${
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
                        `选择 ${entry.siteName} 的日志`,
                        `Select log for ${entry.siteName}`,
                        `選取 ${entry.siteName} 的日誌`
                      )}
                    />
                    <span aria-hidden="true">
                      <Check size={12} />
                    </span>
                  </label>
                  <span className={`log-status is-${entry.status}`}>{statusLabel(entry.status, tr)}</span>
                  <strong>{entry.accountLabel}</strong>
                  <span>{entry.siteName}</span>
                  <span>{displayGroup(entry.groupName, tr)}</span>
                  <p>{entry.reason}</p>
                  <time dateTime={entry.timestamp}>
                    {formatDate(entry.timestamp, {
                      month: '2-digit',
                      day: '2-digit',
                      hour: '2-digit',
                      minute: '2-digit',
                      second: '2-digit'
                    })}
                  </time>
                  <button className="text-button" onClick={() => setDetailEntry(entry)}>
                    <Eye size={14} />
                    {tr('查看详情', 'View details', '查看詳情')}
                  </button>
                </article>
              ))}
            </div>

            <LogPagination
              count={filtered.length}
              page={currentPage}
              pageCount={pageCount}
              pageSize={pageSize}
              onPageChange={setPage}
              onPageSizeChange={setPageSize}
            />
          </div>
        )}
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

function localDateKey(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
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

function displayGroup(
  value: string,
  tr: (zhCN: string, en: string, zhTW: string) => string
): string {
  return value.trim() || tr('未分组', 'Ungrouped', '未分組')
}
