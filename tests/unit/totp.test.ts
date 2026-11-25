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
      label: 'GitHub:dev@example.com'
    })
  })

  it('rejects empty, short and non-Base32 secrets', () => {
    expect(() => normalizeOtpSecret('   ')).toThrow('请输入 OTP 密钥')
    expect(() => normalizeOtpSecret('ABCD')).toThrow('至少需要 8 个字符')
    expect(() => normalizeOtpSecret('ABCDEFG1')).toThrow('Base32')
    expect(() => normalizeOtpSecret('otpauth://totp/x?issuer=y')).toThrow('secret')
  })
})
