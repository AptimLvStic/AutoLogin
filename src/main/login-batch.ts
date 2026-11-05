import {
  appendFileSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type {
  LoginBatchItem,
  LoginBatchItemStatus,
  LoginBatchState,
  LoginStatus,
  LoginViewState,
  LoginLogEntry,
  LoginLogQuery
} from '@shared/types'
import {
  clearManagedSessionDirectories,
  LoginSessionManager
} from './login-session'
import {
  assertChromiumBrowser,
  discoverDefaultBrowser,
  type DefaultBrowser
} from './browser-discovery'
import { ExternalBrowserHost } from './external-browser'
import { browserProfileDirectory } from './session-index'
import { VaultManager } from './vault'

const MAX_CONCURRENT_TABS = 3
const LOGIN_TIMEOUT_MS = 30_000
const MAX_FAILURE_LOG_BYTES = 2 * 1024 * 1024

export class LoginBatchManager {
  private state: LoginBatchState | null = null
  private readonly managers = new Map<string, LoginSessionManager>()
  private readonly timers = new Map<string, NodeJS.Timeout>()
  private readonly loggedResults = new Set<string>()
  private host: ExternalBrowserHost | null = null
  private browserInfo: DefaultBrowser | null = null
  private queue: string[] = []
  private running = 0
  private disposed = false

  constructor(
    private readonly vault: VaultManager,
    private readonly userDataPath: string,
    private readonly browserExecutableOverride: string | undefined,
    private readonly headlessBrowser: boolean,
    private readonly onState: (state: LoginBatchState) => void
  ) {}

  getState(): LoginBatchState | null {
    return this.state ? structuredClone(this.state) : null
  }

  async start(accountIds: string[]): Promise<LoginBatchState> {
    if (this.state?.active) {
      throw new Error('已有批量登录任务正在进行')
    }

    const data = this.vault.requireData()
    const uniqueIds = [...new Set(accountIds)]
    const accounts = uniqueIds.map((accountId) => {
      const account = data.accounts.find((entry) => entry.id === accountId)
      const site = account ? data.sites.find((entry) => entry.id === account.siteId) : null
      if (!account || !site) {
        throw new Error('账号或站点不存在')
      }
      return { account, site }
    })

    await this.closeRuntime()
    this.disposed = false
    const browserInfo = discoverDefaultBrowser(this.browserExecutableOverride)
    assertChromiumBrowser(browserInfo)
    this.browserInfo = browserInfo
    this.host = await ExternalBrowserHost.launch({
      browser: browserInfo,
      profileDirectory: browserProfileDirectory(this.userDataPath, 'batch'),
      headless: this.headlessBrowser,
      proxy: this.vault.getSettings().proxy
    })

    const startedAt = new Date().toISOString()
    this.loggedResults.clear()
    this.queue = accounts.map(({ account }) => account.id)
    this.running = 0
    this.state = {
      batchId: randomUUID(),
      active: true,
      total: accounts.length,
      pending: accounts.length,
      success: 0,
      failed: 0,
      manual: 0,
      canceled: 0,
      startedAt,
      items: accounts.map(({ account, site }) => ({
        accountId: account.id,
        siteId: site.id,
        accountLabel: account.label,
        siteName: site.name,
        groupName: site.group?.trim() || '未分组',
        status: 'queued',
        message: '等待打开'
      }))
    }
    this.publish()
    this.pump()
    return this.getState()!
  }

  async cancel(): Promise<LoginBatchState> {
    if (!this.state) {
      throw new Error('没有可中断的批量登录任务')
    }
    if (!this.state.active) {
      return this.getState()!
    }

    const canceledAt = new Date().toISOString()
    this.state = {
      ...this.state,
      active: false,
      pending: 0,
      canceled: this.state.items.filter((item) => isPendingStatus(item.status)).length + this.state.canceled,
      finishedAt: canceledAt,
      items: this.state.items.map((item) =>
        isPendingStatus(item.status)
          ? {
              ...item,
              status: 'canceled',
              message: '已手动中断',
              completedAt: canceledAt
            }
          : item
      )
    }
    this.queue = []
    await this.closeRuntime()
    this.publish()
    return this.getState()!
  }

  async clearSession(accountId: string): Promise<void> {
    await this.closeRuntime()
    clearManagedSessionDirectories(this.userDataPath, 'batch')
    clearManagedSessionDirectories(this.userDataPath, accountId)
  }

  async closeAccount(accountId: string): Promise<void> {
    this.clearTimer(accountId)
    const manager = this.managers.get(accountId)
    this.managers.delete(accountId)
    if (manager) {
      await manager.close()
    }
  }

  async close(): Promise<void> {
    this.disposed = true
    await this.closeRuntime()
    if (this.state?.active) {
      this.state = {
        ...this.state,
        active: false,
        pending: 0,
        finishedAt: new Date().toISOString()
      }
      this.onState(structuredClone(this.state))
    }
  }

  private pump(): void {
    if (this.disposed || !this.state?.active) {
      return
    }
    while (this.running < MAX_CONCURRENT_TABS && this.queue.length > 0) {
      const accountId = this.queue.shift()
      if (!accountId) {
        break
      }
      this.running += 1
      void this.runAccount(accountId).finally(() => {
        this.running -= 1
        this.pump()
      })
    }
  }

  private async runAccount(accountId: string): Promise<void> {
    const item = this.findItem(accountId)
    if (
      !item ||
      item.status === 'success' ||
      item.status === 'failed' ||
      item.status === 'canceled'
    ) {
      return
    }

    this.updateItem(accountId, {
      status: 'opening',
      message: '正在启动默认浏览器',
      startedAt: new Date().toISOString()
    })
    this.armTimeout(accountId)

    if (!this.host || !this.browserInfo) {
      this.markFailed(accountId, '共享默认浏览器尚未准备好')
      return
    }

    const manager = new LoginSessionManager(
      this.vault,
      this.userDataPath,
      this.browserExecutableOverride,
      this.headlessBrowser,
      (next) => this.handleLoginState(accountId, next),
      this.host
    )
    this.managers.set(accountId, manager)

    try {
      await manager.start(accountId, 'login')
    } catch (error) {
      this.markFailed(
        accountId,
        error instanceof Error ? error.message : '无法启动默认浏览器'
      )
    }
  }

  private handleLoginState(accountId: string, state: LoginViewState): void {
    const item = this.findItem(accountId)
    if (
      !item ||
      item.status === 'success' ||
      item.status === 'failed' ||
      item.status === 'canceled'
    ) {
      return
    }

    if (state.status === 'authenticated') {
      this.clearTimer(accountId)
      const safeReason = sanitizeLoginReason(state.message || '登录成功', '登录成功')
      this.updateItem(accountId, {
        status: 'success',
        message: safeReason,
        completedAt: new Date().toISOString()
      })
      this.writeLoginLog(item, safeReason, 'success')
      return
    }

    if (state.status === 'error') {
      this.markFailed(accountId, state.message || '默认浏览器发生错误')
      return
    }

    if (state.status === 'awaiting_manual_challenge' || state.status === 'needs_action') {
      this.markManual(accountId, state.message || '需要人工处理')
      return
    }

    const status = mapRunningStatus(state.status)
    if (status) {
      this.updateItem(accountId, {
        status,
        message: state.message || '正在处理登录页面'
      })
    }
  }

  private armTimeout(accountId: string): void {
    this.clearTimer(accountId)
    const timer = setTimeout(() => {
      const item = this.findItem(accountId)
      if (
        !item ||
        item.status === 'success' ||
        item.status === 'failed' ||
        item.status === 'canceled'
      ) {
        return
      }
      this.markFailed(accountId, '登录状态在 30 秒内未确认，请检查默认浏览器')
    }, LOGIN_TIMEOUT_MS)
    timer.unref()
    this.timers.set(accountId, timer)
  }

  private clearTimer(accountId: string): void {
    const timer = this.timers.get(accountId)
    if (timer) {
      clearTimeout(timer)
      this.timers.delete(accountId)
    }
  }

  private markFailed(accountId: string, reason: string): void {
    const item = this.findItem(accountId)
    if (
      !item ||
      item.status === 'success' ||
      item.status === 'failed' ||
      item.status === 'canceled'
    ) {
      return
    }
    this.clearTimer(accountId)
    const status = reason.includes('30 秒') ? 'timeout' : 'error'
    const safeReason = sanitizeLoginReason(reason, status === 'timeout' ? '登录超时' : '登录失败')
    this.updateItem(accountId, {
      status: 'failed',
      message: safeReason,
      completedAt: new Date().toISOString()
    })
    this.writeLoginLog(item, safeReason, status)
  }

  private markManual(accountId: string, reason: string): void {
    const item = this.findItem(accountId)
    if (
      !item ||
      item.status === 'success' ||
      item.status === 'failed' ||
      item.status === 'canceled'
    ) {
      return
    }
    this.clearTimer(accountId)
    const safeReason = sanitizeLoginReason(reason, '需要人工处理')
    this.updateItem(accountId, {
      status: 'manual',
      message: safeReason,
      completedAt: new Date().toISOString()
    })
    this.writeLoginLog(item, safeReason, 'manual')
  }

  private writeLoginLog(
    item: LoginBatchItem,
    reason: string,
    status: LoginLogEntry['status']
  ): void {
    const key = `${this.state?.batchId ?? ''}:${item.accountId}`
    if (this.loggedResults.has(key)) {
      return
    }
    this.loggedResults.add(key)

    const entry: LoginLogEntry = {
      id: randomUUID(),
      timestamp: new Date().toISOString(),
      batchId: this.state?.batchId ?? '',
      accountId: item.accountId,
      siteId: item.siteId,
      accountLabel: item.accountLabel,
      siteName: item.siteName,
      groupName: item.groupName,
      status,
      reason
    }
    try {
      const directory = join(this.userDataPath, 'logs')
      const path = failureLogPath(this.userDataPath)
      mkdirSync(directory, { recursive: true })
      if (existsAndIsLarge(path)) {
        rmSync(path, { force: true })
      }
      appendFileSync(path, `${JSON.stringify(entry)}\n`, { encoding: 'utf8', mode: 0o600 })
    } catch {
      // Login logging must never turn a login result into an app crash.
    }
  }

  private updateItem(accountId: string, patch: Partial<LoginBatchItem>): void {
    if (!this.state) {
      return
    }
    this.state.items = this.state.items.map((item) =>
      item.accountId === accountId ? { ...item, ...patch } : item
    )
    this.publish()
  }

  private publish(): void {
    if (!this.state) {
      return
    }
    const pending = this.state.items.filter((item) => isPendingStatus(item.status)).length
    const success = this.state.items.filter((item) => item.status === 'success').length
    const failed = this.state.items.filter(
      (item) => item.status === 'failed' || item.status === 'manual'
    ).length
    const manual = this.state.items.filter((item) => item.status === 'manual').length
    const canceled = this.state.items.filter((item) => item.status === 'canceled').length
    const active = pending > 0
    this.state = {
      ...this.state,
      active,
      pending,
      success,
      failed,
      manual,
      canceled,
      finishedAt:
        !active && !this.state.finishedAt ? new Date().toISOString() : this.state.finishedAt
    }
    this.onState(structuredClone(this.state))
  }

  private findItem(accountId: string): LoginBatchItem | undefined {
    return this.state?.items.find((item) => item.accountId === accountId)
  }

  private async closeRuntime(): Promise<void> {
    this.queue = []
    this.running = 0
    for (const timer of this.timers.values()) {
      clearTimeout(timer)
    }
    this.timers.clear()
    const managers = [...this.managers.values()]
    this.managers.clear()
    await Promise.allSettled(managers.map((manager) => manager.close()))
    const host = this.host
    this.host = null
    this.browserInfo = null
    if (host) {
      await host.close().catch(() => undefined)
    }
  }
}

export function failureLogPath(userDataPath: string): string {
  return join(userDataPath, 'logs', 'login-failures.jsonl')
}

export function readLoginLogs(
  userDataPath: string,
  query: LoginLogQuery = {},
  limit = 1000
): LoginLogEntry[] {
  const path = failureLogPath(userDataPath)
  let content = ''
  try {
    content = readFileSync(path, 'utf8')
  } catch {
    return []
  }

  const querySiteName = normalizeFilter(query.siteName)
  const queryGroup = normalizeFilter(query.groupName)
  const entries = parseLoginLogLines(content).filter((entry) => {
    if (query.date && localDateKey(entry.timestamp) !== query.date) return false
    if (query.siteId && entry.siteId !== query.siteId) {
      if (!querySiteName || entry.siteName !== querySiteName) return false
    }
    if (querySiteName && entry.siteName !== querySiteName) return false
    if (queryGroup && entry.groupName !== queryGroup) return false
    if (query.status && entry.status !== query.status) return false
    return true
  })
  return entries.slice(-Math.max(1, Math.min(limit, 1000))).reverse()
}

export function readFailureLogs(userDataPath: string, limit = 200): LoginLogEntry[] {
  return readLoginLogs(userDataPath, {}, limit).filter((entry) => entry.status !== 'success')
}

export function deleteLoginLogs(userDataPath: string, ids: string[]): number {
  const path = failureLogPath(userDataPath)
  let content = ''
  try {
    content = readFileSync(path, 'utf8')
  } catch {
    return 0
  }

  const idSet = new Set(ids)
  const lines = content.split(/\r?\n/)
  const kept: string[] = []
  let deleted = 0
  for (const line of lines) {
    if (!line.trim()) {
      continue
    }
    const entry = parseLoginLogLine(line)
    if (entry && idSet.has(entry.id)) {
      deleted += 1
    } else {
      kept.push(line)
    }
  }

  if (deleted > 0) {
    const tempPath = `${path}.${process.pid}.tmp`
    writeFileSync(tempPath, kept.length > 0 ? `${kept.join('\n')}\n` : '', {
      encoding: 'utf8',
      mode: 0o600
    })
    renameSync(tempPath, path)
  }
  return deleted
}

function parseLoginLogLines(content: string): LoginLogEntry[] {
  const entries: LoginLogEntry[] = []
  for (const line of content.split(/\r?\n/)) {
    const entry = parseLoginLogLine(line)
    if (entry) entries.push(entry)
  }
  return entries
}

function parseLoginLogLine(line: string): LoginLogEntry | null {
  if (!line.trim()) return null
  try {
    const value = JSON.parse(line) as Partial<LoginLogEntry>
    if (
      typeof value.timestamp !== 'string' ||
      typeof value.batchId !== 'string' ||
      typeof value.accountId !== 'string' ||
      typeof value.accountLabel !== 'string' ||
      typeof value.siteName !== 'string' ||
      !['success', 'error', 'timeout', 'manual'].includes(value.status ?? '') ||
      typeof value.reason !== 'string'
    ) {
      return null
    }
    const siteId =
      typeof value.siteId === 'string' && value.siteId.trim()
        ? value.siteId.slice(0, 128)
        : ''
    const fallbackId = [
      value.timestamp,
      value.batchId,
      value.accountId,
      siteId,
      value.siteName
    ].join(':')
    return {
      id:
        typeof value.id === 'string' && value.id.trim()
          ? value.id.slice(0, 256)
          : `legacy-${stableHash(fallbackId)}`,
      timestamp: value.timestamp,
      batchId: value.batchId.slice(0, 128),
      accountId: value.accountId.slice(0, 128),
      siteId,
      accountLabel: value.accountLabel.slice(0, 80),
      siteName: value.siteName.slice(0, 80),
      groupName:
        typeof value.groupName === 'string' && value.groupName.trim()
          ? value.groupName.trim().slice(0, 40)
          : '未分组',
      status: value.status as LoginLogEntry['status'],
      reason: sanitizeLoginReason(
        value.reason,
        value.status === 'success' ? '登录成功' : '登录失败'
      )
    }
  } catch {
    return null
  }
}

function normalizeFilter(value: string | undefined): string {
  return value?.trim() ?? ''
}

function localDateKey(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function stableHash(value: string): string {
  let left = 0x811c9dc5
  let right = 0x01000193
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index)
    left = Math.imul(left ^ code, 0x01000193) >>> 0
    right = Math.imul(right ^ code, 0x85ebca6b) >>> 0
  }
  return `${left.toString(16).padStart(8, '0')}${right.toString(16).padStart(8, '0')}`
}

function mapRunningStatus(status: LoginStatus): LoginBatchItemStatus | null {
  switch (status) {
    case 'opening':
      return 'opening'
    case 'filling':
      return 'filling'
    case 'submitting':
      return 'submitting'
    default:
      return null
  }
}

function isPendingStatus(status: LoginBatchItemStatus): boolean {
  return ['queued', 'opening', 'filling', 'submitting'].includes(status)
}

function sanitizeLoginReason(value: string, fallback: string): string {
  return value
    .replace(/https?:\/\/[^\s]+/gi, '[地址已隐藏]')
    .replace(/[\r\n]+/g, ' ')
    .trim()
    .slice(0, 300) || fallback
}

function existsAndIsLarge(path: string): boolean {
  try {
    return statSync(path).size >= MAX_FAILURE_LOG_BYTES
  } catch {
    return false
  }
}
