import { useCallback, useEffect, useRef, useState } from 'react'
import { LoaderCircle, LockKeyhole } from 'lucide-react'
import type { AccountWithSite, AppSettings, LoginBatchState, Site } from '@shared/types'
import { DEFAULT_THEME_COLORS, THEME_PRESETS } from '@shared/theme'
import { SetupScreen, UnlockScreen } from './components/AuthScreens'
import { BrandMark } from './components/Brand'
import { LibraryScreen } from './components/LibraryScreen'
import { LoginWorkspace } from './components/LoginWorkspace'
import { ConfirmDialog } from './components/Modal'
import { Toast, type ToastKind, type ToastState } from './components/Toast'

type AuthState = 'boot' | 'setup' | 'unlock' | 'ready'

interface LoginTarget {
  account: AccountWithSite
  mode: 'record'
}

const DEFAULT_SETTINGS: AppSettings = {
  autoLockMinutes: 10,
  themePreset: 'warm',
  customTheme: DEFAULT_THEME_COLORS,
  interfaceScale: 100
}

export default function App(): React.JSX.Element {
  const [authState, setAuthState] = useState<AuthState>('boot')
  const [accounts, setAccounts] = useState<AccountWithSite[]>([])
  const [sites, setSites] = useState<Site[]>([])
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS)
  const [appVersion, setAppVersion] = useState('0.2.2')
  const [loginTarget, setLoginTarget] = useState<LoginTarget | null>(null)
  const [batchState, setBatchState] = useState<LoginBatchState | null>(null)
  const [toast, setToast] = useState<ToastState | null>(null)
  const [resetOpen, setResetOpen] = useState(false)
  const [resetBusy, setResetBusy] = useState(false)
  const toastTimer = useRef<number | null>(null)

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
    return () => {
      if (toastTimer.current) {
        window.clearTimeout(toastTimer.current)
      }
    }
  }, [])

  useEffect(() => {
    const colors =
      settings.themePreset === 'custom'
        ? settings.customTheme
        : THEME_PRESETS[settings.themePreset].colors
    const root = document.documentElement.style
    root.setProperty('--canvas', colors.background)
    root.setProperty('--surface', colors.surface)
    root.setProperty('--ink', colors.text)
    root.setProperty('--accent', colors.accent)
    root.setProperty('--canvas-deep', `color-mix(in srgb, ${colors.background} 88%, ${colors.text})`)
    root.setProperty('--surface-raised', `color-mix(in srgb, ${colors.surface} 94%, white)`)
    root.setProperty('--ink-soft', `color-mix(in srgb, ${colors.text} 82%, ${colors.background})`)
    root.setProperty('--muted', `color-mix(in srgb, ${colors.text} 66%, ${colors.background})`)
    root.setProperty('--muted-light', `color-mix(in srgb, ${colors.text} 58%, ${colors.background})`)
    root.setProperty('--line', `color-mix(in srgb, ${colors.text} 14%, ${colors.background})`)
    root.setProperty('--line-strong', `color-mix(in srgb, ${colors.text} 25%, ${colors.background})`)
    root.setProperty('--accent-strong', `color-mix(in srgb, ${colors.accent} 82%, black)`)
    root.setProperty('--accent-soft', `color-mix(in srgb, ${colors.accent} 16%, ${colors.surface})`)
    root.setProperty('--accent-pale', `color-mix(in srgb, ${colors.accent} 8%, ${colors.surface})`)
    root.setProperty('--ink-panel', `color-mix(in srgb, ${colors.text} 82%, ${colors.accent})`)
    root.setProperty('--ink-panel-deep', `color-mix(in srgb, ${colors.text} 90%, black)`)
    root.setProperty('--focus-ring', `color-mix(in srgb, ${colors.accent} 72%, transparent)`)
  }, [settings.customTheme, settings.themePreset])

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
    notify('success', '保险库已创建')
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
      notify('success', '本地数据已清除，可以重新创建保险库')
    } catch (error) {
      notify('error', error instanceof Error ? error.message : '清除数据失败')
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
      notify('info', `正在默认浏览器中打开 ${next.total} 个账号`)
      return true
    } catch (error) {
      notify('error', error instanceof Error ? error.message : '批量打开失败')
      return false
    }
  }

  return (
    <>
      {authState === 'boot' && (
        <main className="boot-screen">
          <BrandMark />
          <div className="boot-screen__loader">
            <LoaderCircle size={20} className="spin" />
            <span>正在准备本地保险库</span>
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
          batchState={batchState}
          onRefresh={loadData}
          onLock={lockVault}
          onStartBatch={startBatch}
          onRecord={openRecording}
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

      {authState === 'boot' && (
        <div className="boot-screen__footnote">
          <LockKeyhole size={13} />
          Local-first · No telemetry
        </div>
      )}
    </>
  )
}
