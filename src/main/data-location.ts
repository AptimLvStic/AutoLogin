import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs'
import { dirname, isAbsolute, join, parse, relative, resolve } from 'node:path'

const LOCATION_FILE = 'data-location.json'
const LOCATION_BACKUP_FILE = 'data-location.bak.json'
const MANAGED_DATA_ENTRIES = [
  'vault.enc',
  'vault.enc.bak',
  'backups',
  'session-index.json',
  'BrowserProfiles',
  'Partitions',
  'tabs',
  'logs'
] as const

interface DataLocationFile {
  version: 1
  directory: string
}

export function readDataDirectory(
  configDirectory: string,
  additionalDirectories: string[] = [],
  defaultDirectory = configDirectory
): string {
  for (const directory of [configDirectory, ...additionalDirectories]) {
    for (const fileName of [LOCATION_FILE, LOCATION_BACKUP_FILE]) {
      const pointerPath = join(directory, fileName)
      if (!existsSync(pointerPath)) continue
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
        // A damaged location pointer falls back to the next durable copy.
      }
    }
  }
  return resolve(defaultDirectory)
}

export function writeDataDirectory(configDirectory: string, dataDirectory: string): void {
  const pointerPath = join(configDirectory, LOCATION_FILE)
  const backupPointerPath = join(configDirectory, LOCATION_BACKUP_FILE)
  const target = resolve(dataDirectory)
  const fallback = resolve(configDirectory)

  if (samePath(target, fallback)) {
    rmSync(pointerPath, { force: true })
    rmSync(backupPointerPath, { force: true })
    return
  }

  mkdirSync(configDirectory, { recursive: true })
  const payload: DataLocationFile = { version: 1, directory: target }
  writeAtomicPointer(backupPointerPath, JSON.stringify(payload))
  writeAtomicPointer(pointerPath, JSON.stringify(payload))
}

function writeAtomicPointer(pointerPath: string, payload: string): void {
  const tempPath = `${pointerPath}.${process.pid}.tmp`
  writeFileSync(tempPath, payload, { encoding: 'utf8', mode: 0o600 })
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

export function recoverDataDirectoryFromInstall(
  configDirectory: string,
  currentDirectory: string,
  installDirectory: string,
  pointerDirectory = configDirectory
): string {
  const current = resolve(currentDirectory)
  const install = resolve(installDirectory)
  const stable = join(resolve(configDirectory), 'Data')
  const currentIsInstalled = isNested(install, current) || samePath(install, current)

  if (!currentIsInstalled) {
    return current
  }

  if (hasVault(stable)) {
    const currentFreshness = vaultFreshness(current)
    const stableFreshness = vaultFreshness(stable)
    if (currentFreshness > 0 && currentFreshness > stableFreshness + 1_000) {
      const recovered = nextRecoveryDirectory(configDirectory)
      try {
        migrateDataDirectory(pointerDirectory, current, recovered)
        return recovered
      } catch {
        return current
      }
    }
    writeDataDirectory(pointerDirectory, stable)
    return stable
  }

  const source = hasVault(current) ? current : hasVault(install) ? install : ''
  if (!source) {
    return current
  }

  const target = hasManagedData(stable) ? nextRecoveryDirectory(configDirectory) : stable
  try {
    migrateDataDirectory(pointerDirectory, source, target)
    return target
  } catch {
    return source
  }
}

export function pathIsInside(parentDirectory: string, childDirectory: string): boolean {
  return (
    isNested(resolve(parentDirectory), resolve(childDirectory)) ||
    samePath(parentDirectory, childDirectory)
  )
}

function samePath(left: string, right: string): boolean {
  return resolve(left).toLowerCase() === resolve(right).toLowerCase()
}

function isNested(parent: string, child: string): boolean {
  const path = relative(resolve(parent), resolve(child))
  return path !== '' && !path.startsWith('..') && !isAbsolute(path)
}

function hasVault(directory: string): boolean {
  return existsSync(join(resolve(directory), 'vault.enc'))
}

function hasManagedData(directory: string): boolean {
  return MANAGED_DATA_ENTRIES.some((entry) => existsSync(join(resolve(directory), entry)))
}

function vaultFreshness(directory: string): number {
  try {
    return statSync(join(resolve(directory), 'vault.enc')).mtimeMs
  } catch {
    return 0
  }
}

function nextRecoveryDirectory(configDirectory: string): string {
  const stamp = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)
  let candidate = join(resolve(configDirectory), `Data-recovered-${stamp}`)
  let sequence = 2
  while (hasManagedData(candidate)) {
    candidate = join(resolve(configDirectory), `Data-recovered-${stamp}-${sequence}`)
    sequence += 1
  }
  return candidate
}
