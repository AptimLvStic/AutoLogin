import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { prepareUserBrowserProfile } from '../../src/main/browser-profile'

const directories: string[] = []

afterEach(() => {
  while (directories.length > 0) {
    rmSync(directories.pop()!, { recursive: true, force: true })
  }
})

describe('browser profile preparation', () => {
  it('seeds a CDP-safe profile from the selected local Chrome profile', async () => {
    const root = mkdtempSync(join(tmpdir(), 'autologin-browser-profile-'))
    directories.push(root)
    const localAppData = join(root, 'LocalAppData')
    const source = join(localAppData, 'Google', 'Chrome', 'User Data')
    const sourceProfile = join(source, 'Profile 2')
    const destination = join(root, 'managed-profile')
    mkdirSync(join(sourceProfile, 'Network'), { recursive: true })
    writeFileSync(
      join(source, 'Local State'),
      JSON.stringify({
        profile: {
          last_used: 'Profile 2',
          last_active_profiles: ['Profile 2'],
          info_cache: { 'Profile 2': { name: 'Work' } }
        }
      }),
      'utf8'
    )
    writeFileSync(join(sourceProfile, 'Network', 'Cookies'), 'cookie-db', 'utf8')
    writeFileSync(join(sourceProfile, 'Preferences'), '{"profile":{}}', 'utf8')

    const result = await prepareUserBrowserProfile(
      {
        name: 'Google Chrome',
        executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
        progId: 'ChromeHTML'
      },
      destination,
      localAppData
    )

    expect(result).toEqual({ profileDirectory: destination, imported: true })
    expect(readFileSync(join(destination, 'Default', 'Network', 'Cookies'), 'utf8')).toBe(
      'cookie-db'
    )
    expect(
      JSON.parse(readFileSync(join(destination, 'Local State'), 'utf8')).profile.last_used
    ).toBe('Default')
    expect(
      JSON.parse(readFileSync(join(destination, '.autologin-profile.json'), 'utf8'))
    ).toMatchObject({ version: 1, sourceProfile: 'Profile 2' })

    const second = await prepareUserBrowserProfile(
      {
        name: 'Google Chrome',
        executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
        progId: 'ChromeHTML'
      },
      destination,
      localAppData
    )
    expect(second.imported).toBe(false)
  })
})
