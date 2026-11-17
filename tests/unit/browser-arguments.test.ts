import { describe, expect, it } from 'vitest'
import {
  buildBrowserArguments,
  parseTrustedCertificateSpkiList,
  TRUSTED_SPKI_ENV
} from '../../src/main/browser-arguments'

const base = {
  profileDirectory: 'C:\\profile',
  headless: true
}

const fingerprintA = `${'A'.repeat(43)}=`
const fingerprintB = `${'B'.repeat(43)}=`

describe('buildBrowserArguments · TLS 校验默认严格', () => {
  it('默认不传任何证书放行参数', () => {
    const args = buildBrowserArguments(base, {})
    expect(args).not.toContain('--ignore-certificate-errors')
    expect(args.some((arg) => arg.startsWith('--ignore-certificate-errors'))).toBe(false)
  })

  it('显式空数组同样保持严格校验', () => {
    const args = buildBrowserArguments({ ...base, trustedCertificateSpkiList: [] }, {})
    expect(args.some((arg) => arg.includes('ignore-certificate-errors'))).toBe(false)
  })

  it('配置指纹后只放行该指纹，不使用全局开关', () => {
    const args = buildBrowserArguments(
      { ...base, trustedCertificateSpkiList: [fingerprintA] },
      {}
    )
    expect(args).toContain(`--ignore-certificate-errors-spki-list=${fingerprintA}`)
    expect(args).not.toContain('--ignore-certificate-errors')
  })

  it('多个指纹去重后逗号连接', () => {
    const args = buildBrowserArguments(
      { ...base, trustedCertificateSpkiList: [fingerprintA, fingerprintB, fingerprintA] },
      {}
    )
    expect(args).toContain(`--ignore-certificate-errors-spki-list=${fingerprintA},${fingerprintB}`)
  })

  it('非法指纹被丢弃，全非法时回落到严格校验', () => {
    const args = buildBrowserArguments(
      { ...base, trustedCertificateSpkiList: ['not-a-fingerprint', '', '   '] },
      {}
    )
    expect(args.some((arg) => arg.includes('ignore-certificate-errors'))).toBe(false)
  })

  it('环境变量可提供指纹，且被 options 覆盖', () => {
    const fromEnv = buildBrowserArguments(base, { [TRUSTED_SPKI_ENV]: fingerprintA })
    expect(fromEnv).toContain(`--ignore-certificate-errors-spki-list=${fingerprintA}`)

    const overridden = buildBrowserArguments(
      { ...base, trustedCertificateSpkiList: [fingerprintB] },
      { [TRUSTED_SPKI_ENV]: fingerprintA }
    )
    expect(overridden).toContain(`--ignore-certificate-errors-spki-list=${fingerprintB}`)
  })
})

describe('parseTrustedCertificateSpkiList', () => {
  it('支持逗号与空白分隔', () => {
    expect(parseTrustedCertificateSpkiList(`${fingerprintA}, ${fingerprintB}`)).toEqual([
      fingerprintA,
      fingerprintB
    ])
    expect(parseTrustedCertificateSpkiList(`${fingerprintA} ${fingerprintB}`)).toHaveLength(2)
  })

  it('空值返回空数组', () => {
    expect(parseTrustedCertificateSpkiList(undefined)).toEqual([])
    expect(parseTrustedCertificateSpkiList('')).toEqual([])
  })

  it('拒绝过短或含非法字符的条目', () => {
    expect(parseTrustedCertificateSpkiList('abc')).toEqual([])
    expect(parseTrustedCertificateSpkiList(`${'A'.repeat(43)}!`)).toEqual([])
  })
})

describe('buildBrowserArguments · 其余参数保持不变', () => {
  it('保留远程调试与固定开关', () => {
    const args = buildBrowserArguments(base, {})
    expect(args).toContain('--remote-debugging-address=127.0.0.1')
    expect(args).toContain('--remote-debugging-port=0')
    expect(args).toContain('--no-first-run')
    expect(args).toContain('--disable-background-mode')
    expect(args).toContain('--user-data-dir=C:\\profile')
  })

  it('headless 开关与默认地址', () => {
    expect(buildBrowserArguments(base, {})).toEqual(
      expect.arrayContaining(['--headless=new', '--disable-gpu', 'about:blank'])
    )
    const headed = buildBrowserArguments({ ...base, headless: false }, {})
    expect(headed).not.toContain('--headless=new')
  })

  it('代理仅在手动模式下追加参数', () => {
    const systemProxy = buildBrowserArguments(
      {
        ...base,
        proxy: {
          mode: 'system',
          enabled: true,
          protocol: 'http',
          host: '127.0.0.1',
          port: 8080,
          bypassList: ''
        } as never
      },
      {}
    )
    expect(systemProxy.some((arg) => arg.startsWith('--proxy-server'))).toBe(false)

    const manualProxy = buildBrowserArguments(
      {
        ...base,
        proxy: {
          mode: 'manual',
          enabled: true,
          protocol: 'http',
          host: '127.0.0.1',
          port: 8080,
          bypassList: 'localhost,127.0.0.1'
        } as never
      },
      {}
    )
    expect(manualProxy).toContain('--proxy-server=http://127.0.0.1:8080')
    expect(manualProxy).toContain('--proxy-bypass-list=localhost;127.0.0.1')
  })
})
