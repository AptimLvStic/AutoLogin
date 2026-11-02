import { useMemo, useState } from 'react'
import {
  ArrowRight,
  Check,
  Eye,
  EyeOff,
  Globe2,
  KeyRound,
  Star,
  UserRound
} from 'lucide-react'
import type { AccountWithSite, Site } from '@shared/types'
import { Modal } from './Modal'

interface AccountFormProps {
  mode: 'create' | 'edit'
  account?: AccountWithSite
  sites: Site[]
  initialSiteId?: string
  onClose: () => void
  onSaved: (account: AccountWithSite, message: string) => void
}

export function AccountForm({
  mode,
  account,
  sites,
  initialSiteId,
  onClose,
  onSaved
}: AccountFormProps): React.JSX.Element {
  const initialSite = sites.find((site) => site.id === (initialSiteId ?? account?.siteId))
  const [siteMode, setSiteMode] = useState<'existing' | 'new'>(
    account || initialSite ? 'existing' : 'new'
  )
  const [selectedSiteId, setSelectedSiteId] = useState(initialSite?.id ?? sites[0]?.id ?? '')
  const [siteName, setSiteName] = useState('')
  const [startUrl, setStartUrl] = useState('https://')
  const [autoSubmit, setAutoSubmit] = useState(initialSite?.autoSubmit ?? true)
  const [label, setLabel] = useState(account?.label ?? '')
  const [username, setUsername] = useState(account?.username ?? '')
  const [password, setPassword] = useState('')
  const [favorite, setFavorite] = useState(account?.favorite ?? false)
  const [showPassword, setShowPassword] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const selectedSite = useMemo(
    () => sites.find((site) => site.id === selectedSiteId),
    [selectedSiteId, sites]
  )

  function chooseExisting(): void {
    setSiteMode('existing')
    const site = sites[0]
    if (site) {
      setSelectedSiteId(site.id)
      setAutoSubmit(site.autoSubmit)
    }
  }

  function chooseNew(): void {
    setSiteMode('new')
    setAutoSubmit(true)
  }

  function handleSiteChange(siteId: string): void {
    setSelectedSiteId(siteId)
    const site = sites.find((entry) => entry.id === siteId)
    if (site) {
      setAutoSubmit(site.autoSubmit)
    }
  }

  function deriveSiteName(): void {
    if (siteName.trim() || !startUrl.startsWith('http')) {
      return
    }
    try {
      const hostname = new URL(startUrl).hostname.replace(/^www\./, '')
      const base = hostname.split('.')[0]
      if (base) {
        setSiteName(base.charAt(0).toUpperCase() + base.slice(1))
      }
    } catch {
      // The URL validation message will handle malformed values.
    }
  }

  async function submit(event: React.FormEvent): Promise<void> {
    event.preventDefault()
    setError('')
    if (!label.trim() || !username.trim()) {
      setError('请填写账号名称和用户名')
      return
    }
    if (mode === 'create' && !password) {
      setError('请填写登录密码')
      return
    }
    if (siteMode === 'new' && (!siteName.trim() || !/^https?:\/\//.test(startUrl))) {
      setError('请填写有效的站点名称和登录地址')
      return
    }
    if (siteMode === 'existing' && !selectedSite) {
      setError('请选择站点')
      return
    }

    setBusy(true)
    try {
      let site: Site
      if (siteMode === 'new') {
        site = await window.autologin.sites.save({
          name: siteName.trim(),
          startUrl: startUrl.trim(),
          autoSubmit
        })
      } else {
        if (!selectedSite) {
          throw new Error('请选择站点')
        }
        site =
          selectedSite.autoSubmit === autoSubmit
            ? selectedSite
            : await window.autologin.sites.save({
                id: selectedSite.id,
                name: selectedSite.name,
                startUrl: selectedSite.startUrl,
                allowedOrigins: selectedSite.allowedOrigins,
                autoSubmit
              })
      }

      let saved: AccountWithSite
      if (mode === 'edit' && account) {
        saved = await window.autologin.accounts.update(account.id, {
          label: label.trim(),
          username: username.trim(),
          favorite,
          ...(password ? { password } : {})
        })
        onSaved(saved, '账号信息已更新')
      } else {
        saved = await window.autologin.accounts.create({
          siteId: site.id,
          label: label.trim(),
          username: username.trim(),
          password,
          favorite
        })
        onSaved(saved, '账号已加入保险库')
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '保存失败')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      title={mode === 'edit' ? '编辑账号' : '添加登录账号'}
      eyebrow={mode === 'edit' ? 'ACCOUNT DETAILS' : 'NEW CREDENTIAL'}
      onClose={onClose}
      width="760px"
      className="account-form-modal"
    >
      <div className="form-sheet">
        <aside className="form-sheet__aside">
          <div className="form-index">{mode === 'edit' ? '02' : '01'}</div>
          <h3>{mode === 'edit' ? '保持入口清晰' : '从一个站点开始'}</h3>
          <p>
            {mode === 'edit'
              ? '修改名称或凭据不会影响已保存的网站会话。'
              : 'AutoLogin 会为每个账号创建独立浏览器会话，互不干扰。'}
          </p>
          <div className="form-aside-note">
            <Check size={15} />
            <span>密码只保存在本地加密保险库</span>
          </div>
        </aside>
        <form className="form-sheet__form" onSubmit={submit}>
          {!account && (
            <div className="segmented-control" aria-label="站点来源">
              <button
                type="button"
                className={siteMode === 'existing' ? 'is-active' : ''}
                onClick={chooseExisting}
                disabled={sites.length === 0}
              >
                已有站点
              </button>
              <button
                type="button"
                className={siteMode === 'new' ? 'is-active' : ''}
                onClick={chooseNew}
              >
                新站点
              </button>
            </div>
          )}

          {siteMode === 'existing' ? (
            <div className="field-row field-row--single">
              <label className="field">
                <span className="field__label">选择站点</span>
                <span className="select-shell">
                  <Globe2 size={17} />
                  <select
                    value={selectedSiteId}
                    onChange={(event) => handleSiteChange(event.target.value)}
                    disabled={Boolean(account)}
                  >
                    {sites.map((site) => (
                      <option key={site.id} value={site.id}>
                        {site.name}
                      </option>
                    ))}
                  </select>
                </span>
              </label>
              {selectedSite && (
                <div className="site-preview">
                  <span className="monogram monogram--small">
                    {selectedSite.name.slice(0, 1).toUpperCase()}
                  </span>
                  <div>
                    <strong>{selectedSite.name}</strong>
                    <span>{safeHostname(selectedSite.startUrl)}</span>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="field-row">
              <label className="field">
                <span className="field__label">站点名称</span>
                <span className="input-shell">
                  <Globe2 size={17} />
                  <input
                    value={siteName}
                    onChange={(event) => setSiteName(event.target.value)}
                    placeholder="例如：工作台"
                    autoFocus
                  />
                </span>
              </label>
              <label className="field">
                <span className="field__label">登录地址</span>
                <span className="input-shell">
                  <span className="protocol-mark">URL</span>
                  <input
                    value={startUrl}
                    onChange={(event) => setStartUrl(event.target.value)}
                    onBlur={deriveSiteName}
                    placeholder="https://example.com/login"
                    spellCheck={false}
                  />
                </span>
              </label>
            </div>
          )}

          <div className="field-row">
            <label className="field">
              <span className="field__label">账号名称</span>
              <span className="input-shell">
                <Star size={17} />
                <input
                  value={label}
                  onChange={(event) => setLabel(event.target.value)}
                  placeholder="例如：主账号"
                  autoFocus={Boolean(account)}
                />
              </span>
            </label>
            <label className="field">
              <span className="field__label">用户名</span>
              <span className="input-shell">
                <UserRound size={17} />
                <input
                  value={username}
                  onChange={(event) => setUsername(event.target.value)}
                  placeholder="邮箱或账号"
                  autoComplete="off"
                />
              </span>
            </label>
          </div>

          <label className="field">
            <span className="field__label">
              登录密码
              {mode === 'edit' && <small>留空则保持不变</small>}
            </span>
            <span className="input-shell">
              <KeyRound size={17} />
              <input
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder={mode === 'edit' ? '输入新密码以替换' : '输入登录密码'}
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

          <div className="form-options">
            <label className="switch-row">
              <span>
                <strong>自动提交</strong>
                <small>检测到验证码时会自动暂停</small>
              </span>
              <input
                type="checkbox"
                checked={autoSubmit}
                onChange={(event) => setAutoSubmit(event.target.checked)}
              />
              <span className="switch" aria-hidden="true" />
            </label>
            <label className="switch-row">
              <span>
                <strong>加入收藏</strong>
                <small>在侧栏快速访问</small>
              </span>
              <input
                type="checkbox"
                checked={favorite}
                onChange={(event) => setFavorite(event.target.checked)}
              />
              <span className="switch" aria-hidden="true" />
            </label>
          </div>

          {error && <p className="form-error">{error}</p>}
          <div className="modal-actions">
            <button type="button" className="button button--ghost" onClick={onClose}>
              取消
            </button>
            <button type="submit" className="button button--primary" disabled={busy}>
              {busy ? '正在保存…' : mode === 'edit' ? '保存修改' : '添加账号'}
              {!busy && <ArrowRight size={16} />}
            </button>
          </div>
        </form>
      </div>
    </Modal>
  )
}

function safeHostname(value: string): string {
  try {
    return new URL(value).hostname
  } catch {
    return value
  }
}
