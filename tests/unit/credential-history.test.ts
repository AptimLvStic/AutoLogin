import { describe, expect, it } from 'vitest'
import {
  clearCredentialHistory,
  deleteCredentialHistoryEntry,
  listCredentialHistory,
  recordCredentialSnapshot,
  restoreCredentialHistory,
  revealCredentialHistory
} from '../../src/main/credential-history'
import {
  CREDENTIAL_HISTORY_MAX_ENTRIES,
  CURRENT_CREDENTIAL_VERSION_ID,
  type StoredAccount
} from '../../src/shared/types'

function account(): StoredAccount {
  return {
    id: 'account-1',
    tabId: 'local',
    siteId: 'site-1',
    label: 'Example',
    username: 'old-user',
    password: 'old-password',
    favorite: false,
    loginStrategy: 'auto',
    loginBrowser: 'standalone',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-02T00:00:00.000Z',
    credentialUpdatedAt: '2026-01-02T00:00:00.000Z'
  }
}

describe('credential history', () => {
  it('records the previous credentials and reports the changed fields', () => {
    const stored = account()
    recordCredentialSnapshot(stored, '2026-02-01T00:00:00.000Z')
    stored.username = 'new-user'
    stored.password = 'new-password'

    const entries = listCredentialHistory(stored, '2026-02-02T00:00:00.000Z')

    expect(entries).toHaveLength(2)
    expect(entries[0]).toMatchObject({
      id: CURRENT_CREDENTIAL_VERSION_ID,
      current: true,
      changedFields: ['username', 'password']
    })
    expect(entries[1]).toMatchObject({
      current: false,
      changedFields: []
    })
    expect(revealCredentialHistory(stored, entries[1]!.id)).toEqual({
      username: 'old-user',
      password: 'old-password'
    })
  })

  it('records the current credentials before restoring a historical version', () => {
    const stored = account()
    recordCredentialSnapshot(stored, '2026-02-01T00:00:00.000Z')
    const oldVersionId = stored.credentialHistory![0]!.id
    stored.username = 'new-user'
    stored.password = 'new-password'
    stored.credentialUpdatedAt = '2026-02-01T00:00:00.000Z'

    expect(
      restoreCredentialHistory(stored, oldVersionId, '2026-03-01T00:00:00.000Z')
    ).toBe(true)

    expect(stored.username).toBe('old-user')
    expect(stored.password).toBe('old-password')
    expect(stored.credentialHistory).toHaveLength(2)
    expect(
      stored.credentialHistory?.some(
        (entry) => entry.username === 'new-user' && entry.password === 'new-password'
      )
    ).toBe(true)
  })

  it('deletes one or all historical versions without changing current credentials', () => {
    const stored = account()
    recordCredentialSnapshot(stored, '2026-02-01T00:00:00.000Z')
    const firstId = stored.credentialHistory![0]!.id
    stored.username = 'second-user'
    stored.password = 'second-password'
    recordCredentialSnapshot(stored, '2026-03-01T00:00:00.000Z')

    expect(deleteCredentialHistoryEntry(stored, firstId)).toBe(true)
    expect(stored.credentialHistory).toHaveLength(1)
    expect(clearCredentialHistory(stored)).toBe(1)
    expect(stored.credentialHistory).toEqual([])
    expect(stored.username).toBe('second-user')
    expect(stored.password).toBe('second-password')
  })

  it('keeps history bounded while preserving the newest versions', () => {
    const stored = account()
    for (let index = 0; index < CREDENTIAL_HISTORY_MAX_ENTRIES + 5; index += 1) {
      stored.username = `user-${index}`
      stored.password = `password-${index}`
      recordCredentialSnapshot(stored, new Date(2026, 0, index + 1).toISOString())
    }

    expect(stored.credentialHistory).toHaveLength(CREDENTIAL_HISTORY_MAX_ENTRIES)
    expect(stored.credentialHistory?.at(-1)?.username).toBe(
      `user-${CREDENTIAL_HISTORY_MAX_ENTRIES + 4}`
    )
  })
})
