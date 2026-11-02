import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { basename, resolve } from 'node:path'

export interface DefaultBrowser {
  name: string
  executablePath: string
  progId: string
}

const BROWSER_NAMES: Record<string, string> = {
  'chrome.exe': 'Google Chrome',
  'msedge.exe': 'Microsoft Edge',
  'brave.exe': 'Brave',
  'vivaldi.exe': 'Vivaldi',
  'chromium.exe': 'Chromium',
  'thorium.exe': 'Thorium',
  'opera.exe': 'Opera'
}

const KNOWN_NON_CHROMIUM = new Set(['firefox.exe', 'iexplore.exe'])

export function discoverDefaultBrowser(overridePath?: string): DefaultBrowser {
  if (overridePath?.trim()) {
    const executablePath = resolve(overridePath.trim())
    if (!existsSync(executablePath)) {
      throw new Error('测试指定的浏览器不存在')
    }
    return {
      name: displayNameForExecutable(executablePath),
      executablePath,
      progId: 'Override'
    }
  }

  if (process.platform !== 'win32') {
    throw new Error('当前版本仅支持 Windows 默认浏览器自动填充')
  }

  const progId = readProgId('https') ?? readProgId('http')
  if (!progId) {
    throw new Error('无法识别 Windows 默认浏览器')
  }

  const command = parseRegistryDefault(
    queryRegistryDefault(`HKEY_CLASSES_ROOT\\${progId}\\shell\\open\\command`)
  )
  const executablePath = command ? extractExecutablePath(command) : ''
  if (!executablePath || !existsSync(executablePath)) {
    throw new Error('无法找到默认浏览器程序，请重新设置 Windows 默认浏览器')
  }

  return {
    name: displayNameForExecutable(executablePath, progId),
    executablePath,
    progId
  }
}

export function assertChromiumBrowser(browser: DefaultBrowser): void {
  const executable = basename(browser.executablePath).toLowerCase()
  if (KNOWN_NON_CHROMIUM.has(executable)) {
    throw new Error(
      `${browser.name} 暂不支持本地自动填充。请将 Google Chrome 或 Microsoft Edge 设为 Windows 默认浏览器后重试。`
    )
  }
}

export function extractExecutablePath(command: string): string {
  const trimmed = command.trim()
  const quoted = trimmed.match(/^"([^"]+\.exe)"/i)
  const candidate = quoted?.[1] ?? trimmed.match(/^(.+?\.exe)(?:\s|$)/i)?.[1] ?? ''
  return expandEnvironmentVariables(candidate.trim())
}

export function parseProgId(output: string): string {
  return output.match(/\bProgId\s+REG_SZ\s+([^\s]+)/i)?.[1] ?? ''
}

export function parseRegistryDefault(output: string): string {
  return output.match(/\bREG_SZ\s+(.+?)(?:\r?\n)?$/m)?.[1]?.trim() ?? ''
}

function readProgId(protocol: 'http' | 'https'): string {
  const output = queryRegistryDefault(
    `HKCU\\Software\\Microsoft\\Windows\\Shell\\Associations\\UrlAssociations\\${protocol}\\UserChoice`,
    'ProgId'
  )
  return output ? parseProgId(output) : ''
}

function queryRegistryDefault(key: string, value?: string): string {
  try {
    const args = ['query', key]
    if (value) {
      args.push('/v', value)
    } else {
      args.push('/ve')
    }
    return execFileSync('reg.exe', args, {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 5_000
    })
  } catch {
    return ''
  }
}

function displayNameForExecutable(executablePath: string, progId = ''): string {
  const executable = basename(executablePath).toLowerCase()
  if (BROWSER_NAMES[executable]) {
    return BROWSER_NAMES[executable]
  }
  if (/^ChromeHTML$/i.test(progId)) return 'Google Chrome'
  if (/^(MSEdgeHTML|MSEdgeHTM)$/i.test(progId)) return 'Microsoft Edge'
  return basename(executablePath, '.exe')
}

function expandEnvironmentVariables(value: string): string {
  return value.replace(/%([^%]+)%/g, (match, name: string) => {
    const key = Object.keys(process.env).find(
      (entry) => entry.toLowerCase() === name.toLowerCase()
    )
    return key ? (process.env[key] ?? match) : match
  })
}
