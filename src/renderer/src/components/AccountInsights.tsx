import { useMemo, useState } from 'react'
import type { Notify } from './Toast'
import {
  ArrowUpRight,
  Bookmark,
  ChevronDown,
  Copy,
  Download,
  Globe2,
  KeyRound,
  Link2,
  RefreshCw,
  Search,
  ShieldCheck,
  Users
} from 'lucide-react'
import type { AccountWithSite } from '@shared/types'
import { useI18n } from '../i18n'
import { fileToastActions } from '../toast-actions'
import { SiteMark } from './SiteMark'

type Dataset = 'accounts' | 'bookmarks' | 'cross'
type AccountFilter = 'reuse' | 'multiSite' | 'duplicate' | 'stale'
type BookmarkFilter = 'missingCredential' | 'hasNote' | 'sameHost' | 'loginable' | 'inconsistent'
type CrossFilter = 'missingBookmark' | 'inconsistent' | 'loginable'
type FilterId = AccountFilter | BookmarkFilter | CrossFilter

interface AccountInsightsProps {
  accounts: AccountWithSite[]
  bookmarks: AccountWithSite[]
  onOpenAccount: (account: AccountWithSite) => void
  onExportReport?: (accounts: AccountWithSite[]) => void
  notify?: Notify
}

interface IdentityGroup {
  key: string
  username: string
  accounts: AccountWithSite[]
  sites: AccountWithSite[]
  lastUsed?: string
  sharesPassword: boolean
  recorded: number
}

interface Bucket {
  id: string
  name: string
  hint: string
  items: AccountWithSite[]
}

interface CrossRow {
  host: string
  accounts: AccountWithSite[]
  bookmarks: AccountWithSite[]
  inconsistent: boolean
}

const DATASETS: Dataset[] = ['accounts', 'bookmarks', 'cross']
const FILTERS: Record<Dataset, Array<{ id: FilterId; label: string }>> = {
  accounts: [
    { id: 'reuse', label: '复用身份' },
    { id: 'multiSite', label: '站点多账号' },
    { id: 'duplicate', label: '重复密码' },
    { id: 'stale', label: '长期未用' }
  ],
  bookmarks: [
    { id: 'missingCredential', label: '缺凭证' },
    { id: 'hasNote', label: '有备注' },
    { id: 'sameHost', label: '同域双存' },
    { id: 'loginable', label: '可从书签登录' },
    { id: 'inconsistent', label: '凭证不一致' }
  ],
  cross: [
    { id: 'missingBookmark', label: '账号缺书签' },
    { id: 'inconsistent', label: '凭证不一致' },
    { id: 'loginable', label: '可从书签登录' }
  ]
}

function normalizeIdentity(username: string): string {
  const value = username.trim().toLocaleLowerCase()
  return value.includes('@') ? value.replace(/\+[^@]*@/, '@') : value
}

function daysSince(value?: string): number | null {
  if (!value) return null
  const time = new Date(value).getTime()
  if (Number.isNaN(time)) return null
  return Math.max(0, Math.floor((Date.now() - time) / 86_400_000))
}

function relativeDays(value: string | undefined, tr: (zh: string, en: string, tw: string) => string): string {
  const days = daysSince(value)
  if (days === null) return tr('从未使用', 'Never used', '從未使用')
  if (days === 0) return tr('今天使用', 'Used today', '今天使用')
  if (days === 1) return tr('昨天使用', 'Used yesterday', '昨天使用')
  if (days < 30) return tr(`${days} 天前使用`, `Used ${days} days ago`, `${days} 天前使用`)
  const months = Math.floor(days / 30)
  return tr(`${months} 个月前使用`, `Used ${months} months ago`, `${months} 個月前使用`)
}

function latest(...values: Array<string | undefined>): string | undefined {
  return values.filter((value): value is string => Boolean(value)).sort().at(-1)
}

function hostOf(value: string | undefined): string {
  if (!value) return ''
  try {
    const url = new URL(value.includes('://') ? value : `https://${value}`)
    if (url.protocol === 'file:') return 'file://'
    return url.hostname.toLocaleLowerCase().replace(/^www\./, '')
  } catch {
    return ''
  }
}

function bookmarkUrl(account: AccountWithSite): string {
  return account.site.startUrl || ''
}

