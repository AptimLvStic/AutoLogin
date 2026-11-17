import { useEffect, useMemo, useState } from 'react'
import { invoke, isTauri } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { Check, KeyRound, Square, Undo2, UserRound } from 'lucide-react'
import type { AppLanguage, LoginViewState } from '@shared/types'
import { I18nProvider, useI18n } from '../i18n'

interface ShortcutPayload {
  action?: 'copy-username' | 'copy-password' | 'finish-recording'
}

export function RecordingHud(): React.JSX.Element {
  const [language, setLanguage] = useState<AppLanguage>('zh-CN')

  useEffect(() => {
    document.documentElement.classList.add('recording-hud-window')
    void window.autologin.settings
      .get()
      .then((settings) => setLanguage(settings.language))
      .catch(() => undefined)
    return () => document.documentElement.classList.remove('recording-hud-window')
  }, [])

  return (
    <I18nProvider language={language}>
      <RecordingHudContent />
    </I18nProvider>
  )
}

function RecordingHudContent(): React.JSX.Element {
  const { tr } = useI18n()
  const [state, setState] = useState<LoginViewState | null>(null)
  const [now, setNow] = useState(Date.now())
  const [temporaryMessage, setTemporaryMessage] = useState('')
  const [busy, setBusy] = useState<'username' | 'password' | 'undo' | null>(null)

  useEffect(() => {
    let disposed = false
    void window.autologin.login.getState().then((next) => {
      if (!disposed) setState(next)
    })
    const unsubscribe = window.autologin.events.onLoginState((next) => {
      if (!disposed) setState(next)
    })
    return () => {
      disposed = true
      unsubscribe()
    }
  }, [])

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    if (state && !state.recording && isTauri()) {
      void invoke('set_recording_hud_visible', { visible: false })
    }
  }, [state])

  useEffect(() => {
    if (!temporaryMessage) return
    const timer = window.setTimeout(() => setTemporaryMessage(''), 1800)
    return () => window.clearTimeout(timer)
  }, [temporaryMessage])

  useEffect(() => {
    if (!isTauri()) return
    let disposed = false
    let unlisten: (() => void) | null = null
    void listen<ShortcutPayload>('autologin://recording-shortcut', (event) => {
      if (disposed) return
      if (event.payload.action === 'copy-username') void copyCredential('username')
      if (event.payload.action === 'copy-password') void copyCredential('password')
    }).then((dispose) => {
      if (disposed) dispose()
      else unlisten = dispose
    })
    return () => {
      disposed = true
      unlisten?.()
    }
  }, [state?.accountId])

  const lastStep = state?.recordingSteps.at(-1)
  const lastAction = useMemo(
    () => (lastStep ? recordingStepLabel(lastStep, tr) : tr('等待第一步', 'Waiting for the first step', '等待第一步')),
    [lastStep, tr]
  )
  const elapsed = formatElapsed(state, now)
  const longRecording = recordingElapsedSeconds(state, now) >= 300
  const title = state?.recordingPaused
    ? tr('录制已暂停', 'Recording paused', '錄製已暫停')
    : tr('正在录制', 'Recording', '正在錄製')

  async function copyCredential(kind: 'username' | 'password'): Promise<void> {
    if (!state?.accountId || busy) return
    setBusy(kind)
    try {
      if (kind === 'username') {
        await window.autologin.accounts.copyUsername(state.accountId)
      } else {
        await window.autologin.accounts.copy(state.accountId)
      }
      setTemporaryMessage(
        kind === 'username'
          ? tr('账号已复制', 'Username copied', '帳號已複製')
          : tr('密码已复制，2 分钟后清除', 'Password copied; clears in 2 minutes', '密碼已複製，2 分鐘後清除')
      )
    } catch (error) {
      setTemporaryMessage(
        error instanceof Error ? error.message : tr('复制失败', 'Copy failed', '複製失敗')
      )
    } finally {
      setBusy(null)
    }
  }

  async function undo(): Promise<void> {
    if (busy) return
    setBusy('undo')
    try {
      setState(await window.autologin.login.undoRecordingStep())
      setTemporaryMessage(tr('已撤销上一步', 'Last step removed', '已撤銷上一步'))
    } catch (error) {
      setTemporaryMessage(
        error instanceof Error ? error.message : tr('撤销失败', 'Undo failed', '撤銷失敗')
      )
    } finally {
      setBusy(null)
    }
  }

  async function finish(): Promise<void> {
    if (!isTauri()) {
      await window.autologin.login.finishRecording()
      return
    }
    await invoke('request_recording_finish')
  }

  return (
    <div className="recording-hud-root" role="status" aria-live="polite">
      <div className={`recording-hud${state?.recordingPaused ? ' is-paused' : ''}`}>
        <span className="recording-hud__pulse" aria-hidden="true" />
        <div className="recording-hud__text">
          <strong>
            {title}
            {state?.siteName ? ` · ${state.siteName}` : ''}
          </strong>
          <span>
            {temporaryMessage ||
              `${state?.recordingStepCount ?? 0} 步 · ${elapsed} · ${lastAction}${
                longRecording
                  ? ` · ${tr('已超过 5 分钟，是否仍在录制？', 'Over 5 minutes; still recording?', '已超過 5 分鐘，是否仍在錄製？')}`
                  : ''
              }`}
          </span>
        </div>
        <div className="recording-hud__actions">
          <button
            type="button"
            onClick={() => void copyCredential('username')}
            disabled={busy !== null || !state?.accountId}
            title="Ctrl+Shift+U"
          >
            {busy === 'username' ? <Check size={12} /> : <UserRound size={12} />}
            {tr('账号', 'Username', '帳號')}
          </button>
          <button
            type="button"
            onClick={() => void copyCredential('password')}
            disabled={busy !== null || !state?.accountId}
            title="Ctrl+Shift+P"
          >
            {busy === 'password' ? <Check size={12} /> : <KeyRound size={12} />}
            {tr('密码', 'Password', '密碼')}
          </button>
          <button
            type="button"
            onClick={() => void undo()}
            disabled={busy !== null || !state?.recordingStepCount}
            title={tr('撤销上一步', 'Undo last step', '撤銷上一步')}
          >
            <Undo2 size={12} />
          </button>
          <button
            type="button"
            className="recording-hud__finish"
            onClick={() => void finish()}
            title="Ctrl+Shift+Enter"
          >
            <Square size={10} fill="currentColor" />
            {tr('结束', 'Finish', '結束')}
          </button>
        </div>
      </div>
    </div>
  )
}

