export const AUTO_LOCK_OPTIONS = [5, 10, 15, 30] as const
export type AutoLockMinutes = (typeof AUTO_LOCK_OPTIONS)[number]

export const THEME_PRESETS = ['magpie', 'warm', 'sage', 'ocean', 'rose'] as const
export type ThemePreset = (typeof THEME_PRESETS)[number] | 'custom'

export const COLOR_MODES = ['light', 'dark', 'system'] as const
export type ColorMode = (typeof COLOR_MODES)[number]

export const APP_LANGUAGES = ['zh-CN', 'en', 'zh-TW'] as const
export type AppLanguage = (typeof APP_LANGUAGES)[number]

export const INTERFACE_SCALE_MIN = 80
export const INTERFACE_SCALE_MAX = 125
export const INTERFACE_SCALE_STEP = 5
export const FONT_SIZE_SCALE_OPTIONS = [80, 100, 125, 150] as const

export const PROXY_PROTOCOLS = ['http', 'https', 'socks5'] as const
export type ProxyProtocol = (typeof PROXY_PROTOCOLS)[number]

export const PROXY_MODES = ['custom', 'system'] as const
export type ProxyMode = (typeof PROXY_MODES)[number]
export const DEFAULT_PROXY_TEST_URL = 'https://www.google.com/'

export const GROUP_PATH_SEPARATOR = ' / '
export const UNGROUPED_GROUP_KEY = '__autologin:ungrouped__'
export const GROUP_NAME_MAX_LENGTH = 20
export const GROUP_PATH_MAX_LENGTH = 120
export const GROUP_MAX_DEPTH = 3
export const TRASH_RETENTION_OPTIONS = [3, 7, 15, 30] as const
export type TrashRetentionDays = (typeof TRASH_RETENTION_OPTIONS)[number]
export const DEFAULT_TRASH_RETENTION_DAYS: TrashRetentionDays = 7

export const ACCOUNT_TAB_SOURCES = [
  'local',
  'csv',
  'kdbx',
  'bookmarks',
  'autologin'
] as const
export type AccountTabSource = (typeof ACCOUNT_TAB_SOURCES)[number]
export const DEFAULT_ACCOUNT_TAB_ID = 'local'
export const CURRENT_CREDENTIAL_VERSION_ID = 'current'
export const CREDENTIAL_HISTORY_MAX_ENTRIES = 200
export const ACCOUNT_TAB_COLORS = [
  '#5C6BFF',
  '#0E7567',
  '#D97706',
  '#D95757',
  '#7C5CE6',
  '#2F80ED',
  '#7A828D'
] as const

export interface AccountTab {
  id: string
  name: string
  color: string
  source: AccountTabSource
  databaseFileName?: string
  hidden: boolean
  createdAt: string
  updatedAt: string
}

export interface AccountTabCreateInput {
  name?: string
  color?: string
  source?: 'local' | 'bookmarks'
}

export interface AccountTabUpdateInput {
  name?: string
  color?: string
}

export interface ProxySettings {
  mode: ProxyMode
  enabled: boolean
  protocol: ProxyProtocol
  host: string
  port: number
  bypassList: string
  testUrl: string
}

export interface ProxyTestResult {
  ok: boolean
  message: string
  latencyMs?: number
}

export const LOGIN_STRATEGIES = ['auto', 'manual'] as const
export type LoginStrategy = (typeof LOGIN_STRATEGIES)[number]

export const LOGIN_BROWSERS = ['standalone', 'builtin'] as const
export type LoginBrowser = (typeof LOGIN_BROWSERS)[number]

export interface ManualLoginSelectors {
  username?: string
  password?: string
  submit?: string
}

export type SelectorTestField = keyof ManualLoginSelectors

export interface SelectorTestInput {
  accountId: string
  field: SelectorTestField
  selector: string
  url?: string
}

export interface SelectorTestResult {
  found: boolean
  visible: boolean
  count: number
  message: string
}

export interface ThemeColors {
  background: string
  surface: string
  text: string
  accent: string
}

export type LoginStatus =
  | 'idle'
  | 'opening'
  | 'filling'
  | 'awaiting_manual_challenge'
  | 'submitting'
  | 'authenticated'
  | 'needs_action'
  | 'error'

