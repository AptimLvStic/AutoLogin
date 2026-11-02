import { useEffect, useState } from 'react'
import {
  Check,
  KeyRound,
  LockKeyhole,
  ShieldCheck,
  Trash2
} from 'lucide-react'
import { AUTO_LOCK_OPTIONS, type AppSettings, type AutoLockMinutes } from '@shared/types'
import { Modal, ConfirmDialog } from './Modal'
import { PasswordStrength } from './PasswordStrength'

export function SettingsModal({
  settings,
  appVersion,
  onClose,
  onSettingsChange,
  onClearAllData,
  notify
}: {
  settings: AppSettings
  appVersion: string
  onClose: () => void
  onSettingsChange: (settings: AppSettings) => Promise<void>
  onClearAllData: () => Promise<void>
  notify: (kind: 'success' | 'error' | 'info', message: string) => void
}): React.JSX.Element {
  const [autoLock, setAutoLock] = useState<AutoLockMinutes>(settings.autoLockMinutes)
  const [currentPassword, setCurrentPassword] = useState('')
  const [nextPassword, setNextPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [changingPassword, setChangingPassword] = useState(false)
  const [clearOpen, setClearOpen] = useState(false)
  const [clearBusy, setClearBusy] = useState(false)

  useEffect(() => {
    setAutoLock(settings.autoLockMinutes)
  }, [settings.autoLockMinutes])

  async function changeAutoLock(value: AutoLockMinutes): Promise<void> {
    setAutoLock(value)
    try {
      await onSettingsChange({ ...settings, autoLockMinutes: value })
      notify('success', `自动锁定已设为 ${value} 分钟`)
    } catch (error) {
      setAutoLock(settings.autoLockMinutes)
      notify('error', error instanceof Error ? error.message : '设置保存失败')
    }
  }

  async function submitPassword(event: React.FormEvent): Promise<void> {
    event.preventDefault()
    if (nextPassword.length < 10) {
      notify('error', '新主密码至少需要 10 个字符')
      return
    }
    if (nextPassword !== confirmPassword) {
      notify('error', '两次输入的新主密码不一致')
      return
    }
    setChangingPassword(true)
    try {
      await window.autologin.vault.changePassword(currentPassword, nextPassword)
      setCurrentPassword('')
      setNextPassword('')
      setConfirmPassword('')
      notify('success', '主密码已更新')
    } catch (error) {
      notify('error', error instanceof Error ? error.message : '主密码修改失败')
    } finally {
      setChangingPassword(false)
    }
  }

  async function clearAll(): Promise<void> {
    setClearBusy(true)
    try {
      await onClearAllData()
      setClearOpen(false)
    } catch (error) {
      notify('error', error instanceof Error ? error.message : '清除数据失败')
    } finally {
      setClearBusy(false)
    }
  }

  return (
    <>
      <Modal
        title="设置"
        eyebrow="PREFERENCES & SECURITY"
        onClose={onClose}
        width="720px"
        className="settings-modal"
      >
        <div className="settings-stack">
          <section className="settings-section">
            <div className="settings-section__heading">
              <span className="settings-icon">
                <LockKeyhole size={18} />
              </span>
              <div>
                <h3>自动锁定</h3>
                <p>应用闲置一段时间后隐藏保险库内容，网站会话会保留。</p>
              </div>
            </div>
            <div className="segmented-control segmented-control--wide">
              {AUTO_LOCK_OPTIONS.map((minutes) => (
                <button
                  key={minutes}
                  type="button"
                  className={autoLock === minutes ? 'is-active' : ''}
                  onClick={() => void changeAutoLock(minutes)}
                >
                  {minutes} 分钟
                </button>
              ))}
            </div>
          </section>

          <section className="settings-section">
            <div className="settings-section__heading">
              <span className="settings-icon">
                <KeyRound size={18} />
              </span>
              <div>
                <h3>修改主密码</h3>
                <p>修改后会使用新的密钥重新加密整个保险库。</p>
              </div>
            </div>
            <form className="settings-password-form" onSubmit={submitPassword}>
              <label className="field">
                <span className="field__label">当前主密码</span>
                <span className="input-shell">
                  <input
                    type="password"
                    value={currentPassword}
                    onChange={(event) => setCurrentPassword(event.target.value)}
                    autoComplete="current-password"
                  />
                </span>
              </label>
              <div className="field-row">
                <label className="field">
                  <span className="field__label">新主密码</span>
                  <span className="input-shell">
                    <input
                      type="password"
                      value={nextPassword}
                      onChange={(event) => setNextPassword(event.target.value)}
                      autoComplete="new-password"
                    />
                  </span>
                </label>
                <label className="field">
                  <span className="field__label">确认新密码</span>
                  <span className="input-shell">
                    <input
                      type="password"
                      value={confirmPassword}
                      onChange={(event) => setConfirmPassword(event.target.value)}
                      autoComplete="new-password"
                    />
                  </span>
                </label>
              </div>
              {nextPassword && <PasswordStrength password={nextPassword} />}
              <button
                className="button button--soft button--align-self"
                type="submit"
                disabled={
                  changingPassword ||
                  !currentPassword ||
                  nextPassword.length < 10 ||
                  nextPassword !== confirmPassword
                }
              >
                {changingPassword ? '正在更新…' : '更新主密码'}
              </button>
            </form>
          </section>

          <section className="settings-section settings-section--split">
            <div className="settings-section__heading">
              <span className="settings-icon">
                <ShieldCheck size={18} />
              </span>
              <div>
                <h3>隐私与本地数据</h3>
                <p>AutoLogin 不包含账号系统、云同步或遥测追踪。</p>
              </div>
            </div>
            <button
              className="text-button text-button--inline"
              onClick={() => void window.autologin.app.openPrivacy()}
            >
              查看隐私说明
            </button>
          </section>

          <section className="settings-section settings-section--danger">
            <div className="settings-section__heading">
              <span className="settings-icon settings-icon--danger">
                <Trash2 size={18} />
              </span>
              <div>
                <h3>清除所有本地数据</h3>
                <p>删除保险库、账号密码、录制流程和全部网站会话。</p>
              </div>
            </div>
            <button className="button button--danger-ghost" onClick={() => setClearOpen(true)}>
              清除全部数据
            </button>
          </section>

          <footer className="settings-footer">
            <span>AutoLogin v{appVersion}</span>
            <span>
              <Check size={13} /> 本地优先
            </span>
          </footer>
        </div>
      </Modal>
      {clearOpen && (
        <ConfirmDialog
          title="清除所有本地数据？"
          description="所有账号、密码、录制流程和网站会话都会被永久删除，无法恢复。"
          confirmLabel="永久清除"
          danger
          busy={clearBusy}
          onConfirm={() => void clearAll()}
          onClose={() => setClearOpen(false)}
        />
      )}
    </>
  )
}