function formatElapsed(state: LoginViewState | null, now: number): string {
  const totalSeconds = recordingElapsedSeconds(state, now)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
}

function recordingElapsedSeconds(state: LoginViewState | null, now: number): number {
  if (!state?.recordingStartedAt) return 0
  const startedAt = new Date(state.recordingStartedAt).getTime()
  const pausedAt = state.recordingPausedAt
    ? new Date(state.recordingPausedAt).getTime()
    : now
  if (!Number.isFinite(startedAt) || !Number.isFinite(pausedAt)) return 0
  return Math.max(0, Math.floor((pausedAt - startedAt) / 1000))
}

function recordingStepLabel(
  step: NonNullable<LoginViewState['recordingSteps']>[number],
  tr: (zhCN: string, en: string, zhTW: string) => string
): string {
  switch (step.type) {
    case 'fillUsername':
      return tr('输入账号', 'Enter username', '輸入帳號')
    case 'fillPassword':
      return tr('输入密码', 'Enter password', '輸入密碼')
    case 'paste':
      return step.source === 'password'
        ? tr('粘贴密码', 'Paste password', '貼上密碼')
        : step.source === 'username'
          ? tr('粘贴账号', 'Paste username', '貼上帳號')
          : tr('粘贴文本', 'Paste text', '貼上文字')
    case 'focusChallenge':
      return tr('验证码', 'Challenge', '驗證碼')
    case 'acceptCertWarning':
      return tr('跳过证书校验', 'Skip certificate warning', '略過憑證驗證')
    case 'press':
      return tr('按键', 'Key press', '按鍵')
    case 'click':
      return tr('点击', 'Click', '點擊')
    default:
      return tr('步骤', 'Step', '步驟')
  }
}