export type LoginMode = 'login' | 'record'

export interface AppSettings {
  autoLockMinutes: AutoLockMinutes
  trashRetentionDays: TrashRetentionDays
  colorMode: ColorMode
  language: AppLanguage
  themePreset: ThemePreset
  customTheme: ThemeColors
  interfaceScale: number
  fontSizeScale: number
  accountCopyShortcutEnabled: boolean
  accountCopyShortcut: string
  proxy: ProxySettings
  recordingDraftDirectory: string
  defaultLoginBrowser: LoginBrowser
  pureBrowserMode: boolean
  groupOrder: string[]
  groupOrders: Record<string, string[]>
}

export type AppSettingsPatch = Partial<AppSettings>

export interface LoginLogEntry {
  id: string
  timestamp: string
  batchId: string
  accountId: string
  siteId: string
  accountLabel: string
  siteName: string
  groupName: string
  status: 'success' | 'error' | 'timeout' | 'manual'
  reason: string
}

export type FailureLogEntry = LoginLogEntry

export interface LoginLogQuery {
  date?: string
  siteId?: string
  siteName?: string
  groupName?: string
  status?: LoginLogEntry['status']
}

export interface LoginLogDeleteResult {
  deleted: number
}

export interface AccountDeleteResult {
  deleted: number
}

export type AppLogLevel = 'info' | 'success' | 'warning' | 'error'

export interface AppLogEntry {
  id: string
  timestamp: string
  level: AppLogLevel
  category: string
  message: string
  details?: string
}

export interface AppLogClearResult {
  deleted: number
}

export interface AppLogDeleteResult {
  deleted: number
}

export interface BookmarkVisitResult {
  status: 'success' | 'error'
  reason: string
}

export interface VaultStatus {
  initialized: boolean
  unlocked: boolean
  autoLockMinutes: AutoLockMinutes
}

export interface SelectorSpec {
  candidates: string[]
  text?: string
}

export type RecipeStep =
  | {
      id: string
      type: 'fillUsername' | 'fillPassword'
      selector: SelectorSpec
    }
  | {
      id: string
      type: 'click'
      selector: SelectorSpec
      navigationExpected?: boolean
    }
  | {
      id: string
      type: 'press'
      selector: SelectorSpec
      key: string
    }
  | {
      id: string
      type: 'focusChallenge'
      selector?: SelectorSpec
    }
  | {
      id: string
      type: 'paste'
      selector: SelectorSpec
      source: 'username' | 'password' | 'literal'
    }
  | {
      id: string
      type: 'acceptCertWarning'
      optional: true
    }

export interface RecordingStepSummary {
  id: string
  type: RecipeStep['type']
  source?: 'username' | 'password' | 'literal'
  selectorLabel?: string
}

export interface RecipeSuccessCheck {
  urlPrefix?: string
  selector?: SelectorSpec
}

export interface LoginRecipe {
  version: 1
  startUrl: string
  allowedOrigins: string[]
  steps: RecipeStep[]
  successCheck?: RecipeSuccessCheck
  manualChallenge?: boolean
  createdAt: string
  updatedAt: string
}

export interface AccountRecipe {
  id: string
  name: string
  recipe: LoginRecipe
}

export interface Site {
  id: string
  tabId: string
  name: string
  startUrl: string
  allowedOrigins: string[]
  autoSubmit: boolean
  group?: string
  icon?: string
  recipe?: LoginRecipe
  needsReview?: boolean
  createdAt: string
  updatedAt: string
}

export interface Account {
  id: string
  tabId: string
  siteId: string
  label: string
  username: string
  needsUsername?: boolean
  needsSecret?: boolean
  favorite: boolean
  loginStrategy: LoginStrategy
  loginBrowser: LoginBrowser
  manualSelectors?: ManualLoginSelectors
  manualSteps?: RecipeStep[]
  recipes?: AccountRecipe[]
  activeRecipeId?: string
  lastUsedAt?: string
  sortOrder?: number
  createdAt: string
  updatedAt: string
}

