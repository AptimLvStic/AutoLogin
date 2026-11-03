import { forwardRef, useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowRight,
  Check,
  ChevronDown,
  ChevronRight,
  FileText,
  Globe2,
  KeyRound,
  Layers3,
  LoaderCircle,
  LockKeyhole,
  Pencil,
  Plus,
  Search,
  Settings,
  Star,
  UserRound
} from 'lucide-react'
import type { AccountWithSite, AppSettings, LoginBatchState, Site } from '@shared/types'
import { useI18n } from '../i18n'
import { AccountDrawer } from './AccountDrawer'
import { BrandMark } from './Brand'
import { LoginLogsPage } from './LoginLogsPage'
import { SettingsPage, type SettingsModule } from './SettingsPage'

type LibraryView = 'accounts' | 'favorites' | 'logs' | 'settings'
type DrawerState = { mode: 'create'; siteId?: string } | { mode: 'edit'; accountId: string }
type Translate = (
  zhCN: string,
  en: string,
  zhTW: string,
  variables?: Record<string, string | number>
) => string

interface GroupSummary {
  key: string
  name: string
  actualName: string | null
  count: number
  accounts: AccountWithSite[]
}
const UNGROUPED_KEY = '__ungrouped__'

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
  const { tr, language, formatDate } = useI18n()
  const [view, setView] = useState<LibraryView>('accounts')
  const [groupFilter, setGroupFilter] = useState<string | null>(null)
  const [settingsExpanded, setSettingsExpanded] = useState(false)
  const [settingsModule, setSettingsModule] = useState<SettingsModule>('general')
  const [search, setSearch] = useState('')
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set())
  const [favoriteGroups, setFavoriteGroups] = useState<string[]>([])
  const [drawer, setDrawer] = useState<DrawerState | null>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const selectAllRef = useRef<HTMLInputElement>(null)

  const groups = useMemo<GroupSummary[]>(() => {
    const grouped = new Map<string, GroupSummary>()
    for (const site of sites) {
      const actualName = site.group?.trim() || null
      if (!actualName) continue
      if (!grouped.has(actualName)) {
        grouped.set(actualName, {
          key: actualName,
          name: actualName,
          actualName,
          count: 0,
          accounts: []
        })
      }
    }
    for (const account of accounts) {
      const actualName = account.site.group?.trim() || null
      const key = actualName ?? UNGROUPED_KEY
      const current = grouped.get(key) ?? {
        key,
        name: actualName ?? tr('未分组', 'Ungrouped', '未分組'),
        actualName,
        count: 0,
        accounts: []
      }
      current.accounts.push(account)
      current.count += 1
      grouped.set(key, current)
    }

    return [...grouped.values()]
      .map((group) => ({ ...group, accounts: [...group.accounts].sort(compareAccounts) }))
      .sort((left, right) => {
        if (left.actualName === null) return 1
        if (right.actualName === null) return -1
        return left.name.localeCompare(right.name, language)
      })
  }, [accounts, language, sites, tr])

  const favoriteGroupSet = useMemo(() => new Set(favoriteGroups), [favoriteGroups])
  const favoriteAccounts = useMemo(
    () =>
      accounts.filter(
        (account) =>
          account.favorite ||
          Boolean(account.site.group?.trim() && favoriteGroupSet.has(account.site.group.trim()))
      ),
    [accounts, favoriteGroupSet]
  )
  const currentGroup = groupFilter
    ? groups.find((group) => group.key === groupFilter) ?? null
    : null
  const favoriteGroupOptions = groups.filter((group) => Boolean(group.actualName))

  const filteredAccounts = useMemo(() => {
    const query = search.trim().toLocaleLowerCase(language)
    return accounts
      .filter((account) => {
        if (groupFilter && groupKeyFor(account) !== groupFilter) return false
        if (!query) return true
        return [
          account.label,
          account.username,
          account.site.name,
          account.site.startUrl,
          account.site.group ?? ''
        ]
          .join(' ')
          .toLocaleLowerCase(language)
          .includes(query)
      })
      .sort(compareAccounts)
  }, [accounts, groupFilter, language, search])

  const filteredFavorites = useMemo(() => {
    const query = search.trim().toLocaleLowerCase(language)
    if (!query) return favoriteAccounts
    return favoriteAccounts.filter((account) =>
      [account.label, account.username, account.site.name, account.site.group ?? '']
        .join(' ')
        .toLocaleLowerCase(language)
        .includes(query)
    )
  }, [favoriteAccounts, language, search])

  const favoriteGroupsView = useMemo(() => {
    const ids = new Set(filteredFavorites.map((account) => account.id))
    return groups
      .map((group) => ({
        ...group,
        accounts: group.accounts.filter((account) => ids.has(account.id))
      }))
      .filter((group) => group.accounts.length > 0)
  }, [filteredFavorites, groups])

  const visibleSelectedIds = useMemo(
    () =>
      filteredAccounts.filter((account) => selectedIds.has(account.id)).map((account) => account.id),
    [filteredAccounts, selectedIds]
  )
  const allVisibleSelected =
    filteredAccounts.length > 0 && visibleSelectedIds.length === filteredAccounts.length
  const someVisibleSelected = visibleSelectedIds.length > 0 && !allVisibleSelected
  const selectedAccountCount = selectedIds.size
  const drawerAccount =
    drawer?.mode === 'edit'
      ? accounts.find((account) => account.id === drawer.accountId) ?? null
      : null

  useEffect(() => {
    let cancelled = false
    void window.autologin.groups
      .listFavorites()
      .then((next) => {
        if (!cancelled) setFavoriteGroups(next)
      })
      .catch(() => {
        if (!cancelled) setFavoriteGroups([])
      })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    setSelectedIds((current) => {
      const accountIds = new Set(accounts.map((account) => account.id))
      const next = new Set([...current].filter((id) => accountIds.has(id)))
      return next.size === current.size ? current : next
    })
  }, [accounts])

  useEffect(() => {
    if (selectAllRef.current) {
      selectAllRef.current.indeterminate = someVisibleSelected
    }
  }, [someVisibleSelected])

  useEffect(() => {
    if (view !== 'accounts') setSelectedIds(new Set())
  }, [view])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        if (view !== 'accounts' && view !== 'favorites') return
        event.preventDefault()
        searchRef.current?.focus()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [view])

  async function refreshAll(): Promise<void> {
    const [, nextFavoriteGroups] = await Promise.all([
      onRefresh(),
      window.autologin.groups.listFavorites()
    ])
    setFavoriteGroups(nextFavoriteGroups)
  }

  function switchView(next: LibraryView): void {
    setView(next)
    setSearch('')
    setGroupFilter(null)
    setSelectedIds(new Set())
  }

  function chooseAllAccounts(): void {
    setView('accounts')
    setGroupFilter(null)
    setSearch('')
    setSelectedIds(new Set())
  }

  function chooseGroup(group: GroupSummary): void {
    setView('accounts')
    setGroupFilter(group.key)
    setSearch('')
    setSelectedIds(new Set())
  }

  function toggleSettings(): void {
    if (view !== 'settings') {
      setView('settings')
      setSettingsExpanded(true)
      return
    }
    setSettingsExpanded((value) => !value)
  }

  function chooseSettingsModule(next: SettingsModule): void {
    setView('settings')
    setSettingsModule(next)
    setSettingsExpanded(true)
    setSearch('')
    setSelectedIds(new Set())
  }

  async function toggleAccountFavorite(account: AccountWithSite): Promise<void> {
    try {
      await window.autologin.accounts.update(account.id, { favorite: !account.favorite })
      await onRefresh()
    } catch (error) {
      notify(
        'error',
        error instanceof Error
          ? error.message
          : tr('收藏状态更新失败', 'Could not update favorite.', '收藏狀態更新失敗')
      )
    }
  }

  async function toggleGroupFavorite(group: GroupSummary): Promise<void> {
    if (!group.actualName) return
    try {
      const next = await window.autologin.groups.setFavorite(
        group.actualName,
        !favoriteGroupSet.has(group.actualName)
      )
      setFavoriteGroups(next)
    } catch (error) {
      notify(
        'error',
        error instanceof Error
          ? error.message
          : tr('分组收藏更新失败', 'Could not update group favorite.', '分組收藏更新失敗')
      )
    }
  }

  function toggleAccountSelection(accountId: string): void {
    setSelectedIds((current) => {
      const next = new Set(current)
      if (next.has(accountId)) next.delete(accountId)
      else next.add(accountId)
      return next
    })
  }

  function toggleSelectAll(): void {
    setSelectedIds((current) => {
      const next = new Set(current)
      if (allVisibleSelected) {
        for (const account of filteredAccounts) next.delete(account.id)
      } else {
        for (const account of filteredAccounts) next.add(account.id)
      }
      return next
    })
  }

  async function openSelected(): Promise<void> {
    if (selectedIds.size === 0) return
    const opened = await onStartBatch([...selectedIds])
    if (opened) setSelectedIds(new Set())
  }

  async function openAccount(account: AccountWithSite): Promise<void> {
    const opened = await onStartBatch([account.id])
    if (opened) setDrawer(null)
  }

  async function clearAllData(): Promise<void> {
    await window.autologin.app.clearAllData()
    onCleared()
  }

  function handleSaved(_account: AccountWithSite, message: string): void {
    setDrawer(null)
    void refreshAll()
    notify('success', message)
  }

  function handleDeleted(): void {
    setDrawer(null)
    void refreshAll()
    notify('success', tr('账号已删除', 'Account deleted.', '帳號已刪除'))
  }

  const headerTitle =
    view === 'favorites'
      ? tr('收藏', 'Favorites', '收藏')
      : currentGroup?.name ?? tr('全部账号', 'All accounts', '全部帳號')
  const headerDescription =
    view === 'favorites'
      ? tr(
          `${favoriteAccounts.length} 个收藏账号，支持账号与分组收藏`,
          `${favoriteAccounts.length} favorite account${favoriteAccounts.length === 1 ? '' : 's'}, by account or group`,
          `${favoriteAccounts.length} 個收藏帳號，支援帳號與分組收藏`
        )
      : tr(
          `${filteredAccounts.length} 个账号，${groups.length} 个分组`,
          `${filteredAccounts.length} account${filteredAccounts.length === 1 ? '' : 's'} in ${groups.length} group${groups.length === 1 ? '' : 's'}`,
          `${filteredAccounts.length} 個帳號，${groups.length} 個分組`
        )

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <BrandMark />

        <nav className="sidebar-nav sidebar-nav--grouped" aria-label={tr('主导航', 'Main navigation', '主導覽')}>
          <section className="sidebar-section">
            <span className="sidebar-label">{tr('工作台', 'Workspace', '工作台')}</span>
            <button
              className={`sidebar-nav__item${view === 'accounts' ? ' is-active' : ''}`}
              onClick={chooseAllAccounts}
            >
              <KeyRound size={17} />
              <span>{tr('账号', 'Accounts', '帳號')}</span>
              <small>{accounts.length}</small>
            </button>
            <button
              className={`sidebar-nav__item${view === 'favorites' ? ' is-active' : ''}`}
              onClick={() => switchView('favorites')}
            >
              <Star size={17} />
              <span>{tr('收藏', 'Favorites', '收藏')}</span>
              <small>{favoriteAccounts.length}</small>
            </button>
            <button
              className={`sidebar-nav__item${view === 'logs' ? ' is-active' : ''}`}
              onClick={() => switchView('logs')}
            >
              <FileText size={17} />
              <span>{tr('登录日志', 'Login history', '登入日誌')}</span>
            </button>
          </section>

          <section className="sidebar-section sidebar-section--preferences">
            <span className="sidebar-label">{tr('偏好设置', 'Preferences', '偏好設定')}</span>
            <button
              className={`sidebar-nav__item sidebar-nav__item--expandable sidebar-nav__item--settings${
                view === 'settings' ? ' is-active' : ''
              }`}
              onClick={toggleSettings}
              aria-expanded={settingsExpanded}
            >
              <Settings size={17} />
              <span>{tr('设置', 'Settings', '設定')}</span>
              {settingsExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            </button>
            <div
              className={`sidebar-accordion${settingsExpanded ? ' is-expanded' : ''}`}
              aria-hidden={!settingsExpanded}
            >
              <div className="sidebar-accordion__inner">
                <button
                  className={`sidebar-child-item${view === 'settings' && settingsModule === 'general' ? ' is-active' : ''}`}
                  onClick={() => chooseSettingsModule('general')}
                  tabIndex={settingsExpanded ? 0 : -1}
                >
                  {tr('通用设置', 'General', '一般設定')}
                </button>
                <button
                  className={`sidebar-child-item${view === 'settings' && settingsModule === 'appearance' ? ' is-active' : ''}`}
                  onClick={() => chooseSettingsModule('appearance')}
                  tabIndex={settingsExpanded ? 0 : -1}
                >
                  {tr('外观主题', 'Appearance', '外觀主題')}
                </button>
                <button
                  className={`sidebar-child-item${view === 'settings' && settingsModule === 'network' ? ' is-active' : ''}`}
                  onClick={() => chooseSettingsModule('network')}
                  tabIndex={settingsExpanded ? 0 : -1}
                >
                  {tr('网络代理', 'Network proxy', '網路代理')}
                </button>
                <button
                  className={`sidebar-child-item${view === 'settings' && settingsModule === 'security' ? ' is-active' : ''}`}
                  onClick={() => chooseSettingsModule('security')}
                  tabIndex={settingsExpanded ? 0 : -1}
                >
                  {tr('安全与隐私', 'Security & privacy', '安全性與隱私')}
                </button>
                <button
                  className={`sidebar-child-item${view === 'settings' && settingsModule === 'data' ? ' is-active' : ''}`}
                  onClick={() => chooseSettingsModule('data')}
                  tabIndex={settingsExpanded ? 0 : -1}
                >
                  {tr('数据与备份', 'Data & backups', '資料與備份')}
                </button>
                <button
                  className={`sidebar-child-item${view === 'settings' && settingsModule === 'about' ? ' is-active' : ''}`}
                  onClick={() => chooseSettingsModule('about')}
                  tabIndex={settingsExpanded ? 0 : -1}
                >
                  {tr('关于与更新', 'About & updates', '關於與更新')}
                </button>
              </div>
            </div>
          </section>
        </nav>

        <div className="sidebar-bottom">
          <div className="vault-indicator">
            <span className="vault-indicator__pulse" />
            <div>
              <strong>{tr('保险库已解锁', 'Vault unlocked', '保險庫已解鎖')}</strong>
              <small>
                {tr(
                  `闲置 ${settings.autoLockMinutes} 分钟锁定`,
                  `Locks after ${settings.autoLockMinutes} min`,
                  `閒置 ${settings.autoLockMinutes} 分鐘鎖定`
                )}
              </small>
            </div>
          </div>
          <div className="sidebar-actions">
            <button className="sidebar-action" onClick={() => void onLock()}>
              <LockKeyhole size={17} />
              {tr('立即锁定', 'Lock now', '立即鎖定')}
            </button>
          </div>
        </div>
      </aside>

      <main className="library-main">
        <div className="library-content-scroll">
          {(view === 'accounts' || view === 'favorites') && (
            <div className={`library-view-layout${view === 'accounts' ? ' library-view-layout--accounts' : ''}`}>
              {view === 'accounts' && (
                <aside
                  className="account-subnav"
                  aria-label={tr('账号分组', 'Account groups', '帳號分組')}
                >
                  <span className="account-subnav__label">
                    {tr('账号', 'Accounts', '帳號')}
                  </span>
                  <button
                    type="button"
                    className={`account-subnav__item${groupFilter === null ? ' is-active' : ''}`}
                    onClick={chooseAllAccounts}
                  >
                    <KeyRound size={15} />
                    <span>{tr('全部账号', 'All accounts', '全部帳號')}</span>
                    <small>{accounts.length}</small>
                  </button>
                  {groups
                    .filter((group) => group.actualName)
                    .map((group) => (
                      <button
                        type="button"
                        key={group.key}
                        className={`account-subnav__item${
                          groupFilter === group.key ? ' is-active' : ''
                        }`}
                        onClick={() => chooseGroup(group)}
                      >
                        <Layers3 size={15} />
                        <span>{group.name}</span>
                        <small>{group.count}</small>
                      </button>
                    ))}
                  <button
                    type="button"
                    className={`account-subnav__item${
                      groupFilter === UNGROUPED_KEY ? ' is-active' : ''
                    }`}
                    onClick={() => {
                      const ungrouped = groups.find((group) => group.key === UNGROUPED_KEY)
                      if (ungrouped) chooseGroup(ungrouped)
                      else {
                        setView('accounts')
                        setGroupFilter(UNGROUPED_KEY)
                      }
                    }}
                  >
                    <Globe2 size={15} />
                    <span>{tr('未分组', 'Ungrouped', '未分組')}</span>
                    <small>
                      {groups.find((group) => group.key === UNGROUPED_KEY)?.count ?? 0}
                    </small>
                  </button>
                </aside>
              )}
              <div className="library-view-main">
              <header className="library-header">
                <div>
                  <span className="eyebrow">
                    {view === 'favorites' ? 'CURATED LOGIN ENTRIES' : 'LOCAL LOGIN WORKSPACE'}
                  </span>
                  <h1>{headerTitle}</h1>
                  <p>{headerDescription}</p>
                </div>
                <div className="library-header__actions">
                  {batchState && batchState.total > 0 && (
                    <button
                      type="button"
                      className={`batch-status${batchState.active ? ' is-active' : ''}${
                        batchState.failed > 0 ? ' has-failures' : ''
                      }`}
                      onClick={() => switchView('logs')}
                      aria-label={tr('查看登录结果日志', 'View login result logs', '查看登入結果日誌')}
                    >
                      {batchState.active ? (
                        <LoaderCircle size={14} className="spin" />
                      ) : (
                        <span className="batch-status__dot" />
                      )}
                      <span>
                        {tr('成功', 'Success', '成功')} {batchState.success} / {tr('失败', 'Failed', '失敗')}{' '}
                        {batchState.failed}
                        {batchState.manual > 0
                          ? ` · ${tr('待人工', 'Manual', '待人工')} ${batchState.manual}`
                          : ''}
                      </span>
                    </button>
                  )}
                  {view === 'accounts' && (
                    <button
                      className="button button--primary"
                      onClick={() => setDrawer({ mode: 'create' })}
                    >
                      <Plus size={17} />
                      {tr('添加账号', 'Add account', '新增帳號')}
                    </button>
                  )}
                </div>
              </header>

              <div className="library-toolbar">
                <label className="search-field">
                  <Search size={17} />
                  <input
                    ref={searchRef}
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder={
                      view === 'favorites'
                        ? tr('搜索收藏账号', 'Search favorite accounts', '搜尋收藏帳號')
                        : tr(
                            '搜索站点、账号、用户名或分组',
                            'Search sites, accounts, usernames or groups',
                            '搜尋站點、帳號、使用者名稱或分組'
                          )
                    }
                    aria-label={tr('搜索账号', 'Search accounts', '搜尋帳號')}
                  />
                  <kbd>Ctrl K</kbd>
                </label>
                <span className="result-count">
                  {view === 'favorites' ? filteredFavorites.length : filteredAccounts.length}{' '}
                  {(view === 'favorites' ? filteredFavorites.length : filteredAccounts.length) === 1
                    ? 'ACCOUNT'
                    : 'ACCOUNTS'}
                </span>
              </div>

              {view === 'accounts' && selectedAccountCount > 0 && (
                <div className="log-bulk-bar work-bulk-bar" aria-live="polite">
                  <span>
                    <strong>{selectedAccountCount}</strong>{' '}
                    {tr('个账号已选', 'accounts selected', '個帳號已選')}
                  </span>
                  <div>
                    <button className="text-button" onClick={() => setSelectedIds(new Set())}>
                      {tr('取消选择', 'Clear selection', '取消選擇')}
                    </button>
                    <button
                      className="button button--primary"
                      onClick={() => void openSelected()}
                      disabled={Boolean(batchState?.active)}
                    >
                      <Layers3 size={15} />
                      {tr('打开已选', 'Open selected', '開啟已選')}
                    </button>
                  </div>
                </div>
              )}

              {view === 'accounts' ? (
                <section className="account-list" aria-live="polite">
                  <div className="account-list__header accounts-table__header">
                    <SelectionCheckbox
                      ref={selectAllRef}
                      checked={allVisibleSelected}
                      label={tr(
                        '选择当前列表全部账号',
                        'Select all visible accounts',
                        '選擇目前列表全部帳號'
                      )}
                      onChange={toggleSelectAll}
                      disabled={filteredAccounts.length === 0}
                    />
                    <span>{tr('站点', 'Site', '站點')}</span>
                    <span>{tr('用户名', 'Username', '使用者名稱')}</span>
                    <span>{tr('状态', 'Status', '狀態')}</span>
                    <span />
                  </div>

                  {filteredAccounts.map((account, index) => (
                    <AccountListRow
                      key={account.id}
                      account={account}
                      checked={selectedIds.has(account.id)}
                      index={index}
                      tr={tr}
                      formatLastUsed={(value) => formatLastUsed(value, tr, formatDate)}
                      onToggleSelection={() => toggleAccountSelection(account.id)}
                      onToggleFavorite={() => void toggleAccountFavorite(account)}
                      onEdit={() => setDrawer({ mode: 'edit', accountId: account.id })}
                      onLogin={() => void openAccount(account)}
                    />
                  ))}

                  {accounts.length === 0 && (
                    <EmptyState
                      title={tr(
                        '把第一个账号交给 AutoLogin',
                        'Add your first account',
                        '把第一個帳號交給 AutoLogin'
                      )}
                      description={tr(
                        '添加站点和账号，之后只需一次点击即可在默认浏览器中完成登录。',
                        'Add a site and account, then open it in your default browser with one click.',
                        '新增站點和帳號，之後只需一次點擊即可在預設瀏覽器中完成登入。'
                      )}
                      actionLabel={tr('添加第一个账号', 'Add first account', '新增第一個帳號')}
                      onAction={() => setDrawer({ mode: 'create' })}
                    />
                  )}

                  {accounts.length > 0 && filteredAccounts.length === 0 && (
                    <CompactEmptyState
                      title={tr('没有匹配的账号', 'No matching accounts', '沒有符合的帳號')}
                      description={tr(
                        '尝试更换关键词或切换左侧分组。',
                        'Try another search or group.',
                        '嘗試更換關鍵字或切換左側分組。'
                      )}
                    />
                  )}
                </section>
              ) : (
                <div className="favorite-workspace">
                  {favoriteGroupOptions.length > 0 && (
                    <section className="favorite-group-picker">
                      <header className="favorite-group-picker__header">
                        <div className="favorite-group-picker__heading">
                          <span className="favorite-group__icon">
                            <Layers3 size={15} />
                          </span>
                          <div>
                            <h3>{tr('收藏分组', 'Favorite groups', '收藏分組')}</h3>
                            <p>
                              {tr(
                                '收藏整个分组后，组内账号会一并显示在收藏中。',
                                'Favorite a whole group to include all of its accounts in Favorites.',
                                '收藏整個分組後，組內帳號會一併顯示在收藏中。'
                              )}
                            </p>
                          </div>
                        </div>
                        <span className="favorite-group-picker__count">
                          {favoriteGroups.length} {tr('个分组已收藏', 'groups favorited', '個分組已收藏')}
                        </span>
                      </header>
                      <div className="favorite-group-picker__list">
                        {favoriteGroupOptions.map((group) => {
                          const active = favoriteGroupSet.has(group.actualName!)
                          return (
                            <button
                              type="button"
                              key={group.key}
                              className={`favorite-group-picker__row${active ? ' is-active' : ''}`}
                              aria-pressed={active}
                              onClick={() => void toggleGroupFavorite(group)}
                            >
                              <span className="favorite-group-picker__identity">
                                <strong>{group.name}</strong>
                                <small>
                                  {group.count} {tr('个账号', 'accounts', '個帳號')}
                                </small>
                              </span>
                              <span className="favorite-group-picker__action">
                                <Star size={15} fill={active ? 'currentColor' : 'none'} />
                                {active
                                  ? tr('已收藏', 'Favorited', '已收藏')
                                  : tr('收藏分组', 'Favorite', '收藏分組')}
                              </span>
                            </button>
                          )
                        })}
                      </div>
                    </section>
                  )}

                  <section className="favorite-accounts">
                    <header className="favorite-accounts__header">
                      <div>
                        <h3>{tr('收藏账号', 'Favorite accounts', '收藏帳號')}</h3>
                        <p>
                          {tr(
                            '账号收藏和分组收藏中的账号会集中显示在这里。',
                            'Accounts favorited directly or through a group appear here.',
                            '帳號收藏和分組收藏中的帳號會集中顯示在這裡。'
                          )}
                        </p>
                      </div>
                      <span>{filteredFavorites.length}</span>
                    </header>

                    {favoriteAccounts.length === 0 ? (
                      <CompactEmptyState
                        title={tr('还没有收藏账号', 'No favorite accounts yet', '還沒有收藏帳號')}
                        description={tr(
                          '在账号编辑面板中收藏账号，或在上方收藏一个分组。',
                          'Favorite an account in its edit panel, or favorite a group above.',
                          '在帳號編輯面板中收藏帳號，或在上方收藏一個分組。'
                        )}
                      />
                    ) : filteredFavorites.length === 0 ? (
                      <CompactEmptyState
                        title={tr('没有匹配的收藏', 'No matching favorites', '沒有符合的收藏')}
                        description={tr('尝试更换搜索关键词。', 'Try another search.', '嘗試更換搜尋關鍵字。')}
                      />
                    ) : (
                      <div className="favorite-groups">
                        {favoriteGroupsView.map((group) => (
                          <section className="favorite-group" key={group.key}>
                            <header className="favorite-group__header">
                              <div className="favorite-group__identity">
                                <span className="favorite-group__icon">
                                  <Layers3 size={15} />
                                </span>
                                <div>
                                  <h3>{group.name}</h3>
                                  <span>
                                    {group.accounts.length} {tr('个账号', 'accounts', '個帳號')}
                                  </span>
                                </div>
                              </div>
                            </header>
                            <div className="account-list favorite-group__list">
                              {group.accounts.map((account, index) => (
                                <AccountListRow
                                  key={account.id}
                                  account={account}
                                  checked={false}
                                  index={index}
                                  showSelection={false}
                                  showFavorite
                                  tr={tr}
                                  formatLastUsed={(value) => formatLastUsed(value, tr, formatDate)}
                                  onToggleFavorite={() => void toggleAccountFavorite(account)}
                                  onEdit={() => setDrawer({ mode: 'edit', accountId: account.id })}
                                  onLogin={() => void openAccount(account)}
                                />
                              ))}
                            </div>
                          </section>
                        ))}
                      </div>
                    )}
                  </section>
                </div>
              )}
              </div>
            </div>
          )}

          {view === 'logs' && (
            <LoginLogsPage
              sites={sites}
              accounts={accounts}
              favoriteGroups={favoriteGroups}
              notify={notify}
            />
          )}

          {view === 'settings' && (
            <SettingsPage
              module={settingsModule}
              settings={settings}
              appVersion={appVersion}
              onSettingsChange={async (patch) => {
                await window.autologin.settings.update(patch)
                await onRefresh()
              }}
              onRefresh={onRefresh}
              onClearAllData={clearAllData}
              notify={notify}
            />
          )}
        </div>
      </main>

      {drawer && (drawer.mode === 'create' || drawerAccount) && (
        <AccountDrawer
          mode={drawer.mode}
          account={drawer.mode === 'edit' ? drawerAccount ?? undefined : undefined}
          sites={sites}
          initialSiteId={drawer.mode === 'create' ? drawer.siteId : undefined}
          onClose={() => setDrawer(null)}
          onSaved={handleSaved}
          onDeleted={handleDeleted}
          onRecord={drawerAccount ? () => onRecord(drawerAccount) : undefined}
          onChanged={refreshAll}
          notify={notify}
        />
      )}
    </div>
  )
}

