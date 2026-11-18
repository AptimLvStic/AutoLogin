import {
  appendFileSync,
  copyFileSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { mkdir, rm, readdir, readFile } from 'node:fs/promises'
import { join, resolve, sep } from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { recipeStepSchema } from '@shared/schemas'
import type {
  AccountRecipe,
  LoginMode,
  LoginRecipe,
  LoginViewState,
  RecipeDraftResult,
  RecipeStep,
  RecordingSaveStatus,
  RecordingStepSummary,
  Site,
  StoredAccount
} from '@shared/types'
import type { EmbeddedBrowserBounds } from '@shared/types'
import { isHttpUrl, isOriginAllowed, safeOrigin, stripQuery } from '@shared/url'
import {
  assertChromiumBrowser,
  discoverDefaultBrowser,
  type DefaultBrowser
} from './browser-discovery'
import {
  ExternalBrowserHost,
  type ExternalBrowserPage,
  type BrowserAgentCommand,
  type ExternalBrowserEvent
} from './external-browser'
import { appendAppLog } from './app-log'
import { markStage } from './block-watchdog'
import type { EmbeddedBrowserProvider } from './embedded-browser'
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
  manualRequired?: boolean
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
  recordingSteps: [],
  recordingPaused: false,
  browserName: ''
}

const PENDING_RECIPE_DIRECTORY = 'pending-recipes'
const RECORDING_CAPTURE_TIMEOUT_MS = 2_000
const RECORDING_STATE_TIMEOUT_MS = 800
const RECORDING_STOP_TIMEOUT_MS = 500
const RECORDING_CLEANUP_TIMEOUT_MS = 3_500
const RECORDING_FINISH_CACHE_MS = 5 * 60_000

export function resolveRecordingDraftDirectory(
  userDataPath: string,
  configuredDirectory = ''
): string {
  const configured = configuredDirectory.trim()
  return configured
    ? resolve(configured)
    : join(userDataPath, PENDING_RECIPE_DIRECTORY)
}

export class LoginSessionManager {
  private host: ExternalBrowserHost | null = null
  private browser: ExternalBrowserPage | null = null
  private browserInfo: DefaultBrowser | null = null
  private state: LoginViewState = { ...EMPTY_STATE }
  private account: StoredAccount | null = null
  private site: Site | null = null
  private mode: LoginMode = 'login'
  private pageGeneration = 0
  private handledGeneration = -1
  private pageRunTimer: NodeJS.Timeout | null = null
  private certificateCheckTimer: NodeJS.Timeout | null = null
  private stepIndex = 0
  private manualStepIndex = 0
  private recipeRunning = false
  private hadSubmission = false
  private challengeSeen = false
  private genericFallbackTried = false
  private autoFillRetries = 0
  private recordingSteps: RecipeStep[] = []
  private recordingOrigins = new Set<string>()
  private recordingChallengeDetected = false
  private recordedStepKeys = new Set<string>()
  private recordingStartedAtMs = 0
  private recordingPausedAtMs = 0
  private recordingElapsedMs = 0
  private recordingCertificatePending = false
  private rejectedRecordEvents = 0
  private navigationPending = false
  private destroyed = false
  private submissionTimer: NodeJS.Timeout | null = null
  private sessionToken = 0
  private embeddedLabel: string | null = null
  private finishInFlight: {
    key: string
    promise: Promise<RecipeDraftResult>
  } | null = null
  private lastFinish: {
    key: string
    result: RecipeDraftResult
    startedAt: number
    finishedAt: number
  } | null = null
  private lastFinishError: {
    key: string
    error: string
    startedAt: number
    finishedAt: number
    stage?: string
  } | null = null
  private finishStartedAt = 0
  private finishStage = ''
  /** 录制会话 id：每一步实时 append 到 recording-drafts/<id>.jsonl */
  private draftSessionId: string | null = null
  private draftSessionPath: string | null = null
  private draftPersistedStepCount = 0

  constructor(
    private readonly vault: VaultManager,
    private readonly userDataPath: string,
    private readonly browserExecutableOverride: string | undefined,
    private readonly headlessBrowser: boolean,
    private readonly onState: (state: LoginViewState) => void,
    private readonly sharedHost: ExternalBrowserHost | null = null,
    private readonly embeddedProvider: EmbeddedBrowserProvider | null = null
  ) {}

  getState(): LoginViewState {
    return { ...this.state }
  }

  getRecordingSaveStatus(): RecordingSaveStatus {
    if (this.finishInFlight) {
      return {
        state: 'saving',
        startedAt: this.finishStartedAt,
        stage: this.finishStage || '准备保存'
      }
    }

    if (this.lastFinish) {
      if (Date.now() - this.lastFinish.finishedAt <= RECORDING_FINISH_CACHE_MS) {
        return {
          state: this.lastFinish.result.saved ? 'saved' : 'draft_saved',
          startedAt: this.lastFinish.startedAt,
          finishedAt: this.lastFinish.finishedAt,
          stage: this.lastFinish.result.saved ? '写入完成' : '草稿已落盘',
          result: this.lastFinish.result
        }
      }
      this.lastFinish = null
    }

    if (
      this.lastFinishError &&
      Date.now() - this.lastFinishError.finishedAt <= RECORDING_FINISH_CACHE_MS
    ) {
      return {
        state: 'failed',
        startedAt: this.lastFinishError.startedAt,
        finishedAt: this.lastFinishError.finishedAt,
        error: this.lastFinishError.error,
        stage: this.lastFinishError.stage
      }
    }

    return { state: 'idle' }
  }

