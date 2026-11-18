import { describe, expect, it } from 'vitest'
import {
  accountBatchIconInputSchema,
  accountBatchStrategyInputSchema,
  accountDeleteManyInputSchema,
  accountDuplicateInputSchema,
  accountIdsSchema,
  accountCreateInputSchema,
  appSettingsPatchSchema,
  appSettingsSchema,
  groupCreateInputSchema,
  groupDeleteInputSchema,
  groupMoveInputSchema,
  groupRenameInputSchema,
  masterPasswordSchema,
  recipeStepSchema,
  siteInputSchema,
  siteSchema,
  storedAccountSchema
} from '../../src/shared/schemas'
import {
  DEFAULT_PROXY_SETTINGS,
  interfaceScaleToZoom
} from '../../src/shared/theme'

describe('shared input schemas', () => {
  it('maps the default 110 scale setting to the 90% visual baseline', () => {
    expect(interfaceScaleToZoom(110)).toBeCloseTo(0.9)
    expect(interfaceScaleToZoom(115)).toBeCloseTo(0.95)
    expect(interfaceScaleToZoom(125)).toBeCloseTo(1.05)
  })

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

  it('keeps paste and certificate steps credential-free', () => {
    const paste = recipeStepSchema.parse({
      id: 'paste-1',
      type: 'paste',
      selector: { candidates: ['#password'] },
      source: 'password',
      value: 'must-not-be-stored'
    })
    expect(paste).toEqual({
      id: 'paste-1',
      type: 'paste',
      selector: { candidates: ['#password'] },
      source: 'password'
    })
    expect(
      recipeStepSchema.safeParse({
        id: 'cert-1',
        type: 'acceptCertWarning',
        optional: true
      }).success
    ).toBe(true)
    expect(
      recipeStepSchema.safeParse({
        id: 'cert-2',
        type: 'acceptCertWarning',
        optional: false
      }).success
    ).toBe(false)
  })

  it('requires a meaningful master password and delegates credential checks to the target tab', () => {
    expect(masterPasswordSchema.safeParse('short').success).toBe(false)
    expect(masterPasswordSchema.safeParse('long enough password').success).toBe(true)
    expect(
      accountCreateInputSchema.safeParse({
        siteId: 'site-1',
        label: 'Main',
        username: 'user',
        password: ''
      }).success
    ).toBe(true)
    expect(
      accountCreateInputSchema.safeParse({
        siteId: 'site-1',
        label: 'Main',
        username: '',
        password: ''
      }).success
    ).toBe(true)
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
      interfaceScale: 110,
      fontSizeScale: 100,
      accountCopyShortcutEnabled: false,
      accountCopyShortcut: 'Ctrl+C',
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
      defaultLoginBrowser: 'builtin',
      pureBrowserMode: true,
      groupOrder: [],
      groupOrders: {}
    })
  })

  it('accepts review placeholders without weakening site input validation', () => {
    const now = new Date().toISOString()
    expect(
      siteSchema.safeParse({
        id: 'site-review',
        tabId: 'local',
        name: 'Office 2021',
        startUrl: '',
        allowedOrigins: [],
        autoSubmit: true,
        needsReview: true,
        createdAt: now,
        updatedAt: now
      }).success
    ).toBe(true)
    expect(
      siteInputSchema.safeParse({
        name: 'Office 2021',
        startUrl: '',
        autoSubmit: true
      }).success
    ).toBe(false)
  })

  it('accepts partial settings updates and rejects invalid scale values', () => {
    expect(appSettingsPatchSchema.safeParse({ interfaceScale: 115 }).success).toBe(true)
    expect(appSettingsPatchSchema.safeParse({ colorMode: 'system' }).success).toBe(true)
    for (const fontSizeScale of [80, 100, 125, 150]) {
      expect(appSettingsPatchSchema.safeParse({ fontSizeScale }).success).toBe(true)
    }
    expect(appSettingsPatchSchema.safeParse({ trashRetentionDays: 15 }).success).toBe(true)
    expect(
      appSettingsPatchSchema.safeParse({ defaultLoginBrowser: 'builtin' }).success
    ).toBe(true)
    expect(
      appSettingsPatchSchema.safeParse({ pureBrowserMode: false }).success
    ).toBe(true)
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
    expect(appSettingsPatchSchema.safeParse({ fontSizeScale: 110 }).success).toBe(false)
    expect(appSettingsPatchSchema.safeParse({ fontSizeScale: 101 }).success).toBe(false)
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
    expect(
      storedAccountSchema.safeParse({
        ...base,
        credentialUpdatedAt: now,
        credentialHistory: [
          {
            id: 'credential-1',
            username: 'previous-user',
            password: 'secret-password',
            validFrom: now,
            validUntil: now
          }
        ]
      }).success
    ).toBe(true)
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
      groupMoveInputSchema.safeParse({
        fromPath: 'Work / Clients',
        parentPath: 'Archive'
      }).success
    ).toBe(true)
    expect(
      groupMoveInputSchema.safeParse({ fromPath: 'Work / Clients', parentPath: '' }).success
    ).toBe(false)
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
    expect(
      accountBatchIconInputSchema.safeParse({
        accountIds: ['account-1', 'account-2'],
        icon: 'data:image/png;base64,iVBORw0KGgo='
      }).success
    ).toBe(true)
    expect(
      accountBatchIconInputSchema.safeParse({
        accountIds: ['account-1'],
        icon: 'file:///tmp/logo.png'
      }).success
    ).toBe(false)
    expect(accountDuplicateInputSchema.safeParse(['account-1', 'account-2']).success).toBe(true)
    expect(accountDuplicateInputSchema.safeParse([]).success).toBe(false)
    expect(accountDeleteManyInputSchema.safeParse(['account-1', 'account-2']).success).toBe(true)
    expect(accountDeleteManyInputSchema.safeParse([]).success).toBe(false)
    expect(
      accountIdsSchema.safeParse(
        Array.from({ length: 200 }, (_, index) => `account-${index + 1}`)
      ).success
    ).toBe(true)
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

  it('accepts imported group paths up to 120 characters', () => {
    const path = '云'.repeat(120)
    expect(appSettingsPatchSchema.safeParse({ groupOrder: [path] }).success).toBe(true)
    expect(groupMoveInputSchema.safeParse({ fromPath: path }).success).toBe(true)
    expect(
      appSettingsPatchSchema.safeParse({ groupOrder: ['云'.repeat(121)] }).success
    ).toBe(false)
  })

})
