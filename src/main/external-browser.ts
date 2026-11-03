import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import type { ProxySettings, RecipeStep } from '@shared/types'
import { isHttpUrl } from '@shared/url'
import pageAgentSource from 'virtual:page-agent-source'
import type { DefaultBrowser } from './browser-discovery'
import { CdpClient } from './cdp-client'

const AGENT_WORLD = 'autologin-agent'
const AGENT_BINDING = '__autologinSend'
const DEBUG_PORT_FILE = 'DevToolsActivePort'

export type BrowserAgentCommand =
  | {
      type: 'fill-generic'
      username: string
      password: string
      autoSubmit: boolean
      recording: boolean
    }
  | { type: 'record-start' }
  | { type: 'record-stop' }
  | { type: 'detect-challenge' }
  | { type: 'run-step'; step: RecipeStep; username: string; password: string }

export type BrowserAgentEvent =
  | { type: 'record-action'; step: unknown }
  | { type: 'challenge-detected' }
  | { type: 'activity' }

export type ExternalBrowserEvent =
  | { type: 'navigation'; url: string }
  | { type: 'page'; url: string; title: string; loading: boolean }
  | { type: 'loaded'; url: string; title: string }
  | { type: 'agent'; event: BrowserAgentEvent }

export interface ExternalBrowserSnapshot {
  url: string
  title: string
  loading: boolean
}

export interface ExternalBrowserHostOptions {
  browser: DefaultBrowser
  profileDirectory: string
  headless: boolean
  proxy?: ProxySettings
}

interface ExternalBrowserPageOptions {
  onEvent: (event: ExternalBrowserEvent) => void
  onClosed: () => void
}

interface TargetInfo {
  targetId: string
  type: string
  title: string
  url: string
  attached: boolean
}

interface FrameTreeResult {
  frameTree: {
    frame: {
      id: string
      url: string
    }
  }
}

interface AttachTargetResult {
  sessionId: string
}

interface RuntimeEvaluateResult {
  result?: {
    type?: string
    subtype?: string
    value?: unknown
    description?: string
  }
  exceptionDetails?: {
    text?: string
    exception?: { description?: string }
  }
}

interface PageContextSnapshot {
  url: string
  title: string
  readyState: string
}

interface ContextWaiter {
  resolve: (contextId: number) => void
  reject: (error: Error) => void
  timer: NodeJS.Timeout
}

/**
 * Owns one Chromium process. A host can expose several page controllers, so
 * batch login can put every account in a tab of the same browser window.
 */
export class ExternalBrowserHost {
  private client: CdpClient | null = null
  private readonly pages = new Map<string, ExternalBrowserPage>()
  private readonly targetToPage = new Map<string, ExternalBrowserPage>()
  private createPageChain: Promise<void> = Promise.resolve()
  private initialTargetId = ''
  private closed = false
  private closing = false
  private closeNotified = false

  private constructor(
    private readonly child: ChildProcess,
    private readonly options: ExternalBrowserHostOptions,
    private readonly portFile: string
  ) {
    child.once('exit', () => {
      this.closed = true
      this.notifyPagesClosed('默认浏览器已关闭')
    })
    child.once('error', () => {
      this.closed = true
      this.notifyPagesClosed('默认浏览器启动失败')
    })
  }

  static async launch(options: ExternalBrowserHostOptions): Promise<ExternalBrowserHost> {
    mkdirSync(options.profileDirectory, { recursive: true })
    const portFile = join(options.profileDirectory, DEBUG_PORT_FILE)
    rmSync(portFile, { force: true })

    const args = [
      `--user-data-dir=${options.profileDirectory}`,
      '--remote-debugging-address=127.0.0.1',
      '--remote-debugging-port=0',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-background-mode',
      '--disable-background-timer-throttling',
      '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding',
      ...proxyArguments(options.proxy),
      ...(options.headless ? ['--headless=new', '--disable-gpu'] : []),
      '--new-window',
      'about:blank'
    ]
    const child = spawn(options.browser.executablePath, args, {
      stdio: 'ignore',
      windowsHide: false
    })
    const host = new ExternalBrowserHost(child, options, portFile)
    try {
      await host.connect()
      return host
    } catch (error) {
      await host.close()
      throw error
    }
  }