  getEmbeddedLabel(): string | null {
    return this.embeddedLabel
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
    if (!site.startUrl.trim()) {
      throw new Error('账号缺少登录地址，请先补全')
    }
    if (!account.password) {
      throw new Error('账号缺少密码，请先补全')
    }
    if (site.recipe && (account.recipes?.length ?? 0) === 0) {
      const legacyRecipe = {
        id: randomUUID(),
        name: '旧版录制流程',
        recipe: structuredClone(site.recipe)
      }
      account.recipes = [legacyRecipe]
      account.activeRecipeId = legacyRecipe.id
      account.updatedAt = new Date().toISOString()
    }

    this.destroyed = false
    this.account = account
    this.site = site
    this.mode = mode
    if (mode === 'record') {
      this.lastFinish = null
      this.lastFinishError = null
      this.finishStartedAt = 0
    }
    this.stepIndex = 0
    this.manualStepIndex = 0
    this.hadSubmission = false
    this.challengeSeen = false
    this.genericFallbackTried = false
    this.autoFillRetries = 0
    this.recordingSteps = []
    this.recordingOrigins = new Set([safeOrigin(site.startUrl)].filter(Boolean))
    this.recordingChallengeDetected = false
    this.recordedStepKeys = new Set()
    this.recordingStartedAtMs = mode === 'record' ? Date.now() : 0
    this.recordingPausedAtMs = 0
    this.recordingElapsedMs = 0
    this.recordingCertificatePending = false
    this.rejectedRecordEvents = 0
    this.pageGeneration = 0
    this.handledGeneration = -1
    this.recipeRunning = false
    this.navigationPending = false
    this.embeddedLabel = null

    account.lastUsedAt = new Date().toISOString()
    account.updatedAt = account.lastUsedAt
    this.vault.save({ tabIds: [account.tabId] })
    if (mode === 'record') {
      this.openDraftSession(accountId, site.id, site.startUrl)
      appendAppLog(this.userDataPath, {
        level: 'info',
        category: 'login',
        message: '已开始录制登录流程',
        details: `账号：${account.label}`
      })
    }

    this.emit({
      active: true,
      accountId,
      accountLabel: account.label,
      siteName: site.name,
      mode,
      status: 'opening',
      message:
        account.loginBrowser === 'builtin'
          ? '正在打开内置浏览器'
          : '正在启动系统默认浏览器',
      currentUrl: stripQuery(site.startUrl),
      currentOrigin: safeOrigin(site.startUrl),
      pageTitle: site.name,
      isLoading: true,
      originTrusted: isOriginTrusted(site, safeOrigin(site.startUrl), this.currentRecipe()),
      recording: mode === 'record',
      recipeExists: Boolean(this.currentRecipe()),
      recordingStepCount: 0,
      recordingSteps: [],
      recordingPaused: false,
      recordingStartedAt:
        mode === 'record' ? new Date(this.recordingStartedAtMs).toISOString() : undefined,
      recordingPausedAt: undefined,
      browserName: ''
    })

    try {
      let host: ExternalBrowserHost
      if (account.loginBrowser === 'builtin') {
        if (!this.embeddedProvider) {
          throw new Error('内置浏览器尚未准备好')
        }
        const profileDirectory = join(
          browserProfileDirectory(this.userDataPath, account.id),
          'embedded'
        )
        const embedded = await this.embeddedProvider.open({
          accountId: account.id,
          initialUrl: site.startUrl,
          profileDirectory,
          siteId: site.id,
          siteName: site.name,
          accountLabel: account.label,
          groupName: site.group?.trim() || '未分组'
        })
        this.embeddedLabel = embedded.label
        host = await ExternalBrowserHost.attach({
          debugPort: embedded.debugPort,
          profileDirectory
        })
        this.emit({ browserName: '内置浏览器' })
      } else {
        const browserInfo = discoverDefaultBrowser(this.browserExecutableOverride)
        assertChromiumBrowser(browserInfo)
        if (token !== this.sessionToken) {
          return this.getState()
        }
        this.browserInfo = browserInfo
        this.emit({ browserName: browserInfo.name })
        host =
          this.sharedHost ??
          (await ExternalBrowserHost.launch({
            browser: browserInfo,
            profileDirectory: browserProfileDirectory(this.userDataPath, account.id),
            headless: this.headlessBrowser,
            proxy: this.vault.getSettings().proxy,
            initialUrl: site.startUrl,
            pureMode: this.vault.getSettings().pureBrowserMode
          }))
      }
      this.host = host
      if (token !== this.sessionToken || this.destroyed) {
        if (!this.sharedHost) {
          await host.close()
        }
        return this.getState()
      }

      let page: ExternalBrowserPage | null = null
      page = await host.createPage({
        initialUrl: site.startUrl,
        onEvent: (event) => {
          if (page) {
            this.handleBrowserEvent(page, event)
          }
        },
        onClosed: () => {
          if (page) {
            this.handleBrowserClosed(page)
          }
        }
      })
      if (token !== this.sessionToken || this.destroyed) {
        await page.close()
        if (!this.sharedHost) {
          await host.close()
        }
        if (this.embeddedLabel) {
          this.embeddedProvider?.close(this.embeddedLabel)
          this.embeddedLabel = null
        }
        return this.getState()
      }
      this.browser = page
      if (mode === 'record') {
        await this.focusBrowser().catch(() => undefined)
      }
      const snapshot = page.getSnapshot()
      if (isHttpUrl(snapshot.url)) {
        this.handleBrowserEvent(page, {
          type: 'loaded',
          url: snapshot.url,
          title: snapshot.title || site.name
        })
      } else {
        this.schedulePageRun(600)
      }
      return this.getState()
    } catch (error) {
      if (token === this.sessionToken) {
        const page = this.browser
        const host = this.host
        this.browser = null
        this.host = null
        await page?.close().catch(() => undefined)
        if (!this.sharedHost) {
          await host?.close().catch(() => undefined)
        }
        if (this.embeddedLabel) {
          this.embeddedProvider?.close(this.embeddedLabel)
          this.embeddedLabel = null
        }
        this.emit({
          status: 'error',
          message: error instanceof Error ? error.message : '无法启动浏览器',
          isLoading: false
        })
      }
      throw error
    }
  }

  async close(): Promise<void> {
    await this.dispose()
  }

  async detach(): Promise<void> {
    await this.dispose(false)
  }

  setEmbeddedActive(): void {
    if (!this.embeddedLabel || !this.embeddedProvider) return
    this.embeddedProvider.show(this.embeddedLabel)
    this.embeddedProvider.focus(this.embeddedLabel)
  }

  forgetEmbeddedLabel(label: string): void {
    if (this.embeddedLabel === label) {
      this.embeddedLabel = null
    }
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
    this.autoFillRetries = 0
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
    this.vault.save({ tabIds: [site.tabId] })
    this.handledGeneration = -1
    await this.runCurrentPage()
  }

  async focusBrowser(): Promise<void> {
    if (!this.browser) {
      throw new Error('浏览器尚未打开')
    }
    if (this.embeddedLabel && this.embeddedProvider) {
      this.embeddedProvider.show(this.embeddedLabel)
      this.embeddedProvider.focus(this.embeddedLabel)
      return
    }
    await this.browser.focus()
  }

  setEmbeddedBounds(bounds: EmbeddedBrowserBounds): void {
    if (this.embeddedLabel && this.embeddedProvider) {
      this.embeddedProvider.setBounds(this.embeddedLabel, bounds)
    }
  }

  async setAutomationActive(active: boolean): Promise<void> {
    await this.browser?.setAutomationActive(active)
  }

  async finishRecording(requestedName?: string): Promise<RecipeDraftResult> {
    const key = requestedName?.trim() ?? ''
    if (this.finishInFlight?.key === key) {
      return this.finishInFlight.promise
    }
    if (
      this.lastFinish?.key === key &&
      Date.now() - this.lastFinish.finishedAt <= RECORDING_FINISH_CACHE_MS
    ) {
      return this.lastFinish.result
    }
    if (!this.account || !this.site || this.mode !== 'record') {
      throw new Error('当前没有正在录制的登录流程')
    }

    const startedAt = Date.now()
    this.finishStartedAt = startedAt
    this.lastFinishError = null
    this.finishStage = '准备保存'
    markStage('准备保存')
    const promise = this.doFinishRecording(requestedName)
      .then((result) => {
        if (result.saved || result.draftSaved) {
          this.lastFinish = {
            key,
            result,
            startedAt,
            finishedAt: Date.now()
          }
        }
        return result
      })
      .catch((error: unknown) => {
        this.lastFinishError = {
          key,
          error: error instanceof Error ? error.message : String(error),
          startedAt,
          finishedAt: Date.now(),
          stage: this.finishStage
        }
        throw error
      })
      .finally(() => {
        if (this.finishInFlight?.key === key) {
          this.finishInFlight = null
        }
      })
    this.finishInFlight = { key, promise }
    return promise
  }

