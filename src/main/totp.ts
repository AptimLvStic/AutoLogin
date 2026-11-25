import { createHmac } from 'node:crypto'

import type { OtpCode } from '../shared/types'

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
const DEFAULT_PERIOD = 30
const DEFAULT_DIGITS = 6

export interface OtpSecretInfo {
  secret: string
  issuer?: string
  label?: string
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

function parseOtpauthUri(raw: string): OtpSecretInfo | null {
  if (!/^otpauth:\/\//i.test(raw)) return null
  let secret = ''
  let issuer: string | undefined
  let label: string | undefined
  try {
    const url = new URL(raw)
    secret = url.searchParams.get('secret') ?? ''
    issuer = url.searchParams.get('issuer') ?? undefined
    label = decodeURIComponent(url.pathname.replace(/^\/+/, '')) || undefined
  } catch {
    const secretMatch = /[?&]secret=([^&]+)/i.exec(raw)
    const issuerMatch = /[?&]issuer=([^&]+)/i.exec(raw)
    secret = secretMatch?.[1] ? decodeURIComponent(secretMatch[1]) : ''
    issuer = issuerMatch?.[1] ? decodeURIComponent(issuerMatch[1]) : undefined
  }
  if (!secret) {
    throw new Error('otpauth 链接中缺少 secret 参数')
  }
  return { secret, issuer, label }
}

export function normalizeOtpSecret(raw: string): OtpSecretInfo {
  const trimmed = raw.trim()
  if (!trimmed) {
    throw new Error('请输入 OTP 密钥')
  }
  const parsed = parseOtpauthUri(trimmed)
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
    label: parsed?.label ?? undefined
  }
}

export function generateTotp(
  secret: string,
  at: number = Date.now(),
  period: number = DEFAULT_PERIOD,
  digits: number = DEFAULT_DIGITS
): OtpCode {
  const normalized = normalizeOtpSecret(secret)
  const key = decodeBase32(normalized.secret)
  const seconds = Math.floor(at / 1000)
  const counter = Math.floor(seconds / period)
  const remaining = period - (seconds % period)
  const counterBuffer = Buffer.alloc(8)
  counterBuffer.writeUInt32BE(Math.floor(counter / 0x100000000), 0)
  counterBuffer.writeUInt32BE(counter % 0x100000000, 4)
  const digest = createHmac('sha1', key).update(counterBuffer).digest()
  const offset = (digest[digest.length - 1] ?? 0) & 0x0f
  const binary =
    (((digest[offset] ?? 0) & 0x7f) << 24) |
    (((digest[offset + 1] ?? 0) & 0xff) << 16) |
    (((digest[offset + 2] ?? 0) & 0xff) << 8) |
    ((digest[offset + 3] ?? 0) & 0xff)
  const code = String(binary % 10 ** digits).padStart(digits, '0')
  return {
    code,
    remaining,
    period,
    issuer: normalized.issuer,
    label: normalized.label
  }
}
