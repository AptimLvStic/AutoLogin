import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { dirname, isAbsolute, join, parse, relative, resolve } from 'node:path'

const LOCATION_FILE = 'data-location.json'
const MANAGED_DATA_ENTRIES = [
  'vault.enc',
  'vault.enc.bak',
  'backups',
  'session-index.json',
  'BrowserProfiles',
  'Partitions',
  'logs'
] as const

interface DataLocationFile {
  version: 1
  directory: string
}

export function readDataDirectory(configDirectory: string): string {
  const pointerPath = join(configDirectory, LOCATION_FILE)
  if (!existsSync(pointerPath)) {
    return resolve(configDirectory)
  }

  try {
    const parsed = JSON.parse(readFileSync(pointerPath, 'utf8')) as Partial<DataLocationFile>
    if (
      parsed.version === 1 &&
      typeof parsed.directory === 'string' &&
      isAbsolute(parsed.directory)
    ) {
      return resolve(parsed.directory)
    }
  } catch {
    // A damaged location pointer falls back to the default data directory.
  }
  return resolve(configDirectory)
}

export function writeDataDirectory(configDirectory: string, dataDirectory: string): void {
  const pointerPath = join(configDirectory, LOCATION_FILE)
  const target = resolve(dataDirectory)
  const fallback = resolve(configDirectory)

  if (samePath(target, fallback)) {
    rmSync(pointerPath, { force: true })
    return
  }

  mkdirSync(configDirectory, { recursive: true })
  const tempPath = `${pointerPath}.${process.pid}.tmp`
  const payload: DataLocationFile = { version: 1, directory: target }
  writeFileSync(tempPath, JSON.stringify(payload), { encoding: 'utf8', mode: 0o600 })
  try {
    renameSync(tempPath, pointerPath)
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'EEXIST' || code === 'EPERM') {
      rmSync(pointerPath, { force: true })
      renameSync(tempPath, pointerPath)
    } else {
      rmSync(tempPath, { force: true })
      throw error
    }
  }
}

export function migrateDataDirectory(
  configDirectory: string,
  sourceDirectory: string,
  targetDirectory: string
): string {
  const source = resolve(sourceDirectory)
  const target = resolve(targetDirectory)
  if (samePath(source, target)) {
    return target
  }
  if (isNested(source, target) || isNested(target, source)) {
    throw new Error('新的数据目录不能位于当前数据目录内部，反之亦然')
  }
  if (samePath(target, parse(target).root)) {
    throw new Error('不能直接使用磁盘根目录作为数据目录')
  }

  mkdirSync(target, { recursive: true })
  const occupied = MANAGED_DATA_ENTRIES.some((entry) => existsSync(join(target, entry)))
  if (occupied) {
    throw new Error('目标目录已包含 AutoLogin 数据，请选择空目录')
  }

  for (const entry of MANAGED_DATA_ENTRIES) {
    const sourcePath = join(source, entry)
    if (!existsSync(sourcePath)) {
      continue
    }
    cpSync(sourcePath, join(target, entry), { recursive: true, preserveTimestamps: true })
  }

  writeDataDirectory(configDirectory, target)

  // The pointer is durable at this point. Remove the old managed copy so two
  // locations do not silently diverge after the app restarts.
  for (const entry of MANAGED_DATA_ENTRIES) {
    rmSync(join(source, entry), { recursive: true, force: true, maxRetries: 5, retryDelay: 150 })
  }
  return target
}

function samePath(left: string, right: string): boolean {
  return resolve(left).toLowerCase() === resolve(right).toLowerCase()
}

function isNested(parent: string, child: string): boolean {
  const path = relative(resolve(parent), resolve(child))
  return path !== '' && !path.startsWith('..') && !isAbsolute(path)
}
