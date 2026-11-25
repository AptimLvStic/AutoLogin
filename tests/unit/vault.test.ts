import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { VaultManager, VaultError, encryptBufferWithPassword } from '../../src/main/vault'
import type { VaultData } from '@shared/types'

const directories: string[] = []
const DATABASE_PASSWORD = 'correct horse battery staple'

function createManager(): {
  manager: VaultManager
  directory: string
  onLocked: ReturnType<typeof vi.fn>
} {
  const directory = mkdtempSync(join(tmpdir(), 'autologin-vault-'))
  directories.push(directory)
  const onLocked = vi.fn()
  return { manager: new VaultManager(directory, onLocked), directory, onLocked }
}

const DEMO_TAB = {
  id: 'local',
  name: '本地数据库',
  color: '#5C6BFF',
  source: 'local' as const,
  hidden: false,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z'
}

function addDemoAccount(manager: VaultManager): void {
  const data = manager.requireData()
  if (!data.tabs.some((tab) => tab.id === 'local')) {
    data.tabs.push({ ...DEMO_TAB })
  }
  data.sites.push({
    id: 'site-1',
    tabId: 'local',
    name: 'Fixture',
    startUrl: 'https://example.test/login',
    allowedOrigins: ['https://example.test'],
    autoSubmit: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z'
  })
  data.accounts.push({
    id: 'account-1',
    tabId: 'local',
    siteId: 'site-1',
    label: 'Main',
    username: 'tester@example.test',
    password: 'never-write-this-in-plaintext',
    favorite: true,
    loginStrategy: 'auto',
    loginBrowser: 'standalone',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z'
  })
  manager.save()
}

async function openDemoTab(manager: VaultManager): Promise<void> {
  const data = manager.requireData()
  if (!data.tabs.some((tab) => tab.id === 'local')) {
    data.tabs.push({ ...DEMO_TAB })
    manager.save()
  }
  await manager.unlockTab('local', DATABASE_PASSWORD)
}

afterEach(() => {
  while (directories.length > 0) {
    rmSync(directories.pop()!, { recursive: true, force: true })
  }
})

