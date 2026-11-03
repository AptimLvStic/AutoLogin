import { rmSync } from 'node:fs'
import { resolve, sep } from 'node:path'
import { recipeStepSchema } from '@shared/schemas'
import type {
  LoginMode,
  LoginRecipe,
  LoginViewState,
  RecipeDraftResult,
  RecipeStep,
  Site,
  StoredAccount
} from '@shared/types'
import { isHttpUrl, isOriginAllowed, safeOrigin, stripQuery } from '@shared/url'
import {
  assertChromiumBrowser,
  discoverDefaultBrowser,
  type DefaultBrowser
} from './browser-discovery'
import {
  ExternalBrowser,
  type BrowserAgentCommand,
  type ExternalBrowserEvent
} from './external-browser'
import { browserProfileDirectory, partitionDirectory } from './session-index'
import { VaultManager } from './vault'

interface FillResult {
  formFound: boolean
  usernameFilled: boolean
  passwordFilled: boolean
  challengeDetected: boolean
  submitted: boolean
  confidence: 'high' | 'medium' | 'low'
}

interface StepResult {
  stepId: string
  found: boolean
  challengeDetected: boolean
  clicked: boolean
}

interface ChallengeResult {
  detected: boolean
}

const EMPTY_STATE: LoginViewState = {
  active: false,
  status: 'idle',
  message: '',
  currentUrl: '',
  currentOrigin: '',
  pageTitle: '',
  isLoading: false,
  originTrusted: false,
  recording: false,
  recipeExists: false,
  recordingStepCount: 0,
  browserName: ''
}

export class LoginSessionManager {
  private browser: ExternalBrowser | null = null
  private browserInfo: DefaultBrowser | null = null
  private state: LoginViewState = { ...EMPTY_STATE }
  private account: StoredAccount | null = null
  private site: Site | null = null
  private mode: LoginMode = 'login'
  private pageGeneration = 0
  private handledGeneration = -1
  private pageRunTimer: NodeJS.Timeout | null = null
  private stepIndex = 0
  private recipeRunning = false
  private hadSubmission = false
  private challengeSeen = false
  private genericFallbackTried = false
  private recordingSteps: RecipeStep[] = []
  private recordingOrigins = new Set<string>()
  private recordingChallengeDetected = false
  private navigationPending = false
  private destroyed = false
  private submissionTimer: NodeJS.Timeout | null = null
  private sessionToken = 0

  constructor(
    private readonly vault: VaultManager,
    private readonly userDataPath: string,
    private readonly browserExecutableOverride: string | undefined,
    private readonly headlessBrowser: boolean,
    private readonly onState: (state: LoginViewState) => void
  ) {}

  getState(): LoginViewState {
    return { ...this.state }
  }

