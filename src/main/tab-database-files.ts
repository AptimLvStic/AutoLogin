import { existsSync, mkdirSync, renameSync } from 'node:fs'
import { join } from 'node:path'
import {
  DATABASE_FILE_EXTENSIONS,
  databaseExtensionForTab,
  databaseFileNameFor,
  normalizeDatabaseName
} from '../shared/database-files'
import { DEFAULT_ACCOUNT_TAB_ID, type AccountTab, type VaultData } from '../shared/types'

export interface TabDatabaseMigrationIssue {
  tabId: string
  tabName: string
  message: string
}

export interface TabDatabaseMigrationResult {
  changed: boolean
  renamed: number
  issues: TabDatabaseMigrationIssue[]
}

export function migrateTabDatabaseFiles(
  data: VaultData,
  tabsDirectory: string
): TabDatabaseMigrationResult {
  mkdirSync(tabsDirectory, { recursive: true })
  const reservedFileNames = new Set<string>()
  const issues: TabDatabaseMigrationIssue[] = []
  let changed = false
  let renamed = 0

  for (const tab of data.tabs) {
    const extension = databaseExtensionForTab(tab)
    const legacyFileName = findLegacyDatabaseFileName(tab, tabsDirectory)
    const currentFileName = tab.databaseFileName ?? legacyFileName
    const currentPath = currentFileName
      ? join(tabsDirectory, currentFileName)
      : null
    const nextBaseName = uniqueDatabaseBaseName(
      tab.name,
      extension,
      tabsDirectory,
      reservedFileNames,
      currentPath
    )
    const nextFileName = databaseFileNameFor(nextBaseName, extension)
    const nextPath = join(tabsDirectory, nextFileName)

    if (nextBaseName !== tab.name) {
      tab.name = nextBaseName
      changed = true
    }
    if (tab.databaseFileName !== nextFileName) {
      tab.databaseFileName = nextFileName
      changed = true
    }
    reservedFileNames.add(nextFileName.toLocaleLowerCase())

    if (
      !currentPath ||
      !existsSync(currentPath) ||
      pathsEqual(currentPath, nextPath)
    ) {
      continue
    }

    try {
      renameSync(currentPath, nextPath)
      renamed += 1
    } catch (error) {
      tab.databaseFileName = currentFileName ?? undefined
      changed = true
      issues.push({
        tabId: tab.id,
        tabName: tab.name,
        message: error instanceof Error ? error.message : String(error)
      })
    }
  }

  return { changed, renamed, issues }
}

function findLegacyDatabaseFileName(
  tab: AccountTab,
  tabsDirectory: string
): string | null {
  const candidates = new Set<string>()
  if (tab.databaseFileName) candidates.add(tab.databaseFileName)
  candidates.add(
    databaseFileNameFor(tab.name, databaseExtensionForTab(tab))
  )
  for (const extension of DATABASE_FILE_EXTENSIONS) {
    candidates.add(`tab-${tab.id}${extension}`)
  }
  if (tab.id === DEFAULT_ACCOUNT_TAB_ID) {
    candidates.add('tab-local.autologin')
  }

  for (const candidate of candidates) {
    if (existsSync(join(tabsDirectory, candidate))) {
      return candidate
    }
  }
  return null
}

function uniqueDatabaseBaseName(
  requestedName: string,
  extension: string,
  tabsDirectory: string,
  reservedFileNames: Set<string>,
  currentPath: string | null
): string {
  const baseName = normalizeDatabaseName(requestedName)
  let sequence = 1

  while (true) {
    const suffix = sequence === 1 ? '' : ` ${sequence}`
    const candidate = `${baseName
      .slice(0, 40 - suffix.length)
      .trimEnd()}${suffix}`
    const candidateFileName = databaseFileNameFor(candidate, extension)
    const candidatePath = join(tabsDirectory, candidateFileName)
    const reserved = reservedFileNames.has(
      candidateFileName.toLocaleLowerCase()
    )
    const fileTaken =
      existsSync(candidatePath) &&
      (!currentPath || !pathsEqual(candidatePath, currentPath))

    if (!reserved && !fileTaken) return candidate
    sequence += 1
  }
}

function pathsEqual(left: string, right: string): boolean {
  return left.toLocaleLowerCase() === right.toLocaleLowerCase()
}
