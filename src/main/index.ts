import { app, BrowserWindow, clipboard, dialog, ipcMain, Menu, net, session, shell } from 'electron'
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import type { IpcMainEvent, IpcMainInvokeEvent } from 'electron'
import { autoUpdater } from 'electron-updater'
import { CancellationToken } from 'builder-util-runtime'
import {
  accountBatchIconFetchInputSchema,
  accountBatchIconInputSchema,
  accountBatchStrategyInputSchema,
  accountCreateInputSchema,
  accountDeleteManyInputSchema,
  accountDuplicateInputSchema,
  accountMoveInputSchema,
  accountRecipeUpdateInputSchema,
  accountReorderInputSchema,
  accountTabCreateInputSchema,
  accountTabUpdateInputSchema,
  accountUpdateInputSchema,
  appLogDeleteSchema,
  appLogQuerySchema,
  appSettingsPatchSchema,
  autologinSelectionImportSchema,
  changePasswordSchema,
  clipboardSecretInputSchema,
  csvImportInputSchema,
  dataExportInputSchema,
  dataLocationConflictInputSchema,
  favoriteGroupInputSchema,
  groupCreateInputSchema,
  groupDeleteInputSchema,
  groupMoveInputSchema,
  groupRenameInputSchema,
  kdbxSelectionImportSchema,
  loginBatchStartSchema,
  loginLogDeleteSchema,
  loginLogQuerySchema,
  loginStartSchema,
  masterPasswordSchema,
  proxyTestInputSchema,
  selectorTestInputSchema,
  siteIconFetchInputSchema,
  siteInputSchema
} from '@shared/schemas'
import {
  ACCOUNT_TAB_COLORS,
  DEFAULT_ACCOUNT_TAB_ID,
  GROUP_MAX_DEPTH,
  GROUP_PATH_SEPARATOR,
  UNGROUPED_GROUP_KEY
} from '@shared/types'
import {
  databaseFolderForSource,
  databaseFolderForTab,
  databaseExtensionForSource,
  databaseExtensionForTab,
  databaseNameFromFileName,
  databaseFileNameFor,
  isDatabaseNameFileSafe,
  normalizeDatabaseName,
  shouldWriteEncryptedTabSnapshot
} from '@shared/database-files'
import type {
  AccountBatchIconFetchResult,
  AccountBatchIconInput,
  AccountBatchStrategyInput,
  AccountDeleteResult,
  AccountMoveInput,
  AccountRecipeUpdateInput,
  AccountReorderInput,
  AccountTab,
  AccountTabUpdateInput,
  AccountWithSite,
  AboutInfo,
  AppUpdateState,
  AppSettings,
  BackupRecord,
  BookmarkVisitResult,
  DataImportResult,
  DataExportFormat,
  DataLocationChoiceResult,
  DataLocationConflictAction,
  DataLocationInfo,
  DeletedAccountWithSite,
  ExistingDatabaseSelection,
  FileOperationResult,
  GroupCreateInput,
  GroupDefinition,
  GroupMoveInput,
  GroupMoveResult,
  GroupRenameInput,
  KdbxSelection,
  LocalDatabaseFileSelection,
  LocalDatabaseKind,
  LocalDatabaseOpenSelection,
  LoginLogEntry,
  LoginLogDeleteResult,
  LoginLogQuery,
  LoginMode,
  LoginBatchState,
  LoginViewState,
  PasswordReveal,
  ProxySettings,
  ProxyTestResult,
  RecipeStep,
  SelectorTestInput,
  SelectorTestResult,
  Site,
  SiteInput,
  StoredAccount,
  UpdateCheckResult,
  VaultData,
  VaultStatus
} from '@shared/types'
import { BackupManager } from './backups'
import {
  appendAppLog,
  clearAppLogs,
  deleteAppLogs,
  readAppLogs,
  removeLegacyAccessLog
} from './app-log'
import {
  CSV_TEMPLATE,
  mergeAutologinSnapshot,
  mergeImportedLogins,
  parseBookmarksImport,
  parseCsvImport,
  parseKdbxImport,
  serializeTabBookmarks,
  serializeTabCsv,
  serializeTabKdbx,
  type ParsedImport
} from './data-transfer'
import {
  hasManagedDataDirectory,
  migrateDataDirectory,
  pathIsInside,
  readDataDirectory,
  recoverDataDirectoryFromInstall,
  writeDataDirectory
} from './data-location'
import { repairGroupDefinitions } from './group-definitions'
import {
  deleteLoginLogs,
  failureLogPath,
  LoginBatchManager,
  readLoginLogs
} from './login-batch'
import { clearManagedSessionDirectories, LoginSessionManager } from './login-session'
import {
  assertChromiumBrowser,
  discoverDefaultBrowser
} from './browser-discovery'
import { ExternalBrowserHost } from './external-browser'
import { isTrashItemExpired } from './trash-retention'
import { migrateTabDatabaseFiles } from './tab-database-files'
import { buildTabSnapshot, indexVaultDataByTab } from './tab-snapshots'
import { removeMissingDatabaseTabs } from './missing-database-tabs'
import {
  createUpdateDownloadProgressTracker,
  DIFFERENTIAL_FALLBACK_MESSAGE,
  trackUpdateDownloadProgress
} from './update-progress'
import { resolveUpdateCdnBaseUrl } from './update-source'
import {
  discoverManagedBrowserProfileIds,
  discoverManagedPartitionIds,
  SessionIndex
} from './session-index'
import { VaultManager } from './vault'

app.setName('AutoLogin')
app.setAppUserModelId('com.autologin.desktop')
const allowDevelopmentOverrides = !app.isPackaged
const disableSandboxForE2E =
  allowDevelopmentOverrides && process.env.AUTOLOGIN_E2E_DISABLE_SANDBOX === '1'

if (disableSandboxForE2E) {
  app.commandLine.appendSwitch('no-sandbox')
  app.commandLine.appendSwitch('disable-gpu')
}
if (allowDevelopmentOverrides && process.env.AUTOLOGIN_USER_DATA_DIR) {
  app.setPath('userData', resolve(process.env.AUTOLOGIN_USER_DATA_DIR))
}

let mainWindow: BrowserWindow | null = null
let loginManager: LoginSessionManager | null = null
let batchManager: LoginBatchManager | null = null
let vault: VaultManager
let backupManager: BackupManager
let sessionIndex: SessionIndex
let clipboardClearTimer: NodeJS.Timeout | null = null
let configDirectory = ''
let dataLocationPointerDirectory = ''
let dataDirectory = ''
let updateState: AppUpdateState = {
  phase: 'idle',
  currentVersion: app.getVersion(),
  interactive: false
}
let updaterInitialized = false
let startupUpdateCheckStarted = false
let updateDownloadToken: CancellationToken | null = null
let updateDownloadCancelled = false
let updateDifferentialFallbackDetected = false
let updateDownloadProgressTracker = createUpdateDownloadProgressTracker()
let lastLoggedBatchId: string | null = null
let diagnosticsRegistered = false
const pendingKdbxSelections = new Map<
  string,
  { path: string; fileName: string; size: number; expiresAt: number }
>()
const pendingAutologinSelections = new Map<
  string,
  { path: string; fileName: string; size: number; expiresAt: number }
>()
const pendingDatabaseSelections = new Map<
  string,
  {
    kind: LocalDatabaseKind
    path: string
    fileName: string
    size: number
    expiresAt: number
  }
>()
const pendingNewDatabaseTabIds = new Set<string>()

const REPOSITORY_URL =
  process.env.AUTOLOGIN_REPOSITORY_URL?.trim() ||
  ['https:', '//github.com', '/AptimLvStic/AutoLogin'].join('')
const RELEASES_URL = `${REPOSITORY_URL}/releases`
const UPDATE_OWNER = process.env.AUTOLOGIN_UPDATE_OWNER?.trim() || 'AptimLvStic'
const UPDATE_REPO = process.env.AUTOLOGIN_UPDATE_REPO?.trim() || 'AutoLogin'
const GITHUB_UPDATE_FEED = {
  provider: 'github' as const,
  owner: UPDATE_OWNER,
  repo: UPDATE_REPO
}

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
}

app.whenReady().then(() => {
  Menu.setApplicationMenu(null)
  session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => {
    callback(false)
  })
  configDirectory = app.getPath('userData')
  dataLocationPointerDirectory =
    allowDevelopmentOverrides && process.env.AUTOLOGIN_DATA_LOCATION_POINTER_DIR
      ? resolve(process.env.AUTOLOGIN_DATA_LOCATION_POINTER_DIR)
      : join(app.getPath('appData'), 'AutoLogin')
  dataDirectory = readDataDirectory(
    dataLocationPointerDirectory,
    [configDirectory],
    configDirectory
  )
  dataDirectory = recoverDataDirectoryFromInstall(
    configDirectory,
    dataDirectory,
    dirname(app.getPath('exe')),
    dataLocationPointerDirectory
  )
  writeDataDirectory(dataLocationPointerDirectory, dataDirectory)
  if (dataLocationPointerDirectory !== configDirectory) {
    writeDataDirectory(configDirectory, dataDirectory)
  }
  initializeDataStores()
  appendAppLog(dataDirectory, {
    level: 'info',
    category: 'startup',
    message: `AutoLogin v${app.getVersion()} 已启动`
  })
  registerDiagnosticLogging()
  try {
    backupManager.createFromVault(vault.path)
  } catch {
    // Startup backups are best-effort and must never block unlocking the app.
  }
  initializeAutoUpdater()
  createWindow()
  ensureLoginManagers()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) {
      mainWindow.restore()
    }
    mainWindow.focus()
  }
})

app.on('window-all-closed', () => {
  void closeLoginManagers()
  vault?.lock()
  app.quit()
})

app.on('before-quit', () => {
  void closeLoginManagers()
  vault?.lock()
})

function createWindow(): void {
  const window = new BrowserWindow({
    width: 1180,
    height: 760,
    minWidth: 960,
    minHeight: 640,
    show: false,
    thickFrame: true,
    backgroundColor: '#F7F8FA',
    title: 'AutoLogin',
    icon: app.isPackaged
      ? join(process.resourcesPath, 'icon.ico')
      : join(__dirname, '../../resources/icon.ico'),
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: '#F7F8FA',
      symbolColor: '#1F2328',
      height: 40
    },
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: !disableSandboxForE2E,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
      allowRunningInsecureContent: false,
      spellcheck: false,
      devTools: true
    }
  })
  mainWindow = window

  window.once('ready-to-show', () => {
    window.show()
    scheduleStartupUpdateCheck()
  })

  if (vault?.status().unlocked) {
    applyInterfaceScale(vault.getSettings().interfaceScale)
  }

  window.on('closed', () => {
    void closeLoginManagers()
    mainWindow = null
  })

  window.webContents.on('will-navigate', (event) => {
    event.preventDefault()
  })
  window.webContents.on('before-input-event', (event, input) => {
    vault?.touch()
    if (
      input.type === 'keyDown' &&
      !input.control &&
      !input.alt &&
      !input.meta &&
      input.key === 'F12'
    ) {
      event.preventDefault()
      window.webContents.toggleDevTools()
    }
  })
  window.webContents.on('render-process-gone', (_event, details) => {
    appendAppLog(dataDirectory, {
      level: 'error',
      category: 'error',
      message: '渲染进程异常退出',
      details: `原因：${details.reason}，退出码：${details.exitCode}`
    })
  })
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (isHttpUrl(url)) {
      void shell.openExternal(url)
    }
    return { action: 'deny' }
  })

  ensureLoginManagers()

  if (allowDevelopmentOverrides && process.env.ELECTRON_RENDERER_URL) {
    void window.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void window.loadFile(join(__dirname, '../renderer/index.html'))
  }

  registerIpc()
}

function registerDiagnosticLogging(): void {
  if (diagnosticsRegistered) return
  diagnosticsRegistered = true
  process.on('uncaughtExceptionMonitor', (error) => {
    appendAppLog(dataDirectory, {
      level: 'error',
      category: 'error',
      message: '主进程未捕获异常',
      details: sanitizeLogDetails(`${error.name}: ${error.message}`)
    })
  })
  process.on('unhandledRejection', (reason) => {
    appendAppLog(dataDirectory, {
      level: 'error',
      category: 'error',
      message: '主进程未处理 Promise 拒绝',
      details: sanitizeLogDetails(
        reason instanceof Error ? `${reason.name}: ${reason.message}` : String(reason)
      )
    })
  })
}

function initializeDataStores(): void {
  if (removeLegacyAccessLog(dataDirectory)) {
    appendAppLog(dataDirectory, {
      level: 'info',
      category: 'migration',
      message: '已删除旧版访问日志数据'
    })
  }
  vault = new VaultManager(dataDirectory, () => {
    void closeLoginManagers()
    sendToRenderer('vault:locked')
  })
  vault.setBeforeSaveListener((data) => {
    pruneMissingDatabaseTabs(data)
  })
  vault.setSaveListener((data) => syncTabSnapshotFiles(data))
  backupManager = new BackupManager(dataDirectory)
  sessionIndex = new SessionIndex(dataDirectory)
}

function syncTabSnapshotFiles(data: VaultData): void {
  const tabsDirectory = join(dataDirectory, 'tabs')
  try {
    mkdirSync(tabsDirectory, { recursive: true })
  } catch (error) {
    appendAppLog(dataDirectory, {
      level: 'error',
      category: 'error',
      message: '无法创建标签页数据库目录',
      details: sanitizeLogDetails(error instanceof Error ? error.message : String(error))
    })
    return
  }

  const dataByTab = indexVaultDataByTab(data)
  for (const tab of data.tabs) {
    const databasePath = tabDatabasePath(tab)
    try {
      if (shouldWriteEncryptedTabSnapshot(tab)) {
        if (
          !pendingNewDatabaseTabIds.has(tab.id) &&
          !existsSync(databasePath)
        ) {
          continue
        }
        const snapshot = buildTabSnapshot(
          data,
          tab,
          dataByTab.get(tab.id),
          getTabGroupOrder(data, tab.id)
        )
        vault.writeEncryptedSnapshot(databasePath, snapshot)
        pendingNewDatabaseTabIds.delete(tab.id)
      } else if (tab.source === 'bookmarks') {
        if (
          !pendingNewDatabaseTabIds.has(tab.id) &&
          !existsSync(databasePath)
        ) {
          continue
        }
        mkdirSync(dirname(databasePath), { recursive: true })
        writeFileSync(databasePath, serializeTabBookmarks(data, tab.id), {
          encoding: 'utf8',
          mode: 0o600
        })
        pendingNewDatabaseTabIds.delete(tab.id)
      }
    } catch (error) {
      appendAppLog(dataDirectory, {
        level: 'error',
        category: 'error',
        message: `标签页数据库写入失败：${tab.name}`,
        details: sanitizeLogDetails(error instanceof Error ? error.message : String(error))
      })
    }
  }
}

function tabDatabasePath(tab: AccountTab): string {
  return join(
    dataDirectory,
    'tabs',
    databaseFolderForTab(tab),
    tab.databaseFileName ??
      databaseFileNameFor(tab.name, databaseExtensionForTab(tab))
  )
}

function legacyTabDatabasePath(tab: AccountTab): string {
  return join(
    dataDirectory,
    'tabs',
    tab.databaseFileName ??
      databaseFileNameFor(tab.name, databaseExtensionForTab(tab))
  )
}

function tabDatabaseFileExists(tab: AccountTab): boolean {
  return (
    pendingNewDatabaseTabIds.has(tab.id) ||
    existsSync(tabDatabasePath(tab)) ||
    existsSync(legacyTabDatabasePath(tab))
  )
}

function tabRevealDirectory(tab: AccountTab): string {
  const tabsDirectory = join(dataDirectory, 'tabs', databaseFolderForTab(tab))
  const databasePath = tabDatabasePath(tab)
  const legacyPath = legacyTabDatabasePath(tab)
  mkdirSync(tabsDirectory, { recursive: true })
  if (existsSync(databasePath)) return dirname(databasePath)
  if (existsSync(legacyPath)) return dirname(legacyPath)
  return tabsDirectory
}

function pruneMissingDatabaseTabs(data: VaultData): void {
  const result = removeMissingDatabaseTabs(
    data,
    (tab) => tabDatabaseFileExists(tab),
    { hiddenOnly: true }
  )
  if (result.removedTabs.length === 0) return

  for (const accountId of result.removedAccountIds) {
    sessionIndex.remove(accountId)
    clearManagedSessionDirectories(dataDirectory, accountId)
  }
  appendAppLog(dataDirectory, {
    level: 'warning',
    category: 'data',
    message: `已清理 ${result.removedTabs.length} 个文件已丢失的标签页`,
    details: result.removedTabs.map((tab) => tab.name).join('、')
  })
}

function purgeMissingDatabaseTabs(includeVisible = false): void {
  const data = vault.requireData()
  const result = removeMissingDatabaseTabs(
    data,
    (tab) => tabDatabaseFileExists(tab),
    { hiddenOnly: !includeVisible }
  )
  if (result.removedTabs.length === 0) return
  vault.save()

  for (const accountId of result.removedAccountIds) {
    sessionIndex.remove(accountId)
    clearManagedSessionDirectories(dataDirectory, accountId)
  }
  appendAppLog(dataDirectory, {
    level: 'warning',
    category: 'data',
    message: `已清理 ${result.removedTabs.length} 个文件已丢失的标签页`,
    details: result.removedTabs.map((tab) => tab.name).join('、')
  })
}

function reconcileTabDatabaseFiles(): void {
  const data = vault.requireData()
  let result
  try {
    result = migrateTabDatabaseFiles(data, join(dataDirectory, 'tabs'))
  } catch (error) {
    appendAppLog(dataDirectory, {
      level: 'error',
      category: 'data',
      message: '数据库文件迁移失败',
      details: sanitizeLogDetails(
        error instanceof Error ? error.message : String(error)
      )
    })
    syncTabSnapshotFiles(data)
    return
  }
  for (const issue of result.issues) {
    appendAppLog(dataDirectory, {
      level: 'error',
      category: 'data',
      message: `数据库文件迁移失败：${issue.tabName}`,
      details: sanitizeLogDetails(issue.message)
    })
  }
  if (result.changed) {
    vault.save()
  } else {
    syncTabSnapshotFiles(data)
  }
  purgeMissingDatabaseTabs()
  syncTabSnapshotFiles(data)
}

function nextLocalDatabaseName(data: VaultData): string {
  let highest = 0
  for (const tab of data.tabs) {
    const name = tab.name.trim()
    if (name === '本地数据库') {
      highest = Math.max(highest, 1)
      continue
    }
    const match = /^本地数据库\s*(\d+)$/.exec(name)
    if (!match) continue
    highest = Math.max(highest, Number(match[1]) || 0)
  }
  return highest === 0 ? '本地数据库' : `本地数据库${highest + 1}`
}

function ensureLoginManagers(): void {
  if (!loginManager) {
    loginManager = new LoginSessionManager(
      vault,
      dataDirectory,
      allowDevelopmentOverrides ? process.env.AUTOLOGIN_BROWSER_EXECUTABLE : undefined,
      allowDevelopmentOverrides && process.env.AUTOLOGIN_BROWSER_HEADLESS === '1',
      (state) => sendToRenderer('login:state', state)
    )
  }
  if (!batchManager) {
    batchManager = new LoginBatchManager(
      vault,
      dataDirectory,
      allowDevelopmentOverrides ? process.env.AUTOLOGIN_BROWSER_EXECUTABLE : undefined,
      allowDevelopmentOverrides && process.env.AUTOLOGIN_BROWSER_HEADLESS === '1',
      (state) => {
        sendToRenderer('login:batch-state', state)
        if (!state.active && state.finishedAt && lastLoggedBatchId !== state.batchId) {
          lastLoggedBatchId = state.batchId
          appendAppLog(dataDirectory, {
            level: state.failed > 0 || state.canceled > 0 ? 'warning' : 'success',
            category: 'login',
            message:
              state.canceled > 0
                ? `批量登录已中断：成功 ${state.success}，失败 ${state.failed}，已取消 ${state.canceled}`
                : `批量登录完成：成功 ${state.success}，失败 ${state.failed}，需人工处理 ${state.manual}`,
            details: `批次 ${state.batchId}，共 ${state.total} 个账号`
          })
        }
      }
    )
  }
}

