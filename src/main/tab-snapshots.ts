import type {
  AccountTab,
  DeletedAccountRecord,
  GroupDefinition,
  Site,
  StoredAccount,
  VaultData
} from '../shared/types'

interface TabCollections {
  sites: Site[]
  accounts: StoredAccount[]
  groupDefinitions: GroupDefinition[]
  deletedAccounts: DeletedAccountRecord[]
}

export type VaultDataByTab = ReadonlyMap<string, Readonly<TabCollections>>

export function indexVaultDataByTab(data: VaultData): VaultDataByTab {
  const result = new Map<string, TabCollections>()
  const collectionFor = (tabId: string): TabCollections => {
    const current = result.get(tabId)
    if (current) return current
    const next: TabCollections = {
      sites: [],
      accounts: [],
      groupDefinitions: [],
      deletedAccounts: []
    }
    result.set(tabId, next)
    return next
  }

  for (const site of data.sites) collectionFor(site.tabId).sites.push(site)
  for (const account of data.accounts) {
    collectionFor(account.tabId).accounts.push(account)
  }
  for (const group of data.groupDefinitions) {
    collectionFor(group.tabId).groupDefinitions.push(group)
  }
  for (const record of data.deletedAccounts) {
    collectionFor(record.tabId).deletedAccounts.push(record)
  }
  return result
}

export function buildTabSnapshot(
  data: VaultData,
  tab: AccountTab,
  collections: Readonly<TabCollections> | undefined,
  groupOrder: string[]
): VaultData {
  return {
    schemaVersion: data.schemaVersion,
    tabs: [tab],
    sites: collections?.sites ?? [],
    accounts: collections?.accounts ?? [],
    groupDefinitions: collections?.groupDefinitions ?? [],
    deletedAccounts: collections?.deletedAccounts ?? [],
    favoriteGroups: [],
    settings: {
      ...data.settings,
      groupOrder: [...groupOrder],
      groupOrders: { [tab.id]: [...groupOrder] }
    }
  }
}
