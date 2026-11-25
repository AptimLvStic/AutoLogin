import { invoke, isTauri } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import type {
  AccountBatchIconFetchProgress,
  AccountCreateInput,
  AccountUpdateInput,
  AppSettingsPatch,
  AutologinApi,
  EmbeddedBrowserNewWindowEvent,
  EmbeddedBrowserTab,
  LoginBatchState,
  LoginStartInput,
  LoginViewState,
  SiteInput
} from '@shared/types'

interface BackendEventEnvelope {
  channel: string
  payload: unknown
}

const DEFAULT_CALL_TIMEOUT_MS = 35_000
const SESSION_CLEAR_TIMEOUT_MS = 15_000
const LONG_CALL_TIMEOUT_MS = 10 * 60_000 + 5_000
const CALL_LABELS: Record<string, string> = {
  'vault:create': '创建保险库',
  'vault:unlock': '解锁保险库',
  'vault:tab-unlock': '解锁数据库',
  'vault:tab-lock': '锁定数据库',
  'vault:tab-password': '更新数据库密码',
  'sites:save': '保存站点信息',
  'sites:delete': '删除站点',
  'accounts:create': '创建账号',
  'accounts:update': '保存账号修改',
  'accounts:update-recipe': '保存录制步骤',
  'login:start': '打开登录站点',
  'login:start-batch': '批量登录',
  'login:finish-recording': '保存录制流程',
  'login:recording-save-status': '核对录制保存状态',
  'login:cancel-recording': '停止录制',
  'login:clear-session': '清除网站会话',
  'login:close': '关闭登录页面',
  'browser:open-url': '打开站点',
  'settings:update': '保存设置',
  'network:test-proxy': '测试网络连接',
  'app:choose-data-location': '选择数据保存位置',
  'app:choose-recording-draft-directory': '选择录制副本保存位置',
  'app:get-backup-location': '读取自动备份位置',
  'app:choose-backup-location': '选择自动备份保存位置',
  'app:restore-default-backup-location': '恢复默认自动备份位置',
  'app:open-backup-location': '打开自动备份目录',
  'app:resolve-data-location-conflict': '处理数据位置冲突',
  'app:restore-default-data-location': '恢复默认数据位置',
  'app:open-data-location': '打开数据目录',
  'app:reset-browser-profile': '重置浏览器配置',
  'app:open-recording-draft-directory': '打开录制副本目录',
  'app:clear-all-data': '清除本地数据',
  'app:restart': '重新启动应用',
  'data:export-vault': '导出数据',
  'data:export-csv-template': '下载 CSV 模板',
  'data:import-csv': '导入 CSV',
  'data:import-database': '导入数据库',
  'data:import-kdbx': '导入 KDBX 数据库',
  'data:import-autologin': '导入配置',
  'data:import-bookmarks': '导入书签',
  'data:commit-import': '确认导入',
  'data:cancel-import-preview': '取消导入预览',
  'data:restore-backup': '恢复备份'
}

class CallTimeoutError extends Error {}

function callTimeout(channel: string): number {
  if (channel === 'login:finish-recording') {
    return 20_000
  }
  if (channel === 'login:recording-save-status') {
    return 5_000
  }
  if (channel === 'login:clear-session') {
    return SESSION_CLEAR_TIMEOUT_MS
  }
  if (
    channel.includes(':choose-') ||
    channel === 'data:export-vault' ||
    channel === 'data:export-csv-template' ||
    channel === 'data:import-csv' ||
    channel === 'data:import-database' ||
    channel === 'data:import-kdbx' ||
    channel === 'data:import-autologin' ||
    channel === 'data:import-bookmarks' ||
    channel === 'app:reset-browser-profile' ||
    channel === 'app:download-update'
  ) {
    return LONG_CALL_TIMEOUT_MS
  }
  return DEFAULT_CALL_TIMEOUT_MS
}

function operationLabel(channel: string): string {
  return CALL_LABELS[channel] ?? '操作'
}

function formatElapsed(milliseconds: number): string {
  return `${Math.max(0, milliseconds / 1000).toFixed(1)} 秒`
}

