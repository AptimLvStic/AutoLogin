import { appendFileSync, mkdirSync, rmSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type {
  LoginBatchItem,
  LoginBatchItemStatus,
  LoginBatchState,
  LoginStatus,
  LoginViewState
} from '@shared/types'
import {
  clearManagedSessionDirectories,
  LoginSessionManager
} from './login-session'
import { VaultManager } from './vault'

const MAX_CONCURRENT_BROWSERS = 3
const LOGIN_TIMEOUT_MS = 30_000
const MAX_FAILURE_LOG_BYTES = 2 * 1024 * 1024

interface FailureLogEntry {
  timestamp: string
  batchId: string
  accountId: string
  accountLabel: string
  siteName: string
  status: 'error' | 'timeout' | 'manual'
  reason: string
}

export class LoginBatchManager {
  private state: LoginBatchState | null = null
  private readonly managers = new Map<string, LoginSessionManager>()
  private readonly timers = new Map<string, NodeJS.Timeout>()
  private readonly loggedFailures = new Set<string>()
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

    for (const { account } of accounts) {
      await this.closeAccount(account.id)
    }

    const startedAt = new Date().toISOString()
    this.loggedFailures.clear()
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
      startedAt,
      items: accounts.map(({ account, site }) => ({
        accountId: account.id,
        accountLabel: account.label,
        siteName: site.name,
        status: 'queued',
        message: '等待打开'
      }))
    }
    this.publish()
    this.pump()
    return this.getState()!
  }

  async clearSession(accountId: string): Promise<void> {
    await this.closeAccount(accountId)
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
    this.queue = []
    this.running = 0
    for (const timer of this.timers.values()) {
      clearTimeout(timer)
    }
    this.timers.clear()
    const managers = [...this.managers.values()]
    this.managers.clear()
    await Promise.allSettled(managers.map((manager) => manager.close()))
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
    while (this.running < MAX_CONCURRENT_BROWSERS && this.queue.length > 0) {
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
    if (!item || item.status === 'success' || item.status === 'failed') {
      return
    }

    this.updateItem(accountId, {
      status: 'opening',
      message: '正在启动默认浏览器',
      startedAt: new Date().toISOString()
    })
    this.armTimeout(accountId)

    const manager = new LoginSessionManager(
      this.vault,
      this.userDataPath,
      this.browserExecutableOverride,
      this.headlessBrowser,
      (next) => this.handleLoginState(accountId, next)
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
    if (!item || item.status === 'success' || item.status === 'failed') {
      return
    }

    if (state.status === 'authenticated') {
      this.clearTimer(accountId)
      this.updateItem(accountId, {
        status: 'success',
        message: state.message || '登录成功',
        completedAt: new Date().toISOString()
      })
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
      if (!item || item.status === 'success' || item.status === 'failed') {
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
    if (!item || item.status === 'success' || item.status === 'failed') {
      return
    }
    this.clearTimer(accountId)
    const safeReason = sanitizeFailureReason(reason)
    this.updateItem(accountId, {
      status: 'failed',
      message: safeReason,
      completedAt: new Date().toISOString()
    })
    this.writeFailureLog(item, safeReason, reason.includes('30 秒') ? 'timeout' : 'error')
  }

  private markManual(accountId: string, reason: string): void {
    const item = this.findItem(accountId)
    if (!item || item.status === 'success' || item.status === 'failed') {
      return
    }
    this.clearTimer(accountId)
    const safeReason = sanitizeFailureReason(reason)
    this.updateItem(accountId, {
      status: 'manual',
      message: safeReason,
      completedAt: new Date().toISOString()
    })
    this.writeFailureLog(item, safeReason, 'manual')
  }

  private writeFailureLog(
    item: LoginBatchItem,
    reason: string,
    status: FailureLogEntry['status']
  ): void {
    const key = `${this.state?.batchId ?? ''}:${item.accountId}`
    if (this.loggedFailures.has(key)) {
      return
    }
    this.loggedFailures.add(key)

    const entry: FailureLogEntry = {
      timestamp: new Date().toISOString(),
      batchId: this.state?.batchId ?? '',
      accountId: item.accountId,
      accountLabel: item.accountLabel,
      siteName: item.siteName,
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
      // Failure logging must never turn a login failure into an app crash.
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
    const active = pending > 0
    this.state = {
      ...this.state,
      active,
      pending,
      success,
      failed,
      manual,
      finishedAt:
        !active && !this.state.finishedAt ? new Date().toISOString() : this.state.finishedAt
    }
    this.onState(structuredClone(this.state))
  }

  private findItem(accountId: string): LoginBatchItem | undefined {
    return this.state?.items.find((item) => item.accountId === accountId)
  }
}

export function failureLogPath(userDataPath: string): string {
  return join(userDataPath, 'logs', 'login-failures.jsonl')
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

function sanitizeFailureReason(value: string): string {
  return value
    .replace(/https?:\/\/[^\s]+/gi, '[地址已隐藏]')
    .replace(/[\r\n]+/g, ' ')
    .trim()
    .slice(0, 300) || '登录失败'
}

function existsAndIsLarge(path: string): boolean {
  try {
    return statSync(path).size >= MAX_FAILURE_LOG_BYTES
  } catch {
    return false
  }
}
