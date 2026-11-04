import { describe, expect, it } from 'vitest'
import {
  accountBatchStrategyInputSchema,
  accountDeleteManyInputSchema,
  accountDuplicateInputSchema,
  accountCreateInputSchema,
  appSettingsPatchSchema,
  appSettingsSchema,
  groupCreateInputSchema,
  groupDeleteInputSchema,
  groupRenameInputSchema,
  masterPasswordSchema,
  siteInputSchema,
  storedAccountSchema
} from '../../src/shared/schemas'
import { DEFAULT_PROXY_SETTINGS } from '../../src/shared/theme'

describe('shared input schemas', () => {
  it('accepts only http and https site URLs', () => {
    expect(
      siteInputSchema.safeParse({
        name: 'Safe site',
        startUrl: 'https://example.com/login',
        autoSubmit: true
      }).success
    ).toBe(true)
    expect(
      siteInputSchema.safeParse({
        name: 'Unsafe site',
        startUrl: 'javascript:alert(1)',
        autoSubmit: true
      }).success
    ).toBe(false)
  })

  it('requires a meaningful master password and account password', () => {
    expect(masterPasswordSchema.safeParse('short').success).toBe(false)
    expect(masterPasswordSchema.safeParse('long enough password').success).toBe(true)
    expect(
      accountCreateInputSchema.safeParse({
        siteId: 'site-1',
        label: 'Main',
        username: 'user',
        password: ''
      }).success
    ).toBe(false)
  })

  it('fills new appearance defaults when unlocking a v0.2.1 settings object', () => {
    const parsed = appSettingsSchema.parse({ autoLockMinutes: 15 })
    expect(parsed).toEqual({
      autoLockMinutes: 15,
      trashRetentionDays: 7,
      colorMode: 'light',
      language: 'zh-CN',
      themePreset: 'magpie',
      customTheme: {
        background: '#F7F8FA',
        surface: '#FFFFFF',
        text: '#1F2328',
        accent: '#5C6BFF'
      },
      interfaceScale: 100,
      proxy: {
        mode: 'custom',
        enabled: false,
        protocol: 'http',
        host: '',
        port: 8080,
        bypassList: 'localhost, 127.0.0.1, ::1',
        testUrl: 'https://www.google.com/'
      },
      groupOrder: []
    })
  })

  it('accepts partial settings updates and rejects invalid scale values', () => {
    expect(appSettingsPatchSchema.safeParse({ interfaceScale: 115 }).success).toBe(true)
    expect(appSettingsPatchSchema.safeParse({ trashRetentionDays: 15 }).success).toBe(true)
    expect(appSettingsPatchSchema.safeParse({ trashRetentionDays: 14 }).success).toBe(false)
    expect(
      appSettingsPatchSchema.safeParse({
        themePreset: 'custom',
        customTheme: {
          background: '#EEF1E9',
          surface: '#F8FAF4',
          text: '#1E2921',
          accent: '#4E735A'
        }
      }).success
    ).toBe(true)
    expect(appSettingsPatchSchema.safeParse({ interfaceScale: 111 }).success).toBe(false)
    expect(
      appSettingsPatchSchema.safeParse({
        proxy: { ...DEFAULT_PROXY_SETTINGS, testUrl: 'file:///tmp/proxy-test' }
      }).success
    ).toBe(false)
    expect(appSettingsPatchSchema.safeParse({}).success).toBe(false)
  })

  it('limits each account to three recorded flows', () => {
    const now = new Date().toISOString()
    const recipe = {
      version: 1 as const,
      startUrl: 'https://example.com/login',
      allowedOrigins: ['https://example.com'],
      steps: [],
      createdAt: now,
      updatedAt: now
    }
    const base = {
      id: 'account-1',
      siteId: 'site-1',
      label: 'Example',
      username: 'user',
      password: 'secret',
      favorite: false,
      createdAt: now,
      updatedAt: now
    }
    const flows = Array.from({ length: 4 }, (_, index) => ({
      id: `recipe-${index}`,
      name: `Flow ${index}`,
      recipe
    }))
    expect(storedAccountSchema.safeParse({ ...base, recipes: flows.slice(0, 3) }).success).toBe(true)
    expect(storedAccountSchema.safeParse({ ...base, recipes: flows }).success).toBe(false)
  })

  it('validates group actions and account batch inputs', () => {
    expect(
      groupCreateInputSchema.safeParse({ name: 'Work', parentPath: 'Personal' }).success
    ).toBe(true)
    expect(groupCreateInputSchema.safeParse({ name: 'Work / 2026' }).success).toBe(false)
    expect(groupCreateInputSchema.safeParse({ name: '' }).success).toBe(false)
    expect(groupCreateInputSchema.safeParse({ name: 'x'.repeat(21) }).success).toBe(false)
    expect(
      groupRenameInputSchema.safeParse({ fromName: 'Work', toName: 'Clients' }).success
    ).toBe(true)
    expect(
      groupRenameInputSchema.safeParse({ fromName: 'Work', toName: '' }).success
    ).toBe(false)
    expect(groupDeleteInputSchema.safeParse({ groupName: 'Work' }).success).toBe(true)
    expect(
      accountBatchStrategyInputSchema.safeParse({
        accountIds: ['account-1', 'account-2'],
        loginStrategy: 'manual',
        manualSelectors: {
          username: '#username',
          password: '#password'
        }
      }).success
    ).toBe(true)
    expect(
      accountBatchStrategyInputSchema.safeParse({
        accountIds: ['account-1', 'account-1'],
        loginStrategy: 'auto'
      }).success
    ).toBe(false)
    expect(accountDuplicateInputSchema.safeParse(['account-1', 'account-2']).success).toBe(true)
    expect(accountDuplicateInputSchema.safeParse([]).success).toBe(false)
    expect(accountDeleteManyInputSchema.safeParse(['account-1', 'account-2']).success).toBe(true)
    expect(accountDeleteManyInputSchema.safeParse([]).success).toBe(false)
  })

  it('accepts a persisted custom account group order', () => {
    expect(
      appSettingsPatchSchema.safeParse({
        groupOrder: ['Work', 'Work / Clients', 'Work / Clients / 2026']
      }).success
    ).toBe(true)
    expect(
      appSettingsPatchSchema.safeParse({ groupOrder: ['Work', 'Work'] }).success
    ).toBe(false)
  })

})
