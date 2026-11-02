import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  browserProfileDirectory,
  discoverManagedBrowserProfileIds,
  discoverManagedPartitionIds,
  partitionDirectory,
  SessionIndex
} from '../../src/main/session-index'

const directories: string[] = []

function createDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), 'autologin-sessions-'))
  directories.push(directory)
  return directory
}

afterEach(() => {
  while (directories.length > 0) {
    rmSync(directories.pop()!, { recursive: true, force: true })
  }
})

describe('SessionIndex', () => {
  it('persists non-secret account IDs across instances', () => {
    const directory = createDirectory()
    const index = new SessionIndex(directory)
    index.add('account-1')
    index.add('account-2')
    index.remove('account-1')

    const reopened = new SessionIndex(directory)
    expect(reopened.list()).toEqual(['account-2'])
    reopened.clear()
    expect(new SessionIndex(directory).list()).toEqual([])
  })

  it('discovers managed partition directories without trusting arbitrary names', () => {
    const directory = createDirectory()
    const partitions = join(directory, 'Partitions')
    mkdirSync(join(partitions, 'autologin-account-1'), { recursive: true })
    mkdirSync(join(partitions, 'autologin-bad..name'), { recursive: true })
    mkdirSync(join(partitions, 'unrelated'), { recursive: true })

    expect(discoverManagedPartitionIds(directory)).toEqual(['account-1'])
    expect(partitionDirectory(directory, 'account-1')).toBe(
      join(partitions, 'autologin-account-1')
    )
  })

  it('discovers external browser profiles without trusting arbitrary names', () => {
    const directory = createDirectory()
    const profiles = join(directory, 'BrowserProfiles')
    mkdirSync(join(profiles, 'account-1'), { recursive: true })
    mkdirSync(join(profiles, 'bad..name'), { recursive: true })
    mkdirSync(join(profiles, 'unrelated'), { recursive: true })

    expect(discoverManagedBrowserProfileIds(directory)).toEqual([
      'account-1',
      'unrelated'
    ])
    expect(browserProfileDirectory(directory, 'account-1')).toBe(
      join(profiles, 'account-1')
    )
  })
})
