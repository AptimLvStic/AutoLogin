import { describe, expect, it } from 'vitest'
import {
  isHttpUrl,
  isOriginAllowed,
  safeOrigin,
  stripQuery
} from '../../src/shared/url'

describe('URL safety helpers', () => {
  it('accepts only http and https URLs', () => {
    expect(isHttpUrl('https://example.com/login')).toBe(true)
    expect(isHttpUrl('http://127.0.0.1:4173/login')).toBe(true)
    expect(isHttpUrl('javascript:alert(1)')).toBe(false)
    expect(isHttpUrl('file:///C:/secret.txt')).toBe(false)
    expect(isHttpUrl('data:text/html,hello')).toBe(false)
  })

  it('normalizes origins and removes query parameters from success checks', () => {
    expect(safeOrigin('https://Example.com:443/login?token=secret')).toBe(
      'https://example.com'
    )
    expect(stripQuery('https://example.com/app?token=secret#section')).toBe(
      'https://example.com/app'
    )
    expect(safeOrigin('not a url')).toBe('')
  })

  it('matches trusted origins exactly, including scheme and port', () => {
    const allowed = ['https://example.com', 'http://localhost:4173']
    expect(isOriginAllowed('https://example.com', allowed)).toBe(true)
    expect(isOriginAllowed('http://localhost:4173', allowed)).toBe(true)
    expect(isOriginAllowed('http://example.com', allowed)).toBe(false)
    expect(isOriginAllowed('https://example.com:8443', allowed)).toBe(false)
    expect(isOriginAllowed('', allowed)).toBe(false)
  })
})
