import { EventEmitter } from 'node:events'
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { basename, dirname, isAbsolute, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { ProxyAgent, fetch as undiciFetch } from 'undici'

declare global {
  namespace NodeJS {
    interface Process {
      resourcesPath: string
    }
  }
}

type IpcSender = {
  id: number
  send: (channel: string, payload?: unknown) => void
}

export interface IpcMainEvent {
  sender: IpcSender
}

export interface IpcMainInvokeEvent extends IpcMainEvent {}

type IpcHandler = (
  event: IpcMainInvokeEvent,
  ...args: unknown[]
) => unknown | Promise<unknown>

type IpcEventListener = (event: IpcMainEvent, ...args: unknown[]) => void

type WindowEventListener = (...args: any[]) => void

interface WireEvent {
  type: 'event'
  channel: string
  payload: unknown
}

interface WireControl {
  type: 'control'
  action: string
  payload?: unknown
}

type WireMessage = WireEvent | WireControl

interface UpdateProgress {
  transferred: number
  total: number
  percent: number
  bytesPerSecond: number
}

interface UpdateInfo {
  version: string
  releaseNotes?: unknown
}

interface ProxyConfiguration {
  mode?: 'system' | 'direct' | 'fixed_servers'
  proxyRules?: string
  proxyBypassRules?: string
}

interface LatestFeedEntry {
  version: string
  fileName: string
  url: string
  size?: number
}

const isPackaged = process.env.AUTOLOGIN_IS_PACKAGED !== '0'
const appVersion = process.env.AUTOLOGIN_APP_VERSION?.trim() || '0.0.0'
const appName = 'AutoLogin'
const resourcesPath =
  process.env.AUTOLOGIN_RESOURCE_DIR?.trim() ||
  resolve(process.cwd(), 'resources')
const appDataDirectory =
  process.env.APPDATA?.trim() || join(homedir(), 'AppData', 'Roaming')
const defaultUserDataDirectory = join(appDataDirectory, appName)
const configuredPaths = new Map<string, string>()
const appListeners = new Map<string, Set<WindowEventListener>>()
const ipcHandlers = new Map<string, IpcHandler>()
const ipcEventListeners = new Map<string, Set<IpcEventListener>>()
const windows: BrowserWindow[] = []

Object.defineProperty(process, 'resourcesPath', {
  value: resourcesPath,
  configurable: true,
  enumerable: true
})

function writeWire(message: WireMessage): void {
  process.stdout.write(`${JSON.stringify(message)}\n`)
}

export function emitBackendEvent(channel: string, payload: unknown): void {
  writeWire({ type: 'event', channel, payload })
}

function emitControl(action: string, payload?: unknown): void {
  writeWire({ type: 'control', action, payload })
}

function trustedEvent(): IpcMainInvokeEvent {
  return {
    sender: {
      id: 1,
      send: (channel, payload) => emitBackendEvent(channel, payload)
    }
  }
}

export async function dispatchBackendRequest(
  channel: string,
  args: unknown[]
): Promise<unknown> {
  const handler = ipcHandlers.get(channel)
  if (handler) {
    return await handler(trustedEvent(), ...args)
  }

  const listeners = ipcEventListeners.get(channel)
  if (listeners?.size) {
    const event = trustedEvent()
    for (const listener of listeners) {
      listener(event, ...args)
    }
    return undefined
  }

  throw new Error(`未知的本地服务命令：${channel}`)
}

export function backendHandlerCount(): number {
  return ipcHandlers.size
}

interface AppShim {
  isPackaged: boolean
  commandLine: {
    appendSwitch: (name: string, value?: string) => void
  }
  setName: (name: string) => void
  setAppUserModelId: (id: string) => void
  requestSingleInstanceLock: () => boolean
  whenReady: () => Promise<void>
  getVersion: () => string
  getAppPath: () => string
  getPath: (name: string) => string
  setPath: (name: string, value: string) => void
  on: (event: string, listener: WindowEventListener) => AppShim
  relaunch: () => void
  quit: () => void
  exit: (code?: number) => void
}

export const app: AppShim = {
  isPackaged,
  commandLine: {
    appendSwitch: (_name: string, _value?: string): void => undefined
  },
  setName: (_name: string): void => undefined,
  setAppUserModelId: (_id: string): void => undefined,
  requestSingleInstanceLock: (): boolean => true,
  whenReady: (): Promise<void> => Promise.resolve(),
  getVersion: (): string => appVersion,
  getAppPath: (): string => process.env.AUTOLOGIN_APP_PATH?.trim() || process.cwd(),
  getPath: (name: string): string => {
    const configured = configuredPaths.get(name)
    if (configured) return configured
    if (name === 'userData') {
      return process.env.AUTOLOGIN_USER_DATA_DIR?.trim() || defaultUserDataDirectory
    }
    if (name === 'appData') return appDataDirectory
    if (name === 'exe') return process.env.AUTOLOGIN_EXE_PATH?.trim() || process.execPath
    if (name === 'temp') return tmpdir()
    if (name === 'home') return homedir()
    if (name === 'logs') return join(defaultUserDataDirectory, 'logs')
    return defaultUserDataDirectory
  },
  setPath: (name: string, value: string): void => {
    configuredPaths.set(name, resolve(value))
  },
  on: (event: string, listener: WindowEventListener): AppShim => {
    const listeners = appListeners.get(event) ?? new Set<WindowEventListener>()
    listeners.add(listener)
    appListeners.set(event, listeners)
    return app
  },
  relaunch: (): void => emitControl('relaunch'),
  quit: (): void => {
    runAppExitListeners()
    emitControl('exit')
  },
  exit: (code = 0): void => {
    runAppExitListeners()
    emitControl('exit', { code })
    setTimeout(() => process.exit(code), 50).unref()
  }
}

function runAppExitListeners(): void {
  for (const eventName of ['before-quit', 'window-all-closed']) {
    for (const listener of appListeners.get(eventName) ?? []) {
      try {
        listener()
      } catch (error) {
        console.error(`App event ${eventName} failed`, error)
      }
    }
  }
}

export class BrowserWindow {
  private static activeWindow: BrowserWindow | null = null
  private readonly listeners = new Map<string, Set<WindowEventListener>>()
  private readonly onceListeners = new Map<string, Set<WindowEventListener>>()
  readonly webContents = {
    id: 1,
    send: (channel: string, payload?: unknown): void => emitBackendEvent(channel, payload),
    on: (event: string, listener: WindowEventListener): void => {
      this.addListener(this.listeners, event, listener)
    },
    setWindowOpenHandler: (_handler: (details: { url: string }) => unknown): void => {
      // Tauri denies unexpected window creation; links are opened explicitly by the app.
    },
    toggleDevTools: (): void => emitControl('toggle-devtools'),
    setZoomFactor: (_factor: number): void => undefined
  }

  constructor(_options: Record<string, unknown>) {
    BrowserWindow.activeWindow = this
    windows.push(this)
  }

  static getAllWindows(): BrowserWindow[] {
    return BrowserWindow.activeWindow ? [BrowserWindow.activeWindow] : []
  }

  on(event: string, listener: WindowEventListener): this {
    this.addListener(this.listeners, event, listener)
    return this
  }

  once(event: string, listener: WindowEventListener): this {
    this.addListener(this.onceListeners, event, listener)
    queueMicrotask(() => this.emit(event))
    return this
  }

  show(): void {
    // The Tauri window is already visible.
  }

  loadFile(_path: string): Promise<void> {
    return Promise.resolve()
  }

  loadURL(_url: string): Promise<void> {
    return Promise.resolve()
  }

  isDestroyed(): boolean {
    return false
  }

  isMinimized(): boolean {
    return false
  }

  restore(): void {
    emitControl('restore-window')
  }

  focus(): void {
    emitControl('focus-window')
  }

  setTitleBarOverlay(payload: unknown): void {
    emitControl('titlebar-overlay', payload)
  }

  private addListener(
    target: Map<string, Set<WindowEventListener>>,
    event: string,
    listener: WindowEventListener
  ): void {
    const listeners = target.get(event) ?? new Set<WindowEventListener>()
    listeners.add(listener)
    target.set(event, listeners)
  }

  private emit(event: string): void {
    for (const listener of this.listeners.get(event) ?? []) {
      listener()
    }
    const onceListeners = this.onceListeners.get(event)
    if (onceListeners) {
      this.onceListeners.delete(event)
      for (const listener of onceListeners) {
        listener()
      }
    }
  }
}

export const ipcMain = {
  handle: (channel: string, handler: IpcHandler): void => {
    if (ipcHandlers.has(channel)) {
      throw new Error(`本地服务命令重复注册：${channel}`)
    }
    ipcHandlers.set(channel, handler)
  },
  removeHandler: (channel: string): void => {
    ipcHandlers.delete(channel)
  },
  on: (channel: string, listener: IpcEventListener): void => {
    const listeners = ipcEventListeners.get(channel) ?? new Set<IpcEventListener>()
    listeners.add(listener)
    ipcEventListeners.set(channel, listeners)
  },
  removeAllListeners: (channel?: string): void => {
    if (channel) {
      ipcEventListeners.delete(channel)
      return
    }
    ipcEventListeners.clear()
  }
}

export const Menu = {
  setApplicationMenu: (_menu: unknown): void => undefined
}

interface DialogOptions {
  title?: string
  buttonLabel?: string
  defaultPath?: string
  properties?: string[]
  filters?: Array<{ name: string; extensions: string[] }>
  message?: string
  detail?: string
  buttons?: string[]
  type?: string
  noLink?: boolean
  defaultId?: number
  cancelId?: number
}

interface DialogResult {
  canceled: boolean
  filePath?: string
  filePaths: string[]
}

interface MessageBoxResult {
  response: number
  checkboxChecked: boolean
}

const DIALOG_SCRIPT = String.raw`
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$requestJson = [Text.Encoding]::UTF8.GetString(
  [Convert]::FromBase64String($env:AUTOLOGIN_DIALOG_REQUEST)
)
$request = $requestJson | ConvertFrom-Json

try {
  if ($request.kind -eq 'message') {
    $message = [string]$request.message
    if ($request.detail) {
      $message = $message + [Environment]::NewLine + [Environment]::NewLine + [string]$request.detail
    }
    $buttons = @($request.buttons)
    $buttonType = if ($buttons.Count -gt 1) {
      [Windows.Forms.MessageBoxButtons]::YesNo
    } else {
      [Windows.Forms.MessageBoxButtons]::OK
    }
    $icon = [Windows.Forms.MessageBoxIcon]::Information
    $result = [Windows.Forms.MessageBox]::Show(
      $message,
      [string]$request.title,
      $buttonType,
      $icon
    )
    $response = if ($buttons.Count -gt 1 -and $result -eq [Windows.Forms.DialogResult]::No) { 1 } else { 0 }
    [Console]::Out.Write((@{ response = $response; checkboxChecked = $false } | ConvertTo-Json -Compress))
    exit 0
  }

  if ($request.kind -eq 'openDirectory') {
    $dialog = New-Object Windows.Forms.FolderBrowserDialog
    $dialog.Description = [string]$request.title
    $dialog.UseDescriptionForTitle = $true
    if ($request.defaultPath -and (Test-Path -LiteralPath $request.defaultPath)) {
      $dialog.SelectedPath = [string]$request.defaultPath
    }
    $result = $dialog.ShowDialog()
    if ($result -eq [Windows.Forms.DialogResult]::OK) {
      $paths = @([string]$dialog.SelectedPath)
      $canceled = $false
    } else {
      $paths = @()
      $canceled = $true
    }
    [Console]::Out.Write((@{ canceled = $canceled; filePaths = $paths } | ConvertTo-Json -Compress))
    exit 0
  }

  $filters = @()
  foreach ($filter in @($request.filters)) {
    $patterns = @($filter.extensions | ForEach-Object { "*.$_" }) -join ';'
    $filters += ([string]$filter.name + '|' + $patterns)
  }
  $filterText = $filters -join '|'

  if ($request.kind -eq 'save') {
    $dialog = New-Object Windows.Forms.SaveFileDialog
    $dialog.Title = [string]$request.title
    $dialog.Filter = $filterText
    $dialog.OverwritePrompt = $true
    $dialog.AddExtension = $true
    if ($request.defaultPath) {
      $dialog.FileName = [string]$request.defaultPath
    }
    $result = $dialog.ShowDialog()
    if ($result -eq [Windows.Forms.DialogResult]::OK) {
      $paths = @([string]$dialog.FileName)
      $canceled = $false
    } else {
      $paths = @()
      $canceled = $true
    }
  } else {
    $dialog = New-Object Windows.Forms.OpenFileDialog
    $dialog.Title = [string]$request.title
    $dialog.Filter = $filterText
    $dialog.Multiselect = (@($request.properties) -contains 'multiSelections')
    $dialog.CheckFileExists = $true
    if ($request.defaultPath) {
      $dialog.FileName = [string]$request.defaultPath
    }
    $result = $dialog.ShowDialog()
    if ($result -eq [Windows.Forms.DialogResult]::OK) {
      $paths = @($dialog.FileNames)
      $canceled = $false
    } else {
      $paths = @()
      $canceled = $true
    }
  }

  [Console]::Out.Write((@{ canceled = $canceled; filePaths = $paths } | ConvertTo-Json -Compress))
} catch {
  [Console]::Out.Write((@{ error = $_.Exception.Message } | ConvertTo-Json -Compress))
}
`

function runDialogRequest(kind: string, options: DialogOptions): unknown {
  const properties = options.properties ?? []
  const request = {
    kind: kind === 'open' && properties.includes('openDirectory') ? 'openDirectory' : kind,
    title: options.title ?? appName,
    buttonLabel: options.buttonLabel,
    defaultPath: options.defaultPath,
    properties,
    filters: options.filters ?? [],
    message: options.message,
    detail: options.detail,
    buttons: options.buttons ?? [],
    type: options.type
  }
  const encoded = Buffer.from(JSON.stringify(request), 'utf8').toString('base64')
  const result = spawnSync(
    'powershell.exe',
    [
      '-NoLogo',
      '-NoProfile',
      '-NonInteractive',
      '-STA',
      '-OutputFormat',
      'Text',
      '-Command',
      DIALOG_SCRIPT
    ],
    {
      env: { ...process.env, AUTOLOGIN_DIALOG_REQUEST: encoded },
      encoding: 'utf8',
      windowsHide: true
    }
  )
  if (result.status !== 0) {
    throw new Error(result.stderr.trim() || '无法打开系统对话框')
  }
  const output = result.stdout.trim()
  if (!output) {
    throw new Error('系统对话框没有返回结果')
  }
  const parsed = JSON.parse(output) as Record<string, unknown>
  if (typeof parsed.error === 'string') {
    throw new Error(parsed.error)
  }
  return parsed
}

function normalizeDialogArgs(
  first: BrowserWindow | DialogOptions,
  second?: DialogOptions
): DialogOptions {
  return (second ?? first) as DialogOptions
}

export const dialog = {
  showOpenDialog: async (
    first: BrowserWindow | DialogOptions,
    second?: DialogOptions
  ): Promise<DialogResult> => {
    const result = runDialogRequest('open', normalizeDialogArgs(first, second)) as DialogResult
    return {
      canceled: Boolean(result.canceled),
      ...(result.filePath ? { filePath: result.filePath } : {}),
      filePaths: Array.isArray(result.filePaths) ? result.filePaths : []
    }
  },
  showSaveDialog: async (
    first: BrowserWindow | DialogOptions,
    second?: DialogOptions
  ): Promise<DialogResult> => {
    const result = runDialogRequest('save', normalizeDialogArgs(first, second)) as DialogResult
    return {
      canceled: Boolean(result.canceled),
      ...(result.filePath ? { filePath: result.filePath } : {}),
      filePaths: Array.isArray(result.filePaths) ? result.filePaths : []
    }
  },
  showMessageBox: async (
    first: BrowserWindow | DialogOptions,
    second?: DialogOptions
  ): Promise<MessageBoxResult> => {
    const result = runDialogRequest(
      'message',
      normalizeDialogArgs(first, second)
    ) as MessageBoxResult
    return {
      response: Number(result.response) || 0,
      checkboxChecked: false
    }
  }
}

function runClipboardPowerShell(script: string, value?: string): string {
  const env = { ...process.env }
  if (value !== undefined) {
    env.AUTOLOGIN_CLIPBOARD_VALUE = Buffer.from(value, 'utf8').toString('base64')
  }
  const result = spawnSync(
    'powershell.exe',
    ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script],
    {
      env,
      encoding: 'utf8',
      windowsHide: true
    }
  )
  if (result.status !== 0) {
    throw new Error(result.stderr.trim() || '剪贴板操作失败')
  }
  return result.stdout
}