async function closeLoginManagers(): Promise<void> {
  const currentLoginManager = loginManager
  const currentBatchManager = batchManager
  loginManager = null
  batchManager = null
  await Promise.allSettled([
    currentLoginManager?.close() ?? Promise.resolve(),
    currentBatchManager?.close() ?? Promise.resolve()
  ])
}

function registerIpc(): void {
  ipcMain.handle('vault:status', (event) => {
    assertTrustedSender(event)
    return vault.status()
  })
  ipcMain.handle('vault:create', async (event, password: unknown) => {
    assertTrustedSender(event)
    const parsed = masterPasswordSchema.safeParse(password)
    if (!parsed.success) {
      throw new Error(firstIssue(parsed.error))
    }
    const status = await vault.create(parsed.data)
    for (const tab of vault.requireData().tabs) {
      if (shouldWriteEncryptedTabSnapshot(tab)) {
        pendingNewDatabaseTabIds.add(tab.id)
      }
    }
    appendAppLog(dataDirectory, {
      level: 'success',
      category: 'vault',
      message: '本地保险库已创建'
    })
    sessionIndex.replace([])
    ensureLoginManagers()
    applyInterfaceScale(vault.getSettings().interfaceScale)
    await applySystemProxy(vault.getSettings().proxy)
    reconcileTabDatabaseFiles()
    return status
  })
  ipcMain.handle('vault:unlock', async (event, password: unknown) => {
    assertTrustedSender(event)
    const parsed = masterPasswordSchema.safeParse(password)
    if (!parsed.success) {
      throw new Error(firstIssue(parsed.error))
    }
    const status = await vault.unlock(parsed.data)
    appendAppLog(dataDirectory, {
      level: 'success',
      category: 'vault',
      message: '保险库已解锁'
    })
    sessionIndex.replace(vault.requireData().accounts.map((account) => account.id))
    ensureLoginManagers()
    applyInterfaceScale(vault.getSettings().interfaceScale)
    await applySystemProxy(vault.getSettings().proxy)
    reconcileTabDatabaseFiles()
    return status
  })
  ipcMain.handle('vault:lock', (event) => {
    assertTrustedSender(event)
    void closeLoginManagers()
    const status = vault.lock()
    appendAppLog(dataDirectory, {
      level: 'info',
      category: 'vault',
      message: '保险库已锁定'
    })
    return status
  })
  ipcMain.handle('vault:change-password', async (event, payload: unknown) => {
    assertTrustedSender(event)
    const parsed = changePasswordSchema.safeParse(payload)
    if (!parsed.success) {
      throw new Error(firstIssue(parsed.error))
    }
    await vault.changePassword(parsed.data.currentPassword, parsed.data.nextPassword)
  })

  ipcMain.handle('tabs:list', (event): AccountTab[] => {
    assertTrustedSender(event)
    return structuredClone(vault.requireData().tabs)
  })
  ipcMain.handle('tabs:file-status', (event, tabId: unknown): { exists: boolean } => {
    assertTrustedSender(event)
    const id = requireId(tabId)
    const tab = vault.requireData().tabs.find((entry) => entry.id === id)
    if (!tab) {
      throw new Error('标签页不存在')
    }
    return { exists: tabDatabaseFileExists(tab) }
  })
  ipcMain.handle('tabs:create', (event, payload: unknown): AccountTab => {
    assertTrustedSender(event)
    const parsed = accountTabCreateInputSchema.safeParse(payload)
    if (!parsed.success) {
      throw new Error(firstIssue(parsed.error))
    }
    return createAccountTab(parsed.data)
  })
  ipcMain.handle('tabs:update', (event, tabId: unknown, payload: unknown): AccountTab => {
    assertTrustedSender(event)
    const parsed = accountTabUpdateInputSchema.safeParse(payload)
    if (!parsed.success) {
      throw new Error(firstIssue(parsed.error))
    }
    return updateAccountTab(requireId(tabId), parsed.data)
  })
  ipcMain.handle('tabs:delete', async (event, tabId: unknown) => {
    assertTrustedSender(event)
    await deleteAccountTab(requireId(tabId))
  })
  ipcMain.handle('tabs:purge', async (event, tabId: unknown) => {
    assertTrustedSender(event)
    await purgeAccountTab(requireId(tabId))
  })
  ipcMain.handle('tabs:reveal-path', (event, tabId: unknown): string => {
    assertTrustedSender(event)
    const id = requireId(tabId)
    const tab = vault.requireData().tabs.find((entry) => entry.id === id)
    if (!tab) {
      throw new Error('标签页不存在')
    }
    return tabRevealDirectory(tab)
  })
  ipcMain.handle('tabs:reveal', async (event, tabId: unknown) => {
    assertTrustedSender(event)
    const id = requireId(tabId)
    const tab = vault.requireData().tabs.find((entry) => entry.id === id)
    if (!tab) {
      throw new Error('标签页不存在')
    }
    const targetDirectory = tabRevealDirectory(tab)
    const error = await shell.openPath(targetDirectory)
    if (error) {
      throw new Error(`无法打开数据库所在文件夹：${error}`)
    }
  })

  ipcMain.handle('sites:list', (event, tabId: unknown) => {
    assertTrustedSender(event)
    const scopedTabId = requireOptionalTabId(tabId)
    return structuredClone(
      vault
        .requireData()
        .sites.filter((site) => !scopedTabId || site.tabId === scopedTabId)
    )
  })
  ipcMain.handle('sites:fetch-icon', async (event, payload: unknown) => {
    assertTrustedSender(event)
    const parsed = siteIconFetchInputSchema.safeParse(payload)
    if (!parsed.success) {
      throw new Error(firstIssue(parsed.error))
    }
    return fetchSiteIcon(parsed.data.url)
  })
  ipcMain.handle('sites:save', (event, payload: unknown) => {
    assertTrustedSender(event)
    const parsed = siteInputSchema.safeParse(payload)
    if (!parsed.success) {
      throw new Error(firstIssue(parsed.error))
    }
    const site = saveSite(parsed.data)
    appendAppLog(dataDirectory, {
      level: 'success',
      category: 'data',
      message: `${parsed.data.id ? '站点已更新' : '站点已创建'}：${site.name}`,
      details: safeLogUrl(site.startUrl)
    })
    return site
  })
  ipcMain.handle('sites:delete', (event, siteId: unknown) => {
    assertTrustedSender(event)
    const id = requireId(siteId)
    const data = vault.requireData()
    if (data.accounts.some((account) => account.siteId === id)) {
      throw new Error('请先删除该站点下的账号')
    }
    data.sites = data.sites.filter((site) => site.id !== id)
    vault.save()
    appendAppLog(dataDirectory, {
      level: 'info',
      category: 'data',
      message: '站点已删除'
    })
  })

  ipcMain.handle('groups:list', (event, tabId: unknown): GroupDefinition[] => {
    assertTrustedSender(event)
    return listGroups(requireOptionalTabId(tabId))
  })
  ipcMain.handle('groups:create', (event, payload: unknown): GroupDefinition => {
    assertTrustedSender(event)
    const parsed = groupCreateInputSchema.safeParse(payload)
    if (!parsed.success) {
      throw new Error(firstIssue(parsed.error))
    }
    const group = createGroup(parsed.data)
    appendAppLog(dataDirectory, {
      level: 'success',
      category: 'data',
      message: `分组已创建：${group.path}`
    })
    return group
  })
  ipcMain.handle('groups:move', (event, payload: unknown): GroupMoveResult => {
    assertTrustedSender(event)
    const parsed = groupMoveInputSchema.safeParse(payload)
    if (!parsed.success) {
      throw new Error(firstIssue(parsed.error))
    }
    const result = moveGroup(parsed.data)
    appendAppLog(dataDirectory, {
      level: 'success',
      category: 'data',
      message: `分组已移动：${result.fromPath} → ${result.toPath}`
    })
    return result
  })
  ipcMain.handle('groups:list-favorites', (event) => {
    assertTrustedSender(event)
    return [...vault.requireData().favoriteGroups]
  })
  ipcMain.handle('groups:set-favorite', (event, payload: unknown) => {
    assertTrustedSender(event)
    const parsed = favoriteGroupInputSchema.safeParse(payload)
    if (!parsed.success) {
      throw new Error(firstIssue(parsed.error))
    }
    const data = vault.requireData()
    const groupName = parsed.data.groupName.trim()
    if (parsed.data.favorite) {
      data.favoriteGroups = [...new Set([...data.favoriteGroups, groupName])]
    } else {
      data.favoriteGroups = data.favoriteGroups.filter((entry) => entry !== groupName)
    }
    vault.save()
    return [...data.favoriteGroups]
  })
  ipcMain.handle('groups:rename', (event, payload: unknown) => {
    assertTrustedSender(event)
    const parsed = groupRenameInputSchema.safeParse(payload)
    if (!parsed.success) {
      throw new Error(firstIssue(parsed.error))
    }
    renameGroup(parsed.data)
    appendAppLog(dataDirectory, {
      level: 'success',
      category: 'data',
      message: `分组已重命名：${parsed.data.fromName} → ${parsed.data.toName}`
    })
  })
  ipcMain.handle('groups:delete', (event, payload: unknown) => {
    assertTrustedSender(event)
    const parsed = groupDeleteInputSchema.safeParse(payload)
    if (!parsed.success) {
      throw new Error(firstIssue(parsed.error))
    }
    const affected = deleteGroup(parsed.data.groupName, parsed.data.tabId)
    appendAppLog(dataDirectory, {
      level: 'success',
      category: 'data',
      message: `分组已删除：${parsed.data.groupName}`,
      details: `${affected} 个站点已移至未分组`
    })
    return affected
  })

  ipcMain.handle('accounts:list', (event) => {
    assertTrustedSender(event)
    return listAccounts()
  })
  ipcMain.handle('accounts:create', (event, payload: unknown) => {
    assertTrustedSender(event)
    const parsed = accountCreateInputSchema.safeParse(payload)
    if (!parsed.success) {
      throw new Error(firstIssue(parsed.error))
    }
    const account = createAccount(parsed.data)
    appendAppLog(dataDirectory, {
      level: 'success',
      category: 'data',
      message: `账号已创建：${account.site.name}`,
      details: `用户名：${safeLogValue(account.username)}`
    })
    return account
  })
  ipcMain.handle('accounts:update', (event, accountId: unknown, payload: unknown) => {
    assertTrustedSender(event)
    const id = requireId(accountId)
    const parsed = accountUpdateInputSchema.safeParse(payload)
    if (!parsed.success) {
      throw new Error(firstIssue(parsed.error))
    }
    const account = updateAccount(id, parsed.data)
    appendAppLog(dataDirectory, {
      level: 'success',
      category: 'data',
      message: `账号已更新：${account.site.name}`,
      details: `用户名：${safeLogValue(account.username)}`
    })
    return account
  })
  ipcMain.handle('accounts:set-strategy-batch', (event, payload: unknown) => {
    assertTrustedSender(event)
    const parsed = accountBatchStrategyInputSchema.safeParse(payload)
    if (!parsed.success) {
      throw new Error(firstIssue(parsed.error))
    }
    const accounts = setAccountStrategyBatch(parsed.data)
    appendAppLog(dataDirectory, {
      level: 'success',
      category: 'data',
      message: `批量更新 ${accounts.length} 个账号的登录配置`
    })
    return accounts
  })
  ipcMain.handle('accounts:set-icon-batch', (event, payload: unknown) => {
    assertTrustedSender(event)
    const parsed = accountBatchIconInputSchema.safeParse(payload)
    if (!parsed.success) {
      throw new Error(firstIssue(parsed.error))
    }
    const accounts = setAccountIconBatch(parsed.data)
    appendAppLog(dataDirectory, {
      level: 'success',
      category: 'data',
      message: `批量更新 ${accounts.length} 个账号的 Logo`
    })
    return accounts
  })
  ipcMain.handle('accounts:fetch-icons-batch', async (event, payload: unknown) => {
    assertTrustedSender(event)
    const parsed = accountBatchIconFetchInputSchema.safeParse(payload)
    if (!parsed.success) {
      throw new Error(firstIssue(parsed.error))
    }
    const result = await fetchAccountIconsFromSites(parsed.data)
    appendAppLog(dataDirectory, {
      level: result.failedSites.length > 0 ? 'warning' : 'success',
      category: 'data',
      message: `批量获取站点图标：更新 ${result.updatedSites} 个站点、${result.updatedAccounts} 个账号`,
      ...(result.failedSites.length > 0
        ? { details: `未获取到图标：${result.failedSites.join('、')}` }
        : {})
    })
    return result
  })
  ipcMain.handle('accounts:duplicate', (event, payload: unknown) => {
    assertTrustedSender(event)
    const parsed = accountDuplicateInputSchema.safeParse(payload)
    if (!parsed.success) {
      throw new Error(firstIssue(parsed.error))
    }
    const accounts = duplicateAccounts(parsed.data)
    appendAppLog(dataDirectory, {
      level: 'success',
      category: 'data',
      message: `已复制 ${accounts.length} 个账号`,
      details: accounts.map((account) => account.site.name).join('、')
    })
    return accounts
  })
  ipcMain.handle(
    'accounts:set-active-recipe',
    (event, accountId: unknown, recipeId: unknown) => {
      assertTrustedSender(event)
      const id = requireId(accountId)
      const nextRecipeId = recipeId === undefined ? undefined : requireId(recipeId)
      return setActiveAccountRecipe(id, nextRecipeId)
    }
  )
  ipcMain.handle('accounts:delete-recipe', (event, accountId: unknown, recipeId: unknown) => {
    assertTrustedSender(event)
    return deleteAccountRecipe(requireId(accountId), requireId(recipeId))
  })
  ipcMain.handle('accounts:update-recipe', (event, payload: unknown) => {
    assertTrustedSender(event)
    const parsed = accountRecipeUpdateInputSchema.safeParse(payload)
    if (!parsed.success) {
      throw new Error(firstIssue(parsed.error))
    }
    return updateAccountRecipe(parsed.data)
  })
  ipcMain.handle('accounts:reorder', (event, payload: unknown) => {
    assertTrustedSender(event)
    const parsed = accountReorderInputSchema.safeParse(payload)
    if (!parsed.success) {
      throw new Error(firstIssue(parsed.error))
    }
    return reorderAccounts(parsed.data)
  })
  ipcMain.handle('accounts:move-to-group', (event, payload: unknown) => {
    assertTrustedSender(event)
    const parsed = accountMoveInputSchema.safeParse(payload)
    if (!parsed.success) {
      throw new Error(firstIssue(parsed.error))
    }
    return moveAccountsToGroup(parsed.data)
  })
  ipcMain.handle('accounts:delete', async (event, accountId: unknown) => {
    assertTrustedSender(event)
    const id = requireId(accountId)
    const data = vault.requireData()
    const account = data.accounts.find((entry) => entry.id === id)
    if (!account) {
      throw new Error('账号不存在')
    }
    await batchManager?.clearSession(id)
    await loginManager?.clearSession(id)
    clearManagedSessionDirectories(dataDirectory, id)
    moveAccountsToTrash([id])
    sessionIndex.remove(id)
    appendAppLog(dataDirectory, {
      level: 'warning',
      category: 'data',
      message: '账号已移入回收站'
    })
  })
  ipcMain.handle(
    'accounts:delete-many',
    async (event, payload: unknown): Promise<AccountDeleteResult> => {
      assertTrustedSender(event)
      const parsed = accountDeleteManyInputSchema.safeParse(payload)
      if (!parsed.success) {
        throw new Error(firstIssue(parsed.error))
      }
      const data = vault.requireData()
      const requestedIds = new Set(parsed.data)
      const existingIds = data.accounts
        .filter((account) => requestedIds.has(account.id))
        .map((account) => account.id)
      if (existingIds.length === 0) {
        return { deleted: 0 }
      }

      for (const id of existingIds) {
        await batchManager?.clearSession(id)
        await loginManager?.clearSession(id)
        clearManagedSessionDirectories(dataDirectory, id)
      }
      const deletedSet = new Set(existingIds)
      moveAccountsToTrash(existingIds)
      for (const id of existingIds) sessionIndex.remove(id)
      appendAppLog(dataDirectory, {
        level: 'warning',
        category: 'data',
        message: `已将 ${existingIds.length} 个账号移入回收站`
      })
      return { deleted: existingIds.length }
    }
  )
  ipcMain.handle('accounts:list-deleted', (event, tabId: unknown): DeletedAccountWithSite[] => {
    assertTrustedSender(event)
    return listDeletedAccounts(requireOptionalTabId(tabId))
  })
  ipcMain.handle('accounts:restore', (event, accountId: unknown): AccountWithSite => {
    assertTrustedSender(event)
    const account = restoreDeletedAccount(requireId(accountId))
    appendAppLog(dataDirectory, {
      level: 'success',
      category: 'data',
      message: `账号已恢复：${account.site.name}`
    })
    return account
  })
  ipcMain.handle('accounts:restore-many', (event, payload: unknown): AccountDeleteResult => {
    assertTrustedSender(event)
    const parsed = accountDeleteManyInputSchema.safeParse(payload)
    if (!parsed.success) {
      throw new Error(firstIssue(parsed.error))
    }
    const restored = parsed.data.filter((accountId) => {
      try {
        restoreDeletedAccount(accountId)
        return true
      } catch {
        return false
      }
    }).length
    appendAppLog(dataDirectory, {
      level: 'success',
      category: 'data',
      message: `已从回收站恢复 ${restored} 个账号`
    })
    return { deleted: restored }
  })
  ipcMain.handle('accounts:purge', (event, accountId: unknown) => {
    assertTrustedSender(event)
    purgeDeletedAccount(requireId(accountId))
    appendAppLog(dataDirectory, {
      level: 'warning',
      category: 'data',
      message: '账号已从回收站永久删除'
    })
  })
  ipcMain.handle('accounts:purge-many', (event, payload: unknown): AccountDeleteResult => {
    assertTrustedSender(event)
    const parsed = accountDeleteManyInputSchema.safeParse(payload)
    if (!parsed.success) {
      throw new Error(firstIssue(parsed.error))
    }
    const deleted = purgeDeletedAccounts(parsed.data)
    appendAppLog(dataDirectory, {
      level: 'warning',
      category: 'data',
      message: `已从回收站永久删除 ${deleted} 个账号`
    })
    return { deleted }
  })
  ipcMain.handle('accounts:reveal', (event, accountId: unknown): PasswordReveal => {
    assertTrustedSender(event)
    const id = requireId(accountId)
    const account = vault.requireData().accounts.find((entry) => entry.id === id)
    if (!account) {
      throw new Error('账号不存在')
    }
    return { password: account.password, expiresAt: Date.now() + 10_000 }
  })
  ipcMain.handle('accounts:copy', async (event, accountId: unknown) => {
    assertTrustedSender(event)
    const id = requireId(accountId)
    const account = vault.requireData().accounts.find((entry) => entry.id === id)
    if (!account) {
      throw new Error('账号不存在')
    }
    await copySecret(account.password)
    appendAppLog(dataDirectory, {
      level: 'info',
      category: 'data',
      message: '账号密码已复制到剪贴板'
    })
  })
  ipcMain.handle('accounts:copy-username', async (event, accountId: unknown) => {
    assertTrustedSender(event)
    const id = requireId(accountId)
    const account = vault.requireData().accounts.find((entry) => entry.id === id)
    if (!account) {
      throw new Error('账号不存在')
    }
    await clipboard.writeText(account.username)
    appendAppLog(dataDirectory, {
      level: 'info',
      category: 'data',
      message: '账号用户名已复制到剪贴板'
    })
  })
  ipcMain.handle('accounts:copy-url', async (event, accountId: unknown) => {
    assertTrustedSender(event)
    const id = requireId(accountId)
    const data = vault.requireData()
    const account = data.accounts.find((entry) => entry.id === id)
    if (!account) {
      throw new Error('账号不存在')
    }
    const site = data.sites.find((entry) => entry.id === account.siteId)
    if (!site) {
      throw new Error('站点不存在')
    }
    await clipboard.writeText(site.startUrl)
    appendAppLog(dataDirectory, {
      level: 'info',
      category: 'data',
      message: '站点 URL 已复制到剪贴板',
      details: safeLogUrl(site.startUrl)
    })
  })
  ipcMain.handle('clipboard:write-secret', async (event, payload: unknown) => {
    assertTrustedSender(event)
    const parsed = clipboardSecretInputSchema.safeParse(payload)
    if (!parsed.success) {
      throw new Error(firstIssue(parsed.error))
    }
    try {
      await copySecret(parsed.data.value)
      appendAppLog(dataDirectory, {
        level: 'info',
        category: 'clipboard',
        message: '密码生成器结果已复制到剪贴板'
      })
    } catch (error) {
      appendAppLog(dataDirectory, {
        level: 'error',
        category: 'error',
        message: '复制密码失败',
        details: sanitizeLogDetails(
          error instanceof Error ? error.message : String(error)
        )
      })
      throw new Error('复制密码失败')
    }
  })
  ipcMain.handle(
    'bookmarks:visit',
    async (event, accountId: unknown): Promise<BookmarkVisitResult> => {
      assertTrustedSender(event)
      const id = requireId(accountId)
      const data = vault.requireData()
      const account = data.accounts.find((entry) => entry.id === id)
      const site = account
        ? data.sites.find((entry) => entry.id === account.siteId)
        : null
      const tab = account
        ? data.tabs.find((entry) => entry.id === account.tabId)
        : null
      if (!account || !site || tab?.source !== 'bookmarks') {
        throw new Error('书签不存在')
      }
      let status: 'success' | 'error' = 'success'
      let reason = '已在系统默认浏览器中打开'
      try {
        ensureLoginManagers()
        if (!batchManager) {
          throw new Error('本地浏览器尚未准备好')
        }
        await batchManager.openUrl(site.startUrl)
      } catch (error) {
        status = 'error'
        reason =
          error instanceof Error ? error.message : '无法在系统默认浏览器中打开'
      }
      appendAppLog(dataDirectory, {
        level: status === 'success' ? 'info' : 'error',
        category: 'visit',
        message: `书签访问${status === 'success' ? '成功' : '失败'}：${site.name}`,
        details: safeLogUrl(site.startUrl)
      })
      return { status, reason }
    }
  )

  ipcMain.handle('login:start', async (event, payload: unknown): Promise<LoginViewState> => {
    assertTrustedSender(event)
    const parsed = loginStartSchema.safeParse(payload)
    if (!parsed.success) {
      throw new Error(firstIssue(parsed.error))
    }
    if (parsed.data.mode !== 'record') {
      throw new Error('普通登录已改为批量打开默认浏览器，请使用批量登录入口')
    }
    if (batchManager?.getState()?.active) {
      throw new Error('批量打开进行中，请等待任务结束后再录制')
    }
    await batchManager?.closeAccount(parsed.data.accountId)
    ensureLoginManagers()
    if (!loginManager) {
      throw new Error('登录窗口尚未准备好')
    }
    return loginManager.start(parsed.data.accountId, parsed.data.mode as LoginMode)
  })
  ipcMain.handle('login:start-batch', async (event, payload: unknown): Promise<LoginBatchState> => {
    assertTrustedSender(event)
    const parsed = loginBatchStartSchema.safeParse(payload)
    if (!parsed.success) {
      throw new Error(firstIssue(parsed.error))
    }
    if (loginManager?.getState().active) {
      throw new Error('录制进行中，请先结束录制')
    }
    ensureLoginManagers()
    if (!batchManager) {
      throw new Error('批量登录尚未准备好')
    }
    const state = await batchManager.start(parsed.data)
    appendAppLog(dataDirectory, {
      level: 'info',
      category: 'login',
      message: `批量登录已启动，共 ${state.total} 个账号`
    })
    return state
  })
  ipcMain.handle('login:get-batch-state', (event) => {
    assertTrustedSender(event)
    return batchManager?.getState() ?? null
  })
  ipcMain.handle('login:cancel-batch', async (event) => {
    assertTrustedSender(event)
    if (!batchManager) {
      throw new Error('没有可中断的批量登录任务')
    }
    return batchManager.cancel()
  })
  ipcMain.handle('login:close', async (event) => {
    assertTrustedSender(event)
    await closeRecordingManager()
    ensureLoginManagers()
  })
  ipcMain.handle('login:retry', async (event) => {
    assertTrustedSender(event)
    await loginManager?.retry()
  })
  ipcMain.handle('login:trust-origin', async (event) => {
    assertTrustedSender(event)
    await loginManager?.trustCurrentOrigin()
  })
  ipcMain.handle('login:focus-browser', async (event) => {
    assertTrustedSender(event)
    await loginManager?.focusBrowser()
  })
  ipcMain.handle('login:finish-recording', async (event) => {
    assertTrustedSender(event)
    if (!loginManager) {
      throw new Error('登录窗口尚未准备好')
    }
    return loginManager.finishRecording()
  })
  ipcMain.handle('login:cancel-recording', (event) => {
    assertTrustedSender(event)
    loginManager?.cancelRecording()
  })
  ipcMain.handle('login:test-selector', async (event, payload: unknown): Promise<SelectorTestResult> => {
    assertTrustedSender(event)
    const parsed = selectorTestInputSchema.safeParse(payload)
    if (!parsed.success) {
      throw new Error(firstIssue(parsed.error))
    }
    return testSelector(parsed.data)
  })
  ipcMain.handle('login:clear-session', async (event, accountId: unknown) => {
    assertTrustedSender(event)
    const id = requireId(accountId)
    await batchManager?.clearSession(id)
    await loginManager?.clearSession(id)
    clearManagedSessionDirectories(dataDirectory, id)
  })
  ipcMain.handle('login:get-state', (event) => {
    assertTrustedSender(event)
    return loginManager?.getState() ?? null
  })

  ipcMain.handle('settings:get', (event) => {
    assertTrustedSender(event)
    return vault.getSettings()
  })
  ipcMain.handle('settings:update', async (event, payload: unknown) => {
    assertTrustedSender(event)
    const parsed = appSettingsPatchSchema.safeParse(payload)
    if (!parsed.success) {
      throw new Error(firstIssue(parsed.error))
    }
    if (parsed.data.proxy) {
      parsed.data.proxy.enabled = parsed.data.proxy.mode === 'custom'
    }
    const settings = vault.updateSettings(parsed.data)
    if (parsed.data.trashRetentionDays) {
      purgeExpiredDeletedAccounts()
    }
    if (parsed.data.proxy) {
      appendAppLog(dataDirectory, {
        level: 'info',
        category: 'proxy',
        message:
          settings.proxy.mode === 'system'
            ? '网络代理已切换为跟随系统'
            : `网络代理配置已更新（${settings.proxy.enabled ? '自定义代理' : '直连'}）`
      })
    }
    appendAppLog(dataDirectory, {
      level: 'info',
      category: 'settings',
      message: '应用设置已更新',
      details: Object.keys(parsed.data).join('、')
    })
    applyInterfaceScale(settings.interfaceScale)
    await applySystemProxy(settings.proxy)
    return settings
  })
  ipcMain.handle('network:test-proxy', async (event, payload: unknown): Promise<ProxyTestResult> => {
    assertTrustedSender(event)
    const parsed = proxyTestInputSchema.safeParse(payload)
    if (!parsed.success) {
      throw new Error(firstIssue(parsed.error))
    }
    const result = await testProxy(parsed.data)
    appendAppLog(dataDirectory, {
      level: result.ok ? 'success' : 'error',
      category: 'proxy',
      message: `网络代理连通性测试${result.ok ? '成功' : '失败'}：${safeLogUrl(
        parsed.data.testUrl
      )}`,
      details: sanitizeLogDetails(result.message)
    })
    return result
  })

  ipcMain.handle('data:export-vault', async (event, payload: unknown): Promise<FileOperationResult> => {
    assertTrustedSender(event)
    const parsed = dataExportInputSchema.safeParse(payload)
    if (!parsed.success) {
      throw new Error(firstIssue(parsed.error))
    }
    const data = vault.requireData()
    const tab = data.tabs.find((entry) => entry.id === parsed.data.tabId)
    if (!tab) {
      throw new Error('导出标签页不存在')
    }
    if (!mainWindow) {
      return { canceled: true }
    }

    const format: DataExportFormat | 'html' =
      parsed.data.format ??
      (tab.source === 'csv'
        ? 'csv'
        : tab.source === 'kdbx'
          ? 'kdbx'
          : tab.source === 'bookmarks'
            ? 'html'
            : 'autologin')
    const filterNames: Record<typeof format, string> = {
      autologin: 'AutoLogin 加密配置',
      csv: 'CSV 账号文件',
      kdbx: 'KeePass KDBX 数据库',
      html: '浏览器书签 HTML'
    }
    const extensions: Record<typeof format, string> = {
      autologin: 'autologin',
      csv: 'csv',
      kdbx: 'kdbx',
      html: 'html'
    }
    const defaultName = `${safeFileBaseName(tab.name)}-v${app.getVersion()}-${fileDateStamp()}.${extensions[format]}`
    const selection = await dialog.showSaveDialog(mainWindow, {
      title:
        format === 'autologin'
          ? '导出 AutoLogin 加密配置'
          : format === 'kdbx'
            ? '导出 KDBX 数据库'
            : format === 'csv'
              ? '导出 CSV 账号'
              : '导出浏览器书签',
      buttonLabel: '导出',
      defaultPath: join(app.getPath('documents'), defaultName),
      filters: [{ name: filterNames[format], extensions: [extensions[format]] }]
    })
    if (selection.canceled || !selection.filePath) {
      return { canceled: true }
    }

    if (format === 'autologin') {
      vault.copyEncryptedTo(selection.filePath)
    } else if (format === 'csv') {
      writeFileSync(selection.filePath, serializeTabCsv(data, tab.id), {
        encoding: 'utf8',
        mode: 0o600
      })
    } else if (format === 'kdbx') {
      if (!parsed.data.password) {
        throw new Error('导出 KDBX 数据库需要设置数据库主密码')
      }
      const buffer = await serializeTabKdbx(data, tab.id, parsed.data.password)
      writeFileSync(selection.filePath, Buffer.from(buffer), { mode: 0o600 })
    } else {
      writeFileSync(selection.filePath, serializeTabBookmarks(data, tab.id), {
        encoding: 'utf8',
        mode: 0o600
      })
    }

    appendAppLog(dataDirectory, {
      level: 'success',
      category: 'data',
      message:
        format === 'autologin'
          ? '加密配置已导出'
          : format === 'kdbx'
            ? 'KDBX 数据库已导出'
            : format === 'csv'
              ? 'CSV 账号已导出'
              : '浏览器书签已导出',
      details: `${tab.name}；${basename(selection.filePath)}`
    })
    return { canceled: false, fileName: basename(selection.filePath) }
  })
  ipcMain.handle('data:export-csv-template', async (event): Promise<FileOperationResult> => {
    assertTrustedSender(event)
    if (!mainWindow) {
      return { canceled: true }
    }
    const selection = await dialog.showSaveDialog(mainWindow, {
      title: '保存 CSV 导入模板',
      buttonLabel: '保存模板',
      defaultPath: join(app.getPath('documents'), 'AutoLogin-import-template.csv'),
      filters: [{ name: 'CSV 模板', extensions: ['csv'] }]
    })
    if (selection.canceled || !selection.filePath) {
      return { canceled: true }
    }
    writeFileSync(selection.filePath, `\uFEFF${CSV_TEMPLATE}\r\n`, {
      encoding: 'utf8',
      mode: 0o600
    })
    appendAppLog(dataDirectory, {
      level: 'info',
      category: 'data',
      message: 'CSV 导入模板已保存',
      details: basename(selection.filePath)
    })
    return { canceled: false, fileName: basename(selection.filePath) }
  })
  ipcMain.handle('data:import-csv', async (event, payload: unknown): Promise<DataImportResult | null> => {
    assertTrustedSender(event)
    const parsedInput = csvImportInputSchema.safeParse(payload)
    if (!parsedInput.success) {
      throw new Error(firstIssue(parsedInput.error))
    }
    if (!mainWindow) return null
    const selection = await dialog.showOpenDialog(mainWindow, {
      title: '导入标准 CSV 账号',
      buttonLabel: '导入',
      properties: ['openFile'],
      filters: [{ name: 'CSV 文件', extensions: ['csv'] }]
    })
    const path = selection.filePaths[0]
    if (selection.canceled || !path) {
      return null
    }
    const parsed = await parseCsvImport(path)
    const result = applyDataImport(
      parsed,
      'csv',
      basename(path),
      parsedInput.data.mode,
      parsedInput.data.tabId,
      parsedInput.data.mode === 'new'
        ? { sourcePath: normalizeSelectedPath(path) }
        : undefined
    )
    appendImportLog(result, basename(path))
    return result
  })
  ipcMain.handle('data:choose-database', async (event): Promise<LocalDatabaseOpenSelection | null> => {
    assertTrustedSender(event)
    if (!mainWindow) return null
    cleanExpiredDatabaseSelections()
    const selection = await dialog.showOpenDialog(mainWindow, {
      title: '打开本地数据库',
      buttonLabel: '打开数据库',
      properties: ['openFile'],
      filters: [
        {
          name: 'AutoLogin / KDBX 数据库',
          extensions: ['autologin', 'kdbx']
        }
      ]
    })
    const selectedPath = selection.filePaths[0]
    if (selection.canceled || !selectedPath) {
      return null
    }
    const path = normalizeSelectedPath(selectedPath)
    if (!existsSync(path)) {
      throw new Error('所选数据库文件已被移动或删除，请重新选择')
    }
    purgeMissingDatabaseTabs(true)
    const normalizedPath = path.toLocaleLowerCase()
    const kind: LocalDatabaseKind = normalizedPath.endsWith('.kdbx')
      ? 'kdbx'
      : normalizedPath.endsWith('.autologin')
        ? 'autologin'
        : (() => {
            throw new Error('请选择 .autologin 或 .kdbx 格式的本地数据库')
          })()
    const fileName = basename(path)
    const existing = findExistingDatabaseTab(path, kind)
    if (existing) {
      const result = activateExistingDatabaseTab(existing, kind, fileName)
      appendAppLog(dataDirectory, {
        level: 'info',
        category: 'data',
        message: `已打开数据库：${existing.name}`,
        details: fileName
      })
      return result
    }
    const stats = statSync(path)
    const token = randomUUID()
    pendingDatabaseSelections.set(token, {
      kind,
      path,
      fileName,
      size: stats.size,
      expiresAt: Date.now() + 10 * 60 * 1000
    })
    const fileSelection: LocalDatabaseFileSelection = {
      kind,
      token,
      fileName,
      size: stats.size
    }
    return fileSelection
  })
  ipcMain.handle(
    'data:import-database',
    async (event, payload: unknown): Promise<DataImportResult> => {
      assertTrustedSender(event)
      const parsed = autologinSelectionImportSchema.safeParse(payload)
      if (!parsed.success) {
        throw new Error(firstIssue(parsed.error))
      }
      cleanExpiredDatabaseSelections()
      const selection = pendingDatabaseSelections.get(parsed.data.token)
      if (!selection) {
        throw new Error('数据库选择已过期，请重新选择文件')
      }
      const databasePath = resolveSelectedDatabasePath(
        selection.path,
        selection.kind
      )
      if (!databasePath) {
        pendingDatabaseSelections.delete(parsed.data.token)
        throw new Error('所选数据库文件已被移动或删除，请重新选择')
      }
      purgeMissingDatabaseTabs(true)
      const existing = findExistingDatabaseTab(
        databasePath,
        selection.kind
      )
      if (existing) {
        const active = activateExistingDatabaseTab(
          existing,
          selection.kind,
          selection.fileName
        )
        pendingDatabaseSelections.delete(parsed.data.token)
        return {
          source: active.source,
          tabId: active.tabId,
          tabName: active.tabName,
          sitesCreated: 0,
          accountsCreated: 0,
          skipped: 0,
          warnings: []
        }
      }

      const result =
        selection.kind === 'autologin'
          ? applyAutologinImport(
              await vault.readEncryptedSnapshot(
                databasePath,
                parsed.data.password
              ),
              {
                fileName: selection.fileName,
                sourcePath: databasePath,
                exactFileName: true
              }
            )
          : applyDataImport(
              await parseKdbxImport(databasePath, parsed.data.password),
              'kdbx',
              selection.fileName,
              'new',
              undefined,
              { sourcePath: databasePath }
            )
      pendingDatabaseSelections.delete(parsed.data.token)
      appendImportLog(result, selection.fileName)
      return result
    }
  )
  ipcMain.handle('data:choose-kdbx', async (event): Promise<KdbxSelection | null> => {
    assertTrustedSender(event)
    if (!mainWindow) return null
    cleanExpiredKdbxSelections()
    const selection = await dialog.showOpenDialog(mainWindow, {
      title: '选择 KeePassXC 数据库',
      buttonLabel: '选择数据库',
      properties: ['openFile'],
      filters: [{ name: 'KeePassXC 数据库', extensions: ['kdbx'] }]
    })
    const selectedPath = selection.filePaths[0]
    if (selection.canceled || !selectedPath) {
      return null
    }
    const path = normalizeSelectedPath(selectedPath)
    if (!path.toLocaleLowerCase().endsWith('.kdbx')) {
      throw new Error('请选择 .kdbx 格式的 KeePassXC 数据库')
    }
    if (!existsSync(path)) {
      throw new Error('所选数据库文件已被移动或删除，请重新选择')
    }
    const stats = statSync(path)
    const token = randomUUID()
    const fileName = basename(path)
    pendingKdbxSelections.set(token, {
      path,
      fileName,
      size: stats.size,
      expiresAt: Date.now() + 10 * 60 * 1000
    })
    return { token, fileName, size: stats.size }
  })
  ipcMain.handle(
    'data:import-kdbx',
    async (event, payload: unknown): Promise<DataImportResult> => {
      assertTrustedSender(event)
      const parsed = kdbxSelectionImportSchema.safeParse(payload)
      if (!parsed.success) {
        throw new Error(firstIssue(parsed.error))
      }
      cleanExpiredKdbxSelections()
      const selection = pendingKdbxSelections.get(parsed.data.token)
      if (!selection) {
        throw new Error('KeePassXC 数据库选择已过期，请重新选择文件')
      }
      const databasePath = resolveSelectedDatabasePath(
        selection.path,
        'kdbx'
      )
      if (!databasePath) {
        pendingKdbxSelections.delete(parsed.data.token)
        throw new Error('所选数据库文件已被移动或删除，请重新选择')
      }
      const imported = await parseKdbxImport(databasePath, parsed.data.password)
      const result = applyDataImport(
        imported,
        'kdbx',
        selection.fileName,
        'new',
        undefined,
        { sourcePath: databasePath }
      )
      pendingKdbxSelections.delete(parsed.data.token)
      appendImportLog(result, selection.fileName)
      return result
    }
  )
  ipcMain.handle('data:choose-autologin', async (event) => {
    assertTrustedSender(event)
    if (!mainWindow) return null
    cleanExpiredAutologinSelections()
    const selection = await dialog.showOpenDialog(mainWindow, {
      title: '选择 AutoLogin 加密配置',
      buttonLabel: '选择配置',
      properties: ['openFile'],
      filters: [{ name: 'AutoLogin 加密配置', extensions: ['autologin'] }]
    })
    const selectedPath = selection.filePaths[0]
    if (selection.canceled || !selectedPath) {
      return null
    }
    const path = normalizeSelectedPath(selectedPath)
    if (!path.toLocaleLowerCase().endsWith('.autologin')) {
      throw new Error('请选择 .autologin 格式的 AutoLogin 配置文件')
    }
    if (!existsSync(path)) {
      throw new Error('所选数据库文件已被移动或删除，请重新选择')
    }
    const stats = statSync(path)
    const token = randomUUID()
    const fileName = basename(path)
    pendingAutologinSelections.set(token, {
      path,
      fileName,
      size: stats.size,
      expiresAt: Date.now() + 10 * 60 * 1000
    })
    return { token, fileName, size: stats.size }
  })
  ipcMain.handle(
    'data:import-autologin',
    async (event, payload: unknown): Promise<DataImportResult> => {
      assertTrustedSender(event)
      const parsed = autologinSelectionImportSchema.safeParse(payload)
      if (!parsed.success) {
        throw new Error(firstIssue(parsed.error))
      }
      cleanExpiredAutologinSelections()
      const selection = pendingAutologinSelections.get(parsed.data.token)
      if (!selection) {
        throw new Error('AutoLogin 配置文件选择已过期，请重新选择文件')
      }
      const databasePath = resolveSelectedDatabasePath(
        selection.path,
        'autologin'
      )
      if (!databasePath) {
        pendingAutologinSelections.delete(parsed.data.token)
        throw new Error('所选数据库文件已被移动或删除，请重新选择')
      }
      const imported = await vault.readEncryptedSnapshot(
        databasePath,
        parsed.data.password
      )
      const result = applyAutologinImport(imported, {
        fileName: selection.fileName,
        sourcePath: databasePath,
        exactFileName: true
      })
      pendingAutologinSelections.delete(parsed.data.token)
      appendImportLog(result, selection.fileName)
      return result
    }
  )
  ipcMain.handle('data:import-bookmarks', async (event): Promise<DataImportResult | null> => {
    assertTrustedSender(event)
    if (!mainWindow) return null
    const selection = await dialog.showOpenDialog(mainWindow, {
      title: '导入浏览器书签',
      buttonLabel: '导入书签',
      properties: ['openFile'],
      filters: [{ name: '浏览器书签 HTML', extensions: ['html', 'htm'] }]
    })
    const path = selection.filePaths[0]
    if (selection.canceled || !path) return null
    const parsed = await parseBookmarksImport(path)
    const result = applyDataImport(parsed, 'bookmarks', basename(path))
    appendImportLog(result, basename(path))
    return result
  })
  ipcMain.handle('data:list-backups', (event): BackupRecord[] => {
    assertTrustedSender(event)
    return backupManager.list()
  })
  ipcMain.handle('data:restore-backup', async (event, backupId: unknown) => {
    assertTrustedSender(event)
    if (typeof backupId !== 'string') {
      throw new Error('备份文件标识无效')
    }
    const backupPath = backupManager.resolve(backupId)
    await closeLoginManagers()
    vault.lock()
    vault.restoreEncryptedFrom(backupPath)
    sessionIndex.clear()
    ensureLoginManagers()
    appendAppLog(dataDirectory, {
      level: 'success',
      category: 'backup',
      message: '本地备份已恢复',
      details: backupId
    })
  })

  ipcMain.handle('window:update-theme', (event, payload: unknown) => {
    assertTrustedSender(event)
    if (!mainWindow || !isTitleBarTheme(payload)) {
      throw new Error('窗口主题参数无效')
    }
    mainWindow.setTitleBarOverlay({
      color: payload.backgroundColor,
      symbolColor: payload.symbolColor,
      height: payload.height ?? 40
    })
  })

  ipcMain.handle('app:get-version', (event) => {
    assertTrustedSender(event)
    return app.getVersion()
  })
  ipcMain.handle('app:get-about', (event): AboutInfo => {
    assertTrustedSender(event)
    return {
      version: app.getVersion(),
      platform: process.platform,
      dataDirectory
    }
  })
  ipcMain.handle('app:check-for-updates', async (event): Promise<UpdateCheckResult> => {
    assertTrustedSender(event)
    return checkForUpdates(true)
  })
  ipcMain.handle('app:get-update-state', (event): AppUpdateState => {
    assertTrustedSender(event)
    return getUpdateState()
  })
  ipcMain.handle('app:download-update', async (event): Promise<AppUpdateState> => {
    assertTrustedSender(event)
    return downloadUpdate()
  })
  ipcMain.handle('app:cancel-update', async (event): Promise<AppUpdateState> => {
    assertTrustedSender(event)
    return cancelUpdate()
  })
  ipcMain.handle('app:install-update', async (event): Promise<void> => {
    assertTrustedSender(event)
    await installUpdate()
  })
  ipcMain.handle('app:get-data-location', (event): DataLocationInfo => {
    assertTrustedSender(event)
    return dataLocationInfo()
  })
  ipcMain.handle(
    'app:choose-data-location',
    async (event): Promise<DataLocationChoiceResult | null> => {
      assertTrustedSender(event)
      return chooseDataLocation()
    }
  )
  ipcMain.handle(
    'app:resolve-data-location-conflict',
    async (event, payload: unknown): Promise<DataLocationInfo> => {
      assertTrustedSender(event)
      const parsed = dataLocationConflictInputSchema.safeParse(payload)
      if (!parsed.success) {
        throw new Error(parsed.error.issues[0]?.message ?? '数据目录选项无效')
      }
      return resolveDataLocationConflict(parsed.data.directory, parsed.data.action)
    }
  )
  ipcMain.handle('app:restore-default-data-location', async (event): Promise<DataLocationInfo> => {
    assertTrustedSender(event)
    return restoreDefaultDataLocation()
  })
  ipcMain.handle('app:open-data-location', async (event) => {
    assertTrustedSender(event)
    mkdirSync(dataDirectory, { recursive: true })
    const error = await shell.openPath(dataDirectory)
    if (error) {
      throw new Error(`无法打开数据目录：${error}`)
    }
  })
  ipcMain.handle('app:open-failure-log', async (event) => {
    assertTrustedSender(event)
    const path = failureLogPath(dataDirectory)
    if (!existsSync(path)) {
      if (!mainWindow) {
        return
      }
      await dialog.showMessageBox(mainWindow, {
        type: 'info',
        title: '登录失败日志',
        message: '目前还没有登录失败记录',
        detail: '批量登录出现失败时，AutoLogin 会将安全的失败原因写入本地日志。',
        buttons: ['知道了'],
        noLink: true
      })
      return
    }
    const error = await shell.openPath(path)
    if (error) {
      throw new Error(`无法打开失败日志：${error}`)
    }
  })
  ipcMain.handle('app:list-login-logs', (event, payload: unknown): LoginLogEntry[] => {
    assertTrustedSender(event)
    const parsed = loginLogQuerySchema.safeParse(payload)
    if (!parsed.success) {
      throw new Error(firstIssue(parsed.error))
    }
    return readLoginLogs(dataDirectory, parsed.data ?? {}, 1000)
  })
  ipcMain.handle('app:list-failure-logs', (event): LoginLogEntry[] => {
    assertTrustedSender(event)
    return readLoginLogs(dataDirectory, {}, 1000)
  })
  ipcMain.handle('app:delete-login-logs', (event, payload: unknown): LoginLogDeleteResult => {
    assertTrustedSender(event)
    const parsed = loginLogDeleteSchema.safeParse(payload)
    if (!parsed.success) {
      throw new Error(firstIssue(parsed.error))
    }
    return { deleted: deleteLoginLogs(dataDirectory, parsed.data) }
  })
  ipcMain.handle('app:list-app-logs', (event, payload: unknown): ReturnType<typeof readAppLogs> => {
    assertTrustedSender(event)
    const parsed = appLogQuerySchema.safeParse(payload)
    if (!parsed.success) {
      throw new Error(firstIssue(parsed.error))
    }
    return readAppLogs(dataDirectory, parsed.data ?? 200)
  })
  ipcMain.handle('app:delete-app-logs', (event, payload: unknown): { deleted: number } => {
    assertTrustedSender(event)
    const parsed = appLogDeleteSchema.safeParse(payload)
    if (!parsed.success) {
      throw new Error(firstIssue(parsed.error))
    }
    return { deleted: deleteAppLogs(dataDirectory, parsed.data) }
  })
  ipcMain.handle('app:clear-app-logs', (event): { deleted: number } => {
    assertTrustedSender(event)
    const deleted = clearAppLogs(dataDirectory)
    return { deleted }
  })
  ipcMain.handle('app:restart', async (event) => {
    assertTrustedSender(event)
    await closeLoginManagers()
    vault?.lock()
    app.relaunch()
    app.exit(0)
  })
  ipcMain.on('app:activity', (event) => {
    assertTrustedSender(event)
    vault.touch()
  })
  ipcMain.handle('app:clear-all-data', async (event) => {
    assertTrustedSender(event)
    const status = vault.status()
    const data = status.unlocked ? vault.requireData() : null
    const accountIds = new Set([
      ...sessionIndex.list(),
      ...discoverManagedPartitionIds(dataDirectory),
      ...discoverManagedBrowserProfileIds(dataDirectory),
      ...(data?.accounts.map((account) => account.id) ?? [])
    ])
    await closeLoginManagers()
    await Promise.allSettled(
      [...accountIds]
        .filter(isManagedAccountId)
        .map((accountId) => Promise.resolve(clearManagedSessionDirectories(dataDirectory, accountId)))
    )
    sessionIndex.clear()
    vault.clearAllFiles()
    backupManager.clear()
    rmSync(join(dataDirectory, 'tabs'), { recursive: true, force: true })
    ensureLoginManagers()
    appendAppLog(dataDirectory, {
      level: 'warning',
      category: 'data',
      message: '所有本地数据已清除'
    })
  })
  ipcMain.handle('app:open-privacy', async (event) => {
    assertTrustedSender(event)
    if (!mainWindow) {
      return
    }
    const result = await dialog.showMessageBox(mainWindow, {
      type: 'info',
      title: '隐私说明',
      message: 'AutoLogin 采用本地优先设计',
      detail:
        '账号密码保存在本机加密保险库中，不会上传到 AutoLogin 服务器。应用不含遥测和广告追踪。网站会话由 Windows 用户级机制保护。',
      buttons: ['知道了', '打开完整隐私说明'],
      defaultId: 0,
      cancelId: 0,
      noLink: true
    })
    if (result.response === 1) {
      const privacyPath = app.isPackaged
        ? join(process.resourcesPath, 'PRIVACY.md')
        : join(app.getAppPath(), 'PRIVACY.md')
      const error = await shell.openPath(privacyPath)
      if (error) {
        throw new Error(`无法打开隐私说明：${error}`)
      }
    }
  })

}

