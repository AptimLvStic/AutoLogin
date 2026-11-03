import { app, BrowserWindow, clipboard, dialog, ipcMain, Menu, net, session, shell } from 'electron'
import { existsSync, mkdirSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { IpcMainEvent, IpcMainInvokeEvent } from 'electron'
import {
  accountCreateInputSchema,
  accountUpdateInputSchema,
  appSettingsPatchSchema,
  changePasswordSchema,
  loginBatchStartSchema,
  loginStartSchema,
  masterPasswordSchema,
  siteInputSchema
} from '@shared/schemas'
import type {
  AccountWithSite,
  AboutInfo,
  AppSettings,
  DataLocationInfo,
  FailureLogEntry,
  LoginMode,
  LoginBatchState,
  LoginViewState,
  PasswordReveal,
  Site,
  SiteInput,
  UpdateCheckResult,
  VaultStatus
} from '@shared/types'
import { migrateDataDirectory, readDataDirectory } from './data-location'
import { failureLogPath, LoginBatchManager, readFailureLogs } from './login-batch'
import { clearManagedSessionDirectories, LoginSessionManager } from './login-session'
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
let sessionIndex: SessionIndex
let clipboardClearTimer: NodeJS.Timeout | null = null
let configDirectory = ''
let dataDirectory = ''

const REPOSITORY_URL = ['https:', '//github.com', '/AptimLvStic/autologin'].join('')
const RELEASES_URL = `${REPOSITORY_URL}/releases`
const RELEASES_API_URL = [
  'https:',
  '//api.github.com',
  '/repos/AptimLvStic/autologin/releases?per_page=10'
].join('')

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
  initializeDataStores()
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
    backgroundColor: '#f4f1ea',
    title: 'AutoLogin',
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
  ipcMain.handle('settings:update', (event, payload: unknown) => {
    assertTrustedSender(event)
    const parsed = appSettingsPatchSchema.safeParse(payload)
    if (!parsed.success) {
      throw new Error(firstIssue(parsed.error))
    }
    const settings = vault.updateSettings(parsed.data)
    applyInterfaceScale(settings.interfaceScale)
    return settings
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
    return checkForUpdates()
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
  ipcMain.handle('app:list-failure-logs', (event): FailureLogEntry[] => {
    assertTrustedSender(event)
    return readFailureLogs(dataDirectory)
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
    existing.name = input.name.trim()
    existing.startUrl = startUrl
    existing.allowedOrigins = allowedOrigins
    existing.autoSubmit = input.autoSubmit
    existing.group = input.group?.trim() || undefined
    existing.updatedAt = now
    vault.save()
    return structuredClone(existing)
  }

  const site: Site = {
    id: randomUUID(),
    name: input.name.trim(),
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
}): AccountWithSite {
  const data = vault.requireData()
  const site = data.sites.find((entry) => entry.id === input.siteId)
  if (!site) {
    throw new Error('站点不存在')
  }
  const now = new Date().toISOString()
  data.accounts.push({
    id: randomUUID(),
    siteId: site.id,
    label: input.label.trim(),
    username: input.username.trim(),
    password: input.password,
    favorite: input.favorite ?? false,
    createdAt: now,
    updatedAt: now
  })
  vault.save()
  sessionIndex.add(data.accounts[data.accounts.length - 1]!.id)
  return toPublicAccount(data.accounts[data.accounts.length - 1]!, site)
}

function updateAccount(
  accountId: string,
  patch: {
    label?: string
    username?: string
    password?: string
    favorite?: boolean
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
    lastUsedAt: account.lastUsedAt,
    createdAt: account.createdAt,
    updatedAt: account.updatedAt,
    site: structuredClone(site)
  }
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

async function checkForUpdates(): Promise<UpdateCheckResult> {
  const currentVersion = app.getVersion()
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 8_000)
  timer.unref()

  try {
    const response = await net.fetch(RELEASES_API_URL, {
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': `AutoLogin/${currentVersion}`
      },
      signal: controller.signal
    })
    if (!response.ok) {
      return {
        status: 'unavailable',
        currentVersion,
        message:
          response.status === 404
            ? '无法访问更新服务，请确认网络连接或仓库访问权限'
            : `更新服务暂时不可用（HTTP ${response.status}）`
      }
    }

    const payload: unknown = await response.json()
    const releases = Array.isArray(payload)
      ? payload.map(toGithubRelease).filter((release): release is GithubRelease => Boolean(release))
      : []
    const latest = releases.reduce<GithubRelease | null>((current, release) => {
      if (!current) return release
      return compareVersions(release.version, current.version) > 0 ? release : current
    }, null)

    if (!latest) {
      return {
        status: 'up-to-date',
        currentVersion,
        message: '当前没有可用的发布版本'
      }
    }

    if (compareVersions(latest.version, currentVersion) > 0) {
      return {
        status: 'available',
        currentVersion,
        latestVersion: latest.version,
        releaseUrl: latest.url || RELEASES_URL,
        message: `发现新版本 v${latest.version}`
      }
    }

    return {
      status: 'up-to-date',
      currentVersion,
      latestVersion: latest.version,
      releaseUrl: latest.url || RELEASES_URL,
      message: '当前已是最新版本'
    }
  } catch {
    return {
      status: 'unavailable',
      currentVersion,
      message: '无法连接更新服务，请检查网络后重试'
    }
  } finally {
    clearTimeout(timer)
  }
}

interface GithubRelease {
  version: string
  url?: string
}

function toGithubRelease(value: unknown): GithubRelease | null {
  if (!value || typeof value !== 'object') {
    return null
  }
  const record = value as Record<string, unknown>
  if (record.draft === true || typeof record.tag_name !== 'string') {
    return null
  }
  const version = record.tag_name.replace(/^v/i, '').trim()
  if (!parseVersion(version)) {
    return null
  }
  return {
    version,
    url: typeof record.html_url === 'string' && isHttpUrl(record.html_url) ? record.html_url : undefined
  }
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

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}
