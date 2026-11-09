import { constants as fsConstants } from 'node:fs'
import {
  copyFile,
  mkdir,
  readFile,
  readdir,
  stat,
  writeFile
} from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import type { DefaultBrowser } from './browser-discovery'

const PROFILE_MARKER = '.autologin-profile.json'
const PROFILE_FILES = [
  'Preferences',
  'Secure Preferences',
  'Login Data',
  'Login Data For Account',
  'Web Data',
  'History',
  'Favicons',
  'Bookmarks'
] as const
const PROFILE_DIRECTORIES = [
  'Network',
  'Local Storage',
  'Session Storage',
  'Storage',
  'Web Applications'
] as const
const SKIPPED_NAMES = new Set([
  'LOCK',
  'LOG',
  'LOG.old',
  'SingletonCookie',
  'SingletonLock',
  'SingletonSocket'
])

export interface BrowserProfileResult {
  profileDirectory: string
  imported: boolean
}

interface BrowserProfileMarker {
  version: 1
  sourceProfile: string
  importedAt: string
}

/**
 * Chrome 136+ refuses remote debugging against its default profile directory.
 * Seed a local Chrome-compatible profile once so CDP can use the user's existing
 * cookies without exposing the normal browser process to automation.
 */
export async function prepareUserBrowserProfile(
  browser: DefaultBrowser,
  destinationRoot: string,
  localAppData = process.env.LOCALAPPDATA
): Promise<BrowserProfileResult> {
  await mkdir(join(destinationRoot, 'Default'), { recursive: true })
  const markerPath = join(destinationRoot, PROFILE_MARKER)
  if (await pathExists(markerPath)) {
    return { profileDirectory: destinationRoot, imported: false }
  }

  const sourceRoot = browserUserDataRoot(browser, localAppData)
  if (!sourceRoot || !(await pathExists(sourceRoot))) {
    return { profileDirectory: destinationRoot, imported: false }
  }

  const sourceProfile = await selectedProfileName(sourceRoot)
  const sourceProfileDirectory = join(sourceRoot, sourceProfile)
  if (!(await isDirectory(sourceProfileDirectory))) {
    return { profileDirectory: destinationRoot, imported: false }
  }

  await copyFileIfPossible(
    join(sourceRoot, 'Local State'),
    join(destinationRoot, 'Local State')
  )
  await normalizeLocalState(join(destinationRoot, 'Local State'))

  const destinationProfile = join(destinationRoot, 'Default')
  for (const name of PROFILE_FILES) {
    await copyFileIfPossible(
      join(sourceProfileDirectory, name),
      join(destinationProfile, name)
    )
  }
  for (const name of PROFILE_DIRECTORIES) {
    await copyDirectoryIfPossible(
      join(sourceProfileDirectory, name),
      join(destinationProfile, name)
    )
  }

  const marker: BrowserProfileMarker = {
    version: 1,
    sourceProfile,
    importedAt: new Date().toISOString()
  }
  await writeFile(markerPath, JSON.stringify(marker), {
    encoding: 'utf8',
    mode: 0o600
  })
  return { profileDirectory: destinationRoot, imported: true }
}

export function browserUserDataRoot(
  browser: DefaultBrowser,
  localAppData = process.env.LOCALAPPDATA
): string | null {
  if (!localAppData) {
    return null
  }
  switch (basename(browser.executablePath).toLowerCase()) {
    case 'chrome.exe':
      return join(localAppData, 'Google', 'Chrome', 'User Data')
    case 'msedge.exe':
      return join(localAppData, 'Microsoft', 'Edge', 'User Data')
    case 'brave.exe':
      return join(localAppData, 'BraveSoftware', 'Brave-Browser', 'User Data')
    case 'vivaldi.exe':
      return join(localAppData, 'Vivaldi', 'User Data')
    case 'thorium.exe':
      return join(localAppData, 'Thorium', 'User Data')
    default:
      return null
  }
}

async function selectedProfileName(sourceRoot: string): Promise<string> {
  try {
    const localState = JSON.parse(
      await readFile(join(sourceRoot, 'Local State'), 'utf8')
    ) as { profile?: { last_used?: unknown } }
    const value = localState.profile?.last_used
    if (
      typeof value === 'string' &&
      value !== '.' &&
      value !== '..' &&
      !value.includes('/') &&
      !value.includes('\\') &&
      (await isDirectory(join(sourceRoot, value)))
    ) {
      return value
    }
  } catch {
    // Fall back to the standard profile when Local State is unavailable.
  }
  return 'Default'
}

async function normalizeLocalState(path: string): Promise<void> {
  try {
    const parsed = JSON.parse(await readFile(path, 'utf8')) as {
      profile?: {
        last_used?: string
        last_active_profiles?: string[]
        info_cache?: Record<string, unknown>
      }
    }
    if (!parsed.profile) {
      return
    }
    parsed.profile.last_used = 'Default'
    parsed.profile.last_active_profiles = ['Default']
    if (parsed.profile.info_cache && !parsed.profile.info_cache.Default) {
      parsed.profile.info_cache.Default = {}
    }
    await writeFile(path, JSON.stringify(parsed), {
      encoding: 'utf8',
      mode: 0o600
    })
  } catch {
    // A partial Local State file still lets Chrome create a fresh profile.
  }
}

async function copyFileIfPossible(source: string, destination: string): Promise<void> {
  try {
    if (!(await pathExists(source)) || !(await stat(source)).isFile()) {
      return
    }
    await mkdir(dirname(destination), { recursive: true })
    try {
      await copyFile(source, destination, fsConstants.COPYFILE_FICLONE)
    } catch {
      await copyFile(source, destination)
    }
  } catch {
    // Chrome may temporarily lock a profile database; copy what is available.
  }
}

async function copyDirectoryIfPossible(
  source: string,
  destination: string
): Promise<void> {
  try {
    if (!(await isDirectory(source))) {
      return
    }
    await mkdir(destination, { recursive: true })
    for (const entry of await readdir(source, { withFileTypes: true })) {
      if (SKIPPED_NAMES.has(entry.name) || entry.isSymbolicLink()) {
        continue
      }
      const sourcePath = join(source, entry.name)
      const destinationPath = join(destination, entry.name)
      if (entry.isDirectory()) {
        await copyDirectoryIfPossible(sourcePath, destinationPath)
      } else if (entry.isFile()) {
        await copyFileIfPossible(sourcePath, destinationPath)
      }
    }
  } catch {
    // A single locked profile directory must not prevent Chrome from starting.
  }
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory()
  } catch {
    return false
  }
}