  async start(accountId: string, mode: LoginMode): Promise<LoginViewState> {
    await this.dispose()
    const token = ++this.sessionToken
    const data = this.vault.requireData()
    const account = data.accounts.find((entry) => entry.id === accountId)
    if (!account) {
      throw new Error('账号不存在')
    }
    const site = data.sites.find((entry) => entry.id === account.siteId)
    if (!site) {
      throw new Error('站点不存在')
    }

    this.destroyed = false
    this.account = account
    this.site = site
    this.mode = mode
    this.stepIndex = 0
    this.hadSubmission = false
    this.challengeSeen = false
    this.genericFallbackTried = false
    this.recordingSteps = []
    this.recordingOrigins = new Set([safeOrigin(site.startUrl)].filter(Boolean))
    this.recordingChallengeDetected = false
    this.pageGeneration = 0
    this.handledGeneration = -1
    this.recipeRunning = false
    this.navigationPending = false

    account.lastUsedAt = new Date().toISOString()
    account.updatedAt = account.lastUsedAt
    this.vault.save()

    this.emit({
      active: true,
      accountId,
      mode,
      status: 'opening',
      message: '正在启动 Windows 默认浏览器',
      currentUrl: stripQuery(site.startUrl),
      currentOrigin: safeOrigin(site.startUrl),
      pageTitle: site.name,
      isLoading: true,
      originTrusted: isOriginTrusted(site, safeOrigin(site.startUrl)),
      recording: mode === 'record',
      recipeExists: Boolean(site.recipe),
      recordingStepCount: 0,
      browserName: ''
    })

    try {
      const browserInfo = discoverDefaultBrowser(this.browserExecutableOverride)
      assertChromiumBrowser(browserInfo)
      if (token !== this.sessionToken) {
        return this.getState()
      }
      this.browserInfo = browserInfo
      this.emit({ browserName: browserInfo.name })

      const browser = await ExternalBrowser.launch({
        browser: browserInfo,
        profileDirectory: browserProfileDirectory(this.userDataPath, account.id),
        headless: this.headlessBrowser,
        onEvent: (event) => this.handleBrowserEvent(browser, event),
        onClosed: () => this.handleBrowserClosed(browser)
      })
      if (token !== this.sessionToken || this.destroyed) {
        await browser.close()
        return this.getState()
      }
      this.browser = browser
      await browser.navigate(site.startUrl)
      return this.getState()
    } catch (error) {
      if (token === this.sessionToken) {
        this.browser = null
        this.emit({
          status: 'error',
          message: error instanceof Error ? error.message : '无法启动默认浏览器',
          isLoading: false
        })
      }
      throw error
    }
  }

  async close(): Promise<void> {
    await this.dispose()
  }

  async retry(): Promise<void> {
    if (!this.account || !this.site) {
      return
    }
    if (!this.browser) {
      await this.start(this.account.id, this.mode)
      return
    }
    this.handledGeneration = -1
    this.stepIndex = 0
    this.genericFallbackTried = false
    await this.runCurrentPage()
  }

  async trustCurrentOrigin(): Promise<void> {
    if (!this.site || !this.browser) {
      return
    }
    const origin = this.state.currentOrigin || safeOrigin(this.browser.getSnapshot().url)
    if (!origin || this.site.allowedOrigins.includes(origin)) {
      return
    }
    const data = this.vault.requireData()
    const site = data.sites.find((entry) => entry.id === this.site?.id)
    if (!site) {
      return
    }
    site.allowedOrigins = [...new Set([...site.allowedOrigins, origin])]
    site.updatedAt = new Date().toISOString()
    this.site = site
    this.vault.save()
    this.handledGeneration = -1
    await this.runCurrentPage()
  }

  async focusBrowser(): Promise<void> {
    if (!this.browser) {
      throw new Error('默认浏览器尚未打开')
    }
    await this.browser.focus()
  }

  async finishRecording(): Promise<RecipeDraftResult> {
    if (!this.account || !this.site || !this.browser || this.mode !== 'record') {
      throw new Error('当前没有正在录制的登录流程')
    }
    if (this.recordingSteps.length === 0) {
      return { siteId: this.site.id, recipe: emptyRecipe(this.site.startUrl), saved: false }
    }

    const now = new Date().toISOString()
    const currentUrl = stripQuery(this.browser.getSnapshot().url)
    const startUrl = stripQuery(this.site.startUrl)
    const reachedDifferentPage = Boolean(currentUrl && currentUrl !== startUrl)
    const recipe: LoginRecipe = {
      version: 1,
      startUrl: this.site.startUrl,
      allowedOrigins: [...this.recordingOrigins].filter(Boolean),
      steps: this.recordingSteps,
      successCheck: reachedDifferentPage ? { urlPrefix: currentUrl } : undefined,
      manualChallenge: this.recordingChallengeDetected,
      createdAt: now,
      updatedAt: now
    }

    const data = this.vault.requireData()
    const site = data.sites.find((entry) => entry.id === this.site?.id)
    if (!site) {
      throw new Error('站点不存在')
    }
    site.recipe = recipe
    site.allowedOrigins = [...new Set([...site.allowedOrigins, ...recipe.allowedOrigins])]
    site.updatedAt = now
    this.site = site
    this.vault.save()
    this.mode = 'login'
    await this.runAgentCommand({ type: 'record-stop' }).catch(() => null)
    this.emit({
      mode: 'login',
      recording: false,
      recipeExists: true,
      status: 'authenticated',
      message: '登录流程已保存，下次可一键回放'
    })
    return { siteId: site.id, recipe, saved: true }
  }

