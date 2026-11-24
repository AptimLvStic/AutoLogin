import {
  FormEvent,
  KeyboardEvent as ReactKeyboardEvent,
  useEffect,
  useRef,
  useState,
  WheelEvent
} from 'react'
import type { CSSProperties } from 'react'
import {
  ArrowLeft,
  Check,
  ChevronDown,
  Globe2,
  KeyRound,
  LoaderCircle,
  LockKeyhole,
  Plus,
  RefreshCw,
  UserRound,
  X
} from 'lucide-react'
import type { AccountWithSite, EmbeddedBrowserTab } from '@shared/types'
import { useI18n } from '../i18n'
import { embeddedBrowserBounds } from '../native-browser-bounds'
import { ConfirmDialog } from './Modal'

type Notify = (kind: 'success' | 'error' | 'info', message: string) => void
const BROWSER_TAB_COLORS = [
  '#4A55E0',
  '#0E9F6E',
  '#C2410C',
  '#7C3AED',
  '#0F766E',
  '#1D4ED8',
  '#A16207',
  '#BE123C'
] as const

function normalizeAddress(value: string): string {
  const trimmed = value.trim()
  if (!trimmed) throw new Error('请输入页面地址')
  const candidate = /^[a-z][a-z\d+.-]*:/i.test(trimmed)
    ? trimmed
    : `https://${trimmed}`
  const url = new URL(candidate)
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('只支持 http 或 https 地址')
  }
  return url.toString()
}

function mergeTab(
  current: EmbeddedBrowserTab[],
  next: EmbeddedBrowserTab
): EmbeddedBrowserTab[] {
  return current.some((tab) => tab.label === next.label)
    ? current.map((tab) => (tab.label === next.label ? next : tab))
    : [...current, next]
}

function tabSubtitle(siteName: string, accountLabel: string): string {
  const label = accountLabel.trim()
  return label && label !== siteName.trim() ? label : ''
}

function tabDisplayTitle(tab: EmbeddedBrowserTab): string {
  const pageTitle = tab.pageTitle?.trim()
  if (pageTitle) return pageTitle
  const siteName = tab.siteName.trim()
  if (siteName) return siteName
  const url = tab.pageUrl || tab.url
  try {
    return new URL(url).hostname.replace(/^www\./i, '') || url
  } catch {
    return url || '—'
  }
}

function splitTabTitle(value: string): { prefix: string; suffix: string } {
  const title = value.trim()
  const characters = [...title]
  if (characters.length <= 18) return { prefix: title, suffix: '' }
  return {
    prefix: `${characters.slice(0, 12).join('')}…`,
    suffix: characters.slice(-6).join('')
  }
}

function tabGroupColor(groupName: string): string {
  let hash = 0
  for (const character of groupName || '未分组') {
    hash = (hash * 31 + character.charCodeAt(0)) | 0
  }
  return (
    BROWSER_TAB_COLORS[Math.abs(hash) % BROWSER_TAB_COLORS.length] ?? '#4A55E0'
  )
}

function tabDensity(count: number): 'relaxed' | 'standard' | 'compact' {
  if (count <= 6) return 'relaxed'
  if (count <= 11) return 'standard'
  return 'compact'
}

