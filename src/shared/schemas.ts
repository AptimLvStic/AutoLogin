import { z } from 'zod'
import { AUTO_LOCK_OPTIONS } from './types'

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
  recipe: loginRecipeSchema.optional(),
  createdAt: z.string(),
  updatedAt: z.string()
})

export const storedAccountSchema = z.object({
  id: idSchema,
  siteId: idSchema,
  label: z.string().min(1).max(80),
  username: z.string().max(320),
  password: z.string().max(2048),
  favorite: z.boolean(),
  lastUsedAt: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string()
})

export const appSettingsSchema = z.object({
  autoLockMinutes: z.union([
    z.literal(AUTO_LOCK_OPTIONS[0]),
    z.literal(AUTO_LOCK_OPTIONS[1]),
    z.literal(AUTO_LOCK_OPTIONS[2]),
    z.literal(AUTO_LOCK_OPTIONS[3])
  ])
})

export const vaultDataSchema = z.object({
  schemaVersion: z.literal(1),
  sites: z.array(siteSchema),
  accounts: z.array(storedAccountSchema),
  settings: appSettingsSchema
})

export const masterPasswordSchema = z.string().min(10, '主密码至少需要 10 个字符').max(256)

export const siteInputSchema = z.object({
  id: idSchema.optional(),
  name: z.string().trim().min(1, '请输入站点名称').max(80),
  startUrl: httpUrl,
  allowedOrigins: z.array(originSchema).optional(),
  autoSubmit: z.boolean()
})

export const accountCreateInputSchema = z.object({
  siteId: idSchema,
  label: z.string().trim().min(1, '请输入账号名称').max(80),
  username: z.string().trim().min(1, '请输入用户名').max(320),
  password: z.string().min(1, '请输入密码').max(2048),
  favorite: z.boolean().optional()
})

export const accountUpdateInputSchema = z.object({
  label: z.string().trim().min(1).max(80).optional(),
  username: z.string().trim().min(1).max(320).optional(),
  password: z.string().min(1).max(2048).optional(),
  favorite: z.boolean().optional()
})

export const loginStartSchema = z.object({
  accountId: idSchema,
  mode: z.enum(['login', 'record'])
})

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  nextPassword: masterPasswordSchema
})
