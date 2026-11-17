import {
  Fragment,
  forwardRef,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState
} from 'react'
import { createPortal } from 'react-dom'
import {
  ArrowUpRight,
  ArchiveRestore,
  Bookmark,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronsDown,
  ChevronsUp,
  Copy,
  Database,
  FileClock,
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
  MoreHorizontal,
  MoveHorizontal,
  PanelLeftClose,
  PanelLeftOpen,
  Pencil,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  Settings,
  SlidersHorizontal,
  Sparkles,
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
  type AccountBatchIconFetchProgress,
  type AccountTab,
  type AccountWithSite,
  type AppSettings,
  type AppUpdateState,
  type DeletedAccountWithSite,
  type GroupDefinition,
  type LoginBatchState,
  type LoginBrowser,
  type LoginStrategy,
  type LoginViewState,
  type RecipeStep,
  type SelectorTestResult,
  type Site,
  type TrashRetentionDays
} from '@shared/types'
import { matchesKeyboardShortcut } from '@shared/shortcuts'
import {
  flattenGroupTree,
  groupLevel,
  groupParentPath,
  type GroupSummary
} from '@shared/group-tree'
import { useI18n } from '../i18n'
import { AccountDrawer } from './AccountDrawer'
import { AccountTabs } from './AccountTabs'
import { AccountTransferControls } from './AccountTransferControls'
import { AppLogsPage } from './AppLogsPage'
import { BrowserWorkspace } from './BrowserWorkspace'
import {
  BookmarkImportButton,
  BookmarkTransferControls
} from './BookmarkImportButton'
import { CollectionPageHeader } from './CollectionPageHeader'
import {
  CollectionSearchField,
  useCollectionSearch
} from './CollectionSearchField'
import { CollectionFilterSelect } from './CollectionFilterSelect'
import { LoadingSpinner } from './LoadingSpinner'
import {
  emptyLogDateRange,
  LogDateFilter,
  matchesLogDateRange
} from './LogDateFilter'
import { LoginLogsPage } from './LoginLogsPage'
import {
  ManualStepEditor,
  manualSelectorsToSteps,
  manualStepSelector,
  manualStepsAreComplete,
  normalizeManualSteps,
  selectorTestFieldForAction
} from './ManualStepEditor'
import { ConfirmDialog, Modal } from './Modal'
import { PageActionMenu } from './PageActionMenu'
import { PageSizePicker } from './PageSizePicker'
import { PasswordGenerator } from './PasswordGenerator'
import { SettingsPage, type SettingsModule } from './SettingsPage'
import { SiteMark } from './SiteMark'

type LibraryView =
  | 'accounts'
  | 'bookmarks'
  | 'browser'
  | 'passwordGenerator'
  | 'loginLogs'
  | 'appLogs'
  | 'trash'
  | 'settings'
type GroupDropPosition = 'before' | 'after' | 'inside'
type ColumnDropPosition = 'before' | 'after'
type DrawerState = { mode: 'create'; siteId?: string } | { mode: 'edit'; accountId: string }
type AccountMenuState =
  {
    kind: 'account'
    account: AccountWithSite
    anchorX: number
    anchorY: number
    left: number
    top: number
  }
type AccountColumnSizing = 'content' | 'window' | 'manual'
type AccountPageSize = 10 | 20 | 50 | 100 | 200
const ACCOUNT_COLUMN_KEYS = ['username', 'group', 'updated', 'url'] as const
const ACCOUNT_PAGE_SIZES: AccountPageSize[] = [10, 20, 50, 100, 200]
const GROUP_DOT_COLORS = [
  '#6f7cf6',
  '#4f9d82',
  '#c08b4b',
  '#6b8fc9',
  '#b0719b',
  '#5c9fa8'
] as const
type AccountColumnKey = (typeof ACCOUNT_COLUMN_KEYS)[number]
type AccountColumnResizeKey = 'site' | AccountColumnKey | 'actions'
const ACCOUNT_COLUMN_STORAGE_KEY = 'autologin.account.visibleColumns'
const ACCOUNT_COLUMN_ORDER_STORAGE_KEY = 'autologin.account.columnOrder'
const ACCOUNT_COLUMN_SIZING_STORAGE_KEY = 'autologin.account.columnSizing'
const ACCOUNT_COLUMN_WIDTH_STORAGE_KEY = 'autologin.account.columnWidths'
const ACCOUNT_ACTIVE_TAB_STORAGE_KEY = 'autologin.account.activeTab'
const BOOKMARK_ACTIVE_TAB_STORAGE_KEY = 'autologin.bookmark.activeTab'
const SESSION_CLEAR_TIMEOUT_MS = 15_000
const ACCOUNT_COLUMN_DEFAULT_WIDTHS: Record<AccountColumnResizeKey, number> = {
  site: 250,
  username: 150,
  group: 90,
  updated: 96,
  url: 180,
  actions: 128
}
const ACCOUNT_COLUMN_MIN_WIDTHS: Record<AccountColumnResizeKey, number> = {
  site: 90,
  username: 58,
  group: 40,
  updated: 54,
  url: 68,
  actions: 84
}

function groupDotColor(path: string): string {
  let hash = 2166136261
  for (let index = 0; index < path.length; index += 1) {
    hash ^= path.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return (
    GROUP_DOT_COLORS[(hash >>> 0) % GROUP_DOT_COLORS.length] ??
    GROUP_DOT_COLORS[0]
  )
}

function withSessionClearTimeout<T>(promise: Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = window.setTimeout(
      () => reject(new Error('清除网站会话超时，请关闭对应浏览器窗口后重试')),
      SESSION_CLEAR_TIMEOUT_MS
    )
    promise.then(
      (value) => {
        window.clearTimeout(timer)
        resolve(value)
      },
      (reason: unknown) => {
        window.clearTimeout(timer)
        reject(reason)
      }
    )
  })
}

function workflowStepCount(account: AccountWithSite): number {
  const activeRecipe = account.activeRecipeId
    ? account.recipes?.find((recipe) => recipe.id === account.activeRecipeId)?.recipe
    : account.site.recipe
  if (activeRecipe?.steps.length) return activeRecipe.steps.length
  return account.manualSteps?.length ?? 0
}