function renameGroup(input: GroupRenameInput): void {
  const data = vault.requireData()
  const tabId = input.tabId ?? DEFAULT_ACCOUNT_TAB_ID
  ensureGroupDefinitions(data, tabId)
  const fromPath = input.fromName.trim()
  const toName = input.toName.trim()
  const exists = groupPathExists(data, fromPath, tabId)
  if (!exists) throw new Error('分组不存在')
  const parentPath = groupParentPath(fromPath)
  const toPath = parentPath ? `${parentPath}${GROUP_PATH_SEPARATOR}${toName}` : toName
  if (fromPath === toPath) return
  if (
    allGroupPaths(data, tabId).some(
      (path) => path !== fromPath && path === toPath
    )
  ) {
    throw new Error('同级分组名称已存在')
  }

  const now = new Date().toISOString()
  const renamePath = (path: string): string => {
    if (path === fromPath) return toPath
    if (path.startsWith(`${fromPath}${GROUP_PATH_SEPARATOR}`)) {
      return `${toPath}${path.slice(fromPath.length)}`
    }
    return path
  }

  data.groupDefinitions = data.groupDefinitions.map((group) => ({
    ...group,
    path: group.tabId === tabId ? renamePath(group.path) : group.path,
    name: group.tabId === tabId && group.path === fromPath ? toName : group.name,
    updatedAt: now
  }))
  for (const site of data.sites) {
    if (site.tabId !== tabId || !site.group) continue
    const next = renamePath(site.group)
    if (next !== site.group) {
      site.group = next
      site.updatedAt = now
    }
  }
  for (const record of data.deletedAccounts) {
    if (record.tabId === tabId && record.site.group) {
      record.site.group = renamePath(record.site.group)
    }
  }
  setTabGroupOrder(data, tabId, [
    ...new Set(
      getTabGroupOrder(data, tabId).map((path) =>
        path === UNGROUPED_GROUP_KEY ? path : renamePath(path)
      )
    )
  ])
  vault.save()
}

