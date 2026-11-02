import { describe, expect, it } from 'vitest'
import {
  accountCreateInputSchema,
  masterPasswordSchema,
  siteInputSchema
} from '../../src/shared/schemas'

describe('shared input schemas', () => {
  it('accepts only http and https site URLs', () => {
    expect(
      siteInputSchema.safeParse({
        name: 'Safe site',
        startUrl: 'https://example.com/login',
        autoSubmit: true
      }).success
    ).toBe(true)
    expect(
      siteInputSchema.safeParse({
        name: 'Unsafe site',
        startUrl: 'javascript:alert(1)',
        autoSubmit: true
      }).success
    ).toBe(false)
  })

  it('requires a meaningful master password and account password', () => {
    expect(masterPasswordSchema.safeParse('short').success).toBe(false)
    expect(masterPasswordSchema.safeParse('long enough password').success).toBe(true)
    expect(
      accountCreateInputSchema.safeParse({
        siteId: 'site-1',
        label: 'Main',
        username: 'user',
        password: ''
      }).success
    ).toBe(false)
  })

})