  async createPage(options: ExternalBrowserPageOptions): Promise<ExternalBrowserPage> {
    let release: () => void = () => undefined
    const previous = this.createPageChain
    this.createPageChain = new Promise<void>((resolve) => {
      release = resolve
    })
    await previous
    try {
      const client = this.requireClient()
      const targetId = await this.acquireTarget()
      const attached = await client.send<AttachTargetResult>(
        'Target.attachToTarget',
        { targetId, flatten: true }
      )
      const page = new ExternalBrowserPage(
        this,
        client,
        targetId,
        attached.sessionId,
        options
      )
      this.pages.set(attached.sessionId, page)
      this.targetToPage.set(targetId, page)
      try {
        await page.initialize()
        return page
      } catch (error) {
        await page.close()
        throw error
      }
    } finally {
      release()
    }
  }

  async close(): Promise<void> {
    if (this.closing) {
      return
    }
    this.closing = true
    const client = this.client
    this.client = null
    for (const page of [...this.pages.values()]) {
      page.handleHostClosed('登录会话已关闭')
    }
    this.pages.clear()
    this.targetToPage.clear()

    if (client) {
      try {
        await client.send('Browser.close', {}, undefined, 1_500)
      } catch {
        // Chrome may close the socket before acknowledging Browser.close.
      }
      client.close()
    }

    if (!(await waitForExit(this.child, 1_200))) {
      await killProcessTree(this.child.pid)
    }
    this.closed = true
    this.notifyCloseOnce()
  }

  async closePage(page: ExternalBrowserPage): Promise<void> {
    this.detachPage(page)
    const client = this.client
    if (!client || this.closed) {
      return
    }
    try {
      await client.send('Target.closeTarget', { targetId: page.targetId }, undefined, 2_000)
    } catch {
      // The tab may already have been closed by the user.
    }
  }

  private detachPage(page: ExternalBrowserPage): void {
    this.pages.delete(page.sessionId)
    if (this.targetToPage.get(page.targetId) === page) {
      this.targetToPage.delete(page.targetId)
    }
  }

  private async connect(): Promise<void> {
    const websocketUrl = await this.waitForDebugPort()
    this.client = await CdpClient.connect(
      websocketUrl,
      (method, params, sessionId) => this.handleCdpEvent(method, params, sessionId),
      () => {
        if (!this.closing) {
          this.closed = true
          this.notifyPagesClosed('默认浏览器调试连接已关闭')
          this.notifyCloseOnce()
        }
      }
    )
    await this.requireClient().send('Target.setDiscoverTargets', { discover: true })
  }

  private async acquireTarget(): Promise<string> {
    const client = this.requireClient()
    if (!this.initialTargetId) {
      const response = await client.send<{ targetInfos?: TargetInfo[] }>('Target.getTargets')
      const availablePages = (response.targetInfos ?? []).filter(
        (target) => target.type === 'page' && !this.targetToPage.has(target.targetId)
      )
      const target =
        availablePages.find((entry) => entry.url === 'about:blank') ?? availablePages[0]
      if (target) {
        this.initialTargetId = target.targetId
        return target.targetId
      }
    }

    const created = await client.send<{ targetId: string }>('Target.createTarget', {
      url: 'about:blank',
      newWindow: false,
      background: true
    })
    return created.targetId
  }

  private handleCdpEvent(
    method: string,
    params: Record<string, unknown>,
    sessionId?: string
  ): void {
    if (sessionId) {
      this.pages.get(sessionId)?.handleCdpEvent(method, params, sessionId)
      return
    }

    if (method === 'Target.targetDestroyed' && typeof params.targetId === 'string') {
      this.targetToPage.get(params.targetId)?.handleTargetClosed()
      return
    }
    if (method === 'Target.detachedFromTarget' && typeof params.sessionId === 'string') {
      this.pages.get(params.sessionId)?.handleTargetClosed()
      return
    }
    if (method === 'Target.targetCrashed' && typeof params.targetId === 'string') {
      this.targetToPage.get(params.targetId)?.handleTargetClosed()
    }
  }

