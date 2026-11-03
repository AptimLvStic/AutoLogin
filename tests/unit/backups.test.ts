import {
  mkdtempSync,
  readFileSync,
  rmSync,
  utimesSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { BackupManager } from '../../src/main/backups'

const directories: string[] = []

afterEach(() => {
  while (directories.length > 0) {
    rmSync(directories.pop()!, { recursive: true, force: true })
  }
})

function createDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), 'autologin-backups-'))
  directories.push(directory)
  return directory
}

describe('BackupManager', () => {
  it('keeps only the latest three encrypted snapshots', () => {
    const directory = createDirectory()
    const vaultPath = join(directory, 'vault.enc')
    const manager = new BackupManager(directory)
    const baseTime = Math.floor(Date.now() / 1000) - 500

    for (let index = 0; index < 5; index += 1) {
      writeFileSync(vaultPath, `encrypted-${index}`, 'utf8')
      const record = manager.createFromVault(vaultPath)
      expect(record).not.toBeNull()
      const path = join(manager.path, record!.fileName)
      utimesSync(path, baseTime + index, baseTime + index)
    }

    const backups = manager.list()
    expect(backups).toHaveLength(3)
    const contents = backups.map((record) =>
      readFileSync(join(manager.path, record.fileName), 'utf8')
    )
    expect(contents).toEqual(['encrypted-4', 'encrypted-3', 'encrypted-2'])
  })

  it('rejects path traversal and resolves managed backup ids', () => {
    const directory = createDirectory()
    const vaultPath = join(directory, 'vault.enc')
    writeFileSync(vaultPath, 'encrypted', 'utf8')
    const manager = new BackupManager(directory)
    const record = manager.createFromVault(vaultPath)!

    expect(manager.resolve(record.id)).toBe(join(manager.path, record.fileName))
    expect(() => manager.resolve('../vault.enc')).toThrow('备份文件标识无效')
  })

  it('does not create a backup before the vault exists', () => {
    const directory = createDirectory()
    const manager = new BackupManager(directory)
    expect(manager.createFromVault(join(directory, 'vault.enc'))).toBeNull()
    expect(manager.list()).toEqual([])
  })
})
