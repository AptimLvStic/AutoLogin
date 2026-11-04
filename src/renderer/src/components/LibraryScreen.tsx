import { forwardRef, useEffect, useMemo, useRef, useState } from 'react'
import {
  ArchiveRestore,
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  FileClock,
  FolderInput,
  Globe2,
  GripVertical,
  KeyRound,
  Layers3,
  LoaderCircle,
  LogIn,
  LockKeyhole,
  PanelLeftClose,
  PanelLeftOpen,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Settings,
  SlidersHorizontal,
  Trash2,
  Undo2,
  UserRound
} from 'lucide-react'
import {
  GROUP_MAX_DEPTH,
  GROUP_PATH_SEPARATOR,
  TRASH_RETENTION_OPTIONS,
  type AccountWithSite,
  type AppSettings,
  type DeletedAccountWithSite,
  type GroupDefinition,
  type LoginBatchState,
  type LoginStrategy,
  type ManualLoginSelectors,
  type Site,
  type TrashRetentionDays
} from '@shared/types'
import { useI18n } from '../i18n'
import { AccountDrawer } from './AccountDrawer'
import { AppLogsPage } from './AppLogsPage'
import { LoginLogsPage } from './LoginLogsPage'
import { ConfirmDialog, Modal } from './Modal'
import { SettingsPage, type SettingsModule } from './SettingsPage'

