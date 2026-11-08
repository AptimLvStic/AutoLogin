import { copyFileSync, existsSync, mkdirSync } from 'node:fs'
import { basename, resolve } from 'node:path'

if (process.platform !== 'win32') {
  throw new Error('AutoLogin Tauri packaging currently targets Windows only')
}

const nodeSource = process.execPath
if (!existsSync(nodeSource)) {
  throw new Error(`Node runtime not found: ${nodeSource}`)
}

const targetDirectory = resolve('src-tauri/resources/bin')
const target = resolve(targetDirectory, 'node.exe')
mkdirSync(targetDirectory, { recursive: true })
copyFileSync(nodeSource, target)
console.log(`Prepared Tauri sidecar runtime from ${basename(nodeSource)} -> ${target}`)
