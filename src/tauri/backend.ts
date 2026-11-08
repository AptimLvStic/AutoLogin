import { createInterface } from 'node:readline'
import {
  backendHandlerCount,
  dispatchBackendRequest
} from './electron-shim'

interface BackendRequest {
  id: number
  type: 'call'
  channel: string
  args?: unknown[]
}

interface BackendResponse {
  id: number
  ok: boolean
  result?: unknown
  error?: string
}

const originalConsole = {
  log: console.log,
  info: console.info,
  warn: console.warn
}

console.log = (...args: unknown[]): void => {
  console.error(...args)
}
console.info = (...args: unknown[]): void => {
  console.error(...args)
}
console.warn = (...args: unknown[]): void => {
  console.error(...args)
}

function write(message: unknown): void {
  process.stdout.write(`${JSON.stringify(message)}\n`)
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}

async function waitForBackend(): Promise<void> {
  const deadline = Date.now() + 10_000
  while (Date.now() < deadline) {
    if (backendHandlerCount() > 0) return
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 25))
  }
  throw new Error('Tauri 后端未完成初始化')
}

async function main(): Promise<void> {
  await import('../main/index')
  await waitForBackend()
  write({ type: 'ready', handlers: backendHandlerCount() })

  const input = createInterface({
    input: process.stdin,
    crlfDelay: Infinity
  })

  input.on('line', (line) => {
    let request: BackendRequest
    try {
      request = JSON.parse(line) as BackendRequest
    } catch {
      console.error('Ignoring malformed Tauri request')
      return
    }
    if (request.type !== 'call' || typeof request.channel !== 'string') {
      return
    }
    void dispatchBackendRequest(request.channel, request.args ?? [])
      .then((result) => {
        write({
          id: request.id,
          ok: true,
          result: result ?? null
        } satisfies BackendResponse)
      })
      .catch((error) => {
        write({
          id: request.id,
          ok: false,
          error: errorMessage(error)
        } satisfies BackendResponse)
      })
  })

  input.on('close', () => {
    originalConsole.info('Tauri backend input closed')
    process.exit(0)
  })
}

void main().catch((error) => {
  console.error('Tauri backend failed to start', error)
  process.exit(1)
})
