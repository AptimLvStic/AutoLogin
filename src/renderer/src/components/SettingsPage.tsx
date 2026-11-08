import { useEffect, useRef, useState } from 'react'
import {
  ArchiveRestore,
  Check,
  ChevronRight,
  Database,
  Download,
  ExternalLink,
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
  INTERFACE_SCALE_MAX,
  INTERFACE_SCALE_MIN,
  INTERFACE_SCALE_STEP,
  PROXY_PROTOCOLS,
  type AboutInfo,
  type AppLanguage,
  type AppSettings,
  type AppSettingsPatch,
  type AppUpdateState,
  type AutoLockMinutes,
  type BackupRecord,
  type ColorMode,
  type DataLocationInfo,
  type ProxySettings,
  type ProxyTestResult,
  type UpdateCheckResult
} from '@shared/types'
import { DEFAULT_APP_SETTINGS } from '@shared/theme'
import {
  displayKeyboardShortcut,
  shortcutFromKeyboardEvent
} from '@shared/shortcuts'
import { translate, useI18n } from '../i18n'
import { ConfirmDialog } from './Modal'
import { PasswordStrength } from './PasswordStrength'
import { UpdateProgress } from './UpdateDialog'
import { LoadingSpinner } from './LoadingSpinner'

export type SettingsModule =
  | 'general'
  | 'network'
  | 'security'
  | 'data'
  | 'about'

