import { describe, expect, it } from 'vitest'
import {
  accountCreateInputSchema,
  appSettingsPatchSchema,
  appSettingsSchema,
  masterPasswordSchema,
  siteInputSchema
} from '../../src/shared/schemas'

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
      themePreset: 'warm',
      customTheme: {
        background: '#F4F1EA',
        surface: '#FBF9F4',
        text: '#1C2521',
        accent: '#0E7567'
      },
      interfaceScale: 100
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
    expect(appSettingsPatchSchema.safeParse({}).success).toBe(false)
  })

})
