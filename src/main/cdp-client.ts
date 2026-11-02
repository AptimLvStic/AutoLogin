interface CdpResponse {
  id?: number
  result?: unknown
  error?: { message?: string }
  method?: string
  params?: Record<string, unknown>
  sessionId?: string
}

interface PendingCommand {
  resolve: (value: unknown) => void
  reject: (error: Error) => void
  timer: NodeJS.Timeout
}

export class CdpClient {
  private readonly pending = new Map<number, PendingCommand>()
  private nextId = 1
  private closed = false

  private constructor(
    private readonly socket: WebSocket,
    private readonly onEvent: (
      method: string,
      params: Record<string, unknown>,
      sessionId?: string
    ) => void,
    private readonly onClose: () => void
  ) {
    socket.addEventListener('message', (event) => {
      void this.handleMessage(event.data)
    })
    socket.addEventListener('close', () => {
      this.closed = true
      this.rejectPending(new Error('浏览器调试连接已关闭'))
      this.onClose()
    })
    socket.addEventListener('error', () => {
      this.rejectPending(new Error('浏览器调试连接异常'))
    })
  }

  static connect(
    url: string,
    onEvent: (
      method: string,
      params: Record<string, unknown>,
      sessionId?: string
    ) => void,
    onClose: () => void,
    timeoutMilliseconds = 10_000
  ): Promise<CdpClient> {
    return new Promise((resolve, reject) => {
      const socket = new WebSocket(url)
      const timer = setTimeout(() => {
        socket.close()
        reject(new Error('连接默认浏览器超时'))
      }, timeoutMilliseconds)

      socket.addEventListener(
        'open',
        () => {
          clearTimeout(timer)
          resolve(new CdpClient(socket, onEvent, onClose))
        },
        { once: true }
      )
      socket.addEventListener(
        'error',
        () => {
          clearTimeout(timer)
          reject(new Error('无法连接默认浏览器调试端口'))
        },
        { once: true }
      )
    })
  }

  async send<T = Record<string, unknown>>(
    method: string,
    params: Record<string, unknown> = {},
    sessionId?: string,
    timeoutMilliseconds = 10_000
  ): Promise<T> {
    if (this.closed) {
      throw new Error('浏览器调试连接已关闭')
    }
    const id = this.nextId++
    const payload: Record<string, unknown> = { id, method, params }
    if (sessionId) {
      payload.sessionId = sessionId
    }
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`浏览器命令超时：${method}`))
      }, timeoutMilliseconds)
      timer.unref()
      this.pending.set(id, {
        resolve: (value) => resolve(value as T),
        reject,
        timer
      })
      try {
        this.socket.send(JSON.stringify(payload))
      } catch {
        clearTimeout(timer)
        this.pending.delete(id)
        reject(new Error('无法向默认浏览器发送命令'))
      }
    })
  }

  close(): void {
    if (this.closed) {
      return
    }
    this.closed = true
    this.rejectPending(new Error('浏览器调试连接已关闭'))
    try {
      this.socket.close()
    } catch {
      // The browser may already have closed its debugging socket.
    }
  }

  private async handleMessage(raw: unknown): Promise<void> {
    let text: string
    if (typeof raw === 'string') {
      text = raw
    } else if (raw instanceof Blob) {
      text = await raw.text()
    } else if (raw instanceof ArrayBuffer) {
      text = new TextDecoder().decode(raw)
    } else {
      return
    }

    let message: CdpResponse
    try {
      message = JSON.parse(text) as CdpResponse
    } catch {
      return
    }

    if (typeof message.id === 'number') {
      const pending = this.pending.get(message.id)
      if (!pending) {
        return
      }
      clearTimeout(pending.timer)
      this.pending.delete(message.id)
      if (message.error) {
        pending.reject(new Error(message.error.message || '浏览器命令执行失败'))
      } else {
        pending.resolve(message.result ?? {})
      }
      return
    }

    if (message.method) {
      this.onEvent(message.method, message.params ?? {}, message.sessionId)
    }
  }

  private rejectPending(error: Error): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer)
      pending.reject(error)
    }
    this.pending.clear()
  }
}