export const clipboard = {
  writeText: (value: string): void => {
    runClipboardPowerShell(
      '$text=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($env:AUTOLOGIN_CLIPBOARD_VALUE)); Set-Clipboard -Value $text',
      value
    )
  },
  readText: (): string =>
    runClipboardPowerShell(
      '$text=Get-Clipboard -Raw; if ($null -ne $text) { [Console]::Out.Write($text) }'
    ),
  clear: (): void => {
    runClipboardPowerShell('Set-Clipboard -Value $null')
  }
}

function quotePowerShellLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`
}

function runPowerShellDetached(script: string): void {
  const child = spawn(
    'powershell.exe',
    ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script],
    {
      detached: true,
      stdio: 'ignore',
      windowsHide: true
    }
  )
  child.unref()
}

export const shell = {
  openExternal: async (value: string): Promise<void> => {
    const url = new URL(value)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      throw new Error('只能打开 http 或 https 地址')
    }
    runPowerShellDetached(`Start-Process -FilePath ${quotePowerShellLiteral(value)}`)
  },
  openPath: async (path: string): Promise<string> => {
    if (!existsSync(path)) return '文件不存在'
    runPowerShellDetached(`Start-Process -LiteralPath ${quotePowerShellLiteral(path)}`)
    return ''
  },
  showItemInFolder: (path: string): void => {
    if (!existsSync(path)) return
    const child = spawn('explorer.exe', [`/select,${path}`], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true
    })
    child.unref()
  }
}

function readWindowsSystemProxy(): string | null {
  const result = spawnSync(
    'reg.exe',
    [
      'query',
      'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings',
      '/v',
      'ProxyEnable'
    ],
    { encoding: 'utf8', windowsHide: true }
  )
  const enabled = /ProxyEnable\s+REG_DWORD\s+0x1/i.test(result.stdout)
  if (!enabled) return null
  const serverResult = spawnSync(
    'reg.exe',
    [
      'query',
      'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings',
      '/v',
      'ProxyServer'
    ],
    { encoding: 'utf8', windowsHide: true }
  )
  const match = /ProxyServer\s+REG_SZ\s+(.+)/i.exec(serverResult.stdout)
  const server = match?.[1]?.trim()
  if (!server) return null
  const byProtocol = server
    .split(';')
    .map((entry) => entry.split('='))
    .find(([protocol]) => protocol?.toLowerCase() === 'https' || protocol?.toLowerCase() === 'http')
  const hostPort = byProtocol?.[1] ?? server
  return /^[a-z]+:\/\//i.test(hostPort) ? hostPort : `http://${hostPort}`
}

