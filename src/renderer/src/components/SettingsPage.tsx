import { useEffect, useRef, useState } from 'react'
import type { Notify } from './Toast'
import {
  ArchiveRestore,
  Check,
  Database,
  Download,
  FolderOpen,
  Info,
  Keyboard,
  KeyRound,
  Languages,
  LoaderCircle,
  LockKeyhole,
  Monitor,
  Moon,
  Network,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
  SlidersHorizontal,
  Sun,
  Trash2,
  TriangleAlert,
  Type
} from 'lucide-react'
import {
  AUTO_LOCK_OPTIONS,
  DEFAULT_PROXY_TEST_URL,
  FONT_SIZE_SCALE_OPTIONS,
  INTERFACE_SCALE_STEP,
  PROXY_PROTOCOLS,
  type AboutInfo,
  type AppLanguage,
  type AppSettings,
  type AppSettingsPatch,
  type AppUpdateState,
  type AutoLockMinutes,
  type BackupLocationInfo,
  type BackupRecord,
  type ColorMode,
  type DatabaseInfo,
  type DataLocationConflictAction,
  type DataLocationInfo,
  type ProxySettings,
  type ProxyTestResult,
  type UpdateCheckResult
} from '@shared/types'
import {
  DEFAULT_APP_SETTINGS,
  INTERFACE_SCALE_DISPLAY_MAX,
  INTERFACE_SCALE_DISPLAY_MIN,
  interfaceScaleActualToDisplay,
  interfaceScaleDisplayToActual
} from '@shared/theme'
import {
  displayKeyboardShortcut,
  shortcutFromKeyboardEvent
} from '@shared/shortcuts'
import { translate, useI18n } from '../i18n'
import { ConfirmDialog, Modal } from './Modal'
import { InfoTip } from './InfoTip'
import { PasswordStrength } from './PasswordStrength'
import { DatabasePasswordDialog } from './DatabasePasswordDialog'
import { UpdateProgress } from './UpdateDialog'
import { LoadingSpinner } from './LoadingSpinner'

export type SettingsModule =
  | 'general'
  | 'network'
  | 'security'
  | 'data'
  | 'about'

type SettingSavePhase = 'saving' | 'saved' | 'error'

type DatabasePasswordEditor = {
  tabId: string
  current: string
  next: string
  confirm: string
  busy: boolean
  error: string
}

type DatabaseBackupEditor = {
  tabId: string
  name: string
  password: string
  confirm: string
  busy: boolean
  error: string
}

function formatDatabaseSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '—'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

