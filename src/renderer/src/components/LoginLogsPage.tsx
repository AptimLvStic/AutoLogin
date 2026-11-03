import { useEffect, useMemo, useState } from 'react'
import {
  ChevronLeft,
  ChevronRight,
  FileText,
  LoaderCircle,
  RefreshCw,
  SearchX
} from 'lucide-react'
import type { LoginLogEntry } from '@shared/types'
import { useI18n } from '../i18n'

type LogStatusFilter = 'all' | LoginLogEntry['status']
type PageSize = 10 | 20 | 50 | 100 | 200

const PAGE_SIZES: PageSize[] = [10, 20, 50, 100, 200]

export function LoginLogsPage({
  notify
}: {
  notify: (kind: 'success' | 'error' | 'info', message: string) => void
}): React.JSX.Element {
  const { tr, formatDate, language } = useI18n()
  const [entries, setEntries] = useState<LoginLogEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [date, setDate] = useState('')
  const [accountId, setAccountId] = useState('all')
  const [groupName, setGroupName] = useState('all')
  const [status, setStatus] = useState<LogStatusFilter>('all')
  const [pageSize, setPageSize] = useState<PageSize>(20)
  const [page, setPage] = useState(1)

  async function load(): Promise<void> {
    setLoading(true)
    try {
      setEntries(await window.autologin.app.listLoginLogs())
    } catch (error) {
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

  useEffect(() => {
    void load()
  }, [])

  const accountOptions = useMemo(() => {
    const map = new Map<string, string>()
    for (const entry of entries) map.set(entry.accountId, entry.accountLabel)
    return [...map.entries()].sort((left, right) => left[1].localeCompare(right[1], language))
  }, [entries, language])

  const groupOptions = useMemo(
    () =>
      [...new Set(entries.map((entry) => entry.groupName).filter(Boolean))].sort((left, right) =>
        left.localeCompare(right, language)
      ),
    [entries, language]
  )

  const filtered = useMemo(
    () =>
      entries.filter((entry) => {
        if (date && localDateKey(entry.timestamp) !== date) return false
        if (accountId !== 'all' && entry.accountId !== accountId) return false
        if (groupName !== 'all' && entry.groupName !== groupName) return false
        if (status !== 'all' && entry.status !== status) return false
        return true
      }),
    [accountId, date, entries, groupName, status]
  )

  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize))
  const currentPage = Math.min(page, pageCount)
  const visible = filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize)

  useEffect(() => {
    setPage(1)
  }, [accountId, date, groupName, pageSize, status])

  return (
    <section className="page-section logs-page">
      <div className="page-section__intro">
        <span className="eyebrow">LOCAL LOGIN HISTORY</span>
        <h2>{tr('登录日志', 'Login history', '登入日誌')}</h2>
        <p>
          {tr(
            '记录成功、失败、超时和待人工处理结果。日志不包含密码、Cookie、验证码或完整 URL。',
            'Successful, failed, timed-out and manual results are recorded without passwords, cookies, verification codes or full URLs.',
            '記錄成功、失敗、逾時和待人工處理結果。日誌不包含密碼、Cookie、驗證碼或完整網址。'
          )}
        </p>
      </div>

      <div className="log-filters">
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
          <span className="field__label">{tr('账号', 'Account', '帳號')}</span>
          <select
            className="filter-control"
            value={accountId}
            onChange={(event) => setAccountId(event.target.value)}
          >
            <option value="all">{tr('全部账号', 'All accounts', '全部帳號')}</option>
            {accountOptions.map(([id, label]) => (
              <option key={id} value={id}>
                {label}
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
                {displayGroup(group, tr)}
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
            className="button button--ghost"
            onClick={() => void window.autologin.app.openFailureLog()}
          >
            <FileText size={15} />
            {tr('打开原始日志', 'Open raw log', '開啟原始日誌')}
          </button>
        </div>
      </div>

      {loading ? (
        <div className="logs-empty">
          <LoaderCircle size={22} className="spin" />
          <span>{tr('正在读取本地日志', 'Reading local logs', '正在讀取本機日誌')}</span>
        </div>
      ) : visible.length === 0 ? (
        <div className="logs-empty">
          <SearchX size={24} />
          <strong>{tr('没有匹配的日志', 'No matching logs', '沒有符合的日誌')}</strong>
          <span>{tr('调整筛选条件或等待下一次登录记录。', 'Adjust the filters or wait for the next login.', '調整篩選條件或等待下一次登入記錄。')}</span>
        </div>
      ) : (
        <div className="log-table-wrap">
          <div className="log-table" role="table" aria-label={tr('登录日志列表', 'Login log list', '登入日誌列表')}>
            <div className="log-table__header" role="row">
              <span>{tr('状态', 'Status', '狀態')}</span>
              <span>{tr('账号', 'Account', '帳號')}</span>
              <span>{tr('站点', 'Site', '站點')}</span>
              <span>{tr('分组', 'Group', '分組')}</span>
              <span>{tr('说明', 'Details', '說明')}</span>
              <span>{tr('时间', 'Time', '時間')}</span>
            </div>
            {visible.map((entry) => (
              <article
                className="log-table__row"
                role="row"
                key={`${entry.batchId}:${entry.accountId}:${entry.timestamp}`}
              >
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