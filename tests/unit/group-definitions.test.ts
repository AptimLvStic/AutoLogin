import { describe, expect, it } from 'vitest'
import { repairGroupDefinitions } from '../../src/main/group-definitions'
import { DEFAULT_APP_SETTINGS } from '../../src/shared/theme'
import type { AccountTab, GroupDefinition, Site, VaultData } from '../../src/shared/types'

const NOW = '2026-11-09T00:00:00.000Z'

function tab(id: string, name: string, source: AccountTab['source'] = 'local'): AccountTab {
  return {
    id,
    name,
    color: '#5C6BFF',
    source,
    hidden: false,
    createdAt: NOW,
    updatedAt: NOW
  }
}

function site(id: string, tabId: string, group: string): Site {
  return {
    id,
    tabId,
    name: id,
    startUrl: `https://${id}.example.test/login`,
    allowedOrigins: [`https://${id}.example.test`],
    autoSubmit: true,
    group,
    createdAt: NOW,
    updatedAt: NOW
  }
}

function group(tabId: string, path: string): GroupDefinition {
  return {
    tabId,
    path,
    name: path.split(' / ').at(-1) ?? path,
    createdAt: NOW,
    updatedAt: NOW
  }
}

function vault(): VaultData {
  return {
    schemaVersion: 1,
    tabs: [tab('local', '账号'), tab('bookmarks', '书签', 'bookmarks')],
    sites: [],
    accounts: [],
    groupDefinitions: [],
    deletedAccounts: [],
    favoriteGroups: [],
    settings: structuredClone(DEFAULT_APP_SETTINGS)
  }
}

describe('group definition repair', () => {
  it('removes imported groups that leaked into another tab and deduplicates paths', () => {
    const data = vault()
    data.sites = [
      site('local-site', 'local', '工作'),
      site('bookmark-a', 'bookmarks', '书签栏 / gost'),
      site('bookmark-b', 'bookmarks', '书签栏 / gost')
    ]
    data.groupDefinitions = [
      group('local', '工作'),
      group('local', '书签栏'),
      group('local', '书签栏 / gost'),
      group('bookmarks', '书签栏'),
      group('bookmarks', '书签栏 / gost'),
      group('bookmarks', '书签栏 / gost')
    ]
    data.settings.groupOrders = {
      local: ['工作', '书签栏', '书签栏 / gost'],
      bookmarks: ['书签栏', '书签栏 / gost', '书签栏 / gost']
    }
    data.settings.groupOrder = [...data.settings.groupOrders.local!]

    expect(repairGroupDefinitions(data)).toBe(true)
    expect(
      data.groupDefinitions
        .filter((entry) => entry.tabId === 'local')
        .map((entry) => entry.path)
    ).toEqual(['工作'])
    expect(
      data.groupDefinitions
        .filter((entry) => entry.tabId === 'bookmarks')
        .map((entry) => entry.path)
    ).toEqual(['书签栏', '书签栏 / gost'])
    expect(data.settings.groupOrders).toEqual({
      local: ['工作'],
      bookmarks: ['书签栏', '书签栏 / gost']
    })
    expect(data.settings.groupOrder).toEqual(['工作'])
    expect(repairGroupDefinitions(data)).toBe(false)
  })

  it('keeps empty user-created groups on their explicit tab', () => {
    const data = vault()
    data.groupDefinitions = [
      group('local', '待整理'),
      group('bookmarks', '稍后阅读')
    ]
    data.settings.groupOrders = {
      local: ['待整理'],
      bookmarks: ['稍后阅读']
    }

    expect(repairGroupDefinitions(data)).toBe(true)
    expect(data.groupDefinitions).toEqual([
      expect.objectContaining({ tabId: 'local', path: '待整理' }),
      expect.objectContaining({ tabId: 'bookmarks', path: '稍后阅读' })
    ])
    expect(data.settings.groupOrders).toEqual({
      local: ['待整理'],
      bookmarks: ['稍后阅读']
    })
    expect(repairGroupDefinitions(data)).toBe(false)
  })
})
