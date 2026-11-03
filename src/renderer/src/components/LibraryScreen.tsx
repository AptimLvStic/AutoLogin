import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowRight,
  ArrowUpRight,
  Clock3,
  Globe2,
  KeyRound,
  Layers3,
  LoaderCircle,
  LockKeyhole,
  Plus,
  Search,
  Settings,
  ShieldCheck,
  Star,
  UserRound
} from 'lucide-react'
import type { AccountWithSite, AppSettings, LoginBatchState, Site } from '@shared/types'
import { AccountForm } from './AccountForm'
import { BatchLoginModal } from './BatchLoginModal'
import { BrandMark } from './Brand'
import { DetailsDrawer } from './DetailsDrawer'
import { SettingsModal } from './SettingsModal'

type Filter = 'all' | 'favorites' | `site:${string}`

export function LibraryScreen({
  accounts,
  sites,
  settings,
  appVersion,
  batchState,
  onRefresh,
  onLock,
  onStartBatch,
  onRecord,
  onCleared,
  notify
}: {
  accounts: AccountWithSite[]
  sites: Site[]
  settings: AppSettings
  appVersion: string
  batchState: LoginBatchState | null
  onRefresh: () => Promise<void>
  onLock: () => Promise<void>
  onStartBatch: (accountIds: string[]) => Promise<boolean>
  onRecord: (account: AccountWithSite) => void
  onCleared: () => void
  notify: (kind: 'success' | 'error' | 'info', message: string) => void
}): React.JSX.Element {
  const [filter, setFilter] = useState<Filter>('all')
  const [search, setSearch] = useState('')
  const searchRef = useRef<HTMLInputElement>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [formState, setFormState] = useState<
    { mode: 'create'; siteId?: string } | { mode: 'edit'; account: AccountWithSite } | null
  >(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [batchOpen, setBatchOpen] = useState(false)

  const accountSites = useMemo(() => {
    const counts = new Map<string, number>()
    for (const account of accounts) {
      counts.set(account.siteId, (counts.get(account.siteId) ?? 0) + 1)
    }
    return sites
      .filter((site) => counts.has(site.id))
      .map((site) => ({ site, count: counts.get(site.id) ?? 0 }))
  }, [accounts, sites])

  const groupedSites = useMemo(() => {
    const groups = new Map<string, Array<{ site: Site; count: number }>>()
    for (const entry of accountSites) {
      const group = entry.site.group?.trim() || '未分组'
      const current = groups.get(group) ?? []
      current.push(entry)
      groups.set(group, current)
    }
    return [...groups.entries()].sort(([left], [right]) => {
      if (left === '未分组') return 1
      if (right === '未分组') return -1
      return left.localeCompare(right, 'zh-CN')
    })
  }, [accountSites])

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase()
    return accounts
      .filter((account) => {
        if (filter === 'favorites' && !account.favorite) return false
        if (filter.startsWith('site:') && account.siteId !== filter.slice(5)) return false
        if (!query) return true
        return [account.label, account.username, account.site.name, account.site.startUrl]
          .join(' ')
          .toLowerCase()
          .includes(query)
      })
      .sort((a, b) => {
        if (a.favorite !== b.favorite) return a.favorite ? -1 : 1
        return (
          new Date(b.lastUsedAt ?? b.updatedAt).getTime() -
          new Date(a.lastUsedAt ?? a.updatedAt).getTime()
        )
      })
  }, [accounts, filter, search])

  const selected = accounts.find((account) => account.id === selectedId) ?? null
  const recent = accounts
    .filter((account) => account.lastUsedAt)
    .sort(
      (a, b) =>
        new Date(b.lastUsedAt ?? 0).getTime() - new Date(a.lastUsedAt ?? 0).getTime()
    )[0]
  const heading = getHeading(filter, accountSites)

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        searchRef.current?.focus()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  async function toggleFavorite(account: AccountWithSite): Promise<void> {
    try {
      await window.autologin.accounts.update(account.id, { favorite: !account.favorite })
      await onRefresh()
    } catch (error) {
      notify('error', error instanceof Error ? error.message : '收藏状态更新失败')
    }
  }

  async function clearSession(accountId: string): Promise<void> {
    await window.autologin.login.clearSession(accountId)
  }

  async function clearAllData(): Promise<void> {
    await window.autologin.app.clearAllData()
    setSettingsOpen(false)
    onCleared()
  }

  function handleSaved(account: AccountWithSite, message: string): void {
    setFormState(null)
    setSelectedId(account.id)
    void onRefresh()
    notify('success', message)
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <BrandMark />

        <nav className="sidebar-nav" aria-label="账号筛选">
          <span className="sidebar-label">工作台</span>
          <button
            className={`sidebar-nav__item${filter === 'all' ? ' is-active' : ''}`}
            onClick={() => setFilter('all')}
          >
            <KeyRound size={17} />
            <span>全部账号</span>
            <small>{accounts.length}</small>
          </button>
          <button
            className={`sidebar-nav__item${filter === 'favorites' ? ' is-active' : ''}`}
            onClick={() => setFilter('favorites')}
          >
            <Star size={17} />
            <span>收藏</span>
            <small>{accounts.filter((account) => account.favorite).length}</small>
          </button>
        </nav>

        <div className="sidebar-sites">
          <div className="sidebar-label-row">
            <span className="sidebar-label">站点</span>
            <span>{accountSites.length}</span>
          </div>
          <div className="sidebar-sites__list">
            {groupedSites.map(([group, groupEntries]) => (
              <div className="sidebar-site-group" key={group}>
                <div className="sidebar-site-group__heading">
                  <Layers3 size={12} />
                  <span>{group}</span>
                </div>
                {groupEntries.map(({ site, count }) => (
                  <button
                    key={site.id}
                    className={`sidebar-site${filter === `site:${site.id}` ? ' is-active' : ''}`}
                    onClick={() => setFilter(`site:${site.id}`)}
                  >
                    <span className={`monogram monogram--small ${toneClass(site.id)}`}>
                      {site.name.slice(0, 1).toUpperCase()}
                    </span>
                    <span>
                      <strong>{site.name}</strong>
                      <small>{safeHostname(site.startUrl)}</small>
                    </span>
                    <em>{count}</em>
                  </button>
                ))}
              </div>
            ))}
          </div>
        </div>

        <div className="sidebar-bottom">
          <div className="vault-indicator">
            <span className="vault-indicator__pulse" />
            <div>
              <strong>保险库已解锁</strong>
              <small>闲置 {settings.autoLockMinutes} 分钟锁定</small>
            </div>
          </div>
          <div className="sidebar-actions">
            <button className="sidebar-action" onClick={() => setSettingsOpen(true)}>
              <Settings size={17} />
              设置
            </button>
            <button className="sidebar-action" onClick={() => void onLock()}>
              <LockKeyhole size={17} />
              立即锁定
            </button>
          </div>
        </div>
      </aside>

      <main className="library-main">
        <header className="library-header">
          <div>
            <span className="eyebrow">LOCAL LOGIN WORKSPACE</span>
            <h1>{heading}</h1>
            <p>
              {accounts.length === 0
                ? '从一个登录入口开始，建立你的本地账号工作台。'
                : `${accountSites.length} 个站点 · ${accounts.length} 个账号，全部保存在本机`}
            </p>
          </div>
          <div className="library-header__actions">
            {batchState && batchState.total > 0 && (
              <div
                className={`batch-status${batchState.active ? ' is-active' : ''}${
                  batchState.failed > 0 ? ' has-failures' : ''
                }`}
                role="status"
                aria-live="polite"
              >
                {batchState.active ? (
                  <LoaderCircle size={14} className="spin" />
                ) : (
                  <span className="batch-status__dot" />
                )}
                <span>
                  成功 {batchState.success} / 失败 {batchState.failed}
                  {batchState.manual > 0 ? ` · 待处理 ${batchState.manual}` : ''}
                </span>
              </div>
            )}
            <button
              className="button button--ghost"
              onClick={() => setBatchOpen(true)}
              disabled={accounts.length === 0 || Boolean(batchState?.active)}
            >
              <Layers3 size={17} />
              批量打开
            </button>
            <button
              className="button button--primary"
              onClick={() => setFormState({ mode: 'create' })}
            >
              <Plus size={17} />
              添加账号
            </button>
          </div>
        </header>

        {accounts.length > 0 && recent && !search && filter === 'all' && (
          <section className="recent-band">
            <div className="recent-band__copy">
              <span className="eyebrow eyebrow--light">CONTINUE WHERE YOU LEFT OFF</span>
              <h2>{recent.label}</h2>
              <p>
                {recent.site.name} · {recent.username}
              </p>
            </div>
            <div className="recent-band__meta">
              <span>
                <Clock3 size={15} />
                {formatLastUsed(recent.lastUsedAt)}
              </span>
              <span>
                <ShieldCheck size={15} />
                {recent.site.recipe ? '录制流程就绪' : '通用识别就绪'}
              </span>
            </div>
            <button className="recent-login" onClick={() => void onStartBatch([recent.id])}>
              继续登录
              <ArrowUpRight size={18} />
            </button>
            <span className="recent-band__glyph" aria-hidden="true">
              {recent.site.name.slice(0, 1).toUpperCase()}
            </span>
          </section>
        )}

        <div className="library-toolbar">
          <label className="search-field">
            <Search size={17} />
            <input
              ref={searchRef}
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="搜索站点、账号或用户名"
              aria-label="搜索账号"
            />
            <kbd>Ctrl K</kbd>
          </label>
          <span className="result-count">
            {filtered.length} {filtered.length === 1 ? 'ACCOUNT' : 'ACCOUNTS'}
          </span>
        </div>

        <section className="account-list" aria-live="polite">
          <div className="account-list__header">
            <span>账号</span>
            <span>用户名</span>
            <span>最近使用</span>
            <span>状态</span>
            <span />
          </div>
          {filtered.map((account, index) => (
            <article
              className={`account-row${selectedId === account.id ? ' is-selected' : ''}`}
              key={account.id}
              style={{ '--row-index': index } as React.CSSProperties}
              onClick={() => setSelectedId(account.id)}
            >
              <div className="account-identity">
                <span className={`monogram ${toneClass(account.siteId)}`}>
                  {account.site.name.slice(0, 1).toUpperCase()}
                </span>
                <div>
                  <div className="account-name-line">
                    <strong>{account.label}</strong>
                    {account.favorite && <Star size={13} fill="currentColor" />}
                  </div>
                  <span>
                    {account.site.name}
                    <em>·</em>
                    {safeHostname(account.site.startUrl)}
                  </span>
                </div>
              </div>
              <div className="account-username">
                <UserRound size={14} />
                <span>{account.username}</span>
              </div>
              <div className="account-last-used">{formatLastUsed(account.lastUsedAt)}</div>
              <div>
                <span className={`recipe-badge${account.site.recipe ? ' is-recorded' : ''}`}>
                  <span />
                  {account.site.recipe ? '已录制' : '自动识别'}
                </span>
              </div>
              <div className="account-actions">
                <button
                  className={`icon-button icon-button--small${account.favorite ? ' is-active' : ''}`}
                  onClick={(event) => {
                    event.stopPropagation()
                    void toggleFavorite(account)
                  }}
                  aria-label={account.favorite ? '取消收藏' : '收藏'}
                >
                  <Star size={15} fill={account.favorite ? 'currentColor' : 'none'} />
                </button>
                <button
                  className="row-login-button"
                  onClick={(event) => {
                    event.stopPropagation()
                    void onStartBatch([account.id])
                  }}
                >
                  登录
                  <ArrowRight size={15} />
                </button>
              </div>
            </article>
          ))}

          {accounts.length === 0 && (
            <div className="empty-state">
              <div className="empty-state__art" aria-hidden="true">
                <span />
                <span />
                <span>
                  <KeyRound size={27} strokeWidth={1.6} />
                </span>
              </div>
              <span className="eyebrow">YOUR FIRST LOGIN</span>
              <h2>把第一个账号交给 AutoLogin</h2>
              <p>添加站点和账号，之后只需一次点击即可回到登录页面。</p>
              <button
                className="button button--primary"
                onClick={() => setFormState({ mode: 'create' })}
              >
                <Plus size={17} />
                添加第一个账号
              </button>
            </div>
          )}

          {accounts.length > 0 && filtered.length === 0 && (
            <div className="empty-state empty-state--compact">
              <Search size={26} />
              <h2>没有匹配的账号</h2>
              <p>尝试更换关键词或切换侧栏筛选条件。</p>
            </div>
          )}
        </section>
      </main>

      {selected && (
        <DetailsDrawer
          account={selected}
          onClose={() => setSelectedId(null)}
          onEdit={() => {
            setSelectedId(null)
            setFormState({ mode: 'edit', account: selected })
          }}
          onLogin={() => void onStartBatch([selected.id])}
          onRecord={() => {
            setSelectedId(null)
            onRecord(selected)
          }}
          onDelete={() => {
            setSelectedId(null)
            void onRefresh()
          }}
          onClearSession={() => clearSession(selected.id)}
          onFavorite={() => toggleFavorite(selected)}
          onSiteUpdated={() => void onRefresh()}
          notify={notify}
        />
      )}

      {batchOpen && (
        <BatchLoginModal
          accounts={accounts}
          sites={sites}
          onClose={() => setBatchOpen(false)}
          onStart={onStartBatch}
        />
      )}

      {formState && (
        <AccountForm
          mode={formState.mode}
          account={formState.mode === 'edit' ? formState.account : undefined}
          sites={sites}
          initialSiteId={formState.mode === 'create' ? formState.siteId : undefined}
          onClose={() => setFormState(null)}
          onSaved={handleSaved}
        />
      )}

      {settingsOpen && (
        <SettingsModal
          settings={settings}
          appVersion={appVersion}
          onClose={() => setSettingsOpen(false)}
          onSettingsChange={async (next) => {
            await window.autologin.settings.update(next)
            await onRefresh()
          }}
          onClearAllData={clearAllData}
          notify={notify}
        />
      )}
    </div>
  )
}

function getHeading(
  filter: Filter,
  accountSites: Array<{ site: Site; count: number }>
): string {
  if (filter === 'favorites') return '收藏的入口'
  if (filter.startsWith('site:')) {
    const site = accountSites.find((entry) => entry.site.id === filter.slice(5))
    return site?.site.name ?? '站点账号'
  }
  return '你的登录入口'
}

function safeHostname(value: string): string {
  try {
    return new URL(value).hostname.replace(/^www\./, '')
  } catch {
    return value
  }
}

function formatLastUsed(value?: string): string {
  if (!value) return '尚未使用'
  const date = new Date(value)
  const now = new Date()
  if (date.toDateString() === now.toDateString()) {
    return `今天 ${new Intl.DateTimeFormat('zh-CN', {
      hour: '2-digit',
      minute: '2-digit'
    }).format(date)}`
  }
  return new Intl.DateTimeFormat('zh-CN', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  }).format(date)
}

function toneClass(id: string): string {
  let hash = 0
  for (const char of id) {
    hash = (hash * 31 + char.charCodeAt(0)) >>> 0
  }
  return `monogram--tone-${hash % 4}`
}