class ShimSession {
  private proxy: ProxyConfiguration = { mode: 'system' }

  setProxy(configuration: ProxyConfiguration): Promise<void> {
    this.proxy = configuration
    return Promise.resolve()
  }

  closeAllConnections(): Promise<void> {
    return Promise.resolve()
  }

  setPermissionRequestHandler(
    _handler: (
      contents: unknown,
      permission: string,
      callback: (allowed: boolean) => void
    ) => void
  ): void {
    // Tauri WebView permissions are controlled by Tauri capabilities.
  }

  async fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    const proxyUrl =
      this.proxy.mode === 'fixed_servers'
        ? this.proxy.proxyRules
        : this.proxy.mode === 'system'
          ? readWindowsSystemProxy()
          : null
    const dispatcher = proxyUrl ? new ProxyAgent(proxyUrl) : undefined
    return (await undiciFetch(input as Parameters<typeof undiciFetch>[0], {
      ...(init as Parameters<typeof undiciFetch>[1]),
      ...(dispatcher ? { dispatcher } : {})
    })) as unknown as Response
  }
}

const defaultSession = new ShimSession()

export const session = {
  defaultSession,
  fromPartition: (_partition: string): ShimSession => new ShimSession()
}

export const net = {
  fetch: async (input: string | URL | Request, init?: RequestInit): Promise<Response> =>
    (await undiciFetch(
      input as Parameters<typeof undiciFetch>[0],
      init as Parameters<typeof undiciFetch>[1]
    )) as unknown as Response
}