function AccountListRow({
  account,
  checked,
  index,
  showSelection = true,
  showFavorite = true,
  tr,
  formatLastUsed,
  onToggleSelection,
  onToggleFavorite,
  onEdit,
  onLogin
}: {
  account: AccountWithSite
  checked: boolean
  index: number
  showSelection?: boolean
  showFavorite?: boolean
  tr: Translate
  formatLastUsed: (value?: string) => string
  onToggleSelection?: () => void
  onToggleFavorite?: () => void
  onEdit: () => void
  onLogin: () => void
}): React.JSX.Element {
  return (
    <article
      className={`account-row${showSelection ? '' : ' account-row--favorite'}${
        checked ? ' is-selected' : ''
      }`}
      style={{ '--row-index': index } as React.CSSProperties}
      onClick={onEdit}
    >
      {showSelection && (
        <SelectionCheckbox
          checked={checked}
          label={tr(
            `选择站点 ${account.site.name}`,
            `Select ${account.site.name}`,
            `選擇站點 ${account.site.name}`
          )}
          onChange={() => onToggleSelection?.()}
        />
      )}
      <div className="account-identity">
        <span className={`monogram ${toneClass(account.siteId)}`}>
          {account.site.name.slice(0, 1).toUpperCase()}
        </span>
        <div>
          <div className="account-name-line">
            <strong>{account.site.name}</strong>
            {account.favorite && <Star size={13} fill="currentColor" />}
          </div>
          <span>
            {account.username}
            <em>·</em>
            {displayGroup(account, tr)}
          </span>
        </div>
      </div>
      <div className="account-username">
        <UserRound size={14} />
        <span>
          <strong>{account.username}</strong>
          <small>{formatLastUsed(account.lastUsedAt)}</small>
        </span>
      </div>
      <div>
        <span
          className={`recipe-badge${
            (account.recipes?.length ?? 0) > 0 || account.site.recipe ? ' is-recorded' : ''
          }`}
        >
          <span />
          {(account.recipes?.length ?? 0) > 0 || account.site.recipe
            ? tr('已录制', 'Recorded', '已錄製')
            : tr('自动识别', 'Auto detect', '自動識別')}
        </span>
      </div>
      <div className="account-actions">
        {showFavorite && (
          <button
            className={`icon-button icon-button--small${account.favorite ? ' is-active' : ''}`}
            onClick={(event) => {
              event.stopPropagation()
              onToggleFavorite?.()
            }}
            aria-label={
              account.favorite
                ? tr('取消账号收藏', 'Remove account favorite', '取消帳號收藏')
                : tr('收藏账号', 'Favorite account', '收藏帳號')
            }
          >
            <Star size={15} fill={account.favorite ? 'currentColor' : 'none'} />
          </button>
        )}
        <button
          className="row-login-button"
          onClick={(event) => {
            event.stopPropagation()
            onLogin()
          }}
        >
          {tr('登录', 'Sign in', '登入')}
          <ArrowRight size={15} />
        </button>
        <button
          className="row-edit-button"
          onClick={(event) => {
            event.stopPropagation()
            onEdit()
          }}
        >
          {tr('编辑', 'Edit', '編輯')}
          <Pencil size={14} />
        </button>
      </div>
    </article>
  )
}

