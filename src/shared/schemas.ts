import { z } from 'zod'
import { isDatabaseNameFileSafe } from './database-files'
import {
  ACCOUNT_TAB_COLORS,
  ACCOUNT_TAB_SOURCES,
  APP_LANGUAGES,
  AUTO_LOCK_OPTIONS,
  COLOR_MODES,
  DEFAULT_ACCOUNT_TAB_ID,
  DEFAULT_PROXY_TEST_URL,
  FONT_SIZE_SCALE_OPTIONS,
  GROUP_NAME_MAX_LENGTH,
  DEFAULT_TRASH_RETENTION_DAYS,
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

const groupNameSchema = z
  .string()
  .trim()
  .min(1, '分组名称不能为空')
  .max(GROUP_NAME_MAX_LENGTH, `分组名称不能超过 ${GROUP_NAME_MAX_LENGTH} 个字符`)
  .regex(/^[\p{L}\p{N} _-]+$/u, '分组名称不能包含特殊字符')

const groupPathSchema = z.string().trim().min(1).max(80)
const tabIdSchema = idSchema.default(DEFAULT_ACCOUNT_TAB_ID)
const tabNameSchema = z.string().trim().min(1, '标签页名称不能为空').max(40)
const tabFileSafeNameSchema = tabNameSchema.refine(
  isDatabaseNameFileSafe,
  '数据库名称必须是有效的 Windows 文件名'
)
const tabColorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/, '标签页颜色无效')
const tabDatabaseFileNameSchema = z
  .string()
  .trim()
  .min(5)
  .max(180)
  .regex(
    /^[^<>:"/\\|?*\u0000-\u001f]+\.(autologin|kdbx|csv|html?)$/i,
    '数据库文件名无效'
  )

const defaultLocalTab = {
  id: DEFAULT_ACCOUNT_TAB_ID,
  name: '本地账号',
  color: ACCOUNT_TAB_COLORS[0],
  source: 'local' as const,
  hidden: false,
  createdAt: '1970-01-01T00:00:00.000Z',
  updatedAt: '1970-01-01T00:00:00.000Z'
}

export const accountTabSchema = z.object({
  id: idSchema,
  name: tabNameSchema,
  color: tabColorSchema,
  source: z.enum(ACCOUNT_TAB_SOURCES),
  databaseFileName: tabDatabaseFileNameSchema.optional(),
  hidden: z.boolean().default(false),
  createdAt: z.string(),
  updatedAt: z.string()
})

const siteIconDataUrlSchema = z
  .string()
  .max(750_000, '账号图标不能超过 750 KB')
  .regex(
    /^data:image\/[a-zA-Z0-9.+-]+;base64,[a-zA-Z0-9+/]+={0,2}$/,
    '账号图标格式无效'
  )

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
  tabId: tabIdSchema,
  name: z.string().min(1).max(80),
  startUrl: httpUrl,
  allowedOrigins: z.array(originSchema).min(1),
  autoSubmit: z.boolean(),
  group: groupPathSchema.optional(),
  icon: siteIconDataUrlSchema.optional(),
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
  tabId: tabIdSchema,
  siteId: idSchema,
  label: z.string().min(1).max(80),
  username: z.string().max(320),
  password: z.string().max(2048),
  favorite: z.boolean(),
  loginStrategy: z.enum(LOGIN_STRATEGIES).default('auto'),
  manualSelectors: manualLoginSelectorsSchema.optional(),
  manualSteps: z.array(recipeStepSchema).max(30).optional(),
  recipes: z.array(accountRecipeSchema).max(3).default([]),
  activeRecipeId: idSchema.optional(),
  lastUsedAt: z.string().optional(),
  sortOrder: z.number().int().min(0).max(1_000_000).optional(),
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

const fontSizeScaleSchema = z.union([
  z.literal(FONT_SIZE_SCALE_OPTIONS[0]),
  z.literal(FONT_SIZE_SCALE_OPTIONS[1]),
  z.literal(FONT_SIZE_SCALE_OPTIONS[2]),
  z.literal(FONT_SIZE_SCALE_OPTIONS[3])
])

const groupOrderSchema = z
  .array(groupPathSchema)
  .max(500)
  .refine((groups) => new Set(groups).size === groups.length, '分组顺序不能包含重复项')

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

const defaultProxySettings = {
  mode: 'custom' as const,
  enabled: true,
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
  trashRetentionDays: z
    .union([z.literal(3), z.literal(7), z.literal(15), z.literal(30)])
    .default(DEFAULT_TRASH_RETENTION_DAYS),
  colorMode: colorModeSchema.default('light'),
  language: languageSchema.default('zh-CN'),
  themePreset: themePresetSchema.default('magpie'),
  customTheme: themeColorsSchema.default(defaultThemeColors),
  interfaceScale: interfaceScaleSchema.default(110),
  fontSizeScale: fontSizeScaleSchema.default(100).catch(100),
  accountCopyShortcutEnabled: z.boolean().default(false),
  accountCopyShortcut: z.string().trim().min(1).max(40).default('Ctrl+C'),
  proxy: proxySettingsSchema.default(defaultProxySettings),
  groupOrder: groupOrderSchema.default([]),
  groupOrders: z.record(z.string(), groupOrderSchema).default({})
})