type UpdateFeed =
  | { provider: 'github'; owner: string; repo: string }
  | { provider: 'generic'; url: string }

function parseLatestYml(contents: string): LatestFeedEntry {
  const version = /^version:\s*['"]?([^'"\s]+)['"]?\s*$/m.exec(contents)?.[1]
  const fileName =
    /^\s*-\s*url:\s*['"]?([^'"\s]+)['"]?\s*$/m.exec(contents)?.[1] ??
    /^path:\s*['"]?([^'"\s]+)['"]?\s*$/m.exec(contents)?.[1]
  const sizeText = /^\s*size:\s*(\d+)\s*$/m.exec(contents)?.[1]
  if (!version || !fileName) {
    throw new Error('更新清单缺少版本或安装包信息')
  }
  return {
    version,
    fileName,
    url: fileName,
    ...(sizeText ? { size: Number(sizeText) } : {})
  }
}

function feedLatestUrl(feed: UpdateFeed): string {
  if (feed.provider === 'generic') {
    return new URL('latest.yml', feed.url.endsWith('/') ? feed.url : `${feed.url}/`).toString()
  }
  return `https://github.com/${feed.owner}/${feed.repo}/releases/latest/download/latest.yml`
}

function feedDownloadUrl(feed: UpdateFeed, entry: LatestFeedEntry): string {
  if (feed.provider === 'generic') {
    return new URL(entry.fileName, feed.url.endsWith('/') ? feed.url : `${feed.url}/`).toString()
  }
  return `https://github.com/${feed.owner}/${feed.repo}/releases/download/v${entry.version}/${entry.fileName}`
}

