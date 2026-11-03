import {
  closeSync,
  copyFileSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeSync
} from 'node:fs'
import { basename, join } from 'node:path'
import { randomBytes } from 'node:crypto'
import type { BackupRecord } from '@shared/types'

const BACKUP_FILE_PATTERN = /^autologin-backup-\d{8}T\d{9}-[a-f0-9]{6}\.enc$/
const MAX_BACKUPS = 3

export class BackupManager {
  private readonly directory: string

  constructor(dataDirectory: string) {
    this.directory = join(dataDirectory, 'backups')
  }

  get path(): string {
    return this.directory
  }

  createFromVault(vaultPath: string): BackupRecord | null {
    if (!existsSync(vaultPath)) {
      return null
    }
    mkdirSync(this.directory, { recursive: true })
    const now = new Date()
    const fileName = `autologin-backup-${timestampForFile(now)}-${randomBytes(3).toString('hex')}.enc`
    const target = join(this.directory, fileName)
    const temp = `${target}.${process.pid}.tmp`

    const file = openSync(temp, 'w', 0o600)
    try {
      const source = readFileSync(vaultPath)
      writeSync(file, source)
      fsyncSync(file)
    } finally {
      closeSync(file)
    }
    renameSync(temp, target)
    this.prune()
    return toRecord(target)
  }

  list(): BackupRecord[] {
    if (!existsSync(this.directory)) {
      return []
    }
    return readdirSync(this.directory)
      .filter((fileName) => BACKUP_FILE_PATTERN.test(fileName))
      .map((fileName) => join(this.directory, fileName))
      .filter((path) => existsSync(path))
      .map(toRecord)
      .sort(
        (left, right) =>
          right.createdAt.localeCompare(left.createdAt) ||
          right.fileName.localeCompare(left.fileName)
      )
  }

  resolve(id: string): string {
    if (!BACKUP_FILE_PATTERN.test(id) || basename(id) !== id) {
      throw new Error('备份文件标识无效')
    }
    const path = join(this.directory, id)
    if (!existsSync(path)) {
      throw new Error('备份文件不存在或已被清理')
    }
    return path
  }

  clear(): void {
    rmSync(this.directory, { recursive: true, force: true })
  }

  private prune(): void {
    for (const record of this.list().slice(MAX_BACKUPS)) {
      rmSync(join(this.directory, record.fileName), { force: true })
    }
  }
}

function timestampForFile(date: Date): string {
  const iso = date.toISOString()
  return `${iso.slice(0, 10).replace(/-/g, '')}T${iso
    .slice(11, 23)
    .replace(/[:.]/g, '')}`
}

function toRecord(path: string): BackupRecord {
  const stats = statSync(path)
  return {
    id: basename(path),
    fileName: basename(path),
    createdAt: stats.mtime.toISOString(),
    size: stats.size
  }
}
