import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
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

  it('detects installation and nested paths', () => {
    expect(pathIsInside('C:\\Apps\\AutoLogin', 'C:\\Apps\\AutoLogin\\data')).toBe(true)
    expect(pathIsInside('C:\\Apps\\AutoLogin', 'C:\\Apps\\AutoLogin')).toBe(true)
    expect(pathIsInside('C:\\Apps\\AutoLogin', 'C:\\Users\\Data\\AutoLogin')).toBe(false)
  })
})
