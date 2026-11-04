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
import { useI18n } from '../i18n'
import { ConfirmDialog } from './Modal'
import { SiteMark } from './SiteMark'

type Translate = (
  zhCN: string,
  en: string,
  zhTW: string,
  variables?: Record<string, string | number>
) => string

const INITIAL_STATE: LoginViewState = {
  active: true,
  status: 'opening',
  message: '',
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
  const { tr, language } = useI18n()
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
            message:
              language === 'zh-CN' && error instanceof Error
                ? error.message
                : tr(
                    '无法打开 Windows 默认浏览器',
                    'Could not open the Windows default browser.',
                    '無法開啟 Windows 預設瀏覽器'
                  )
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
  }, [account.id, language, mode, tr])

  function errorMessage(
    error: unknown,
    zhCN: string,
    en: string,
    zhTW: string
  ): string {
    if (language === 'zh-CN' && error instanceof Error && error.message) return error.message
    return tr(zhCN, en, zhTW)
  }

  async function focusBrowser(): Promise<void> {
    try {
      await window.autologin.login.focusBrowser()
    } catch (error) {
      notify(
        'error',
        errorMessage(
          error,
          '无法切换到默认浏览器',
          'Could not switch to the default browser.',
          '無法切換到預設瀏覽器'
        )
      )
    }
  }

  async function retry(): Promise<void> {
    try {
      await window.autologin.login.retry()
    } catch (error) {
      notify('error', errorMessage(error, '重试失败', 'Retry failed.', '重試失敗'))
    }
  }

  async function trustOrigin(): Promise<void> {
    try {
      await window.autologin.login.trustCurrentOrigin()
      notify(
        'success',
        tr('已信任当前域名并继续登录', 'Origin trusted. Sign-in will continue.', '已信任目前網域並繼續登入')
      )
    } catch (error) {
      notify('error', errorMessage(error, '操作失败', 'The operation failed.', '操作失敗'))
    }
  }

  async function restartRecording(): Promise<void> {
    try {
      await window.autologin.login.close()
      const next = await window.autologin.login.start({ accountId: account.id, mode: 'record' })
      setState(next)
      notify(
        'info',
        tr(
          '录制已开始，请在默认浏览器中完成登录',
          'Recording started. Complete the sign-in in your default browser.',
          '錄製已開始，請在預設瀏覽器中完成登入'
        )
      )
    } catch (error) {
      notify(
        'error',
        errorMessage(error, '无法开始录制', 'Could not start recording.', '無法開始錄製')
      )
    }
  }

  async function finishRecording(): Promise<void> {
    setBusy(true)
    try {
      const result = await window.autologin.login.finishRecording()
      if (result.saved) {
        await onDataChanged()
        notify('success', tr('登录流程已保存', 'Sign-in flow saved.', '登入流程已儲存'))
        onClose()
      } else {
        notify(
          'info',
          tr(
            '尚未捕获到可回放的登录步骤',
            'No replayable sign-in steps were captured.',
            '尚未擷取到可重播的登入步驟'
          )
        )
      }
    } catch (error) {
      notify(
        'error',
        errorMessage(
          error,
          '保存录制流程失败',
          'Could not save the recorded flow.',
          '儲存錄製流程失敗'
        )
      )
    } finally {
      setBusy(false)
    }
  }

  async function cancelRecording(): Promise<void> {
    await window.autologin.login.cancelRecording()
    notify('info', tr('已取消本次录制', 'Recording cancelled.', '已取消本次錄製'))
  }

  async function copyUsername(): Promise<void> {
    try {
      await window.autologin.accounts.copyUsername(account.id)
      notify('success', tr('账号已复制', 'Username copied.', '帳號已複製'))
    } catch (error) {
      notify(
        'error',
        errorMessage(error, '无法写入剪贴板', 'Could not write to the clipboard.', '無法寫入剪貼簿')
      )
    }
  }

  async function copyPassword(): Promise<void> {
    try {
      await window.autologin.accounts.copy(account.id)
      notify(
        'success',
        tr('密码已复制，30 秒后自动清除', 'Password copied. It clears after 30 seconds.', '密碼已複製，30 秒後自動清除')
      )
    } catch (error) {
      notify('error', errorMessage(error, '复制失败', 'Copy failed.', '複製失敗'))
    }
  }

  async function clearSession(): Promise<void> {
    setBusy(true)
    try {
      await window.autologin.login.clearSession(account.id)
      notify('success', tr('网站会话已清除', 'Website session cleared.', '網站工作階段已清除'))
      setConfirmClear(false)
      onClose()
    } catch (error) {
      notify(
        'error',
        errorMessage(error, '清除会话失败', 'Could not clear the session.', '清除工作階段失敗')
      )
    } finally {
      setBusy(false)
    }
  }

  const status = statusMeta(state.status, tr)
  const isRecording = state.recording
  const canTrustOrigin = !state.originTrusted && Boolean(state.currentOrigin)
  const browserName =
    state.browserName ||
    tr('Windows 默认浏览器', 'Windows default browser', 'Windows 預設瀏覽器')
  const localizedMessage = heroMessage(state, browserName, tr)
  const noticeMessage =
    language === 'zh-CN' && state.message ? state.message : localizedMessage
  const showNotice = Boolean(noticeMessage) && state.status !== 'authenticated'
  const showFallback = state.status === 'needs_action' || state.status === 'error'
  const pageAddress = displayUrl(state.currentUrl || account.site.startUrl)

  return (
    <div className="login-workspace">
      <header className="workspace-header">
        <div className="workspace-header__left">
          <button
            className="icon-button icon-button--back"
            onClick={onClose}
            aria-label={tr('返回账号库', 'Back to accounts', '返回帳號庫')}
          >
            <ArrowLeft size={18} />
          </button>
          <SiteMark site={account.site} className="monogram--small" />
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
            {tr('重新录制', 'Record again', '重新錄製')}
          </button>
          <button
            className="icon-button"
            onClick={() => setConfirmClear(true)}
            aria-label={tr('清除会话', 'Clear session', '清除工作階段')}
          >
            <Trash2 size={17} />
          </button>
          <button
            className="icon-button"
            onClick={onClose}
            aria-label={tr('关闭', 'Close', '關閉')}
          >
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
          {tr('切换到浏览器', 'Switch to browser', '切換到瀏覽器')}
        </button>
      </div>

      {isRecording && (
        <div className="recording-bar">
          <span className="recording-pulse" />
          <div>
            <strong>{tr('正在录制登录流程', 'Recording sign-in flow', '正在錄製登入流程')}</strong>
            <small>
              {tr(
                `已完成 ${state.recordingStepCount} 个步骤。请在默认浏览器中完成验证码和登录，再结束录制。`,
                `${state.recordingStepCount} step${state.recordingStepCount === 1 ? '' : 's'} captured. Complete any challenge and sign-in in your default browser, then finish recording.`,
                `已完成 ${state.recordingStepCount} 個步驟。請在預設瀏覽器中完成驗證碼和登入，再結束錄製。`
              )}
            </small>
          </div>
          <div className="recording-actions">
            <button className="button button--ghost button--small" onClick={() => void cancelRecording()}>
              {tr('取消', 'Cancel', '取消')}
            </button>
            <button
              className="button button--primary button--small"
              onClick={() => void finishRecording()}
              disabled={busy}
            >
              <Square size={13} fill="currentColor" />
              {tr('结束录制', 'Finish recording', '結束錄製')}
            </button>
          </div>
        </div>
      )}

      {showNotice && (
        <div className={`login-notice login-notice--${status.tone}`}>
          <span className="login-notice__icon">{status.icon}</span>
          <p>{noticeMessage}</p>
          <div className="login-notice__actions">
            {canTrustOrigin && (
              <button className="button button--ghost button--small" onClick={() => void trustOrigin()}>
                <Globe2 size={14} />
                {tr('信任当前域名', 'Trust this origin', '信任目前網域')}
              </button>
            )}
            {showFallback && (
              <>
                <button
                  className="button button--ghost button--small"
                  onClick={() => void copyUsername()}
                >
                  <UserRound size={13} />
                  {tr('复制账号', 'Copy username', '複製帳號')}
                </button>
                <button
                  className="button button--ghost button--small"
                  onClick={() => void copyPassword()}
                >
                  <KeyRound size={13} />
                  {tr('复制密码', 'Copy password', '複製密碼')}
                </button>
                {!isRecording && (
                  <button
                    className="button button--ghost button--small"
                    onClick={() => void restartRecording()}
                  >
                    <RotateCcw size={13} />
                    {tr('录制登录', 'Record sign-in', '錄製登入')}
                  </button>
                )}
                <button className="button button--ghost button--small" onClick={() => void retry()}>
                  <Play size={13} />
                  {tr('重新尝试', 'Try again', '重新嘗試')}
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
              <span>{tr('独立登录会话', 'Isolated sign-in session', '獨立登入工作階段')}</span>
              <h1>
                {tr(
                  `已在 ${browserName} 中打开`,
                  `Opened in ${browserName}`,
                  `已在 ${browserName} 中開啟`
                )}
              </h1>
            </div>
            <span className={`workspace-status workspace-status--${status.tone}`}>
              {status.icon}
              {status.label}
            </span>
          </div>

          <p className="external-browser-card__lead">{localizedMessage}</p>

          <div className="external-browser-address">
            <span className="external-browser-address__icon">
              <LockKeyhole size={15} />
            </span>
            <div>
              <small>{tr('当前页面', 'Current page', '目前頁面')}</small>
              <strong>{pageAddress}</strong>
            </div>
          </div>

          <ol className="external-browser-steps">
            <li>
              <span>01</span>
              <div>
                <strong>{tr('默认浏览器打开', 'Default browser', '預設瀏覽器開啟')}</strong>
                <small>
                  {tr(
                    '使用此账号独立的浏览器配置目录。',
                    'Uses this account’s isolated browser profile.',
                    '使用此帳號獨立的瀏覽器設定目錄。'
                  )}
                </small>
              </div>
            </li>
            <li>
              <span>02</span>
              <div>
                <strong>{tr('自动填写并提交', 'Autofill and submit', '自動填寫並提交')}</strong>
                <small>
                  {tr(
                    '仅在已登记域名内执行，每个页面最多提交一次。',
                    'Runs only on approved origins, with at most one submit per page.',
                    '僅在已登記網域內執行，每個頁面最多提交一次。'
                  )}
                </small>
              </div>
            </li>
            <li>
              <span>03</span>
              <div>
                <strong>{tr('验证码人工接管', 'Manual challenge takeover', '驗證碼人工接管')}</strong>
                <small>
                  {tr(
                    '检测到验证码或 2FA 时停止提交，由你完成验证。',
                    'Stops submitting when a CAPTCHA or 2FA is detected and lets you finish it.',
                    '偵測到驗證碼或 2FA 時停止提交，由你完成驗證。'
                  )}
                </small>
              </div>
            </li>
          </ol>

          <div className="external-browser-card__actions">
            <button className="button button--primary" onClick={() => void focusBrowser()}>
              <ExternalLink size={15} />
              {tr('切换到浏览器', 'Switch to browser', '切換到瀏覽器')}
            </button>
            {showFallback && (
              <button className="button button--ghost" onClick={() => void retry()}>
                <RotateCcw size={15} />
                {tr('重新尝试', 'Try again', '重新嘗試')}
              </button>
            )}
          </div>

          <p className="external-browser-card__note">
            {tr(
              'Cookie 和网站会话保存在此账号的独立浏览器配置目录中，由浏览器与 Windows 用户级机制保护，不直接使用保险库主密码加密。',
              'Cookies and website sessions live in this account’s isolated browser profile and are protected by the browser and Windows user security, not directly by the vault master password.',
              'Cookie 和網站工作階段儲存在此帳號的獨立瀏覽器設定目錄中，由瀏覽器與 Windows 使用者層級機制保護，不直接使用保險庫主密碼加密。'
            )}
          </p>
        </section>
      </div>

      {confirmClear && (
        <ConfirmDialog
          title={tr(
            '清除此账号的网站会话？',
            'Clear this account’s website session?',
            '清除此帳號的網站工作階段？'
          )}
          description={tr(
            '将删除该账号独立的默认浏览器配置目录，下次登录需要重新输入账号密码。已保存的凭据和录制流程不会被删除。',
            'This removes the account’s isolated default-browser profile. You will need to enter the credentials again next time. Saved credentials and recorded flows are kept.',
            '將刪除該帳號獨立的預設瀏覽器設定目錄，下次登入需要重新輸入帳號密碼。已儲存的憑證和錄製流程不會被刪除。'
          )}
          confirmLabel={tr('清除会话', 'Clear session', '清除工作階段')}
          busy={busy}
          onConfirm={() => void clearSession()}
          onClose={() => setConfirmClear(false)}
        />
      )}
    </div>
  )
}

function heroMessage(state: LoginViewState, browserName: string, tr: Translate): string {
  switch (state.status) {
    case 'opening':
      return tr(
        `AutoLogin 正在启动 ${browserName} 并建立仅绑定本机的受控会话。`,
        `AutoLogin is starting ${browserName} and preparing a local-only controlled session.`,
        `AutoLogin 正在啟動 ${browserName} 並建立僅綁定本機的受控工作階段。`
      )
    case 'filling':
      return tr(
        '正在识别登录表单并填写账号密码。请稍候，不要关闭浏览器窗口。',
        'AutoLogin is detecting the sign-in form and filling your credentials. Keep the browser window open.',
        '正在識別登入表單並填寫帳號密碼。請稍候，不要關閉瀏覽器視窗。'
      )
    case 'submitting':
      return tr(
        '账号密码已填写并提交，正在等待网站响应。',
        'Credentials were filled and submitted. Waiting for the website to respond.',
        '帳號密碼已填寫並提交，正在等待網站回應。'
      )
    case 'awaiting_manual_challenge':
      return tr(
        '验证码或二次验证需要人工完成。请切换到浏览器，完成验证后保持窗口打开。',
        'A CAPTCHA or second-factor check needs you. Switch to the browser and complete it while keeping the window open.',
        '驗證碼或二次驗證需要人工完成。請切換到瀏覽器，完成驗證後保持視窗開啟。'
      )
    case 'authenticated':
      return tr(
        '登录已完成。你可以关闭此工作区，浏览器会话会为下次登录保留。',
        'Sign-in is complete. You can close this workspace; the browser session is kept for next time.',
        '登入已完成。你可以關閉此工作區，瀏覽器工作階段會為下次登入保留。'
      )
    case 'needs_action':
      return tr(
        '当前步骤需要你确认。请切换到浏览器查看页面，或使用下方兜底操作。',
        'This step needs your confirmation. Switch to the browser or use the fallback actions below.',
        '目前步驟需要你確認。請切換到瀏覽器查看頁面，或使用下方備用操作。'
      )
    case 'error':
      return tr(
        '默认浏览器连接出现问题。你可以重新尝试，或检查 Windows 默认浏览器设置。',
        'There was a problem connecting to the default browser. Try again or check the Windows default browser settings.',
        '預設瀏覽器連線發生問題。你可以重新嘗試，或檢查 Windows 預設瀏覽器設定。'
      )
    default:
      return tr(
        '登录页面将在 Windows 默认浏览器中打开，并由 AutoLogin 自动填充。',
        'The sign-in page opens in your Windows default browser and AutoLogin fills it automatically.',
        '登入頁面將在 Windows 預設瀏覽器中開啟，並由 AutoLogin 自動填寫。'
      )
  }
}

function statusMeta(
  status: LoginStatus,
  tr: Translate
): {
  label: string
  tone: 'neutral' | 'working' | 'warning' | 'success' | 'danger'
  icon: React.ReactNode
} {
  switch (status) {
    case 'opening':
      return {
        label: tr('正在打开', 'Opening', '正在開啟'),
        tone: 'working',
        icon: <LoaderCircle size={13} className="spin" />
      }
    case 'filling':
      return {
        label: tr('正在填充', 'Filling', '正在填寫'),
        tone: 'working',
        icon: <LoaderCircle size={13} className="spin" />
      }
    case 'awaiting_manual_challenge':
      return {
        label: tr('等待人工验证', 'Waiting for you', '等待人工驗證'),
        tone: 'warning',
        icon: <CircleAlert size={13} />
      }
    case 'submitting':
      return {
        label: tr('正在提交', 'Submitting', '正在提交'),
        tone: 'working',
        icon: <LoaderCircle size={13} className="spin" />
      }
    case 'authenticated':
      return {
        label: tr('已登录', 'Signed in', '已登入'),
        tone: 'success',
        icon: <Check size={13} />
      }
    case 'needs_action':
      return {
        label: tr('需要确认', 'Action needed', '需要確認'),
        tone: 'warning',
        icon: <CircleAlert size={13} />
      }
    case 'error':
      return {
        label: tr('出现问题', 'Error', '發生問題'),
        tone: 'danger',
        icon: <CircleAlert size={13} />
      }
    default:
      return {
        label: tr('待启动', 'Ready', '待啟動'),
        tone: 'neutral',
        icon: <Globe2 size={13} />
      }
  }
}

function displayUrl(value: string): string {
  try {
    const url = new URL(value)
    return `${url.origin}${url.pathname}`
  } catch {
    return value
  }
}