export const appSettingsPatchSchema = z
  .object({
    autoLockMinutes: autoLockMinutesSchema.optional(),
    trashRetentionDays: z
      .union([z.literal(3), z.literal(7), z.literal(15), z.literal(30)])
      .optional(),
    colorMode: colorModeSchema.optional(),
    language: languageSchema.optional(),
    themePreset: themePresetSchema.optional(),
    customTheme: themeColorsSchema.optional(),
    interfaceScale: interfaceScaleSchema.optional(),
    fontSizeScale: fontSizeScaleSchema.optional(),
    accountCopyShortcutEnabled: z.boolean().optional(),
    accountCopyShortcut: z.string().trim().min(1).max(40).optional(),
    proxy: proxySettingsSchema.optional(),
    groupOrder: groupOrderSchema.optional(),
    groupOrders: z.record(z.string(), groupOrderSchema).optional()
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: '至少需要更新一项设置'
  })

export const vaultDataSchema = z.object({
  schemaVersion: z.literal(1),
  tabs: z.array(accountTabSchema).default([defaultLocalTab]),
  sites: z.array(siteSchema),
  accounts: z.array(storedAccountSchema),
  groupDefinitions: z
    .array(
      z.object({
        tabId: tabIdSchema,
        path: groupPathSchema,
        name: z.string().trim().min(1).max(40),
        createdAt: z.string(),
        updatedAt: z.string()
      })
    )
    .max(500)
    .default([]),
  deletedAccounts: z
    .array(
      z.object({
        account: storedAccountSchema,
        site: siteSchema,
        tabId: tabIdSchema,
        deletedAt: z.string()
      })
    )
    .max(500)
    .default([]),
  favoriteGroups: z.array(groupPathSchema).default([]),
  settings: appSettingsSchema
})

export const masterPasswordSchema = z.string().min(10, '主密码至少需要 10 个字符').max(256)

export const siteInputSchema = z.object({
  id: idSchema.optional(),
  tabId: tabIdSchema.optional(),
  name: z.string().trim().min(1, '请输入站点名称').max(80),
  startUrl: httpUrl,
  allowedOrigins: z.array(originSchema).optional(),
  autoSubmit: z.boolean(),
  group: groupPathSchema.optional(),
  icon: siteIconDataUrlSchema.optional()
})

export const siteIconFetchInputSchema = z
  .object({
    url: httpUrl
  })
  .strict()

export const groupCreateInputSchema = z
  .object({
    tabId: tabIdSchema.optional(),
    parentPath: groupPathSchema.optional(),
    name: groupNameSchema
  })
  .strict()

export const groupMoveInputSchema = z
  .object({
    tabId: tabIdSchema.optional(),
    fromPath: groupPathSchema,
    parentPath: groupPathSchema.optional()
  })
  .strict()

export const accountCreateInputSchema = z.object({
  siteId: idSchema,
  label: z.string().trim().min(1, '请输入账号名称').max(80),
  // Bookmarks intentionally store no credentials. The main process checks
  // non-empty credentials when the target tab is a regular account tab.
  username: z.string().trim().max(320),
  password: z.string().max(2048),
  favorite: z.boolean().optional(),
  loginStrategy: z.enum(LOGIN_STRATEGIES).optional(),
  manualSelectors: manualLoginSelectorsSchema.optional(),
  manualSteps: z.array(recipeStepSchema).max(30).optional()
})

export const accountUpdateInputSchema = z.object({
  label: z.string().trim().min(1).max(80).optional(),
  username: z.string().trim().min(1).max(320).optional(),
  password: z.string().min(1).max(2048).optional(),
  favorite: z.boolean().optional(),
  activeRecipeId: idSchema.optional(),
  loginStrategy: z.enum(LOGIN_STRATEGIES).optional(),
  manualSelectors: manualLoginSelectorsSchema.optional(),
  manualSteps: z.array(recipeStepSchema).max(30).optional()
})

export const accountRecipeUpdateInputSchema = z
  .object({
    accountId: idSchema,
    recipeId: idSchema,
    steps: z.array(recipeStepSchema).max(30)
  })
  .strict()