export interface CredentialVersionSnapshot {
  id: string
  username: string
  password: string
  validFrom: string
  validUntil: string
}

export type CredentialHistoryField = 'username' | 'password'

export interface CredentialHistoryEntry {
  id: string
  current: boolean
  validFrom: string
  validUntil?: string
  changedFields: CredentialHistoryField[]
  sizeBytes: number
}

export interface CredentialHistoryReveal {
  username: string
  password: string
}

export interface StoredAccount extends Account {
  password: string
  credentialHistory?: CredentialVersionSnapshot[]
  credentialUpdatedAt?: string
}

export interface AccountWithSite extends Account {
  site: Site
}

export interface GroupDefinition {
  tabId: string
  path: string
  name: string
  createdAt: string
  updatedAt: string
}

export interface GroupCreateInput {
  tabId?: string
  parentPath?: string
  name: string
}

export interface GroupMoveInput {
  tabId?: string
  fromPath: string
  parentPath?: string
}

export interface GroupMoveResult {
  fromPath: string
  toPath: string
}

export interface DeletedAccountRecord {
  account: StoredAccount
  site: Site
  tabId: string
  deletedAt: string
}

export interface DeletedAccountWithSite extends Account {
  site: Site
  tabId: string
  tabName: string
  source: AccountTabSource
  deletedAt: string
}

export interface VaultData {
  schemaVersion: 1
  tabs: AccountTab[]
  sites: Site[]
  accounts: StoredAccount[]
  groupDefinitions: GroupDefinition[]
  deletedAccounts: DeletedAccountRecord[]
  favoriteGroups: string[]
  settings: AppSettings
}

export interface LoginViewState {
  active: boolean
  accountId?: string
  accountLabel?: string
  siteName?: string
  mode?: LoginMode
  status: LoginStatus
  message: string
  currentUrl: string
  currentOrigin: string
  pageTitle: string
  isLoading: boolean
  originTrusted: boolean
  recording: boolean
  recipeExists: boolean
  recordingStepCount: number
  recordingSteps: RecordingStepSummary[]
  recordingPaused: boolean
  recordingStartedAt?: string
  recordingPausedAt?: string
  browserName: string
}

export interface SiteInput {
  id?: string
  tabId?: string
  name: string
  startUrl: string
  allowedOrigins?: string[]
  autoSubmit: boolean
  group?: string
  icon?: string
}

export interface AccountCreateInput {
  siteId: string
  label: string
  username: string
  password: string
  favorite?: boolean
  loginStrategy?: LoginStrategy
  loginBrowser?: LoginBrowser
  manualSelectors?: ManualLoginSelectors
  manualSteps?: RecipeStep[]
}

export interface AccountUpdateInput {
  label?: string
  username?: string
  password?: string
  favorite?: boolean
  activeRecipeId?: string
  loginStrategy?: LoginStrategy
  loginBrowser?: LoginBrowser
  manualSelectors?: ManualLoginSelectors
  manualSteps?: RecipeStep[]
}

export interface AccountBatchStrategyInput {
  accountIds: string[]
  loginStrategy: LoginStrategy
  loginBrowser?: LoginBrowser
  manualSelectors?: ManualLoginSelectors
  manualSteps?: RecipeStep[]
}

export interface AccountRecipeUpdateInput {
  accountId: string
  recipeId: string
  steps: RecipeStep[]
}

export interface AccountBatchIconInput {
  accountIds: string[]
  icon: string
}

export interface AccountBatchIconFetchResult {
  updatedAccounts: number
  updatedSites: number
  failedSites: string[]
  canceled: boolean
}

export interface AccountBatchIconFetchProgress {
  totalAccounts: number
  completedAccounts: number
  updatedSiteCount: number
  failedSiteCount: number
}

export interface AccountMoveInput {
  accountIds: string[]
  groupPath?: string
  tabId?: string
}

export interface AccountReorderInput {
  accountIds: string[]
  tabId?: string
}

export interface GroupRenameInput {
  tabId?: string
  fromName: string
  toName: string
}

export interface LoginStartInput {
  accountId: string
  mode: LoginMode
}

