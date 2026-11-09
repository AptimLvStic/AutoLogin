import {
  DEFAULT_ACCOUNT_TAB_ID,
  GROUP_PATH_SEPARATOR,
  UNGROUPED_GROUP_KEY
} from '@shared/types'
import type { GroupDefinition, VaultData } from '@shared/types'

function groupPrefixes(path: string): string[] {
  const segments = path
    .split(GROUP_PATH_SEPARATOR)
    .map((segment) => segment.trim())
    .filter(Boolean)
  return segments.map((_, index) => segments.slice(0, index + 1).join(GROUP_PATH_SEPARATOR))
}

function tabGroupOrder(data: VaultData, tabId: string): string[] {
  return (
    data.settings.groupOrders[tabId] ??
    (tabId === DEFAULT_ACCOUNT_TAB_ID ? data.settings.groupOrder : [])
  )
}

function addScopedPath(
  scopes: Map<string, Set<string>>,
  path: string | undefined,
  tabId: string
): void {
  const normalized = path?.trim()
  if (!normalized || normalized === UNGROUPED_GROUP_KEY) {
    return
  }
  for (const prefix of groupPrefixes(normalized)) {
    const tabs = scopes.get(prefix) ?? new Set<string>()
    tabs.add(tabId)
    scopes.set(prefix, tabs)
  }
}

function mergeScopes(
  first: Map<string, Set<string>>,
  second: Map<string, Set<string>>
): Map<string, Set<string>> {
  const merged = new Map<string, Set<string>>()
  for (const source of [first, second]) {
    for (const [path, tabs] of source) {
      const current = merged.get(path) ?? new Set<string>()
      for (const tabId of tabs) current.add(tabId)
      merged.set(path, current)
    }
  }
  return merged
}

/**
 * Repairs group scope drift after imports and older migrations.
 *
 * Account/site references are authoritative. When a path is referenced by a
 * tab, stale definitions and ordering entries copied into another tab are
 * discarded. Paths without account references are retained from explicit
 * definitions or ordering entries so empty user-created groups survive.
 */
export function repairGroupDefinitions(data: VaultData): boolean {
  const originalGroups = JSON.stringify(data.groupDefinitions)
  const originalOrders = JSON.stringify(data.settings.groupOrders)
  const originalLegacyOrder = JSON.stringify(data.settings.groupOrder)
  const tabIds = new Set(data.tabs.map((tab) => tab.id))
  const referencedScopes = new Map<string, Set<string>>()
  const definitionScopes = new Map<string, Set<string>>()
  const orderedScopes = new Map<string, Set<string>>()

  const normalizeTabId = (tabId: string | undefined): string =>
    tabId && tabIds.has(tabId) ? tabId : DEFAULT_ACCOUNT_TAB_ID

  for (const site of data.sites) {
    const tabId = normalizeTabId(site.tabId)
    if (tabIds.has(tabId)) addScopedPath(referencedScopes, site.group, tabId)
  }
  for (const record of data.deletedAccounts) {
    const tabId = normalizeTabId(record.tabId ?? record.site.tabId)
    if (tabIds.has(tabId)) addScopedPath(referencedScopes, record.site.group, tabId)
  }
  for (const group of data.groupDefinitions) {
    const tabId = normalizeTabId(group.tabId)
    if (tabIds.has(tabId)) addScopedPath(definitionScopes, group.path, tabId)
  }
  for (const tab of data.tabs) {
    for (const path of tabGroupOrder(data, tab.id)) {
      addScopedPath(orderedScopes, path, tab.id)
    }
  }

  const fallbackScopes = mergeScopes(definitionScopes, orderedScopes)
  const scopes = new Map<string, Set<string>>()
  const paths = new Set([...referencedScopes.keys(), ...fallbackScopes.keys()])
  for (const path of paths) {
    const referencedTabs = referencedScopes.get(path)
    const owners =
      referencedTabs && referencedTabs.size > 0
        ? referencedTabs
        : fallbackScopes.get(path)
    if (owners && owners.size > 0) {
      scopes.set(path, new Set(owners))
    }
  }

  const candidatesByPath = new Map<string, GroupDefinition[]>()
  for (const group of data.groupDefinitions) {
    const path = group.path.trim()
    if (!path || path === UNGROUPED_GROUP_KEY) continue
    const candidates = candidatesByPath.get(path) ?? []
    candidates.push(group)
    candidatesByPath.set(path, candidates)
  }

  const now = new Date().toISOString()
  const repaired: GroupDefinition[] = []
  for (const tab of data.tabs) {
    const tabPaths = [...scopes.entries()]
      .filter(([, tabs]) => tabs.has(tab.id))
      .map(([path]) => path)
      .sort(compareGroupPaths)
    for (const path of tabPaths) {
      const candidates = candidatesByPath.get(path) ?? []
      const source =
        candidates.find((group) => normalizeTabId(group.tabId) === tab.id) ??
        candidates[0]
      repaired.push({
        tabId: tab.id,
        path,
        name: path.split(GROUP_PATH_SEPARATOR).at(-1) ?? path,
        createdAt: source?.createdAt ?? now,
        updatedAt: source?.updatedAt ?? now
      })
    }
  }
  data.groupDefinitions = repaired

  for (const tab of data.tabs) {
    const availablePaths = [...scopes.entries()]
      .filter(([, tabs]) => tabs.has(tab.id))
      .map(([path]) => path)
      .sort(compareGroupPaths)
    const available = new Set(availablePaths)
    const normalized = [
      ...new Set(
        tabGroupOrder(data, tab.id)
          .map((path) => path.trim())
          .filter((path) => path === UNGROUPED_GROUP_KEY || available.has(path))
      )
    ]
    const ordered = new Set(normalized)
    for (const path of availablePaths) {
      if (!ordered.has(path)) {
        normalized.push(path)
        ordered.add(path)
      }
    }
    data.settings.groupOrders[tab.id] = normalized
    if (tab.id === DEFAULT_ACCOUNT_TAB_ID) {
      data.settings.groupOrder = [...normalized]
    }
  }

  return (
    originalGroups !== JSON.stringify(data.groupDefinitions) ||
    originalOrders !== JSON.stringify(data.settings.groupOrders) ||
    originalLegacyOrder !== JSON.stringify(data.settings.groupOrder)
  )
}

function compareGroupPaths(left: string, right: string): number {
  const leftDepth = left.split(GROUP_PATH_SEPARATOR).length
  const rightDepth = right.split(GROUP_PATH_SEPARATOR).length
  return leftDepth - rightDepth || left.localeCompare(right)
}