type LibraryView = 'accounts' | 'loginLogs' | 'appLogs' | 'trash' | 'settings'
type GroupDropPosition = 'before' | 'after' | 'inside'
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
  parentPath: string | null
  level: number
  count: number
  accounts: AccountWithSite[]
}
const UNGROUPED_KEY = '__ungrouped__'
const ACCOUNT_SUBNAV_DEFAULT_WIDTH = 184
const ACCOUNT_SUBNAV_MIN_WIDTH = 128
const ACCOUNT_SUBNAV_MAX_WIDTH = 320
const ACCOUNT_SUBNAV_HIDE_THRESHOLD = 132

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
  const [settingsModule, setSettingsModule] = useState<SettingsModule>('general')
  const [sidebarCollapsed, setSidebarCollapsed] = useState(
    () => window.localStorage.getItem('autologin.sidebar.collapsed') === '1'
  )
  const [search, setSearch] = useState('')
  const [searchExpanded, setSearchExpanded] = useState(false)
  const [collapsedGroupPaths, setCollapsedGroupPaths] = useState<Set<string>>(() => {
    try {
      const stored = window.localStorage.getItem('autologin.account.groups.collapsedPaths')
      const values = stored ? (JSON.parse(stored) as unknown) : []
      return new Set(
        Array.isArray(values)
          ? values.filter((value): value is string => typeof value === 'string')
          : []
      )
    } catch {
      return new Set()
    }
  })
  const [accountSubnavWidth, setAccountSubnavWidth] = useState(() => {
    const savedValue = window.localStorage.getItem('autologin.account.subnav.width')
    const saved = savedValue === null ? Number.NaN : Number(savedValue)
    return Number.isFinite(saved)
      ? Math.max(ACCOUNT_SUBNAV_MIN_WIDTH, Math.min(ACCOUNT_SUBNAV_MAX_WIDTH, saved))
      : ACCOUNT_SUBNAV_DEFAULT_WIDTH
  })
  const [accountSubnavHidden, setAccountSubnavHidden] = useState(
    () => window.localStorage.getItem('autologin.account.subnav.hidden') === '1'
  )
  const [groupDefinitions, setGroupDefinitions] = useState<GroupDefinition[]>([])
  const [deletedAccounts, setDeletedAccounts] = useState<DeletedAccountWithSite[]>([])
  const [groupCreateState, setGroupCreateState] = useState<{
    parent: GroupSummary | null
    left: number
    top: number
  } | null>(null)
  const [groupCreateName, setGroupCreateName] = useState('')
  const [groupCreateError, setGroupCreateError] = useState('')
  const [groupCreateBusy, setGroupCreateBusy] = useState(false)
  const [copyMenu, setCopyMenu] = useState<{
    account: AccountWithSite
    left: number
    top: number
  } | null>(null)
  const [restoringAccountId, setRestoringAccountId] = useState<string | null>(null)
  const [trashRetentionSaving, setTrashRetentionSaving] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set())
  const [drawer, setDrawer] = useState<DrawerState | null>(null)
  const [draggedGroupPath, setDraggedGroupPath] = useState<string | null>(null)
  const [groupDropTarget, setGroupDropTarget] = useState<{
    path: string
    position: GroupDropPosition
  } | null>(null)
  const [groupMenu, setGroupMenu] = useState<{
    group: GroupSummary
    left: number
    top: number
  } | null>(null)
  const [renameGroupTarget, setRenameGroupTarget] = useState<GroupSummary | null>(null)
  const [renameGroupValue, setRenameGroupValue] = useState('')
  const [moveGroupTarget, setMoveGroupTarget] = useState<GroupSummary | null>(null)
  const [moveGroupDestination, setMoveGroupDestination] = useState('')
  const [moveGroupBusy, setMoveGroupBusy] = useState(false)
  const [moveGroupError, setMoveGroupError] = useState('')
  const [deleteGroupTarget, setDeleteGroupTarget] = useState<GroupSummary | null>(null)
  const [groupActionBusy, setGroupActionBusy] = useState(false)
  const [batchStrategyOpen, setBatchStrategyOpen] = useState(false)
  const [batchStrategy, setBatchStrategy] = useState<LoginStrategy>('auto')
  const [batchSelectors, setBatchSelectors] = useState<ManualLoginSelectors>({})
  const [batchStrategyError, setBatchStrategyError] = useState('')
  const [batchStrategyBusy, setBatchStrategyBusy] = useState(false)
  const [duplicateBusy, setDuplicateBusy] = useState(false)
  const [manualRefreshing, setManualRefreshing] = useState(false)
  const [deleteSelectedOpen, setDeleteSelectedOpen] = useState(false)
  const [deleteSelectedBusy, setDeleteSelectedBusy] = useState(false)
  const searchRef = useRef<HTMLInputElement>(null)
  const selectAllRef = useRef<HTMLInputElement>(null)
  const groupCreateInputRef = useRef<HTMLInputElement>(null)
  const draggedGroupPathRef = useRef<string | null>(null)
  const subnavResizeRef = useRef<{
    startX: number
    startWidth: number
    latestWidth: number
  } | null>(null)
  const subnavResizeCleanupRef = useRef<(() => void) | null>(null)
  const subnavResizeMovedRef = useRef(false)
  const suppressSubnavToggleRef = useRef(false)

  const groups = useMemo<GroupSummary[]>(() => {
    const grouped = new Map<string, GroupSummary>()
    const ensureGroup = (path: string, name?: string): GroupSummary => {
      const current = grouped.get(path) ?? {
        key: path,
        name: name || path.split(GROUP_PATH_SEPARATOR).at(-1) || path,
        actualName: path,
        parentPath: groupParentPath(path),
        level: groupLevel(path),
        count: 0,
        accounts: []
      }
      grouped.set(path, current)
      return current
    }
    for (const definition of groupDefinitions) {
      ensureGroup(definition.path, definition.name)
    }
    for (const site of sites) {
      const actualName = site.group?.trim() || null
      if (!actualName) continue
      ensureGroup(actualName)
    }
    for (const account of accounts) {
      const actualName = account.site.group?.trim() || null
      const key = actualName ?? UNGROUPED_KEY
      const current =
        key === UNGROUPED_KEY
          ? grouped.get(key) ?? {
              key,
              name: tr('未分组', 'Ungrouped', '未分組'),
              actualName: null,
              parentPath: null,
              level: 1,
              count: 0,
              accounts: []
            }
          : ensureGroup(key)
      current.accounts.push(account)
      current.count += 1
      grouped.set(key, current)
    }

    const order = new Map(settings.groupOrder.map((name, index) => [name, index]))
    const values = [...grouped.values()].map((group) => ({
      ...group,
      accounts: [...group.accounts].sort(compareAccounts)
    }))
    return flattenGroupTree(values, order, language)
  }, [accounts, groupDefinitions, language, settings.groupOrder, sites, tr])
  const namedGroups = useMemo(
    () => groups.filter((group) => group.actualName !== null),
    [groups]
  )
  const groupsWithChildren = useMemo(
    () =>
      new Set(
        namedGroups
          .map((group) => group.actualName)
          .filter((path): path is string => Boolean(path) && groups.some(
            (candidate) => candidate.parentPath === path
          ))
      ),
    [groups, namedGroups]
  )
  const visibleNamedGroups = useMemo(
    () =>
      namedGroups.filter((group) => {
        if (!group.actualName) return false
        const segments = group.actualName.split(GROUP_PATH_SEPARATOR)
        return segments
          .slice(0, -1)
          .every(
            (_, index) =>
              !collapsedGroupPaths.has(
                segments.slice(0, index + 1).join(GROUP_PATH_SEPARATOR)
              )
          )
      }),
    [collapsedGroupPaths, namedGroups]
  )

  const currentGroup = groupFilter
    ? groups.find((group) => group.key === groupFilter) ?? null
    : null
  const currentBreadcrumb = useMemo(() => {
    if (!currentGroup) {
      return [{ label: tr('全部账号', 'All accounts', '全部帳號'), path: null as string | null }]
    }
    if (!currentGroup.actualName) {
      return [
        {
          label: tr('未分组', 'Ungrouped', '未分組'),
          path: null as string | null
        }
      ]
    }
    const segments = currentGroup.actualName.split(GROUP_PATH_SEPARATOR).filter(Boolean)
    return segments.map((label, index) => ({
      label,
      path: segments.slice(0, index + 1).join(GROUP_PATH_SEPARATOR)
    }))
  }, [currentGroup, tr])
  const moveGroupDestinations = useMemo(() => {
    if (!moveGroupTarget?.actualName) return []
    const sourcePath = moveGroupTarget.actualName
    const sourceLevel = groupLevel(sourcePath)
    const sourceMaxLevel = Math.max(
      sourceLevel,
      ...groups
        .filter(
          (group) =>
            group.actualName === sourcePath ||
            group.actualName?.startsWith(`${sourcePath}${GROUP_PATH_SEPARATOR}`)
        )
        .map((group) => groupLevel(group.actualName ?? group.key))
    )
    return groups.filter((group) => {
      if (!group.actualName) return false
      if (
        group.actualName === sourcePath ||
        group.actualName.startsWith(`${sourcePath}${GROUP_PATH_SEPARATOR}`)
      ) {
        return false
      }
      return groupLevel(group.actualName) + 1 + (sourceMaxLevel - sourceLevel) <= GROUP_MAX_DEPTH
    })
  }, [groups, moveGroupTarget])

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
    void Promise.all([window.autologin.groups.list(), window.autologin.accounts.listDeleted()])
      .then(([nextGroups, nextDeleted]) => {
        if (cancelled) return
        setGroupDefinitions(nextGroups)
        setDeletedAccounts(nextDeleted)
      })
      .catch(() => {
        if (cancelled) return
        setGroupDefinitions([])
        setDeletedAccounts([])
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
    if (view !== 'trash') return
    let cancelled = false
    void window.autologin.accounts.listDeleted().then((next) => {
      if (!cancelled) setDeletedAccounts(next)
    })
    return () => {
      cancelled = true
    }
  }, [view])

  useEffect(() => {
    if (selectAllRef.current) {
      selectAllRef.current.indeterminate = someVisibleSelected
    }
  }, [someVisibleSelected])

  useEffect(() => {
    if (view !== 'accounts') setSelectedIds(new Set())
  }, [view])

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
    if (!groupCreateState) return
    window.requestAnimationFrame(() => groupCreateInputRef.current?.focus())
    const closeOnPointer = (event: PointerEvent): void => {
      if (
        event.target instanceof Element &&
        event.target.closest('.group-create-popover')
      ) {
        return
      }
      setGroupCreateState(null)
      setGroupCreateError('')
    }
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        setGroupCreateState(null)
        setGroupCreateError('')
      }
    }
    document.addEventListener('pointerdown', closeOnPointer)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('pointerdown', closeOnPointer)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [groupCreateState])

  useEffect(() => {
    if (!copyMenu) return
    let scrollArmed = false
    const armScrollClose = window.requestAnimationFrame(() => {
      scrollArmed = true
    })
    const close = (): void => setCopyMenu(null)
    const closeOnPointer = (event: PointerEvent): void => {
      if (event.target instanceof Element && event.target.closest('.account-copy-menu')) {
        return
      }
      close()
    }
    const closeOnScroll = (): void => {
      if (scrollArmed) close()
    }
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') close()
    }
    document.addEventListener('pointerdown', closeOnPointer)
    document.addEventListener('keydown', closeOnEscape)
    window.addEventListener('resize', close)
    window.addEventListener('scroll', closeOnScroll, true)
    return () => {
      window.cancelAnimationFrame(armScrollClose)
      document.removeEventListener('pointerdown', closeOnPointer)
      document.removeEventListener('keydown', closeOnEscape)
      window.removeEventListener('resize', close)
      window.removeEventListener('scroll', closeOnScroll, true)
    }
  }, [copyMenu])

  useEffect(() => {
    if (!searchExpanded) return
    window.requestAnimationFrame(() => searchRef.current?.focus())
  }, [searchExpanded])

  useEffect(() => () => subnavResizeCleanupRef.current?.(), [])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        if (view !== 'accounts') return
        event.preventDefault()
        setSearchExpanded(true)
        window.requestAnimationFrame(() => searchRef.current?.focus())
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [view])

  async function refreshAll(): Promise<void> {
    const [, nextGroups, nextDeleted] = await Promise.all([
      onRefresh(),
      window.autologin.groups.list(),
      window.autologin.accounts.listDeleted()
    ])
    setGroupDefinitions(nextGroups)
    setDeletedAccounts(nextDeleted)
  }

  function switchView(next: LibraryView): void {
    setView(next)
    setSearch('')
    setSearchExpanded(false)
    setGroupFilter(null)
    setSelectedIds(new Set())
  }

  function chooseAllAccounts(): void {
    setView('accounts')
    setGroupFilter(null)
    setSearch('')
    setSearchExpanded(false)
    setSelectedIds(new Set())
  }

  function chooseGroup(group: GroupSummary): void {
    setView('accounts')
    setGroupFilter(group.key)
    setSearch('')
    setSearchExpanded(false)
    setSelectedIds(new Set())
  }

  function chooseLogView(next: 'loginLogs' | 'appLogs'): void {
    switchView(next)
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
    setSearch('')
    setSearchExpanded(false)
    setSelectedIds(new Set())
  }

  function openSettings(): void {
    chooseSettingsModule(settingsModule)
  }

  function toggleGroupExpanded(path: string): void {
    setCollapsedGroupPaths((current) => {
      const next = new Set(current)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      window.localStorage.setItem(
        'autologin.account.groups.collapsedPaths',
        JSON.stringify([...next])
      )
      return next
    })
  }

  function expandGroupAncestors(path: string | undefined): void {
    if (!path) return
    setCollapsedGroupPaths((current) => {
      const next = new Set(current)
      const segments = path.split(GROUP_PATH_SEPARATOR)
      for (let index = 1; index <= segments.length; index += 1) {
        next.delete(segments.slice(0, index).join(GROUP_PATH_SEPARATOR))
      }
      window.localStorage.setItem(
        'autologin.account.groups.collapsedPaths',
        JSON.stringify([...next])
      )
      return next
    })
  }

  function toggleAccountSubnav(): void {
    setAccountSubnavHidden((current) => {
      const next = !current
      if (!next && accountSubnavWidth < ACCOUNT_SUBNAV_MIN_WIDTH) {
        setAccountSubnavWidth(ACCOUNT_SUBNAV_MIN_WIDTH)
        window.localStorage.setItem(
          'autologin.account.subnav.width',
          String(ACCOUNT_SUBNAV_MIN_WIDTH)
        )
      }
      window.localStorage.setItem('autologin.account.subnav.hidden', next ? '1' : '0')
      return next
    })
  }

  function handleSubnavToggle(): void {
    if (suppressSubnavToggleRef.current) {
      suppressSubnavToggleRef.current = false
      return
    }
    toggleAccountSubnav()
  }

  function beginSubnavResize(
    event: React.PointerEvent<HTMLElement>,
    preserveClick = false
  ): void {
    if (event.button !== 0) return
    if (!preserveClick) event.preventDefault()
    subnavResizeMovedRef.current = false
    subnavResizeRef.current = {
      startX: event.clientX,
      startWidth: accountSubnavWidth,
      latestWidth: accountSubnavWidth
    }
    document.body.classList.add('is-resizing-account-subnav')
    subnavResizeCleanupRef.current?.()

    const cleanup = (): void => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', finish)
      window.removeEventListener('pointercancel', finish)
      subnavResizeRef.current = null
      subnavResizeCleanupRef.current = null
      document.body.classList.remove('is-resizing-account-subnav')
    }
    const finish = (): void => {
      const drag = subnavResizeRef.current
      const moved = subnavResizeMovedRef.current
      cleanup()
      if (!drag) return
      if (moved) {
        suppressSubnavToggleRef.current = true
        window.setTimeout(() => {
          suppressSubnavToggleRef.current = false
        }, 0)
      }
      if (drag.latestWidth <= ACCOUNT_SUBNAV_HIDE_THRESHOLD) {
        setAccountSubnavHidden(true)
        window.localStorage.setItem('autologin.account.subnav.hidden', '1')
        return
      }
      const persisted = Math.max(
        ACCOUNT_SUBNAV_MIN_WIDTH,
        Math.min(ACCOUNT_SUBNAV_MAX_WIDTH, drag.latestWidth)
      )
      setAccountSubnavWidth(persisted)
      window.localStorage.setItem('autologin.account.subnav.width', String(persisted))
    }
    const onMove = (moveEvent: PointerEvent): void => {
      const drag = subnavResizeRef.current
      if (!drag) return
      const delta = moveEvent.clientX - drag.startX
      if (Math.abs(delta) > 4) {
        subnavResizeMovedRef.current = true
        if (accountSubnavHidden) {
          setAccountSubnavHidden(false)
          window.localStorage.setItem('autologin.account.subnav.hidden', '0')
        }
      }
      const nextWidth = Math.max(
        96,
        Math.min(ACCOUNT_SUBNAV_MAX_WIDTH, drag.startWidth + delta)
      )
      drag.latestWidth = nextWidth
      setAccountSubnavWidth(nextWidth)
    }

    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', finish, { once: true })
    window.addEventListener('pointercancel', finish, { once: true })
    subnavResizeCleanupRef.current = cleanup
  }

  function openGroupCreate(
    event: React.MouseEvent<HTMLButtonElement>,
    parent: GroupSummary | null
  ): void {
    event.preventDefault()
    event.stopPropagation()
    if (parent && groupLevel(parent.actualName ?? parent.key) >= GROUP_MAX_DEPTH) return
    const rect = event.currentTarget.getBoundingClientRect()
    const width = 276
    const height = 178
    setGroupCreateState({
      parent,
      left: Math.max(8, Math.min(rect.right + 8, window.innerWidth - width - 8)),
      top: Math.max(8, Math.min(rect.bottom + 6, window.innerHeight - height - 8))
    })
    setGroupCreateName('')
    setGroupCreateError('')
  }

  function validateNewGroupName(name: string): string | null {
    const value = name.trim()
    if (value.length < 1) return tr('请输入分组名称', 'Enter a group name.', '請輸入分組名稱')
    if (value.length > 20) {
      return tr('分组名称最多 20 个字符', 'Group names are limited to 20 characters.', '分組名稱最多 20 個字元')
    }
    if (!/^[\p{L}\p{N} _-]+$/u.test(value)) {
      return tr('分组名称不能包含特殊字符', 'Special characters are not allowed.', '分組名稱不能包含特殊字元')
    }
    const parentPath = groupCreateState?.parent?.actualName ?? null
    if (
      groups.some(
        (group) =>
          group.parentPath === parentPath &&
          group.name.localeCompare(value, language, { sensitivity: 'accent' }) === 0
      )
    ) {
      return tr('同级分组名称已存在', 'A sibling group with this name already exists.', '同級分組名稱已存在')
    }
    return null
  }

  async function submitNewGroup(event: React.FormEvent): Promise<void> {
    event.preventDefault()
    const validation = validateNewGroupName(groupCreateName)
    if (validation) {
      setGroupCreateError(validation)
      return
    }
    setGroupCreateBusy(true)
    setGroupCreateError('')
    try {
      await window.autologin.groups.create({
        ...(groupCreateState?.parent?.actualName
          ? { parentPath: groupCreateState.parent.actualName }
          : {}),
        name: groupCreateName.trim()
      })
      await refreshAll()
      setGroupCreateState(null)
      setGroupCreateName('')
      notify('success', tr('分组已创建', 'Group created.', '分組已建立'))
    } catch (error) {
      setGroupCreateError(
        error instanceof Error
          ? error.message
          : tr('创建分组失败', 'Could not create group.', '建立分組失敗')
      )
    } finally {
      setGroupCreateBusy(false)
    }
  }

  function openCopyMenu(
    event: React.MouseEvent<HTMLButtonElement>,
    account: AccountWithSite
  ): void {
    event.preventDefault()
    event.stopPropagation()
    const rect = event.currentTarget.getBoundingClientRect()
    const menuHeight = 142
    const top =
      rect.bottom + menuHeight + 8 <= window.innerHeight
        ? rect.bottom + 6
        : Math.max(8, rect.top - menuHeight - 6)
    setCopyMenu({
      account,
      left: Math.max(8, Math.min(rect.right - 190, window.innerWidth - 198)),
      top
    })
  }

  async function copyAccountUsername(account: AccountWithSite): Promise<void> {
    setCopyMenu(null)
    try {
      await window.autologin.accounts.copyUsername(account.id)
      notify('success', tr('用户名已复制', 'Username copied.', '使用者名稱已複製'))
    } catch (error) {
      notify(
        'error',
        error instanceof Error
          ? error.message
          : tr('复制用户名失败', 'Could not copy username.', '複製使用者名稱失敗')
      )
    }
  }

  async function copyAccountPassword(account: AccountWithSite): Promise<void> {
    setCopyMenu(null)
    try {
      await window.autologin.accounts.copy(account.id)
      notify('success', tr('密码已复制', 'Password copied.', '密碼已複製'))
    } catch (error) {
      notify(
        'error',
        error instanceof Error
          ? error.message
          : tr('复制密码失败', 'Could not copy password.', '複製密碼失敗')
      )
    }
  }

  async function duplicateSingleAccount(account: AccountWithSite): Promise<void> {
    setCopyMenu(null)
    try {
      const [created] = await window.autologin.accounts.duplicate([account.id])
      await refreshAll()
      notify(
        'success',
        tr(
          `已创建“${created?.site.name ?? account.site.name}”副本`,
          `Created a copy of “${created?.site.name ?? account.site.name}”.`,
          `已建立「${created?.site.name ?? account.site.name}」副本`
        )
      )
    } catch (error) {
      notify(
        'error',
        error instanceof Error
          ? error.message
          : tr('复制账号失败', 'Could not copy account.', '複製帳號失敗')
      )
    }
  }

  async function restoreAccount(accountId: string): Promise<void> {
    setRestoringAccountId(accountId)
    try {
      await window.autologin.accounts.restore(accountId)
      await refreshAll()
      notify('success', tr('账号已恢复', 'Account restored.', '帳號已恢復'))
    } catch (error) {
      notify(
        'error',
        error instanceof Error
          ? error.message
          : tr('恢复账号失败', 'Could not restore account.', '恢復帳號失敗')
      )
    } finally {
      setRestoringAccountId(null)
    }
  }

  async function updateTrashRetention(days: TrashRetentionDays): Promise<void> {
    if (days === settings.trashRetentionDays || trashRetentionSaving) return
    setTrashRetentionSaving(true)
    try {
      await window.autologin.settings.update({ trashRetentionDays: days })
      await refreshAll()
      notify(
        'success',
        tr(
          `回收站保留天数已设为 ${days} 天`,
          `Recycle Bin retention is now ${days} days.`,
          `回收站保留天數已設為 ${days} 天`
        )
      )
    } catch (error) {
      notify(
        'error',
        error instanceof Error
          ? error.message
          : tr('保留天数更新失败', 'Could not update retention.', '保留天數更新失敗')
      )
    } finally {
      setTrashRetentionSaving(false)
    }
  }

  async function saveGroupOrder(groupOrder: string[]): Promise<void> {
    try {
      await window.autologin.settings.update({ groupOrder })
      await onRefresh()
    } catch (error) {
      notify(
        'error',
        error instanceof Error
          ? error.message
          : tr('分组顺序保存失败', 'Could not save group order.', '分組順序儲存失敗')
      )
      await onRefresh()
    }
  }

  function beginGroupDrag(
    event: React.DragEvent<HTMLSpanElement>,
    group: GroupSummary
  ): void {
    if (!group.actualName) return
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('text/plain', group.actualName)
    draggedGroupPathRef.current = group.actualName
    setDraggedGroupPath(group.actualName)
  }

  function resolveGroupDropPosition(
    draggedPath: string,
    target: GroupSummary,
    position: GroupDropPosition
  ): GroupDropPosition | null {
    const targetPath = target.actualName
    if (!targetPath || targetPath === draggedPath) return null
    if (targetPath.startsWith(`${draggedPath}${GROUP_PATH_SEPARATOR}`)) return null

    if (position === 'inside') {
      const source = groups.find((group) => group.actualName === draggedPath)
      if (!source) return null
      const sourceLevel = groupLevel(draggedPath)
      const sourceMaxLevel = Math.max(
        sourceLevel,
        ...groups
          .filter(
            (group) =>
              group.actualName === draggedPath ||
              group.actualName?.startsWith(`${draggedPath}${GROUP_PATH_SEPARATOR}`)
          )
          .map((group) => groupLevel(group.actualName ?? group.key))
      )
      const resultDepth = groupLevel(targetPath) + 1 + (sourceMaxLevel - sourceLevel)
      return resultDepth <= GROUP_MAX_DEPTH ? 'inside' : null
    }

    const targetParent = groupParentPath(targetPath)
    if (targetParent?.startsWith(`${draggedPath}${GROUP_PATH_SEPARATOR}`)) return null
    return position
  }

  function hoverGroupDropTarget(
    event: React.DragEvent<HTMLDivElement>,
    group: GroupSummary
  ): void {
    const activePath = draggedGroupPathRef.current ?? draggedGroupPath
    if (!activePath) return
    const rect = event.currentTarget.getBoundingClientRect()
    const offset = (event.clientY - rect.top) / Math.max(1, rect.height)
    const requested: GroupDropPosition =
      offset < 0.3 ? 'before' : offset > 0.7 ? 'after' : 'inside'
    const resolved = resolveGroupDropPosition(activePath, group, requested)
    if (!resolved) {
      setGroupDropTarget(null)
      return
    }
    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'
    setGroupDropTarget({ path: group.actualName ?? group.key, position: resolved })
  }

  async function finishGroupDrop(
    event: React.DragEvent<HTMLDivElement>,
    target: GroupSummary
  ): Promise<void> {
    event.preventDefault()
    const draggedPath = draggedGroupPathRef.current ?? draggedGroupPath
    const dropTarget = groupDropTarget
    draggedGroupPathRef.current = null
    setDraggedGroupPath(null)
    setGroupDropTarget(null)
    if (!draggedPath || !dropTarget || dropTarget.path !== target.actualName) return

    const destinationParent =
      dropTarget.position === 'inside'
        ? target.actualName ?? undefined
        : groupParentPath(target.actualName ?? target.key) ?? undefined
    const currentParent = groupParentPath(draggedPath) ?? undefined

    if (destinationParent === currentParent) {
      const siblings = groups
        .filter(
          (group) =>
            group.actualName &&
            (group.parentPath ?? undefined) === destinationParent
        )
        .map((group) => group.actualName as string)
      const nextSiblings = siblings.filter((path) => path !== draggedPath)
      const targetIndex = nextSiblings.indexOf(target.actualName ?? '')
      if (targetIndex < 0) return
      nextSiblings.splice(
        targetIndex + (dropTarget.position === 'after' ? 1 : 0),
        0,
        draggedPath
      )
      if (nextSiblings.join('\0') === siblings.join('\0')) return
      const nextOrder = groups
        .map((group) => group.actualName)
        .filter((path): path is string => Boolean(path))
      const siblingSet = new Set(siblings)
      let siblingIndex = 0
      for (let index = 0; index < nextOrder.length; index += 1) {
        const currentPath = nextOrder[index]
        if (!currentPath || !siblingSet.has(currentPath)) continue
        const replacement = nextSiblings[siblingIndex]
        if (replacement) nextOrder[index] = replacement
        siblingIndex += 1
      }
      await saveGroupOrder(nextOrder)
      return
    }

    setGroupActionBusy(true)
    try {
      const result = await window.autologin.groups.move({
        fromPath: draggedPath,
        ...(destinationParent ? { parentPath: destinationParent } : {})
      })
      expandGroupAncestors(result.toPath)
      setGroupFilter(result.toPath)
      await refreshAll()
      notify(
        'success',
        tr(
          `分组已移动到“${destinationParent ?? tr('顶层分组', 'Top level', '第一層分組')}”`,
          `Group moved to “${destinationParent ?? 'top level'}”.`,
          `分組已移動到「${destinationParent ?? '第一層分組'}」`
        )
      )
    } catch (error) {
      notify(
        'error',
        error instanceof Error
          ? error.message
          : tr('移动分组失败', 'Could not move group.', '移動分組失敗')
      )
      await refreshAll()
    } finally {
      setGroupActionBusy(false)
    }
  }

  function openMoveGroupDialog(group: GroupSummary): void {
    if (!group.actualName) return
    setMoveGroupTarget(group)
    setMoveGroupDestination(group.parentPath ?? '')
    setMoveGroupError('')
  }

  async function submitMoveGroup(event: React.FormEvent): Promise<void> {
    event.preventDefault()
    if (!moveGroupTarget?.actualName) return
    const destination = moveGroupDestination || undefined
    if (destination === (moveGroupTarget.parentPath ?? undefined)) {
      setMoveGroupTarget(null)
      return
    }
    setMoveGroupBusy(true)
    setMoveGroupError('')
    try {
      const result = await window.autologin.groups.move({
        fromPath: moveGroupTarget.actualName,
        ...(destination ? { parentPath: destination } : {})
      })
      expandGroupAncestors(result.toPath)
      setGroupFilter(result.toPath)
      await refreshAll()
      setMoveGroupTarget(null)
      notify(
        'success',
        tr(
          `分组已移动到“${destination ?? tr('顶层分组', 'Top level', '第一層分組')}”`,
          `Group moved to “${destination ?? 'top level'}”.`,
          `分組已移動到「${destination ?? '第一層分組'}」`
        )
      )
    } catch (error) {
      setMoveGroupError(
        error instanceof Error
          ? error.message
          : tr('移动分组失败', 'Could not move group.', '移動分組失敗')
      )
    } finally {
      setMoveGroupBusy(false)
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
      const nextPath = renameGroupTarget.parentPath
        ? `${renameGroupTarget.parentPath}${GROUP_PATH_SEPARATOR}${nextName}`
        : nextName
      if (groupFilter === renameGroupTarget.key) setGroupFilter(nextPath)
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
      setBatchStrategyOpen(false)
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

  async function refreshAccounts(): Promise<void> {
    setManualRefreshing(true)
    try {
      await refreshAll()
    } catch (error) {
      notify(
        'error',
        error instanceof Error
          ? error.message
          : tr('刷新账号失败', 'Could not refresh accounts.', '重新整理帳號失敗')
      )
    } finally {
      setManualRefreshing(false)
    }
  }

  async function deleteSelectedAccounts(): Promise<void> {
    if (selectedIds.size === 0) return
    const count = selectedIds.size
    setDeleteSelectedBusy(true)
    try {
      const result = await window.autologin.accounts.deleteMany([...selectedIds])
      setDeleteSelectedOpen(false)
      setSelectedIds(new Set())
      await refreshAll()
      notify(
        'success',
        tr(
          `已将 ${result.deleted} 个账号移入回收站`,
          `Moved ${result.deleted} account${result.deleted === 1 ? '' : 's'} to Recycle Bin.`,
          `已將 ${result.deleted} 個帳號移至回收站`
        )
      )
    } catch (error) {
      notify(
        'error',
        error instanceof Error
          ? error.message
          : tr('批量删除账号失败', 'Could not delete selected accounts.', '批次刪除帳號失敗')
      )
    } finally {
      setDeleteSelectedBusy(false)
      if (count === 0) setDeleteSelectedOpen(false)
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
    notify('success', tr('账号已移入回收站', 'Account moved to Recycle Bin.', '帳號已移至回收站'))
  }

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
              className={`sidebar-nav__item${
                view === 'loginLogs' || view === 'appLogs' ? ' is-active' : ''
              }`}
              onClick={() => chooseLogView('loginLogs')}
              aria-label={tr('日志', 'Logs', '日誌')}
              title={tr('日志', 'Logs', '日誌')}
            >
              <FileClock size={17} />
              <span>{tr('日志', 'Logs', '日誌')}</span>
            </button>
            <button
              className={`sidebar-nav__item${view === 'trash' ? ' is-active' : ''}`}
              onClick={() => switchView('trash')}
              aria-label={tr('回收站', 'Recycle Bin', '回收站')}
              title={tr('回收站', 'Recycle Bin', '回收站')}
            >
              <ArchiveRestore size={17} />
              <span>{tr('回收站', 'Recycle Bin', '回收站')}</span>
              <small>{deletedAccounts.length}</small>
            </button>
          </section>
        </nav>

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
              type="button"
              className="sidebar-action sidebar-action--icon"
              onClick={() => void onLock()}
              aria-label={tr('立即锁定', 'Lock now', '立即鎖定')}
              data-tooltip={tr('立即锁定', 'Lock now', '立即鎖定')}
            >
              <LockKeyhole size={17} />
            </button>
            <button
              type="button"
              className={`sidebar-action sidebar-action--icon${
                view === 'settings' ? ' is-active' : ''
              }`}
              onClick={openSettings}
              aria-label={tr('设置', 'Settings', '設定')}
              data-tooltip={tr('设置', 'Settings', '設定')}
            >
              <Settings size={17} />
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

      {groupCreateState && (
        <form
          className="group-create-popover"
          role="dialog"
          aria-label={tr('新增分组', 'Add group', '新增分組')}
          style={{ left: groupCreateState.left, top: groupCreateState.top }}
          onSubmit={(event) => void submitNewGroup(event)}
        >
          <header>
            <div>
              <strong>{tr('新增子分组', 'Add subgroup', '新增子分組')}</strong>
              <small>
                {groupCreateState.parent
                  ? groupCreateState.parent.actualName
                  : tr('一级分组', 'Top-level group', '第一層分組')}
              </small>
            </div>
            <span>
              {(groupCreateState.parent
                ? groupLevel(groupCreateState.parent.actualName ?? groupCreateState.parent.key)
                : 0) + 1}
              /{GROUP_MAX_DEPTH}
            </span>
          </header>
          <label className="field">
            <span className="field__label">{tr('分组名称', 'Group name', '分組名稱')}</span>
            <input
              ref={groupCreateInputRef}
              className="filter-control"
              value={groupCreateName}
              onChange={(event) => {
                setGroupCreateName(event.target.value)
                if (groupCreateError) setGroupCreateError('')
              }}
              maxLength={20}
              placeholder={tr('1–20 个字符', '1–20 characters', '1–20 個字元')}
              autoComplete="off"
            />
          </label>
          {groupCreateError && <p className="form-error">{groupCreateError}</p>}
          <div className="group-create-popover__actions">
            <button
              type="button"
              className="button button--ghost button--small"
              onClick={() => setGroupCreateState(null)}
              disabled={groupCreateBusy}
            >
              {tr('取消', 'Cancel', '取消')}
            </button>
            <button
              type="submit"
              className="button button--primary button--small"
              disabled={groupCreateBusy}
            >
              {groupCreateBusy ? (
                <LoaderCircle size={13} className="spin" />
              ) : (
                <Plus size={13} />
              )}
              {tr('创建', 'Create', '建立')}
            </button>
          </div>
        </form>
      )}

      {copyMenu && (
        <div
          className="account-copy-menu"
          role="menu"
          aria-label={tr('复制账号内容', 'Copy account options', '複製帳號內容')}
          style={{ left: copyMenu.left, top: copyMenu.top }}
        >
          <button
            type="button"
            role="menuitem"
            onClick={() => void copyAccountUsername(copyMenu.account)}
          >
            <UserRound size={14} />
            {tr('复制用户名', 'Copy username', '複製使用者名稱')}
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => void copyAccountPassword(copyMenu.account)}
          >
            <KeyRound size={14} />
            {tr('复制密码', 'Copy password', '複製密碼')}
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => void duplicateSingleAccount(copyMenu.account)}
          >
            <Copy size={14} />
            {tr('复制账号', 'Duplicate account', '複製帳號')}
          </button>
        </div>
      )}

      {batchStrategyOpen && (
        <Modal
          title={tr('批量操作', 'Batch actions', '批次操作')}
          eyebrow="BATCH ACTIONS"
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
                  <strong>{tr('自动识别', 'Auto detect', '自動識別')}</strong>
                  <small>
                    {tr(
                      '优先回放已录制流程，失败时自动识别表单',
                      'Replay recorded flows, then fall back to form detection',
                      '優先回放已錄製流程，失敗時自動辨識表單'
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
                onClick={() => void duplicateSelectedAccounts()}
                disabled={duplicateBusy || batchStrategyBusy}
              >
                {duplicateBusy ? (
                  <LoaderCircle size={15} className="spin" />
                ) : (
                  <Copy size={15} />
                )}
                {duplicateBusy
                  ? tr('正在复制…', 'Copying…', '正在複製…')
                  : tr('复制所选账号', 'Copy selected', '複製所選帳號')}
              </button>
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
                  maxLength={20}
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
                  renameGroupValue.trim() === renameGroupTarget.name
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

      {moveGroupTarget && (
        <Modal
          title={tr('移动分组', 'Move group', '移動分組')}
          eyebrow="GROUP MOVE"
          onClose={() => {
            if (!moveGroupBusy) setMoveGroupTarget(null)
          }}
          width="480px"
          className="group-move-modal"
        >
          <form className="group-move-form" onSubmit={(event) => void submitMoveGroup(event)}>
            <p className="modal-description">
              {tr(
                `将“${moveGroupTarget.name}”移动到新的父级分组。子分组会随父级一起移动。`,
                `Move “${moveGroupTarget.name}” under a new parent. Child groups move with it.`,
                `將「${moveGroupTarget.name}」移動到新的父級分組。子分組會隨父級一起移動。`
              )}
            </p>
            <label className="field">
              <span className="field__label">{tr('目标分组', 'Destination', '目標分組')}</span>
              <select
                className="filter-control"
                data-autofocus
                value={moveGroupDestination}
                onChange={(event) => {
                  setMoveGroupDestination(event.target.value)
                  setMoveGroupError('')
                }}
              >
                <option value="">{tr('顶层分组', 'Top level', '第一層分組')}</option>
                {moveGroupDestinations.map((group) => (
                  <option key={group.actualName} value={group.actualName ?? ''}>
                    {group.actualName}
                  </option>
                ))}
              </select>
            </label>
            {moveGroupError && <p className="form-error">{moveGroupError}</p>}
            <div className="modal-actions">
              <button
                type="button"
                className="button button--ghost"
                onClick={() => setMoveGroupTarget(null)}
                disabled={moveGroupBusy}
              >
                {tr('取消', 'Cancel', '取消')}
              </button>
              <button
                type="submit"
                className="button button--primary"
                disabled={
                  moveGroupBusy ||
                  moveGroupDestination === (moveGroupTarget.parentPath ?? '')
                }
              >
                {moveGroupBusy ? (
                  <LoaderCircle size={15} className="spin" />
                ) : (
                  <FolderInput size={15} />
                )}
                {moveGroupBusy
                  ? tr('正在移动…', 'Moving…', '正在移動…')
                  : tr('确认移动', 'Move group', '確認移動')}
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

      {deleteSelectedOpen && (
        <ConfirmDialog
          title={tr(
            '将所选账号移入回收站？',
            'Move selected accounts to Recycle Bin?',
            '將所選帳號移至回收站？'
          )}
          description={tr(
            `将把 ${selectedAccountCount} 个账号移入回收站并清除其独立网站会话。之后可从回收站恢复账号和录制流程。`,
            `${selectedAccountCount} accounts will move to Recycle Bin and their website sessions will be cleared. You can restore them later.`,
            `將把 ${selectedAccountCount} 個帳號移至回收站並清除其獨立網站工作階段。之後可從回收站恢復帳號和錄製流程。`
          )}
          confirmLabel={tr('移入回收站', 'Move to Recycle Bin', '移至回收站')}
          danger
          busy={deleteSelectedBusy}
          onConfirm={() => void deleteSelectedAccounts()}
          onClose={() => setDeleteSelectedOpen(false)}
        />
      )}

      <main className="library-main">
        <div className="library-content-scroll">
          {view === 'accounts' && (
            <div
              className={`library-view-layout library-view-layout--accounts${
                accountSubnavHidden ? ' is-account-subnav-hidden' : ''
              }`}
              style={
                {
                  '--account-subnav-width': `${accountSubnavWidth}px`
                } as React.CSSProperties
              }
            >
              {(
                <div className="account-subnav-shell">
                {!accountSubnavHidden && (
                <aside
                  className="account-subnav"
                  aria-label={tr('账号分组', 'Account groups', '帳號分組')}
                >
                  <span className="account-subnav__label">{tr('账号', 'Accounts', '帳號')}</span>
                  <div className="account-subnav__all-row">
                    <button
                      type="button"
                      className={`account-subnav__item${groupFilter === null ? ' is-active' : ''}`}
                      onClick={chooseAllAccounts}
                    >
                      <KeyRound size={15} />
                      <span>{tr('全部账号', 'All accounts', '全部帳號')}</span>
                      <small>{accounts.length}</small>
                    </button>
                    <button
                      type="button"
                      className="account-subnav__add-group"
                      onClick={(event) => openGroupCreate(event, null)}
                      aria-label={tr('新增一级分组', 'Add top-level group', '新增第一層分組')}
                      title={tr('新增一级分组', 'Add top-level group', '新增第一層分組')}
                    >
                      <Plus size={14} />
                    </button>
                  </div>
                  <section className="account-subnav__groups">
                    <div className="account-subnav__group-list">
                      {visibleNamedGroups.map((group) => {
                        const hasChildren = groupsWithChildren.has(group.actualName ?? '')
                        const isCollapsed = collapsedGroupPaths.has(group.actualName ?? '')
                        return (
                            <div
                              className={`account-subnav__group-row${
                                groupDropTarget?.path === group.actualName
                                  ? ` is-drop-${groupDropTarget.position}`
                                  : ''
                              }${draggedGroupPath === group.actualName ? ' is-dragging' : ''}`}
                              key={group.key}
                              data-group-path={group.actualName ?? group.key}
                              onDragOver={(event) => hoverGroupDropTarget(event, group)}
                              onDragLeave={(event) => {
                                if (
                                  event.relatedTarget instanceof Node &&
                                  event.currentTarget.contains(event.relatedTarget)
                                ) {
                                  return
                                }
                                setGroupDropTarget(null)
                              }}
                              onDrop={(event) => void finishGroupDrop(event, group)}
                              style={
                                {
                                  '--group-depth': Math.max(0, group.level - 1)
                                } as React.CSSProperties
                              }
                            >
                              <span
                                className="account-subnav__drag-handle"
                                draggable
                                onDragStart={(event) => beginGroupDrag(event, group)}
                                onDragEnd={() => {
                                  draggedGroupPathRef.current = null
                                  setDraggedGroupPath(null)
                                  setGroupDropTarget(null)
                                }}
                                aria-hidden="true"
                              >
                                <GripVertical size={13} />
                              </span>
                              <div
                                className={`account-subnav__group-main${
                                  groupFilter === group.key ? ' is-active' : ''
                                }`}
                              >
                                <button
                                  type="button"
                                  className="account-subnav__item account-subnav__item--group"
                                  onClick={() => chooseGroup(group)}
                                  onContextMenu={(event) => openGroupMenu(event, group)}
                                  onKeyDown={(event) => openGroupMenuFromKeyboard(event, group)}
                                  aria-haspopup="menu"
                                  title={group.actualName ?? group.name}
                                >
                                  <Layers3 size={15} />
                                  <span>{group.name}</span>
                                  <small>{group.count}</small>
                                </button>
                                <button
                                  type="button"
                                  className="account-subnav__group-toggle"
                                  onClick={() => {
                                    if (group.actualName) toggleGroupExpanded(group.actualName)
                                  }}
                                  disabled={!hasChildren}
                                  aria-label={
                                    hasChildren
                                      ? isCollapsed
                                        ? tr(
                                            `展开“${group.name}”`,
                                            `Expand “${group.name}”`,
                                            `展開「${group.name}」`
                                          )
                                        : tr(
                                            `收起“${group.name}”`,
                                            `Collapse “${group.name}”`,
                                            `收起「${group.name}」`
                                          )
                                      : tr('无子分组', 'No subgroups', '無子分組')
                                  }
                                  aria-expanded={hasChildren ? !isCollapsed : undefined}
                                >
                                  {isCollapsed ? (
                                    <ChevronRight size={14} />
                                  ) : (
                                    <ChevronDown size={14} />
                                  )}
                                </button>
                              </div>
                              {groupLevel(group.actualName ?? group.key) < GROUP_MAX_DEPTH && (
                                <button
                                  type="button"
                                  className="account-subnav__add-group"
                                  onClick={(event) => openGroupCreate(event, group)}
                                  aria-label={tr(
                                    `在“${group.name}”下新增子分组`,
                                    `Add a subgroup under “${group.name}”`,
                                    `在「${group.name}」下新增子分組`
                                  )}
                                  title={tr('新增子分组', 'Add subgroup', '新增子分組')}
                                >
                                  <Plus size={13} />
                                </button>
                              )}
                            </div>
                        )
                      })}
                      <div className="account-subnav__group-row account-subnav__group-row--ungrouped">
                        <span
                          className="account-subnav__drag-handle account-subnav__drag-handle--placeholder"
                          aria-hidden="true"
                        />
                        <div
                          className={`account-subnav__group-main${
                            groupFilter === UNGROUPED_KEY ? ' is-active' : ''
                          }`}
                        >
                          <button
                            type="button"
                            className="account-subnav__item account-subnav__item--group"
                            onClick={() => {
                              const ungrouped = groups.find(
                                (group) => group.key === UNGROUPED_KEY
                              )
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
                          <span
                            className="account-subnav__group-toggle account-subnav__group-toggle--spacer"
                            aria-hidden="true"
                          />
                        </div>
                      </div>
                    </div>
                  </section>
                </aside>
                )}
                {!accountSubnavHidden && (
                  <div
                    className="account-subnav__resizer"
                    role="separator"
                    aria-orientation="vertical"
                    aria-label={tr('调整账号侧边栏宽度', 'Resize account sidebar', '調整帳號側邊欄寬度')}
                    onPointerDown={beginSubnavResize}
                  />
                )}
                </div>
              )}
              <div className="library-view-main">
              <header className="library-header page-breadcrumb-bar">
                <nav className="page-breadcrumb" aria-label={tr('面包屑', 'Breadcrumb', '麵包屑')}>
                  <span>{tr('账号', 'Accounts', '帳號')}</span>
                  {currentBreadcrumb.map((crumb, index) => {
                    const isLast = index === currentBreadcrumb.length - 1
                    return (
                      <span className="page-breadcrumb__segment" key={crumb.path ?? 'all'}>
                        <ChevronRight size={12} />
                        {isLast ? (
                          <h1 title={crumb.path ?? undefined}>{crumb.label}</h1>
                        ) : (
                          <span
                            className="page-breadcrumb__crumb page-breadcrumb__crumb--static"
                            title={crumb.path ?? undefined}
                          >
                            {crumb.label}
                          </span>
                        )}
                      </span>
                    )
                  })}
                </nav>
                <div className="library-header__actions">
                  {batchState && batchState.total > 0 && (
                    <button
                      type="button"
                      className={`batch-status${batchState.active ? ' is-active' : ''}${
                        batchState.failed > 0 ? ' has-failures' : ''
                      }`}
                      onClick={() => switchView('loginLogs')}
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
                </div>
              </header>

              <div className="account-subnav-controls">
                <button
                  type="button"
                  className="account-subnav-toggle button button--ghost button--small button--icon-only"
                  onClick={handleSubnavToggle}
                  aria-label={
                    accountSubnavHidden
                      ? tr('展开账号侧边栏', 'Expand account sidebar', '展開帳號側邊欄')
                      : tr('隐藏账号侧边栏', 'Hide account sidebar', '隱藏帳號側邊欄')
                  }
                  aria-expanded={!accountSubnavHidden}
                  title={
                    accountSubnavHidden
                      ? tr('展开账号侧边栏', 'Expand account sidebar', '展開帳號側邊欄')
                      : tr('隐藏账号侧边栏', 'Hide account sidebar', '隱藏帳號側邊欄')
                  }
                >
                  {accountSubnavHidden ? (
                    <PanelLeftOpen size={14} />
                  ) : (
                    <PanelLeftClose size={14} />
                  )}
                </button>
              </div>

              <div className="library-toolbar">
                <div
                  className={`search-field search-field--expandable${
                    searchExpanded ? ' is-expanded' : ''
                  }`}
                >
                  <button
                    type="button"
                    className="search-field__toggle"
                    onClick={() => {
                      if (searchExpanded) {
                        setSearch('')
                        setSearchExpanded(false)
                      } else {
                        setSearchExpanded(true)
                      }
                    }}
                    aria-label={tr('搜索账号', 'Search accounts', '搜尋帳號')}
                    aria-expanded={searchExpanded}
                  >
                    <Search size={17} />
                  </button>
                  <input
                    ref={searchRef}
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder={tr(
                      '搜索站点、账号、用户名或分组',
                      'Search sites, accounts, usernames or groups',
                      '搜尋站點、帳號、使用者名稱或分組'
                    )}
                    aria-label={tr('搜索账号', 'Search accounts', '搜尋帳號')}
                    disabled={!searchExpanded}
                    tabIndex={searchExpanded ? 0 : -1}
                    onKeyDown={(event) => {
                      if (event.key !== 'Escape') return
                      setSearch('')
                      setSearchExpanded(false)
                    }}
                  />
                  <kbd aria-hidden={!searchExpanded}>Ctrl K</kbd>
                </div>
                {view === 'accounts' && (
                  <div className="library-toolbar__actions">
                    <button
                      type="button"
                      className="button button--primary button--small button--icon-only"
                      onClick={() => setDrawer({ mode: 'create' })}
                      aria-label={tr('添加账号', 'Add account', '新增帳號')}
                      title={tr('添加账号', 'Add account', '新增帳號')}
                    >
                      <Plus size={14} />
                    </button>
                    <button
                      type="button"
                      className="button button--ghost button--small button--icon-only"
                      onClick={() => void refreshAccounts()}
                      disabled={manualRefreshing}
                      aria-label={tr('刷新', 'Refresh', '重新整理')}
                      title={tr('刷新', 'Refresh', '重新整理')}
                    >
                      <RefreshCw
                        size={14}
                        className={manualRefreshing ? 'spin' : undefined}
                      />
                    </button>
                    <button
                      type="button"
                      className="button button--ghost button--small button--icon-only"
                      onClick={() => {
                        if (currentGroup) openMoveGroupDialog(currentGroup)
                      }}
                      disabled={
                        !currentGroup?.actualName ||
                        groupActionBusy ||
                        selectedAccountCount > 0
                      }
                      aria-label={tr('移动分组', 'Move group', '移動分組')}
                      title={tr('移动分组', 'Move group', '移動分組')}
                    >
                      <FolderInput size={14} />
                    </button>
                    <button
                      type="button"
                      className="button button--ghost button--small button--icon-only"
                      onClick={openBatchStrategy}
                      disabled={selectedAccountCount === 0 || Boolean(batchState?.active)}
                      aria-label={tr('批量操作', 'Batch actions', '批次操作')}
                      title={tr('批量操作', 'Batch actions', '批次操作')}
                    >
                      <SlidersHorizontal size={14} />
                    </button>
                    <button
                      type="button"
                      className="button button--ghost button--small button--icon-only"
                      onClick={() => void openSelected()}
                      disabled={selectedAccountCount === 0 || Boolean(batchState?.active)}
                      aria-label={tr('批量登录', 'Batch sign in', '批次登入')}
                      title={tr('批量登录', 'Batch sign in', '批次登入')}
                    >
                      <Layers3 size={14} />
                    </button>
                    <button
                      type="button"
                      className="button button--danger-ghost button--small button--icon-only"
                      onClick={() => setDeleteSelectedOpen(true)}
                      disabled={selectedAccountCount === 0 || Boolean(batchState?.active)}
                      aria-label={tr('删除账号', 'Delete accounts', '刪除帳號')}
                      title={tr('删除账号', 'Delete accounts', '刪除帳號')}
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                )}
              </div>

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
                    <span className="account-col--site">{tr('站点', 'Site', '站點')}</span>
                    <span className="account-col--username">
                      {tr('用户名', 'Username', '使用者名稱')}
                    </span>
                    <span className="account-col--group">{tr('分组', 'Group', '分組')}</span>
                    <span className="account-col--updated">
                      {tr('最后更新', 'Last updated', '最後更新')}
                    </span>
                    <span className="account-col--status">{tr('状态', 'Status', '狀態')}</span>
                    <span className="account-col--actions" />
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
                      onEdit={() => setDrawer({ mode: 'edit', accountId: account.id })}
                      onCopy={(event) => openCopyMenu(event, account)}
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
              </div>
            </div>
          )}

          {view === 'loginLogs' && (
            <LoginLogsPage
              sites={sites}
              accounts={accounts}
              groups={groupDefinitions}
              notify={notify}
              onNavigate={chooseLogView}
            />
          )}

          {view === 'appLogs' && (
            <AppLogsPage notify={notify} onNavigate={chooseLogView} />
          )}

          {view === 'trash' && (
            <section className="page-section trash-page">
              <header className="page-breadcrumb-bar">
                <nav className="page-breadcrumb" aria-label={tr('面包屑', 'Breadcrumb', '麵包屑')}>
                  <h1>{tr('回收站', 'Recycle Bin', '回收站')}</h1>
                </nav>
                <div className="trash-page__actions">
                  <label className="trash-retention-control">
                    <span>{tr('保留天数', 'Keep for', '保留天數')}</span>
                    <select
                      aria-label={tr('回收站保留天数', 'Recycle Bin retention', '回收站保留天數')}
                      value={settings.trashRetentionDays}
                      disabled={trashRetentionSaving}
                      onChange={(event) =>
                        void updateTrashRetention(
                          Number(event.target.value) as TrashRetentionDays
                        )
                      }
                    >
                      {TRASH_RETENTION_OPTIONS.map((days) => (
                        <option key={days} value={days}>
                          {tr(`${days} 天`, `${days} days`, `${days} 天`)}
                        </option>
                      ))}
                    </select>
                    {trashRetentionSaving && <LoaderCircle size={14} className="spin" />}
                  </label>
                  <button
                    type="button"
                    className="button button--ghost button--small"
                    onClick={() => void refreshAccounts()}
                    disabled={manualRefreshing}
                  >
                    <RefreshCw size={14} className={manualRefreshing ? 'spin' : undefined} />
                    {tr('刷新', 'Refresh', '重新整理')}
                  </button>
                </div>
              </header>

              {deletedAccounts.length === 0 ? (
                <CompactEmptyState
                  title={tr('回收站是空的', 'Recycle Bin is empty', '回收站是空的')}
                  description={tr(
                    `删除的账号会在这里保留 ${settings.trashRetentionDays} 天，可随时恢复。`,
                    `Deleted accounts are kept here for ${settings.trashRetentionDays} days and can be restored at any time.`,
                    `刪除的帳號會在這裡保留 ${settings.trashRetentionDays} 天，可隨時恢復。`
                  )}
                />
              ) : (
                <div className="trash-list" role="table" aria-label={tr('已删除账号', 'Deleted accounts', '已刪除帳號')}>
                  <div className="trash-list__header" role="row">
                    <span>{tr('站点', 'Site', '站點')}</span>
                    <span>{tr('用户名', 'Username', '使用者名稱')}</span>
                    <span>{tr('分组', 'Group', '分組')}</span>
                    <span>{tr('删除时间', 'Deleted', '刪除時間')}</span>
                    <span>{tr('操作', 'Actions', '操作')}</span>
                  </div>
                  {deletedAccounts.map((account) => (
                    <div className="trash-row" role="row" key={account.id}>
                      <div className="account-identity">
                        <span className={`monogram ${toneClass(account.siteId)}`}>
                          {account.site.name.slice(0, 1).toUpperCase()}
                        </span>
                        <div>
                          <strong>{account.site.name}</strong>
                        </div>
                      </div>
                      <div className="account-username">
                        <UserRound size={14} />
                        <strong>{account.username}</strong>
                      </div>
                      <div className="account-group-cell">
                        <Layers3 size={13} />
                        <span>{displayGroup(account, tr)}</span>
                      </div>
                      <time className="account-updated" dateTime={account.deletedAt}>
                        {formatDate(account.deletedAt, {
                          year: 'numeric',
                          month: 'short',
                          day: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit'
                        })}
                      </time>
                      <button
                        type="button"
                        className="button button--ghost button--small trash-restore-button"
                        onClick={() => void restoreAccount(account.id)}
                        disabled={restoringAccountId === account.id}
                      >
                        {restoringAccountId === account.id ? (
                          <LoaderCircle size={14} className="spin" />
                        ) : (
                          <Undo2 size={14} />
                        )}
                        {tr('恢复', 'Restore', '恢復')}
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </section>
          )}

          {view === 'settings' && (
            <SettingsPage
              module={settingsModule}
              settings={settings}
              appVersion={appVersion}
              onModuleChange={chooseSettingsModule}
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
          groups={groupDefinitions}
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
  tr,
  formatLastUsed,
  onToggleSelection,
  onEdit,
  onCopy,
  onLogin
}: {
  account: AccountWithSite
  checked: boolean
  index: number
  tr: Translate
  formatLastUsed: (value?: string) => string
  onToggleSelection?: () => void
  onEdit: () => void
  onCopy: (event: React.MouseEvent<HTMLButtonElement>) => void
  onLogin: () => void
}): React.JSX.Element {
  return (
    <article
      className={`account-row${checked ? ' is-selected' : ''}`}
      style={{ '--row-index': index } as React.CSSProperties}
      onClick={onEdit}
    >
      <SelectionCheckbox
        checked={checked}
        label={tr(
          `选择站点 ${account.site.name}`,
          `Select ${account.site.name}`,
          `選擇站點 ${account.site.name}`
        )}
        onChange={() => onToggleSelection?.()}
      />
      <div className="account-identity">
        <span className={`monogram ${toneClass(account.siteId)}`}>
          {account.site.name.slice(0, 1).toUpperCase()}
        </span>
        <div>
          <div className="account-name-line">
            <strong>{account.site.name}</strong>
          </div>
        </div>
      </div>
      <div className="account-username">
        <UserRound size={14} />
        <strong>{account.username}</strong>
      </div>
      <div className="account-group-cell">
        <Layers3 size={13} />
        <span>{displayGroup(account, tr)}</span>
      </div>
      <time className="account-updated" dateTime={account.updatedAt}>
        {formatLastUsed(account.updatedAt)}
      </time>
      <div className="account-status-cell">
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
        <button
          className="row-login-button row-action-button--icon"
          onClick={(event) => {
            event.stopPropagation()
            onLogin()
          }}
          aria-label={tr('登录', 'Sign in', '登入')}
          title={tr('登录', 'Sign in', '登入')}
        >
          <LogIn size={15} />
        </button>
        <button
          className="row-edit-button row-action-button--icon"
          onClick={(event) => {
            event.stopPropagation()
            onEdit()
          }}
          aria-label={tr('编辑', 'Edit', '編輯')}
          title={tr('编辑', 'Edit', '編輯')}
        >
          <Pencil size={14} />
        </button>
        <button
          className="icon-button icon-button--small account-copy-trigger"
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.stopPropagation()
            onCopy(event)
          }}
          aria-label={tr('复制账号内容', 'Copy account options', '複製帳號內容')}
          title={tr('复制账号内容', 'Copy account options', '複製帳號內容')}
        >
          <Copy size={14} />
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

function groupParentPath(path: string): string | null {
  const parts = path.split(GROUP_PATH_SEPARATOR).filter(Boolean)
  if (parts.length <= 1) return null
  return parts.slice(0, -1).join(GROUP_PATH_SEPARATOR)
}

function groupLevel(path: string): number {
  return Math.max(1, path.split(GROUP_PATH_SEPARATOR).filter(Boolean).length)
}

function flattenGroupTree(
  groups: GroupSummary[],
  order: Map<string, number>,
  language: string
): GroupSummary[] {
  const named = groups.filter(
    (group): group is GroupSummary & { actualName: string } => group.actualName !== null
  )
  const ungrouped = groups.filter((group) => group.actualName === null)
  const result: GroupSummary[] = []
  const visited = new Set<string>()
  const compare = (left: GroupSummary, right: GroupSummary): number => {
    const leftOrder =
      order.get(left.actualName ?? left.key) ?? order.get(left.name) ?? Number.MAX_SAFE_INTEGER
    const rightOrder =
      order.get(right.actualName ?? right.key) ?? order.get(right.name) ?? Number.MAX_SAFE_INTEGER
    if (leftOrder !== rightOrder) return leftOrder - rightOrder
    return left.name.localeCompare(right.name, language)
  }

  const visit = (parentPath: string | null): void => {
    const children = named
      .filter((group) => group.parentPath === parentPath && !visited.has(group.key))
      .sort(compare)
    for (const group of children) {
      visited.add(group.key)
      result.push(group)
      visit(group.actualName)
    }
  }

  visit(null)
  // Invalid or partially recovered paths still need to remain reachable.
  for (const group of named.filter((entry) => !visited.has(entry.key)).sort(compare)) {
    visited.add(group.key)
    result.push(group)
    visit(group.actualName)
  }
  return [...result, ...ungrouped]
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
