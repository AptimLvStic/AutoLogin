import { describe, expect, it } from 'vitest'
import { isTrashItemExpired } from '../../src/main/trash-retention'

const DAY_MS = 24 * 60 * 60 * 1000
const now = Date.parse('2026-11-04T12:00:00.000Z')

describe('trash retention', () => {
  it('expires accounts at the configured boundary', () => {
    expect(
      isTrashItemExpired(new Date(now - 3 * DAY_MS).toISOString(), 3, now)
    ).toBe(true)
    expect(
      isTrashItemExpired(new Date(now - 3 * DAY_MS + 1).toISOString(), 3, now)
    ).toBe(false)
  })

  it('keeps recent accounts and records with invalid timestamps', () => {
    expect(
      isTrashItemExpired(new Date(now - 6 * DAY_MS).toISOString(), 7, now)
    ).toBe(false)
    expect(isTrashItemExpired('not-a-date', 3, now)).toBe(false)
  })

  it('supports every retention option', () => {
    for (const days of [3, 7, 15, 30] as const) {
      expect(
        isTrashItemExpired(new Date(now - (days + 1) * DAY_MS).toISOString(), days, now)
      ).toBe(true)
    }
  })
})
