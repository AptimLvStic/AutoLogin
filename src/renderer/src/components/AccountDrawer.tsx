import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowRight,
  Check,
  ChevronDown,
  CirclePlay,
  Copy,
  Eye,
  EyeOff,
  Globe2,
  KeyRound,
  Layers3,
  LoaderCircle,
  RefreshCw,
  Star,
  Trash2,
  UserRound,
  X
} from 'lucide-react'
import type { AccountWithSite, Site } from '@shared/types'
import { useI18n } from '../i18n'
import { ConfirmDialog } from './Modal'

interface AccountDrawerProps {
  mode: 'create' | 'edit'
  account?: AccountWithSite
  sites: Site[]
  initialSiteId?: string
  onClose: () => void
  onSaved: (account: AccountWithSite, message: string) => void
  onDeleted: () => void
  onRecord?: () => void
  notify: (kind: 'success' | 'error' | 'info', message: string) => void
}

export function AccountDrawer({
  mode,
  account,
  sites,
  initialSiteId,
  onClose,
  onSaved,
  onDeleted,
  onRecord,
  notify
}: AccountDrawerProps): React.JSX.Element {
  const { tr } = useI18n()
  const initialSite = sites.find((site) => site.id === (initialSiteId ?? account?.siteId))
  const [siteMode, setSiteMode] = useState<'existing' | 'new'>(
    account || initialSite || sites.length > 0 ? 'existing' : 'new'
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
  const [revealedPassword, setRevealedPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [destructiveBusy, setDestructiveBusy] = useState(false)
  const [error, setError] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [confirmClear, setConfirmClear] = useState(false)
  const sitePickerRef = useRef<HTMLDivElement>(null)
  const revealTimer = useRef<number | null>(null)

  const selectedSite = useMemo(
    () => sites.find((site) => site.id === selectedSiteId),
    [selectedSiteId, sites]
  )

  useEffect(() => {
    if (!sitePickerOpen) return
    const closeOnPointerDown = (event: PointerEvent): void => {
      if (!sitePickerRef.current?.contains(event.target as Node)) {
        setSitePickerOpen(false)
      }
    }
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setSitePickerOpen(false)
    }
    document.addEventListener('pointerdown', closeOnPointerDown)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('pointerdown', closeOnPointerDown)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [sitePickerOpen])

  useEffect(() => {
    return () => {
      if (revealTimer.current) window.clearTimeout(revealTimer.current)
    }
  }, [])

  function hideRevealedPassword(): void {
    if (revealTimer.current) {
      window.clearTimeout(revealTimer.current)
      revealTimer.current = null
    }
    setRevealedPassword('')
  }

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
    if (siteName.trim() || !startUrl.startsWith('http')) return
    try {
      const hostname = new URL(startUrl).hostname.replace(/^www\./, '')
      const base = hostname.split('.')[0]
      if (base) setSiteName(base.charAt(0).toUpperCase() + base.slice(1))
    } catch {
      // URL validation is shown by the form error.
    }
  }

  async function submit(event: React.FormEvent): Promise<void> {
    event.preventDefault()
    setError('')
    if (!label.trim() || !username.trim()) {
      setError(tr('请填写账号名称和用户名', 'Enter an account name and username.', '請填寫帳號名稱和使用者名稱'))
      return
    }
    if (mode === 'create' && !password) {
      setError(tr('请填写登录密码', 'Enter the login password.', '請填寫登入密碼'))
      return
    }
    if (siteMode === 'new' && (!siteName.trim() || !/^https?:\/\//.test(startUrl))) {
      setError(tr('请填写有效的站点名称和登录地址', 'Enter a valid site name and sign-in URL.', '請填寫有效的站點名稱和登入網址'))
      return
    }
    if (siteMode === 'existing' && !selectedSite) {
      setError(tr('请选择站点', 'Select a site.', '請選擇站點'))
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
        if (!selectedSite) throw new Error(tr('请选择站点', 'Select a site.', '請選擇站點'))
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
        onSaved(saved, tr('账号信息已更新', 'Account updated.', '帳號資料已更新'))
      } else {
        saved = await window.autologin.accounts.create({
          siteId: site.id,
          label: label.trim(),
          username: username.trim(),
          password,
          favorite
        })
        onSaved(saved, tr('账号已加入保险库', 'Account added to the vault.', '帳號已加入保險庫'))
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : tr('保存失败', 'Could not save.', '儲存失敗'))
    } finally {
      setBusy(false)
    }
  }

  async function revealPassword(): Promise<void> {
    if (!account) return
    if (revealedPassword) {
      hideRevealedPassword()
      return
    }
    try {
      const result = await window.autologin.accounts.reveal(account.id)
      setRevealedPassword(result.password)
      revealTimer.current = window.setTimeout(
        hideRevealedPassword,
        Math.max(500, result.expiresAt - Date.now())
      )
    } catch (reason) {
      notify('error', reason instanceof Error ? reason.message : tr('无法查看密码', 'Could not reveal password.', '無法查看密碼'))
    }
  }

  async function copyUsername(): Promise<void> {
    if (!account) return
    try {
      await window.autologin.accounts.copyUsername(account.id)
      notify('success', tr('用户名已复制', 'Username copied.', '使用者名稱已複製'))
    } catch (reason) {
      notify('error', reason instanceof Error ? reason.message : tr('复制失败', 'Copy failed.', '複製失敗'))
    }
  }

  async function copyPassword(): Promise<void> {
    if (!account) return
    try {
      await window.autologin.accounts.copy(account.id)
      notify('success', tr('密码已复制，30 秒后自动清除', 'Password copied and will clear in 30 seconds.', '密碼已複製，30 秒後自動清除'))
    } catch (reason) {
      notify('error', reason instanceof Error ? reason.message : tr('复制失败', 'Copy failed.', '複製失敗'))
    }
  }

  async function clearSession(): Promise<void> {
    if (!account) return
    setDestructiveBusy(true)
    try {
      await window.autologin.login.clearSession(account.id)
      setConfirmClear(false)
      notify('success', tr('网站会话已清除', 'Website session cleared.', '網站工作階段已清除'))
    } catch (reason) {
      notify('error', reason instanceof Error ? reason.message : tr('清除会话失败', 'Could not clear session.', '清除工作階段失敗'))
    } finally {
      setDestructiveBusy(false)
    }
  }

  async function deleteAccount(): Promise<void> {
    if (!account) return
    setDestructiveBusy(true)
    try {
      await window.autologin.accounts.delete(account.id)
      setConfirmDelete(false)
      onDeleted()
    } catch (reason) {
      notify('error', reason instanceof Error ? reason.message : tr('删除失败', 'Delete failed.', '刪除失敗'))
    } finally {
      setDestructiveBusy(false)
    }
  }

  return (
    <>
      <div className="drawer-layer account-drawer-layer">
        <button
          className="drawer-backdrop"
          aria-label={tr('关闭账号面板', 'Close account panel', '關閉帳號面板')}
          onClick={onClose}
        />
        <aside
          className="details-drawer account-drawer"
          role="dialog"
          aria-modal="true"
          aria-labelledby="account-drawer-title"
        >
          <header className="details-header account-drawer__header">
            <div className="details-identity">
              <span className={`monogram ${account ? toneClass(account.siteId) : ''}`}>
                {(selectedSite?.name ?? account?.site.name ?? '?').slice(0, 1).toUpperCase()}
              </span>
              <div>
                <span className="eyebrow">
                  {mode === 'edit' ? 'ACCOUNT DETAILS' : 'NEW CREDENTIAL'}
                </span>
                <h2 id="account-drawer-title">
                  {mode === 'edit'
                    ? account?.label
                    : tr('添加登录账号', 'Add account', '新增登入帳號')}
                </h2>
                <span className="domain-label">
                  <Globe2 size={12} />
                  {selectedSite ? safeHostname(selectedSite.startUrl) : tr('选择站点后开始', 'Choose a site to begin', '選擇站點後開始')}
                </span>
              </div>
            </div>
            <button
              className="icon-button icon-button--small"
              onClick={onClose}
              aria-label={tr('关闭', 'Close', '關閉')}
            >
              <X size={17} />
            </button>
          </header>


          <form className="account-form account-drawer__form" onSubmit={submit}>
            {!account && (
              <div className="segmented-control" aria-label={tr('站点来源', 'Site source', '站點來源')}>
                <button
                  type="button"
                  className={siteMode === 'existing' ? 'is-active' : ''}
                  onClick={chooseExisting}
                  disabled={sites.length === 0}
                >
                  {tr('已有站点', 'Existing site', '現有站點')}
                </button>
                <button
                  type="button"
                  className={siteMode === 'new' ? 'is-active' : ''}
                  onClick={chooseNew}
                >
                  {tr('新站点', 'New site', '新站點')}
                </button>
              </div>
            )}

            <div className="account-form__grid">
              {siteMode === 'existing' ? (
                account ? (
                  <div className="account-site-summary account-form__span-2">
                    <span className="monogram monogram--small">
                      {selectedSite?.name.slice(0, 1).toUpperCase() ?? '?'}
                    </span>
                    <span>
                      <strong>{selectedSite?.name ?? tr('站点信息不可用', 'Site unavailable', '站點資料不可用')}</strong>
                      <small>
                        {selectedSite ? safeHostname(selectedSite.startUrl) : tr('请重新选择站点', 'Choose the site again', '請重新選擇站點')}
                      </small>
                    </span>
                    <em>{tr('固定站点', 'Fixed site', '固定站點')}</em>
                  </div>
                ) : (
                  <label className="field account-form__span-2">
                    <span className="field__label">{tr('选择站点', 'Select site', '選擇站點')}</span>
                    <div className="site-picker" ref={sitePickerRef}>
                      <button
                        type="button"
                        className={`site-picker__trigger${sitePickerOpen ? ' is-open' : ''}`}
                        onClick={() => setSitePickerOpen((open) => !open)}
                        aria-haspopup="listbox"
                        aria-expanded={sitePickerOpen}
                      >
                        <Globe2 size={17} />
                        <span>
                          <strong>{selectedSite?.name ?? tr('选择站点', 'Select site', '選擇站點')}</strong>
                          <small>
                            {selectedSite
                              ? safeHostname(selectedSite.startUrl)
                              : tr('请选择已有站点', 'Choose an existing site', '請選擇現有站點')}
                          </small>
                        </span>
                        <ChevronDown size={16} className={sitePickerOpen ? 'is-open' : ''} />
                      </button>
                      {sitePickerOpen && (
                        <div className="site-picker__menu" role="listbox" aria-label={tr('选择站点', 'Select site', '選擇站點')}>
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
                                  {displayGroup(site.group, tr)} · {safeHostname(site.startUrl)}
                                </small>
                              </span>
                              {site.id === selectedSiteId && <Check size={15} />}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </label>
                )
              ) : (
                <>
                  <label className="field">
                    <span className="field__label">{tr('站点名称', 'Site name', '站點名稱')}</span>
                    <span className="input-shell">
                      <Globe2 size={17} />
                      <input
                        value={siteName}
                        onChange={(event) => setSiteName(event.target.value)}
                        placeholder={tr('例如：工作台', 'e.g. Workspace', '例如：工作台')}
                        autoFocus
                      />
                    </span>
                  </label>
                  <label className="field">
                    <span className="field__label">{tr('登录地址', 'Sign-in URL', '登入網址')}</span>
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
                </>
              )}

              <label className="field">
                <span className="field__label">{tr('站点分组（可选）', 'Site group (optional)', '站點分組（選填）')}</span>
                <span className="input-shell">
                  <Layers3 size={17} />
                  <input
                    value={siteGroup}
                    onChange={(event) => setSiteGroup(event.target.value)}
                    placeholder={tr('例如：工作、财务、个人', 'e.g. Work, Finance, Personal', '例如：工作、財務、個人')}
                    maxLength={40}
                  />
                </span>
              </label>

              <label className="field">
                <span className="field__label">{tr('账号名称', 'Account name', '帳號名稱')}</span>
                <span className="input-shell">
                  <Star size={17} />
                  <input
                    value={label}
                    onChange={(event) => setLabel(event.target.value)}
                    placeholder={tr('例如：主账号', 'e.g. Primary account', '例如：主帳號')}
                    autoFocus={Boolean(account)}
                  />
                </span>
              </label>

              <label className="field">
                <span className="field__label">{tr('用户名', 'Username', '使用者名稱')}</span>
                <span className="input-shell">
                  <UserRound size={17} />
                  <input
                    value={username}
                    onChange={(event) => setUsername(event.target.value)}
                    placeholder={tr('邮箱或账号', 'Email or username', '電子郵件或帳號')}
                    autoComplete="off"
                  />
                  {account && (
                    <button
                      type="button"
                      className="input-action"
                      onClick={() => void copyUsername()}
                      aria-label={tr('复制用户名', 'Copy username', '複製使用者名稱')}
                    >
                      <Copy size={15} />
                    </button>
                  )}
                </span>
              </label>

              <label className="field">
                <span className="field__label">
                  {tr('登录密码', 'Login password', '登入密碼')}
                  {mode === 'edit' && (
                    <small>{tr('留空则保持不变', 'Leave blank to keep current', '留空則保持不變')}</small>
                  )}
                </span>
                <span className="input-shell">
                  <KeyRound size={17} />
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    placeholder={
                      mode === 'edit'
                        ? tr('输入新密码以替换', 'Enter a new password to replace', '輸入新密碼以取代')
                        : tr('输入登录密码', 'Enter login password', '輸入登入密碼')
                    }
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

              <div className="form-options account-form__span-2">
                <label className="switch-row">
                  <span>
                    <strong>{tr('自动提交', 'Auto submit', '自動提交')}</strong>
                    <small>{tr('检测到验证码时会自动暂停', 'Pauses when a challenge is detected', '偵測到驗證碼時會自動暫停')}</small>
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
                    <strong>{tr('加入收藏', 'Add to favorites', '加入收藏')}</strong>
                    <small>{tr('在收藏页快速访问', 'Quick access from Favorites', '在收藏頁快速存取')}</small>
                  </span>
                  <input
                    type="checkbox"
                    checked={favorite}
                    onChange={(event) => setFavorite(event.target.checked)}
                  />
                  <span className="switch" aria-hidden="true" />
                </label>
              </div>
            </div>

            {account && (
              <div className="drawer-saved-password">
                <span>
                  <KeyRound size={14} />
                  {tr('已保存密码', 'Saved password', '已儲存密碼')}
                </span>
                <strong className={revealedPassword ? 'revealed-password' : 'masked-password'}>
                  {revealedPassword || '••••••••••••'}
                </strong>
                <button
                  type="button"
                  className="icon-button icon-button--small"
                  onClick={() => void revealPassword()}
                  aria-label={revealedPassword ? tr('隐藏密码', 'Hide password', '隱藏密碼') : tr('查看密码', 'Reveal password', '查看密碼')}
                >
                  {revealedPassword ? <EyeOff size={15} /> : <Eye size={15} />}
                </button>
                <button
                  type="button"
                  className="icon-button icon-button--small"
                  onClick={() => void copyPassword()}
                  aria-label={tr('复制密码', 'Copy password', '複製密碼')}
                >
                  <Copy size={15} />
                </button>
              </div>
            )}

            {error && <p className="form-error">{error}</p>}

            {account && (
              <div className="account-drawer__management">
                {onRecord && (
                  <button type="button" className="text-button" onClick={onRecord}>
                    <CirclePlay size={14} />
                    {account.site.recipe
                      ? tr('重新录制登录流程', 'Record flow again', '重新錄製登入流程')
                      : tr('录制登录流程', 'Record sign-in flow', '錄製登入流程')}
                  </button>
                )}
                <button type="button" className="text-button" onClick={() => setConfirmClear(true)}>
                  <RefreshCw size={14} />
                  {tr('清除会话', 'Clear session', '清除工作階段')}
                </button>
                <button type="button" className="text-button text-button--danger" onClick={() => setConfirmDelete(true)}>
                  <Trash2 size={14} />
                  {tr('删除账号', 'Delete account', '刪除帳號')}
                </button>
              </div>
            )}

            <div className="modal-actions account-drawer__actions">
              <button type="button" className="button button--ghost" onClick={onClose}>
                {tr('取消', 'Cancel', '取消')}
              </button>
              <button type="submit" className="button button--primary" disabled={busy}>
                {busy
                  ? tr('正在保存…', 'Saving…', '正在儲存…')
                  : mode === 'edit'
                    ? tr('保存修改', 'Save changes', '儲存變更')
                    : tr('添加账号', 'Add account', '新增帳號')}
                {!busy && <ArrowRight size={16} />}
              </button>
            </div>
          </form>
        </aside>
      </div>

      {confirmDelete && (
        <ConfirmDialog
          title={tr('删除这个账号？', 'Delete this account?', '刪除這個帳號？')}
          description={tr(
            '账号凭据、录制流程和独立网站会话都会从本机移除，此操作无法撤销。',
            'Credentials, recorded flows and the website session will be removed from this device. This cannot be undone.',
            '帳號憑證、錄製流程和獨立網站工作階段都會從本機移除，此操作無法復原。'
          )}
          confirmLabel={tr('删除账号', 'Delete account', '刪除帳號')}
          danger
          busy={destructiveBusy}
          onConfirm={() => void deleteAccount()}
          onClose={() => setConfirmDelete(false)}
        />
      )}
      {confirmClear && (
        <ConfirmDialog
          title={tr('清除网站会话？', 'Clear website session?', '清除網站工作階段？')}
          description={tr(
            '下次打开此账号时需要重新登录，账号密码不会受到影响。',
            'You will need to sign in again next time. Saved credentials are not affected.',
            '下次開啟此帳號時需要重新登入，帳號密碼不會受到影響。'
          )}
          confirmLabel={tr('清除会话', 'Clear session', '清除工作階段')}
          busy={destructiveBusy}
          onConfirm={() => void clearSession()}
          onClose={() => setConfirmClear(false)}
        />
      )}
    </>
  )
}

function safeHostname(value: string): string {
  try {
    return new URL(value).hostname.replace(/^www\./, '')
  } catch {
    return value
  }
}

function displayGroup(
  value: string | undefined,
  tr: (zhCN: string, en: string, zhTW: string) => string
): string {
  return value?.trim() || tr('未分组', 'Ungrouped', '未分組')
}

function toneClass(id: string): string {
  let hash = 0
  for (const char of id) hash = (hash * 31 + char.charCodeAt(0)) >>> 0
  return `monogram--tone-${hash % 4}`
}