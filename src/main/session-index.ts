import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeSync
} from 'node:fs'
import { join } from 'node:path'

interface SessionIndexFile {
  version: 1
  accountIds: string[]
}

const ACCOUNT_ID_PATTERN = /^[a-zA-Z0-9_-]{1,128}$/

/**
 * Account IDs are not secrets. Keeping this small index outside the vault lets
 * the app clear browser partitions even when the user has forgotten the master
 * password and the vault cannot be decrypted.
 */
export class SessionIndex {
  private readonly indexPath: string
  private readonly accountIds = new Set<string>()

  constructor(private readonly userDataPath: string) {
    this.indexPath = join(userDataPath, 'session-index.json')
    this.load()
  }

  list(): string[] {
    return [...this.accountIds]
  }

  add(accountId: string): void {
    if (!isValidAccountId(accountId)) {
      return
    }
    this.accountIds.add(accountId)
    this.persist()
  }

  remove(accountId: string): void {
    if (this.accountIds.delete(accountId)) {
      this.persist()
    }
  }

  replace(accountIds: string[]): void {
    this.accountIds.clear()
    for (const accountId of accountIds) {
      if (isValidAccountId(accountId)) {
        this.accountIds.add(accountId)
      }
    }
    this.persist()
  }

  clear(): void {
    this.accountIds.clear()
    rmSync(this.indexPath, { force: true })
  }

  private load(): void {
    if (!existsSync(this.indexPath)) {
      return
    }
    try {
      const parsed = JSON.parse(readFileSync(this.indexPath, 'utf8')) as Partial<SessionIndexFile>
      if (parsed.version !== 1 || !Array.isArray(parsed.accountIds)) {
        return
      }
      for (const accountId of parsed.accountIds) {
        if (typeof accountId === 'string' && isValidAccountId(accountId)) {
          this.accountIds.add(accountId)
        }
      }
    } catch {
      // A damaged non-secret index is recoverable by scanning partitions.
    }
  }

  private persist(): void {
    mkdirSync(this.userDataPath, { recursive: true })
    const payload: SessionIndexFile = {
      version: 1,
      accountIds: this.list()
    }
    const tempPath = `${this.indexPath}.${process.pid}.tmp`
    const file = openSync(tempPath, 'w', 0o600)
    try {
      writeSync(file, JSON.stringify(payload))
      fsyncSync(file)
    } finally {
      closeSync(file)
    }

    try {
      renameSync(tempPath, this.indexPath)
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code === 'EEXIST' || code === 'EPERM') {
        rmSync(this.indexPath, { force: true })
        renameSync(tempPath, this.indexPath)
      } else {
        rmSync(tempPath, { force: true })
        throw error
      }
    }
  }
}

export function discoverManagedPartitionIds(userDataPath: string): string[] {
  return discoverAccountDirectories(join(userDataPath, 'Partitions'), 'autologin-')
}

export function partitionDirectory(userDataPath: string, accountId: string): string {
  return join(userDataPath, 'Partitions', `autologin-${accountId}`)
}

export function browserProfileDirectory(userDataPath: string, accountId: string): string {
  return join(userDataPath, 'BrowserProfiles', accountId)
}

export function discoverManagedBrowserProfileIds(userDataPath: string): string[] {
  return discoverAccountDirectories(join(userDataPath, 'BrowserProfiles'), '')
}

function discoverAccountDirectories(directory: string, prefix: string): string[] {
  if (!existsSync(directory)) {
    return []
  }
  try {
    return readdirSync(directory, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && entry.name.startsWith(prefix))
      .map((entry) => entry.name.slice(prefix.length))
      .filter(isValidAccountId)
  } catch {
    return []
  }
}

function isValidAccountId(accountId: string): boolean {
  return ACCOUNT_ID_PATTERN.test(accountId)
}
