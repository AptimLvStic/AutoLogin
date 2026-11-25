import { useState } from 'react'
import { Eye, EyeOff, KeyRound, LoaderCircle } from 'lucide-react'
import { useI18n } from '../i18n'
import { Modal } from './Modal'
import { PasswordStrength } from './PasswordStrength'

export type DatabasePasswordMode = 'create' | 'unlock' | 'change'

/**
 * 数据库级密码对话框。软件本身不再有全局主密码：
 * - create：新建数据库时设置该库自己的密码
 * - unlock：打开（解锁）一个已锁定的数据库
 * - change：修改当前数据库的密码
 */
export function DatabasePasswordDialog({
  mode,
  databaseName,
  onClose,
  onSubmit
}: {
  mode: DatabasePasswordMode
  databaseName?: string
  onClose: () => void
  onSubmit: (payload: {
    currentPassword?: string
    nextPassword: string
  }) => Promise<void>
}): React.JSX.Element {
  const { tr } = useI18n()
  const [currentPassword, setCurrentPassword] = useState('')
  const [nextPassword, setNextPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const needsCurrent = mode === 'change'
  const needsConfirm = mode !== 'unlock'
  const canSubmit =
    !busy &&
    (!needsCurrent || currentPassword.length > 0) &&
    nextPassword.length >= 10 &&
    (!needsConfirm || nextPassword === confirmPassword)

  const title =
    mode === 'create'
      ? tr('为数据库设置密码', 'Set a database password', '為資料庫設定密碼')
      : mode === 'unlock'
        ? tr('解锁数据库', 'Unlock database', '解鎖資料庫')
        : tr('修改数据库密码', 'Change database password', '修改資料庫密碼')

  const description =
    mode === 'create'
      ? tr(
          '这个密码只保护当前数据库。启动软件不再需要密码，打开或锁定后解锁这个数据库时才需要。',
          'This password protects only this database. AutoLogin no longer asks for a password at launch — you enter it when opening or unlocking this database.',
          '這個密碼只保護目前資料庫。啟動軟體不再需要密碼，開啟或鎖定後解鎖這個資料庫時才需要。'
        )
      : mode === 'unlock'
        ? tr(
            '输入这个数据库的密码。忘记后无法恢复该数据库里的内容。',
            'Enter this database password. It cannot be recovered if you forget it.',
            '輸入這個資料庫的密碼。忘記後無法恢復該資料庫裡的內容。'
          )
        : tr(
            '修改后会用新密码重新加密这个数据库。其他数据库不受影响。',
            'The database is re-encrypted with the new password. Other databases are unaffected.',
            '修改後會用新密碼重新加密這個資料庫。其他資料庫不受影響。'
          )

  async function submit(event: React.FormEvent): Promise<void> {
    event.preventDefault()
    if (!canSubmit) return
    setError('')
    setBusy(true)
    try {
      await onSubmit({
        currentPassword: needsCurrent ? currentPassword : undefined,
        nextPassword
      })
    } catch (reason) {
      setError(
        reason instanceof Error && reason.message
          ? reason.message
          : tr('操作失败，请重试', 'Something went wrong. Try again.', '操作失敗，請重試')
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal title={title} eyebrow="DATABASE PASSWORD" width="480px" onClose={onClose}>
      <form className="database-password-form" onSubmit={submit}>
        <p className="modal-description">
          {databaseName ? <strong>{databaseName} · </strong> : null}
          {description}
        </p>
        {needsCurrent && (
          <label className="field">
            <span className="field__label">
              {tr('当前数据库密码', 'Current database password', '目前資料庫密碼')}
            </span>
            <span className="input-shell">
              <KeyRound size={17} />
              <input
                type={showPassword ? 'text' : 'password'}
                value={currentPassword}
                onChange={(event) => setCurrentPassword(event.target.value)}
                autoComplete="current-password"
              />
              <button
                type="button"
                className="input-action"
                onClick={() => setShowPassword((current) => !current)}
                aria-label={
                  showPassword
                    ? tr('隐藏密码', 'Hide password', '隱藏密碼')
                    : tr('显示密码', 'Show password', '顯示密碼')
                }
              >
                {showPassword ? <EyeOff size={17} /> : <Eye size={17} />}
              </button>
            </span>
          </label>
        )}
        <label className="field">
          <span className="field__label">
            {mode === 'create'
              ? tr('数据库密码', 'Database password', '資料庫密碼')
              : mode === 'unlock'
                ? tr('数据库密码', 'Database password', '資料庫密碼')
                : tr('新数据库密码', 'New database password', '新資料庫密碼')}
          </span>
          <span className="input-shell">
            <KeyRound size={17} />
            <input
              type={showPassword ? 'text' : 'password'}
              value={nextPassword}
              onChange={(event) => setNextPassword(event.target.value)}
              placeholder={
                mode === 'unlock'
                  ? tr('输入密码', 'Enter password', '輸入密碼')
                  : tr('至少 10 个字符', 'At least 10 characters', '至少 10 個字元')
              }
              autoComplete={mode === 'unlock' ? 'current-password' : 'new-password'}
              data-autofocus
            />
            <button
              type="button"
              className="input-action"
              onClick={() => setShowPassword((current) => !current)}
              aria-label={
                showPassword
                  ? tr('隐藏密码', 'Hide password', '隱藏密碼')
                  : tr('显示密码', 'Show password', '顯示密碼')
              }
            >
              {showPassword ? <EyeOff size={17} /> : <Eye size={17} />}
            </button>
          </span>
        </label>
        {needsConfirm && nextPassword && <PasswordStrength password={nextPassword} />}
        {needsConfirm && (
          <label className="field">
            <span className="field__label">
              {mode === 'create'
                ? tr('确认密码', 'Confirm password', '確認密碼')
                : tr('确认新密码', 'Confirm new password', '確認新密碼')}
            </span>
            <span className="input-shell">
              <KeyRound size={17} />
              <input
                type={showPassword ? 'text' : 'password'}
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
                autoComplete="new-password"
              />
            </span>
          </label>
        )}
        {error && <p className="form-error">{error}</p>}
        <div className="modal-actions">
          <button className="button button--ghost" type="button" onClick={onClose} disabled={busy}>
            {tr('取消', 'Cancel', '取消')}
          </button>
          <button
            className={`button button--primary${busy ? ' is-loading' : ''}`}
            type="submit"
            disabled={!canSubmit}
            aria-busy={busy}
          >
            {busy && <LoaderCircle size={15} className="spin" />}
            {mode === 'create'
              ? tr('创建数据库', 'Create database', '建立資料庫')
              : mode === 'unlock'
                ? tr('解锁', 'Unlock', '解鎖')
                : tr('更新密码', 'Update password', '更新密碼')}
          </button>
        </div>
      </form>
    </Modal>
  )
}
