import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'
import {
  appLogPath,
  appendAppLog,
  clearAppLogs,
  deleteAppLogs,
  readAppLogs
} from '../../src/main/app-log'

const directories: string[] = []

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

describe('app log storage', () => {
  it('persists newest-first logs and clears them on request', () => {
    const directory = mkdtempSync(join(tmpdir(), 'autologin-app-log-'))
    directories.push(directory)

    appendAppLog(directory, {
      level: 'info',
      category: 'startup',
      message: '应用已启动'
    })
    appendAppLog(directory, {
      level: 'success',
      category: 'proxy',
      message: '网络代理连通性测试成功：https://www.google.com/',
      details: '系统代理连接正常，延迟 32 ms'
    })

    const logs = readAppLogs(directory)
    expect(logs).toHaveLength(2)
    expect(logs[0]?.category).toBe('proxy')
    expect(logs[1]?.category).toBe('startup')
    expect(existsSync(appLogPath(directory))).toBe(true)

    expect(clearAppLogs(directory)).toBe(2)
    expect(readAppLogs(directory)).toEqual([])
    expect(readFileSync(appLogPath(directory), 'utf8')).toBe('')
  })

  it('keeps only the latest 500 entries', () => {
    const directory = mkdtempSync(join(tmpdir(), 'autologin-app-log-'))
    directories.push(directory)

    for (let index = 0; index < 505; index += 1) {
      appendAppLog(directory, {
        level: 'info',
        category: 'test',
        message: `entry-${index}`
      })
    }

    const logs = readAppLogs(directory, 500)
    expect(logs).toHaveLength(500)
    expect(logs[0]?.message).toBe('entry-504')
    expect(logs.at(-1)?.message).toBe('entry-5')
  })

  it('deletes selected entries without affecting the remaining log', () => {
    const directory = mkdtempSync(join(tmpdir(), 'autologin-app-log-'))
    directories.push(directory)

    const first = appendAppLog(directory, {
      level: 'info',
      category: 'test',
      message: 'first'
    })
    appendAppLog(directory, {
      level: 'warning',
      category: 'test',
      message: 'second'
    })

    expect(deleteAppLogs(directory, [first.id])).toBe(1)
    const remaining = readAppLogs(directory)
    expect(remaining).toHaveLength(1)
    expect(remaining[0]?.message).toBe('second')
  })
})
