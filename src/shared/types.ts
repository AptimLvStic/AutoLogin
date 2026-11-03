export const AUTO_LOCK_OPTIONS = [5, 10, 15, 30] as const
export type AutoLockMinutes = (typeof AUTO_LOCK_OPTIONS)[number]

export const THEME_PRESETS = ['warm', 'sage', 'ocean', 'rose'] as const
export type ThemePreset = (typeof THEME_PRESETS)[number] | 'custom'

export const COLOR_MODES = ['light', 'dark'] as const
export type ColorMode = (typeof COLOR_MODES)[number]

export const APP_LANGUAGES = ['zh-CN', 'en', 'zh-TW'] as const
export type AppLanguage = (typeof APP_LANGUAGES)[number]

export const INTERFACE_SCALE_MIN = 80
export const INTERFACE_SCALE_MAX = 125
export const INTERFACE_SCALE_STEP = 5

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
  colorMode: ColorMode
  language: AppLanguage
  themePreset: ThemePreset
  customTheme: ThemeColors
  interfaceScale: number
}

export type AppSettingsPatch = Partial<AppSettings>

export interface LoginLogEntry {
  timestamp: string
  batchId: string
  accountId: string
  accountLabel: string
  siteName: string
  groupName: string
  status: 'success' | 'error' | 'timeout' | 'manual'
  reason: string
}

export type FailureLogEntry = LoginLogEntry

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

export interface VaultData {
  schemaVersion: 1
  sites: Site[]
  accounts: StoredAccount[]
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
}

export interface AccountUpdateInput {
  label?: string
  username?: string
  password?: string
  favorite?: boolean
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
  siteId: string
  recipe: LoginRecipe
  saved: boolean
}

export interface DataLocationInfo {
  directory: string
  defaultDirectory: string
  isDefault: boolean
  restartRequired?: boolean
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
    listFavorites: () => Promise<string[]>
    setFavorite: (groupName: string, favorite: boolean) => Promise<string[]>
  }
  accounts: {
    list: () => Promise<AccountWithSite[]>
    create: (input: AccountCreateInput) => Promise<AccountWithSite>
    update: (accountId: string, patch: AccountUpdateInput) => Promise<AccountWithSite>
    delete: (accountId: string) => Promise<void>
    reveal: (accountId: string) => Promise<PasswordReveal>
    copyUsername: (accountId: string) => Promise<void>
    copy: (accountId: string) => Promise<void>
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
    openRepository: () => Promise<void>
    openReleases: () => Promise<void>
    getDataLocation: () => Promise<DataLocationInfo>
    chooseDataLocation: () => Promise<DataLocationInfo | null>
    openDataLocation: () => Promise<void>
    openFailureLog: () => Promise<void>
    listLoginLogs: () => Promise<LoginLogEntry[]>
    listFailureLogs: () => Promise<LoginLogEntry[]>
    restart: () => Promise<void>
    reportActivity: () => void
    clearAllData: () => Promise<void>
    openPrivacy: () => Promise<void>
  }
  events: {
    onVaultLocked: (callback: () => void) => () => void
    onLoginState: (callback: (state: LoginViewState) => void) => () => void
    onLoginBatchState: (callback: (state: LoginBatchState) => void) => () => void
  }
}
