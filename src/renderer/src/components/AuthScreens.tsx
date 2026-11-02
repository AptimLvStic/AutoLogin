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
import { BrandMark } from './Brand'
import { PasswordStrength, passwordStrength } from './PasswordStrength'

function AuthShell({
  children,
  mode
}: {
  children: React.ReactNode
  mode: 'setup' | 'unlock'
}): React.JSX.Element {
  return (
    <main className={`auth-shell auth-shell--${mode}`}>
      <section className="auth-story">
        <BrandMark />
        <div className="auth-story__content">
          <span className="eyebrow eyebrow--light">PRIVATE BY DEFAULT</span>
          <h1>
            一次解锁，
            <br />
            回到每个账号。
          </h1>
          <p>
            把分散在浏览器里的登录入口收进一个安静的本地工作台。账号加密保存，验证码始终由你掌控。
          </p>
        </div>
        <div className="auth-feature-strip">
          <span>
            <ShieldCheck size={16} />
            本地加密
          </span>
          <span>
            <Fingerprint size={16} />
            人工验证
          </span>
          <span>
            <Globe2 size={16} />
            会话复用
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
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const strength = passwordStrength(password)

  async function submit(event: React.FormEvent): Promise<void> {
    event.preventDefault()
    setError('')
    if (password.length < 10) {
      setError('主密码至少需要 10 个字符')
      return
    }
    if (password !== confirm) {
      setError('两次输入的主密码不一致')
      return
    }
    setBusy(true)
    try {
      await onCreate(password)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '创建保险库失败')
    } finally {
      setBusy(false)
    }
  }

  return (
    <AuthShell mode="setup">
      <div className="auth-form-heading">
        <span className="eyebrow">FIRST RUN · 01</span>
        <h2>创建你的本地保险库</h2>
        <p>主密码只用于本机加密。它不会上传，也无法被找回。</p>
      </div>
      <form className="auth-form" onSubmit={submit}>
        <label className="field">
          <span className="field__label">主密码</span>
          <span className="input-shell">
            <KeyRound size={17} />
            <input
              type={showPassword ? 'text' : 'password'}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="至少 10 个字符"
              autoFocus
              autoComplete="new-password"
            />
            <button
              type="button"
              className="input-action"
              onClick={() => setShowPassword((value) => !value)}
              aria-label={showPassword ? '隐藏密码' : '显示密码'}
            >
              {showPassword ? <EyeOff size={17} /> : <Eye size={17} />}
            </button>
          </span>
        </label>
        {password && <PasswordStrength password={password} />}
        <label className="field">
          <span className="field__label">再次输入主密码</span>
          <span className="input-shell">
            <ShieldCheck size={17} />
            <input
              type={showPassword ? 'text' : 'password'}
              value={confirm}
              onChange={(event) => setConfirm(event.target.value)}
              placeholder="确认主密码"
              autoComplete="new-password"
            />
          </span>
        </label>
        <div className="auth-warning">
          <LockKeyhole size={17} />
          <p>
            <strong>请妥善保管主密码。</strong>
            忘记后无法恢复保险库，只能清除本机数据并重新开始。
          </p>
        </div>
        {error && <p className="form-error">{error}</p>}
        <button
          className="button button--primary button--large auth-submit"
          type="submit"
          disabled={busy || strength.score === 0}
        >
          {busy ? '正在创建…' : '创建保险库'}
          {!busy && <ArrowRight size={17} />}
        </button>
      </form>
      <div className="auth-assurance">
        <span>
          <Check size={14} /> 无云端账号
        </span>
        <span>
          <Check size={14} /> 无遥测追踪
        </span>
        <span>
          <Check size={14} /> 仅保存在本机
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
      setError(reason instanceof Error ? reason.message : '无法解锁保险库')
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
        <h2>保险库已锁定</h2>
        <p>输入主密码，继续访问你的登录工作台。</p>
      </div>
      <form className="auth-form auth-form--unlock" onSubmit={submit}>
        <label className="field">
          <span className="field__label">主密码</span>
          <span className="input-shell input-shell--large">
            <KeyRound size={18} />
            <input
              type={showPassword ? 'text' : 'password'}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="输入主密码"
              autoFocus
              autoComplete="current-password"
            />
            <button
              type="button"
              className="input-action"
              onClick={() => setShowPassword((value) => !value)}
              aria-label={showPassword ? '隐藏密码' : '显示密码'}
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
          {busy ? '正在解锁…' : '解锁保险库'}
          {!busy && <ArrowRight size={17} />}
        </button>
      </form>
      <button className="text-button auth-forgot" onClick={onForgot}>
        忘记主密码？
      </button>
    </AuthShell>
  )
}
