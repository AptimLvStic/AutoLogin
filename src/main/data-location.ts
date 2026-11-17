import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs'
import { dirname, isAbsolute, join, parse, relative, resolve } from 'node:path'

const LOCATION_FILE = 'data-location.json'
const LOCATION_BACKUP_FILE = 'data-location.bak.json'
const BACKUP_LOCATION_FILE = 'backup-location.json'
const BACKUP_LOCATION_BACKUP_FILE = 'backup-location.bak.json'
const DATA_LOCATION_FILES = [LOCATION_FILE, LOCATION_BACKUP_FILE] as const
const BACKUP_LOCATION_FILES = [BACKUP_LOCATION_FILE, BACKUP_LOCATION_BACKUP_FILE] as const
const MANAGED_DATA_ENTRIES = [
  'vault.enc',
  'vault.enc.bak',
  'backups',
  'session-index.json',
  'BrowserProfiles',
  'Partitions',
  'tabs',
  'pending-recipes',
  'logs'
] as const
const CRITICAL_DATA_FILES = ['vault.enc', 'vault.enc.bak'] as const

interface DataLocationFile {
  version: 1
  directory: string
}

interface MigrateDataDirectoryOptions {
  replaceExisting?: boolean
  copyEntry?: (source: string, destination: string) => void
}

interface TreeMeasurement {
  files: number
  bytes: number
}

/** Counts regular files and total bytes so a partial copy can be detected. */
export function measureTree(target: string): TreeMeasurement {
  const stats = statSync(target)
  if (!stats.isDirectory()) {
    return { files: 1, bytes: stats.size }
  }
  let files = 0
  let bytes = 0
  for (const entry of readdirSync(target, { withFileTypes: true })) {
    const child = measureTree(join(target, entry.name))
    files += child.files
    bytes += child.bytes
  }
  return { files, bytes }
}

/**
 * Copies then verifies file count and byte size. A partial copy (full disk, or
 * an antivirus lock released after the copy started) would otherwise pass
 * silently, the pointer would move, and the source would be deleted — leaving
 * no complete vault on either side.
 */
export function copyVerified(
  from: string,
  to: string,
  copy: (source: string, destination: string) => void = (source, destination) => {
    cpSync(source, destination, { recursive: true, preserveTimestamps: true })
  }
): void {
  copy(from, to)
  const expected = measureTree(from)
  const actual = measureTree(to)
  if (expected.files !== actual.files || expected.bytes !== actual.bytes) {
    throw new Error('数据复制不完整，已保留原目录，请检查目标磁盘空间')
  }
}

