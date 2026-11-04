import type { TrashRetentionDays } from '@shared/types'

const DAY_MS = 24 * 60 * 60 * 1000

export function isTrashItemExpired(
  deletedAt: string,
  retentionDays: TrashRetentionDays,
  now = Date.now()
): boolean {
  const timestamp = new Date(deletedAt).getTime()
  if (Number.isNaN(timestamp)) return false
  return timestamp <= now - retentionDays * DAY_MS
}
