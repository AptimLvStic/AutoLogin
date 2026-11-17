import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  markChannel,
  markStage,
  runtimeTrace,
  startBlockWatchdog
} from '../../src/main/block-watchdog'

afterEach(() => {
  vi.useRealTimers()
  runtimeTrace.stage = ''
  runtimeTrace.channel = ''
  runtimeTrace.at = 0
})

describe('block watchdog', () => {
  it('reports the stalled stage and backend channel after the event loop resumes', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-11-17T02:45:00.000Z'))
    markStage('vault.saveAsync 序列化与备份')
    markChannel('login:finish-recording')
    const report = vi.fn()
    const stop = startBlockWatchdog(report)

    await vi.advanceTimersByTimeAsync(100)
    expect(report).not.toHaveBeenCalled()

    vi.setSystemTime(Date.now() + 2_000)
    await vi.advanceTimersByTimeAsync(50)

    expect(report).toHaveBeenCalledOnce()
    expect(report.mock.calls[0]?.[0]).toBeGreaterThanOrEqual(1_900)
    expect(report.mock.calls[0]?.[1]).toMatchObject({
      stage: 'vault.saveAsync 序列化与备份',
      channel: 'login:finish-recording'
    })
    stop()
  })

  it('stops reporting after cleanup', async () => {
    vi.useFakeTimers()
    const report = vi.fn()
    const stop = startBlockWatchdog(report)
    stop()

    vi.setSystemTime(Date.now() + 5_000)
    await vi.advanceTimersByTimeAsync(100)

    expect(report).not.toHaveBeenCalled()
  })
})
