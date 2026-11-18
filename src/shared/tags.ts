import type { Account, Site } from './types'

export const ACCOUNT_TAG_KEYS = [
  'needs-url',
  'needs-username',
  'needs-password'
] as const

export type AccountTagKey = (typeof ACCOUNT_TAG_KEYS)[number]

type AccountTagSite = Pick<Site, 'startUrl' | 'needsReview'>
type AccountTagAccount = Pick<
  Account,
  'username' | 'needsUsername' | 'needsSecret'
>

export function accountTags(
  site: AccountTagSite,
  account: AccountTagAccount
): AccountTagKey[] {
  const tags: AccountTagKey[] = []
  if (site.needsReview || !site.startUrl.trim()) tags.push('needs-url')
  if (account.needsUsername || !account.username.trim()) {
    tags.push('needs-username')
  }
  if (account.needsSecret) tags.push('needs-password')
  return tags
}

export function accountTagsFromValues(input: {
  startUrl: string
  username: string
  password: string
}): AccountTagKey[] {
  const tags: AccountTagKey[] = []
  if (!input.startUrl.trim()) tags.push('needs-url')
  if (!input.username.trim()) tags.push('needs-username')
  if (!input.password.trim()) tags.push('needs-password')
  return tags
}
