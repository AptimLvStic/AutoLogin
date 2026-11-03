// @vitest-environment jsdom

import React from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { I18nProvider } from '../../src/renderer/src/i18n'
import {
  Markdown,
  UpdateDialog
} from '../../src/renderer/src/components/UpdateDialog'

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

describe('UpdateDialog Markdown', () => {
  it('renders release headings, lists and links without allowing unsafe URLs', () => {
    act(() => {
      root.render(
        React.createElement(Markdown, {
          content: [
            '## 更新内容',
            '',
            '- **应用内更新**',
            '- 侧边栏折叠',
            '',
            '[发布页](https://github.com/AptimLvStic/AutoLogin/releases)',
            '[危险链接](javascript:alert)'
          ].join('\n')
        })
      )
    })

    expect(container.querySelector('h3')?.textContent).toBe('更新内容')
    expect(container.querySelectorAll('li')).toHaveLength(2)
    expect(container.querySelector('strong')?.textContent).toBe('应用内更新')
    const links = [...container.querySelectorAll('a')]
    expect(links).toHaveLength(1)
    expect(links[0]?.href).toBe('https://github.com/AptimLvStic/AutoLogin/releases')
    expect(container.textContent).toContain('危险链接')
  })

  it('starts an available update and exposes restart after download', () => {
    const onDownload = vi.fn()
    const props = {
      onLater: vi.fn(),
      onDownload,
      onInstall: vi.fn(),
      onOpenRelease: vi.fn(),
      onRetry: vi.fn()
    }
    act(() => {
      root.render(
        React.createElement(
          I18nProvider,
          {
            language: 'zh-CN',
            children: React.createElement(UpdateDialog, {
              ...props,
              state: {
                phase: 'available',
                currentVersion: '0.5.0',
                latestVersion: '0.6.0',
                releaseNotes: '## 更新内容\n\n- 应用内自动更新',
                interactive: true
              }
            })
          }
        )
      )
    })

    const downloadButton = [...document.querySelectorAll<HTMLButtonElement>('button')].find(
      (button) => button.textContent?.includes('立即更新')
    )
    expect(downloadButton).toBeDefined()
    act(() => downloadButton?.click())
    expect(onDownload).toHaveBeenCalledOnce()

    act(() => {
      root.render(
        React.createElement(
          I18nProvider,
          {
            language: 'zh-CN',
            children: React.createElement(UpdateDialog, {
              ...props,
              state: {
                phase: 'downloaded',
                currentVersion: '0.5.0',
                latestVersion: '0.6.0',
                releaseNotes: '## 更新内容',
                interactive: true,
                percent: 100
              }
            })
          }
        )
      )
    })
    expect(document.body.textContent).toContain('重启并安装')
  })
})