function siteDomain(startUrl: string): string {
  try {
    return new URL(startUrl).hostname.replace(/^www\./i, '')
  } catch {
    return startUrl.replace(/^https?:\/\//i, '').split('/')[0] ?? startUrl
  }
}

function batchManualStepsSignature(steps: RecipeStep[]): string {
  return JSON.stringify(
    steps.map((step) => ({
      type: step.type,
      selector: manualStepSelector(step).trim(),
      key: step.type === 'press' ? step.key.trim() : ''
    }))
  )
}

const ACCOUNT_COLUMN_TRACKS = {
  wide: {
    checkbox: '22px',
    site: 'minmax(190px, 1.45fr)',
    username: 'minmax(110px, 0.9fr)',
    group: 'minmax(82px, 0.62fr)',
    updated: '96px',
    url: 'minmax(120px, 0.9fr)',
    actions: 'max-content'
  },
  medium: {
    checkbox: '20px',
    site: 'minmax(150px, 1.35fr)',
    username: 'minmax(92px, 0.88fr)',
    group: 'minmax(72px, 0.62fr)',
    updated: '86px',
    url: 'minmax(104px, 0.85fr)',
    actions: 'max-content'
  },
  compact: {
    checkbox: '20px',
    site: 'minmax(132px, 1.25fr)',
    username: 'minmax(72px, 0.78fr)',
    group: 'minmax(56px, 0.58fr)',
    updated: '68px',
    url: 'minmax(90px, 0.78fr)',
    actions: 'max-content'
  },
  narrow: {
    checkbox: '18px',
    site: 'minmax(110px, 1.2fr)',
    username: 'minmax(62px, 0.72fr)',
    group: 'minmax(48px, 0.52fr)',
    updated: '58px',
    url: 'minmax(70px, 0.72fr)',
    actions: 'max-content'
  }
} as const
type Translate = (
  zhCN: string,
  en: string,
  zhTW: string,
  variables?: Record<string, string | number>
) => string

const UNGROUPED_KEY = UNGROUPED_GROUP_KEY
const ACCOUNT_SUBNAV_DEFAULT_WIDTH = 224
const ACCOUNT_SUBNAV_MIN_WIDTH = 148
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
  loginState,
  recordingFinishRequest,
  onRefresh,
  onLock,
  onStartBatch,
  onRecord,
  onRecordingFinishHandled,
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
  loginState: LoginViewState | null
  recordingFinishRequest: number
  onRefresh: () => Promise<void>
  onLock: () => Promise<void>
  onStartBatch: (accountIds: string[]) => Promise<boolean>
  onRecord: (account: AccountWithSite) => Promise<boolean>
  onRecordingFinishHandled: () => void
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
    return stored?.trim() || ''
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
  const sidebarCollapsed = true
  const [rowEntryEnabled, setRowEntryEnabled] = useState(true)
  const [search, setSearch] = useState('')
  const [searchExpanded, setSearchExpanded] = useState(false)
  const [visibleAccountColumns, setVisibleAccountColumns] = useState<
    Set<AccountColumnKey>
  >(() => {
    try {
      const stored = window.localStorage.getItem(ACCOUNT_COLUMN_STORAGE_KEY)
      if (!stored) {
        return new Set<AccountColumnKey>(['username', 'group', 'updated'])
      }
      const values = JSON.parse(stored) as unknown
      if (!Array.isArray(values)) {
        return new Set<AccountColumnKey>(['username', 'group', 'updated'])
      }
      return new Set(
        values.filter(
          (value): value is AccountColumnKey =>
            typeof value === 'string' &&
            ACCOUNT_COLUMN_KEYS.includes(value as AccountColumnKey)
        )
      )
    } catch {
      return new Set<AccountColumnKey>(['username', 'group', 'updated'])
    }
  })
  const availableAccountColumnKeys = ACCOUNT_COLUMN_KEYS
  const effectiveVisibleAccountColumns = visibleAccountColumns
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
      return 'window'
    })
  const [columnMenuOpen, setColumnMenuOpen] = useState(false)
  const [columnMenuPosition, setColumnMenuPosition] = useState({ left: 0, top: 0 })
  const [draggedColumnKey, setDraggedColumnKey] = useState<AccountColumnKey | null>(
    null
  )
  const [columnDropTarget, setColumnDropTarget] = useState<{
    key: AccountColumnKey
    position: ColumnDropPosition
  } | null>(null)
  const [accountGroupTreeExpanded, setAccountGroupTreeExpanded] = useState(
    () => window.localStorage.getItem('autologin.account.groups.treeExpanded') !== '0'
  )
  const [groupSearch, setGroupSearch] = useState('')
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
  const [groupDefinitionState, setGroupDefinitionState] = useState<{
    tabId: string
    groups: GroupDefinition[]
  }>({ tabId: '', groups: [] })
  const groupDefinitions =
    groupDefinitionState.tabId === activeTabId ? groupDefinitionState.groups : []
  const [deletedAccounts, setDeletedAccounts] = useState<DeletedAccountWithSite[]>([])
  const [trashSection, setTrashSection] = useState<'accounts' | 'bookmarks'>(
    'accounts'
  )
  const sectionDeletedAccounts = useMemo(
    () =>
      deletedAccounts.filter((record) =>
        trashSection === 'bookmarks'
          ? record.source === 'bookmarks'
          : record.source !== 'bookmarks'
      ),
    [deletedAccounts, trashSection]
  )
  const {
    searchInput: trashSearchInput,
    search: trashSearch,
    searchRef: trashSearchRef,
    setSearchInput: setTrashSearchInput,
    clearSearch: clearTrashSearch
  } = useCollectionSearch(language)
  const [trashDateRange, setTrashDateRange] = useState(emptyLogDateRange)
  const [trashGroup, setTrashGroup] = useState('all')
  const [trashSource, setTrashSource] = useState('all')
  const [groupCreateState, setGroupCreateState] = useState<{
    parent: GroupSummary | null
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
  const [tabClosePrompt, setTabClosePrompt] = useState<{
    tab: AccountTab
    left: number
    top: number
  } | null>(null)
  const [renameTabTarget, setRenameTabTarget] = useState<AccountTab | null>(null)
  const [renameTabValue, setRenameTabValue] = useState('')
  const [tabBusy, setTabBusy] = useState(false)
  const [missingTabFileTarget, setMissingTabFileTarget] =
    useState<AccountTab | null>(null)
  const [restoringAccountId, setRestoringAccountId] = useState<string | null>(null)
  const [trashSelection, setTrashSelection] = useState<Set<string>>(() => new Set())
  const [purgeTargets, setPurgeTargets] = useState<string[] | null>(null)
  const [trashActionBusy, setTrashActionBusy] = useState(false)
  const [trashPageSize, setTrashPageSize] = useState<AccountPageSize>(20)
  const [trashPage, setTrashPage] = useState(1)
  const [trashRetentionSaving, setTrashRetentionSaving] = useState(false)
  const [trashRetentionOpen, setTrashRetentionOpen] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set())
  const [accountPageSize, setAccountPageSize] = useState<AccountPageSize>(20)
  const [accountPage, setAccountPage] = useState(1)
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
  const [deleteGroupTarget, setDeleteGroupTarget] = useState<GroupSummary | null>(null)
  const [groupActionBusy, setGroupActionBusy] = useState(false)
  const [batchStrategyOpen, setBatchStrategyOpen] = useState(false)
  const [batchStrategy, setBatchStrategy] = useState<LoginStrategy>('auto')
  const [batchBrowser, setBatchBrowser] = useState<LoginBrowser>('standalone')
  const [batchSteps, setBatchSteps] = useState<RecipeStep[]>([])
  const [batchStepTests, setBatchStepTests] = useState<
    Record<string, SelectorTestResult>
  >({})
  const [batchStepTesting, setBatchStepTesting] = useState<string | null>(null)
  const [batchStrategyError, setBatchStrategyError] = useState('')
  const [batchStrategyBusy, setBatchStrategyBusy] = useState(false)
  const [batchSessionClearConfirm, setBatchSessionClearConfirm] = useState(false)
  const [batchSessionClearBusy, setBatchSessionClearBusy] = useState(false)
  const [batchIcon, setBatchIcon] = useState<string | null>(null)
  const [batchIconBusy, setBatchIconBusy] = useState(false)
  const [batchIconFetchBusy, setBatchIconFetchBusy] = useState(false)
  const [batchIconFetchProgress, setBatchIconFetchProgress] =
    useState<AccountBatchIconFetchProgress | null>(null)
  const [batchIconFetchCancelBusy, setBatchIconFetchCancelBusy] = useState(false)
  const [duplicateBusy, setDuplicateBusy] = useState(false)
  const [accountClipboardIds, setAccountClipboardIds] = useState<string[]>([])
  const [keyboardDuplicateBusy, setKeyboardDuplicateBusy] = useState(false)
  const [bookmarkBatchOpenBusy, setBookmarkBatchOpenBusy] = useState(false)
  const [manualRefreshing, setManualRefreshing] = useState(false)
  const [deleteSelectedOpen, setDeleteSelectedOpen] = useState(false)
  const [deleteSelectedBusy, setDeleteSelectedBusy] = useState(false)
  const searchRef = useRef<HTMLInputElement>(null)
  const searchContainerRef = useRef<HTMLDivElement>(null)
  const selectAllRef = useRef<HTMLInputElement>(null)
  const selectionAnchorRef = useRef<string | null>(null)
  const trashSelectAllRef = useRef<HTMLInputElement>(null)
  const groupCreateInputRef = useRef<HTMLInputElement>(null)
  const batchIconInputRef = useRef<HTMLInputElement>(null)
  const columnMenuRef = useRef<HTMLDivElement>(null)
  const accountMenuRef = useRef<HTMLDivElement>(null)
  const columnResizeCleanupRef = useRef<(() => void) | null>(null)
  const columnDragCleanupRef = useRef<(() => void) | null>(null)
  const groupDragCleanupRef = useRef<(() => void) | null>(null)
  const suppressColumnClickRef = useRef(false)
  const suppressGroupClickRef = useRef(false)
  const accountListRef = useRef<HTMLElement>(null)
  const accountTableScrollRef = useRef<HTMLDivElement>(null)
  const accountLayoutRef = useRef<HTMLDivElement>(null)
  const draggedGroupPathRef = useRef<string | null>(null)
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
      if (definition.tabId !== activeTabId) continue
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
    () => {
      const query = groupSearch.trim().toLocaleLowerCase(language)
      if (query) {
        const matchingPaths = new Set<string>()
        for (const group of groups) {
          if (!group.actualName) {
            if (group.name.toLocaleLowerCase(language).includes(query)) {
              matchingPaths.add('')
            }
            continue
          }
          if (
            !group.actualName.toLocaleLowerCase(language).includes(query) &&
            !group.name.toLocaleLowerCase(language).includes(query)
          ) {
            continue
          }
          const segments = group.actualName.split(GROUP_PATH_SEPARATOR)
          for (let index = 1; index <= segments.length; index += 1) {
            matchingPaths.add(segments.slice(0, index).join(GROUP_PATH_SEPARATOR))
          }
        }
        return groups.filter(
          (group) => !group.actualName || matchingPaths.has(group.actualName)
        )
      }
      return groups.filter((group) => {
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
      })
    },
    [collapsedGroupPaths, groupSearch, groups, language]
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
  const recordedAccountCount = useMemo(
    () => filteredAccounts.filter((account) => workflowStepCount(account) > 0).length,
    [filteredAccounts]
  )

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
  const trashGroupOptions = useMemo(() => {
    const values = new Set<string>()
    for (const record of sectionDeletedAccounts) {
      values.add(trashGroupKey(record))
    }
    return [...values].sort((left, right) => {
      if (left === '__ungrouped__') return 1
      if (right === '__ungrouped__') return -1
      return left.localeCompare(right, language)
    })
  }, [language, sectionDeletedAccounts])
  const trashSourceOptions = useMemo(() => {
    const values = new Set<string>()
    for (const record of sectionDeletedAccounts) {
      values.add(record.tabName.trim() || record.tabId)
    }
    return [...values].sort((left, right) => left.localeCompare(right, language))
  }, [language, sectionDeletedAccounts])
  const normalizedTrashSearch = trashSearch
  const visibleDeletedAccounts = useMemo(
    () =>
      sectionDeletedAccounts.filter((record) => {
        if (normalizedTrashSearch) {
          const haystack = [
            record.site.name,
            record.username,
            displayGroup(record, tr),
            record.tabName
          ]
            .join(' ')
            .toLocaleLowerCase(language)
          if (!haystack.includes(normalizedTrashSearch)) return false
        }
        if (!matchesLogDateRange(record.deletedAt, trashDateRange)) return false
        if (trashGroup !== 'all' && trashGroupKey(record) !== trashGroup) return false
        if (
          trashSource !== 'all' &&
          (record.tabName.trim() || record.tabId) !== trashSource
        ) {
          return false
        }
        return true
      }),
    [
      language,
      normalizedTrashSearch,
      sectionDeletedAccounts,
      trashDateRange,
      trashGroup,
      trashSource,
      tr
    ]
  )
  const trashPageCount = Math.max(
    1,
    Math.ceil(visibleDeletedAccounts.length / trashPageSize)
  )
  const currentTrashPage = Math.min(trashPage, trashPageCount)
  const pagedDeletedAccounts = useMemo(
    () =>
      visibleDeletedAccounts.slice(
        (currentTrashPage - 1) * trashPageSize,
        currentTrashPage * trashPageSize
      ),
    [currentTrashPage, trashPageSize, visibleDeletedAccounts]
  )
  const trashPageSelectedCount = pagedDeletedAccounts.filter((account) =>
    trashSelection.has(account.id)
  ).length
  const allTrashPageSelected =
    pagedDeletedAccounts.length > 0 &&
    trashPageSelectedCount === pagedDeletedAccounts.length
  const someTrashPageSelected =
    trashPageSelectedCount > 0 && !allTrashPageSelected
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
              ''
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
    setGroupDefinitionState({ tabId: activeTabId, groups: [] })
    if (!activeTabId) {
      return () => {
        cancelled = true
      }
    }
    void window.autologin.groups
      .list(activeTabId)
      .then((nextGroups) => {
        if (!cancelled) {
          setGroupDefinitionState({ tabId: activeTabId, groups: nextGroups })
        }
      })
      .catch(() => {
        if (!cancelled) {
          setGroupDefinitionState({ tabId: activeTabId, groups: [] })
        }
      })
    return () => {
      cancelled = true
    }
  }, [activeTabId])

  useEffect(() => {
    if (accountTabId) {
      window.localStorage.setItem(ACCOUNT_ACTIVE_TAB_STORAGE_KEY, accountTabId)
    } else {
      window.localStorage.removeItem(ACCOUNT_ACTIVE_TAB_STORAGE_KEY)
    }
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
      trashSelectAllRef.current.indeterminate = someTrashPageSelected
    }
  }, [someTrashPageSelected])

  useEffect(() => {
    setTrashPage(1)
  }, [
    trashDateRange,
    trashGroup,
    trashPageSize,
    trashSearchInput,
    trashSection,
    trashSource
  ])

  useEffect(() => {
    setTrashPage((current) => Math.min(current, trashPageCount))
  }, [trashPageCount])

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
    if (!tabClosePrompt) return
    const close = (): void => setTabClosePrompt(null)
    const closeOnPointer = (event: PointerEvent): void => {
      if (
        event.target instanceof Element &&
        event.target.closest('.tab-close-popover')
      ) {
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
  }, [tabClosePrompt])

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
    if (!searchExpanded) return
    const closeOnOutsidePointer = (event: PointerEvent): void => {
      if (
        !search &&
        event.target instanceof Node &&
        !searchContainerRef.current?.contains(event.target)
      ) {
        setSearchExpanded(false)
      }
    }
    document.addEventListener('pointerdown', closeOnOutsidePointer)
    return () => document.removeEventListener('pointerdown', closeOnOutsidePointer)
  }, [search, searchExpanded])

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
    setRowEntryEnabled(true)
    const timer = window.setTimeout(() => setRowEntryEnabled(false), 760)
    return () => window.clearTimeout(timer)
  }, [activeTabId, view])

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
  useEffect(() => () => columnDragCleanupRef.current?.(), [])
  useEffect(() => () => groupDragCleanupRef.current?.(), [])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (
        !isAccountCollectionView ||
        accountEditorOpen ||
        batchState?.active ||
        batchStrategyOpen ||
        batchSessionClearConfirm ||
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
    batchSessionClearConfirm,
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
    setGroupDefinitionState({ tabId: activeTabId, groups: nextGroups })
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
    setGroupDefinitionState({
      tabId,
      groups: (await window.autologin.groups.list(tabId)) ?? []
    })
  }

  function switchView(next: LibraryView): void {
    setView(next)
    setDrawer(null)
    setSearch('')
    setSearchExpanded(false)
    setGroupSearch('')
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

  function beginAccountColumnPointerDrag(
    event: React.PointerEvent<HTMLButtonElement>,
    sourceKey: AccountColumnKey
  ): void {
    if (event.button !== 0) return
    columnDragCleanupRef.current?.()
    const source = event.currentTarget
    const pointerId = event.pointerId
    const startX = event.clientX
    const startY = event.clientY
    let active = false
    let latestTarget: {
      key: AccountColumnKey
      position: ColumnDropPosition
    } | null = null
    try {
      source.setPointerCapture(pointerId)
    } catch {
      // Document listeners below still provide pointer dragging without capture.
    }

    const cleanup = (): void => {
      document.removeEventListener('pointermove', onPointerMove)
      document.removeEventListener('pointerup', onPointerUp)
      document.removeEventListener('pointercancel', onPointerCancel)
      window.removeEventListener('blur', onPointerCancel)
      if (source.hasPointerCapture(pointerId)) {
        source.releasePointerCapture(pointerId)
      }
      document.body.classList.remove('is-dragging-account-column')
      if (columnDragCleanupRef.current === cleanup) {
        columnDragCleanupRef.current = null
      }
    }

    const clearDragState = (): void => {
      setDraggedColumnKey(null)
      setColumnDropTarget(null)
    }

    const onPointerMove = (moveEvent: PointerEvent): void => {
      if (moveEvent.pointerId !== pointerId) return
      if (
        !active &&
        Math.hypot(moveEvent.clientX - startX, moveEvent.clientY - startY) < 5
      ) {
        return
      }
      if (!active) {
        active = true
        suppressColumnClickRef.current = true
        setDraggedColumnKey(sourceKey)
        document.body.classList.add('is-dragging-account-column')
      }
      moveEvent.preventDefault()
      const target = (
        document.elementFromPoint(moveEvent.clientX, moveEvent.clientY) as Element | null
      )?.closest<HTMLElement>('[data-column-menu-key]')
      const targetKey = target?.dataset.columnMenuKey as AccountColumnKey | undefined
      if (
        !target ||
        !targetKey ||
        targetKey === sourceKey ||
        !ACCOUNT_COLUMN_KEYS.includes(targetKey)
      ) {
        latestTarget = null
        setColumnDropTarget(null)
        return
      }
      const rect = target.getBoundingClientRect()
      const position: ColumnDropPosition =
        moveEvent.clientY < rect.top + rect.height / 2 ? 'before' : 'after'
      latestTarget = { key: targetKey, position }
      setColumnDropTarget({ key: targetKey, position })
    }

    const onPointerUp = (upEvent: PointerEvent): void => {
      if (upEvent.pointerId !== pointerId) return
      upEvent.preventDefault()
      cleanup()
      const target = latestTarget
      clearDragState()
      if (active && target) {
        moveAccountColumn(sourceKey, target.key, target.position)
      }
      if (active) {
        window.setTimeout(() => {
          suppressColumnClickRef.current = false
        }, 0)
      }
    }

    const onPointerCancel = (): void => {
      cleanup()
      clearDragState()
      suppressColumnClickRef.current = false
    }

    columnDragCleanupRef.current = cleanup
    document.addEventListener('pointermove', onPointerMove, { passive: false })
    document.addEventListener('pointerup', onPointerUp)
    document.addEventListener('pointercancel', onPointerCancel)
    window.addEventListener('blur', onPointerCancel)
  }

  function moveAccountColumn(
    source: AccountColumnKey,
    target: AccountColumnKey,
    position: ColumnDropPosition
  ): void {
    if (source === target) return
    setAccountColumnOrder((current) => {
      if (!current.includes(source) || !current.includes(target)) return current
      const next = current.filter((key) => key !== source)
      const targetIndex = next.indexOf(target)
      if (targetIndex < 0) return current
      next.splice(targetIndex + (position === 'after' ? 1 : 0), 0, source)
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
    return tr('站点 URL', 'Site URL', '站點 URL')
  }

  function chooseAllAccounts(): void {
    setView('accounts')
    setGroupFilter(null)
    setSearch('')
    setSearchExpanded(false)
    setSelectedIds(new Set())
  }

  function openAccountsFromBrowser(): void {
    chooseAllAccounts()
    setSearchExpanded(true)
    window.requestAnimationFrame(() => searchRef.current?.focus())
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

  async function selectTab(tab: AccountTab): Promise<void> {
    if (tabBusy) return
    try {
      const status = await window.autologin.tabs.fileStatus(tab.id)
      if (!status.exists) {
        setMissingTabFileTarget(tab)
        return
      }
      if (view === 'bookmarks') {
        setBookmarkTabId(tab.id)
      } else {
        setAccountTabId(tab.id)
      }
    } catch (error) {
      notify(
        'error',
        error instanceof Error
          ? error.message
          : tr('无法检查标签页文件', 'Could not check the tab file.', '無法檢查標籤頁檔案')
      )
    }
  }

  async function deleteMissingTabPage(): Promise<void> {
    const tab = missingTabFileTarget
    if (!tab || tabBusy) return
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
              (entry) => !entry.hidden && entry.id === DEFAULT_ACCOUNT_TAB_ID
            ) ??
            nextTabs.find(
              (entry) => !entry.hidden && entry.source !== 'bookmarks'
            )
          setAccountTabId(nextAccountTab?.id ?? '')
        }
      }
      setMissingTabFileTarget(null)
      await onRefresh()
      notify(
        'success',
        tab.source === 'bookmarks'
          ? tr('已删除失效的书签页面', 'Missing bookmark page removed.', '已刪除失效的書籤頁面')
          : tr('已删除失效的数据库页面', 'Missing database page removed.', '已刪除失效的資料庫頁面')
      )
    } catch (error) {
      notify(
        'error',
        error instanceof Error
          ? error.message
          : tr('删除失效页面失败', 'Could not remove the missing page.', '刪除失效頁面失敗')
      )
    } finally {
      setTabBusy(false)
    }
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

  function openTabClosePrompt(tab: AccountTab, anchor?: DOMRect): void {
    const tabElement = [...document.querySelectorAll<HTMLElement>('.account-tab')]
      .find((element) => element.dataset.tabId === tab.id)
    const target = anchor ?? tabElement?.getBoundingClientRect()
    const width = 272
    const estimatedHeight = 144
    const left = Math.min(
      Math.max(12, (target?.right ?? window.innerWidth - width) - width),
      window.innerWidth - width - 12
    )
    const top = Math.min(
      target ? target.bottom + 6 : 76,
      window.innerHeight - estimatedHeight - 12
    )
    setTabMenu(null)
    setTabClosePrompt({ tab, left, top })
  }

  async function closeTab(
    tab: AccountTab,
    mode: 'close' | 'purge' = 'close'
  ): Promise<void> {
    if (tabBusy) return
    setTabClosePrompt(null)
    setTabBusy(true)
    try {
      if (mode === 'purge') {
        await window.autologin.tabs.purge(tab.id)
      } else {
        await window.autologin.tabs.delete(tab.id)
      }
      const nextTabs =
        mode === 'purge'
          ? tabs.filter((entry) => entry.id !== tab.id)
          : tabs.map((entry) =>
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
      await onRefresh()
      if (mode === 'purge') {
        setDeletedAccounts(await window.autologin.accounts.listDeleted())
      }
      notify(
        'success',
        tab.source === 'bookmarks'
          ? mode === 'purge'
            ? tr('书签已关闭并永久删除', 'Bookmark tab and data deleted.', '書籤已關閉並永久刪除')
            : tr('标签页已关闭', 'Tab closed.', '標籤頁已關閉')
          : mode === 'purge'
            ? tr('数据库已关闭并永久删除', 'Database and file deleted.', '資料庫已關閉並永久刪除')
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
      persistCollapsedGroupPaths(next)
      return next
    })
  }

  function persistCollapsedGroupPaths(paths: Set<string>): void {
    window.localStorage.setItem(
      'autologin.account.groups.collapsedPaths',
      JSON.stringify([...paths])
    )
  }

  function setAllGroupsExpanded(expanded: boolean): void {
    setCollapsedGroupPaths((current) => {
      const next = new Set(expanded ? [] : current)
      if (!expanded) {
        for (const path of groupsWithChildren) next.add(path)
      }
      persistCollapsedGroupPaths(next)
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
      persistCollapsedGroupPaths(next)
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

  function showGroupCreate(parent: GroupSummary | null): void {
    if (parent && groupLevel(parent.actualName ?? parent.key) >= GROUP_MAX_DEPTH) return
    setGroupMenu(null)
    setGroupCreateState({ parent })
    setGroupCreateName('')
    setGroupCreateError('')
  }

  function openGroupCreate(
    event: React.MouseEvent<HTMLButtonElement>,
    parent: GroupSummary | null
  ): void {
    event.preventDefault()
    event.stopPropagation()
    showGroupCreate(parent)
  }

  function openGroupCreateFromMenu(group: GroupSummary): void {
    showGroupCreate(group)
  }

  function closeGroupCreate(): void {
    if (groupCreateBusy) return
    setGroupCreateState(null)
    setGroupCreateError('')
  }

  function selectGroupParent(parent: GroupSummary | null): void {
    setGroupCreateState((current) => (current ? { ...current, parent } : current))
    if (groupCreateError) setGroupCreateError('')
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
    const pageIds = pagedDeletedAccounts.map((account) => account.id)
    setTrashSelection((current) => {
      const next = new Set(current)
      const removePage = pageIds.length > 0 && pageIds.every((id) => next.has(id))
      for (const id of pageIds) {
        if (removePage) next.delete(id)
        else next.add(id)
      }
      return next
    })
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

  function groupDragPath(group: GroupSummary): string | null {
    return group.actualName ?? (group.key === UNGROUPED_KEY ? UNGROUPED_KEY : null)
  }

  function groupSiblingPaths(parentPath: string | null): string[] {
    return groups
      .filter((group) => (group.parentPath ?? null) === parentPath)
      .map(groupDragPath)
      .filter((path): path is string => Boolean(path))
  }

  function reorderSiblingPaths(
    draggedPath: string,
    targetPath: string,
    position: 'before' | 'after',
    parentPath: string | null
  ): string[] | null {
    const siblings = groupSiblingPaths(parentPath)
    const nextSiblings = siblings.filter((path) => path !== draggedPath)
    const targetIndex = nextSiblings.indexOf(targetPath)
    if (targetIndex < 0) return null
    nextSiblings.splice(
      targetIndex + (position === 'after' ? 1 : 0),
      0,
      draggedPath
    )
    return nextSiblings
  }

  function groupAtPointer(
    clientX: number,
    clientY: number
  ): { group: GroupSummary; row: HTMLElement } | null {
    const groupList = document.querySelector<HTMLElement>(
      '.account-subnav__group-list'
    )
    if (!groupList) return null
    const listRect = groupList.getBoundingClientRect()
    if (
      clientX < listRect.left - 8 ||
      clientX > listRect.right + 8 ||
      clientY < listRect.top - 8 ||
      clientY > listRect.bottom + 8
    ) {
      return null
    }

    const directRow = (
      document.elementFromPoint(clientX, clientY) as Element | null
    )?.closest<HTMLElement>('.account-subnav__group-row')
    let row =
      directRow && groupList.contains(directRow) ? directRow : null
    if (!row) {
      let nearestDistance = Number.POSITIVE_INFINITY
      for (const candidate of groupList.querySelectorAll<HTMLElement>(
        ':scope > .account-subnav__group-row'
      )) {
        const rect = candidate.getBoundingClientRect()
        const distance =
          clientY < rect.top
            ? rect.top - clientY
            : clientY > rect.bottom
              ? clientY - rect.bottom
              : 0
        if (distance < nearestDistance) {
          nearestDistance = distance
          row = candidate
        }
      }
    }

    const path = row?.dataset.groupPath
    if (!row || !path) return null
    const group = groups.find((candidate) => groupDragPath(candidate) === path)
    return group ? { group, row } : null
  }

  function beginGroupPointerDrag(
    event: React.PointerEvent<HTMLDivElement>,
    group: GroupSummary
  ): void {
    if (event.button !== 0) return
    if (
      event.target instanceof Element &&
      event.target.closest('.account-subnav__add-group')
    ) {
      return
    }
    const dragPath = groupDragPath(group)
    if (!dragPath) return

    groupDragCleanupRef.current?.()
    const sourceRow = event.currentTarget
    const pointerId = event.pointerId
    const startX = event.clientX
    const startY = event.clientY
    let active = false
    let latestTarget: {
      group: GroupSummary
      position: GroupDropPosition
    } | null = null
    let latestTargetSignature: string | null = null
    const cleanup = (): void => {
      document.removeEventListener('pointermove', onPointerMove)
      document.removeEventListener('pointerup', onPointerUp)
      document.removeEventListener('pointercancel', onPointerCancel)
      window.removeEventListener('blur', onPointerCancel)
      if (sourceRow.hasPointerCapture(pointerId)) {
        sourceRow.releasePointerCapture(pointerId)
      }
      document.body.classList.remove('is-dragging-group')
      if (groupDragCleanupRef.current === cleanup) {
        groupDragCleanupRef.current = null
      }
    }

    const clearDragState = (): void => {
      draggedGroupPathRef.current = null
      setDraggedGroupPath(null)
      setGroupDropTarget(null)
    }

    const onPointerMove = (moveEvent: PointerEvent): void => {
      if (moveEvent.pointerId !== pointerId) return
      if (
        !active &&
        Math.hypot(moveEvent.clientX - startX, moveEvent.clientY - startY) < 6
      ) {
        return
      }
      if (!active) {
        active = true
        suppressGroupClickRef.current = true
        draggedGroupPathRef.current = dragPath
        setDraggedGroupPath(dragPath)
        document.body.classList.add('is-dragging-group')
        try {
          sourceRow.setPointerCapture(pointerId)
        } catch {
          // Document listeners still handle the drag when capture is unavailable.
        }
      }
      moveEvent.preventDefault()
      const hit = groupAtPointer(moveEvent.clientX, moveEvent.clientY)
      if (!hit) {
        if (latestTarget) {
          latestTarget = null
          latestTargetSignature = null
          setGroupDropTarget(null)
        }
        return
      }
      const rect = hit.row.getBoundingClientRect()
      const offset = (moveEvent.clientY - rect.top) / Math.max(1, rect.height)
      const requested: GroupDropPosition =
        offset < 0.3 ? 'before' : offset > 0.7 ? 'after' : 'inside'
      const position = resolveGroupDropPosition(dragPath, hit.group, requested)
      const targetPath = groupDragPath(hit.group)
      if (!position || !targetPath) {
        if (latestTarget) {
          latestTarget = null
          latestTargetSignature = null
          setGroupDropTarget(null)
        }
        return
      }
      const targetSignature = `${targetPath}\u0000${position}`
      if (targetSignature === latestTargetSignature) return
      latestTargetSignature = targetSignature
      latestTarget = { group: hit.group, position }
      setGroupDropTarget({ path: targetPath, position })
    }

    const onPointerUp = (upEvent: PointerEvent): void => {
      if (upEvent.pointerId !== pointerId) return
      if (!active) {
        cleanup()
        clearDragState()
        return
      }
      upEvent.preventDefault()
      cleanup()
      clearDragState()
      const target = latestTarget
      if (target) void moveGroupToTarget(dragPath, target.group, target.position)
      window.setTimeout(() => {
        suppressGroupClickRef.current = false
      }, 0)
    }

    const onPointerCancel = (): void => {
      cleanup()
      clearDragState()
      suppressGroupClickRef.current = false
    }

    groupDragCleanupRef.current = cleanup
    document.addEventListener('pointermove', onPointerMove, { passive: false })
    document.addEventListener('pointerup', onPointerUp)
    document.addEventListener('pointercancel', onPointerCancel)
    window.addEventListener('blur', onPointerCancel)
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
    let resolvedPosition = position
    if (draggedIsUngrouped || targetIsUngrouped) {
      if (draggedIsUngrouped && target.parentPath !== null) return null
      if (targetIsUngrouped && groupParentPath(draggedPath) !== null) return null
      if (resolvedPosition === 'inside') resolvedPosition = 'after'
    }
    if (targetPath.startsWith(`${draggedPath}${GROUP_PATH_SEPARATOR}`)) return null

    if (resolvedPosition === 'inside') {
      if (groupParentPath(draggedPath) === targetPath) return null
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
    if (targetParent === groupParentPath(draggedPath)) {
      const siblings = groupSiblingPaths(targetParent)
      const nextSiblings = reorderSiblingPaths(
        draggedPath,
        targetPath,
        resolvedPosition,
        targetParent
      )
      if (
        nextSiblings &&
        nextSiblings.join('\u0000') === siblings.join('\u0000')
      ) {
        return null
      }
    }
    return resolvedPosition
  }

  async function moveGroupToTarget(
    draggedPath: string,
    target: GroupSummary,
    position: GroupDropPosition
  ): Promise<void> {
    const targetPath = groupDragPath(target)
    if (!targetPath) return
    const destinationParent =
      position === 'inside'
        ? target.actualName ?? null
        : target.actualName
          ? groupParentPath(target.actualName)
          : null
    const currentParent = groupParentPath(draggedPath)

    if (destinationParent === currentParent) {
      const siblings = groupSiblingPaths(destinationParent)
      const nextSiblings = reorderSiblingPaths(
        draggedPath,
        targetPath,
        position === 'after' ? 'after' : 'before',
        destinationParent
      )
      if (!nextSiblings || nextSiblings.join('\u0000') === siblings.join('\u0000')) {
        return
      }
      const nextOrder = groups
        .map(groupDragPath)
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

  function openGroupMenu(
    event: React.MouseEvent<HTMLButtonElement>,
    group: GroupSummary
  ): void {
    event.preventDefault()
    event.stopPropagation()
    setGroupMenu({
      group,
      left: Math.max(8, Math.min(event.clientX, window.innerWidth - 196)),
      top: Math.max(8, Math.min(event.clientY, window.innerHeight - 198))
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
      top: Math.max(8, Math.min(rect.top, window.innerHeight - 198))
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
    const browsers = new Set(selectedAccounts.map((account) => account.loginBrowser))
    const sharedBrowser =
      browsers.size === 1 ? selectedAccounts[0]?.loginBrowser ?? 'standalone' : 'standalone'
    const firstAccount = selectedAccounts[0]
    const candidateSteps = firstAccount?.manualSteps?.length
      ? structuredClone(firstAccount.manualSteps)
      : manualSelectorsToSteps(firstAccount?.manualSelectors)
    const candidateSignature = batchManualStepsSignature(candidateSteps)
    const sharedSteps = selectedAccounts.every((account) => {
      const steps = account.manualSteps?.length
        ? account.manualSteps
        : manualSelectorsToSteps(account.manualSelectors)
      return batchManualStepsSignature(steps) === candidateSignature
    })
      ? candidateSteps
      : []
    setBatchStrategy(sharedStrategy)
    setBatchBrowser(sharedBrowser)
    setBatchSteps(sharedSteps)
    setBatchStepTests({})
    setBatchStepTesting(null)
    setBatchIcon(null)
    setBatchIconFetchProgress(null)
    setBatchStrategyError('')
    setBatchStrategyOpen(true)
  }

  function closeBatchStrategy(): void {
    if (
      batchStrategyBusy ||
      batchSessionClearBusy ||
      batchIconBusy ||
      batchIconFetchBusy
    ) {
      return
    }
    setBatchStrategyOpen(false)
    setBatchSteps([])
    setBatchStepTests({})
    setBatchStepTesting(null)
    setBatchIcon(null)
    setBatchIconFetchProgress(null)
    setBatchIconFetchCancelBusy(false)
  }

  async function testBatchManualStep(step: RecipeStep): Promise<void> {
    const account = selectedAccounts[0]
    const selector = manualStepSelector(step).trim()
    if (!account || !selector) {
      notify(
        'info',
        selector
          ? tr('请先选择账号', 'Select an account first.', '請先選擇帳號')
          : tr('请先填写定位器', 'Enter a selector first.', '請先填寫定位器')
      )
      return
    }
    setBatchStepTesting(step.id)
    try {
      const result = await window.autologin.login.testSelector({
        accountId: account.id,
        field: selectorTestFieldForAction(step.type),
        selector,
        url: account.site.startUrl
      })
      setBatchStepTests((current) => ({ ...current, [step.id]: result }))
      notify(result.found ? 'success' : 'error', result.message)
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : tr('定位器测试失败', 'Element test failed.', '定位器測試失敗')
      setBatchStepTests((current) => ({
        ...current,
        [step.id]: { found: false, visible: false, count: 0, message }
      }))
      notify('error', message)
    } finally {
      setBatchStepTesting(null)
    }
  }

  async function applyBatchStrategy(): Promise<void> {
    if (batchSessionClearBusy || batchIconFetchBusy) return
    const normalizedSteps = normalizeManualSteps(batchSteps)
    const stepsProvided = normalizedSteps.length > 0
    if (
      batchStrategy === 'manual' &&
      stepsProvided &&
      !manualStepsAreComplete(normalizedSteps)
    ) {
      setBatchStrategyError(
        tr(
          '手动配置至少需要包含“输入用户名”和“输入密码”步骤，且每个步骤都要填写 Selector',
          'Manual configuration needs username and password steps with selectors.',
          '手動設定至少需要包含「輸入使用者名稱」和「輸入密碼」步驟，且每個步驟都要填寫 Selector'
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
        loginBrowser: batchBrowser,
        ...(batchStrategy === 'manual' && stepsProvided
          ? { manualSteps: normalizedSteps }
          : {})
      })
      await onRefresh()
      setBatchStrategyOpen(false)
      setBatchSteps([])
      setBatchStepTests({})
      setBatchStepTesting(null)
      setSelectedIds(new Set())
      notify(
        'success',
        tr(
          `已更新 ${selectedAccountCount} 个账号的登录配置和登录方式`,
          `Updated login configuration and method for ${selectedAccountCount} accounts.`,
          `已更新 ${selectedAccountCount} 個帳號的登入設定和登入方式`
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
    if (batchSessionClearBusy || batchIconFetchBusy) return
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
      batchSessionClearBusy ||
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
      batchSessionClearBusy ||
      batchIconBusy ||
      batchIconFetchBusy
    ) {
      return
    }
    setBatchIconFetchBusy(true)
    setBatchStrategyError('')
    setBatchIconFetchProgress({
      totalAccounts: selectedIds.size,
      completedAccounts: 0,
      updatedSiteCount: 0,
      failedSiteCount: 0
    })
    const unsubscribeProgress =
      window.autologin.events.onAccountBatchIconFetchProgress(
        setBatchIconFetchProgress
      )
    try {
      const result = await window.autologin.accounts.fetchIconsBatch([
        ...selectedIds
      ])
      if (result.updatedAccounts > 0) await onRefresh()
      if (result.canceled) {
        notify(
          'info',
          result.updatedAccounts > 0
            ? tr(
                `已中断获取网站图标，已更新 ${result.updatedAccounts} 个账号`,
                `Icon download stopped after updating ${result.updatedAccounts} accounts.`,
                `已中斷取得網站圖示，已更新 ${result.updatedAccounts} 個帳號`
              )
            : tr(
                '已中断获取网站图标',
                'Site icon download stopped.',
                '已中斷取得網站圖示'
              )
        )
        return
      }
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
      unsubscribeProgress()
      setBatchIconFetchBusy(false)
      setBatchIconFetchProgress(null)
      setBatchIconFetchCancelBusy(false)
    }
  }

  async function cancelBatchIconFetch(): Promise<void> {
    if (!batchIconFetchBusy || batchIconFetchCancelBusy) return
    setBatchIconFetchCancelBusy(true)
    try {
      const canceled = await window.autologin.accounts.cancelIconFetchBatch()
      if (!canceled) setBatchIconFetchCancelBusy(false)
    } catch (error) {
      setBatchIconFetchCancelBusy(false)
      notify(
        'error',
        error instanceof Error
          ? error.message
          : tr(
              '中断获取网站图标失败',
              'Could not stop the site icon download.',
              '中斷取得網站圖示失敗'
            )
      )
    }
  }

  async function duplicateSelectedAccounts(): Promise<void> {
    if (selectedIds.size === 0 || batchSessionClearBusy) return
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

  async function clearSelectedAccountSessions(): Promise<void> {
    if (selectedIds.size === 0) return
    const ids = [...selectedIds]
    setBatchSessionClearBusy(true)
    try {
      const results = await Promise.allSettled(
        ids.map((accountId) =>
          withSessionClearTimeout(window.autologin.login.clearSession(accountId))
        )
      )
      const cleared = results.filter((result) => result.status === 'fulfilled').length
      const failed = results.length - cleared
      if (failed === 0) {
        notify(
          'success',
          tr(
            `已清除 ${cleared} 个账号的网站会话`,
            `Cleared website sessions for ${cleared} account${cleared === 1 ? '' : 's'}.`,
            `已清除 ${cleared} 個帳號的網站工作階段`
          )
        )
      } else {
        const firstFailure = results.find(
          (result): result is PromiseRejectedResult => result.status === 'rejected'
        )
        const reason =
          firstFailure?.reason instanceof Error
            ? firstFailure.reason.message
            : String(firstFailure?.reason ?? '')
        notify(
          'error',
          tr(
            `已清除 ${cleared} 个账号，${failed} 个账号清除失败${
              reason ? `：${reason}` : ''
            }`,
            `Cleared ${cleared}; ${failed} account${failed === 1 ? '' : 's'} failed.${
              reason ? ` ${reason}` : ''
            }`,
            `已清除 ${cleared} 個帳號，${failed} 個帳號清除失敗${
              reason ? `：${reason}` : ''
            }`
          )
        )
      }
    } finally {
      setBatchSessionClearConfirm(false)
      setBatchSessionClearBusy(false)
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
    const usesBuiltinBrowser = selectedAccounts.some(
      (account) => account.loginBrowser === 'builtin'
    )
    const opened = await onStartBatch([...selectedIds])
    if (opened) {
      setSelectedIds(new Set())
      selectionAnchorRef.current = null
      if (usesBuiltinBrowser) setView('browser')
    }
  }

  async function openSelectedBookmarks(): Promise<void> {
    if (view !== 'bookmarks' || selectedIds.size === 0 || bookmarkBatchOpenBusy) {
      return
    }
    const ids = [...selectedIds]
    setBookmarkBatchOpenBusy(true)
    try {
      const results = await Promise.allSettled(
        ids.map((accountId) => window.autologin.bookmarks.visit(accountId))
      )
      const failedIds: string[] = []
      results.forEach((result, index) => {
        const accountId = ids[index]
        if (result.status === 'rejected' || result.value.status !== 'success') {
          if (accountId) failedIds.push(accountId)
        }
      })
      const openedCount = ids.length - failedIds.length
      const failedCount = failedIds.length
      if (openedCount > 0) {
        notify(
          failedCount === 0 ? 'success' : 'info',
          failedCount === 0
            ? tr(
                `已打开 ${openedCount} 个书签`,
                `Opened ${openedCount} bookmark${openedCount === 1 ? '' : 's'}.`,
                `已開啟 ${openedCount} 個書籤`
              )
            : tr(
                `已打开 ${openedCount} 个书签，${failedCount} 个失败`,
                `Opened ${openedCount} bookmark${openedCount === 1 ? '' : 's'}; ${failedCount} failed.`,
                `已開啟 ${openedCount} 個書籤，${failedCount} 個失敗`
              )
        )
      } else {
        notify(
          'error',
          tr(
            `打开 ${failedCount} 个书签失败`,
            `Could not open ${failedCount} bookmark${failedCount === 1 ? '' : 's'}.`,
            `開啟 ${failedCount} 個書籤失敗`
          )
        )
      }
      if (failedCount === 0) {
        setSelectedIds(new Set())
        selectionAnchorRef.current = null
      } else {
        setSelectedIds(new Set(failedIds))
        selectionAnchorRef.current = failedIds.at(-1) ?? null
      }
    } finally {
      setBookmarkBatchOpenBusy(false)
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
    if (opened) {
      setDrawer(null)
      if (account.loginBrowser === 'builtin') setView('browser')
    }
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

  function renderGroupDropSlot(
    targetPath: string,
    position: 'before' | 'after'
  ): React.JSX.Element {
    return (
      <div
        className="account-subnav__drop-slot"
        data-group-drop-path={targetPath}
        data-group-drop-position={position}
        aria-hidden="true"
      >
        <span>{tr('松开放到此处', 'Drop here', '鬆開放至此處')}</span>
      </div>
    )
  }

  return (
    <div
      className={`app-shell${sidebarCollapsed ? ' is-sidebar-collapsed' : ''}${
        accountEditorOpen ? ' is-account-editor' : ''
      }`}
    >
      <aside className={`sidebar${sidebarCollapsed ? ' is-collapsed' : ''}`}>
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
              className={`sidebar-nav__item${view === 'browser' ? ' is-active' : ''}`}
              onClick={() => switchView('browser')}
              aria-label={tr('浏览器', 'Browser', '瀏覽器')}
              title={tr('浏览器', 'Browser', '瀏覽器')}
            >
              <Globe2 size={17} />
              <span>{tr('浏览器', 'Browser', '瀏覽器')}</span>
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
              <span>{tr('锁定', 'Lock', '鎖定')}</span>
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
              <span>{tr('设置', 'Settings', '設定')}</span>
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
            onClick={() => openTabClosePrompt(tabMenu.tab)}
          >
            <X size={14} />
            {tabMenu.tab.source === 'bookmarks'
              ? tr('关闭标签页', 'Close tab', '關閉標籤頁')
              : tr('关闭数据库', 'Close database', '關閉資料庫')}
          </button>
        </div>
      )}

      {tabClosePrompt && (
        <div
          className="tab-close-popover"
          role="menu"
          aria-label={tr(
            '关闭数据库选项',
            'Close database options',
            '關閉資料庫選項'
          )}
          style={{ left: tabClosePrompt.left, top: tabClosePrompt.top }}
        >
          <button
            type="button"
            role="menuitem"
            onClick={() => void closeTab(tabClosePrompt.tab, 'close')}
            disabled={tabBusy}
          >
            <X size={14} />
            {tabClosePrompt.tab.source === 'bookmarks'
              ? tr('关闭书签', 'Close bookmark tab', '關閉書籤')
              : tr('关闭数据库', 'Close database', '關閉資料庫')}
          </button>
          <button
            type="button"
            role="menuitem"
            className="is-danger"
            onClick={() => void closeTab(tabClosePrompt.tab, 'purge')}
            disabled={tabBusy}
          >
            <Trash2 size={14} />
            {tabClosePrompt.tab.source === 'bookmarks'
              ? tr(
                  '关闭并且删除书签',
                  'Close and delete bookmark tab',
                  '關閉並刪除書籤'
                )
              : tr(
                  '关闭并且删除数据库',
                  'Close and delete database',
                  '關閉並刪除資料庫'
                )}
          </button>
          <div className="account-context-menu__divider" aria-hidden="true" />
          <button
            type="button"
            role="menuitem"
            onClick={() => setTabClosePrompt(null)}
            disabled={tabBusy}
          >
            {tr('取消', 'Cancel', '取消')}
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
          {groupLevel(groupMenu.group.actualName ?? groupMenu.group.key) <
            GROUP_MAX_DEPTH && (
            <button
              type="button"
              role="menuitem"
              onClick={() =>
                  openGroupCreateFromMenu(groupMenu.group)
                }
            >
              <Plus size={14} />
              {tr('新增子分组', 'Add subgroup', '新增子分組')}
            </button>
          )}
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
        <Modal
          title={tr('新建分组', 'New group', '新增分組')}
          onClose={closeGroupCreate}
          width="400px"
          className="group-create-modal"
        >
          <form
            className="group-create-form"
            onSubmit={(event) => void submitNewGroup(event)}
          >
            <div className="field">
              <span className="field__label" id="group-parent-label">
                {tr('父级分组', 'Parent group', '父群組')}
              </span>
              <GroupParentPicker
                groups={namedGroups}
                value={groupCreateState.parent}
                onChange={selectGroupParent}
                tr={tr}
                language={language}
              />
            </div>
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
            <div className="group-create-form__actions">
              <button
                type="button"
                className="button button--ghost button--small"
                onClick={closeGroupCreate}
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
        </Modal>
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

      {batchStrategyOpen && (
        <Modal
          title={tr('批量操作', 'Batch actions', '批次操作')}
          eyebrow="BATCH ACTIONS"
          onClose={closeBatchStrategy}
          width="720px"
          className="batch-strategy-modal batch-strategy-drawer"
          placement="right"
        >
          <form
            className="batch-strategy-form"
            onSubmit={(event) => {
              event.preventDefault()
              void applyBatchStrategy()
            }}
          >
            <div className="batch-strategy-form__body">
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
                    disabled={batchSessionClearBusy || batchIconBusy || batchIconFetchBusy}
                  >
                    <ImagePlus size={14} />
                    {tr('选择图片', 'Choose image', '選擇圖片')}
                  </button>
                  <button
                    type="button"
                    className="button button--ghost button--small"
                    onClick={() => void fetchBatchSiteIcons()}
                    disabled={batchSessionClearBusy || batchIconBusy || batchIconFetchBusy}
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
                    disabled={
                      !batchIcon ||
                      batchSessionClearBusy ||
                      batchIconBusy ||
                      batchIconFetchBusy
                    }
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
                {batchIconFetchBusy && batchIconFetchProgress && (
                  <div className="batch-icon-fetch-progress">
                    <div className="batch-icon-fetch-progress__content">
                      <div className="batch-icon-fetch-progress__meta">
                        <span>
                          {tr(
                            '正在获取网站图标',
                            'Downloading site icons',
                            '正在取得網站圖示'
                          )}
                        </span>
                        <strong>
                          {batchIconFetchProgress.completedAccounts} /{' '}
                          {batchIconFetchProgress.totalAccounts}
                        </strong>
                      </div>
                      <div
                        className="batch-icon-fetch-progress__track"
                        role="progressbar"
                        aria-label={tr(
                          '网站图标获取进度',
                          'Site icon download progress',
                          '網站圖示取得進度'
                        )}
                        aria-valuemin={0}
                        aria-valuemax={Math.max(
                          1,
                          batchIconFetchProgress.totalAccounts
                        )}
                        aria-valuenow={batchIconFetchProgress.completedAccounts}
                        aria-valuetext={tr(
                          `已处理 ${batchIconFetchProgress.completedAccounts} / ${batchIconFetchProgress.totalAccounts} 个账号`,
                          `${batchIconFetchProgress.completedAccounts} of ${batchIconFetchProgress.totalAccounts} accounts processed`,
                          `已處理 ${batchIconFetchProgress.completedAccounts} / ${batchIconFetchProgress.totalAccounts} 個帳號`
                        )}
                      >
                        <span
                          style={{
                            width: `${
                              batchIconFetchProgress.totalAccounts > 0
                                ? Math.min(
                                    100,
                                    (batchIconFetchProgress.completedAccounts /
                                      batchIconFetchProgress.totalAccounts) *
                                      100
                                  )
                                : 0
                            }%`
                          }}
                        />
                      </div>
                    </div>
                    <button
                      type="button"
                      className="batch-icon-fetch-progress__cancel"
                      onClick={() => void cancelBatchIconFetch()}
                      disabled={batchIconFetchCancelBusy}
                    >
                      {batchIconFetchCancelBusy ? (
                        <LoaderCircle size={13} className="spin" />
                      ) : (
                        <X size={13} />
                      )}
                      {batchIconFetchCancelBusy
                        ? tr('正在中断…', 'Stopping…', '正在中斷…')
                        : tr('中断获取', 'Stop', '中斷取得')}
                    </button>
                  </div>
                )}
              </div>
              <div className={`batch-icon-editor__preview${batchIcon ? ' has-image' : ''}`}>
                {batchIcon ? (
                  <img src={batchIcon} alt="" />
                ) : (
                  <ImagePlus size={22} aria-hidden="true" />
                )}
              </div>
            </section>
            <section className="batch-session-action">
              <div>
                <span className="field__label">
                  {tr('网站会话', 'Website sessions', '網站工作階段')}
                </span>
                <strong>{tr('清除所选账号的网站会话', 'Clear selected sessions', '清除所選帳號的網站工作階段')}</strong>
                <small>
                  {tr(
                    '下次登录这些账号时需要重新验证；账号密码和历史记录不会受到影响。',
                    'These accounts must sign in again next time. Credentials and history are not affected.',
                    '下次登入這些帳號時需要重新驗證；帳號密碼和歷史記錄不會受到影響。'
                  )}
                </small>
              </div>
              <button
                type="button"
                className="button button--ghost"
                onClick={() => setBatchSessionClearConfirm(true)}
                disabled={batchSessionClearBusy || batchStrategyBusy}
              >
                {batchSessionClearBusy ? (
                  <LoaderCircle size={15} className="spin" />
                ) : (
                  <RefreshCw size={15} />
                )}
                {batchSessionClearBusy
                  ? tr('正在清除…', 'Clearing…', '正在清除…')
                  : tr('清除会话', 'Clear sessions', '清除工作階段')}
              </button>
            </section>
            <span className="field__label">
              {tr('登录配置', 'Login configuration', '登入設定')}
            </span>
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
                      '按顺序配置输入、点击和验证码步骤',
                      'Order input, click and challenge steps explicitly',
                      '按順序設定輸入、點擊和驗證碼步驟'
                    )}
                  </small>
                </span>
              </label>
            </div>

            <span className="field__label">
              {tr('登录方式', 'Login method', '登入方式')}
            </span>
            <div className="proxy-mode-options account-strategy-options">
              <label
                className={`proxy-mode-option${batchBrowser === 'builtin' ? ' is-active' : ''}`}
              >
                <input
                  type="radio"
                  name="batch-login-browser"
                  value="builtin"
                  checked={batchBrowser === 'builtin'}
                  onChange={() => {
                    setBatchBrowser('builtin')
                    setBatchStrategyError('')
                  }}
                />
                <span>
                  <strong>{tr('内置浏览器', 'Built-in browser', '內建瀏覽器')}</strong>
                  <small>
                    {tr(
                      '在 AutoLogin 内按账号打开多个标签页',
                      'Open multiple account tabs inside AutoLogin',
                      '在 AutoLogin 內依帳號開啟多個分頁'
                    )}
                  </small>
                </span>
              </label>
              <label
                className={`proxy-mode-option${batchBrowser === 'standalone' ? ' is-active' : ''}`}
              >
                <input
                  type="radio"
                  name="batch-login-browser"
                  value="standalone"
                  checked={batchBrowser === 'standalone'}
                  onChange={() => {
                    setBatchBrowser('standalone')
                    setBatchStrategyError('')
                  }}
                />
                <span>
                  <strong>{tr('独立浏览器', 'Independent browser', '獨立瀏覽器')}</strong>
                  <small>
                    {tr(
                      '在系统默认浏览器中打开独立会话',
                      'Open isolated sessions in the system default browser',
                      '在系統預設瀏覽器中開啟獨立工作階段'
                    )}
                  </small>
                </span>
              </label>
            </div>

            {batchStrategy === 'manual' && (
              <section
                className="drawer-recipes manual-selector-panel batch-manual-selector"
                aria-label={tr('批量手动配置', 'Batch manual configuration', '批次手動設定')}
              >
                <header className="drawer-recipes__header">
                  <div>
                    <strong>{tr('元素定位器', 'Element selectors', '元素定位器')}</strong>
                    <small>
                      {tr(
                        '这些步骤会应用到所有所选账号；留空则保留各账号现有配置',
                        'These steps apply to every selected account. Leave empty to keep existing setup.',
                        '這些步驟會套用到所有所選帳號；留空則保留各帳號現有設定'
                      )}
                    </small>
                  </div>
                </header>
                <ManualStepEditor
                  steps={batchSteps}
                  onChange={(nextSteps, invalidatedStepId) => {
                    setBatchSteps(nextSteps)
                    if (!invalidatedStepId) return
                    setBatchStepTests((current) => {
                      if (!current[invalidatedStepId]) return current
                      const next = { ...current }
                      delete next[invalidatedStepId]
                      return next
                    })
                  }}
                  selectorTests={batchStepTests}
                  selectorTesting={batchStepTesting}
                  onTest={(step) => void testBatchManualStep(step)}
                  disabled={
                    batchSessionClearBusy ||
                    batchStrategyBusy || batchIconBusy || batchIconFetchBusy
                  }
                  emptyText={tr(
                    '留空会保留各账号现有手动配置；需要统一配置时，点击下方“添加步骤”。',
                    'Leave empty to keep each account’s manual setup, or add steps to apply one shared flow.',
                    '留空會保留各帳號現有手動設定；需要統一設定時，點擊下方「新增步驟」。'
                  )}
                  footerText={tr(
                    '按从上到下的顺序执行，可拖拽调整',
                    'Steps run top to bottom and can be reordered',
                    '步驟由上到下執行，可拖曳調整'
                  )}
                />
              </section>
            )}

            {batchStrategyError && <p className="form-error">{batchStrategyError}</p>}
            </div>
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
                disabled={
                  batchSessionClearBusy ||
                  batchStrategyBusy ||
                  batchIconBusy ||
                  batchIconFetchBusy
                }
              >
                {tr('取消', 'Cancel', '取消')}
              </button>
              <button
                type="submit"
                className="button button--primary"
                disabled={
                  batchSessionClearBusy ||
                  batchStrategyBusy ||
                  batchIconBusy ||
                  batchIconFetchBusy
                }
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

      {batchSessionClearConfirm && (
        <ConfirmDialog
          title={tr(
            '清除所选账号的网站会话？',
            'Clear selected website sessions?',
            '清除所選帳號的網站工作階段？'
          )}
          description={tr(
            `将清除 ${selectedAccountCount} 个账号的独立网站会话，下次登录需要重新验证。账号密码和历史记录不会受到影响。`,
            `Website sessions for ${selectedAccountCount} account${selectedAccountCount === 1 ? '' : 's'} will be cleared and require sign-in again. Credentials and history are not affected.`,
            `將清除 ${selectedAccountCount} 個帳號的獨立網站工作階段，下次登入需要重新驗證。帳號密碼和歷史記錄不會受到影響。`
          )}
          confirmLabel={tr('清除会话', 'Clear sessions', '清除工作階段')}
          busy={batchSessionClearBusy}
          closeWhileBusy
          onConfirm={() => void clearSelectedAccountSessions()}
          onClose={() => setBatchSessionClearConfirm(false)}
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

      {missingTabFileTarget && (
        <ConfirmDialog
          title={
            missingTabFileTarget.source === 'bookmarks'
              ? tr('这个书签已被删除', 'This bookmark was deleted', '這個書籤已被刪除')
              : tr('这个数据库已被删除', 'This database was deleted', '這個資料庫已被刪除')
          }
          description={
            missingTabFileTarget.source === 'bookmarks'
              ? tr(
                  '磁盘上的书签文件已不存在。是否删除该页面？',
                  'The bookmark file no longer exists on disk. Remove this page?',
                  '磁碟上的書籤檔案已不存在。是否刪除該頁面？'
                )
              : tr(
                  '磁盘上的数据库文件已不存在。是否删除该页面？',
                  'The database file no longer exists on disk. Remove this page?',
                  '磁碟上的資料庫檔案已不存在。是否刪除該頁面？'
                )
          }
          confirmLabel={tr('删除页面', 'Remove page', '刪除頁面')}
          danger
          busy={tabBusy}
          onConfirm={() => void deleteMissingTabPage()}
          onClose={() => {
            if (!tabBusy) setMissingTabFileTarget(null)
          }}
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
            onRecord={drawerAccount ? () => onRecord(drawerAccount) : undefined}
            onChanged={refreshAll}
            loginState={loginState}
            recordingFinishRequest={recordingFinishRequest}
            onRecordingFinishHandled={onRecordingFinishHandled}
            notify={notify}
          />
        ) : (
        <div
          className={`library-content-scroll${
            isAccountCollectionView ? ' library-content-scroll--accounts' : ''
          }${isLogView ? ' library-content-scroll--logs' : ''}${
            view === 'settings' ? ' library-content-scroll--settings' : ''
          }${
            view === 'passwordGenerator'
              ? ' library-content-scroll--password-generator'
              : ''
          }${view === 'trash' ? ' library-content-scroll--trash' : ''
          }${view === 'browser' ? ' library-content-scroll--browser' : ''
          }`}
        >
          {isAccountCollectionView && (
            <div className="account-workspace">
            {!showDatabaseEmptyState && (
              <AccountTabs
                tabs={visibleTabs}
                activeTabId={activeTabId}
                bookmarkMode={view === 'bookmarks'}
                busy={tabBusy}
                onSelect={(tab) => void selectTab(tab)}
                onOpenMenu={openTabMenu}
                onClose={(tab, anchor) => openTabClosePrompt(tab, anchor)}
                controls={
                  <>
                    <div
                      ref={searchContainerRef}
                      className={`account-tabs__search search-field search-field--expandable${
                        searchExpanded ? ' is-expanded' : ''
                      }`}
                    >
                      <button
                        type="button"
                        className="search-field__toggle"
                        onClick={() => {
                          if (searchExpanded && !search) {
                            setSearchExpanded(false)
                            searchRef.current?.blur()
                            return
                          }
                          setSearchExpanded(true)
                          window.requestAnimationFrame(() => searchRef.current?.focus())
                        }}
                        aria-label={
                          searchExpanded
                            ? tr('收起搜索', 'Collapse search', '收合搜尋')
                            : tr('展开搜索', 'Expand search', '展開搜尋')
                        }
                        aria-expanded={searchExpanded}
                      >
                        <Search size={16} />
                      </button>
                      <input
                        ref={searchRef}
                        value={search}
                        onChange={(event) => setSearch(event.target.value)}
                        onFocus={() => setSearchExpanded(true)}
                        data-app-search
                        data-app-search-priority={20}
                        aria-keyshortcuts="Control+F"
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
                        tabIndex={searchExpanded ? 0 : -1}
                        onKeyDown={(event) => {
                          if (event.key !== 'Escape') return
                          if (search) {
                            setSearch('')
                          } else {
                            setSearchExpanded(false)
                            event.currentTarget.blur()
                          }
                        }}
                      />
                      <kbd aria-hidden="true">Ctrl F</kbd>
                    </div>
                    <button
                      type="button"
                      className="account-tabs__add account-tabs__add--labelled"
                      onClick={() => setDrawer({ mode: 'create' })}
                      aria-label={
                        view === 'bookmarks'
                          ? tr('添加书签', 'Add bookmark', '新增書籤')
                          : tr('添加账号', 'Add account', '新增帳號')
                      }
                    >
                      <Plus size={15} />
                      <span>
                        {view === 'bookmarks'
                          ? tr('添加书签', 'Add bookmark', '新增書籤')
                          : tr('添加账号', 'Add account', '新增帳號')}
                      </span>
                    </button>
                    {view === 'accounts' && (
                      <AccountTransferControls
                        tabId={activeTabId}
                        onCreateTab={() => createTab('local')}
                        creatingTab={tabBusy}
                        onImported={(result) =>
                          void handleDataImported(result.tabId)
                        }
                        notify={notify}
                      />
                    )}
                    {view === 'bookmarks' && (
                      <BookmarkTransferControls
                        tabId={activeTabId}
                        creating={tabBusy}
                        onCreate={() => createTab('bookmarks')}
                        onImported={(result) =>
                          void handleDataImported(result.tabId)
                        }
                        notify={notify}
                      />
                    )}
                  </>
                }
              />
            )}
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
                  <div className="account-subnav__search-bar" role="search">
                    <Search size={13} aria-hidden="true" />
                    <input
                      id="account-group-search"
                      value={groupSearch}
                      onChange={(event) => setGroupSearch(event.target.value)}
                      data-app-search
                      data-app-search-priority={10}
                      aria-keyshortcuts="Control+F"
                      onKeyDown={(event) => {
                        if (event.key !== 'Escape') return
                        setGroupSearch('')
                        event.currentTarget.blur()
                      }}
                      placeholder={tr('筛选分组', 'Filter groups', '篩選分組')}
                      aria-label={tr('筛选分组', 'Filter groups', '篩選分組')}
                    />
                  </div>
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
                          ? tr(
                              '全部书签（展开或收起分组）',
                              'All bookmarks (expand or collapse groups)',
                              '全部書籤（展開或收合分組）'
                            )
                          : tr(
                              '全部账号（展开或收起分组）',
                              'All accounts (expand or collapse groups)',
                              '全部帳號（展開或收合分組）'
                            )
                      }
                    >
                      <KeyRound size={15} />
                      <span>
                        {view === 'bookmarks'
                          ? tr('全部书签', 'All bookmarks', '全部書籤')
                          : tr('全部账号', 'All accounts', '全部帳號')}
                      </span>
                      <small>{accounts.length}</small>
                      <span className="account-subnav__tree-chevron" aria-hidden="true">
                        {accountGroupTreeExpanded ? (
                          <ChevronDown size={14} />
                        ) : (
                          <ChevronRight size={14} />
                        )}
                      </span>
                    </button>
                  </div>
                  <div className="account-subnav__view-divider" aria-hidden="true" />
                  <div
                    className={`account-subnav__groups-accordion${
                      accountGroupTreeExpanded ? ' is-expanded' : ''
                    }`}
                    aria-hidden={!accountGroupTreeExpanded}
                  >
                    <div className="account-subnav__groups-inner">
                      <div className="account-subnav__groups-heading">
                        <span className="account-subnav__groups-heading-label">
                          <span>{tr('分组', 'Groups', '分組')}</span>
                          <small>{visibleTreeGroups.length}</small>
                        </span>
                        <div
                          className="account-subnav__groups-heading-actions"
                          role="toolbar"
                          aria-label={tr('分组展开控制', 'Group expansion controls', '分組展開控制')}
                        >
                          <button
                            type="button"
                            onClick={() => setAllGroupsExpanded(true)}
                            disabled={groupsWithChildren.size === 0}
                            aria-label={tr(
                              '全部展开分组',
                              'Expand all groups',
                              '全部展開分組'
                            )}
                            title={tr(
                              '全部展开分组',
                              'Expand all groups',
                              '全部展開分組'
                            )}
                          >
                            <ChevronsDown size={14} />
                          </button>
                          <button
                            type="button"
                            onClick={() => setAllGroupsExpanded(false)}
                            disabled={groupsWithChildren.size === 0}
                            aria-label={tr(
                              '全部收缩分组',
                              'Collapse all groups',
                              '全部收合分組'
                            )}
                            title={tr(
                              '全部收缩分组',
                              'Collapse all groups',
                              '全部收合分組'
                            )}
                          >
                            <ChevronsUp size={14} />
                          </button>
                        </div>
                      </div>
                      <section className="account-subnav__groups">
                        <div className="account-subnav__group-list">
                          {visibleTreeGroups.map((group) => {
                            const isUngrouped = !group.actualName
                            const groupPath = group.actualName ?? group.key
                            const dropPosition =
                              groupDropTarget?.path === groupPath
                                ? groupDropTarget.position
                                : null
                            const hasChildren = groupsWithChildren.has(
                              group.actualName ?? ''
                            )
                            const isCollapsed = collapsedGroupPaths.has(
                              group.actualName ?? ''
                            )
                            return (
                              <Fragment key={group.key}>
                                {dropPosition === 'before' &&
                                  renderGroupDropSlot(groupPath, 'before')}
                                <div
                                  className={`account-subnav__group-row${
                                    isUngrouped
                                      ? ' account-subnav__group-row--ungrouped'
                                      : ''
                                  }${
                                    hasChildren
                                      ? ' account-subnav__group-row--parent'
                                      : ''
                                  }${
                                    group.level > 1
                                      ? ' account-subnav__group-row--child'
                                      : ''
                                  }${
                                    dropPosition === 'inside'
                                      ? ' is-drop-inside'
                                      : ''
                                  }${
                                    draggedGroupPath === groupPath
                                      ? ' is-dragging'
                                      : ''
                                  }`}
                                  data-group-path={groupPath}
                                  data-group-level={group.level}
                                  onPointerDown={(event) =>
                                    beginGroupPointerDrag(event, group)
                                  }
                                  style={
                                    isUngrouped
                                      ? undefined
                                      : ({
                                          '--group-depth': Math.max(
                                            0,
                                            group.level - 1
                                          )
                                        } as React.CSSProperties)
                                  }
                                >
                                  <button
                                    type="button"
                                    className={`account-subnav__item account-subnav__item--group account-subnav__item--text-only${
                                      groupFilter === group.key ? ' is-active' : ''
                                    }`}
                                    onClick={() => {
                                      if (suppressGroupClickRef.current) return
                                      if (isUngrouped) {
                                        chooseGroup(group)
                                      } else {
                                        chooseGroupFromTree(group, hasChildren)
                                      }
                                    }}
                                    onContextMenu={
                                      isUngrouped
                                        ? undefined
                                        : (event) => openGroupMenu(event, group)
                                    }
                                    onKeyDown={
                                      isUngrouped
                                        ? undefined
                                        : (event) =>
                                            openGroupMenuFromKeyboard(event, group)
                                    }
                                    aria-haspopup={isUngrouped ? undefined : 'menu'}
                                    aria-expanded={
                                      hasChildren ? !isCollapsed : undefined
                                    }
                                    aria-level={group.level}
                                    aria-label={
                                      isUngrouped
                                        ? tr(
                                            '未分组，无子分组',
                                            'Ungrouped, no subgroups',
                                            '未分組，無子分組'
                                          )
                                        : hasChildren
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
                                    <span className="account-subnav__group-label">
                                      <span
                                        className="account-subnav__group-dot"
                                        style={{
                                          backgroundColor: isUngrouped
                                            ? '#b7b7b1'
                                            : groupDotColor(groupPath)
                                        }}
                                        aria-hidden="true"
                                      />
                                      <span className="account-subnav__group-name">
                                        {group.name}
                                      </span>
                                    </span>
                                    <small>{group.count}</small>
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
                                </div>
                                {dropPosition === 'after' &&
                                  renderGroupDropSlot(groupPath, 'after')}
                              </Fragment>
                            )
                          })}
                        </div>
                      </section>
                    </div>
                  </div>
                  <button
                    type="button"
                    className="account-subnav__new-group"
                    onClick={(event) => openGroupCreate(event, null)}
                  >
                    <Plus size={14} />
                    <span>{tr('新建分组', 'New group', '新增分組')}</span>
                  </button>
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
                  <span className="library-header__summary">
                    {view === 'bookmarks'
                      ? tr(
                          `${filteredAccounts.length} 个书签 · ${recordedAccountCount} 个已配置流程`,
                          `${filteredAccounts.length} bookmarks · ${recordedAccountCount} with saved flows`,
                          `${filteredAccounts.length} 個書籤 · ${recordedAccountCount} 個已設定流程`
                        )
                      : tr(
                          `${filteredAccounts.length} 个账号 · ${recordedAccountCount} 个已录制流程`,
                          `${filteredAccounts.length} accounts · ${recordedAccountCount} with recorded flows`,
                          `${filteredAccounts.length} 個帳號 · ${recordedAccountCount} 個已錄製流程`
                        )}
                  </span>
                </div>
                <div className="library-header__actions">
                  <button
                    type="button"
                    className="library-header__refresh"
                    onClick={() => void refreshAccounts()}
                    disabled={manualRefreshing}
                    aria-label={tr('刷新', 'Refresh', '重新整理')}
                    title={tr('刷新', 'Refresh', '重新整理')}
                    aria-busy={manualRefreshing}
                  >
                    {manualRefreshing ? (
                      <LoadingSpinner size={15} />
                    ) : (
                      <RefreshCw size={15} />
                    )}
                  </button>
                </div>
              </header>

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
                }${rowEntryEnabled ? ' is-row-entry-enabled' : ''}${
                  filteredAccounts.length === 0 ? ' is-empty' : ''
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
                              aria-checked={accountColumnSizing === 'window'}
                              className={
                                accountColumnSizing === 'window'
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
                            {accountColumnSizing === 'manual' && (
                              <button
                                type="button"
                                role="menuitemradio"
                                aria-checked="true"
                                className="is-checked"
                              >
                                <span className="account-column-menu__icon">
                                  <SlidersHorizontal size={14} />
                                </span>
                                <span>
                                  {tr('自定义列宽', 'Custom widths', '自訂欄寬')}
                                </span>
                              </button>
                            )}
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
                                  className={[
                                    checked ? 'is-checked' : '',
                                    draggedColumnKey === key ? 'is-dragging' : '',
                                    columnDropTarget?.key === key
                                      ? `is-drop-${columnDropTarget.position}`
                                      : ''
                                  ]
                                    .filter(Boolean)
                                    .join(' ')}
                                  key={key}
                                  data-column-menu-key={key}
                                  onClick={() => {
                                    if (suppressColumnClickRef.current) return
                                    toggleAccountColumn(key)
                                  }}
                                  onPointerDown={(event) =>
                                    beginAccountColumnPointerDrag(event, key)
                                  }
                                  title={tr(
                                    '拖动调整列顺序',
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
                      onMore={(event) => openAccountMenu(event, account)}
                      onLogin={() => void openAccount(account)}
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
                    <EmptyState
                      bookmark={view === 'bookmarks'}
                      eyebrow={
                        view === 'bookmarks'
                          ? tr(
                              'NO MATCHING BOOKMARKS',
                              'NO MATCHING BOOKMARKS',
                              'NO MATCHING BOOKMARKS'
                            )
                          : tr(
                              'NO MATCHING ACCOUNTS',
                              'NO MATCHING ACCOUNTS',
                              'NO MATCHING ACCOUNTS'
                            )
                      }
                      title={
                        view === 'bookmarks'
                          ? tr('没有匹配的书签', 'No matching bookmarks', '沒有符合的書籤')
                          : tr('没有匹配的账号', 'No matching accounts', '沒有符合的帳號')
                      }
                      description={tr(
                        '尝试更换关键词或切换左侧分组。',
                        'Try another search or group.',
                        '嘗試更換關鍵字或切換左側分組。'
                      )}
                      action={
                        <button
                          type="button"
                          className="button button--primary"
                          onClick={() => {
                            setSearch('')
                            setSearchExpanded(false)
                            setGroupFilter(null)
                            setAccountPage(1)
                          }}
                        >
                          <RotateCcw size={16} />
                          {view === 'bookmarks'
                            ? tr('查看全部书签', 'View all bookmarks', '查看全部書籤')
                            : tr('查看全部账号', 'View all accounts', '查看全部帳號')}
                        </button>
                      }
                    />
                  )}
              </section>
              </div>
              <footer className="account-pagination">
                  <span aria-live="polite">
                    {tr(
                      view === 'bookmarks'
                        ? selectedAccountCount > 0
                          ? '已选择 {selected} 个书签，共 {count} 个书签，第 {page}/{pages} 页'
                          : '共 {count} 个书签，第 {page}/{pages} 页'
                        : selectedAccountCount > 0
                          ? '已选择 {selected} 个账号，共 {count} 个账号，第 {page}/{pages} 页'
                          : '共 {count} 个账号，第 {page}/{pages} 页',
                      view === 'bookmarks'
                        ? selectedAccountCount > 0
                          ? '{selected} bookmarks selected, {count} total, page {page} of {pages}'
                          : '{count} bookmarks, page {page} of {pages}'
                        : selectedAccountCount > 0
                          ? '{selected} accounts selected, {count} total, page {page} of {pages}'
                          : '{count} accounts, page {page} of {pages}',
                      view === 'bookmarks'
                        ? selectedAccountCount > 0
                          ? '已選取 {selected} 個書籤，共 {count} 個書籤，第 {page}/{pages} 頁'
                          : '共 {count} 個書籤，第 {page}/{pages} 頁'
                        : selectedAccountCount > 0
                          ? '已選取 {selected} 個帳號，共 {count} 個帳號，第 {page}/{pages} 頁'
                          : '共 {count} 個帳號，第 {page}/{pages} 頁',
                      {
                        selected: selectedAccountCount,
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
              </div>
            </div>
            )}
            </div>
          )}

          {view === 'passwordGenerator' && (
            <section className="page-section password-generator-page">
              <PasswordGenerator notify={notify} />
            </section>
          )}

          {view === 'browser' && (
            <BrowserWorkspace
              notify={notify}
              onOpenAccounts={openAccountsFromBrowser}
            />
          )}

          {view === 'loginLogs' && (
            <LoginLogsPage
              sites={allSites}
              notify={notify}
              onNavigate={chooseLogView}
            />
          )}

          {view === 'appLogs' && (
            <AppLogsPage notify={notify} onNavigate={chooseLogView} />
          )}

          {view === 'trash' && (
            <section className="page-section trash-page">
              <CollectionPageHeader
                title={tr('回收站', 'Recycle Bin', '回收站')}
                actions={
                  <>
                    <button
                      type="button"
                      className="button button--ghost button--small"
                      onClick={() => void refreshAccounts()}
                      disabled={manualRefreshing}
                    >
                      <RefreshCw
                        size={14}
                        className={manualRefreshing ? 'spin' : undefined}
                      />
                      {tr('刷新', 'Refresh', '重新整理')}
                    </button>
                    <PageActionMenu
                      open={trashRetentionOpen}
                      onOpenChange={setTrashRetentionOpen}
                      label={tr('更多回收站操作', 'More Recycle Bin actions', '更多回收站操作')}
                      busy={trashRetentionSaving}
                    >
                      <span className="page-action-menu__label">
                        {tr('保留天数', 'Keep for', '保留天數')}
                      </span>
                      {TRASH_RETENTION_OPTIONS.map((days) => {
                        const selected = settings.trashRetentionDays === days
                        return (
                          <button
                            key={days}
                            type="button"
                            role="menuitemradio"
                            aria-checked={selected}
                            className={selected ? 'is-selected' : ''}
                            disabled={trashRetentionSaving}
                            onClick={() => {
                              setTrashRetentionOpen(false)
                              void updateTrashRetention(days)
                            }}
                          >
                            <span>{tr(`${days} 天`, `${days} days`, `${days} 天`)}</span>
                            {selected ? <Check size={13} /> : null}
                          </button>
                        )
                      })}
                    </PageActionMenu>
                  </>
                }
                tabs={
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
                        clearTrashSearch()
                        setTrashDateRange(emptyLogDateRange())
                        setTrashGroup('all')
                        setTrashSource('all')
                      }}
                    >
                      <UserRound size={14} />
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
                        clearTrashSearch()
                        setTrashDateRange(emptyLogDateRange())
                        setTrashGroup('all')
                        setTrashSource('all')
                      }}
                    >
                      <Bookmark size={14} />
                      {tr('书签', 'Bookmarks', '書籤')}
                    </button>
                  </nav>
                }
                filters={
                  <div className="collection-filter-bar">
                    <CollectionSearchField
                      searchRef={trashSearchRef}
                      value={trashSearchInput}
                      onChange={setTrashSearchInput}
                      onClear={clearTrashSearch}
                      placeholder={
                        trashSection === 'bookmarks'
                          ? tr('搜索已删除的书签', 'Search deleted bookmarks', '搜尋已刪除的書籤')
                          : tr('搜索已删除的账号', 'Search deleted accounts', '搜尋已刪除的帳號')
                      }
                      ariaLabel={tr('搜索回收站', 'Search Recycle Bin', '搜尋回收站')}
                    />
                    <LogDateFilter
                      value={trashDateRange}
                      onChange={setTrashDateRange}
                    />
                    <CollectionFilterSelect
                      value={trashGroup}
                      onChange={setTrashGroup}
                      ariaLabel={tr('分组', 'Group', '分組')}
                      searchable
                      searchPlaceholder={tr('搜索分组', 'Search groups', '搜尋分組')}
                      options={[
                        {
                          value: 'all',
                          label: tr('全部分组', 'All groups', '全部分組')
                        },
                        ...trashGroupOptions.map((value) => ({
                          value,
                          label:
                            value === '__ungrouped__'
                              ? tr('未分组', 'Ungrouped', '未分組')
                              : value
                        }))
                      ]}
                    />
                    <CollectionFilterSelect
                      value={trashSource}
                      onChange={setTrashSource}
                      ariaLabel={tr('来源', 'Source', '來源')}
                      options={[
                        {
                          value: 'all',
                          label: tr('全部来源', 'All sources', '全部來源')
                        },
                        ...trashSourceOptions.map((value) => ({
                          value,
                          label: value
                        }))
                      ]}
                    />
                    <button
                      type="button"
                      className="collection-filter-reset"
                      onClick={() => {
                        clearTrashSearch()
                        setTrashDateRange(emptyLogDateRange())
                        setTrashGroup('all')
                        setTrashSource('all')
                      }}
                    >
                      <RotateCcw size={14} />
                      {tr('重置', 'Reset', '重設')}
                    </button>
                  </div>
                }
              />

              {trashSelection.size > 0 && (
                <div
                  className="selection-dock selection-dock--page"
                  role="toolbar"
                  aria-label={tr('回收站批量操作', 'Recycle Bin batch actions', '回收站批次操作')}
                >
                  <span className="selection-dock__count">
                    {tr(
                      `已选 ${trashSelection.size} 项`,
                      `${trashSelection.size} selected`,
                      `已選 ${trashSelection.size} 項`
                    )}
                  </span>
                  <button
                    type="button"
                    className="selection-dock__primary"
                    onClick={() => void restoreSelectedAccounts()}
                    disabled={trashActionBusy}
                  >
                    {trashActionBusy ? (
                      <LoaderCircle size={15} className="spin" />
                    ) : (
                      <Undo2 size={15} />
                    )}
                    {tr('批量恢复', 'Restore selected', '批次恢復')}
                  </button>
                  <button
                    type="button"
                    className="selection-dock__danger"
                    onClick={() => setPurgeTargets([...trashSelection])}
                    disabled={trashActionBusy}
                  >
                    <Trash2 size={15} />
                    {tr('批量删除', 'Delete selected', '批次刪除')}
                  </button>
                  <button
                    type="button"
                    className="selection-dock__cancel"
                    onClick={() => setTrashSelection(new Set())}
                    disabled={trashActionBusy}
                  >
                    {tr('取消', 'Cancel', '取消')}
                  </button>
                </div>
              )}

              <div className="trash-content">
                {visibleDeletedAccounts.length === 0 ? (
                  <CompactEmptyState
                    className="trash-empty-state"
                    icon={<Trash2 size={30} strokeWidth={1.7} />}
                    title={
                      trashSection === 'bookmarks'
                        ? tr('没有已删除的书签', 'No deleted bookmarks', '沒有已刪除的書籤')
                        : tr('没有已删除的账号', 'No deleted accounts', '沒有已刪除的帳號')
                    }
                    description={tr(
                      `在${trashSection === 'bookmarks' ? '书签库' : '账号库'}中选中${
                        trashSection === 'bookmarks' ? '书签' : '账号'
                      }后按 Delete，会先移到这里并保留 ${settings.trashRetentionDays} 天，期间可随时恢复。`,
                      `Select ${trashSection === 'bookmarks' ? 'bookmarks' : 'accounts'} in the ${
                        trashSection === 'bookmarks' ? 'bookmark library' : 'account library'
                      } and press Delete. They stay here for ${settings.trashRetentionDays} days and can be restored.`,
                      `在${trashSection === 'bookmarks' ? '書籤庫' : '帳號庫'}中選取${
                        trashSection === 'bookmarks' ? '書籤' : '帳號'
                      }後按 Delete，會先移到這裡並保留 ${settings.trashRetentionDays} 天，期間可隨時恢復。`
                    )}
                    actions={
                      <>
                        <button
                          type="button"
                          className="button button--soft button--small"
                          onClick={() =>
                            switchView(trashSection === 'bookmarks' ? 'bookmarks' : 'accounts')
                          }
                        >
                          <ArchiveRestore size={15} />
                          {trashSection === 'bookmarks'
                            ? tr('返回书签库', 'Back to bookmarks', '返回書籤庫')
                            : tr('返回账号库', 'Back to accounts', '返回帳號庫')}
                        </button>
                        <button
                          type="button"
                          className="button button--ghost button--small"
                          onClick={() => setTrashRetentionOpen(true)}
                        >
                          <Settings size={15} />
                          {tr('调整保留天数', 'Change retention', '調整保留天數')}
                        </button>
                      </>
                    }
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
                        checked={allTrashPageSelected}
                        disabled={pagedDeletedAccounts.length === 0}
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
                    {pagedDeletedAccounts.map((account) => (
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
              </div>
              <footer className="account-pagination trash-pagination">
                <span aria-live="polite">
                  {tr(
                    trashSection === 'bookmarks'
                      ? trashSelection.size > 0
                        ? '已选择 {selected} 个书签 · 共 {count} 个书签 · 第 {page}/{pages} 页'
                        : '共 {count} 个书签 · 第 {page}/{pages} 页'
                      : trashSelection.size > 0
                        ? '已选择 {selected} 个账号 · 共 {count} 个账号 · 第 {page}/{pages} 页'
                        : '共 {count} 个账号 · 第 {page}/{pages} 页',
                    trashSection === 'bookmarks'
                      ? trashSelection.size > 0
                        ? '{selected} bookmarks selected · {count} total · page {page} of {pages}'
                        : '{count} bookmarks · page {page} of {pages}'
                      : trashSelection.size > 0
                        ? '{selected} accounts selected · {count} total · page {page} of {pages}'
                        : '{count} accounts · page {page} of {pages}',
                    trashSection === 'bookmarks'
                      ? trashSelection.size > 0
                        ? '已選取 {selected} 個書籤 · 共 {count} 個書籤 · 第 {page}/{pages} 頁'
                        : '共 {count} 個書籤 · 第 {page}/{pages} 頁'
                      : trashSelection.size > 0
                        ? '已選取 {selected} 個帳號 · 共 {count} 個帳號 · 第 {page}/{pages} 頁'
                        : '共 {count} 個帳號 · 第 {page}/{pages} 頁',
                    {
                      selected: trashSelection.size,
                      count: visibleDeletedAccounts.length,
                      page: currentTrashPage,
                      pages: trashPageCount
                    }
                  )}
                </span>
                <div className="account-pagination__controls">
                  <PageSizePicker
                    ariaLabel={tr(
                      '回收站每页条数',
                      'Recycle Bin items per page',
                      '回收站每頁筆數'
                    )}
                    value={trashPageSize}
                    options={ACCOUNT_PAGE_SIZES}
                    onChange={(nextPageSize) =>
                      setTrashPageSize(nextPageSize as AccountPageSize)
                    }
                  />
                  <div className="account-pagination__nav">
                    <button
                      type="button"
                      className="icon-button icon-button--small"
                      onClick={() => setTrashPage((page) => Math.max(1, page - 1))}
                      disabled={currentTrashPage <= 1}
                      aria-label={tr('上一页', 'Previous page', '上一頁')}
                    >
                      <ChevronLeft size={16} />
                    </button>
                    <button
                      type="button"
                      className="icon-button icon-button--small"
                      onClick={() =>
                        setTrashPage((page) => Math.min(trashPageCount, page + 1))
                      }
                      disabled={currentTrashPage >= trashPageCount}
                      aria-label={tr('下一页', 'Next page', '下一頁')}
                    >
                      <ChevronRight size={16} />
                    </button>
                  </div>
                </div>
              </footer>
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
      {isAccountCollectionView &&
        !showDatabaseEmptyState &&
        !accountEditorOpen &&
        !batchState?.active &&
        selectedAccountCount > 0 && (
          <div className="selection-dock" role="toolbar" aria-label={tr('批量操作', 'Batch actions', '批次操作')}>
            <span className="selection-dock__count">
              {tr(
                `已选 ${selectedAccountCount} 项`,
                `${selectedAccountCount} selected`,
                `已選 ${selectedAccountCount} 項`
              )}
            </span>
            {view === 'accounts' ? (
              <>
                <button
                  type="button"
                  className="selection-dock__primary"
                  onClick={() => void openSelected()}
                  disabled={Boolean(batchState?.active)}
                >
                  <Layers3 size={15} />
                  {tr('批量登录', 'Batch sign in', '批次登入')}
                </button>
                <button
                  type="button"
                  onClick={openBatchStrategy}
                  disabled={Boolean(batchState?.active)}
                >
                  <SlidersHorizontal size={15} />
                  {tr('批量操作', 'Batch actions', '批次操作')}
                </button>
                <button
                  type="button"
                  onClick={() => setBatchSessionClearConfirm(true)}
                  disabled={Boolean(batchState?.active) || batchSessionClearBusy}
                >
                  {batchSessionClearBusy ? (
                    <LoaderCircle size={15} className="spin" />
                  ) : (
                    <RefreshCw size={15} />
                  )}
                  {tr('清除会话', 'Clear sessions', '清除工作階段')}
                </button>
              </>
            ) : (
              <button
                type="button"
                className="selection-dock__primary"
                onClick={() => void openSelectedBookmarks()}
                disabled={bookmarkBatchOpenBusy}
              >
                {bookmarkBatchOpenBusy ? (
                  <LoaderCircle size={15} className="spin" />
                ) : (
                  <Globe2 size={15} />
                )}
                {tr('批量打开', 'Open selected', '批次開啟')}
              </button>
            )}
            <button
              type="button"
              onClick={() => setDeleteSelectedOpen(true)}
              disabled={Boolean(batchState?.active) || bookmarkBatchOpenBusy}
            >
              <Trash2 size={15} />
              {tr('移入回收站', 'Move to Recycle Bin', '移至回收站')}
            </button>
            <button
              type="button"
              className="selection-dock__cancel"
              onClick={() => {
                setSelectedIds(new Set())
                selectionAnchorRef.current = null
              }}
            >
              {tr('取消', 'Cancel', '取消')}
            </button>
          </div>
        )}
    </div>
  )
}

function GroupParentPicker({
  groups,
  value,
  onChange,
  tr,
  language
}: {
  groups: GroupSummary[]
  value: GroupSummary | null
  onChange: (group: GroupSummary | null) => void
  tr: Translate
  language: AppSettings['language']
}): React.JSX.Element {
  const listboxId = useId()
  const triggerRef = useRef<HTMLButtonElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)
  const availableParents = useMemo(
    () =>
      groups
        .filter(
          (group) =>
            group.actualName &&
            groupLevel(group.actualName ?? group.key) < GROUP_MAX_DEPTH
        )
        .sort((left, right) =>
          (left.actualName ?? '').localeCompare(right.actualName ?? '', language, {
            sensitivity: 'accent'
          })
        ),
    [groups, language]
  )
  const options = useMemo<(GroupSummary | null)[]>(
    () => [null, ...availableParents],
    [availableParents]
  )
  const filteredOptions = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase(language)
    if (!normalizedQuery) return options
    return options.filter((option) =>
      (option?.actualName ?? tr('无（一级分组）', 'None (top-level group)', '無（第一層分組）'))
        .toLocaleLowerCase(language)
        .includes(normalizedQuery)
    )
  }, [language, options, query, tr])
  const selectedPath = value?.actualName ?? ''
  const selectedLabel =
    value?.actualName ??
    tr('无（一级分组）', 'None (top-level group)', '無（第一層分組）')

  useEffect(() => {
    if (!open) return
    const focusFrame = window.requestAnimationFrame(() => searchRef.current?.focus())
    const closeOnOutsidePointer = (event: PointerEvent): void => {
      if (
        event.target instanceof Node &&
        !triggerRef.current?.parentElement?.contains(event.target)
      ) {
        setOpen(false)
        setQuery('')
      }
    }
    document.addEventListener('pointerdown', closeOnOutsidePointer)
    return () => {
      window.cancelAnimationFrame(focusFrame)
      document.removeEventListener('pointerdown', closeOnOutsidePointer)
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    setActiveIndex((current) =>
      filteredOptions.length === 0 ? 0 : Math.min(current, filteredOptions.length - 1)
    )
  }, [filteredOptions.length, open])

  useEffect(() => {
    if (!open || filteredOptions.length === 0) return
    listRef.current
      ?.querySelector<HTMLElement>(`[data-parent-option-index="${activeIndex}"]`)
      ?.scrollIntoView({ block: 'nearest' })
  }, [activeIndex, filteredOptions.length, open])

  function openMenu(): void {
    const selectedIndex = options.findIndex(
      (option) => (option?.actualName ?? '') === selectedPath
    )
    setQuery('')
    setActiveIndex(selectedIndex >= 0 ? selectedIndex : 0)
    setOpen(true)
  }

  function closeMenu(restoreFocus = true): void {
    setOpen(false)
    setQuery('')
    if (restoreFocus) {
      window.requestAnimationFrame(() => triggerRef.current?.focus())
    }
  }

  function chooseParent(option: GroupSummary | null): void {
    onChange(option)
    closeMenu()
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLDivElement>): void {
    if (!open) return
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      closeMenu()
      return
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      if (filteredOptions.length === 0) return
      const direction = event.key === 'ArrowDown' ? 1 : -1
      setActiveIndex(
        (current) =>
          (current + direction + filteredOptions.length) % filteredOptions.length
      )
      return
    }
    if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault()
      if (filteredOptions.length === 0) return
      setActiveIndex(event.key === 'Home' ? 0 : filteredOptions.length - 1)
      return
    }
    if (event.key === 'Enter' && filteredOptions.length > 0) {
      event.preventDefault()
      chooseParent(filteredOptions[activeIndex] ?? null)
    }
  }

  return (
    <div
      className={`group-parent-picker${open ? ' is-open' : ''}`}
      onKeyDown={handleKeyDown}
    >
      <button
        ref={triggerRef}
        type="button"
        className="group-parent-picker__trigger"
        onClick={() => (open ? closeMenu(false) : openMenu())}
        onKeyDown={(event) => {
          if (!open && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
            event.preventDefault()
            openMenu()
          }
        }}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listboxId : undefined}
        aria-labelledby="group-parent-label"
      >
        <span>{selectedLabel}</span>
        <ChevronDown size={14} aria-hidden="true" />
      </button>
      {open && (
        <div className="group-parent-picker__menu">
          <label className="group-parent-picker__search">
            <Search size={13} aria-hidden="true" />
            <input
              ref={searchRef}
              value={query}
              data-app-search
              data-app-search-priority={40}
              aria-keyshortcuts="Control+F"
              onChange={(event) => {
                setQuery(event.target.value)
                setActiveIndex(0)
              }}
              placeholder={tr('搜索父级分组', 'Search parent groups', '搜尋父群組')}
              aria-label={tr('搜索父级分组', 'Search parent groups', '搜尋父群組')}
              autoComplete="off"
            />
          </label>
          <div
            ref={listRef}
            id={listboxId}
            className="group-parent-picker__options"
            role="listbox"
            aria-labelledby="group-parent-label"
            aria-activedescendant={
              filteredOptions.length > 0
                ? `${listboxId}-option-${activeIndex}`
                : undefined
            }
            tabIndex={-1}
          >
            {filteredOptions.map((option, index) => {
              const optionPath = option?.actualName ?? ''
              const isSelected = optionPath === selectedPath
              return (
                <button
                  type="button"
                  role="option"
                  id={`${listboxId}-option-${index}`}
                  data-parent-option-index={index}
                  className={`group-parent-picker__option${
                    index === activeIndex ? ' is-active' : ''
                  }${isSelected ? ' is-selected' : ''}`}
                  key={option?.key ?? '__top-level__'}
                  aria-selected={isSelected}
                  tabIndex={-1}
                  onPointerEnter={() => setActiveIndex(index)}
                  onClick={() => chooseParent(option)}
                >
                  <span>
                    {option?.actualName ??
                      tr(
                        '无（一级分组）',
                        'None (top-level group)',
                        '無（第一層分組）'
                      )}
                  </span>
                  {isSelected && <Check size={13} aria-hidden="true" />}
                </button>
              )
            })}
            {filteredOptions.length === 0 && (
              <p className="group-parent-picker__empty">
                {tr('没有匹配的分组', 'No matching groups', '沒有相符的群組')}
              </p>
            )}
          </div>
        </div>
      )}
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
  onMore,
  onLogin
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
  onMore: (event: React.MouseEvent<HTMLButtonElement>) => void
  onLogin: () => void
}): React.JSX.Element {
  const actionLabel = bookmark
    ? tr('访问', 'Visit', '造訪')
    : tr('登录', 'Sign in', '登入')
  const rowClickHandledRef = useRef(false)

  return (
    <article
      className={`account-row${checked ? ' is-selected' : ''}`}
      style={{ '--row-index': Math.min(index, 8) } as React.CSSProperties}
      title={tr(
        '双击编辑，右键查看更多操作',
        'Double-click to edit, right-click for more actions',
        '雙擊編輯，右鍵查看更多操作'
      )}
      onDoubleClick={(event) => {
        if (event.target instanceof Element && event.target.closest('button, input, label')) {
          return
        }
        if (rowClickHandledRef.current) {
          rowClickHandledRef.current = false
          onToggleSelection?.(false)
        }
        onEdit()
      }}
      onClick={(event) => {
        if (
          event.target instanceof Element &&
          event.target.closest('button, input, label')
        ) {
          rowClickHandledRef.current = false
          return
        }
        if (event.detail > 1) {
          return
        }
        event.preventDefault()
        rowClickHandledRef.current = true
        onToggleSelection?.(event.shiftKey)
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
        <SiteMark site={account.site} />
        <div>
          <div className="account-name-line">
            <strong>{account.site.name}</strong>
          </div>
          <small className="account-site-domain" title={account.site.startUrl}>
            {siteDomain(account.site.startUrl)}
          </small>
        </div>
      </div>
      <div
        className={`account-username${
          visibleColumns.has('username') ? '' : ' is-column-hidden'
        }`}
        data-column-key="username"
        style={{ order: accountColumnOrderStyle(columnOrder, 'username') }}
      >
        <strong>{account.username}</strong>
      </div>
      <div
        className={`account-group-cell${
          visibleColumns.has('group') ? '' : ' is-column-hidden'
        }`}
        data-column-key="group"
        style={{ order: accountColumnOrderStyle(columnOrder, 'group') }}
      >
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
          className="row-login-button"
          onClick={(event) => {
            event.stopPropagation()
            onLogin()
          }}
          aria-label={actionLabel}
          title={actionLabel}
        >
          {bookmark ? <Globe2 size={14} /> : <LogIn size={14} />}
          <span>{actionLabel}</span>
          <ArrowUpRight size={13} />
        </button>
        <button
          type="button"
          className="row-more-button"
          onClick={(event) => {
            event.stopPropagation()
            onMore(event)
          }}
          aria-label={tr('更多操作', 'More actions', '更多操作')}
          title={tr('更多操作', 'More actions', '更多操作')}
        >
          <MoreHorizontal size={16} />
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
  bookmark = false,
  eyebrow,
  icon
}: {
  title: string
  description: string
  action?: React.ReactNode
  bookmark?: boolean
  eyebrow?: string
  icon?: React.ReactNode
}): React.JSX.Element {
  return (
    <div className="empty-state">
      <div className="empty-state__art" aria-hidden="true">
        <span />
        <span />
        <span>
          {icon ? (
            icon
          ) : bookmark ? (
            <Bookmark size={27} strokeWidth={1.6} />
          ) : (
            <KeyRound size={27} strokeWidth={1.6} />
          )}
        </span>
      </div>
      <span className="eyebrow">
        {eyebrow ?? (bookmark ? 'IMPORT YOUR BOOKMARKS' : 'YOUR FIRST LOGIN')}
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
  description,
  icon,
  actions,
  className = ''
}: {
  title: string
  description: string
  icon?: React.ReactNode
  actions?: React.ReactNode
  className?: string
}): React.JSX.Element {
  return (
    <div className={`empty-state empty-state--compact ${className}`.trim()}>
      {icon ?? <Globe2 size={26} />}
      <h2>{title}</h2>
      <p>{description}</p>
      {actions ? <div className="empty-state__actions">{actions}</div> : null}
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

function trashGroupKey(account: DeletedAccountWithSite): string {
  return account.site.group?.trim() || '__ungrouped__'
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
