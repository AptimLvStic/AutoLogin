import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  appendAccessLog,
  deleteAccessLogs,
  readAccessLogs
} from '../../src/main/access-log'

const directories: string[] = []

afterEach(() => {
  while (directories.length > 0) {
    rmSync(directories.pop()!, { recursive: true, force: true })
  }
})

function createDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), 'autologin-access-'))
  directories.push(directory)
  return directory
}

describe('access log', () => {
  it('redacts URLs and filters by site, group and status', () => {
    const directory = createDirectory()
    const success = appendAccessLog(directory, {
      accountId: 'account-1',
      siteId: 'site-1',
      accountLabel: '设计资料',
      siteName: '设计站点',
      groupName: '工作 / 资料',
      url: 'https://example.com/docs?token=secret#private',
      status: 'success',
      reason: '已在系统默认浏览器中打开'
    })
    appendAccessLog(directory, {
      accountId: 'account-2',
      siteId: 'site-2',
      accountLabel: '新闻',
      siteName: '资讯站点',
      groupName: '阅读',
      url: 'https://news.example.com/today',
      status: 'error',
      reason: '无法在系统默认浏览器中打开'
    })

    expect(success.url).toBe('https://example.com/docs')
    expect(
      readAccessLogs(directory, {
        siteId: 'site-1',
        groupName: '工作 / 资料',
        status: 'success'
      })
    ).toHaveLength(1)
    expect(readAccessLogs(directory, { status: 'error' })[0]?.siteName).toBe(
      '资讯站点'
    )
  })

  it('deletes selected entries without touching the rest', () => {
    const directory = createDirectory()
    const first = appendAccessLog(directory, {
      accountId: 'account-1',
      siteId: 'site-1',
      accountLabel: '书签一',
      siteName: '站点一',
      groupName: '未分组',
      url: 'https://one.example.com/',
      status: 'success',
      reason: '已打开'
    })
    appendAccessLog(directory, {
      accountId: 'account-2',
      siteId: 'site-2',
      accountLabel: '书签二',
      siteName: '站点二',
      groupName: '未分组',
      url: 'https://two.example.com/',
      status: 'success',
      reason: '已打开'
    })

    expect(deleteAccessLogs(directory, [first.id])).toBe(1)
    expect(readAccessLogs(directory)).toHaveLength(1)
    expect(readAccessLogs(directory)[0]?.siteName).toBe('站点二')
  })
})
