import { useState } from 'react'
import {
  ArrowRight,
  Check,
  Eye,
  EyeOff,
  Fingerprint,
  Globe2,
  KeyRound,
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
          <span className="eyebrow eyebrow--light">PRIVATE BY DEFAULT</span>
          <h1>
            {tr('一次解锁，', 'One unlock.', '一次解鎖，')}
            <br />
            {tr('回到每个账号。', 'Every account.', '回到每個帳號。')}
          </h1>
          <p>
            {tr(
              '把分散在浏览器里的登录入口收进一个安静的本地工作台。账号加密保存，验证码始终由你掌控。',
              'Keep every browser login in one calm local workspace. Credentials stay encrypted and verification always stays in your hands.',
              '把分散在瀏覽器裡的登入入口收進一個安靜的本機工作台。帳號加密保存，驗證碼始終由你掌控。'
            )}
          </p>
        </div>
        <div className="auth-feature-strip">
          <span>
            <ShieldCheck size={16} />
            {tr('本地加密', 'Local encryption', '本機加密')}
          </span>
          <span>
            <Fingerprint size={16} />
            {tr('人工验证', 'Manual verification', '人工驗證')}
          </span>
          <span>
            <Globe2 size={16} />
            {tr('会话复用', 'Session reuse', '工作階段重用')}
          </span>
        </div>
        <div className="auth-orbit" aria-hidden="true">
          <span className="auth-orbit__ring auth-orbit__ring--one" />
          <span className="auth-orbit__ring auth-orbit__ring--two" />
          <span className="auth-orbit__ring auth-orbit__ring--three" />
          <span className="auth-orbit__core">
            <LockKeyhole size={28} strokeWidth={1.6} />
          </span>
          <span className="auth-orbit__dot auth-orbit__dot--one" />
          <span className="auth-orbit__dot auth-orbit__dot--two" />
        </div>
      </section>
      <section className="auth-panel">
        <div className="auth-panel__inner">{children}</div>
        <p className="auth-panel__footnote">AutoLogin · Windows local-first login workspace</p>
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
          className="button button--primary button--large auth-submit"
          type="submit"
          disabled={busy || score === 0}
        >
          {busy ? tr('正在创建…', 'Creating…', '正在建立…') : tr('创建保险库', 'Create vault', '建立保險庫')}
          {!busy && <ArrowRight size={17} />}
        </button>
      </form>
      <div className="auth-assurance">
        <span>
          <Check size={14} /> {tr('无云端账号', 'No cloud account', '無雲端帳號')}
        </span>
        <span>
          <Check size={14} /> {tr('无遥测追踪', 'No telemetry', '無遙測追蹤')}
        </span>
        <span>
          <Check size={14} /> {tr('仅保存在本机', 'Stored locally', '僅保存在本機')}
        </span>
      </div>
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

  async function submit(event: React.FormEvent): Promise<void> {
    event.preventDefault()
    setError('')
    setBusy(true)
    try {
      await onUnlock(password)
    } catch (reason) {
      setError(
        language === 'zh-CN' && reason instanceof Error
          ? reason.message
          : tr('无法解锁保险库', 'Could not unlock the vault.', '無法解鎖保險庫')
      )
      setPassword('')
    } finally {
      setBusy(false)
    }
  }

  return (
    <AuthShell mode="unlock">
      <div className="unlock-seal" aria-hidden="true">
        <span className="unlock-seal__halo" />
        <span className="unlock-seal__disc">
          <LockKeyhole size={26} strokeWidth={1.7} />
        </span>
      </div>
      <div className="auth-form-heading auth-form-heading--center">
        <span className="eyebrow">WELCOME BACK</span>
        <h2>{tr('保险库已锁定', 'Vault locked', '保險庫已鎖定')}</h2>
        <p>{tr('输入主密码，继续访问你的登录工作台。', 'Enter your master password to continue.', '輸入主密碼，繼續存取你的登入工作台。')}</p>
      </div>
      <form className="auth-form auth-form--unlock" onSubmit={submit}>
        <label className="field">
          <span className="field__label">{tr('主密码', 'Master password', '主密碼')}</span>
          <span className="input-shell input-shell--large">
            <KeyRound size={18} />
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
              className="input-action"
              onClick={() => setShowPassword((value) => !value)}
              aria-label={showPassword ? tr('隐藏密码', 'Hide password', '隱藏密碼') : tr('显示密码', 'Show password', '顯示密碼')}
            >
              {showPassword ? <EyeOff size={17} /> : <Eye size={17} />}
            </button>
          </span>
        </label>
        {error && <p className="form-error">{error}</p>}
        <button
          className="button button--primary button--large auth-submit"
          type="submit"
          disabled={busy || password.length === 0}
        >
          {busy ? tr('正在解锁…', 'Unlocking…', '正在解鎖…') : tr('解锁保险库', 'Unlock vault', '解鎖保險庫')}
          {!busy && <ArrowRight size={17} />}
        </button>
      </form>
      <button className="text-button auth-forgot" onClick={onForgot}>
        {tr('忘记主密码？', 'Forgot master password?', '忘記主密碼？')}
      </button>
    </AuthShell>
  )
}