export function SettingsPage({
  module,
  settings,
  appVersion,
  updateState,
  onModuleChange,
  onSettingsChange,
  onRefresh,
  onClearAllData,
  onDownloadUpdate,
  onCancelUpdate,
  onInstallUpdate,
  notify
}: {
  module: SettingsModule
  settings: AppSettings
  appVersion: string
  updateState: AppUpdateState | null
  onModuleChange: (module: SettingsModule) => void
  onSettingsChange: (patch: AppSettingsPatch) => Promise<void>
  onRefresh: () => Promise<void>
  onClearAllData: () => Promise<void>
  onDownloadUpdate: () => Promise<void>
  onCancelUpdate: () => Promise<void>
  onInstallUpdate: () => Promise<void>
  notify: (kind: 'success' | 'error' | 'info', message: string) => void
}): React.JSX.Element {
  const { tr, formatDate } = useI18n()
  const [autoLock, setAutoLock] = useState<AutoLockMinutes>(settings.autoLockMinutes)
  const [currentPassword, setCurrentPassword] = useState('')
  const [nextPassword, setNextPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [changingPassword, setChangingPassword] = useState(false)
  const [clearOpen, setClearOpen] = useState(false)
  const [clearBusy, setClearBusy] = useState(false)
  const [about, setAbout] = useState<AboutInfo | null>(null)
  const [dataLocation, setDataLocation] = useState<DataLocationInfo | null>(null)
  const [locationBusy, setLocationBusy] = useState(false)
  const [restoreLocationOpen, setRestoreLocationOpen] = useState(false)
  const [updateResult, setUpdateResult] = useState<UpdateCheckResult | null>(null)
  const [checkingUpdates, setCheckingUpdates] = useState(false)
  const [downloadUpdateBusy, setDownloadUpdateBusy] = useState(false)
  const [cancelUpdateBusy, setCancelUpdateBusy] = useState(false)
  const [installUpdateBusy, setInstallUpdateBusy] = useState(false)
  const [interfaceScale, setInterfaceScale] = useState(settings.interfaceScale)
  const [fontSizeScale, setFontSizeScale] = useState(settings.fontSizeScale)
  const [proxy, setProxy] = useState<ProxySettings>(settings.proxy)
  const [proxySaving, setProxySaving] = useState(false)
  const [proxyTesting, setProxyTesting] = useState(false)
  const [proxyResult, setProxyResult] = useState<ProxyTestResult | null>(null)
  const [backups, setBackups] = useState<BackupRecord[]>([])
  const [backupsLoading, setBackupsLoading] = useState(false)
  const [confirmBackup, setConfirmBackup] = useState<BackupRecord | null>(null)
  const [restoringBackup, setRestoringBackup] = useState(false)
  const scaleSaveTimer = useRef<number | null>(null)

  useEffect(() => {
    setAutoLock(settings.autoLockMinutes)
  }, [settings.autoLockMinutes])

  useEffect(() => {
    setInterfaceScale(settings.interfaceScale)
    setFontSizeScale(settings.fontSizeScale)
    setProxy(settings.proxy)
  }, [settings.fontSizeScale, settings.interfaceScale, settings.proxy])

  useEffect(() => {
    return () => {
      if (scaleSaveTimer.current) window.clearTimeout(scaleSaveTimer.current)
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    void Promise.all([window.autologin.app.getAbout(), window.autologin.app.getDataLocation()])
      .then(([nextAbout, nextLocation]) => {
        if (!cancelled) {
          setAbout(nextAbout)
          setDataLocation(nextLocation)
        }
      })
      .catch((error) => {
        if (!cancelled) {
          notify(
            'error',
            error instanceof Error
              ? error.message
              : tr('无法读取应用信息', 'Could not read app information.', '無法讀取應用程式資訊')
          )
        }
      })
    return () => {
      cancelled = true
    }
  }, [notify])

  useEffect(() => {
    if (module === 'data') {
      void loadBackups()
    }
  }, [module])

  async function changeAutoLock(value: AutoLockMinutes): Promise<void> {
    setAutoLock(value)
    try {
      await onSettingsChange({ autoLockMinutes: value })
      notify(
        'success',
        tr(
          '自动锁定已设为 {value} 分钟',
          'Auto-lock set to {value} minutes.',
          '自動鎖定已設為 {value} 分鐘',
          { value }
        )
      )
    } catch (error) {
      setAutoLock(settings.autoLockMinutes)
      notify(
        'error',
        error instanceof Error
          ? error.message
          : tr('设置保存失败', 'Could not save setting.', '設定儲存失敗')
      )
    }
  }

  async function saveAppearance(patch: AppSettingsPatch, message: string): Promise<void> {
    try {
      await onSettingsChange(patch)
      notify('success', message)
    } catch (error) {
      notify(
        'error',
        error instanceof Error
          ? error.message
          : tr('外观设置保存失败', 'Could not save appearance.', '外觀設定儲存失敗')
      )
    }
  }

  function scheduleScaleSave(value: number): void {
    setInterfaceScale(value)
    if (scaleSaveTimer.current) window.clearTimeout(scaleSaveTimer.current)
    scaleSaveTimer.current = window.setTimeout(() => {
      void saveAppearance(
        { interfaceScale: value },
        tr(
          '界面比例已设为 {value}%',
          'Interface scale set to {value}%.',
          '介面比例已設為 {value}%',
          { value }
        )
      )
    }, 260)
  }

  async function changeFontSize(value: number): Promise<void> {
    setFontSizeScale(value)
    try {
      await onSettingsChange({ fontSizeScale: value })
      notify(
        'success',
        tr(
          '字体大小已设为 {value}%',
          'Font size set to {value}%.',
          '字體大小已設為 {value}%',
          { value }
        )
      )
    } catch (error) {
      setFontSizeScale(settings.fontSizeScale)
      notify(
        'error',
        error instanceof Error
          ? error.message
          : tr('字体大小保存失败', 'Could not save font size.', '字體大小儲存失敗')
      )
    }
  }

  async function resetScale(): Promise<void> {
    if (scaleSaveTimer.current) {
      window.clearTimeout(scaleSaveTimer.current)
      scaleSaveTimer.current = null
    }
    setInterfaceScale(100)
    await saveAppearance(
      { interfaceScale: 100 },
      tr('界面比例已恢复默认', 'Interface scale reset to default.', '介面比例已恢復預設')
    )
  }

  async function resetFontSize(): Promise<void> {
    await changeFontSize(100)
  }

  async function updateCopyShortcut(enabled: boolean): Promise<void> {
    try {
      await onSettingsChange({ accountCopyShortcutEnabled: enabled })
      notify(
        'success',
        enabled
          ? tr('账号复制快捷键已启用', 'Account copy shortcut enabled.', '帳號複製快捷鍵已啟用')
          : tr('账号复制快捷键已关闭', 'Account copy shortcut disabled.', '帳號複製快捷鍵已關閉')
      )
    } catch (error) {
      notify(
        'error',
        error instanceof Error
          ? error.message
          : tr('快捷键设置保存失败', 'Could not save shortcut.', '快捷鍵設定儲存失敗')
      )
    }
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
    try {
      await onSettingsChange({ accountCopyShortcut: shortcut })
      notify(
        'success',
        tr(
          `账号复制快捷键已设为 ${displayKeyboardShortcut(shortcut)}`,
          `Account copy shortcut set to ${displayKeyboardShortcut(shortcut)}.`,
          `帳號複製快捷鍵已設為 ${displayKeyboardShortcut(shortcut)}`
        )
      )
    } catch (error) {
      notify(
        'error',
        error instanceof Error
          ? error.message
          : tr('快捷键设置保存失败', 'Could not save shortcut.', '快捷鍵設定儲存失敗')
      )
    }
  }

  async function resetAllSettings(): Promise<void> {
    if (scaleSaveTimer.current) {
      window.clearTimeout(scaleSaveTimer.current)
      scaleSaveTimer.current = null
    }
    setAutoLock(DEFAULT_APP_SETTINGS.autoLockMinutes)
    setInterfaceScale(DEFAULT_APP_SETTINGS.interfaceScale)
    setFontSizeScale(DEFAULT_APP_SETTINGS.fontSizeScale)
    setProxy(DEFAULT_APP_SETTINGS.proxy)
    setProxyResult(null)
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
        groupOrder: []
      },
      translate(
        settings.language,
        '所有设置已恢复默认',
        'All settings reset to defaults.',
        '所有設定已恢復預設'
      )
    )
  }

  async function submitPassword(event: React.FormEvent): Promise<void> {
    event.preventDefault()
    if (nextPassword.length < 10) {
      notify(
        'error',
        tr(
          '新主密码至少需要 10 个字符',
          'The new master password needs at least 10 characters.',
          '新主密碼至少需要 10 個字元'
        )
      )
      return
    }
    if (nextPassword !== confirmPassword) {
      notify(
        'error',
        tr(
          '两次输入的新主密码不一致',
          'The new master passwords do not match.',
          '兩次輸入的新主密碼不一致'
        )
      )
      return
    }
    setChangingPassword(true)
    try {
      await window.autologin.vault.changePassword(currentPassword, nextPassword)
      setCurrentPassword('')
      setNextPassword('')
      setConfirmPassword('')
      notify('success', tr('主密码已更新', 'Master password updated.', '主密碼已更新'))
    } catch (error) {
      notify(
        'error',
        error instanceof Error
          ? error.message
          : tr('主密码修改失败', 'Could not change master password.', '主密碼修改失敗')
      )
    } finally {
      setChangingPassword(false)
    }
  }

  async function chooseLocation(): Promise<void> {
    setLocationBusy(true)
    try {
      const next = await window.autologin.app.chooseDataLocation()
      if (next) {
        setDataLocation(next)
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
    await saveAppearance(
      { colorMode },
      tr(
        colorMode === 'system'
          ? '外观已跟随系统'
          : colorMode === 'dark'
            ? '已切换为暗色外观'
            : '已切换为亮色外观',
        colorMode === 'system'
          ? 'Appearance now follows the system.'
          : colorMode === 'dark'
            ? 'Dark appearance enabled.'
            : 'Light appearance enabled.',
        colorMode === 'system'
          ? '外觀已跟隨系統'
          : colorMode === 'dark'
            ? '已切換為暗色外觀'
            : '已切換為亮色外觀'
      )
    )
  }

  async function changeLanguage(language: AppLanguage): Promise<void> {
    try {
      await onSettingsChange({ language })
      notify(
        'success',
        translate(
          language,
          '界面语言已切换为简体中文',
          'Language switched to English.',
          '介面語言已切換為繁體中文'
        )
      )
    } catch (error) {
      notify(
        'error',
        error instanceof Error
          ? error.message
          : tr('语言设置保存失败', 'Could not save language.', '語言設定儲存失敗')
      )
    }
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
    try {
      await onSettingsChange({ proxy })
      notify(
        'success',
        tr('网络代理配置已保存', 'Network proxy settings saved.', '網路代理設定已儲存')
      )
    } catch (error) {
      notify(
        'error',
        error instanceof Error
          ? error.message
          : tr('代理配置保存失败', 'Could not save proxy settings.', '代理設定儲存失敗')
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
    try {
      setBackups(await window.autologin.data.listBackups())
    } catch (error) {
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

  const title = settingsModuleTitle(module, tr)
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
          <header className="settings-page__header">
            <nav className="page-breadcrumb" aria-label={tr('面包屑', 'Breadcrumb', '麵包屑')}>
              <span>{tr('设置', 'Settings', '設定')}</span>
              <ChevronRight size={12} />
              <h2>{title}</h2>
            </nav>
          </header>

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
                  min={INTERFACE_SCALE_MIN}
                  max={INTERFACE_SCALE_MAX}
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
                    '可在 80% 至 125% 之间调整',
                    'Adjustable from 80% to 125%.',
                    '可在 80% 至 125% 之間調整'
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
              >
                <RotateCcw size={15} />
                {tr('恢复默认设置', 'Restore defaults', '恢復預設設定')}
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
            title={tr('主密码与本地数据', 'Master password and local data', '主密碼與本機資料')}
            description={tr(
              '管理主密码和本机数据的清除操作。',
              'Manage the master password and local data deletion.',
              '管理主密碼和本機資料清除操作。'
            )}
          >
            <div className="settings-card">
              <SettingsCardHeading
                icon={<KeyRound size={17} />}
                title={tr('修改主密码', 'Change master password', '修改主密碼')}
                description={tr(
                  '修改后会使用新的密钥重新加密整个保险库。',
                  'The entire vault is re-encrypted with the new key.',
                  '修改後會使用新的金鑰重新加密整個保險庫。'
                )}
              />
              <form className="settings-password-form" onSubmit={submitPassword}>
                <label className="field">
                  <span className="field__label">
                    {tr('当前主密码', 'Current master password', '目前主密碼')}
                  </span>
                  <span className="input-shell">
                    <input
                      type="password"
                      value={currentPassword}
                      onChange={(event) => setCurrentPassword(event.target.value)}
                      autoComplete="current-password"
                    />
                  </span>
                </label>
                <div className="field-row">
                  <label className="field">
                    <span className="field__label">
                      {tr('新主密码', 'New master password', '新主密碼')}
                    </span>
                    <span className="input-shell">
                      <input
                        type="password"
                        value={nextPassword}
                        onChange={(event) => setNextPassword(event.target.value)}
                        autoComplete="new-password"
                      />
                    </span>
                  </label>
                  <label className="field">
                    <span className="field__label">
                      {tr('确认新密码', 'Confirm new password', '確認新密碼')}
                    </span>
                    <span className="input-shell">
                      <input
                        type="password"
                        value={confirmPassword}
                        onChange={(event) => setConfirmPassword(event.target.value)}
                        autoComplete="new-password"
                      />
                    </span>
                  </label>
                </div>
                {nextPassword && <PasswordStrength password={nextPassword} />}
                <button
                  className="button button--soft button--align-self"
                  type="submit"
                  disabled={
                    changingPassword ||
                    !currentPassword ||
                    nextPassword.length < 10 ||
                    nextPassword !== confirmPassword
                  }
                >
                  {changingPassword
                    ? tr('正在更新…', 'Updating…', '正在更新…')
                    : tr('更新主密码', 'Update master password', '更新主密碼')}
                </button>
              </form>
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
                description={tr(
                  '保险库、账号配置、登录日志、备份和浏览器会话都保存在此目录。',
                  'Vault, accounts, logs, backups and browser sessions are stored here.',
                  '保險庫、帳號設定、登入日誌、備份和瀏覽器工作階段都儲存在此目錄。'
                )}
              />
              <div className="settings-location">
                <code>{dataLocation?.directory ?? tr('正在读取…', 'Loading…', '正在讀取…')}</code>
                <span className="settings-location__badge">
                  {dataLocation?.isDefault
                    ? tr('默认位置', 'Default', '預設位置')
                    : tr('自定义位置', 'Custom', '自訂位置')}
                </span>
              </div>
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
                    onClick={() => void window.autologin.app.restart()}
                  >
                    {tr('立即重启', 'Restart now', '立即重新啟動')}
                  </button>
                </div>
              )}
              <div className="settings-inline-actions settings-location-actions">
                <button
                  className="button button--soft"
                  onClick={() => void chooseLocation()}
                  disabled={locationBusy}
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
                  onClick={() => void window.autologin.app.openDataLocation()}
                >
                  {tr('打开目录', 'Open folder', '開啟目錄')}
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

            <div className="settings-card backup-card">
              <div className="settings-card__heading">
                <ArchiveRestore size={17} />
                <div>
                  <h4>{tr('自动备份', 'Automatic backups', '自動備份')}</h4>
                  <p>
                    {tr(
                      '每次启动软件时静默备份当前加密保险库，滚动保留最新 3 份。',
                      'The encrypted vault is backed up silently on every app launch, keeping the latest three copies.',
                      '每次啟動軟體時靜默備份目前加密保險庫，滾動保留最新 3 份。'
                    )}
                  </p>
                </div>
                <button
                  className="icon-button icon-button--small backup-refresh"
                  onClick={() => void loadBackups()}
                  disabled={backupsLoading}
                  aria-label={tr('刷新备份列表', 'Refresh backups', '重新整理備份')}
                >
                  <RefreshCw size={14} className={backupsLoading ? 'spin' : ''} />
                </button>
              </div>
              {backupsLoading ? (
                <div className="backup-empty">
                  <LoaderCircle size={18} className="spin" />
                  {tr('正在读取备份…', 'Loading backups…', '正在讀取備份…')}
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
              '查看版本、源代码和 GitHub 发布信息。',
              'View version, source code and GitHub releases.',
              '查看版本、原始碼和 GitHub 發佈資訊。'
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
                <span>{about?.runtimeName ?? 'Tauri'}</span>
                <strong>{about?.runtimeVersion || '—'}</strong>
                <span>{tr('平台', 'Platform', '平台')}</span>
                <strong>{about ? platformLabel(about.platform) : 'Windows'}</strong>
              </div>
              <div className="settings-inline-actions">
                <button
                  className="text-button"
                  onClick={() => void window.autologin.app.openRepository()}
                >
                  {tr('源代码仓库', 'Source repository', '原始碼儲存庫')}{' '}
                  <ExternalLink size={13} />
                </button>
                <button
                  className="text-button"
                  onClick={() => void window.autologin.app.openPrivacy()}
                >
                  {tr('隐私说明', 'Privacy', '隱私說明')}
                </button>
              </div>
            </div>

            <div className="settings-card">
              <SettingsCardHeading
                icon={<RefreshCw size={17} />}
                title={tr('检查更新', 'Check for updates', '檢查更新')}
                description={tr(
                  '从 GitHub Releases 获取版本信息，不会上传任何本地数据。',
                  'Read version information from GitHub Releases without uploading local data.',
                  '從 GitHub Releases 取得版本資訊，不會上傳任何本機資料。'
                )}
              />
              <div className="settings-update-row">
                <button
                  className="button button--soft"
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
                <button
                  className="button button--ghost"
                  onClick={() => void window.autologin.app.openReleases()}
                >
                  {tr('打开发布页', 'Open releases', '開啟發佈頁')}
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
                  {updateResult.status === 'available' && (
                    <button
                      className="text-button"
                      onClick={() => void window.autologin.app.openReleases()}
                    >
                      {tr('查看发布', 'View release', '查看發佈')}
                    </button>
                  )}
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

function SettingsCardHeading({
  icon,
  title,
  description
}: {
  icon: React.ReactNode
  title: string
  description: string
}): React.JSX.Element {
  return (
    <div className="settings-card__heading">
      {icon}
      <div>
        <h4>{title}</h4>
        <p>{description}</p>
      </div>
    </div>
  )
}

function settingsModuleTitle(
  module: SettingsModule,
  tr: (zhCN: string, en: string, zhTW: string) => string
): string {
  const titles: Record<SettingsModule, string> = {
    general: tr('通用配置', 'General', '一般設定'),
    network: tr('网络代理', 'Network proxy', '網路代理'),
    security: tr('安全与隐私', 'Security & privacy', '安全性與隱私'),
    data: tr('数据与备份', 'Data & backups', '資料與備份'),
    about: tr('关于与更新', 'About & updates', '關於與更新')
  }
  return titles[module]
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
