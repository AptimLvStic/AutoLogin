import { existsSync, mkdirSync, renameSync } from 'node:fs'
import { join } from 'node:path'
import {
  DATABASE_FILE_EXTENSIONS,
  DATABASE_FOLDERS,
  databaseExtensionForTab,
  databaseFileNameFor,
  databaseFolderForTab,
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
  const reservedFileNames = new Map<string, Set<string>>()
  const issues: TabDatabaseMigrationIssue[] = []
  let changed = false
  let renamed = 0

  for (const tab of data.tabs) {
    const extension = databaseExtensionForTab(tab)
    const folder = databaseFolderForTab(tab)
    const folderDirectory = join(tabsDirectory, folder)
    mkdirSync(folderDirectory, { recursive: true })

    const existingPath = findExistingDatabasePath(tab, tabsDirectory, extension)
    const currentFileName =
      existingPath?.fileName ??
      tab.databaseFileName ??
      findLegacyDatabaseFileName(tab, tabsDirectory, extension)
    const currentPath = existingPath?.path ?? null
    const folderReservations =
      reservedFileNames.get(folder) ?? new Set<string>()
    reservedFileNames.set(folder, folderReservations)

    const nextBaseName = uniqueDatabaseBaseName(
      tab.name,
      extension,
      folderDirectory,
      folderReservations,
      currentPath
    )
    const nextFileName = databaseFileNameFor(nextBaseName, extension)
    const nextPath = join(folderDirectory, nextFileName)

    if (nextBaseName !== tab.name) {
      tab.name = nextBaseName
      changed = true
    }
    if (tab.databaseFileName !== nextFileName) {
      tab.databaseFileName = nextFileName
      changed = true
    }
    folderReservations.add(nextFileName.toLocaleLowerCase())

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
      if (currentFileName) {
        tab.databaseFileName = currentFileName
        changed = true
      }
      issues.push({
        tabId: tab.id,
        tabName: tab.name,
        message: error instanceof Error ? error.message : String(error)
      })
    }
  }

  return { changed, renamed, issues }
}

interface ExistingDatabasePath {
  path: string
  fileName: string
}

function findExistingDatabasePath(
  tab: AccountTab,
  tabsDirectory: string,
  extension: string
): ExistingDatabasePath | null {
  const candidates = candidateFileNames(tab, extension)
  const folders = [...DATABASE_FOLDERS, '']
  for (const fileName of candidates) {
    for (const folder of folders) {
      const path = join(tabsDirectory, folder, fileName)
      if (existsSync(path)) {
        return { path, fileName }
      }
    }
  }
  return null
}

function findLegacyDatabaseFileName(
  tab: AccountTab,
  tabsDirectory: string,
  extension: string
): string | null {
  return findExistingDatabasePath(tab, tabsDirectory, extension)?.fileName ?? null
}

function candidateFileNames(tab: AccountTab, extension: string): string[] {
  const candidates = new Set<string>()
  if (tab.databaseFileName) candidates.add(tab.databaseFileName)
  candidates.add(databaseFileNameFor(tab.name, extension))
  for (const candidateExtension of DATABASE_FILE_EXTENSIONS) {
    candidates.add(`tab-${tab.id}${candidateExtension}`)
  }
  if (tab.id === DEFAULT_ACCOUNT_TAB_ID) {
    candidates.add('tab-local.autologin')
  }
  return [...candidates]
}

function uniqueDatabaseBaseName(
  requestedName: string,
  extension: string,
  folderDirectory: string,
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
    const candidatePath = join(folderDirectory, candidateFileName)
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
