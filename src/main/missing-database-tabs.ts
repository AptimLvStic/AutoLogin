import type { AccountTab, VaultData } from '@shared/types'

export interface MissingDatabaseTabCleanup {
  removedTabs: AccountTab[]
  removedAccountIds: string[]
}

export function removeMissingDatabaseTabs(
  data: VaultData,
  tabFileExists: (tab: AccountTab) => boolean,
  options: { hiddenOnly?: boolean } = {}
): MissingDatabaseTabCleanup {
  const removedTabs = data.tabs.filter(
    (tab) => (!options.hiddenOnly || tab.hidden) && !tabFileExists(tab)
  )
  if (removedTabs.length === 0) {
    return { removedTabs: [], removedAccountIds: [] }
  }

  const removedTabIds = new Set(removedTabs.map((tab) => tab.id))
  const removedAccountIds = data.accounts
    .filter((account) => removedTabIds.has(account.tabId))
    .map((account) => account.id)
  data.tabs = data.tabs.filter((tab) => !removedTabIds.has(tab.id))
  data.sites = data.sites.filter((site) => !removedTabIds.has(site.tabId))
  data.accounts = data.accounts.filter(
    (account) => !removedTabIds.has(account.tabId)
  )
  data.groupDefinitions = data.groupDefinitions.filter(
    (group) => !removedTabIds.has(group.tabId)
  )
  data.deletedAccounts = data.deletedAccounts.filter(
    (record) => !removedTabIds.has(record.tabId)
  )

  return { removedTabs, removedAccountIds }
}
