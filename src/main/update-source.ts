import { readFileSync } from 'node:fs'

export const DEFAULT_UPDATE_CDN_BASE_URL =
  'https://aptimlvstic.github.io/Tauri/updates/'

export function normalizeUpdateBaseUrl(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null
  try {
    const url = new URL(value.trim())
    if (url.protocol !== 'https:') return null
    url.search = ''
    url.hash = ''
    return url.toString().replace(/\/?$/, '/')
  } catch {
    return null
  }
}

export function resolveUpdateCdnBaseUrl(options: {
  environmentUrl?: string
  configPath?: string
}): string {
  const environmentUrl = normalizeUpdateBaseUrl(options.environmentUrl)
  if (environmentUrl) return environmentUrl

  if (options.configPath) {
    try {
      const config: unknown = JSON.parse(
        readFileSync(options.configPath, 'utf8')
      )
      if (config && typeof config === 'object') {
        const configured = normalizeUpdateBaseUrl(
          (config as Record<string, unknown>).cdnBaseUrl
        )
        if (configured) return configured
      }
    } catch {
      // A missing or invalid optional config falls back to the project CDN.
    }
  }

  return DEFAULT_UPDATE_CDN_BASE_URL
}