export function readDataDirectory(
  configDirectory: string,
  additionalDirectories: string[] = [],
  defaultDirectory = configDirectory
): string {
  return (
    readLocationPointer(
      [configDirectory, ...additionalDirectories],
      DATA_LOCATION_FILES
    ) ?? resolve(defaultDirectory)
  )
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

export function readBackupDirectory(
  configDirectory: string,
  additionalDirectories: string[] = [],
  defaultDirectory = configDirectory
): string {
  return (
    readLocationPointer(
      [configDirectory, ...additionalDirectories],
      BACKUP_LOCATION_FILES
    ) ?? resolve(defaultDirectory)
  )
}

export function writeBackupDirectory(
  configDirectory: string,
  backupDirectory: string,
  defaultDirectory: string
): void {
  const pointerPath = join(configDirectory, BACKUP_LOCATION_FILE)
  const backupPointerPath = join(configDirectory, BACKUP_LOCATION_BACKUP_FILE)
  const target = resolve(backupDirectory)
  const fallback = resolve(defaultDirectory)

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

export function defaultDataDirectoryForExecutable(executablePath: string): string {
  const installDirectory = dirname(resolve(executablePath))
  return join(dirname(installDirectory), 'AutoLogin-Data')
}

export function migrateLegacyDefaultDataDirectory(
  pointerDirectory: string,
  legacyDirectory: string,
  defaultDirectory: string
): string {
  const legacy = resolve(legacyDirectory)
  const target = resolve(defaultDirectory)
  if (samePath(legacy, target)) {
    return target
  }
  if (hasVault(target) || !hasManagedDataDirectory(legacy)) {
    return target
  }
  if (hasManagedDataDirectory(target)) {
    return legacy
  }
  try {
    migrateDataDirectory(pointerDirectory, legacy, target)
    return target
  } catch {
    const committed = readDataDirectory(pointerDirectory, [], legacy)
    return hasVault(committed) ? committed : legacy
  }
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
  targetDirectory: string,
  options: MigrateDataDirectoryOptions = {}
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
    if (!options.replaceExisting) {
      throw new Error('目标目录已包含 AutoLogin 数据，请选择加载旧数据或备份后覆盖')
    }
    backupTargetData(target)
  }

  const copiedTargetEntries: string[] = []
  try {
    for (const entry of MANAGED_DATA_ENTRIES) {
      const sourcePath = join(source, entry)
      if (!existsSync(sourcePath)) {
        continue
      }
      const targetPath = join(target, entry)
      copiedTargetEntries.push(targetPath)
      copyVerified(sourcePath, targetPath, options.copyEntry)
    }
    verifyCriticalDataFiles(source, target)
  } catch (error) {
    // The pointer has not moved yet. Remove only this attempt's target copies
    // so the source remains the single authoritative and retryable copy.
    for (const targetPath of copiedTargetEntries.reverse()) {
      try {
        rmSync(targetPath, { recursive: true, force: true })
      } catch {
        // Preserve the original copy/verification error.
      }
    }
    throw error
  }

  writeDataDirectory(configDirectory, target)

  // The pointer is durable at this point. Remove the old managed copy so two
  // locations do not silently diverge after the app restarts.
  for (const entry of MANAGED_DATA_ENTRIES) {
    rmSync(join(source, entry), { recursive: true, force: true, maxRetries: 5, retryDelay: 150 })
  }
  return target
}

function verifyCriticalDataFiles(source: string, target: string): void {
  for (const entry of CRITICAL_DATA_FILES) {
    const sourcePath = join(source, entry)
    if (!existsSync(sourcePath)) {
      continue
    }
    const targetPath = join(target, entry)
    try {
      const sourceBytes = readFileSync(sourcePath)
      const targetBytes = readFileSync(targetPath)
      if (!sourceBytes.equals(targetBytes)) {
        throw new Error(`${entry} 内容校验失败，已保留原目录`)
      }
    } catch (error) {
      if (error instanceof Error && error.message.includes('已保留原目录')) {
        throw error
      }
      throw new Error(`无法读取复制后的关键数据文件 ${entry}，已保留原目录`)
    }
  }
}

export function recoverDataDirectoryFromInstall(
  configDirectory: string,
  currentDirectory: string,
  installDirectory: string,
  pointerDirectory = configDirectory,
  stableDirectory = join(resolve(configDirectory), 'Data')
): string {
  const current = resolve(currentDirectory)
  const install = resolve(installDirectory)
  const stable = resolve(stableDirectory)
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

  const target = hasManagedDataDirectory(stable)
    ? nextRecoveryDirectory(configDirectory)
    : stable
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

function readLocationPointer(
  directories: string[],
  fileNames: readonly string[]
): string | null {
  for (const directory of directories) {
    for (const fileName of fileNames) {
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
  return null
}

export function hasManagedDataDirectory(directory: string): boolean {
  return MANAGED_DATA_ENTRIES.some((entry) => existsSync(join(resolve(directory), entry)))
}

function backupTargetData(targetDirectory: string): string {
  const target = resolve(targetDirectory)
  const entries = readdirSync(target)
  const backupDirectory = nextBackupDirectory(target)
  mkdirSync(backupDirectory, { recursive: true })
  for (const entry of entries) {
    renameSync(join(target, entry), join(backupDirectory, entry))
  }
  return backupDirectory
}

function nextBackupDirectory(targetDirectory: string): string {
  const now = new Date()
  const stamp = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0'),
    '_',
    String(now.getHours()).padStart(2, '0'),
    String(now.getMinutes()).padStart(2, '0'),
    String(now.getSeconds()).padStart(2, '0')
  ].join('')
  let candidate = join(resolve(targetDirectory), `旧数据备份_${stamp}`)
  let sequence = 2
  while (existsSync(candidate)) {
    candidate = join(resolve(targetDirectory), `旧数据备份_${stamp}_${sequence}`)
    sequence += 1
  }
  return candidate
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
  while (hasManagedDataDirectory(candidate)) {
    candidate = join(resolve(configDirectory), `Data-recovered-${stamp}-${sequence}`)
    sequence += 1
  }
  return candidate
}
