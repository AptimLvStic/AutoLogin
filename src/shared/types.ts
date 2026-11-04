export const AUTO_LOCK_OPTIONS = [5, 10, 15, 30] as const
export type AutoLockMinutes = (typeof AUTO_LOCK_OPTIONS)[number]

export const THEME_PRESETS = ['magpie', 'warm', 'sage', 'ocean', 'rose'] as const
export type ThemePreset = (typeof THEME_PRESETS)[number] | 'custom'

export const COLOR_MODES = ['light', 'dark'] as const
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
export const GROUP_NAME_MAX_LENGTH = 20
export const GROUP_MAX_DEPTH = 3
export const TRASH_RETENTION_OPTIONS = [3, 7, 15, 30] as const
export type TrashRetentionDays = (typeof TRASH_RETENTION_OPTIONS)[number]
export const DEFAULT_TRASH_RETENTION_DAYS: TrashRetentionDays = 7

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
  proxy: ProxySettings
  groupOrder: string[]
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
  name: string
  startUrl: string
  allowedOrigins: string[]
  autoSubmit: boolean
  group?: string
  recipe?: LoginRecipe
  createdAt: string
  updatedAt: string
}

export interface Account {
  id: string
  siteId: string
  label: string
  username: string
  favorite: boolean
  loginStrategy: LoginStrategy
  manualSelectors?: ManualLoginSelectors
  recipes?: AccountRecipe[]
  activeRecipeId?: string
  lastUsedAt?: string
  createdAt: string
  updatedAt: string
}

export interface StoredAccount extends Account {
  password: string
}

export interface AccountWithSite extends Account {
  site: Site
}

export interface GroupDefinition {
  path: string
  name: string
  createdAt: string
  updatedAt: string
}

export interface GroupCreateInput {
  parentPath?: string
  name: string
}

export interface GroupMoveInput {
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
  deletedAt: string
}

export interface DeletedAccountWithSite extends Account {
  site: Site
  deletedAt: string
}

export interface VaultData {
  schemaVersion: 1
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
  browserName: string
}

export interface SiteInput {
  id?: string
  name: string
  startUrl: string
  allowedOrigins?: string[]
  autoSubmit: boolean
  group?: string
}

export interface AccountCreateInput {
  siteId: string
  label: string
  username: string
  password: string
  favorite?: boolean
  loginStrategy?: LoginStrategy
  manualSelectors?: ManualLoginSelectors
}

export interface AccountUpdateInput {
  label?: string
  username?: string
  password?: string
  favorite?: boolean
  activeRecipeId?: string
  loginStrategy?: LoginStrategy
  manualSelectors?: ManualLoginSelectors
}

export interface AccountBatchStrategyInput {
  accountIds: string[]
  loginStrategy: LoginStrategy
  manualSelectors?: ManualLoginSelectors
}

export interface GroupRenameInput {
  fromName: string
  toName: string
}

export interface LoginStartInput {
  accountId: string
  mode: LoginMode
}

export type LoginBatchItemStatus =
  | 'queued'
  | 'opening'
  | 'filling'
  | 'submitting'
  | 'manual'
  | 'success'
  | 'failed'

export interface LoginBatchItem {
  accountId: string
  siteId: string
  accountLabel: string
  siteName: string
  groupName: string
  status: LoginBatchItemStatus
  message: string
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

export interface DataImportResult {
  source: 'csv' | 'kdbx'
  sitesCreated: number
  accountsCreated: number
  skipped: number
  warnings: string[]
}

export interface BackupRecord {
  id: string
  fileName: string
  createdAt: string
  size: number
}

export interface AboutInfo {
  version: string
  electronVersion: string
  platform: string
  repositoryUrl: string
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
    list: () => Promise<Site[]>
    save: (input: SiteInput) => Promise<Site>
    delete: (siteId: string) => Promise<void>
  }
  groups: {
    list: () => Promise<GroupDefinition[]>
    create: (input: GroupCreateInput) => Promise<GroupDefinition>
    move: (input: GroupMoveInput) => Promise<GroupMoveResult>
    listFavorites: () => Promise<string[]>
    setFavorite: (groupName: string, favorite: boolean) => Promise<string[]>
    rename: (fromName: string, toName: string) => Promise<void>
    delete: (groupName: string) => Promise<number>
  }
  accounts: {
    list: () => Promise<AccountWithSite[]>
    create: (input: AccountCreateInput) => Promise<AccountWithSite>
    update: (accountId: string, patch: AccountUpdateInput) => Promise<AccountWithSite>
    setStrategyBatch: (input: AccountBatchStrategyInput) => Promise<AccountWithSite[]>
    duplicate: (accountIds: string[]) => Promise<AccountWithSite[]>
    delete: (accountId: string) => Promise<void>
    deleteMany: (accountIds: string[]) => Promise<AccountDeleteResult>
    listDeleted: () => Promise<DeletedAccountWithSite[]>
    restore: (accountId: string) => Promise<AccountWithSite>
    reveal: (accountId: string) => Promise<PasswordReveal>
    copyUsername: (accountId: string) => Promise<void>
    copy: (accountId: string) => Promise<void>
    setActiveRecipe: (accountId: string, recipeId?: string) => Promise<AccountWithSite>
    deleteRecipe: (accountId: string, recipeId: string) => Promise<AccountWithSite>
  }
  login: {
    start: (input: LoginStartInput) => Promise<LoginViewState>
    startBatch: (accountIds: string[]) => Promise<LoginBatchState>
    getBatchState: () => Promise<LoginBatchState | null>
    close: () => Promise<void>
    retry: () => Promise<void>
    trustCurrentOrigin: () => Promise<void>
    focusBrowser: () => Promise<void>
    finishRecording: () => Promise<RecipeDraftResult>
    cancelRecording: () => Promise<void>
    testSelector: (input: SelectorTestInput) => Promise<SelectorTestResult>
    clearSession: (accountId: string) => Promise<void>
    getState: () => Promise<LoginViewState>
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
    installUpdate: () => Promise<void>
    openRepository: () => Promise<void>
    openReleases: () => Promise<void>
    getDataLocation: () => Promise<DataLocationInfo>
    chooseDataLocation: () => Promise<DataLocationInfo | null>
    openDataLocation: () => Promise<void>
    openFailureLog: () => Promise<void>
    listLoginLogs: (query?: LoginLogQuery) => Promise<LoginLogEntry[]>
    listFailureLogs: () => Promise<LoginLogEntry[]>
    deleteLoginLogs: (ids: string[]) => Promise<LoginLogDeleteResult>
    listAppLogs: (limit?: number) => Promise<AppLogEntry[]>
    deleteAppLogs: (ids: string[]) => Promise<AppLogDeleteResult>
    clearAppLogs: () => Promise<AppLogClearResult>
    restart: () => Promise<void>
    reportActivity: () => void
    clearAllData: () => Promise<void>
    openPrivacy: () => Promise<void>
  }
  network: {
    testProxy: (settings: ProxySettings) => Promise<ProxyTestResult>
  }
  data: {
    exportVault: () => Promise<FileOperationResult>
    exportCsvTemplate: () => Promise<FileOperationResult>
    importCsv: () => Promise<DataImportResult | null>
    chooseKdbx: () => Promise<KdbxSelection | null>
    importKdbx: (input: KdbxImportInput) => Promise<DataImportResult>
    listBackups: () => Promise<BackupRecord[]>
    restoreBackup: (backupId: string) => Promise<void>
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
    onUpdateState: (callback: (state: AppUpdateState) => void) => () => void
  }
}