function moveGroup(input: GroupMoveInput): GroupMoveResult {
  const data = vault.requireData()
  const tabId = input.tabId ?? DEFAULT_ACCOUNT_TAB_ID
  ensureGroupDefinitions(data, tabId)
  const fromPath = input.fromPath.trim()
  const parentPath = input.parentPath?.trim() || undefined
  if (!groupPathExists(data, fromPath, tabId)) {
    throw new Error('分组不存在')
  }
  if (parentPath && !groupPathExists(data, parentPath, tabId)) {
    throw new Error('目标分组不存在')
  }
  if (
    parentPath === fromPath ||
    parentPath?.startsWith(`${fromPath}${GROUP_PATH_SEPARATOR}`)
  ) {
    throw new Error('不能将分组移动到自身或其子分组中')
  }

  const currentParent = groupParentPath(fromPath)
  if ((currentParent ?? undefined) === parentPath) {
    return { fromPath, toPath: fromPath }
  }

  const groupName = fromPath.split(GROUP_PATH_SEPARATOR).at(-1) ?? fromPath
  const toPath = parentPath
    ? `${parentPath}${GROUP_PATH_SEPARATOR}${groupName}`
    : groupName
  const paths = allGroupPaths(data, tabId)
  if (paths.some((path) => path === toPath && path !== fromPath)) {
    throw new Error('目标分组下已存在同名分组')
  }

  const movedPaths = paths.filter(
    (path) => path === fromPath || path.startsWith(`${fromPath}${GROUP_PATH_SEPARATOR}`)
  )
  const relativeDepth = Math.max(
    0,
    ...movedPaths.map((path) => groupDepth(path) - groupDepth(fromPath))
  )
  const targetDepth = parentPath ? groupDepth(parentPath) : 0
  if (targetDepth + 1 + relativeDepth > GROUP_MAX_DEPTH) {
    throw new Error(`分组最多支持 ${GROUP_MAX_DEPTH} 级`)
  }

  const now = new Date().toISOString()
  const movePath = (path: string): string => {
    if (path === fromPath) return toPath
    if (path.startsWith(`${fromPath}${GROUP_PATH_SEPARATOR}`)) {
      return `${toPath}${path.slice(fromPath.length)}`
    }
    return path
  }

  data.groupDefinitions = data.groupDefinitions.map((group) => ({
    ...group,
    path: group.tabId === tabId ? movePath(group.path) : group.path,
    updatedAt: now
  }))
  for (const site of data.sites) {
    if (site.tabId !== tabId || !site.group) continue
    const next = movePath(site.group)
    if (next !== site.group) {
      site.group = next
      site.updatedAt = now
    }
  }
  for (const record of data.deletedAccounts) {
    if (record.tabId === tabId && record.site.group) {
      record.site.group = movePath(record.site.group)
    }
  }
  setTabGroupOrder(data, tabId, [
    ...new Set(
      getTabGroupOrder(data, tabId).map((path) =>
        path === UNGROUPED_GROUP_KEY ? path : movePath(path)
      )
    )
  ])
  vault.save()
  return { fromPath, toPath }
}

function deleteGroup(groupName: string, requestedTabId?: string): number {
  const data = vault.requireData()
  const tabId = requestedTabId ?? DEFAULT_ACCOUNT_TAB_ID
  ensureGroupDefinitions(data, tabId)
  const root = groupName.trim()
  if (!groupPathExists(data, root, tabId)) return 0
  const removedPaths = new Set(
    allGroupPaths(data, tabId).filter(
      (path) => path === root || path.startsWith(`${root}${GROUP_PATH_SEPARATOR}`)
    )
  )
  const now = new Date().toISOString()
  let affected = 0
  for (const site of data.sites) {
    if (site.tabId === tabId && site.group && removedPaths.has(site.group)) {
      site.group = undefined
      site.updatedAt = now
      affected += 1
    }
  }
  for (const record of data.deletedAccounts) {
    if (record.tabId === tabId && record.site.group && removedPaths.has(record.site.group)) {
      record.site.group = undefined
    }
  }
  data.groupDefinitions = data.groupDefinitions.filter(
    (entry) => entry.tabId !== tabId || !removedPaths.has(entry.path)
  )
  setTabGroupOrder(
    data,
    tabId,
    getTabGroupOrder(data, tabId).filter((entry) => !removedPaths.has(entry))
  )
  vault.save()
  return affected
}

function listGroups(tabId?: string): GroupDefinition[] {
  const data = vault.requireData()
  const scopedTabId = tabId ?? DEFAULT_ACCOUNT_TAB_ID
  let changed = repairGroupDefinitions(data)
  changed = ensureGroupDefinitions(data, scopedTabId) || changed
  const seen = new Set<string>()
  const deduplicated = data.groupDefinitions.filter((group) => {
    const key = `${group.tabId ?? DEFAULT_ACCOUNT_TAB_ID}\u0000${group.path}`
    if (seen.has(key)) {
      changed = true
      return false
    }
    seen.add(key)
    return true
  })
  if (deduplicated.length !== data.groupDefinitions.length) {
    data.groupDefinitions = deduplicated
  }
  if (changed) vault.save()
  return structuredClone(
    data.groupDefinitions.filter((group) => group.tabId === scopedTabId)
  )
}

function createGroup(input: GroupCreateInput): GroupDefinition {
  const data = vault.requireData()
  const tabId = input.tabId ?? DEFAULT_ACCOUNT_TAB_ID
  ensureGroupDefinitions(data, tabId)
  const name = input.name.trim()
  const parentPath = input.parentPath?.trim() || undefined
  if (parentPath && !groupPathExists(data, parentPath, tabId)) {
    throw new Error('父级分组不存在')
  }
  const depth = parentPath ? groupDepth(parentPath) + 1 : 1
  if (depth > GROUP_MAX_DEPTH) {
    throw new Error(`分组最多支持 ${GROUP_MAX_DEPTH} 级`)
  }
  const path = parentPath ? `${parentPath}${GROUP_PATH_SEPARATOR}${name}` : name
  if (groupPathExists(data, path, tabId)) {
    throw new Error('同级分组名称已存在')
  }

  const now = new Date().toISOString()
  const group: GroupDefinition = {
    tabId,
    path,
    name,
    createdAt: now,
    updatedAt: now
  }
  data.groupDefinitions.push(group)
  const order = getTabGroupOrder(data, tabId)
  if (!order.includes(path)) setTabGroupOrder(data, tabId, [...order, path])
  vault.save()
  return structuredClone(group)
}

