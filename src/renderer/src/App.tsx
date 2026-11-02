import { useCallback, useEffect, useRef, useState } from 'react'
import { LoaderCircle, LockKeyhole } from 'lucide-react'
import type { AccountWithSite, AppSettings, LoginMode, Site } from '@shared/types'
import { SetupScreen, UnlockScreen } from './components/AuthScreens'
import { BrandMark } from './components/Brand'
import { LibraryScreen } from './components/LibraryScreen'
import { LoginWorkspace } from './components/LoginWorkspace'
import { ConfirmDialog } from './components/Modal'
import { Toast, type ToastKind, type ToastState } from './components/Toast'

type AuthState = 'boot' | 'setup' | 'unlock' | 'ready'

interface LoginTarget {
  account: AccountWithSite
  mode: LoginMode
}

const DEFAULT_SETTINGS: AppSettings = { autoLockMinutes: 10 }

export default function App(): React.JSX.Element {
  const [authState, setAuthState] = useState<AuthState>('boot')
  const [accounts, setAccounts] = useState<AccountWithSite[]>([])
  const [sites, setSites] = useState<Site[]>([])
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS)
  const [appVersion, setAppVersion] = useState('0.2.0')
  const [loginTarget, setLoginTarget] = useState<LoginTarget | null>(null)
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
        setSettings({ autoLockMinutes: status.autoLockMinutes })
        setAuthState(status.initialized ? 'unlock' : 'setup')
      })
      .catch(() => {
        if (!cancelled) setAuthState('setup')
      })

    const unsubscribe = window.autologin.events.onVaultLocked(() => {
      if (!cancelled) {
        setLoginTarget(null)
        setAccounts([])
        setSites([])
        setAuthState('unlock')
      }
    })
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
    setSettings({ autoLockMinutes: status.autoLockMinutes })
    await loadData()
    setAuthState('ready')
    notify('success', '保险库已创建')
  }

  async function unlockVault(password: string): Promise<void> {
    const status = await window.autologin.vault.unlock(password)
    setSettings({ autoLockMinutes: status.autoLockMinutes })
    await loadData()
    setAuthState('ready')
  }

  async function lockVault(): Promise<void> {
    await window.autologin.vault.lock()
    setLoginTarget(null)
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
      setResetOpen(false)
      setAuthState('setup')
      notify('success', '本地数据已清除，可以重新创建保险库')
    } catch (error) {
      notify('error', error instanceof Error ? error.message : '清除数据失败')
    } finally {
      setResetBusy(false)
    }
  }

  function openLogin(account: AccountWithSite): void {
    setLoginTarget({ account, mode: 'login' })
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
          onRefresh={loadData}
          onLock={lockVault}
          onLogin={openLogin}
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
