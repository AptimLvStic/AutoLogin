import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Check,
  ChevronDown,
  CirclePlay,
  Copy,
  Download,
  Eye,
  EyeOff,
  Globe2,
  GripVertical,
  History,
  ImagePlus,
  KeyRound,
  Layers3,
  ListChecks,
  LoaderCircle,
  Pause,
  Play,
  Plus,
  RefreshCw,
  Search,
  SlidersHorizontal,
  Trash2,
  Undo2,
  UserRound,
  X
} from 'lucide-react'
import type {
  AccountRecipe,
  AccountWithSite,
  GroupDefinition,
  LoginBrowser,
  LoginStrategy,
  LoginViewState,
  RecipeDraftResult,
  RecipeStep,
  RecordingSaveStatus,
  RecordingStepSummary,
  SelectorTestResult,
  Site
} from '@shared/types'
import { useI18n } from '../i18n'
import {
  ManualStepEditor,
  MANUAL_STEP_ACTIONS,
  changeManualStepType,
  createManualStep,
  initialManualSteps,
  manualStepActionLabel,
  manualStepSelector,
  manualStepSelectorSpec,
  manualStepsAreComplete,
  nextManualStepType,
  normalizeManualSteps,
  selectorPlaceholderForAction,
  selectorTestFieldForAction,
  updateManualStepSelector,
  type ManualStepAction
} from './ManualStepEditor'
import { ConfirmDialog, Modal } from './Modal'
import { CredentialHistoryDialog } from './CredentialHistoryDialog'
import { PasswordGeneratorPopover } from './PasswordGenerator'
import { SiteMark } from './SiteMark'

interface AccountDrawerProps {
  tabId: string
  mode: 'create' | 'edit'
  bookmarkMode?: boolean
  account?: AccountWithSite
  defaultLoginBrowser?: LoginBrowser
  focusField?: 'url' | 'username' | 'password'
  sites: Site[]
  groups: GroupDefinition[]
  initialSiteId?: string
  onClose: () => void
  onSaved: (account: AccountWithSite, message: string) => void
  onRecord?: () => Promise<boolean>
  onChanged: () => Promise<void>
  loginState: LoginViewState | null
  recordingFinishRequest: number
  onRecordingFinishHandled: () => void
  notify: (kind: 'success' | 'error' | 'info', message: string) => void
}

