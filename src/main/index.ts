import { app, BrowserWindow, clipboard, dialog, ipcMain, Menu, net, session, shell } from 'electron'
import { existsSync, mkdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { IpcMainEvent, IpcMainInvokeEvent } from 'electron'
import { autoUpdater } from 'electron-updater'
import {
  accountCreateInputSchema,
  accountUpdateInputSchema,
  appSettingsPatchSchema,
  changePasswordSchema,
  favoriteGroupInputSchema,
  kdbxSelectionImportSchema,
  loginBatchStartSchema,
  loginLogDeleteSchema,
  loginLogQuerySchema,
  loginStartSchema,
  masterPasswordSchema,
  proxyTestInputSchema,
  selectorTestInputSchema,
  siteInputSchema
} from '@shared/schemas'
import type {
  AccountWithSite,
  AboutInfo,
  AppUpdateState,
  AppSettings,
  BackupRecord,
  DataImportResult,
  DataLocationInfo,
  FileOperationResult,
  KdbxSelection,
  LoginLogEntry,
  LoginLogDeleteResult,
  LoginLogQuery,
  LoginMode,
  LoginBatchState,
  LoginViewState,
  PasswordReveal,
  ProxySettings,
  ProxyTestResult,
  SelectorTestInput,
  SelectorTestResult,
  Site,
  SiteInput,
  UpdateCheckResult,
  VaultStatus
} from '@shared/types'
import { BackupManager } from './backups'
import {
  CSV_TEMPLATE,
  mergeImportedLogins,
  parseCsvImport,
  parseKdbxImport,
  type ParsedImport
} from './data-transfer'
import {
  migrateDataDirectory,
  pathIsInside,
  readDataDirectory,
  recoverDataDirectoryFromInstall
} from './data-location'
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
let dataDirectory = ''
let updateState: AppUpdateState = {
  phase: 'idle',
  currentVersion: app.getVersion(),
  interactive: false
}
let updaterInitialized = false
let startupUpdateCheckStarted = false
const pendingKdbxSelections = new Map<
  string,
  { path: string; fileName: string; size: number; expiresAt: number }
>()

const REPOSITORY_URL = ['https:', '//github.com', '/AptimLvStic/AutoLogin'].join('')
const RELEASES_URL = `${REPOSITORY_URL}/releases`

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
  dataDirectory = readDataDirectory(configDirectory)
  dataDirectory = recoverDataDirectoryFromInstall(
    configDirectory,
    dataDirectory,
    dirname(app.getPath('exe'))
  )
  initializeDataStores()
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
      ? join(process.resourcesPath, 'icon.png')
      : join(__dirname, '../../resources/icon.png'),
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
      devTools: !app.isPackaged
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
  window.webContents.on('before-input-event', () => {
    vault?.touch()
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

function initializeDataStores(): void {
  vault = new VaultManager(dataDirectory, () => {
    void closeLoginManagers()
    sendToRenderer('vault:locked')
  })
  backupManager = new BackupManager(dataDirectory)
  sessionIndex = new SessionIndex(dataDirectory)
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
      (state) => sendToRenderer('login:batch-state', state)
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
    sessionIndex.replace([])
    ensureLoginManagers()
    applyInterfaceScale(vault.getSettings().interfaceScale)
    await applySystemProxy(vault.getSettings().proxy)
    return status
  })
  ipcMain.handle('vault:unlock', async (event, password: unknown) => {
    assertTrustedSender(event)
    const parsed = masterPasswordSchema.safeParse(password)
    if (!parsed.success) {
      throw new Error(firstIssue(parsed.error))
    }
    const status = await vault.unlock(parsed.data)
    sessionIndex.replace(vault.requireData().accounts.map((account) => account.id))
    ensureLoginManagers()
    applyInterfaceScale(vault.getSettings().interfaceScale)
    await applySystemProxy(vault.getSettings().proxy)
    return status
  })
  ipcMain.handle('vault:lock', (event) => {
    assertTrustedSender(event)
    void closeLoginManagers()
    return vault.lock()
  })
  ipcMain.handle('vault:change-password', async (event, payload: unknown) => {
    assertTrustedSender(event)
    const parsed = changePasswordSchema.safeParse(payload)
    if (!parsed.success) {
      throw new Error(firstIssue(parsed.error))
    }
    await vault.changePassword(parsed.data.currentPassword, parsed.data.nextPassword)
  })

  ipcMain.handle('sites:list', (event) => {
    assertTrustedSender(event)
    return structuredClone(vault.requireData().sites)
  })
  ipcMain.handle('sites:save', (event, payload: unknown) => {
    assertTrustedSender(event)
    const parsed = siteInputSchema.safeParse(payload)
    if (!parsed.success) {
      throw new Error(firstIssue(parsed.error))
    }
    return saveSite(parsed.data)
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
    return createAccount(parsed.data)
  })
  ipcMain.handle('accounts:update', (event, accountId: unknown, payload: unknown) => {
    assertTrustedSender(event)
    const id = requireId(accountId)
    const parsed = accountUpdateInputSchema.safeParse(payload)
    if (!parsed.success) {
      throw new Error(firstIssue(parsed.error))
    }
    return updateAccount(id, parsed.data)
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
    data.accounts = data.accounts.filter((entry) => entry.id !== id)
    vault.save()
    sessionIndex.remove(id)
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
  })
  ipcMain.handle('accounts:copy-username', (event, accountId: unknown) => {
    assertTrustedSender(event)
    const id = requireId(accountId)
    const account = vault.requireData().accounts.find((entry) => entry.id === id)
    if (!account) {
      throw new Error('账号不存在')
    }
    clipboard.writeText(account.username)
  })

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
    return batchManager.start(parsed.data)
  })
  ipcMain.handle('login:get-batch-state', (event) => {
    assertTrustedSender(event)
    return batchManager?.getState() ?? null
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
    const settings = vault.updateSettings(parsed.data)
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
    return testProxy(parsed.data)
  })

  ipcMain.handle('data:export-vault', async (event): Promise<FileOperationResult> => {
    assertTrustedSender(event)
    vault.requireData()
    if (!mainWindow) {
      return { canceled: true }
    }
    const defaultName = `AutoLogin-v${app.getVersion()}-${fileDateStamp()}.autologin`
    const selection = await dialog.showSaveDialog(mainWindow, {
      title: '导出 AutoLogin 加密配置',
      buttonLabel: '导出',
      defaultPath: join(app.getPath('documents'), defaultName),
      filters: [{ name: 'AutoLogin 加密配置', extensions: ['autologin'] }]
    })
    if (selection.canceled || !selection.filePath) {
      return { canceled: true }
    }
    vault.copyEncryptedTo(selection.filePath)
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
    return { canceled: false, fileName: basename(selection.filePath) }
  })
  ipcMain.handle('data:import-csv', async (event): Promise<DataImportResult | null> => {
    assertTrustedSender(event)
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
    return applyDataImport(parsed, 'csv')
  })
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
    const path = selection.filePaths[0]
    if (selection.canceled || !path) {
      return null
    }
    if (!path.toLocaleLowerCase().endsWith('.kdbx')) {
      throw new Error('请选择 .kdbx 格式的 KeePassXC 数据库')
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
      const imported = await parseKdbxImport(selection.path, parsed.data.password)
      const result = applyDataImport(imported, 'kdbx')
      pendingKdbxSelections.delete(parsed.data.token)
      return result
    }
  )
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
      electronVersion: process.versions.electron ?? '',
      platform: process.platform,
      repositoryUrl: REPOSITORY_URL,
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
  ipcMain.handle('app:install-update', async (event): Promise<void> => {
    assertTrustedSender(event)
    await installUpdate()
  })
  ipcMain.handle('app:open-repository', async (event) => {
    assertTrustedSender(event)
    await openExternalUrl(REPOSITORY_URL)
  })
  ipcMain.handle('app:open-releases', async (event) => {
    assertTrustedSender(event)
    await openExternalUrl(RELEASES_URL)
  })
  ipcMain.handle('app:get-data-location', (event): DataLocationInfo => {
    assertTrustedSender(event)
    return dataLocationInfo()
  })
  ipcMain.handle('app:choose-data-location', async (event): Promise<DataLocationInfo | null> => {
    assertTrustedSender(event)
    return chooseDataLocation()
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
    ensureLoginManagers()
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

function saveSite(input: SiteInput): Site {
  const data = vault.requireData()
  const now = new Date().toISOString()
  const startUrl = normalizeUrl(input.startUrl)
  const startOrigin = new URL(startUrl).origin
  const requestedName = input.name.trim()
  const normalizedName = normalizeSiteName(requestedName)
  const duplicate = data.sites.find(
    (site) =>
      site.id !== input.id && normalizeSiteName(site.name) === normalizedName
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
    const previousName = existing.name
    existing.name = requestedName
    existing.startUrl = startUrl
    existing.allowedOrigins = allowedOrigins
    existing.autoSubmit = input.autoSubmit
    existing.group = input.group?.trim() || undefined
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
    name: requestedName,
    startUrl,
    allowedOrigins,
    autoSubmit: input.autoSubmit,
    group: input.group?.trim() || undefined,
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
}): AccountWithSite {
  const data = vault.requireData()
  const site = data.sites.find((entry) => entry.id === input.siteId)
  if (!site) {
    throw new Error('站点不存在')
  }
  const loginStrategy = input.loginStrategy ?? 'auto'
  const manualSelectors = normalizeManualSelectors(input.manualSelectors)
  assertManualSelectors(loginStrategy, manualSelectors)
  const now = new Date().toISOString()
  data.accounts.push({
    id: randomUUID(),
    siteId: site.id,
    label: site.name,
    username: input.username.trim(),
    password: input.password,
    favorite: input.favorite ?? false,
    loginStrategy,
    manualSelectors,
    createdAt: now,
    updatedAt: now
  })
  vault.save()
  sessionIndex.add(data.accounts[data.accounts.length - 1]!.id)
  return toPublicAccount(data.accounts[data.accounts.length - 1]!, site)
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
      proxy: vault.getSettings().proxy
    })
    const page = await host.createPage({
      onEvent: () => undefined,
      onClosed: () => undefined
    })
    await page.navigate(normalizeUrl(input.url?.trim() || site.startUrl))
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
  if (patch.activeRecipeId !== undefined) {
    if (
      patch.activeRecipeId &&
      !(account.recipes ?? []).some((recipe) => recipe.id === patch.activeRecipeId)
    ) {
      throw new Error('录制流程不存在')
    }
    account.activeRecipeId = patch.activeRecipeId || undefined
  }
  assertManualSelectors(account.loginStrategy, account.manualSelectors)
  account.updatedAt = new Date().toISOString()
  vault.save()
  return toPublicAccount(account, site)
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
    siteId: account.siteId,
    label: account.label,
    username: account.username,
    favorite: account.favorite,
    loginStrategy: account.loginStrategy ?? 'auto',
    manualSelectors: structuredClone(account.manualSelectors),
    recipes: structuredClone(account.recipes ?? []),
    activeRecipeId: account.activeRecipeId,
    lastUsedAt: account.lastUsedAt,
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

function applyDataImport(parsed: ParsedImport, source: 'csv' | 'kdbx'): DataImportResult {
  const data = vault.requireData()
  const merged = mergeImportedLogins(data, source, parsed)
  data.sites = merged.data.sites
  data.accounts = merged.data.accounts
  vault.save()
  sessionIndex.replace(data.accounts.map((account) => account.id))
  return merged.result
}

async function copySecret(value: string): Promise<void> {
  clipboard.writeText(value)
  if (clipboardClearTimer) {
    clearTimeout(clipboardClearTimer)
  }
  clipboardClearTimer = setTimeout(async () => {
    if ((await clipboard.readText()) === value) {
      clipboard.clear()
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

async function chooseDataLocation(): Promise<DataLocationInfo | null> {
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
    return dataLocationInfo()
  }
  if (pathIsInside(dirname(app.getPath('exe')), target)) {
    throw new Error('数据目录不能位于 AutoLogin 安装目录内，以免升级时丢失')
  }

  await closeLoginManagers()
  vault.lock()
  try {
    migrateDataDirectory(configDirectory, dataDirectory, target)
    dataDirectory = target
    initializeDataStores()
    ensureLoginManagers()
    sendToRenderer('vault:locked')
    return dataLocationInfo(true)
  } catch (error) {
    // A failed migration may still have committed the location pointer. Reload
    // from the pointer so the running app never keeps using a removed source.
    dataDirectory = readDataDirectory(configDirectory)
    initializeDataStores()
    ensureLoginManagers()
    sendToRenderer('vault:locked')
    throw error
  }
}

async function openExternalUrl(value: string): Promise<void> {
  if (!isHttpUrl(value)) {
    throw new Error('只能打开 http 或 https 地址')
  }
  await shell.openExternal(value)
}

function initializeAutoUpdater(): void {
  if (updaterInitialized) return
  updaterInitialized = true
  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = true
  autoUpdater.allowDowngrade = false

  autoUpdater.on('download-progress', (progress) => {
    publishUpdateState({
      ...updateState,
      phase: 'downloading',
      message: '正在下载更新…',
      percent: progress.percent,
      bytesPerSecond: progress.bytesPerSecond,
      transferred: progress.transferred,
      total: progress.total
    })
  })
  autoUpdater.on('update-downloaded', (info) => {
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
    if (updateState.phase === 'idle' || updateState.phase === 'up-to-date') return
    publishUpdateState({
      ...updateState,
      phase: 'error',
      message: updateErrorMessage(error)
    })
  })
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

  publishUpdateState({
    phase: 'checking',
    currentVersion,
    interactive,
    message: '正在检查更新…'
  })

  try {
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
    message: '正在下载更新…'
  })
  try {
    await autoUpdater.downloadUpdate()
  } catch (error) {
    const current = getUpdateState()
    publishUpdateState({
      ...current,
      phase: 'error',
      message: updateErrorMessage(error)
    })
    throw error
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
      `https://api.github.com/repos/AptimLvStic/AutoLogin/releases/tags/v${encodeURIComponent(version)}`,
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
