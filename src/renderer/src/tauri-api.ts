import { invoke, isTauri } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import type {
  AccountCreateInput,
  AccountUpdateInput,
  AppSettingsPatch,
  AutologinApi,
  LoginBatchState,
  LoginStartInput,
  LoginViewState,
  SiteInput
} from '@shared/types'

interface BackendEventEnvelope {
  channel: string
  payload: unknown
}

async function call<T>(channel: string, ...args: unknown[]): Promise<T> {
  try {
    const normalizedArgs = [...args]
    while (
      normalizedArgs.length > 0 &&
      normalizedArgs[normalizedArgs.length - 1] === undefined
    ) {
      normalizedArgs.pop()
    }
    return await invoke<T>('backend_call', { channel, args: normalizedArgs })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(message.replace(/^Error:\s*/i, '') || '操作失败')
  }
}

function subscribe<T>(channel: string, callback: (payload: T) => void): () => void {
  let disposed = false
  let unlisten: UnlistenFn | null = null
  void listen<BackendEventEnvelope>('autologin://backend-event', (event) => {
    if (disposed || event.payload.channel !== channel) return
    callback(event.payload.payload as T)
  }).then((dispose) => {
    if (disposed) {
      dispose()
    } else {
      unlisten = dispose
    }
  })
  return () => {
    disposed = true
    unlisten?.()
    unlisten = null
  }
}

