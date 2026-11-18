import {
  existsSync,
  readFileSync,
  readdirSync,
  statSync
} from 'node:fs'
import { join, resolve } from 'node:path'

const root = process.cwd()
const backendPath = resolve(root, 'dist-backend/backend.cjs')
const sourceRoots = [
  resolve(root, 'src/agent'),
  resolve(root, 'src/main'),
  resolve(root, 'src/shared'),
  resolve(root, 'src/tauri')
]
const requiredMarkers = [
  '2026-11-18.browser-layout-and-import-result',
  'openDraftSession',
  'appendDraftStep',
  'recoverDraftSession',
  'startBlockWatchdog'
]

if (!existsSync(backendPath)) {
  throw new Error('dist-backend/backend.cjs 不存在，请先运行 npm run build:backend')
}

function latestSourceTimestamp(directory) {
  let latest = 0
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) {
      latest = Math.max(latest, latestSourceTimestamp(path))
      continue
    }
    if (!entry.name.endsWith('.ts')) continue
    latest = Math.max(latest, statSync(path).mtimeMs)
  }
  return latest
}

const latestSource = Math.max(...sourceRoots.map(latestSourceTimestamp))
const backendStat = statSync(backendPath)
if (backendStat.mtimeMs + 1 < latestSource) {
  throw new Error(
    `dist-backend/backend.cjs 已过期：后台 ${new Date(
      backendStat.mtimeMs
    ).toISOString()}，源码 ${new Date(latestSource).toISOString()}`
  )
}

const contents = readFileSync(backendPath, 'utf8')
const missing = requiredMarkers.filter((marker) => !contents.includes(marker))
if (missing.length > 0) {
  throw new Error(`Tauri 后台产物缺少关键修复：${missing.join('、')}`)
}

console.log(
  `Verified dist-backend/backend.cjs (${backendStat.size} bytes, ${new Date(
    backendStat.mtimeMs
  ).toISOString()})`
)
