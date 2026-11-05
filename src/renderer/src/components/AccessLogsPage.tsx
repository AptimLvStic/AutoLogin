import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Check,
  ChevronRight,
  Eye,
  Globe2,
  LoaderCircle,
  RefreshCw,
  SearchX,
  Trash2
} from 'lucide-react'
import type {
  AccessLogEntry,
  AccountWithSite,
  GroupDefinition,
  Site
} from '@shared/types'
import { useI18n } from '../i18n'
import {
  LogPagination,
  type LogPageSize
} from './LogPagination'
import { LogsTabs, type LogView } from './LogsTabs'
import { ConfirmDialog, Modal } from './Modal'

type AccessStatusFilter = 'all' | AccessLogEntry['status']

const MAX_DELETE_COUNT = 100

export function AccessLogsPage({
  sites,
  accounts,
  notify,
  onNavigate
}: {
  sites: Site[]
  accounts: AccountWithSite[]
  notify: (kind: 'success' | 'error' | 'info', message: string) => void
  onNavigate: (view: LogView) => void
}): React.JSX.Element {
  const { tr, formatDate, language } = useI18n()
  const [entries, setEntries] = useState<AccessLogEntry[]>([])
  const [groupDefinitions, setGroupDefinitions] = useState<GroupDefinition[]>([])
  const [loading, setLoading] = useState(true)
  const [date, setDate] = useState('')
  const [siteId, setSiteId] = useState('all')
  const [groupName, setGroupName] = useState('all')
  const [status, setStatus] = useState<AccessStatusFilter>('all')
  const [pageSize, setPageSize] = useState<LogPageSize>(20)
  const [page, setPage] = useState(1)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set())
  const [detailEntry, setDetailEntry] = useState<AccessLogEntry | null>(null)
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const selectAllRef = useRef<HTMLInputElement>(null)

  async function load(): Promise<void> {
    setLoading(true)
    try {
      setEntries(await window.autologin.app.listAccessLogs())
    } catch (error) {
      notify(
        'error',
        error instanceof Error
          ? error.message
          : tr('读取访问日志失败', 'Could not read access logs.', '讀取存取日誌失敗')
      )
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [])

  useEffect(() => {
    const tabIds = [...new Set(sites.map((site) => site.tabId))]
    if (tabIds.length === 0) {
      setGroupDefinitions([])
      return
    }
    let cancelled = false
    void Promise.all(tabIds.map((tabId) => window.autologin.groups.list(tabId)))
      .then((values) => {
        if (!cancelled) setGroupDefinitions(values.flat())
      })
      .catch(() => {
        if (!cancelled) setGroupDefinitions([])
      })
    return () => {
      cancelled = true
    }
  }, [sites])

  const siteOptions = useMemo(() => {
    const values = new Map<string, string>()
    for (const site of sites) values.set(site.id, site.name)
    for (const entry of entries) {
      if (!values.has(entry.siteId)) values.set(entry.siteId, entry.siteName)
    }
    return [...values.entries()]
      .map(([id, name]) => ({ id, name }))
      .sort((left, right) => left.name.localeCompare(right.name, language))
  }, [entries, language, sites])

  const groupOptions = useMemo(() => {
    const names = new Set<string>()
    for (const group of groupDefinitions) {
      if (group.path.trim()) names.add(group.path.trim())
    }
    for (const site of sites) {
      if (site.group?.trim()) names.add(site.group.trim())
    }
    for (const account of accounts) {
      if (account.site.group?.trim()) names.add(account.site.group.trim())
    }
    for (const entry of entries) {
      if (entry.groupName.trim()) names.add(entry.groupName.trim())
    }
    return [...names].sort((left, right) => left.localeCompare(right, language))
  }, [accounts, entries, groupDefinitions, language, sites])

  const selectedSite = siteOptions.find((site) => site.id === siteId)
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
      const result = await window.autologin.app.deleteAccessLogs([...selectedIds])
      setConfirmDeleteOpen(false)
      setSelectedIds(new Set())
      await load()
      notify(
        'success',
        tr(
          `已删除 ${result.deleted} 条访问日志`,
          `Deleted ${result.deleted} access log entries.`,
          `已刪除 ${result.deleted} 筆存取日誌`
        )
      )
    } catch (error) {
      notify(
        'error',
        error instanceof Error
          ? error.message
          : tr('删除访问日志失败', 'Could not delete access logs.', '刪除存取日誌失敗')
      )
    } finally {
      setDeleting(false)
    }
  }

  return (
    <>
      <section className="page-section logs-page access-logs-page">
        <nav className="page-breadcrumb" aria-label={tr('面包屑', 'Breadcrumb', '麵包屑')}>
          <span>{tr('日志', 'Logs', '日誌')}</span>
          <ChevronRight size={12} />
          <h2>{tr('访问日志', 'Access history', '存取日誌')}</h2>
        </nav>

        <LogsTabs active="accessLogs" onChange={onNavigate} />

        <div className="log-filters log-filters--access">
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
              onChange={(event) => setStatus(event.target.value as AccessStatusFilter)}
            >
              <option value="all">{tr('全部状态', 'All statuses', '全部狀態')}</option>
              <option value="success">{tr('成功', 'Success', '成功')}</option>
              <option value="error">{tr('失败', 'Failed', '失敗')}</option>
            </select>
          </label>
          <div className="log-filters__actions">
            <button className="button button--soft" onClick={() => void load()} disabled={loading}>
              {loading ? <LoaderCircle size={15} className="spin" /> : <RefreshCw size={15} />}
              {tr('刷新', 'Refresh', '重新整理')}
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
            <span>{tr('正在读取访问日志', 'Reading access logs', '正在讀取存取日誌')}</span>
          </div>
        ) : visible.length === 0 ? (
          <div className="logs-empty">
            <SearchX size={24} />
            <strong>{tr('暂无数据', 'No data', '暫無資料')}</strong>
            <span>
              {tr(
                '调整筛选条件或从书签页访问站点后再查看。',
                'Adjust the filters or visit a bookmark to create a record.',
                '調整篩選條件或從書籤頁造訪站點後再查看。'
              )}
            </span>
          </div>
        ) : (
          <div className="log-table-wrap">
            <div
              className="access-log-table"
              role="table"
              aria-label={tr('访问日志列表', 'Access log list', '存取日誌列表')}
            >
              <div className="access-log-table__header access-log-table__grid" role="row">
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
                <span>{tr('站点', 'Site', '站點')}</span>
                <span>{tr('分组', 'Group', '分組')}</span>
                <span>{tr('访问地址', 'URL', '網址')}</span>
                <span>{tr('时间', 'Time', '時間')}</span>
                <span>{tr('操作', 'Action', '操作')}</span>
              </div>
              {visible.map((entry) => (
                <article
                  className={`access-log-table__row access-log-table__grid${
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
                        `选择 ${entry.siteName} 的访问日志`,
                        `Select access log for ${entry.siteName}`,
                        `選取 ${entry.siteName} 的存取日誌`
                      )}
                    />
                    <span aria-hidden="true">
                      <Check size={12} />
                    </span>
                  </label>
                  <span className={`log-status is-${entry.status}`}>
                    {entry.status === 'success'
                      ? tr('成功', 'Success', '成功')
                      : tr('失败', 'Failed', '失敗')}
                  </span>
                  <strong>{entry.siteName}</strong>
                  <span>{entry.groupName || tr('未分组', 'Ungrouped', '未分組')}</span>
                  <span className="access-log-url" title={entry.url}>
                    <Globe2 size={13} />
                    {entry.url}
                  </span>
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
          title={tr('删除选中的访问日志？', 'Delete selected access logs?', '刪除選取的存取日誌？')}
          description={tr(
            `将永久删除 ${selectedIds.size} 条本地访问日志，书签和网站会话不会受到影响。`,
            `${selectedIds.size} local access logs will be permanently deleted. Bookmarks and website sessions are unaffected.`,
            `將永久刪除 ${selectedIds.size} 筆本機存取日誌，書籤和網站工作階段不會受到影響。`
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
          title={tr('访问详情', 'Access details', '存取詳情')}
          eyebrow={tr('本地访问记录', 'LOCAL ACCESS RECORD', '本機存取記錄')}
          onClose={() => setDetailEntry(null)}
          width="620px"
          className="log-detail-modal"
        >
          <div className="log-detail-body">
            <div className="log-detail-summary">
              <span className={`log-status is-${detailEntry.status}`}>
                {detailEntry.status === 'success'
                  ? tr('成功', 'Success', '成功')
                  : tr('失败', 'Failed', '失敗')}
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
                <dd>{detailEntry.groupName || tr('未分组', 'Ungrouped', '未分組')}</dd>
              </div>
              <div>
                <dt>{tr('书签名称', 'Bookmark', '書籤名稱')}</dt>
                <dd>{detailEntry.accountLabel}</dd>
              </div>
              <div>
                <dt>{tr('时间', 'Time', '時間')}</dt>
                <dd>{formatDate(detailEntry.timestamp, { dateStyle: 'medium', timeStyle: 'medium' })}</dd>
              </div>
              <div className="log-detail-grid__wide">
                <dt>{tr('访问地址', 'URL', '網址')}</dt>
                <dd><code>{detailEntry.url}</code></dd>
              </div>
            </dl>
            <div className="log-detail-reason">
              <strong>{tr('完整访问说明', 'Full explanation', '完整存取說明')}</strong>
              <p>{detailEntry.reason}</p>
            </div>
            <p className="modal-description log-detail-redaction">
              {tr(
                '访问日志在写入时脱敏，只保留站点来源和路径，不包含查询参数、密码或 Cookie。',
                'Access logs are redacted at write time and keep only the origin and path without query parameters, passwords or cookies.',
                '存取日誌在寫入時去識別化，只保留站點來源和路徑，不包含查詢參數、密碼或 Cookie。'
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
