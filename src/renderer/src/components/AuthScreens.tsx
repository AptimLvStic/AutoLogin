import { useState } from 'react'
import {
  ArrowRight,
  Eye,
  EyeOff,
  KeyRound,
  LoaderCircle,
  LockKeyhole,
  ShieldCheck
} from 'lucide-react'
import { useI18n } from '../i18n'
import { PasswordStrength, passwordStrength } from './PasswordStrength'

function AuthShell({
  children,
  mode
}: {
  children: React.ReactNode
  mode: 'setup' | 'unlock'
}): React.JSX.Element {
  const { tr } = useI18n()
  return (
    <main className={`auth-shell auth-shell--${mode}`}>
      <section className="auth-story">
        <div className="auth-story__content">
          <span className="eyebrow">LOCAL-FIRST LOGIN WORKSPACE</span>
          <h1>
            <span className="auth-story__line">
              {tr('记住一次登录，', 'Remember a sign-in once.', '記住一次登入，')}
            </span>
            <span className="auth-story__line">
              {tr('以后点一下就好。', 'Then it is one click.', '以後點一下就好。')}
            </span>
          </h1>
          <p>
            {tr(
              '完整记录点击与输入的序列，重放失败自动回退到通用表单识别。适用于二次跳转、验证码前置页与 SSO 中转。',
              'Record the complete click and input sequence, then fall back to generic form detection if replay fails. Built for redirects, pre-login challenges and SSO hops.',
              '完整記錄點擊與輸入的順序，重放失敗時自動回到通用表單辨識。適用於二次跳轉、驗證碼前置頁與 SSO 中轉。'
            )}
          </p>
        </div>
        <div className="auth-story__orbit" aria-hidden="true">
          <div className="auth-orbit">
            <span className="auth-orbit__ring auth-orbit__ring--one">
              <svg className="auth-orbit__arc" viewBox="0 0 100 100" aria-hidden="true">
                <circle cx="50" cy="50" r="49" />
              </svg>
            </span>
            <span className="auth-orbit__ring auth-orbit__ring--two">
              <svg className="auth-orbit__arc" viewBox="0 0 100 100" aria-hidden="true">
                <circle cx="50" cy="50" r="49" />
              </svg>
            </span>
            <span className="auth-orbit__ring auth-orbit__ring--three">
              <svg className="auth-orbit__arc" viewBox="0 0 100 100" aria-hidden="true">
                <circle cx="50" cy="50" r="49" />
              </svg>
            </span>
            <span className="auth-orbit__halo" />
            <span className="auth-orbit__core">
              <LockKeyhole size={24} strokeWidth={1.5} />
            </span>
            <span className="auth-orbit__dot-spin auth-orbit__dot-spin--one">
              <span className="auth-orbit__dot auth-orbit__dot--one" />
            </span>
            <span className="auth-orbit__dot-spin auth-orbit__dot-spin--two">
              <span className="auth-orbit__dot auth-orbit__dot--two" />
            </span>
            <span className="auth-orbit__dot-spin auth-orbit__dot-spin--three">
              <span className="auth-orbit__dot auth-orbit__dot--three" />
            </span>
          </div>
        </div>
        <div className="auth-trust-row">
          <span>{tr('仅保存在本机', 'Stored locally', '僅保存在本機')}</span>
          <span>{tr('无遥测追踪', 'No telemetry', '無遙測追蹤')}</span>
          <span>AES-256-GCM</span>
        </div>
      </section>
      <section className="auth-panel">
        <div className="auth-panel__inner">{children}</div>
      </section>
    </main>
  )
}

