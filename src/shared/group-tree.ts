import {
  GROUP_PATH_SEPARATOR,
  UNGROUPED_GROUP_KEY,
  type AccountWithSite
} from './types'

export interface GroupSummary {
  key: string
  name: string
  actualName: string | null
  parentPath: string | null
  level: number
  count: number
  accounts: AccountWithSite[]
}

export function groupParentPath(path: string): string | null {
  const parts = path.split(GROUP_PATH_SEPARATOR).filter(Boolean)
  if (parts.length <= 1) return null
  return parts.slice(0, -1).join(GROUP_PATH_SEPARATOR)
}

export function groupLevel(path: string): number {
  return Math.max(1, path.split(GROUP_PATH_SEPARATOR).filter(Boolean).length)
}

export function flattenGroupTree(
  groups: GroupSummary[],
  order: Map<string, number>,
  language: string
): GroupSummary[] {
  const named = groups.filter(
    (group): group is GroupSummary & { actualName: string } => group.actualName !== null
  )
  const ungrouped = groups.filter((group) => group.actualName === null)
  const result: GroupSummary[] = []
  const visited = new Set<string>()
  const compare = (left: GroupSummary, right: GroupSummary): number => {
    const leftOrder =
      order.get(left.actualName ?? left.key) ??
      order.get(left.name) ??
      Number.MAX_SAFE_INTEGER
    const rightOrder =
      order.get(right.actualName ?? right.key) ??
      order.get(right.name) ??
      Number.MAX_SAFE_INTEGER
    if (leftOrder !== rightOrder) return leftOrder - rightOrder
    return left.name.localeCompare(right.name, language)
  }

  const visit = (parentPath: string | null): void => {
    const children = named
      .filter((group) => group.parentPath === parentPath && !visited.has(group.key))
      .sort(compare)
    for (const group of children) {
      if (visited.has(group.key)) continue
      visited.add(group.key)
      result.push(group)
      visit(group.actualName)
    }
  }

  visit(null)
  // Invalid or partially recovered paths still need to remain reachable.
  for (const group of named.filter((entry) => !visited.has(entry.key)).sort(compare)) {
    if (visited.has(group.key)) continue
    visited.add(group.key)
    result.push(group)
    visit(group.actualName)
  }
  if (ungrouped.length === 0) return result
  const ungroupedOrder = order.get(UNGROUPED_GROUP_KEY) ?? Number.MAX_SAFE_INTEGER
  const insertIndex = result.findIndex((group) => {
    if (group.parentPath !== null) return false
    const groupOrder =
      order.get(group.actualName ?? group.key) ??
      order.get(group.name) ??
      Number.MAX_SAFE_INTEGER
    return groupOrder > ungroupedOrder
  })
  result.splice(insertIndex < 0 ? result.length : insertIndex, 0, ...ungrouped)
  return result
}