  private notifyPagesClosed(message: string): void {
    for (const page of [...this.pages.values()]) {
      page.handleHostClosed(message)
    }
  }

  private notifyCloseOnce(): void {
    if (this.closeNotified) {
      return
    }
    this.closeNotified = true
  }

  private async waitForDebugPort(): Promise<string> {
    const deadline = Date.now() + 15_000
    while (Date.now() < deadline) {
      if (this.child.exitCode !== null) {
        throw new Error('默认浏览器启动后立即退出')
      }
      if (existsSync(this.portFile)) {
        try {
          const [portLine, pathLine] = readFileSync(this.portFile, 'utf8')
            .trim()
            .split(/\r?\n/)
          const port = Number(portLine)
          if (
            Number.isInteger(port) &&
            port > 0 &&
            port <= 65_535 &&
            pathLine?.startsWith('/devtools/browser/')
          ) {
            return `ws://127.0.0.1:${port}${pathLine}`
          }
        } catch {
          // Chrome may still be writing the file.
        }
      }
      await delay(100)
    }
    throw new Error('启动默认浏览器超时，请确认浏览器已正确安装')
  }

  private requireClient(): CdpClient {
    if (!this.client || this.closed) {
      throw new Error('默认浏览器未连接')
    }
    return this.client
  }
}

export class ExternalBrowserPage {
  private mainFrameId = ''
  private agentContextId: number | null = null
  private contextWaiters: ContextWaiter[] = []
  private navigationEpoch = 0
  private snapshot: ExternalBrowserSnapshot = { url: 'about:blank', title: '', loading: true }
  private closed = false
  private closing = false
  private closeNotified = false

  constructor(
    private readonly host: ExternalBrowserHost,
    private readonly client: CdpClient,
    public readonly targetId: string,
    public readonly sessionId: string,
    private readonly options: ExternalBrowserPageOptions
  ) {}

  async initialize(): Promise<void> {
    await this.client.send('Page.enable', {}, this.sessionId)
    const frameTree = await this.client.send<FrameTreeResult>(
      'Page.getFrameTree',
      {},
      this.sessionId
    )
    this.mainFrameId = frameTree.frameTree.frame.id
    this.snapshot.url = frameTree.frameTree.frame.url || 'about:blank'

    await this.client.send('Runtime.enable', {}, this.sessionId)
    try {
      await this.client.send(
        'Runtime.addBinding',
        { name: AGENT_BINDING, executionContextName: AGENT_WORLD },
        this.sessionId
      )
    } catch {
      await this.client.send('Runtime.addBinding', { name: AGENT_BINDING }, this.sessionId)
    }
    await this.client.send(
      'Page.addScriptToEvaluateOnNewDocument',
      {
        source: pageAgentSource,
        worldName: AGENT_WORLD,
        runImmediately: true
      },
      this.sessionId
    )
    await this.waitForAgentContext(5_000).catch(() => null)
  }

  getSnapshot(): ExternalBrowserSnapshot {
    return { ...this.snapshot }
  }

  async navigate(url: string): Promise<void> {
    if (!isHttpUrl(url)) {
      throw new Error('只能打开 http 或 https 地址')
    }
    await this.requireClient().send(
      'Page.navigate',
      { url },
      this.sessionId,
      15_000
    )
  }

