export const AUTO_LOCK_OPTIONS = [5, 10, 15, 30] as const
export type AutoLockMinutes = (typeof AUTO_LOCK_OPTIONS)[number]

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

export interface Site {
  id: string
  name: string
  startUrl: string
  allowedOrigins: string[]
  autoSubmit: boolean
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

export interface PasswordReveal {
  password: string
  expiresAt: number
}

export interface RecipeDraftResult {
  siteId: string
  recipe: LoginRecipe
  saved: boolean
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
    update: (settings: AppSettings) => Promise<AppSettings>
  }
  app: {
    getVersion: () => Promise<string>
    reportActivity: () => void
    clearAllData: () => Promise<void>
    openPrivacy: () => Promise<void>
  }
  events: {
    onVaultLocked: (callback: () => void) => () => void
    onLoginState: (callback: (state: LoginViewState) => void) => () => void
  }
}