const SelectionCheckbox = forwardRef<
  HTMLInputElement,
  {
    checked: boolean
    label: string
    onChange: () => void
    disabled?: boolean
  }
>(function SelectionCheckbox({ checked, label, onChange, disabled }, ref): React.JSX.Element {
  return (
    <label
      className={`selection-checkbox${checked ? ' is-checked' : ''}`}
      onClick={(event) => event.stopPropagation()}
    >
      <input
        ref={ref}
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={onChange}
        aria-label={label}
      />
      <span aria-hidden="true">
        <Check size={12} />
      </span>
    </label>
  )
})

function EmptyState({
  title,
  description,
  actionLabel,
  onAction
}: {
  title: string
  description: string
  actionLabel: string
  onAction: () => void
}): React.JSX.Element {
  return (
    <div className="empty-state">
      <div className="empty-state__art" aria-hidden="true">
        <span />
        <span />
        <span>
          <KeyRound size={27} strokeWidth={1.6} />
        </span>
      </div>
      <span className="eyebrow">YOUR FIRST LOGIN</span>
      <h2>{title}</h2>
      <p>{description}</p>
      <button className="button button--primary" onClick={onAction}>
        <Plus size={17} />
        {actionLabel}
      </button>
    </div>
  )
}

function CompactEmptyState({
  title,
  description
}: {
  title: string
  description: string
}): React.JSX.Element {
  return (
    <div className="empty-state empty-state--compact">
      <Globe2 size={26} />
      <h2>{title}</h2>
      <p>{description}</p>
    </div>
  )
}