class ShimAutoUpdater extends EventEmitter {
  autoDownload = false
  autoInstallOnAppQuit = true
  allowDowngrade = false
  logger: {
    info: (message: string) => void
    warn: (message: string) => void
    error: (message: string) => void
  } | null = null

  private feed: UpdateFeed = {
    provider: 'github',
    owner: process.env.AUTOLOGIN_UPDATE_OWNER?.trim() || 'AptimLvStic',
    repo: process.env.AUTOLOGIN_UPDATE_REPO?.trim() || 'Tauri'
  }
  private latest: LatestFeedEntry | null = null
  private installerPath = ''

  setFeedURL(next: UpdateFeed): void {
    this.feed = next
    this.latest = null
  }

  async checkForUpdates(): Promise<{ updateInfo: UpdateInfo } | null> {
    const response = await net.fetch(feedLatestUrl(this.feed), {
      headers: {
        'Cache-Control': 'no-cache',
        'User-Agent': `${appName}/${appVersion}`
      }
    })
    if (!response.ok) {
      throw new Error(`更新源返回 HTTP ${response.status}`)
    }
    this.latest = parseLatestYml(await response.text())
    return {
      updateInfo: {
        version: this.latest.version
      }
    }
  }

  async downloadUpdate(token?: { cancelled?: boolean }): Promise<void> {
    if (!this.latest) {
      throw new Error('尚未获取更新清单')
    }
    const response = await net.fetch(feedDownloadUrl(this.feed, this.latest), {
      headers: { 'User-Agent': `${appName}/${appVersion}` }
    })
    if (!response.ok || !response.body) {
      throw new Error(`下载安装包失败：HTTP ${response.status}`)
    }

    const total = Number(response.headers.get('content-length') ?? this.latest.size ?? 0)
    const destination = join(
      tmpdir(),
      `${appName}-${this.latest.version}-${Date.now()}.exe`
    )
    const chunks: Uint8Array[] = []
    let transferred = 0
    let lastPublishedAt = 0
    const startedAt = Date.now()

    for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
      if (token?.cancelled) {
        rmSync(destination, { force: true })
        throw new Error('更新下载已取消')
      }
      chunks.push(chunk)
      transferred += chunk.byteLength
      const now = Date.now()
      if (now - lastPublishedAt >= 150) {
        lastPublishedAt = now
        const seconds = Math.max((now - startedAt) / 1000, 0.001)
        this.emit('download-progress', {
          transferred,
          total,
          percent: total > 0 ? Math.min(100, (transferred / total) * 100) : 0,
          bytesPerSecond: transferred / seconds
        } satisfies UpdateProgress)
      }
    }

    if (token?.cancelled) {
      throw new Error('更新下载已取消')
    }
    writeFileSync(destination, Buffer.concat(chunks))
    this.installerPath = destination
    this.emit('download-progress', {
      transferred,
      total: total || transferred,
      percent: 100,
      bytesPerSecond: transferred / Math.max((Date.now() - startedAt) / 1000, 0.001)
    } satisfies UpdateProgress)
    this.emit('update-downloaded', {
      version: this.latest.version
    } satisfies UpdateInfo)
  }

  quitAndInstall(_isSilent?: boolean, _isForceRunAfter?: boolean): void {
    if (!this.installerPath || !existsSync(this.installerPath)) {
      throw new Error('更新安装包不存在')
    }
    emitControl('install-update', { path: this.installerPath })
  }

  on(event: 'download-progress', listener: (progress: UpdateProgress) => void): this
  on(event: 'update-downloaded', listener: (info: UpdateInfo) => void): this
  on(event: 'error', listener: (error: Error) => void): this
  on(event: string, listener: (...args: any[]) => void): this {
    return super.on(event, listener)
  }
}

export const autoUpdater = new ShimAutoUpdater()

void pathToFileURL
void basename
void dirname
void isAbsolute
void mkdirSync
void readFileSync
void statSync
