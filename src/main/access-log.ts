import { randomUUID } from 'node:crypto'
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync
} from 'node:fs'
import { dirname, join } from 'node:path'
import type {
  AccessLogEntry,
  AccessLogQuery
} from '@shared/types'

const MAX_LOG_ENTRIES = 5000

export function accessLogPath(dataDirectory: string): string {
  return join(dataDirectory, 'logs', 'access.jsonl')
}

export function appendAccessLog(
  dataDirectory: string,
  input: Omit<AccessLogEntry, 'id' | 'timestamp' | 'url'> & { url: string }
): AccessLogEntry {
  const path = accessLogPath(dataDirectory)
  mkdirSync(dirname(path), { recursive: true })
  const entry: AccessLogEntry = {
    id: randomUUID(),
    timestamp: new Date().toISOString(),
    accountId: sanitizeText(input.accountId, 128),
    siteId: sanitizeText(input.siteId, 128),
    accountLabel: sanitizeText(input.accountLabel, 80),
    siteName: sanitizeText(input.siteName, 80),
    groupName: sanitizeText(input.groupName, 120),
    url: safeLogUrl(input.url),
    status: input.status,
    reason: sanitizeText(input.reason, 1000)
  }
  appendFileSync(path, `${JSON.stringify(entry)}\n`, {
    encoding: 'utf8',
    mode: 0o600
  })
  trimLogFile(path)
  return entry
}

export function readAccessLogs(
  dataDirectory: string,
  query?: AccessLogQuery
): AccessLogEntry[] {
  const path = accessLogPath(dataDirectory)
  if (!existsSync(path)) return []
  return readFileSync(path, 'utf8')
    .split(/\r?\n/)
    .filter(Boolean)
    .flatMap((line) => {
      try {
        const entry = JSON.parse(line) as Partial<AccessLogEntry>
        if (!isAccessLogEntry(entry)) return []
        if (query?.date && localDateKey(entry.timestamp) !== query.date) return []
        if (
          query?.siteId &&
          entry.siteId !== query.siteId &&
          entry.siteName !== query.siteName
        ) {
          return []
        }
        if (query?.siteName && entry.siteName !== query.siteName) return []
        if (query?.groupName && entry.groupName !== query.groupName) return []
        if (query?.status && entry.status !== query.status) return []
        return [entry as AccessLogEntry]
      } catch {
        return []
      }
    })
    .slice(-MAX_LOG_ENTRIES)
    .reverse()
}

export function deleteAccessLogs(dataDirectory: string, ids: string[]): number {
  const path = accessLogPath(dataDirectory)
  if (!existsSync(path)) return 0
  const entries = readAccessLogs(dataDirectory)
  const selected = new Set(ids)
  const remaining = entries.filter((entry) => !selected.has(entry.id))
  if (remaining.length === entries.length) return 0
  const contents = remaining
    .reverse()
    .map((entry) => JSON.stringify(entry))
    .join('\n')
  writeFileSync(path, contents ? `${contents}\n` : '', {
    encoding: 'utf8',
    mode: 0o600
  })
  return entries.length - remaining.length
}

function trimLogFile(path: string): void {
  const lines = readFileSync(path, 'utf8')
    .split(/\r?\n/)
    .filter(Boolean)
  if (lines.length <= MAX_LOG_ENTRIES) return
  writeFileSync(path, `${lines.slice(-MAX_LOG_ENTRIES).join('\n')}\n`, {
    encoding: 'utf8',
    mode: 0o600
  })
}

function isAccessLogEntry(entry: Partial<AccessLogEntry>): entry is AccessLogEntry {
  return (
    typeof entry.id === 'string' &&
    typeof entry.timestamp === 'string' &&
    typeof entry.accountId === 'string' &&
    typeof entry.siteId === 'string' &&
    typeof entry.accountLabel === 'string' &&
    typeof entry.siteName === 'string' &&
    typeof entry.groupName === 'string' &&
    typeof entry.url === 'string' &&
    (entry.status === 'success' || entry.status === 'error') &&
    typeof entry.reason === 'string'
  )
}

function safeLogUrl(value: string): string {
  try {
    const url = new URL(value)
    return `${url.origin}${url.pathname}`
  } catch {
    return '无效地址'
  }
}

function sanitizeText(value: string, maxLength: number): string {
  return value
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength)
}

function localDateKey(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}