  private async doFinishRecording(
    requestedName?: string
  ): Promise<RecipeDraftResult> {
    const recordedAccount = this.account
    const recordedSite = this.site
    if (!recordedAccount || !recordedSite) {
      throw new Error('当前没有正在录制的登录流程')
    }
    markStage('finish-recording 入口')

    // 先用内存里已有的步骤落一份草稿副本。
    // capture-login-form 只是补全，不是必需；这样即使后续步骤卡死，录制结果也不会丢。
    const pendingRecipeId = randomUUID()
    if (this.recordingSteps.length > 0) {
      this.writePendingRecipe(recordedAccount.id, recordedSite.id, {
        id: pendingRecipeId,
        name: requestedName?.trim() || `录制流程 ${(recordedAccount.recipes?.length ?? 0) + 1}`,
        recipe: this.buildRecipeFromSteps(recordedSite.startUrl, this.recordingSteps)
      })
    }

    this.finishStage = '整理录制步骤'

    markStage('整理录制步骤')
    this.emit({ message: '正在整理录制步骤…' })
    if (this.browser) {
      try {
        this.finishStage = '捕获页面表单'
        markStage('捕获页面表单')
        const captured = await withTimeout(
          this.runAgentCommand({ type: 'capture-login-form' }),
          RECORDING_CAPTURE_TIMEOUT_MS,
          []
        )
        if (Array.isArray(captured)) {
          for (const step of captured) {
            this.recordAction(step)
          }
        }
      } catch {
        // The page may have closed after steps were already captured.
      }
    }

    if (this.recordingSteps.length === 0) {
      this.closeDraftSession()
      appendAppLog(this.userDataPath, {
        level: 'warning',
        category: 'login',
        message: '录制流程未捕获到可回放步骤',
        details: `被拒绝事件：${this.rejectedRecordEvents}；当前域名：${
          safeOrigin(this.browser?.getSnapshot().url ?? this.state.currentUrl) ||
          '未知'
        }`
      })
      return {
        accountId: recordedAccount.id,
        siteId: recordedSite.id,
        recipe: emptyRecipe(recordedSite.startUrl),
        saved: false
      }
    }

    const now = new Date().toISOString()
    const currentUrl = stripQuery(
      this.browser?.getSnapshot().url ?? this.state.currentUrl
    )
    const startUrl = stripQuery(recordedSite.startUrl)
    const reachedDifferentPage = Boolean(currentUrl && currentUrl !== startUrl)
    const recipe: LoginRecipe = {
      version: 1,
      startUrl: recordedSite.startUrl,
      allowedOrigins: [...this.recordingOrigins].filter(Boolean),
      steps: this.recordingSteps,
      successCheck: reachedDifferentPage ? { urlPrefix: currentUrl } : undefined,
      manualChallenge: this.recordingChallengeDetected,
      createdAt: now,
      updatedAt: now
    }

    this.finishStage = '读取保险库数据'

    markStage('读取保险库数据')
    const data = this.vault.requireData()
    const site = data.sites.find((entry) => entry.id === this.site?.id)
    const account = data.accounts.find((entry) => entry.id === this.account?.id)
    if (!site || !account) {
      throw new Error('站点不存在')
    }
    const recipes = account.recipes ?? []
    if (recipes.length >= 3) {
      throw new Error('每个账号最多保存三个录制流程，请先删除旧流程')
    }
    const trimmedName = requestedName?.trim()
    let recipeName = trimmedName ?? ''
    if (!recipeName) {
      let sequence = recipes.length + 1
      while (recipes.some((entry) => entry.name === `录制流程 ${sequence}`)) {
        sequence += 1
      }
      recipeName = `录制流程 ${sequence}`
    }
    if (recipes.some((entry) => entry.name === recipeName)) {
      throw new Error('录制流程名称已存在，请换一个名称')
    }
    const accountRecipe = {
      id: pendingRecipeId,
      name: recipeName,
      recipe
    }
    const previousRecipes = account.recipes
    const previousActiveRecipeId = account.activeRecipeId
    const previousAccountUpdatedAt = account.updatedAt
    const previousAllowedOrigins = [...site.allowedOrigins]
    const previousSiteUpdatedAt = site.updatedAt
    account.recipes = [...recipes, accountRecipe]
    account.activeRecipeId = accountRecipe.id
    account.updatedAt = now
    site.allowedOrigins = [...new Set([...site.allowedOrigins, ...recipe.allowedOrigins])]
    site.updatedAt = now
    // 先落盘一份独立副本：即使随后的保险库写入卡住或失败，
    // 下次启动也能自动合并，录制结果不会丢。
    this.finishStage = '写入保险库（同步快照与备份）'
    markStage('写入保险库（同步快照与备份）')
    const pendingRecipeSaved = this.writePendingRecipe(account.id, site.id, accountRecipe)
    this.emit({ message: '正在写入录制流程…' })
    const saveStartedAt = Date.now()
    appendAppLog(this.userDataPath, {
      level: 'info',
      category: 'login',
      message: '开始写入登录流程录制',
      details: `账号：${account.label}；步骤：${recipe.steps.length}；数据库：${account.tabId}`
    })
    try {
      await this.vault.saveAsync({ tabIds: [account.tabId] })
      this.finishStage = '写入完成'
      markStage('写入完成')
      this.clearPendingRecipe(accountRecipe.id)
      this.closeDraftSession()
    } catch (error) {
      account.recipes = previousRecipes
      account.activeRecipeId = previousActiveRecipeId
      account.updatedAt = previousAccountUpdatedAt
      site.allowedOrigins = previousAllowedOrigins
      site.updatedAt = previousSiteUpdatedAt
      const message = error instanceof Error ? error.message : String(error)
      const draftSafe =
        pendingRecipeSaved ||
        Boolean(
          this.draftSessionPath &&
            this.draftPersistedStepCount >= this.recordingSteps.length
        )
      if (draftSafe) {
        this.finishStage = '草稿已落盘'
        markStage('草稿已落盘')
        appendAppLog(this.userDataPath, {
          level: 'warning',
          category: 'login',
          message: '登录流程保险库写入失败，已保留录制草稿',
          details: `账号：${account.label}；阶段：写入录制流程；原因：${message}`
        })
        if (pendingRecipeSaved) {
          // 最终 .json 副本已经完整落盘，删除实时 .jsonl，避免下次启动恢复两份。
          this.closeDraftSession()
        } else {
          // 只有 .jsonl 完整时保留它；顺手清掉可能存在的早期半成品 .json。
          this.clearPendingRecipe(pendingRecipeId)
          this.detachDraftSession()
        }
        this.resetRecordingAfterDraftSave()
        void this.finishRecordingCleanup()
        return {
          accountId: recordedAccount.id,
          siteId: recordedSite.id,
          recipe,
          saved: false,
          draftSaved: true
        }
      }
      appendAppLog(this.userDataPath, {
        level: 'error',
        category: 'login',
        message: '登录流程录制保存失败',
        details: `账号：${account.label}；阶段：写入录制流程；原因：${message}`
      })
      this.emit({
        status: 'needs_action',
        message: '保存录制流程失败，请查看失败原因后重试'
      })
      throw new Error(`写入录制流程失败：${message}`)
    }
    this.site = site
    this.account = account
    appendAppLog(this.userDataPath, {
      level: 'success',
      category: 'login',
      message: '登录流程录制已保存',
      details: `账号：${account.label}；步骤：${recipe.steps.length}；耗时：${Date.now() - saveStartedAt}ms`
    })
    this.mode = 'login'
    this.recordingSteps = []
    this.recordingChallengeDetected = false
    this.recordedStepKeys = new Set()
    this.recordingCertificatePending = false
    this.recordingStartedAtMs = 0
    this.recordingPausedAtMs = 0
    this.recordingElapsedMs = 0
    this.emit({
      mode: 'login',
      recording: false,
      recordingPaused: false,
      recordingStepCount: 0,
      recordingSteps: [],
      recordingStartedAt: undefined,
      recordingPausedAt: undefined,
      status: 'authenticated',
      message: '录制流程已保存'
    })
    void this.finishRecordingCleanup()
    return {
      accountId: account.id,
      siteId: site.id,
      recipeId: accountRecipe.id,
      recipe,
      saved: true
    }
  }

