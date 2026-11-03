import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowRight,
  Check,
  ChevronDown,
  Eye,
  EyeOff,
  Globe2,
  KeyRound,
  Layers3,
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
  const [siteGroup, setSiteGroup] = useState(initialSite?.group ?? '')
  const [sitePickerOpen, setSitePickerOpen] = useState(false)
  const [label, setLabel] = useState(account?.label ?? '')
  const [username, setUsername] = useState(account?.username ?? '')
  const [password, setPassword] = useState('')
  const [favorite, setFavorite] = useState(account?.favorite ?? false)
  const [showPassword, setShowPassword] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const sitePickerRef = useRef<HTMLDivElement>(null)

  const selectedSite = useMemo(
    () => sites.find((site) => site.id === selectedSiteId),
    [selectedSiteId, sites]
  )

  useEffect(() => {
    if (!sitePickerOpen) {
      return
    }
    const closeOnPointerDown = (event: PointerEvent): void => {
      if (!sitePickerRef.current?.contains(event.target as Node)) {
        setSitePickerOpen(false)
      }
    }
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        setSitePickerOpen(false)
      }
    }
    document.addEventListener('pointerdown', closeOnPointerDown)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('pointerdown', closeOnPointerDown)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [sitePickerOpen])

  function chooseExisting(): void {
    setSiteMode('existing')
    const site = sites[0]
    if (site) {
      setSelectedSiteId(site.id)
      setAutoSubmit(site.autoSubmit)
      setSiteGroup(site.group ?? '')
    }
  }

  function chooseNew(): void {
    setSiteMode('new')
    setAutoSubmit(true)
    setSiteGroup('')
  }

  function handleSiteChange(siteId: string): void {
    setSelectedSiteId(siteId)
    const site = sites.find((entry) => entry.id === siteId)
    if (site) {
      setAutoSubmit(site.autoSubmit)
      setSiteGroup(site.group ?? '')
      setSitePickerOpen(false)
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
          autoSubmit,
          group: siteGroup.trim() || undefined
        })
      } else {
        if (!selectedSite) {
          throw new Error('请选择站点')
        }
        const groupChanged = (selectedSite.group ?? '') !== siteGroup.trim()
        site =
          selectedSite.autoSubmit === autoSubmit && !groupChanged
            ? selectedSite
            : await window.autologin.sites.save({
                id: selectedSite.id,
                name: selectedSite.name,
                startUrl: selectedSite.startUrl,
                allowedOrigins: selectedSite.allowedOrigins,
                autoSubmit,
                group: siteGroup.trim() || undefined
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
                <div className="site-picker" ref={sitePickerRef}>
                  <button
                    type="button"
                    className={`site-picker__trigger${sitePickerOpen ? ' is-open' : ''}`}
                    onClick={() => setSitePickerOpen((open) => !open)}
                    disabled={Boolean(account)}
                    aria-haspopup="listbox"
                    aria-expanded={sitePickerOpen}
                  >
                    <Globe2 size={17} />
                    <span>
                      <strong>{selectedSite?.name ?? '选择站点'}</strong>
                      <small>
                        {selectedSite ? safeHostname(selectedSite.startUrl) : '请选择已有站点'}
                      </small>
                    </span>
                    <ChevronDown size={16} className={sitePickerOpen ? 'is-open' : ''} />
                  </button>
                  {sitePickerOpen && !account && (
                    <div className="site-picker__menu" role="listbox" aria-label="选择站点">
                      {sites.map((site) => (
                        <button
                          key={site.id}
                          type="button"
                          role="option"
                          aria-selected={site.id === selectedSiteId}
                          className={site.id === selectedSiteId ? 'is-selected' : ''}
                          onClick={() => handleSiteChange(site.id)}
                        >
                          <span className="monogram monogram--small">
                            {site.name.slice(0, 1).toUpperCase()}
                          </span>
                          <span>
                            <strong>{site.name}</strong>
                            <small>
                              {site.group?.trim() || '未分组'} · {safeHostname(site.startUrl)}
                            </small>
                          </span>
                          {site.id === selectedSiteId && <Check size={15} />}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
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

          <label className="field">
            <span className="field__label">站点分组（可选）</span>
            <span className="input-shell">
              <Layers3 size={17} />
              <input
                value={siteGroup}
                onChange={(event) => setSiteGroup(event.target.value)}
                placeholder="例如：工作、财务、个人"
                maxLength={40}
              />
            </span>
          </label>

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
