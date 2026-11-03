import { forwardRef, useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowRight,
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  FileText,
  Globe2,
  KeyRound,
  Layers3,
  LoaderCircle,
  LockKeyhole,
  PanelLeftClose,
  PanelLeftOpen,
  Pencil,
  Plus,
  Search,
  Settings,
  SlidersHorizontal,
  Star,
  Trash2,
  UserRound
} from 'lucide-react'
import type {
  AccountWithSite,
  AppSettings,
  LoginBatchState,
  LoginStrategy,
  ManualLoginSelectors,
  Site
} from '@shared/types'
import { useI18n } from '../i18n'
import { AccountDrawer } from './AccountDrawer'
import { LoginLogsPage } from './LoginLogsPage'
import { ConfirmDialog, Modal } from './Modal'
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
  const [collapsedSettingsOpen, setCollapsedSettingsOpen] = useState(false)
  const [collapsedSettingsPosition, setCollapsedSettingsPosition] = useState({
    top: 120,
    left: 78
  })
  const [sidebarCollapsed, setSidebarCollapsed] = useState(
    () => window.localStorage.getItem('autologin.sidebar.collapsed') === '1'
  )
  const [search, setSearch] = useState('')
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set())
  const [favoriteGroups, setFavoriteGroups] = useState<string[]>([])
  const [drawer, setDrawer] = useState<DrawerState | null>(null)
  const [groupMenu, setGroupMenu] = useState<{
    group: GroupSummary
    left: number
    top: number
  } | null>(null)
  const [renameGroupTarget, setRenameGroupTarget] = useState<GroupSummary | null>(null)
  const [renameGroupValue, setRenameGroupValue] = useState('')
  const [deleteGroupTarget, setDeleteGroupTarget] = useState<GroupSummary | null>(null)
  const [groupActionBusy, setGroupActionBusy] = useState(false)
  const [batchStrategyOpen, setBatchStrategyOpen] = useState(false)
  const [batchStrategy, setBatchStrategy] = useState<LoginStrategy>('auto')
  const [batchSelectors, setBatchSelectors] = useState<ManualLoginSelectors>({})
  const [batchStrategyError, setBatchStrategyError] = useState('')
  const [batchStrategyBusy, setBatchStrategyBusy] = useState(false)
  const [duplicateBusy, setDuplicateBusy] = useState(false)
  const searchRef = useRef<HTMLInputElement>(null)
  const selectAllRef = useRef<HTMLInputElement>(null)
  const settingsButtonRef = useRef<HTMLButtonElement>(null)
  const settingsPopoverRef = useRef<HTMLDivElement>(null)
  const collapsedSettingsCloseTimer = useRef<number | null>(null)

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
      ).sort(compareAccounts),
    [accounts, favoriteGroupSet]
  )
  const currentGroup = groupFilter
    ? groups.find((group) => group.key === groupFilter) ?? null
    : null

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

  const visibleSelectedIds = useMemo(
    () =>
      filteredAccounts.filter((account) => selectedIds.has(account.id)).map((account) => account.id),
    [filteredAccounts, selectedIds]
  )
  const allVisibleSelected =
    filteredAccounts.length > 0 && visibleSelectedIds.length === filteredAccounts.length
  const someVisibleSelected = visibleSelectedIds.length > 0 && !allVisibleSelected
  const selectedAccountCount = selectedIds.size
  const selectedAccounts = useMemo(
    () => accounts.filter((account) => selectedIds.has(account.id)),
    [accounts, selectedIds]
  )
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
    if (!collapsedSettingsOpen) return
    const closeOnPointer = (event: PointerEvent): void => {
      const target = event.target as Node
      if (
        settingsButtonRef.current?.contains(target) ||
        settingsPopoverRef.current?.contains(target)
      ) {
        return
      }
      setCollapsedSettingsOpen(false)
    }
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setCollapsedSettingsOpen(false)
    }
    document.addEventListener('pointerdown', closeOnPointer)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('pointerdown', closeOnPointer)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [collapsedSettingsOpen])

  useEffect(() => {
    if (!sidebarCollapsed) setCollapsedSettingsOpen(false)
  }, [sidebarCollapsed])

  useEffect(() => {
    if (!groupMenu) return
    const closeMenu = (): void => setGroupMenu(null)
    const closeOnPointer = (event: PointerEvent): void => {
      if (
        event.target instanceof Element &&
        event.target.closest('.group-context-menu')
      ) {
        return
      }
      closeMenu()
    }
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setGroupMenu(null)
    }
    document.addEventListener('pointerdown', closeOnPointer)
    document.addEventListener('keydown', closeOnEscape)
    window.addEventListener('blur', closeMenu)
    return () => {
      document.removeEventListener('pointerdown', closeOnPointer)
      document.removeEventListener('keydown', closeOnEscape)
      window.removeEventListener('blur', closeMenu)
    }
  }, [groupMenu])

  useEffect(() => {
    return () => {
      if (collapsedSettingsCloseTimer.current) {
        window.clearTimeout(collapsedSettingsCloseTimer.current)
      }
    }
  }, [])

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
    if (sidebarCollapsed) {
      openCollapsedSettings()
      return
    }
    if (view !== 'settings') {
      setView('settings')
      setSettingsExpanded(true)
      return
    }
    setSettingsExpanded((value) => !value)
  }

  function openCollapsedSettings(): void {
    if (!sidebarCollapsed) return
    if (collapsedSettingsCloseTimer.current) {
      window.clearTimeout(collapsedSettingsCloseTimer.current)
      collapsedSettingsCloseTimer.current = null
    }
    const rect = settingsButtonRef.current?.getBoundingClientRect()
    if (rect) {
      setCollapsedSettingsPosition({
        top: Math.max(52, Math.min(rect.top, window.innerHeight - 350)),
        left: rect.right + 10
      })
    }
    setCollapsedSettingsOpen(true)
  }

  function scheduleCollapsedSettingsClose(): void {
    if (collapsedSettingsCloseTimer.current) {
      window.clearTimeout(collapsedSettingsCloseTimer.current)
    }
    collapsedSettingsCloseTimer.current = window.setTimeout(() => {
      setCollapsedSettingsOpen(false)
      collapsedSettingsCloseTimer.current = null
    }, 140)
  }

  function keepCollapsedSettingsOpen(): void {
    if (collapsedSettingsCloseTimer.current) {
      window.clearTimeout(collapsedSettingsCloseTimer.current)
      collapsedSettingsCloseTimer.current = null
    }
  }

  function toggleSidebar(): void {
    setSidebarCollapsed((current) => {
      const next = !current
      window.localStorage.setItem('autologin.sidebar.collapsed', next ? '1' : '0')
      return next
    })
  }

  function chooseSettingsModule(next: SettingsModule): void {
    setView('settings')
    setSettingsModule(next)
    setSettingsExpanded(true)
    setSearch('')
    setSelectedIds(new Set())
    setCollapsedSettingsOpen(false)
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

  function openGroupMenu(
    event: React.MouseEvent<HTMLButtonElement>,
    group: GroupSummary
  ): void {
    event.preventDefault()
    event.stopPropagation()
    setGroupMenu({
      group,
      left: Math.max(8, Math.min(event.clientX, window.innerWidth - 196)),
      top: Math.max(8, Math.min(event.clientY, window.innerHeight - 158))
    })
  }

  function openGroupMenuFromKeyboard(
    event: React.KeyboardEvent<HTMLButtonElement>,
    group: GroupSummary
  ): void {
    if (event.key !== 'ContextMenu' && !(event.shiftKey && event.key === 'F10')) {
      return
    }
    event.preventDefault()
    const rect = event.currentTarget.getBoundingClientRect()
    setGroupMenu({
      group,
      left: Math.max(8, Math.min(rect.right + 6, window.innerWidth - 196)),
      top: Math.max(8, Math.min(rect.top, window.innerHeight - 158))
    })
  }

  async function renameSelectedGroup(): Promise<void> {
    if (!renameGroupTarget?.actualName) return
    const nextName = renameGroupValue.trim()
    if (!nextName || nextName === renameGroupTarget.actualName) {
      setRenameGroupTarget(null)
      return
    }
    setGroupActionBusy(true)
    try {
      await window.autologin.groups.rename(renameGroupTarget.actualName, nextName)
      if (groupFilter === renameGroupTarget.key) setGroupFilter(nextName)
      await refreshAll()
      setRenameGroupTarget(null)
      notify('success', tr('分组已重命名', 'Group renamed.', '分組已重新命名'))
    } catch (error) {
      notify(
        'error',
        error instanceof Error
          ? error.message
          : tr('重命名分组失败', 'Could not rename group.', '重新命名分組失敗')
      )
    } finally {
      setGroupActionBusy(false)
    }
  }

  async function deleteSelectedGroup(): Promise<void> {
    if (!deleteGroupTarget?.actualName) return
    setGroupActionBusy(true)
    try {
      const count = await window.autologin.groups.delete(deleteGroupTarget.actualName)
      if (groupFilter === deleteGroupTarget.key) setGroupFilter(null)
      await refreshAll()
      setDeleteGroupTarget(null)
      notify(
        'success',
        tr(
          `分组已删除，${count} 个站点已移至未分组`,
          `Group deleted. ${count} sites moved to Ungrouped.`,
          `分組已刪除，${count} 個站點已移至未分組`
        )
      )
    } catch (error) {
      notify(
        'error',
        error instanceof Error
          ? error.message
          : tr('删除分组失败', 'Could not delete group.', '刪除分組失敗')
      )
    } finally {
      setGroupActionBusy(false)
    }
  }

  function openBatchStrategy(): void {
    if (selectedAccounts.length === 0) return
    const strategies = new Set(selectedAccounts.map((account) => account.loginStrategy))
    const sharedStrategy =
      strategies.size === 1 ? selectedAccounts[0]?.loginStrategy ?? 'auto' : 'auto'
    const sharedSelector = (field: keyof ManualLoginSelectors): string => {
      const values = selectedAccounts.map((account) => account.manualSelectors?.[field] ?? '')
      return values.every((value) => value === values[0]) ? values[0] ?? '' : ''
    }
    setBatchStrategy(sharedStrategy)
    setBatchSelectors({
      username: sharedSelector('username'),
      password: sharedSelector('password'),
      submit: sharedSelector('submit')
    })
    setBatchStrategyError('')
    setBatchStrategyOpen(true)
  }

  async function applyBatchStrategy(): Promise<void> {
    const selectors = {
      username: batchSelectors.username?.trim() || undefined,
      password: batchSelectors.password?.trim() || undefined,
      submit: batchSelectors.submit?.trim() || undefined
    }
    const selectorsProvided = Object.values(selectors).some(Boolean)
    if (
      batchStrategy === 'manual' &&
      selectorsProvided &&
      (!selectors.username || !selectors.password)
    ) {
      setBatchStrategyError(
        tr(
          '填写统一定位器时，用户名和密码均不能为空',
          'Enter both username and password selectors.',
          '填寫統一定位器時，使用者名稱和密碼均不能為空'
        )
      )
      return
    }

    setBatchStrategyBusy(true)
    setBatchStrategyError('')
    try {
      await window.autologin.accounts.setStrategyBatch({
        accountIds: [...selectedIds],
        loginStrategy: batchStrategy,
        ...(batchStrategy === 'manual' && selectorsProvided
          ? { manualSelectors: selectors }
          : {})
      })
      await onRefresh()
      setBatchStrategyOpen(false)
      setSelectedIds(new Set())
      notify(
        'success',
        tr(
          `已更新 ${selectedAccountCount} 个账号的登录方式`,
          `Updated the login method for ${selectedAccountCount} accounts.`,
          `已更新 ${selectedAccountCount} 個帳號的登入方式`
        )
      )
    } catch (error) {
      setBatchStrategyError(
        error instanceof Error
          ? error.message
          : tr('批量设置失败', 'Could not apply settings.', '批次設定失敗')
      )
    } finally {
      setBatchStrategyBusy(false)
    }
  }

  async function duplicateSelectedAccounts(): Promise<void> {
    if (selectedIds.size === 0) return
    const count = selectedIds.size
    setDuplicateBusy(true)
    try {
      await window.autologin.accounts.duplicate([...selectedIds])
      setSelectedIds(new Set())
      await onRefresh()
      notify(
        'success',
        tr(
          `已复制 ${count} 个账号`,
          `Copied ${count} accounts.`,
          `已複製 ${count} 個帳號`
        )
      )
    } catch (error) {
      notify(
        'error',
        error instanceof Error
          ? error.message
          : tr('复制账号失败', 'Could not copy accounts.', '複製帳號失敗')
      )
    } finally {
      setDuplicateBusy(false)
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
  return (
    <div className={`app-shell${sidebarCollapsed ? ' is-sidebar-collapsed' : ''}`}>
      <aside className={`sidebar${sidebarCollapsed ? ' is-collapsed' : ''}`}>
        <div className="sidebar-topbar">
          <button
            type="button"
            className="sidebar-collapse-toggle"
            onClick={toggleSidebar}
            aria-label={
              sidebarCollapsed
                ? tr('显示菜单栏', 'Show sidebar', '顯示選單列')
                : tr('隐藏菜单栏', 'Hide sidebar', '隱藏選單列')
            }
            aria-expanded={!sidebarCollapsed}
            title={
              sidebarCollapsed
                ? tr('显示菜单栏', 'Show sidebar', '顯示選單列')
                : tr('隐藏菜单栏', 'Hide sidebar', '隱藏選單列')
            }
          >
            {sidebarCollapsed ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}
            <span>
              {sidebarCollapsed
                ? tr('显示菜单栏', 'Show sidebar', '顯示選單列')
                : tr('隐藏菜单栏', 'Hide sidebar', '隱藏選單列')}
            </span>
          </button>
        </div>

        <nav className="sidebar-nav sidebar-nav--grouped" aria-label={tr('主导航', 'Main navigation', '主導覽')}>
          <section className="sidebar-section">
            <button
              className={`sidebar-nav__item${view === 'accounts' ? ' is-active' : ''}`}
              onClick={chooseAllAccounts}
              aria-label={tr('账号', 'Accounts', '帳號')}
              title={tr('账号', 'Accounts', '帳號')}
            >
              <KeyRound size={17} />
              <span>{tr('账号', 'Accounts', '帳號')}</span>
              <small>{accounts.length}</small>
            </button>
            <button
              className={`sidebar-nav__item${view === 'favorites' ? ' is-active' : ''}`}
              onClick={() => switchView('favorites')}
              aria-label={tr('收藏', 'Favorites', '收藏')}
              title={tr('收藏', 'Favorites', '收藏')}
            >
              <Star size={17} />
              <span>{tr('收藏', 'Favorites', '收藏')}</span>
              <small>{favoriteAccounts.length}</small>
            </button>
            <button
              className={`sidebar-nav__item${view === 'logs' ? ' is-active' : ''}`}
              onClick={() => switchView('logs')}
              aria-label={tr('登录日志', 'Login history', '登入日誌')}
              title={tr('登录日志', 'Login history', '登入日誌')}
            >
              <FileText size={17} />
              <span>{tr('登录日志', 'Login history', '登入日誌')}</span>
            </button>
          </section>

          <section className="sidebar-section sidebar-section--preferences">
            <button
              ref={settingsButtonRef}
              className={`sidebar-nav__item sidebar-nav__item--expandable sidebar-nav__item--settings${
                view === 'settings' ? ' is-active' : ''
              }`}
              onClick={toggleSettings}
              onMouseEnter={openCollapsedSettings}
              onMouseLeave={scheduleCollapsedSettingsClose}
              onFocus={openCollapsedSettings}
              aria-expanded={sidebarCollapsed ? collapsedSettingsOpen : settingsExpanded}
              aria-haspopup={sidebarCollapsed ? 'menu' : undefined}
              aria-label={tr('设置', 'Settings', '設定')}
              title={tr('设置', 'Settings', '設定')}
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
                  className={`sidebar-child-item${view === 'settings' && settingsModule === 'diary' ? ' is-active' : ''}`}
                  onClick={() => chooseSettingsModule('diary')}
                  tabIndex={settingsExpanded ? 0 : -1}
                >
                  {tr('软件日记', 'App diary', '軟體日記')}
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

        {sidebarCollapsed && collapsedSettingsOpen && (
          <div
            ref={settingsPopoverRef}
            className="sidebar-settings-popover"
            role="menu"
            aria-label={tr('设置菜单', 'Settings menu', '設定選單')}
            style={{
              top: collapsedSettingsPosition.top,
              left: collapsedSettingsPosition.left
            }}
            onMouseEnter={keepCollapsedSettingsOpen}
            onMouseLeave={scheduleCollapsedSettingsClose}
          >
            <span className="sidebar-settings-popover__label">
              {tr('设置', 'Settings', '設定')}
            </span>
            {(
              [
                ['general', tr('通用设置', 'General', '一般設定')],
                ['appearance', tr('外观主题', 'Appearance', '外觀主題')],
                ['network', tr('网络代理', 'Network proxy', '網路代理')],
                ['security', tr('安全与隐私', 'Security & privacy', '安全性與隱私')],
                ['data', tr('数据与备份', 'Data & backups', '資料與備份')],
                ['diary', tr('软件日记', 'App diary', '軟體日記')],
                ['about', tr('关于与更新', 'About & updates', '關於與更新')]
              ] as const
            ).map(([module, label]) => (
              <button
                type="button"
                role="menuitem"
                key={module}
                className={`sidebar-settings-popover__item${
                  view === 'settings' && settingsModule === module ? ' is-active' : ''
                }`}
                onClick={() => chooseSettingsModule(module)}
              >
                {label}
              </button>
            ))}
          </div>
        )}

        <div className="sidebar-bottom">
          <div
            className="vault-indicator"
            title={tr('保险库已解锁', 'Vault unlocked', '保險庫已解鎖')}
            aria-label={tr('保险库已解锁', 'Vault unlocked', '保險庫已解鎖')}
          >
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
            <button
              className="sidebar-action"
              onClick={() => void onLock()}
              aria-label={tr('立即锁定', 'Lock now', '立即鎖定')}
              title={tr('立即锁定', 'Lock now', '立即鎖定')}
            >
              <LockKeyhole size={17} />
              <span>{tr('立即锁定', 'Lock now', '立即鎖定')}</span>
            </button>
          </div>
        </div>
      </aside>

      {groupMenu && (
        <div
          className="group-context-menu"
          role="menu"
          aria-label={tr('分组操作', 'Group actions', '分組操作')}
          style={{ left: groupMenu.left, top: groupMenu.top }}
        >
          <span className="group-context-menu__label">{groupMenu.group.name}</span>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setRenameGroupTarget(groupMenu.group)
              setRenameGroupValue(groupMenu.group.name)
              setGroupMenu(null)
            }}
          >
            <Pencil size={14} />
            {tr('重命名分组', 'Rename group', '重新命名分組')}
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              const group = groupMenu.group
              setGroupMenu(null)
              void toggleGroupFavorite(group)
            }}
          >
            <Star
              size={14}
              fill={
                favoriteGroupSet.has(groupMenu.group.actualName ?? '')
                  ? 'currentColor'
                  : 'none'
              }
            />
            {favoriteGroupSet.has(groupMenu.group.actualName ?? '')
              ? tr('取消收藏分组', 'Remove group favorite', '取消收藏分組')
              : tr('收藏分组', 'Favorite group', '收藏分組')}
          </button>
          <button
            type="button"
            role="menuitem"
            className="is-danger"
            onClick={() => {
              setDeleteGroupTarget(groupMenu.group)
              setGroupMenu(null)
            }}
          >
            <Trash2 size={14} />
            {tr('删除分组', 'Delete group', '刪除分組')}
          </button>
        </div>
      )}

      {batchStrategyOpen && (
        <Modal
          title={tr('批量设置登录方式', 'Set login method', '批次設定登入方式')}
          eyebrow="BATCH LOGIN METHOD"
          onClose={() => setBatchStrategyOpen(false)}
          width="560px"
          className="batch-strategy-modal"
        >
          <form
            className="batch-strategy-form"
            onSubmit={(event) => {
              event.preventDefault()
              void applyBatchStrategy()
            }}
          >
            <p className="modal-description">
              {tr(
                `将统一更新所选 ${selectedAccountCount} 个账号的登录方式。`,
                `Update the login method for ${selectedAccountCount} selected accounts.`,
                `將統一更新所選 ${selectedAccountCount} 個帳號的登入方式。`
              )}
            </p>
            <div className="proxy-mode-options account-strategy-options">
              <label
                className={`proxy-mode-option${batchStrategy === 'auto' ? ' is-active' : ''}`}
              >
                <input
                  type="radio"
                  name="batch-login-strategy"
                  value="auto"
                  checked={batchStrategy === 'auto'}
                  onChange={() => {
                    setBatchStrategy('auto')
                    setBatchStrategyError('')
                  }}
                />
                <span>
                  <strong>{tr('自动录制', 'Automatic recording', '自動錄製')}</strong>
                  <small>
                    {tr(
                      '优先回放录制流程，失败时自动识别表单',
                      'Replay recorded flows, then fall back to form detection',
                      '優先回放錄製流程，失敗時自動辨識表單'
                    )}
                  </small>
                </span>
              </label>
              <label
                className={`proxy-mode-option${batchStrategy === 'manual' ? ' is-active' : ''}`}
              >
                <input
                  type="radio"
                  name="batch-login-strategy"
                  value="manual"
                  checked={batchStrategy === 'manual'}
                  onChange={() => {
                    setBatchStrategy('manual')
                    setBatchStrategyError('')
                  }}
                />
                <span>
                  <strong>{tr('手动配置', 'Manual configuration', '手動設定')}</strong>
                  <small>
                    {tr(
                      '使用用户名、密码和提交按钮定位器',
                      'Use username, password and submit selectors',
                      '使用使用者名稱、密碼和提交按鈕定位器'
                    )}
                  </small>
                </span>
              </label>
            </div>

            {batchStrategy === 'manual' && (
              <div className="batch-selector-fields">
                <p className="settings-hint">
                  {tr(
                    '可填写统一适用的定位器；留空时会检查每个账号是否已有完整配置。',
                    'Optionally apply shared selectors. Leave blank to keep each account’s existing selectors.',
                    '可填寫統一適用的定位器；留空時會檢查每個帳號是否已有完整設定。'
                  )}
                </p>
                {(
                  [
                    ['username', tr('用户名定位器', 'Username selector', '使用者名稱定位器')],
                    ['password', tr('密码定位器', 'Password selector', '密碼定位器')],
                    ['submit', tr('提交按钮定位器', 'Submit selector', '提交按鈕定位器')]
                  ] as const
                ).map(([field, label]) => (
                  <label className="field" key={field}>
                    <span className="field__label">{label}</span>
                    <span className="input-shell">
                      <SlidersHorizontal size={15} />
                      <input
                        value={batchSelectors[field] ?? ''}
                        onChange={(event) =>
                          setBatchSelectors((current) => ({
                            ...current,
                            [field]: event.target.value
                          }))
                        }
                        placeholder={
                          field === 'username'
                            ? 'input[name="username"], #username'
                            : field === 'password'
                              ? 'input[type="password"], #password'
                              : 'button[type="submit"], #login'
                        }
                        spellCheck={false}
                        autoComplete="off"
                      />
                    </span>
                  </label>
                ))}
              </div>
            )}

            {batchStrategyError && <p className="form-error">{batchStrategyError}</p>}
            <div className="modal-actions">
              <button
                type="button"
                className="button button--ghost"
                onClick={() => setBatchStrategyOpen(false)}
                disabled={batchStrategyBusy}
              >
                {tr('取消', 'Cancel', '取消')}
              </button>
              <button type="submit" className="button button--primary" disabled={batchStrategyBusy}>
                {batchStrategyBusy ? (
                  <LoaderCircle size={15} className="spin" />
                ) : (
                  <Check size={15} />
                )}
                {batchStrategyBusy
                  ? tr('正在应用…', 'Applying…', '正在套用…')
                  : tr('应用设置', 'Apply', '套用設定')}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {renameGroupTarget && (
        <Modal
          title={tr('重命名分组', 'Rename group', '重新命名分組')}
          eyebrow="GROUP NAME"
          onClose={() => setRenameGroupTarget(null)}
          width="440px"
          className="group-rename-modal"
        >
          <form
            className="group-rename-form"
            onSubmit={(event) => {
              event.preventDefault()
              void renameSelectedGroup()
            }}
          >
            <label className="field">
              <span className="field__label">{tr('分组名称', 'Group name', '分組名稱')}</span>
              <span className="input-shell">
                <Layers3 size={16} />
                <input
                  data-autofocus
                  value={renameGroupValue}
                  onChange={(event) => setRenameGroupValue(event.target.value)}
                  maxLength={40}
                  placeholder={tr('输入新的分组名称', 'Enter a new group name', '輸入新的分組名稱')}
                />
              </span>
            </label>
            <div className="modal-actions">
              <button
                type="button"
                className="button button--ghost"
                onClick={() => setRenameGroupTarget(null)}
                disabled={groupActionBusy}
              >
                {tr('取消', 'Cancel', '取消')}
              </button>
              <button
                type="submit"
                className="button button--primary"
                disabled={
                  groupActionBusy ||
                  !renameGroupValue.trim() ||
                  renameGroupValue.trim() === renameGroupTarget.actualName
                }
              >
                {groupActionBusy ? <LoaderCircle size={15} className="spin" /> : <Check size={15} />}
                {groupActionBusy
                  ? tr('正在保存…', 'Saving…', '正在儲存…')
                  : tr('保存名称', 'Save name', '儲存名稱')}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {deleteGroupTarget && (
        <ConfirmDialog
          title={tr('删除这个分组？', 'Delete this group?', '刪除這個分組？')}
          description={tr(
            `“${deleteGroupTarget.name}”中的站点会移至未分组，账号、密码和录制流程不会被删除。`,
            `Sites in “${deleteGroupTarget.name}” will move to Ungrouped. Accounts, passwords and recorded flows will be kept.`,
            `「${deleteGroupTarget.name}」中的站點會移至未分組，帳號、密碼和錄製流程不會被刪除。`
          )}
          confirmLabel={tr('删除分组', 'Delete group', '刪除分組')}
          danger
          busy={groupActionBusy}
          onConfirm={() => void deleteSelectedGroup()}
          onClose={() => setDeleteGroupTarget(null)}
        />
      )}

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
                        onContextMenu={(event) => openGroupMenu(event, group)}
                        onKeyDown={(event) => openGroupMenuFromKeyboard(event, group)}
                        aria-haspopup="menu"
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
              <header className="library-header page-breadcrumb-bar">
                <nav className="page-breadcrumb" aria-label={tr('面包屑', 'Breadcrumb', '麵包屑')}>
                  <span>{tr('工作台', 'Workspace', '工作台')}</span>
                  <ChevronRight size={12} />
                  {view !== 'favorites' && (
                    <>
                      <span>{tr('账号', 'Accounts', '帳號')}</span>
                      <ChevronRight size={12} />
                    </>
                  )}
                  <h1>{headerTitle}</h1>
                </nav>
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
                      className="button button--ghost"
                      onClick={() => void duplicateSelectedAccounts()}
                      disabled={duplicateBusy || Boolean(batchState?.active)}
                    >
                      {duplicateBusy ? (
                        <LoaderCircle size={15} className="spin" />
                      ) : (
                        <Copy size={15} />
                      )}
                      {duplicateBusy
                        ? tr('正在复制…', 'Copying…', '正在複製…')
                        : tr('复制账号', 'Copy accounts', '複製帳號')}
                    </button>
                    <button
                      className="button button--ghost"
                      onClick={openBatchStrategy}
                      disabled={Boolean(batchState?.active)}
                    >
                      <SlidersHorizontal size={15} />
                      {tr('设置登录方式', 'Set login method', '設定登入方式')}
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
                          '在账号编辑面板中收藏账号，或在账号页右键收藏一个分组。',
                          'Favorite an account in its edit panel, or right-click a group on the Accounts page.',
                          '在帳號編輯面板中收藏帳號，或在帳號頁右鍵收藏一個分組。'
                        )}
                      />
                    ) : filteredFavorites.length === 0 ? (
                      <CompactEmptyState
                        title={tr('没有匹配的收藏', 'No matching favorites', '沒有符合的收藏')}
                        description={tr('尝试更换搜索关键词。', 'Try another search.', '嘗試更換搜尋關鍵字。')}
                      />
                    ) : (
                      <div className="account-list favorite-account-list">
                        {filteredFavorites.map((account, index) => (
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