export function SetupScreen({
  onCreate
}: {
  onCreate: (password: string) => Promise<void>
}): React.JSX.Element {
  const { tr, language } = useI18n()
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const score = passwordStrength(password)

  async function submit(event: React.FormEvent): Promise<void> {
    event.preventDefault()
    setError('')
    if (password.length < 10) {
      setError(tr('主密码至少需要 10 个字符', 'Use at least 10 characters.', '主密碼至少需要 10 個字元'))
      return
    }
    if (password !== confirm) {
      setError(tr('两次输入的主密码不一致', 'The master passwords do not match.', '兩次輸入的主密碼不一致'))
      return
    }
    setBusy(true)
    try {
      await onCreate(password)
    } catch (reason) {
      setError(
        language === 'zh-CN' && reason instanceof Error
          ? reason.message
          : tr('创建保险库失败', 'Could not create the vault.', '建立保險庫失敗')
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <AuthShell mode="setup">
      <div className="auth-form-heading">
        <span className="eyebrow">FIRST RUN · 01</span>
        <h2>{tr('创建你的本地保险库', 'Create your local vault', '建立你的本機保險庫')}</h2>
        <p>
          {tr(
            '主密码只用于本机加密。它不会上传，也无法被找回。',
            'Your master password is used only for local encryption. It is never uploaded and cannot be recovered.',
            '主密碼只用於本機加密。它不會上傳，也無法被找回。'
          )}
        </p>
      </div>
      <form className="auth-form" onSubmit={submit}>
        <label className="field">
          <span className="field__label">{tr('主密码', 'Master password', '主密碼')}</span>
          <span className="input-shell">
            <KeyRound size={17} />
            <input
              type={showPassword ? 'text' : 'password'}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder={tr('至少 10 个字符', 'At least 10 characters', '至少 10 個字元')}
              autoFocus
              autoComplete="new-password"
            />
            <button
              type="button"
              className="input-action"
              onClick={() => setShowPassword((value) => !value)}
              aria-label={showPassword ? tr('隐藏密码', 'Hide password', '隱藏密碼') : tr('显示密码', 'Show password', '顯示密碼')}
            >
              {showPassword ? <EyeOff size={17} /> : <Eye size={17} />}
            </button>
          </span>
        </label>
        {password && <PasswordStrength password={password} />}
        <label className="field">
          <span className="field__label">{tr('再次输入主密码', 'Confirm master password', '再次輸入主密碼')}</span>
          <span className="input-shell">
            <ShieldCheck size={17} />
            <input
              type={showPassword ? 'text' : 'password'}
              value={confirm}
              onChange={(event) => setConfirm(event.target.value)}
              placeholder={tr('确认主密码', 'Confirm master password', '確認主密碼')}
              autoComplete="new-password"
            />
          </span>
        </label>
        <div className="auth-warning">
          <LockKeyhole size={17} />
          <p>
            <strong>{tr('请妥善保管主密码。', 'Keep your master password safe.', '請妥善保管主密碼。')}</strong>
            {tr(
              '忘记后无法恢复保险库，只能清除本机数据并重新开始。',
              'If you forget it, the vault cannot be recovered. You will need to clear local data and start over.',
              '忘記後無法恢復保險庫，只能清除本機資料並重新開始。'
            )}
          </p>
        </div>
        {error && <p className="form-error">{error}</p>}
        <button
          className={`button button--primary button--large auth-submit${
            busy ? ' is-loading' : ''
          }`}
          type="submit"
          disabled={busy || score === 0}
          aria-busy={busy}
        >
          {busy && <LoaderCircle size={15} className="spin" />}
          {busy ? tr('正在创建…', 'Creating…', '正在建立…') : tr('创建保险库', 'Create vault', '建立保險庫')}
          <span className={`button-icon-slot${busy ? ' is-hidden' : ''}`}>
            <ArrowRight size={17} />
          </span>
        </button>
      </form>
      {/* 信任标签统一放在左栏底部（.auth-trust-row），右栏不再重复一遍。 */}
    </AuthShell>
  )
}

export function UnlockScreen({
  onUnlock,
  onForgot
}: {
  onUnlock: (password: string) => Promise<void>
  onForgot: () => void
}): React.JSX.Element {
  const { tr, language } = useI18n()
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [shaking, setShaking] = useState(false)

  function reject(message: string): void {
    setError(message)
    // 抖动只播一次：先移除再在下一帧加回，保证重复触发也会重新播放。
    setShaking(false)
    window.requestAnimationFrame(() => setShaking(true))
    window.setTimeout(() => setShaking(false), 380)
  }

  async function submit(event: React.FormEvent): Promise<void> {
    event.preventDefault()
    setError('')
    if (!password) {
      reject(tr('请输入主密码', 'Enter your master password', '請輸入主密碼'))
      return
    }
    setShaking(false)
    setBusy(true)
    try {
      await onUnlock(password)
    } catch (reason) {
      const raw = reason instanceof Error ? reason.message : ''
      const message = raw.includes('密码不正确')
        ? tr(
            '主密码不正确，或旧版保险库文件已损坏',
            'Incorrect master password, or the old vault file is damaged.',
            '主密碼不正確，或舊版保險庫檔案已損壞'
          )
        : raw.includes('主密码至少需要 10 个字符')
          ? tr('主密码至少需要 10 个字符', 'Use at least 10 characters.', '主密碼至少需要 10 個字元')
          : language === 'zh-CN' && raw
            ? raw
            : tr('无法解锁保险库', 'Could not unlock the vault.', '無法解鎖保險庫')
      setPassword('')
      reject(message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <AuthShell mode="unlock">
      <div className="auth-form-heading">
        <span className="eyebrow">MIGRATE VAULT</span>
        <h2>{tr('迁移旧版保险库', 'Migrate your old vault', '遷移舊版保險庫')}</h2>
        <p>
          {tr(
            '最后一次输入旧版主密码。迁移后每个数据库改用自己的密码。',
            'Enter the old master password one last time. Each database then gets its own password.',
            '最後一次輸入舊版主密碼。遷移後每個資料庫改用自己的密碼。'
          )}
        </p>
      </div>
      <form
        className={`auth-form auth-form--unlock${error ? ' is-error' : ''}${
          shaking ? ' is-shaking' : ''
        }`}
        onSubmit={submit}
      >
        <label className="field">
          <span className="field__label">{tr('主密码', 'Master password', '主密碼')}</span>
          <span className="input-shell input-shell--large">
            <input
              type={showPassword ? 'text' : 'password'}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder={tr('输入主密码', 'Enter master password', '輸入主密碼')}
              autoFocus
              autoComplete="current-password"
            />
            <button
              type="button"
              className="input-text-action"
              onClick={() => setShowPassword((value) => !value)}
              aria-label={showPassword ? tr('隐藏密码', 'Hide password', '隱藏密碼') : tr('显示密码', 'Show password', '顯示密碼')}
            >
              {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
              <span>
                {showPassword
                  ? tr('隐藏', 'Hide', '隱藏')
                  : tr('显示', 'Show', '顯示')}
              </span>
            </button>
          </span>
        </label>
        {error && <p className="form-error">{error}</p>}
        <button
          className={`button button--primary button--large auth-submit${
            busy ? ' is-loading' : ''
          }`}
          type="submit"
          disabled={busy}
          aria-busy={busy}
        >
          {busy && <LoaderCircle size={15} className="spin" />}
          {busy ? tr('正在解锁…', 'Unlocking…', '正在解鎖…') : tr('解锁', 'Unlock', '解鎖')}
          <span className={`button-icon-slot${busy ? ' is-hidden' : ''}`}>
            <ArrowRight size={17} />
          </span>
        </button>
      </form>
      <button className="text-button auth-forgot" onClick={onForgot}>
        <span>{tr('忘记主密码？', 'Forgot master password?', '忘記主密碼？')}</span>
      </button>
    </AuthShell>
  )
}