  cancelRecording(): void {
    this.recordingSteps = []
    this.recordingChallengeDetected = false
    this.mode = 'login'
    void this.runAgentCommand({ type: 'record-stop' }).catch(() => null)
    this.emit({
      mode: 'login',
      recording: false,
      recordingStepCount: 0,
      status: 'needs_action',
      message: '已取消录制'
    })
  }

  async clearSession(accountId: string): Promise<void> {
    if (this.account?.id === accountId) {
      await this.dispose()
    }
    clearManagedSessionDirectories(this.userDataPath, accountId)
  }

  private async dispose(): Promise<void> {
    this.sessionToken += 1
    this.destroyed = true
    this.clearPageTimer()
    this.clearSubmissionTimer()
    const browser = this.browser
    this.browser = null
    this.browserInfo = null
    this.account = null
    this.site = null
    this.recipeRunning = false
    this.navigationPending = false
    this.state = { ...EMPTY_STATE }
    this.onState(this.getState())
    if (browser) {
      await browser.close()
    }
  }

  private handleBrowserEvent(browser: ExternalBrowser, event: ExternalBrowserEvent): void {
    if (this.browser !== browser || this.destroyed) {
      return
    }

    if (event.type === 'navigation') {
      this.navigationPending = true
      this.pageGeneration += 1
      this.handledGeneration = -1
      this.clearPageTimer()
      this.clearSubmissionTimer()
      this.recordOrigin(event.url)
      const origin = safeOrigin(event.url)
      const trusted = this.site ? isOriginTrusted(this.site, origin) : false
      this.emit({
        currentUrl: stripQuery(event.url),
        currentOrigin: origin,
        isLoading: true,
        originTrusted: trusted,
        status:
          !isHttpUrl(event.url)
            ? 'needs_action'
            : this.state.status === 'authenticated'
              ? 'opening'
              : this.state.status,
        message: !isHttpUrl(event.url)
          ? '已阻止在不安全页面上自动填充'
          : this.mode === 'record'
            ? '正在录制，请继续完成登录'
            : '页面正在跳转'
      })
      return
    }

    if (event.type === 'loaded' || event.type === 'page') {
      this.navigationPending = false
      this.recordOrigin(event.url)
      this.emit({
        currentUrl: stripQuery(event.url),
        currentOrigin: safeOrigin(event.url),
        pageTitle: event.title || this.state.pageTitle,
        isLoading: event.type === 'page' ? event.loading : false,
        originTrusted: this.site ? isOriginTrusted(this.site, safeOrigin(event.url)) : false
      })
      if (isHttpUrl(event.url)) {
        this.schedulePageRun(350)
      }
      return
    }

    if (event.type === 'agent') {
      if (event.event.type === 'record-action') {
        this.recordAction(event.event.step)
      } else if (event.event.type === 'challenge-detected') {
        this.challengeSeen = true
        this.recordingChallengeDetected = true
        this.emit({
          status: 'awaiting_manual_challenge',
          message: '检测到验证码或二次验证，请在默认浏览器中人工完成'
        })
      } else if (event.event.type === 'activity') {
        this.vault.touch()
      }
    }
  }

  private handleBrowserClosed(browser: ExternalBrowser): void {
    if (this.browser !== browser || this.destroyed) {
      return
    }
    this.browser = null
    this.clearPageTimer()
    this.clearSubmissionTimer()
    this.emit({
      status: 'error',
      message: '默认浏览器已关闭，可点击重新尝试再次打开',
      isLoading: false
    })
  }

  private schedulePageRun(delay = 420): void {
    this.clearPageTimer()
    const generation = this.pageGeneration
    this.pageRunTimer = setTimeout(() => {
      if (
        this.destroyed ||
        !this.browser ||
        generation !== this.pageGeneration ||
        generation === this.handledGeneration
      ) {
        return
      }
      void this.runCurrentPage()
    }, delay)
  }