function ensureGroupDefinitions(data: VaultData, tabId?: string): boolean {
  const scopedTabId = tabId ?? DEFAULT_ACCOUNT_TAB_ID
  const matchesTab = (entryTabId: string | undefined): boolean =>
    !tabId || (entryTabId ?? DEFAULT_ACCOUNT_TAB_ID) === scopedTabId
  const existing = new Set(
    data.groupDefinitions
      .filter((group) => matchesTab(group.tabId))
      .map((group) => group.path)
  )
  const paths = new Set<string>()
  for (const site of data.sites) {
    if (matchesTab(site.tabId) && site.group?.trim()) paths.add(site.group.trim())
  }
  for (const record of data.deletedAccounts) {
    if (matchesTab(record.tabId) && record.site.group?.trim()) {
      paths.add(record.site.group.trim())
    }
  }
  for (const path of getTabGroupOrder(data, scopedTabId)) {
    if (path.trim() === UNGROUPED_GROUP_KEY) continue
    paths.add(path.trim())
  }

  let changed = false
  for (const path of paths) {
    const segments = path.split(GROUP_PATH_SEPARATOR).map((segment) => segment.trim())
    for (let index = 1; index <= segments.length; index += 1) {
      const prefix = segments.slice(0, index).join(GROUP_PATH_SEPARATOR)
      if (!prefix || existing.has(prefix)) continue
      const now = new Date().toISOString()
      data.groupDefinitions.push({
        tabId: scopedTabId,
        path: prefix,
        name: segments[index - 1] ?? prefix,
        createdAt: now,
        updatedAt: now
      })
      existing.add(prefix)
      changed = true
    }
  }
  return changed
}

function allGroupPaths(data: VaultData, tabId: string): string[] {
  const paths = new Set(
    data.groupDefinitions
      .filter((group) => group.tabId === tabId)
      .map((group) => group.path)
  )
  for (const site of data.sites) {
    if (site.tabId === tabId && site.group?.trim()) paths.add(site.group.trim())
  }
  for (const record of data.deletedAccounts) {
    if (record.tabId === tabId && record.site.group?.trim()) {
      paths.add(record.site.group.trim())
    }
  }
  for (const path of getTabGroupOrder(data, tabId)) {
    if (path === UNGROUPED_GROUP_KEY) continue
    paths.add(path)
  }
  return [...paths]
}

function groupPathExists(data: VaultData, path: string, tabId: string): boolean {
  return allGroupPaths(data, tabId).includes(path)
}

function getTabGroupOrder(data: VaultData, tabId: string): string[] {
  return (
    data.settings.groupOrders[tabId] ??
    (tabId === DEFAULT_ACCOUNT_TAB_ID ? data.settings.groupOrder : [])
  )
}

function setTabGroupOrder(data: VaultData, tabId: string, order: string[]): void {
  data.settings.groupOrders[tabId] = order
  if (tabId === DEFAULT_ACCOUNT_TAB_ID) {
    data.settings.groupOrder = [...order]
  }
}

function groupParentPath(path: string): string | undefined {
  const segments = path.split(GROUP_PATH_SEPARATOR)
  if (segments.length <= 1) return undefined
  return segments.slice(0, -1).join(GROUP_PATH_SEPARATOR)
}

function groupDepth(path: string): number {
  return path.split(GROUP_PATH_SEPARATOR).filter(Boolean).length
}

function listDeletedAccounts(tabId?: string): DeletedAccountWithSite[] {
  const data = vault.requireData()
  purgeExpiredDeletedAccounts()
  const tabs = new Map(data.tabs.map((tab) => [tab.id, tab] as const))
  return [...data.deletedAccounts]
    .filter((record) => !tabId || record.tabId === tabId)
    .sort(
      (left, right) =>
        new Date(right.deletedAt).getTime() - new Date(left.deletedAt).getTime()
    )
    .map((record) => {
      const tab = tabs.get(record.tabId)
      return {
        ...toPublicAccount(record.account, record.site),
        deletedAt: record.deletedAt,
        tabId: record.tabId,
        tabName: tab?.name ?? '本地账号',
        source: tab?.source ?? 'local'
      }
    })
}

function purgeExpiredDeletedAccounts(): number {
  const data = vault.requireData()
  const before = data.deletedAccounts.length
  data.deletedAccounts = data.deletedAccounts.filter(
    (record) =>
      !isTrashItemExpired(record.deletedAt, data.settings.trashRetentionDays)
  )
  const removed = before - data.deletedAccounts.length
  if (removed > 0) vault.save()
  return removed
}

function moveAccountsToTrash(accountIds: string[]): void {
  const data = vault.requireData()
  const requested = new Set(accountIds)
  const now = new Date().toISOString()
  const removedSiteIds = new Set<string>()

  for (const account of data.accounts) {
    if (!requested.has(account.id)) continue
    const site = data.sites.find((entry) => entry.id === account.siteId)
    if (!site) continue
    data.deletedAccounts = data.deletedAccounts.filter(
      (record) => record.account.id !== account.id
    )
    data.deletedAccounts.push({
      account: structuredClone(account),
      site: structuredClone(site),
      tabId: account.tabId ?? site.tabId ?? DEFAULT_ACCOUNT_TAB_ID,
      deletedAt: now
    })
    removedSiteIds.add(site.id)
  }

  data.accounts = data.accounts.filter((account) => !requested.has(account.id))
  const activeSiteIds = new Set(data.accounts.map((account) => account.siteId))
  data.sites = data.sites.filter(
    (site) => !removedSiteIds.has(site.id) || activeSiteIds.has(site.id)
  )
  vault.save()
}

function restoreDeletedAccount(accountId: string): AccountWithSite {
  const data = vault.requireData()
  const record = data.deletedAccounts.find((entry) => entry.account.id === accountId)
  if (!record) throw new Error('回收站中不存在该账号')
  if (data.accounts.some((account) => account.id === record.account.id)) {
    throw new Error('同名账号已被恢复')
  }

  const tabId = record.tabId ?? record.account.tabId ?? DEFAULT_ACCOUNT_TAB_ID
  const tabSites = data.sites.filter((entry) => entry.tabId === tabId)
  const takenNames = new Set(tabSites.map((site) => normalizeSiteName(site.name)))
  let site = tabSites.find((entry) => entry.id === record.site.id)
  if (!site) {
    const sameName = tabSites.find(
      (entry) => normalizeSiteName(entry.name) === normalizeSiteName(record.site.name)
    )
    if (sameName && sameName.startUrl === record.site.startUrl) {
      site = sameName
    } else {
      site = {
        ...structuredClone(record.site),
        tabId,
        name:
          sameName || takenNames.has(normalizeSiteName(record.site.name))
            ? uniqueCopyName(record.site.name, takenNames)
            : record.site.name
      }
      data.sites.push(site)
    }
  }

  const account: StoredAccount = {
    ...structuredClone(record.account),
    tabId,
    siteId: site.id
  }
  data.accounts.push(account)
  data.deletedAccounts = data.deletedAccounts.filter(
    (entry) => entry.account.id !== accountId
  )
  ensureGroupDefinitions(data, tabId)
  vault.save()
  sessionIndex.add(account.id)
  return toPublicAccount(account, site)
}

function purgeDeletedAccount(accountId: string): void {
  const data = vault.requireData()
  const before = data.deletedAccounts.length
  data.deletedAccounts = data.deletedAccounts.filter(
    (record) => record.account.id !== accountId
  )
  if (data.deletedAccounts.length === before) {
    throw new Error('回收站中不存在该账号')
  }
  vault.save()
}

function purgeDeletedAccounts(accountIds: string[]): number {
  const data = vault.requireData()
  const requested = new Set(accountIds)
  const before = data.deletedAccounts.length
  data.deletedAccounts = data.deletedAccounts.filter(
    (record) => !requested.has(record.account.id)
  )
  const removed = before - data.deletedAccounts.length
  if (removed > 0) vault.save()
  return removed
}

function saveSite(input: SiteInput): Site {
  const data = vault.requireData()
  const now = new Date().toISOString()
  const startUrl = normalizeUrl(input.startUrl)
  const startOrigin = new URL(startUrl).origin
  const requestedName = input.name.trim()
  const normalizedName = normalizeSiteName(requestedName)
  const tabId = input.tabId ?? DEFAULT_ACCOUNT_TAB_ID
  const duplicate = data.sites.find(
    (site) =>
      site.tabId === tabId &&
      site.id !== input.id &&
      normalizeSiteName(site.name) === normalizedName
  )
  if (duplicate) {
    throw new Error('站点名称已存在，请使用其他名称')
  }
  const allowedOrigins = [
    ...new Set(
      [startOrigin, ...(input.allowedOrigins ?? [])]
        .map(normalizeOrigin)
        .filter((origin): origin is string => Boolean(origin))
    )
  ]

  if (input.id) {
    const existing = data.sites.find((site) => site.id === input.id)
    if (!existing) {
      throw new Error('站点不存在')
    }
    if (input.tabId && existing.tabId !== input.tabId) {
      throw new Error('不能将站点移动到其他标签页')
    }
    const previousName = existing.name
    existing.name = requestedName
    existing.startUrl = startUrl
    existing.allowedOrigins = allowedOrigins
    existing.autoSubmit = input.autoSubmit
    existing.group = input.group?.trim() || undefined
    existing.icon = input.icon
    existing.updatedAt = now
    if (previousName !== requestedName) {
      for (const account of data.accounts) {
        if (account.siteId === existing.id) {
          account.label = requestedName
          account.updatedAt = now
        }
      }
    }
    vault.save()
    return structuredClone(existing)
  }

  const site: Site = {
    id: randomUUID(),
    tabId,
    name: requestedName,
    startUrl,
    allowedOrigins,
    autoSubmit: input.autoSubmit,
    group: input.group?.trim() || undefined,
    icon: input.icon,
    createdAt: now,
    updatedAt: now
  }
  data.sites.push(site)
  vault.save()
  return structuredClone(site)
}

function createAccount(input: {
  siteId: string
  label: string
  username: string
  password: string
  favorite?: boolean
  loginStrategy?: 'auto' | 'manual'
  manualSelectors?: {
    username?: string
    password?: string
    submit?: string
  }
  manualSteps?: RecipeStep[]
}): AccountWithSite {
  const data = vault.requireData()
  const site = data.sites.find((entry) => entry.id === input.siteId)
  if (!site) {
    throw new Error('站点不存在')
  }
  const tab = data.tabs.find((entry) => entry.id === (site.tabId ?? DEFAULT_ACCOUNT_TAB_ID))
  const isBookmark = tab?.source === 'bookmarks'
  if (!isBookmark && !input.username.trim()) {
    throw new Error('请输入用户名')
  }
  if (!isBookmark && !input.password) {
    throw new Error('请输入密码')
  }
  const loginStrategy = input.loginStrategy ?? 'auto'
  const manualSelectors = normalizeManualSelectors(input.manualSelectors)
  const manualSteps = input.manualSteps?.length
    ? structuredClone(input.manualSteps)
    : undefined
  assertManualConfiguration(loginStrategy, manualSelectors, manualSteps)
  const now = new Date().toISOString()
  const account: StoredAccount = {
    id: randomUUID(),
    tabId: site.tabId,
    siteId: site.id,
    label: site.name,
    username: input.username.trim(),
    password: input.password,
    favorite: input.favorite ?? false,
    loginStrategy,
    manualSelectors,
    manualSteps,
    sortOrder: nextAccountSortOrder(data, site.tabId),
    createdAt: now,
    updatedAt: now
  }
  data.accounts.push(account)
  vault.save()
  sessionIndex.add(account.id)
  return toPublicAccount(account, site)
}

function nextAccountSortOrder(data: VaultData, tabId: string): number {
  return (
    Math.max(
      -1,
      ...data.accounts
        .filter((account) => account.tabId === tabId)
        .map((account) =>
          typeof account.sortOrder === 'number' ? account.sortOrder : -1
        )
    ) + 1
  )
}

function normalizeManualSelectors(input: {
  username?: string
  password?: string
  submit?: string
} | undefined): {
  username?: string
  password?: string
  submit?: string
} | undefined {
  if (!input) return undefined
  const normalized = {
    username: input.username?.trim() || undefined,
    password: input.password?.trim() || undefined,
    submit: input.submit?.trim() || undefined
  }
  return Object.values(normalized).some(Boolean) ? normalized : undefined
}

async function testSelector(input: SelectorTestInput): Promise<SelectorTestResult> {
  const data = vault.requireData()
  const account = data.accounts.find((entry) => entry.id === input.accountId)
  const site = account
    ? data.sites.find((entry) => entry.id === account.siteId)
    : undefined
  if (!account || !site) {
    throw new Error('账号或站点不存在')
  }

  const browser = discoverDefaultBrowser(
    allowDevelopmentOverrides ? process.env.AUTOLOGIN_BROWSER_EXECUTABLE : undefined
  )
  assertChromiumBrowser(browser)
  const testDirectory = join(dataDirectory, 'selector-tests', randomUUID())
  mkdirSync(testDirectory, { recursive: true })
  let host: ExternalBrowserHost | null = null
  try {
    host = await ExternalBrowserHost.launch({
      browser,
      profileDirectory: testDirectory,
      headless: true,
      proxy: vault.getSettings().proxy,
      initialUrl: normalizeUrl(input.url?.trim() || site.startUrl)
    })
    const page = await host.createPage({
      initialUrl: normalizeUrl(input.url?.trim() || site.startUrl),
      onEvent: () => undefined,
      onClosed: () => undefined
    })
    await page.waitForLoad()
    const result = await page.runAgentCommand({
      type: 'test-selector',
      field: input.field,
      selector: input.selector
    })
    if (!result || typeof result !== 'object') {
      throw new Error('页面未返回元素测试结果')
    }
    const record = result as Partial<SelectorTestResult>
    return {
      found: Boolean(record.found),
      visible: Boolean(record.visible),
      count: typeof record.count === 'number' ? record.count : 0,
      message:
        typeof record.message === 'string' && record.message
          ? record.message
          : record.found
            ? '已找到匹配元素'
            : '未找到匹配元素'
    }
  } finally {
    await host?.close().catch(() => undefined)
    rmSync(testDirectory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 })
  }
}

function assertManualSelectors(
  strategy: 'auto' | 'manual',
  selectors: { username?: string; password?: string } | undefined
): void {
  if (strategy !== 'manual') return
  if (!selectors?.username || !selectors.password) {
    throw new Error('手动配置需要填写用户名和密码的样式定位器')
  }
}

function hasManualLoginSteps(steps: RecipeStep[] | undefined): boolean {
  if (!steps?.length) return false
  return (
    steps.some((step) => step.type === 'fillUsername') &&
    steps.some((step) => step.type === 'fillPassword')
  )
}

function assertManualConfiguration(
  strategy: 'auto' | 'manual',
  selectors: { username?: string; password?: string } | undefined,
  steps: RecipeStep[] | undefined
): void {
  if (strategy !== 'manual') return
  if (hasManualLoginSteps(steps)) return
  assertManualSelectors(strategy, selectors)
}

function updateAccount(
  accountId: string,
  patch: {
    label?: string
    username?: string
    password?: string
    favorite?: boolean
    activeRecipeId?: string
    loginStrategy?: 'auto' | 'manual'
    manualSelectors?: {
      username?: string
      password?: string
      submit?: string
    }
    manualSteps?: RecipeStep[]
  }
): AccountWithSite {
  const data = vault.requireData()
  const account = data.accounts.find((entry) => entry.id === accountId)
  if (!account) {
    throw new Error('账号不存在')
  }
  const site = data.sites.find((entry) => entry.id === account.siteId)
  if (!site) {
    throw new Error('站点不存在')
  }
  if (patch.label !== undefined) account.label = patch.label.trim()
  if (patch.username !== undefined) account.username = patch.username.trim()
  if (patch.password !== undefined) account.password = patch.password
  if (patch.favorite !== undefined) account.favorite = patch.favorite
  if (patch.loginStrategy !== undefined) account.loginStrategy = patch.loginStrategy
  if (patch.manualSelectors !== undefined) {
    account.manualSelectors = normalizeManualSelectors({
      ...account.manualSelectors,
      ...patch.manualSelectors
    })
  }
  if (patch.manualSteps !== undefined) {
    account.manualSteps = patch.manualSteps.length
      ? structuredClone(patch.manualSteps)
      : undefined
  }
  if (patch.activeRecipeId !== undefined) {
    if (
      patch.activeRecipeId &&
      !(account.recipes ?? []).some((recipe) => recipe.id === patch.activeRecipeId)
    ) {
      throw new Error('录制流程不存在')
    }
    account.activeRecipeId = patch.activeRecipeId || undefined
  }
  assertManualConfiguration(
    account.loginStrategy,
    account.manualSelectors,
    account.manualSteps
  )
  account.updatedAt = new Date().toISOString()
  vault.save()
  return toPublicAccount(account, site)
}

function setAccountStrategyBatch(
  input: AccountBatchStrategyInput
): AccountWithSite[] {
  const data = vault.requireData()
  const siteMap = new Map(data.sites.map((site) => [site.id, site]))
  const accounts = input.accountIds.map((accountId) => {
    const account = data.accounts.find((entry) => entry.id === accountId)
    if (!account) throw new Error('所选账号中包含不存在的记录')
    if (!siteMap.has(account.siteId)) throw new Error('所选账号包含失效的站点')
    return account
  })
  const sharedSelectors = normalizeManualSelectors(input.manualSelectors)
  const sharedSteps = input.manualSteps?.length
    ? structuredClone(input.manualSteps)
    : undefined

  if (
    input.loginStrategy === 'manual' &&
    !sharedSteps &&
    input.manualSelectors &&
    (!sharedSelectors?.username || !sharedSelectors.password)
  ) {
    throw new Error('批量手动配置需要同时填写用户名和密码定位器')
  }
  if (
    input.loginStrategy === 'manual' &&
    sharedSteps &&
    !hasManualLoginSteps(sharedSteps)
  ) {
    throw new Error('批量手动配置至少需要包含输入用户名和输入密码步骤')
  }
  if (input.loginStrategy === 'manual' && !sharedSelectors && !sharedSteps) {
    const incomplete = accounts.some(
      (account) =>
        !hasManualLoginSteps(account.manualSteps) &&
        (!account.manualSelectors?.username || !account.manualSelectors.password)
    )
    if (incomplete) {
      throw new Error('部分账号尚无完整定位器，请填写统一定位器后再应用')
    }
  }

  const now = new Date().toISOString()
  for (const account of accounts) {
    account.loginStrategy = input.loginStrategy
    if (input.loginStrategy === 'manual' && sharedSteps) {
      account.manualSelectors = undefined
      account.manualSteps = structuredClone(sharedSteps)
    } else if (input.loginStrategy === 'manual' && sharedSelectors) {
      account.manualSelectors = structuredClone(sharedSelectors)
      account.manualSteps = undefined
    }
    account.updatedAt = now
  }
  vault.save()
  return accounts.map((account) =>
    toPublicAccount(account, siteMap.get(account.siteId)!)
  )
}

function setAccountIconBatch(input: AccountBatchIconInput): AccountWithSite[] {
  const data = vault.requireData()
  const siteMap = new Map(data.sites.map((site) => [site.id, site]))
  const accounts = input.accountIds.map((accountId) => {
    const account = data.accounts.find((entry) => entry.id === accountId)
    if (!account) throw new Error('所选账号中包含不存在的记录')
    if (!siteMap.has(account.siteId)) throw new Error('所选账号包含失效的站点')
    return account
  })
  const siteIds = new Set(accounts.map((account) => account.siteId))
  const now = new Date().toISOString()

  for (const site of data.sites) {
    if (!siteIds.has(site.id)) continue
    site.icon = input.icon
    site.updatedAt = now
  }
  for (const account of accounts) {
    account.updatedAt = now
  }

  vault.save()
  return accounts.map((account) =>
    toPublicAccount(account, siteMap.get(account.siteId)!)
  )
}

