/**
 * 主进程事件循环看门狗。
 *
 * 背景：录制保存时出现过主进程整体无响应（连轻量的状态查询 IPC 都超时），
 * 但日志在关键位置是空白的 —— 因为同步阻塞期间任何写日志的代码也跑不到。
 *
 * 做法：用一个 50ms 的心跳。若某次心跳的实际间隔远超 50ms，说明事件循环
 * 在这段时间里被同步代码占住；恢复后立刻把「阻塞时长 + 当时正在做的事」写进
 * 日志。这样即使卡死，重启后也能从日志读到答案，不需要人工抓栈。
 */

/** 关键路径上的运行痕迹，供看门狗在阻塞恢复时输出。 */
export const runtimeTrace = {
  /** 当前所处阶段，例如「写入保险库」「捕获页面表单」。 */
  stage: '',
  /** 最近一次进入的 IPC 通道。 */
  channel: '',
  /** 最近一次标记的时间戳。 */
  at: 0
}

export function markStage(stage: string): void {
  runtimeTrace.stage = stage
  runtimeTrace.at = Date.now()
}

export function markChannel(channel: string): void {
  runtimeTrace.channel = channel
  runtimeTrace.at = Date.now()
}

const HEARTBEAT_MS = 50
/** 超过这个延迟才认为是真实阻塞，避免误报 GC 抖动。 */
const BLOCK_THRESHOLD_MS = 1_500

/**
 * 启动看门狗。`report` 在检测到阻塞并恢复后被调用一次。
 * 返回停止函数，便于测试或退出时清理。
 */
export function startBlockWatchdog(
  report: (durationMs: number, trace: typeof runtimeTrace) => void
): () => void {
  let last = Date.now()
  let maxDuration = 0
  const timer = setInterval(() => {
    const now = Date.now()
    const gap = now - last - HEARTBEAT_MS
    last = now
    if (gap < BLOCK_THRESHOLD_MS) {
      return
    }
    maxDuration = Math.max(maxDuration, gap)
    // 阻塞期间 runtimeTrace 不会被更新，因此它反映的是「阻塞发生时」的状态。
    report(gap, { ...runtimeTrace })
  }, HEARTBEAT_MS)
  timer.unref()
  return () => clearInterval(timer)
}
