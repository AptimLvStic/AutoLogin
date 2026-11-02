import { useEffect, useState } from 'react'
import {
  ArrowLeft,
  Check,
  CircleAlert,
  Copy,
  ExternalLink,
  Globe2,
  KeyRound,
  LoaderCircle,
  LockKeyhole,
  Play,
  RotateCcw,
  Square,
  Trash2,
  UserRound,
  X
} from 'lucide-react'
import type { AccountWithSite, LoginMode, LoginStatus, LoginViewState } from '@shared/types'
import { ConfirmDialog } from './Modal'

const INITIAL_STATE: LoginViewState = {
  active: true,
  status: 'opening',
  message: '正在启动 Windows 默认浏览器',
  currentUrl: '',
  currentOrigin: '',
  pageTitle: '',
  isLoading: true,
  originTrusted: true,
  recording: false,
  recipeExists: false,
  recordingStepCount: 0,
  browserName: ''
}

export function LoginWorkspace({
  account,
  mode,
  onClose,
  onDataChanged,
  notify
}: {
  account: AccountWithSite
  mode: LoginMode
  onClose: () => void
  onDataChanged: () => Promise<void>
  notify: (kind: 'success' | 'error' | 'info', message: string) => void
}): React.JSX.Element {
  const [state, setState] = useState<LoginViewState>({
    ...INITIAL_STATE,
    accountId: account.id,
    mode,
    recording: mode === 'record',
    recipeExists: Boolean(account.site.recipe)
  })
  const [confirmClear, setConfirmClear] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let cancelled = false
    void window.autologin.login
      .start({ accountId: account.id, mode })
      .then((next) => {
        if (!cancelled) setState(next)
      })
      .catch((error) => {
        if (!cancelled) {
          setState((current) => ({
            ...current,
            status: 'error',
            message: error instanceof Error ? error.message : '无法打开默认浏览器'
          }))
        }
      })
    const unsubscribe = window.autologin.events.onLoginState((next) => {
      if (!cancelled) setState(next)
    })
    return () => {
      cancelled = true
      unsubscribe()
      void window.autologin.login.close()
    }
  }, [account.id, mode])

  async function focusBrowser(): Promise<void> {
    try {
      await window.autologin.login.focusBrowser()
    } catch (error) {
      notify('error', error instanceof Error ? error.message : '无法切换到默认浏览器')
    }
  }

  async function retry(): Promise<void> {
    try {
      await window.autologin.login.retry()
    } catch (error) {
      notify('error', error instanceof Error ? error.message : '重试失败')
    }
  }

  async function trustOrigin(): Promise<void> {
    try {
      await window.autologin.login.trustCurrentOrigin()
      notify('success', '已信任当前域名并继续登录')
    } catch (error) {
      notify('error', error instanceof Error ? error.message : '操作失败')
    }
  }

  async function restartRecording(): Promise<void> {
    try {
      await window.autologin.login.close()
      const next = await window.autologin.login.start({ accountId: account.id, mode: 'record' })
      setState(next)
      notify('info', '录制已开始，请在默认浏览器中完成登录')
    } catch (error) {
      notify('error', error instanceof Error ? error.message : '无法开始录制')
    }
  }

  async function finishRecording(): Promise<void> {
    setBusy(true)
    try {
      const result = await window.autologin.login.finishRecording()
      if (result.saved) {
        await onDataChanged()
        notify('success', '登录流程已保存')
        onClose()
      } else {
        notify('info', '尚未捕获到可回放的登录步骤')
      }
    } catch (error) {
      notify('error', error instanceof Error ? error.message : '保存录制流程失败')
    } finally {
      setBusy(false)
    }
  }

  async function cancelRecording(): Promise<void> {
    await window.autologin.login.cancelRecording()
    notify('info', '已取消本次录制')
  }

  async function copyUsername(): Promise<void> {
    try {
      await window.autologin.accounts.copyUsername(account.id)
      notify('success', '账号已复制')
    } catch (error) {
      notify('error', error instanceof Error ? error.message : '无法写入剪贴板')
    }
  }

  async function copyPassword(): Promise<void> {
    try {
      await window.autologin.accounts.copy(account.id)
      notify('success', '密码已复制，30 秒后自动清除')
    } catch (error) {
      notify('error', error instanceof Error ? error.message : '复制失败')
    }
  }

  async function clearSession(): Promise<void> {
    setBusy(true)
    try {
      await window.autologin.login.clearSession(account.id)
      notify('success', '网站会话已清除')
      setConfirmClear(false)
      onClose()
    } catch (error) {
      notify('error', error instanceof Error ? error.message : '清除会话失败')
    } finally {
      setBusy(false)
    }
  }

  const status = statusMeta(state.status)
  const isRecording = state.recording
  const canTrustOrigin = !state.originTrusted && Boolean(state.currentOrigin)
  const showNotice = Boolean(state.message) && state.status !== 'authenticated'
  const showFallback = state.status === 'needs_action' || state.status === 'error'
  const browserName = state.browserName || 'Windows 默认浏览器'
  const pageAddress = displayUrl(state.currentUrl || account.site.startUrl)

  return (
    <div className="login-workspace">
      <header className="workspace-header">
        <div className="workspace-header__left">
          <button className="icon-button icon-button--back" onClick={onClose} aria-label="返回账号库">
            <ArrowLeft size={18} />
          </button>
          <span className={`monogram monogram--small ${toneClass(account.siteId)}`}>
            {account.site.name.slice(0, 1).toUpperCase()}
          </span>
          <div className="workspace-account">
            <span>
              {account.site.name} <em>/</em> {account.label}
            </span>
            <small>{account.username}</small>
          </div>
        </div>
        <div className="workspace-header__center">
          <span className={`workspace-status workspace-status--${status.tone}`}>
            {state.isLoading && state.status === 'opening' ? (
              <LoaderCircle size={13} className="spin" />
            ) : (
              status.icon
            )}
            {status.label}
          </span>
        </div>
        <div className="workspace-header__actions">
          <button
            className="text-button"
            onClick={() => void restartRecording()}
            disabled={isRecording}
          >
            <RotateCcw size={15} />
            重新录制
          </button>
          <button className="icon-button" onClick={() => setConfirmClear(true)} aria-label="清除会话">
            <Trash2 size={17} />
          </button>
          <button className="icon-button" onClick={onClose} aria-label="关闭">
            <X size={18} />
          </button>
        </div>
      </header>

      <div className="browser-toolbar browser-toolbar--external">
        <div className="external-browser-identity">
          <Globe2 size={15} />
          <span>{browserName}</span>
        </div>
        <div className="address-pill">
          <LockKeyhole size={13} />
          <span>{pageAddress}</span>
        </div>
        <button className="toolbar-external" onClick={() => void focusBrowser()}>
          <ExternalLink size={15} />
          切换到浏览器
        </button>
      </div>

      {isRecording && (
        <div className="recording-bar">
          <span className="recording-pulse" />
          <div>
            <strong>正在录制登录流程</strong>
            <small>
              已完成 {state.recordingStepCount} 个步骤。请在默认浏览器中完成验证码和登录，再结束录制。
            </small>
          </div>
          <div className="recording-actions">
            <button className="button button--ghost button--small" onClick={() => void cancelRecording()}>
              取消
            </button>
            <button
              className="button button--primary button--small"
              onClick={() => void finishRecording()}
              disabled={busy}
            >
              <Square size={13} fill="currentColor" />
              结束录制
            </button>
          </div>
        </div>
      )}

      {showNotice && (
        <div className={`login-notice login-notice--${status.tone}`}>
          <span className="login-notice__icon">{status.icon}</span>
          <p>{state.message}</p>
          <div className="login-notice__actions">
            {canTrustOrigin && (
              <button className="button button--ghost button--small" onClick={() => void trustOrigin()}>
                <Globe2 size={14} />
                信任当前域名
              </button>
            )}
            {showFallback && (
              <>
                <button
                  className="button button--ghost button--small"
                  onClick={() => void copyUsername()}
                >
                  <UserRound size={13} />
                  复制账号
                </button>
                <button
                  className="button button--ghost button--small"
                  onClick={() => void copyPassword()}
                >
                  <KeyRound size={13} />
                  复制密码
                </button>
                {!isRecording && (
                  <button
                    className="button button--ghost button--small"
                    onClick={() => void restartRecording()}
                  >
                    <RotateCcw size={13} />
                    录制登录
                  </button>
                )}
                <button className="button button--ghost button--small" onClick={() => void retry()}>
                  <Play size={13} />
                  重新尝试
                </button>
              </>
            )}
          </div>
        </div>
      )}

      <div className="login-surface login-surface--external">
        <section className="external-browser-card" aria-live="polite">
          <div className="external-browser-card__header">
            <span className="external-browser-card__mark">
              <ExternalLink size={24} strokeWidth={1.6} />
            </span>
            <div className="external-browser-card__heading">
              <span>独立登录会话</span>
              <h1>已在 {browserName} 中打开</h1>
            </div>
            <span className={`workspace-status workspace-status--${status.tone}`}>
              {status.icon}
              {status.label}
            </span>
          </div>

          <p className="external-browser-card__lead">{heroMessage(state, browserName)}</p>

          <div className="external-browser-address">
            <span className="external-browser-address__icon">
              <LockKeyhole size={15} />
            </span>
            <div>
              <small>当前页面</small>
              <strong>{pageAddress}</strong>
            </div>
          </div>

          <ol className="external-browser-steps">
            <li>
              <span>01</span>
              <div>
                <strong>默认浏览器打开</strong>
                <small>使用此账号独立的浏览器配置目录。</small>
              </div>
            </li>
            <li>
              <span>02</span>
              <div>
                <strong>自动填写并提交</strong>
                <small>仅在已登记域名内执行，每个页面最多提交一次。</small>
              </div>
            </li>
            <li>
              <span>03</span>
              <div>
                <strong>验证码人工接管</strong>
                <small>检测到验证码或 2FA 时停止提交，由你完成验证。</small>
              </div>
            </li>
          </ol>

          <div className="external-browser-card__actions">
            <button className="button button--primary" onClick={() => void focusBrowser()}>
              <ExternalLink size={15} />
              切换到浏览器
            </button>
            {showFallback && (
              <button className="button button--ghost" onClick={() => void retry()}>
                <RotateCcw size={15} />
                重新尝试
              </button>
            )}
          </div>

          <p className="external-browser-card__note">
            Cookie 和网站会话保存在此账号的独立浏览器配置目录中，由浏览器与 Windows 用户级机制保护，不直接使用保险库主密码加密。
          </p>
        </section>
      </div>

      {confirmClear && (
        <ConfirmDialog
          title="清除此账号的网站会话？"
          description="将删除该账号独立的默认浏览器配置目录，下次登录需要重新输入账号密码。已保存的凭据和录制流程不会被删除。"
          confirmLabel="清除会话"
          busy={busy}
          onConfirm={() => void clearSession()}
          onClose={() => setConfirmClear(false)}
        />
      )}
    </div>
  )
}

