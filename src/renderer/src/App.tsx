import { useCallback, useEffect, useRef, useState } from 'react'
import { LoaderCircle, LockKeyhole } from 'lucide-react'
import type {
  AccountWithSite,
  AppSettings,
  AppUpdateState,
  LoginBatchState,
  Site
} from '@shared/types'
import { DEFAULT_APP_SETTINGS, resolveThemeColors } from '@shared/theme'
import logoUrl from './assets/app-logo.png'
import { SetupScreen, UnlockScreen } from './components/AuthScreens'
import { BrandMark } from './components/Brand'
import { LibraryScreen } from './components/LibraryScreen'
import { LoginWorkspace } from './components/LoginWorkspace'
import { ConfirmDialog } from './components/Modal'
import { Toast, type ToastKind, type ToastState } from './components/Toast'
import { UpdateDialog } from './components/UpdateDialog'
import { I18nProvider, translate } from './i18n'

type AuthState = 'boot' | 'setup' | 'unlock' | 'ready'

interface LoginTarget {
  account: AccountWithSite
  mode: 'record'
}

const DEFAULT_SETTINGS: AppSettings = {
  ...DEFAULT_APP_SETTINGS,
  customTheme: { ...DEFAULT_APP_SETTINGS.customTheme }
}

export default function App(): React.JSX.Element {
  const [authState, setAuthState] = useState<AuthState>('boot')
  const [accounts, setAccounts] = useState<AccountWithSite[]>([])
  const [sites, setSites] = useState<Site[]>([])
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS)
  const [appVersion, setAppVersion] = useState('0.9.4')
  const [loginTarget, setLoginTarget] = useState<LoginTarget | null>(null)
  const [batchState, setBatchState] = useState<LoginBatchState | null>(null)
  const [updateState, setUpdateState] = useState<AppUpdateState | null>(null)
  const [systemPrefersDark, setSystemPrefersDark] = useState(() =>
    window.matchMedia('(prefers-color-scheme: dark)').matches
  )
  const [dismissedUpdateVersion, setDismissedUpdateVersion] = useState<string | null>(null)
  const [toast, setToast] = useState<ToastState | null>(null)
  const [resetOpen, setResetOpen] = useState(false)
  const [resetBusy, setResetBusy] = useState(false)
  const toastTimer = useRef<number | null>(null)
  const tr = (zhCN: string, en: string, zhTW: string): string =>
    translate(settings.language, zhCN, en, zhTW)

  const notify = useCallback((kind: ToastKind, message: string): void => {
    if (toastTimer.current) {
      window.clearTimeout(toastTimer.current)
    }
    setToast({ id: Date.now(), kind, message })
    toastTimer.current = window.setTimeout(() => setToast(null), 4200)
  }, [])

  const loadData = useCallback(async (): Promise<void> => {
    const [nextAccounts, nextSites, nextSettings] = await Promise.all([
      window.autologin.accounts.list(),
      window.autologin.sites.list(),
      window.autologin.settings.get()
    ])
    setAccounts(nextAccounts)
    setSites(nextSites)
    setSettings(nextSettings)
  }, [])

  useEffect(() => {
    let cancelled = false
    void Promise.all([window.autologin.vault.status(), window.autologin.app.getVersion()])
      .then(([status, version]) => {
        if (cancelled) return
        setAppVersion(version)
        setSettings((current) => ({ ...current, autoLockMinutes: status.autoLockMinutes }))
        setAuthState(status.initialized ? 'unlock' : 'setup')
      })
      .catch(() => {
        if (!cancelled) setAuthState('setup')
      })

    const unsubscribeLocked = window.autologin.events.onVaultLocked(() => {
      if (!cancelled) {
        setLoginTarget(null)
        setBatchState(null)
        setAccounts([])
        setSites([])
        setAuthState('unlock')
      }
    })
    const unsubscribeBatch = window.autologin.events.onLoginBatchState((state) => {
      if (!cancelled) {
        setBatchState(state)
      }
    })
    return () => {
      cancelled = true
      unsubscribeLocked()
      unsubscribeBatch()
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    const applyUpdateState = (state: AppUpdateState): void => {
      if (cancelled) return
      if (state.phase === 'checking') {
        setDismissedUpdateVersion(null)
      }
      setUpdateState(state)
    }

    void window.autologin.app
      .getUpdateState()
      .then(applyUpdateState)
      .catch(() => undefined)
    const unsubscribe = window.autologin.events.onUpdateState(applyUpdateState)
    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [])

  useEffect(() => {
    return () => {
      if (toastTimer.current) {
        window.clearTimeout(toastTimer.current)
      }
    }
  }, [])

  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const updateSystemTheme = (event: MediaQueryListEvent): void => {
      setSystemPrefersDark(event.matches)
    }
    setSystemPrefersDark(media.matches)
    media.addEventListener('change', updateSystemTheme)
    return () => media.removeEventListener('change', updateSystemTheme)
  }, [])

  useEffect(() => {
    const effectiveColorMode =
      settings.colorMode === 'system'
        ? systemPrefersDark
          ? 'dark'
          : 'light'
        : settings.colorMode
    const colors = resolveThemeColors(
      settings.themePreset,
      effectiveColorMode,
      settings.customTheme
    )
    const root = document.documentElement.style
    root.setProperty('--font-scale', String(settings.fontSizeScale / 100))
    const isDark = effectiveColorMode === 'dark'
    const isMagpie = settings.themePreset === 'magpie'
    const sidebarBackground = isDark
      ? isMagpie
        ? '#1A1C21'
        : colors.background
      : isMagpie
        ? '#F7F8FA'
        : colors.background
    const cardBackground = isDark
      ? isMagpie
        ? '#202329'
        : colors.surface
      : '#FFFFFF'
    root.setProperty('--canvas', colors.background)
    root.setProperty('--surface', colors.surface)
    root.setProperty('--sidebar-bg', sidebarBackground)
    root.setProperty('--card', cardBackground)
    root.setProperty('--ink', isDark ? '#F2F3F5' : '#17191C')
    root.setProperty('--accent', colors.accent)
    root.setProperty('--canvas-deep', `color-mix(in srgb, ${colors.background} 88%, ${colors.text})`)
    root.setProperty('--surface-raised', cardBackground)
    root.setProperty('--ink-soft', isDark ? '#D7DAE0' : '#30343A')
    root.setProperty('--muted', isDark ? '#A4A9B3' : '#6B7280')
    root.setProperty('--muted-light', isDark ? '#8B919B' : '#7A828D')
    root.setProperty('--line', isDark ? 'rgba(255, 255, 255, 0.09)' : '#E5E7EB')
    root.setProperty(
      '--line-strong',
      isDark ? 'rgba(255, 255, 255, 0.16)' : '#D5D9E0'
    )
    root.setProperty('--card-border', isDark ? 'rgba(255, 255, 255, 0.09)' : '#E8EAED')
    root.setProperty(
      '--card-shadow',
      isDark
        ? '0 1px 2px rgba(0, 0, 0, 0.32)'
        : '0 1px 2px rgba(31, 35, 40, 0.04), 0 8px 24px rgba(31, 35, 40, 0.035)'
    )
    root.setProperty('--content-divider', isDark ? 'rgba(255, 255, 255, 0.08)' : '#E9EBEF')
    root.setProperty('--accent-strong', `color-mix(in srgb, ${colors.accent} 82%, ${effectiveColorMode === 'dark' ? 'white' : 'black'})`)
    root.setProperty('--accent-soft', `color-mix(in srgb, ${colors.accent} 16%, ${colors.surface})`)
    root.setProperty('--accent-pale', `color-mix(in srgb, ${colors.accent} 8%, ${colors.surface})`)
    root.setProperty('--accent-contrast', isDark && isMagpie ? '#15161A' : '#FFFFFF')
    root.setProperty(
      '--ink-panel',
      isMagpie ? (isDark ? '#242631' : '#25273E') : isDark ? '#191C21' : `color-mix(in srgb, ${colors.text} 82%, ${colors.accent})`
    )
    root.setProperty(
      '--ink-panel-deep',
      isMagpie ? (isDark ? '#181920' : '#191A2A') : isDark ? '#121419' : `color-mix(in srgb, ${colors.text} 90%, black)`
    )
    root.setProperty('--cream', isMagpie ? '#F5F5FC' : '#F8F1E4')
    root.setProperty('--focus-ring', `color-mix(in srgb, ${colors.accent} 72%, transparent)`)
    document.documentElement.dataset.colorMode = effectiveColorMode
    document.documentElement.dataset.themePreset = settings.themePreset
    document.documentElement.style.colorScheme = effectiveColorMode
    document.documentElement.lang = settings.language
    void window.autologin.windowControls
      .updateTheme({
        backgroundColor: sidebarBackground,
        symbolColor: isDark ? '#F2F3F5' : '#1F2328',
        height: 40
      })
      .catch(() => undefined)
  }, [
    settings.colorMode,
    settings.customTheme,
    settings.fontSizeScale,
    settings.language,
    settings.themePreset,
    systemPrefersDark
  ])

  useEffect(() => {
    let lastReport = 0
    const reportActivity = (): void => {
      const now = Date.now()
      if (now - lastReport < 15_000) {
        return
      }
      lastReport = now
      window.autologin.app.reportActivity()
    }
    const events: Array<keyof WindowEventMap> = [
      'pointerdown',
      'keydown',
      'wheel',
      'touchstart'
    ]
    for (const eventName of events) {
      window.addEventListener(eventName, reportActivity, { passive: true })
    }
    return () => {
      for (const eventName of events) {
        window.removeEventListener(eventName, reportActivity)
      }
    }
  }, [])

  async function createVault(password: string): Promise<void> {
    const status = await window.autologin.vault.create(password)
    setSettings((current) => ({ ...current, autoLockMinutes: status.autoLockMinutes }))
    await loadData()
    setBatchState(await window.autologin.login.getBatchState())
    setAuthState('ready')
    notify(
      'success',
      translate(settings.language, '保险库已创建', 'Vault created', '保險庫已建立')
    )
  }

  async function unlockVault(password: string): Promise<void> {
    const status = await window.autologin.vault.unlock(password)
    setSettings((current) => ({ ...current, autoLockMinutes: status.autoLockMinutes }))
    await loadData()
    setBatchState(await window.autologin.login.getBatchState())
    setAuthState('ready')
  }

  async function lockVault(): Promise<void> {
    await window.autologin.vault.lock()
    setLoginTarget(null)
    setBatchState(null)
    setAccounts([])
    setSites([])
    setAuthState('unlock')
  }

  async function resetVault(): Promise<void> {
    setResetBusy(true)
    try {
      await window.autologin.app.clearAllData()
      setAccounts([])
      setSites([])
      setLoginTarget(null)
      setBatchState(null)
      setResetOpen(false)
      setAuthState('setup')
      notify(
        'success',
        translate(
          settings.language,
          '本地数据已清除，可以重新创建保险库',
          'Local data cleared. You can create a new vault.',
          '本機資料已清除，可以重新建立保險庫'
        )
      )
    } catch (error) {
      notify(
        'error',
        error instanceof Error
          ? error.message
          : translate(settings.language, '清除数据失败', 'Failed to clear data', '清除資料失敗')
      )
    } finally {
      setResetBusy(false)
    }
  }

  function openRecording(account: AccountWithSite): void {
    setLoginTarget({ account, mode: 'record' })
  }

  async function startBatch(accountIds: string[]): Promise<boolean> {
    try {
      const next = await window.autologin.login.startBatch(accountIds)
      setBatchState(next)
      notify(
        'info',
        translate(
          settings.language,
          `正在默认浏览器中打开 ${next.total} 个账号`,
          `Opening ${next.total} account${next.total === 1 ? '' : 's'} in your default browser`,
          `正在預設瀏覽器中開啟 ${next.total} 個帳號`
        )
      )
      return true
    } catch (error) {
      notify(
        'error',
        error instanceof Error
          ? error.message
          : translate(settings.language, '批量打开失败', 'Batch open failed', '批次開啟失敗')
      )
      return false
    }
  }

  async function cancelBatch(): Promise<void> {
    try {
      setBatchState(await window.autologin.login.cancelBatch())
      notify('info', translate(settings.language, '已中断批量登录', 'Batch sign-in canceled', '已中斷批次登入'))
    } catch (error) {
      notify(
        'error',
        error instanceof Error
          ? error.message
          : translate(settings.language, '中断批量登录失败', 'Could not cancel batch sign-in', '中斷批次登入失敗')
      )
    }
  }

  async function downloadUpdate(): Promise<void> {
    try {
      setUpdateState(await window.autologin.app.downloadUpdate())
    } catch (error) {
      notify(
        'error',
        error instanceof Error
          ? error.message
          : translate(settings.language, '更新下载失败', 'Could not download the update', '更新下載失敗')
      )
    }
  }

  async function cancelUpdate(): Promise<void> {
    try {
      setUpdateState(await window.autologin.app.cancelUpdate())
    } catch (error) {
      notify(
        'error',
        error instanceof Error
          ? error.message
          : translate(settings.language, '无法取消更新下载', 'Could not cancel the update download', '無法取消更新下載')
      )
    }
  }

  async function installUpdate(): Promise<void> {
    try {
      await window.autologin.app.installUpdate()
    } catch (error) {
      notify(
        'error',
        error instanceof Error
          ? error.message
          : translate(settings.language, '无法安装更新', 'Could not install the update', '無法安裝更新')
      )
    }
  }

  async function retryUpdate(): Promise<void> {
    try {
      await window.autologin.app.checkForUpdates()
    } catch (error) {
      notify(
        'error',
        error instanceof Error
          ? error.message
          : translate(settings.language, '检查更新失败', 'Could not check for updates', '檢查更新失敗')
      )
    }
  }

  const updateDialogVisible =
    authState === 'ready' &&
    Boolean(updateState) &&
    dismissedUpdateVersion !== (updateState?.latestVersion ?? updateState?.phase ?? '') &&
    (updateState?.phase === 'available' ||
      updateState?.phase === 'downloading' ||
      updateState?.phase === 'downloaded' ||
      (updateState?.phase === 'error' && updateState.interactive))

  return (
    <I18nProvider language={settings.language}>
    <>
      <div className="window-titlebar" aria-hidden="true">
        <img className="window-titlebar__logo" src={logoUrl} alt="" />
        <span>AutoLogin</span>
      </div>
      {authState === 'boot' && (
        <main className="boot-screen">
          <BrandMark />
          <div className="boot-screen__loader">
            <LoaderCircle size={20} className="spin" />
            <span>{tr('正在准备本地保险库', 'Preparing your local vault', '正在準備本機保險庫')}</span>
          </div>
        </main>
      )}

      {authState === 'setup' && <SetupScreen onCreate={createVault} />}

      {authState === 'unlock' && (
        <>
          <UnlockScreen onUnlock={unlockVault} onForgot={() => setResetOpen(true)} />
          {resetOpen && (
            <ConfirmDialog
              title="无法找回主密码"
              description="主密码不会以任何形式保存在可恢复的位置。继续将永久删除本机保险库、账号密码和网站会话。"
              confirmLabel="清除并重新开始"
              danger
              busy={resetBusy}
              onConfirm={() => void resetVault()}
              onClose={() => setResetOpen(false)}
            />
          )}
        </>
      )}

      {authState === 'ready' && !loginTarget && (
        <LibraryScreen
          accounts={accounts}
          sites={sites}
          settings={settings}
          appVersion={appVersion}
          updateState={updateState}
          batchState={batchState}
          onRefresh={loadData}
          onLock={lockVault}
          onStartBatch={startBatch}
          onCancelBatch={cancelBatch}
          onRecord={openRecording}
          onDownloadUpdate={downloadUpdate}
          onCancelUpdate={cancelUpdate}
          onInstallUpdate={installUpdate}
          onCleared={() => {
            setAccounts([])
            setSites([])
            setAuthState('setup')
          }}
          notify={notify}
        />
      )}

      {authState === 'ready' && loginTarget && (
        <LoginWorkspace
          key={`${loginTarget.account.id}-${loginTarget.mode}`}
          account={loginTarget.account}
          mode={loginTarget.mode}
          onClose={() => setLoginTarget(null)}
          onDataChanged={loadData}
          notify={notify}
        />
      )}

      {toast && <Toast toast={toast} onClose={() => setToast(null)} />}

      {updateDialogVisible && updateState && (
        <UpdateDialog
          state={updateState}
          onLater={() =>
            setDismissedUpdateVersion(updateState.latestVersion ?? updateState.phase)
          }
          onDownload={() => void downloadUpdate()}
          onCancel={cancelUpdate}
          onInstall={() => void installUpdate()}
          onOpenRelease={() => void window.autologin.app.openReleases()}
          onRetry={() => void retryUpdate()}
        />
      )}

      {authState === 'boot' && (
        <div className="boot-screen__footnote">
          <LockKeyhole size={13} />
          Local-first · No telemetry
        </div>
      )}
    </>
    </I18nProvider>
  )
}