async function fetchAccountIconsFromSites(
  accountIds: string[]
): Promise<AccountBatchIconFetchResult> {
  const data = vault.requireData()
  const siteMap = new Map(data.sites.map((site) => [site.id, site]))
  const selectedIds = new Set(accountIds)
  const uniqueSites = new Map<string, Site>()

  for (const account of data.accounts) {
    if (!selectedIds.has(account.id)) continue
    const site = siteMap.get(account.siteId)
    if (!site) throw new Error('所选账号包含失效的站点')
    uniqueSites.set(site.id, site)
  }
  if (uniqueSites.size === 0) throw new Error('所选账号中包含不存在的记录')

  const queue = [...uniqueSites.values()]
  const results = new Map<string, string>()
  let cursor = 0
  const worker = async (): Promise<void> => {
    while (cursor < queue.length) {
      const site = queue[cursor]
      cursor += 1
      if (!site) continue
      try {
        results.set(site.id, await fetchSiteIcon(site.startUrl))
      } catch {
        // Continue with the remaining sites and report failures together.
      }
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(4, queue.length) }, () => worker())
  )

  const latestData = vault.requireData()
  const latestSiteMap = new Map(latestData.sites.map((site) => [site.id, site]))
  const updatedSiteIds = new Set(results.keys())
  const now = new Date().toISOString()
  const failedSites: string[] = []
  const updatedAccountIds = new Set<string>()

  for (const site of uniqueSites.values()) {
    const latestSite = latestSiteMap.get(site.id)
    if (!latestSite) {
      updatedSiteIds.delete(site.id)
      continue
    }
    const icon = results.get(site.id)
    if (!icon) {
      failedSites.push(latestSite.name)
      continue
    }
    latestSite.icon = icon
    latestSite.updatedAt = now
  }
  for (const account of latestData.accounts) {
    if (!selectedIds.has(account.id) || !updatedSiteIds.has(account.siteId)) continue
    account.updatedAt = now
    updatedAccountIds.add(account.id)
  }

  if (updatedSiteIds.size > 0) vault.save()
  return {
    updatedAccounts: updatedAccountIds.size,
    updatedSites: updatedSiteIds.size,
    failedSites
  }
}

function duplicateAccounts(accountIds: string[]): AccountWithSite[] {
  const data = vault.requireData()
  const siteMap = new Map(data.sites.map((site) => [site.id, site]))
  const originals = accountIds.map((accountId) => {
    const account = data.accounts.find((entry) => entry.id === accountId)
    if (!account) throw new Error('所选账号中包含不存在的记录')
    const site = siteMap.get(account.siteId)
    if (!site) throw new Error('所选账号包含失效的站点')
    return { account, site }
  })

  const namesByTab = new Map<string, Set<string>>()
  const namesForTab = (tabId: string): Set<string> => {
    const existing = namesByTab.get(tabId)
    if (existing) return existing
    const created = new Set(
      data.sites
        .filter((site) => site.tabId === tabId)
        .map((site) => normalizeSiteName(site.name))
    )
    namesByTab.set(tabId, created)
    return created
  }
  const now = new Date().toISOString()
  const created: Array<{ account: StoredAccount; site: Site }> = []

  for (const original of originals) {
    const tabId = original.site.tabId ?? original.account.tabId ?? DEFAULT_ACCOUNT_TAB_ID
    const copyName = uniqueCopyName(original.site.name, namesForTab(tabId))
    const site: Site = {
      ...structuredClone(original.site),
      id: randomUUID(),
      tabId,
      name: copyName,
      createdAt: now,
      updatedAt: now
    }
    const recipeIds = new Map<string, string>()
    const recipes = (original.account.recipes ?? []).map((recipe) => {
      const id = randomUUID()
      recipeIds.set(recipe.id, id)
      return { ...structuredClone(recipe), id }
    })
    const account: StoredAccount = {
      ...structuredClone(original.account),
      id: randomUUID(),
      tabId,
      siteId: site.id,
      label: copyName,
      favorite: false,
      recipes,
      activeRecipeId: original.account.activeRecipeId
        ? recipeIds.get(original.account.activeRecipeId)
        : undefined,
      lastUsedAt: undefined,
      sortOrder: nextAccountSortOrder(data, tabId),
      createdAt: now,
      updatedAt: now
    }
    data.sites.push(site)
    data.accounts.push(account)
    created.push({ account, site })
  }

  vault.save()
  for (const entry of created) {
    sessionIndex.add(entry.account.id)
  }
  return created.map((entry) => toPublicAccount(entry.account, entry.site))
}

function uniqueCopyName(baseName: string, takenNames: Set<string>): string {
  const base = baseName.trim()
  let sequence = 1
  while (true) {
    const suffix = sequence === 1 ? ' 副本' : ` 副本 ${sequence}`
    const available = Math.max(1, 80 - suffix.length)
    const candidate = `${base.slice(0, available).trimEnd()}${suffix}`
    const normalized = normalizeSiteName(candidate)
    if (!takenNames.has(normalized)) {
      takenNames.add(normalized)
      return candidate
    }
    sequence += 1
  }
}

function reorderAccounts(input: AccountReorderInput): AccountWithSite[] {
  const data = vault.requireData()
  const accounts = input.accountIds.map((accountId) => {
    const account = data.accounts.find((entry) => entry.id === accountId)
    if (!account) throw new Error('排序列表中包含不存在的账号')
    return account
  })
  const tabId = input.tabId ?? accounts[0]?.tabId ?? DEFAULT_ACCOUNT_TAB_ID
  if (accounts.some((account) => account.tabId !== tabId)) {
    throw new Error('不能跨标签页排序账号')
  }
  accounts.forEach((account, index) => {
    account.sortOrder = index
  })
  vault.save()
  const sites = new Map(data.sites.map((site) => [site.id, site]))
  return accounts.map((account) => toPublicAccount(account, sites.get(account.siteId)!))
}

function moveAccountsToGroup(input: AccountMoveInput): AccountWithSite[] {
  const data = vault.requireData()
  const accounts = input.accountIds.map((accountId) => {
    const account = data.accounts.find((entry) => entry.id === accountId)
    if (!account) throw new Error('所选账号中包含不存在的记录')
    return account
  })
  const tabId = input.tabId ?? accounts[0]?.tabId ?? DEFAULT_ACCOUNT_TAB_ID
  if (accounts.some((account) => account.tabId !== tabId)) {
    throw new Error('不能跨标签页移动账号')
  }
  const groupPath = input.groupPath?.trim() || undefined
  ensureGroupDefinitions(data, tabId)
  if (groupPath && !groupPathExists(data, groupPath, tabId)) {
    throw new Error('目标分组不存在')
  }

  const siteIds = new Set(accounts.map((account) => account.siteId))
  const now = new Date().toISOString()
  for (const site of data.sites) {
    if (site.tabId !== tabId || !siteIds.has(site.id)) continue
    site.group = groupPath
    site.updatedAt = now
  }
  let nextSortOrder = nextAccountSortOrder(data, tabId)
  for (const account of accounts) {
    account.sortOrder = nextSortOrder
    account.updatedAt = now
    nextSortOrder += 1
  }
  vault.save()
  const sites = new Map(data.sites.map((site) => [site.id, site]))
  return accounts.map((account) => toPublicAccount(account, sites.get(account.siteId)!))
}

function listAccounts(): AccountWithSite[] {
  const data = vault.requireData()
  const sites = new Map(data.sites.map((site) => [site.id, site]))
  return data.accounts.flatMap((account) => {
    const site = sites.get(account.siteId)
    return site ? [toPublicAccount(account, site)] : []
  })
}

function toPublicAccount(
  account: Omit<AccountWithSite, 'site'>,
  site: Site
): AccountWithSite {
  return {
    id: account.id,
    tabId: account.tabId,
    siteId: account.siteId,
    label: account.label,
    username: account.username,
    favorite: account.favorite,
    loginStrategy: account.loginStrategy ?? 'auto',
    manualSelectors: structuredClone(account.manualSelectors),
    manualSteps: structuredClone(account.manualSteps),
    recipes: structuredClone(account.recipes ?? []),
    activeRecipeId: account.activeRecipeId,
    lastUsedAt: account.lastUsedAt,
    sortOrder: account.sortOrder,
    createdAt: account.createdAt,
    updatedAt: account.updatedAt,
    site: structuredClone(site)
  }
}

function setActiveAccountRecipe(
  accountId: string,
  recipeId: string | undefined
): AccountWithSite {
  const data = vault.requireData()
  const account = data.accounts.find((entry) => entry.id === accountId)
  if (!account) {
    throw new Error('账号不存在')
  }
  if (recipeId && !(account.recipes ?? []).some((recipe) => recipe.id === recipeId)) {
    throw new Error('录制流程不存在')
  }
  account.activeRecipeId = recipeId
  account.updatedAt = new Date().toISOString()
  vault.save()
  const site = data.sites.find((entry) => entry.id === account.siteId)
  if (!site) {
    throw new Error('站点不存在')
  }
  return toPublicAccount(account, site)
}

function deleteAccountRecipe(accountId: string, recipeId: string): AccountWithSite {
  const data = vault.requireData()
  const account = data.accounts.find((entry) => entry.id === accountId)
  if (!account) {
    throw new Error('账号不存在')
  }
  const recipes = account.recipes ?? []
  if (!recipes.some((recipe) => recipe.id === recipeId)) {
    throw new Error('录制流程不存在')
  }
  account.recipes = recipes.filter((recipe) => recipe.id !== recipeId)
  if (account.activeRecipeId === recipeId) {
    account.activeRecipeId = account.recipes[0]?.id
  }
  account.updatedAt = new Date().toISOString()
  vault.save()
  const site = data.sites.find((entry) => entry.id === account.siteId)
  if (!site) {
    throw new Error('站点不存在')
  }
  return toPublicAccount(account, site)
}

function updateAccountRecipe(input: AccountRecipeUpdateInput): AccountWithSite {
  const data = vault.requireData()
  const account = data.accounts.find((entry) => entry.id === input.accountId)
  if (!account) {
    throw new Error('账号不存在')
  }
  const recipe = (account.recipes ?? []).find((entry) => entry.id === input.recipeId)
  if (!recipe) {
    throw new Error('录制流程不存在')
  }
  if (new Set(input.steps.map((step) => step.id)).size !== input.steps.length) {
    throw new Error('录制流程步骤标识不能重复')
  }
  const now = new Date().toISOString()
  recipe.recipe.steps = structuredClone(input.steps)
  recipe.recipe.updatedAt = now
  account.updatedAt = now
  vault.save()
  const site = data.sites.find((entry) => entry.id === account.siteId)
  if (!site) {
    throw new Error('站点不存在')
  }
  appendAppLog(dataDirectory, {
    level: 'info',
    category: 'data',
    message: `录制流程已更新：${recipe.name}`,
    details: `${input.steps.length} 个步骤`
  })
  return toPublicAccount(account, site)
}

function createAccountTab(input?: {
  name?: string
  color?: string
  source?: 'local' | 'bookmarks'
}): AccountTab {
  const data = vault.requireData()
  const source = input?.source ?? 'local'
  const tab = buildAccountTab(
    data,
    input?.name ?? (source === 'bookmarks' ? '新书签标签' : nextLocalDatabaseName(data)),
    source,
    input?.color ??
      ACCOUNT_TAB_COLORS[
        data.tabs.length % ACCOUNT_TAB_COLORS.length
      ] ??
      ACCOUNT_TAB_COLORS[0]
  )
  data.tabs.push(tab)
  try {
    vault.save()
  } catch (error) {
    data.tabs = data.tabs.filter((entry) => entry.id !== tab.id)
    pendingNewDatabaseTabIds.delete(tab.id)
    throw error
  }
  appendAppLog(dataDirectory, {
    level: 'info',
    category: 'data',
    message: `${source === 'bookmarks' ? '书签' : '账号'}标签页已创建：${tab.name}`
  })
  return structuredClone(tab)
}

function updateAccountTab(tabId: string, input: AccountTabUpdateInput): AccountTab {
  const data = vault.requireData()
  const tab = data.tabs.find((entry) => entry.id === tabId)
  if (!tab) throw new Error('标签页不存在')
  const previousName = tab.name
  const previousDatabaseFileName = tab.databaseFileName
  let renamedFrom: string | null = null
  let renamedTo: string | null = null
  if (input.name !== undefined) {
    const name = input.name.trim()
    if (!isDatabaseNameFileSafe(name)) {
      throw new Error('数据库名称包含无效文件名字符或格式')
    }
    if (
      data.tabs.some(
        (entry) =>
          entry.id !== tabId &&
          entry.name.toLocaleLowerCase() === name.toLocaleLowerCase()
      )
    ) {
      throw new Error('名称已存在')
    }
    if (name !== tab.name) {
      const oldPath = tabDatabasePath(tab)
      const nextFileName = databaseFileNameFor(
        name,
        databaseExtensionForTab(tab)
      )
      const nextPath = join(
        dataDirectory,
        'tabs',
        databaseFolderForTab(tab),
        nextFileName
      )
      const samePath =
        oldPath.toLocaleLowerCase() === nextPath.toLocaleLowerCase()
      if (existsSync(nextPath) && !samePath) {
        throw new Error('目标数据库文件已存在')
      }
      if (existsSync(oldPath) && !samePath) {
        mkdirSync(dirname(nextPath), { recursive: true })
        renameSync(oldPath, nextPath)
        renamedFrom = oldPath
        renamedTo = nextPath
      }
      tab.databaseFileName = nextFileName
      tab.name = name
    }
  }
  if (input.color !== undefined) tab.color = input.color
  tab.updatedAt = new Date().toISOString()
  try {
    vault.save()
  } catch (error) {
    tab.name = previousName
    if (previousDatabaseFileName === undefined) {
      delete tab.databaseFileName
    } else {
      tab.databaseFileName = previousDatabaseFileName
    }
    if (renamedFrom && renamedTo && existsSync(renamedTo)) {
      try {
        renameSync(renamedTo, renamedFrom)
      } catch {
        // Preserve the original save error; the next sync repairs the file.
      }
    }
    throw error
  }
  appendAppLog(dataDirectory, {
    level: 'info',
    category: 'data',
    message: `账号标签页已更新：${tab.name}`
  })
  return structuredClone(tab)
}

async function deleteAccountTab(tabId: string): Promise<void> {
  const data = vault.requireData()
  const tab = data.tabs.find((entry) => entry.id === tabId)
  if (!tab) throw new Error('标签页不存在')
  tab.hidden = true
  tab.updatedAt = new Date().toISOString()
  vault.save()
  appendAppLog(dataDirectory, {
    level: 'warning',
    category: 'data',
    message: `标签页已关闭：${tab.name}`
  })
}

async function purgeAccountTab(tabId: string): Promise<void> {
  const data = vault.requireData()
  const tab = data.tabs.find((entry) => entry.id === tabId)
  if (!tab) throw new Error('标签页不存在')

  const siteIds = new Set(
    data.sites
      .filter((site) => site.tabId === tabId)
      .map((site) => site.id)
  )
  const accountIds = new Set(
    data.accounts
      .filter(
        (account) =>
          account.tabId === tabId || siteIds.has(account.siteId)
      )
      .map((account) => account.id)
  )
  const databasePaths = new Set([
    tabDatabasePath(tab),
    legacyTabDatabasePath(tab)
  ])

  data.tabs = data.tabs.filter((entry) => entry.id !== tabId)
  data.sites = data.sites.filter(
    (site) => site.tabId !== tabId && !siteIds.has(site.id)
  )
  data.accounts = data.accounts.filter(
    (account) =>
      account.tabId !== tabId && !accountIds.has(account.id)
  )
  data.groupDefinitions = data.groupDefinitions.filter(
    (group) => group.tabId !== tabId
  )
  data.deletedAccounts = data.deletedAccounts.filter(
    (record) => record.tabId !== tabId && !accountIds.has(record.account.id)
  )
  delete data.settings.groupOrders[tabId]
  if (tabId === DEFAULT_ACCOUNT_TAB_ID) {
    data.settings.groupOrder = []
  }
  vault.save()
  pendingNewDatabaseTabIds.delete(tabId)

  for (const accountId of accountIds) {
    try {
      await batchManager?.clearSession(accountId)
      await loginManager?.clearSession(accountId)
      clearManagedSessionDirectories(dataDirectory, accountId)
      sessionIndex.remove(accountId)
    } catch (error) {
      appendAppLog(dataDirectory, {
        level: 'warning',
        category: 'error',
        message: '删除数据库时未能完全清理浏览器会话',
        details: sanitizeLogDetails(
          error instanceof Error ? error.message : String(error)
        )
      })
    }
  }

  for (const databasePath of databasePaths) {
    rmSync(databasePath, {
      force: true,
      maxRetries: 3,
      retryDelay: 120
    })
  }

  appendAppLog(dataDirectory, {
    level: 'warning',
    category: 'data',
    message: `${tab.source === 'bookmarks' ? '书签' : '数据库'}已关闭并永久删除：${tab.name}`
  })
}

function buildAccountTab(
  data: VaultData,
  requestedName: string,
  source: AccountTab['source'],
  color: string,
  originalFileName?: string
): AccountTab {
  const baseName = requestedName.trim().slice(0, 40) || '新标签'
  const taken = new Set(data.tabs.map((tab) => tab.name.toLocaleLowerCase()))
  const extension = databaseExtensionForSource(source, originalFileName)
  let databaseFileName = databaseFileNameFor(
    normalizeDatabaseName(baseName),
    extension
  )
  let name = baseName
  let sequence = 2
  name = normalizeDatabaseName(name)
  while (
    taken.has(name.toLocaleLowerCase()) ||
    data.tabs.some(
      (tab) =>
        (
          tab.databaseFileName ??
          databaseFileNameFor(tab.name, databaseExtensionForTab(tab))
        ).toLocaleLowerCase() === databaseFileName.toLocaleLowerCase()
    ) ||
    existsSync(
      join(
        dataDirectory,
        'tabs',
        databaseFolderForSource(source),
        databaseFileName
      )
    )
  ) {
    const suffix = ` ${sequence}`
    name = `${baseName.slice(0, 40 - suffix.length).trimEnd()}${suffix}`
    name = normalizeDatabaseName(name)
    databaseFileName = databaseFileNameFor(name, extension)
    sequence += 1
  }
  const id = randomUUID()
  const now = new Date().toISOString()
  const tab: AccountTab = {
    id,
    name,
    color,
    source,
    databaseFileName,
    hidden: false,
    createdAt: now,
    updatedAt: now
  }
  if (
    shouldWriteEncryptedTabSnapshot(tab) ||
    tab.source === 'bookmarks'
  ) {
    pendingNewDatabaseTabIds.add(tab.id)
  }
  return tab
}

function applyDataImport(
  parsed: ParsedImport,
  source: 'csv' | 'kdbx' | 'bookmarks',
  fileName: string,
  mode: 'current' | 'new' = 'new',
  currentTabId?: string,
  options: { sourcePath?: string } = {}
): DataImportResult {
  const data = vault.requireData()
  const sourceColors: Record<typeof source, string> = {
    csv: '#0E7567',
    kdbx: '#2F80ED',
    bookmarks: '#D97706'
  }
  const fileNameWithoutExtension = fileName.replace(/\.(csv|kdbx|html?|htm)$/i, '')
  const staged = structuredClone(data)
  const targetTab =
    mode === 'current'
      ? staged.tabs.find(
          (tab) => tab.id === (currentTabId ?? DEFAULT_ACCOUNT_TAB_ID) && !tab.hidden
        )
      : source === 'kdbx'
        ? buildOpenedDatabaseTab(
            staged,
            fileName,
            source,
            sourceColors[source]
          )
        : buildAccountTab(
            staged,
            source === 'csv' ? nextLocalDatabaseName(staged) : fileNameWithoutExtension,
            source,
            sourceColors[source],
            fileName
          )
  if (!targetTab) {
    throw new Error('当前数据库不存在，无法导入 CSV')
  }
  if (mode === 'new') staged.tabs.push(targetTab)
  const merged = mergeImportedLogins(staged, source, parsed, targetTab.id)
  if (mode === 'new' && options.sourcePath) {
    ensureOpenedDatabaseFileStored(targetTab, options.sourcePath)
  }
  repairGroupDefinitions(merged.data)
  data.tabs = merged.data.tabs
  data.sites = merged.data.sites
  data.accounts = merged.data.accounts
  data.groupDefinitions = merged.data.groupDefinitions
  data.settings.groupOrders = merged.data.settings.groupOrders
  data.settings.groupOrder = merged.data.settings.groupOrder
  vault.save()
  sessionIndex.replace(data.accounts.map((account) => account.id))
  return merged.result
}

