import { describe, expect, it } from 'vitest'
import { generateTotp, normalizeOtpSecret } from '../../src/main/totp'

const RFC_SECRET = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ'

describe('totp', () => {
  it('matches the RFC 6238 SHA-1 vector with six digits', () => {
    const code = generateTotp(RFC_SECRET, 59_000)
    expect(code.code).toBe('287082')
    expect(code.period).toBe(30)
    expect(code.remaining).toBe(1)
  })

  it('normalizes spaces, dashes and padding', () => {
    expect(normalizeOtpSecret('jbsw y3dp-ehpk 3pxp====').secret).toBe('JBSWY3DPEHPK3PXP')
  })

  it('reads otpauth links', () => {
    const info = normalizeOtpSecret(
      'otpauth://totp/GitHub:dev%40example.com?secret=JBSWY3DPEHPK3PXP&issuer=GitHub'
    )
    expect(info).toEqual({
      secret: 'JBSWY3DPEHPK3PXP',
      issuer: 'GitHub',
      label: 'GitHub:dev@example.com',
      config: { algorithm: 'SHA1', digits: 6, period: 30, type: 'totp' }
    })
  })

  it('honours algorithm, digits and period', () => {
    const config = { algorithm: 'SHA256', digits: 8, period: 60 } as const
    const code = generateTotp(RFC_SECRET, 59_000, config)
    expect(code.code).toMatch(/^\d{8}$/)
    expect(code.period).toBe(60)
    expect(code.remaining).toBe(1)
    expect(code.config).toMatchObject(config)
  })

  it('parses and rejects unsupported otpauth parameters', () => {
    const sha256 = normalizeOtpSecret(
      'otpauth://totp/Example:dev?secret=JBSWY3DPEHPK3PXP&issuer=GitHub&algorithm=SHA256&digits=8&period=60'
    )
    expect(sha256.config).toEqual({ algorithm: 'SHA256', digits: 8, period: 60, type: 'totp' })
    expect(() =>
      normalizeOtpSecret('otpauth://hotp/Example:dev?secret=JBSWY3DPEHPK3PXP&issuer=GitHub&counter=1')
    ).toThrow('HOTP')
    expect(() =>
      normalizeOtpSecret('otpauth://totp/Example:dev?secret=JBSWY3DPEHPK3PXP&issuer=GitHub&algorithm=MD5')
    ).toThrow('OTP 算法')
  })

  it('rejects empty, short and non-Base32 secrets', () => {
    expect(() => normalizeOtpSecret('   ')).toThrow('请输入 OTP 密钥')
    expect(() => normalizeOtpSecret('ABCD')).toThrow('至少需要 8 个字符')
    expect(() => normalizeOtpSecret('ABCDEFG1')).toThrow('Base32')
    expect(() => normalizeOtpSecret('otpauth://totp/x?issuer=y')).toThrow('secret')
  })
})
