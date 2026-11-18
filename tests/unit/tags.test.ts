import { describe, expect, it } from 'vitest'
import { accountTags, accountTagsFromValues } from '@shared/tags'

describe('account status tags', () => {
  it('derives tags from explicit completion flags', () => {
    expect(
      accountTags(
        { startUrl: '', needsReview: false },
        { username: '', needsUsername: false, needsSecret: true }
      )
    ).toEqual(['needs-url', 'needs-username', 'needs-password'])
  })

  it('clears tags when all fields are present', () => {
    expect(
      accountTags(
        { startUrl: 'https://example.test/login', needsReview: false },
        { username: 'alice', needsUsername: false, needsSecret: false }
      )
    ).toEqual([])
  })

  it('uses the same rules for imported values', () => {
    expect(
      accountTagsFromValues({
        startUrl: 'https://example.test/login',
        username: 'alice',
        password: ''
      })
    ).toEqual(['needs-password'])
  })
})
