import { describe, expect, it } from 'vitest'
import {
  assertChromiumBrowser,
  extractExecutablePath,
  parseProgId,
  parseRegistryDefault
} from '../../src/main/browser-discovery'

describe('Windows default browser discovery', () => {
  it('extracts quoted and unquoted executable paths from shell commands', () => {
    expect(
      extractExecutablePath(
        '"C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe" --single-argument %1'
      )
    ).toBe('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe')
    expect(
      extractExecutablePath(
        'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe -- "%1"'
      )
    ).toBe('C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe')
  })

  it('parses UserChoice ProgId and shell command registry output', () => {
    expect(
      parseProgId(
        'HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\Shell\\Associations\\UrlAssociations\\https\\UserChoice\r\n    ProgId    REG_SZ    ChromeHTML\r\n'
      )
    ).toBe('ChromeHTML')
    expect(
      parseRegistryDefault(
        'HKEY_CLASSES_ROOT\\ChromeHTML\\shell\\open\\command\r\n    (Default)    REG_SZ    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe" -- "%1"\r\n'
      )
    ).toBe('"C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe" -- "%1"')
  })

  it('rejects known non-Chromium default browsers with an actionable message', () => {
    expect(() =>
      assertChromiumBrowser({
        name: 'Mozilla Firefox',
        executablePath: 'C:\\Program Files\\Mozilla Firefox\\firefox.exe',
        progId: 'FirefoxURL'
      })
    ).toThrow('Google Chrome 或 Microsoft Edge')
    expect(() =>
      assertChromiumBrowser({
        name: 'Microsoft Edge',
        executablePath: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
        progId: 'MSEdgeHTM'
      })
    ).not.toThrow()
  })
})