function applyAutologinImport(
  imported: VaultData,
  options: {
    fileName?: string
    sourcePath?: string
    exactFileName?: boolean
  } = {}
): DataImportResult {
  const data = vault.requireData()
  const existingTabIds = new Set(data.tabs.map((tab) => tab.id))
  const preferredTabName =
    options.exactFileName && options.fileName
      ? normalizeDatabaseName(databaseNameFromFileName(options.fileName))
      : undefined
  const merged = mergeAutologinSnapshot(data, imported, {
    preferredTabName,
    allowSuffixOnConflict: !options.exactFileName
  })
  const targetTab = merged.data.tabs.find((tab) => tab.id === merged.result.tabId)
  for (const tab of merged.data.tabs) {
    if (
      !existingTabIds.has(tab.id) &&
      shouldWriteEncryptedTabSnapshot(tab)
    ) {
      pendingNewDatabaseTabIds.add(tab.id)
    }
  }
  if (options.sourcePath && targetTab) {
    ensureOpenedDatabaseFileStored(targetTab, options.sourcePath)
  }
  repairGroupDefinitions(merged.data)
  data.tabs = merged.data.tabs
  data.sites = merged.data.sites
  data.accounts = merged.data.accounts
  data.groupDefinitions = merged.data.groupDefinitions
  data.settings.groupOrders = merged.data.settings.groupOrders
  data.settings.groupOrder = merged.data.settings.groupOrder
  vault.save()
  sessionIndex.replace(data.accounts.map((account) => account.id))
  return merged.result
}

function buildOpenedDatabaseTab(
  data: VaultData,
  fileName: string,
  source: 'kdbx',
  color: string
): AccountTab {
  const name = normalizeDatabaseName(
    databaseNameFromFileName(fileName).slice(0, 40)
  )
  const extension = databaseExtensionForSource(source, fileName)
  const databaseFileName = databaseFileNameFor(name, extension)
  const nameConflict = data.tabs.some(
    (tab) => tab.name.toLocaleLowerCase() === name.toLocaleLowerCase()
  )
  const fileConflict = data.tabs.some(
    (tab) =>
      (
        tab.databaseFileName ??
        databaseFileNameFor(tab.name, databaseExtensionForTab(tab))
      ).toLocaleLowerCase() === databaseFileName.toLocaleLowerCase()
  )
  if (nameConflict || fileConflict) {
    throw new Error(`数据库“${name}”已在标签页中打开，未创建副本`)
  }
  const now = new Date().toISOString()
  return {
    id: randomUUID(),
    name,
    color,
    source,
    databaseFileName,
    hidden: false,
    createdAt: now,
    updatedAt: now
  }
}

function ensureOpenedDatabaseFileStored(
  tab: AccountTab,
  sourcePath: string
): void {
  const databaseFileName =
    tab.databaseFileName ??
    databaseFileNameFor(tab.name, databaseExtensionForTab(tab))
  const targetPath = join(
    dataDirectory,
    'tabs',
    databaseFolderForTab(tab),
    databaseFileName
  )
  if (
    resolve(sourcePath).toLocaleLowerCase() ===
    resolve(targetPath).toLocaleLowerCase()
  ) {
    return
  }
  if (existsSync(targetPath)) {
    throw new Error(`数据库文件“${databaseFileName}”已存在，未覆盖原文件`)
  }
  mkdirSync(dirname(targetPath), { recursive: true })
  if (pathIsInside(join(dataDirectory, 'tabs'), sourcePath)) {
    renameSync(sourcePath, targetPath)
  } else {
    copyFileSync(sourcePath, targetPath)
  }
}

function findExistingDatabaseTab(
  filePath: string,
  kind: LocalDatabaseKind
): AccountTab | null {
  const data = vault.requireData()
  const normalizedPath = resolve(filePath).toLocaleLowerCase()
  const exact = data.tabs.find(
    (tab) =>
      tabMatchesDatabaseKind(tab, kind) &&
      (resolve(tabDatabasePath(tab)).toLocaleLowerCase() === normalizedPath ||
        resolve(legacyTabDatabasePath(tab)).toLocaleLowerCase() === normalizedPath)
  )
  if (exact) return exact

  const tabsDirectory = resolve(join(dataDirectory, 'tabs')).toLocaleLowerCase()
  if (
    normalizedPath !== tabsDirectory &&
    !pathIsInside(tabsDirectory, normalizedPath)
  ) {
    return null
  }
  const requestedName = normalizeDatabaseName(
    databaseNameFromFileName(basename(filePath))
  )
    .replace(/\s+/g, '')
    .toLocaleLowerCase()
  return (
    data.tabs.find(
      (tab) =>
        tabMatchesDatabaseKind(tab, kind) &&
        normalizeDatabaseName(tab.name)
          .replace(/\s+/g, '')
          .toLocaleLowerCase() === requestedName
    ) ?? null
  )
}

function tabMatchesDatabaseKind(
  tab: AccountTab,
  kind: LocalDatabaseKind
): boolean {
  return kind === 'kdbx'
    ? tab.source === 'kdbx'
    : tab.source === 'local' || tab.source === 'autologin'
}

function activateExistingDatabaseTab(
  tab: AccountTab,
  source: LocalDatabaseKind,
  fileName: string
): ExistingDatabaseSelection {
  if (tab.hidden) {
    tab.hidden = false
    tab.updatedAt = new Date().toISOString()
    vault.save()
  }
  return {
    kind: 'existing',
    source,
    tabId: tab.id,
    tabName: tab.name,
    fileName
  }
}

function appendImportLog(result: DataImportResult, fileName: string): void {
  appendAppLog(dataDirectory, {
    level: result.accountsCreated > 0 ? 'success' : 'warning',
    category: 'data',
    message: `账号导入完成：${result.tabName}`,
    details: `${fileName}；新增 ${result.sitesCreated} 个站点、${result.accountsCreated} 个账号，跳过 ${result.skipped} 条`
  })
}

async function copySecret(value: string): Promise<void> {
  await clipboard.writeText(value)
  if (clipboardClearTimer) {
    clearTimeout(clipboardClearTimer)
  }
  clipboardClearTimer = setTimeout(async () => {
    if ((await clipboard.readText()) === value) {
      await clipboard.clear()
    }
  }, 30_000)
  clipboardClearTimer.unref()
}

function cleanExpiredKdbxSelections(): void {
  const now = Date.now()
  for (const [token, selection] of pendingKdbxSelections) {
    if (selection.expiresAt <= now) {
      pendingKdbxSelections.delete(token)
    }
  }
}

function cleanExpiredDatabaseSelections(): void {
  const now = Date.now()
  for (const [token, selection] of pendingDatabaseSelections) {
    if (selection.expiresAt <= now) {
      pendingDatabaseSelections.delete(token)
    }
  }
}

function normalizeSelectedPath(value: string): string {
  const trimmed = value.trim().replace(/^"(.*)"$/, '$1')
  if (/^file:\/\//i.test(trimmed)) {
    try {
      return resolve(fileURLToPath(trimmed))
    } catch {
      // Fall through to path resolution for malformed file URLs.
    }
  }
  return resolve(trimmed)
}

function resolveSelectedDatabasePath(
  selectedPath: string,
  kind: LocalDatabaseKind
): string | null {
  const normalizedPath = normalizeSelectedPath(selectedPath)
  if (existsSync(normalizedPath)) {
    return normalizedPath
  }

  const tabsRoot = resolve(join(dataDirectory, 'tabs'))
  if (!pathIsInside(tabsRoot, normalizedPath)) {
    return null
  }
  const fileName = basename(normalizedPath)
  const candidates = [
    join(tabsRoot, kind === 'kdbx' ? 'kdbx' : 'autologin', fileName),
    join(tabsRoot, fileName)
  ]
  return candidates.find((candidate) => existsSync(candidate)) ?? null
}

function cleanExpiredAutologinSelections(): void {
  const now = Date.now()
  for (const [token, selection] of pendingAutologinSelections) {
    if (selection.expiresAt <= now) {
      pendingAutologinSelections.delete(token)
    }
  }
}

function safeFileBaseName(value: string): string {
  const cleaned = value
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/g, '')
  return cleaned || 'AutoLogin-export'
}

function fileDateStamp(): string {
  return new Date().toISOString().replace(/\D/g, '').slice(0, 14)
}

function isTitleBarTheme(
  value: unknown
): value is { backgroundColor: string; symbolColor: string; height?: number } {
  if (!value || typeof value !== 'object') return false
  const record = value as Record<string, unknown>
  return (
    typeof record.backgroundColor === 'string' &&
    /^#[0-9a-fA-F]{6}$/.test(record.backgroundColor) &&
    typeof record.symbolColor === 'string' &&
    /^#[0-9a-fA-F]{6}$/.test(record.symbolColor) &&
    (record.height === undefined ||
      (typeof record.height === 'number' && record.height >= 32 && record.height <= 64))
  )
}

function assertTrustedSender(event: IpcMainInvokeEvent | IpcMainEvent): void {
  if (!mainWindow || event.sender.id !== mainWindow.webContents.id) {
    throw new Error('不受信任的调用来源')
  }
}

function dataLocationInfo(restartRequired = false): DataLocationInfo {
  return {
    directory: dataDirectory,
    defaultDirectory: configDirectory,
    isDefault: sameDirectory(dataDirectory, configDirectory),
    ...(restartRequired ? { restartRequired: true } : {})
  }
}

async function chooseDataLocation(): Promise<DataLocationChoiceResult | null> {
  if (!mainWindow) {
    return null
  }
  const selection = await dialog.showOpenDialog(mainWindow, {
    title: '选择 AutoLogin 数据目录',
    buttonLabel: '使用此文件夹',
    properties: ['openDirectory', 'createDirectory']
  })
  const selected = selection.filePaths[0]
  if (selection.canceled || !selected) {
    return null
  }

  const target = resolve(selected)
  if (sameDirectory(target, dataDirectory)) {
    return { status: 'changed', info: dataLocationInfo() }
  }
  assertDataLocationTarget(target)
  if (hasManagedDataDirectory(target)) {
    return { status: 'occupied', directory: target }
  }

  return {
    status: 'changed',
    info: await applyDataLocationChange(target, 'migrate')
  }
}

async function resolveDataLocationConflict(
  directory: string,
  action: DataLocationConflictAction
): Promise<DataLocationInfo> {
  const target = resolve(directory)
  if (sameDirectory(target, dataDirectory)) {
    return dataLocationInfo()
  }
  assertDataLocationTarget(target)
  if (action === 'load' && !hasManagedDataDirectory(target)) {
    throw new Error('目标目录中的旧数据已不存在，请重新选择目录')
  }
  return applyDataLocationChange(target, action)
}

function assertDataLocationTarget(target: string): void {
  if (pathIsInside(dirname(app.getPath('exe')), target)) {
    throw new Error('数据目录不能位于 AutoLogin 安装目录内，以免升级时丢失')
  }
}

async function applyDataLocationChange(
  targetDirectory: string,
  mode: 'migrate' | 'load' | 'overwrite'
): Promise<DataLocationInfo> {
  const target = resolve(targetDirectory)
  assertDataLocationTarget(target)
  await closeLoginManagers()
  vault.lock()
  try {
    if (mode === 'load') {
      writeDataDirectory(dataLocationPointerDirectory, target)
    } else {
      migrateDataDirectory(dataLocationPointerDirectory, dataDirectory, target, {
        replaceExisting: mode === 'overwrite'
      })
    }
    writeDataDirectory(configDirectory, target)
    dataDirectory = target
    initializeDataStores()
    ensureLoginManagers()
    sendToRenderer('vault:locked')
    return dataLocationInfo(true)
  } catch (error) {
    // A failed migration may still have committed the location pointer. Reload
    // from the pointer so the running app never keeps using a removed source.
    dataDirectory = readDataDirectory(
      dataLocationPointerDirectory,
      [configDirectory],
      configDirectory
    )
    initializeDataStores()
    ensureLoginManagers()
    sendToRenderer('vault:locked')
    throw error
  }
}

async function restoreDefaultDataLocation(): Promise<DataLocationInfo> {
  const target = resolve(configDirectory)
  if (sameDirectory(target, dataDirectory)) {
    return dataLocationInfo()
  }

  await closeLoginManagers()
  vault.lock()
  try {
    migrateDataDirectory(dataLocationPointerDirectory, dataDirectory, target)
    writeDataDirectory(configDirectory, target)
    dataDirectory = target
    initializeDataStores()
    ensureLoginManagers()
    sendToRenderer('vault:locked')
    return dataLocationInfo(true)
  } catch (error) {
    dataDirectory = readDataDirectory(
      dataLocationPointerDirectory,
      [configDirectory],
      configDirectory
    )
    initializeDataStores()
    ensureLoginManagers()
    sendToRenderer('vault:locked')
    throw error
  }
}

function initializeAutoUpdater(): void {
  if (updaterInitialized) return
  updaterInitialized = true
  autoUpdater.setFeedURL(GITHUB_UPDATE_FEED)
  autoUpdater.logger = {
    info(message) {
      appendUpdaterLog('info', message)
    },
    warn(message) {
      appendUpdaterLog('warning', message)
    },
    error(message) {
      appendUpdaterLog('error', message)
      if (String(message).includes('Cannot download differentially, fallback to full download')) {
        markDifferentialFallback()
      }
    }
  }
  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = true
  autoUpdater.allowDowngrade = false

  autoUpdater.on('download-progress', (progress) => {
    const fallbackDetected =
      updateDifferentialFallbackDetected ||
      trackUpdateDownloadProgress(updateDownloadProgressTracker, {
        transferred: progress.transferred,
        total: progress.total
      })
    if (fallbackDetected) {
      updateDifferentialFallbackDetected = true
    }
    publishUpdateState({
      ...updateState,
      phase: 'downloading',
      message: fallbackDetected
        ? DIFFERENTIAL_FALLBACK_MESSAGE
        : '正在下载更新…',
      percent: progress.percent,
      bytesPerSecond: progress.bytesPerSecond,
      transferred: progress.transferred,
      total: progress.total,
      downloadMode: fallbackDetected ? 'full' : 'differential'
    })
  })
  autoUpdater.on('update-downloaded', (info) => {
    updateDownloadCancelled = false
    updateDownloadToken = null
    publishUpdateState({
      ...updateState,
      phase: 'downloaded',
      latestVersion: info.version,
      releaseNotes: updateState.releaseNotes ?? normalizeReleaseNotes(info.releaseNotes),
      message: '更新已下载，重启后即可安装',
      percent: 100
    })
  })
  autoUpdater.on('error', (error) => {
    if (updateDownloadCancelled || updateDownloadToken?.cancelled) return
    if (updateState.phase === 'idle' || updateState.phase === 'up-to-date') return
    publishUpdateState({
      ...updateState,
      phase: 'error',
      message: updateErrorMessage(error)
    })
  })
}

function appendUpdaterLog(
  level: 'info' | 'warning' | 'error',
  message: unknown
): void {
  appendAppLog(dataDirectory, {
    level,
    category: 'update',
    message: '应用更新器日志',
    details: sanitizeLogDetails(String(message))
  })
}

function markDifferentialFallback(): void {
  if (updateDifferentialFallbackDetected) return
  updateDifferentialFallbackDetected = true
  appendAppLog(dataDirectory, {
    level: 'warning',
    category: 'update',
    message: '增量更新失败，已降级为完整安装包下载'
  })
  if (updateState.phase === 'downloading') {
    publishUpdateState({
      ...updateState,
      downloadMode: 'full',
      message: DIFFERENTIAL_FALLBACK_MESSAGE
    })
  }
}

function configureUpdateFeed(source: 'cdn' | 'github'): void {
  if (source === 'cdn') {
    autoUpdater.setFeedURL({
      provider: 'generic',
      url: resolveUpdateCdnBaseUrl({
        environmentUrl: process.env.AUTOLOGIN_UPDATE_CDN_URL,
        configPath: join(process.resourcesPath, 'update-config.json')
      })
    })
    return
  }
  autoUpdater.setFeedURL(GITHUB_UPDATE_FEED)
}

async function selectPrimaryUpdateSource(): Promise<'cdn' | 'github'> {
  if (process.env.AUTOLOGIN_DISABLE_UPDATE_CDN === '1') {
    configureUpdateFeed('github')
    return 'github'
  }

  const cdnBaseUrl = resolveUpdateCdnBaseUrl({
    environmentUrl: process.env.AUTOLOGIN_UPDATE_CDN_URL,
    configPath: join(process.resourcesPath, 'update-config.json')
  })
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 6_000)
  timer.unref()
  try {
    const response = await net.fetch(new URL('latest.yml', cdnBaseUrl).toString(), {
      headers: {
        'Cache-Control': 'no-cache',
        'User-Agent': `AutoLogin/${app.getVersion()}`
      },
      signal: controller.signal
    })
    const contents = await response.text()
    if (response.ok && /(?:^|\n)version:\s*\S+/.test(contents)) {
      configureUpdateFeed('cdn')
      appendAppLog(dataDirectory, {
        level: 'info',
        category: 'update',
        message: '已使用 CDN 更新源',
        details: cdnBaseUrl
      })
      return 'cdn'
    }
    appendUpdaterLog(
      'warning',
      `CDN 更新源不可用：HTTP ${response.status} ${cdnBaseUrl}`
    )
  } catch (error) {
    appendUpdaterLog(
      'warning',
      `CDN 更新源连接失败：${error instanceof Error ? error.message : String(error)}`
    )
  } finally {
    clearTimeout(timer)
  }

  configureUpdateFeed('github')
  return 'github'
}

function scheduleStartupUpdateCheck(): void {
  if (startupUpdateCheckStarted || !app.isPackaged) return
  startupUpdateCheckStarted = true
  const timer = setTimeout(() => {
    void checkForUpdates(false)
  }, 2_500)
  timer.unref()
}

async function checkForUpdates(interactive = true): Promise<UpdateCheckResult> {
  const currentVersion = app.getVersion()
  if (!app.isPackaged) {
    const message = '自动更新仅在安装版中启用'
    publishUpdateState({
      phase: interactive ? 'error' : 'idle',
      currentVersion,
      interactive,
      message: interactive ? message : undefined
    })
    return { status: 'unavailable', currentVersion, message }
  }

  if (updateState.phase === 'downloading' || updateState.phase === 'downloaded') {
    return {
      status: 'available',
      currentVersion,
      latestVersion: updateState.latestVersion,
      releaseUrl: updateState.releaseUrl,
      message:
        updateState.phase === 'downloading' ? '更新正在下载' : '更新已下载，等待重启安装'
    }
  }

  updateDownloadCancelled = false
  publishUpdateState({
    phase: 'checking',
    currentVersion,
    interactive,
    message: '正在检查更新…'
  })

  const primarySource = await selectPrimaryUpdateSource()
  const sources: Array<'cdn' | 'github'> =
    primarySource === 'cdn' ? ['cdn', 'github'] : ['github']

  try {
    let lastError: unknown
    for (const source of sources) {
      try {
        configureUpdateFeed(source)
        return await checkForUpdatesWithActiveFeed(
          currentVersion,
          interactive
        )
      } catch (error) {
        lastError = error
        if (source === 'cdn') {
          appendUpdaterLog(
            'warning',
            `CDN 更新检查失败，切换到 GitHub：${
              error instanceof Error ? error.message : String(error)
            }`
          )
          publishUpdateState({
            phase: 'checking',
            currentVersion,
            interactive,
            message: 'CDN 更新源不可用，正在切换备用源…'
          })
        }
      }
    }
    throw lastError
  } catch (error) {
    const message = updateErrorMessage(error)
    publishUpdateState({
      phase: interactive ? 'error' : 'idle',
      currentVersion,
      interactive,
      message: interactive ? message : undefined
    })
    return { status: 'unavailable', currentVersion, message }
  }
}