export interface EmbeddedBrowserBounds {
  x: number
  y: number
  width: number
  height: number
}

export interface EmbeddedBrowserOpenRequest {
  requestId: string
  accountId: string
  initialUrl: string
  profileDirectory: string
}

export interface EmbeddedBrowserOpenResult {
  label: string
  debugPort: number
}

export interface EmbeddedBrowserTab {
  label: string
  accountId: string
  siteId: string
  siteName: string
  pageTitle?: string
  pageUrl?: string
  accountLabel: string
  groupName: string
  url: string
  title: string
  isLoading: boolean
  createdAt: string
}

export interface EmbeddedBrowserTabPatch {
  url?: string
  title?: string
  pageTitle?: string
  pageUrl?: string
  isLoading?: boolean
}

export interface EmbeddedBrowserControlEvent {
  action:
    | 'show'
    | 'hide'
    | 'close'
    | 'focus'
    | 'set-bounds'
    | 'navigate'
    | 'back'
    | 'reload'
  label: string
  bounds?: EmbeddedBrowserBounds
  url?: string
}

export interface EmbeddedBrowserNewWindowEvent {
  url: string
}

export type LoginBatchItemStatus =
  | 'queued'
  | 'opening'
  | 'filling'
  | 'submitting'
  | 'manual'
  | 'success'
  | 'failed'
  | 'canceled'

export interface LoginBatchItem {
  accountId: string
  siteId: string
  accountLabel: string
  siteName: string
  groupName: string
  loginBrowser: LoginBrowser
  status: LoginBatchItemStatus
  message: string
  embeddedReady?: boolean
  startedAt?: string
  completedAt?: string
}

export interface LoginBatchState {
  batchId: string
  active: boolean
  total: number
  pending: number
  success: number
  failed: number
  manual: number
  canceled: number
  items: LoginBatchItem[]
  startedAt: string
  finishedAt?: string
}

export interface PasswordReveal {
  password: string
  expiresAt: number
}

export interface RecipeDraftResult {
  accountId: string
  siteId: string
  recipeId?: string
  recipe: LoginRecipe
  saved: boolean
  /** 保险库写入未完成，但完整副本已经安全落盘。 */
  draftSaved?: boolean
}

export type RecordingSaveState = 'idle' | 'saving' | 'saved' | 'draft_saved' | 'failed'

export interface RecordingSaveStatus {
  state: RecordingSaveState
  startedAt?: number
  finishedAt?: number
  error?: string
  /** 保存流程当前停留在哪一步，用于超时后定位卡点。 */
  stage?: string
  result?: RecipeDraftResult
}

export interface AccountRecipeInput {
  name: string
  recipe: LoginRecipe
}

export interface DataLocationInfo {
  directory: string
  defaultDirectory: string
  isDefault: boolean
  restartRequired?: boolean
}

export interface BackupLocationInfo {
  directory: string
  defaultDirectory: string
  isDefault: boolean
}

export type DataLocationConflictAction = 'load' | 'overwrite'

export type DataLocationChoiceResult =
  | { status: 'changed'; info: DataLocationInfo }
  | { status: 'occupied'; directory: string }

export interface FileOperationResult {
  canceled: boolean
  fileName?: string
}

export interface KdbxSelection {
  token: string
  fileName: string
  size: number
}

export interface KdbxImportInput {
  token: string
  password: string
}

export interface AutologinSelection {
  token: string
  fileName: string
  size: number
}

export type LocalDatabaseKind = 'autologin' | 'kdbx'

export interface LocalDatabaseFileSelection {
  kind: LocalDatabaseKind
  token: string
  fileName: string
  size: number
}

export interface ExistingDatabaseSelection {
  kind: 'existing'
  source: LocalDatabaseKind
  tabId: string
  tabName: string
  fileName: string
}

export type LocalDatabaseOpenSelection =
  | LocalDatabaseFileSelection
  | ExistingDatabaseSelection

export interface AutologinImportInput {
  token: string
  password: string
}

export interface LocalDatabaseImportInput {
  token: string
  password: string
}

export interface DataExportInput {
  tabId: string
  format?: DataExportFormat
  password?: string
}