  private async runCurrentPage(): Promise<void> {
    if (!this.browser || !this.account || !this.site) {
      return
    }
    if (this.recipeRunning) {
      this.schedulePageRun(150)
      return
    }
    const generation = this.pageGeneration
    if (this.handledGeneration === generation) {
      return
    }
    this.handledGeneration = generation
    const snapshot = this.browser.getSnapshot()
    const currentUrl = snapshot.url
    const currentOrigin = safeOrigin(currentUrl)
    const trusted = isOriginTrusted(this.site, currentOrigin)
    this.emit({
      currentUrl: stripQuery(currentUrl),
      currentOrigin,
      originTrusted: trusted,
      pageTitle: snapshot.title || this.site.name,
      recipeExists: Boolean(this.site.recipe),
      isLoading: snapshot.loading
    })

    if (!isHttpUrl(currentUrl)) {
      this.emit({
        status: 'needs_action',
        message: '当前页面不是 http 或 https 地址，已暂停自动填充'
      })
      return
    }

    if (this.mode === 'record') {
      this.emit({
        status: 'needs_action',
        message: trusted
          ? '正在录制：在默认浏览器中完成登录后点击“结束录制”'
          : '当前页面不在信任域名内，请手动完成登录后结束录制',
        recording: true
      })
      await this.runAgentCommand({ type: 'record-start' }).catch(() => null)
      if (trusted) {
        await this.fillGeneric(false, true)
      }
      return
    }

    const successPrefix = this.site.recipe?.successCheck?.urlPrefix
    if (successPrefix && stripQuery(currentUrl).startsWith(successPrefix)) {
      this.emit({ status: 'authenticated', message: '会话仍然有效，已直接打开站点' })
      return
    }

    if (!trusted) {
      this.emit({
        status: 'needs_action',
        message: `页面跳转到了未授权域名 ${currentOrigin || ''}，已暂停自动填充`
      })
      return
    }

    if (this.site.recipe && this.site.recipe.steps.length > 0) {
      const completed = await this.runRecipe()
      if (completed) {
        return
      }
    }

    await this.fillGeneric(this.site.autoSubmit, false)
  }

  private async fillGeneric(autoSubmit: boolean, recording: boolean): Promise<void> {
    if (!this.account || !this.browser) {
      return
    }
    this.emit({
      status: 'filling',
      message: recording ? '正在录制登录流程' : '正在识别账号密码字段'
    })
    try {
      const result = await this.runAgentCommand({
        type: 'fill-generic',
        username: this.account.username,
        password: this.account.password,
        autoSubmit,
        recording
      })
      this.handleFillResult(requireFillResult(result))
    } catch {
      this.emit({
        status: 'needs_action',
        message: '未能完成自动填充，可重试或录制登录流程'
      })
    }
  }

