import { describe, expect, it } from 'vitest'
import {
  createUpdateDownloadProgressTracker,
  trackUpdateDownloadProgress
} from '../../src/main/update-progress'

describe('differential update progress tracking', () => {
  it('detects a differential download falling back to the full installer', () => {
    const tracker = createUpdateDownloadProgressTracker()

    expect(
      trackUpdateDownloadProgress(tracker, {
        transferred: 320 * 1024,
        total: 10 * 1024 * 1024
      })
    ).toBe(false)
    expect(
      trackUpdateDownloadProgress(tracker, {
        transferred: 2 * 1024 * 1024,
        total: 128 * 1024 * 1024
      })
    ).toBe(true)
    expect(tracker.fallbackDetected).toBe(true)
  })

  it('does not flag a normal full download that starts from zero', () => {
    const tracker = createUpdateDownloadProgressTracker()

    expect(
      trackUpdateDownloadProgress(tracker, {
        transferred: 0,
        total: 128 * 1024 * 1024
      })
    ).toBe(false)
    expect(
      trackUpdateDownloadProgress(tracker, {
        transferred: 30 * 1024 * 1024,
        total: 128 * 1024 * 1024
      })
    ).toBe(false)
  })
})