export type DataExportFormat = 'autologin' | 'csv' | 'kdbx'

export interface ImportSkipDetail {
  rowNumber: number
  title: string
  reason: string
}

export type ImportMissingField = 'startUrl' | 'username' | 'password'

export interface ImportPreviewCandidate {
  index: number
  rowNumber: number
  siteName: string
  startUrl: string
  username: string
  siteGroup?: string
  missingFields: ImportMissingField[]
  defaultSelected: boolean
}

export interface ImportPreview {
  token: string
  source: 'csv' | 'kdbx' | 'bookmarks'
  fileName: string
  readyCount: number
  selectableCount: number
  blockedCount: number
  candidates: ImportPreviewCandidate[]
  skipDetails: ImportSkipDetail[]
  warnings: string[]
}

export interface ImportCommitInput {
  token: string
  selectedIndexes: number[]
}

export interface ImportPreviewCancelInput {
  token: string
}

export type LocalDatabaseImportResult = DataImportResult | ImportPreview

export interface DataImportResult {
  source: 'csv' | 'kdbx' | 'bookmarks' | 'autologin'
  tabId: string
  tabName: string
  sitesCreated: number
  accountsCreated: number
  skipped: number
  groupsCreated: number
  maxDepth: number
  groupPaths: string[]
  skipDetails: ImportSkipDetail[]
  warnings: string[]
}

export type CsvImportMode = 'current' | 'new'

export interface CsvImportInput {
  mode: CsvImportMode
  tabId: string
}

export interface BackupRecord {
  id: string
  fileName: string
  createdAt: string
  size: number
}

export interface AboutInfo {
  version: string
  platform: string
  dataDirectory: string
}

export interface UpdateCheckResult {
  status: 'available' | 'up-to-date' | 'unavailable'
  currentVersion: string
  latestVersion?: string
  releaseUrl?: string
  message: string
}

export type AppUpdatePhase =
  | 'idle'
  | 'checking'
  | 'available'
  | 'downloading'
  | 'downloaded'
  | 'up-to-date'
  | 'error'

export interface AppUpdateState {
  phase: AppUpdatePhase
  currentVersion: string
  latestVersion?: string
  releaseName?: string
  releaseDate?: string
  releaseNotes?: string
  releaseUrl?: string
  message?: string
  interactive: boolean
  percent?: number
  bytesPerSecond?: number
  transferred?: number
  total?: number
  downloadMode?: 'differential' | 'full'
}

