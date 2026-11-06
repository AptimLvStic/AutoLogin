import { forwardRef, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  ArchiveRestore,
  Bookmark,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Copy,
  Database,
  FileClock,
  FileSpreadsheet,
  FolderOpen,
  Globe2,
  GripVertical,
  ImagePlus,
  KeyRound,
  Layers3,
  LoaderCircle,
  LogIn,
  LockKeyhole,
  Maximize2,
  MoveHorizontal,
  PanelLeftClose,
  PanelLeftOpen,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Settings,
  SlidersHorizontal,
  Sparkles,
  Square,
  Trash2,
  Undo2,
  UserRound,
  X
} from 'lucide-react'
import {
  ACCOUNT_TAB_COLORS,
  DEFAULT_ACCOUNT_TAB_ID,
  GROUP_MAX_DEPTH,
  GROUP_PATH_SEPARATOR,
  TRASH_RETENTION_OPTIONS,
  UNGROUPED_GROUP_KEY,
  type AccountTab,
  type AccountWithSite,
  type AppSettings,
  type AppUpdateState,
  type DeletedAccountWithSite,
  type GroupDefinition,
  type LoginBatchState,
  type LoginStrategy,
  type ManualLoginSelectors,
  type Site,
  type TrashRetentionDays
} from '@shared/types'
import { matchesKeyboardShortcut } from '@shared/shortcuts'
import { useI18n } from '../i18n'
import { AccountDrawer } from './AccountDrawer'
import { AccountTabs, DatabaseCreateIcon } from './AccountTabs'
import { AccountTransferControls } from './AccountTransferControls'
import { AppLogsPage } from './AppLogsPage'
import {
  BookmarkExportButton,
  BookmarkImportButton
} from './BookmarkImportButton'
import { LoadingSpinner } from './LoadingSpinner'
import { LoginLogsPage } from './LoginLogsPage'
import { ConfirmDialog, Modal } from './Modal'
import { PageSizePicker } from './PageSizePicker'
import { PasswordGenerator } from './PasswordGenerator'
import { SettingsPage, type SettingsModule } from './SettingsPage'
import { SiteMark } from './SiteMark'

type LibraryView =
  | 'accounts'
  | 'bookmarks'
  | 'passwordGenerator'
  | 'loginLogs'
  | 'appLogs'
  | 'trash'
  | 'settings'
type GroupDropPosition = 'before' | 'after' | 'inside'
type DrawerState = { mode: 'create'; siteId?: string } | { mode: 'edit'; accountId: string }
type AccountMenuState =
  | {
      kind: 'account'
      account: AccountWithSite
      anchorX: number
      anchorY: number
      left: number
      top: number
    }
  | { kind: 'page'; anchorX: number; anchorY: number; left: number; top: number }
type AccountColumnSizing = 'content' | 'window' | 'manual'
type AccountPageSize = 10 | 20 | 50 | 100 | 200
const ACCOUNT_COLUMN_KEYS = ['username', 'group', 'updated', 'status', 'url'] as const
const ACCOUNT_PAGE_SIZES: AccountPageSize[] = [10, 20, 50, 100, 200]
type AccountColumnKey = (typeof ACCOUNT_COLUMN_KEYS)[number]
type AccountColumnResizeKey = 'site' | AccountColumnKey | 'actions'
const ACCOUNT_COLUMN_STORAGE_KEY = 'autologin.account.visibleColumns'
const ACCOUNT_COLUMN_ORDER_STORAGE_KEY = 'autologin.account.columnOrder'
const ACCOUNT_COLUMN_SIZING_STORAGE_KEY = 'autologin.account.columnSizing'
const ACCOUNT_COLUMN_WIDTH_STORAGE_KEY = 'autologin.account.columnWidths'
const ACCOUNT_ACTIVE_TAB_STORAGE_KEY = 'autologin.account.activeTab'
const BOOKMARK_ACTIVE_TAB_STORAGE_KEY = 'autologin.bookmark.activeTab'
const ACCOUNT_COLUMN_DEFAULT_WIDTHS: Record<AccountColumnResizeKey, number> = {
  site: 220,
  username: 150,
  group: 90,
  updated: 86,
  status: 72,
  url: 180,
  actions: 80
}
const ACCOUNT_COLUMN_MIN_WIDTHS: Record<AccountColumnResizeKey, number> = {
  site: 90,
  username: 58,
  group: 40,
  updated: 54,
  status: 46,
  url: 68,
  actions: 52
}
const ACCOUNT_COLUMN_TRACKS = {
  wide: {
    checkbox: '22px',
    site: 'minmax(120px, 1.15fr)',
    username: 'minmax(80px, 0.78fr)',
    group: 'minmax(52px, 0.5fr)',
    updated: '82px',
    status: '70px',
    url: 'minmax(112px, 0.9fr)',
    actions: '98px'
  },
  medium: {
    checkbox: '20px',
    site: 'minmax(96px, 1.1fr)',
    username: 'minmax(68px, 0.78fr)',
    group: 'minmax(44px, 0.48fr)',
    updated: '68px',
    status: '56px',
    url: 'minmax(92px, 0.85fr)',
    actions: '96px'
  },
  compact: {
    checkbox: '20px',
    site: 'minmax(84px, 1.1fr)',
    username: 'minmax(58px, 0.78fr)',
    group: 'minmax(40px, 0.5fr)',
    updated: '60px',
    status: '52px',
    url: 'minmax(78px, 0.8fr)',
    actions: '92px'
  },
  narrow: {
    checkbox: '20px',
    site: 'minmax(72px, 1.05fr)',
    username: 'minmax(48px, 0.72fr)',
    group: 'minmax(34px, 0.45fr)',
    updated: '52px',
    status: '46px',
    url: 'minmax(68px, 0.8fr)',
    actions: '88px'
  }
} as const
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
const UNGROUPED_KEY = UNGROUPED_GROUP_KEY
const ACCOUNT_SUBNAV_DEFAULT_WIDTH = 184
const ACCOUNT_SUBNAV_MIN_WIDTH = 128
const ACCOUNT_SUBNAV_MAX_WIDTH = 320
const ACCOUNT_SUBNAV_HIDE_THRESHOLD = 132

function accountColumnTemplate(
  visibleColumns: Set<AccountColumnKey>,
  columnOrder: readonly AccountColumnKey[],
  density: keyof typeof ACCOUNT_COLUMN_TRACKS,
  sizing: AccountColumnSizing,
  manualWidths: Record<AccountColumnResizeKey, number>,
  fitContentWidths: Record<AccountColumnResizeKey, number>
): string {
  if (sizing === 'content') {
    return [
      '22px',
      `${fitContentWidths.site}px`,
      ...columnOrder.filter((key) => visibleColumns.has(key)).map(
        (key) => `${fitContentWidths[key]}px`
      ),
      `${fitContentWidths.actions}px`
    ].join(' ')
  }
  const tracks = ACCOUNT_COLUMN_TRACKS[density]
  if (sizing === 'manual') {
    return [
      tracks.checkbox,
      `${manualWidths.site}px`,
      ...columnOrder.filter((key) => visibleColumns.has(key)).map(
        (key) => `${manualWidths[key]}px`
      ),
      `${manualWidths.actions}px`
    ].join(' ')
  }
  return [
    tracks.checkbox,
    tracks.site,
    ...columnOrder.filter((key) => visibleColumns.has(key)).map(
      (key) => tracks[key]
    ),
    tracks.actions
  ].join(' ')
}

function normalizeAccountColumnOrder(value: unknown): AccountColumnKey[] {
  const valid = Array.isArray(value)
    ? value.filter(
        (entry): entry is AccountColumnKey =>
          typeof entry === 'string' &&
          ACCOUNT_COLUMN_KEYS.includes(entry as AccountColumnKey)
      )
    : []
  return [
    ...new Set(valid),
    ...ACCOUNT_COLUMN_KEYS.filter((key) => !valid.includes(key))
  ]
}

function accountColumnOrderStyle(
  columnOrder: readonly AccountColumnKey[],
  key: AccountColumnResizeKey
): number {
  if (key === 'site') return 1
  if (key === 'actions') return columnOrder.length + 2
  const index = columnOrder.indexOf(key)
  return index < 0 ? columnOrder.length + 1 : index + 2
}

function measureAccountColumnWidths(
  header: HTMLElement,
  rows: HTMLElement[],
  visibleColumns: Set<AccountColumnKey>
): Record<AccountColumnResizeKey, number> {
  const widths = { ...ACCOUNT_COLUMN_DEFAULT_WIDTHS }
  const probe = document.createElement('div')
  probe.style.cssText =
    'position:fixed;left:-10000px;top:0;display:flex;flex-direction:column;align-items:flex-start;width:max-content;visibility:hidden;pointer-events:none;'
  document.body.append(probe)

  const measure = (source: HTMLElement | null): number => {
    if (!source) return 0
    const clone = source.cloneNode(true) as HTMLElement
    clone
      .querySelectorAll('.account-column-resizer')
      .forEach((node) => node.remove())
    clone.style.cssText =
      'display:flex;width:max-content;min-width:0;max-width:none;align-items:center;'
    probe.append(clone)
    const width = clone.getBoundingClientRect().width
    clone.remove()
    return width
  }

  try {
    for (const key of ['site', ...ACCOUNT_COLUMN_KEYS, 'actions'] as const) {
      if (key !== 'site' && key !== 'actions' && !visibleColumns.has(key)) {
        continue
      }
      const cells = [
        header.querySelector<HTMLElement>(`[data-column-key="${key}"]`),
        ...rows.map((row) =>
          row.querySelector<HTMLElement>(`[data-column-key="${key}"]`)
        )
      ]
      const contentWidth = Math.max(0, ...cells.map(measure))
      const horizontalRoom = key === 'actions' ? 8 : 18
      widths[key] = Math.max(
        ACCOUNT_COLUMN_MIN_WIDTHS[key],
        Math.min(520, Math.ceil(contentWidth + horizontalRoom))
      )
    }
  } finally {
    probe.remove()
  }

  return widths
}

