import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('virtual:page-agent-source', () => ({ default: '' }))

import {
  deleteLoginLogs,
  failureLogPath,
  readLoginLogs
} from '../../src/main/login-batch'

const directories: string[] = []

function createLogFixture(): string {
  const directory = mkdtempSync(join(tmpdir(), 'autologin-logs-'))
  directories.push(directory)
  mkdirSync(join(directory, 'logs'), { recursive: true })
  const entries = [
    {
      id: 'log-1',
      timestamp: '2026-11-03T12:00:00.000Z',
      batchId: 'batch-1',
      accountId: 'account-1',
      siteId: 'site-1',
      accountLabel: 'Portal',
      siteName: 'Portal',
      groupName: 'Work',
      status: 'success',
      reason: '登录成功'
    },
    {
      id: 'log-2',
      timestamp: '2026-11-03T12:01:00.000Z',
      batchId: 'batch-1',
      accountId: 'account-2',
      siteId: 'site-2',
      accountLabel: 'Mail',
      siteName: 'Mail',
      groupName: 'Work',
      status: 'error',
      reason: '页面结构无法识别'
    },
    {
      id: 'log-3',
      timestamp: '2026-11-03T12:02:00.000Z',
      batchId: 'batch-2',
      accountId: 'account-3',
      siteId: 'site-3',
      accountLabel: 'Admin',
      siteName: 'Admin',
      groupName: 'Internal',
      status: 'manual',
      reason: '需要人工完成验证码'
    }
  ]
  writeFileSync(
    failureLogPath(directory),
    `${entries.map((entry) => JSON.stringify(entry)).join('\n')}\n`,
    'utf8'
  )
  return directory
}

afterEach(() => {
  while (directories.length > 0) {
    rmSync(directories.pop()!, { recursive: true, force: true })
  }
})

describe('login log persistence', () => {
  it('filters by site, group and status', () => {
    const directory = createLogFixture()
    expect(readLoginLogs(directory, { siteId: 'site-2' })).toHaveLength(1)
    expect(readLoginLogs(directory, { siteName: 'Admin' })[0]?.id).toBe('log-3')
    expect(readLoginLogs(directory, { groupName: 'Work' })).toHaveLength(2)
    expect(readLoginLogs(directory, { status: 'error' })[0]?.id).toBe('log-2')
  })

  it('persists legacy ids and deletes only requested records', () => {
    const directory = createLogFixture()
    const path = failureLogPath(directory)
    writeFileSync(
      path,
      `${JSON.stringify({
        timestamp: '2026-11-03T12:03:00.000Z',
        batchId: 'legacy',
        accountId: 'legacy-account',
        accountLabel: 'Legacy',
        siteName: 'Legacy',
        groupName: 'Archive',
        status: 'timeout',
        reason: '登录超时'
      })}\n`,
      'utf8'
    )
    const legacy = readLoginLogs(directory)
    expect(legacy[0]?.id).toMatch(/^legacy-/)
    expect(deleteLoginLogs(directory, [legacy[0]!.id])).toBe(1)
    expect(readLoginLogs(directory)).toHaveLength(0)
  })
})
