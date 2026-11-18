import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import type {
  EmbeddedBrowserBounds,
  EmbeddedBrowserOpenResult,
  EmbeddedBrowserTab,
  EmbeddedBrowserTabPatch
} from '@shared/types'
import { requestNative } from '../tauri/backend-runtime'
import {
  ExternalBrowserHost,
  type ExternalBrowserEvent,
  type ExternalBrowserPage
} from './external-browser'

export interface EmbeddedBrowserProvider {
  open(input: {
    accountId: string
    initialUrl: string
    profileDirectory: string
    siteId: string
    siteName: string
    accountLabel: string
    groupName: string
  }): Promise<EmbeddedBrowserOpenResult>
  show(label: string): void
  hide(label: string): void
  focus(label: string): void
  close(label: string): void
  setBounds(label: string, bounds: EmbeddedBrowserBounds): void
  update(label: string, patch: EmbeddedBrowserTabPatch): void
}

export class EmbeddedBrowserController implements EmbeddedBrowserProvider {
  private readonly tabs = new Map<string, EmbeddedBrowserTab>()
  private readonly manualSessions = new Map<
    string,
    {
      host: ExternalBrowserHost
      page: ExternalBrowserPage
    }
  >()

  constructor(
    private readonly onTabsChanged: (tabs: EmbeddedBrowserTab[]) => void = () => undefined
  ) {}

  async open(input: {
    accountId: string
    initialUrl: string
    profileDirectory: string
    siteId: string
    siteName: string
    accountLabel: string
    groupName: string
  }): Promise<EmbeddedBrowserOpenResult> {
    const label = `embedded-${input.accountId}-${randomUUID().slice(0, 8)}`
    const result = await requestNative<EmbeddedBrowserOpenResult>(
      'embedded-browser-open',
      {
        label,
        url: input.initialUrl,
        profileDirectory: input.profileDirectory
      }
    )
    this.tabs.set(result.label, {
      label: result.label,
      accountId: input.accountId,
      siteId: input.siteId,
      siteName: input.siteName,
      accountLabel: input.accountLabel,
      groupName: input.groupName,
      url: input.initialUrl,
      pageUrl: input.initialUrl,
      title: input.siteName,
      isLoading: true,
      createdAt: new Date().toISOString()
    })
    this.publish()
    return result
  }

  async openUrl(
    url: string,
    profileRoot: string
  ): Promise<EmbeddedBrowserTab> {
    const label = `embedded-manual-${randomUUID().slice(0, 8)}`
    const profileDirectory = join(profileRoot, label)
    const result = await requestNative<EmbeddedBrowserOpenResult>(
      'embedded-browser-open',
      {
        label,
        url,
        profileDirectory
      }
    )
    const siteName = displaySiteName(url)
    const tab: EmbeddedBrowserTab = {
      label: result.label,
      accountId: `manual-${result.label}`,
      siteId: `manual-${result.label}`,
      siteName,
      accountLabel: '手动打开',
      groupName: '浏览',
      url,
      pageUrl: url,
      title: siteName,
      isLoading: true,
      createdAt: new Date().toISOString()
    }
    this.tabs.set(result.label, tab)
    this.publish()

    try {
      const host = await ExternalBrowserHost.attach({
        debugPort: result.debugPort,
        profileDirectory
      })
      let page: ExternalBrowserPage | null = null
      page = await host.createPage({
        initialUrl: url,
        onEvent: (event) => this.handleManualEvent(result.label, event),
        onClosed: () => {
          this.manualSessions.delete(result.label)
          this.removeTab(result.label)
          void host.close().catch(() => undefined)
        }
      })
      if (!this.tabs.has(result.label)) {
        await page.close().catch(() => undefined)
        await host.close().catch(() => undefined)
        throw new Error('浏览器标签已关闭')
      }
      this.manualSessions.set(result.label, { host, page })
      const snapshot = page.getSnapshot()
      this.update(result.label, {
        url: snapshot.url || url,
        pageUrl: snapshot.url || url,
        pageTitle: snapshot.title || '',
        title: snapshot.title || siteName,
        isLoading: snapshot.loading
      })
      return { ...this.tabs.get(result.label)! }
    } catch (error) {
      this.removeTab(result.label)
      this.control(result.label, 'close')
      throw error
    }
  }

  list(): EmbeddedBrowserTab[] {
    return [...this.tabs.values()]
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
      .map((tab) => ({ ...tab }))
  }

  activate(label: string): void {
    if (!this.tabs.has(label)) {
      throw new Error('浏览器标签不存在')
    }
    for (const tab of this.tabs.values()) {
      if (tab.label !== label) this.hide(tab.label)
    }
    this.show(label)
    this.focus(label)
  }

