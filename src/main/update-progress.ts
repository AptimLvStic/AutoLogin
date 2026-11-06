export const DIFFERENTIAL_FALLBACK_MESSAGE =
  '增量更新失败，正在下载完整安装包…'

export interface UpdateDownloadProgressTracker {
  initialTotal: number | null
  previousTotal: number | null
  previousTransferred: number | null
  fallbackDetected: boolean
}

export interface UpdateDownloadProgressSample {
  transferred: number
  total: number
}

export function createUpdateDownloadProgressTracker(): UpdateDownloadProgressTracker {
  return {
    initialTotal: null,
    previousTotal: null,
    previousTransferred: null,
    fallbackDetected: false
  }
}

export function trackUpdateDownloadProgress(
  tracker: UpdateDownloadProgressTracker,
  sample: UpdateDownloadProgressSample
): boolean {
  if (!Number.isFinite(sample.total) || sample.total <= 0) {
    return tracker.fallbackDetected
  }

  const transferred = Math.max(0, sample.transferred)
  if (tracker.initialTotal === null) {
    tracker.initialTotal = sample.total
  } else if (
    !tracker.fallbackDetected &&
    tracker.previousTotal !== null &&
    tracker.previousTransferred !== null &&
    sample.total > tracker.previousTotal * 2 &&
    sample.total - tracker.previousTotal >= 5 * 1024 * 1024 &&
    transferred / sample.total <
      tracker.previousTransferred / tracker.previousTotal - 0.005
  ) {
    // electron-updater reports the delta size for differential downloads and
    // then restarts progress from zero with the full installer size.
    tracker.fallbackDetected = true
  }

  tracker.previousTotal = sample.total
  tracker.previousTransferred = transferred
  return tracker.fallbackDetected
}
