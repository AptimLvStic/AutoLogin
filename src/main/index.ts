import { app, BrowserWindow, clipboard, dialog, ipcMain, Menu, session, shell } from 'electron'
import { rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { IpcMainEvent, IpcMainInvokeEvent } from 'electron'
import {
  accountCreateInputSchema,
  accountUpdateInputSchema,
  appSettingsSchema,
  changePasswordSchema,
  loginStartSchema,
  masterPasswordSchema,
  siteInputSchema
} from '@shared/schemas'
import type {
  AccountWithSite,
  AppSettings,
  LoginMode,
  LoginViewState,
  PasswordReveal,
  Site,
  SiteInput,
  VaultStatus
} from '@shared/types'
import { LoginSessionManager } from './login-session'
import {
  browserProfileDirectory,
  discoverManagedBrowserProfileIds,
  discoverManagedPartitionIds,
  partitionDirectory,
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
let vault: VaultManager
let sessionIndex: SessionIndex
let clipboardClearTimer: NodeJS.Timeout | null = null

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
}

app.whenReady().then(() => {
  Menu.setApplicationMenu(null)
  session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => {
    callback(false)
  })
  vault = new VaultManager(app.getPath('userData'), () => {
    void loginManager?.close()
    sendToRenderer('vault:locked')
  })
  sessionIndex = new SessionIndex(app.getPath('userData'))
  createWindow()

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
  vault?.lock()
  app.quit()
})

app.on('before-quit', () => {
  void loginManager?.close()
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

  window.on('closed', () => {
    void loginManager?.close()
    loginManager = null
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

  loginManager = new LoginSessionManager(
    vault,
    app.getPath('userData'),
    allowDevelopmentOverrides ? process.env.AUTOLOGIN_BROWSER_EXECUTABLE : undefined,
    allowDevelopmentOverrides && process.env.AUTOLOGIN_BROWSER_HEADLESS === '1',
    (state) => sendToRenderer('login:state', state)
  )

  if (allowDevelopmentOverrides && process.env.ELECTRON_RENDERER_URL) {
    void window.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void window.loadFile(join(__dirname, '../renderer/index.html'))
  }

  registerIpc()
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
    return status
  })
  ipcMain.handle('vault:lock', (event) => {
    assertTrustedSender(event)
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
    await loginManager?.clearSession(id)
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
    if (!loginManager) {
      throw new Error('登录窗口尚未准备好')
    }
    return loginManager.start(parsed.data.accountId, parsed.data.mode as LoginMode)
  })
  ipcMain.handle('login:close', async (event) => {
    assertTrustedSender(event)
    await loginManager?.close()
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
    await loginManager?.clearSession(id)
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
    const parsed = appSettingsSchema.safeParse(payload)
    if (!parsed.success) {
      throw new Error(firstIssue(parsed.error))
    }
    return vault.updateSettings(parsed.data as AppSettings)
  })

  ipcMain.handle('app:get-version', (event) => {
    assertTrustedSender(event)
    return app.getVersion()
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
      ...discoverManagedPartitionIds(app.getPath('userData')),
      ...discoverManagedBrowserProfileIds(app.getPath('userData')),
      ...(data?.accounts.map((account) => account.id) ?? [])
    ])
    await loginManager?.close()
    await Promise.allSettled(
      [...accountIds]
        .filter(isManagedAccountId)
        .map((accountId) => clearManagedSession(accountId))
    )
    sessionIndex.clear()
    vault.clearAllFiles()
  })
  ipcMain.handle('app:open-privacy', async (event) => {
    assertTrustedSender(event)
    const result = await dialog.showMessageBox(mainWindow!, {
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

async function clearManagedSession(accountId: string): Promise<void> {
  try {
    rmSync(browserProfileDirectory(app.getPath('userData'), accountId), {
      recursive: true,
      force: true,
      maxRetries: 8,
      retryDelay: 200
    })
    rmSync(partitionDirectory(app.getPath('userData'), accountId), {
      recursive: true,
      force: true,
      maxRetries: 8,
      retryDelay: 200
    })
  } catch {
    // A browser profile can retain a handle briefly after its process exits.
  }
}

function isManagedAccountId(value: string): boolean {
  return /^[a-zA-Z0-9_-]{1,128}$/.test(value)
}

function sendToRenderer(channel: string, payload?: unknown): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, payload)
  }
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
