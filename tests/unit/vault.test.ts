import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { VaultManager, VaultError } from '../../src/main/vault'

const directories: string[] = []

function createManager(): { manager: VaultManager; directory: string; onLocked: ReturnType<typeof vi.fn> } {
  const directory = mkdtempSync(join(tmpdir(), 'autologin-vault-'))
  directories.push(directory)
  const onLocked = vi.fn()
  return { manager: new VaultManager(directory, onLocked), directory, onLocked }
}

function addDemoAccount(manager: VaultManager): void {
  const data = manager.requireData()
  const now = new Date().toISOString()
  data.sites.push({
    id: 'site-1',
    name: 'Fixture',
    startUrl: 'https://example.test/login',
    allowedOrigins: ['https://example.test'],
    autoSubmit: true,
    createdAt: now,
    updatedAt: now
  })
  data.accounts.push({
    id: 'account-1',
    siteId: 'site-1',
    label: 'Main',
    username: 'tester@example.test',
    password: 'never-write-this-in-plaintext',
    favorite: true,
    createdAt: now,
    updatedAt: now
  })
  manager.save()
}

afterEach(() => {
  while (directories.length > 0) {
    rmSync(directories.pop()!, { recursive: true, force: true })
  }
})

describe('VaultManager', () => {
  it('creates, encrypts, locks and unlocks a vault', async () => {
    const { manager, onLocked } = createManager()
    await manager.create('correct horse battery staple')
    addDemoAccount(manager)
    manager.save()

    const raw = readFileSync(manager.path, 'utf8')
    expect(raw).not.toContain('never-write-this-in-plaintext')
    expect(raw).not.toContain('tester@example.test')

    manager.lock()
    expect(onLocked).toHaveBeenCalledOnce()
    expect(manager.status().unlocked).toBe(false)

    await manager.unlock('correct horse battery staple')
    expect(manager.requireData().accounts[0]?.password).toBe('never-write-this-in-plaintext')
  })

  it('rejects a wrong master password', async () => {
    const { manager } = createManager()
    await manager.create('correct horse battery staple')
    manager.lock()

    await expect(manager.unlock('not the right password')).rejects.toMatchObject({
      code: 'WRONG_PASSWORD'
    })
  })

  it('recovers from the encrypted backup when the primary file is damaged', async () => {
    const { manager } = createManager()
    await manager.create('correct horse battery staple')
    addDemoAccount(manager)
    addDemoAccount(manager)
    manager.save()
    manager.lock()

    writeFileSync(manager.path, '{damaged', 'utf8')
    await manager.unlock('correct horse battery staple')
    expect(manager.requireData().accounts).toHaveLength(2)
  })

  it('rejects unlock when both the primary vault and backup are tampered with', async () => {
    const { manager } = createManager()
    await manager.create('correct horse battery staple')
    addDemoAccount(manager)
    manager.save()
    manager.lock()

    writeFileSync(manager.path, '{tampered-primary', 'utf8')
    writeFileSync(manager.backup, '{tampered-backup', 'utf8')

    await expect(manager.unlock('correct horse battery staple')).rejects.toMatchObject({
      code: 'CORRUPTED'
    })
    expect(manager.status().unlocked).toBe(false)
  })

  it('persists the auto-lock setting across lock and unlock', async () => {
    const { manager } = createManager()
    await manager.create('correct horse battery staple')
    manager.updateSettings({ autoLockMinutes: 15 })
    manager.lock()

    const status = await manager.unlock('correct horse battery staple')
    expect(status.autoLockMinutes).toBe(15)
    expect(manager.getSettings()).toEqual(
      expect.objectContaining({
        autoLockMinutes: 15,
        colorMode: 'light',
        language: 'zh-CN',
        themePreset: 'warm',
        interfaceScale: 100
      })
    )
  })

  it('merges theme and scale updates without overwriting unrelated settings', async () => {
    const { manager } = createManager()
    await manager.create('correct horse battery staple')

    manager.updateSettings({ autoLockMinutes: 30 })
    manager.updateSettings({ themePreset: 'custom', interfaceScale: 115 })
    manager.updateSettings({
      customTheme: {
        background: '#EEF2F3',
        surface: '#F8FAFA',
        text: '#17262B',
        accent: '#176B7A'
      }
    })
    manager.lock()

    await manager.unlock('correct horse battery staple')
    expect(manager.getSettings()).toEqual({
      autoLockMinutes: 30,
      colorMode: 'light',
      language: 'zh-CN',
      themePreset: 'custom',
      interfaceScale: 115,
      customTheme: {
        background: '#EEF2F3',
        surface: '#F8FAFA',
        text: '#17262B',
        accent: '#176B7A'
      },
      proxy: {
        enabled: false,
        protocol: 'http',
        host: '',
        port: 8080,
        bypassList: 'localhost, 127.0.0.1, ::1'
      }
    })
  })

  it('re-encrypts with a new master password', async () => {
    const { manager } = createManager()
    await manager.create('correct horse battery staple')
    await manager.changePassword(
      'correct horse battery staple',
      'a different long master password'
    )
    manager.lock()

    await expect(manager.unlock('correct horse battery staple')).rejects.toBeInstanceOf(VaultError)
    await manager.unlock('a different long master password')
    expect(manager.status().unlocked).toBe(true)
  })
})
