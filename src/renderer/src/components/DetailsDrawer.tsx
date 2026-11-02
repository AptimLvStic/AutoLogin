import { useEffect, useState } from 'react'
import {
  ArrowUpRight,
  Check,
  Clock3,
  Copy,
  Eye,
  EyeOff,
  Globe2,
  KeyRound,
  Pencil,
  RefreshCw,
  ShieldCheck,
  Star,
  Trash2,
  UserRound,
  X
} from 'lucide-react'
import type { AccountWithSite, Site } from '@shared/types'
import { ConfirmDialog } from './Modal'

export function DetailsDrawer({
  account,
  onClose,
  onEdit,
  onLogin,
  onDelete,
  onClearSession,
  onFavorite,
  onSiteUpdated,
  notify
}: {
  account: AccountWithSite
  onClose: () => void
  onEdit: () => void
  onLogin: () => void
  onDelete: () => void
  onClearSession: () => Promise<void>
  onFavorite: () => Promise<void>
  onSiteUpdated: (site: Site) => void
  notify: (kind: 'success' | 'error' | 'info', message: string) => void
}): React.JSX.Element {
  const [revealed, setRevealed] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [confirmClear, setConfirmClear] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    setRevealed('')
  }, [account.id])

  useEffect(() => {
    if (!revealed) {
      return
    }
    const timer = window.setTimeout(() => setRevealed(''), 10_000)
    return () => window.clearTimeout(timer)
  }, [revealed])

  async function revealPassword(): Promise<void> {
    if (revealed) {
      setRevealed('')
      return
    }
    try {
      const result = await window.autologin.accounts.reveal(account.id)
      setRevealed(result.password)
    } catch (error) {
      notify('error', error instanceof Error ? error.message : '无法查看密码')
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

  async function copyUsername(): Promise<void> {
    try {
      await window.autologin.accounts.copyUsername(account.id)
      notify('success', '用户名已复制')
    } catch (error) {
      notify('error', error instanceof Error ? error.message : '无法写入剪贴板')
    }
  }

  async function changeAutoSubmit(): Promise<void> {
    try {
      const updated = await window.autologin.sites.save({
        id: account.site.id,
        name: account.site.name,
        startUrl: account.site.startUrl,
        allowedOrigins: account.site.allowedOrigins,
        autoSubmit: !account.site.autoSubmit
      })
      onSiteUpdated(updated)
      notify('success', updated.autoSubmit ? '已开启自动提交' : '已关闭自动提交')
    } catch (error) {
      notify('error', error instanceof Error ? error.message : '更新失败')
    }
  }

  async function deleteAccount(): Promise<void> {
    setBusy(true)
    try {
      await window.autologin.accounts.delete(account.id)
      setConfirmDelete(false)
      onDelete()
      notify('success', '账号已删除')
    } catch (error) {
      notify('error', error instanceof Error ? error.message : '删除失败')
    } finally {
      setBusy(false)
    }
  }

  async function clearSession(): Promise<void> {
    setBusy(true)
    try {
      await onClearSession()
      setConfirmClear(false)
      notify('success', '网站会话已清除')
    } catch (error) {
      notify('error', error instanceof Error ? error.message : '清除会话失败')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <div className="drawer-layer">
        <button className="drawer-backdrop" aria-label="关闭账号详情" onClick={onClose} />
        <aside className="details-drawer" aria-label="账号详情">
          <header className="details-header">
            <div className="details-identity">
              <span className="monogram monogram--large">
                {account.site.name.slice(0, 1).toUpperCase()}
              </span>
              <div>
                <span className="eyebrow">{account.site.name}</span>
                <h2>{account.label}</h2>
                <span className="domain-label">
                  <Globe2 size={13} />
                  {safeHostname(account.site.startUrl)}
                </span>
              </div>
            </div>
            <div className="details-header__actions">
              <button
                className={`icon-button${account.favorite ? ' is-active' : ''}`}
                onClick={() => void onFavorite()}
                aria-label={account.favorite ? '取消收藏' : '收藏账号'}
              >
                <Star size={17} fill={account.favorite ? 'currentColor' : 'none'} />
              </button>
              <button className="icon-button" onClick={onClose} aria-label="关闭">
                <X size={18} />
              </button>
            </div>
          </header>

          <div className="details-scroll">
            <button className="drawer-login-button" onClick={onLogin}>
              <span className="drawer-login-button__icon">
                <ArrowUpRight size={20} />
              </span>
              <span>
                <strong>打开并登录</strong>
                <small>在 Windows 默认浏览器中打开并自动填充</small>
              </span>
              <ArrowUpRight size={18} className="drawer-login-button__arrow" />
            </button>

            <section className="details-section">
              <div className="section-heading">
                <h3>凭据</h3>
                <span>仅保存在本机</span>
              </div>
              <div className="credential-row">
                <span className="credential-row__icon">
                  <UserRound size={17} />
                </span>
                <div>
                  <small>用户名</small>
                  <strong>{account.username}</strong>
                </div>
                <button
                  className="icon-button icon-button--small"
                  onClick={() => void copyUsername()}
                  aria-label="复制用户名"
                >
                  <Copy size={15} />
                </button>
              </div>
              <div className="credential-row">
                <span className="credential-row__icon">
                  <KeyRound size={17} />
                </span>
                <div>
                  <small>密码</small>
                  <strong className={revealed ? 'revealed-password' : 'masked-password'}>
                    {revealed || '••••••••••••'}
                  </strong>
                </div>
                <div className="credential-actions">
                  <button
                    className="icon-button icon-button--small"
                    onClick={() => void revealPassword()}
                    aria-label={revealed ? '隐藏密码' : '查看密码'}
                  >
                    {revealed ? <EyeOff size={15} /> : <Eye size={15} />}
                  </button>
                  <button
                    className="icon-button icon-button--small"
                    onClick={() => void copyPassword()}
                    aria-label="复制密码"
                  >
                    <Copy size={15} />
                  </button>
                </div>
              </div>
            </section>

            <section className="details-section">
              <div className="section-heading">
                <h3>登录行为</h3>
                <span>{account.site.recipe ? '已录制流程' : '通用识别'}</span>
              </div>
              <label className="switch-row switch-row--boxed">
                <span>
                  <strong>自动提交</strong>
                  <small>遇到验证码时始终暂停</small>
                </span>
                <input
                  type="checkbox"
                  checked={account.site.autoSubmit}
                  onChange={() => void changeAutoSubmit()}
                />
                <span className="switch" aria-hidden="true" />
              </label>
              <div className="status-note">
                <span className={account.site.recipe ? 'status-dot is-good' : 'status-dot'} />
                <div>
                  <strong>
                    {account.site.recipe ? '站点已配置录制流程' : '使用通用表单识别'}
                  </strong>
                  <small>
                    {account.site.recipe
                      ? `包含 ${account.site.recipe.steps.length} 个回放步骤`
                      : '可在登录页面选择“重新录制”提升兼容性'}
                  </small>
                </div>
              </div>
            </section>

            <section className="details-section details-meta">
              <div>
                <Clock3 size={15} />
                <span>最近使用</span>
                <strong>{formatLastUsed(account.lastUsedAt)}</strong>
              </div>
              <div>
                <ShieldCheck size={15} />
                <span>会话隔离</span>
                <strong>独立浏览器配置目录</strong>
              </div>
            </section>
          </div>

          <div className="details-footer">
            <div className="details-actions">
              <button className="button button--soft" onClick={onEdit}>
                <Pencil size={16} />
                编辑账号
              </button>
              <button className="button button--ghost" onClick={() => setConfirmClear(true)}>
                <RefreshCw size={16} />
                清除会话
              </button>
            </div>
            <button className="danger-link" onClick={() => setConfirmDelete(true)}>
              <Trash2 size={15} />
              删除此账号
            </button>
          </div>
        </aside>
      </div>
      {confirmDelete && (
        <ConfirmDialog
          title="删除这个账号？"
          description="账号凭据、录制流程和独立网站会话都会从本机移除，此操作无法撤销。"
          confirmLabel="删除账号"
          danger
          busy={busy}
          onConfirm={() => void deleteAccount()}
          onClose={() => setConfirmDelete(false)}
        />
      )}
      {confirmClear && (
        <ConfirmDialog
          title="清除网站会话？"
          description="下次打开此账号时需要重新登录，账号密码不会受到影响。"
          confirmLabel="清除会话"
          busy={busy}
          onConfirm={() => void clearSession()}
          onClose={() => setConfirmClear(false)}
        />
      )}
    </>
  )
}

function safeHostname(value: string): string {
  try {
    return new URL(value).hostname
  } catch {
    return value
  }
}

function formatLastUsed(value?: string): string {
  if (!value) {
    return '尚未使用'
  }
  const date = new Date(value)
  const now = new Date()
  const sameDay = date.toDateString() === now.toDateString()
  return new Intl.DateTimeFormat('zh-CN', {
    ...(sameDay ? {} : { month: 'short', day: 'numeric' }),
    hour: '2-digit',
    minute: '2-digit'
  }).format(date)
}