  private async runRecipe(): Promise<boolean> {
    if (!this.site?.recipe || !this.account || !this.browser || this.recipeRunning) {
      return false
    }
    this.recipeRunning = true
    try {
      while (
        this.browser &&
        this.site?.recipe &&
        this.stepIndex < this.site.recipe.steps.length
      ) {
        const step = this.site.recipe.steps[this.stepIndex]
        if (!step) {
          break
        }
        const origin = safeOrigin(this.browser.getSnapshot().url)
        if (!isOriginTrusted(this.site, origin)) {
          this.emit({
            status: 'needs_action',
            message: `回放暂停：当前域名 ${origin || '未知'} 未被信任`
          })
          return true
        }

        this.emit({ status: 'filling', message: `正在执行登录步骤 ${this.stepIndex + 1}` })
        const beforeGeneration = this.pageGeneration
        const beforeUrl = this.browser.getSnapshot().url
        const result = requireStepResult(
          await this.runAgentCommand({
            type: 'run-step',
            step,
            username: this.account.username,
            password: this.account.password
          })
        )
        if (!result.found) {
          break
        }
        if (result.challengeDetected) {
          this.challengeSeen = true
          this.recordingChallengeDetected = true
          this.emit({
            status: 'awaiting_manual_challenge',
            message: '已定位验证码输入框，请在默认浏览器中人工完成验证'
          })
          return true
        }
        this.stepIndex += 1

        if (step.type === 'click' || step.type === 'press') {
          const navigated = await this.waitForNavigationChange(
            beforeUrl,
            beforeGeneration,
            step.type === 'click' && step.navigationExpected === false ? 400 : 2_500
          )
          if (navigated) {
            this.handledGeneration = -1
            this.schedulePageRun(80)
            return true
          }
          try {
            if (await this.sendChallengeCommand()) {
              this.challengeSeen = true
              this.recordingChallengeDetected = true
              this.emit({
                status: 'awaiting_manual_challenge',
                message: '已定位验证码输入框，请在默认浏览器中人工完成验证'
              })
              return true
            }
          } catch {
            // A challenge check is best-effort; the recipe can still continue.
          }
        } else {
          await delay(180)
        }
      }

      if (this.site?.recipe && this.stepIndex >= this.site.recipe.steps.length) {
        await delay(900)
        try {
          if (await this.sendChallengeCommand()) {
            this.challengeSeen = true
            this.recordingChallengeDetected = true
            this.emit({
              status: 'awaiting_manual_challenge',
              message: '已定位验证码输入框，请在默认浏览器中人工完成验证'
            })
            return true
          }
        } catch {
          // Continue to the normal completion check below.
        }
        const currentUrl = this.browser?.getSnapshot().url ?? ''
        if (
          this.site.recipe.successCheck?.urlPrefix &&
          stripQuery(currentUrl).startsWith(this.site.recipe.successCheck.urlPrefix)
        ) {
          this.emit({ status: 'authenticated', message: '登录流程回放完成' })
          return true
        }
        this.emit({
          status: 'needs_action',
          message: '登录步骤已执行，请在默认浏览器中确认是否已登录'
        })
        return true
      }
      return false
    } catch {
      if (!this.genericFallbackTried) {
        this.genericFallbackTried = true
        this.emit({
          status: 'needs_action',
          message: '录制流程未能完整执行，已切换为通用识别'
        })
      }
      return false
    } finally {
      this.recipeRunning = false
    }
  }

  private async waitForNavigationChange(
    beforeUrl: string,
    beforeGeneration: number,
    timeoutMilliseconds: number
  ): Promise<boolean> {
    const deadline = Date.now() + timeoutMilliseconds
    while (Date.now() < deadline) {
      if (this.navigationPending || this.pageGeneration !== beforeGeneration) {
        return true
      }
      const currentUrl = this.browser?.getSnapshot().url ?? ''
      if (currentUrl && currentUrl !== beforeUrl) {
        return true
      }
      await delay(100)
    }
    return false
  }

  private handleFillResult(result: FillResult): void {
    if (result.challengeDetected) {
      this.challengeSeen = true
      this.recordingChallengeDetected = true
      this.emit({
        status: 'awaiting_manual_challenge',
        message: '账号密码已填充，请在默认浏览器中人工完成验证码或二次验证'
      })
      return
    }

    if (result.submitted) {
      this.hadSubmission = true
      this.emit({ status: 'submitting', message: '已提交登录，正在等待页面响应' })
      this.startSubmissionWatch()
      return
    }

    if (result.formFound && (result.usernameFilled || result.passwordFilled)) {
      this.emit({
        status: 'needs_action',
        message:
          this.mode === 'record'
            ? '账号密码已填入，请继续在默认浏览器中完成登录'
            : '账号密码已填充，请确认页面后手动提交'
      })
      return
    }

    if (this.hadSubmission || this.challengeSeen) {
      this.clearSubmissionTimer()
      this.emit({ status: 'authenticated', message: '登录页面已离开，登录流程完成' })
      return
    }

    this.emit({
      status: 'needs_action',
      message: '未识别到登录表单，可能已经登录或页面结构较特殊'
    })
  }

