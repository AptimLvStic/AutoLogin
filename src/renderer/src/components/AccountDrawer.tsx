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
  ImagePlus,
  KeyRound,
  Layers3,
  ListChecks,
  LoaderCircle,
  Plus,
  RefreshCw,
  Search,
  SlidersHorizontal,
  Trash2,
  UserRound,
  X
} from 'lucide-react'
import type {
  AccountRecipe,
  AccountWithSite,
  GroupDefinition,
  LoginStrategy,
  RecipeStep,
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
import { PasswordGeneratorPopover } from './PasswordGenerator'
import { SiteMark } from './SiteMark'

interface AccountDrawerProps {
  tabId: string
  mode: 'create' | 'edit'
  bookmarkMode?: boolean
  account?: AccountWithSite
  sites: Site[]
  groups: GroupDefinition[]
  initialSiteId?: string
  onClose: () => void
  onSaved: (account: AccountWithSite, message: string) => void
  onDeleted: () => void
  onRecord?: () => void
  onChanged: () => Promise<void>
  notify: (kind: 'success' | 'error' | 'info', message: string) => void
}

export function AccountDrawer({
  tabId,
  mode,
  bookmarkMode = false,
  account,
  sites,
  groups,
  initialSiteId,
  onClose,
  onSaved,
  onDeleted,
  onRecord,
  onChanged,
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
  const [username, setUsername] = useState(account?.username ?? '')
  const [password, setPassword] = useState('')
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
  const [iconBusy, setIconBusy] = useState(false)
  const revealTimer = useRef<number | null>(null)
  const sitePickerRef = useRef<HTMLDivElement>(null)
  const groupPickerRef = useRef<HTMLDivElement>(null)
  const iconFileRef = useRef<HTMLInputElement>(null)
  const recipeDetailsVersionRef = useRef(0)
  const latestRecipeDetailsRef = useRef<AccountRecipe | null>(null)
  const recipeSaveCountRef = useRef(0)
  const recipeSaveQueueRef = useRef<Promise<void>>(Promise.resolve())

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

  useEffect(() => {
    return () => {
      if (revealTimer.current) window.clearTimeout(revealTimer.current)
    }
  }, [])

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
    if (!/^https?:\/\//i.test(startUrl.trim())) {
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
    if (!siteName.trim() || (!isBookmark && !username.trim())) {
      setError(
        isBookmark
          ? tr('请填写站点名称', 'Enter a site name.', '請填寫站點名稱')
          : tr(
              '请填写站点名称和用户名',
              'Enter a site name and username.',
              '請填寫站點名稱和使用者名稱'
            )
      )
      return
    }
    if (!isBookmark && mode === 'create' && !password) {
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

    setBusy(true)
    try {
      let site: Site
      if (siteMode === 'new') {
        site = await window.autologin.sites.save({
          tabId,
          name: siteName.trim(),
          startUrl: startUrl.trim(),
          autoSubmit,
          group: siteGroup.trim() || undefined,
          ...(siteIcon ? { icon: siteIcon } : {})
        })
      } else {
        if (!selectedSite) throw new Error(tr('请选择站点', 'Select a site.', '請選擇站點'))
        const groupChanged = (selectedSite.group ?? '') !== siteGroup.trim()
        const siteChanged =
          selectedSite.name !== siteName.trim() ||
          selectedSite.startUrl !== startUrl.trim() ||
          selectedSite.autoSubmit !== autoSubmit ||
          (selectedSite.icon ?? '') !== siteIcon ||
          groupChanged
        site =
          !siteChanged
            ? selectedSite
            : await window.autologin.sites.save({
                id: selectedSite.id,
                tabId: selectedSite.tabId,
                name: siteName.trim(),
                startUrl: startUrl.trim(),
                allowedOrigins: selectedSite.allowedOrigins,
                autoSubmit,
                group: siteGroup.trim() || undefined,
                ...(siteIcon ? { icon: siteIcon } : {})
              })
      }

      let saved: AccountWithSite
      if (mode === 'edit' && account) {
        saved = await window.autologin.accounts.update(account.id, {
          label: site.name,
          ...(isBookmark
            ? {}
            : {
                username: username.trim(),
                loginStrategy,
                manualSteps:
                  loginStrategy === 'manual' ? normalizeManualSteps(manualSteps) : [],
                ...(password ? { password } : {})
              })
        })
        onSaved(
          saved,
          isBookmark
            ? tr('书签信息已更新', 'Bookmark updated.', '書籤資料已更新')
            : tr('账号信息已更新', 'Account updated.', '帳號資料已更新')
        )
      } else {
        saved = await window.autologin.accounts.create({
          siteId: site.id,
          label: site.name,
          username: isBookmark ? '' : username.trim(),
          password: isBookmark ? '' : password,
          loginStrategy: isBookmark ? 'auto' : loginStrategy,
          manualSteps:
            isBookmark || loginStrategy !== 'manual'
              ? []
              : normalizeManualSteps(manualSteps)
        })
        onSaved(
          saved,
          isBookmark
            ? tr('书签已加入保险库', 'Bookmark added to the vault.', '書籤已加入保險庫')
            : tr('账号已加入保险库', 'Account added to the vault.', '帳號已加入保險庫')
        )
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
                            ? safeHostname(selectedSite.startUrl)
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
                              <small>{safeHostname(site.startUrl)}</small>
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
                          ? tr('正在获取...', 'Downloading...', '正在取得...')
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
                      <PasswordGeneratorPopover
                        notify={notify}
                        onApply={(value) => {
                          setPassword(value)
                          setShowPassword(true)
                          notify(
                            'success',
                            tr('已填入新密码', 'Generated password applied', '已填入新密碼')
                          )
                        }}
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

            {!isBookmark && account && (
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

            {!isBookmark && (
              <>
                <section
                  className="account-login-strategy account-editor-choice-section"
                  aria-label={tr('登录方式', 'Login method', '登入方式')}
                >
                  <span className="account-editor-row-label">
                    {tr('登录方式', 'Login method', '登入方式')}
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

                {account && loginStrategy === 'auto' && (
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
              <div className="account-drawer__management">
                {account && (
                  <>
                    {!isBookmark && (
                      <button type="button" className="text-button" onClick={() => setConfirmClear(true)}>
                        <RefreshCw size={14} />
                        {tr('清除会话', 'Clear session', '清除工作階段')}
                      </button>
                    )}
                    <button
                      type="button"
                      className="text-button text-button--danger"
                      onClick={() => setConfirmDelete(true)}
                    >
                      <Trash2 size={14} />
                      {isBookmark
                        ? tr('删除站点', 'Delete site', '刪除站點')
                        : tr('删除账号', 'Delete account', '刪除帳號')}
                    </button>
                  </>
                )}
              </div>
              <div className="account-drawer__actions">
                <button
                  type="button"
                  className="button button--ghost"
                  onClick={onClose}
                  disabled={busy}
                >
                  {tr('取消', 'Cancel', '取消')}
                </button>
                <button type="submit" className="button button--primary" disabled={busy}>
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

      {confirmDelete && (
        <ConfirmDialog
          title={
            isBookmark
              ? tr('删除这个站点？', 'Delete this site?', '刪除這個站點？')
              : tr('删除这个账号？', 'Delete this account?', '刪除這個帳號？')
          }
          description={
            isBookmark
              ? tr(
                  '站点会移入回收站，书签记录可稍后从主菜单的回收站恢复。',
                  'The site will move to Recycle Bin and can be restored later from the main menu.',
                  '站點會移至回收站，書籤記錄可稍後從主選單的回收站恢復。'
                )
              : tr(
                  '账号会移入回收站，独立网站会话将被清除；之后可从主菜单的回收站恢复。',
                  'The account will move to Recycle Bin and its website session will be cleared. You can restore it later from the main menu.',
                  '帳號會移至回收站，獨立網站工作階段將被清除；之後可從主選單的回收站恢復。'
                )
          }
          confirmLabel={
            isBookmark
              ? tr('删除站点', 'Delete site', '刪除站點')
              : tr('删除账号', 'Delete account', '刪除帳號')
          }
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
          onClose={closeRecipeDetails}
          width="780px"
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

function normalizeRecipeStepsForSave(steps: RecipeStep[]): RecipeStep[] {
  return steps.map((step) => {
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
