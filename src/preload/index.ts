import { contextBridge, ipcRenderer } from 'electron'
import type {
  AccountCreateInput,
  AccountUpdateInput,
  AppUpdateState,
  AppSettings,
  AppSettingsPatch,
  AutologinApi,
  LoginBatchState,
  LoginStartInput,
  LoginViewState,
  SiteInput
} from '@shared/types'

async function invoke<T>(channel: string, ...args: unknown[]): Promise<T> {
  try {
    return (await ipcRenderer.invoke(channel, ...args)) as T
  } catch (error) {
    const raw = error instanceof Error ? error.message : String(error)
    const cleaned = raw
      .replace(/^Error invoking remote method '[^']+':\s*/i, '')
      .replace(/^Error:\s*/i, '')
    throw new Error(cleaned || '操作失败')
  }
}

const api: AutologinApi = {
  vault: {
    status: () => invoke('vault:status'),
    create: (masterPassword) => invoke('vault:create', masterPassword),
    unlock: (masterPassword) => invoke('vault:unlock', masterPassword),
    lock: () => invoke('vault:lock'),
    changePassword: (currentPassword, nextPassword) =>
      invoke('vault:change-password', { currentPassword, nextPassword })
  },
  sites: {
    list: (tabId) => invoke('sites:list', tabId),
    save: (input: SiteInput) => invoke('sites:save', input),
    delete: (siteId) => invoke('sites:delete', siteId),
    fetchIcon: (url) => invoke('sites:fetch-icon', { url })
  },
  tabs: {
    list: () => invoke('tabs:list'),
    create: (input) => invoke('tabs:create', input),
    update: (tabId, input) => invoke('tabs:update', tabId, input),
    delete: (tabId) => invoke('tabs:delete', tabId),
    reveal: (tabId) => invoke('tabs:reveal', tabId)
  },
  groups: {
    list: (tabId) => invoke('groups:list', tabId),
    create: (input) => invoke('groups:create', input),
    move: (input) => invoke('groups:move', input),
    listFavorites: () => invoke('groups:list-favorites'),
    setFavorite: (groupName, favorite) =>
      invoke('groups:set-favorite', { groupName, favorite }),
    rename: (fromName, toName, tabId) =>
      invoke('groups:rename', { fromName, toName, tabId }),
    delete: (groupName, tabId) =>
      invoke('groups:delete', { groupName, tabId })
  },
  accounts: {
    list: () => invoke('accounts:list'),
    create: (input: AccountCreateInput) => invoke('accounts:create', input),
    update: (accountId, patch: AccountUpdateInput) =>
      invoke('accounts:update', accountId, patch),
    setStrategyBatch: (input) => invoke('accounts:set-strategy-batch', input),
    setIconBatch: (input) => invoke('accounts:set-icon-batch', input),
    fetchIconsBatch: (accountIds) => invoke('accounts:fetch-icons-batch', accountIds),
    duplicate: (accountIds) => invoke('accounts:duplicate', accountIds),
    delete: (accountId) => invoke('accounts:delete', accountId),
    deleteMany: (accountIds) => invoke('accounts:delete-many', accountIds),
    listDeleted: (tabId) => invoke('accounts:list-deleted', tabId),
    restore: (accountId) => invoke('accounts:restore', accountId),
    restoreMany: (accountIds) => invoke('accounts:restore-many', accountIds),
    purge: (accountId) => invoke('accounts:purge', accountId),
    purgeMany: (accountIds) => invoke('accounts:purge-many', accountIds),
    moveToGroup: (input) => invoke('accounts:move-to-group', input),
    reorder: (input) => invoke('accounts:reorder', input),
    reveal: (accountId) => invoke('accounts:reveal', accountId),
    copyUsername: (accountId) => invoke('accounts:copy-username', accountId),
    copy: (accountId) => invoke('accounts:copy', accountId),
    copyUrl: (accountId) => invoke('accounts:copy-url', accountId),
    setActiveRecipe: (accountId, recipeId) =>
      invoke('accounts:set-active-recipe', accountId, recipeId),
    deleteRecipe: (accountId, recipeId) =>
      invoke('accounts:delete-recipe', accountId, recipeId),
    updateRecipe: (input) => invoke('accounts:update-recipe', input)
  },
  login: {
    start: (input: LoginStartInput) => invoke('login:start', input),
    startBatch: (accountIds) => invoke('login:start-batch', accountIds),
    cancelBatch: () => invoke('login:cancel-batch'),
    getBatchState: () => invoke('login:get-batch-state'),
    close: () => invoke('login:close'),
    retry: () => invoke('login:retry'),
    trustCurrentOrigin: () => invoke('login:trust-origin'),
    focusBrowser: () => invoke('login:focus-browser'),
    finishRecording: () => invoke('login:finish-recording'),
    cancelRecording: () => invoke('login:cancel-recording'),
    testSelector: (input) => invoke('login:test-selector', input),
    clearSession: (accountId) => invoke('login:clear-session', accountId),
    getState: () => invoke('login:get-state')
  },
  settings: {
    get: () => invoke('settings:get'),
    update: (settings: AppSettingsPatch) => invoke('settings:update', settings)
  },
  app: {
    getVersion: () => invoke('app:get-version'),
    getAbout: () => invoke('app:get-about'),
    checkForUpdates: () => invoke('app:check-for-updates'),
    getUpdateState: () => invoke('app:get-update-state'),
    downloadUpdate: () => invoke('app:download-update'),
    cancelUpdate: () => invoke('app:cancel-update'),
    installUpdate: () => invoke('app:install-update'),
    openRepository: () => invoke('app:open-repository'),
    openReleases: () => invoke('app:open-releases'),
    getDataLocation: () => invoke('app:get-data-location'),
    chooseDataLocation: () => invoke('app:choose-data-location'),
    restoreDefaultDataLocation: () => invoke('app:restore-default-data-location'),
    openDataLocation: () => invoke('app:open-data-location'),
    openFailureLog: () => invoke('app:open-failure-log'),
    listLoginLogs: (query) => invoke('app:list-login-logs', query),
    listFailureLogs: () => invoke('app:list-failure-logs'),
    deleteLoginLogs: (ids) => invoke('app:delete-login-logs', ids),
    listAppLogs: (limit) => invoke('app:list-app-logs', limit),
    deleteAppLogs: (ids) => invoke('app:delete-app-logs', ids),
    clearAppLogs: () => invoke('app:clear-app-logs'),
    restart: () => invoke('app:restart'),
    reportActivity: () => ipcRenderer.send('app:activity'),
    clearAllData: () => invoke('app:clear-all-data'),
    openPrivacy: () => invoke('app:open-privacy')
  },
  network: {
    testProxy: (settings) => invoke('network:test-proxy', settings)
  },
  data: {
    exportTab: (input) => invoke('data:export-vault', input),
    exportCsvTemplate: () => invoke('data:export-csv-template'),
    importCsv: (input) => invoke('data:import-csv', input),
    chooseDatabase: () => invoke('data:choose-database'),
    importDatabase: (input) => invoke('data:import-database', input),
    chooseKdbx: () => invoke('data:choose-kdbx'),
    importKdbx: (input) => invoke('data:import-kdbx', input),
    chooseAutologin: () => invoke('data:choose-autologin'),
    importAutologin: (input) => invoke('data:import-autologin', input),
    importBookmarks: () => invoke('data:import-bookmarks'),
    listBackups: () => invoke('data:list-backups'),
    restoreBackup: (backupId) => invoke('data:restore-backup', backupId)
  },
  clipboard: {
    writeSecret: (value) => invoke('clipboard:write-secret', { value })
  },
  bookmarks: {
    visit: (accountId) => invoke('bookmarks:visit', accountId)
  },
  windowControls: {
    updateTheme: (theme) => invoke('window:update-theme', theme)
  },
  events: {
    onVaultLocked: (callback) => subscribe('vault:locked', callback),
    onLoginState: (callback: (state: LoginViewState) => void) =>
      subscribe('login:state', callback),
    onLoginBatchState: (callback: (state: LoginBatchState) => void) =>
      subscribe('login:batch-state', callback),
    onUpdateState: (callback: (state: AppUpdateState) => void) =>
      subscribe('app:update-state', callback)
  }
}

function subscribe<T>(channel: string, callback: (payload: T) => void): () => void {
  const listener = (_event: Electron.IpcRendererEvent, payload: T): void => {
    callback(payload)
  }
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

contextBridge.exposeInMainWorld('autologin', api)