function withCallDeadline<T>(
  promise: Promise<T>,
  milliseconds: number,
  message: string
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = window.setTimeout(
      () => reject(new CallTimeoutError(message)),
      milliseconds
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

async function call<T>(channel: string, ...args: unknown[]): Promise<T> {
  const startedAt = Date.now()
  const label = operationLabel(channel)
  const timeout = callTimeout(channel)
  try {
    const normalizedArgs = [...args]
    while (
      normalizedArgs.length > 0 &&
      normalizedArgs[normalizedArgs.length - 1] === undefined
    ) {
      normalizedArgs.pop()
    }
    return await withCallDeadline(
      invoke<T>('backend_call', { channel, args: normalizedArgs }),
      timeout,
      `${label}未完成（已等待 ${formatElapsed(timeout)}）`
    )
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const normalized = message.replace(/^Error:\s*/i, '') || '操作失败'
    const elapsed = Date.now() - startedAt
    if (error instanceof CallTimeoutError) {
      if (channel === 'login:clear-session') {
        throw new Error(
          `${normalized}。已停止等待，请关闭对应浏览器窗口后重试`
        )
      }
      throw new Error(
        `${normalized}。当前阶段可能仍在处理中，请关闭当前窗口后重新打开确认结果`
      )
    }
    throw new Error(
      label === '操作'
        ? normalized
        : `${label}失败（耗时 ${formatElapsed(elapsed)}）：${normalized}`
    )
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
    create: () => call('vault:create'),
    unlock: (masterPassword) => call('vault:unlock', masterPassword),
    lock: () => call('vault:lock'),
    unlockTab: (input) => call('vault:tab-unlock', input),
    lockTab: (tabId) => call('vault:tab-lock', tabId),
    changeTabPassword: (input) => call('vault:tab-password', input)
  },
  sites: {
    list: (tabId) => call('sites:list', tabId),
    save: (input: SiteInput) => call('sites:save', input),
    delete: (siteId) => call('sites:delete', siteId),
    fetchIcon: (url) => call('sites:fetch-icon', { url })
  },
  tabs: {
    list: () => call('tabs:list'),
    info: () => call('tabs:info'),
    create: (input) => call('tabs:create', input),
    update: (tabId, input) => call('tabs:update', tabId, input),
    fileStatus: (tabId) => call('tabs:file-status', tabId),
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
    cancelIconFetchBatch: () => call('accounts:cancel-icon-fetch-batch'),
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
    listCredentialHistory: (accountId) =>
      call('accounts:list-credential-history', accountId),
    revealCredentialHistory: (accountId, historyId) =>
      call('accounts:reveal-credential-history', accountId, historyId),
    restoreCredentialHistory: (accountId, historyId) =>
      call('accounts:restore-credential-history', accountId, historyId),
    deleteCredentialHistory: (accountId, historyId) =>
      call('accounts:delete-credential-history', accountId, historyId),
    clearCredentialHistory: (accountId) =>
      call('accounts:clear-credential-history', accountId),
    copyUsername: (accountId) => call('accounts:copy-username', accountId),
    getOtp: (accountId) => call('accounts:otp', accountId),
    previewOtp: (secret, config) => call('accounts:otp-preview', { secret, config }),
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
    finishRecording: (name) => call('login:finish-recording', { name }),
    recordingSaveStatus: () => call('login:recording-save-status'),
    cancelRecording: () => call('login:cancel-recording'),
    undoRecordingStep: () => call('login:undo-recording-step'),
    pauseRecording: () => call('login:pause-recording'),
    resumeRecording: () => call('login:resume-recording'),
    testSelector: (input) => call('login:test-selector', input),
    clearSession: (accountId) => call('login:clear-session', accountId),
    getState: () => call('login:get-state'),
    setEmbeddedBounds: (bounds) => call('login:set-embedded-bounds', bounds),
    setEmbeddedActive: (accountId) => call('login:set-embedded-active', accountId),
    closeEmbeddedTabs: () => call('login:close-embedded-tabs')
  },
  browser: {
    listTabs: () => call('browser:list-tabs'),
    openUrl: (url) => call('browser:open-url', url),
    activate: (label) => call('browser:activate', label),
    close: (label) => call('browser:close', label),
    navigate: (label, url) => call('browser:navigate', { label, url }),
    back: (label) => call('browser:back', label),
    reload: (label) => call('browser:reload', label),
    setBounds: (label, bounds) => call('browser:set-bounds', { label, bounds }),
    hideAll: () => call('browser:hide-all')
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
    chooseRecordingDraftDirectory: () =>
      call('app:choose-recording-draft-directory'),
    getBackupLocation: () => call('app:get-backup-location'),
    chooseBackupLocation: () => call('app:choose-backup-location'),
    restoreDefaultBackupLocation: () =>
      call('app:restore-default-backup-location'),
    openBackupLocation: () => call('app:open-backup-location'),
    resolveDataLocationConflict: (directory, action) =>
      call('app:resolve-data-location-conflict', { directory, action }),
    restoreDefaultDataLocation: () => call('app:restore-default-data-location'),
    openDataLocation: () => call('app:open-data-location'),
    resetBrowserProfile: () => call('app:reset-browser-profile'),
    openRecordingDraftDirectory: () =>
      call('app:open-recording-draft-directory'),
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
    reportUiFailure: (input) => call('app:report-ui-failure', input),
    clearAllData: () => call('app:clear-all-data'),
    openPrivacy: () => call('app:open-privacy')
  },
  network: {
    testProxy: (settings) => call('network:test-proxy', settings)
  },
  data: {
    exportTab: (input) => call('data:export-vault', input),
    exportRecords: (input) => call('data:export-records', input),
    saveText: (input) => call('export:save-text', input),
    openExportPath: (path) => call('data:open-path', { path }),
    revealExportPath: (path) => call('data:reveal-export-path', { path }),
    exportCsvTemplate: () => call('data:export-csv-template'),
    chooseCsv: (input) => call('data:choose-csv', input),
    importCsv: (input) => call('data:import-csv', input),
    chooseDatabase: () => call('data:choose-database'),
    importDatabase: (input) => call('data:import-database', input),
    chooseKdbx: () => call('data:choose-kdbx'),
    importKdbx: (input) => call('data:import-kdbx', input),
    chooseAutologin: () => call('data:choose-autologin'),
    importAutologin: (input) => call('data:import-autologin', input),
    importBookmarks: () => call('data:import-bookmarks'),
    commitImport: (input) => call('data:commit-import', input),
    cancelImportPreview: (input) => call('data:cancel-import-preview', input),
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
    onBrowserTabs: (callback: (tabs: EmbeddedBrowserTab[]) => void) =>
      subscribe('browser:tabs', callback),
    onBrowserNewWindow: (
      callback: (event: EmbeddedBrowserNewWindowEvent) => void
    ) => subscribe('browser:new-window', callback),
    onAccountBatchIconFetchProgress: (
      callback: (progress: AccountBatchIconFetchProgress) => void
    ) => subscribe('accounts:icon-fetch-progress', callback),
    onUpdateState: (callback) => subscribe('app:update-state', callback)
  }
}

export function installTauriAutologinApi(): void {
  if (!isTauri() || window.autologin) return
  window.autologin = api
}
