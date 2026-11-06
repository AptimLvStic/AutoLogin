import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  databaseExtensionForSource,
  databaseFileNameFor,
  isDatabaseNameFileSafe
} from '../../src/shared/database-files'
import { migrateTabDatabaseFiles } from '../../src/main/tab-database-files'
import {
  buildTabSnapshot,
  indexVaultDataByTab
} from '../../src/main/tab-snapshots'
import { DEFAULT_APP_SETTINGS } from '../../src/shared/theme'
import type {
  AccountTab,
  AccountTabSource,
  Site,
  StoredAccount,
  VaultData
} from '../../src/shared/types'

const directories: string[] = []

afterEach(() => {
  while (directories.length > 0) {
    rmSync(directories.pop()!, { recursive: true, force: true })
  }
})

function createDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), 'autologin-database-files-'))
  directories.push(directory)
  return directory
}

function createTab(
  id: string,
  name: string,
  source: AccountTabSource,
  databaseFileName?: string
): AccountTab {
  return {
    id,
    name,
    source,
    color: '#5C6BFF',
    databaseFileName,
    hidden: false,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z'
  }
}

function createVault(tabs: AccountTab[]): VaultData {
  return {
    schemaVersion: 1,
    tabs,
    sites: [],
    accounts: [],
    groupDefinitions: [],
    deletedAccounts: [],
    favoriteGroups: [],
    settings: structuredClone(DEFAULT_APP_SETTINGS)
  }
}

describe('database files', () => {
  it('keeps the imported database extension when building a display filename', () => {
    expect(
      databaseFileNameFor(
        '工作账号',
        databaseExtensionForSource('kdbx', 'legacy.kdbx')
      )
    ).toBe('工作账号.kdbx')
    expect(
      databaseFileNameFor(
        '财务数据',
        databaseExtensionForSource('csv', 'finance.csv')
      )
    ).toBe('财务数据.csv')
    expect(
      databaseFileNameFor(
        '书签',
        databaseExtensionForSource('bookmarks', 'bookmarks.html')
      )
    ).toBe('书签.html')
    expect(
      databaseFileNameFor(
        '本地数据库 1',
        databaseExtensionForSource('local')
      )
    ).toBe('本地数据库 1.autologin')
    expect(isDatabaseNameFileSafe('工作账号')).toBe(true)
    expect(isDatabaseNameFileSafe('工作/账号')).toBe(false)
    expect(isDatabaseNameFileSafe('CON')).toBe(false)
  })

  it('migrates every legacy tab-uuid file to its database name and suffix', () => {
    const root = createDirectory()
    const tabsDirectory = join(root, 'tabs')
    mkdirSync(tabsDirectory, { recursive: true })
    const data = createVault([
      createTab('local', '本地账号', 'local'),
      createTab('kdbx-1', '工作账号', 'kdbx', 'tab-kdbx-1.kdbx'),
      createTab('csv-1', '财务数据', 'csv', 'tab-csv-1.csv'),
      createTab('bookmarks-1', '书签', 'bookmarks', 'tab-bookmarks-1.html')
    ])
    for (const fileName of [
      'tab-local.autologin',
      'tab-kdbx-1.kdbx',
      'tab-csv-1.csv',
      'tab-bookmarks-1.html'
    ]) {
      writeFileSync(join(tabsDirectory, fileName), fileName)
    }

    const result = migrateTabDatabaseFiles(data, tabsDirectory)

    expect(result.changed).toBe(true)
    expect(result.renamed).toBe(4)
    expect(result.issues).toEqual([])
    expect(data.tabs.map((tab) => tab.databaseFileName)).toEqual([
      '本地账号.autologin',
      '工作账号.kdbx',
      '财务数据.csv',
      '书签.html'
    ])
    for (const fileName of [
      '本地账号.autologin',
      '工作账号.kdbx',
      '财务数据.csv',
      '书签.html'
    ]) {
      expect(existsSync(join(tabsDirectory, fileName))).toBe(true)
    }
    expect(
      existsSync(join(tabsDirectory, 'tab-local.autologin'))
    ).toBe(false)
    expect(existsSync(join(tabsDirectory, 'tab-kdbx-1.kdbx'))).toBe(false)
    expect(existsSync(join(tabsDirectory, 'tab-csv-1.csv'))).toBe(false)
    expect(existsSync(join(tabsDirectory, 'tab-bookmarks-1.html'))).toBe(false)
  })

  it('builds a tab snapshot from one grouping pass without unrelated data', () => {
    const tabs = [
      createTab('local', '本地账号', 'local'),
      createTab('second', '第二个数据库', 'local')
    ]
    const data = createVault(tabs)
    const createdAt = '2026-01-01T00:00:00.000Z'
    const sites: Site[] = ['local', 'second'].map((tabId) => ({
      id: `site-${tabId}`,
      tabId,
      name: `Site ${tabId}`,
      startUrl: `https://${tabId}.example.test/login`,
      allowedOrigins: [`https://${tabId}.example.test`],
      autoSubmit: true,
      createdAt,
      updatedAt: createdAt
    }))
    const accounts: StoredAccount[] = ['local', 'second'].map((tabId) => ({
      id: `account-${tabId}`,
      tabId,
      siteId: `site-${tabId}`,
      label: `Account ${tabId}`,
      username: `${tabId}@example.test`,
      password: 'encrypted-in-real-vault',
      favorite: false,
      loginStrategy: 'auto',
      createdAt,
      updatedAt: createdAt
    }))
    data.sites = sites
    data.accounts = accounts

    const byTab = indexVaultDataByTab(data)
    const snapshot = buildTabSnapshot(
      data,
      tabs[1]!,
      byTab.get('second'),
      ['Second group']
    )

    expect(snapshot.tabs).toEqual([tabs[1]])
    expect(snapshot.sites.map((site) => site.id)).toEqual(['site-second'])
    expect(snapshot.accounts.map((account) => account.id)).toEqual([
      'account-second'
    ])
    expect(snapshot.settings.groupOrder).toEqual(['Second group'])
    expect(snapshot.settings.groupOrders).toEqual({
      second: ['Second group']
    })
  })
})