  cancelRecording(): void {
    this.closeDraftSession()
    this.recordingSteps = []
    this.recordingChallengeDetected = false
    this.recordedStepKeys = new Set()
    this.recordingCertificatePending = false
    this.recordingStartedAtMs = 0
    this.recordingPausedAtMs = 0
    this.recordingElapsedMs = 0
    this.mode = 'login'
    void this.runAgentCommand({ type: 'record-stop' }).catch(() => null)
    this.emit({
      mode: 'login',
      recording: false,
      recordingPaused: false,
      recordingStepCount: 0,
      recordingSteps: [],
      recordingStartedAt: undefined,
      recordingPausedAt: undefined,
      status: 'needs_action',
      message: '已取消录制'
    })
  }

  async undoRecordingStep(): Promise<LoginViewState> {
    if (this.mode !== 'record') {
      throw new Error('当前没有正在录制的登录流程')
    }
    if (this.recordingSteps.length > 0) {
      this.recordingSteps.pop()
      this.appendDraftUndo()
    }
    this.recordedStepKeys.clear()
    this.emitRecordingState('已撤销上一步')
    void withTimeout(
      this.runAgentCommand({ type: 'record-clear-dedupe' }).catch(() => null),
      RECORDING_STATE_TIMEOUT_MS,
      undefined
    )
    return this.getState()
  }

  async pauseRecording(): Promise<LoginViewState> {
    if (this.mode !== 'record') {
      throw new Error('当前没有正在录制的登录流程')
    }
    if (!this.state.recordingPaused) {
      this.recordingPausedAtMs = Date.now()
      this.emit({
        recordingPaused: true,
        recordingPausedAt: new Date(this.recordingPausedAtMs).toISOString(),
        status: 'needs_action',
        message: '录制已暂停'
      })
      void withTimeout(
        this.runAgentCommand({ type: 'record-pause' }).catch(() => null),
        RECORDING_STATE_TIMEOUT_MS,
        undefined
      )
    }
    return this.getState()
  }

  async resumeRecording(): Promise<LoginViewState> {
    if (this.mode !== 'record') {
      throw new Error('当前没有正在录制的登录流程')
    }
    if (this.state.recordingPaused) {
      const now = Date.now()
      if (this.recordingPausedAtMs > this.recordingStartedAtMs) {
        this.recordingElapsedMs += this.recordingPausedAtMs - this.recordingStartedAtMs
      }
      this.recordingStartedAtMs = now - this.recordingElapsedMs
      this.recordingPausedAtMs = 0
      this.emit({
        recordingPaused: false,
        recordingPausedAt: undefined,
        recordingStartedAt: new Date(this.recordingStartedAtMs).toISOString(),
        status: 'needs_action',
        message: '录制已继续'
      })
      void withTimeout(
        this.runAgentCommand({ type: 'record-resume' }).catch(() => null),
        RECORDING_STATE_TIMEOUT_MS,
        undefined
      )
    }
    return this.getState()
  }

  async rememberClipboardSource(
    accountId: string,
    source: 'username' | 'password',
    value: string
  ): Promise<void> {
    if (
      this.mode !== 'record' ||
      this.state.recordingPaused ||
      this.account?.id !== accountId
    ) {
      return
    }
    const digest = createHash('sha256').update(value).digest('hex')
    await this.runAgentCommand({
      type: 'record-copy-source',
      source,
      digest,
      expiresAt: Date.now() + 120_000
    }).catch(() => null)
  }

  async clearSession(accountId: string): Promise<void> {
    if (this.account?.id === accountId) {
      await this.dispose(true, true)
    }
  }

  private buildRecipeFromSteps(startUrl: string, steps: RecipeStep[]): LoginRecipe {
    const now = new Date().toISOString()
    const currentUrl = stripQuery(
      this.browser?.getSnapshot().url ?? this.state.currentUrl
    )
    const start = stripQuery(startUrl)
    return {
      version: 1,
      startUrl,
      allowedOrigins: [...this.recordingOrigins].filter(Boolean),
      steps,
      successCheck:
        currentUrl && currentUrl !== start ? { urlPrefix: currentUrl } : undefined,
      manualChallenge: this.recordingChallengeDetected,
      createdAt: now,
      updatedAt: now
    }
  }

  /**
   * 录制会话开始：创建一个 append-only 的 jsonl 草稿文件。
   * 之后每一步都实时追加，**不依赖「结束并保存」按钮**。
   * 即使保存请求卡死、软件被强杀，步骤也已经落在盘上。
   */
  private openDraftSession(accountId: string, siteId: string, startUrl: string): void {
    try {
      const directory = resolveRecordingDraftDirectory(
        this.userDataPath,
        this.vault.getSettings().recordingDraftDirectory
      )
      mkdirSync(directory, { recursive: true })
      this.draftSessionId = randomUUID()
      this.draftSessionPath = join(directory, `${this.draftSessionId}.jsonl`)
      this.draftPersistedStepCount = 0
      const header = {
        kind: 'header',
        accountId,
        siteId,
        startUrl,
        startedAt: new Date().toISOString()
      }
      writeFileSync(
        this.draftSessionPath,
        `${JSON.stringify(header)}\n`,
        { encoding: 'utf8', mode: 0o600 }
      )
    } catch (error) {
      this.draftSessionId = null
      this.draftSessionPath = null
      this.draftPersistedStepCount = 0
      appendAppLog(this.userDataPath, {
        level: 'warning',
        category: 'login',
        message: '录制草稿文件创建失败',
        details: error instanceof Error ? error.message : String(error)
      })
    }
  }

  private appendDraftStep(step: RecipeStep): void {
    if (!this.draftSessionPath) {
      return
    }
    try {
      appendFileSync(
        this.draftSessionPath,
        `${JSON.stringify({
          kind: 'step',
          step,
          url: this.browser?.getSnapshot().url ?? this.state.currentUrl
        })}\n`,
        { encoding: 'utf8' }
      )
      this.draftPersistedStepCount += 1
    } catch {
      // 单步写入失败不影响录制继续，内存里的步骤仍然完整。
    }
  }

  private appendDraftUndo(): void {
    if (!this.draftSessionPath) {
      return
    }
    try {
      appendFileSync(
        this.draftSessionPath,
        `${JSON.stringify({ kind: 'undo' })}\n`,
        { encoding: 'utf8' }
      )
      this.draftPersistedStepCount = Math.max(0, this.draftPersistedStepCount - 1)
    } catch {
      // 单步写入失败不影响录制继续，内存里的步骤仍然完整。
    }
  }

  private closeDraftSession(): void {
    if (!this.draftSessionPath) {
      return
    }
    try {
      rmSync(this.draftSessionPath, { force: true })
    } catch {
      // 删不掉就留着，下次启动合并时按 id 去重。
    }
    this.detachDraftSession()
  }

  private detachDraftSession(): void {
    this.draftSessionId = null
    this.draftSessionPath = null
    this.draftPersistedStepCount = 0
  }