export function SettingsPage({
  module,
  settings,
  appVersion,
  updateState,
  onModuleChange,
  onSettingsChange,
  onRefresh,
  activeTabId,
  activeTabName,
  onClearAllData,
  onDownloadUpdate,
  onCancelUpdate,
  onInstallUpdate,
  onVaultStatusChange,
  onDatabasesChanged,
  onUnlockDatabase,
  notify
}: {
  module: SettingsModule
  settings: AppSettings
  appVersion: string
  updateState: AppUpdateState | null
  onModuleChange: (module: SettingsModule) => void
  onSettingsChange: (patch: AppSettingsPatch) => Promise<void>
  onRefresh: () => Promise<void>
  activeTabId: string
  activeTabName: string
  onClearAllData: () => Promise<void>
  onDownloadUpdate: () => Promise<void>
  onCancelUpdate: () => Promise<void>
  onInstallUpdate: () => Promise<void>
  onVaultStatusChange: () => Promise<void>
  onDatabasesChanged: () => Promise<void>
  onUnlockDatabase: (tabId: string, password: string) => Promise<void>
  notify: Notify
}): React.JSX.Element {
  const { tr, formatDate } = useI18n()
  const [autoLock, setAutoLock] = useState<AutoLockMinutes>(settings.autoLockMinutes)
  const [databases, setDatabases] = useState<DatabaseInfo[] | null>(null)
  const [databasesError, setDatabasesError] = useState('')
  const [passwordEditor, setPasswordEditor] = useState<DatabasePasswordEditor | null>(null)
  const [backupEditor, setBackupEditor] = useState<DatabaseBackupEditor | null>(null)
  const [removeTarget, setRemoveTarget] = useState<DatabaseInfo | null>(null)
  const [unlockTarget, setUnlockTarget] = useState<DatabaseInfo | null>(null)
  const [removingDatabase, setRemovingDatabase] = useState(false)
  const [lockingTabId, setLockingTabId] = useState('')
  const [clearOpen, setClearOpen] = useState(false)
  const [clearBusy, setClearBusy] = useState(false)
  const [about, setAbout] = useState<AboutInfo | null>(null)
  const [dataLocation, setDataLocation] = useState<DataLocationInfo | null>(null)
  const [dataLocationLoading, setDataLocationLoading] = useState(true)
  const [dataLocationError, setDataLocationError] = useState('')
  const [backupLocation, setBackupLocation] = useState<BackupLocationInfo | null>(null)
  const [backupLocationLoading, setBackupLocationLoading] = useState(true)
  const [backupLocationError, setBackupLocationError] = useState('')
  const [choosingBackupLocation, setChoosingBackupLocation] = useState(false)
  const [openingBackupLocation, setOpeningBackupLocation] = useState(false)
  const [locationBusy, setLocationBusy] = useState(false)
  const [locationConflict, setLocationConflict] = useState<{ directory: string } | null>(null)
  const [locationConflictBusy, setLocationConflictBusy] =
    useState<DataLocationConflictAction | null>(null)
  const [openingDataLocation, setOpeningDataLocation] = useState(false)
  const [recordingDraftBusy, setRecordingDraftBusy] = useState(false)
  const [openingRecordingDraftDirectory, setOpeningRecordingDraftDirectory] =
    useState(false)
  const [resetBrowserProfileConfirm, setResetBrowserProfileConfirm] =
    useState(false)
  const [resettingBrowserProfile, setResettingBrowserProfile] = useState(false)
  const [restartingApp, setRestartingApp] = useState(false)
  const [openingPrivacy, setOpeningPrivacy] = useState(false)
  const [restoreLocationOpen, setRestoreLocationOpen] = useState(false)
  const [updateResult, setUpdateResult] = useState<UpdateCheckResult | null>(null)
  const [checkingUpdates, setCheckingUpdates] = useState(false)
  const [downloadUpdateBusy, setDownloadUpdateBusy] = useState(false)
  const [cancelUpdateBusy, setCancelUpdateBusy] = useState(false)
  const [installUpdateBusy, setInstallUpdateBusy] = useState(false)
  const [interfaceScale, setInterfaceScale] = useState(() =>
    interfaceScaleActualToDisplay(settings.interfaceScale)
  )
  const [fontSizeScale, setFontSizeScale] = useState(settings.fontSizeScale)
  const [proxy, setProxy] = useState<ProxySettings>(settings.proxy)
  const [proxySaving, setProxySaving] = useState(false)
  const proxyDirty = JSON.stringify(proxy) !== JSON.stringify(settings.proxy)
  const [proxyTesting, setProxyTesting] = useState(false)
  const [proxyResult, setProxyResult] = useState<ProxyTestResult | null>(null)
  const [backups, setBackups] = useState<BackupRecord[]>([])
  const [backupsLoading, setBackupsLoading] = useState(false)
  const [backupsError, setBackupsError] = useState('')
  const [confirmBackup, setConfirmBackup] = useState<BackupRecord | null>(null)
  const [restoringBackup, setRestoringBackup] = useState(false)
  const [resettingSettings, setResettingSettings] = useState(false)
  const scaleSaveTimer = useRef<number | null>(null)
  const [saveStates, setSaveStates] = useState<
    Record<string, { phase: SettingSavePhase; message?: string }>
  >({})
  const saveTimers = useRef<Record<string, number>>({})

  function setSaveState(key: string, phase: SettingSavePhase, message?: string): void {
    if (saveTimers.current[key]) {
      window.clearTimeout(saveTimers.current[key])
      delete saveTimers.current[key]
    }
    setSaveStates((current) => ({ ...current, [key]: { phase, message } }))
    if (phase === 'saved') {
      saveTimers.current[key] = window.setTimeout(() => {
        delete saveTimers.current[key]
        setSaveStates((current) => {
          const next = { ...current }
          delete next[key]
          return next
        })
      }, 2000)
    }
  }

  // 即时保存的统一入口：分段按钮、开关、滑块点下去就已生效，成功时不再点亮「已保存」，失败才提示。
  async function saveInstant(patch: AppSettingsPatch): Promise<boolean> {
    try {
      await onSettingsChange(patch)
      return true
    } catch (error) {
      notify(
        'error',
        error instanceof Error
          ? error.message
          : tr('设置保存失败', 'Could not save setting.', '設定儲存失敗')
      )
      return false
    }
  }

  useEffect(() => {
    setAutoLock(settings.autoLockMinutes)
  }, [settings.autoLockMinutes])

  useEffect(() => {
    setInterfaceScale(interfaceScaleActualToDisplay(settings.interfaceScale))
    setFontSizeScale(settings.fontSizeScale)
    setProxy(settings.proxy)
  }, [settings.fontSizeScale, settings.interfaceScale, settings.proxy])

  useEffect(() => {
    return () => {
      if (scaleSaveTimer.current) window.clearTimeout(scaleSaveTimer.current)
      for (const timer of Object.values(saveTimers.current)) {
        window.clearTimeout(timer)
      }
    }
  }, [])

  useEffect(() => {
    void loadSettingsInfo()
  }, [notify])

  useEffect(() => {
    if (module === 'data') {
      void loadBackups()
    }
  }, [module])

  async function loadSettingsInfo(): Promise<void> {
    setDataLocationLoading(true)
    setDataLocationError('')
    setBackupLocationLoading(true)
    setBackupLocationError('')
    const [aboutResult, locationResult, backupLocationResult] = await Promise.allSettled([
      window.autologin.app.getAbout(),
      window.autologin.app.getDataLocation(),
      window.autologin.app.getBackupLocation()
    ])
    if (aboutResult.status === 'fulfilled') {
      setAbout(aboutResult.value)
    } else {
      notify(
        'error',
        aboutResult.reason instanceof Error
          ? aboutResult.reason.message
          : tr('无法读取应用信息', 'Could not read app information.', '無法讀取應用程式資訊')
      )
    }
    if (locationResult.status === 'fulfilled') {
      setDataLocation(locationResult.value)
    } else {
      const message =
        locationResult.reason instanceof Error
          ? locationResult.reason.message
          : tr('无法读取数据保存位置', 'Could not read the data location.', '無法讀取資料儲存位置')
      setDataLocationError(message)
      notify('error', message)
    }
    if (backupLocationResult.status === 'fulfilled') {
      setBackupLocation(backupLocationResult.value)
    } else {
      const message =
        backupLocationResult.reason instanceof Error
          ? backupLocationResult.reason.message
          : tr(
              '无法读取自动备份位置',
              'Could not read the backup location.',
              '無法讀取自動備份位置'
            )
      setBackupLocationError(message)
      notify('error', message)
    }
    setDataLocationLoading(false)
    setBackupLocationLoading(false)
  }

  async function changeAutoLock(value: AutoLockMinutes): Promise<void> {
    setAutoLock(value)
    const saved = await saveInstant({ autoLockMinutes: value })
    if (!saved) setAutoLock(settings.autoLockMinutes)
  }

  async function saveAppearance(
    patch: AppSettingsPatch,
    message?: string
  ): Promise<boolean> {
    try {
      await onSettingsChange(patch)
      if (message) notify('success', message)
      return true
    } catch (error) {
      notify(
        'error',
        error instanceof Error
          ? error.message
          : tr('外观设置保存失败', 'Could not save appearance.', '外觀設定儲存失敗')
      )
      return false
    }
  }

  function scheduleScaleSave(value: number): void {
    setInterfaceScale(value)
    if (scaleSaveTimer.current) window.clearTimeout(scaleSaveTimer.current)
    scaleSaveTimer.current = window.setTimeout(() => {
      void saveAppearance({ interfaceScale: interfaceScaleDisplayToActual(value) })
    }, 260)
  }

  async function changeFontSize(value: number): Promise<void> {
    setFontSizeScale(value)
    const saved = await saveInstant({ fontSizeScale: value })
    if (!saved) setFontSizeScale(settings.fontSizeScale)
  }

  async function resetScale(): Promise<void> {
    if (scaleSaveTimer.current) {
      window.clearTimeout(scaleSaveTimer.current)
      scaleSaveTimer.current = null
    }
    setInterfaceScale(100)
    await saveAppearance({ interfaceScale: DEFAULT_APP_SETTINGS.interfaceScale })
  }

  async function resetFontSize(): Promise<void> {
    await changeFontSize(100)
  }

  async function updateCopyShortcut(enabled: boolean): Promise<void> {
    await saveInstant({ accountCopyShortcutEnabled: enabled })
  }

  async function changeDefaultLoginBrowser(
    loginBrowser: AppSettings['defaultLoginBrowser']
  ): Promise<void> {
    await saveInstant({ defaultLoginBrowser: loginBrowser })
  }

  async function changePureBrowserMode(enabled: boolean): Promise<void> {
    await saveInstant({ pureBrowserMode: enabled })
  }

  async function captureCopyShortcut(
    event: React.KeyboardEvent<HTMLInputElement>
  ): Promise<void> {
    if (['Alt', 'Control', 'Meta', 'Shift'].includes(event.key)) return
    event.preventDefault()
    const shortcut = shortcutFromKeyboardEvent(event.nativeEvent)
    if (!shortcut) {
      notify(
        'error',
        tr(
          '请使用 Ctrl、Alt 或 Shift 组合键',
          'Use a Ctrl, Alt or Shift key combination.',
          '請使用 Ctrl、Alt 或 Shift 組合鍵'
        )
      )
      return
    }
    await saveInstant({ accountCopyShortcut: shortcut })
  }

  async function resetAllSettings(): Promise<void> {
    if (resettingSettings) return
    setResettingSettings(true)
    if (scaleSaveTimer.current) {
      window.clearTimeout(scaleSaveTimer.current)
      scaleSaveTimer.current = null
    }
    setAutoLock(DEFAULT_APP_SETTINGS.autoLockMinutes)
    setInterfaceScale(interfaceScaleActualToDisplay(DEFAULT_APP_SETTINGS.interfaceScale))
    setFontSizeScale(DEFAULT_APP_SETTINGS.fontSizeScale)
    setProxy(DEFAULT_APP_SETTINGS.proxy)
    setProxyResult(null)
    try {
      await saveAppearance(
        {
          autoLockMinutes: DEFAULT_APP_SETTINGS.autoLockMinutes,
          colorMode: DEFAULT_APP_SETTINGS.colorMode,
          language: DEFAULT_APP_SETTINGS.language,
          themePreset: DEFAULT_APP_SETTINGS.themePreset,
          customTheme: DEFAULT_APP_SETTINGS.customTheme,
          interfaceScale: DEFAULT_APP_SETTINGS.interfaceScale,
          fontSizeScale: DEFAULT_APP_SETTINGS.fontSizeScale,
          accountCopyShortcutEnabled: DEFAULT_APP_SETTINGS.accountCopyShortcutEnabled,
          accountCopyShortcut: DEFAULT_APP_SETTINGS.accountCopyShortcut,
          proxy: DEFAULT_APP_SETTINGS.proxy,
          recordingDraftDirectory: DEFAULT_APP_SETTINGS.recordingDraftDirectory,
          defaultLoginBrowser: DEFAULT_APP_SETTINGS.defaultLoginBrowser,
          pureBrowserMode: DEFAULT_APP_SETTINGS.pureBrowserMode,
          groupOrder: []
        },
        translate(
          settings.language,
          '所有设置已恢复默认',
          'All settings reset to defaults.',
          '所有設定已恢復預設'
        )
      )
    } finally {
      setResettingSettings(false)
    }
  }

  async function loadDatabases(): Promise<void> {
    try {
      const list = await window.autologin.tabs.info()
      setDatabases(list)
      setDatabasesError('')
    } catch (error) {
      setDatabases([])
      setDatabasesError(
        error instanceof Error
          ? error.message
          : tr('无法读取数据库列表', 'Could not read the database list.', '無法讀取資料庫清單')
      )
    }
  }

  useEffect(() => {
    if (module !== 'security') return
    void loadDatabases()
  }, [module])

  function openPasswordEditor(tab: DatabaseInfo): void {
    setPasswordEditor({
      tabId: tab.id,
      current: '',
      next: '',
      confirm: '',
      busy: false,
      error: ''
    })
    setBackupEditor(null)
  }

  async function submitDatabasePassword(
    event: React.FormEvent,
    tabId: string
  ): Promise<void> {
    event.preventDefault()
    const editor = passwordEditor
    if (!editor || editor.tabId !== tabId) return
    const fail = (message: string): void => {
      setPasswordEditor({ ...editor, busy: false, error: message })
    }
    if (editor.next.length < 10) {
      fail(
        tr(
          '新数据库密码至少需要 10 个字符',
          'The new database password needs at least 10 characters.',
          '新資料庫密碼至少需要 10 個字元'
        )
      )
      return
    }
    if (editor.next !== editor.confirm) {
      fail(
        tr(
          '两次输入的新数据库密码不一致',
          'The new database passwords do not match.',
          '兩次輸入的新資料庫密碼不一致'
        )
      )
      return
    }
    if (!editor.current) {
      fail(tr('请输入当前数据库密码', 'Enter the current password.', '請輸入目前資料庫密碼'))
      return
    }
    const name = databases?.find((item) => item.id === tabId)?.name ?? ''
    setPasswordEditor({ ...editor, busy: true, error: '' })
    try {
      await window.autologin.vault.changeTabPassword({
        tabId,
        currentPassword: editor.current,
        nextPassword: editor.next
      })
      setPasswordEditor(null)
      notify(
        'success',
        name
          ? tr(`「${name}」的密码已更新`, `Password updated for "${name}".`, `「${name}」的密碼已更新`)
          : tr('数据库密码已更新', 'Database password updated.', '資料庫密碼已更新')
      )
    } catch (error) {
      fail(
        error instanceof Error
          ? error.message
          : tr(
              '数据库密码修改失败',
              'Could not change the database password.',
              '資料庫密碼修改失敗'
            )
      )
    }
  }

  async function lockDatabase(tab: DatabaseInfo): Promise<void> {
    setLockingTabId(tab.id)
    try {
      await window.autologin.vault.lockTab(tab.id)
      await onVaultStatusChange()
      await loadDatabases()
      notify(
        'success',
        tr(`「${tab.name}」已锁定`, `"${tab.name}" is locked.`, `「${tab.name}」已鎖定`)
      )
    } catch (error) {
      notify(
        'error',
        error instanceof Error
          ? error.message
          : tr('锁定数据库失败', 'Could not lock the database.', '鎖定資料庫失敗')
      )
    } finally {
      setLockingTabId('')
    }
  }

  async function removeDatabase(): Promise<void> {
    const target = removeTarget
    if (!target) return
    setRemovingDatabase(true)
    try {
      await window.autologin.tabs.delete(target.id)
      setRemoveTarget(null)
      setPasswordEditor(null)
      setBackupEditor(null)
      await onDatabasesChanged()
      await onVaultStatusChange()
      await loadDatabases()
      notify(
        'success',
        tr(
          `「${target.name}」已从列表移除`,
          `"${target.name}" was removed from the list.`,
          `「${target.name}」已從清單移除`
        )
      )
    } catch (error) {
      notify(
        'error',
        error instanceof Error
          ? error.message
          : tr('移除数据库失败', 'Could not remove the database.', '移除資料庫失敗')
      )
    } finally {
      setRemovingDatabase(false)
    }
  }

  function openBackupEditor(tab: DatabaseInfo): void {
    setBackupEditor({
      tabId: tab.id,
      name: tab.name,
      password: '',
      confirm: '',
      busy: false,
      error: ''
    })
    setPasswordEditor(null)
  }

  async function submitBackupExport(event: React.FormEvent): Promise<void> {
    event.preventDefault()
    const editor = backupEditor
    if (!editor) return
    const fail = (message: string): void => {
      setBackupEditor({ ...editor, busy: false, error: message })
    }
    if (editor.password.length < 8) {
      fail(
        tr(
          '导出密码至少需要 8 个字符',
          'The export password needs at least 8 characters.',
          '匯出密碼至少需要 8 個字元'
        )
      )
      return
    }
    if (editor.password !== editor.confirm) {
      fail(
        tr(
          '两次输入的导出密码不一致',
          'The export passwords do not match.',
          '兩次輸入的匯出密碼不一致'
        )
      )
      return
    }
    setBackupEditor({ ...editor, busy: true, error: '' })
    try {
      const result = await window.autologin.data.exportTab({
        tabId: editor.tabId,
        format: 'autologin',
        password: editor.password
      })
      setBackupEditor(null)
      if (!result.canceled) {
        notify(
          'success',
          tr(
            `已导出备份：${result.fileName ?? ''}`,
            `Backup exported: ${result.fileName ?? ''}`,
            `已匯出備份：${result.fileName ?? ''}`
          )
        )
      }
    } catch (error) {
      setBackupEditor({
        ...editor,
        busy: false,
        error:
          error instanceof Error
            ? error.message
            : tr('导出备份失败', 'Could not export the backup.', '匯出備份失敗')
      })
    }
  }

  async function chooseLocation(): Promise<void> {
    setLocationBusy(true)
    try {
      const result = await window.autologin.app.chooseDataLocation()
      if (result?.status === 'occupied') {
        setLocationConflict({ directory: result.directory })
        return
      }
      if (result?.status === 'changed') {
        setDataLocation(result.info)
        notify(
          'success',
          tr(
            '数据目录已迁移，重启 AutoLogin 后继续使用',
            'Data location moved. Restart AutoLogin to continue.',
            '資料目錄已遷移，重新啟動 AutoLogin 後繼續使用'
          )
        )
      }
    } catch (error) {
      notify(
        'error',
        error instanceof Error
          ? error.message
          : tr('数据目录迁移失败', 'Could not move data location.', '資料目錄遷移失敗')
      )
    } finally {
      setLocationBusy(false)
    }
  }

  async function resolveLocationConflict(action: DataLocationConflictAction): Promise<void> {
    if (!locationConflict || locationConflictBusy) return
    setLocationConflictBusy(action)
    try {
      const next = await window.autologin.app.resolveDataLocationConflict(
        locationConflict.directory,
        action
      )
      setDataLocation(next)
      setLocationConflict(null)
      notify(
        'success',
        action === 'load'
          ? tr(
              '已切换到所选目录，重启 AutoLogin 后继续使用',
              'Switched to the selected directory. Restart AutoLogin to continue.',
              '已切換至所選目錄，重新啟動 AutoLogin 後繼續使用'
            )
          : tr(
              '当前数据已迁移，目录中的旧数据已自动备份',
              'Current data migrated. The previous directory contents were backed up automatically.',
              '目前資料已遷移，目錄中的舊資料已自動備份'
            )
      )
    } catch (error) {
      notify(
        'error',
        error instanceof Error
          ? error.message
          : tr('处理旧数据目录失败', 'Could not resolve the existing data directory.', '處理舊資料目錄失敗')
      )
    } finally {
      setLocationConflictBusy(null)
    }
  }

  async function restoreDefaultLocation(): Promise<void> {
    if (!dataLocation || dataLocation.isDefault || locationBusy) return
    setLocationBusy(true)
    try {
      const next = await window.autologin.app.restoreDefaultDataLocation()
      setDataLocation(next)
      setRestoreLocationOpen(false)
      notify(
        'success',
        tr(
          '数据已迁移回默认目录，重启 AutoLogin 后继续使用',
          'Data moved back to the default location. Restart AutoLogin to continue.',
          '資料已遷移回預設目錄，重新啟動 AutoLogin 後繼續使用'
        )
      )
    } catch (error) {
      notify(
        'error',
        error instanceof Error
          ? error.message
          : tr(
              '恢复默认数据目录失败',
              'Could not restore the default data location.',
              '恢復預設資料目錄失敗'
            )
      )
    } finally {
      setLocationBusy(false)
    }
  }

  async function checkUpdates(): Promise<void> {
    if (checkingUpdates) return
    const startedAt = Date.now()
    setCheckingUpdates(true)
    try {
      setUpdateResult(await window.autologin.app.checkForUpdates())
    } catch (error) {
      setUpdateResult({
        status: 'unavailable',
        currentVersion: appVersion,
        message:
          error instanceof Error
            ? error.message
            : tr('检查更新失败', 'Could not check for updates.', '檢查更新失敗')
      })
    } finally {
      await waitForLoadingFeedback(startedAt)
      setCheckingUpdates(false)
    }
  }

  async function startUpdateDownload(): Promise<void> {
    if (downloadUpdateBusy || cancelUpdateBusy || installUpdateBusy) return
    setDownloadUpdateBusy(true)
    try {
      await onDownloadUpdate()
    } finally {
      setDownloadUpdateBusy(false)
    }
  }

  async function cancelUpdateDownload(): Promise<void> {
    if (cancelUpdateBusy || installUpdateBusy) return
    setCancelUpdateBusy(true)
    try {
      await onCancelUpdate()
    } finally {
      setCancelUpdateBusy(false)
    }
  }

  async function installDownloadedUpdate(): Promise<void> {
    if (downloadUpdateBusy || cancelUpdateBusy || installUpdateBusy) return
    setInstallUpdateBusy(true)
    try {
      await onInstallUpdate()
    } finally {
      setInstallUpdateBusy(false)
    }
  }

  async function clearAll(): Promise<void> {
    setClearBusy(true)
    try {
      await onClearAllData()
      setClearOpen(false)
    } catch (error) {
      notify(
        'error',
        error instanceof Error
          ? error.message
          : tr('清除数据失败', 'Could not clear data.', '清除資料失敗')
      )
    } finally {
      setClearBusy(false)
    }
  }

  async function changeColorMode(colorMode: ColorMode): Promise<void> {
    await saveInstant({ colorMode })
  }

  async function changeLanguage(language: AppLanguage): Promise<void> {
    await saveInstant({ language })
  }

  function updateProxy<K extends keyof ProxySettings>(key: K, value: ProxySettings[K]): void {
    setProxy((current) => {
      if (key !== 'mode') return { ...current, [key]: value }
      return {
        ...current,
        mode: value as ProxySettings['mode'],
        enabled: value === 'custom'
      }
    })
    setProxyResult(null)
  }

  async function saveProxy(): Promise<void> {
    setProxySaving(true)
    setSaveState('proxy', 'saving')
    try {
      await onSettingsChange({ proxy })
      setSaveState('proxy', 'saved')
    } catch (error) {
      setSaveState(
        'proxy',
        'error',
        error instanceof Error
          ? error.message
          : tr('设置保存失败', 'Could not save setting.', '設定儲存失敗')
      )
    } finally {
      setProxySaving(false)
    }
  }

  async function testProxyConnection(): Promise<void> {
    if (proxyTesting) return
    const startedAt = Date.now()
    setProxyTesting(true)
    setProxyResult(null)
    try {
      setProxyResult(await window.autologin.network.testProxy(proxy))
    } catch (error) {
      setProxyResult({
        ok: false,
        message:
          error instanceof Error
            ? error.message
            : tr('代理连接测试失败', 'Proxy connection test failed.', '代理連線測試失敗')
      })
    } finally {
      await waitForLoadingFeedback(startedAt)
      setProxyTesting(false)
    }
  }

  async function loadBackups(): Promise<void> {
    setBackupsLoading(true)
    setBackupsError('')
    try {
      setBackups(await window.autologin.data.listBackups())
    } catch (error) {
      setBackupsError(
        error instanceof Error
          ? error.message
          : tr('读取备份记录失败', 'Could not load backups.', '讀取備份記錄失敗')
      )
      notify(
        'error',
        error instanceof Error
          ? error.message
          : tr('读取备份记录失败', 'Could not load backups.', '讀取備份記錄失敗')
      )
    } finally {
      setBackupsLoading(false)
    }
  }

  async function openDataLocation(): Promise<void> {
    if (openingDataLocation) return
    setOpeningDataLocation(true)
    try {
      await window.autologin.app.openDataLocation()
      notify('success', tr('已打开数据目录', 'Data folder opened.', '已開啟資料目錄'))
    } catch (error) {
      notify(
        'error',
        error instanceof Error
          ? error.message
          : tr('无法打开数据目录', 'Could not open the data folder.', '無法開啟資料目錄')
      )
    } finally {
      setOpeningDataLocation(false)
    }
  }

  async function chooseBackupLocation(): Promise<void> {
    if (choosingBackupLocation) return
    setChoosingBackupLocation(true)
    try {
      const next = await window.autologin.app.chooseBackupLocation()
      if (!next) return
      setBackupLocation(next)
      setBackupLocationError('')
      await loadBackups()
      notify(
        'success',
        tr(
          '自动备份保存位置已更新',
          'Automatic backup location updated.',
          '自動備份儲存位置已更新'
        )
      )
    } catch (error) {
      notify(
        'error',
        error instanceof Error
          ? error.message
          : tr(
              '自动备份保存位置更新失败',
              'Could not update the automatic backup location.',
              '自動備份儲存位置更新失敗'
            )
      )
    } finally {
      setChoosingBackupLocation(false)
    }
  }

  async function openBackupLocation(): Promise<void> {
    if (openingBackupLocation) return
    setOpeningBackupLocation(true)
    try {
      await window.autologin.app.openBackupLocation()
      notify(
        'success',
        tr('已打开自动备份目录', 'Backup folder opened.', '已開啟自動備份目錄')
      )
    } catch (error) {
      notify(
        'error',
        error instanceof Error
          ? error.message
          : tr(
              '无法打开自动备份目录',
              'Could not open the backup folder.',
              '無法開啟自動備份目錄'
            )
      )
    } finally {
      setOpeningBackupLocation(false)
    }
  }

  async function restoreDefaultBackupLocation(): Promise<void> {
    if (choosingBackupLocation || !backupLocation) return
    setChoosingBackupLocation(true)
    try {
      const next = await window.autologin.app.restoreDefaultBackupLocation()
      setBackupLocation(next)
      setBackupLocationError('')
      await loadBackups()
      notify(
        'success',
        tr(
          '自动备份已恢复默认位置',
          'Automatic backups restored to the default location.',
          '自動備份已恢復預設位置'
        )
      )
    } catch (error) {
      notify(
        'error',
        error instanceof Error
          ? error.message
          : tr(
              '恢复默认自动备份位置失败',
              'Could not restore the default backup location.',
              '恢復預設自動備份位置失敗'
            )
      )
    } finally {
      setChoosingBackupLocation(false)
    }
  }

  async function chooseRecordingDraftDirectory(): Promise<void> {
    if (recordingDraftBusy) return
    setRecordingDraftBusy(true)
    try {
      const directory = await window.autologin.app.chooseRecordingDraftDirectory()
      if (!directory) return
      await onSettingsChange({ recordingDraftDirectory: directory })
      notify(
        'success',
        tr(
          '录制副本保存位置已更新',
          'Recording draft location updated.',
          '錄製副本儲存位置已更新'
        )
      )
    } catch (error) {
      notify(
        'error',
        error instanceof Error
          ? error.message
          : tr(
              '录制副本保存位置更新失败',
              'Could not update the recording draft location.',
              '錄製副本儲存位置更新失敗'
            )
      )
    } finally {
      setRecordingDraftBusy(false)
    }
  }

  async function resetRecordingDraftDirectory(): Promise<void> {
    if (recordingDraftBusy || !settings.recordingDraftDirectory) return
    setRecordingDraftBusy(true)
    try {
      await onSettingsChange({ recordingDraftDirectory: '' })
      notify(
        'success',
        tr(
          '录制副本已恢复默认位置',
          'Recording draft location reset to default.',
          '錄製副本已恢復預設位置'
        )
      )
    } catch (error) {
      notify(
        'error',
        error instanceof Error
          ? error.message
          : tr(
              '恢复默认位置失败',
              'Could not reset the recording draft location.',
              '恢復預設位置失敗'
            )
      )
    } finally {
      setRecordingDraftBusy(false)
    }
  }

  async function openRecordingDraftDirectory(): Promise<void> {
    if (openingRecordingDraftDirectory) return
    setOpeningRecordingDraftDirectory(true)
    try {
      await window.autologin.app.openRecordingDraftDirectory()
      notify(
        'success',
        tr('已打开录制副本目录', 'Recording draft folder opened.', '已開啟錄製副本目錄')
      )
    } catch (error) {
      notify(
        'error',
        error instanceof Error
          ? error.message
          : tr(
              '无法打开录制副本目录',
              'Could not open the recording draft folder.',
              '無法開啟錄製副本目錄'
            )
      )
    } finally {
      setOpeningRecordingDraftDirectory(false)
    }
  }

  async function resetBrowserProfile(): Promise<void> {
    if (resettingBrowserProfile) return
    setResettingBrowserProfile(true)
    try {
      await window.autologin.app.resetBrowserProfile()
      setResetBrowserProfileConfirm(false)
      notify(
        'success',
        tr(
          '共享浏览器配置已重置，下次登录会重新导入本机配置',
          'Shared browser profile reset. The local profile will be imported on the next sign-in.',
          '共用瀏覽器設定已重設，下次登入會重新匯入本機設定'
        )
      )
    } catch (error) {
      notify(
        'error',
        error instanceof Error
          ? error.message
          : tr(
              '重置浏览器配置失败',
              'Could not reset the browser profile.',
              '重設瀏覽器設定失敗'
            )
      )
    } finally {
      setResettingBrowserProfile(false)
    }
  }

  async function restartApp(): Promise<void> {
    if (restartingApp) return
    setRestartingApp(true)
    try {
      await window.autologin.app.restart()
    } catch (error) {
      setRestartingApp(false)
      notify(
        'error',
        error instanceof Error
          ? error.message
          : tr('无法重启应用', 'Could not restart the app.', '無法重新啟動應用程式')
      )
    }
  }

  async function openPrivacy(): Promise<void> {
    if (openingPrivacy) return
    setOpeningPrivacy(true)
    try {
      await window.autologin.app.openPrivacy()
    } catch (error) {
      notify(
        'error',
        error instanceof Error
          ? error.message
          : tr('无法打开隐私说明', 'Could not open the privacy notice.', '無法開啟隱私說明')
      )
    } finally {
      setOpeningPrivacy(false)
    }
  }

  async function restoreBackup(): Promise<void> {
    if (!confirmBackup) return
    setRestoringBackup(true)
    try {
      await window.autologin.data.restoreBackup(confirmBackup.id)
      setConfirmBackup(null)
      notify(
        'success',
        tr(
          '备份已恢复，请使用备份对应的主密码解锁',
          'Backup restored. Unlock with the master password for that backup.',
          '備份已還原，請使用備份對應的主密碼解鎖'
        )
      )
    } catch (error) {
      notify(
        'error',
        error instanceof Error
          ? error.message
          : tr('恢复备份失败', 'Could not restore backup.', '還原備份失敗')
      )
    } finally {
      setRestoringBackup(false)
    }
  }

  const settingsModules: Array<[SettingsModule, string]> = [
    ['general', tr('通用配置', 'General', '一般設定')],
    ['network', tr('网络代理', 'Network proxy', '網路代理')],
    ['security', tr('安全与隐私', 'Security & privacy', '安全性與隱私')],
    ['data', tr('数据与备份', 'Data & backups', '資料與備份')],
    ['about', tr('关于与更新', 'About & updates', '關於與更新')]
  ]
  return (
    <>
      <section className="page-section settings-page settings-page--controlled">
        <div className="settings-page__sticky">
          <nav
            className="settings-tabs"
            role="tablist"
            aria-label={tr('设置分类', 'Settings sections', '設定分類')}
          >
            {settingsModules.map(([nextModule, label]) => (
              <button
                type="button"
                role="tab"
                key={nextModule}
                aria-selected={module === nextModule}
                className={module === nextModule ? 'is-active' : ''}
                onClick={() => onModuleChange(nextModule)}
              >
                {label}
              </button>
            ))}
          </nav>
        </div>

        <div className="settings-page__body">
        {module === 'general' && (
          <SettingsPanel
            icon={<SlidersHorizontal size={18} />}
            title={tr('锁定与显示', 'Lock and display', '鎖定與顯示')}
            description={tr(
              '控制自动锁定、界面比例和全局默认配置。',
              'Control auto-lock, interface scale and global defaults.',
              '控制自動鎖定、介面比例和全域預設設定。'
            )}
          >
            <div className="settings-card">
              <SettingsCardHeading
                icon={<LockKeyhole size={17} />}
                title={tr('自动锁定', 'Auto-lock', '自動鎖定')}
                description={tr(
                  '应用闲置后隐藏保险库内容，网站会话会保留。',
                  'Hide vault contents after inactivity while keeping website sessions.',
                  '應用程式閒置後隱藏保險庫內容，網站工作階段會保留。'
                )}
              />
              <div className="segmented-control segmented-control--wide">
                {AUTO_LOCK_OPTIONS.map((minutes) => (
                  <button
                    key={minutes}
                    type="button"
                    className={autoLock === minutes ? 'is-active' : ''}
                    onClick={() => void changeAutoLock(minutes)}
                  >
                    {tr(`${minutes} 分钟`, `${minutes} min`, `${minutes} 分鐘`)}
                  </button>
                ))}
              </div>
            </div>

            <div className="settings-card settings-card--browser-launch">
              <SettingsCardHeading
                icon={<Monitor size={17} />}
                title={tr('浏览器启动方式', 'Browser launch', '瀏覽器啟動方式')}
                description={tr(
                  '新建和导入账号默认继承这里的登录方式；纯净模式会屏蔽扩展与崩溃恢复气泡。',
                  'New and imported accounts inherit this browser choice. Pure mode hides extensions and crash-restore prompts.',
                  '新建和匯入帳號預設繼承這裡的登入方式；純淨模式會封鎖擴充功能與當機還原提示。'
                )}
              />
              <div className="settings-control-row">
                <span className="settings-control-row__label">
                  {tr('默认登录方式', 'Default browser', '預設登入方式')}
                </span>
                <div
                  className="segmented-control"
                  role="group"
                  aria-label={tr('默认登录方式', 'Default browser', '預設登入方式')}
                >
                  <button
                    type="button"
                    className={
                      settings.defaultLoginBrowser === 'builtin' ? 'is-active' : ''
                    }
                    onClick={() => void changeDefaultLoginBrowser('builtin')}
                  >
                    {tr('内置浏览器', 'Built-in', '內建瀏覽器')}
                  </button>
                  <button
                    type="button"
                    className={
                      settings.defaultLoginBrowser === 'standalone'
                        ? 'is-active'
                        : ''
                    }
                    onClick={() => void changeDefaultLoginBrowser('standalone')}
                  >
                    {tr('独立浏览器', 'Standalone', '獨立瀏覽器')}
                  </button>
                </div>
              </div>
              <div className="switch-row switch-row--isolated">
                <span>
                  <strong>{tr('纯净浏览器模式', 'Pure browser mode', '純淨瀏覽器模式')}</strong>
                  <small>
                    {tr(
                      '关闭扩展、组件后台页、翻译弹层与崩溃恢复提示；每次启动前会清洗外部浏览器配置。',
                      'Disable extensions, component background pages, translate prompts and crash-restore bubbles; the external profile is sanitized before launch.',
                      '關閉擴充功能、元件背景頁、翻譯提示與當機還原提示；每次啟動前會清洗外部瀏覽器設定。'
                    )}
                  </small>
                </span>
                <label className="switch-row__hit">
                  <input
                    type="checkbox"
                    checked={settings.pureBrowserMode}
                    onChange={(event) =>
                      void changePureBrowserMode(event.target.checked)
                    }
                    aria-label={tr('纯净浏览器模式', 'Pure browser mode', '純淨瀏覽器模式')}
                  />
                  <span className="switch" aria-hidden="true" />
                </label>
              </div>
              <p className="settings-hint">
                {tr(
                  '若某些站点必须依赖扩展登录，可关闭纯净模式；配置清洗仍会清除崩溃恢复状态。',
                  'Turn off pure mode if a site depends on extensions. Crash-state cleanup still runs.',
                  '若某些站點必須依賴擴充功能登入，可關閉純淨模式；設定清洗仍會清除當機還原狀態。'
                )}
              </p>
            </div>

            <div className="settings-card">
              <div className="settings-control-row">
                <span className="settings-control-row__label">
                  {tr('外观', 'Appearance', '外觀')}
                </span>
                <div
                  className="segmented-control"
                  role="group"
                  aria-label={tr('外观', 'Appearance', '外觀')}
                >
                  <button
                    type="button"
                    className={settings.colorMode === 'light' ? 'is-active' : ''}
                    onClick={() => void changeColorMode('light')}
                  >
                    <Sun size={14} />
                    {tr('亮色', 'Light', '亮色')}
                  </button>
                  <button
                    type="button"
                    className={settings.colorMode === 'dark' ? 'is-active' : ''}
                    onClick={() => void changeColorMode('dark')}
                  >
                    <Moon size={14} />
                    {tr('暗色', 'Dark', '暗色')}
                  </button>
                  <button
                    type="button"
                    className={settings.colorMode === 'system' ? 'is-active' : ''}
                    onClick={() => void changeColorMode('system')}
                  >
                    <Monitor size={14} />
                    {tr('跟随系统', 'Follow system', '跟隨系統')}
                  </button>
                </div>
              </div>
              <div className="settings-control-row">
                <span className="settings-control-row__label">
                  <Languages size={14} /> {tr('界面语言', 'Language', '介面語言')}
                </span>
                <div
                  className="segmented-control segmented-control--language"
                  role="group"
                  aria-label={tr('界面语言', 'Language', '介面語言')}
                >
                  {(
                    [
                      ['zh-CN', '简体中文'],
                      ['en', 'English'],
                      ['zh-TW', '繁體中文']
                    ] as Array<[AppLanguage, string]>
                  ).map(([value, label]) => (
                    <button
                      key={value}
                      type="button"
                      className={settings.language === value ? 'is-active' : ''}
                      onClick={() => void changeLanguage(value)}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="settings-card">
              <SettingsCardHeading
                icon={<RefreshCw size={17} />}
                title={tr('界面比例', 'Interface scale', '介面比例')}
                description={tr(
                  '按当前窗口调整界面缩放，默认 100%。',
                  'Adjust interface scale for this window. Default is 100%.',
                  '依目前視窗調整介面縮放，預設為 100%。'
                )}
              />
              <div className="scale-control">
                <input
                  type="range"
                  min={INTERFACE_SCALE_DISPLAY_MIN}
                  max={INTERFACE_SCALE_DISPLAY_MAX}
                  step={INTERFACE_SCALE_STEP}
                  value={interfaceScale}
                  onChange={(event) => scheduleScaleSave(Number(event.target.value))}
                  aria-label={tr('界面比例', 'Interface scale', '介面比例')}
                />
                <strong>{interfaceScale}%</strong>
              </div>
              <div className="settings-inline-actions settings-inline-actions--between">
                <span className="settings-hint">
                  {tr(
                    '可在 70% 至 115% 之间调整',
                    'Adjustable from 70% to 115%.',
                    '可在 70% 至 115% 之間調整'
                  )}
                </span>
                <button
                  type="button"
                  className="reset-setting-button"
                  onClick={() => void resetScale()}
                >
                  <RotateCcw size={14} />
                  {tr('恢复默认比例', 'Reset scale', '恢復預設比例')}
                </button>
              </div>
            </div>

            <div className="settings-card settings-card--font-size">
              <SettingsCardHeading
                icon={<Type size={17} />}
                title={tr('文字大小', 'Text size', '文字大小')}
                description={tr(
                  '选择界面文字的显示比例，不改变窗口和控件的整体尺寸。',
                  'Choose the interface text size without resizing the layout.',
                  '選擇介面文字的顯示比例，不改變視窗和控件的整體尺寸。'
                )}
              />
              <div
                className="font-size-selector"
                role="group"
                aria-label={tr('文字大小', 'Text size', '文字大小')}
              >
                {FONT_SIZE_SCALE_OPTIONS.map((value) => (
                  <button
                    key={value}
                    type="button"
                    className={fontSizeScale === value ? 'is-active' : ''}
                    aria-pressed={fontSizeScale === value}
                    onClick={() => void changeFontSize(value)}
                  >
                    {value}%
                  </button>
                ))}
              </div>
              <div className="settings-inline-actions settings-inline-actions--between">
                <span className="settings-hint">
                  {tr(
                    '可在 90% 至 120% 之间调整',
                    'Adjustable from 90% to 120%.',
                    '可在 90% 至 120% 之間調整'
                  )}
                </span>
                <button
                  type="button"
                  className="reset-setting-button"
                  onClick={() => void resetFontSize()}
                >
                  <RotateCcw size={14} />
                  {tr('恢复默认字体大小', 'Reset font size', '恢復預設字體大小')}
                </button>
              </div>
            </div>

            <div className="settings-card settings-card--shortcut">
              <SettingsCardHeading
                icon={<Keyboard size={17} />}
                title={tr('快捷键', 'Keyboard shortcuts', '快捷鍵')}
                description={tr(
                  '集中管理 AutoLogin 内部快捷键。默认不占用系统按键，后续快捷操作也会在这里统一配置。',
                  'Manage AutoLogin shortcuts in one place. System keys remain available by default, and future actions will use the same settings area.',
                  '集中管理 AutoLogin 內部快捷鍵。預設不佔用系統按鍵，後續快捷操作也會在這裡統一設定。'
                )}
              />
              <label className="switch-row shortcut-enable-row">
                <span>
                  <strong>{tr('启用 AutoLogin 内部快捷键', 'Enable AutoLogin shortcuts', '啟用 AutoLogin 內部快捷鍵')}</strong>
                  <small>
                    {tr(
                      '默认关闭；开启后可统一配置各快捷操作，当前可用功能为复制账号',
                      'Disabled by default. Enable it to manage shortcut actions here; account copy is currently available.',
                      '預設關閉；開啟後可統一設定各快捷操作，目前可用功能為複製帳號'
                    )}
                  </small>
                </span>
                <input
                  type="checkbox"
                  checked={settings.accountCopyShortcutEnabled}
                  onChange={(event) => void updateCopyShortcut(event.target.checked)}
                />
                <span className="switch" aria-hidden="true" />
              </label>
              <label className="shortcut-capture-row">
                <span>{tr('复制账号', 'Copy accounts', '複製帳號')}</span>
                <input
                  className="shortcut-capture-input"
                  value={displayKeyboardShortcut(settings.accountCopyShortcut)}
                  readOnly
                  disabled={!settings.accountCopyShortcutEnabled}
                  onKeyDown={(event) => void captureCopyShortcut(event)}
                  onFocus={(event) => event.currentTarget.select()}
                  aria-label={tr('账号复制快捷键', 'Account copy shortcut', '帳號複製快捷鍵')}
                  title={tr(
                    '点击后按下新的组合键',
                    'Click and press a new key combination',
                    '點擊後按下新的組合鍵'
                  )}
                />
              </label>
              <p className="settings-hint">
                {tr(
                  '复制后按 Ctrl+V 粘贴账号副本。该功能与普通文本复制相互独立。',
                  'After copying, press Ctrl+V to paste account copies. This is separate from normal text copying.',
                  '複製後按 Ctrl+V 貼上帳號副本。此功能與一般文字複製相互獨立。'
                )}
              </p>
            </div>

            <div className="settings-card settings-card--split">
              <div>
                <h4>{tr('重置默认配置', 'Reset defaults', '重設預設設定')}</h4>
                <p>
                  {tr(
                    '恢复 defalut 亮色主题、简体中文、100% 比例、100% 字体、10 分钟锁定和直连网络。',
                    'Restore the light defalut theme, Simplified Chinese, 100% scale, 100% font size, 10-minute lock and direct networking.',
                    '恢復 defalut 亮色主題、簡體中文、100% 比例、100% 字體、10 分鐘鎖定和直連網路。'
                  )}
                </p>
              </div>
              <button
                type="button"
                className="reset-setting-button"
                onClick={() => void resetAllSettings()}
                disabled={resettingSettings}
              >
                {resettingSettings ? (
                  <LoaderCircle size={15} className="spin" />
                ) : (
                  <RotateCcw size={15} />
                )}
                {resettingSettings
                  ? tr('正在恢复…', 'Restoring…', '正在恢復…')
                  : tr('恢复默认设置', 'Restore defaults', '恢復預設設定')}
              </button>
            </div>
          </SettingsPanel>
        )}

        {module === 'network' && (
          <SettingsPanel
            icon={<Network size={18} />}
            title={tr('代理配置', 'Proxy configuration', '代理設定')}
            description={tr(
              '选择跟随系统代理或使用自定义代理，并验证网络连通性。',
              'Follow the system proxy or use a custom proxy, then verify connectivity.',
              '選擇跟隨系統代理或使用自訂代理，並驗證網路連線。'
            )}
          >
            <div className="settings-card proxy-card">
              <SettingsCardHeading
                icon={<Network size={17} />}
                title={tr('代理模式', 'Proxy mode', '代理模式')}
                description={tr(
                  '跟随系统时会自动读取 Windows 当前代理设置；自定义代理只作用于 AutoLogin 与其启动的浏览器。',
                  'Follow system reads the current Windows proxy. A custom proxy applies only to AutoLogin and browsers it launches.',
                  '跟隨系統會自動讀取 Windows 目前代理設定；自訂代理只作用於 AutoLogin 與其啟動的瀏覽器。'
                )}
                action={
                  <span className="settings-card__save-scope">
                    <span
                      className={`settings-save-requirement${proxyDirty ? ' is-dirty' : ''}`}
                    >
                      {proxyDirty
                        ? tr('有未保存修改', 'Unsaved changes', '有未儲存修改')
                        : tr('需点击保存', 'Requires save', '需點擊儲存')}
                    </span>
                    <SettingSaveHint state={saveStates['proxy']} />
                  </span>
                }
              />
              <div className="proxy-mode-options" role="radiogroup" aria-label={tr('代理模式', 'Proxy mode', '代理模式')}>
                <label className={`proxy-mode-option${proxy.mode === 'custom' ? ' is-active' : ''}`}>
                  <input
                    type="radio"
                    name="proxy-mode"
                    value="custom"
                    checked={proxy.mode === 'custom'}
                    onChange={() => updateProxy('mode', 'custom')}
                  />
                  <span>
                    <strong>{tr('自定义代理', 'Custom proxy', '自訂代理')}</strong>
                    <small>{tr('手动填写协议、服务器和端口', 'Enter protocol, host and port manually', '手動填寫協定、伺服器和連接埠')}</small>
                  </span>
                </label>
                <label className={`proxy-mode-option${proxy.mode === 'system' ? ' is-active' : ''}`}>
                  <input
                    type="radio"
                    name="proxy-mode"
                    value="system"
                    checked={proxy.mode === 'system'}
                    onChange={() => updateProxy('mode', 'system')}
                  />
                  <span>
                    <strong>{tr('跟随系统', 'Follow system', '跟隨系統')}</strong>
                    <small>{tr('自动使用操作系统网络代理', 'Use the operating system proxy automatically', '自動使用作業系統網路代理')}</small>
                  </span>
                </label>
              </div>

              <div className={`proxy-fields${proxy.mode === 'system' ? ' is-disabled' : ''}`}>
                <label className="field">
                  <span className="field__label">{tr('协议', 'Protocol', '協定')}</span>
                  <select
                    className="select-control"
                    value={proxy.protocol}
                    onChange={(event) =>
                      updateProxy(
                        'protocol',
                        event.target.value as ProxySettings['protocol']
                      )
                    }
                    disabled={proxy.mode === 'system'}
                  >
                    {PROXY_PROTOCOLS.map((protocol) => (
                      <option key={protocol} value={protocol}>
                        {protocol.toUpperCase()}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  <span className="field__label">{tr('服务器', 'Host', '伺服器')}</span>
                  <input
                    className="filter-control"
                    value={proxy.host}
                    onChange={(event) => updateProxy('host', event.target.value)}
                    placeholder="127.0.0.1"
                    disabled={proxy.mode === 'system'}
                    spellCheck={false}
                  />
                </label>
                <label className="field">
                  <span className="field__label">{tr('端口', 'Port', '連接埠')}</span>
                  <input
                    className="filter-control"
                    type="number"
                    min={1}
                    max={65535}
                    value={proxy.port}
                    onChange={(event) => updateProxy('port', Number(event.target.value))}
                    disabled={proxy.mode === 'system'}
                  />
                </label>
                <label className="field proxy-fields__wide">
                  <span className="field__label">{tr('绕过代理', 'Bypass list', '略過代理')}</span>
                  <input
                    className="filter-control"
                    value={proxy.bypassList}
                    onChange={(event) => updateProxy('bypassList', event.target.value)}
                    placeholder="localhost, 127.0.0.1, ::1"
                    disabled={proxy.mode === 'system'}
                    spellCheck={false}
                  />
                </label>
              </div>

              <div className="proxy-advanced-row">
                <label className="field">
                  <span className="field__label">
                    {tr('高级配置 · 测试 URL', 'Advanced · Test URL', '進階設定 · 測試 URL')}
                  </span>
                  <span className="proxy-advanced-row__control">
                    <input
                      className="filter-control"
                      type="url"
                      value={proxy.testUrl}
                      onChange={(event) => updateProxy('testUrl', event.target.value)}
                      placeholder={DEFAULT_PROXY_TEST_URL}
                      aria-label={tr('测试 URL', 'Test URL', '測試 URL')}
                      spellCheck={false}
                    />
                    <button
                      type="button"
                      className="text-button"
                      onClick={() => updateProxy('testUrl', DEFAULT_PROXY_TEST_URL)}
                    >
                      <RotateCcw size={13} />
                      {tr('恢复默认', 'Reset', '恢復預設')}
                    </button>
                  </span>
                </label>
                <span className="settings-hint">
                  {tr(
                    '此地址仅用于连通性测试，不受上方代理模式影响。',
                    'This URL is only used for connectivity tests and is independent of proxy mode.',
                    '此網址僅用於連線測試，不受上方代理模式影響。'
                  )}
                </span>
              </div>

              <div className="settings-inline-actions">
                <span className="settings-hint">
                  {proxy.mode === 'system'
                    ? tr(
                        '将自动读取并应用 Windows/macOS 当前系统代理配置。',
                        'The current Windows/macOS system proxy will be read and applied automatically.',
                        '將自動讀取並套用 Windows/macOS 目前系統代理設定。'
                      )
                    : tr(
                        '该配置不会修改 Windows 全局代理。',
                        'This configuration does not change the Windows system proxy.',
                        '此設定不會修改 Windows 全域代理。'
                      )}
                </span>
                <div className="settings-inline-actions">
                  <button
                    className="button button--ghost proxy-test-button"
                    onClick={() => void testProxyConnection()}
                    disabled={proxyTesting}
                    aria-busy={proxyTesting}
                  >
                    {proxyTesting ? (
                      <LoadingSpinner />
                    ) : (
                      <Network size={15} />
                    )}
                    {proxyTesting
                      ? tr('测试中…', 'Testing…', '測試中…')
                      : tr('测试连接', 'Test connection', '測試連線')}
                  </button>
                  <button
                    className="button button--primary"
                    onClick={() => void saveProxy()}
                    disabled={proxySaving}
                  >
                    {proxySaving ? (
                      <LoaderCircle size={15} className="spin" />
                    ) : (
                      <Check size={15} />
                    )}
                    {proxySaving
                      ? tr('保存中…', 'Saving…', '儲存中…')
                      : tr('保存代理配置', 'Save proxy', '儲存代理設定')}
                  </button>
                </div>
              </div>

              {proxyResult && (
                <div
                  className={`proxy-test-result${proxyResult.ok ? ' is-success' : ' is-error'}`}
                >
                  {proxyResult.ok ? <Check size={16} /> : <TriangleAlert size={16} />}
                  <span>{proxyResult.message}</span>
                </div>
              )}
            </div>
          </SettingsPanel>
        )}

        {module === 'security' && (
          <SettingsPanel
            icon={<ShieldCheck size={18} />}
            title={tr('数据库密码与本地数据', 'Database password and local data', '資料庫密碼與本機資料')}
            description={tr(
              '每个数据库单独加密、单独设置密码，只在本机校验；忘记密码后无法恢复。',
              'Each database is encrypted with its own password, verified on this device only; a forgotten password cannot be recovered.',
              '每個資料庫單獨加密、單獨設定密碼，只在本機驗證；忘記密碼後無法復原。'
            )}
          >
            <div className="settings-card">
              <SettingsCardHeading
                icon={<Database size={17} />}
                title={tr('已打开的数据库', 'Open databases', '已開啟的資料庫')}
                description={tr(
                  '每个数据库使用自己的密码；在这里修改密码、导出备份或锁定数据库。',
                  'Each database keeps its own password; change it, export a backup or lock it here.',
                  '每個資料庫使用自己的密碼；在這裡修改密碼、匯出備份或鎖定資料庫。'
                )}
              />
              {databasesError && (
                <div className="settings-notice settings-notice--error">
                  <TriangleAlert size={16} />
                  <span>{databasesError}</span>
                  <button className="text-button" onClick={() => void loadDatabases()}>
                    {tr('重试', 'Retry', '重試')}
                  </button>
                </div>
              )}
              {!databasesError && databases === null && (
                <p className="form-hint">{tr('正在读取…', 'Loading…', '正在讀取…')}</p>
              )}
              {!databasesError && databases && databases.length === 0 && (
                <p className="form-hint">
                  {tr(
                    '还没有打开任何数据库。',
                    'No database is open yet.',
                    '還沒有開啟任何資料庫。'
                  )}
                </p>
              )}
              {databases && databases.length > 0 && (
                <ul className="settings-db-list">
                  {databases.map((tab) => {
                    const editor = passwordEditor?.tabId === tab.id ? passwordEditor : null
                    const canChangePassword = tab.source !== 'kdbx'
                    return (
                      <li key={tab.id} className={`settings-db${tab.locked ? ' is-locked' : ''}`}>
                        <div className="settings-db__head">
                          <span className="settings-db__mark" aria-hidden="true">
                            {Array.from(tab.name)[0] ?? '库'}
                          </span>
                          <div className="settings-db__ident">
                            <div className="settings-db__title">
                              <strong>{tab.name}</strong>
                              <span
                                className={`settings-db__badge${tab.locked ? ' is-locked' : ''}`}
                              >
                                {tab.locked
                                  ? tr('已锁定', 'Locked', '已鎖定')
                                  : tr('已解锁', 'Unlocked', '已解鎖')}
                              </span>
                            </div>
                            <code className="settings-db__path">{tab.filePath}</code>
                          </div>
                        </div>
                        <dl className="settings-db__meta">
                          <div>
                            <dt>{tr('条目', 'Items', '項目')}</dt>
                            <dd>
                              {tab.locked
                                ? '—'
                                : tr(
                                    `${tab.accountCount} 账号 · ${tab.groupCount} 分组`,
                                    `${tab.accountCount} accounts · ${tab.groupCount} groups`,
                                    `${tab.accountCount} 帳號 · ${tab.groupCount} 分組`
                                  )}
                            </dd>
                          </div>
                          <div>
                            <dt>{tr('大小', 'Size', '大小')}</dt>
                            <dd>
                              {tab.exists
                                ? formatDatabaseSize(tab.sizeBytes)
                                : tr('尚未生成文件', 'No file yet', '尚未產生檔案')}
                            </dd>
                          </div>
                          <div>
                            <dt>{tr('加密', 'Encryption', '加密')}</dt>
                            <dd>
                              {tab.source === 'kdbx'
                                ? 'KeePass KDBX · AES-256'
                                : tr(
                                    'AES-256 · Argon2id 派生',
                                    'AES-256 · Argon2id',
                                    'AES-256 · Argon2id 衍生'
                                  )}
                            </dd>
                          </div>
                          <div>
                            <dt>{tr('最后修改', 'Last modified', '最後修改')}</dt>
                            <dd>
                              {tab.modifiedAt
                                ? formatDate(tab.modifiedAt, {
                                    dateStyle: 'medium',
                                    timeStyle: 'short'
                                  })
                                : '—'}
                            </dd>
                          </div>
                        </dl>
                        <div className="settings-db__actions">
                          {tab.locked ? (
                            <button
                              className="button button--soft button--small"
                              onClick={() => setUnlockTarget(tab)}
                            >
                              <KeyRound size={14} />
                              {tr('解锁', 'Unlock', '解鎖')}
                            </button>
                          ) : (
                            canChangePassword && (
                              <button
                                className="button button--soft button--small"
                                onClick={() =>
                                  editor ? setPasswordEditor(null) : openPasswordEditor(tab)
                                }
                                aria-expanded={Boolean(editor)}
                              >
                                <KeyRound size={14} />
                                {editor
                                  ? tr('收起', 'Collapse', '收起')
                                  : tr('修改密码', 'Change password', '修改密碼')}
                              </button>
                            )
                          )}
                          <button
                            className="button button--ghost button--small"
                            onClick={() => openBackupEditor(tab)}
                          >
                            <Download size={14} />
                            {tr('导出备份', 'Export backup', '匯出備份')}
                          </button>
                          <button
                            className="button button--ghost button--small"
                            onClick={() => void lockDatabase(tab)}
                            disabled={tab.locked || lockingTabId === tab.id}
                            aria-busy={lockingTabId === tab.id}
                          >
                            {lockingTabId === tab.id ? (
                              <LoaderCircle size={14} className="spin" />
                            ) : (
                              <LockKeyhole size={14} />
                            )}
                            {tab.locked
                              ? tr('已锁定', 'Locked', '已鎖定')
                              : tr('立即锁定', 'Lock now', '立即鎖定')}
                          </button>
                          <button
                            className="button button--danger-ghost button--small settings-db__remove"
                            onClick={() => setRemoveTarget(tab)}
                          >
                            <Trash2 size={14} />
                            {tr('移除…', 'Remove…', '移除…')}
                          </button>
                        </div>
                        {editor && (
                          <form
                            className="settings-db__editor"
                            onSubmit={(event) => void submitDatabasePassword(event, tab.id)}
                          >
                            <p className="settings-db__editor-title">
                              {tr('修改密码', 'Change password', '修改密碼')}
                              <span>
                                {tr(
                                  `只影响「${tab.name}」`,
                                  `Only affects "${tab.name}"`,
                                  `只影響「${tab.name}」`
                                )}
                              </span>
                            </p>
                            <label className="field">
                              <span className="field__label">
                                {tr('当前密码', 'Current password', '目前密碼')}
                              </span>
                              <span className="input-shell">
                                <input
                                  type="password"
                                  value={editor.current}
                                  placeholder={tr(
                                    '输入当前数据库密码',
                                    'Enter the current password',
                                    '輸入目前資料庫密碼'
                                  )}
                                  onChange={(event) =>
                                    setPasswordEditor({ ...editor, current: event.target.value })
                                  }
                                  autoComplete="current-password"
                                  data-autofocus
                                />
                              </span>
                            </label>
                            <div className="field-row">
                              <label className="field">
                                <span className="field__label">
                                  {tr('新密码', 'New password', '新密碼')}
                                </span>
                                <span className="input-shell">
                                  <input
                                    type="password"
                                    value={editor.next}
                                    placeholder={tr(
                                      '至少 10 个字符',
                                      'At least 10 characters',
                                      '至少 10 個字元'
                                    )}
                                    onChange={(event) =>
                                      setPasswordEditor({ ...editor, next: event.target.value })
                                    }
                                    autoComplete="new-password"
                                  />
                                </span>
                              </label>
                              <label className="field">
                                <span className="field__label">
                                  {tr('确认', 'Confirm', '確認')}
                                </span>
                                <span className="input-shell">
                                  <input
                                    type="password"
                                    value={editor.confirm}
                                    placeholder={tr('再输一次', 'Type it again', '再輸入一次')}
                                    onChange={(event) =>
                                      setPasswordEditor({ ...editor, confirm: event.target.value })
                                    }
                                    autoComplete="new-password"
                                  />
                                </span>
                              </label>
                            </div>
                            {editor.next && <PasswordStrength password={editor.next} />}
                            {editor.error && <p className="form-error">{editor.error}</p>}
                            <p className="form-hint">
                              {tr(
                                '修改后旧备份仍然用旧密码，需要单独更新。',
                                'Existing backups keep the old password; update them separately.',
                                '修改後舊備份仍然使用舊密碼，需要單獨更新。'
                              )}
                            </p>
                            <div className="settings-inline-actions">
                              <button
                                className="button button--soft button--small"
                                type="submit"
                                disabled={
                                  editor.busy ||
                                  !editor.current ||
                                  editor.next.length < 10 ||
                                  editor.next !== editor.confirm
                                }
                                aria-busy={editor.busy}
                              >
                                {editor.busy && <LoaderCircle size={14} className="spin" />}
                                {tr('更新密码', 'Update password', '更新密碼')}
                              </button>
                              <button
                                className="button button--ghost button--small"
                                type="button"
                                onClick={() => setPasswordEditor(null)}
                                disabled={editor.busy}
                              >
                                {tr('取消', 'Cancel', '取消')}
                              </button>
                            </div>
                          </form>
                        )}
                      </li>
                    )
                  })}
                </ul>
              )}
            </div>

            <div className="settings-card settings-card--danger">
              <SettingsCardHeading
                icon={<Trash2 size={17} />}
                title={tr('清除所有本地数据', 'Clear all local data', '清除所有本機資料')}
                description={tr(
                  '删除保险库、账号密码、录制流程、备份和全部网站会话。',
                  'Delete the vault, credentials, recorded flows, backups and all website sessions.',
                  '刪除保險庫、帳號密碼、錄製流程、備份和全部網站工作階段。'
                )}
              />
              <button
                className="button button--danger-ghost"
                onClick={() => setClearOpen(true)}
              >
                <Trash2 size={15} />
                {tr('清除全部数据', 'Clear all data', '清除全部資料')}
              </button>
            </div>
          </SettingsPanel>
        )}

        {module === 'data' && (
          <SettingsPanel
            icon={<Database size={18} />}
            title={tr('数据与备份', 'Data and backups', '資料與備份')}
            description={tr(
              '管理本地数据目录和启动时的自动备份。账号导入与配置导出已移至账号标签栏。',
              'Manage the local data directory and startup backups. Account import and configuration export are available from the account tab bar.',
              '管理本機資料目錄和啟動時的自動備份。帳號匯入與設定匯出已移至帳號標籤列。'
            )}
          >
            <div className="settings-card">
              <SettingsCardHeading
                icon={<FolderOpen size={17} />}
                title={tr('数据保存位置', 'Data location', '資料儲存位置')}
                tip={tr(
                  '保险库、账号配置、登录日志和浏览器会话都保存在此目录；自动备份可单独设置。',
                  'The vault, accounts, logs and browser sessions are stored here; automatic backups can use a separate folder.',
                  '保險庫、帳號設定、登入日誌和瀏覽器工作階段都儲存在此目錄；自動備份可單獨設定。'
                )}
              />
              <div className="settings-location">
                <code>
                  {dataLocationLoading
                    ? tr('正在读取…', 'Loading…', '正在讀取…')
                    : dataLocationError
                      ? tr('读取失败', 'Could not load', '讀取失敗')
                      : dataLocation?.directory}
                </code>
                {dataLocation && !dataLocationError && (
                  <span className="settings-location__badge">
                    {dataLocation.isDefault
                      ? tr('默认位置', 'Default', '預設位置')
                      : tr('自定义位置', 'Custom', '自訂位置')}
                  </span>
                )}
              </div>
              {dataLocationError && (
                <div className="settings-notice settings-notice--error">
                  <TriangleAlert size={16} />
                  <span>{dataLocationError}</span>
                  <button className="text-button" onClick={() => void loadSettingsInfo()}>
                    {tr('重试', 'Retry', '重試')}
                  </button>
                </div>
              )}
              {dataLocation?.restartRequired && (
                <div className="settings-notice">
                  <TriangleAlert size={16} />
                  <span>
                    {tr(
                      '数据已迁移，需要重启应用完成切换。',
                      'Data moved. Restart the app to finish switching.',
                      '資料已遷移，需要重新啟動應用程式完成切換。'
                    )}
                  </span>
                  <button
                    className="text-button"
                    onClick={() => void restartApp()}
                    disabled={restartingApp}
                  >
                    {restartingApp ? (
                      <LoaderCircle size={13} className="spin" />
                    ) : null}
                    {restartingApp
                      ? tr('正在重启…', 'Restarting…', '正在重新啟動…')
                      : tr('立即重启', 'Restart now', '立即重新啟動')}
                  </button>
                </div>
              )}
              <div className="settings-inline-actions settings-location-actions">
                <button
                  className={`button button--soft${locationBusy ? ' is-loading' : ''}`}
                  onClick={() => void chooseLocation()}
                  disabled={locationBusy}
                  aria-busy={locationBusy}
                >
                  {locationBusy ? (
                    <LoaderCircle size={15} className="spin" />
                  ) : (
                    <FolderOpen size={15} />
                  )}
                  {locationBusy
                    ? tr('正在迁移…', 'Moving…', '正在遷移…')
                    : tr('更改位置', 'Change location', '變更位置')}
                </button>
                <button
                  className="button button--ghost"
                  onClick={() => void openDataLocation()}
                  disabled={openingDataLocation || dataLocationLoading || Boolean(dataLocationError)}
                  aria-busy={openingDataLocation}
                >
                  {openingDataLocation ? (
                    <LoaderCircle size={15} className="spin" />
                  ) : (
                    <FolderOpen size={15} />
                  )}
                  {openingDataLocation
                    ? tr('打开中…', 'Opening…', '開啟中…')
                    : tr('打开目录', 'Open folder', '開啟目錄')}
                </button>
                <button
                  type="button"
                  className="reset-setting-button"
                  onClick={() => setRestoreLocationOpen(true)}
                  disabled={locationBusy || !dataLocation || dataLocation.isDefault}
                >
                  <RotateCcw size={14} />
                  {tr('恢复默认位置', 'Restore default location', '恢復預設位置')}
                </button>
              </div>
            </div>

            <div className="settings-card">
              <SettingsCardHeading
                icon={<ArchiveRestore size={17} />}
                title={tr(
                  '录制副本保存位置',
                  'Recording draft location',
                  '錄製副本儲存位置'
                )}
                tip={tr(
                  '录制流程在保存完成前会先写入一份副本，保存异常时可在重启后自动补回。留空时使用数据目录下的 pending-recipes 文件夹。',
                  'A draft copy is written before saving completes, so it can be recovered after a restart if saving fails. Leave empty to use the pending-recipes folder in the data directory.',
                  '錄製流程在儲存完成前會先寫入一份副本，儲存異常時可在重新啟動後自動補回。留空時使用資料目錄下的 pending-recipes 資料夾。'
                )}
              />
              <div className="settings-location">
                <code>
                  {settings.recordingDraftDirectory ||
                    (dataLocation?.directory
                      ? `${dataLocation.directory.replace(/[\\/]+$/, '')}\\pending-recipes`
                      : tr(
                          '数据目录\\pending-recipes',
                          'Data directory\\pending-recipes',
                          '資料目錄\\pending-recipes'
                        ))}
                </code>
                <span className="settings-location__badge">
                  {settings.recordingDraftDirectory
                    ? tr('自定义位置', 'Custom', '自訂位置')
                    : tr('默认位置', 'Default', '預設位置')}
                </span>
              </div>
              <div className="settings-inline-actions settings-location-actions">
                <button
                  className={`button button--soft${recordingDraftBusy ? ' is-loading' : ''}`}
                  onClick={() => void chooseRecordingDraftDirectory()}
                  disabled={recordingDraftBusy}
                  aria-busy={recordingDraftBusy}
                >
                  {recordingDraftBusy ? (
                    <LoaderCircle size={15} className="spin" />
                  ) : (
                    <FolderOpen size={15} />
                  )}
                  {recordingDraftBusy
                    ? tr('正在保存…', 'Saving…', '正在儲存…')
                    : tr('更改位置', 'Change location', '變更位置')}
                </button>
                <button
                  className="button button--ghost"
                  onClick={() => void openRecordingDraftDirectory()}
                  disabled={openingRecordingDraftDirectory || recordingDraftBusy}
                  aria-busy={openingRecordingDraftDirectory}
                >
                  {openingRecordingDraftDirectory ? (
                    <LoaderCircle size={15} className="spin" />
                  ) : (
                    <FolderOpen size={15} />
                  )}
                  {openingRecordingDraftDirectory
                    ? tr('打开中…', 'Opening…', '開啟中…')
                    : tr('打开目录', 'Open folder', '開啟目錄')}
                </button>
                <button
                  type="button"
                  className="reset-setting-button"
                  onClick={() => void resetRecordingDraftDirectory()}
                  disabled={recordingDraftBusy || !settings.recordingDraftDirectory}
                >
                  <RotateCcw size={14} />
                  {tr('恢复默认位置', 'Restore default', '恢復預設位置')}
                </button>
              </div>
            </div>

            <div className="settings-card">
              <SettingsCardHeading
                icon={<ShieldCheck size={17} />}
                title={tr(
                  '外部浏览器配置',
                  'External browser profile',
                  '外部瀏覽器設定'
                )}
                tip={tr(
                  '登录时会复用 AutoLogin 管理的独立配置并清除扩展、崩溃恢复等干扰项。若窗口仍出现异常，可重置后重新导入。',
                  'Sign-in reuses an AutoLogin-managed profile and clears extensions and crash-restore state. Reset and re-import if the window still looks wrong.',
                  '登入時會重用 AutoLogin 管理的獨立設定並清除擴充功能、當機還原等干擾項。若視窗仍異常，可重設後重新匯入。'
                )}
              />
              <div className="settings-profile-row">
                <p className="settings-hint settings-hint--danger">
                  {tr(
                    '重置会关闭当前外部浏览器，并清除共享配置中的 Cookie 和登录状态；账号密码与保险库不受影响。',
                    'Reset closes the external browser and clears cookies and sign-in state in the shared profile. Accounts and the vault are unaffected.',
                    '重設會關閉目前外部瀏覽器，並清除共用設定中的 Cookie 和登入狀態；帳號密碼與保險庫不受影響。'
                  )}
                </p>
                <button
                  type="button"
                  className="button button--danger-ghost"
                  onClick={() => setResetBrowserProfileConfirm(true)}
                >
                  <Trash2 size={14} />
                  {tr('重置浏览器配置', 'Reset browser profile', '重設瀏覽器設定')}
                </button>
              </div>
            </div>

            <div className="settings-card backup-card">
              <SettingsCardHeading
                icon={<ArchiveRestore size={17} />}
                title={tr('自动备份', 'Automatic backups', '自動備份')}
                tip={tr(
                  '每次启动软件时静默备份当前加密保险库，滚动保留最新 3 份。可单独选择保存位置，已有备份不会随目录切换移动。',
                  'The encrypted vault is backed up silently on every app launch, keeping the latest three copies. You can choose a separate location; existing backups stay in the previous folder.',
                  '每次啟動軟體時靜默備份目前加密保險庫，滾動保留最新 3 份。可單獨選擇儲存位置，既有備份不會隨目錄切換移動。'
                )}
                action={
                  <button
                    className="icon-button icon-button--small backup-refresh"
                    onClick={() => void loadBackups()}
                    disabled={backupsLoading}
                    aria-label={tr('刷新备份列表', 'Refresh backups', '重新整理備份')}
                  >
                    <RefreshCw size={14} className={backupsLoading ? 'spin' : ''} />
                  </button>
                }
              />
              <div className="settings-location">
                <code>
                  {backupLocationLoading
                    ? tr('正在读取…', 'Loading…', '正在讀取…')
                    : backupLocationError
                      ? tr('读取失败', 'Could not load', '讀取失敗')
                      : backupLocation?.directory}
                </code>
                {backupLocation && !backupLocationError && (
                  <span className="settings-location__badge">
                    {backupLocation.isDefault
                      ? tr('默认位置', 'Default', '預設位置')
                      : tr('自定义位置', 'Custom', '自訂位置')}
                  </span>
                )}
              </div>
              {backupLocationError && (
                <div className="settings-notice settings-notice--error">
                  <TriangleAlert size={16} />
                  <span>{backupLocationError}</span>
                  <button className="text-button" onClick={() => void loadSettingsInfo()}>
                    {tr('重试', 'Retry', '重試')}
                  </button>
                </div>
              )}
              <div className="settings-inline-actions settings-location-actions">
                <button
                  className={`button button--soft${choosingBackupLocation ? ' is-loading' : ''}`}
                  onClick={() => void chooseBackupLocation()}
                  disabled={choosingBackupLocation || backupLocationLoading}
                  aria-busy={choosingBackupLocation}
                >
                  {choosingBackupLocation ? (
                    <LoaderCircle size={15} className="spin" />
                  ) : (
                    <FolderOpen size={15} />
                  )}
                  {choosingBackupLocation
                    ? tr('正在保存…', 'Saving…', '正在儲存…')
                    : tr('更改位置', 'Change location', '變更位置')}
                </button>
                <button
                  className="button button--ghost"
                  onClick={() => void openBackupLocation()}
                  disabled={
                    openingBackupLocation ||
                    backupLocationLoading ||
                    Boolean(backupLocationError)
                  }
                  aria-busy={openingBackupLocation}
                >
                  {openingBackupLocation ? (
                    <LoaderCircle size={15} className="spin" />
                  ) : (
                    <FolderOpen size={15} />
                  )}
                  {openingBackupLocation
                    ? tr('打开中…', 'Opening…', '開啟中…')
                    : tr('打开目录', 'Open folder', '開啟目錄')}
                </button>
                <button
                  type="button"
                  className="reset-setting-button"
                  onClick={() => void restoreDefaultBackupLocation()}
                  disabled={
                    choosingBackupLocation ||
                    !backupLocation ||
                    backupLocation.isDefault
                  }
                >
                  <RotateCcw size={14} />
                  {tr('恢复默认位置', 'Restore default', '恢復預設位置')}
                </button>
              </div>
              {backupsLoading ? (
                <div className="backup-empty">
                  <LoaderCircle size={18} className="spin" />
                  {tr('正在读取备份…', 'Loading backups…', '正在讀取備份…')}
                </div>
              ) : backupsError ? (
                <div className="backup-empty backup-empty--error">
                  <TriangleAlert size={18} />
                  <span>{backupsError}</span>
                  <button className="button button--soft button--small" onClick={() => void loadBackups()}>
                    <RefreshCw size={13} />
                    {tr('重试', 'Retry', '重試')}
                  </button>
                </div>
              ) : backups.length === 0 ? (
                <div className="backup-empty">
                  {tr(
                    '尚无自动备份。下次启动 AutoLogin 时会创建第一份。',
                    'No automatic backups yet. The first one is created on the next launch.',
                    '尚無自動備份。下次啟動 AutoLogin 時會建立第一份。'
                  )}
                </div>
              ) : (
                <div className="backup-list">
                  {backups.map((backup, index) => (
                    <div className="backup-row" key={backup.id}>
                      <span className="backup-row__index">{String(index + 1).padStart(2, '0')}</span>
                      <div className="backup-row__identity">
                        <strong>{formatBackupTime(backup.createdAt, settings.language)}</strong>
                        <small>
                          {backup.fileName} · {formatBytes(backup.size)}
                        </small>
                      </div>
                      <button
                        className="button button--ghost button--small"
                        onClick={() => setConfirmBackup(backup)}
                      >
                        <ArchiveRestore size={14} />
                        {tr('一键恢复', 'Restore', '一鍵還原')}
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </SettingsPanel>
        )}

        {module === 'about' && (
          <SettingsPanel
            icon={<Info size={18} />}
            title={tr('版本与发布', 'Version and releases', '版本與發佈')}
            description={tr(
              '查看当前版本和更新信息。',
              'View the current version and update information.',
              '查看目前版本和更新資訊。'
            )}
          >
            <div className="settings-card">
              <SettingsCardHeading
                icon={<Info size={17} />}
                title={tr('关于 AutoLogin', 'About AutoLogin', '關於 AutoLogin')}
                description={tr(
                  '本地优先的 Windows 登录入口管理工具。',
                  'A local-first login workspace for Windows.',
                  '本機優先的 Windows 登入入口管理工具。'
                )}
              />
              <div className="settings-about-grid">
                <span>{tr('版本', 'Version', '版本')}</span>
                <strong>v{about?.version ?? appVersion}</strong>
                <span>{tr('平台', 'Platform', '平台')}</span>
                <strong>{about ? platformLabel(about.platform) : 'Windows'}</strong>
              </div>
              <div className="settings-inline-actions">
                <button
                  className="text-button"
                  onClick={() => void openPrivacy()}
                  disabled={openingPrivacy}
                >
                  {openingPrivacy ? (
                    <LoaderCircle size={13} className="spin" />
                  ) : null}
                  {openingPrivacy
                    ? tr('打开中…', 'Opening…', '開啟中…')
                    : tr('隐私说明', 'Privacy', '隱私說明')}
                </button>
              </div>
            </div>

            <div className="settings-card">
              <SettingsCardHeading
                icon={<RefreshCw size={17} />}
                title={tr('检查更新', 'Check for updates', '檢查更新')}
                description={tr(
                  '从官方更新源获取版本信息，不会上传任何本地数据。',
                  'Read version information from the official update source without uploading local data.',
                  '從官方更新來源取得版本資訊，不會上傳任何本機資料。'
                )}
              />
              <div className="settings-update-row">
                <button
                  className={`button button--soft${checkingUpdates ? ' is-loading' : ''}`}
                  onClick={() => void checkUpdates()}
                  disabled={checkingUpdates}
                  aria-busy={checkingUpdates}
                >
                  {checkingUpdates ? (
                    <LoadingSpinner />
                  ) : (
                    <RefreshCw size={15} />
                  )}
                  {checkingUpdates
                    ? tr('正在检查…', 'Checking…', '正在檢查…')
                    : tr('检查更新', 'Check now', '檢查更新')}
                </button>
              </div>
              {updateResult && (
                <div className={`settings-update-status is-${updateResult.status}`}>
                  {updateResult.status === 'available' ? (
                    <Download size={16} />
                  ) : updateResult.status === 'up-to-date' ? (
                    <Check size={16} />
                  ) : (
                    <TriangleAlert size={16} />
                  )}
                  <span>
                    <strong>{updateResult.message}</strong>
                    {updateResult.latestVersion && (
                      <small>
                        {tr(
                          `当前 v${updateResult.currentVersion} · 最新 v${updateResult.latestVersion}`,
                          `Current v${updateResult.currentVersion} · Latest v${updateResult.latestVersion}`,
                          `目前 v${updateResult.currentVersion} · 最新 v${updateResult.latestVersion}`
                        )}
                      </small>
                    )}
                  </span>
                </div>
              )}
              {updateState &&
                (updateState.phase === 'available' ||
                  updateState.phase === 'downloading' ||
                  updateState.phase === 'downloaded' ||
                  updateState.phase === 'error') && (
                  <section
                    className={`settings-active-update is-${updateState.phase}`}
                    aria-label={tr('应用内更新状态', 'In-app update status', '應用程式內更新狀態')}
                  >
                    <div className="settings-active-update__summary">
                      <span className="settings-active-update__icon">
                        {updateState.phase === 'downloading' ||
                        downloadUpdateBusy ||
                        installUpdateBusy ? (
                          <LoaderCircle size={16} className="spin" />
                        ) : updateState.phase === 'downloaded' ? (
                          <Check size={16} />
                        ) : updateState.phase === 'error' ? (
                          <TriangleAlert size={16} />
                        ) : (
                          <Download size={16} />
                        )}
                      </span>
                      <span>
                        <strong>
                          {updateState.latestVersion
                            ? tr(
                                `版本 v${updateState.latestVersion}`,
                                `Version v${updateState.latestVersion}`,
                                `版本 v${updateState.latestVersion}`
                              )
                            : tr('应用更新', 'Application update', '應用程式更新')}
                        </strong>
                        <small>
                          {updateState.message ??
                            tr('更新状态已同步', 'Update status synchronized', '更新狀態已同步')}
                        </small>
                      </span>
                      {updateState.phase === 'available' && (
                        <button
                          type="button"
                          className="button button--primary button--small"
                          onClick={() => void startUpdateDownload()}
                          disabled={downloadUpdateBusy || cancelUpdateBusy || installUpdateBusy}
                        >
                          {downloadUpdateBusy ? (
                            <LoaderCircle size={13} className="spin" />
                          ) : (
                            <Download size={13} />
                          )}
                          {tr('立即更新', 'Update now', '立即更新')}
                        </button>
                      )}
                      {updateState.phase === 'downloaded' && (
                        <button
                          type="button"
                          className="button button--primary button--small"
                          onClick={() => void installDownloadedUpdate()}
                          disabled={downloadUpdateBusy || cancelUpdateBusy || installUpdateBusy}
                        >
                          {installUpdateBusy ? (
                            <LoaderCircle size={13} className="spin" />
                          ) : (
                            <RefreshCw size={13} />
                          )}
                          {tr('重启并安装', 'Restart and install', '重新啟動並安裝')}
                        </button>
                      )}
                    </div>
                    {(updateState.phase === 'downloading' ||
                      updateState.phase === 'downloaded') && (
                      <UpdateProgress
                        className="settings-update-progress"
                        state={updateState}
                        cancelling={cancelUpdateBusy}
                        onCancel={
                          updateState.phase === 'downloading'
                            ? () => void cancelUpdateDownload()
                            : undefined
                        }
                      />
                    )}
                  </section>
                )}
            </div>
          </SettingsPanel>
        )}
        </div>

      </section>

      {locationConflict && (
        <Modal
          title={tr(
            '检测到旧版 AutoLogin 数据',
            'Existing AutoLogin data found',
            '偵測到舊版 AutoLogin 資料'
          )}
          onClose={() => {
            if (!locationConflictBusy) setLocationConflict(null)
          }}
          width="540px"
          className="data-location-conflict-dialog"
        >
          <div className="data-location-conflict__body">
            <p className="modal-description">
              {tr(
                '目标目录中已有 AutoLogin 数据。您希望直接加载该目录的数据，还是覆盖并迁移当前数据？',
                'The target directory already contains AutoLogin data. Load that data, or overwrite it while migrating the current data?',
                '目標目錄中已有 AutoLogin 資料。您希望直接載入該目錄的資料，還是覆蓋並遷移目前資料？'
              )}
            </p>
            <code className="data-location-conflict__path">{locationConflict.directory}</code>
            <p className="data-location-conflict__note">
              <ArchiveRestore size={15} />
              <span>
                {tr(
                  '选择覆盖后，目标目录中的旧数据会自动重命名为“旧数据备份_时间戳”，不会直接删除。',
                  'When overwriting, existing target data is renamed to “旧数据备份_时间戳” instead of being deleted.',
                  '選擇覆蓋後，目標目錄中的舊資料會自動重新命名為「旧数据备份_时间戳」，不會直接刪除。'
                )}
              </span>
            </p>
          </div>
          <div className="modal-actions data-location-conflict__actions">
            <button
              className="button button--ghost"
              onClick={() => setLocationConflict(null)}
              disabled={Boolean(locationConflictBusy)}
            >
              {tr('取消', 'Cancel', '取消')}
            </button>
            <button
              className="button button--ghost"
              onClick={() => void resolveLocationConflict('load')}
              disabled={Boolean(locationConflictBusy)}
            >
              {locationConflictBusy === 'load' ? (
                <LoaderCircle size={15} className="spin" />
              ) : (
                <FolderOpen size={15} />
              )}
              {locationConflictBusy === 'load'
                ? tr('正在加载…', 'Loading…', '正在載入…')
                : tr('直接加载该目录的数据', 'Load this directory', '直接載入此目錄的資料')}
            </button>
            <button
              className="button button--primary"
              onClick={() => void resolveLocationConflict('overwrite')}
              disabled={Boolean(locationConflictBusy)}
            >
              {locationConflictBusy === 'overwrite' ? (
                <LoaderCircle size={15} className="spin" />
              ) : (
                <ArchiveRestore size={15} />
              )}
              {locationConflictBusy === 'overwrite'
                ? tr('正在迁移…', 'Migrating…', '正在遷移…')
                : tr('备份旧数据并覆盖', 'Back up and overwrite', '備份舊資料並覆蓋')}
            </button>
          </div>
        </Modal>
      )}

      {clearOpen && (
        <ConfirmDialog
          title={tr('清除所有本地数据？', 'Clear all local data?', '清除所有本機資料？')}
          description={tr(
            '所有账号、密码、录制流程、备份和网站会话都会被永久删除，无法恢复。',
            'All accounts, passwords, recorded flows, backups and website sessions will be permanently deleted.',
            '所有帳號、密碼、錄製流程、備份和網站工作階段都會被永久刪除，無法復原。'
          )}
          confirmLabel={tr('永久清除', 'Delete permanently', '永久清除')}
          danger
          busy={clearBusy}
          onConfirm={() => void clearAll()}
          onClose={() => setClearOpen(false)}
        />
      )}

      {confirmBackup && (
        <ConfirmDialog
          title={tr('恢复这份备份？', 'Restore this backup?', '還原這份備份？')}
          description={tr(
            '当前保险库会被所选加密备份替换，应用随后锁定。请使用该备份对应的主密码重新解锁。',
            'The current vault will be replaced by the selected encrypted backup and the app will lock. Unlock with the master password that matches that backup.',
            '目前保險庫會被所選加密備份取代，應用程式隨後鎖定。請使用該備份對應的主密碼重新解鎖。'
          )}
          confirmLabel={tr('确认恢复', 'Restore backup', '確認還原')}
          busy={restoringBackup}
          onConfirm={() => void restoreBackup()}
          onClose={() => setConfirmBackup(null)}
        />
      )}

      {restoreLocationOpen && (
        <ConfirmDialog
          title={tr(
            '恢复默认数据目录？',
            'Restore the default data location?',
            '恢復預設資料目錄？'
          )}
          description={tr(
            '是否将现有数据迁移回默认目录？迁移完成后需要重启 AutoLogin 才能继续使用新位置。',
            'Move the existing data back to the default directory? Restart AutoLogin after the migration to use the new location.',
            '是否將現有資料遷移回預設目錄？遷移完成後需要重新啟動 AutoLogin 才能繼續使用新位置。'
          )}
          confirmLabel={tr('迁移并恢复', 'Move and restore', '遷移並恢復')}
          busy={locationBusy}
          onConfirm={() => void restoreDefaultLocation()}
          onClose={() => {
            if (!locationBusy) setRestoreLocationOpen(false)
          }}
        />
      )}

      {resetBrowserProfileConfirm && (
        <ConfirmDialog
          title={tr(
            '重置共享浏览器配置？',
            'Reset the shared browser profile?',
            '重設共用瀏覽器設定？'
          )}
          description={tr(
            '将关闭当前外部浏览器，并清除共享配置中的 Cookie 与登录状态。账号密码和保险库不会受影响，下次登录需要重新验证部分站点。',
            'This closes the external browser and clears cookies and sign-in state from the shared profile. Accounts and the vault are unaffected, but some sites may require sign-in again.',
            '將關閉目前外部瀏覽器，並清除共用設定中的 Cookie 與登入狀態。帳號密碼和保險庫不會受影響，下次登入需要重新驗證部分站點。'
          )}
          confirmLabel={tr('确认重置', 'Reset profile', '確認重設')}
          danger
          busy={resettingBrowserProfile}
          onConfirm={() => void resetBrowserProfile()}
          onClose={() => {
            if (!resettingBrowserProfile) setResetBrowserProfileConfirm(false)
          }}
        />
      )}

      {backupEditor && (
        <Modal
          className="backup-export-dialog"
          title={tr('导出数据库备份', 'Export a database backup', '匯出資料庫備份')}
          width="480px"
          onClose={() => {
            if (!backupEditor.busy) setBackupEditor(null)
          }}
        >
          <form
            className="backup-export-form"
            onSubmit={(event) => void submitBackupExport(event)}
          >
            <p className="modal-description">
              {tr(
                `将「${backupEditor.name}」导出为加密的 .autologin 备份，需要为这份文件单独设置导出密码。`,
                `Export "${backupEditor.name}" as an encrypted .autologin backup and set a password for this file.`,
                `將「${backupEditor.name}」匯出為加密的 .autologin 備份，需要為這份檔案單獨設定匯出密碼。`
              )}
            </p>
            <label className="field">
              <span className="field__label">
                {tr('导出密码', 'Export password', '匯出密碼')}
              </span>
              <span className="input-shell">
                <input
                  type="password"
                  value={backupEditor.password}
                  placeholder={tr('至少 8 个字符', 'At least 8 characters', '至少 8 個字元')}
                  onChange={(event) =>
                    setBackupEditor({ ...backupEditor, password: event.target.value })
                  }
                  autoComplete="new-password"
                  data-autofocus
                />
              </span>
            </label>
            <label className="field">
              <span className="field__label">
                {tr('确认导出密码', 'Confirm export password', '確認匯出密碼')}
              </span>
              <span className="input-shell">
                <input
                  type="password"
                  value={backupEditor.confirm}
                  placeholder={tr('再输一次', 'Type it again', '再輸入一次')}
                  onChange={(event) =>
                    setBackupEditor({ ...backupEditor, confirm: event.target.value })
                  }
                  autoComplete="new-password"
                />
              </span>
            </label>
            {backupEditor.error && <p className="form-error">{backupEditor.error}</p>}
            <p className="backup-export-dialog__hint">
              {tr(
                '备份文件不会自动更新，重新打开时会要求输入这里设置的密码。',
                'The backup file is not updated automatically; it asks for this password when reopened.',
                '備份檔案不會自動更新，重新開啟時會要求輸入這裡設定的密碼。'
              )}
            </p>
            <div className="modal-actions">
              <button
                className="button button--ghost"
                type="button"
                onClick={() => setBackupEditor(null)}
                disabled={backupEditor.busy}
              >
                {tr('取消', 'Cancel', '取消')}
              </button>
              <button
                className="button button--primary"
                type="submit"
                disabled={
                  backupEditor.busy ||
                  backupEditor.password.length < 8 ||
                  backupEditor.password !== backupEditor.confirm
                }
                aria-busy={backupEditor.busy}
              >
                {backupEditor.busy && <LoaderCircle size={14} className="spin" />}
                {tr('选择保存位置…', 'Choose location…', '選擇儲存位置…')}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {unlockTarget && (
        <DatabasePasswordDialog
          mode="unlock"
          databaseName={unlockTarget.name}
          onClose={() => setUnlockTarget(null)}
          onSubmit={async ({ nextPassword }) => {
            const name = unlockTarget.name
            await onUnlockDatabase(unlockTarget.id, nextPassword)
            setUnlockTarget(null)
            await onVaultStatusChange()
            await loadDatabases()
            notify(
              'success',
              tr(`「${name}」已解锁`, `"${name}" is unlocked.`, `「${name}」已解鎖`)
            )
          }}
        />
      )}

      {removeTarget && (
        <ConfirmDialog
          title={tr(
            `移除「${removeTarget.name}」？`,
            `Remove "${removeTarget.name}"?`,
            `移除「${removeTarget.name}」？`
          )}
          description={tr(
            '移除后这个数据库会从列表隐藏，账号数据和 .autologin 文件仍保留在本地，可以随时重新打开。',
            'The database is hidden from the list; its accounts and the .autologin file stay on this device and can be reopened later.',
            '移除後這個資料庫會從清單隱藏，帳號資料和 .autologin 檔案仍保留在本機，可以隨時重新開啟。'
          )}
          confirmLabel={tr('移除', 'Remove', '移除')}
          danger
          busy={removingDatabase}
          onConfirm={() => void removeDatabase()}
          onClose={() => {
            if (!removingDatabase) setRemoveTarget(null)
          }}
        />
      )}

    </>
  )
}

function SettingsPanel({
  children
}: {
  icon: React.ReactNode
  title: string
  description: string
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <section className="settings-panel">
      <div className="settings-panel__body">{children}</div>
    </section>
  )
}

function SettingSaveHint({
  state
}: {
  state?: { phase: SettingSavePhase; message?: string }
}): React.JSX.Element | null {
  const { tr } = useI18n()
  if (!state) return null
  const text =
    state.phase === 'saving'
      ? tr('保存中…', 'Saving…', '儲存中…')
      : state.phase === 'saved'
        ? tr('已保存', 'Saved', '已儲存')
        : tr('保存失败', 'Save failed', '儲存失敗')
  return (
    <span
      className={`setting-save-state is-${state.phase}`}
      role="status"
      aria-live="polite"
      title={state.message || text}
    >
      <i aria-hidden="true" />
      {text}
    </span>
  )
}

function SettingsCardHeading({
  icon,
  title,
  description,
  tip,
  action
}: {
  icon: React.ReactNode
  title: string
  description?: string
  tip?: React.ReactNode
  action?: React.ReactNode
}): React.JSX.Element {
  return (
    <div className="settings-card__heading">
      {icon}
      <div>
        <h4>
          {title}
          {tip ? <InfoTip>{tip}</InfoTip> : null}
        </h4>
        {description ? <p>{description}</p> : null}
      </div>
      {action}
    </div>
  )
}

function platformLabel(platform: string): string {
  if (platform === 'win32') return 'Windows x64'
  if (platform === 'darwin') return 'macOS'
  if (platform === 'linux') return 'Linux'
  return platform
}

async function waitForLoadingFeedback(startedAt: number): Promise<void> {
  const remaining = 500 - (Date.now() - startedAt)
  if (remaining > 0) {
    await new Promise((resolve) => window.setTimeout(resolve, remaining))
  }
}

function formatBytes(value: number): string {
  if (value < 1024) return `${value} B`
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`
  return `${(value / (1024 * 1024)).toFixed(1)} MB`
}

function formatBackupTime(value: string, language: AppLanguage): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat(
    language === 'en' ? 'en-US' : language === 'zh-TW' ? 'zh-TW' : 'zh-CN',
    {
      dateStyle: 'medium',
      timeStyle: 'short'
    }
  ).format(date)
}
