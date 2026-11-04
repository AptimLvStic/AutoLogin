import { randomUUID } from 'node:crypto'
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync
} from 'node:fs'
import { dirname, join } from 'node:path'
import type { AppLogEntry, AppLogLevel } from '@shared/types'

const MAX_LOG_ENTRIES = 500

export function appLogPath(dataDirectory: string): string {
  return join(dataDirectory, 'logs', 'app.jsonl')
}

export function appendAppLog(
  dataDirectory: string,
  input: {
    level: AppLogLevel
    category: string
    message: string
    details?: string
  }
): AppLogEntry {
  const path = appLogPath(dataDirectory)
  mkdirSync(dirname(path), { recursive: true })
  const entry: AppLogEntry = {
    id: randomUUID(),
    timestamp: new Date().toISOString(),
    level: input.level,
    category: sanitizeText(input.category, 40),
    message: sanitizeText(input.message, 500),
    ...(input.details?.trim()
      ? { details: sanitizeText(input.details, 2000) }
      : {})
  }
  appendFileSync(path, `${JSON.stringify(entry)}\n`, {
    encoding: 'utf8',
    mode: 0o600
  })
  trimLogFile(path)
  return entry
}

export function readAppLogs(dataDirectory: string, limit = 200): AppLogEntry[] {
  const path = appLogPath(dataDirectory)
  if (!existsSync(path)) return []
  return readFileSync(path, 'utf8')
    .split(/\r?\n/)
    .filter(Boolean)
    .flatMap((line) => {
      try {
        const entry = JSON.parse(line) as Partial<AppLogEntry>
        if (
          typeof entry.id !== 'string' ||
          typeof entry.timestamp !== 'string' ||
          typeof entry.level !== 'string' ||
          typeof entry.category !== 'string' ||
          typeof entry.message !== 'string'
        ) {
          return []
        }
        return [entry as AppLogEntry]
      } catch {
        return []
      }
    })
    .slice(-Math.max(1, Math.min(limit, MAX_LOG_ENTRIES)))
    .reverse()
}

export function clearAppLogs(dataDirectory: string): number {
  const path = appLogPath(dataDirectory)
  if (!existsSync(path)) return 0
  const count = readAppLogs(dataDirectory, MAX_LOG_ENTRIES).length
  writeFileSync(path, '', { encoding: 'utf8', mode: 0o600 })
  return count
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

function sanitizeText(value: string, maxLength: number): string {
  return value
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength)
}
