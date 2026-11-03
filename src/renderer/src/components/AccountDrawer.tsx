import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowRight,
  Check,
  CirclePlay,
  Copy,
  Eye,
  EyeOff,
  Globe2,
  KeyRound,
  Layers3,
  ListChecks,
  LoaderCircle,
  RefreshCw,
  SlidersHorizontal,
  Star,
  Trash2,
  UserRound,
  X
} from 'lucide-react'
import type {
  AccountRecipe,
  AccountWithSite,
  LoginStrategy,
  ManualLoginSelectors,
  SelectorTestField,
  SelectorTestResult,
  Site
} from '@shared/types'
import { useI18n } from '../i18n'
import { ConfirmDialog, Modal } from './Modal'

interface AccountDrawerProps {
  mode: 'create' | 'edit'
  account?: AccountWithSite
  sites: Site[]
  initialSiteId?: string
  onClose: () => void
  onSaved: (account: AccountWithSite, message: string) => void
  onDeleted: () => void
  onRecord?: () => void
  onChanged: () => Promise<void>
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
  onChanged,
  notify
}: AccountDrawerProps): React.JSX.Element {
  const { tr } = useI18n()
  const initialSite = sites.find((site) => site.id === (initialSiteId ?? account?.siteId))
  const [siteMode, setSiteMode] = useState<'existing' | 'new'>(
    account || initialSite || sites.length > 0 ? 'existing' : 'new'
  )
  const [selectedSiteId, setSelectedSiteId] = useState(initialSite?.id ?? sites[0]?.id ?? '')
  const [siteName, setSiteName] = useState(
    account?.site.name ?? initialSite?.name ?? ''
  )
  const [startUrl, setStartUrl] = useState(
    account?.site.startUrl ?? initialSite?.startUrl ?? 'https://'
  )
  const [autoSubmit, setAutoSubmit] = useState(initialSite?.autoSubmit ?? true)
  const [siteGroup, setSiteGroup] = useState(initialSite?.group ?? '')
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
  const [recipes, setRecipes] = useState<AccountRecipe[]>(account?.recipes ?? [])
  const [activeRecipeId, setActiveRecipeId] = useState(account?.activeRecipeId)
  const [loginStrategy, setLoginStrategy] = useState<LoginStrategy>(
    account?.loginStrategy ?? 'auto'
  )
  const [manualSelectors, setManualSelectors] = useState<ManualLoginSelectors>(
    account?.manualSelectors ?? {}
  )
  const [selectorTests, setSelectorTests] = useState<
    Partial<Record<SelectorTestField, SelectorTestResult>>
  >({})
  const [selectorTesting, setSelectorTesting] = useState<SelectorTestField | null>(null)
  const [recipeDetails, setRecipeDetails] = useState<AccountRecipe | null>(null)
  const [confirmRecipeDelete, setConfirmRecipeDelete] = useState<AccountRecipe | null>(null)
  const [recipeBusy, setRecipeBusy] = useState(false)
  const revealTimer = useRef<number | null>(null)

  const selectedSite = useMemo(
    () => sites.find((site) => site.id === selectedSiteId),
    [selectedSiteId, sites]
  )

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
      setSiteName(site.name)
      setStartUrl(site.startUrl)
      setAutoSubmit(site.autoSubmit)
      setSiteGroup(site.group ?? '')
    }
  }

  function chooseNew(): void {
    setSiteMode('new')
    setSiteName('')
    setStartUrl('https://')
    setAutoSubmit(true)
    setSiteGroup('')
  }

  function handleSiteChange(siteId: string): void {
    setSelectedSiteId(siteId)
    const site = sites.find((entry) => entry.id === siteId)
    if (site) {
      setSiteName(site.name)
      setStartUrl(site.startUrl)
      setAutoSubmit(site.autoSubmit)
      setSiteGroup(site.group ?? '')
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
    if (!siteName.trim() || !username.trim()) {
      setError(tr('请填写站点名称和用户名', 'Enter a site name and username.', '請填寫站點名稱和使用者名稱'))
      return
    }
    if (mode === 'create' && !password) {
      setError(tr('请填写登录密码', 'Enter the login password.', '請填寫登入密碼'))
      return
    }
    if (!siteName.trim() || !/^https?:\/\//.test(startUrl)) {
      setError(tr('请填写有效的站点名称和登录地址', 'Enter a valid site name and sign-in URL.', '請填寫有效的站點名稱和登入網址'))
      return
    }
    if (siteMode === 'existing' && !selectedSite) {
      setError(tr('请选择站点', 'Select a site.', '請選擇站點'))
      return
    }
    if (
      mode === 'edit' &&
      loginStrategy === 'manual' &&
      (!manualSelectors.username?.trim() || !manualSelectors.password?.trim())
    ) {
      setError(
        tr(
          '手动配置需要填写用户名和密码定位器',
          'Enter username and password selectors for manual configuration.',
          '手動設定需要填寫使用者名稱和密碼定位器'
        )
      )
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
        const siteChanged =
          selectedSite.name !== siteName.trim() ||
          selectedSite.startUrl !== startUrl.trim() ||
          selectedSite.autoSubmit !== autoSubmit ||
          groupChanged
        site =
          !siteChanged
            ? selectedSite
            : await window.autologin.sites.save({
                id: selectedSite.id,
                name: siteName.trim(),
                startUrl: startUrl.trim(),
                allowedOrigins: selectedSite.allowedOrigins,
                autoSubmit,
                group: siteGroup.trim() || undefined
              })
      }

      let saved: AccountWithSite
      if (mode === 'edit' && account) {
        saved = await window.autologin.accounts.update(account.id, {
          label: site.name,
          username: username.trim(),
          favorite,
          loginStrategy,
          manualSelectors,
          ...(password ? { password } : {})
        })
        onSaved(saved, tr('账号信息已更新', 'Account updated.', '帳號資料已更新'))
      } else {
        saved = await window.autologin.accounts.create({
          siteId: site.id,
          label: site.name,
          username: username.trim(),
          password,
          favorite,
          loginStrategy,
          manualSelectors
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

  async function activateRecipe(recipeId: string): Promise<void> {
    if (!account) return
    setRecipeBusy(true)
    try {
      const saved = await window.autologin.accounts.setActiveRecipe(account.id, recipeId)
      setRecipes(saved.recipes ?? [])
      setActiveRecipeId(saved.activeRecipeId)
      await onChanged()
      notify(
        'success',
        tr('已切换当前录制流程', 'Active recorded flow updated.', '已切換目前錄製流程')
      )
    } catch (reason) {
      notify(
        'error',
        reason instanceof Error
          ? reason.message
          : tr('切换录制流程失败', 'Could not switch recorded flow.', '切換錄製流程失敗')
      )
    } finally {
      setRecipeBusy(false)
    }
  }

  async function removeRecipe(): Promise<void> {
    if (!account || !confirmRecipeDelete) return
    setRecipeBusy(true)
    try {
      const saved = await window.autologin.accounts.deleteRecipe(
        account.id,
        confirmRecipeDelete.id
      )
      setRecipes(saved.recipes ?? [])
      setActiveRecipeId(saved.activeRecipeId)
      setConfirmRecipeDelete(null)
      await onChanged()
      notify('success', tr('录制流程已删除', 'Recorded flow deleted.', '錄製流程已刪除'))
    } catch (reason) {
      notify(
        'error',
        reason instanceof Error
          ? reason.message
          : tr('删除录制流程失败', 'Could not delete recorded flow.', '刪除錄製流程失敗')
      )
    } finally {
      setRecipeBusy(false)
    }
  }

  function startRecording(): void {
    if (!onRecord) return
    if (recipes.length >= 3) {
      notify(
        'info',
        tr(
          '每个账号最多保存三个录制流程，请先删除一个旧流程',
          'Each account can keep up to three recorded flows. Delete one first.',
          '每個帳號最多儲存三個錄製流程，請先刪除一個舊流程'
        )
      )
      return
    }
    onRecord()
  }

  function updateManualSelector(field: SelectorTestField, value: string): void {
    setManualSelectors((current) => ({ ...current, [field]: value }))
    setSelectorTests((current) => {
      if (!current[field]) return current
      const next = { ...current }
      delete next[field]
      return next
    })
  }

  async function testManualSelector(field: SelectorTestField): Promise<void> {
    if (!account) {
      notify(
        'info',
        tr(
          '请先保存账号，再测试页面定位器',
          'Save the account before testing selectors.',
          '請先儲存帳號，再測試頁面定位器'
        )
      )
      return
    }
    const selector = manualSelectors[field]?.trim()
    if (!selector) {
      notify(
        'info',
        tr('请先填写定位器', 'Enter a selector first.', '請先填寫定位器')
      )
      return
    }
    setSelectorTesting(field)
    try {
      const result = await window.autologin.login.testSelector({
        accountId: account.id,
        field,
        selector,
        url: startUrl.trim() || undefined
      })
      setSelectorTests((current) => ({ ...current, [field]: result }))
      notify(result.found ? 'success' : 'error', result.message)
    } catch (reason) {
      const message =
        reason instanceof Error
          ? reason.message
          : tr('定位器测试失败', 'Element test failed.', '定位器測試失敗')
      setSelectorTests((current) => ({
        ...current,
        [field]: { found: false, visible: false, count: 0, message }
      }))
      notify('error', message)
    } finally {
      setSelectorTesting(null)
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
                {(siteName || selectedSite?.name || account?.site.name || '?')
                  .slice(0, 1)
                  .toUpperCase()}
              </span>
              <div>
                <span className="eyebrow">
                  {mode === 'edit' ? 'SITE DETAILS' : 'NEW CREDENTIAL'}
                </span>
                <h2 id="account-drawer-title">
                  {mode === 'edit'
                    ? siteName || account?.site.name
                    : tr('添加登录账号', 'Add account', '新增登入帳號')}
                </h2>
                <span className="domain-label">
                  <Globe2 size={12} />
                  {startUrl.startsWith('http')
                    ? safeHostname(startUrl)
                    : tr('填写登录地址后开始', 'Enter a sign-in URL to begin', '填寫登入網址後開始')}
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
            <div className="account-drawer__body">
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
              {!account && siteMode === 'existing' && (
                <label className="field account-form__span-2">
                  <span className="field__label">{tr('选择站点', 'Select site', '選擇站點')}</span>
                  <span className="input-shell input-shell--select">
                    <Globe2 size={17} />
                    <select
                      className="select-control"
                      value={selectedSiteId}
                      onChange={(event) => handleSiteChange(event.target.value)}
                    >
                      <option value="">{tr('请选择已有站点', 'Choose an existing site', '請選擇現有站點')}</option>
                      {sites.map((site) => (
                        <option key={site.id} value={site.id}>
                          {site.name} · {safeHostname(site.startUrl)}
                        </option>
                      ))}
                    </select>
                  </span>
                </label>
              )}

              <label className="field">
                <span className="field__label">{tr('站点名称', 'Site name', '站點名稱')}</span>
                <span className="input-shell">
                  <Globe2 size={17} />
                  <input
                    value={siteName}
                    onChange={(event) => setSiteName(event.target.value)}
                    placeholder={tr('例如：工作台', 'e.g. Workspace', '例如：工作台')}
                    autoFocus={mode === 'edit'}
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
              <>
                <section
                  className="account-login-strategy"
                  aria-label={tr('登录方式', 'Login method', '登入方式')}
                >
                  <div className="proxy-mode-options account-strategy-options">
                    <label
                      className={`proxy-mode-option${loginStrategy === 'auto' ? ' is-active' : ''}`}
                    >
                      <input
                        type="radio"
                        name="login-strategy"
                        value="auto"
                        checked={loginStrategy === 'auto'}
                        onChange={() => setLoginStrategy('auto')}
                      />
                      <span>
                        <strong>{tr('自动录制', 'Automatic recording', '自動錄製')}</strong>
                        <small>
                          {tr(
                            '优先回放录制流程，失败时自动识别表单',
                            'Replay a recorded flow, then fall back to form detection',
                            '優先回放錄製流程，失敗時自動辨識表單'
                          )}
                        </small>
                      </span>
                    </label>
                    <label
                      className={`proxy-mode-option${loginStrategy === 'manual' ? ' is-active' : ''}`}
                    >
                      <input
                        type="radio"
                        name="login-strategy"
                        value="manual"
                        checked={loginStrategy === 'manual'}
                        onChange={() => setLoginStrategy('manual')}
                      />
                      <span>
                        <strong>{tr('手动配置', 'Manual configuration', '手動設定')}</strong>
                        <small>
                          {tr(
                            '使用精确的样式定位器匹配账号、密码和提交按钮',
                            'Use exact selectors for credentials and submit',
                            '使用精確的樣式定位器匹配帳號、密碼和提交按鈕'
                          )}
                        </small>
                      </span>
                    </label>
                  </div>
                </section>

                {loginStrategy === 'auto' && (
                <section className="drawer-recipes" aria-label={tr('录制流程', 'Recorded flows', '錄製流程')}>
                  <header className="drawer-recipes__header">
                    <div>
                      <strong>{tr('录制流程', 'Recorded flows', '錄製流程')}</strong>
                      <small>{recipes.length}/3 {tr('已保存', 'saved', '已儲存')}</small>
                    </div>
                    {onRecord && (
                      <button type="button" className="text-button" onClick={startRecording}>
                        <CirclePlay size={14} />
                        {tr('录制新流程', 'Record new flow', '錄製新流程')}
                      </button>
                    )}
                  </header>
                  {recipes.length === 0 ? (
                    <p className="drawer-recipes__empty">
                      {account.site.recipe
                        ? tr(
                            '检测到旧版录制流程，将在下次登录时迁移到此账号。',
                            'A legacy recorded flow will migrate to this account on the next sign-in.',
                            '偵測到舊版錄製流程，將在下次登入時遷移到此帳號。'
                          )
                        : tr(
                            '尚未录制。特殊登录页可录制后回放。',
                            'No recorded flow yet. Record one for special sign-in pages.',
                            '尚未錄製。特殊登入頁可錄製後回放。'
                          )}
                    </p>
                  ) : (
                    <div className="drawer-recipes__list">
                      {recipes.map((recipe) => {
                        const active = recipe.id === activeRecipeId
                        return (
                          <div
                            className={`drawer-recipe-row${active ? ' is-active' : ''}`}
                            key={recipe.id}
                          >
                            <span className="drawer-recipe-row__state" aria-hidden="true">
                              {active ? <Check size={12} /> : <ListChecks size={13} />}
                            </span>
                            <span className="drawer-recipe-row__identity">
                              <strong>{recipe.name}</strong>
                              <small>
                                {recipe.recipe.steps.length} {tr('个步骤', 'steps', '個步驟')}
                                {active ? ` · ${tr('当前流程', 'Active', '目前流程')}` : ''}
                              </small>
                            </span>
                            <span className="drawer-recipe-row__actions">
                              <button
                                type="button"
                                className="text-button"
                                onClick={() => setRecipeDetails(recipe)}
                              >
                                {tr('查看', 'View', '查看')}
                              </button>
                              {!active && (
                                <button
                                  type="button"
                                  className="text-button"
                                  onClick={() => void activateRecipe(recipe.id)}
                                  disabled={recipeBusy}
                                >
                                  {tr('启用', 'Enable', '啟用')}
                                </button>
                              )}
                              <button
                                type="button"
                                className="icon-button icon-button--small"
                                onClick={() => setConfirmRecipeDelete(recipe)}
                                aria-label={tr('删除录制流程', 'Delete recorded flow', '刪除錄製流程')}
                              >
                                <Trash2 size={13} />
                              </button>
                            </span>
                          </div>
                        )
                      })}
                    </div>
                  )}
                </section>
                )}

                {loginStrategy === 'manual' && (
                  <section
                    className="drawer-recipes manual-selector-panel"
                    aria-label={tr('手动登录配置', 'Manual login configuration', '手動登入設定')}
                  >
                    <header className="drawer-recipes__header">
                      <div>
                        <strong>{tr('元素定位器', 'Element selectors', '元素定位器')}</strong>
                        <small>
                          {tr(
                            '仅保存定位规则，不保存输入内容',
                            'Only selectors are stored',
                            '僅儲存定位規則，不儲存輸入內容'
                          )}
                        </small>
                      </div>
                    </header>
                    {(
                      [
                        ['username', tr('用户名', 'Username', '使用者名稱')],
                        ['password', tr('密码', 'Password', '密碼')],
                        ['submit', tr('提交按钮', 'Submit button', '提交按鈕')]
                      ] as const
                    ).map(([field, label]) => {
                      const result = selectorTests[field]
                      return (
                        <label className="field selector-config-row" key={field}>
                          <span className="field__label">{label}</span>
                          <span className="selector-config-row__control">
                            <span className="input-shell">
                              <SlidersHorizontal size={15} />
                              <input
                                value={manualSelectors[field] ?? ''}
                                onChange={(event) =>
                                  updateManualSelector(field, event.target.value)
                                }
                                placeholder={selectorPlaceholder(field)}
                                spellCheck={false}
                                autoComplete="off"
                              />
                            </span>
                            <button
                              type="button"
                              className="button button--ghost button--small"
                              onClick={() => void testManualSelector(field)}
                              disabled={selectorTesting !== null}
                            >
                              {selectorTesting === field ? (
                                <LoaderCircle size={13} className="spin" />
                              ) : (
                                <RefreshCw size={13} />
                              )}
                              {tr('测试', 'Test', '測試')}
                            </button>
                          </span>
                          {result && (
                            <small
                              className={`selector-config-row__result${
                                result.found ? ' is-success' : ' is-error'
                              }`}
                            >
                              {result.message}
                            </small>
                          )}
                        </label>
                      )
                    })}
                  </section>
                )}
              </>
            )}
            </div>

            <div className="account-drawer__footer">
              <div className="account-drawer__management">
                {account && (
                  <>
                    <button type="button" className="text-button" onClick={() => setConfirmClear(true)}>
                      <RefreshCw size={14} />
                      {tr('清除会话', 'Clear session', '清除工作階段')}
                    </button>
                    <button
                      type="button"
                      className="text-button text-button--danger"
                      onClick={() => setConfirmDelete(true)}
                    >
                      <Trash2 size={14} />
                      {tr('删除账号', 'Delete account', '刪除帳號')}
                    </button>
                  </>
                )}
              </div>
              <div className="account-drawer__actions">
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
      {confirmRecipeDelete && (
        <ConfirmDialog
          title={tr('删除这个录制流程？', 'Delete this recorded flow?', '刪除這個錄製流程？')}
          description={tr(
            `“${confirmRecipeDelete.name}”会被永久删除，账号密码和网站会话不会受到影响。`,
            `“${confirmRecipeDelete.name}” will be permanently deleted. Credentials and website sessions are unaffected.`,
            `「${confirmRecipeDelete.name}」會被永久刪除，帳號密碼和網站工作階段不會受到影響。`
          )}
          confirmLabel={tr('删除流程', 'Delete flow', '刪除流程')}
          danger
          busy={recipeBusy}
          onConfirm={() => void removeRecipe()}
          onClose={() => setConfirmRecipeDelete(null)}
        />
      )}
      {recipeDetails && (
        <Modal
          title={recipeDetails.name}
          eyebrow={tr('录制流程详情', 'RECORDED FLOW', '錄製流程詳情')}
          onClose={() => setRecipeDetails(null)}
          width="620px"
          className="recipe-details-modal"
        >
          <div className="recipe-details-meta">
            <span>
              {recipeDetails.recipe.steps.length} {tr('个步骤', 'steps', '個步驟')}
            </span>
            <span>{safeHostname(recipeDetails.recipe.startUrl)}</span>
            {recipeDetails.id === activeRecipeId && (
              <strong>{tr('当前启用', 'Active', '目前啟用')}</strong>
            )}
          </div>
          <ol className="recipe-steps">
            {recipeDetails.recipe.steps.map((step, index) => (
              <li key={step.id}>
                <span>{String(index + 1).padStart(2, '0')}</span>
                <div>
                  <strong>{recipeStepName(step.type, tr)}</strong>
                  <small>
                    {step.type === 'press'
                      ? `${tr('按键', 'Key', '按鍵')} ${step.key}`
                      : step.selector
                        ? step.selector.candidates.join('  ·  ')
                        : tr('无需选择器', 'No selector', '無需選擇器')}
                  </small>
                </div>
              </li>
            ))}
          </ol>
          <p className="modal-description">
            {tr(
              '这里只展示步骤类型与稳定选择器，不包含账号、密码、验证码或页面输入的真实内容。',
              'Only step types and stable selectors are shown. Credentials, verification codes and real page input are excluded.',
              '這裡只顯示步驟類型與穩定選擇器，不包含帳號、密碼、驗證碼或頁面輸入的真實內容。'
            )}
          </p>
        </Modal>
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

function selectorPlaceholder(field: SelectorTestField): string {
  if (field === 'username') return 'input[name="username"], #username'
  if (field === 'password') return 'input[type="password"], #password'
  return 'button[type="submit"], #login'
}

function recipeStepName(
  type: AccountRecipe['recipe']['steps'][number]['type'],
  tr: (zhCN: string, en: string, zhTW: string) => string
): string {
  switch (type) {
    case 'fillUsername':
      return tr('填写用户名', 'Fill username', '填寫使用者名稱')
    case 'fillPassword':
      return tr('填写密码', 'Fill password', '填寫密碼')
    case 'click':
      return tr('点击元素', 'Click element', '點擊元素')
    case 'press':
      return tr('按下按键', 'Press key', '按下按鍵')
    case 'focusChallenge':
      return tr('聚焦人工验证', 'Focus manual challenge', '聚焦人工驗證')
  }
}

function toneClass(id: string): string {
  let hash = 0
  for (const char of id) hash = (hash * 31 + char.charCodeAt(0)) >>> 0
  return `monogram--tone-${hash % 4}`
}