  async runAgentCommand(command: BrowserAgentCommand): Promise<unknown> {
    const expression = `window.__autologinAgent.handleCommand(${JSON.stringify(command)})`
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const contextId = await this.waitForAgentContext()
      try {
        await this.ensureAgentInstalled(contextId)
        const response = await this.requireClient().send<RuntimeEvaluateResult>(
          'Runtime.evaluate',
          {
            expression,
            contextId,
            awaitPromise: true,
            returnByValue: true,
            userGesture: true
          },
          this.sessionId,
          8_000
        )
        if (response.exceptionDetails) {
          throw new Error(
            response.exceptionDetails.exception?.description ||
              response.exceptionDetails.text ||
              '页面脚本执行失败'
          )
        }
        return response.result?.value ?? null
      } catch (error) {
        if (attempt === 0 && !this.closed) {
          this.agentContextId = null
          continue
        }
        throw error
      }
    }
    return null
  }

  async focus(): Promise<void> {
    await this.requireClient().send('Page.bringToFront', {}, this.sessionId)
  }

  async close(): Promise<void> {
    if (this.closing) {
      return
    }
    this.closing = true
    await this.host.closePage(this)
    this.markClosed('登录会话已关闭')
  }

  handleTargetClosed(): void {
    this.markClosed('默认浏览器标签页已关闭')
  }

  handleHostClosed(message: string): void {
    this.markClosed(message)
  }

  handleCdpEvent(
    method: string,
    params: Record<string, unknown>,
    sessionId?: string
  ): void {
    if (sessionId && sessionId !== this.sessionId) {
      return
    }

    if (method === 'Page.frameNavigated') {
      const frame = params.frame as
        | { id?: string; parentId?: string; url?: string }
        | undefined
      if (!frame?.id || frame.parentId) {
        return
      }
      this.navigationEpoch += 1
      this.mainFrameId = frame.id
      this.agentContextId = null
      const url = frame.url ?? ''
      this.snapshot = { ...this.snapshot, url, loading: true }
      this.emit({ type: 'navigation', url })
      return
    }

    if (method === 'Page.navigatedWithinDocument') {
      if (params.frameId !== this.mainFrameId || typeof params.url !== 'string') {
        return
      }
      this.snapshot = { ...this.snapshot, url: params.url, loading: true }
      this.emit({ type: 'navigation', url: params.url })
      return
    }

    if (method === 'Page.loadEventFired') {
      const epoch = this.navigationEpoch
      void this.handleLoad(epoch)
      return
    }

    if (method === 'Runtime.executionContextCreated') {
      const context = params.context as
        | {
            id?: number
            name?: string
            auxData?: { frameId?: string; isDefault?: boolean }
          }
        | undefined
      if (
        typeof context?.id === 'number' &&
        context.name === AGENT_WORLD &&
        context.auxData?.frameId === this.mainFrameId
      ) {
        this.agentContextId = context.id
        this.resolveContextWaiters(context.id)
      }
      return
    }

    if (method === 'Runtime.executionContextDestroyed') {
      if (params.executionContextId === this.agentContextId) {
        this.agentContextId = null
      }
      return
    }

    if (method === 'Runtime.executionContextsCleared') {
      this.agentContextId = null
      return
    }

    if (method === 'Runtime.bindingCalled') {
      if (params.executionContextId !== this.agentContextId || typeof params.payload !== 'string') {
        return
      }
      try {
        const payload = JSON.parse(params.payload) as BrowserAgentEvent
        if (
          payload.type === 'record-action' ||
          payload.type === 'challenge-detected' ||
          payload.type === 'activity'
        ) {
          this.emit({ type: 'agent', event: payload })
        }
      } catch {
        // Ignore malformed page messages.
      }
    }
  }

  private async handleLoad(epoch: number): Promise<void> {
    if (this.closed || epoch !== this.navigationEpoch) {
      return
    }
    try {
      const contextId = await this.waitForAgentContext()
      const snapshot = await this.evaluateSnapshot(contextId)
      if (epoch !== this.navigationEpoch) {
        return
      }
      this.snapshot = {
        url: snapshot.url,
        title: snapshot.title,
        loading: false
      }
      this.emit({ type: 'loaded', url: snapshot.url, title: snapshot.title })
    } catch {
      if (!this.closed) {
        this.snapshot = { ...this.snapshot, loading: false }
        this.emit({
          type: 'page',
          url: this.snapshot.url,
          title: this.snapshot.title,
          loading: false
        })
      }
    }
  }

  private async evaluateSnapshot(contextId: number): Promise<PageContextSnapshot> {
    const response = await this.requireClient().send<RuntimeEvaluateResult>(
      'Runtime.evaluate',
      {
        expression: `({ url: location.href, title: document.title, readyState: document.readyState })`,
        contextId,
        returnByValue: true
      },
      this.sessionId,
      4_000
    )
    if (response.exceptionDetails) {
      throw new Error('无法读取页面状态')
    }
    const value = response.result?.value as Partial<PageContextSnapshot> | undefined
    return {
      url: typeof value?.url === 'string' ? value.url : this.snapshot.url,
      title: typeof value?.title === 'string' ? value.title : '',
      readyState: typeof value?.readyState === 'string' ? value.readyState : 'loading'
    }
  }

  private async ensureAgentInstalled(contextId: number): Promise<void> {
    const response = await this.requireClient().send<RuntimeEvaluateResult>(
      'Runtime.evaluate',
      {
        expression: `typeof window.__autologinAgent?.handleCommand`,
        contextId,
        returnByValue: true
      },
      this.sessionId,
      3_000
    )
    if (response.result?.value === 'function') {
      return
    }
    await this.requireClient().send(
      'Runtime.evaluate',
      { expression: pageAgentSource, contextId, returnByValue: true },
      this.sessionId,
      3_000
    )
  }

  private async waitForAgentContext(timeoutMilliseconds = 6_000): Promise<number> {
    if (this.agentContextId !== null) {
      return this.agentContextId
    }
    if (this.closed) {
      throw new Error('默认浏览器已关闭')
    }
    return new Promise<number>((resolve, reject) => {
      const waiter: ContextWaiter = {
        resolve,
        reject,
        timer: setTimeout(() => {
          this.contextWaiters = this.contextWaiters.filter((entry) => entry !== waiter)
          reject(new Error('等待登录页面就绪超时'))
        }, timeoutMilliseconds)
      }
      waiter.timer.unref()
      this.contextWaiters.push(waiter)
    })
  }

  private resolveContextWaiters(contextId: number): void {
    for (const waiter of this.contextWaiters) {
      clearTimeout(waiter.timer)
      waiter.resolve(contextId)
    }
    this.contextWaiters = []
  }

  private rejectContextWaiters(error: Error): void {
    for (const waiter of this.contextWaiters) {
      clearTimeout(waiter.timer)
      waiter.reject(error)
    }
    this.contextWaiters = []
  }

  private emit(event: ExternalBrowserEvent): void {
    try {
      this.options.onEvent(event)
    } catch {
      // A renderer-side state callback must not break browser control.
    }
  }

  private markClosed(message: string): void {
    if (this.closed) {
      return
    }
    this.closed = true
    this.rejectContextWaiters(new Error(message))
    if (this.closeNotified) {
      return
    }
    this.closeNotified = true
    try {
      this.options.onClosed()
    } catch {
      // Shutdown callbacks are best effort.
    }
  }

  private requireClient(): CdpClient {
    if (this.closed || this.closing) {
      throw new Error('默认浏览器页面已关闭')
    }
    return this.client
  }
}

function proxyArguments(proxy: ProxySettings | undefined): string[] {
  if (!proxy || proxy.mode === 'system' || !proxy.enabled || !proxy.host.trim()) {
    return []
  }
  const bypass = proxy.bypassList
    .split(/[;,]/)
    .map((entry) => entry.trim())
    .filter(Boolean)
    .join(';')
  return [
    `--proxy-server=${proxy.protocol}://${proxy.host.trim()}:${proxy.port}`,
    ...(bypass ? [`--proxy-bypass-list=${bypass}`] : [])
  ]
}

function waitForExit(child: ChildProcess, timeoutMilliseconds: number): Promise<boolean> {
  if (child.exitCode !== null) {
    return Promise.resolve(true)
  }
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), timeoutMilliseconds)
    child.once('exit', () => {
      clearTimeout(timer)
      resolve(true)
    })
  })
}

async function killProcessTree(pid: number | undefined): Promise<void> {
  if (!pid) {
    return
  }
  await new Promise<void>((resolve) => {
    const killer = spawn('taskkill.exe', ['/PID', String(pid), '/T', '/F'], {
      stdio: 'ignore',
      windowsHide: true
    })
    killer.once('exit', () => resolve())
    killer.once('error', () => resolve())
  })
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}
