import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  hasManagedDataDirectory,
  migrateDataDirectory,
  pathIsInside,
  readDataDirectory,
  recoverDataDirectoryFromInstall,
  writeDataDirectory
} from '../../src/main/data-location'

const directories: string[] = []

function createDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), 'autologin-location-'))
  directories.push(directory)
  return directory
}

afterEach(() => {
  while (directories.length > 0) {
    rmSync(directories.pop()!, { recursive: true, force: true })
  }
})

describe('data location recovery', () => {
  it('moves managed data out of the installation directory', () => {
    const config = createDirectory()
    const install = join(createDirectory(), 'AutoLogin')
    mkdirSync(join(install, 'backups'), { recursive: true })
    writeFileSync(join(install, 'vault.enc'), 'encrypted-vault')
    writeFileSync(join(install, 'vault.enc.bak'), 'encrypted-backup')
    writeFileSync(join(install, 'backups', 'old.enc'), 'rolling-backup')
    writeFileSync(join(install, 'AutoLogin.exe'), 'application-binary')
    writeDataDirectory(config, install)

    const recovered = recoverDataDirectoryFromInstall(config, install, install)

    expect(recovered).toBe(join(config, 'Data'))
    expect(readFileSync(join(recovered, 'vault.enc'), 'utf8')).toBe('encrypted-vault')
    expect(existsSync(join(recovered, 'backups', 'old.enc'))).toBe(true)
    expect(readDataDirectory(config)).toBe(recovered)
    expect(existsSync(join(install, 'vault.enc'))).toBe(false)
    expect(existsSync(join(install, 'AutoLogin.exe'))).toBe(true)
  })

  it('repairs a stale pointer when the installer already preserved a copy', () => {
    const config = createDirectory()
    const install = join(createDirectory(), 'AutoLogin')
    mkdirSync(install, { recursive: true })
    mkdirSync(join(config, 'Data'), { recursive: true })
    writeFileSync(join(config, 'Data', 'vault.enc'), 'installer-preserved-vault')
    writeDataDirectory(config, install)

    const recovered = recoverDataDirectoryFromInstall(config, install, install)

    expect(recovered).toBe(join(config, 'Data'))
    expect(readDataDirectory(config)).toBe(recovered)
  })

  it('keeps a custom data location through installer userData changes', () => {
    const stablePointerDirectory = createDirectory()
    const oldUserData = createDirectory()
    const newUserData = createDirectory()
    const customData = createDirectory()
    writeFileSync(join(customData, 'vault.enc'), 'custom-vault')

    writeDataDirectory(stablePointerDirectory, customData)
    writeDataDirectory(oldUserData, customData)

    expect(readDataDirectory(stablePointerDirectory, [newUserData], newUserData)).toBe(
      customData
    )
  })

  it('falls back to the backup location pointer when the primary file is damaged', () => {
    const stablePointerDirectory = createDirectory()
    const userData = createDirectory()
    const customData = createDirectory()
    writeDataDirectory(stablePointerDirectory, customData)
    writeFileSync(join(stablePointerDirectory, 'data-location.json'), '{damaged')

    expect(readDataDirectory(stablePointerDirectory, [userData], userData)).toBe(customData)
  })

  it('moves custom data back to the default directory and keeps the location durable', () => {
    const stablePointerDirectory = createDirectory()
    const userData = createDirectory()
    const customData = createDirectory()
    const defaultData = join(userData, 'Data')
    mkdirSync(defaultData, { recursive: true })
    writeFileSync(join(customData, 'vault.enc'), 'custom-vault')
    writeDataDirectory(stablePointerDirectory, customData)

    migrateDataDirectory(stablePointerDirectory, customData, defaultData)
    writeDataDirectory(userData, defaultData)

    expect(readFileSync(join(defaultData, 'vault.enc'), 'utf8')).toBe('custom-vault')
    expect(existsSync(join(customData, 'vault.enc'))).toBe(false)
    expect(readDataDirectory(stablePointerDirectory, [userData], userData)).toBe(defaultData)
  })

  it('backs up existing target data before overwriting it', () => {
    const stablePointerDirectory = createDirectory()
    const currentData = createDirectory()
    const targetData = createDirectory()
    writeFileSync(join(currentData, 'vault.enc'), 'current-vault')
    mkdirSync(join(currentData, 'logs'), { recursive: true })
    writeFileSync(join(currentData, 'logs', 'app.jsonl'), 'current-log')
    writeFileSync(join(targetData, 'vault.enc'), 'old-vault')
    mkdirSync(join(targetData, 'backups'), { recursive: true })
    writeFileSync(join(targetData, 'backups', 'old.enc'), 'old-backup')
    writeFileSync(join(targetData, 'notes.txt'), 'keep-this-too')

    expect(hasManagedDataDirectory(targetData)).toBe(true)
    migrateDataDirectory(stablePointerDirectory, currentData, targetData, {
      replaceExisting: true
    })

    const backupName = readdirSync(targetData).find((name) => name.startsWith('旧数据备份_'))
    expect(backupName).toBeTruthy()
    const backupDirectory = join(targetData, backupName!)
    expect(readFileSync(join(targetData, 'vault.enc'), 'utf8')).toBe('current-vault')
    expect(readFileSync(join(targetData, 'logs', 'app.jsonl'), 'utf8')).toBe('current-log')
    expect(readFileSync(join(backupDirectory, 'vault.enc'), 'utf8')).toBe('old-vault')
    expect(readFileSync(join(backupDirectory, 'backups', 'old.enc'), 'utf8')).toBe('old-backup')
    expect(readFileSync(join(backupDirectory, 'notes.txt'), 'utf8')).toBe('keep-this-too')
    expect(existsSync(join(currentData, 'vault.enc'))).toBe(false)
    expect(readDataDirectory(stablePointerDirectory)).toBe(targetData)
  })

  it('detects installation and nested paths', () => {
    expect(pathIsInside('C:\\Apps\\AutoLogin', 'C:\\Apps\\AutoLogin\\data')).toBe(true)
    expect(pathIsInside('C:\\Apps\\AutoLogin', 'C:\\Apps\\AutoLogin')).toBe(true)
    expect(pathIsInside('C:\\Apps\\AutoLogin', 'C:\\Users\\Data\\AutoLogin')).toBe(false)
  })
})
