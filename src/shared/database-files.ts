import type { AccountTab, AccountTabSource } from './types'

export const DATABASE_FILE_EXTENSIONS = [
  '.autologin',
  '.kdbx',
  '.csv',
  '.html',
  '.htm'
] as const

export const DATABASE_FOLDERS = [
  'autologin',
  'kdbx',
  'csv',
  'bookmarks'
] as const

export type DatabaseFolder = (typeof DATABASE_FOLDERS)[number]

const SOURCE_EXTENSIONS: Record<AccountTabSource, string> = {
  local: '.autologin',
  autologin: '.autologin',
  kdbx: '.kdbx',
  csv: '.csv',
  bookmarks: '.html'
}

const SOURCE_FOLDERS: Record<AccountTabSource, DatabaseFolder> = {
  local: 'autologin',
  autologin: 'autologin',
  kdbx: 'kdbx',
  csv: 'csv',
  bookmarks: 'bookmarks'
}

const WINDOWS_RESERVED_NAMES = new Set([
  'CON',
  'PRN',
  'AUX',
  'NUL',
  ...Array.from({ length: 9 }, (_, index) => `COM${index + 1}`),
  ...Array.from({ length: 9 }, (_, index) => `LPT${index + 1}`)
])

export function extensionFromDatabaseFileName(fileName?: string): string {
  if (!fileName) return ''
  const normalized = fileName.trim().toLocaleLowerCase()
  return (
    DATABASE_FILE_EXTENSIONS.find((extension) =>
      normalized.endsWith(extension)
    ) ?? ''
  )
}

export function databaseNameFromFileName(fileName: string): string {
  const extension = extensionFromDatabaseFileName(fileName)
  return extension ? fileName.slice(0, -extension.length) : fileName
}

export function databaseExtensionForSource(
  source: AccountTabSource,
  originalFileName?: string
): string {
  const originalExtension = extensionFromDatabaseFileName(originalFileName)
  if (originalExtension) {
    if (source === 'kdbx' && originalExtension === '.kdbx') {
      return originalExtension
    }
    if (source === 'csv' && originalExtension === '.csv') {
      return originalExtension
    }
    if (
      source === 'bookmarks' &&
      (originalExtension === '.html' || originalExtension === '.htm')
    ) {
      return originalExtension
    }
    if (source === 'autologin' && originalExtension === '.autologin') {
      return originalExtension
    }
  }
  return SOURCE_EXTENSIONS[source]
}

export function databaseExtensionForTab(tab: AccountTab): string {
  return (
    extensionFromDatabaseFileName(tab.databaseFileName) ||
    databaseExtensionForSource(tab.source)
  )
}

export function databaseFolderForSource(source: AccountTabSource): DatabaseFolder {
  return SOURCE_FOLDERS[source]
}

export function databaseFolderForTab(tab: AccountTab): DatabaseFolder {
  return databaseFolderForSource(tab.source)
}

export function shouldWriteEncryptedTabSnapshot(tab: AccountTab): boolean {
  return tab.source === 'local' || tab.source === 'autologin'
}

export function normalizeDatabaseName(value: string): string {
  let normalized = value
    .normalize('NFKC')
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-')
    .replace(/[. ]+$/g, '')
    .trim()
    .slice(0, 40)

  if (!normalized) normalized = 'database'
  const stem = normalized.split('.')[0]?.toLocaleUpperCase() ?? ''
  if (WINDOWS_RESERVED_NAMES.has(stem)) {
    normalized = `_${normalized}`.slice(0, 40)
  }
  return normalized
}

export function isDatabaseNameFileSafe(value: string): boolean {
  const trimmed = value.trim()
  return (
    trimmed.length >= 1 &&
    trimmed.length <= 40 &&
    normalizeDatabaseName(trimmed) === trimmed
  )
}

export function databaseFileNameFor(
  name: string,
  extension: string
): string {
  const normalizedExtension = extension.startsWith('.')
    ? extension
    : `.${extension}`
  return `${normalizeDatabaseName(name)}${normalizedExtension.toLocaleLowerCase()}`
}