function heroMessage(state: LoginViewState, browserName: string): string {
  switch (state.status) {
    case 'opening':
      return `AutoLogin 正在启动 ${browserName} 并建立仅绑定本机的受控会话。`
    case 'filling':
      return '正在识别登录表单并填写账号密码。请稍候，不要关闭浏览器窗口。'
    case 'submitting':
      return '账号密码已填写并提交，正在等待网站响应。'
    case 'awaiting_manual_challenge':
      return '验证码或二次验证需要人工完成。请切换到浏览器，完成验证后保持窗口打开。'
    case 'authenticated':
      return '登录已完成。你可以关闭此工作区，浏览器会话会为下次登录保留。'
    case 'needs_action':
      return '当前步骤需要你确认。请切换到浏览器查看页面，或使用下方兜底操作。'
    case 'error':
      return '默认浏览器连接出现问题。你可以重新尝试，或检查 Windows 默认浏览器设置。'
    default:
      return '登录页面将在 Windows 默认浏览器中打开，并由 AutoLogin 自动填充。'
  }
}

function statusMeta(status: LoginStatus): {
  label: string
  tone: 'neutral' | 'working' | 'warning' | 'success' | 'danger'
  icon: React.ReactNode
} {
  switch (status) {
    case 'opening':
      return {
        label: '正在打开',
        tone: 'working',
        icon: <LoaderCircle size={13} className="spin" />
      }
    case 'filling':
      return {
        label: '正在填充',
        tone: 'working',
        icon: <LoaderCircle size={13} className="spin" />
      }
    case 'awaiting_manual_challenge':
      return {
        label: '等待人工验证',
        tone: 'warning',
        icon: <CircleAlert size={13} />
      }
    case 'submitting':
      return {
        label: '正在提交',
        tone: 'working',
        icon: <LoaderCircle size={13} className="spin" />
      }
    case 'authenticated':
      return {
        label: '已登录',
        tone: 'success',
        icon: <Check size={13} />
      }
    case 'needs_action':
      return {
        label: '需要确认',
        tone: 'warning',
        icon: <CircleAlert size={13} />
      }
    case 'error':
      return {
        label: '出现问题',
        tone: 'danger',
        icon: <CircleAlert size={13} />
      }
    default:
      return {
        label: '待启动',
        tone: 'neutral',
        icon: <Globe2 size={13} />
      }
  }
}

function toneClass(id: string): string {
  let hash = 0
  for (const char of id) {
    hash = (hash * 31 + char.charCodeAt(0)) >>> 0
  }
  return `monogram--tone-${hash % 4}`
}

function displayUrl(value: string): string {
  try {
    const url = new URL(value)
    return `${url.origin}${url.pathname}`
  } catch {
    return value
  }
}
