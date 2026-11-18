// @vitest-environment jsdom

import React from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { DataImportResult } from '@shared/types'
import { I18nProvider } from '../../src/renderer/src/i18n'
import { ImportResultDialog } from '../../src/renderer/src/components/ImportResultDialog'

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  ;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
    .IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

describe('ImportResultDialog', () => {
  it('shows import totals and expands the skipped entries', () => {
    renderResult(resultWithSkips())

    const kpis = Array.from(
      document.querySelectorAll('.import-result-dialog__kpis strong')
    ).map((element) => element.textContent)
    expect(kpis).toEqual(['18', '5', '9', '3'])
    expect(
      document.querySelectorAll('.import-result-dialog__skip-row')
    ).toHaveLength(3)

    const expand = document.querySelector<HTMLButtonElement>(
      '.import-result-dialog__expand'
    )
    expect(expand?.textContent).toContain('其余 2 条')
    act(() => expand?.click())

    expect(
      document.querySelectorAll('.import-result-dialog__skip-row')
    ).toHaveLength(5)
  })

  it('marks a zero-account import as a failure with the first reason', () => {
    renderResult({
      ...resultWithSkips(),
      accountsCreated: 0,
      warnings: ['数据库中没有包含有效网址、用户名和密码的登录记录']
    })

    expect(
      document.querySelector('.import-result-dialog__hero')?.className
    ).toContain('is-failure')
    expect(document.body.textContent).toContain(
      '数据库中没有包含有效网址、用户名和密码的登录记录'
    )
  })
})

function renderResult(result: DataImportResult): void {
  act(() => {
    root.render(
      React.createElement(
        I18nProvider,
        {
          language: 'zh-CN',
          children: React.createElement(ImportResultDialog, {
            result,
            onClose: () => undefined,
            onView: () => undefined
          })
        }
      )
    )
  })
}

function resultWithSkips(): DataImportResult {
  return {
    source: 'kdbx',
    tabId: 'local',
    tabName: '个人账号密码',
    sitesCreated: 18,
    accountsCreated: 18,
    skipped: 5,
    groupsCreated: 9,
    maxDepth: 3,
    groupPaths: ['工作 / 邮件'],
    skipDetails: Array.from({ length: 5 }, (_, index) => ({
      rowNumber: index + 1,
      title: `条目 ${index + 1}`,
      reason: '登录地址为空'
    })),
    warnings: []
  }
}
