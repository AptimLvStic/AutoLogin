import { describe, expect, it } from 'vitest'
import {
  DEFAULT_UPDATE_CDN_BASE_URL,
  normalizeUpdateBaseUrl,
  resolveUpdateCdnBaseUrl
} from '../../src/main/update-source'

describe('update CDN source', () => {
  it('normalizes HTTPS base URLs and rejects unsafe protocols', () => {
    expect(normalizeUpdateBaseUrl('https://cdn.example.com/updates')).toBe(
      'https://cdn.example.com/updates/'
    )
    expect(normalizeUpdateBaseUrl('http://cdn.example.com/updates')).toBeNull()
    expect(normalizeUpdateBaseUrl('file:///tmp/updates')).toBeNull()
  })

  it('uses the environment override and otherwise defaults to the project CDN', () => {
    expect(
      resolveUpdateCdnBaseUrl({
        environmentUrl: 'https://updates.example.com/autologin',
        configPath: 'missing.json'
      })
    ).toBe('https://updates.example.com/autologin/')
    expect(resolveUpdateCdnBaseUrl({ configPath: 'missing.json' })).toBe(
      DEFAULT_UPDATE_CDN_BASE_URL
    )
  })
})