export interface AutologinApi {
  vault: {
    status: () => Promise<VaultStatus>
    create: (masterPassword: string) => Promise<VaultStatus>
    unlock: (masterPassword: string) => Promise<VaultStatus>
    lock: () => Promise<VaultStatus>
    changePassword: (currentPassword: string, nextPassword: string) => Promise<void>
  }
  sites: {
    list: (tabId?: string) => Promise<Site[]>
    save: (input: SiteInput) => Promise<Site>
    delete: (siteId: string) => Promise<void>
    fetchIcon: (url: string) => Promise<string>
  }
  tabs: {
    list: () => Promise<AccountTab[]>
    create: (input?: AccountTabCreateInput) => Promise<AccountTab>
    update: (tabId: string, input: AccountTabUpdateInput) => Promise<AccountTab>
    fileStatus: (tabId: string) => Promise<{ exists: boolean }>
    delete: (tabId: string) => Promise<void>
    purge: (tabId: string) => Promise<void>
    reveal: (tabId: string) => Promise<void>
  }
  groups: {
    list: (tabId?: string) => Promise<GroupDefinition[]>
    create: (input: GroupCreateInput) => Promise<GroupDefinition>
    move: (input: GroupMoveInput) => Promise<GroupMoveResult>
    listFavorites: () => Promise<string[]>
    setFavorite: (groupName: string, favorite: boolean) => Promise<string[]>
    rename: (fromName: string, toName: string, tabId?: string) => Promise<void>
    delete: (groupName: string, tabId?: string) => Promise<number>
  }
  accounts: {
    list: () => Promise<AccountWithSite[]>
    create: (input: AccountCreateInput) => Promise<AccountWithSite>
    update: (accountId: string, patch: AccountUpdateInput) => Promise<AccountWithSite>
    setStrategyBatch: (input: AccountBatchStrategyInput) => Promise<AccountWithSite[]>
    setIconBatch: (input: AccountBatchIconInput) => Promise<AccountWithSite[]>
    fetchIconsBatch: (accountIds: string[]) => Promise<AccountBatchIconFetchResult>
    cancelIconFetchBatch: () => Promise<boolean>
    duplicate: (accountIds: string[]) => Promise<AccountWithSite[]>
    delete: (accountId: string) => Promise<void>
    deleteMany: (accountIds: string[]) => Promise<AccountDeleteResult>
    listDeleted: (tabId?: string) => Promise<DeletedAccountWithSite[]>
    restore: (accountId: string) => Promise<AccountWithSite>
    restoreMany: (accountIds: string[]) => Promise<AccountDeleteResult>
    purge: (accountId: string) => Promise<void>
    purgeMany: (accountIds: string[]) => Promise<AccountDeleteResult>
    moveToGroup: (input: AccountMoveInput) => Promise<AccountWithSite[]>
    reorder: (input: AccountReorderInput) => Promise<AccountWithSite[]>
    reveal: (accountId: string) => Promise<PasswordReveal>
    listCredentialHistory: (accountId: string) => Promise<CredentialHistoryEntry[]>
    revealCredentialHistory: (
      accountId: string,
      historyId: string
    ) => Promise<CredentialHistoryReveal>
    restoreCredentialHistory: (
      accountId: string,
      historyId: string
    ) => Promise<AccountWithSite>
    deleteCredentialHistory: (accountId: string, historyId: string) => Promise<void>
    clearCredentialHistory: (accountId: string) => Promise<void>
    copyUsername: (accountId: string) => Promise<void>
    copy: (accountId: string) => Promise<void>
    copyUrl: (accountId: string) => Promise<void>
    setActiveRecipe: (accountId: string, recipeId?: string) => Promise<AccountWithSite>
    deleteRecipe: (accountId: string, recipeId: string) => Promise<AccountWithSite>
    updateRecipe: (input: AccountRecipeUpdateInput) => Promise<AccountWithSite>
  }
  login: {
    start: (input: LoginStartInput) => Promise<LoginViewState>
    startBatch: (accountIds: string[]) => Promise<LoginBatchState>
    cancelBatch: () => Promise<LoginBatchState>
    getBatchState: () => Promise<LoginBatchState | null>
    close: () => Promise<void>
    retry: () => Promise<void>
    trustCurrentOrigin: () => Promise<void>
    focusBrowser: () => Promise<void>
    finishRecording: (name?: string) => Promise<RecipeDraftResult>
    recordingSaveStatus: () => Promise<RecordingSaveStatus>
    cancelRecording: () => Promise<void>
    undoRecordingStep: () => Promise<LoginViewState>
    pauseRecording: () => Promise<LoginViewState>
    resumeRecording: () => Promise<LoginViewState>
    testSelector: (input: SelectorTestInput) => Promise<SelectorTestResult>
    clearSession: (accountId: string) => Promise<void>
    getState: () => Promise<LoginViewState>
    setEmbeddedBounds: (bounds: EmbeddedBrowserBounds) => Promise<void>
    setEmbeddedActive: (accountId: string) => Promise<void>
    closeEmbeddedTabs: () => Promise<void>
  }
  browser: {
    listTabs: () => Promise<EmbeddedBrowserTab[]>
    openUrl: (url: string) => Promise<EmbeddedBrowserTab>
    activate: (label: string) => Promise<void>
    close: (label: string) => Promise<void>
    navigate: (label: string, url: string) => Promise<EmbeddedBrowserTab>
    back: (label: string) => Promise<void>
    reload: (label: string) => Promise<void>
    setBounds: (label: string, bounds: EmbeddedBrowserBounds) => Promise<void>
    hideAll: () => Promise<void>
  }
  settings: {
    get: () => Promise<AppSettings>
    update: (settings: AppSettingsPatch) => Promise<AppSettings>
  }
  app: {
    getVersion: () => Promise<string>
    getAbout: () => Promise<AboutInfo>
    checkForUpdates: () => Promise<UpdateCheckResult>
    getUpdateState: () => Promise<AppUpdateState>
    downloadUpdate: () => Promise<AppUpdateState>
    cancelUpdate: () => Promise<AppUpdateState>
    installUpdate: () => Promise<void>
    getDataLocation: () => Promise<DataLocationInfo>
    chooseDataLocation: () => Promise<DataLocationChoiceResult | null>
    chooseRecordingDraftDirectory: () => Promise<string | null>
    getBackupLocation: () => Promise<BackupLocationInfo>
    chooseBackupLocation: () => Promise<BackupLocationInfo | null>
    restoreDefaultBackupLocation: () => Promise<BackupLocationInfo>
    openBackupLocation: () => Promise<void>
    resolveDataLocationConflict: (
      directory: string,
      action: DataLocationConflictAction
    ) => Promise<DataLocationInfo>
    restoreDefaultDataLocation: () => Promise<DataLocationInfo>
    openDataLocation: () => Promise<void>
    resetBrowserProfile: () => Promise<void>
    openRecordingDraftDirectory: () => Promise<void>
    openFailureLog: () => Promise<void>
    listLoginLogs: (query?: LoginLogQuery) => Promise<LoginLogEntry[]>
    listFailureLogs: () => Promise<LoginLogEntry[]>
    deleteLoginLogs: (ids: string[]) => Promise<LoginLogDeleteResult>
    listAppLogs: (limit?: number) => Promise<AppLogEntry[]>
    deleteAppLogs: (ids: string[]) => Promise<AppLogDeleteResult>
    clearAppLogs: () => Promise<AppLogClearResult>
    restart: () => Promise<void>
    reportActivity: () => void
    reportUiFailure: (input: {
      message: string
      context?: string
      durationMs?: number
    }) => Promise<void>
    clearAllData: () => Promise<void>
    openPrivacy: () => Promise<void>
  }
  network: {
    testProxy: (settings: ProxySettings) => Promise<ProxyTestResult>
  }
  data: {
    exportTab: (input: DataExportInput) => Promise<FileOperationResult>
    exportCsvTemplate: () => Promise<FileOperationResult>
    importCsv: (input: CsvImportInput) => Promise<ImportPreview | null>
    chooseDatabase: () => Promise<LocalDatabaseOpenSelection | null>
    importDatabase: (
      input: LocalDatabaseImportInput
    ) => Promise<LocalDatabaseImportResult>
    chooseKdbx: () => Promise<KdbxSelection | null>
    importKdbx: (input: KdbxImportInput) => Promise<ImportPreview>
    chooseAutologin: () => Promise<AutologinSelection | null>
    importAutologin: (input: AutologinImportInput) => Promise<DataImportResult>
    importBookmarks: () => Promise<DataImportResult | null>
    commitImport: (input: ImportCommitInput) => Promise<DataImportResult>
    cancelImportPreview: (input: ImportPreviewCancelInput) => Promise<void>
    listBackups: () => Promise<BackupRecord[]>
    restoreBackup: (backupId: string) => Promise<void>
  }
  clipboard: {
    writeSecret: (value: string) => Promise<void>
  }
  bookmarks: {
    visit: (accountId: string) => Promise<BookmarkVisitResult>
  }
  windowControls: {
    updateTheme: (theme: {
      backgroundColor: string
      symbolColor: string
      height?: number
    }) => Promise<void>
  }
  events: {
    onVaultLocked: (callback: () => void) => () => void
    onLoginState: (callback: (state: LoginViewState) => void) => () => void
    onLoginBatchState: (callback: (state: LoginBatchState) => void) => () => void
    onBrowserTabs: (callback: (tabs: EmbeddedBrowserTab[]) => void) => () => void
    onBrowserNewWindow: (
      callback: (event: EmbeddedBrowserNewWindowEvent) => void
    ) => () => void
    onAccountBatchIconFetchProgress: (
      callback: (progress: AccountBatchIconFetchProgress) => void
    ) => () => void
    onUpdateState: (callback: (state: AppUpdateState) => void) => () => void
  }
}
