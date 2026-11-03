import { z } from 'zod'
import {
  APP_LANGUAGES,
  AUTO_LOCK_OPTIONS,
  COLOR_MODES,
  DEFAULT_PROXY_TEST_URL,
  INTERFACE_SCALE_MAX,
  INTERFACE_SCALE_MIN,
  LOGIN_STRATEGIES,
  PROXY_MODES,
  PROXY_PROTOCOLS,
  THEME_PRESETS
} from './types'

const httpUrl = z
  .string()
  .trim()
  .min(1)
  .refine((value) => {
    try {
      const url = new URL(value)
      return url.protocol === 'http:' || url.protocol === 'https:'
    } catch {
      return false
    }
  }, '请输入有效的 http 或 https 地址')

const originSchema = z
  .string()
  .trim()
  .min(1)
  .refine((value) => {
    try {
      const url = new URL(value)
      return (url.protocol === 'http:' || url.protocol === 'https:') && url.origin === value
    } catch {
      return false
    }
  }, '来源地址无效')

const idSchema = z.string().regex(/^[a-zA-Z0-9_-]{1,128}$/, '标识格式无效')

const groupNameSchema = z.string().trim().min(1).max(40)

export const selectorSpecSchema = z.object({
  candidates: z.array(z.string().min(1)).min(1).max(8),
  text: z.string().max(120).optional()
})

export const recipeStepSchema = z.discriminatedUnion('type', [
  z.object({
    id: z.string().min(1),
    type: z.enum(['fillUsername', 'fillPassword']),
    selector: selectorSpecSchema
  }),
  z.object({
    id: z.string().min(1),
    type: z.literal('click'),
    selector: selectorSpecSchema,
    navigationExpected: z.boolean().optional()
  }),
  z.object({
    id: z.string().min(1),
    type: z.literal('press'),
    selector: selectorSpecSchema,
    key: z.string().min(1).max(30)
  }),
  z.object({
    id: z.string().min(1),
    type: z.literal('focusChallenge'),
    selector: selectorSpecSchema.optional()
  })
])

export const loginRecipeSchema = z.object({
  version: z.literal(1),
  startUrl: httpUrl,
  allowedOrigins: z.array(originSchema).min(1),
  steps: z.array(recipeStepSchema).max(30),
  successCheck: z
    .object({
      urlPrefix: httpUrl.optional(),
      selector: selectorSpecSchema.optional()
    })
    .optional(),
  manualChallenge: z.boolean().optional(),
  createdAt: z.string(),
  updatedAt: z.string()
})

export const siteSchema = z.object({
  id: idSchema,
  name: z.string().min(1).max(80),
  startUrl: httpUrl,
  allowedOrigins: z.array(originSchema).min(1),
  autoSubmit: z.boolean(),
  group: z.string().trim().max(40).optional(),
  recipe: loginRecipeSchema.optional(),
  createdAt: z.string(),
  updatedAt: z.string()
})

export const accountRecipeSchema = z.object({
  id: idSchema,
  name: z.string().trim().min(1).max(60),
  recipe: loginRecipeSchema
})

const selectorInputSchema = z
  .string()
  .trim()
  .min(1, '请输入 CSS Selector')
  .max(500, 'CSS Selector 不能超过 500 个字符')
  .refine((value) => !/[\u0000-\u001f\u007f]/.test(value), 'CSS Selector 包含无效字符')

export const manualLoginSelectorsSchema = z
  .object({
    username: selectorInputSchema.optional(),
    password: selectorInputSchema.optional(),
    submit: selectorInputSchema.optional()
  })
  .strict()

export const storedAccountSchema = z.object({
  id: idSchema,
  siteId: idSchema,
  label: z.string().min(1).max(80),
  username: z.string().max(320),
  password: z.string().max(2048),
  favorite: z.boolean(),
  loginStrategy: z.enum(LOGIN_STRATEGIES).default('auto'),
  manualSelectors: manualLoginSelectorsSchema.optional(),
  recipes: z.array(accountRecipeSchema).max(3).default([]),
  activeRecipeId: idSchema.optional(),
  lastUsedAt: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string()
})

const hexColorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/, '颜色必须是六位十六进制值')

export const themeColorsSchema = z.object({
  background: hexColorSchema,
  surface: hexColorSchema,
  text: hexColorSchema,
  accent: hexColorSchema
})

const autoLockMinutesSchema = z.union([
  z.literal(AUTO_LOCK_OPTIONS[0]),
  z.literal(AUTO_LOCK_OPTIONS[1]),
  z.literal(AUTO_LOCK_OPTIONS[2]),
  z.literal(AUTO_LOCK_OPTIONS[3])
])

const themePresetSchema = z.enum([...THEME_PRESETS, 'custom'])
const colorModeSchema = z.enum(COLOR_MODES)
const languageSchema = z.enum(APP_LANGUAGES)

const interfaceScaleSchema = z
  .number()
  .int()
  .min(INTERFACE_SCALE_MIN)
  .max(INTERFACE_SCALE_MAX)
  .multipleOf(5)