function hasCredential(account: AccountWithSite): boolean {
  return Boolean(account.username || !account.needsSecret)
}

function hasNote(account: AccountWithSite): boolean {
  return Boolean(account.note?.trim() || account.site.note?.trim())
}

function Highlight({ text, query }: { text: string; query: string }): React.JSX.Element {
  const needle = query.trim()
  if (!needle) return <>{text}</>
  const index = text.toLocaleLowerCase().indexOf(needle.toLocaleLowerCase())
  if (index < 0) return <>{text}</>
  return (
    <>
      {text.slice(0, index)}
      <mark>{text.slice(index, index + needle.length)}</mark>
      {text.slice(index + needle.length)}
    </>
  )
}

export function AccountInsights({
  accounts,
  bookmarks,
  onOpenAccount,
  onExportReport,
  notify
}: AccountInsightsProps): React.JSX.Element {
  const { tr } = useI18n()
  const [dataset, setDataset] = useState<Dataset>('accounts')
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [keywords, setKeywords] = useState<Record<Dataset, string>>({ accounts: '', bookmarks: '', cross: '' })
  const [filters, setFilters] = useState<Record<Dataset, Set<FilterId>>>({
    accounts: new Set(),
    bookmarks: new Set(),
    cross: new Set()
  })
  const [bookmarkView, setBookmarkView] = useState<'group' | 'domain'>('group')
  const [exporting, setExporting] = useState(false)
  const keyword = keywords[dataset]

  const identities = useMemo<IdentityGroup[]>(() => {
    const map = new Map<string, AccountWithSite[]>()
    for (const account of accounts) {
      const key = normalizeIdentity(account.username)
      const list = map.get(key) ?? []
      list.push(account)
      map.set(key, list)
    }
    return [...map.entries()]
      .map(([key, list]) => {
        const siteMap = new Map<string, AccountWithSite>()
        for (const account of list) siteMap.set(account.site.id, account)
        return {
          key,
          username: key ? list[0]?.username ?? key : tr('（未填写用户名）', '(no username)', '（未填寫使用者名稱）'),
          accounts: list,
          sites: [...siteMap.values()],
          lastUsed: latest(...list.map((account) => account.lastUsedAt ?? account.updatedAt)),
          sharesPassword: list.some((account) => account.sharesPassword),
          recorded: list.filter((account) => Boolean(account.activeRecipeId || account.recipes?.length)).length
        }
      })
      .sort(
        (a, b) =>
          Number(b.sites.length > 1) - Number(a.sites.length > 1) ||
          b.sites.length - a.sites.length ||
          a.username.localeCompare(b.username)
      )
  }, [accounts, tr])

  const duplicateAccounts = useMemo(() => accounts.filter((account) => account.sharesPassword), [accounts])
  const staleAccounts = useMemo(
    () => accounts.filter((account) => (daysSince(account.updatedAt) ?? 0) >= 90),
    [accounts]
  )
  const reused = identities.filter((group) => group.sites.length > 1)

  const bookmarkHosts = useMemo(() => {
    const map = new Map<string, AccountWithSite[]>()
    for (const bookmark of bookmarks) {
      const host = hostOf(bookmarkUrl(bookmark))
      const list = map.get(host) ?? []
      list.push(bookmark)
      map.set(host, list)
    }
    return map
  }, [bookmarks])

  const crossRows = useMemo<CrossRow[]>(() => {
    const byHost = new Map<string, CrossRow>()
    const ensure = (host: string): CrossRow => {
      const row = byHost.get(host) ?? { host, accounts: [], bookmarks: [], inconsistent: false }
      byHost.set(host, row)
      return row
    }
    for (const account of accounts) {
      const host = hostOf(account.site.startUrl)
      if (!host) continue
      ensure(host).accounts.push(account)
    }
    for (const bookmark of bookmarks) {
      const host = hostOf(bookmarkUrl(bookmark))
      if (!host) continue
      ensure(host).bookmarks.push(bookmark)
    }
    for (const row of byHost.values()) {
      const accountNames = new Set(
        row.accounts.map((account) => normalizeIdentity(account.username)).filter(Boolean)
      )
      row.inconsistent = row.bookmarks.some(
        (bookmark) =>
          Boolean(bookmark.username) &&
          accountNames.size > 0 &&
          !accountNames.has(normalizeIdentity(bookmark.username))
      )
      if (!row.inconsistent && row.accounts.length > 0 && row.bookmarks.length > 0) {
        row.inconsistent = row.bookmarks.some((bookmark) => !bookmark.username && !bookmark.needsSecret)
      }
    }
    return [...byHost.values()].sort(
      (a, b) =>
        Number(b.inconsistent) - Number(a.inconsistent) ||
        b.accounts.length + b.bookmarks.length - (a.accounts.length + a.bookmarks.length) ||
        a.host.localeCompare(b.host)
    )
  }, [accounts, bookmarks])

  const counts = useMemo(() => {
    const missingCredential = bookmarks.filter((item) => !hasCredential(item)).length
    const loginable = bookmarks.filter((item) => Boolean(item.username)).length
    const inconsistentBookmarks = crossRows.filter((row) => row.inconsistent).reduce((sum, row) => sum + row.bookmarks.length, 0)
    return {
      accounts: {
        reuse: reused.length,
        multiSite: new Set(accounts.filter((account) => account.sharesPassword).map((account) => account.site.id)).size,
        duplicate: duplicateAccounts.length,
        stale: staleAccounts.length
      },
      bookmarks: {
        total: bookmarks.length,
        missingCredential,
        hasNote: bookmarks.filter((item) => hasNote(item)).length,
        sameHost: [...bookmarkHosts.values()].filter((list) => list.length > 1).length,
        loginable,
        inconsistent: inconsistentBookmarks
      },
      cross: {
        missingBookmark: crossRows.filter((row) => row.accounts.length > 0 && row.bookmarks.length === 0).length,
        inconsistent: crossRows.filter((row) => row.inconsistent).length,
        loginable: crossRows.filter((row) => row.bookmarks.some((item) => Boolean(item.username))).length
      }
    }
  }, [accounts, bookmarks, bookmarkHosts, crossRows, duplicateAccounts.length, reused.length, staleAccounts.length])

  function matches(account: AccountWithSite, needle: string): boolean {
    if (!needle) return true
    return [account.site.name, account.site.startUrl, account.site.group, account.username, account.label, account.note]
      .filter(Boolean)
      .some((value) => value!.toLocaleLowerCase().includes(needle))
  }

  const needle = keyword.trim().toLocaleLowerCase()

  const filteredAccounts = useMemo(() => {
    const active = filters.accounts
    let list = accounts.filter((account) => matches(account, needle))
    if (active.has('reuse')) {
      const ids = new Set(reused.flatMap((group) => group.accounts.map((account) => account.id)))
      list = list.filter((account) => ids.has(account.id))
    }
    if (active.has('multiSite')) {
      const sites = new Set(accounts.map((account) => account.site.id))
      const ids = new Set(
        [...sites].flatMap((siteId) => {
          const group = accounts.filter((account) => account.site.id === siteId)
          return group.length > 1 ? group.map((account) => account.id) : []
        })
      )
      list = list.filter((account) => ids.has(account.id))
    }
    if (active.has('duplicate')) list = list.filter((account) => account.sharesPassword)
    if (active.has('stale')) list = list.filter((account) => (daysSince(account.updatedAt) ?? 0) >= 90)
    return list
  }, [accounts, filters.accounts, needle, reused])

  const accountGroups = useMemo(() => {
    const ids = new Set(filteredAccounts.map((account) => account.id))
    return identities
      .map((group) => ({ ...group, accounts: group.accounts.filter((account) => ids.has(account.id)) }))
      .filter((group) => group.accounts.length > 0)
  }, [identities, filteredAccounts])

  const filteredBookmarks = useMemo(() => {
    const active = filters.bookmarks
    let list = bookmarks.filter((bookmark) => matches(bookmark, needle))
    if (active.has('missingCredential')) list = list.filter((bookmark) => !hasCredential(bookmark))
    if (active.has('hasNote')) list = list.filter((bookmark) => hasNote(bookmark))
    if (active.has('sameHost')) {
      const hosts = new Set([...bookmarkHosts.entries()].filter(([, items]) => items.length > 1).map(([host]) => host))
      list = list.filter((bookmark) => hosts.has(hostOf(bookmarkUrl(bookmark))))
    }
    if (active.has('loginable')) list = list.filter((bookmark) => Boolean(bookmark.username))
    if (active.has('inconsistent')) {
      const ids = new Set(crossRows.filter((row) => row.inconsistent).flatMap((row) => row.bookmarks.map((item) => item.id)))
      list = list.filter((bookmark) => ids.has(bookmark.id))
    }
    return list
  }, [bookmarks, filters.bookmarks, needle, bookmarkHosts, crossRows])

  const bookmarkBuckets = useMemo<Bucket[]>(() => {
    if (bookmarkView === 'group') {
      const map = new Map<string, AccountWithSite[]>()
      for (const bookmark of filteredBookmarks) {
        const key = bookmark.site.group?.trim() || tr('未分组', 'Ungrouped', '未分組')
        const list = map.get(key) ?? []
        list.push(bookmark)
        map.set(key, list)
      }
      return [...map.entries()]
        .map(([name, items]) => ({ id: `group:${name}`, name, hint: tr(`${items.length} 个书签`, `${items.length} bookmarks`, `${items.length} 個書籤`), items }))
        .sort((a, b) => b.items.length - a.items.length)
    }
    const map = new Map<string, AccountWithSite[]>()
    for (const bookmark of filteredBookmarks) {
      const host = hostOf(bookmarkUrl(bookmark)) || tr('其他', 'Other', '其他')
      const list = map.get(host) ?? []
      list.push(bookmark)
      map.set(host, list)
    }
    return [...map.entries()]
      .map(([name, items]) => ({ id: `host:${name}`, name, hint: tr(`${items.length} 个书签`, `${items.length} bookmarks`, `${items.length} 個書籤`), items }))
      .sort((a, b) => b.items.length - a.items.length || a.name.localeCompare(b.name))
  }, [filteredBookmarks, bookmarkView, tr])

  const filteredCross = useMemo(() => {
    const active = filters.cross
    return crossRows.filter((row) => {
      if (needle && !row.host.includes(needle) && !row.accounts.some((item) => matches(item, needle)) && !row.bookmarks.some((item) => matches(item, needle))) {
        return false
      }
      if (active.has('missingBookmark') && !(row.accounts.length > 0 && row.bookmarks.length === 0)) return false
      if (active.has('inconsistent') && !row.inconsistent) return false
      if (active.has('loginable') && !row.bookmarks.some((item) => Boolean(item.username))) return false
      return true
    })
  }, [crossRows, filters.cross, needle])

  function toggleFilter(id: FilterId): void {
    setFilters((current) => {
      const next = new Set(current[dataset])
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return { ...current, [dataset]: next }
    })
  }

  function toggle(key: string): void {
    setCollapsed((current) => {
      const next = new Set(current)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  async function exportReport(): Promise<void> {
    if (exporting) return
    if (dataset === 'accounts' && onExportReport) {
      onExportReport(filteredAccounts)
      return
    }
    setExporting(true)
    try {
      const title = dataset === 'accounts' ? '账号统计' : dataset === 'bookmarks' ? '书签统计' : '账号与书签交叉统计'
      const lines = [
        `# AutoLogin ${title}`,
        '',
        `导出时间：${new Date().toLocaleString()}`,
        `范围：${dataset === 'accounts' ? `${accounts.length} 个账号 / ${identities.length} 个身份` : dataset === 'bookmarks' ? `${bookmarks.length} 个书签 / ${bookmarkHosts.size} 个域名` : `${crossRows.length} 个域名`}`,
        ''
      ]
      if (dataset === 'accounts') {
        lines.push('## 复用身份', '', '| 身份 | 站点数 | 最近使用 |', '| --- | --- | --- |')
        for (const group of reused.slice(0, 50)) lines.push(`| ${group.username.replace(/\|/g, '\\|')} | ${group.sites.length} | ${group.lastUsed ?? ''} |`)
      } else if (dataset === 'bookmarks') {
        lines.push('## 域名分布', '', '| 域名 | 书签数 |', '| --- | --- |')
        for (const [host, items] of [...bookmarkHosts.entries()].sort((a, b) => b[1].length - a[1].length).slice(0, 50)) lines.push(`| ${host || '其他'} | ${items.length} |`)
      } else {
        lines.push('## 交叉情况', '', '| 域名 | 账号 | 书签 | 凭证不一致 |', '| --- | --- | --- | --- |')
        for (const row of crossRows.slice(0, 50)) lines.push(`| ${row.host} | ${row.accounts.length} | ${row.bookmarks.length} | ${row.inconsistent ? '是' : ''} |`)
      }
      const saved = await window.autologin.data.saveText({
        content: lines.join('\n'),
        fileName: `AutoLogin-${title}-${new Date().toISOString().slice(0, 10)}.md`,
        extension: 'md'
      })
      notify?.(
        'success',
        tr('统计报表已导出', 'Report exported', '統計報表已匯出'),
        fileToastActions(tr, saved.filePath)
      )
    } catch (reason) {
      if (reason instanceof Error && /取消|cancel/i.test(reason.message)) {
        notify?.('info', tr('已取消导出', 'Export cancelled', '已取消匯出'))
      } else {
        notify?.('error', reason instanceof Error ? reason.message : tr('导出失败', 'Export failed', '匯出失敗'))
      }
    } finally {
      setExporting(false)
    }
  }

  const kpis = dataset === 'accounts'
    ? [
        { id: 'reuse' as FilterId, icon: Users, value: counts.accounts.reuse, label: '复用身份', hint: '一个用户名 ≥ 2 个站点' },
        { id: 'multiSite' as FilterId, icon: Globe2, value: counts.accounts.multiSite, label: '站点多账号', hint: '同一站点 ≥ 2 个账号' },
        { id: 'duplicate' as FilterId, icon: Copy, value: counts.accounts.duplicate, label: '重复密码', hint: '建议逐个更换' },
        { id: 'stale' as FilterId, icon: RefreshCw, value: counts.accounts.stale, label: '90 天未更新', hint: '密码可能已过期' }
      ]
    : dataset === 'bookmarks'
      ? [
          { id: 'missingCredential' as FilterId, icon: KeyRound, value: counts.bookmarks.missingCredential, label: '缺凭证', hint: '没有用户名或密码' },
          { id: 'hasNote' as FilterId, icon: Bookmark, value: counts.bookmarks.hasNote, label: '有备注', hint: '可用于检索' },
          { id: 'sameHost' as FilterId, icon: Link2, value: counts.bookmarks.sameHost, label: '同域双存', hint: '同一域名 ≥ 2 个书签' },
          { id: 'inconsistent' as FilterId, icon: ShieldCheck, value: counts.bookmarks.inconsistent, label: '凭证不一致', hint: '与账号用户名不同' }
        ]
      : [
          { id: 'missingBookmark' as FilterId, icon: Bookmark, value: counts.cross.missingBookmark, label: '账号缺书签', hint: '有账号，没书签' },
          { id: 'inconsistent' as FilterId, icon: ShieldCheck, value: counts.cross.inconsistent, label: '凭证不一致', hint: '书签与账号不一致' },
          { id: 'loginable' as FilterId, icon: KeyRound, value: counts.cross.loginable, label: '可从书签登录', hint: '书签保存了用户名' }
        ]

  const total = dataset === 'accounts' ? accounts.length : dataset === 'bookmarks' ? bookmarks.length : crossRows.length
  const found = dataset === 'accounts' ? filteredAccounts.length : dataset === 'bookmarks' ? filteredBookmarks.length : filteredCross.length

  function renderAccountRow(account: AccountWithSite): React.JSX.Element {
    return (
      <button type="button" className="insights-row" key={account.id} onClick={() => onOpenAccount(account)}>
        <SiteMark site={account.site} />
        <span className="insights-row__main">
          <strong><Highlight text={account.site.name} query={keyword} /></strong>
          <small>
            <Highlight text={account.username || tr('未填写用户名', 'No username', '未填寫使用者名稱')} query={keyword} />
            {' · '}
            <Highlight text={account.site.group || tr('未分组', 'Ungrouped', '未分組')} query={keyword} />
          </small>
        </span>
        <span className="insights-row__tags">
          {account.hasOtp && <span className="insights-badge is-quiet">OTP</span>}
          {account.sharesPassword && <span className="insights-badge is-warning">{tr('密码重复', 'Reused', '重複')}</span>}
          {(daysSince(account.updatedAt) ?? 0) >= 90 && <span className="insights-badge is-muted">{tr('90 天未更新', 'Stale', '90 天未更新')}</span>}
          <span className="insights-row__time">{relativeDays(account.lastUsedAt ?? account.updatedAt, tr)}</span>
          <ArrowUpRight size={13} />
        </span>
      </button>
    )
  }

  return (
    <section className="page-section account-insights">
      <header className="account-insights__header">
        <div>
          <h2>{tr('统计', 'Insights', '統計')}</h2>
          <p className="account-insights__lede">
            {tr(
              `${accounts.length} 个账号 · ${bookmarks.length} 个书签 · ${crossRows.length} 个域名`,
              `${accounts.length} accounts · ${bookmarks.length} bookmarks · ${crossRows.length} hosts`,
              `${accounts.length} 個帳號 · ${bookmarks.length} 個書籤 · ${crossRows.length} 個網域`
            )}
          </p>
        </div>
        <div className="insights-actions">
          <div className="segmented-control insights-tabs" role="tablist" aria-label={tr('数据集', 'Dataset', '資料集')}>
            {DATASETS.map((id) => (
              <button key={id} type="button" role="tab" aria-selected={dataset === id} className={dataset === id ? 'is-active' : ''} onClick={() => setDataset(id)}>
                {id === 'accounts' ? tr('账号', 'Accounts', '帳號') : id === 'bookmarks' ? tr('书签', 'Bookmarks', '書籤') : tr('交叉', 'Cross', '交叉')}
              </button>
            ))}
          </div>
          <button type="button" className="button button--ghost button--small" onClick={() => void exportReport()} disabled={exporting}>
            <Download size={14} />
            {tr('导出报表', 'Export report', '匯出報表')}
          </button>
        </div>
      </header>

      <div className="account-insights__stats">
        {kpis.map((item) => {
          const Icon = item.icon
          const active = filters[dataset].has(item.id)
          return (
            <button
              key={item.id}
              type="button"
              className={`insights-kpi${active ? ' is-active' : ''}`}
              onClick={() => toggleFilter(item.id)}
              aria-pressed={active}
            >
              <Icon size={16} />
              <strong>{item.value}</strong>
              <span>{tr(item.label, item.label, item.label)}</span>
              <small>{tr(item.hint, item.hint, item.hint)}</small>
            </button>
          )
        })}
      </div>

      <div className="insights-toolbar">
        <label className="insights-search">
          <Search size={15} />
          <input
            value={keyword}
            onChange={(event) => setKeywords((current) => ({ ...current, [dataset]: event.target.value }))}
            placeholder={tr('搜索站点、用户名、分组或备注', 'Search sites, usernames, groups or notes', '搜尋站點、使用者名稱、分組或備註')}
            aria-label={tr('在统计中搜索', 'Search insights', '在統計中搜尋')}
          />
          <span>{tr(`找到 ${found} / 共 ${total}`, `${found} of ${total}`, `找到 ${found} / 共 ${total}`)}</span>
        </label>
        <div className="insights-filters" role="group" aria-label={tr('筛选', 'Filters', '篩選')}>
          {FILTERS[dataset].map((item) => (
            <button
              key={item.id}
              type="button"
              className={`insights-filter${filters[dataset].has(item.id) ? ' is-active' : ''}`}
              onClick={() => toggleFilter(item.id)}
              aria-pressed={filters[dataset].has(item.id)}
            >
              {tr(item.label, item.label, item.label)}
            </button>
          ))}
          {dataset === 'bookmarks' && (
            <div className="segmented-control insights-view-toggle" role="group" aria-label={tr('书签分组方式', 'Bookmark grouping', '書籤分組方式')}>
              <button type="button" className={bookmarkView === 'group' ? 'is-active' : ''} onClick={() => setBookmarkView('group')}>{tr('按分组', 'By group', '按分組')}</button>
              <button type="button" className={bookmarkView === 'domain' ? 'is-active' : ''} onClick={() => setBookmarkView('domain')}>{tr('按域名', 'By domain', '按網域')}</button>
            </div>
          )}
        </div>
      </div>

      {dataset === 'accounts' && (
        <div className="insights-list">
          {accountGroups.length === 0 ? (
            <p className="empty-hint">{tr('没有符合条件的账号。', 'No accounts match.', '沒有符合條件的帳號。')}</p>
          ) : (
            accountGroups.map((group) => {
              const open = !collapsed.has(group.key)
              return (
                <article className={`insights-identity${open ? ' is-open' : ''}`} key={group.key || 'empty'}>
                  <button type="button" className="insights-identity__head" onClick={() => toggle(group.key)} aria-expanded={open}>
                    <span className="insights-avatar">{group.username.slice(0, 1).toLocaleUpperCase()}</span>
                    <span className="insights-identity__title">
                      <strong><Highlight text={group.username} query={keyword} /></strong>
                      <small>
                        {group.accounts.length > 1
                          ? tr(`复用身份 · ${new Set(group.accounts.map((item) => item.site.id)).size} 个站点`, `Shared identity · ${new Set(group.accounts.map((item) => item.site.id)).size} sites`, `重用身分 · ${new Set(group.accounts.map((item) => item.site.id)).size} 個站點`)
                          : tr('单一账号', 'Single account', '單一帳號')}
                        {' · '}
                        {relativeDays(group.lastUsed, tr)}
                      </small>
                    </span>
                    <span className="insights-identity__badges">
                      {group.sharesPassword && <span className="insights-badge is-warning">{tr('密码重复', 'Password reused', '密碼重複')}</span>}
                      {group.accounts.length > 1 && <span className="insights-badge">{tr(`${group.accounts.length} 个账号`, `${group.accounts.length} accounts`, `${group.accounts.length} 個帳號`)}</span>}
                    </span>
                    <ChevronDown size={15} className="insights-identity__chevron" />
                  </button>
                  {open && <div className="insights-identity__sites">{group.accounts.map(renderAccountRow)}</div>}
                </article>
              )
            })
          )}
        </div>
      )}

      {dataset === 'bookmarks' && (
        <div className="insights-list">
          {bookmarkBuckets.length === 0 ? (
            <p className="empty-hint">{tr('没有符合条件的书签。', 'No bookmarks match.', '沒有符合條件的書籤。')}</p>
          ) : (
            bookmarkBuckets.map((bucket) => (
              <article className="insights-bucket" key={bucket.id}>
                <header className="insights-bucket__head">
                  <strong><Highlight text={bucket.name} query={keyword} /></strong>
                  <small>{bucket.hint}</small>
                </header>
                <div className="insights-bucket__rows">{bucket.items.map(renderAccountRow)}</div>
              </article>
            ))
          )}
        </div>
      )}

      {dataset === 'cross' && (
        <div className="insights-list">
          {filteredCross.length === 0 ? (
            <p className="empty-hint">{tr('没有符合条件的域名。', 'No hosts match.', '沒有符合條件的網域。')}</p>
          ) : (
            filteredCross.map((row) => (
              <article className="insights-cross" key={row.host}>
                <header className="insights-cross__head">
                  <span className="insights-cross__host">
                    <strong><Highlight text={row.host} query={keyword} /></strong>
                    <small>{tr(`${row.accounts.length} 个账号 · ${row.bookmarks.length} 个书签`, `${row.accounts.length} accounts · ${row.bookmarks.length} bookmarks`, `${row.accounts.length} 個帳號 · ${row.bookmarks.length} 個書籤`)}</small>
                  </span>
                  {row.inconsistent && <span className="insights-badge is-warning">{tr('凭证不一致', 'Credentials differ', '憑證不一致')}</span>}
                  {row.accounts.length > 0 && row.bookmarks.length === 0 && <span className="insights-badge is-muted">{tr('缺书签', 'No bookmark', '缺書籤')}</span>}
                </header>
                <div className="insights-bucket__rows">
                  {row.accounts.map(renderAccountRow)}
                  {row.bookmarks.map(renderAccountRow)}
                </div>
              </article>
            ))
          )}
        </div>
      )}

      <p className="account-insights__note">
        {tr(
          '账号与书签按域名（去掉 www）归并；用户名相同时才视为同一身份，不区分大小写。导出报表只包含汇总与计数，不含密码。',
          'Accounts and bookmarks are merged by host (www removed); identities match case-insensitively on username. Reports contain summaries only, never passwords.',
          '帳號與書籤按網域（去掉 www）合併；使用者名稱相同才視為同一身分，不分大小寫。匯出報表只包含彙總與計數，不含密碼。'
        )}
      </p>
    </section>
  )
}