  private recordAction(rawStep: unknown): void {
    if (this.mode !== 'record') {
      return
    }
    const parsed = recipeStepSchema.safeParse(rawStep)
    if (!parsed.success || this.recordingSteps.length >= 30) {
      return
    }
    const step = parsed.data as RecipeStep
    this.recordingSteps.push(step)
    if (step.type === 'focusChallenge') {
      this.recordingChallengeDetected = true
    }
    this.emit({ recordingStepCount: this.recordingSteps.length })
  }

  private async runAgentCommand(command: BrowserAgentCommand): Promise<unknown> {
    if (!this.browser) {
      throw new Error('默认浏览器尚未打开')
    }
    return this.browser.runAgentCommand(command)
  }

  private async sendChallengeCommand(): Promise<boolean> {
    const result = (await this.runAgentCommand({ type: 'detect-challenge' })) as
      | ChallengeResult
      | null
    return Boolean(result?.detected)
  }

  private recordOrigin(url: string): void {
    if (this.mode !== 'record') {
      return
    }
    const origin = safeOrigin(url)
    if (origin) {
      this.recordingOrigins.add(origin)
    }
  }

  private emit(patch: Partial<LoginViewState>): void {
    this.state = { ...this.state, ...patch }
    this.onState(this.getState())
  }

  private clearPageTimer(): void {
    if (this.pageRunTimer) {
      clearTimeout(this.pageRunTimer)
      this.pageRunTimer = null
    }
  }

  private startSubmissionWatch(): void {
    this.clearSubmissionTimer()
    this.submissionTimer = setTimeout(() => {
      if (this.browser && this.state.status === 'submitting') {
        this.emit({
          status: 'needs_action',
          message: '页面尚未跳转，请在默认浏览器中确认是否已登录或处理页面提示'
        })
      }
    }, 8_000)
    this.submissionTimer.unref()
  }

  private clearSubmissionTimer(): void {
    if (this.submissionTimer) {
      clearTimeout(this.submissionTimer)
      this.submissionTimer = null
    }
  }
}

export function isOriginTrusted(site: Site, origin: string): boolean {
  return isOriginAllowed(origin, [
    ...site.allowedOrigins,
    ...(site.recipe?.allowedOrigins ?? [])
  ])
}

function requireFillResult(value: unknown): FillResult {
  if (!value || typeof value !== 'object') {
    throw new Error('页面未返回填充结果')
  }
  return value as FillResult
}

function requireStepResult(value: unknown): StepResult {
  if (!value || typeof value !== 'object') {
    throw new Error('页面未返回步骤结果')
  }
  return value as StepResult
}

function removeManagedDirectory(
  userDataPath: string,
  rootName: 'BrowserProfiles' | 'Partitions',
  directoryName: string
): void {
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(directoryName)) {
    throw new Error('无效的会话目录')
  }
  const root = resolve(userDataPath, rootName)
  const target = resolve(
    rootName === 'BrowserProfiles'
      ? browserProfileDirectory(userDataPath, directoryName)
      : partitionDirectory(userDataPath, directoryName)
  )
  if (!target.startsWith(`${root}${sep}`)) {
    throw new Error('拒绝删除保险库之外的目录')
  }
  rmSync(target, { recursive: true, force: true, maxRetries: 8, retryDelay: 200 })
}

export function clearManagedSessionDirectories(
  userDataPath: string,
  accountId: string
): void {
  removeManagedDirectory(userDataPath, 'BrowserProfiles', accountId)
  try {
    removeManagedDirectory(userDataPath, 'Partitions', `autologin-${accountId}`)
  } catch {
    // Legacy Electron partitions may still be locked by an older process.
  }
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

function emptyRecipe(startUrl: string): LoginRecipe {
  const now = new Date().toISOString()
  return {
    version: 1,
    startUrl,
    allowedOrigins: [safeOrigin(startUrl)].filter(Boolean),
    steps: [],
    createdAt: now,
    updatedAt: now
  }
}