export const accountBatchStrategyInputSchema = z
  .object({
    accountIds: z
      .array(idSchema)
      .min(1)
      .max(500)
      .refine((ids) => new Set(ids).size === ids.length, '账号标识不能重复'),
    loginStrategy: z.enum(LOGIN_STRATEGIES),
    manualSelectors: manualLoginSelectorsSchema.optional(),
    manualSteps: z.array(recipeStepSchema).max(30).optional()
  })
  .strict()

export const accountIdsSchema = z
  .array(idSchema)
  .min(1)
  .max(500)
  .refine((ids) => new Set(ids).size === ids.length, '账号标识不能重复')

export const accountBatchIconFetchInputSchema = accountIdsSchema

export const accountBatchIconInputSchema = z
  .object({
    accountIds: accountIdsSchema,
    icon: siteIconDataUrlSchema
  })
  .strict()

export const accountDuplicateInputSchema = accountIdsSchema
export const accountDeleteManyInputSchema = accountIdsSchema

export const accountReorderInputSchema = z
  .object({
    accountIds: accountIdsSchema,
    tabId: tabIdSchema.optional()
  })
  .strict()

export const accountMoveInputSchema = z
  .object({
    accountIds: accountIdsSchema,
    groupPath: groupPathSchema.optional(),
    tabId: tabIdSchema.optional()
  })
  .strict()

export const accountTabCreateInputSchema = z
  .object({
    name: tabFileSafeNameSchema.optional(),
    color: tabColorSchema.optional(),
    source: z.enum(['local', 'bookmarks']).optional()
  })
  .strict()
  .optional()

export const accountTabUpdateInputSchema = z
  .object({
    name: tabFileSafeNameSchema.optional(),
    color: tabColorSchema.optional()
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: '至少需要更新一项标签页属性'
  })

export const loginStartSchema = z.object({
  accountId: idSchema,
  mode: z.enum(['login', 'record'])
})

export const loginBatchStartSchema = z.array(idSchema).min(1).max(500)

export const selectorTestInputSchema = z
  .object({
    accountId: idSchema,
    field: z.enum(['username', 'password', 'submit']),
    selector: selectorInputSchema,
    url: httpUrl.optional()
  })
  .strict()

export const favoriteGroupInputSchema = z.object({
  groupName: groupPathSchema,
  favorite: z.boolean()
})

export const groupRenameInputSchema = z
  .object({
    tabId: tabIdSchema.optional(),
    fromName: groupPathSchema,
    toName: groupNameSchema
  })
  .strict()

export const groupDeleteInputSchema = z
  .object({
    tabId: tabIdSchema.optional(),
    groupName: groupPathSchema
  })
  .strict()

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  nextPassword: masterPasswordSchema
})

export const loginLogQuerySchema = z
  .object({
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    siteId: idSchema.optional(),
    siteName: z.string().trim().max(80).optional(),
    groupName: z.string().trim().max(80).optional(),
    status: z.enum(['success', 'error', 'timeout', 'manual']).optional()
  })
  .strict()
  .optional()

export const loginLogDeleteSchema = z
  .array(z.string().min(1).max(256))
  .min(1)
  .max(100)
  .refine((ids) => new Set(ids).size === ids.length, { message: '日志标识不能重复' })

export const appLogQuerySchema = z.number().int().min(1).max(500).optional()

export const appLogDeleteSchema = z
  .array(idSchema)
  .min(1)
  .max(100)
  .refine((ids) => new Set(ids).size === ids.length, { message: '日志标识不能重复' })

export const dataLocationConflictInputSchema = z
  .object({
    directory: z.string().trim().min(1).max(32767),
    action: z.enum(['load', 'overwrite'])
  })
  .strict()

export const proxyTestInputSchema = proxySettingsSchema

export const kdbxSelectionImportSchema = z
  .object({
    token: z.string().regex(/^[a-f0-9-]{36}$/),
    password: z.string().min(1, '请输入 KeePassXC 数据库主密码').max(256)
  })
  .strict()

export const autologinSelectionImportSchema = kdbxSelectionImportSchema

export const clipboardSecretInputSchema = z
  .object({
    value: z.string().min(1, '剪贴板内容不能为空').max(4096)
  })
  .strict()

export const dataExportInputSchema = z
  .object({
    tabId: idSchema,
    format: z.enum(['autologin', 'csv', 'kdbx']).optional(),
    password: masterPasswordSchema.optional()
  })
  .strict()

export const csvImportInputSchema = z
  .object({
    mode: z.enum(['current', 'new']),
    tabId: idSchema
  })
  .strict()
