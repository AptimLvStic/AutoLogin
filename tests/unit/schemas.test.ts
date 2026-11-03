import { describe, expect, it } from 'vitest'
import {
  accountCreateInputSchema,
  appSettingsPatchSchema,
  appSettingsSchema,
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
        testUrl: 'https://api.github.com/zen'
      }
    })
  })

  it('accepts partial settings updates and rejects invalid scale values', () => {
    expect(appSettingsPatchSchema.safeParse({ interfaceScale: 115 }).success).toBe(true)
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

})