  private resetRecordingAfterDraftSave(): void {
    this.mode = 'login'
    this.recordingSteps = []
    this.recordingChallengeDetected = false
    this.recordedStepKeys = new Set()
    this.recordingCertificatePending = false
    this.recordingStartedAtMs = 0
    this.recordingPausedAtMs = 0
    this.recordingElapsedMs = 0
    this.emit({
      mode: 'login',
      recording: false,
      recordingPaused: false,
      recordingStepCount: 0,
      recordingSteps: [],
      recordingStartedAt: undefined,
      recordingPausedAt: undefined,
      status: 'needs_action',
      message: '保险库暂时未写入，录制草稿已保存；重启后会自动恢复'
    })
  }

  private writePendingRecipe(
    accountId: string,
    siteId: string,
    accountRecipe: AccountRecipe
  ): boolean {
    try {
      const directory = resolveRecordingDraftDirectory(
        this.userDataPath,
        this.vault.getSettings().recordingDraftDirectory
      )
      mkdirSync(directory, { recursive: true })
      const payload = {
        accountId,
        siteId,
        recipeId: accountRecipe.id,
        name: accountRecipe.name,
        recipe: accountRecipe.recipe,
        createdAt: new Date().toISOString()
      }
      writeFileSync(join(directory, `${accountRecipe.id}.json`), JSON.stringify(payload), {
        encoding: 'utf8',
        mode: 0o600
      })
      return true
    } catch (error) {
      appendAppLog(this.userDataPath, {
        level: 'warning',
        category: 'login',
        message: '录制流程待合并副本写入失败',
        details: error instanceof Error ? error.message : String(error)
      })
      return false
    }
  }

  private clearPendingRecipe(recipeId: string): void {
    try {
      const directory = resolveRecordingDraftDirectory(
        this.userDataPath,
        this.vault.getSettings().recordingDraftDirectory
      )
      rmSync(join(directory, `${recipeId}.json`), { force: true })
    } catch {
      // 清理失败不影响保存结果，下次启动合并时会按 id 去重并删除。
    }
  }

  private async finishRecordingCleanup(): Promise<void> {
    await withTimeout(
      this.runAgentCommand({ type: 'record-stop' }).catch(() => null),
      RECORDING_STOP_TIMEOUT_MS,
      undefined
    )
    await withTimeout(
      this.dispose().catch(() => undefined),
      RECORDING_CLEANUP_TIMEOUT_MS,
      undefined
    )
  }

  private async dispose(closePage = true, closeEmbedded = false): Promise<void> {
    this.sessionToken += 1
    this.destroyed = true
    this.clearPageTimer()
    this.clearCertificateTimer()
    this.clearSubmissionTimer()
    const browser = this.browser
    const host = this.host
    const embeddedProvider = this.embeddedProvider
    const embeddedLabel = this.embeddedLabel
    this.browser = null
    this.host = null
    this.browserInfo = null
    this.embeddedLabel = null
    this.account = null
    this.site = null
    this.recipeRunning = false
    this.navigationPending = false
    this.state = { ...EMPTY_STATE }
    this.onState(this.getState())
    const preserveEmbeddedPage = Boolean(embeddedLabel && !closeEmbedded)
    if (browser && closePage && !preserveEmbeddedPage) {
      await browser.close().catch(() => undefined)
    }
    if (!this.sharedHost && host) {
      await host.close().catch(() => undefined)
    }
    if (embeddedLabel && embeddedProvider) {
      if (closeEmbedded) {
        embeddedProvider.close(embeddedLabel)
      } else {
        embeddedProvider.hide(embeddedLabel)
      }
    }
  }

