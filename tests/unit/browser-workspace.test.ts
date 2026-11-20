// @vitest-environment jsdom

import React from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  AutologinApi,
  EmbeddedBrowserNewWindowEvent,
  EmbeddedBrowserTab
} from '@shared/types'
import { BrowserWorkspace } from '../../src/renderer/src/components/BrowserWorkspace'
import { I18nProvider } from '../../src/renderer/src/i18n'

const tab: EmbeddedBrowserTab = {
  label: 'embedded-new-window',
  accountId: 'manual-embedded-new-window',
  siteId: 'manual-embedded-new-window',
  siteName: 'example.test',
  accountLabel: '手动打开',
  groupName: '浏览',
  url: 'https://example.test/popup',
  title: 'example.test',
  isLoading: false,
  createdAt: '2026-11-12T15:00:00.000Z'
}

let container: HTMLDivElement
let root: Root
let newWindowListener: ((event: EmbeddedBrowserNewWindowEvent) => void) | null

const secondTab: EmbeddedBrowserTab = {
  ...tab,
  label: 'embedded-second',
  accountId: 'manual-embedded-second',
  siteId: 'manual-embedded-second',
  siteName: 'second.test',
  url: 'https://second.test/',
  title: 'second.test'
}

const openUrl = vi.fn(async () => tab)
const back = vi.fn(async () => undefined)
const reload = vi.fn(async () => undefined)
const hideAll = vi.fn(async () => undefined)
const navigate = vi.fn(async () => tab)
const activate = vi.fn(async () => undefined)
const close = vi.fn(async () => undefined)
const setBounds = vi.fn(async () => undefined)

beforeEach(() => {
  ;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
    .IS_REACT_ACT_ENVIRONMENT = true
  newWindowListener = null
  vi.clearAllMocks()
  class ResizeObserverStub {
    observe(): void {}
    disconnect(): void {}
    unobserve(): void {}
  }
  vi.stubGlobal('ResizeObserver', ResizeObserverStub)
  HTMLElement.prototype.scrollTo = vi.fn()

  Object.defineProperty(window, 'autologin', {
    configurable: true,
    value: {
      browser: {
        listTabs: async () => [],
        openUrl,
        activate,
        close,
        navigate,
        back,
        reload,
        setBounds,
        hideAll
      },
      events: {
        onBrowserTabs: () => () => undefined,
        onBrowserNewWindow: (
          callback: (event: EmbeddedBrowserNewWindowEvent) => void
        ) => {
          newWindowListener = callback
          return () => {
            newWindowListener = null
          }
        }
      }
    } as unknown as AutologinApi
  })

  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  vi.unstubAllGlobals()
})

describe('BrowserWorkspace', () => {
  it('labels tabs with the loaded page title instead of the site name', async () => {
    act(() => {
      root.render(
        React.createElement(
          I18nProvider,
          {
            language: 'zh-CN',
            children: React.createElement(BrowserWorkspace, {
              notify: () => undefined,
              onOpenAccounts: () => undefined
            })
          }
        )
      )
    })
    await flush()

    openUrl.mockResolvedValueOnce({
      ...tab,
      siteName: 'baidu.com',
      pageTitle: '百度一下，你就知道',
      url: 'https://www.baidu.com/',
      pageUrl: 'https://www.baidu.com/'
    })
    act(() => {
      newWindowListener?.({ url: 'https://www.baidu.com/' })
    })
    await flush()

    openUrl.mockResolvedValueOnce({
      ...secondTab,
      siteName: 'baidu.com',
      pageTitle: '深圳时间_百度搜索',
      url: 'https://www.baidu.com/s?wd=深圳时间',
      pageUrl: 'https://www.baidu.com/s?wd=深圳时间'
    })
    act(() => {
      newWindowListener?.({
        url: 'https://www.baidu.com/s?wd=深圳时间'
      })
    })
    await flush()

    expect(container.textContent).toContain('百度一下，你就知道')
    expect(container.textContent).toContain('深圳时间_百度搜索')
  })

  it('opens page-requested windows in a new tab and supports going back', async () => {
    act(() => {
      root.render(
        React.createElement(
          I18nProvider,
          {
            language: 'zh-CN',
            children: React.createElement(BrowserWorkspace, {
              notify: () => undefined,
              onOpenAccounts: () => undefined
            })
          }
        )
      )
    })
    await flush()

    expect(container.textContent).not.toContain('打开最近访问')
    expect(
      container.querySelector<HTMLButtonElement>('button[aria-label="返回上一页"]')
        ?.disabled
    ).toBe(true)

    act(() => {
      newWindowListener?.({ url: tab.url })
    })
    await flush()

    expect(openUrl).toHaveBeenCalledWith(tab.url)
    expect(container.textContent).toContain('example.test')
    expect(
      container.querySelector<HTMLButtonElement>('button[aria-label="返回上一页"]')
        ?.disabled
    ).toBe(false)

    const backButton = container.querySelector<HTMLButtonElement>(
      'button[aria-label="返回上一页"]'
    )
    act(() => backButton?.click())
    await flush()

    expect(back).toHaveBeenCalledWith(tab.label)
  })

  it('keeps the viewport free of horizontal menu padding', async () => {
    act(() => {
      root.render(
        React.createElement(
          I18nProvider,
          {
            language: 'zh-CN',
            children: React.createElement(BrowserWorkspace, {
              notify: () => undefined,
              onOpenAccounts: () => undefined
            })
          }
        )
      )
    })
    await flush()

    act(() => {
      newWindowListener?.({ url: tab.url })
    })
    await flush()

    expect(
      container.querySelector('button[aria-label="查看全部页面"]')
    ).toBeNull()
    expect(
      container.querySelectorAll(
        '.browser-workspace__copy-actions .browser-workspace__icon-button'
      )
    ).toHaveLength(2)

    openUrl.mockResolvedValueOnce(secondTab)
    act(() => {
      newWindowListener?.({ url: secondTab.url })
    })
    await flush()

    const wrap = container.querySelector('.browser-workspace__viewport-wrap')
    expect(wrap?.className).toBe('browser-workspace__viewport-wrap')

    const allPages = container.querySelector<HTMLButtonElement>(
      'button[aria-label="查看全部页面"]'
    )
    expect(allPages).not.toBeNull()
    act(() => allPages?.click())
    await flush()

    expect(container.querySelector('.browser-workspace__overview')).not.toBeNull()
    expect(container.querySelector('.browser-workspace__tab-menu')).toBeNull()
    // 不再用 --menu-h 把页面顶下去：页面总览接管视图区，原生视图先收起。
    expect(wrap?.getAttribute('style')).toBeNull()
    expect(hideAll).toHaveBeenCalled()
  })
})

async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
}
