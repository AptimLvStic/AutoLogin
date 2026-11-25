import { useEffect, useRef, useState } from 'react'
import type { Notify } from './Toast'
import { CircleAlert, LoaderCircle, Square, X } from 'lucide-react'
import type { LoginBatchItem, LoginBatchState } from '@shared/types'
import { useI18n } from '../i18n'
import { embeddedBrowserBounds } from '../native-browser-bounds'

function tabInitial(value: string): string {
  return (value.trim().slice(0, 1) || '?').toUpperCase()
}

function tabSubtitle(siteName: string, accountLabel: string): string {
  const label = accountLabel.trim()
  return label && label !== siteName.trim() ? label : ''
}

export function EmbeddedBatchBrowser({
  state,
  notify,
  onClose
}: {
  state: LoginBatchState
  notify: Notify
  onClose: () => void
}): React.JSX.Element {
  const { tr } = useI18n()
  const items = state.items.filter((item) => item.loginBrowser === 'builtin')
  const firstReady = items.find((item) => item.embeddedReady)?.accountId
  const [activeAccountId, setActiveAccountId] = useState(firstReady ?? items[0]?.accountId ?? '')
  const viewportRef = useRef<HTMLDivElement>(null)
  const activeItem =
    items.find((item) => item.accountId === activeAccountId) ?? items[0] ?? null

  useEffect(() => {
    if (!activeAccountId && firstReady) {
      setActiveAccountId(firstReady)
      return
    }
    if (
      activeAccountId &&
      !items.some(
        (item) => item.accountId === activeAccountId && item.embeddedReady
      ) &&
      firstReady
    ) {
      setActiveAccountId(firstReady)
    }
  }, [activeAccountId, firstReady, items])

  useEffect(() => {
    if (!activeItem?.embeddedReady) return
    void window.autologin.login.setEmbeddedActive(activeItem.accountId)
  }, [activeItem?.accountId, activeItem?.embeddedReady])

  useEffect(() => {
    const viewport = viewportRef.current
    if (!viewport) return
    let frame = 0
    const updateBounds = (): void => {
      const bounds = embeddedBrowserBounds(viewport)
      if (bounds) {
        void window.autologin.login.setEmbeddedBounds(bounds)
      }
    }
    const schedule = (): void => {
      if (frame) window.cancelAnimationFrame(frame)
      frame = window.requestAnimationFrame(() => {
        frame = 0
        updateBounds()
      })
    }
    const observer = new ResizeObserver(schedule)
    observer.observe(viewport)
    window.addEventListener('resize', schedule)
    schedule()
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', schedule)
      if (frame) window.cancelAnimationFrame(frame)
    }
  }, [activeItem?.accountId])

  async function cancelBatch(): Promise<void> {
    try {
      await window.autologin.login.cancelBatch()
      notify('info', tr('批量登录已中断', 'Batch sign-in stopped.', '批次登入已中斷'))
      onClose()
    } catch (error) {
      notify(
        'error',
        error instanceof Error
          ? error.message
          : tr('无法中断批量登录', 'Could not stop batch sign-in.', '無法中斷批次登入')
      )
    }
  }

  async function closeBrowser(): Promise<void> {
    try {
      await window.autologin.login.closeEmbeddedTabs()
    } finally {
      onClose()
    }
  }

  return (
    <section className="embedded-batch-browser" aria-label={tr('内置浏览器', 'Built-in browser', '內建瀏覽器')}>
      <header className="embedded-batch-browser__header">
        <div className="embedded-batch-browser__tabs" role="tablist">
          {items.map((item) => (
            <button
              key={item.accountId}
              type="button"
              role="tab"
              aria-selected={item.accountId === activeItem?.accountId}
              className={`embedded-batch-tab${
                item.accountId === activeItem?.accountId ? ' is-active' : ''
              }`}
              onClick={() => setActiveAccountId(item.accountId)}
              disabled={!item.embeddedReady}
              title={[item.siteName, tabSubtitle(item.siteName, item.accountLabel)]
                .filter(Boolean)
                .join(' · ')}
            >
              <span className="embedded-batch-tab__avatar" aria-hidden="true">
                {!item.embeddedReady ? (
                  <LoaderCircle size={11} className="spin" />
                ) : (
                  tabInitial(item.siteName)
                )}
              </span>
              <span className="embedded-batch-tab__copy">
                <strong>{item.siteName}</strong>
                {tabSubtitle(item.siteName, item.accountLabel) && (
                  <small>{item.accountLabel}</small>
                )}
              </span>
            </button>
          ))}
        </div>
        <div className="embedded-batch-browser__summary">
          <span>
            {tr(
              `成功 ${state.success} · 待处理 ${state.manual} · 失败 ${state.failed}`,
              `${state.success} succeeded · ${state.manual} need attention · ${state.failed} failed`,
              `成功 ${state.success} · 待處理 ${state.manual} · 失敗 ${state.failed}`
            )}
          </span>
          {state.active ? (
            <button
              type="button"
              className="button button--danger-ghost button--small"
              onClick={() => void cancelBatch()}
            >
              <Square size={12} fill="currentColor" />
              {tr('中断', 'Stop', '中斷')}
            </button>
          ) : (
            <button
              type="button"
              className="button button--ghost button--small"
              onClick={() => void closeBrowser()}
            >
              <X size={14} />
              {tr('关闭页面', 'Close pages', '關閉頁面')}
            </button>
          )}
        </div>
      </header>
      <div className="embedded-batch-browser__bar">
        <span className={`batch-state-dot batch-state-dot--${activeItem?.status ?? 'queued'}`} />
        <strong>{activeItem?.siteName ?? tr('正在准备页面', 'Preparing pages', '正在準備頁面')}</strong>
        <small>{activeItem?.message ?? ''}</small>
      </div>
      {items.length === 0 ? (
        <div className="embedded-batch-browser__empty">
          <CircleAlert size={22} />
          <span>{tr('没有内置浏览器页面', 'No built-in browser pages', '沒有內建瀏覽器頁面')}</span>
        </div>
      ) : (
        <div ref={viewportRef} className="embedded-batch-browser__viewport" />
      )}
    </section>
  )
}

export function hasBuiltinBatchItems(state: LoginBatchState | null): boolean {
  return Boolean(
    state?.items.some((item) => item.loginBrowser === 'builtin')
  )
}

export function builtinBatchItemCount(state: LoginBatchState | null): number {
  return state?.items.filter((item) => item.loginBrowser === 'builtin').length ?? 0
}