export function AccountDrawer({
  tabId,
  mode,
  bookmarkMode = false,
  account,
  defaultLoginBrowser = 'builtin',
  focusField,
  sites,
  groups,
  initialSiteId,
  onClose,
  onSaved,
  onRecord,
  onChanged,
  loginState,
  recordingFinishRequest,
  onRecordingFinishHandled,
  notify
}: AccountDrawerProps): React.JSX.Element {
  const { tr } = useI18n()
  const isBookmark = bookmarkMode
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
  const [siteIcon, setSiteIcon] = useState(
    account?.site.icon ?? initialSite?.icon ?? ''
  )
  const [autoSubmit, setAutoSubmit] = useState(initialSite?.autoSubmit ?? true)
  const [siteGroup, setSiteGroup] = useState(initialSite?.group ?? '')
  const [username, setUsername] = useState(
    account?.needsUsername ? '' : account?.username ?? ''
  )
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [revealedPassword, setRevealedPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [fieldErrors, setFieldErrors] = useState<{
    siteName?: string
    startUrl?: string
  }>({})
  const [discardConfirmOpen, setDiscardConfirmOpen] = useState(false)
  const [credentialHistoryOpen, setCredentialHistoryOpen] = useState(false)
  const [recipes, setRecipes] = useState<AccountRecipe[]>(account?.recipes ?? [])
  const [activeRecipeId, setActiveRecipeId] = useState(account?.activeRecipeId)
  const [loginStrategy, setLoginStrategy] = useState<LoginStrategy>(
    account?.loginStrategy ?? 'auto'
  )
  const [loginBrowser, setLoginBrowser] = useState<LoginBrowser>(
    account?.loginBrowser ?? defaultLoginBrowser
  )
  const [manualSteps, setManualSteps] = useState<RecipeStep[]>(() =>
    initialManualSteps(account)
  )
  const [selectorTests, setSelectorTests] = useState<Record<string, SelectorTestResult>>(
    {}
  )
  const [selectorTesting, setSelectorTesting] = useState<string | null>(null)
  const [sitePickerOpen, setSitePickerOpen] = useState(false)
  const [groupPickerOpen, setGroupPickerOpen] = useState(false)
  const [sitePickerQuery, setSitePickerQuery] = useState('')
  const [groupPickerQuery, setGroupPickerQuery] = useState('')
  const [recipeDetails, setRecipeDetails] = useState<AccountRecipe | null>(null)
  const [confirmRecipeDelete, setConfirmRecipeDelete] = useState<AccountRecipe | null>(null)
  const [recipeBusy, setRecipeBusy] = useState(false)
  const [draggedRecipeStepId, setDraggedRecipeStepId] = useState<string | null>(null)
  const [recipeStepTests, setRecipeStepTests] = useState<
    Record<string, SelectorTestResult>
  >({})
  const [recipeStepTesting, setRecipeStepTesting] = useState<string | null>(null)
  const [recordingNow, setRecordingNow] = useState(Date.now())
  const [recordingAction, setRecordingAction] = useState<
    'pause' | 'resume' | 'undo' | 'username' | 'password' | 'trust' | 'finish' | null
  >(null)
  const [recordingFinishOpen, setRecordingFinishOpen] = useState(false)
  const [recordingName, setRecordingName] = useState('')
  const [recordingError, setRecordingError] = useState('')
  const [recordingSaveStage, setRecordingSaveStage] = useState('')
  const [recordingSaveFailed, setRecordingSaveFailed] = useState(false)
  const [iconBusy, setIconBusy] = useState(false)
  const revealTimer = useRef<number | null>(null)
  const passwordEditedRef = useRef(false)
  const closedRef = useRef(false)
  const recordingSaveStageRef = useRef('')
  const sitePickerRef = useRef<HTMLDivElement>(null)
  const groupPickerRef = useRef<HTMLDivElement>(null)
  const iconFileRef = useRef<HTMLInputElement>(null)
  const startUrlRef = useRef<HTMLInputElement>(null)
  const usernameRef = useRef<HTMLInputElement>(null)
  const passwordRef = useRef<HTMLInputElement>(null)
  const recipeDetailsVersionRef = useRef(0)
  const latestRecipeDetailsRef = useRef<AccountRecipe | null>(null)
  const recipeSaveCountRef = useRef(0)
  const recipeSaveQueueRef = useRef<Promise<void>>(Promise.resolve())

  // 未保存改动判定：只比较真正会随「保存」提交的字段，避免把已即时保存的录制流程算进来。
  const formSnapshot = JSON.stringify({
    siteMode,
    selectedSiteId,
    siteName,
    startUrl,
    siteIcon,
    autoSubmit,
    siteGroup,
    username,
    password,
    loginStrategy,
    loginBrowser,
    manualSteps
  })
  const initialFormSnapshotRef = useRef<string | null>(null)
  if (initialFormSnapshotRef.current === null) {
    initialFormSnapshotRef.current = formSnapshot
  }
  const hasUnsavedChanges = formSnapshot !== initialFormSnapshotRef.current

  const selectedSite = useMemo(
    () => sites.find((site) => site.id === selectedSiteId),
    [selectedSiteId, sites]
  )
  const groupOptions = useMemo(
    () => [...groups].sort((left, right) => left.path.localeCompare(right.path)),
    [groups]
  )
  const filteredSiteOptions = useMemo(() => {
    const query = sitePickerQuery.trim().toLocaleLowerCase()
    if (!query) return sites
    return sites.filter((site) =>
      [site.name, site.startUrl, safeHostname(site.startUrl), site.group ?? '']
        .join(' ')
        .toLocaleLowerCase()
        .includes(query)
    )
  }, [sitePickerQuery, sites])
  const filteredGroupOptions = useMemo(() => {
    const query = groupPickerQuery.trim().toLocaleLowerCase()
    if (!query) return groupOptions
    return groupOptions.filter((group) =>
      group.path.toLocaleLowerCase().includes(query)
    )
  }, [groupOptions, groupPickerQuery])
  const recordingThisAccount = Boolean(
    account &&
      loginState?.recording &&
      loginState.accountId === account.id
  )
  const recordingSteps = recordingThisAccount ? (loginState?.recordingSteps ?? []) : []
  const recordingStepCount = recordingThisAccount
    ? (loginState?.recordingStepCount ?? recordingSteps.length)
    : 0
  const recordingElapsed = formatRecordingDuration(loginState, recordingNow)
  const recordingLong = recordingDurationSeconds(loginState, recordingNow) >= 300

  useEffect(() => {
    return () => {
      if (revealTimer.current) window.clearTimeout(revealTimer.current)
    }
  }, [])

  useEffect(() => {
    if (isBookmark || mode !== 'edit' || !account) return
    let cancelled = false
    passwordEditedRef.current = false
    setPassword('')
    setRevealedPassword('')
    setShowPassword(false)
    void window.autologin.accounts
      .reveal(account.id)
      .then((result) => {
        if (cancelled || passwordEditedRef.current) return
        setPassword(result.password)
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [account?.id, isBookmark, mode])

  useEffect(() => {
    if (!focusField) return
    const timer = window.setTimeout(() => {
      if (focusField === 'url') startUrlRef.current?.focus()
      else if (focusField === 'username') usernameRef.current?.focus()
      else passwordRef.current?.focus()
    }, 60)
    return () => window.clearTimeout(timer)
  }, [account?.id, focusField])

  useEffect(() => {
    if (!sitePickerOpen) return
    const closeOnPointer = (event: PointerEvent): void => {
      if (
        event.target instanceof Node &&
        sitePickerRef.current?.contains(event.target)
      ) {
        return
      }
      setSitePickerOpen(false)
    }
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setSitePickerOpen(false)
    }
    document.addEventListener('pointerdown', closeOnPointer)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('pointerdown', closeOnPointer)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [sitePickerOpen])

  useEffect(() => {
    if (!groupPickerOpen) return
    const closeOnPointer = (event: PointerEvent): void => {
      if (
        event.target instanceof Node &&
        groupPickerRef.current?.contains(event.target)
      ) {
        return
      }
      setGroupPickerOpen(false)
    }
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setGroupPickerOpen(false)
    }
    document.addEventListener('pointerdown', closeOnPointer)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('pointerdown', closeOnPointer)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [groupPickerOpen])

  useEffect(() => {
    if (!recordingThisAccount) return
    const timer = window.setInterval(() => setRecordingNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [recordingThisAccount])

  useEffect(() => {
    if (!recordingThisAccount) {
      if (recordingAction === 'finish') return
      setRecordingFinishOpen(false)
      setRecordingAction(null)
      setRecordingError('')
      setRecordingSaveStage('')
      recordingSaveStageRef.current = ''
      setRecordingSaveFailed(false)
    }
  }, [recordingAction, recordingThisAccount])

  useEffect(() => {
    if (recordingAction !== 'finish') return
    const message = loginState?.message?.trim()
    if (!message || !isRecordingSaveStage(message)) return
    recordingSaveStageRef.current = message
    setRecordingSaveStage(message)
  }, [loginState?.message, recordingAction])

  useEffect(() => {
    if (!recordingThisAccount || recordingFinishRequest <= 0) return
    setRecordingError('')
    setRecordingSaveFailed(false)
    setRecordingSaveStage('')
    recordingSaveStageRef.current = ''
    setRecordingName((current) => current || defaultRecordingName(recipes.length, tr))
    setRecordingFinishOpen(true)
    onRecordingFinishHandled()
  }, [
    onRecordingFinishHandled,
    recipes.length,
    recordingFinishRequest,
    recordingThisAccount,
    tr
  ])

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
      setSiteIcon(site.icon ?? '')
      setAutoSubmit(site.autoSubmit)
      setSiteGroup(site.group ?? '')
    }
  }

  function chooseNew(): void {
    setSiteMode('new')
    setSiteName('')
    setStartUrl('https://')
    setSiteIcon('')
    setAutoSubmit(true)
    setSiteGroup('')
  }

  function handleSiteChange(siteId: string): void {
    setSelectedSiteId(siteId)
    setSitePickerOpen(false)
    const site = sites.find((entry) => entry.id === siteId)
    if (site) {
      setSiteName(site.name)
      setStartUrl(site.startUrl)
      setSiteIcon(site.icon ?? '')
      setAutoSubmit(site.autoSubmit)
      setSiteGroup(site.group ?? '')
    }
  }

  async function fetchWebsiteIcon(): Promise<void> {
    if (!isValidHttpUrl(startUrl)) {
      notify(
        'error',
        tr(
          '请先填写有效的 http 或 https 登录地址',
          'Enter a valid HTTP or HTTPS sign-in URL first.',
          '請先填寫有效的 HTTP 或 HTTPS 登入網址'
        )
      )
      return
    }
    setIconBusy(true)
    try {
      const icon = await window.autologin.sites.fetchIcon(startUrl.trim())
      setSiteIcon(icon)
      notify(
        'success',
        tr('已获取站点图标', 'Site icon downloaded.', '已取得站點圖示')
      )
    } catch (reason) {
      notify(
        'error',
        reason instanceof Error
          ? reason.message
          : tr('获取站点图标失败', 'Could not download the site icon.', '取得站點圖示失敗')
      )
    } finally {
      setIconBusy(false)
    }
  }

  async function selectSiteIcon(event: React.ChangeEvent<HTMLInputElement>): Promise<void> {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    if (!file.type.startsWith('image/')) {
      notify('error', tr('请选择图片文件', 'Choose an image file.', '請選擇圖片檔案'))
      return
    }
    if (file.size > 512 * 1024) {
      notify(
        'error',
        tr('图标文件不能超过 512 KB', 'The icon must be 512 KB or smaller.', '圖示檔案不能超過 512 KB')
      )
      return
    }
    try {
      setSiteIcon(await readFileAsDataUrl(file))
    } catch {
      notify('error', tr('读取图标失败', 'Could not read the icon.', '讀取圖示失敗'))
    }
  }

  function deriveSiteName(): void {
    if (siteName.trim() || !isValidHttpUrl(startUrl)) return
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
    setFieldErrors({})
    const normalizedStartUrl = normalizeOptionalStartUrl(startUrl)
    const nextFieldErrors: { siteName?: string; startUrl?: string } = {}
    if (!siteName.trim()) {
      nextFieldErrors.siteName = tr(
        '请填写站点名称',
        'Enter a site name.',
        '請填寫站點名稱'
      )
    }
    if (normalizedStartUrl && !isValidHttpUrl(normalizedStartUrl)) {
      nextFieldErrors.startUrl = tr(
        '登录地址需要是有效的 http 或 https 地址',
        'The sign-in URL must be a valid http or https address.',
        '登入網址需要是有效的 http 或 https 位址'
      )
    }
    if (Object.keys(nextFieldErrors).length > 0) {
      setFieldErrors(nextFieldErrors)
      return
    }
    if (siteMode === 'existing' && !selectedSite) {
      setError(tr('请选择站点', 'Select a site.', '請選擇站點'))
      return
    }
    if (
      !isBookmark &&
      loginStrategy === 'manual' &&
      !manualStepsAreComplete(manualSteps)
    ) {
      setError(
        tr(
          '手动配置至少需要包含“输入用户名”和“输入密码”步骤，且每个步骤都要填写 Selector',
          'Manual configuration needs username and password steps with selectors.',
          '手動設定至少需要包含「輸入使用者名稱」和「輸入密碼」步驟，且每個步驟都要填寫 Selector'
        )
      )
      return
    }

    const startedAt = Date.now()
    const saveLabel = isBookmark
      ? tr('保存书签', 'Save bookmark', '儲存書籤')
      : tr('保存账号修改', 'Save account changes', '儲存帳號變更')
    let saveStage = tr('准备保存', 'Preparing to save', '準備儲存')
    setBusy(true)
    try {
      let site: Site
      if (siteMode === 'new') {
        saveStage = tr('写入站点信息', 'Writing site details', '寫入站點資訊')
        site = await withUiTimeout(
          window.autologin.sites.save({
            tabId,
            name: siteName.trim(),
            startUrl: normalizedStartUrl,
            autoSubmit,
            group: siteGroup.trim() || undefined,
            ...(siteIcon ? { icon: siteIcon } : {})
          }),
          20_000,
          tr(
            '保存站点信息未完成（已等待 20 秒）',
            'Saving site details did not finish within 20 seconds.',
            '儲存站點資訊未完成（已等待 20 秒）'
          )
        )
      } else {
        if (!selectedSite) throw new Error(tr('请选择站点', 'Select a site.', '請選擇站點'))
        const groupChanged = (selectedSite.group ?? '') !== siteGroup.trim()
        const siteChanged =
          selectedSite.name !== siteName.trim() ||
          selectedSite.startUrl !== normalizedStartUrl ||
          selectedSite.autoSubmit !== autoSubmit ||
          (selectedSite.icon ?? '') !== siteIcon ||
          groupChanged
        site =
          !siteChanged
            ? selectedSite
            : await (async () => {
                saveStage = tr('写入站点信息', 'Writing site details', '寫入站點資訊')
                return await withUiTimeout(
                  window.autologin.sites.save({
                    id: selectedSite.id,
                    tabId: selectedSite.tabId,
                    name: siteName.trim(),
                    startUrl: normalizedStartUrl,
                    allowedOrigins: selectedSite.allowedOrigins,
                    autoSubmit,
                    group: siteGroup.trim() || undefined,
                    ...(siteIcon ? { icon: siteIcon } : {})
                  }),
                  20_000,
                  tr(
                    '保存站点信息未完成（已等待 20 秒）',
                    'Saving site details did not finish within 20 seconds.',
                    '儲存站點資訊未完成（已等待 20 秒）'
                  )
                )
              })()
      }

      if (closedRef.current) return
      let saved: AccountWithSite
      if (mode === 'edit' && account) {
        saveStage = isBookmark
          ? tr('写入书签信息', 'Writing bookmark details', '寫入書籤資訊')
          : tr('写入账号信息', 'Writing account details', '寫入帳號資訊')
        saved = await withUiTimeout(
          window.autologin.accounts.update(account.id, {
            label: site.name,
            ...(isBookmark
              ? {}
              : {
                  username: username.trim(),
                  loginStrategy,
                  loginBrowser,
                  manualSteps:
                    loginStrategy === 'manual' ? normalizeManualSteps(manualSteps) : [],
                  ...(password ? { password } : {})
                })
          }),
          20_000,
          tr(
            '保存账号信息未完成（已等待 20 秒）',
            'Saving account details did not finish within 20 seconds.',
            '儲存帳號資訊未完成（已等待 20 秒）'
          )
        )
        if (closedRef.current) return
        onSaved(
          saved,
          isBookmark
            ? tr('书签信息已更新', 'Bookmark updated.', '書籤資料已更新')
            : tr('账号信息已更新', 'Account updated.', '帳號資料已更新')
        )
      } else {
        saveStage = isBookmark
          ? tr('创建书签', 'Creating bookmark', '建立書籤')
          : tr('创建账号', 'Creating account', '建立帳號')
        saved = await withUiTimeout(
          window.autologin.accounts.create({
            siteId: site.id,
            label: site.name,
            username: isBookmark ? '' : username.trim(),
            password: isBookmark ? '' : password,
            loginStrategy: isBookmark ? 'auto' : loginStrategy,
            loginBrowser: isBookmark ? 'standalone' : loginBrowser,
            manualSteps:
              isBookmark || loginStrategy !== 'manual'
                ? []
                : normalizeManualSteps(manualSteps)
          }),
          20_000,
          tr(
            '保存账号信息未完成（已等待 20 秒）',
            'Saving account details did not finish within 20 seconds.',
            '儲存帳號資訊未完成（已等待 20 秒）'
          )
        )
        if (closedRef.current) return
        onSaved(
          saved,
          isBookmark
            ? tr('书签已加入保险库', 'Bookmark added to the vault.', '書籤已加入保險庫')
            : tr('账号已加入保险库', 'Account added to the vault.', '帳號已加入保險庫')
        )
      }
    } catch (reason) {
      if (closedRef.current) return
      const message = describeOperationFailure(
        saveLabel,
        saveStage,
        startedAt,
        reason,
        tr
      )
      setError(message)
      void window.autologin.app
        .reportUiFailure({
          context: saveLabel,
          message,
          durationMs: Date.now() - startedAt
        })
        .catch(() => undefined)
    } finally {
      if (!closedRef.current) setBusy(false)
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
      notify(
        'success',
        recordingThisAccount
          ? tr(
              '密码已复制，录制期间 2 分钟后清除',
              'Password copied and will clear 2 minutes after recording ends.',
              '密碼已複製，錄製期間 2 分鐘後清除'
            )
          : tr(
              '密码已复制，30 秒后自动清除',
              'Password copied and will clear in 30 seconds.',
              '密碼已複製，30 秒後自動清除'
            )
      )
    } catch (reason) {
      notify('error', reason instanceof Error ? reason.message : tr('复制失败', 'Copy failed.', '複製失敗'))
    }
  }

  async function applyRestoredCredentials(saved: AccountWithSite): Promise<void> {
    setUsername(saved.username)
    setPassword('')
    setShowPassword(false)
    hideRevealedPassword()
    await onChanged()
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

  function openRecipeDetails(recipe: AccountRecipe): void {
    const next = structuredClone(recipe)
    recipeDetailsVersionRef.current += 1
    latestRecipeDetailsRef.current = next
    setRecipeDetails(next)
    setRecipeStepTests({})
    setRecipeStepTesting(null)
    setDraggedRecipeStepId(null)
  }

  function closeRecipeDetails(): void {
    persistCurrentRecipeDetails(false)
    latestRecipeDetailsRef.current = null
    setRecipeDetails(null)
    setRecipeStepTests({})
    setRecipeStepTesting(null)
  }

  function applyRecipeDetails(recipe: AccountRecipe): void {
    recipeDetailsVersionRef.current += 1
    latestRecipeDetailsRef.current = recipe
    setRecipeDetails(recipe)
  }

  function persistCurrentRecipeDetails(notifySuccess = false): void {
    const current = latestRecipeDetailsRef.current
    if (!current) return
    void persistRecipeSteps(current, current.recipe.steps, { notifySuccess })
  }

  function persistRecipeSteps(
    recipe: AccountRecipe,
    steps: RecipeStep[],
    options: { notifySuccess?: boolean } = {}
  ): Promise<void> {
    if (!account) return Promise.resolve()
    const normalizedSteps = normalizeRecipeStepsForSave(steps)
    if (!recipeStepsCanBeSaved(normalizedSteps)) return Promise.resolve()
    const version = recipeDetailsVersionRef.current
    const save = async (): Promise<void> => {
      recipeSaveCountRef.current += 1
      setRecipeBusy(true)
      try {
        const saved = await window.autologin.accounts.updateRecipe({
          accountId: account.id,
          recipeId: recipe.id,
          steps: normalizedSteps
        })
        const updatedRecipes = saved.recipes ?? []
        const updatedRecipe =
          updatedRecipes.find((entry) => entry.id === recipe.id) ?? null
        setRecipes(updatedRecipes)
        setActiveRecipeId(saved.activeRecipeId)
        if (
          updatedRecipe &&
          recipeDetailsVersionRef.current === version &&
          latestRecipeDetailsRef.current?.id === recipe.id
        ) {
          latestRecipeDetailsRef.current = updatedRecipe
          setRecipeDetails(updatedRecipe)
        }
        await onChanged()
        if (options.notifySuccess !== false) {
          notify(
            'success',
            tr('录制流程已更新', 'Recorded flow updated.', '錄製流程已更新')
          )
        }
      } catch (reason) {
        notify(
          'error',
          reason instanceof Error
            ? reason.message
            : tr('更新录制流程失败', 'Could not update recorded flow.', '更新錄製流程失敗')
        )
      } finally {
        recipeSaveCountRef.current = Math.max(0, recipeSaveCountRef.current - 1)
        if (recipeSaveCountRef.current === 0) {
          setRecipeBusy(false)
        }
      }
    }
    const queued = recipeSaveQueueRef.current.then(save, save)
    recipeSaveQueueRef.current = queued.then(
      () => undefined,
      () => undefined
    )
    return queued
  }

  function updateRecipeStep(
    stepId: string,
    updater: (step: RecipeStep) => RecipeStep
  ): AccountRecipe | null {
    if (!recipeDetails) return null
    if (!recipeDetails.recipe.steps.some((step) => step.id === stepId)) return null
    const steps = recipeDetails.recipe.steps.map((step) =>
      step.id === stepId ? updater(step) : step
    )
    const updated = {
      ...recipeDetails,
      recipe: { ...recipeDetails.recipe, steps }
    }
    applyRecipeDetails(updated)
    setRecipeStepTests((current) => {
      if (!current[stepId]) return current
      const next = { ...current }
      delete next[stepId]
      return next
    })
    return updated
  }

  function changeRecipeStepType(
    stepId: string,
    action: ManualStepAction
  ): void {
    const updated = updateRecipeStep(stepId, (step) =>
      changeManualStepType(step, action)
    )
    if (updated) {
      void persistRecipeSteps(updated, updated.recipe.steps)
    }
  }

  function updateRecipeStepSelector(stepId: string, value: string): void {
    updateRecipeStep(stepId, (step) => updateManualStepSelector(step, value))
  }

  function updateRecipeStepKey(stepId: string, value: string): void {
    updateRecipeStep(stepId, (step) =>
      step.type === 'press' ? { ...step, key: value } : step
    )
  }

  function addRecipeStep(): void {
    if (!recipeDetails) return
    if (recipeDetails.recipe.steps.length >= 30) {
      notify(
        'info',
        tr(
          '单个录制流程最多包含 30 个步骤',
          'A recorded flow can contain up to 30 steps.',
          '單個錄製流程最多包含 30 個步驟'
        )
      )
      return
    }
    const step = createManualStep(
      nextManualStepType(recipeDetails.recipe.steps)
    )
    const updated = {
      ...recipeDetails,
      recipe: {
        ...recipeDetails.recipe,
        steps: [...recipeDetails.recipe.steps, step]
      }
    }
    applyRecipeDetails(updated)
    void persistRecipeSteps(updated, updated.recipe.steps)
  }

  function removeRecipeStep(stepId: string): void {
    if (!recipeDetails) return
    const next = recipeDetails.recipe.steps.filter((step) => step.id !== stepId)
    const updated = {
      ...recipeDetails,
      recipe: { ...recipeDetails.recipe, steps: next }
    }
    applyRecipeDetails(updated)
    setRecipeStepTests((current) => {
      const updatedTests = { ...current }
      delete updatedTests[stepId]
      return updatedTests
    })
    void persistRecipeSteps(updated, next)
  }

  function moveRecipeStep(sourceId: string, targetId: string): void {
    if (!recipeDetails || sourceId === targetId) return
    const steps = [...recipeDetails.recipe.steps]
    const sourceIndex = steps.findIndex((step) => step.id === sourceId)
    const targetIndex = steps.findIndex((step) => step.id === targetId)
    if (sourceIndex < 0 || targetIndex < 0) return
    const [moved] = steps.splice(sourceIndex, 1)
    if (!moved) return
    steps.splice(targetIndex, 0, moved)
    const updated = {
      ...recipeDetails,
      recipe: { ...recipeDetails.recipe, steps }
    }
    applyRecipeDetails(updated)
    void persistRecipeSteps(updated, steps)
  }

  async function startRecording(): Promise<void> {
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
    setRecordingError('')
    setRecordingSaveFailed(false)
    setRecordingSaveStage('')
    recordingSaveStageRef.current = ''
    const started = await onRecord()
    if (started) {
      setRecordingNow(Date.now())
      setRecordingName(defaultRecordingName(recipes.length, tr))
    }
  }

  function closeDrawerNow(): void {
    if (closedRef.current) return
    if (recordingThisAccount) {
      notify(
        'info',
        tr(
          '编辑页已关闭，录制继续在后台进行；可通过顶部录制浮条继续操作。',
          'The editor is closed. Recording continues in the background from the top recording bar.',
          '編輯頁已關閉，錄製繼續在背景進行；可透過頂部錄製浮條繼續操作。'
        )
      )
    }
    closedRef.current = true
    setDiscardConfirmOpen(false)
    setRecordingFinishOpen(false)
    onClose()
  }

  function requestDrawerClose(): void {
    if (closedRef.current) return
    // 录制中关闭编辑页是既有流程：录制在后台继续，不做脏检查拦截。
    if (!recordingThisAccount && hasUnsavedChanges) {
      setDiscardConfirmOpen(true)
      return
    }
    closeDrawerNow()
  }

  async function toggleRecordingPause(): Promise<void> {
    if (!recordingThisAccount || recordingAction) return
    const resume = loginState?.recordingPaused === true
    setRecordingAction(resume ? 'resume' : 'pause')
    try {
      if (resume) {
        await window.autologin.login.resumeRecording()
      } else {
        await window.autologin.login.pauseRecording()
      }
    } catch (reason) {
      notify(
        'error',
        reason instanceof Error
          ? reason.message
          : tr('更新录制状态失败', 'Could not update recording.', '無法更新錄製狀態')
      )
    } finally {
      setRecordingAction(null)
    }
  }

  async function undoRecordingStep(): Promise<void> {
    if (!recordingThisAccount || recordingAction || recordingStepCount === 0) return
    setRecordingAction('undo')
    try {
      await window.autologin.login.undoRecordingStep()
    } catch (reason) {
      notify(
        'error',
        reason instanceof Error
          ? reason.message
          : tr('撤销失败', 'Could not undo the last step.', '撤銷失敗')
      )
    } finally {
      setRecordingAction(null)
    }
  }

  async function trustCurrentOrigin(): Promise<void> {
    if (!recordingThisAccount || recordingAction) return
    setRecordingAction('trust')
    try {
      await window.autologin.login.trustCurrentOrigin()
      notify(
        'success',
        tr('已信任当前域名并继续录制', 'Origin trusted; recording continues.', '已信任目前網域並繼續錄製')
      )
    } catch (reason) {
      notify(
        'error',
        reason instanceof Error
          ? reason.message
          : tr('无法信任当前域名', 'Could not trust this origin.', '無法信任目前網域')
      )
    } finally {
      setRecordingAction(null)
    }
  }

  async function copyRecordingCredential(kind: 'username' | 'password'): Promise<void> {
    if (recordingAction) return
    setRecordingAction(kind)
    try {
      if (kind === 'username') {
        await copyUsername()
      } else {
        await copyPassword()
      }
    } finally {
      setRecordingAction(null)
    }
  }

  function openRecordingSummary(): void {
    setRecordingError('')
    setRecordingSaveFailed(false)
    setRecordingSaveStage('')
    recordingSaveStageRef.current = ''
    setRecordingName(defaultRecordingName(recipes.length, tr))
    setRecordingFinishOpen(true)
  }

  function completeRecordingSave(
    result: RecipeDraftResult,
    name: string,
    message: string
  ): boolean {
    if (!result.saved || !result.recipeId) return false
    const recipe = { id: result.recipeId, name, recipe: result.recipe }
    setRecipes((current) => [
      ...current.filter((entry) => entry.id !== result.recipeId),
      recipe
    ])
    setActiveRecipeId(result.recipeId)
    setRecordingFinishOpen(false)
    setRecordingSaveFailed(false)
    setRecordingError('')
    setRecordingSaveStage('')
    recordingSaveStageRef.current = ''
    notify('success', message)
    void onChanged().catch(() => undefined)
    return true
  }

  function completeRecordingDraftSave(message: string): void {
    setRecordingFinishOpen(false)
    setRecordingSaveFailed(false)
    setRecordingError('')
    setRecordingSaveStage('')
    recordingSaveStageRef.current = ''
    notify('success', message)
  }

  async function readRecordingSaveStatus(): Promise<RecordingSaveStatus | null> {
    try {
      return await withUiTimeout(
        window.autologin.login.recordingSaveStatus(),
        3_000,
        tr(
          '核对保存结果超时',
          'Checking the save result timed out.',
          '核對儲存結果逾時'
        )
      )
    } catch {
      return null
    }
  }

  async function finishRecording(): Promise<void> {
    if (!account || !recordingThisAccount || recordingAction) return
    if (recordingStepCount === 0) {
      setRecordingError(
        tr(
          '当前还没有捕捉到可回放步骤，请继续在浏览器中完成登录',
          'No replayable steps were captured yet. Continue signing in through the browser.',
          '目前還沒有捕捉到可回放步驟，請繼續在瀏覽器中完成登入'
        )
      )
      return
    }
    const name = recordingName.trim()
    if (!name) {
      setRecordingError(tr('请填写流程名称', 'Enter a flow name.', '請填寫流程名稱'))
      return
    }
    if (recipes.some((recipe) => recipe.name === name)) {
      setRecordingError(
        tr(
          '录制流程名称已存在，请换一个名称',
          'A recorded flow with this name already exists.',
          '錄製流程名稱已存在，請換一個名稱'
        )
      )
      return
    }
    const startedAt = Date.now()
    const initialStage = tr(
      '正在提交保存请求',
      'Submitting the save request',
      '正在提交儲存請求'
    )
    setRecordingAction('finish')
    setRecordingError('')
    setRecordingSaveFailed(false)
    setRecordingSaveStage(initialStage)
    recordingSaveStageRef.current = initialStage
    let saveStatus: RecordingSaveStatus | null = null
    try {
      const result = await withUiTimeout(
        window.autologin.login.finishRecording(name),
        21_000,
        tr(
          '保存录制流程未完成（已等待 21 秒）',
          'Saving the recorded flow did not finish within 21 seconds.',
          '儲存錄製流程未完成（已等待 21 秒）'
        )
      )
      if (result.draftSaved && !result.saved) {
        completeRecordingDraftSave(
          tr(
            '保险库暂未写入，录制草稿已保存；重启后会自动恢复',
            'The vault write did not finish, but the recording draft is safely saved and will recover after restart.',
            '保險庫暫未寫入，錄製草稿已儲存；重新啟動後會自動恢復'
          )
        )
        return
      }
      if (!result.saved || !result.recipeId) {
        setRecordingError(
          tr(
            '没有捕捉到可回放步骤，请返回浏览器完成一次登录操作',
            'No replayable steps were captured. Return to the browser and complete a sign-in.',
            '沒有捕捉到可回放步驟，請返回瀏覽器完成一次登入操作'
          )
        )
        setRecordingSaveFailed(true)
        return
      }
      completeRecordingSave(
        result,
        name,
        tr(
          '录制流程已保存并启用',
          'Recorded flow saved and enabled.',
          '錄製流程已儲存並啟用'
        )
      )
    } catch (reason) {
      let rawMessage =
        reason instanceof Error
          ? reason.message
          : tr('保存录制流程失败', 'Could not save the recorded flow.', '儲存錄製流程失敗')
      const checkingStage = tr(
        '保存请求尚未返回，正在核对本地写入状态…',
        'The save request has not returned; checking the local write status...',
        '儲存請求尚未返回，正在核對本機寫入狀態…'
      )
      recordingSaveStageRef.current = checkingStage
      setRecordingSaveStage(checkingStage)
      saveStatus = await readRecordingSaveStatus()
      const statusDeadline = Date.now() + 15_000
      while (
        (saveStatus === null || saveStatus.state === 'saving') &&
        Date.now() < statusDeadline
      ) {
        const detail = saveStatus?.stage
        const writingStage = detail
          ? tr(
              `后台进度：${detail}（请勿重复点击）`,
              `Backend stage: ${detail} (do not submit again)`,
              `後台進度：${detail}（請勿重複點擊）`
            )
          : tr(
              '等待后台响应，请勿重复点击…',
              'Waiting for the backend; do not submit again...',
              '等待後台回應，請勿重複點擊…'
            )
        recordingSaveStageRef.current = writingStage
        setRecordingSaveStage(writingStage)
        await new Promise<void>((resolve) => window.setTimeout(resolve, 750))
        saveStatus = await readRecordingSaveStatus()
      }
      if (saveStatus?.state === 'idle') {
        rawMessage = tr(
          '后台没有收到这次保存请求（可能已与界面断开）。请重启软件后确认流程是否已保存。',
          'The backend never received this save request. Restart the app and check whether the flow was saved.',
          '後台沒有收到這次儲存請求。請重新啟動軟體後確認流程是否已儲存。'
        )
      }
      if (
        saveStatus?.state === 'saved' &&
        saveStatus.result?.saved &&
        saveStatus.result.recipeId
      ) {
        completeRecordingSave(
          saveStatus.result,
          name,
          tr(
            '检测到流程已保存并启用',
            'The recorded flow was saved and enabled.',
            '偵測到流程已儲存並啟用'
          )
        )
        return
      }
      if (saveStatus?.state === 'draft_saved') {
        completeRecordingDraftSave(
          tr(
            '保险库暂未写入，录制草稿已保存；重启后会自动恢复',
            'The vault write did not finish, but the recording draft is safely saved and will recover after restart.',
            '保險庫暫未寫入，錄製草稿已儲存；重新啟動後會自動恢復'
          )
        )
        return
      }
      if (saveStatus?.state === 'failed' && saveStatus.error) {
        rawMessage = saveStatus.error
      } else if (saveStatus?.state === 'saving') {
        const pendingStage = tr(
          '保存仍在后台进行',
          'The save is still running in the background',
          '儲存仍在背景進行'
        )
        recordingSaveStageRef.current = pendingStage
        setRecordingSaveStage(pendingStage)
      }
      const stage =
        recordingSaveStageRef.current ||
        tr('提交保存请求', 'Submitting the save request', '提交儲存請求')
      const seconds = Math.max(0, (Date.now() - startedAt) / 1000).toFixed(1)
      const stillSaving = saveStatus?.state === 'saving'
      const message = `${rawMessage} ${tr(
        '当前阶段',
        'Current stage',
        '目前階段'
      )}：${stage}；${tr('已等待', 'Waited', '已等待')} ${seconds} ${
        stillSaving
          ? tr(
              '秒。保存仍在后台进行，请勿重复点击；可关闭编辑页，稍后从顶部录制浮条或通知确认结果。',
              'seconds. The save is still running in the background. Do not submit again; close the editor and confirm later from the top recording bar or notification.',
              '秒。儲存仍在背景進行，請勿重複點擊；可關閉編輯頁，稍後從頂部錄製浮條或通知確認結果。'
            )
          : tr(
              '秒。数据可能已写入，也可能尚未写入；可重试保存，或先关闭编辑页并从顶部录制浮条继续。',
              'seconds. The data may or may not have been saved. Retry, or close the editor and continue from the top recording bar.',
              '秒。資料可能已寫入，也可能尚未寫入；可重試儲存，或先關閉編輯頁並從頂部錄製浮條繼續。'
            )
      }`
      setRecordingSaveFailed(true)
      setRecordingError(message)
      notify('error', message)
      void window.autologin.app
        .reportUiFailure({
          context: tr('保存录制流程', 'Save recorded flow', '儲存錄製流程'),
          message,
          durationMs: Date.now() - startedAt
        })
        .catch(() => undefined)
    } finally {
      setRecordingAction(null)
    }
  }

  async function testManualStep(step: RecipeStep): Promise<void> {
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
    const selector = manualStepSelector(step).trim()
    if (!selector) {
      notify(
        'info',
        tr('请先填写定位器', 'Enter a selector first.', '請先填寫定位器')
      )
      return
    }
    const field = selectorTestFieldForAction(step.type)
    setSelectorTesting(step.id)
    try {
      const result = await window.autologin.login.testSelector({
        accountId: account.id,
        field,
        selector,
        url: startUrl.trim() || undefined
      })
      setSelectorTests((current) => ({ ...current, [step.id]: result }))
      notify(result.found ? 'success' : 'error', result.message)
    } catch (reason) {
      const message =
        reason instanceof Error
          ? reason.message
          : tr('定位器测试失败', 'Element test failed.', '定位器測試失敗')
      setSelectorTests((current) => ({
        ...current,
        [step.id]: { found: false, visible: false, count: 0, message }
      }))
      notify('error', message)
    } finally {
      setSelectorTesting(null)
    }
  }

  async function testRecipeStep(step: RecipeStep): Promise<void> {
    if (!account || !recipeDetails) return
    const selector = manualStepSelector(step).trim()
    if (!selector) {
      notify(
        'info',
        tr('请先填写定位器', 'Enter a selector first.', '請先填寫定位器')
      )
      return
    }
    setRecipeStepTesting(step.id)
    try {
      const result = await window.autologin.login.testSelector({
        accountId: account.id,
        field: selectorTestFieldForAction(step.type),
        selector,
        url: recipeDetails.recipe.startUrl || startUrl.trim() || undefined
      })
      setRecipeStepTests((current) => ({ ...current, [step.id]: result }))
      notify(result.found ? 'success' : 'error', result.message)
    } catch (reason) {
      const message =
        reason instanceof Error
          ? reason.message
          : tr('定位器测试失败', 'Element test failed.', '定位器測試失敗')
      setRecipeStepTests((current) => ({
        ...current,
        [step.id]: { found: false, visible: false, count: 0, message }
      }))
      notify('error', message)
    } finally {
      setRecipeStepTesting(null)
    }
  }

  return (
    <>
      <section
        className="account-editor-page account-drawer"
        aria-labelledby="account-drawer-title"
      >
          <header className="details-header account-drawer__header">
            <div className="details-identity">
              <SiteMark
                site={{
                  id: (account?.siteId ?? selectedSiteId) || 'new-site',
                  name: siteName || selectedSite?.name || account?.site.name || '?',
                  icon: siteIcon || undefined
                }}
              />
              <div>
                <span className="eyebrow">
                  {isBookmark
                    ? mode === 'edit'
                      ? 'BOOKMARK DETAILS'
                      : 'NEW BOOKMARK'
                    : mode === 'edit'
                      ? 'SITE DETAILS'
                      : 'NEW CREDENTIAL'}
                </span>
                <h2 id="account-drawer-title">
                  {mode === 'edit'
                    ? siteName || account?.site.name
                    : isBookmark
                      ? tr('添加书签', 'Add bookmark', '新增書籤')
                      : tr('添加登录账号', 'Add account', '新增登入帳號')}
                </h2>
                <span className="domain-label">
                  <Globe2 size={12} />
                  {safeHostname(startUrl) ||
                    tr('地址未设置', 'Address not set', '位址未設定')}
                </span>
              </div>
            </div>
            <button
              className="icon-button icon-button--small"
              onClick={requestDrawerClose}
              aria-label={tr('关闭', 'Close', '關閉')}
            >
              <X size={17} />
            </button>
          </header>


          <form className="account-form account-drawer__form" onSubmit={submit}>
            <div className="account-drawer__body">
            {!account && (
              <div className="account-editor-choice-row">
                <span className="account-editor-row-label">
                  {tr('站点来源', 'Site source', '站點來源')}
                </span>
                <div
                  className="segmented-control"
                  aria-label={tr('站点来源', 'Site source', '站點來源')}
                >
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
              </div>
            )}

            <div className="account-form__grid">
              {!account && siteMode === 'existing' && (
                <div className="field account-form__span-2">
                  <span className="field__label">{tr('选择站点', 'Select site', '選擇站點')}</span>
                  <div className="site-picker" ref={sitePickerRef}>
                    <button
                      type="button"
                      className={`site-picker__trigger${sitePickerOpen ? ' is-open' : ''}`}
                      aria-label={tr('选择站点', 'Select site', '選擇站點')}
                      aria-haspopup="listbox"
                      aria-expanded={sitePickerOpen}
                      onClick={() => {
                        if (!sitePickerOpen) setSitePickerQuery('')
                        setSitePickerOpen((current) => !current)
                      }}
                    >
                      <Globe2 size={17} />
                      <span>
                        <strong>
                          {selectedSite?.name ??
                            tr('请选择已有站点', 'Choose an existing site', '請選擇現有站點')}
                        </strong>
                        <small>
                          {selectedSite
                            ? safeHostname(selectedSite.startUrl) ||
                              tr('地址未设置', 'Address not set', '位址未設定')
                            : tr('从本地站点中选择', 'Choose from saved sites', '從本機站點中選擇')}
                        </small>
                      </span>
                      <ChevronDown
                        size={16}
                        className={sitePickerOpen ? 'is-open' : ''}
                      />
                    </button>
                    {sitePickerOpen && (
                      <div
                        className="site-picker__menu"
                        role="listbox"
                        aria-label={tr('已有站点列表', 'Saved sites', '現有站點清單')}
                      >
                        <label className="site-picker__search">
                          <Search size={14} />
                          <input
                            value={sitePickerQuery}
                            onChange={(event) => setSitePickerQuery(event.target.value)}
                            data-app-search
                            data-app-search-priority={40}
                            aria-keyshortcuts="Control+F"
                            onKeyDown={(event) => {
                              if (event.key === 'Enter') event.preventDefault()
                            }}
                            placeholder={tr('搜索站点名称或地址', 'Search site name or URL', '搜尋站點名稱或網址')}
                            aria-label={tr('搜索已有站点', 'Search saved sites', '搜尋現有站點')}
                            autoFocus
                          />
                          {sitePickerQuery && (
                            <button
                              type="button"
                              onClick={() => setSitePickerQuery('')}
                              aria-label={tr('清空搜索', 'Clear search', '清除搜尋')}
                            >
                              <X size={13} />
                            </button>
                          )}
                        </label>
                        <div className="site-picker__results">
                        {filteredSiteOptions.map((site) => (
                          <button
                            type="button"
                            role="option"
                            key={site.id}
                            aria-selected={site.id === selectedSiteId}
                            className={site.id === selectedSiteId ? 'is-selected' : ''}
                            onClick={() => handleSiteChange(site.id)}
                          >
                            <SiteMark site={site} />
                            <span>
                              <strong>{site.name}</strong>
                              <small>
                                {safeHostname(site.startUrl) ||
                                  tr('地址未设置', 'Address not set', '位址未設定')}
                              </small>
                            </span>
                            {site.id === selectedSiteId && <Check size={14} />}
                          </button>
                        ))}
                        {filteredSiteOptions.length === 0 && (
                          <span className="site-picker__empty">
                            {tr('没有匹配的站点', 'No matching sites', '沒有符合的站點')}
                          </span>
                        )}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}

              <label className={`field${fieldErrors.siteName ? ' is-invalid' : ''}`}>
                <span className="field__label">
                  {tr('站点名称', 'Site name', '站點名稱')}
                  <span className="field__badge is-required">
                    {tr('必填', 'Required', '必填')}
                  </span>
                </span>
                <span className="input-shell">
                  <Globe2 size={17} />
                  <input
                    value={siteName}
                    onChange={(event) => {
                      setSiteName(event.target.value)
                      if (fieldErrors.siteName) {
                        setFieldErrors((current) => ({ ...current, siteName: undefined }))
                      }
                    }}
                    placeholder={tr('例如：工作台', 'e.g. Workspace', '例如：工作台')}
                    autoFocus={mode === 'edit' && !focusField}
                    aria-invalid={fieldErrors.siteName ? true : undefined}
                  />
                </span>
                {fieldErrors.siteName && (
                  <p className="field__error" role="alert">
                    {fieldErrors.siteName}
                  </p>
                )}
              </label>
              <label className={`field${fieldErrors.startUrl ? ' is-invalid' : ''}`}>
                <span className="field__label">
                  {tr('登录地址', 'Sign-in URL', '登入網址')}
                  <span className="field__badge">{tr('选填', 'Optional', '選填')}</span>
                  <small>
                    {tr(
                      '可留空，保存后会标记为待补全',
                      'Optional; saved as needs review when empty',
                      '可留空，儲存後會標記為待補全'
                    )}
                  </small>
                </span>
                <span className="input-shell">
                  <span className="protocol-mark">URL</span>
                  <input
                    ref={startUrlRef}
                    value={startUrl}
                    onChange={(event) => {
                      setStartUrl(event.target.value)
                      if (fieldErrors.startUrl) {
                        setFieldErrors((current) => ({ ...current, startUrl: undefined }))
                      }
                    }}
                    onBlur={deriveSiteName}
                    placeholder="https://example.com/login"
                    spellCheck={false}
                    aria-invalid={fieldErrors.startUrl ? true : undefined}
                  />
                </span>
                {fieldErrors.startUrl && (
                  <p className="field__error" role="alert">
                    {fieldErrors.startUrl}
                  </p>
                )}
              </label>

              <div className="field site-icon-field">
                <span className="field__label">
                  {tr('账号图标', 'Account icon', '帳號圖示')}
                </span>
                <div className="site-icon-editor">
                  <SiteMark
                    site={{
                      id: (account?.siteId ?? selectedSiteId) || 'new-site',
                      name: siteName || tr('新站点', 'New site', '新站點'),
                      icon: siteIcon || undefined
                    }}
                    className="site-icon-editor__preview"
                  />
                  <div className="site-icon-editor__body">
                    <span>
                      {tr(
                        '上传本地图片，或从当前登录地址获取网站图标。',
                        'Upload a local image or download the icon from the sign-in URL.',
                        '上傳本機圖片，或從目前登入網址取得網站圖示。'
                      )}
                    </span>
                    <small>
                      {tr(
                        '支持 PNG、JPG、WebP、GIF、SVG、ICO，最大 512 KB',
                        'PNG, JPG, WebP, GIF, SVG or ICO up to 512 KB',
                        '支援 PNG、JPG、WebP、GIF、SVG、ICO，最大 512 KB'
                      )}
                    </small>
                    <div className="site-icon-editor__actions">
                      <input
                        ref={iconFileRef}
                        type="file"
                        accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml,image/x-icon,.ico"
                        className="site-icon-editor__file-input"
                        hidden
                        aria-label={tr('上传账号图标文件', 'Upload account icon file', '上傳帳號圖示檔案')}
                        onChange={(event) => void selectSiteIcon(event)}
                        disabled={iconBusy}
                      />
                      <button
                        type="button"
                        className="button button--ghost button--small"
                        onClick={() => iconFileRef.current?.click()}
                        disabled={iconBusy}
                      >
                        <ImagePlus size={14} />
                        {tr('上传图标', 'Upload icon', '上傳圖示')}
                      </button>
                      <button
                        type="button"
                        className="button button--ghost button--small"
                        onClick={() => void fetchWebsiteIcon()}
                        disabled={iconBusy}
                        aria-busy={iconBusy}
                      >
                        {iconBusy ? (
                          <LoaderCircle
                            size={14}
                            className="spin site-icon-fetch-spin"
                          />
                        ) : (
                          <Download size={14} />
                        )}
                        {iconBusy
                          ? tr('正在获取…', 'Downloading…', '正在取得…')
                          : tr('获取网站图标', 'Get site icon', '取得網站圖示')}
                      </button>
                      {siteIcon && (
                        <button
                          type="button"
                          className="button button--danger-ghost button--small"
                          onClick={() => setSiteIcon('')}
                          disabled={iconBusy}
                        >
                          <Trash2 size={14} />
                          {tr('移除图标', 'Remove icon', '移除圖示')}
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              </div>

              <div className="field">
                <span className="field__label">{tr('站点分组（可选）', 'Site group (optional)', '站點分組（選填）')}</span>
                <div className="site-picker group-picker" ref={groupPickerRef}>
                  <button
                    type="button"
                    className={`site-picker__trigger${groupPickerOpen ? ' is-open' : ''}`}
                    aria-label={tr('站点分组', 'Site group', '站點分組')}
                    aria-haspopup="listbox"
                    aria-expanded={groupPickerOpen}
                    onClick={() => {
                      if (!groupPickerOpen) setGroupPickerQuery('')
                      setGroupPickerOpen((current) => !current)
                    }}
                  >
                    <Layers3 size={17} />
                    <span>
                      <strong>{siteGroup || tr('未分组', 'Ungrouped', '未分組')}</strong>
                      <small>
                        {siteGroup
                          ? tr('当前分组', 'Current group', '目前分組')
                          : tr('默认分组', 'Default group', '預設分組')}
                      </small>
                    </span>
                    <ChevronDown
                      size={16}
                      className={groupPickerOpen ? 'is-open' : ''}
                    />
                  </button>
                  {groupPickerOpen && (
                    <div
                      className="site-picker__menu group-picker__menu"
                      role="listbox"
                      aria-label={tr('站点分组列表', 'Site groups', '站點分組清單')}
                    >
                      <label className="site-picker__search">
                        <Search size={14} />
                        <input
                          value={groupPickerQuery}
                          onChange={(event) => setGroupPickerQuery(event.target.value)}
                          data-app-search
                          data-app-search-priority={40}
                          aria-keyshortcuts="Control+F"
                          onKeyDown={(event) => {
                            if (event.key === 'Enter') event.preventDefault()
                          }}
                          placeholder={tr('搜索分组', 'Search groups', '搜尋分組')}
                          aria-label={tr('搜索站点分组', 'Search site groups', '搜尋站點分組')}
                          autoFocus
                        />
                        {groupPickerQuery && (
                          <button
                            type="button"
                            onClick={() => setGroupPickerQuery('')}
                            aria-label={tr('清空搜索', 'Clear search', '清除搜尋')}
                          >
                            <X size={13} />
                          </button>
                        )}
                      </label>
                      <div className="site-picker__results">
                      <button
                        type="button"
                        role="option"
                        aria-selected={siteGroup === ''}
                        className={siteGroup === '' ? 'is-selected' : ''}
                        onClick={() => {
                          setSiteGroup('')
                          setGroupPickerOpen(false)
                        }}
                      >
                        <Layers3 size={15} />
                        <span>
                          <strong>{tr('未分组', 'Ungrouped', '未分組')}</strong>
                          <small>{tr('不归入站点分组', 'No site group', '不歸入站點分組')}</small>
                        </span>
                        {siteGroup === '' && <Check size={14} />}
                      </button>
                      {filteredGroupOptions.map((group) => (
                        <button
                          type="button"
                          role="option"
                          key={group.path}
                          aria-selected={group.path === siteGroup}
                          className={group.path === siteGroup ? 'is-selected' : ''}
                          onClick={() => {
                            setSiteGroup(group.path)
                            setGroupPickerOpen(false)
                          }}
                        >
                          <Layers3 size={15} />
                          <span>
                            <strong>{group.path}</strong>
                            <small>{tr('站点分组', 'Site group', '站點分組')}</small>
                          </span>
                          {group.path === siteGroup && <Check size={14} />}
                        </button>
                      ))}
                      {filteredGroupOptions.length === 0 && (
                        <span className="site-picker__empty">
                          {tr('没有匹配的分组', 'No matching groups', '沒有符合的分組')}
                        </span>
                      )}
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {!isBookmark && (
                <>
                  <label className="field">
                    <span className="field__label">
                      {tr('用户名', 'Username', '使用者名稱')}
                      <span className="field__badge">{tr('选填', 'Optional', '選填')}</span>
                      <small>
                        {tr(
                          '可留空，保存后会标记为待补全',
                          'Optional; saved as needs review when empty',
                          '可留空，儲存後會標記為待補全'
                        )}
                      </small>
                    </span>
                    <span className="input-shell">
                      <UserRound size={17} />
                      <input
                        ref={usernameRef}
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
                      <span className="field__badge">{tr('选填', 'Optional', '選填')}</span>
                      {mode === 'edit' ? (
                        <small>{tr('留空则保持不变', 'Leave blank to keep current', '留空則保持不變')}</small>
                      ) : (
                        <small>
                          {tr(
                            '可留空，保存后会标记为待补全',
                            'Optional; saved as needs review when empty',
                            '可留空，儲存後會標記為待補全'
                          )}
                        </small>
                      )}
                    </span>
                    <span className="input-shell">
                      <KeyRound size={17} />
                      <input
                        ref={passwordRef}
                        className="account-password-input"
                        type={
                          revealedPassword || (password && showPassword)
                            ? 'text'
                            : 'password'
                        }
                        value={password || revealedPassword}
                        onChange={(event) => {
                          hideRevealedPassword()
                          passwordEditedRef.current = true
                          setPassword(event.target.value)
                        }}
                        placeholder={
                          mode === 'edit'
                            ? tr(
                                '已保存密码，输入新密码以替换',
                                'Password saved. Enter a new one to replace it.',
                                '已儲存密碼，輸入新密碼以取代'
                              )
                            : tr('输入登录密码', 'Enter login password', '輸入登入密碼')
                        }
                        autoComplete="new-password"
                      />
                      <PasswordGeneratorPopover
                        notify={notify}
                        onApply={(value) => {
                          hideRevealedPassword()
                          passwordEditedRef.current = true
                          setPassword(value)
                          setShowPassword(true)
                          notify(
                            'success',
                            tr('已填入新密码', 'Generated password applied', '已填入新密碼')
                          )
                        }}
                      />
                      {account && (
                        <button
                          type="button"
                          className="input-text-action password-input__history"
                          onClick={() => {
                            hideRevealedPassword()
                            setCredentialHistoryOpen(true)
                          }}
                          aria-label={tr(
                            '查看账号密码历史',
                            'View credential history',
                            '查看帳號密碼歷史'
                          )}
                          title={tr(
                            '查看账号密码历史',
                            'View credential history',
                            '查看帳號密碼歷史'
                          )}
                        >
                          <History size={15} />
                          <span>{tr('历史记录', 'History', '歷史記錄')}</span>
                        </button>
                      )}
                      <button
                        type="button"
                        className="input-action"
                        onClick={() => {
                          if (password) {
                            setShowPassword((value) => !value)
                            return
                          }
                          void revealPassword()
                        }}
                        aria-label={
                          revealedPassword || (password && showPassword)
                            ? tr('隐藏密码', 'Hide password', '隱藏密碼')
                            : tr('显示密码', 'Show password', '顯示密碼')
                        }
                        title={
                          revealedPassword || (password && showPassword)
                            ? tr('隐藏密码', 'Hide password', '隱藏密碼')
                            : tr('显示密码', 'Show password', '顯示密碼')
                        }
                      >
                        {revealedPassword || (password && showPassword) ? (
                          <EyeOff size={17} />
                        ) : (
                          <Eye size={17} />
                        )}
                      </button>
                      {account && (
                        <button
                          type="button"
                          className="input-action"
                          onClick={() => void copyPassword()}
                          aria-label={tr('复制密码', 'Copy password', '複製密碼')}
                          title={tr('复制密码', 'Copy password', '複製密碼')}
                        >
                          <Copy size={16} />
                        </button>
                      )}
                    </span>
                  </label>

                  <div className="form-options account-form__span-2">
                    <label className="account-editor-check-row">
                      <input
                        type="checkbox"
                        checked={autoSubmit}
                        onChange={(event) => setAutoSubmit(event.target.checked)}
                      />
                      <span>
                        <strong>{tr('自动提交', 'Auto submit', '自動提交')}</strong>
                        <small>
                          {tr(
                            '检测到验证码时会自动暂停',
                            'Pauses when a challenge is detected',
                            '偵測到驗證碼時會自動暫停'
                          )}
                        </small>
                      </span>
                    </label>
                  </div>
                </>
              )}
            </div>

            {error && <p className="form-error">{error}</p>}

            {!isBookmark && (
              <>
                <section
                  className="account-login-strategy account-editor-choice-section"
                  aria-label={tr('登录配置', 'Login configuration', '登入設定')}
                >
                  <span className="account-editor-row-label">
                    {tr('登录配置', 'Login configuration', '登入設定')}
                  </span>
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
                        <strong>{tr('自动识别', 'Auto detect', '自動識別')}</strong>
                        <small>
                          {tr(
                            '自动识别登录表单；已录制流程会优先回放',
                            'Detect the login form, using recorded flows first when available',
                            '自動辨識登入表單；已錄製流程會優先回放'
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
                            '按顺序配置输入、点击和验证码步骤',
                            'Order input, click and challenge steps explicitly',
                            '按順序設定輸入、點擊和驗證碼步驟'
                          )}
                        </small>
                      </span>
                    </label>
                  </div>
                </section>

                <section
                  className="account-login-strategy account-editor-choice-section"
                  aria-label={tr('登录方式', 'Login method', '登入方式')}
                >
                  <span className="account-editor-row-label">
                    {tr('登录方式', 'Login method', '登入方式')}
                  </span>
                  <div className="proxy-mode-options account-strategy-options">
                    <label
                      className={`proxy-mode-option${loginBrowser === 'builtin' ? ' is-active' : ''}`}
                    >
                      <input
                        type="radio"
                        name="login-browser"
                        value="builtin"
                        checked={loginBrowser === 'builtin'}
                        onChange={() => setLoginBrowser('builtin')}
                      />
                      <span>
                        <strong>{tr('内置浏览器', 'Built-in browser', '內建瀏覽器')}</strong>
                        <small>
                          {tr(
                            '在 AutoLogin 内打开，可同时保留多个标签页',
                            'Open inside AutoLogin and keep multiple tabs open',
                            '在 AutoLogin 內開啟，可同時保留多個分頁'
                          )}
                        </small>
                      </span>
                    </label>
                    <label
                      className={`proxy-mode-option${loginBrowser === 'standalone' ? ' is-active' : ''}`}
                    >
                      <input
                        type="radio"
                        name="login-browser"
                        value="standalone"
                        checked={loginBrowser === 'standalone'}
                        onChange={() => setLoginBrowser('standalone')}
                      />
                      <span>
                        <strong>{tr('独立浏览器', 'Independent browser', '獨立瀏覽器')}</strong>
                        <small>
                          {tr(
                            '在系统默认浏览器中打开独立登录会话',
                            'Open an isolated session in the system default browser',
                            '在系統預設瀏覽器中開啟獨立登入工作階段'
                          )}
                        </small>
                      </span>
                    </label>
                  </div>
                </section>

                {account && loginStrategy === 'auto' && (
                <section
                  className={`drawer-recipes${recordingThisAccount ? ' is-recording' : ''}`}
                  aria-label={tr('录制流程', 'Recorded flows', '錄製流程')}
                >
                  <header className="drawer-recipes__header">
                    <div>
                      {recordingThisAccount && (
                        <span
                          className={`drawer-recording-dot${loginState?.recordingPaused ? ' is-paused' : ''}`}
                          aria-hidden="true"
                        />
                      )}
                      <strong>{tr('录制流程', 'Recorded flows', '錄製流程')}</strong>
                      <small>
                        {recordingThisAccount
                          ? `${recordingStepCount} ${tr('步', 'steps', '步')} · ${recordingElapsed}`
                          : `${recipes.length}/3 ${tr('已保存', 'saved', '已儲存')}`}
                      </small>
                    </div>
                    {!recordingThisAccount && onRecord && (
                      <button
                        type="button"
                        className="text-button"
                        onClick={() => void startRecording()}
                        disabled={recipes.length >= 3}
                      >
                        <CirclePlay size={14} />
                        {tr('录制新流程', 'Record new flow', '錄製新流程')}
                      </button>
                    )}
                  </header>

                  {recordingThisAccount ? (
                    <div className="drawer-recording">
                      <p className="drawer-recording__hint">
                        {loginState?.recordingPaused
                          ? tr(
                              '录制已暂停。点击“继续录制”后，新的页面操作才会被记录。',
                              'Recording is paused. Resume before performing more page actions.',
                              '錄製已暫停。點擊「繼續錄製」後，新的頁面操作才會被記錄。'
                            )
                          : tr(
                              '浏览器已在前台。建议依次录入：用户名 → 密码 → 提交按钮。',
                              'The browser is in the foreground. Capture username, password, then submit.',
                              '瀏覽器已在前景。建議依次錄入：使用者名稱 → 密碼 → 提交按鈕。'
                            )}
                      </p>
                      {recordingLong && (
                        <p className="drawer-recording__status is-warning">
                          {tr(
                            '录制已超过 5 分钟，是否仍在录制？如已完成，请点击“完成录制”。',
                            'Recording has run for more than 5 minutes. Select "Finish recording" when ready.',
                            '錄製已超過 5 分鐘，是否仍在錄製？如已完成，請點擊「完成錄製」。'
                          )}
                        </p>
                      )}
                      {loginState?.currentUrl.startsWith('http://') && (
                        <p className="drawer-recording__status">
                          {tr(
                            '当前页面使用 HTTP，浏览器可能阻止自动填充；可使用下方复制账号/密码后手动粘贴。',
                            'This page uses HTTP, so autofill may be blocked. Copy credentials below and paste manually.',
                            '目前頁面使用 HTTP，瀏覽器可能阻止自動填寫；可使用下方複製帳號/密碼後手動貼上。'
                          )}
                        </p>
                      )}
                      {!loginState?.originTrusted && loginState?.currentOrigin && (
                        <div className="drawer-recording__status is-warning">
                          <span>
                            {tr(
                              `当前域名 ${loginState.currentOrigin} 尚未信任`,
                              `This origin is not trusted yet: ${loginState.currentOrigin}`,
                              `目前網域 ${loginState.currentOrigin} 尚未信任`
                            )}
                          </span>
                          <button
                            type="button"
                            onClick={() => void trustCurrentOrigin()}
                            disabled={recordingAction !== null}
                          >
                            {recordingAction === 'trust' && (
                              <LoaderCircle size={12} className="spin" />
                            )}
                            {tr('信任当前域名', 'Trust origin', '信任目前網域')}
                          </button>
                        </div>
                      )}
                      {recordingSteps.length === 0 ? (
                        <div className="drawer-recording__empty">
                          <span className="drawer-recording-dot" aria-hidden="true" />
                          <span>
                            {tr(
                              '等待第一步操作，捕捉后会自动出现在这里',
                              'Waiting for the first action; captured steps appear here.',
                              '等待第一步操作，捕捉後會自動出現在這裡'
                            )}
                          </span>
                        </div>
                      ) : (
                        <ol className="drawer-recording__steps">
                          {recordingSteps.map((step, index) => (
                            <li key={step.id}>
                              <span className="drawer-recording__index">
                                {String(index + 1).padStart(2, '0')}
                              </span>
                              <strong>{recordingStepLabel(step, tr)}</strong>
                              <span className="drawer-recording__target">
                                {step.selectorLabel ??
                                  (step.type === 'acceptCertWarning'
                                    ? tr('浏览器证书提醒页', 'Browser certificate page', '瀏覽器憑證提醒頁')
                                    : '')}
                              </span>
                            </li>
                          ))}
                        </ol>
                      )}
                      {recordingSteps.some((step) => step.type === 'acceptCertWarning') && (
                        <p className="drawer-recording__warning">
                          {tr(
                            '此流程包含“跳过证书校验”，保存后会在流程列表显式标注。',
                            'This flow includes a certificate bypass and will be labeled after saving.',
                            '此流程包含「略過憑證驗證」，儲存後會在流程清單明確標註。'
                          )}
                        </p>
                      )}
                      <div className="drawer-recording__actions">
                        <button
                          type="button"
                          className="drawer-recording-action"
                          onClick={() => void toggleRecordingPause()}
                          disabled={recordingAction !== null}
                        >
                          {loginState?.recordingPaused ? <Play size={13} /> : <Pause size={13} />}
                          {loginState?.recordingPaused
                            ? tr('继续录制', 'Resume', '繼續錄製')
                            : tr('暂停', 'Pause', '暫停')}
                        </button>
                        <button
                          type="button"
                          className="drawer-recording-action"
                          onClick={() => void copyRecordingCredential('username')}
                          disabled={recordingAction !== null}
                        >
                          {recordingAction === 'username' ? (
                            <LoaderCircle size={13} className="spin" />
                          ) : (
                            <UserRound size={13} />
                          )}
                          {tr('复制账号', 'Copy username', '複製帳號')}
                        </button>
                        <button
                          type="button"
                          className="drawer-recording-action"
                          onClick={() => void copyRecordingCredential('password')}
                          disabled={recordingAction !== null}
                        >
                          {recordingAction === 'password' ? (
                            <LoaderCircle size={13} className="spin" />
                          ) : (
                            <KeyRound size={13} />
                          )}
                          {tr('复制密码', 'Copy password', '複製密碼')}
                        </button>
                        <button
                          type="button"
                          className="drawer-recording-action"
                          onClick={() => void undoRecordingStep()}
                          disabled={recordingAction !== null || recordingStepCount === 0}
                        >
                          {recordingAction === 'undo' ? (
                            <LoaderCircle size={13} className="spin" />
                          ) : (
                            <Undo2 size={13} />
                          )}
                          {tr('撤销上一步', 'Undo', '撤銷上一步')}
                        </button>
                        <button
                          type="button"
                          className="drawer-recording-action drawer-recording-action--finish"
                          onClick={openRecordingSummary}
                          disabled={recordingAction !== null}
                        >
                          {tr('完成录制', 'Finish recording', '完成錄製')}
                        </button>
                      </div>
                    </div>
                  ) : recipes.length === 0 ? (
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
                              <strong>
                                {recipe.name}
                                {recipe.recipe.steps.some(
                                  (step) => step.type === 'acceptCertWarning'
                                ) && (
                                  <em className="drawer-recipe-row__badge">
                                    {tr('含跳过证书校验', 'Certificate bypass', '含略過憑證驗證')}
                                  </em>
                                )}
                              </strong>
                              <small>
                                {recipe.recipe.steps.length} {tr('个步骤', 'steps', '個步驟')}
                                {active ? ` · ${tr('当前流程', 'Active', '目前流程')}` : ''}
                              </small>
                            </span>
                            <span className="drawer-recipe-row__actions">
                              <button
                                type="button"
                                className="text-button"
                                onClick={() => openRecipeDetails(recipe)}
                              >
                                {tr('编辑', 'Edit', '編輯')}
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
                    <ManualStepEditor
                      steps={manualSteps}
                      onChange={(nextSteps, invalidatedStepId) => {
                        setManualSteps(nextSteps)
                        if (!invalidatedStepId) return
                        setSelectorTests((current) => {
                          if (!current[invalidatedStepId]) return current
                          const next = { ...current }
                          delete next[invalidatedStepId]
                          return next
                        })
                      }}
                      selectorTests={selectorTests}
                      selectorTesting={selectorTesting}
                      onTest={(step) => void testManualStep(step)}
                    />
                  </section>
                )}
              </>
            )}
            </div>

            <div className="account-drawer__footer">
              <div className="account-drawer__actions">
                <button
                  type="button"
                  className="button button--ghost"
                  onClick={requestDrawerClose}
                >
                  {tr('取消', 'Cancel', '取消')}
                </button>
                <button
                  type="submit"
                  className={`button button--primary${busy ? ' is-loading' : ''}`}
                  disabled={busy || recordingThisAccount}
                  aria-busy={busy}
                >
                  {busy && <LoaderCircle size={14} className="spin" />}
                  {busy
                    ? tr('正在保存…', 'Saving…', '正在儲存…')
                    : mode === 'edit'
                      ? tr('保存修改', 'Save changes', '儲存變更')
                      : isBookmark
                        ? tr('添加书签', 'Add bookmark', '新增書籤')
                        : tr('添加账号', 'Add account', '新增帳號')}
                </button>
              </div>
            </div>
          </form>
      </section>

      {credentialHistoryOpen && account && (
        <CredentialHistoryDialog
          accountId={account.id}
          onClose={() => setCredentialHistoryOpen(false)}
          onRestored={(saved) => void applyRestoredCredentials(saved)}
          notify={notify}
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
          onClose={closeRecipeDetails}
          width="780px"
          className="recipe-details-modal"
        >
          <div className="recipe-details-meta">
            <span>
              {recipeDetails.recipe.steps.length} {tr('个步骤', 'steps', '個步驟')}
            </span>
            <span>
              {safeHostname(recipeDetails.recipe.startUrl) ||
                tr('地址未设置', 'Address not set', '位址未設定')}
            </span>
            {recipeDetails.id === activeRecipeId && (
              <strong>{tr('当前启用', 'Active', '目前啟用')}</strong>
            )}
          </div>
          <div className="recipe-details-steps" role="list">
            {recipeDetails.recipe.steps.length === 0 && (
              <div className="manual-step-empty">
                <ListChecks size={18} />
                <span>
                  {tr(
                    '这个流程还没有步骤。点击下方按钮添加第一条步骤。',
                    'This flow has no steps yet. Add one below.',
                    '這個流程還沒有步驟。點擊下方按鈕新增第一個步驟。'
                  )}
                </span>
              </div>
            )}
            {recipeDetails.recipe.steps.map((step, index) => {
              const result = recipeStepTests[step.id]
              return (
                <div
                  className={`manual-step-row recipe-details-step-row${
                    draggedRecipeStepId === step.id ? ' is-dragging' : ''
                  }`}
                  key={step.id}
                  role="listitem"
                  onDragOver={(event) => {
                    if (!draggedRecipeStepId) return
                    event.preventDefault()
                    event.dataTransfer.dropEffect = 'move'
                  }}
                  onDrop={(event) => {
                    event.preventDefault()
                    if (draggedRecipeStepId) {
                      moveRecipeStep(draggedRecipeStepId, step.id)
                    }
                    setDraggedRecipeStepId(null)
                  }}
                >
                  <span
                    className="manual-step-row__handle"
                    draggable
                    onDragStart={(event) => {
                      event.dataTransfer.effectAllowed = 'move'
                      event.dataTransfer.setData('text/plain', step.id)
                      setDraggedRecipeStepId(step.id)
                    }}
                    onDragEnd={() => setDraggedRecipeStepId(null)}
                    aria-label={tr(
                      `拖拽步骤 ${index + 1}`,
                      `Drag step ${index + 1}`,
                      `拖曳步驟 ${index + 1}`
                    )}
                    title={tr('拖拽排序', 'Drag to reorder', '拖曳排序')}
                  >
                    <GripVertical size={14} />
                  </span>
                  <select
                    className="filter-control manual-step-row__action"
                    aria-label={tr(
                      `步骤 ${index + 1} 动作类型`,
                      `Step ${index + 1} action`,
                      `步驟 ${index + 1} 動作類型`
                    )}
                    value={step.type}
                    onChange={(event) =>
                      changeRecipeStepType(
                        step.id,
                        event.target.value as ManualStepAction
                      )
                    }
                  >
                    {MANUAL_STEP_ACTIONS.map((action) => (
                      <option value={action} key={action}>
                        {manualStepActionLabel(action, tr)}
                      </option>
                    ))}
                  </select>
                  <span className="manual-step-row__selector-cell">
                    <span className="input-shell">
                      <SlidersHorizontal size={15} />
                      <input
                        aria-label={tr(
                          `步骤 ${index + 1} Selector`,
                          `Step ${index + 1} selector`,
                          `步驟 ${index + 1} Selector`
                        )}
                        value={manualStepSelector(step)}
                        onChange={(event) =>
                          updateRecipeStepSelector(step.id, event.target.value)
                        }
                        onBlur={() => persistCurrentRecipeDetails(false)}
                        placeholder={selectorPlaceholderForAction(step.type)}
                        spellCheck={false}
                        autoComplete="off"
                      />
                    </span>
                    {step.type === 'press' && (
                      <span className="input-shell manual-step-row__key-field">
                        <KeyRound size={15} />
                        <input
                          aria-label={tr(
                            `步骤 ${index + 1} 按键`,
                            `Step ${index + 1} key`,
                            `步驟 ${index + 1} 按鍵`
                          )}
                          value={step.key}
                          onChange={(event) =>
                            updateRecipeStepKey(step.id, event.target.value)
                          }
                          onBlur={() => persistCurrentRecipeDetails(false)}
                          placeholder="Enter"
                          spellCheck={false}
                          autoComplete="off"
                        />
                      </span>
                    )}
                    {result && (
                      <small
                        className={`selector-config-row__result${
                          result.found ? ' is-success' : ' is-error'
                        }`}
                      >
                        {result.message}
                      </small>
                    )}
                  </span>
                  <button
                    type="button"
                    className="button button--ghost button--small"
                    onClick={() => void testRecipeStep(step)}
                    disabled={
                      recipeStepTesting !== null ||
                      recipeBusy ||
                      !manualStepSelector(step).trim()
                    }
                  >
                    {recipeStepTesting === step.id ? (
                      <LoaderCircle size={13} className="spin" />
                    ) : (
                      <RefreshCw size={13} />
                    )}
                    {tr('测试', 'Test', '測試')}
                  </button>
                  <button
                    type="button"
                    className="icon-button icon-button--small manual-step-row__delete"
                    onClick={() => removeRecipeStep(step.id)}
                    disabled={recipeBusy}
                    aria-label={tr(
                      `删除步骤 ${index + 1}`,
                      `Delete step ${index + 1}`,
                      `刪除步驟 ${index + 1}`
                    )}
                    title={tr('删除步骤', 'Delete step', '刪除步驟')}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              )
            })}
          </div>
          <footer className="manual-selector-panel__footer recipe-details-modal__footer">
            <button
              type="button"
              className="button button--ghost button--small"
              onClick={addRecipeStep}
              disabled={recipeBusy || recipeDetails.recipe.steps.length >= 30}
            >
              <Plus size={13} />
              {tr('添加新步骤', 'Add new step', '新增步驟')}
            </button>
            <small>
              {recipeBusy
                ? tr('正在保存…', 'Saving…', '正在儲存…')
                : tr(
                    '修改后自动保存，可拖拽调整执行顺序',
                    'Changes save automatically. Drag to reorder.',
                    '修改後會自動儲存，可拖曳調整執行順序'
                  )}
            </small>
          </footer>
          <p className="modal-description">
            {tr(
              '这里只展示步骤类型与稳定选择器，不包含账号、密码、验证码或页面输入的真实内容。',
              'Only step types and stable selectors are shown. Credentials, verification codes and real page input are excluded.',
              '這裡只顯示步驟類型與穩定選擇器，不包含帳號、密碼、驗證碼或頁面輸入的真實內容。'
            )}
          </p>
        </Modal>
      )}

      {discardConfirmOpen && (
        <Modal
          title={tr(
            '放弃未保存的修改？',
            'Discard unsaved changes?',
            '放棄未儲存的變更？'
          )}
          width="460px"
          className="confirm-dialog"
          onClose={() => setDiscardConfirmOpen(false)}
        >
          <p className="modal-description">
            {tr(
              '关闭后，本次填写但尚未保存的站点、账号或登录配置会丢失。',
              'Anything you changed here but have not saved will be lost when you close the editor.',
              '關閉後，本次填寫但尚未儲存的站點、帳號或登入設定會遺失。'
            )}
          </p>
          <div className="modal-actions">
            <button
              type="button"
              className="button button--primary"
              onClick={() => setDiscardConfirmOpen(false)}
              data-autofocus
            >
              {tr('继续编辑', 'Keep editing', '繼續編輯')}
            </button>
            <button
              type="button"
              className="button button--danger-ghost"
              onClick={closeDrawerNow}
            >
              {tr('放弃修改', 'Discard changes', '放棄修改')}
            </button>
          </div>
        </Modal>
      )}

      {recordingFinishOpen && recordingThisAccount && (
        <Modal
          title={tr('保存录制流程', 'Save recorded flow', '儲存錄製流程')}
          eyebrow="RECORDING SUMMARY"
          width="560px"
          className="recording-summary-dialog"
          onClose={() => {
            setRecordingFinishOpen(false)
            setRecordingError('')
          }}
        >
          <div className="recording-summary">
            <div className="recording-summary__meta">
              <span>
                {recordingStepCount} {tr('个步骤', 'steps', '個步驟')}
              </span>
              <span>{recordingElapsed}</span>
              <span className="recording-summary__safe-status">
                <Check size={11} />
                {tr(
                  '草稿已实时保存到磁盘',
                  'Draft saved to disk in real time',
                  '草稿已即時儲存到磁碟'
                )}
              </span>
            </div>
            {recordingSteps.length === 0 ? (
              <p className="recording-summary__empty">
                {tr(
                  '还没有捕捉到可回放步骤。返回浏览器完成一次登录后再结束录制。',
                  'No replayable steps were captured. Complete a sign-in in the browser first.',
                  '還沒有捕捉到可回放步驟。返回瀏覽器完成一次登入後再結束錄製。'
                )}
              </p>
            ) : (
              <ol className="recording-summary__steps">
                {recordingSteps.map((step, index) => (
                  <li key={step.id}>
                    <span>{String(index + 1).padStart(2, '0')}</span>
                    <strong>{recordingStepLabel(step, tr)}</strong>
                    <small>
                      {step.selectorLabel ??
                        (step.type === 'acceptCertWarning'
                          ? tr('浏览器证书提醒页', 'Browser certificate page', '瀏覽器憑證提醒頁')
                          : tr('页面操作', 'Page action', '頁面操作'))}
                    </small>
                  </li>
                ))}
              </ol>
            )}
            <label className="field recording-summary__name">
              <span className="field__label">
                {tr('流程名称', 'Flow name', '流程名稱')}
              </span>
              <span className="input-shell">
                <ListChecks size={15} />
                <input
                  value={recordingName}
                  onChange={(event) => {
                    setRecordingName(event.target.value)
                    setRecordingError('')
                  }}
                  maxLength={60}
                  autoFocus
                  placeholder={tr('例如：生产环境登录', 'For example: Production sign-in', '例如：生產環境登入')}
                />
              </span>
            </label>
            <p className="recording-summary__privacy">
              {tr(
                '摘要只展示步骤类型与定位信息，不包含账号、密码或页面输入的明文。',
                'The summary only contains step types and selectors, never credentials or entered values.',
                '摘要只顯示步驟類型與定位資訊，不包含帳號、密碼或頁面輸入的明文。'
              )}
            </p>
            {recordingAction === 'finish' && (
              <div className="recording-save-progress" role="status" aria-live="polite">
                <LoaderCircle size={14} className="spin" />
                <span>
                  <strong>{recordingSaveStage}</strong>
                  <small>
                    {tr(
                      '保存期间可以关闭摘要或编辑页；录制状态会保留在顶部录制浮条。',
                      'You can close this summary or the editor while saving. Recording remains available in the top recording bar.',
                      '儲存期間可以關閉摘要或編輯頁；錄製狀態會保留在頂部錄製浮條。'
                    )}
                  </small>
                </span>
              </div>
            )}
            {recordingError && (
              <p className="form-error" role="alert">
                {recordingError}
              </p>
            )}
          </div>
          <div className="modal-actions">
            <button
              type="button"
              className="button button--ghost"
              onClick={() => {
                setRecordingFinishOpen(false)
                setRecordingError('')
              }}
              disabled={recordingAction === 'finish'}
            >
              {tr('继续录制', 'Continue recording', '繼續錄製')}
            </button>
            {recordingSaveFailed && (
              <button
                type="button"
                className="button button--danger-ghost"
                onClick={requestDrawerClose}
              >
                {tr('关闭编辑页', 'Close editor', '關閉編輯頁')}
              </button>
            )}
            <button
              type="button"
              className={`button button--primary${
                recordingAction === 'finish' ? ' is-loading' : ''
              }`}
              onClick={() => void finishRecording()}
              disabled={
                recordingAction !== null ||
                recordingStepCount === 0 ||
                !recordingName.trim()
              }
              aria-busy={recordingAction === 'finish'}
            >
              {recordingAction === 'finish' && (
                <LoaderCircle size={14} className="spin" />
              )}
              {recordingAction === 'finish'
                ? tr('正在保存…', 'Saving…', '正在儲存…')
                : tr('完成录制', 'Finish recording', '完成錄製')}
            </button>
          </div>
        </Modal>
      )}
    </>
  )
}

function safeHostname(value: string): string {
  try {
    const url = new URL(value)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return ''
    return url.hostname.replace(/^www\./, '')
  } catch {
    return ''
  }
}

function withUiTimeout<T>(
  promise: Promise<T>,
  milliseconds: number,
  message: string
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error(message)), milliseconds)
    promise.then(
      (value) => {
        window.clearTimeout(timer)
        resolve(value)
      },
      (reason: unknown) => {
        window.clearTimeout(timer)
        reject(reason)
      }
    )
  })
}

function isRecordingSaveStage(message: string): boolean {
  return (
    message.startsWith('正在整理录制步骤') ||
    message.startsWith('正在写入录制流程') ||
    message.startsWith('录制流程已保存') ||
    message.startsWith('保存录制流程失败')
  )
}

function normalizeOptionalStartUrl(value: string): string {
  const trimmed = value.trim()
  return trimmed === 'https://' || trimmed === 'http://' ? '' : trimmed
}

function describeOperationFailure(
  operation: string,
  stage: string,
  startedAt: number,
  reason: unknown,
  tr: (zhCN: string, en: string, zhTW: string) => string
): string {
  const raw =
    reason instanceof Error
      ? reason.message
      : tr('操作未完成', 'The operation did not finish.', '操作未完成')
  const seconds = Math.max(0, (Date.now() - startedAt) / 1000).toFixed(1)
  return `${operation}${tr('失败', ' failed', '失敗')}：${raw} ${tr(
    '当前阶段',
    'Current stage',
    '目前階段'
  )}：${stage}；${tr('已等待', 'Waited', '已等待')} ${seconds} ${tr(
    '秒。数据可能已写入，也可能尚未写入；关闭页面后重新打开即可确认。',
    'seconds. The data may or may not have been saved; reopen this page to confirm.',
    '秒。資料可能已寫入，也可能尚未寫入；關閉頁面後重新開啟即可確認。'
  )}`
}

function isValidHttpUrl(value: string): boolean {
  try {
    const url = new URL(value.trim())
    return (
      (url.protocol === 'http:' || url.protocol === 'https:') &&
      Boolean(url.hostname)
    )
  } catch {
    return false
  }
}

function defaultRecordingName(
  existingCount: number,
  tr: (zhCN: string, en: string, zhTW: string) => string
): string {
  return tr('录制流程 ', 'Recorded flow ', '錄製流程 ') + String(existingCount + 1)
}

function formatRecordingDuration(
  state: LoginViewState | null,
  now: number
): string {
  const totalSeconds = recordingDurationSeconds(state, now)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
}

function recordingDurationSeconds(state: LoginViewState | null, now: number): number {
  if (!state?.recordingStartedAt) return 0
  const startedAt = new Date(state.recordingStartedAt).getTime()
  const endedAt = state.recordingPausedAt
    ? new Date(state.recordingPausedAt).getTime()
    : now
  if (!Number.isFinite(startedAt) || !Number.isFinite(endedAt)) return 0
  return Math.max(0, Math.floor((endedAt - startedAt) / 1000))
}

function recordingStepLabel(
  step: RecordingStepSummary,
  tr: (zhCN: string, en: string, zhTW: string) => string
): string {
  switch (step.type) {
    case 'fillUsername':
      return tr('输入账号', 'Enter username', '輸入帳號')
    case 'fillPassword':
      return tr('输入密码', 'Enter password', '輸入密碼')
    case 'paste':
      return step.source === 'password'
        ? tr('粘贴密码', 'Paste password', '貼上密碼')
        : step.source === 'username'
          ? tr('粘贴账号', 'Paste username', '貼上帳號')
          : tr('粘贴文本', 'Paste text', '貼上文字')
    case 'focusChallenge':
      return tr('验证码 / 二次验证', 'Challenge / 2FA', '驗證碼 / 二次驗證')
    case 'acceptCertWarning':
      return tr('跳过证书提醒', 'Bypass certificate warning', '略過憑證提醒')
    case 'press':
      return tr('按键', 'Key press', '按鍵')
    case 'click':
      return tr('点击提交或跳转', 'Click submit or navigation', '點擊提交或跳轉')
    default:
      return tr('页面操作', 'Page action', '頁面操作')
  }
}

function normalizeRecipeStepsForSave(steps: RecipeStep[]): RecipeStep[] {
  return steps.map((step) => {
    if (step.type === 'acceptCertWarning') return step
    const selector = manualStepSelectorSpec(step)
    const candidate = selector.candidates[0]?.trim() ?? ''
    if (step.type === 'focusChallenge' && !candidate) {
      const { selector: _selector, ...withoutSelector } = step
      return withoutSelector
    }
    return {
      ...step,
      ...(step.type === 'press' ? { key: step.key.trim() } : {}),
      selector: {
        ...selector,
        candidates: candidate ? [candidate] : []
      }
    } as RecipeStep
  })
}

function recipeStepsCanBeSaved(steps: RecipeStep[]): boolean {
  return steps.every((step) => {
    if (step.type === 'acceptCertWarning') return true
    if (step.type === 'focusChallenge' && !('selector' in step)) return true
    const selector = manualStepSelector(step).trim()
    if (!selector) return false
    return step.type !== 'press' || Boolean(step.key.trim())
  })
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () =>
      typeof reader.result === 'string'
        ? resolve(reader.result)
        : reject(new Error('无法读取图片'))
    reader.onerror = () => reject(reader.error ?? new Error('无法读取图片'))
    reader.readAsDataURL(file)
  })
}