export function LibraryScreen({
  accounts: allAccounts,
  sites: allSites,
  settings,
  appVersion,
  updateState,
  batchState,
  onRefresh,
  onLock,
  onStartBatch,
  onCancelBatch,
  onRecord,
  onDownloadUpdate,
  onCancelUpdate,
  onInstallUpdate,
  onCleared,
  notify
}: {
  accounts: AccountWithSite[]
  sites: Site[]
  settings: AppSettings
  appVersion: string
  updateState: AppUpdateState | null
  batchState: LoginBatchState | null
  onRefresh: () => Promise<void>
  onLock: () => Promise<void>
  onStartBatch: (accountIds: string[]) => Promise<boolean>
  onCancelBatch: () => Promise<void>
  onRecord: (account: AccountWithSite) => void
  onDownloadUpdate: () => Promise<void>
  onCancelUpdate: () => Promise<void>
  onInstallUpdate: () => Promise<void>
  onCleared: () => void
  notify: (kind: 'success' | 'error' | 'info', message: string) => void
}): React.JSX.Element {
  const { tr, language, formatDate } = useI18n()
  const [tabs, setTabs] = useState<AccountTab[]>([])
  const [accountTabId, setAccountTabId] = useState(() => {
    const stored = window.localStorage.getItem(ACCOUNT_ACTIVE_TAB_STORAGE_KEY)
    return stored?.trim() || DEFAULT_ACCOUNT_TAB_ID
  })
  const [bookmarkTabId, setBookmarkTabId] = useState(
    () => window.localStorage.getItem(BOOKMARK_ACTIVE_TAB_STORAGE_KEY)?.trim() || ''
  )
  const [view, setView] = useState<LibraryView>('accounts')
  const activeTabId = view === 'bookmarks' ? bookmarkTabId : accountTabId
  const accountTabs = useMemo(
    () => tabs.filter((tab) => !tab.hidden && tab.source !== 'bookmarks'),
    [tabs]
  )
  const bookmarkTabs = useMemo(
    () => tabs.filter((tab) => !tab.hidden && tab.source === 'bookmarks'),
    [tabs]
  )
  const visibleTabs = view === 'bookmarks' ? bookmarkTabs : accountTabs
  const isAccountCollectionView = view === 'accounts' || view === 'bookmarks'
  const showDatabaseEmptyState =
    isAccountCollectionView && visibleTabs.length === 0
  const activeTab = useMemo(
    () => visibleTabs.find((tab) => tab.id === activeTabId) ?? null,
    [activeTabId, visibleTabs]
  )
  const tabAccountCounts = useMemo(() => {
    const counts = new Map<string, number>()
    for (const account of allAccounts) {
      counts.set(account.tabId, (counts.get(account.tabId) ?? 0) + 1)
    }
    return counts
  }, [allAccounts])
  const isLogView = view === 'loginLogs' || view === 'appLogs'
  const bookmarkTabIds = useMemo(
    () => new Set(bookmarkTabs.map((tab) => tab.id)),
    [bookmarkTabs]
  )
  const bookmarkAccounts = useMemo(
    () => allAccounts.filter((account) => bookmarkTabIds.has(account.tabId)),
    [allAccounts, bookmarkTabIds]
  )
  const bookmarkSites = useMemo(
    () => allSites.filter((site) => bookmarkTabIds.has(site.tabId)),
    [allSites, bookmarkTabIds]
  )
  const accounts = useMemo(
    () => allAccounts.filter((account) => account.tabId === activeTabId),
    [activeTabId, allAccounts]
  )
  const sites = useMemo(
    () => allSites.filter((site) => site.tabId === activeTabId),
    [activeTabId, allSites]
  )
  const [groupFilter, setGroupFilter] = useState<string | null>(null)
  const [settingsModule, setSettingsModule] = useState<SettingsModule>('general')
  const [sidebarCollapsed, setSidebarCollapsed] = useState(
    () => window.localStorage.getItem('autologin.sidebar.collapsed') === '1'
  )
  const [search, setSearch] = useState('')
  const [searchExpanded, setSearchExpanded] = useState(false)
  const [visibleAccountColumns, setVisibleAccountColumns] = useState<
    Set<AccountColumnKey>
  >(() => {
    try {
      const stored = window.localStorage.getItem(ACCOUNT_COLUMN_STORAGE_KEY)
      if (!stored) return new Set(ACCOUNT_COLUMN_KEYS)
      const values = JSON.parse(stored) as unknown
      if (!Array.isArray(values)) return new Set(ACCOUNT_COLUMN_KEYS)
      return new Set(
        values.filter(
          (value): value is AccountColumnKey =>
            typeof value === 'string' &&
            ACCOUNT_COLUMN_KEYS.includes(value as AccountColumnKey)
        )
      )
    } catch {
      return new Set(ACCOUNT_COLUMN_KEYS)
    }
  })
  const availableAccountColumnKeys = useMemo(
    () =>
      view === 'bookmarks'
        ? ACCOUNT_COLUMN_KEYS.filter((key) => key !== 'status')
        : [...ACCOUNT_COLUMN_KEYS],
    [view]
  )
  const effectiveVisibleAccountColumns = useMemo(
    () =>
      view === 'bookmarks'
        ? new Set([...visibleAccountColumns].filter((key) => key !== 'status'))
        : visibleAccountColumns,
    [view, visibleAccountColumns]
  )
  const [accountColumnOrder, setAccountColumnOrder] = useState<AccountColumnKey[]>(
    () => {
      try {
        const stored = window.localStorage.getItem(ACCOUNT_COLUMN_ORDER_STORAGE_KEY)
        return normalizeAccountColumnOrder(stored ? JSON.parse(stored) : null)
      } catch {
        return [...ACCOUNT_COLUMN_KEYS]
      }
    }
  )
  const [accountColumnWidths, setAccountColumnWidths] = useState<
    Record<AccountColumnResizeKey, number>
  >(() => {
    try {
      const stored = window.localStorage.getItem(ACCOUNT_COLUMN_WIDTH_STORAGE_KEY)
      const values = stored ? (JSON.parse(stored) as unknown) : null
      if (!values || typeof values !== 'object') return { ...ACCOUNT_COLUMN_DEFAULT_WIDTHS }
      const record = values as Record<string, unknown>
      return Object.fromEntries(
        Object.entries(ACCOUNT_COLUMN_DEFAULT_WIDTHS).map(([key, fallback]) => {
          const value = record[key]
          return [
            key,
            typeof value === 'number' && Number.isFinite(value)
              ? Math.max(
                  ACCOUNT_COLUMN_MIN_WIDTHS[key as AccountColumnResizeKey],
                  Math.min(520, value)
                )
              : fallback
          ]
        })
      ) as Record<AccountColumnResizeKey, number>
    } catch {
      return { ...ACCOUNT_COLUMN_DEFAULT_WIDTHS }
    }
  })
  const [accountFitContentWidths, setAccountFitContentWidths] = useState<
    Record<AccountColumnResizeKey, number>
  >(() => ({ ...ACCOUNT_COLUMN_DEFAULT_WIDTHS }))
  const [accountColumnSizing, setAccountColumnSizing] =
    useState<AccountColumnSizing>(() => {
      const stored = window.localStorage.getItem(ACCOUNT_COLUMN_SIZING_STORAGE_KEY)
      if (stored === 'content' || stored === 'manual') return stored
      return 'window'
    })
  const [columnMenuOpen, setColumnMenuOpen] = useState(false)
  const [columnMenuPosition, setColumnMenuPosition] = useState({ left: 0, top: 0 })
  const [draggedColumnKey, setDraggedColumnKey] = useState<AccountColumnKey | null>(
    null
  )
  const [accountGroupTreeExpanded, setAccountGroupTreeExpanded] = useState(
    () => window.localStorage.getItem('autologin.account.groups.treeExpanded') !== '0'
  )
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
  const [trashSection, setTrashSection] = useState<'accounts' | 'bookmarks'>(
    'accounts'
  )
  const visibleDeletedAccounts = useMemo(
    () =>
      deletedAccounts.filter((record) =>
        trashSection === 'bookmarks'
          ? record.source === 'bookmarks'
          : record.source !== 'bookmarks'
      ),
    [deletedAccounts, trashSection]
  )
  const [groupCreateState, setGroupCreateState] = useState<{
    parent: GroupSummary | null
    left: number
    top: number
  } | null>(null)
  const [groupCreateName, setGroupCreateName] = useState('')
  const [groupCreateError, setGroupCreateError] = useState('')
  const [groupCreateBusy, setGroupCreateBusy] = useState(false)
  const [accountMenu, setAccountMenu] = useState<AccountMenuState | null>(null)
  const [tabMenu, setTabMenu] = useState<{
    tab: AccountTab
    left: number
    top: number
  } | null>(null)
  const [renameTabTarget, setRenameTabTarget] = useState<AccountTab | null>(null)
  const [renameTabValue, setRenameTabValue] = useState('')
  const [tabBusy, setTabBusy] = useState(false)
  const [restoringAccountId, setRestoringAccountId] = useState<string | null>(null)
  const [trashSelection, setTrashSelection] = useState<Set<string>>(() => new Set())
  const [purgeTargets, setPurgeTargets] = useState<string[] | null>(null)
  const [trashActionBusy, setTrashActionBusy] = useState(false)
  const [trashRetentionSaving, setTrashRetentionSaving] = useState(false)
  const [trashRetentionOpen, setTrashRetentionOpen] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set())
  const [accountPageSize, setAccountPageSize] = useState<AccountPageSize>(20)
  const [accountPage, setAccountPage] = useState(1)
  const [drawer, setDrawer] = useState<DrawerState | null>(null)
  const [draggedGroupPath, setDraggedGroupPath] = useState<string | null>(null)
  const [draggedAccountIds, setDraggedAccountIds] = useState<string[]>([])
  const [accountDropTarget, setAccountDropTarget] = useState<{
    accountId: string
    position: 'before' | 'after'
  } | null>(null)
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
  const [deleteGroupTarget, setDeleteGroupTarget] = useState<GroupSummary | null>(null)
  const [groupActionBusy, setGroupActionBusy] = useState(false)
  const [batchStrategyOpen, setBatchStrategyOpen] = useState(false)
  const [batchStrategy, setBatchStrategy] = useState<LoginStrategy>('auto')
  const [batchSelectors, setBatchSelectors] = useState<ManualLoginSelectors>({})
  const [batchStrategyError, setBatchStrategyError] = useState('')
  const [batchStrategyBusy, setBatchStrategyBusy] = useState(false)
  const [batchIcon, setBatchIcon] = useState<string | null>(null)
  const [batchIconBusy, setBatchIconBusy] = useState(false)
  const [batchIconFetchBusy, setBatchIconFetchBusy] = useState(false)
  const [duplicateBusy, setDuplicateBusy] = useState(false)
  const [accountClipboardIds, setAccountClipboardIds] = useState<string[]>([])
  const [keyboardDuplicateBusy, setKeyboardDuplicateBusy] = useState(false)
  const [batchCancelBusy, setBatchCancelBusy] = useState(false)
  const [manualRefreshing, setManualRefreshing] = useState(false)
  const [deleteSelectedOpen, setDeleteSelectedOpen] = useState(false)
  const [deleteSelectedBusy, setDeleteSelectedBusy] = useState(false)
  const searchRef = useRef<HTMLInputElement>(null)
  const selectAllRef = useRef<HTMLInputElement>(null)
  const selectionAnchorRef = useRef<string | null>(null)
  const trashSelectAllRef = useRef<HTMLInputElement>(null)
  const trashRetentionRef = useRef<HTMLDivElement>(null)
  const groupCreateInputRef = useRef<HTMLInputElement>(null)
  const batchIconInputRef = useRef<HTMLInputElement>(null)
  const columnMenuRef = useRef<HTMLDivElement>(null)
  const accountMenuRef = useRef<HTMLDivElement>(null)
  const columnResizeCleanupRef = useRef<(() => void) | null>(null)
  const accountListRef = useRef<HTMLElement>(null)
  const accountTableScrollRef = useRef<HTMLDivElement>(null)
  const accountLayoutRef = useRef<HTMLDivElement>(null)
  const draggedGroupPathRef = useRef<string | null>(null)
  const draggedAccountIdsRef = useRef<string[]>([])
  const subnavResizeRef = useRef<{
    startX: number
    startWidth: number
    latestWidth: number
    pendingWidth: number
    frameId: number | null
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
    if (!grouped.has(UNGROUPED_KEY)) {
      grouped.set(UNGROUPED_KEY, {
        key: UNGROUPED_KEY,
        name: tr('未分组', 'Ungrouped', '未分組'),
        actualName: null,
        parentPath: null,
        level: 1,
        count: 0,
        accounts: []
      })
    }

    const scopedGroupOrder =
      settings.groupOrders?.[activeTabId] ??
      (activeTabId === DEFAULT_ACCOUNT_TAB_ID ? settings.groupOrder : [])
    const order = new Map(scopedGroupOrder.map((name, index) => [name, index]))
    const values = [...grouped.values()].map((group) => ({
      ...group,
      accounts: [...group.accounts].sort(compareAccounts)
    }))
    return flattenGroupTree(values, order, language)
  }, [
    accounts,
    activeTabId,
    groupDefinitions,
    language,
    settings.groupOrder,
    settings.groupOrders,
    sites,
    tr
  ])
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
  const visibleTreeGroups = useMemo(
    () =>
      groups.filter((group) => {
        if (!group.actualName) return true
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
    [collapsedGroupPaths, groups]
  )

  const currentGroup = groupFilter
    ? groups.find((group) => group.key === groupFilter) ?? null
    : null
  const currentBreadcrumb = useMemo(() => {
    if (!currentGroup) {
      return [
        {
          label:
            view === 'bookmarks'
              ? tr('全部书签', 'All bookmarks', '全部書籤')
              : tr('全部账号', 'All accounts', '全部帳號'),
          path: null as string | null
        }
      ]
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
  }, [currentGroup, tr, view])
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

  const accountPageCount = Math.max(
    1,
    Math.ceil(filteredAccounts.length / accountPageSize)
  )
  const currentAccountPage = Math.min(accountPage, accountPageCount)
  const pagedAccounts = useMemo(
    () =>
      filteredAccounts.slice(
        (currentAccountPage - 1) * accountPageSize,
        currentAccountPage * accountPageSize
      ),
    [accountPageSize, currentAccountPage, filteredAccounts]
  )
  const visibleSelectedIds = useMemo(
    () =>
      filteredAccounts.filter((account) => selectedIds.has(account.id)).map((account) => account.id),
    [filteredAccounts, selectedIds]
  )
  const pageSelectedIds = useMemo(
    () => pagedAccounts.filter((account) => selectedIds.has(account.id)).map((account) => account.id),
    [pagedAccounts, selectedIds]
  )
  const allPageSelected =
    pagedAccounts.length > 0 && pageSelectedIds.length === pagedAccounts.length
  const somePageSelected = pageSelectedIds.length > 0 && !allPageSelected
  const selectedAccountCount = selectedIds.size
  const selectedAccounts = useMemo(
    () => accounts.filter((account) => selectedIds.has(account.id)),
    [accounts, selectedIds]
  )
  const drawerAccount =
    drawer?.mode === 'edit'
      ? accounts.find((account) => account.id === drawer.accountId) ?? null
      : null
  const accountEditorOpen = Boolean(
    drawer && (drawer.mode === 'create' || drawerAccount)
  )
  const accountGridStyle = useMemo(
    () =>
      ({
        '--account-columns-wide': accountColumnTemplate(
          effectiveVisibleAccountColumns,
          accountColumnOrder,
          'wide',
          accountColumnSizing,
          accountColumnWidths,
          accountFitContentWidths
        ),
        '--account-columns-medium': accountColumnTemplate(
          effectiveVisibleAccountColumns,
          accountColumnOrder,
          'medium',
          accountColumnSizing,
          accountColumnWidths,
          accountFitContentWidths
        ),
        '--account-columns-compact': accountColumnTemplate(
          effectiveVisibleAccountColumns,
          accountColumnOrder,
          'compact',
          accountColumnSizing,
          accountColumnWidths,
          accountFitContentWidths
        ),
        '--account-columns-narrow': accountColumnTemplate(
          effectiveVisibleAccountColumns,
          accountColumnOrder,
          'narrow',
          accountColumnSizing,
          accountColumnWidths,
          accountFitContentWidths
        )
      }) as React.CSSProperties,
    [
      accountFitContentWidths,
      accountColumnOrder,
      accountColumnSizing,
      accountColumnWidths,
      effectiveVisibleAccountColumns
    ]
  )

  useEffect(() => {
    let cancelled = false
    void Promise.all([
      window.autologin.tabs.list(),
      window.autologin.accounts.listDeleted()
    ])
      .then(([nextTabs, nextDeleted]) => {
        if (cancelled) return
        setTabs(nextTabs)
        const nextAccountTabs = nextTabs.filter(
          (tab) => !tab.hidden && tab.source !== 'bookmarks'
        )
        if (!nextAccountTabs.some((tab) => tab.id === accountTabId)) {
          setAccountTabId(
            nextAccountTabs.find((tab) => tab.id === DEFAULT_ACCOUNT_TAB_ID)?.id ??
              nextAccountTabs[0]?.id ??
              DEFAULT_ACCOUNT_TAB_ID
          )
        }
        const nextBookmarkTabs = nextTabs.filter(
          (tab) => !tab.hidden && tab.source === 'bookmarks'
        )
        if (!nextBookmarkTabs.some((tab) => tab.id === bookmarkTabId)) {
          setBookmarkTabId(nextBookmarkTabs[0]?.id ?? '')
        }
        setDeletedAccounts(nextDeleted)
      })
      .catch(() => {
        if (cancelled) return
        setTabs([])
        setDeletedAccounts([])
      })
    return () => {
      cancelled = true
    }
  }, [accountTabId, activeTabId, bookmarkTabId])

  useEffect(() => {
    let cancelled = false
    setGroupFilter(null)
    setSearch('')
    setSearchExpanded(false)
    setSelectedIds(new Set())
    selectionAnchorRef.current = null
    setDrawer(null)
    if (!activeTabId) {
      setGroupDefinitions([])
      return () => {
        cancelled = true
      }
    }
    void window.autologin.groups
      .list(activeTabId)
      .then((nextGroups) => {
        if (!cancelled) setGroupDefinitions(nextGroups)
      })
      .catch(() => {
        if (!cancelled) setGroupDefinitions([])
      })
    return () => {
      cancelled = true
    }
  }, [activeTabId])

  useEffect(() => {
    window.localStorage.setItem(ACCOUNT_ACTIVE_TAB_STORAGE_KEY, accountTabId)
  }, [accountTabId])

  useEffect(() => {
    if (bookmarkTabId) {
      window.localStorage.setItem(BOOKMARK_ACTIVE_TAB_STORAGE_KEY, bookmarkTabId)
    } else {
      window.localStorage.removeItem(BOOKMARK_ACTIVE_TAB_STORAGE_KEY)
    }
  }, [bookmarkTabId])

  useEffect(() => {
    setSelectedIds((current) => {
      const accountIds = new Set(accounts.map((account) => account.id))
      const next = new Set([...current].filter((id) => accountIds.has(id)))
      return next.size === current.size ? current : next
    })
  }, [accounts])

  useEffect(() => {
    setTrashSelection((current) => {
      const available = new Set(
        visibleDeletedAccounts.map((account) => account.id)
      )
      const next = new Set([...current].filter((id) => available.has(id)))
      return next.size === current.size ? current : next
    })
  }, [visibleDeletedAccounts])

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
      selectAllRef.current.indeterminate = somePageSelected
    }
  }, [somePageSelected])

  useEffect(() => {
    setAccountPage(1)
  }, [accountPageSize, activeTabId, groupFilter, search])

  useEffect(() => {
    if (trashSelectAllRef.current) {
      trashSelectAllRef.current.indeterminate =
        trashSelection.size > 0 &&
        trashSelection.size < visibleDeletedAccounts.length
    }
  }, [trashSelection.size, visibleDeletedAccounts.length])

  useEffect(() => {
    if (!trashRetentionOpen) return
    const closeOnPointer = (event: PointerEvent): void => {
      if (
        event.target instanceof Node &&
        trashRetentionRef.current?.contains(event.target)
      ) {
        return
      }
      setTrashRetentionOpen(false)
    }
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setTrashRetentionOpen(false)
    }
    document.addEventListener('pointerdown', closeOnPointer)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('pointerdown', closeOnPointer)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [trashRetentionOpen])

  useEffect(() => {
    if (!isAccountCollectionView) {
      setSelectedIds(new Set())
      selectionAnchorRef.current = null
    }
  }, [isAccountCollectionView])

  useEffect(() => {
    if (!tabMenu) return
    const close = (): void => setTabMenu(null)
    const closeOnPointer = (event: PointerEvent): void => {
      if (event.target instanceof Element && event.target.closest('.account-tab-menu')) {
        return
      }
      close()
    }
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') close()
    }
    document.addEventListener('pointerdown', closeOnPointer)
    document.addEventListener('keydown', closeOnEscape)
    window.addEventListener('blur', close)
    return () => {
      document.removeEventListener('pointerdown', closeOnPointer)
      document.removeEventListener('keydown', closeOnEscape)
      window.removeEventListener('blur', close)
    }
  }, [tabMenu])

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
    const focusFrame = window.requestAnimationFrame(() =>
      groupCreateInputRef.current?.focus()
    )
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
      window.cancelAnimationFrame(focusFrame)
      document.removeEventListener('pointerdown', closeOnPointer)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [groupCreateState])

  useEffect(() => {
    if (!accountMenu) return
    const close = (): void => setAccountMenu(null)
    const closeOnPointer = (event: PointerEvent): void => {
      if (event.target instanceof Element && event.target.closest('.account-context-menu')) {
        return
      }
      close()
    }
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') close()
    }
    document.addEventListener('pointerdown', closeOnPointer)
    document.addEventListener('keydown', closeOnEscape)
    window.addEventListener('resize', close)
    window.addEventListener('scroll', close, true)
    window.addEventListener('wheel', close, { passive: true })
    return () => {
      document.removeEventListener('pointerdown', closeOnPointer)
      document.removeEventListener('keydown', closeOnEscape)
      window.removeEventListener('resize', close)
      window.removeEventListener('scroll', close, true)
      window.removeEventListener('wheel', close)
    }
  }, [accountMenu])

  useLayoutEffect(() => {
    if (!accountMenu) return
    const menu = accountMenuRef.current
    if (!menu) return
    const rect = menu.getBoundingClientRect()
    const margin = 8
    const left = Math.max(
      margin,
      Math.min(accountMenu.anchorX, window.innerWidth - rect.width - margin)
    )
    const top =
      accountMenu.anchorY + rect.height + margin <= window.innerHeight
        ? accountMenu.anchorY
        : Math.max(margin, accountMenu.anchorY - rect.height - margin)
    if (
      Math.abs(left - accountMenu.left) < 0.5 &&
      Math.abs(top - accountMenu.top) < 0.5
    ) {
      return
    }
    setAccountMenu((current) =>
      current ? { ...current, left, top } : current
    )
  }, [accountMenu])

  useEffect(() => {
    if (!columnMenuOpen) return
    const closeOnPointer = (event: PointerEvent): void => {
      if (
        event.target instanceof Node &&
        columnMenuRef.current?.contains(event.target)
      ) {
        return
      }
      setColumnMenuOpen(false)
    }
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setColumnMenuOpen(false)
    }
    const close = (): void => setColumnMenuOpen(false)
    document.addEventListener('pointerdown', closeOnPointer)
    document.addEventListener('keydown', closeOnEscape)
    window.addEventListener('blur', close)
    window.addEventListener('resize', close)
    return () => {
      document.removeEventListener('pointerdown', closeOnPointer)
      document.removeEventListener('keydown', closeOnEscape)
      window.removeEventListener('blur', close)
      window.removeEventListener('resize', close)
    }
  }, [columnMenuOpen])

  useEffect(() => {
    if (!searchExpanded) return
    const focusFrame = window.requestAnimationFrame(() =>
      searchRef.current?.focus()
    )
    return () => window.cancelAnimationFrame(focusFrame)
  }, [searchExpanded])

  useEffect(() => {
    window.localStorage.setItem(
      ACCOUNT_COLUMN_WIDTH_STORAGE_KEY,
      JSON.stringify(accountColumnWidths)
    )
  }, [accountColumnWidths])

  useEffect(() => {
    window.localStorage.setItem(ACCOUNT_COLUMN_SIZING_STORAGE_KEY, accountColumnSizing)
  }, [accountColumnSizing])

  useEffect(() => {
    if (accountColumnSizing !== 'content') return
    const list = accountListRef.current
    const header = list?.querySelector<HTMLElement>('.account-list__header')
    if (!list || !header) return
    const rows = [...list.querySelectorAll<HTMLElement>('.account-row')]
    const frame = window.requestAnimationFrame(() => {
      const next = measureAccountColumnWidths(
        header,
        rows,
        effectiveVisibleAccountColumns
      )
      setAccountFitContentWidths((current) =>
        Object.entries(next).every(
          ([key, value]) =>
            current[key as AccountColumnResizeKey] === value
        )
          ? current
          : next
      )
    })
    return () => window.cancelAnimationFrame(frame)
  }, [
    accountColumnSizing,
    accountColumnOrder,
    pagedAccounts,
    settings.fontSizeScale,
    effectiveVisibleAccountColumns
  ])

  useEffect(() => {
    window.localStorage.setItem(
      ACCOUNT_COLUMN_ORDER_STORAGE_KEY,
      JSON.stringify(accountColumnOrder)
    )
  }, [accountColumnOrder])

  useEffect(() => () => subnavResizeCleanupRef.current?.(), [])
  useEffect(() => () => columnResizeCleanupRef.current?.(), [])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        if (!isAccountCollectionView) return
        event.preventDefault()
        setSearchExpanded(true)
        window.requestAnimationFrame(() => searchRef.current?.focus())
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [isAccountCollectionView])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (
        !isAccountCollectionView ||
        accountEditorOpen ||
        batchState?.active ||
        batchStrategyOpen ||
        deleteSelectedOpen
      ) {
        return
      }
      const target = event.target instanceof Element ? event.target : null
      if (
        target?.closest(
          'textarea, select, input:not([type="checkbox"]):not([type="radio"]), [contenteditable="true"]'
        )
      ) {
        return
      }
      const modifier = event.ctrlKey || event.metaKey
      if (
        settings.accountCopyShortcutEnabled &&
        matchesKeyboardShortcut(event, settings.accountCopyShortcut)
      ) {
        if (visibleSelectedIds.length === 0) return
        event.preventDefault()
        setAccountClipboardIds([...visibleSelectedIds])
        notify(
          'info',
          tr(
            `已复制 ${visibleSelectedIds.length} 个账号，按 Ctrl+V 粘贴`,
            `Copied ${visibleSelectedIds.length} account${visibleSelectedIds.length === 1 ? '' : 's'}. Press Ctrl+V to paste.`,
            `已複製 ${visibleSelectedIds.length} 個帳號，按 Ctrl+V 貼上`
          )
        )
        return
      }
      if (modifier && event.key.toLowerCase() === 'v') {
        if (accountClipboardIds.length === 0 || keyboardDuplicateBusy) return
        event.preventDefault()
        void pasteAccountClipboard()
        return
      }
      if (!modifier && event.key === 'Delete' && selectedIds.size > 0) {
        event.preventDefault()
        setDeleteSelectedOpen(true)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [
    accountClipboardIds,
    accountEditorOpen,
    batchState?.active,
    batchStrategyOpen,
    deleteSelectedOpen,
    keyboardDuplicateBusy,
    notify,
    selectedIds.size,
    settings.accountCopyShortcut,
    settings.accountCopyShortcutEnabled,
    tr,
    isAccountCollectionView,
    visibleSelectedIds
  ])

  async function refreshAll(): Promise<void> {
    const [, nextTabs, nextGroups, nextDeleted] = await Promise.all([
      onRefresh(),
      window.autologin.tabs.list(),
      activeTabId ? window.autologin.groups.list(activeTabId) : Promise.resolve([]),
      window.autologin.accounts.listDeleted()
    ])
    setTabs(nextTabs)
    setGroupDefinitions(nextGroups)
    setDeletedAccounts(nextDeleted)
  }

  async function handleDataImported(tabId: string): Promise<void> {
    const [nextTabs] = await Promise.all([
      window.autologin.tabs.list(),
      onRefresh()
    ])
    setTabs(nextTabs)
    const importedTab = nextTabs.find((tab) => tab.id === tabId)
    if (importedTab?.source === 'bookmarks') {
      setBookmarkTabId(tabId)
      setView('bookmarks')
    } else {
      setAccountTabId(tabId)
      setView('accounts')
    }
    setGroupDefinitions(
      (await window.autologin.groups.list(tabId)) ?? []
    )
  }

  function switchView(next: LibraryView): void {
    setView(next)
    setDrawer(null)
    setSearch('')
    setSearchExpanded(false)
    setColumnMenuOpen(false)
    setGroupFilter(null)
    setSelectedIds(new Set())
    selectionAnchorRef.current = null
  }

  function toggleAccountColumn(key: AccountColumnKey): void {
    setVisibleAccountColumns((current) => {
      const next = new Set(current)
      if (next.has(key)) {
        next.delete(key)
      } else {
        next.add(key)
      }
      window.localStorage.setItem(
        ACCOUNT_COLUMN_STORAGE_KEY,
        JSON.stringify(ACCOUNT_COLUMN_KEYS.filter((column) => next.has(column)))
      )
      return next
    })
  }

  function moveAccountColumn(source: AccountColumnKey, target: AccountColumnKey): void {
    if (source === target) return
    setAccountColumnOrder((current) => {
      const from = current.indexOf(source)
      const to = current.indexOf(target)
      if (from < 0 || to < 0) return current
      const next = [...current]
      next.splice(from, 1)
      next.splice(to, 0, source)
      return next
    })
  }

  function openColumnMenu(event: React.MouseEvent<HTMLElement>): void {
    event.preventDefault()
    event.stopPropagation()
    const menuWidth = 214
    const menuHeight = 386
    setColumnMenuPosition({
      left: Math.max(8, Math.min(event.clientX, window.innerWidth - menuWidth - 8)),
      top:
        event.clientY + menuHeight + 8 <= window.innerHeight
          ? event.clientY
          : Math.max(8, event.clientY - menuHeight)
    })
    setColumnMenuOpen(true)
  }

  function chooseAccountColumnSizing(sizing: AccountColumnSizing): void {
    setAccountColumnSizing(sizing)
    window.localStorage.setItem(ACCOUNT_COLUMN_SIZING_STORAGE_KEY, sizing)
    setColumnMenuOpen(false)
  }

  function beginAccountColumnResize(
    event: React.PointerEvent<HTMLSpanElement>,
    key: AccountColumnResizeKey
  ): void {
    if (event.button !== 0) return
    event.preventDefault()
    event.stopPropagation()
    setColumnMenuOpen(false)
    const header = event.currentTarget.closest<HTMLElement>('.account-list__header')
    if (!header) return
    const measuredWidths = { ...ACCOUNT_COLUMN_DEFAULT_WIDTHS }
    for (const cell of header.querySelectorAll<HTMLElement>(':scope > [data-column-key]')) {
      const columnKey = cell.dataset.columnKey as AccountColumnResizeKey | undefined
      const width = cell.getBoundingClientRect().width
      if (columnKey && width > 0) measuredWidths[columnKey] = Math.round(width)
    }
    const startX = event.clientX
    const startWidth = measuredWidths[key]
    setAccountColumnSizing('manual')
    setAccountColumnWidths(measuredWidths)
    columnResizeCleanupRef.current?.()
    document.body.classList.add('is-resizing-account-column')
    const onPointerMove = (moveEvent: PointerEvent): void => {
      const nextWidth = Math.max(
        ACCOUNT_COLUMN_MIN_WIDTHS[key],
        Math.min(520, startWidth + moveEvent.clientX - startX)
      )
      setAccountColumnWidths((current) => ({ ...current, [key]: nextWidth }))
    }
    const cleanup = (): void => {
      document.removeEventListener('pointermove', onPointerMove)
      document.removeEventListener('pointerup', cleanup)
      document.removeEventListener('pointercancel', cleanup)
      document.body.classList.remove('is-resizing-account-column')
      if (columnResizeCleanupRef.current === cleanup) {
        columnResizeCleanupRef.current = null
      }
    }
    columnResizeCleanupRef.current = cleanup
    document.addEventListener('pointermove', onPointerMove)
    document.addEventListener('pointerup', cleanup)
    document.addEventListener('pointercancel', cleanup)
  }

  function accountColumnResizer(
    key: AccountColumnResizeKey,
    label: string
  ): React.JSX.Element {
    return (
      <span
        className="account-column-resizer"
        role="separator"
        aria-orientation="vertical"
        aria-label={tr(`调整${label}列宽`, `Resize ${label} column`, `調整${label}欄寬`)}
        onPointerDown={(event) => beginAccountColumnResize(event, key)}
      />
    )
  }

  function accountColumnLabel(key: AccountColumnKey): string {
    if (key === 'username') return tr('用户名', 'Username', '使用者名稱')
    if (key === 'group') return tr('分组', 'Group', '分組')
    if (key === 'updated') return tr('最后更新', 'Last updated', '最後更新')
    if (key === 'status') return tr('状态', 'Status', '狀態')
    return tr('站点 URL', 'Site URL', '站點 URL')
  }

  function chooseAllAccounts(): void {
    setView('accounts')
    setGroupFilter(null)
    setSearch('')
    setSearchExpanded(false)
    setSelectedIds(new Set())
  }

  function chooseGroup(group: GroupSummary): void {
    setView(view === 'bookmarks' ? 'bookmarks' : 'accounts')
    setGroupFilter(group.key)
    setSearch('')
    setSearchExpanded(false)
    setSelectedIds(new Set())
  }

  function chooseAllAccountsFromTree(): void {
    setGroupFilter(null)
    setSearch('')
    setSearchExpanded(false)
    setSelectedIds(new Set())
    toggleAccountGroupTree()
  }

  function chooseBookmarks(): void {
    const targetId =
      bookmarkTabs.find((tab) => tab.id === bookmarkTabId)?.id ??
      bookmarkTabs[0]?.id ??
      ''
    setBookmarkTabId(targetId)
    switchView('bookmarks')
  }

  function chooseGroupFromTree(group: GroupSummary, hasChildren: boolean): void {
    chooseGroup(group)
    if (!hasChildren || !group.actualName) return
    toggleGroupExpanded(group.actualName)
  }

  function toggleAccountGroupTree(): void {
    setAccountGroupTreeExpanded((current) => {
      const next = !current
      window.localStorage.setItem(
        'autologin.account.groups.treeExpanded',
        next ? '1' : '0'
      )
      return next
    })
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

  async function createTab(source: 'local' | 'bookmarks' = 'local'): Promise<void> {
    if (tabBusy) return
    setTabBusy(true)
    try {
      const tab = await window.autologin.tabs.create(
        source === 'bookmarks'
          ? {
              name: tr('新书签标签', 'New bookmark tab', '新書籤標籤'),
              source
            }
          : { source }
      )
      setTabs((current) => [...current, tab])
      if (source === 'bookmarks') {
        setBookmarkTabId(tab.id)
        setView('bookmarks')
      } else {
        setAccountTabId(tab.id)
        setView('accounts')
      }
      notify(
        'success',
        source === 'bookmarks'
          ? tr('书签标签页已创建', 'Bookmark tab created.', '書籤標籤頁已建立')
          : tr('数据库已创建', 'Database created.', '資料庫已建立')
      )
    } catch (error) {
      notify(
        'error',
        error instanceof Error
          ? error.message
          : source === 'bookmarks'
            ? tr('创建书签标签页失败', 'Could not create bookmark tab.', '建立書籤標籤頁失敗')
            : tr('创建数据库失败', 'Could not create database.', '建立資料庫失敗')
      )
    } finally {
      setTabBusy(false)
    }
  }

  function openTabMenu(
    event: React.MouseEvent<HTMLElement>,
    tab: AccountTab
  ): void {
    event.preventDefault()
    event.stopPropagation()
    const width = 224
    const height = 218
    setTabMenu({
      tab,
      left: Math.max(8, Math.min(event.clientX, window.innerWidth - width - 8)),
      top:
        event.clientY + height + 8 <= window.innerHeight
          ? event.clientY
          : Math.max(8, event.clientY - height)
    })
  }

  function beginRenameTab(tab: AccountTab): void {
    setTabMenu(null)
    setRenameTabTarget(tab)
    setRenameTabValue(tab.name)
  }

  async function saveTabName(event: React.FormEvent): Promise<void> {
    event.preventDefault()
    if (!renameTabTarget || !renameTabValue.trim() || tabBusy) return
    setTabBusy(true)
    try {
      const updated = await window.autologin.tabs.update(renameTabTarget.id, {
        name: renameTabValue.trim()
      })
      setTabs((current) =>
        current.map((tab) => (tab.id === updated.id ? updated : tab))
      )
      setRenameTabTarget(null)
      notify(
        'success',
        renameTabTarget.source === 'bookmarks'
          ? tr('标签页名称已保存', 'Tab renamed.', '標籤頁已重新命名')
          : tr('数据库名称已保存', 'Database renamed.', '資料庫已重新命名')
      )
    } catch (error) {
      notify(
        'error',
        error instanceof Error
          ? error.message
          : renameTabTarget?.source === 'bookmarks'
            ? tr('重命名标签页失败', 'Could not rename tab.', '重新命名標籤頁失敗')
            : tr('重命名数据库失败', 'Could not rename database.', '重新命名資料庫失敗')
      )
    } finally {
      setTabBusy(false)
    }
  }

  async function setTabColor(tab: AccountTab, color: string): Promise<void> {
    if (tabBusy) return
    setTabBusy(true)
    try {
      const updated = await window.autologin.tabs.update(tab.id, { color })
      setTabs((current) =>
        current.map((entry) => (entry.id === updated.id ? updated : entry))
      )
      setTabMenu(null)
    } catch (error) {
      notify(
        'error',
        error instanceof Error
          ? error.message
          : tr('设置标签页颜色失败', 'Could not update tab color.', '設定標籤頁顏色失敗')
      )
    } finally {
      setTabBusy(false)
    }
  }

  async function closeTab(tab: AccountTab): Promise<void> {
    if (tabBusy) return
    setTabBusy(true)
    try {
      await window.autologin.tabs.delete(tab.id)
      const nextTabs = tabs.map((entry) =>
        entry.id === tab.id ? { ...entry, hidden: true } : entry
      )
      setTabs(nextTabs)
      if (activeTabId === tab.id) {
        if (tab.source === 'bookmarks') {
          const nextBookmarkTab = nextTabs.find(
            (entry) => !entry.hidden && entry.source === 'bookmarks'
          )
          setBookmarkTabId(nextBookmarkTab?.id ?? '')
        } else {
          const nextAccountTab =
            nextTabs.find(
              (entry) =>
                !entry.hidden && entry.id === DEFAULT_ACCOUNT_TAB_ID
            ) ??
            nextTabs.find(
              (entry) => !entry.hidden && entry.source !== 'bookmarks'
            )
          setAccountTabId(nextAccountTab?.id ?? '')
        }
      }
      setTabMenu(null)
      notify(
        'success',
        tab.source === 'bookmarks'
          ? tr('标签页已关闭', 'Tab closed.', '標籤頁已關閉')
          : tr('数据库已关闭', 'Database closed.', '資料庫已關閉')
      )
    } catch (error) {
      notify(
        'error',
        error instanceof Error
          ? error.message
          : tab.source === 'bookmarks'
            ? tr('关闭标签页失败', 'Could not close tab.', '關閉標籤頁失敗')
            : tr('关闭数据库失败', 'Could not close database.', '關閉資料庫失敗')
      )
    } finally {
      setTabBusy(false)
    }
  }

  async function revealTabDatabase(tab: AccountTab): Promise<void> {
    setTabMenu(null)
    try {
      await window.autologin.tabs.reveal(tab.id)
    } catch (error) {
      notify(
        'error',
        error instanceof Error
          ? error.message
          : tr('无法打开数据库文件夹', 'Could not open the database folder.', '無法開啟資料庫資料夾')
      )
    }
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
      latestWidth: accountSubnavWidth,
      pendingWidth: accountSubnavWidth,
      frameId: null
    }
    document.body.classList.add('is-resizing-account-subnav')
    subnavResizeCleanupRef.current?.()

    const cleanup = (): void => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', finish)
      window.removeEventListener('pointercancel', finish)
      const drag = subnavResizeRef.current
      if (drag?.frameId !== null && drag?.frameId !== undefined) {
        window.cancelAnimationFrame(drag.frameId)
        drag.frameId = null
      }
      subnavResizeRef.current = null
      subnavResizeCleanupRef.current = null
      document.body.classList.remove('is-resizing-account-subnav')
    }
    const finish = (): void => {
      const drag = subnavResizeRef.current
      const moved = subnavResizeMovedRef.current
      if (drag) {
        if (drag.frameId !== null) {
          window.cancelAnimationFrame(drag.frameId)
          drag.frameId = null
        }
        accountLayoutRef.current?.style.setProperty(
          '--account-subnav-width',
          `${drag.latestWidth}px`
        )
      }
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
      drag.pendingWidth = nextWidth
      if (drag.frameId !== null) return
      drag.frameId = window.requestAnimationFrame(() => {
        const activeDrag = subnavResizeRef.current
        if (!activeDrag) return
        activeDrag.frameId = null
        accountLayoutRef.current?.style.setProperty(
          '--account-subnav-width',
          `${activeDrag.pendingWidth}px`
        )
      })
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
        tabId: activeTabId,
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

  function openAccountMenu(
    event: React.MouseEvent<HTMLElement>,
    account: AccountWithSite
  ): void {
    event.preventDefault()
    event.stopPropagation()
    const menuWidth = 196
    const pointer = event.nativeEvent
    const anchorX = pointer.clientX
    const anchorY = pointer.clientY
    setAccountMenu({
      kind: 'account',
      account,
      anchorX,
      anchorY,
      left: Math.max(8, Math.min(anchorX, window.innerWidth - menuWidth - 8)),
      top: Math.max(8, Math.min(anchorY, window.innerHeight - 8))
    })
  }

  function openPageAccountMenu(event: React.MouseEvent<HTMLElement>): void {
    if (view === 'bookmarks') return
    if (event.defaultPrevented) return
    const target = event.target instanceof Element ? event.target : null
    if (
      target?.closest(
        '.account-row, .account-list__header, .account-tabs, .account-subnav-shell, button, input, select, textarea, a, label'
      )
    ) {
      return
    }
    event.preventDefault()
    event.stopPropagation()
    const menuWidth = 190
    const pointer = event.nativeEvent
    const anchorX = pointer.clientX
    const anchorY = pointer.clientY
    setAccountMenu({
      kind: 'page',
      anchorX,
      anchorY,
      left: Math.max(8, Math.min(anchorX, window.innerWidth - menuWidth - 8)),
      top: Math.max(8, Math.min(anchorY, window.innerHeight - 8))
    })
  }

  async function copyAccountUsername(account: AccountWithSite): Promise<void> {
    setAccountMenu(null)
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
    setAccountMenu(null)
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

  async function copyAccountUrl(account: AccountWithSite): Promise<void> {
    setAccountMenu(null)
    try {
      await window.autologin.accounts.copyUrl(account.id)
      notify('success', tr('站点 URL 已复制', 'Site URL copied.', '站點 URL 已複製'))
    } catch (error) {
      notify(
        'error',
        error instanceof Error
          ? error.message
          : tr('复制站点 URL 失败', 'Could not copy site URL.', '複製站點 URL 失敗')
      )
    }
  }

  async function duplicateSingleAccount(account: AccountWithSite): Promise<void> {
    setAccountMenu(null)
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

  async function pasteAccountClipboard(): Promise<void> {
    if (accountClipboardIds.length === 0 || keyboardDuplicateBusy) return
    setKeyboardDuplicateBusy(true)
    try {
      const created = await window.autologin.accounts.duplicate(accountClipboardIds)
      await refreshAll()
      setSelectedIds(new Set(created.map((account) => account.id)))
      notify(
        'success',
        tr(
          `已粘贴 ${created.length} 个账号`,
          `Pasted ${created.length} account${created.length === 1 ? '' : 's'}.`,
          `已貼上 ${created.length} 個帳號`
        )
      )
    } catch (error) {
      notify(
        'error',
        error instanceof Error
          ? error.message
          : tr('粘贴账号失败', 'Could not paste accounts.', '貼上帳號失敗')
      )
    } finally {
      setKeyboardDuplicateBusy(false)
    }
  }

  async function restoreAccount(accountId: string): Promise<void> {
    setRestoringAccountId(accountId)
    try {
      await window.autologin.accounts.restore(accountId)
      await refreshAll()
      notify(
        'success',
        trashSection === 'bookmarks'
          ? tr('书签已恢复', 'Bookmark restored.', '書籤已恢復')
          : tr('账号已恢复', 'Account restored.', '帳號已恢復')
      )
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

  function toggleTrashSelection(accountId: string): void {
    setTrashSelection((current) => {
      const next = new Set(current)
      if (next.has(accountId)) next.delete(accountId)
      else next.add(accountId)
      return next
    })
  }

  function toggleAllTrashSelection(): void {
    if (trashSelection.size === visibleDeletedAccounts.length) {
      setTrashSelection(new Set())
      return
    }
    setTrashSelection(new Set(visibleDeletedAccounts.map((account) => account.id)))
  }

  async function restoreSelectedAccounts(): Promise<void> {
    if (trashSelection.size === 0 || trashActionBusy) return
    setTrashActionBusy(true)
    try {
      const result = await window.autologin.accounts.restoreMany([...trashSelection])
      setTrashSelection(new Set())
      await refreshAll()
      notify(
        'success',
        trashSection === 'bookmarks'
          ? tr(
              `已恢复 ${result.deleted} 个书签`,
              `Restored ${result.deleted} bookmark${result.deleted === 1 ? '' : 's'}.`,
              `已恢復 ${result.deleted} 個書籤`
            )
          : tr(
              `已恢复 ${result.deleted} 个账号`,
              `Restored ${result.deleted} account${result.deleted === 1 ? '' : 's'}.`,
              `已恢復 ${result.deleted} 個帳號`
            )
      )
    } catch (error) {
      notify(
        'error',
        error instanceof Error
          ? error.message
          : tr('批量恢复失败', 'Could not restore accounts.', '批次恢復失敗')
      )
    } finally {
      setTrashActionBusy(false)
    }
  }

  async function purgeSelectedAccounts(): Promise<void> {
    if (!purgeTargets || purgeTargets.length === 0 || trashActionBusy) return
    setTrashActionBusy(true)
    try {
      const result = await window.autologin.accounts.purgeMany(purgeTargets)
      setPurgeTargets(null)
      setTrashSelection(new Set())
      await refreshAll()
      notify(
        'success',
        trashSection === 'bookmarks'
          ? tr(
              `已永久删除 ${result.deleted} 个书签`,
              `Permanently deleted ${result.deleted} bookmark${result.deleted === 1 ? '' : 's'}.`,
              `已永久刪除 ${result.deleted} 個書籤`
            )
          : tr(
              `已永久删除 ${result.deleted} 个账号`,
              `Permanently deleted ${result.deleted} account${result.deleted === 1 ? '' : 's'}.`,
              `已永久刪除 ${result.deleted} 個帳號`
            )
      )
    } catch (error) {
      notify(
        'error',
        error instanceof Error
          ? error.message
          : tr('永久删除失败', 'Could not permanently delete accounts.', '永久刪除失敗')
      )
    } finally {
      setTrashActionBusy(false)
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
      await window.autologin.settings.update({
        groupOrders: {
          ...settings.groupOrders,
          [activeTabId]: groupOrder
        },
        ...(activeTabId === DEFAULT_ACCOUNT_TAB_ID ? { groupOrder } : {})
      })
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
    const dragPath =
      group.actualName ?? (group.key === UNGROUPED_KEY ? UNGROUPED_KEY : null)
    if (!dragPath) return
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('text/plain', dragPath)
    draggedGroupPathRef.current = dragPath
    setDraggedGroupPath(dragPath)
  }

  function resolveGroupDropPosition(
    draggedPath: string,
    target: GroupSummary,
    position: GroupDropPosition
  ): GroupDropPosition | null {
    const targetPath =
      target.actualName ?? (target.key === UNGROUPED_KEY ? UNGROUPED_KEY : null)
    if (!targetPath || targetPath === draggedPath) return null
    const draggedIsUngrouped = draggedPath === UNGROUPED_KEY
    const targetIsUngrouped = targetPath === UNGROUPED_KEY
    if (draggedIsUngrouped || targetIsUngrouped) {
      if (draggedIsUngrouped && target.parentPath !== null) return null
      if (targetIsUngrouped && groupParentPath(draggedPath) !== null) return null
      return position === 'inside' ? 'after' : position
    }
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
    if (draggedAccountIdsRef.current.length > 0) {
      event.preventDefault()
      event.dataTransfer.dropEffect = 'move'
      const path = group.actualName ?? group.key
      setGroupDropTarget((current) =>
        current?.path === path && current.position === 'inside'
          ? current
          : { path, position: 'inside' }
      )
      return
    }
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
    const path = group.actualName ?? group.key
    setGroupDropTarget((current) =>
      current?.path === path && current.position === resolved
        ? current
        : { path, position: resolved }
    )
  }

  async function finishGroupDrop(
    event: React.DragEvent<HTMLDivElement>,
    target: GroupSummary
  ): Promise<void> {
    event.preventDefault()
    const draggedAccounts = draggedAccountIdsRef.current
    if (draggedAccounts.length > 0) {
      draggedAccountIdsRef.current = []
      setDraggedAccountIds([])
      setGroupDropTarget(null)
      await moveDraggedAccountsToGroup(
        draggedAccounts,
        target.actualName ?? undefined,
        target.name
      )
      return
    }
    const draggedPath = draggedGroupPathRef.current ?? draggedGroupPath
    const dropTarget = groupDropTarget
    draggedGroupPathRef.current = null
    setDraggedGroupPath(null)
    setGroupDropTarget(null)
    const targetPath =
      target.actualName ?? (target.key === UNGROUPED_KEY ? UNGROUPED_KEY : null)
    if (!draggedPath || !dropTarget || dropTarget.path !== targetPath) return

    const destinationParent =
      dropTarget.position === 'inside'
        ? target.actualName ?? undefined
        : target.actualName
          ? groupParentPath(target.actualName) ?? undefined
          : undefined
    const currentParent = groupParentPath(draggedPath) ?? undefined

    if (destinationParent === currentParent) {
      const siblings = groups
        .filter((group) => (group.parentPath ?? undefined) === destinationParent)
        .map(
          (group) =>
            group.actualName ??
            (group.key === UNGROUPED_KEY ? UNGROUPED_GROUP_KEY : null)
        )
        .filter((path): path is string => Boolean(path))
      const nextSiblings = siblings.filter((path) => path !== draggedPath)
      const targetIndex = nextSiblings.indexOf(targetPath ?? '')
      if (targetIndex < 0) return
      nextSiblings.splice(
        targetIndex + (dropTarget.position === 'after' ? 1 : 0),
        0,
        draggedPath
      )
      if (nextSiblings.join('\0') === siblings.join('\0')) return
      const nextOrder = groups
        .map(
          (group) =>
            group.actualName ??
            (group.key === UNGROUPED_KEY ? UNGROUPED_GROUP_KEY : null)
        )
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
        tabId: activeTabId,
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

  function beginAccountDrag(
    event: React.DragEvent<HTMLElement>,
    account: AccountWithSite
  ): void {
    const target = event.target instanceof Element ? event.target : null
    if (target?.closest('button, input, label, a')) {
      event.preventDefault()
      return
    }
    const selected = selectedIds.has(account.id)
      ? visibleSelectedIds
      : [account.id]
    const ids = selected.length > 0 ? selected : [account.id]
    draggedAccountIdsRef.current = ids
    setDraggedAccountIds(ids)
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('text/plain', account.id)
  }

  function endAccountDrag(): void {
    draggedAccountIdsRef.current = []
    setDraggedAccountIds([])
    setAccountDropTarget(null)
    setGroupDropTarget(null)
  }

  function hoverAccountDropTarget(
    event: React.DragEvent<HTMLElement>,
    account: AccountWithSite
  ): void {
    if (
      draggedAccountIdsRef.current.length === 0 ||
      draggedAccountIdsRef.current.includes(account.id)
    ) {
      return
    }
    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'
    const rect = event.currentTarget.getBoundingClientRect()
    const position: 'before' | 'after' =
      event.clientY < rect.top + rect.height / 2 ? 'before' : 'after'
    setAccountDropTarget((current) =>
      current?.accountId === account.id && current.position === position
        ? current
        : { accountId: account.id, position }
    )
  }

  async function finishAccountDrop(
    event: React.DragEvent<HTMLElement>,
    targetAccount: AccountWithSite
  ): Promise<void> {
    event.preventDefault()
    event.stopPropagation()
    const dragged = draggedAccountIdsRef.current
    const dropTarget = accountDropTarget
    const targetRect = event.currentTarget.getBoundingClientRect()
    const dropPosition =
      dropTarget?.accountId === targetAccount.id
        ? dropTarget.position
        : event.clientY < targetRect.top + targetRect.height / 2
          ? 'before'
          : 'after'
    endAccountDrag()
    if (
      dragged.length === 0 ||
      dragged.includes(targetAccount.id)
    ) {
      return
    }
    const ordered = [...accounts]
      .sort(compareAccounts)
      .map((account) => account.id)
    const moving = ordered.filter((id) => dragged.includes(id))
    const remaining = ordered.filter((id) => !dragged.includes(id))
    const targetIndex = remaining.indexOf(targetAccount.id)
    if (targetIndex < 0) return
    remaining.splice(
      targetIndex + (dropPosition === 'after' ? 1 : 0),
      0,
      ...moving
    )
    try {
      await window.autologin.accounts.reorder({
        tabId: activeTabId,
        accountIds: remaining
      })
      await refreshAll()
    } catch (error) {
      notify(
        'error',
        error instanceof Error
          ? error.message
          : tr('账号排序失败', 'Could not reorder accounts.', '帳號排序失敗')
      )
    }
  }

  async function moveDraggedAccountsToGroup(
    accountIds: string[],
    groupPath: string | undefined,
    groupName: string
  ): Promise<void> {
    try {
      await window.autologin.accounts.moveToGroup({
        tabId: activeTabId,
        accountIds,
        ...(groupPath ? { groupPath } : {})
      })
      await refreshAll()
      notify(
        'success',
        tr(
          `已将 ${accountIds.length} 个账号移动到“${groupName}”`,
          `Moved ${accountIds.length} account${accountIds.length === 1 ? '' : 's'} to “${groupName}”.`,
          `已將 ${accountIds.length} 個帳號移動到「${groupName}」`
        )
      )
    } catch (error) {
      notify(
        'error',
        error instanceof Error
          ? error.message
          : tr('移动账号失败', 'Could not move accounts.', '移動帳號失敗')
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
      await window.autologin.groups.rename(
        renameGroupTarget.actualName,
        nextName,
        activeTabId
      )
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
      const count = await window.autologin.groups.delete(
        deleteGroupTarget.actualName,
        activeTabId
      )
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
    setBatchIcon(null)
    setBatchStrategyError('')
    setBatchStrategyOpen(true)
  }

  function closeBatchStrategy(): void {
    if (batchStrategyBusy || batchIconBusy || batchIconFetchBusy) return
    setBatchStrategyOpen(false)
    setBatchIcon(null)
  }

  async function applyBatchStrategy(): Promise<void> {
    if (batchIconFetchBusy) return
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

  async function selectBatchIcon(
    event: React.ChangeEvent<HTMLInputElement>
  ): Promise<void> {
    if (batchIconFetchBusy) return
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    if (!file.type.startsWith('image/')) {
      notify('error', tr('请选择图片文件', 'Choose an image file.', '請選擇圖片檔案'))
      return
    }
    if (file.size > 512 * 1024) {
      notify(
        'error',
        tr(
          'Logo 文件不能超过 512 KB',
          'The logo must be 512 KB or smaller.',
          'Logo 檔案不能超過 512 KB'
        )
      )
      return
    }
    try {
      setBatchIcon(await readFileAsDataUrl(file))
    } catch {
      notify('error', tr('读取 Logo 失败', 'Could not read the logo.', '讀取 Logo 失敗'))
    }
  }

  async function applyBatchIcon(): Promise<void> {
    if (
      !batchIcon ||
      selectedIds.size === 0 ||
      batchIconBusy ||
      batchIconFetchBusy
    ) {
      return
    }
    const count = selectedIds.size
    setBatchIconBusy(true)
    try {
      await window.autologin.accounts.setIconBatch({
        accountIds: [...selectedIds],
        icon: batchIcon
      })
      await onRefresh()
      setBatchStrategyOpen(false)
      setBatchIcon(null)
      setSelectedIds(new Set())
      notify(
        'success',
        tr(
          `已更新 ${count} 个账号的 Logo`,
          `Updated the logo for ${count} accounts.`,
          `已更新 ${count} 個帳號的 Logo`
        )
      )
    } catch (error) {
      notify(
        'error',
        error instanceof Error
          ? error.message
          : tr('批量更新 Logo 失败', 'Could not update logos.', '批次更新 Logo 失敗')
      )
    } finally {
      setBatchIconBusy(false)
    }
  }

  async function fetchBatchSiteIcons(): Promise<void> {
    if (
      selectedIds.size === 0 ||
      batchIconBusy ||
      batchIconFetchBusy
    ) {
      return
    }
    setBatchIconFetchBusy(true)
    setBatchStrategyError('')
    try {
      const result = await window.autologin.accounts.fetchIconsBatch([
        ...selectedIds
      ])
      if (result.updatedAccounts > 0) await onRefresh()
      if (result.failedSites.length === 0) {
        setBatchStrategyOpen(false)
        setBatchIcon(null)
        setSelectedIds(new Set())
        notify(
          'success',
          tr(
            `已获取并更新 ${result.updatedAccounts} 个账号的网站图标`,
            `Downloaded and updated site icons for ${result.updatedAccounts} accounts.`,
            `已取得並更新 ${result.updatedAccounts} 個帳號的網站圖示`
          )
        )
        return
      }
      const failed = result.failedSites.slice(0, 3).join('、')
      const remaining = Math.max(0, result.failedSites.length - 3)
      const details = remaining > 0 ? `${failed} 等 ${result.failedSites.length} 个站点` : failed
      setBatchStrategyError(
        tr(
          `已更新 ${result.updatedAccounts} 个账号；${details}未获取到图标。`,
          `Updated ${result.updatedAccounts} accounts; icons were unavailable for ${details}.`,
          `已更新 ${result.updatedAccounts} 個帳號；${details}未取得圖示。`
        )
      )
      notify(
        'info',
        tr(
          '部分站点图标未获取成功',
          'Some site icons could not be downloaded.',
          '部分站點圖示未取得成功'
        )
      )
    } catch (error) {
      setBatchStrategyError(
        error instanceof Error
          ? error.message
          : tr(
              '批量获取网站图标失败',
              'Could not download site icons.',
              '批次取得網站圖示失敗'
            )
      )
    } finally {
      setBatchIconFetchBusy(false)
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
    if (manualRefreshing) return
    const startedAt = Date.now()
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
      const remaining = 500 - (Date.now() - startedAt)
      if (remaining > 0) {
        await new Promise((resolve) => window.setTimeout(resolve, remaining))
      }
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
      selectionAnchorRef.current = null
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

  function toggleAccountSelection(accountId: string, shiftKey = false): void {
    if (shiftKey && selectionAnchorRef.current) {
      const anchorIndex = pagedAccounts.findIndex(
        (account) => account.id === selectionAnchorRef.current
      )
      const targetIndex = pagedAccounts.findIndex((account) => account.id === accountId)
      if (anchorIndex >= 0 && targetIndex >= 0) {
        const start = Math.min(anchorIndex, targetIndex)
        const end = Math.max(anchorIndex, targetIndex)
        const rangeIds = pagedAccounts
          .slice(start, end + 1)
          .map((account) => account.id)
        setSelectedIds((current) => new Set([...current, ...rangeIds]))
        return
      }
    }
    setSelectedIds((current) => {
      const next = new Set(current)
      if (next.has(accountId)) next.delete(accountId)
      else next.add(accountId)
      return next
    })
    selectionAnchorRef.current = accountId
  }

  function toggleSelectAll(): void {
    setSelectedIds((current) => {
      const next = new Set(current)
      if (allPageSelected) {
        for (const account of pagedAccounts) next.delete(account.id)
        selectionAnchorRef.current = null
      } else {
        for (const account of pagedAccounts) next.add(account.id)
        selectionAnchorRef.current = pagedAccounts[0]?.id ?? null
      }
      return next
    })
  }

  async function openSelected(): Promise<void> {
    if (selectedIds.size === 0) return
    const opened = await onStartBatch([...selectedIds])
    if (opened) {
      setSelectedIds(new Set())
      selectionAnchorRef.current = null
    }
  }

  async function cancelActiveBatch(): Promise<void> {
    if (!batchState?.active || batchCancelBusy) return
    setBatchCancelBusy(true)
    try {
      await onCancelBatch()
    } finally {
      setBatchCancelBusy(false)
    }
  }

  async function openAccount(account: AccountWithSite): Promise<void> {
    if (view === 'bookmarks') {
      setDrawer(null)
      try {
        const entry = await window.autologin.bookmarks.visit(account.id)
        if (entry.status === 'success') {
          notify(
            'success',
            tr(
              `已在默认浏览器中访问“${account.site.name}”`,
              `Opened “${account.site.name}” in your default browser.`,
              `已在預設瀏覽器中造訪「${account.site.name}」`
            )
          )
        } else {
          notify(
            'error',
            entry.reason ||
              tr('无法打开书签', 'Could not open the bookmark.', '無法開啟書籤')
          )
        }
      } catch (error) {
        notify(
          'error',
          error instanceof Error
            ? error.message
            : tr('访问书签失败', 'Could not visit the bookmark.', '造訪書籤失敗')
        )
      }
      return
    }
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
    <div
      className={`app-shell${sidebarCollapsed ? ' is-sidebar-collapsed' : ''}${
        accountEditorOpen ? ' is-account-editor' : ''
      }`}
    >
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
            </button>
            <button
              className={`sidebar-nav__item${view === 'bookmarks' ? ' is-active' : ''}`}
              onClick={chooseBookmarks}
              aria-label={tr('书签', 'Bookmarks', '書籤')}
              title={tr('书签', 'Bookmarks', '書籤')}
            >
              <Bookmark size={17} />
              <span>{tr('书签', 'Bookmarks', '書籤')}</span>
            </button>
            <button
              className={`sidebar-nav__item${
                view === 'passwordGenerator' ? ' is-active' : ''
              }`}
              onClick={() => switchView('passwordGenerator')}
              aria-label={tr('密码生成器', 'Password generator', '密碼產生器')}
              title={tr('密码生成器', 'Password generator', '密碼產生器')}
            >
              <Sparkles size={17} />
              <span>{tr('密码生成器', 'Password generator', '密碼產生器')}</span>
            </button>
            <button
              className={`sidebar-nav__item${
                view === 'loginLogs' || view === 'appLogs'
                  ? ' is-active'
                  : ''
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
            </button>
          </section>
        </nav>

        <div className="sidebar-bottom">
          {updateState &&
            (updateState.phase === 'downloading' || updateState.phase === 'downloaded') && (
              <button
                type="button"
                className={`sidebar-update-progress is-${updateState.phase}`}
                onClick={() => chooseSettingsModule('about')}
                aria-label={
                  updateState.phase === 'downloaded'
                    ? tr(
                        '更新已下载，打开关于与更新',
                        'Update downloaded. Open About & updates.',
                        '更新已下載，開啟關於與更新'
                      )
                    : tr(
                        `更新下载进度 ${Math.round(updateState.percent ?? 0)}%，打开关于与更新`,
                        `Update download ${Math.round(updateState.percent ?? 0)}%. Open About & updates.`,
                        `更新下載進度 ${Math.round(updateState.percent ?? 0)}%，開啟關於與更新`
                      )
                }
              >
                <span className="sidebar-update-progress__label">
                  {updateState.phase === 'downloaded' ? (
                    <Check size={14} aria-hidden="true" />
                  ) : (
                    <LoaderCircle size={14} className="spin" aria-hidden="true" />
                  )}
                  <span>
                    {updateState.phase === 'downloaded'
                      ? tr('更新已就绪', 'Update ready', '更新已就緒')
                      : updateState.downloadMode === 'full'
                        ? tr(
                            '正在下载完整安装包',
                            'Downloading full installer',
                            '正在下載完整安裝包'
                          )
                        : tr('正在下载更新', 'Downloading update', '正在下載更新')}
                  </span>
                  <strong>
                    {Math.round(
                      updateState.phase === 'downloaded' ? 100 : updateState.percent ?? 0
                    )}
                    %
                  </strong>
                </span>
                <span
                  className="sidebar-update-progress__track"
                  role="progressbar"
                  aria-label={tr('更新下载进度', 'Update download progress', '更新下載進度')}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={Math.round(
                    updateState.phase === 'downloaded' ? 100 : updateState.percent ?? 0
                  )}
                >
                  <span
                    style={{
                      width: `${Math.max(
                        0,
                        Math.min(
                          100,
                          updateState.phase === 'downloaded'
                            ? 100
                            : updateState.percent ?? 0
                        )
                      )}%`
                    }}
                  />
                </span>
              </button>
            )}
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

      {tabMenu && (
        <div
          className="account-tab-menu"
          role="menu"
          aria-label={tr('标签页操作', 'Tab actions', '標籤頁操作')}
          style={{ left: tabMenu.left, top: tabMenu.top }}
        >
          <button
            type="button"
            role="menuitem"
            onClick={() => beginRenameTab(tabMenu.tab)}
          >
            <Pencil size={14} />
            {tabMenu.tab.source === 'bookmarks'
              ? tr('重命名标签页', 'Rename tab', '重新命名標籤頁')
              : tr('重命名数据库', 'Rename database', '重新命名資料庫')}
          </button>
          <div className="account-tab-menu__colors">
            <span>{tr('标签颜色', 'Tab color', '標籤顏色')}</span>
            <div>
              {ACCOUNT_TAB_COLORS.map((color) => (
                <button
                  type="button"
                  className={`account-tab-color${
                    tabMenu.tab.color.toLocaleLowerCase() === color.toLocaleLowerCase()
                      ? ' is-active'
                      : ''
                  }`}
                  key={color}
                  style={{ '--tab-color': color } as React.CSSProperties}
                  onClick={() => void setTabColor(tabMenu.tab, color)}
                  aria-label={tr(`选择颜色 ${color}`, `Choose color ${color}`, `選擇顏色 ${color}`)}
                  title={color}
                >
                  {tabMenu.tab.color.toLocaleLowerCase() === color.toLocaleLowerCase() && (
                    <Check size={11} />
                  )}
                </button>
              ))}
            </div>
          </div>
          <div className="account-context-menu__divider" aria-hidden="true" />
          <button
            type="button"
            role="menuitem"
            onClick={() => void revealTabDatabase(tabMenu.tab)}
          >
            <FolderOpen size={14} />
            {tabMenu.tab.source === 'bookmarks'
              ? tr('打开标签页所在文件夹', 'Open tab folder', '開啟標籤頁資料夾')
              : tr('打开数据库所在文件夹', 'Open database folder', '開啟資料庫資料夾')}
          </button>
          <div className="account-context-menu__divider" aria-hidden="true" />
          <button
            type="button"
            role="menuitem"
            className="is-danger"
            onClick={() => void closeTab(tabMenu.tab)}
          >
            <X size={14} />
            {tabMenu.tab.source === 'bookmarks'
              ? tr('关闭标签页', 'Close tab', '關閉標籤頁')
              : tr('关闭数据库', 'Close database', '關閉資料庫')}
          </button>
        </div>
      )}

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

      {accountMenu?.kind === 'account' &&
        createPortal(
        <div
          ref={accountMenuRef}
          className="account-context-menu"
          role="menu"
          aria-label={
            view === 'bookmarks'
              ? tr('书签操作', 'Bookmark actions', '書籤操作')
              : tr('账号操作', 'Account actions', '帳號操作')
          }
          style={{ left: accountMenu.left, top: accountMenu.top }}
        >
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              const accountId = accountMenu.account.id
              setAccountMenu(null)
              setDrawer({ mode: 'edit', accountId })
            }}
          >
            <Pencil size={14} />
            {view === 'bookmarks'
              ? tr('编辑书签', 'Edit bookmark', '編輯書籤')
              : tr('编辑账号', 'Edit account', '編輯帳號')}
          </button>
          <div className="account-context-menu__divider" aria-hidden="true" />
          {view !== 'bookmarks' && (
            <>
              <button
                type="button"
                role="menuitem"
                onClick={() => void copyAccountUsername(accountMenu.account)}
              >
                <UserRound size={14} />
                {tr('复制用户名', 'Copy username', '複製使用者名稱')}
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => void copyAccountPassword(accountMenu.account)}
              >
                <KeyRound size={14} />
                {tr('复制密码', 'Copy password', '複製密碼')}
              </button>
            </>
          )}
          <button
            type="button"
            role="menuitem"
            onClick={() => void copyAccountUrl(accountMenu.account)}
          >
            <Globe2 size={14} />
            {tr('复制 URL', 'Copy URL', '複製 URL')}
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => void duplicateSingleAccount(accountMenu.account)}
          >
            <Copy size={14} />
            {view === 'bookmarks'
              ? tr('复制书签', 'Duplicate bookmark', '複製書籤')
              : tr('复制账号', 'Duplicate account', '複製帳號')}
          </button>
          <div className="account-context-menu__divider" aria-hidden="true" />
          <button
            type="button"
            role="menuitem"
            className="is-danger"
            onClick={() => {
              const account = accountMenu.account
              setAccountMenu(null)
              setSelectedIds(new Set([account.id]))
              setDeleteSelectedOpen(true)
            }}
          >
            <Trash2 size={14} />
            {view === 'bookmarks'
              ? tr('删除书签', 'Delete bookmark', '刪除書籤')
              : tr('删除账号', 'Delete account', '刪除帳號')}
          </button>
        </div>,
        document.body
      )}

      {accountMenu?.kind === 'page' &&
        createPortal(
        <div
          ref={accountMenuRef}
          className="account-context-menu"
          role="menu"
          aria-label={tr('账号页面操作', 'Account page actions', '帳號頁面操作')}
          style={{ left: accountMenu.left, top: accountMenu.top }}
        >
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setAccountMenu(null)
              setDrawer({ mode: 'create' })
            }}
          >
            <Plus size={14} />
            {view === 'bookmarks'
              ? tr('新增书签', 'Add bookmark', '新增書籤')
              : tr('新增账号', 'Add account', '新增帳號')}
          </button>
        </div>,
        document.body
      )}

      {batchStrategyOpen && (
        <Modal
          title={tr('批量操作', 'Batch actions', '批次操作')}
          eyebrow="BATCH ACTIONS"
          onClose={closeBatchStrategy}
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
                `可统一更新所选 ${selectedAccountCount} 个账号的登录方式或账号 Logo。`,
                `Update the login method or logo for ${selectedAccountCount} selected accounts.`,
                `可統一更新所選 ${selectedAccountCount} 個帳號的登入方式或帳號 Logo。`
              )}
            </p>
            <section className="batch-icon-editor">
              <div className="batch-icon-editor__copy">
                <span className="field__label">
                  {tr('账号 Logo', 'Account logo', '帳號 Logo')}
                </span>
                <strong>{tr('批量更新账号 Logo', 'Update account logos', '批次更新帳號 Logo')}</strong>
                <small>
                  {tr(
                    '选择一张本地图片统一应用，或按每个账号的站点地址获取网站图标。',
                    'Choose one local image for all accounts, or download each site icon from its sign-in URL.',
                    '選擇一張本機圖片統一套用，或按每個帳號的站點網址取得網站圖示。'
                  )}
                </small>
                <div className="batch-icon-editor__actions">
                  <input
                    ref={batchIconInputRef}
                    type="file"
                    accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml,image/x-icon,.ico"
                    className="batch-icon-editor__file-input"
                    aria-label={tr('选择批量 Logo 文件', 'Choose batch logo file', '選擇批次 Logo 檔案')}
                    onChange={(event) => void selectBatchIcon(event)}
                  />
                  <button
                    type="button"
                    className="button button--ghost button--small"
                    onClick={() => batchIconInputRef.current?.click()}
                    disabled={batchIconBusy || batchIconFetchBusy}
                  >
                    <ImagePlus size={14} />
                    {tr('选择图片', 'Choose image', '選擇圖片')}
                  </button>
                  <button
                    type="button"
                    className="button button--ghost button--small"
                    onClick={() => void fetchBatchSiteIcons()}
                    disabled={batchIconBusy || batchIconFetchBusy}
                    aria-busy={batchIconFetchBusy}
                  >
                    {batchIconFetchBusy ? (
                      <LoaderCircle size={14} className="spin" />
                    ) : (
                      <Globe2 size={14} />
                    )}
                    {batchIconFetchBusy
                      ? tr('正在获取…', 'Downloading…', '正在取得…')
                      : tr('获取网站图标', 'Get site icons', '取得網站圖示')}
                  </button>
                  <button
                    type="button"
                    className="button button--primary button--small"
                    onClick={() => void applyBatchIcon()}
                    disabled={!batchIcon || batchIconBusy || batchIconFetchBusy}
                  >
                    {batchIconBusy ? (
                      <LoaderCircle size={14} className="spin" />
                    ) : (
                      <Check size={14} />
                    )}
                    {batchIconBusy
                      ? tr('正在更新…', 'Updating…', '正在更新…')
                      : tr('应用 Logo', 'Apply logo', '套用 Logo')}
                  </button>
                </div>
              </div>
              <div className={`batch-icon-editor__preview${batchIcon ? ' has-image' : ''}`}>
                {batchIcon ? (
                  <img src={batchIcon} alt="" />
                ) : (
                  <ImagePlus size={22} aria-hidden="true" />
                )}
              </div>
            </section>
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
                disabled={
                  duplicateBusy ||
                  batchStrategyBusy ||
                  batchIconBusy ||
                  batchIconFetchBusy
                }
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
                onClick={closeBatchStrategy}
                disabled={batchStrategyBusy || batchIconBusy || batchIconFetchBusy}
              >
                {tr('取消', 'Cancel', '取消')}
              </button>
              <button
                type="submit"
                className="button button--primary"
                disabled={batchStrategyBusy || batchIconBusy || batchIconFetchBusy}
              >
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

      {renameTabTarget && (
        <Modal
          title={
            renameTabTarget.source === 'bookmarks'
              ? tr('重命名标签页', 'Rename tab', '重新命名標籤頁')
              : tr('重命名数据库', 'Rename database', '重新命名資料庫')
          }
          eyebrow={renameTabTarget.source === 'bookmarks' ? 'BOOKMARK TAB' : 'DATABASE'}
          onClose={() => {
            if (!tabBusy) setRenameTabTarget(null)
          }}
          width="440px"
        >
          <form className="group-rename-form" onSubmit={(event) => void saveTabName(event)}>
            <label className="field">
              <span className="field__label">
                {renameTabTarget.source === 'bookmarks'
                  ? tr('标签页名称', 'Tab name', '標籤頁名稱')
                  : tr('数据库名称', 'Database name', '資料庫名稱')}
              </span>
              <span className="input-shell">
                <Layers3 size={16} />
                <input
                  data-autofocus
                  value={renameTabValue}
                  onChange={(event) => setRenameTabValue(event.target.value)}
                  maxLength={40}
                />
              </span>
            </label>
            <div className="modal-actions">
              <button
                type="button"
                className="button button--ghost"
                onClick={() => setRenameTabTarget(null)}
                disabled={tabBusy}
              >
                {tr('取消', 'Cancel', '取消')}
              </button>
              <button
                type="submit"
                className="button button--primary"
                disabled={tabBusy || !renameTabValue.trim()}
              >
                {tabBusy ? <LoaderCircle size={15} className="spin" /> : <Check size={15} />}
                {tabBusy
                  ? tr('正在保存…', 'Saving…', '正在儲存…')
                  : tr('保存名称', 'Save name', '儲存名稱')}
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

      {purgeTargets && (
        <ConfirmDialog
          title={tr('永久删除所选账号？', 'Permanently delete selected accounts?', '永久刪除所選帳號？')}
          description={tr(
            `将永久删除 ${purgeTargets.length} 个账号及其站点配置，无法再恢复。登录记录和软件日志不会被删除。`,
            `${purgeTargets.length} account${purgeTargets.length === 1 ? '' : 's'} and site configurations will be permanently deleted and cannot be restored. Login history and app logs are kept.`,
            `將永久刪除 ${purgeTargets.length} 個帳號及其站點設定，無法再恢復。登入記錄和軟體日誌不會被刪除。`
          )}
          confirmLabel={tr('永久删除', 'Delete permanently', '永久刪除')}
          danger
          busy={trashActionBusy}
          onConfirm={() => void purgeSelectedAccounts()}
          onClose={() => setPurgeTargets(null)}
        />
      )}

      <main
        className={`library-main${accountEditorOpen ? ' is-account-editor' : ''}`}
      >
        {accountEditorOpen && drawer ? (
          <AccountDrawer
            tabId={activeTabId}
            mode={drawer.mode}
            bookmarkMode={view === 'bookmarks'}
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
        ) : (
        <div
          className={`library-content-scroll${
            isAccountCollectionView ? ' library-content-scroll--accounts' : ''
          }${isLogView ? ' library-content-scroll--logs' : ''}${
            view === 'settings' ? ' library-content-scroll--settings' : ''
          }`}
          onContextMenu={
            isAccountCollectionView && !showDatabaseEmptyState
              ? openPageAccountMenu
              : undefined
          }
        >
          {isAccountCollectionView && (
            <>
            <AccountTabs
              tabs={visibleTabs}
              activeTabId={activeTabId}
              bookmarkMode={view === 'bookmarks'}
              busy={tabBusy}
              accountCounts={tabAccountCounts}
              onSelect={(tab) => {
                if (view === 'bookmarks') {
                  setBookmarkTabId(tab.id)
                } else {
                  setAccountTabId(tab.id)
                }
              }}
              onOpenMenu={openTabMenu}
              onClose={(tab) => void closeTab(tab)}
              controls={
                showDatabaseEmptyState ? null : (
                  <>
                    {view === 'accounts' && (
                      <AccountTransferControls
                        tabId={activeTabId}
                        onCreateTab={() => createTab('local')}
                        onImported={(result) =>
                          void handleDataImported(result.tabId)
                        }
                        notify={notify}
                      />
                    )}
                    {view === 'bookmarks' && (
                      <>
                        <button
                          type="button"
                          className="account-tabs__add"
                          onClick={() => void createTab('bookmarks')}
                          disabled={tabBusy}
                          aria-label={tr(
                            '新增书签标签页',
                            'Add bookmark tab',
                            '新增書籤標籤頁'
                          )}
                          title={tr(
                            '新增书签标签页',
                            'Add bookmark tab',
                            '新增書籤標籤頁'
                          )}
                        >
                          <DatabaseCreateIcon busy={tabBusy} />
                        </button>
                        <BookmarkImportButton
                          onImported={(result) =>
                            void handleDataImported(result.tabId)
                          }
                          notify={notify}
                        />
                        <BookmarkExportButton
                          tabId={activeTabId}
                          notify={notify}
                        />
                      </>
                    )}
                  </>
                )
              }
            />
            {showDatabaseEmptyState ? (
              <DatabaseWorkspaceEmptyState
                bookmarkMode={view === 'bookmarks'}
                creating={tabBusy}
                onCreate={() =>
                  createTab(view === 'bookmarks' ? 'bookmarks' : 'local')
                }
                onImported={(tabId) => void handleDataImported(tabId)}
                notify={notify}
              />
            ) : (
            <div
              ref={accountLayoutRef}
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
                  <div className="account-subnav__header" aria-hidden="true" />
                  <div className="account-subnav__all-row">
                    <button
                      type="button"
                      className={`account-subnav__item account-subnav__all-button${
                        groupFilter === null ? ' is-active' : ''
                      }`}
                      onClick={chooseAllAccountsFromTree}
                      aria-expanded={accountGroupTreeExpanded}
                      title={
                        view === 'bookmarks'
                          ? tr('全部书签', 'All bookmarks', '全部書籤')
                          : tr('全部账号', 'All accounts', '全部帳號')
                      }
                    >
                      <KeyRound size={15} />
                      <span>
                        {view === 'bookmarks'
                          ? tr('全部书签', 'All bookmarks', '全部書籤')
                          : tr('全部账号', 'All accounts', '全部帳號')}
                      </span>
                      {accounts.length > 0 && <small>{accounts.length}</small>}
                      <span className="account-subnav__tree-chevron" aria-hidden="true">
                        {accountGroupTreeExpanded ? (
                          <ChevronDown size={14} />
                        ) : (
                          <ChevronRight size={14} />
                        )}
                      </span>
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
                  <div
                    className={`account-subnav__groups-accordion${
                      accountGroupTreeExpanded ? ' is-expanded' : ''
                    }`}
                    aria-hidden={!accountGroupTreeExpanded}
                  >
                    <div className="account-subnav__groups-inner">
                      <section className="account-subnav__groups">
                        <div className="account-subnav__group-list">
                      {visibleTreeGroups.map((group) => {
                        if (!group.actualName) {
                          return (
                            <div
                              className={`account-subnav__group-row account-subnav__group-row--ungrouped${
                                groupDropTarget?.path === group.key
                                  ? ` is-drop-${groupDropTarget.position}`
                                  : ''
                              }${draggedGroupPath === group.key ? ' is-dragging' : ''}`}
                              key={group.key}
                              data-group-path={group.key}
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
                              <button
                                type="button"
                                className={`account-subnav__item account-subnav__item--group${
                                  groupFilter === UNGROUPED_KEY ? ' is-active' : ''
                                }`}
                                onClick={() => chooseGroup(group)}
                                aria-label={tr(
                                  '未分组，无子分组',
                                  'Ungrouped, no subgroups',
                                  '未分組，無子分組'
                                )}
                                title={group.name}
                              >
                                <Globe2 size={15} />
                                <span>{group.name}</span>
                                {group.count > 0 && <small>{group.count}</small>}
                                <span className="account-subnav__tree-spacer" aria-hidden="true" />
                              </button>
                            </div>
                          )
                        }
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
                              <button
                                type="button"
                                className={`account-subnav__item account-subnav__item--group${
                                  groupFilter === group.key ? ' is-active' : ''
                                }`}
                                onClick={() => chooseGroupFromTree(group, hasChildren)}
                                onContextMenu={(event) => openGroupMenu(event, group)}
                                onKeyDown={(event) => openGroupMenuFromKeyboard(event, group)}
                                aria-haspopup="menu"
                                aria-expanded={hasChildren ? !isCollapsed : undefined}
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
                                    : tr(
                                        `${group.name}，无子分组`,
                                        `${group.name}, no subgroups`,
                                        `${group.name}，無子分組`
                                      )
                                }
                                title={group.actualName ?? group.name}
                              >
                                <Layers3 size={15} />
                                <span>{group.name}</span>
                                {group.count > 0 && <small>{group.count}</small>}
                                {hasChildren ? (
                                  <span
                                    className="account-subnav__tree-chevron"
                                    aria-hidden="true"
                                  >
                                    {isCollapsed ? (
                                      <ChevronRight size={14} />
                                    ) : (
                                      <ChevronDown size={14} />
                                    )}
                                  </span>
                                ) : (
                                  <span
                                    className="account-subnav__tree-spacer"
                                    aria-hidden="true"
                                  />
                                )}
                              </button>
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
                        </div>
                      </section>
                    </div>
                  </div>
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
                <div className="library-header__leading">
                  <button
                    type="button"
                    className={`account-subnav-collapse-toggle${
                      accountSubnavHidden ? ' is-collapsed' : ''
                    }`}
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
                      <PanelLeftOpen size={15} />
                    ) : (
                      <PanelLeftClose size={15} />
                    )}
                  </button>
                  <nav
                    className="page-breadcrumb"
                    aria-label={tr('面包屑', 'Breadcrumb', '麵包屑')}
                  >
                    <span>
                      {view === 'bookmarks'
                        ? tr('书签', 'Bookmarks', '書籤')
                        : tr('账号', 'Accounts', '帳號')}
                    </span>
                    {currentBreadcrumb.map((crumb, index) => {
                      const isLast = index === currentBreadcrumb.length - 1
                      return (
                        <span
                          className="page-breadcrumb__segment"
                          key={crumb.path ?? 'all'}
                        >
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
                </div>
                <div className="library-header__actions">
                  {view === 'accounts' && batchState && batchState.total > 0 && (
                    <button
                      type="button"
                      className={`batch-status${batchState.active ? ' is-active' : ''}${
                        batchState.failed > 0 || batchState.canceled > 0 ? ' has-failures' : ''
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
                        {batchState.canceled > 0
                          ? ` · ${tr('已中断', 'Canceled', '已中斷')} ${batchState.canceled}`
                          : ''}
                      </span>
                    </button>
                  )}
                  {view === 'accounts' && batchState?.active && (
                    <button
                      type="button"
                      className="batch-cancel"
                      onClick={() => void cancelActiveBatch()}
                      disabled={batchCancelBusy}
                      aria-label={tr('中断批量登录', 'Cancel batch sign-in', '中斷批次登入')}
                      title={tr('中断批量登录', 'Cancel batch sign-in', '中斷批次登入')}
                    >
                      {batchCancelBusy ? (
                        <LoaderCircle size={13} className="spin" />
                      ) : (
                        <Square size={11} fill="currentColor" />
                      )}
                    </button>
                  )}
                </div>
              </header>

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
                      view === 'bookmarks'
                        ? '搜索书签、用户名或分组'
                        : '搜索站点、账号、用户名或分组',
                      view === 'bookmarks'
                        ? 'Search bookmarks, usernames or groups'
                        : 'Search sites, accounts, usernames or groups',
                      view === 'bookmarks'
                        ? '搜尋書籤、使用者名稱或分組'
                        : '搜尋站點、帳號、使用者名稱或分組'
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
                  {isAccountCollectionView && (
                  <div className="library-toolbar__actions">
                    <button
                      type="button"
                      className="account-add-button button button--primary button--small button--icon-only"
                      onClick={() => setDrawer({ mode: 'create' })}
                      aria-label={
                        view === 'bookmarks'
                          ? tr('添加书签', 'Add bookmark', '新增書籤')
                          : tr('添加账号', 'Add account', '新增帳號')
                      }
                      title={
                        view === 'bookmarks'
                          ? tr('添加书签', 'Add bookmark', '新增書籤')
                          : tr('添加账号', 'Add account', '新增帳號')
                      }
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
                      aria-busy={manualRefreshing}
                    >
                      {manualRefreshing ? <LoadingSpinner size={14} /> : <RefreshCw size={14} />}
                    </button>
                    {view === 'accounts' && (
                      <>
                        <button
                          type="button"
                          className="button button--ghost button--small button--icon-only"
                          onClick={openBatchStrategy}
                          disabled={
                            selectedAccountCount === 0 || Boolean(batchState?.active)
                          }
                          aria-label={tr('批量操作', 'Batch actions', '批次操作')}
                          title={tr('批量操作', 'Batch actions', '批次操作')}
                        >
                          <SlidersHorizontal size={14} />
                        </button>
                        <button
                          type="button"
                          className="button button--ghost button--small button--icon-only"
                          onClick={() => void openSelected()}
                          disabled={
                            selectedAccountCount === 0 || Boolean(batchState?.active)
                          }
                          aria-label={tr('批量登录', 'Batch sign in', '批次登入')}
                          title={tr('批量登录', 'Batch sign in', '批次登入')}
                        >
                          <Layers3 size={14} />
                        </button>
                      </>
                    )}
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

              <div
                ref={accountTableScrollRef}
                className={`account-table-scroll${
                  accountColumnSizing === 'content' ? ' is-fit-content' : ''
                }`}
              >
              <section
                ref={accountListRef}
                className={`account-list${
                  accountColumnSizing === 'content' ? ' is-fit-content' : ''
                }`}
                aria-live="polite"
                style={accountGridStyle}
              >
                  <div
                    className="account-list__header accounts-table__header"
                    onContextMenu={openColumnMenu}
                  >
                    <SelectionCheckbox
                      ref={selectAllRef}
                      checked={allPageSelected}
                      label={tr(
                        '选择当前页全部账号',
                        'Select all accounts on this page',
                        '選擇目前頁全部帳號'
                      )}
                      onChange={toggleSelectAll}
                      disabled={pagedAccounts.length === 0}
                    />
                    <span
                      className="account-col--site"
                      data-column-key="site"
                      style={{ order: accountColumnOrderStyle(accountColumnOrder, 'site') }}
                    >
                      {tr('站点', 'Site', '站點')}
                      {accountColumnResizer('site', tr('站点', 'site', '站點'))}
                    </span>
                    <span
                      className={`account-col--username${
                        effectiveVisibleAccountColumns.has('username')
                          ? ''
                          : ' is-column-hidden'
                      }`}
                      data-column-key="username"
                      style={{
                        order: accountColumnOrderStyle(accountColumnOrder, 'username')
                      }}
                    >
                      {tr('用户名', 'Username', '使用者名稱')}
                      {accountColumnResizer('username', tr('用户名', 'username', '使用者名稱'))}
                    </span>
                    <span
                      className={`account-col--group${
                        effectiveVisibleAccountColumns.has('group') ? '' : ' is-column-hidden'
                      }`}
                      data-column-key="group"
                      style={{
                        order: accountColumnOrderStyle(accountColumnOrder, 'group')
                      }}
                    >
                      {tr('分组', 'Group', '分組')}
                      {accountColumnResizer('group', tr('分组', 'group', '分組'))}
                    </span>
                    <span
                      className={`account-col--updated${
                        effectiveVisibleAccountColumns.has('updated')
                          ? ''
                          : ' is-column-hidden'
                      }`}
                      data-column-key="updated"
                      style={{
                        order: accountColumnOrderStyle(accountColumnOrder, 'updated')
                      }}
                    >
                      {tr('最后更新', 'Last updated', '最後更新')}
                      {accountColumnResizer('updated', tr('最后更新', 'updated', '最後更新'))}
                    </span>
                    {view !== 'bookmarks' && (
                      <span
                        className={`account-col--status${
                          effectiveVisibleAccountColumns.has('status')
                            ? ''
                            : ' is-column-hidden'
                        }`}
                        data-column-key="status"
                        style={{
                          order: accountColumnOrderStyle(accountColumnOrder, 'status')
                        }}
                      >
                        {tr('状态', 'Status', '狀態')}
                        {accountColumnResizer('status', tr('状态', 'status', '狀態'))}
                      </span>
                    )}
                    <span
                      className={`account-col--url${
                        effectiveVisibleAccountColumns.has('url') ? '' : ' is-column-hidden'
                      }`}
                      data-column-key="url"
                      style={{
                        order: accountColumnOrderStyle(accountColumnOrder, 'url')
                      }}
                    >
                      {tr('站点 URL', 'Site URL', '站點 URL')}
                      {accountColumnResizer('url', tr('站点 URL', 'site URL', '站點 URL'))}
                    </span>
                    <div
                      className="account-col--actions"
                      data-column-key="actions"
                      style={{
                        order: accountColumnOrderStyle(accountColumnOrder, 'actions')
                      }}
                    >
                      <span>{tr('操作', 'Actions', '操作')}</span>
                      {accountColumnResizer('actions', tr('操作', 'actions', '操作'))}
                      {columnMenuOpen &&
                        createPortal(
                          <div
                            className="account-column-menu"
                            role="menu"
                            aria-label={tr(
                              '账号列表显示列',
                              'Account list columns',
                              '帳號列表顯示欄位'
                            )}
                            ref={columnMenuRef}
                            style={{
                              left: columnMenuPosition.left,
                              top: columnMenuPosition.top
                            }}
                          >
                            <span className="account-column-menu__label">
                              {tr('列尺寸', 'Column sizing', '欄位尺寸')}
                            </span>
                            <button
                              type="button"
                              role="menuitemradio"
                              aria-checked={accountColumnSizing === 'content'}
                              className={
                                accountColumnSizing === 'content'
                                  ? 'is-checked'
                                  : undefined
                              }
                              onClick={() => chooseAccountColumnSizing('content')}
                            >
                              <span className="account-column-menu__icon">
                                <Maximize2 size={14} />
                              </span>
                              <span>{tr('适应内容', 'Fit content', '適應內容')}</span>
                            </button>
                            <button
                              type="button"
                              role="menuitemradio"
                              aria-checked={accountColumnSizing !== 'content'}
                              className={
                                accountColumnSizing !== 'content'
                                  ? 'is-checked'
                                  : undefined
                              }
                              onClick={() => chooseAccountColumnSizing('window')}
                            >
                              <span className="account-column-menu__icon">
                                <MoveHorizontal size={14} />
                              </span>
                              <span>{tr('适应窗口', 'Fit window', '適應視窗')}</span>
                            </button>
                            <div
                              className="account-column-menu__divider"
                              aria-hidden="true"
                            />
                            <span className="account-column-menu__label">
                              {tr('显示列', 'Visible columns', '顯示欄位')}
                            </span>
                            {accountColumnOrder
                              .filter((key) =>
                                availableAccountColumnKeys.includes(key)
                              )
                              .map((key) => {
                              const checked = effectiveVisibleAccountColumns.has(key)
                              return (
                                <button
                                  type="button"
                                  role="menuitemcheckbox"
                                  aria-checked={checked}
                                  className={`${checked ? 'is-checked' : ''}${
                                    draggedColumnKey === key ? ' is-dragging' : ''
                                  }`}
                                  key={key}
                                  onClick={() => toggleAccountColumn(key)}
                                  draggable
                                  onDragStart={(event) => {
                                    event.dataTransfer.effectAllowed = 'move'
                                    event.dataTransfer.setData('text/plain', key)
                                    setDraggedColumnKey(key)
                                  }}
                                  onDragEnd={() => setDraggedColumnKey(null)}
                                  onDragOver={(event) => {
                                    event.preventDefault()
                                    event.dataTransfer.dropEffect = 'move'
                                  }}
                                  onDrop={(event) => {
                                    event.preventDefault()
                                    if (draggedColumnKey) {
                                      moveAccountColumn(draggedColumnKey, key)
                                    }
                                    setDraggedColumnKey(null)
                                  }}
                                  title={tr(
                                    '拖拽调整列顺序',
                                    'Drag to reorder columns',
                                    '拖曳調整欄位順序'
                                  )}
                                >
                                  <span
                                    className="account-column-menu__drag"
                                    aria-hidden="true"
                                  >
                                    <GripVertical size={12} />
                                  </span>
                                  <span className="account-column-menu__check">
                                    {checked && <Check size={12} />}
                                  </span>
                                  <span>{accountColumnLabel(key)}</span>
                                </button>
                              )
                            })}
                          </div>,
                          document.body
                        )}
                    </div>
                  </div>

                  {pagedAccounts.map((account, index) => (
                    <AccountListRow
                      key={account.id}
                      account={account}
                      bookmark={view === 'bookmarks'}
                      checked={selectedIds.has(account.id)}
                      index={index}
                      tr={tr}
                      visibleColumns={effectiveVisibleAccountColumns}
                      columnOrder={accountColumnOrder}
                      formatLastUsed={(value) => formatLastUsed(value, tr, formatDate)}
                      onToggleSelection={(shiftKey) =>
                        toggleAccountSelection(account.id, shiftKey)
                      }
                      onShiftSelect={() => toggleAccountSelection(account.id, true)}
                      onEdit={() => setDrawer({ mode: 'edit', accountId: account.id })}
                      onContextMenu={(event) => openAccountMenu(event, account)}
                      onLogin={() => void openAccount(account)}
                      dragged={draggedAccountIds.includes(account.id)}
                      dropPosition={
                        accountDropTarget?.accountId === account.id
                          ? accountDropTarget.position
                          : null
                      }
                      onDragStart={(event) => beginAccountDrag(event, account)}
                      onDragEnd={endAccountDrag}
                      onDragOver={(event) => hoverAccountDropTarget(event, account)}
                      onDrop={(event) => void finishAccountDrop(event, account)}
                    />
                  ))}

                  {accounts.length === 0 && (
                    <EmptyState
                      bookmark={view === 'bookmarks'}
                      title={
                        view === 'bookmarks'
                          ? tr('导入第一份浏览器书签', 'Import your first bookmarks', '匯入第一份瀏覽器書籤')
                          : tr(
                              '把第一个账号交给 AutoLogin',
                              'Add your first account',
                              '把第一個帳號交給 AutoLogin'
                            )
                      }
                      description={
                        view === 'bookmarks'
                          ? tr(
                              '书签会独立保存在这里，可整理分组并通过系统默认浏览器访问。',
                              'Bookmarks stay separate here, with groups and default-browser access.',
                              '書籤會獨立保存在這裡，可整理分組並透過系統預設瀏覽器造訪。'
                            )
                          : tr(
                              '添加站点和账号，之后只需一次点击即可在默认浏览器中完成登录。',
                              'Add a site and account, then open it in your default browser with one click.',
                              '新增站點和帳號，之後只需一次點擊即可在預設瀏覽器中完成登入。'
                            )
                      }
                      action={
                        view === 'bookmarks' ? (
                          <BookmarkImportButton
                            showLabel
                            onImported={(result) => void handleDataImported(result.tabId)}
                            notify={notify}
                          />
                        ) : (
                          <button
                            className="button button--primary"
                            onClick={() => setDrawer({ mode: 'create' })}
                          >
                            <Plus size={17} />
                            {tr('添加第一个账号', 'Add first account', '新增第一個帳號')}
                          </button>
                        )
                      }
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
              {filteredAccounts.length > 0 && (
                <footer className="account-pagination">
                  <span aria-live="polite">
                    {tr(
                      view === 'bookmarks'
                        ? '共 {count} 个书签，第 {page}/{pages} 页'
                        : '共 {count} 个账号，第 {page}/{pages} 页',
                      view === 'bookmarks'
                        ? '{count} bookmarks, page {page} of {pages}'
                        : '{count} accounts, page {page} of {pages}',
                      view === 'bookmarks'
                        ? '共 {count} 個書籤，第 {page}/{pages} 頁'
                        : '共 {count} 個帳號，第 {page}/{pages} 頁',
                      {
                        count: filteredAccounts.length,
                        page: currentAccountPage,
                        pages: accountPageCount
                      }
                    )}
                  </span>
                  <div className="account-pagination__controls">
                    <PageSizePicker
                      ariaLabel={tr(
                        '账号每页条数',
                        'Accounts per page',
                        '帳號每頁筆數'
                      )}
                      value={accountPageSize}
                      options={ACCOUNT_PAGE_SIZES}
                      onChange={(nextPageSize) =>
                        setAccountPageSize(nextPageSize as AccountPageSize)
                      }
                    />
                    <div className="account-pagination__nav">
                      <button
                        type="button"
                        className="icon-button icon-button--small"
                        onClick={() =>
                          setAccountPage((value) => Math.max(1, value - 1))
                        }
                        disabled={currentAccountPage <= 1}
                        aria-label={tr('上一页', 'Previous page', '上一頁')}
                      >
                        <ChevronLeft size={16} />
                      </button>
                      <button
                        type="button"
                        className="icon-button icon-button--small"
                        onClick={() =>
                          setAccountPage((value) =>
                            Math.min(accountPageCount, value + 1)
                          )
                        }
                        disabled={currentAccountPage >= accountPageCount}
                        aria-label={tr('下一页', 'Next page', '下一頁')}
                      >
                        <ChevronRight size={16} />
                      </button>
                    </div>
                  </div>
                </footer>
              )}
              </div>
            </div>
            )}
            </>
          )}

          {view === 'passwordGenerator' && (
            <section className="page-section password-generator-page">
              <header className="page-breadcrumb-bar">
                <nav className="page-breadcrumb" aria-label={tr('面包屑', 'Breadcrumb', '麵包屑')}>
                  <h1>{tr('密码生成器', 'Password generator', '密碼產生器')}</h1>
                </nav>
              </header>
              <PasswordGenerator notify={notify} />
            </section>
          )}

          {view === 'loginLogs' && (
            <LoginLogsPage
              sites={allSites}
              accounts={allAccounts}
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
                  <div className="trash-retention-control" ref={trashRetentionRef}>
                    <span>{tr('保留天数', 'Keep for', '保留天數')}</span>
                    <button
                      type="button"
                      className="trash-retention-trigger"
                      aria-label={tr('回收站保留天数', 'Recycle Bin retention', '回收站保留天數')}
                      aria-haspopup="menu"
                      aria-expanded={trashRetentionOpen}
                      disabled={trashRetentionSaving}
                      onClick={() => setTrashRetentionOpen((open) => !open)}
                    >
                      <strong>
                        {tr(
                          `${settings.trashRetentionDays} 天`,
                          `${settings.trashRetentionDays} days`,
                          `${settings.trashRetentionDays} 天`
                        )}
                      </strong>
                      <ChevronDown
                        size={14}
                        className={trashRetentionOpen ? 'is-open' : undefined}
                      />
                    </button>
                    {trashRetentionOpen && (
                      <div
                        className="trash-retention-menu"
                        role="menu"
                        aria-label={tr('回收站保留天数选项', 'Retention options', '回收站保留天數選項')}
                      >
                        {TRASH_RETENTION_OPTIONS.map((days) => {
                          const selected = settings.trashRetentionDays === days
                          return (
                            <button
                              key={days}
                              type="button"
                              role="menuitemradio"
                              aria-checked={selected}
                              className={selected ? 'is-selected' : ''}
                              onClick={() => {
                                setTrashRetentionOpen(false)
                                void updateTrashRetention(days)
                              }}
                            >
                              <span>
                                {tr(`${days} 天`, `${days} days`, `${days} 天`)}
                              </span>
                              {selected && <Check size={13} />}
                            </button>
                          )
                        })}
                      </div>
                    )}
                    {trashRetentionSaving && <LoaderCircle size={14} className="spin" />}
                  </div>
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

              <nav
                className="settings-tabs trash-tabs"
                role="tablist"
                aria-label={tr('回收站分类', 'Recycle Bin sections', '回收站分類')}
              >
                <button
                  type="button"
                  role="tab"
                  aria-selected={trashSection === 'accounts'}
                  className={trashSection === 'accounts' ? 'is-active' : ''}
                  onClick={() => {
                    setTrashSection('accounts')
                    setTrashSelection(new Set())
                    setTrashRetentionOpen(false)
                  }}
                >
                  {tr('账号', 'Accounts', '帳號')}
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={trashSection === 'bookmarks'}
                  className={trashSection === 'bookmarks' ? 'is-active' : ''}
                  onClick={() => {
                    setTrashSection('bookmarks')
                    setTrashSelection(new Set())
                    setTrashRetentionOpen(false)
                  }}
                >
                  {tr('书签', 'Bookmarks', '書籤')}
                </button>
              </nav>

              {visibleDeletedAccounts.length > 0 && (
                <div className="trash-bulk-bar">
                  <span>
                    {trashSelection.size > 0
                      ? tr(
                          `已选择 ${trashSelection.size} 个${
                            trashSection === 'bookmarks' ? '书签' : '账号'
                          }`,
                          `${trashSelection.size} ${
                            trashSection === 'bookmarks' ? 'bookmark' : 'account'
                          }${trashSelection.size === 1 ? '' : 's'} selected`,
                          `已選取 ${trashSelection.size} 個${
                            trashSection === 'bookmarks' ? '書籤' : '帳號'
                          }`
                        )
                      : tr(
                          `勾选${
                            trashSection === 'bookmarks' ? '书签' : '账号'
                          }后可批量恢复或永久删除`,
                          `Select ${
                            trashSection === 'bookmarks' ? 'bookmarks' : 'accounts'
                          } to restore or delete permanently`,
                          `勾選${
                            trashSection === 'bookmarks' ? '書籤' : '帳號'
                          }後可批次恢復或永久刪除`
                        )}
                  </span>
                  <div>
                    <button
                      type="button"
                      className="button button--ghost button--small"
                      onClick={() => void restoreSelectedAccounts()}
                      disabled={trashSelection.size === 0 || trashActionBusy}
                    >
                      {trashActionBusy ? (
                        <LoaderCircle size={14} className="spin" />
                      ) : (
                        <Undo2 size={14} />
                      )}
                      {tr('批量恢复', 'Restore selected', '批次恢復')}
                    </button>
                    <button
                      type="button"
                      className="button button--danger-ghost button--small"
                      onClick={() => setPurgeTargets([...trashSelection])}
                      disabled={trashSelection.size === 0 || trashActionBusy}
                    >
                      <Trash2 size={14} />
                      {tr('批量删除', 'Delete selected', '批次刪除')}
                    </button>
                  </div>
                </div>
              )}

              {visibleDeletedAccounts.length === 0 ? (
                <CompactEmptyState
                  title={tr('回收站是空的', 'Recycle Bin is empty', '回收站是空的')}
                  description={tr(
                    `删除的${
                      trashSection === 'bookmarks' ? '书签' : '账号'
                    }会在这里保留 ${settings.trashRetentionDays} 天，可随时恢复。`,
                    `Deleted ${
                      trashSection === 'bookmarks' ? 'bookmarks' : 'accounts'
                    } are kept here for ${settings.trashRetentionDays} days and can be restored at any time.`,
                    `刪除的${
                      trashSection === 'bookmarks' ? '書籤' : '帳號'
                    }會在這裡保留 ${settings.trashRetentionDays} 天，可隨時恢復。`
                  )}
                />
              ) : (
                <div
                  className={`trash-list${
                    trashSection === 'bookmarks' ? ' trash-list--bookmarks' : ''
                  }`}
                  role="table"
                  aria-label={
                    trashSection === 'bookmarks'
                      ? tr('已删除书签', 'Deleted bookmarks', '已刪除書籤')
                      : tr('已删除账号', 'Deleted accounts', '已刪除帳號')
                  }
                >
                  <div className="trash-list__header" role="row">
                    <SelectionCheckbox
                      ref={trashSelectAllRef}
                      checked={
                        visibleDeletedAccounts.length > 0 &&
                        trashSelection.size === visibleDeletedAccounts.length
                      }
                      label={
                        trashSection === 'bookmarks'
                          ? tr('选择回收站全部书签', 'Select all deleted bookmarks', '選取回收站全部書籤')
                          : tr('选择回收站全部账号', 'Select all deleted accounts', '選取回收站全部帳號')
                      }
                      onChange={toggleAllTrashSelection}
                    />
                    <span>{tr('站点', 'Site', '站點')}</span>
                    {trashSection === 'accounts' && (
                      <span>{tr('用户名', 'Username', '使用者名稱')}</span>
                    )}
                    <span>{tr('分组', 'Group', '分組')}</span>
                    <span>{tr('标签', 'Tab', '標籤')}</span>
                    <span>{tr('删除时间', 'Deleted', '刪除時間')}</span>
                    <span>{tr('操作', 'Actions', '操作')}</span>
                  </div>
                  {visibleDeletedAccounts.map((account) => (
                    <div className="trash-row" role="row" key={account.id}>
                      <SelectionCheckbox
                        checked={trashSelection.has(account.id)}
                        label={tr(
                          `选择 ${account.site.name}`,
                          `Select ${account.site.name}`,
                          `選取 ${account.site.name}`
                        )}
                        onChange={() => toggleTrashSelection(account.id)}
                      />
                      <div className="account-identity">
                        <SiteMark site={account.site} />
                        <div>
                          <strong>{account.site.name}</strong>
                        </div>
                      </div>
                      {trashSection === 'accounts' && (
                        <div className="account-username">
                          <UserRound size={14} />
                          <strong>{account.username}</strong>
                        </div>
                      )}
                      <div className="account-group-cell">
                        <Layers3 size={13} />
                        <span>{displayGroup(account, tr)}</span>
                      </div>
                      <div className="trash-tab-cell">
                        <Database size={13} />
                        <span title={account.tabName}>{account.tabName}</span>
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
                      <div className="trash-row__actions">
                        <button
                          type="button"
                          className="button button--ghost button--small button--icon-only"
                          onClick={() => void restoreAccount(account.id)}
                          disabled={restoringAccountId === account.id || trashActionBusy}
                          aria-label={
                            trashSection === 'bookmarks'
                              ? tr('恢复书签', 'Restore bookmark', '恢復書籤')
                              : tr('恢复账号', 'Restore account', '恢復帳號')
                          }
                          title={
                            trashSection === 'bookmarks'
                              ? tr('恢复书签', 'Restore bookmark', '恢復書籤')
                              : tr('恢复账号', 'Restore account', '恢復帳號')
                          }
                        >
                          {restoringAccountId === account.id ? (
                            <LoaderCircle size={14} className="spin" />
                          ) : (
                            <Undo2 size={14} />
                          )}
                        </button>
                        <button
                          type="button"
                          className="button button--danger-ghost button--small button--icon-only"
                          onClick={() => setPurgeTargets([account.id])}
                          disabled={trashActionBusy}
                          aria-label={
                            trashSection === 'bookmarks'
                              ? tr('永久删除书签', 'Delete bookmark permanently', '永久刪除書籤')
                              : tr('永久删除账号', 'Delete account permanently', '永久刪除帳號')
                          }
                          title={
                            trashSection === 'bookmarks'
                              ? tr('永久删除书签', 'Delete bookmark permanently', '永久刪除書籤')
                              : tr('永久删除账号', 'Delete account permanently', '永久刪除帳號')
                          }
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
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
              updateState={updateState}
              onModuleChange={chooseSettingsModule}
              onSettingsChange={async (patch) => {
                await window.autologin.settings.update(patch)
                await onRefresh()
              }}
              onRefresh={onRefresh}
              onClearAllData={clearAllData}
              onDownloadUpdate={onDownloadUpdate}
              onCancelUpdate={onCancelUpdate}
              onInstallUpdate={onInstallUpdate}
              notify={notify}
            />
          )}
        </div>
        )}
      </main>
    </div>
  )
}
function AccountListRow({
  account,
  bookmark,
  checked,
  index,
  tr,
  visibleColumns,
  columnOrder,
  formatLastUsed,
  onToggleSelection,
  onShiftSelect,
  onEdit,
  onContextMenu,
  onLogin,
  dragged,
  dropPosition,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDrop
}: {
  account: AccountWithSite
  bookmark: boolean
  checked: boolean
  index: number
  tr: Translate
  visibleColumns: Set<AccountColumnKey>
  columnOrder: AccountColumnKey[]
  formatLastUsed: (value?: string) => string
  onToggleSelection?: (shiftKey: boolean) => void
  onShiftSelect?: () => void
  onEdit: () => void
  onContextMenu: (event: React.MouseEvent<HTMLElement>) => void
  onLogin: () => void
  dragged: boolean
  dropPosition: 'before' | 'after' | null
  onDragStart: (event: React.DragEvent<HTMLElement>) => void
  onDragEnd: () => void
  onDragOver: (event: React.DragEvent<HTMLElement>) => void
  onDrop: (event: React.DragEvent<HTMLElement>) => void
}): React.JSX.Element {
  const recorded = (account.recipes?.length ?? 0) > 0 || Boolean(account.site.recipe)
  const statusLabel = bookmark
    ? tr('书签', 'Bookmark', '書籤')
    : recorded
      ? tr('已录制', 'Recorded', '已錄製')
      : tr('自动识别', 'Auto detect', '自動識別')
  const actionLabel = bookmark
    ? tr('访问', 'Visit', '造訪')
    : tr('登录', 'Sign in', '登入')

  return (
    <article
      className={`account-row${checked ? ' is-selected' : ''}${
        dragged ? ' is-dragging' : ''
      }${dropPosition ? ` is-drop-${dropPosition}` : ''}`}
      style={{ '--row-index': index } as React.CSSProperties}
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragOver={onDragOver}
      onDrop={onDrop}
      title={tr(
        '双击编辑，右键查看更多操作',
        'Double-click to edit, right-click for more actions',
        '雙擊編輯，右鍵查看更多操作'
      )}
      onDoubleClick={(event) => {
        if (event.target instanceof Element && event.target.closest('button, input, label')) {
          return
        }
        onEdit()
      }}
      onClick={(event) => {
        if (
          !event.shiftKey ||
          (event.target instanceof Element && event.target.closest('button, input, label'))
        ) {
          return
        }
        event.preventDefault()
        onShiftSelect?.()
      }}
      onContextMenu={onContextMenu}
    >
      <SelectionCheckbox
        checked={checked}
        label={tr(
          `选择站点 ${account.site.name}`,
          `Select ${account.site.name}`,
          `選擇站點 ${account.site.name}`
        )}
        onChange={(shiftKey) => onToggleSelection?.(shiftKey)}
      />
      <div
        className="account-identity"
        data-column-key="site"
        style={{ order: accountColumnOrderStyle(columnOrder, 'site') }}
      >
        <span className="account-row-drag-handle" aria-hidden="true">
          <GripVertical size={12} />
        </span>
        <SiteMark site={account.site} />
        <div>
          <div className="account-name-line">
            <strong>{account.site.name}</strong>
          </div>
        </div>
      </div>
      <div
        className={`account-username${
          visibleColumns.has('username') ? '' : ' is-column-hidden'
        }`}
        data-column-key="username"
        style={{ order: accountColumnOrderStyle(columnOrder, 'username') }}
      >
        <UserRound size={14} />
        <strong>{account.username}</strong>
      </div>
      <div
        className={`account-group-cell${
          visibleColumns.has('group') ? '' : ' is-column-hidden'
        }`}
        data-column-key="group"
        style={{ order: accountColumnOrderStyle(columnOrder, 'group') }}
      >
        <Layers3 size={13} />
        <span>{displayGroup(account, tr)}</span>
      </div>
      <time
        className={`account-updated${
          visibleColumns.has('updated') ? '' : ' is-column-hidden'
        }`}
        data-column-key="updated"
        style={{ order: accountColumnOrderStyle(columnOrder, 'updated') }}
        dateTime={account.updatedAt}
      >
        {formatLastUsed(account.updatedAt)}
      </time>
      {!bookmark && (
        <div
          className={`account-status-cell${
            visibleColumns.has('status') ? '' : ' is-column-hidden'
          }`}
          data-column-key="status"
          style={{ order: accountColumnOrderStyle(columnOrder, 'status') }}
        >
          <span
            className={`recipe-badge${recorded ? ' is-recorded' : ''}`}
            title={statusLabel}
          >
            <span />
            {statusLabel}
          </span>
        </div>
      )}
      <div
        className={`account-site-url${
          visibleColumns.has('url') ? '' : ' is-column-hidden'
        }`}
        data-column-key="url"
        style={{ order: accountColumnOrderStyle(columnOrder, 'url') }}
        title={account.site.startUrl}
      >
        {account.site.startUrl}
      </div>
      <div
        className="account-actions"
        data-column-key="actions"
        style={{ order: accountColumnOrderStyle(columnOrder, 'actions') }}
      >
        <button
          className="row-login-button row-action-button--icon"
          onClick={(event) => {
            event.stopPropagation()
            onLogin()
          }}
          aria-label={actionLabel}
          title={actionLabel}
        >
          {bookmark ? <Globe2 size={15} /> : <LogIn size={15} />}
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
    onChange: (shiftKey: boolean) => void
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
        onChange={(event) =>
          onChange(Boolean((event.nativeEvent as MouseEvent).shiftKey))
        }
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
  action,
  bookmark = false
}: {
  title: string
  description: string
  action: React.ReactNode
  bookmark?: boolean
}): React.JSX.Element {
  return (
    <div className="empty-state">
      <div className="empty-state__art" aria-hidden="true">
        <span />
        <span />
        <span>
          {bookmark ? (
            <Bookmark size={27} strokeWidth={1.6} />
          ) : (
            <KeyRound size={27} strokeWidth={1.6} />
          )}
        </span>
      </div>
      <span className="eyebrow">
        {bookmark ? 'IMPORT YOUR BOOKMARKS' : 'YOUR FIRST LOGIN'}
      </span>
      <h2>{title}</h2>
      <p>{description}</p>
      {action}
    </div>
  )
}

function DatabaseWorkspaceEmptyState({
  bookmarkMode = false,
  creating,
  onCreate,
  onImported,
  notify
}: {
  bookmarkMode?: boolean
  creating: boolean
  onCreate: () => Promise<void>
  onImported: (tabId: string) => void
  notify: (kind: 'success' | 'error' | 'info', message: string) => void
}): React.JSX.Element {
  const { tr } = useI18n()
  const [openDatabaseRequest, setOpenDatabaseRequest] = useState(0)
  const [openingDatabase, setOpeningDatabase] = useState(false)
  const busy = creating || openingDatabase

  return (
    <section
      className="empty-state library-database-empty-state"
      aria-label={
        bookmarkMode
          ? tr(
              '没有打开的书签标签页',
              'No bookmark tab is open',
              '沒有開啟的書籤標籤頁'
            )
          : tr('没有打开的数据库', 'No database is open', '沒有開啟的資料庫')
      }
    >
      <div className="empty-state__art" aria-hidden="true">
        <span />
        <span />
        <span>
          {bookmarkMode ? (
            <Bookmark size={27} strokeWidth={1.6} />
          ) : (
            <Database size={27} strokeWidth={1.6} />
          )}
        </span>
      </div>
      <span className="eyebrow">
        {bookmarkMode ? 'NO BOOKMARK TAB OPEN' : 'NO DATABASE OPEN'}
      </span>
      <h2>
        {bookmarkMode
          ? tr('还没有书签标签页', 'No bookmark tabs yet', '尚未有書籤標籤頁')
          : tr(
              '打开一个数据库开始使用',
              'Open a database to get started',
              '開啟資料庫開始使用'
            )}
      </h2>
      <p>
        {bookmarkMode
          ? tr(
              '新建一个书签标签页，或导入浏览器书签开始使用。',
              'Create a bookmark tab or import browser bookmarks to get started.',
              '建立一個書籤標籤頁，或匯入瀏覽器書籤開始使用。'
            )
          : tr(
              '所有数据库标签页都已关闭。新建本地数据库，或选择已有的 AutoLogin、KDBX 文件继续。',
              'All database tabs are closed. Create a local database or open an existing AutoLogin or KDBX file.',
              '所有資料庫分頁都已關閉。建立本機資料庫，或選擇既有的 AutoLogin、KDBX 檔案繼續。'
            )}
      </p>
      <div className="library-database-empty-state__actions">
        <button
          type="button"
          className="button button--primary"
          onClick={() => void onCreate()}
          disabled={busy}
        >
          <Plus size={17} />
          {bookmarkMode
            ? tr('新建书签标签页', 'New bookmark tab', '新增書籤標籤頁')
            : tr('新建数据库', 'New database', '新增資料庫')}
        </button>
        {bookmarkMode ? (
          <BookmarkImportButton
            showLabel
            buttonClassName="button button--ghost"
            onImported={(result) => onImported(result.tabId)}
            notify={notify}
          />
        ) : (
          <button
            type="button"
            className="button button--ghost"
            onClick={() => setOpenDatabaseRequest((value) => value + 1)}
            disabled={busy}
          >
            <FolderOpen size={17} />
            {tr('打开本地数据库', 'Open local database', '開啟本機資料庫')}
          </button>
        )}
      </div>
      {!bookmarkMode && (
        <AccountTransferControls
          tabId=""
          renderControls={false}
          openDatabaseRequest={openDatabaseRequest}
          onDatabaseBusyChange={setOpeningDatabase}
          onCreateTab={onCreate}
          onImported={(result) => onImported(result.tabId)}
          notify={notify}
        />
      )}
    </section>
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
  const leftOrder = left.sortOrder
  const rightOrder = right.sortOrder
  if (typeof leftOrder === 'number' && typeof rightOrder === 'number') {
    return leftOrder - rightOrder
  }
  if (typeof leftOrder === 'number') return -1
  if (typeof rightOrder === 'number') return 1
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
  if (ungrouped.length === 0) return result
  const ungroupedOrder = order.get(UNGROUPED_GROUP_KEY) ?? Number.MAX_SAFE_INTEGER
  const insertIndex = result.findIndex((group) => {
    if (group.parentPath !== null) return false
    const groupOrder =
      order.get(group.actualName ?? group.key) ??
      order.get(group.name) ??
      Number.MAX_SAFE_INTEGER
    return groupOrder > ungroupedOrder
  })
  result.splice(insertIndex < 0 ? result.length : insertIndex, 0, ...ungrouped)
  return result
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () =>
      typeof reader.result === 'string'
        ? resolve(reader.result)
        : reject(new Error('无法读取图片'))
    reader.onerror = () => reject(reader.error ?? new Error('无法读取图片'))
    reader.readAsDataURL(file)
  })
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