async function checkForUpdatesWithActiveFeed(
  currentVersion: string,
  interactive: boolean
): Promise<UpdateCheckResult> {
  const result = await autoUpdater.checkForUpdates()
  const info = result?.updateInfo
  if (!info?.version) {
    const message = '当前没有可用的发布版本'
    publishUpdateState({
      phase: 'up-to-date',
      currentVersion,
      interactive,
      message
    })
    return { status: 'up-to-date', currentVersion, message }
  }

  const latestVersion = info.version.replace(/^v/i, '').trim()
  if (!parseVersion(latestVersion)) {
    throw new Error('更新版本号无效')
  }

  const metadata = await fetchReleaseMetadata(latestVersion, info.releaseNotes)
  if (compareVersions(latestVersion, currentVersion) > 0) {
    const nextState: AppUpdateState = {
      phase: 'available',
      currentVersion,
      latestVersion,
      releaseName: metadata.name ?? `AutoLogin v${latestVersion}`,
      releaseDate: metadata.date,
      releaseNotes: metadata.notes,
      releaseUrl:
        metadata.url ??
        `${REPOSITORY_URL}/releases/tag/v${encodeURIComponent(latestVersion)}`,
      interactive,
      message: `发现新版本 v${latestVersion}`
    }
    publishUpdateState(nextState)
    return {
      status: 'available',
      currentVersion,
      latestVersion,
      releaseUrl: nextState.releaseUrl,
      message: nextState.message ?? ''
    }
  }

  const message = '当前已是最新版本'
  publishUpdateState({
    phase: 'up-to-date',
    currentVersion,
    latestVersion,
    releaseName: metadata.name,
    releaseDate: metadata.date,
    releaseUrl: metadata.url ?? RELEASES_URL,
    interactive,
    message
  })
  return {
    status: 'up-to-date',
    currentVersion,
    latestVersion,
    releaseUrl: metadata.url ?? RELEASES_URL,
    message
  }
}

async function downloadUpdate(): Promise<AppUpdateState> {
  if (!app.isPackaged) {
    throw new Error('自动更新仅在安装版中启用')
  }
  if (updateState.phase === 'downloaded') {
    return getUpdateState()
  }
  if (updateState.phase !== 'available' && updateState.phase !== 'error') {
    throw new Error('当前没有可下载的更新')
  }

  publishUpdateState({
    ...updateState,
    phase: 'downloading',
    interactive: true,
    percent: 0,
    message: '正在下载更新…',
    downloadMode: undefined
  })
  updateDownloadCancelled = false
  updateDifferentialFallbackDetected = false
  updateDownloadProgressTracker = createUpdateDownloadProgressTracker()
  const token = new CancellationToken()
  updateDownloadToken = token
  try {
    await autoUpdater.downloadUpdate(token)
  } catch (error) {
    if (token.cancelled) {
      if (updateDownloadToken === token) {
        publishUpdateState({
          ...getUpdateState(),
          phase: 'available',
          percent: 0,
          bytesPerSecond: undefined,
          transferred: undefined,
          total: undefined,
          message: '更新下载已取消',
          downloadMode: undefined
        })
      }
      return getUpdateState()
    }
    const current = getUpdateState()
    publishUpdateState({
      ...current,
      phase: 'error',
      message: updateErrorMessage(error)
    })
    throw error
  } finally {
    if (updateDownloadToken === token) {
      updateDownloadToken = null
    }
  }
  const current = getUpdateState()
  if (current.phase !== 'downloaded') {
    publishUpdateState({
      ...current,
      phase: 'downloaded',
      percent: 100,
      message: '更新已下载，重启后即可安装'
    })
  }
  return getUpdateState()
}

async function cancelUpdate(): Promise<AppUpdateState> {
  if (updateState.phase !== 'downloading' || !updateDownloadToken) {
    return getUpdateState()
  }
  updateDownloadCancelled = true
  updateDownloadToken.cancel()
  publishUpdateState({
    ...getUpdateState(),
    phase: 'available',
    percent: 0,
    bytesPerSecond: undefined,
    transferred: undefined,
    total: undefined,
    message: '更新下载已取消',
    downloadMode: undefined
  })
  return getUpdateState()
}

async function installUpdate(): Promise<void> {
  if (!app.isPackaged) {
    throw new Error('自动更新仅在安装版中启用')
  }
  if (updateState.phase !== 'downloaded') {
    throw new Error('更新尚未下载完成')
  }
  await closeLoginManagers()
  vault?.lock()
  setTimeout(() => autoUpdater.quitAndInstall(false, true), 100)
}

function getUpdateState(): AppUpdateState {
  return { ...updateState }
}

function publishUpdateState(next: AppUpdateState): void {
  updateState = next
  sendToRenderer('app:update-state', getUpdateState())
}

async function fetchReleaseMetadata(
  version: string,
  fallbackNotes: unknown
): Promise<{ name?: string; date?: string; notes?: string; url?: string }> {
  const fallback = {
    notes: normalizeReleaseNotes(fallbackNotes),
    url: `${REPOSITORY_URL}/releases/tag/v${encodeURIComponent(version)}`
  }
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 8_000)
  timer.unref()
  try {
    const response = await net.fetch(
      `https://api.github.com/repos/${UPDATE_OWNER}/${UPDATE_REPO}/releases/tags/v${encodeURIComponent(version)}`,
      {
        headers: {
          Accept: 'application/vnd.github+json',
          'User-Agent': `AutoLogin/${app.getVersion()}`
        },
        signal: controller.signal
      }
    )
    if (!response.ok) return fallback
    const payload: unknown = await response.json()
    if (!payload || typeof payload !== 'object') return fallback
    const record = payload as Record<string, unknown>
    const body = typeof record.body === 'string' ? record.body.trim() : ''
    return {
      name: typeof record.name === 'string' ? record.name : undefined,
      date:
        typeof record.published_at === 'string'
          ? record.published_at
          : typeof record.created_at === 'string'
            ? record.created_at
            : undefined,
      notes: body || fallback.notes,
      url:
        typeof record.html_url === 'string' && isHttpUrl(record.html_url)
          ? record.html_url
          : fallback.url
    }
  } catch {
    return fallback
  } finally {
    clearTimeout(timer)
  }
}

function normalizeReleaseNotes(value: unknown): string | undefined {
  if (typeof value === 'string') {
    const notes = value.trim()
    return notes || undefined
  }
  if (!Array.isArray(value)) return undefined
  const notes = value
    .map((entry) => {
      if (!entry || typeof entry !== 'object') return ''
      const record = entry as Record<string, unknown>
      const version = typeof record.version === 'string' ? `## v${record.version}` : ''
      const note = typeof record.note === 'string' ? record.note.trim() : ''
      return [version, note].filter(Boolean).join('\n\n')
    })
    .filter(Boolean)
    .join('\n\n')
  return notes || undefined
}

function updateErrorMessage(error: unknown): string {
  const detail = error instanceof Error ? error.message : String(error)
  return detail.trim() ? `更新失败：${detail}` : '更新失败，请稍后重试'
}

interface ParsedVersion {
  numbers: [number, number, number]
  prerelease: string[]
}

function parseVersion(value: string): ParsedVersion | null {
  const match = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/.exec(value.trim())
  if (!match) {
    return null
  }
  return {
    numbers: [Number(match[1]), Number(match[2]), Number(match[3])],
    prerelease: match[4] ? match[4].split('.') : []
  }
}

function compareVersions(left: string, right: string): number {
  const parsedLeft = parseVersion(left)
  const parsedRight = parseVersion(right)
  if (!parsedLeft || !parsedRight) {
    return 0
  }
  for (let index = 0; index < 3; index += 1) {
    const difference = parsedLeft.numbers[index]! - parsedRight.numbers[index]!
    if (difference !== 0) {
      return difference
    }
  }
  if (parsedLeft.prerelease.length === 0 && parsedRight.prerelease.length > 0) {
    return 1
  }
  if (parsedRight.prerelease.length === 0 && parsedLeft.prerelease.length > 0) {
    return -1
  }
  const count = Math.max(parsedLeft.prerelease.length, parsedRight.prerelease.length)
  for (let index = 0; index < count; index += 1) {
    const leftPart = parsedLeft.prerelease[index]
    const rightPart = parsedRight.prerelease[index]
    if (leftPart === undefined) return -1
    if (rightPart === undefined) return 1
    if (leftPart === rightPart) continue
    const leftNumber = /^\d+$/.test(leftPart) ? Number(leftPart) : null
    const rightNumber = /^\d+$/.test(rightPart) ? Number(rightPart) : null
    if (leftNumber !== null && rightNumber !== null) {
      return leftNumber - rightNumber
    }
    if (leftNumber !== null) return -1
    if (rightNumber !== null) return 1
    return leftPart.localeCompare(rightPart)
  }
  return 0
}

function sameDirectory(left: string, right: string): boolean {
  return resolve(left).toLowerCase() === resolve(right).toLowerCase()
}

async function closeRecordingManager(): Promise<void> {
  const current = loginManager
  loginManager = null
  await current?.close()
}

function isManagedAccountId(value: string): boolean {
  return /^[a-zA-Z0-9_-]{1,128}$/.test(value)
}

function sendToRenderer(channel: string, payload?: unknown): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, payload)
  }
}

function applyInterfaceScale(interfaceScale: number): void {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return
  }
  mainWindow.webContents.setZoomFactor(Math.min(1.25, Math.max(0.8, interfaceScale / 100)))
}

function requireId(value: unknown): string {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > 128 ||
    !/^[a-zA-Z0-9_-]+$/.test(value)
  ) {
    throw new Error('无效的标识')
  }
  return value
}

function requireOptionalTabId(value: unknown): string | undefined {
  if (value === undefined || value === null || value === '') return undefined
  return requireId(value)
}

function safeLogValue(value: string): string {
  const trimmed = value.trim()
  if (!trimmed) return '（空）'
  if (trimmed.includes('@')) {
    const [name, domain] = trimmed.split('@', 2)
    return `${(name ?? '').slice(0, 2)}***@${domain ?? ''}`
  }
  return trimmed.length <= 2 ? '***' : `${trimmed.slice(0, 1)}***${trimmed.slice(-1)}`
}

function firstIssue(error: { issues: Array<{ message: string }> }): string {
  return error.issues[0]?.message ?? '输入内容无效'
}

function normalizeUrl(value: string): string {
  const url = new URL(value.trim())
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('只支持 http 或 https 地址')
  }
  return url.toString()
}

function normalizeOrigin(value: string): string | null {
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.origin : null
  } catch {
    return null
  }
}

function normalizeSiteName(value: string): string {
  return value.trim().toLocaleLowerCase()
}

const SITE_ICON_MAX_BYTES = 512 * 1024
const PAGE_ICON_SCAN_MAX_BYTES = 1024 * 1024

async function fetchSiteIcon(pageUrl: string): Promise<string> {
  const startUrl = new URL(normalizeUrl(pageUrl))
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 10_000)
  timer.unref()
  const candidates = new Set<string>()
  try {
    let pageBaseUrl = startUrl.toString()
    try {
      const pageResponse = await net.fetch(startUrl.toString(), {
        headers: {
          Accept: 'text/html,application/xhtml+xml',
          'User-Agent': `AutoLogin/${app.getVersion()}`
        },
        signal: controller.signal
      })
      if (pageResponse.url && isHttpUrl(pageResponse.url)) {
        pageBaseUrl = pageResponse.url
      }
      const contentType = pageResponse.headers.get('content-type') ?? ''
      const contentLength = Number(pageResponse.headers.get('content-length') ?? 0)
      if (
        pageResponse.ok &&
        contentType.toLowerCase().includes('html') &&
        (!Number.isFinite(contentLength) || contentLength <= PAGE_ICON_SCAN_MAX_BYTES)
      ) {
        const htmlBuffer = await pageResponse.arrayBuffer()
        if (htmlBuffer.byteLength <= PAGE_ICON_SCAN_MAX_BYTES) {
          const html = new TextDecoder().decode(htmlBuffer)
          for (const iconUrl of extractDeclaredIconUrls(html, pageBaseUrl)) {
            candidates.add(iconUrl)
          }
        }
      }
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') throw error
    }

    candidates.add(new URL('/favicon.ico', pageBaseUrl).toString())
    candidates.add(new URL('/apple-touch-icon.png', pageBaseUrl).toString())

    for (const candidate of [...candidates].slice(0, 6)) {
      if (!isHttpUrl(candidate)) continue
      try {
        const response = await net.fetch(candidate, {
          headers: {
            Accept: 'image/avif,image/webp,image/png,image/svg+xml,image/x-icon,image/*,*/*;q=0.8',
            'User-Agent': `AutoLogin/${app.getVersion()}`
          },
          signal: controller.signal
        })
        if (!response.ok) continue
        const contentLength = Number(response.headers.get('content-length') ?? 0)
        if (Number.isFinite(contentLength) && contentLength > SITE_ICON_MAX_BYTES) {
          continue
        }
        const mime = resolveIconMime(
          response.headers.get('content-type'),
          response.url || candidate
        )
        if (!mime) continue
        const iconBuffer = Buffer.from(await response.arrayBuffer())
        if (iconBuffer.byteLength === 0 || iconBuffer.byteLength > SITE_ICON_MAX_BYTES) {
          continue
        }
        return `data:${mime};base64,${iconBuffer.toString('base64')}`
      } catch (error) {
        if (error instanceof Error && error.name === 'AbortError') throw error
      }
    }
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error('获取站点图标超时，请稍后重试或上传本地图片')
    }
    throw new Error('无法从该站点获取图标，请上传本地图片')
  } finally {
    clearTimeout(timer)
  }
  throw new Error('该站点没有可用的图标，请上传本地图片')
}

function extractDeclaredIconUrls(html: string, baseUrl: string): string[] {
  const results: string[] = []
  for (const tag of html.match(/<link\b[^>]*>/gi) ?? []) {
    const rel = readHtmlAttribute(tag, 'rel')?.trim().toLowerCase() ?? ''
    if (!/(?:^|\s)(?:icon|apple-touch-icon(?:-precomposed)?)(?:\s|$)/i.test(rel)) {
      continue
    }
    const href = readHtmlAttribute(tag, 'href')
      ?.replaceAll('&amp;', '&')
      .replaceAll('&quot;', '"')
      .trim()
    if (!href) continue
    try {
      const resolved = new URL(href, baseUrl).toString()
      if (isHttpUrl(resolved) && !results.includes(resolved)) results.push(resolved)
    } catch {
      // Ignore malformed icon links and continue with favicon fallbacks.
    }
  }
  return results
}

function readHtmlAttribute(tag: string, name: string): string | null {
  const match = tag.match(
    new RegExp(`\\b${name}\\s*=\\s*(?:\"([^\"]*)\"|'([^']*)'|([^\\s>]+))`, 'i')
  )
  return match?.[1] ?? match?.[2] ?? match?.[3] ?? null
}

function resolveIconMime(contentType: string | null, url: string): string | null {
  const normalized = contentType?.split(';')[0]?.trim().toLowerCase() ?? ''
  if (normalized.startsWith('image/')) return normalized
  try {
    const pathname = new URL(url).pathname.toLowerCase()
    if (pathname.endsWith('.svg')) return 'image/svg+xml'
    if (pathname.endsWith('.png')) return 'image/png'
    if (pathname.endsWith('.webp')) return 'image/webp'
    if (pathname.endsWith('.gif')) return 'image/gif'
    if (pathname.endsWith('.jpg') || pathname.endsWith('.jpeg')) return 'image/jpeg'
    if (pathname.endsWith('.ico')) return 'image/x-icon'
  } catch {
    return null
  }
  return null
}

async function applySystemProxy(proxy: ProxySettings): Promise<void> {
  if (proxy.mode === 'system') {
    await session.defaultSession.setProxy({ mode: 'system' })
  } else if (proxy.enabled && proxy.host.trim()) {
    await session.defaultSession.setProxy({
      mode: 'fixed_servers',
      proxyRules: `${proxy.protocol}://${proxy.host.trim()}:${proxy.port}`,
      proxyBypassRules: proxy.bypassList
    })
  } else {
    await session.defaultSession.setProxy({ mode: 'direct' })
  }
  await session.defaultSession.closeAllConnections()
}

async function testProxy(settings: ProxySettings): Promise<ProxyTestResult> {
  if (settings.mode === 'system') {
    const testSession = session.fromPartition(`autologin-proxy-test-${randomUUID()}`)
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 8_000)
    const startedAt = Date.now()
    try {
      await testSession.setProxy({ mode: 'system' })
      const response = await testSession.fetch(settings.testUrl, {
        headers: {
          Accept: 'text/plain',
          'User-Agent': `AutoLogin/${app.getVersion()}`
        },
        signal: controller.signal
      })
      const latencyMs = Date.now() - startedAt
      if (!response.ok) {
        return {
          ok: false,
          latencyMs,
          message: `已使用系统代理，但测试请求返回 HTTP ${response.status}`
        }
      }
      return {
        ok: true,
        latencyMs,
        message: `系统代理连接正常，延迟 ${latencyMs} ms`
      }
    } catch (error) {
      const message =
        error instanceof Error && error.name === 'AbortError'
          ? '系统代理连接超时'
          : error instanceof Error
            ? `系统代理连接失败：${error.message}`
            : '系统代理连接失败'
      return { ok: false, message }
    } finally {
      clearTimeout(timer)
      await testSession.closeAllConnections().catch(() => undefined)
    }
  }
  if (!settings.enabled) {
    return { ok: false, message: '请先启用代理配置' }
  }
  if (!settings.host.trim()) {
    return { ok: false, message: '请输入代理服务器地址' }
  }

  const testSession = session.fromPartition(`autologin-proxy-test-${randomUUID()}`)
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 8_000)
  const startedAt = Date.now()
  try {
    await testSession.setProxy({
      mode: 'fixed_servers',
      proxyRules: `${settings.protocol}://${settings.host.trim()}:${settings.port}`,
      proxyBypassRules: settings.bypassList
    })
    const response = await testSession.fetch(settings.testUrl, {
      headers: {
        Accept: 'text/plain',
        'User-Agent': `AutoLogin/${app.getVersion()}`
      },
      signal: controller.signal
    })
    const latencyMs = Date.now() - startedAt
    if (!response.ok) {
      return {
        ok: false,
        latencyMs,
        message: `代理已连接，但测试请求返回 HTTP ${response.status}`
      }
    }
    return {
      ok: true,
      latencyMs,
      message: `代理连接正常，延迟 ${latencyMs} ms`
    }
  } catch (error) {
    const message =
      error instanceof Error && error.name === 'AbortError'
        ? '代理连接超时'
        : error instanceof Error
          ? `代理连接失败：${error.message}`
          : '代理连接失败'
    return { ok: false, message }
  } finally {
    clearTimeout(timer)
    await testSession.closeAllConnections().catch(() => undefined)
  }
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

function safeLogUrl(value: string): string {
  try {
    const url = new URL(value)
    return `${url.origin}${url.pathname}`
  } catch {
    return '无效地址'
  }
}

function sanitizeLogDetails(value: string): string {
  return value.replace(/https?:\/\/[^\s]+/gi, (url) => safeLogUrl(url))
}