const api: AutologinApi = {
  vault: {
    status: () => call('vault:status'),
    create: (masterPassword) => call('vault:create', masterPassword),
    unlock: (masterPassword) => call('vault:unlock', masterPassword),
    lock: () => call('vault:lock'),
    changePassword: (currentPassword, nextPassword) =>
      call('vault:change-password', { currentPassword, nextPassword })
  },
  sites: {
    list: (tabId) => call('sites:list', tabId),
    save: (input: SiteInput) => call('sites:save', input),
    delete: (siteId) => call('sites:delete', siteId),
    fetchIcon: (url) => call('sites:fetch-icon', { url })
  },
  tabs: {
    list: () => call('tabs:list'),
    create: (input) => call('tabs:create', input),
    update: (tabId, input) => call('tabs:update', tabId, input),
    delete: (tabId) => call('tabs:delete', tabId),
    purge: (tabId) => call('tabs:purge', tabId),
    reveal: async (tabId) => {
      const path = await call<string>('tabs:reveal-path', tabId)
      try {
        await invoke('open_path', { path })
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        throw new Error(message || '无法打开数据库所在文件夹')
      }
    }
  },
  groups: {
    list: (tabId) => call('groups:list', tabId),
    create: (input) => call('groups:create', input),
    move: (input) => call('groups:move', input),
    listFavorites: () => call('groups:list-favorites'),
    setFavorite: (groupName, favorite) =>
      call('groups:set-favorite', { groupName, favorite }),
    rename: (fromName, toName, tabId) =>
      call('groups:rename', { fromName, toName, tabId }),
    delete: (groupName, tabId) => call('groups:delete', { groupName, tabId })
  },
  accounts: {
    list: () => call('accounts:list'),
    create: (input: AccountCreateInput) => call('accounts:create', input),
    update: (accountId, patch: AccountUpdateInput) =>
      call('accounts:update', accountId, patch),
    setStrategyBatch: (input) => call('accounts:set-strategy-batch', input),
    setIconBatch: (input) => call('accounts:set-icon-batch', input),
    fetchIconsBatch: (accountIds) => call('accounts:fetch-icons-batch', accountIds),
    duplicate: (accountIds) => call('accounts:duplicate', accountIds),
    delete: (accountId) => call('accounts:delete', accountId),
    deleteMany: (accountIds) => call('accounts:delete-many', accountIds),
    listDeleted: (tabId) => call('accounts:list-deleted', tabId),
    restore: (accountId) => call('accounts:restore', accountId),
    restoreMany: (accountIds) => call('accounts:restore-many', accountIds),
    purge: (accountId) => call('accounts:purge', accountId),
    purgeMany: (accountIds) => call('accounts:purge-many', accountIds),
    moveToGroup: (input) => call('accounts:move-to-group', input),
    reorder: (input) => call('accounts:reorder', input),
    reveal: (accountId) => call('accounts:reveal', accountId),
    copyUsername: (accountId) => call('accounts:copy-username', accountId),
    copy: (accountId) => call('accounts:copy', accountId),
    copyUrl: (accountId) => call('accounts:copy-url', accountId),
    setActiveRecipe: (accountId, recipeId) =>
      call('accounts:set-active-recipe', accountId, recipeId),
    deleteRecipe: (accountId, recipeId) =>
      call('accounts:delete-recipe', accountId, recipeId),
    updateRecipe: (input) => call('accounts:update-recipe', input)
  },
  login: {
    start: (input: LoginStartInput) => call('login:start', input),
    startBatch: (accountIds) => call('login:start-batch', accountIds),
    cancelBatch: () => call('login:cancel-batch'),
    getBatchState: () => call('login:get-batch-state'),
    close: () => call('login:close'),
    retry: () => call('login:retry'),
    trustCurrentOrigin: () => call('login:trust-origin'),
    focusBrowser: () => call('login:focus-browser'),
    finishRecording: () => call('login:finish-recording'),
    cancelRecording: () => call('login:cancel-recording'),
    testSelector: (input) => call('login:test-selector', input),
    clearSession: (accountId) => call('login:clear-session', accountId),
    getState: () => call('login:get-state')
  },
  settings: {
    get: () => call('settings:get'),
    update: (settings: AppSettingsPatch) => call('settings:update', settings)
  },
  app: {
    getVersion: () => call('app:get-version'),
    getAbout: () => call('app:get-about'),
    checkForUpdates: () => call('app:check-for-updates'),
    getUpdateState: () => call('app:get-update-state'),
    downloadUpdate: () => call('app:download-update'),
    cancelUpdate: () => call('app:cancel-update'),
    installUpdate: () => call('app:install-update'),
    getDataLocation: () => call('app:get-data-location'),
    chooseDataLocation: () => call('app:choose-data-location'),
    restoreDefaultDataLocation: () => call('app:restore-default-data-location'),
    openDataLocation: () => call('app:open-data-location'),
    openFailureLog: () => call('app:open-failure-log'),
    listLoginLogs: (query) => call('app:list-login-logs', query),
    listFailureLogs: () => call('app:list-failure-logs'),
    deleteLoginLogs: (ids) => call('app:delete-login-logs', ids),
    listAppLogs: (limit) => call('app:list-app-logs', limit),
    deleteAppLogs: (ids) => call('app:delete-app-logs', ids),
    clearAppLogs: () => call('app:clear-app-logs'),
    restart: () => call('app:restart'),
    reportActivity: () => {
      void call('app:activity')
    },
    clearAllData: () => call('app:clear-all-data'),
    openPrivacy: () => call('app:open-privacy')
  },
  network: {
    testProxy: (settings) => call('network:test-proxy', settings)
  },
  data: {
    exportTab: (input) => call('data:export-vault', input),
    exportCsvTemplate: () => call('data:export-csv-template'),
    importCsv: (input) => call('data:import-csv', input),
    chooseDatabase: () => call('data:choose-database'),
    importDatabase: (input) => call('data:import-database', input),
    chooseKdbx: () => call('data:choose-kdbx'),
    importKdbx: (input) => call('data:import-kdbx', input),
    chooseAutologin: () => call('data:choose-autologin'),
    importAutologin: (input) => call('data:import-autologin', input),
    importBookmarks: () => call('data:import-bookmarks'),
    listBackups: () => call('data:list-backups'),
    restoreBackup: (backupId) => call('data:restore-backup', backupId)
  },
  clipboard: {
    writeSecret: (value) => call('clipboard:write-secret', { value })
  },
  bookmarks: {
    visit: (accountId) => call('bookmarks:visit', accountId)
  },
  windowControls: {
    updateTheme: (theme) => call('window:update-theme', theme)
  },
  events: {
    onVaultLocked: (callback) => subscribe('vault:locked', callback),
    onLoginState: (callback: (state: LoginViewState) => void) =>
      subscribe('login:state', callback),
    onLoginBatchState: (callback: (state: LoginBatchState) => void) =>
      subscribe('login:batch-state', callback),
    onUpdateState: (callback) => subscribe('app:update-state', callback)
  }
}

export function installTauriAutologinApi(): void {
  if (!isTauri() || window.autologin) return
  window.autologin = api
}