function compareAccounts(left: AccountWithSite, right: AccountWithSite): number {
  return (
    new Date(right.lastUsedAt ?? right.updatedAt).getTime() -
    new Date(left.lastUsedAt ?? left.updatedAt).getTime()
  )
}

function groupKeyFor(account: AccountWithSite): string {
  return account.site.group?.trim() || UNGROUPED_KEY
}

function displayGroup(account: AccountWithSite, tr: Translate): string {
  return account.site.group?.trim() || tr('未分组', 'Ungrouped', '未分組')
}

function formatLastUsed(
  value: string | undefined,
  tr: Translate,
  formatDate: (value: string | number | Date, options?: Intl.DateTimeFormatOptions) => string
): string {
  if (!value) return tr('尚未使用', 'Not used yet', '尚未使用')
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return tr('时间未知', 'Unknown time', '時間未知')
  const now = new Date()
  if (date.toDateString() === now.toDateString()) {
    return tr(
      `今天 ${formatDate(date, { hour: '2-digit', minute: '2-digit' })}`,
      `Today ${formatDate(date, { hour: '2-digit', minute: '2-digit' })}`,
      `今天 ${formatDate(date, { hour: '2-digit', minute: '2-digit' })}`
    )
  }
  return formatDate(date, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  })
}

function toneClass(id: string): string {
  let hash = 0
  for (const char of id) hash = (hash * 31 + char.charCodeAt(0)) >>> 0
  return `monogram--tone-${hash % 4}`
}
