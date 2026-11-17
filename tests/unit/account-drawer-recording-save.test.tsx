// @vitest-environment jsdom

import React from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  AccountWithSite,
  AutologinApi,
  LoginViewState,
  Site
} from '../../src/shared/types'
import { AccountDrawer } from '../../src/renderer/src/components/AccountDrawer'
import { I18nProvider } from '../../src/renderer/src/i18n'

let container: HTMLDivElement
let root: Root
let previousApi: AutologinApi | undefined

beforeEach(() => {
  ;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
    .IS_REACT_ACT_ENVIRONMENT = true
  previousApi = window.autologin
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  document.querySelectorAll('.modal-layer').forEach((element) => element.remove())
  window.autologin = previousApi as AutologinApi
})

describe('AccountDrawer recording save recovery', () => {
  it('shows the failure reason and lets the user close without cancelling recording', async () => {
    const finishRecording = vi.fn(async () => {
      throw new Error('模拟保存失败')
    })
    const recordingSaveStatus = vi.fn(async () => ({
      state: 'failed' as const,
      error: '模拟保存失败'
    }))
    const cancelRecording = vi.fn(async () => undefined)
    const reportUiFailure = vi.fn(async () => undefined)
    window.autologin = {
      accounts: {
        reveal: vi.fn(async () => ({
          password: 'secret',
          expiresAt: Date.now() + 10_000
        }))
      },
      login: {
        finishRecording,
        recordingSaveStatus,
        cancelRecording
      },
      app: {
        reportUiFailure
      }
    } as unknown as AutologinApi

    const { site, account, loginState } = createDrawerFixture()
    const onClose = vi.fn()

    renderDrawer({ site, account, loginState, onClose })

    const openSummary = findButton(container, '完成录制')
    act(() => openSummary.click())
    const summary = document.querySelector<HTMLElement>('.recording-summary-dialog')
    if (!summary) throw new Error('未打开录制摘要')

    const nameInput = summary.querySelector<HTMLInputElement>(
      '.recording-summary__name input'
    )
    if (!nameInput) throw new Error('未找到流程名称输入框')
    const valueSetter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      'value'
    )?.set
    act(() => {
      valueSetter?.call(nameInput, '失败测试流程')
      nameInput.dispatchEvent(new Event('input', { bubbles: true }))
    })

    const saveButton = findButton(summary, '完成录制')
    act(() => saveButton.click())

    await waitFor(() => {
      expect(reportUiFailure).toHaveBeenCalledOnce()
      expect(summary.textContent).toContain('模拟保存失败')
    })
    const closeButton = findButton(summary, '关闭编辑页')
    act(() => closeButton.click())

    expect(cancelRecording).not.toHaveBeenCalled()
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('recovers a timed-out save through the lightweight status endpoint', async () => {
    const { site, account, loginState } = createDrawerFixture()
    const finishRecording = vi.fn(async () => {
      throw new Error('保存录制流程未完成（已等待 20 秒）')
    })
    const recordingSaveStatus = vi.fn(async () => ({
      state: 'saved' as const,
      result: {
        accountId: account.id,
        siteId: site.id,
        recipeId: 'recipe-1',
        recipe: {
          version: 1 as const,
          startUrl: site.startUrl,
          allowedOrigins: site.allowedOrigins,
          steps: [
            {
              id: 'step-1',
              type: 'fillUsername' as const,
              selector: { candidates: ['#username'] }
            }
          ],
          createdAt: site.createdAt,
          updatedAt: site.updatedAt
        },
        saved: true as const
      }
    }))
    const notify = vi.fn()
    const reportUiFailure = vi.fn(async () => undefined)
    const onChanged = vi.fn(async () => undefined)
    window.autologin = {
      accounts: {
        reveal: vi.fn(async () => ({
          password: 'secret',
          expiresAt: Date.now() + 10_000
        }))
      },
      login: {
        finishRecording,
        recordingSaveStatus,
        cancelRecording: vi.fn(async () => undefined)
      },
      app: {
        reportUiFailure
      }
    } as unknown as AutologinApi

    renderDrawer({
      site,
      account,
      loginState,
      onClose: vi.fn(),
      onChanged,
      notify
    })

    act(() => findButton(container, '完成录制').click())
    const summary = document.querySelector<HTMLElement>('.recording-summary-dialog')
    if (!summary) throw new Error('未打开录制摘要')
    act(() => findButton(summary, '完成录制').click())

    await waitFor(() => {
      expect(recordingSaveStatus).toHaveBeenCalled()
      expect(onChanged).toHaveBeenCalledOnce()
    })
    expect(notify).toHaveBeenCalledWith('success', '检测到流程已保存并启用')
    expect(reportUiFailure).not.toHaveBeenCalled()
    expect(document.querySelector('.recording-summary-dialog')).toBeNull()
  })

  it('treats a safely persisted draft as a successful recovery state', async () => {
    const { site, account, loginState } = createDrawerFixture()
    const finishRecording = vi.fn(async () => ({
      accountId: account.id,
      siteId: site.id,
      recipe: {
        version: 1 as const,
        startUrl: site.startUrl,
        allowedOrigins: site.allowedOrigins,
        steps: loginState.recordingSteps.map((step) => ({
          id: step.id,
          type: 'fillUsername' as const,
          selector: { candidates: ['#username'] }
        })),
        createdAt: site.createdAt,
        updatedAt: site.updatedAt
      },
      saved: false as const,
      draftSaved: true as const
    }))
    const notify = vi.fn()
    const reportUiFailure = vi.fn(async () => undefined)
    const onChanged = vi.fn(async () => undefined)
    window.autologin = {
      accounts: {
        reveal: vi.fn(async () => ({
          password: 'secret',
          expiresAt: Date.now() + 10_000
        }))
      },
      login: {
        finishRecording,
        recordingSaveStatus: vi.fn(async () => ({ state: 'idle' as const })),
        cancelRecording: vi.fn(async () => undefined)
      },
      app: {
        reportUiFailure
      }
    } as unknown as AutologinApi

    renderDrawer({
      site,
      account,
      loginState,
      onClose: vi.fn(),
      onChanged,
      notify
    })

    act(() => findButton(container, '完成录制').click())
    const summary = document.querySelector<HTMLElement>('.recording-summary-dialog')
    if (!summary) throw new Error('未打开录制摘要')
    act(() => findButton(summary, '完成录制').click())

    await waitFor(() => {
      expect(notify).toHaveBeenCalledWith(
        'success',
        '保险库暂未写入，录制草稿已保存；重启后会自动恢复'
      )
    })
    expect(reportUiFailure).not.toHaveBeenCalled()
    expect(onChanged).not.toHaveBeenCalled()
    expect(document.querySelector('.recording-summary-dialog')).toBeNull()
  })

  it('recognizes a draft_saved status after the save request times out', async () => {
    const { site, account, loginState } = createDrawerFixture()
    const finishRecording = vi.fn(async () => {
      throw new Error('保存录制流程未完成（已等待 21 秒）')
    })
    const recordingSaveStatus = vi.fn(async () => ({
      state: 'draft_saved' as const,
      result: {
        accountId: account.id,
        siteId: site.id,
        recipe: {
          version: 1 as const,
          startUrl: site.startUrl,
          allowedOrigins: site.allowedOrigins,
          steps: [],
          createdAt: site.createdAt,
          updatedAt: site.updatedAt
        },
        saved: false as const,
        draftSaved: true as const
      }
    }))
    const notify = vi.fn()
    const reportUiFailure = vi.fn(async () => undefined)
    window.autologin = {
      accounts: {
        reveal: vi.fn(async () => ({
          password: 'secret',
          expiresAt: Date.now() + 10_000
        }))
      },
      login: {
        finishRecording,
        recordingSaveStatus,
        cancelRecording: vi.fn(async () => undefined)
      },
      app: {
        reportUiFailure
      }
    } as unknown as AutologinApi

    renderDrawer({ site, account, loginState, onClose: vi.fn(), notify })

    act(() => findButton(container, '完成录制').click())
    const summary = document.querySelector<HTMLElement>('.recording-summary-dialog')
    if (!summary) throw new Error('未打开录制摘要')
    act(() => findButton(summary, '完成录制').click())

    await waitFor(() => {
      expect(recordingSaveStatus).toHaveBeenCalled()
      expect(notify).toHaveBeenCalledWith(
        'success',
        '保险库暂未写入，录制草稿已保存；重启后会自动恢复'
      )
    })
    expect(reportUiFailure).not.toHaveBeenCalled()
    expect(document.querySelector('.recording-summary-dialog')).toBeNull()
  })

  it('does not treat an idle backend status as an in-progress save', async () => {
    const { site, account, loginState } = createDrawerFixture()
    const recordingSaveStatus = vi.fn(async () => ({ state: 'idle' as const }))
    const reportUiFailure = vi.fn(async () => undefined)
    window.autologin = {
      accounts: {
        reveal: vi.fn(async () => ({
          password: 'secret',
          expiresAt: Date.now() + 10_000
        }))
      },
      login: {
        finishRecording: vi.fn(async () => {
          throw new Error('保存录制流程未完成（已等待 20 秒）')
        }),
        recordingSaveStatus,
        cancelRecording: vi.fn(async () => undefined)
      },
      app: {
        reportUiFailure
      }
    } as unknown as AutologinApi

    renderDrawer({ site, account, loginState, onClose: vi.fn() })
    act(() => findButton(container, '完成录制').click())
    const summary = document.querySelector<HTMLElement>('.recording-summary-dialog')
    if (!summary) throw new Error('未打开录制摘要')
    act(() => findButton(summary, '完成录制').click())

    await waitFor(() => {
      expect(reportUiFailure).toHaveBeenCalledOnce()
      expect(summary.textContent).toContain(
        '后台没有收到这次保存请求（可能已与界面断开）'
      )
    })
    expect(recordingSaveStatus).toHaveBeenCalledOnce()
  })
})

interface DrawerFixture {
  site: Site
  account: AccountWithSite
  loginState: LoginViewState
}

function createDrawerFixture(): DrawerFixture {
  const site: Site = {
    id: 'site-1',
    tabId: 'local',
    name: '测试站点',
    startUrl: 'https://example.test/login',
    allowedOrigins: ['https://example.test'],
    autoSubmit: true,
    createdAt: '2026-11-16T00:00:00.000Z',
    updatedAt: '2026-11-16T00:00:00.000Z'
  }
  const account: AccountWithSite = {
    id: 'account-1',
    tabId: 'local',
    siteId: site.id,
    label: site.name,
    username: 'tester',
    favorite: false,
    loginStrategy: 'auto',
    loginBrowser: 'standalone',
    recipes: [],
    createdAt: site.createdAt,
    updatedAt: site.updatedAt,
    site
  }
  const loginState: LoginViewState = {
    active: true,
    accountId: account.id,
    mode: 'record',
    status: 'authenticated',
    message: '登录成功',
    currentUrl: site.startUrl,
    currentOrigin: 'https://example.test',
    pageTitle: site.name,
    isLoading: false,
    originTrusted: true,
    recording: true,
    recipeExists: false,
    recordingStepCount: 1,
    recordingSteps: [
      {
        id: 'step-1',
        type: 'fillUsername',
        selectorLabel: '#username'
      }
    ],
    recordingPaused: false,
    recordingStartedAt: site.createdAt,
    browserName: 'Google Chrome'
  }
  return { site, account, loginState }
}

function renderDrawer(input: {
  site: Site
  account: AccountWithSite
  loginState: LoginViewState
  onClose: () => void
  onChanged?: () => Promise<void>
  notify?: (kind: 'success' | 'error' | 'info', message: string) => void
}): void {
  act(() => {
    root.render(
      React.createElement(
        I18nProvider,
        {
          language: 'zh-CN',
          children: React.createElement(AccountDrawer, {
            tabId: 'local',
            mode: 'edit',
            account: input.account,
            sites: [input.site],
            groups: [],
            onClose: input.onClose,
            onSaved: vi.fn(),
            onChanged: input.onChanged ?? vi.fn(async () => undefined),
            loginState: input.loginState,
            recordingFinishRequest: 0,
            onRecordingFinishHandled: vi.fn(),
            notify: input.notify ?? vi.fn()
          })
        }
      )
    )
  })
}

function findButton(scope: ParentNode, label: string): HTMLButtonElement {
  const button = [...scope.querySelectorAll('button')].find(
    (candidate) => candidate.textContent?.trim() === label
  )
  if (!(button instanceof HTMLButtonElement)) {
    throw new Error(`未找到按钮：${label}`)
  }
  return button
}

async function waitFor(assertion: () => void): Promise<void> {
  const deadline = Date.now() + 2_000
  while (Date.now() < deadline) {
    try {
      assertion()
      return
    } catch {
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0))
      })
    }
  }
  assertion()
}