  show(label: string): void {
    this.control(label, 'show')
  }

  hide(label: string): void {
    this.control(label, 'hide')
  }

  focus(label: string): void {
    this.control(label, 'focus')
  }

  close(label: string): void {
    if (!this.tabs.has(label)) return
    this.removeTab(label)
    const manual = this.manualSessions.get(label)
    if (manual) {
      this.manualSessions.delete(label)
      void manual.page
        .close()
        .catch(() => undefined)
        .finally(() => manual.host.close().catch(() => undefined))
    }
    this.control(label, 'close')
  }

  setBounds(label: string, bounds: EmbeddedBrowserBounds): void {
    this.control(label, 'set-bounds', bounds)
  }

  update(label: string, patch: EmbeddedBrowserTabPatch): void {
    const tab = this.tabs.get(label)
    if (!tab) return
    const next: EmbeddedBrowserTab = {
      ...tab,
      ...(patch.url !== undefined ? { url: patch.url } : {}),
      ...(patch.title !== undefined ? { title: patch.title } : {}),
      ...(patch.pageTitle !== undefined ? { pageTitle: patch.pageTitle } : {}),
      ...(patch.pageUrl !== undefined ? { pageUrl: patch.pageUrl } : {}),
      ...(patch.isLoading !== undefined ? { isLoading: patch.isLoading } : {})
    }
    if (
      next.url === tab.url &&
      next.title === tab.title &&
      next.pageTitle === tab.pageTitle &&
      next.pageUrl === tab.pageUrl &&
      next.isLoading === tab.isLoading
    ) {
      return
    }
    this.tabs.set(label, next)
    this.publish()
  }

  hideAll(): void {
    for (const label of this.tabs.keys()) {
      this.hide(label)
    }
  }

  async navigate(label: string, url: string): Promise<EmbeddedBrowserTab> {
    const tab = this.tabs.get(label)
    if (!tab) throw new Error('浏览器标签不存在')
    await requestNative(
      'embedded-browser-control',
      { label, action: 'navigate', url },
      15_000
    )
    this.update(label, { url, pageUrl: url, pageTitle: '', isLoading: true })
    return { ...this.tabs.get(label)! }
  }

  async back(label: string): Promise<void> {
    if (!this.tabs.has(label)) throw new Error('浏览器标签不存在')
    await requestNative(
      'embedded-browser-control',
      { label, action: 'back' },
      15_000
    )
    this.update(label, { pageTitle: '', isLoading: true })
  }

  async reload(label: string): Promise<void> {
    if (!this.tabs.has(label)) throw new Error('浏览器标签不存在')
    await requestNative(
      'embedded-browser-control',
      { label, action: 'reload' },
      15_000
    )
    this.update(label, { pageTitle: '', isLoading: true })
  }

  closeAll(): void {
    for (const label of this.tabs.keys()) {
      const manual = this.manualSessions.get(label)
      if (manual) {
        this.manualSessions.delete(label)
        void manual.page
          .close()
          .catch(() => undefined)
          .finally(() => manual.host.close().catch(() => undefined))
      }
      this.control(label, 'close')
    }
    this.tabs.clear()
    this.publish()
  }

  private handleManualEvent(label: string, event: ExternalBrowserEvent): void {
    if (!this.tabs.has(label)) return
    if (event.type === 'navigation') {
      this.update(label, {
        url: event.url,
        pageUrl: event.url,
        pageTitle: '',
        isLoading: true
      })
      return
    }
    if (event.type === 'loaded' || event.type === 'page') {
      this.update(label, {
        url: event.url,
        pageUrl: event.url,
        pageTitle: event.title,
        title: event.title,
        isLoading: event.type === 'page' ? event.loading : false
      })
    }
  }

  private removeTab(label: string): void {
    if (!this.tabs.delete(label)) return
    this.publish()
  }

  private control(
    label: string,
    action: 'show' | 'hide' | 'focus' | 'close' | 'set-bounds',
    bounds?: EmbeddedBrowserBounds
  ): void {
    void requestNative(
      'embedded-browser-control',
      {
        label,
        action,
        ...(bounds ? { bounds } : {})
      },
      5_000
    ).catch(() => undefined)
  }

  private publish(): void {
    this.onTabsChanged(this.list())
  }
}

function displaySiteName(value: string): string {
  try {
    const url = new URL(value)
    return url.hostname.replace(/^www\./i, '') || url.toString()
  } catch {
    return value
  }
}
