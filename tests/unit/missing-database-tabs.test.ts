import { describe, expect, it } from 'vitest'
import { removeMissingDatabaseTabs } from '../../src/main/missing-database-tabs'
import { DEFAULT_APP_SETTINGS } from '../../src/shared/theme'
import type {
  AccountTab,
  DeletedAccountRecord,
  GroupDefinition,
  Site,
  StoredAccount,
  VaultData
} from '../../src/shared/types'

const now = '2026-11-06T00:00:00.000Z'

function tab(
  id: string,
  name: string,
  source: AccountTab['source'],
  databaseFileName: string
): AccountTab {
  return {
    id,
    name,
    source,
    color: '#5C6BFF',
    databaseFileName,
    hidden: false,
    createdAt: now,
    updatedAt: now
  }
}

function site(id: string, tabId: string): Site {
  return {
    id,
    tabId,
    name: `站点 ${id}`,
    startUrl: 'https://example.com/login',
    allowedOrigins: ['https://example.com'],
    autoSubmit: true,
    createdAt: now,
    updatedAt: now
  }
}

function account(id: string, tabId: string, siteId: string): StoredAccount {
  return {
    id,
    tabId,
    siteId,
    label: id,
    username: id,
    password: 'secret',
    favorite: false,
    loginStrategy: 'auto',
    createdAt: now,
    updatedAt: now
  }
}

describe('missing database tab cleanup', () => {
  it('removes only file-backed tabs whose database file disappeared', () => {
    const localTab = tab('local', '本地账号', 'local', '本地账号.autologin')
    const missingKdbxTab = tab('kdbx', '工作账号', 'kdbx', '工作账号.kdbx')
    const csvTab = tab('csv', '财务数据', 'csv', '财务数据.csv')
    const bookmarkTab = tab('bookmarks', '书签', 'bookmarks', '书签.html')
    const localSite = site('site-local', localTab.id)
    const kdbxSite = site('site-kdbx', missingKdbxTab.id)
    const localAccount = account('account-local', localTab.id, localSite.id)
    const kdbxAccount = account('account-kdbx', missingKdbxTab.id, kdbxSite.id)
    const group: GroupDefinition = {
      tabId: missingKdbxTab.id,
      path: '工作',
      name: '工作',
      createdAt: now,
      updatedAt: now
    }
    const deleted: DeletedAccountRecord = {
      account: kdbxAccount,
      site: kdbxSite,
      tabId: missingKdbxTab.id,
      deletedAt: now
    }
    const data: VaultData = {
      schemaVersion: 1,
      tabs: [localTab, missingKdbxTab, csvTab, bookmarkTab],
      sites: [localSite, kdbxSite],
      accounts: [localAccount, kdbxAccount],
      groupDefinitions: [group],
      deletedAccounts: [deleted],
      favoriteGroups: [],
      settings: DEFAULT_APP_SETTINGS
    }

    const result = removeMissingDatabaseTabs(
      data,
      (entry) => entry.databaseFileName !== '工作账号.kdbx'
    )

    expect(result.removedTabs.map((entry) => entry.id)).toEqual(['kdbx'])
    expect(result.removedAccountIds).toEqual(['account-kdbx'])
    expect(data.tabs.map((entry) => entry.id)).toEqual([
      'local',
      'csv',
      'bookmarks'
    ])
    expect(data.sites.map((entry) => entry.id)).toEqual(['site-local'])
    expect(data.accounts.map((entry) => entry.id)).toEqual(['account-local'])
    expect(data.groupDefinitions).toEqual([])
    expect(data.deletedAccounts).toEqual([])
  })
})
