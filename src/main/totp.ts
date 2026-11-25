import { createHmac } from 'node:crypto'

import { DEFAULT_OTP_CONFIG } from '../shared/types'
import type { OtpAlgorithm, OtpCode, OtpConfig, OtpDigits, OtpPeriod } from '../shared/types'

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
const ALGORITHMS: OtpAlgorithm[] = ['SHA1', 'SHA256', 'SHA512']
const DIGITS: OtpDigits[] = [6, 7, 8]
const PERIODS: OtpPeriod[] = [15, 30, 60]

export interface OtpSecretInfo {
  secret: string
  issuer?: string
  label?: string
  config: OtpConfig
}

function decodeBase32(value: string): Buffer {
  let bits = 0
  let accumulator = 0
  const bytes: number[] = []
  for (const char of value) {
    const index = BASE32_ALPHABET.indexOf(char)
    if (index < 0) {
      throw new Error('OTP 密钥包含无效的 Base32 字符')
    }
    accumulator = (accumulator << 5) | index
    bits += 5
    if (bits >= 8) {
      bits -= 8
      bytes.push((accumulator >>> bits) & 0xff)
    }
  }
  return Buffer.from(bytes)
}

function withDefaults(partial: Partial<OtpConfig> = {}): OtpConfig {
  return {
    algorithm: ALGORITHMS.includes(partial.algorithm as OtpAlgorithm)
      ? (partial.algorithm as OtpAlgorithm)
      : DEFAULT_OTP_CONFIG.algorithm,
    digits: DIGITS.includes(partial.digits as OtpDigits)
      ? (partial.digits as OtpDigits)
      : DEFAULT_OTP_CONFIG.digits,
    period: PERIODS.includes(partial.period as OtpPeriod)
      ? (partial.period as OtpPeriod)
      : DEFAULT_OTP_CONFIG.period,
    type: 'totp'
  }
}

function parseOtpConfig(url: URL): OtpConfig {
  const algorithm = (url.searchParams.get('algorithm') ?? 'SHA1').toUpperCase()
  const digits = Number(url.searchParams.get('digits') ?? 6)
  const period = Number(url.searchParams.get('period') ?? 30)
  if (!ALGORITHMS.includes(algorithm as OtpAlgorithm)) {
    throw new Error(`暂不支持该 OTP 算法：${algorithm}`)
  }
  if (!DIGITS.includes(digits as OtpDigits)) {
    throw new Error('OTP 验证码位数只支持 6、7 或 8 位')
  }
  if (!PERIODS.includes(period as OtpPeriod)) {
    throw new Error('OTP 刷新周期只支持 15、30 或 60 秒')
  }
  return withDefaults({
    algorithm: algorithm as OtpAlgorithm,
    digits: digits as OtpDigits,
    period: period as OtpPeriod
  })
}

function parseOtpauthUri(raw: string): OtpSecretInfo | null {
  if (!/^otpauth:\/\//i.test(raw)) return null
  let secret = ''
  let issuer: string | undefined
  let label: string | undefined
  let config: OtpConfig = { ...DEFAULT_OTP_CONFIG }
  try {
    const url = new URL(raw)
    const type = url.host.toLowerCase()
    if (type === 'hotp') {
      throw new Error('暂不支持 HOTP 计数器验证码，请使用 TOTP')
    }
    if (type === 'steam') {
      throw new Error('暂不支持 Steam 令牌，请使用标准 TOTP')
    }
    if (type !== 'totp') {
      throw new Error('otpauth 链接类型必须是 totp')
    }
    secret = url.searchParams.get('secret') ?? ''
    issuer = url.searchParams.get('issuer') ?? undefined
    label = decodeURIComponent(url.pathname.replace(/^\/+/, '')) || undefined
    config = parseOtpConfig(url)
  } catch (error) {
    if (error instanceof Error && /暂不支持|只支持|必须是/.test(error.message)) {
      throw error
    }
    const secretMatch = /[?&]secret=([^&]+)/i.exec(raw)
    const issuerMatch = /[?&]issuer=([^&]+)/i.exec(raw)
    secret = secretMatch?.[1] ? decodeURIComponent(secretMatch[1]) : ''
    issuer = issuerMatch?.[1] ? decodeURIComponent(issuerMatch[1]) : undefined
  }
  if (!secret) {
    throw new Error('otpauth 链接中缺少 secret 参数')
  }
  return { secret, issuer, label, config }
}

export function normalizeOtpSecret(
  raw: string,
  override?: Partial<OtpConfig>
): OtpSecretInfo {
  const trimmed = raw.trim()
  if (!trimmed) {
    throw new Error('请输入 OTP 密钥')
  }
  const parsed = parseOtpauthUri(trimmed)
  const config = withDefaults({ ...(parsed?.config ?? DEFAULT_OTP_CONFIG), ...override })
  const source = (parsed?.secret ?? trimmed)
    .replace(/[\s-]/g, '')
    .replace(/=+$/g, '')
    .toUpperCase()
  if (!source) {
    throw new Error('请输入 OTP 密钥')
  }
  if (!/^[A-Z2-7]+$/.test(source)) {
    throw new Error('OTP 密钥必须是 Base32 字符（A-Z、2-7）')
  }
  if (source.length < 8) {
    throw new Error('OTP 密钥至少需要 8 个字符')
  }
  if (source.length > 256) {
    throw new Error('OTP 密钥不能超过 256 个字符')
  }
  return {
    secret: source,
    issuer: parsed?.issuer ?? undefined,
    label: parsed?.label ?? undefined,
    config
  }
}

export function generateTotp(
  secret: string,
  at: number = Date.now(),
  config: Partial<OtpConfig> = {}
): OtpCode {
  const normalized = normalizeOtpSecret(secret, config)
  const resolved = normalized.config
  const key = decodeBase32(normalized.secret)
  const seconds = Math.floor(at / 1000)
  const counter = Math.floor(seconds / resolved.period)
  const remaining = resolved.period - (seconds % resolved.period)
  const counterBuffer = Buffer.alloc(8)
  counterBuffer.writeUInt32BE(Math.floor(counter / 0x100000000), 0)
  counterBuffer.writeUInt32BE(counter % 0x100000000, 4)
  const digest = createHmac(resolved.algorithm.toLowerCase(), key)
    .update(counterBuffer)
    .digest()
  const offset = (digest[digest.length - 1] ?? 0) & 0x0f
  const binary =
    (((digest[offset] ?? 0) & 0x7f) << 24) |
    (((digest[offset + 1] ?? 0) & 0xff) << 16) |
    (((digest[offset + 2] ?? 0) & 0xff) << 8) |
    ((digest[offset + 3] ?? 0) & 0xff)
  const code = String(binary % 10 ** resolved.digits).padStart(resolved.digits, '0')
  return {
    code,
    remaining,
    period: resolved.period,
    issuer: normalized.issuer,
    label: normalized.label,
    config: resolved
  }
}