describe('VaultManager', () => {
  it('creates a plaintext shell but keeps every database encrypted', async () => {
    const { manager } = createManager()
    await manager.create()
    expect(manager.requireData().tabs).toEqual([])
    await openDemoTab(manager)
    addDemoAccount(manager)
    manager.save()

    const raw = readFileSync(manager.path, 'utf8')
    expect(raw).not.toContain('never-write-this-in-plaintext')
    expect(raw).not.toContain('tester@example.test')
    expect(raw).toContain('"tabBlobs"')

    manager.lock()
    expect(manager.status().unlocked).toBe(false)
    expect(manager.requireData().accounts).toEqual([])
    expect(manager.status().tabs).toEqual([{ id: 'local', locked: true }])

    await manager.unlockTab('local', DATABASE_PASSWORD)
    expect(manager.requireData().accounts[0]?.password).toBe(
      'never-write-this-in-plaintext'
    )
    expect(manager.status().tabs).toEqual([{ id: 'local', locked: false }])
  })

  it('rejects a wrong database password', async () => {
    const { manager } = createManager()
    await manager.create()
    await openDemoTab(manager)
    manager.lock()

    await expect(manager.unlockTab('local', 'not the right password')).rejects.toMatchObject({
      code: 'WRONG_PASSWORD'
    })
    expect(manager.status().tabs[0]?.locked).toBe(true)
  })

  it('saves interactively through asynchronous file I/O', async () => {
    const { manager } = createManager()
    await manager.create()
    await openDemoTab(manager)
    addDemoAccount(manager)
    manager.requireData().accounts[0]!.label = '异步保存'

    await manager.saveAsync()
    manager.lock()
    await manager.unlockTab('local', DATABASE_PASSWORD)

    expect(manager.requireData().accounts[0]?.label).toBe('异步保存')
  })

  it('persists the auto-lock setting across lock and unlock', async () => {
    const { manager } = createManager()
    await manager.create()
    manager.updateSettings({ autoLockMinutes: 15 })
    manager.lock()

    expect(manager.status().autoLockMinutes).toBe(15)
    expect(manager.getSettings()).toEqual(
      expect.objectContaining({
        autoLockMinutes: 15,
        colorMode: 'light',
        language: 'zh-CN',
        themePreset: 'magpie',
        interfaceScale: 110
      })
    )
  })

  it('keeps the tab list after lock', async () => {
    const { manager } = createManager()
    await manager.create()
    await openDemoTab(manager)
    manager.lock()

    expect(manager.requireData().tabs).toEqual([
      expect.objectContaining({ id: 'local', name: '本地数据库', source: 'local' })
    ])
    expect(manager.status().tabs).toEqual([{ id: 'local', locked: true }])
  })

  it('migrates a legacy single-password vault into per-database blobs', async () => {
    const { manager, directory } = createManager()
    const now = '2026-01-01T00:00:00.000Z'
    const legacy: VaultData = {
      schemaVersion: 1,
      tabs: [
        {
          id: 'local',
          name: '本地数据库',
          color: '#5C6BFF',
          source: 'local',
          hidden: false,
          createdAt: now,
          updatedAt: now
        }
      ],
      sites: [
        {
          id: 'site-1',
          tabId: 'local',
          name: 'Fixture',
          startUrl: 'https://example.test/login',
          allowedOrigins: ['https://example.test'],
          autoSubmit: true,
          createdAt: now,
          updatedAt: now
        }
      ],
      accounts: [
        {
          id: 'account-1',
          tabId: 'local',
          siteId: 'site-1',
          label: 'Main',
          username: 'tester@example.test',
          password: 'legacy-secret',
          favorite: false,
          loginStrategy: 'auto',
          loginBrowser: 'standalone',
          createdAt: now,
          updatedAt: now
        }
      ],
      groupDefinitions: [],
      deletedAccounts: [],
      favoriteGroups: [],
      settings: manager.getSettings()
    }
    writeFileSync(
      join(directory, 'vault.enc'),
      await encryptBufferWithPassword(
        Buffer.from(JSON.stringify(legacy), 'utf8'),
        'old master password',
        'autologin-vault'
      ),
      'utf8'
    )

    const fresh = new VaultManager(directory, () => undefined)
    expect(fresh.status().legacyPasswordRequired).toBe(true)
    await expect(fresh.unlock('wrong password')).rejects.toBeInstanceOf(VaultError)

    await fresh.unlock('old master password')
    expect(fresh.status().legacyPasswordRequired).toBe(false)
    expect(fresh.status().tabs).toEqual([{ id: 'local', locked: false }])
    expect(fresh.requireData().accounts[0]?.password).toBe('legacy-secret')
    expect(existsSync(join(directory, 'vault.json'))).toBe(true)
    expect(readFileSync(join(directory, 'vault.json'), 'utf8')).not.toContain('legacy-secret')

    fresh.lock()
    await fresh.unlockTab('local', 'old master password')
    expect(fresh.requireData().accounts[0]?.password).toBe('legacy-secret')
  })

  it('merges theme and scale updates without overwriting unrelated settings', async () => {
    const { manager } = createManager()
    await manager.create()

    manager.updateSettings({ autoLockMinutes: 30, trashRetentionDays: 30 })
    manager.updateSettings({
      themePreset: 'custom',
      interfaceScale: 115,
      fontSizeScale: 125
    })
    manager.updateSettings({
      customTheme: {
        background: '#EEF2F3',
        surface: '#F8FAFA',
        text: '#17262B',
        accent: '#176B7A'
      }
    })

    expect(manager.getSettings()).toEqual({
      autoLockMinutes: 30,
      trashRetentionDays: 30,
      colorMode: 'light',
      language: 'zh-CN',
      themePreset: 'custom',
      interfaceScale: 115,
      fontSizeScale: 125,
      accountCopyShortcutEnabled: false,
      accountCopyShortcut: 'Ctrl+C',
      defaultLoginBrowser: 'builtin',
      pureBrowserMode: true,
      customTheme: {
        background: '#EEF2F3',
        surface: '#F8FAFA',
        text: '#17262B',
        accent: '#176B7A'
      },
      proxy: {
        mode: 'custom',
        enabled: true,
        protocol: 'http',
        host: '',
        port: 8080,
        bypassList: 'localhost, 127.0.0.1, ::1',
        testUrl: 'https://www.google.com/'
      },
      recordingDraftDirectory: '',
      groupOrder: [],
      groupOrders: {}
    })
  })

  it('re-encrypts a database with a new password', async () => {
    const { manager } = createManager()
    await manager.create()
    await openDemoTab(manager)
    await manager.changeTabPassword(
      'local',
      DATABASE_PASSWORD,
      'a different long database password'
    )
    manager.lock()

    await expect(manager.unlockTab('local', DATABASE_PASSWORD)).rejects.toBeInstanceOf(
      VaultError
    )
    await manager.unlockTab('local', 'a different long database password')
    expect(manager.status().tabs[0]?.locked).toBe(false)
  })

  it('exports and restores the encrypted shell without exposing plaintext', async () => {
    const { manager, directory } = createManager()
    await manager.create()
    await openDemoTab(manager)
    addDemoAccount(manager)
    const exported = join(directory, 'export.json')
    manager.copyEncryptedTo(exported)

    const exportedRaw = readFileSync(exported, 'utf8')
    expect(exportedRaw).toContain('"tabBlobs"')
    expect(exportedRaw).not.toContain('never-write-this-in-plaintext')

    manager.requireData().accounts[0]!.username = 'changed@example.test'
    manager.save()
    manager.restoreEncryptedFrom(exported)
    expect(manager.status().unlocked).toBe(false)

    await manager.unlockTab('local', DATABASE_PASSWORD)
    expect(manager.requireData().accounts[0]?.username).toBe('tester@example.test')
  })

  it('writes per-database snapshot files with the database key', async () => {
    const { manager, directory } = createManager()
    await manager.create()
    await openDemoTab(manager)
    addDemoAccount(manager)
    const snapshotPath = join(directory, 'tabs', 'local.autologin')
    manager.writeTabSnapshot(snapshotPath, 'local', manager.requireData())
    const raw = readFileSync(snapshotPath, 'utf8')
    expect(raw).not.toContain('never-write-this-in-plaintext')

    manager.lock()
    expect(() =>
      manager.writeTabSnapshot(snapshotPath, 'local', manager.requireData())
    ).toThrowError(VaultError)
  })
})