export const proxySettingsSchema = z
  .object({
    mode: z.enum(PROXY_MODES).default('custom'),
    enabled: z.boolean(),
    protocol: z.enum(PROXY_PROTOCOLS),
    host: z.string().trim().max(255),
    port: z.number().int().min(1).max(65535),
    bypassList: z.string().trim().max(1000),
    testUrl: z
      .string()
      .trim()
      .max(2048)
      .default(DEFAULT_PROXY_TEST_URL)
      .refine((value) => {
        try {
          const url = new URL(value)
          return url.protocol === 'http:' || url.protocol === 'https:'
        } catch {
          return false
        }
      }, '测试 URL 必须是有效的 http/https 地址')
  })
  .superRefine((value, context) => {
    if (value.mode === 'custom' && value.enabled && !value.host) {
      context.addIssue({ code: 'custom', path: ['host'], message: '请输入代理服务器地址' })
    }
  })

const defaultProxySettings = {
  mode: 'custom' as const,
  enabled: false,
  protocol: 'http' as const,
  host: '',
  port: 8080,
  bypassList: 'localhost, 127.0.0.1, ::1',
  testUrl: DEFAULT_PROXY_TEST_URL
}

const defaultThemeColors = {
  background: '#F7F8FA',
  surface: '#FFFFFF',
  text: '#1F2328',
  accent: '#5C6BFF'
}

export const appSettingsSchema = z.object({
  autoLockMinutes: autoLockMinutesSchema.default(10),
  colorMode: colorModeSchema.default('light'),
  language: languageSchema.default('zh-CN'),
  themePreset: themePresetSchema.default('magpie'),
  customTheme: themeColorsSchema.default(defaultThemeColors),
  interfaceScale: interfaceScaleSchema.default(100),
  proxy: proxySettingsSchema.default(defaultProxySettings)
})

export const appSettingsPatchSchema = z
  .object({
    autoLockMinutes: autoLockMinutesSchema.optional(),
    colorMode: colorModeSchema.optional(),
    language: languageSchema.optional(),
    themePreset: themePresetSchema.optional(),
    customTheme: themeColorsSchema.optional(),
    interfaceScale: interfaceScaleSchema.optional(),
    proxy: proxySettingsSchema.optional()
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: '至少需要更新一项设置'
  })

export const vaultDataSchema = z.object({
  schemaVersion: z.literal(1),
  sites: z.array(siteSchema),
  accounts: z.array(storedAccountSchema),
  favoriteGroups: z.array(groupNameSchema).default([]),
  settings: appSettingsSchema
})

export const masterPasswordSchema = z.string().min(10, '主密码至少需要 10 个字符').max(256)

export const siteInputSchema = z.object({
  id: idSchema.optional(),
  name: z.string().trim().min(1, '请输入站点名称').max(80),
  startUrl: httpUrl,
  allowedOrigins: z.array(originSchema).optional(),
  autoSubmit: z.boolean(),
  group: z.string().trim().max(40).optional()
})

export const accountCreateInputSchema = z.object({
  siteId: idSchema,
  label: z.string().trim().min(1, '请输入账号名称').max(80),
  username: z.string().trim().min(1, '请输入用户名').max(320),
  password: z.string().min(1, '请输入密码').max(2048),
  favorite: z.boolean().optional(),
  loginStrategy: z.enum(LOGIN_STRATEGIES).optional(),
  manualSelectors: manualLoginSelectorsSchema.optional()
})

export const accountUpdateInputSchema = z.object({
  label: z.string().trim().min(1).max(80).optional(),
  username: z.string().trim().min(1).max(320).optional(),
  password: z.string().min(1).max(2048).optional(),
  favorite: z.boolean().optional(),
  activeRecipeId: idSchema.optional(),
  loginStrategy: z.enum(LOGIN_STRATEGIES).optional(),
  manualSelectors: manualLoginSelectorsSchema.optional()
})

export const loginStartSchema = z.object({
  accountId: idSchema,
  mode: z.enum(['login', 'record'])
})

export const loginBatchStartSchema = z.array(idSchema).min(1).max(100)

export const selectorTestInputSchema = z
  .object({
    accountId: idSchema,
    field: z.enum(['username', 'password', 'submit']),
    selector: selectorInputSchema,
    url: httpUrl.optional()
  })
  .strict()

export const favoriteGroupInputSchema = z.object({
  groupName: groupNameSchema,
  favorite: z.boolean()
})

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  nextPassword: masterPasswordSchema
})

export const loginLogQuerySchema = z
  .object({
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    siteId: idSchema.optional(),
    siteName: z.string().trim().max(80).optional(),
    groupName: z.string().trim().max(40).optional(),
    status: z.enum(['success', 'error', 'timeout', 'manual']).optional()
  })
  .strict()
  .optional()

export const loginLogDeleteSchema = z
  .array(z.string().min(1).max(256))
  .min(1)
  .max(100)
  .refine((ids) => new Set(ids).size === ids.length, { message: '日志标识不能重复' })

export const proxyTestInputSchema = proxySettingsSchema

export const kdbxSelectionImportSchema = z
  .object({
    token: z.string().regex(/^[a-f0-9-]{36}$/),
    password: z.string().min(1, '请输入 KeePassXC 数据库主密码').max(256)
  })
  .strict()