  private handleBrowserEvent(browser: ExternalBrowserPage, event: ExternalBrowserEvent): void {
    if (this.browser !== browser || this.destroyed) {
      return
    }

    if (event.type === 'navigation') {
      this.navigationPending = true
      this.pageGeneration += 1
      this.handledGeneration = -1
      this.autoFillRetries = 0
      this.clearPageTimer()
      this.clearSubmissionTimer()
      if (
        this.mode === 'record' &&
        this.recordingCertificatePending &&
        isHttpUrl(event.url)
      ) {
        this.recordCertificateWarningStep()
      }
      this.recordOrigin(event.url)
      if (this.embeddedLabel && this.embeddedProvider) {
        this.embeddedProvider.update(this.embeddedLabel, {
          url: event.url,
          pageUrl: event.url,
          pageTitle: '',
          isLoading: true
        })
      }
      const origin = safeOrigin(event.url)
      const trusted = this.site
        ? isOriginTrusted(this.site, origin, this.currentRecipe())
        : false
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
            ? '当前页面无法安全加载，已暂停自动填充'
          : this.mode === 'record'
            ? '正在录制，请继续完成登录'
            : '页面正在跳转'
      })
      if (!isHttpUrl(event.url)) {
        this.scheduleCertificateWarningCheck()
      }
      return
    }

    if (event.type === 'loaded' || event.type === 'page') {
      this.navigationPending = false
      if (
        this.mode === 'record' &&
        this.recordingCertificatePending &&
        isHttpUrl(event.url)
      ) {
        this.recordCertificateWarningStep()
      }
      this.recordOrigin(event.url)
      if (this.embeddedLabel && this.embeddedProvider) {
        this.embeddedProvider.update(this.embeddedLabel, {
          url: event.url,
          pageUrl: event.url,
          pageTitle: event.title,
          title: event.title || this.site?.name || this.state.pageTitle,
          isLoading: event.type === 'page' ? event.loading : false
        })
      }
      this.emit({
        currentUrl: stripQuery(event.url),
        currentOrigin: safeOrigin(event.url),
        pageTitle: event.title || this.state.pageTitle,
        isLoading: event.type === 'page' ? event.loading : false,
        originTrusted: this.site
          ? isOriginTrusted(this.site, safeOrigin(event.url), this.currentRecipe())
          : false
      })
      if (isHttpUrl(event.url)) {
        this.schedulePageRun(350)
      } else {
        this.scheduleCertificateWarningCheck()
      }
      return
    }

    if (event.type === 'agent') {
      if (event.event.type === 'record-action') {
        this.recordAction(event.event.step, event.event.frameId)
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

  private handleBrowserClosed(browser: ExternalBrowserPage): void {
    if (this.browser !== browser || this.destroyed) {
      return
    }
    this.browser = null
    if (!this.sharedHost) {
      this.host = null
    }
    this.clearPageTimer()
    this.clearSubmissionTimer()
    this.emit({
      status: this.mode === 'record' ? 'needs_action' : 'error',
      message:
        this.mode === 'record'
          ? '浏览器页面已关闭；已捕获的步骤仍可点击“结束录制”保存'
          : '浏览器页面已关闭，可点击重新尝试再次打开',
      recording: this.mode === 'record',
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
    const recipe = this.currentRecipe()
    const trusted = isOriginTrusted(this.site, currentOrigin, recipe)
    this.emit({
      currentUrl: stripQuery(currentUrl),
      currentOrigin,
      originTrusted: trusted,
      pageTitle: snapshot.title || this.site.name,
      recipeExists: Boolean(recipe),
      isLoading: snapshot.loading
    })

    if (await this.inspectCertificateWarning(this.mode !== 'record')) {
      return
    }

    if (!isHttpUrl(currentUrl)) {
      this.emit({
        status: 'needs_action',
        message: '当前页面不是 http 或 https 地址，已暂停自动填充'
      })
      return
    }

    if (this.mode === 'record') {
      if (this.state.recordingPaused) {
        this.emit({
          status: 'needs_action',
          message: '录制已暂停'
        })
        return
      }
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

    const successPrefix = recipe?.successCheck?.urlPrefix
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

    if (this.account.loginStrategy === 'manual') {
      await this.fillManual()
      return
    }

    if (recipe && recipe.steps.length > 0) {
      const completed = await this.runRecipe()
      if (completed) {
        return
      }
    }

    const fillResult = await this.fillGeneric(this.site.autoSubmit, false)
    if (fillResult && !fillResult.formFound && this.autoFillRetries < 2) {
      this.autoFillRetries += 1
      this.handledGeneration = -1
      this.schedulePageRun(900)
    }
  }

  private async fillGeneric(
    autoSubmit: boolean,
    recording: boolean
  ): Promise<FillResult | null> {
    if (!this.account || !this.browser) {
      return null
    }
    this.emit({
      status: 'filling',
      message: recording ? '正在录制登录流程' : '正在识别账号密码字段'
    })
    const beforeUrl = this.browser.getSnapshot().url
    const beforeGeneration = this.pageGeneration
    try {
      const commandPromise = this.runAgentCommand({
        type: 'fill-generic',
        username: this.loginUsername(),
        password: this.account.password,
        autoSubmit,
        recording
      })
      const outcome = await Promise.race([
        commandPromise.then((result) => ({ kind: 'result' as const, result })),
        this.waitForNavigationChange(beforeUrl, beforeGeneration, 8_000).then(
          (navigated) => ({ kind: 'navigation' as const, navigated })
        )
      ])
      if (outcome.kind === 'navigation' && outcome.navigated) {
        void commandPromise.catch(() => undefined)
        if (autoSubmit) {
          this.hadSubmission = true
          this.emit({ status: 'submitting', message: '已提交登录，正在等待页面响应' })
          this.startSubmissionWatch()
        }
        return null
      }
      const result = requireFillResult(
        outcome.kind === 'result' ? outcome.result : null
      )
      this.handleFillResult(result)
      return result
    } catch {
      this.emit({
        status: 'needs_action',
        message: '未能完成自动填充，可重试或录制登录流程'
      })
      return null
    }
  }

  private loginUsername(): string {
    return this.account?.needsUsername ? '' : this.account?.username ?? ''
  }

  private async fillManual(): Promise<void> {
    if (!this.account || !this.browser) {
      return
    }
    const manualSteps = this.account.manualSteps
    if (manualSteps?.length) {
      if (this.manualStepIndex >= manualSteps.length && this.hadSubmission) {
        this.clearSubmissionTimer()
        this.emit({
          status: 'authenticated',
          message: '登录页面已离开，手动登录流程完成'
        })
        return
      }
      await this.runManualSteps(manualSteps)
      return
    }
    const selectors = this.account.manualSelectors
    if (!selectors?.username || !selectors.password) {
      this.emit({
        status: 'needs_action',
        message: '手动配置缺少用户名或密码定位器，请先编辑账号'
      })
      return
    }

    this.emit({
      status: 'filling',
      message: '正在使用手动配置定位登录字段'
    })
    const beforeUrl = this.browser.getSnapshot().url
    const beforeGeneration = this.pageGeneration
    try {
      const commandPromise = this.runAgentCommand({
        type: 'fill-manual',
        username: this.loginUsername(),
        password: this.account.password,
        autoSubmit: this.site?.autoSubmit ?? false,
        selectors
      })
      const outcome = await Promise.race([
        commandPromise.then((result) => ({ kind: 'result' as const, result })),
        this.waitForNavigationChange(beforeUrl, beforeGeneration, 8_000).then(
          (navigated) => ({ kind: 'navigation' as const, navigated })
        )
      ])
      if (outcome.kind === 'navigation' && outcome.navigated) {
        void commandPromise.catch(() => undefined)
        if (this.site?.autoSubmit) {
          this.hadSubmission = true
          this.emit({ status: 'submitting', message: '已提交登录，正在等待页面响应' })
          this.startSubmissionWatch()
        }
        return
      }
      this.handleFillResult(
        requireFillResult(outcome.kind === 'result' ? outcome.result : null)
      )
    } catch {
      this.emit({
        status: 'needs_action',
        message: '手动配置未能定位完整表单，请编辑账号并测试定位器'
      })
    }
  }

  private async runManualSteps(steps: RecipeStep[]): Promise<void> {
    if (!this.account || !this.site || !this.browser) {
      return
    }
    this.emit({
      status: 'filling',
      message: '正在执行手动登录步骤'
    })

    for (let index = this.manualStepIndex; index < steps.length; index += 1) {
      if (!this.browser) return
      const step = steps[index]
      if (!step) break
      const origin = safeOrigin(this.browser.getSnapshot().url)
      if (!isOriginTrusted(this.site, origin, null)) {
        this.emit({
          status: 'needs_action',
          message: `手动步骤已暂停：当前域名 ${origin || '未知'} 未被信任`
        })
        return
      }

      this.emit({
        status: 'filling',
        message: `正在执行手动步骤 ${index + 1}/${steps.length}`
      })
      const beforeUrl = this.browser.getSnapshot().url
      const beforeGeneration = this.pageGeneration
      const result = requireStepResult(
        await this.runAgentCommand({
          type: 'run-step',
          step,
          username: this.loginUsername(),
          password: this.account.password
        })
      )
      if (!result.found) {
        this.emit({
          status: 'needs_action',
          message: `手动步骤 ${index + 1} 未找到目标元素，请编辑账号并测试定位器`
        })
        return
      }
      if (result.manualRequired) {
        this.emit({
          status: 'needs_action',
          message: `手动步骤 ${index + 1} 需要人工完成`
        })
        return
      }
      if (result.challengeDetected) {
        this.challengeSeen = true
        this.recordingChallengeDetected = true
        this.emit({
          status: 'awaiting_manual_challenge',
          message: '已定位验证码输入框，请在默认浏览器中人工完成验证'
        })
        return
      }

      this.manualStepIndex = index + 1
      if (step.type === 'click' || step.type === 'press') {
        const navigated = await this.waitForNavigationChange(
          beforeUrl,
          beforeGeneration,
          step.type === 'click' && step.navigationExpected === false ? 400 : 2_500
        )
        if (navigated) {
          this.hadSubmission = true
          if (this.manualStepIndex < steps.length) {
            this.emit({
              status: 'filling',
              message: `页面已跳转，将继续执行手动步骤 ${this.manualStepIndex + 1}/${steps.length}`
            })
          } else {
            this.emit({ status: 'submitting', message: '已提交登录，正在等待页面响应' })
            this.startSubmissionWatch()
          }
          return
        }
      } else {
        await delay(160)
      }
    }

    await delay(350)
    try {
      if (await this.sendChallengeCommand()) {
        this.challengeSeen = true
        this.recordingChallengeDetected = true
        this.emit({
          status: 'awaiting_manual_challenge',
          message: '已定位验证码输入框，请在默认浏览器中人工完成验证'
        })
        return
      }
    } catch {
      // Challenge detection is best-effort after a manual sequence.
    }
    this.emit({
      status: 'needs_action',
      message: '手动步骤已执行，请在默认浏览器中确认登录结果'
    })
  }

  private async runRecipe(): Promise<boolean> {
    const recipe = this.currentRecipe()
    if (!recipe || !this.site || !this.account || !this.browser || this.recipeRunning) {
      return false
    }
    this.recipeRunning = true
    try {
      while (
        this.browser &&
        this.stepIndex < recipe.steps.length
      ) {
        const step = recipe.steps[this.stepIndex]
        if (!step) {
          break
        }
        if (step.type === 'acceptCertWarning') {
          const handled = await this.inspectCertificateWarning(true)
          this.stepIndex += 1
          if (handled) {
            this.hadSubmission = false
            this.startSubmissionWatch()
            return true
          }
          continue
        }
        const origin = safeOrigin(this.browser.getSnapshot().url)
        if (!isOriginTrusted(this.site, origin, recipe)) {
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
            username: this.loginUsername(),
            password: this.account.password
          })
        )
        if (!result.found) {
          break
        }
        if (result.manualRequired) {
          this.emit({
            status: 'needs_action',
            message: `登录步骤 ${this.stepIndex + 1} 需要人工完成，请在默认浏览器中继续`
          })
          return true
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

      if (this.stepIndex >= recipe.steps.length) {
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
          recipe.successCheck?.urlPrefix &&
          stripQuery(currentUrl).startsWith(recipe.successCheck.urlPrefix)
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

    const currentUrl = stripQuery(this.browser?.getSnapshot().url ?? '')
    const startUrl = stripQuery(this.site?.startUrl ?? '')
    if (
      currentUrl &&
      startUrl &&
      currentUrl !== startUrl &&
      isHttpUrl(currentUrl)
    ) {
      this.clearSubmissionTimer()
      this.emit({ status: 'authenticated', message: '已有会话仍然有效，已直接打开站点' })
      return
    }

    this.emit({
      status: 'needs_action',
      message: '未识别到登录表单，可能已经登录或页面结构较特殊'
    })
  }

  private recordAction(rawStep: unknown, frameId = ''): void {
    if (this.mode !== 'record' || this.state.recordingPaused) {
      return
    }
    const parsed = recipeStepSchema.safeParse(rawStep)
    if (!parsed.success || this.recordingSteps.length >= 30) {
      if (!parsed.success) {
        this.rejectedRecordEvents += 1
      }
      return
    }
    const step = parsed.data as RecipeStep
    const selectorKey =
      step.type === 'acceptCertWarning'
        ? ''
        : step.type === 'focusChallenge'
          ? (step.selector?.candidates.join('|') ?? '')
          : step.selector.candidates.join('|')
    const stepKey = `${stripQuery(this.browser?.getSnapshot().url ?? '')}:${frameId}:${step.type}:${selectorKey}`
    if (this.recordedStepKeys.has(stepKey)) {
      return
    }
    this.recordedStepKeys.add(stepKey)
    this.recordingSteps = addRecordedStep(this.recordingSteps, step)
    this.appendDraftStep(step)
    if (step.type === 'focusChallenge') {
      this.recordingChallengeDetected = true
    }
    this.emitRecordingState()
  }

  private async runAgentCommand(command: BrowserAgentCommand): Promise<unknown> {
    if (!this.browser) {
      throw new Error('浏览器尚未打开')
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

  private scheduleCertificateWarningCheck(): void {
    this.clearCertificateTimer()
    this.certificateCheckTimer = setTimeout(() => {
      this.certificateCheckTimer = null
      void this.inspectCertificateWarning(this.mode !== 'record')
    }, 350)
  }

  private clearCertificateTimer(): void {
    if (this.certificateCheckTimer) {
      clearTimeout(this.certificateCheckTimer)
      this.certificateCheckTimer = null
    }
  }

  private async inspectCertificateWarning(autoAccept: boolean): Promise<boolean> {
    if (!this.browser || this.destroyed) {
      return false
    }
    const result = (await this.runAgentCommand({
      type: 'detect-cert-warning'
    }).catch(() => null)) as { detected?: boolean } | null
    if (!result?.detected) {
      return false
    }

    if (this.mode === 'record') {
      if (!this.state.recordingPaused) {
        this.recordingCertificatePending = true
      }
      this.emit({
        status: 'needs_action',
        message: '检测到证书拦截页，请在浏览器中继续前往目标站点'
      })
      return true
    }

    if (!autoAccept) {
      return true
    }
    this.emit({
      status: 'opening',
      message: '正在处理证书拦截页',
      isLoading: true
    })
    const accepted = (await this.runAgentCommand({
      type: 'accept-cert-warning'
    }).catch(() => null)) as { accepted?: boolean } | null
    if (accepted?.accepted) {
      this.startSubmissionWatch()
    }
    return true
  }

  private recordCertificateWarningStep(): void {
    this.recordingCertificatePending = false
    if (this.state.recordingPaused) {
      return
    }
    this.recordAction(
      {
        id: randomUUID(),
        type: 'acceptCertWarning',
        optional: true
      },
      'certificate-warning'
    )
  }

  private emitRecordingState(message = this.state.message): void {
    this.emit({
      recordingStepCount: this.recordingSteps.length,
      recordingSteps: this.recordingSteps.map(toRecordingStepSummary),
      recordingPaused: Boolean(this.state.recordingPaused),
      recordingStartedAt:
        this.recordingStartedAtMs > 0
          ? new Date(this.recordingStartedAtMs).toISOString()
          : undefined,
      recordingPausedAt: this.recordingPausedAtMs
        ? new Date(this.recordingPausedAtMs).toISOString()
        : undefined,
      message
    })
  }

  private currentRecipe(): LoginRecipe | null {
    if (!this.account) {
      return this.site?.recipe ?? null
    }
    const recipes = this.account.recipes ?? []
    return (
      recipes.find((entry) => entry.id === this.account?.activeRecipeId)?.recipe ??
      recipes[0]?.recipe ??
      this.site?.recipe ??
      null
    )
  }

  private emit(patch: Partial<LoginViewState>): void {
    this.state = { ...this.state, ...patch }
    if (this.embeddedLabel && this.embeddedProvider) {
      this.embeddedProvider.update(this.embeddedLabel, {
        ...(patch.pageTitle !== undefined
          ? { title: patch.pageTitle, pageTitle: patch.pageTitle }
          : {}),
        ...(patch.isLoading !== undefined ? { isLoading: patch.isLoading } : {})
      })
    }
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

export function isOriginTrusted(
  site: Site,
  origin: string,
  recipe: LoginRecipe | null = site.recipe ?? null
): boolean {
  return isOriginAllowed(origin, [
    ...site.allowedOrigins,
    ...(recipe?.allowedOrigins ?? [])
  ])
}

function toRecordingStepSummary(step: RecipeStep): RecordingStepSummary {
  if (step.type === 'acceptCertWarning') {
    return { id: step.id, type: step.type }
  }
  const selector = 'selector' in step ? step.selector : undefined
  if (!selector) {
    return { id: step.id, type: step.type }
  }
  const selectorLabel =
    selector.text?.trim().slice(0, 80) ||
    selector.candidates[0]?.slice(0, 120) ||
    undefined
  return {
    id: step.id,
    type: step.type,
    ...(step.type === 'paste' ? { source: step.source } : {}),
    ...(selectorLabel ? { selectorLabel } : {})
  }
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
    // Partitions from older desktop builds may still be locked by a stale process.
  }
}

export async function clearManagedSessionDirectoriesWithRetry(
  userDataPath: string,
  accountId: string
): Promise<void> {
  let lastError: unknown
  for (let attempt = 0; attempt < 6; attempt += 1) {
    try {
      clearManagedSessionDirectories(userDataPath, accountId)
      return
    } catch (error) {
      lastError = error
      if (attempt < 5) await delay(250)
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error('清除网站会话失败')
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

async function withTimeout<T>(
  promise: Promise<T>,
  milliseconds: number,
  fallback: T
): Promise<T> {
  let timer: NodeJS.Timeout | null = null
  try {
    return await Promise.race([
      promise,
      new Promise<T>((resolve) => {
        timer = setTimeout(() => resolve(fallback), milliseconds)
        timer.unref()
      })
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
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

function addRecordedStep(
  steps: RecipeStep[],
  step: RecipeStep
): RecipeStep[] {
  let next = steps
  if (step.type === 'paste' && step.source !== 'literal') {
    const selectorKey =
      step.selector.candidates[0] ??
      step.selector.text ??
      ''
    const replacedType =
      step.source === 'password' ? 'fillPassword' : 'fillUsername'
    next = next.filter(
      (existing) =>
        existing.type !== replacedType ||
        !('selector' in existing) ||
        existing.selector?.candidates[0] !== selectorKey
    )
  }
  return [...next, step]
}

interface PendingRecipeFile {
  accountId: string
  siteId: string
  recipeId: string
  name: string
  recipe: LoginRecipe
  createdAt: string
}

function parsePendingRecipeFile(source: string): PendingRecipeFile | null {
  try {
    const payload = JSON.parse(readFileSync(source, 'utf8')) as PendingRecipeFile
    if (
      !payload?.accountId ||
      !payload.siteId ||
      !payload.recipeId ||
      !payload.name ||
      !payload.recipe
    ) {
      return null
    }
    return payload
  } catch {
    return null
  }
}

export function migratePendingRecipeFiles(
  sourceDirectory: string,
  targetDirectory: string
): number {
  const source = resolve(sourceDirectory)
  const target = resolve(targetDirectory)
  if (source.toLowerCase() === target.toLowerCase()) {
    return 0
  }

  mkdirSync(target, { recursive: true })
  let entries: string[]
  try {
    entries = readdirSync(source)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return 0
    }
    throw error
  }

  let migrated = 0
  for (const entry of entries) {
    if (!entry.endsWith('.json')) continue
    const sourcePath = join(source, entry)
    if (!parsePendingRecipeFile(sourcePath)) continue
    mkdirSync(target, { recursive: true })
    copyFileSync(sourcePath, join(target, entry))
    rmSync(sourcePath, { force: true })
    migrated += 1
  }
  return migrated
}

interface DraftLine {
  kind?: string
  accountId?: string
  siteId?: string
  startUrl?: string
  step?: unknown
  url?: string
}

/**
 * 从 append-only 草稿（recording-drafts/<session>.jsonl）恢复一条流程。
 * 这个文件在录制过程中逐步写入，不依赖「结束并保存」是否成功，
 * 所以主进程卡死、被强杀、断电都不会丢。
 */
async function recoverDraftSession(
  file: string,
  vault: VaultManager,
  userDataPath: string
): Promise<boolean> {
  try {
    const raw = await readFile(file, 'utf8')
    let steps: RecipeStep[] = []
    const origins = new Set<string>()
    let accountId = ''
    let startUrl = ''

    for (const line of raw.split('\n')) {
      if (!line.trim()) continue
      let entry: DraftLine
      try {
        entry = JSON.parse(line) as DraftLine
      } catch {
        continue
      }
      if (entry.kind === 'header') {
        accountId = entry.accountId ?? ''
        startUrl = entry.startUrl ?? ''
        const origin = safeOrigin(startUrl)
        if (origin) origins.add(origin)
        continue
      }
      if (entry.kind === 'undo') {
        steps.pop()
        continue
      }
      if (entry.kind !== 'step' || !entry.step) continue
      const parsed = recipeStepSchema.safeParse(entry.step)
      if (parsed.success) {
        steps = addRecordedStep(steps, parsed.data as RecipeStep)
      }
      const origin = safeOrigin(entry.url ?? '')
      if (origin) origins.add(origin)
    }

    if (!accountId || steps.length === 0) {
      return false
    }

    const data = vault.requireData()
    const account = data.accounts.find((item) => item.id === accountId)
    if (!account) {
      return false
    }
    if ((account.recipes?.length ?? 0) >= 3) {
      return false
    }

    const now = new Date().toISOString()
    const recipeId = randomUUID()
    const recipe: LoginRecipe = {
      version: 1,
      startUrl,
      allowedOrigins: [...origins],
      steps,
      manualChallenge: steps.some((step) => step.type === 'focusChallenge'),
      createdAt: now,
      updatedAt: now
    }

    const recipes = account.recipes ?? []
    let sequence = recipes.length + 1
    while (recipes.some((item) => item.name === `录制流程 ${sequence}（恢复）`)) {
      sequence += 1
    }
    account.recipes = [
      ...recipes,
      { id: recipeId, name: `录制流程 ${sequence}（恢复）`, recipe }
    ]
    account.updatedAt = now
    await vault.saveAsync({ tabIds: [account.tabId] })
    await rm(file, { force: true })

    appendAppLog(userDataPath, {
      level: 'success',
      category: 'login',
      message: `已从录制草稿恢复流程（${steps.length} 步）`,
      details: `账号：${account.label}`
    })
    return true
  } catch {
    return false
  }
}

/**
 * 保险库解锁后把遗留的待合并录制流程补回去。
 * 保险库写入卡住或崩溃时，录制结果仍留在 pending-recipes 目录里，不会丢。
 */
export async function mergePendingRecipes(
  userDataPath: string,
  vault: VaultManager,
  configuredDirectory = vault.getSettings().recordingDraftDirectory
): Promise<number> {
  let merged = 0
  const directories = [
    ...new Set([
      resolveRecordingDraftDirectory(userDataPath, configuredDirectory),
      resolveRecordingDraftDirectory(userDataPath)
    ])
  ]
  for (const directory of directories) {
    let entries: string[]
    try {
      entries = await readdir(directory)
    } catch {
      continue
    }

    for (const entry of entries) {
      if (entry.endsWith('.jsonl')) {
        const recovered = await recoverDraftSession(join(directory, entry), vault, userDataPath)
        if (recovered) {
          merged += 1
        }
        continue
      }
      if (!entry.endsWith('.json')) continue
      const file = join(directory, entry)
      try {
        const payload = JSON.parse(await readFile(file, 'utf8')) as PendingRecipeFile
        if (
          !payload?.accountId ||
          !payload.siteId ||
          !payload.recipeId ||
          !payload.name ||
          !payload.recipe
        ) {
          continue
        }
        const data = vault.requireData()
        const account = data.accounts.find((item) => item.id === payload.accountId)
        if (!account) {
          continue
        }
        const recipes = account.recipes ?? []
        if (
          recipes.some((item) => item.id === payload.recipeId || item.name === payload.name)
        ) {
          await rm(file, { force: true })
          continue
        }
        account.recipes = [
          ...recipes,
          { id: payload.recipeId, name: payload.name, recipe: payload.recipe }
        ]
        account.activeRecipeId = payload.recipeId
        account.updatedAt = new Date().toISOString()
        await vault.saveAsync({ tabIds: [account.tabId] })
        await rm(file, { force: true })
        merged += 1
      } catch {
        // 单个文件失败时保留它，等下次解锁再试。
      }
    }
  }

  if (merged > 0) {
    appendAppLog(userDataPath, {
      level: 'success',
      category: 'login',
      message: `已补回 ${merged} 个未合并的录制流程`,
      details: '来源：pending-recipes（上次保存未完成）'
    })
  }
  return merged
}
