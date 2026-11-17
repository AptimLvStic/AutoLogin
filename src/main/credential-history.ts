import { randomUUID } from 'node:crypto'
import { Buffer } from 'node:buffer'
import {
  CREDENTIAL_HISTORY_MAX_ENTRIES,
  CURRENT_CREDENTIAL_VERSION_ID,
  type CredentialHistoryEntry,
  type CredentialHistoryField,
  type CredentialHistoryReveal,
  type CredentialVersionSnapshot,
  type StoredAccount
} from '../shared/types'

export function recordCredentialSnapshot(account: StoredAccount, changedAt: string): void {
  const snapshot: CredentialVersionSnapshot = {
    id: randomUUID(),
    username: account.username,
    password: account.password,
    validFrom: credentialValidFrom(account),
    validUntil: changedAt
  }
  account.credentialHistory = [
    ...(account.credentialHistory ?? []),
    snapshot
  ].slice(-CREDENTIAL_HISTORY_MAX_ENTRIES)
}

export function listCredentialHistory(
  account: StoredAccount,
  now = new Date().toISOString()
): CredentialHistoryEntry[] {
  const timeline = credentialTimeline(account, now)
  return timeline.map((entry, index) => {
    const older = timeline[index + 1]
    const current = index === 0
    return {
      id: entry.id,
      current,
      validFrom: entry.validFrom,
      ...(current ? {} : { validUntil: entry.validUntil }),
      changedFields: older ? changedFieldsBetween(entry, older) : [],
      sizeBytes: Buffer.byteLength(entry.username) + Buffer.byteLength(entry.password)
    }
  })
}

export function revealCredentialHistory(
  account: StoredAccount,
  historyId: string
): CredentialHistoryReveal {
  const entry =
    historyId === CURRENT_CREDENTIAL_VERSION_ID
      ? {
          username: account.username,
          password: account.password
        }
      : account.credentialHistory?.find((version) => version.id === historyId)
  if (!entry) {
    throw new Error('历史凭据版本不存在')
  }
  return {
    username: entry.username,
    password: entry.password
  }
}

export function restoreCredentialHistory(
  account: StoredAccount,
  historyId: string,
  changedAt: string
): boolean {
  const version = account.credentialHistory?.find((entry) => entry.id === historyId)
  if (!version) {
    throw new Error('历史凭据版本不存在')
  }
  if (account.username === version.username && account.password === version.password) {
    return false
  }
  recordCredentialSnapshot(account, changedAt)
  account.username = version.username
  account.password = version.password
  account.credentialUpdatedAt = changedAt
  if (!account.credentialHistory?.some((entry) => entry.id === version.id)) {
    account.credentialHistory = [
      ...(account.credentialHistory ?? []),
      version
    ].slice(-CREDENTIAL_HISTORY_MAX_ENTRIES)
  }
  return true
}

export function deleteCredentialHistoryEntry(
  account: StoredAccount,
  historyId: string
): boolean {
  const before = account.credentialHistory?.length ?? 0
  account.credentialHistory = (account.credentialHistory ?? []).filter(
    (entry) => entry.id !== historyId
  )
  return account.credentialHistory.length !== before
}

export function clearCredentialHistory(account: StoredAccount): number {
  const removed = account.credentialHistory?.length ?? 0
  account.credentialHistory = []
  return removed
}

function credentialTimeline(
  account: StoredAccount,
  now: string
): CredentialVersionSnapshot[] {
  const history = [...(account.credentialHistory ?? [])].sort(
    (left, right) => timeValue(right.validUntil) - timeValue(left.validUntil)
  )
  return [
    {
      id: CURRENT_CREDENTIAL_VERSION_ID,
      username: account.username,
      password: account.password,
      validFrom: credentialValidFrom(account),
      validUntil: now
    },
    ...history
  ]
}

function credentialValidFrom(account: StoredAccount): string {
  return account.credentialUpdatedAt ?? account.updatedAt ?? account.createdAt
}

function changedFieldsBetween(
  newer: CredentialVersionSnapshot,
  older: CredentialVersionSnapshot
): CredentialHistoryField[] {
  const fields: CredentialHistoryField[] = []
  if (newer.username !== older.username) fields.push('username')
  if (newer.password !== older.password) fields.push('password')
  return fields
}

function timeValue(value: string): number {
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : 0
}
