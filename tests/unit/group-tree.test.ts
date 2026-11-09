import { describe, expect, it } from 'vitest'
import {
  flattenGroupTree,
  type GroupSummary
} from '../../src/shared/group-tree'

function group(path: string, parentPath: string | null): GroupSummary {
  return {
    key: path,
    name: path.split(' / ').at(-1) ?? path,
    actualName: path,
    parentPath,
    level: path.split(' / ').length,
    count: 0,
    accounts: []
  }
}

describe('group tree flattening', () => {
  it('does not duplicate descendants when a partially loaded parent is recovered later', () => {
    const parent = group('导入分组', null)
    const orphanedChild = group('缺失父级 / 子分组', '缺失父级')
    const orphanedLeaf = group('缺失父级 / 子分组 / 末级', '缺失父级 / 子分组')
    const order = new Map([
      [parent.actualName!, 0],
      [orphanedChild.actualName!, 1],
      [orphanedLeaf.actualName!, 2]
    ])

    const flattened = flattenGroupTree(
      [parent, orphanedChild, orphanedLeaf],
      order,
      'zh-CN'
    )

    expect(flattened.map((entry) => entry.key)).toEqual([
      parent.key,
      orphanedChild.key,
      orphanedLeaf.key
    ])
    expect(new Set(flattened.map((entry) => entry.key)).size).toBe(flattened.length)
  })
})