export function BrowserWorkspace({
  notify,
  onOpenAccounts
}: {
  notify: Notify
  onOpenAccounts: () => void
}): React.JSX.Element {
  const { tr } = useI18n()
  const [tabs, setTabs] = useState<EmbeddedBrowserTab[]>([])
  const [activeLabel, setActiveLabel] = useState('')
  const [newTabDraft, setNewTabDraft] = useState(false)
  const [address, setAddress] = useState('')
  const [loadingTabs, setLoadingTabs] = useState(true)
  const [navigating, setNavigating] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [copiedField, setCopiedField] = useState<'username' | 'password' | null>(null)
  const [accounts, setAccounts] = useState<AccountWithSite[]>([])
  const [selectedAccountId, setSelectedAccountId] = useState('')
  const [accountMenuOpen, setAccountMenuOpen] = useState(false)
  const [overflowOpen, setOverflowOpen] = useState(false)
  const [hasTabOverflow, setHasTabOverflow] = useState(false)
  const [goingBack, setGoingBack] = useState(false)
  const [closeAllConfirmOpen, setCloseAllConfirmOpen] = useState(false)
  const [closingAll, setClosingAll] = useState(false)
  const tabsRef = useRef<HTMLDivElement>(null)
  const viewportRef = useRef<HTMLDivElement>(null)
  const viewportWrapRef = useRef<HTMLDivElement>(null)
  const accountMenuRef = useRef<HTMLDivElement>(null)
  const accountTriggerRef = useRef<HTMLButtonElement>(null)
  const addressInputRef = useRef<HTMLInputElement>(null)
  const overflowRef = useRef<HTMLDivElement>(null)
  const overviewRef = useRef<HTMLDivElement>(null)
  const copyFeedbackTimerRef = useRef<number | null>(null)
  const newTabDraftRef = useRef(false)
  const activeBeforeDraftRef = useRef('')
  const active = tabs.find((tab) => tab.label === activeLabel) ?? null
  const siteAccounts = active
    ? accounts.filter((item) => item.siteId === active.siteId)
    : []
  const currentAccountId = siteAccounts.some((item) => item.id === selectedAccountId)
    ? selectedAccountId
    : active?.accountId ?? ''
  const currentAccount =
    siteAccounts.find((item) => item.id === currentAccountId) ?? null
  const currentAccountLabel =
    currentAccount?.label || active?.accountLabel || ''
  const density = tabDensity(tabs.length)
  // 没有任何标签时不要留一条空标签栏，把「新建标签页」并进工具栏。
  const showTabsBar = tabs.length > 0 || newTabDraft || loadingTabs

  useEffect(() => {
    let cancelled = false
    const applyTabs = (next: EmbeddedBrowserTab[]): void => {
      if (cancelled) return
      setTabs(next)
      setActiveLabel((current) =>
        newTabDraftRef.current
          ? ''
          : next.some((tab) => tab.label === current)
          ? current
          : next[0]?.label ?? ''
      )
    }
    void window.autologin.browser
      .listTabs()
      .then(applyTabs)
      .catch((error) => {
        if (!cancelled) {
          notify(
            'error',
            error instanceof Error
              ? error.message
              : tr('无法读取浏览器标签', 'Could not load browser tabs.', '無法讀取瀏覽器標籤')
          )
        }
      })
      .finally(() => {
        if (!cancelled) setLoadingTabs(false)
      })
    const unsubscribeTabs = window.autologin.events.onBrowserTabs(applyTabs)
    const unsubscribeNewWindow = window.autologin.events.onBrowserNewWindow(
      (event) => {
        if (cancelled || typeof event.url !== 'string' || !event.url) return
        void window.autologin.browser
          .openUrl(event.url)
          .then((tab) => {
            if (cancelled) return
            setDraftOpen(false)
            setTabs((current) => mergeTab(current, tab))
            setActiveLabel(tab.label)
            setAddress(tab.url)
            notify(
              'info',
              tr(
                '已在新标签页打开',
                'Opened in a new tab.',
                '已在新分頁開啟'
              )
            )
          })
          .catch((error) => {
            if (cancelled) return
            notify(
              'error',
              error instanceof Error
                ? error.message
                : tr(
                    '无法打开新标签页',
                    'Could not open the new tab.',
                    '無法開啟新分頁'
                  )
            )
          })
      }
    )
    return () => {
      cancelled = true
      unsubscribeTabs()
      unsubscribeNewWindow()
      void window.autologin.browser.hideAll()
    }
  }, [notify, tr])

  useEffect(() => {
    if (document.activeElement === addressInputRef.current) return
    setAddress(active?.url ?? '')
  }, [active?.label, active?.url])

  // 同一站点可能有多个账号：进入标签页或切换站点时重新取一次，供地址栏右侧选择。
  useEffect(() => {
    let cancelled = false
    const load = window.autologin.accounts?.list
    if (!load) return
    void load()
      .then((next) => {
        if (!cancelled) setAccounts(next)
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [active?.siteId])

  useEffect(() => {
    setSelectedAccountId('')
    setAccountMenuOpen(false)
  }, [active?.label, active?.accountId])

  useEffect(() => {
    if (!accountMenuOpen) return
    const frame = window.requestAnimationFrame(() => {
      accountMenuRef.current
        ?.querySelector<HTMLButtonElement>('[role="option"][aria-selected="true"]')
        ?.focus()
    })
    const handlePointerDown = (event: PointerEvent): void => {
      if (!accountMenuRef.current?.contains(event.target as Node)) {
        setAccountMenuOpen(false)
      }
    }
    document.addEventListener('pointerdown', handlePointerDown)
    return () => {
      window.cancelAnimationFrame(frame)
      document.removeEventListener('pointerdown', handlePointerDown)
    }
  }, [accountMenuOpen])

  useEffect(() => {
    if (!newTabDraft) return
    const frame = window.requestAnimationFrame(() => {
      const element = tabsRef.current
      element?.scrollTo({ left: element.scrollWidth, behavior: 'smooth' })
    })
    return () => window.cancelAnimationFrame(frame)
  }, [newTabDraft])

  useEffect(() => {
    const element = tabsRef.current
    if (!element) return
    let frame = 0
    const measure = (): void => {
      setHasTabOverflow(element.scrollWidth > element.clientWidth + 1)
    }
    const schedule = (): void => {
      if (frame) window.cancelAnimationFrame(frame)
      frame = window.requestAnimationFrame(() => {
        frame = 0
        measure()
      })
    }
    const observer = new ResizeObserver(schedule)
    observer.observe(element)
    window.addEventListener('resize', schedule)
    schedule()
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', schedule)
      if (frame) window.cancelAnimationFrame(frame)
    }
  }, [tabs, newTabDraft])

  useEffect(() => {
    // 总览打开时先收起原生视图：DOM 弹层永远盖不住原生窗口，
    // 收起来既不会把页面往下挤，也不会出现"点击被页面吞掉、弹层关不掉"。
    if (overflowOpen) {
      void window.autologin.browser.hideAll()
      return
    }
    if (!active) return
    let frame = 0
    const updateBounds = (activate: boolean): void => {
      const viewport = viewportRef.current
      if (!viewport) return
      const bounds = embeddedBrowserBounds(viewport)
      if (!bounds) return
      void window.autologin.browser
        .setBounds(active.label, bounds)
        .then(() => {
          if (activate) return window.autologin.browser.activate(active.label)
        })
        .catch(() => undefined)
    }
    const schedule = (activate = false): void => {
      if (frame) window.cancelAnimationFrame(frame)
      frame = window.requestAnimationFrame(() => {
        frame = 0
        updateBounds(activate)
      })
    }
    const onWindowResize = (): void => schedule()
    const observer = new ResizeObserver(() => schedule())
    if (viewportRef.current) observer.observe(viewportRef.current)
    window.addEventListener('resize', onWindowResize)
    schedule(true)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', onWindowResize)
      if (frame) window.cancelAnimationFrame(frame)
    }
  }, [active?.label, overflowOpen])

  useEffect(() => {
    if (!overflowOpen) return
    const closeOnPointer = (event: PointerEvent): void => {
      if (event.target instanceof Node) {
        if (overflowRef.current?.contains(event.target)) return
        if (overviewRef.current?.contains(event.target)) return
      }
      setOverflowOpen(false)
    }
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      setOverflowOpen(false)
    }
    document.addEventListener('pointerdown', closeOnPointer)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('pointerdown', closeOnPointer)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [overflowOpen])

  useEffect(() => {
    if (tabs.length > 1) return
    setOverflowOpen(false)
  }, [tabs.length])

  useEffect(() => {
    setCopiedField(null)
    if (copyFeedbackTimerRef.current !== null) {
      window.clearTimeout(copyFeedbackTimerRef.current)
      copyFeedbackTimerRef.current = null
    }
  }, [active?.label])

  useEffect(
    () => () => {
      if (copyFeedbackTimerRef.current !== null) {
        window.clearTimeout(copyFeedbackTimerRef.current)
      }
    },
    []
  )

  function setDraftOpen(open: boolean): void {
    newTabDraftRef.current = open
    setNewTabDraft(open)
  }

  async function selectTab(label: string): Promise<void> {
    setDraftOpen(false)
    setActiveLabel(label)
    try {
      await window.autologin.browser.activate(label)
    } catch (error) {
      notify(
        'error',
        error instanceof Error
          ? error.message
          : tr('无法切换到该页面', 'Could not switch pages.', '無法切換到該頁面')
      )
    }
  }

  async function openAddress(value: string, message: string): Promise<void> {
    if (navigating) return
    setNavigating(true)
    try {
      const url = normalizeAddress(value)
      const next = active
        ? await window.autologin.browser.navigate(active.label, url)
        : await window.autologin.browser.openUrl(url)
      setDraftOpen(false)
      setTabs((current) => mergeTab(current, next))
      setActiveLabel(next.label)
      setAddress(next.url)
      notify('success', message)
    } catch (error) {
      notify(
        'error',
        error instanceof Error
          ? error.message
          : tr('无法打开页面地址', 'Could not open the page address.', '無法開啟頁面位址')
      )
    } finally {
      setNavigating(false)
    }
  }

  async function navigate(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    await openAddress(
      address,
      tr('页面地址已更新', 'Page address updated.', '頁面位址已更新')
    )
  }

  async function reload(): Promise<void> {
    if (!active || refreshing) return
    setRefreshing(true)
    try {
      await window.autologin.browser.reload(active.label)
    } catch (error) {
      notify(
        'error',
        error instanceof Error
          ? error.message
          : tr('无法刷新页面', 'Could not refresh the page.', '無法重新整理頁面')
      )
    } finally {
      setRefreshing(false)
    }
  }

  async function goBack(): Promise<void> {
    if (!active || goingBack) return
    setGoingBack(true)
    try {
      await window.autologin.browser.back(active.label)
    } catch (error) {
      notify(
        'error',
        error instanceof Error
          ? error.message
          : tr('无法返回上一页', 'Could not go back.', '無法返回上一頁')
      )
    } finally {
      setGoingBack(false)
    }
  }

  async function closeTab(label: string): Promise<void> {
    try {
      await window.autologin.browser.close(label)
      setTabs((current) => {
        const next = current.filter((tab) => tab.label !== label)
        if (label === activeLabel) setActiveLabel(next[0]?.label ?? '')
        return next
      })
    } catch (error) {
      notify(
        'error',
        error instanceof Error
          ? error.message
          : tr('无法关闭浏览器标签', 'Could not close the browser tab.', '無法關閉瀏覽器標籤')
      )
    }
  }

  function closeAllTabs(): void {
    if (closingAll || tabs.length === 0) return
    setClosingAll(true)
    const labels = tabs.map((tab) => tab.label)
    // 先把界面状态清干净，再让原生窗口在后台收尾：
    // 任何一个窗口关闭卡住，都不会把界面留在"白屏且关不掉"的状态。
    setTabs([])
    setActiveLabel('')
    setDraftOpen(false)
    setOverflowOpen(false)
    setCloseAllConfirmOpen(false)
    notify('info', tr('已关闭全部页面', 'All pages closed.', '已關閉全部頁面'))
    void Promise.allSettled(
      labels.map((label) => window.autologin.browser.close(label))
    ).finally(() => setClosingAll(false))
  }

  function chooseAccount(accountId: string): void {
    setSelectedAccountId(accountId)
    setAccountMenuOpen(false)
    window.requestAnimationFrame(() => accountTriggerRef.current?.focus())
  }

  function handleAccountMenuKeyDown(event: ReactKeyboardEvent<HTMLDivElement>): void {
    const options = Array.from(
      accountMenuRef.current?.querySelectorAll<HTMLButtonElement>('[role="option"]') ?? []
    )
    if (event.key === 'Escape') {
      event.preventDefault()
      setAccountMenuOpen(false)
      accountTriggerRef.current?.focus()
      return
    }
    if (event.key === 'Tab') {
      setAccountMenuOpen(false)
      return
    }
    if (event.key === 'Enter' || event.key === ' ') {
      const option = (document.activeElement as HTMLElement | null)?.closest<HTMLElement>(
        '[role="option"]'
      )
      const accountId = option?.dataset.accountId
      if (accountId) {
        event.preventDefault()
        chooseAccount(accountId)
      }
      return
    }
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp' && event.key !== 'Home' && event.key !== 'End') {
      return
    }
    event.preventDefault()
    const current = options.findIndex((option) => option === document.activeElement)
    let next = 0
    if (event.key === 'End') next = options.length - 1
    else if (event.key === 'ArrowUp') next = current <= 0 ? options.length - 1 : current - 1
    else if (event.key === 'ArrowDown') next = current < 0 || current === options.length - 1 ? 0 : current + 1
    options[next]?.focus()
  }

  async function copyUsername(): Promise<void> {
    if (!currentAccountId) return
    try {
      await window.autologin.accounts.copyUsername(currentAccountId)
      showCopyFeedback('username')
      notify('success', tr('用户名已复制', 'Username copied.', '使用者名稱已複製'))
    } catch (error) {
      notify(
        'error',
        error instanceof Error
          ? error.message
          : tr('复制用户名失败', 'Could not copy username.', '複製使用者名稱失敗')
      )
    }
  }

  async function copyPassword(): Promise<void> {
    if (!currentAccountId) return
    try {
      await window.autologin.accounts.copy(currentAccountId)
      showCopyFeedback('password')
      notify('success', tr('密码已复制', 'Password copied.', '密碼已複製'))
    } catch (error) {
      notify(
        'error',
        error instanceof Error
          ? error.message
          : tr('复制密码失败', 'Could not copy password.', '複製密碼失敗')
      )
    }
  }

  function startNewTab(): void {
    if (!newTabDraftRef.current) {
      activeBeforeDraftRef.current = active?.label ?? ''
      setDraftOpen(true)
      setActiveLabel('')
      setAddress('')
      setOverflowOpen(false)
      void window.autologin.browser.hideAll()
    }
    window.requestAnimationFrame(() => addressInputRef.current?.focus())
  }

  function cancelNewTab(): void {
    if (!newTabDraftRef.current) return
    setDraftOpen(false)
    const previous = activeBeforeDraftRef.current
    const next = tabs.some((tab) => tab.label === previous)
      ? previous
      : tabs[0]?.label ?? ''
    setActiveLabel(next)
    if (next) {
      void window.autologin.browser.activate(next).catch(() => undefined)
    }
  }

  function scrollTabStrip(event: WheelEvent<HTMLDivElement>): void {
    const element = event.currentTarget
    if (element.scrollWidth <= element.clientWidth) return
    if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return
    element.scrollLeft += event.deltaY
  }

  function showCopyFeedback(field: 'username' | 'password'): void {
    if (copyFeedbackTimerRef.current !== null) {
      window.clearTimeout(copyFeedbackTimerRef.current)
    }
    setCopiedField(field)
    copyFeedbackTimerRef.current = window.setTimeout(() => {
      setCopiedField(null)
      copyFeedbackTimerRef.current = null
    }, 1200)
  }

  return (
    <section
      className="browser-workspace"
      aria-label={tr('内置浏览器', 'Built-in browser', '內建瀏覽器')}
      data-density={density}
    >
      <header
        className={`browser-workspace__tabs-bar${showTabsBar ? '' : ' is-hidden'}`}
      >
        <div className="browser-workspace__tabs-shell">
          <div
            ref={tabsRef}
            className="browser-workspace__tabs"
            role="tablist"
            aria-label={tr('已打开的站点', 'Open sites', '已開啟的站點')}
            onWheel={scrollTabStrip}
          >
            {tabs.map((tab) => {
              const displayTitle = tabDisplayTitle(tab)
              const title = splitTabTitle(displayTitle)
              const subtitle = tabSubtitle(tab.siteName || displayTitle, tab.accountLabel)
              return (
                <div
                  className={`browser-workspace__tab${
                    tab.label === active?.label ? ' is-active' : ''
                  }${tab.isLoading ? ' is-loading' : ''}`}
                  key={tab.label}
                  role="tab"
                  aria-selected={tab.label === active?.label}
                  style={
                    {
                      '--browser-tab-color': tabGroupColor(tab.groupName)
                    } as CSSProperties
                  }
                >
                  <button
                    type="button"
                    className="browser-workspace__tab-label"
                    onClick={() => void selectTab(tab.label)}
                    title={[displayTitle, subtitle].filter(Boolean).join(' · ')}
                    aria-label={displayTitle}
                  >
                    <span className="browser-workspace__tab-copy">
                      <strong className="browser-workspace__tab-title">
                        {tab.isLoading ? (
                          <span
                            className="browser-workspace__tab-skeleton"
                            aria-hidden="true"
                          />
                        ) : (
                          <>
                            <span className="browser-workspace__tab-title-prefix">
                              {title.prefix}
                            </span>
                            {title.suffix && (
                              <span className="browser-workspace__tab-title-suffix">
                                {title.suffix}
                              </span>
                            )}
                          </>
                        )}
                      </strong>
                      {subtitle && <small>{tab.accountLabel}</small>}
                    </span>
                  </button>
                  <button
                    type="button"
                    className="browser-workspace__tab-close"
                    onClick={() => void closeTab(tab.label)}
                    aria-label={tr(
                      `关闭 ${displayTitle}`,
                      `Close ${displayTitle}`,
                      `關閉 ${displayTitle}`
                    )}
                    title={tr('关闭页面', 'Close page', '關閉頁面')}
                  >
                    <X size={13} />
                  </button>
                </div>
              )
            })}
            {newTabDraft && (
              <div
                className="browser-workspace__tab browser-workspace__tab--draft is-active"
                role="tab"
                aria-selected="true"
                style={{ '--browser-tab-color': 'var(--accent)' } as CSSProperties}
              >
                <button
                  type="button"
                  className="browser-workspace__tab-label"
                  onClick={() => addressInputRef.current?.focus()}
                  title={tr('新标签页', 'New tab', '新分頁')}
                >
                  <span className="browser-workspace__tab-copy">
                    <strong className="browser-workspace__tab-title">
                      <span className="browser-workspace__tab-title-prefix">
                        {tr('新标签页', 'New tab', '新分頁')}
                      </span>
                    </strong>
                  </span>
                </button>
                <button
                  type="button"
                  className="browser-workspace__tab-close"
                  onClick={cancelNewTab}
                  aria-label={tr('关闭新标签页', 'Close new tab', '關閉新分頁')}
                  title={tr('关闭页面', 'Close page', '關閉頁面')}
                >
                  <X size={13} />
                </button>
              </div>
            )}
            {loadingTabs && (
              <span className="browser-workspace__loading">
                <LoaderCircle size={14} className="spin" />
                {tr('读取页面', 'Loading pages', '讀取頁面')}
              </span>
            )}
          </div>
          {hasTabOverflow && (
            <span className="browser-workspace__tabs-fade" aria-hidden="true" />
          )}
        </div>
        <div className="browser-workspace__tabs-actions" ref={overflowRef}>
          <button
            type="button"
            className={`browser-workspace__new-tab${
              newTabDraft ? ' is-active' : ''
            }`}
            onClick={startNewTab}
            aria-label={tr('新建标签页', 'New tab', '新增分頁')}
            title={tr('新建标签页', 'New tab', '新增分頁')}
          >
            <Plus size={16} />
          </button>
          {tabs.length > 1 && (
            <button
              type="button"
              className={`browser-workspace__all-tabs${
                overflowOpen ? ' is-active' : ''
              }`}
              aria-haspopup="menu"
              aria-expanded={overflowOpen}
              aria-label={tr('查看全部页面', 'View all pages', '檢視全部頁面')}
              onClick={() => setOverflowOpen((current) => !current)}
              title={tr('查看全部页面', 'View all pages', '檢視全部頁面')}
            >
              <span>{tr('全部', 'All', '全部')}</span>
              <span className="browser-workspace__all-tabs-count">{tabs.length}</span>
              <ChevronDown size={13} />
            </button>
          )}
        </div>
      </header>

      <div className="browser-workspace__bar">
        <button
          type="button"
          className="browser-workspace__icon-button"
          onClick={() => void goBack()}
          disabled={!active || goingBack}
          aria-label={tr('返回上一页', 'Go back', '返回上一頁')}
          title={tr('返回上一页', 'Go back', '返回上一頁')}
        >
          {goingBack ? (
            <LoaderCircle size={16} className="spin" />
          ) : (
            <ArrowLeft size={16} />
          )}
        </button>
        <button
          type="button"
          className="browser-workspace__icon-button"
          onClick={() => void reload()}
          disabled={!active || refreshing}
          aria-label={tr('刷新页面', 'Refresh page', '重新整理頁面')}
          title={tr('刷新页面', 'Refresh page', '重新整理頁面')}
        >
          {refreshing ? (
            <LoaderCircle size={16} className="spin" />
          ) : (
            <RefreshCw size={16} />
          )}
        </button>
        <form className="browser-workspace__address" onSubmit={(event) => void navigate(event)}>
          <LockKeyhole size={14} aria-hidden="true" />
          <input
            ref={addressInputRef}
            value={address}
            onChange={(event) => setAddress(event.target.value)}
            placeholder={
              active
                ? tr('输入页面地址', 'Enter page address', '輸入頁面位址')
                : tr('输入网址后按回车，打开新页面', 'Enter a URL and press Enter', '輸入網址後按 Enter')
            }
            aria-label={tr('页面地址', 'Page address', '頁面位址')}
            spellCheck={false}
            autoComplete="off"
          />
          {navigating && <LoaderCircle size={14} className="spin" />}
        </form>
        {active && currentAccountLabel && (
          <div
            className="browser-workspace__current-account"
            title={tr(
              `当前账号：${currentAccountLabel}${
                currentAccount?.username ? ` · ${currentAccount.username}` : ''
              }`,
              `Current account: ${currentAccountLabel}${
                currentAccount?.username ? ` · ${currentAccount.username}` : ''
              }`,
              `目前帳號：${currentAccountLabel}${
                currentAccount?.username ? ` · ${currentAccount.username}` : ''
              }`
            )}
          >
            <span className="browser-workspace__current-account-label">
              {tr('当前账号', 'Current account', '目前帳號')}
            </span>
            {siteAccounts.length > 1 ? (
              <div className="browser-workspace__account-select" ref={accountMenuRef}>
                <button
                  ref={accountTriggerRef}
                  type="button"
                  className="browser-workspace__account-trigger"
                  aria-haspopup="listbox"
                  aria-expanded={accountMenuOpen}
                  aria-label={tr(
                    '选择要复制凭据的账号',
                    'Choose the account to copy credentials from',
                    '選擇要複製憑證的帳號'
                  )}
                  onClick={() => setAccountMenuOpen((current) => !current)}
                  onKeyDown={(event) => {
                    if (
                      event.key === 'ArrowDown' ||
                      event.key === 'ArrowUp' ||
                      event.key === 'Enter' ||
                      event.key === ' '
                    ) {
                      event.preventDefault()
                      setAccountMenuOpen(true)
                    }
                  }}
                >
                  <span>
                    {currentAccountLabel}
                    {currentAccount?.username ? ` · ${currentAccount.username}` : ''}
                  </span>
                  <ChevronDown size={12} aria-hidden="true" />
                </button>
                {accountMenuOpen && (
                  <div
                    className="browser-workspace__account-menu"
                    role="listbox"
                    aria-label={tr('选择账号', 'Choose account', '選擇帳號')}
                    onKeyDown={handleAccountMenuKeyDown}
                  >
                    {siteAccounts.map((item) => {
                      const selected = item.id === currentAccountId
                      return (
                        <button
                          type="button"
                          role="option"
                          data-account-id={item.id}
                          aria-selected={selected}
                          tabIndex={selected ? 0 : -1}
                          className={`browser-workspace__account-option${
                            selected ? ' is-selected' : ''
                          }`}
                          key={item.id}
                          onClick={() => chooseAccount(item.id)}
                          title={`${item.label}${item.username ? ` · ${item.username}` : ''}`}
                        >
                          <span>
                            {item.label}
                            {item.username ? ` · ${item.username}` : ''}
                          </span>
                          {selected && <Check size={13} aria-hidden="true" />}
                        </button>
                      )
                    })}
                  </div>
                )}
              </div>
            ) : (
              <strong>{currentAccountLabel}</strong>
            )}
          </div>
        )}
        {!showTabsBar && (
          <button
            type="button"
            className="browser-workspace__new-tab"
            onClick={startNewTab}
            aria-label={tr('新建标签页', 'New tab', '新增分頁')}
            title={tr('新建标签页', 'New tab', '新增分頁')}
          >
            <Plus size={16} />
          </button>
        )}
        {active && (
          <div className="browser-workspace__copy-actions">
            <button
              type="button"
              className={`browser-workspace__icon-button${
                copiedField === 'username' ? ' is-copied' : ''
              }`}
              onClick={() => void copyUsername()}
              aria-label={
                copiedField === 'username'
                  ? tr('已复制用户名', 'Username copied', '已複製使用者名稱')
                  : tr('复制用户名', 'Copy username', '複製使用者名稱')
              }
              title={
                copiedField === 'username'
                  ? tr('已复制用户名', 'Username copied', '已複製使用者名稱')
                  : tr('复制用户名', 'Copy username', '複製使用者名稱')
              }
            >
              {copiedField === 'username' ? <Check size={15} /> : <UserRound size={15} />}
            </button>
            <button
              type="button"
              className={`browser-workspace__icon-button${
                copiedField === 'password' ? ' is-copied' : ''
              }`}
              onClick={() => void copyPassword()}
              aria-label={
                copiedField === 'password'
                  ? tr('已复制密码', 'Password copied', '已複製密碼')
                  : tr('复制密码', 'Copy password', '複製密碼')
              }
              title={
                copiedField === 'password'
                  ? tr('已复制密码', 'Password copied', '已複製密碼')
                  : tr('复制密码', 'Copy password', '複製密碼')
              }
            >
              {copiedField === 'password' ? <Check size={15} /> : <KeyRound size={15} />}
            </button>
          </div>
        )}
      </div>

      <div
        ref={viewportWrapRef}
        className={`browser-workspace__viewport-wrap${
          accountMenuOpen && active ? ' is-account-menu-open' : ''
        }`}
      >
        {overflowOpen && tabs.length > 1 ? (
          <div
            ref={overviewRef}
            className="browser-workspace__overview"
            role="dialog"
            aria-label={tr('全部页面', 'All pages', '全部頁面')}
          >
            <div className="browser-workspace__overview-panel">
              <header className="browser-workspace__overview-head">
                <div className="browser-workspace__overview-title">
                  <span className="eyebrow">{tr('全部页面', 'All pages', '全部頁面')}</span>
                  <h2>
                    {tabs.length}
                    <small>
                      {tr('个页面已打开', 'pages open', '個頁面已開啟')}
                    </small>
                  </h2>
                </div>
                <button
                  type="button"
                  className="browser-workspace__icon-button"
                  onClick={() => setOverflowOpen(false)}
                  aria-label={tr('返回当前页面', 'Back to page', '返回目前頁面')}
                  title={tr('返回当前页面（Esc）', 'Back to page (Esc)', '返回目前頁面（Esc）')}
                >
                  <X size={16} />
                </button>
              </header>
              <div className="browser-workspace__overview-grid">
                {tabs.map((tab) => {
                  const displayTitle = tabDisplayTitle(tab)
                  const subtitle = tabSubtitle(
                    tab.siteName || displayTitle,
                    tab.accountLabel
                  )
                  const isActive = tab.label === active?.label
                  return (
                    <div
                      className={`browser-workspace__overview-card${
                        isActive ? ' is-active' : ''
                      }`}
                      key={tab.label}
                      style={
                        {
                          '--browser-tab-color': tabGroupColor(tab.groupName)
                        } as CSSProperties
                      }
                    >
                      <button
                        type="button"
                        className="browser-workspace__overview-card-main"
                        onClick={() => {
                          setOverflowOpen(false)
                          void selectTab(tab.label)
                        }}
                        title={[displayTitle, subtitle].filter(Boolean).join(' · ')}
                      >
                        <span
                          className="browser-workspace__overview-mark"
                          aria-hidden="true"
                        />
                        <span className="browser-workspace__overview-text">
                          <strong>{displayTitle}</strong>
                          <small>
                            {subtitle || tr('手动打开', 'Manual', '手動開啟')}
                          </small>
                        </span>
                        {isActive && (
                          <span className="browser-workspace__overview-current">
                            {tr('当前', 'Current', '目前')}
                          </span>
                        )}
                      </button>
                      <button
                        type="button"
                        className="browser-workspace__overview-card-close"
                        onClick={() => void closeTab(tab.label)}
                        aria-label={tr(
                          `关闭 ${displayTitle}`,
                          `Close ${displayTitle}`,
                          `關閉 ${displayTitle}`
                        )}
                        title={tr('关闭页面', 'Close page', '關閉頁面')}
                      >
                        <X size={12} />
                      </button>
                    </div>
                  )
                })}
              </div>
              <footer className="browser-workspace__overview-foot">
                <span>
                  {tr(
                    '点击卡片切换页面，Esc 返回',
                    'Pick a card to switch, Esc to go back',
                    '點擊卡片切換頁面，Esc 返回'
                  )}
                </span>
                <button
                  type="button"
                  className="browser-workspace__overview-danger"
                  onClick={() => setCloseAllConfirmOpen(true)}
                >
                  <X size={13} />
                  {tr('关闭全部页面', 'Close all pages', '關閉全部頁面')}
                </button>
              </footer>
            </div>
          </div>
        ) : loadingTabs ? (
          <div className="browser-workspace__empty browser-workspace__empty--loading" role="status">
            <LoaderCircle size={24} className="spin" />
            <span>{tr('正在读取页面', 'Loading pages', '正在讀取頁面')}</span>
          </div>
        ) : !active ? (
          <div className="browser-workspace__empty">
            <div className="browser-workspace__empty-art" aria-hidden="true">
              <span />
              <span />
              <span>
                <Globe2 size={26} strokeWidth={1.5} />
              </span>
            </div>
            <span className="eyebrow">
              {tr('START BROWSING', 'START BROWSING', 'START BROWSING')}
            </span>
            <h2>
              {newTabDraft
                ? tr('新标签页', 'New tab', '新分頁')
                : tr('还没有打开站点', 'No sites open yet', '尚未開啟站點')}
            </h2>
            <p>
              {newTabDraft
                ? tr(
                    '在上方地址栏输入网址，按回车即可打开。',
                    'Enter a URL in the address bar and press Enter.',
                    '在上方網址列輸入網址，按 Enter 即可開啟。'
                  )
                : tr(
                    '从账号库选一个站点打开，或直接在上方输入网址。',
                    'Open a site from your account library, or enter a URL above.',
                    '從帳號庫選一個站點開啟，或直接在上方輸入網址。'
                  )}
            </p>
            <div className="browser-workspace__empty-actions">
              <button
                type="button"
                className="button button--primary"
                onClick={onOpenAccounts}
              >
                <UserRound size={16} />
                {tr('去账号库', 'Go to accounts', '前往帳號庫')}
              </button>
            </div>
          </div>
        ) : (
          <div ref={viewportRef} className="browser-workspace__viewport" />
        )}
      </div>

      {closeAllConfirmOpen && (
        <ConfirmDialog
          title={tr('关闭全部页面？', 'Close all pages?', '關閉全部頁面？')}
          description={tr(
            '所有已打开的内置浏览器页面都会被关闭，未保存的页面操作将无法恢复。',
            'All built-in browser pages will close. Unsaved page changes cannot be recovered.',
            '所有已開啟的內建瀏覽器頁面都會關閉，未儲存的頁面操作將無法復原。'
          )}
          confirmLabel={tr('关闭全部页面', 'Close all pages', '關閉全部頁面')}
          danger
          busy={closingAll}
          onConfirm={() => void closeAllTabs()}
          onClose={() => {
            if (!closingAll) setCloseAllConfirmOpen(false)
          }}
        />
      )}
    </section>
  )
}
