import { useEffect, useRef, useState } from 'react'
import {
  ArchiveRestore,
  BookOpen,
  Check,
  ChevronRight,
  Database,
  Download,
  ExternalLink,
  FileDown,
  FileSpreadsheet,
  FolderOpen,
  Import,
  Info,
  KeyRound,
  Languages,
  LoaderCircle,
  LockKeyhole,
  Moon,
  Network,
  Palette,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
  SlidersHorizontal,
  Sun,
  Trash2,
  TriangleAlert,
  Upload
} from 'lucide-react'
import {
  AUTO_LOCK_OPTIONS,
  DEFAULT_PROXY_TEST_URL,
  INTERFACE_SCALE_MAX,
  INTERFACE_SCALE_MIN,
  INTERFACE_SCALE_STEP,
  PROXY_PROTOCOLS,
  type AboutInfo,
  type AppLogEntry,
  type AppLanguage,
  type AppSettings,
  type AppSettingsPatch,
  type AutoLockMinutes,
  type BackupRecord,
  type ColorMode,
  type DataImportResult,
  type DataLocationInfo,
  type KdbxSelection,
  type ProxySettings,
  type ProxyTestResult,
  type ThemeColors,
  type ThemePreset,
  type UpdateCheckResult
} from '@shared/types'
import {
  DEFAULT_APP_SETTINGS,
  DEFAULT_THEME_COLORS,
  THEME_PRESETS,
  resolveThemeColors
} from '@shared/theme'
import { translate, useI18n } from '../i18n'
import { ConfirmDialog, Modal } from './Modal'
import { PasswordStrength } from './PasswordStrength'

export type SettingsModule =
  | 'general'
  | 'appearance'
  | 'network'
  | 'security'
  | 'data'
  | 'appLogs'
  | 'about'

export function SettingsPage({
  module,
  settings,
  appVersion,
  onModuleChange,
  onSettingsChange,
  onRefresh,
  onClearAllData,
  notify
}: {
  module: SettingsModule
  settings: AppSettings
  appVersion: string
  onModuleChange: (module: SettingsModule) => void
  onSettingsChange: (patch: AppSettingsPatch) => Promise<void>
  onRefresh: () => Promise<void>
  onClearAllData: () => Promise<void>
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
  const [updateResult, setUpdateResult] = useState<UpdateCheckResult | null>(null)
  const [checkingUpdates, setCheckingUpdates] = useState(false)
  const [customTheme, setCustomTheme] = useState<ThemeColors>(settings.customTheme)
  const [interfaceScale, setInterfaceScale] = useState(settings.interfaceScale)
  const [proxy, setProxy] = useState<ProxySettings>(settings.proxy)
  const [proxySaving, setProxySaving] = useState(false)
  const [proxyTesting, setProxyTesting] = useState(false)
  const [proxyResult, setProxyResult] = useState<ProxyTestResult | null>(null)
  const [backups, setBackups] = useState<BackupRecord[]>([])
  const [backupsLoading, setBackupsLoading] = useState(false)
  const [confirmBackup, setConfirmBackup] = useState<BackupRecord | null>(null)
  const [restoringBackup, setRestoringBackup] = useState(false)
  const [importBusy, setImportBusy] = useState(false)
  const [importResult, setImportResult] = useState<DataImportResult | null>(null)
  const [kdbxSelection, setKdbxSelection] = useState<KdbxSelection | null>(null)
  const [kdbxPassword, setKdbxPassword] = useState('')
  const [kdbxError, setKdbxError] = useState('')
  const [kdbxBusy, setKdbxBusy] = useState(false)
  const [appLogs, setAppLogs] = useState<AppLogEntry[]>([])
  const [appLogsLoading, setAppLogsLoading] = useState(false)
  const [appLogsClearOpen, setAppLogsClearOpen] = useState(false)
  const [appLogsClearing, setAppLogsClearing] = useState(false)
  const scaleSaveTimer = useRef<number | null>(null)

  useEffect(() => {
    setAutoLock(settings.autoLockMinutes)
  }, [settings.autoLockMinutes])

  useEffect(() => {
    setCustomTheme(settings.customTheme)
    setInterfaceScale(settings.interfaceScale)
    setProxy(settings.proxy)
  }, [settings.customTheme, settings.interfaceScale, settings.proxy])

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
    if (module === 'appLogs') {
      void loadAppLogs()
    }
  }, [module])

  async function loadAppLogs(): Promise<void> {
    setAppLogsLoading(true)
    try {
      setAppLogs(await window.autologin.app.listAppLogs(200))
    } catch (error) {
      notify(
        'error',
        error instanceof Error
          ? error.message
          : tr('读取软件日志失败', 'Could not read app logs.', '讀取軟體日誌失敗')
      )
    } finally {
      setAppLogsLoading(false)
    }
  }

  async function clearApplicationLogs(): Promise<void> {
    setAppLogsClearing(true)
    try {
      const result = await window.autologin.app.clearAppLogs()
      setAppLogsClearOpen(false)
      setAppLogs([])
      notify(
        'success',
        tr(
          `已清除 ${result.deleted} 条软件日志`,
          `Cleared ${result.deleted} app log entries.`,
          `已清除 ${result.deleted} 筆軟體日誌`
        )
      )
    } catch (error) {
      notify(
        'error',
        error instanceof Error
          ? error.message
          : tr('清除软件日志失败', 'Could not clear app logs.', '清除軟體日誌失敗')
      )
    } finally {
      setAppLogsClearing(false)
    }
  }

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

  function updateCustomColor(key: keyof ThemeColors, value: string): void {
    setCustomTheme((current) => ({ ...current, [key]: value.toUpperCase() }))
  }

  async function applyCustomTheme(): Promise<void> {
    await saveAppearance(
      { themePreset: 'custom', customTheme },
      tr('自定义主题已应用', 'Custom theme applied.', '自訂主題已套用')
    )
  }

  async function resetTheme(): Promise<void> {
    setCustomTheme(DEFAULT_THEME_COLORS)
    await saveAppearance(
      { themePreset: 'magpie', customTheme: DEFAULT_THEME_COLORS },
      tr('主题配色已恢复默认', 'Theme reset to default.', '主題配色已恢復預設')
    )
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

  async function resetAllSettings(): Promise<void> {
    if (scaleSaveTimer.current) {
      window.clearTimeout(scaleSaveTimer.current)
      scaleSaveTimer.current = null
    }
    setAutoLock(DEFAULT_APP_SETTINGS.autoLockMinutes)
    setCustomTheme(DEFAULT_APP_SETTINGS.customTheme)
    setInterfaceScale(DEFAULT_APP_SETTINGS.interfaceScale)
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

  async function checkUpdates(): Promise<void> {
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
      setCheckingUpdates(false)
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
        colorMode === 'dark' ? '已切换为暗色模式' : '已切换为亮色模式',
        colorMode === 'dark' ? 'Dark mode enabled.' : 'Light mode enabled.',
        colorMode === 'dark' ? '已切換為暗色模式' : '已切換為亮色模式'
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
    setProxy((current) => ({ ...current, [key]: value }))
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

  async function exportVault(): Promise<void> {
    try {
      const result = await window.autologin.data.exportVault()
      if (!result.canceled) {
        notify(
          'success',
          tr(
            `已导出加密配置：${result.fileName ?? ''}`,
            `Encrypted configuration exported: ${result.fileName ?? ''}`,
            `已匯出加密設定：${result.fileName ?? ''}`
          )
        )
      }
    } catch (error) {
      notify(
        'error',
        error instanceof Error
          ? error.message
          : tr('导出配置失败', 'Could not export configuration.', '匯出設定失敗')
      )
    }
  }

  async function exportCsvTemplate(): Promise<void> {
    try {
      const result = await window.autologin.data.exportCsvTemplate()
      if (!result.canceled) {
        notify(
          'success',
          tr(
            `CSV 模板已保存：${result.fileName ?? ''}`,
            `CSV template saved: ${result.fileName ?? ''}`,
            `CSV 範本已儲存：${result.fileName ?? ''}`
          )
        )
      }
    } catch (error) {
      notify(
        'error',
        error instanceof Error
          ? error.message
          : tr('保存 CSV 模板失败', 'Could not save CSV template.', '儲存 CSV 範本失敗')
      )
    }
  }

  async function importCsv(): Promise<void> {
    setImportBusy(true)
    try {
      const result = await window.autologin.data.importCsv()
      if (result) {
        applyImportResult(result)
      }
    } catch (error) {
      notify(
        'error',
        error instanceof Error
          ? error.message
          : tr('导入 CSV 失败', 'Could not import CSV.', '匯入 CSV 失敗')
      )
    } finally {
      setImportBusy(false)
    }
  }

  async function chooseKdbx(): Promise<void> {
    setImportBusy(true)
    try {
      const selection = await window.autologin.data.chooseKdbx()
      if (selection) {
        setKdbxSelection(selection)
        setKdbxPassword('')
        setKdbxError('')
      }
    } catch (error) {
      notify(
        'error',
        error instanceof Error
          ? error.message
          : tr('选择 KDBX 文件失败', 'Could not select KDBX file.', '選擇 KDBX 檔案失敗')
      )
    } finally {
      setImportBusy(false)
    }
  }

  async function importKdbx(event: React.FormEvent): Promise<void> {
    event.preventDefault()
    if (!kdbxSelection || !kdbxPassword) {
      setKdbxError(tr('请输入数据库主密码', 'Enter the database master password.', '請輸入資料庫主密碼'))
      return
    }
    setKdbxBusy(true)
    setKdbxError('')
    try {
      const result = await window.autologin.data.importKdbx({
        token: kdbxSelection.token,
        password: kdbxPassword
      })
      setKdbxSelection(null)
      setKdbxPassword('')
      applyImportResult(result)
    } catch (error) {
      setKdbxError(
        error instanceof Error
          ? error.message
          : tr('导入 KeePassXC 数据库失败', 'Could not import the KeePassXC database.', '匯入 KeePassXC 資料庫失敗')
      )
    } finally {
      setKdbxBusy(false)
    }
  }

  function applyImportResult(result: DataImportResult): void {
    setImportResult(result)
    void onRefresh()
    notify(
      'success',
      tr(
        `已新增 ${result.sitesCreated} 个站点、${result.accountsCreated} 个账号`,
        `${result.sitesCreated} sites and ${result.accountsCreated} accounts imported.`,
        `已新增 ${result.sitesCreated} 個站點、${result.accountsCreated} 個帳號`
      )
    )
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
    ['appearance', tr('外观主题', 'Appearance', '外觀主題')],
    ['network', tr('网络代理', 'Network proxy', '網路代理')],
    ['security', tr('安全与隐私', 'Security & privacy', '安全性與隱私')],
    ['data', tr('数据与备份', 'Data & backups', '資料與備份')],
    ['appLogs', tr('软件日志', 'App logs', '軟體日誌')],
    ['about', tr('关于与更新', 'About & updates', '關於與更新')]
  ]
  return (
    <>
      <section className="page-section settings-page settings-page--controlled">
        <header className="settings-page__header">
          <nav className="page-breadcrumb" aria-label={tr('面包屑', 'Breadcrumb', '麵包屑')}>
            <span>{tr('工作台', 'Workspace', '工作台')}</span>
            <ChevronRight size={12} />
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
                <button className="text-button" onClick={() => void resetScale()}>
                  <RotateCcw size={14} />
                  {tr('恢复默认比例', 'Reset scale', '恢復預設比例')}
                </button>
              </div>
            </div>

            <div className="settings-card settings-card--split">
              <div>
                <h4>{tr('重置默认配置', 'Reset defaults', '重設預設設定')}</h4>
                <p>
                  {tr(
                    '恢复 defalut 亮色主题、简体中文、100% 比例、10 分钟锁定和直连网络。',
                    'Restore the light defalut theme, Simplified Chinese, 100% scale, 10-minute lock and direct networking.',
                    '恢復 defalut 亮色主題、簡體中文、100% 比例、10 分鐘鎖定和直連網路。'
                  )}
                </p>
              </div>
              <button className="button button--soft" onClick={() => void resetAllSettings()}>
                <RotateCcw size={15} />
                {tr('恢复默认设置', 'Restore defaults', '恢復預設設定')}
              </button>
            </div>
          </SettingsPanel>
        )}

        {module === 'appearance' && (
          <SettingsPanel
            icon={<Palette size={18} />}
            title={tr('显示与配色', 'Display and colors', '顯示與配色')}
            description={tr(
              '切换亮暗模式、界面语言、主题预设和自定义配色。',
              'Switch color mode, language, theme presets and custom colors.',
              '切換亮暗模式、介面語言、主題預設和自訂配色。'
            )}
          >
            <div className="settings-card">
              <div className="settings-control-row">
                <span className="settings-control-row__label">
                  {tr('颜色模式', 'Color mode', '色彩模式')}
                </span>
                <div
                  className="segmented-control"
                  role="group"
                  aria-label={tr('颜色模式', 'Color mode', '色彩模式')}
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
                icon={<Palette size={17} />}
                title={tr('主题预设', 'Theme presets', '主題預設')}
                description={tr(
                  'defalut 是默认的高留白主题，也可以选择其他预设或自定义配色。',
                  'defalut is the default spacious theme. You can also choose another preset or custom colors.',
                  'defalut 是預設的高留白主題，也可以選擇其他預設或自訂配色。'
                )}
              />
              <div
                className="theme-preset-grid"
                role="group"
                aria-label={tr('主题预设', 'Theme presets', '主題預設')}
              >
                {(
                  Object.entries(THEME_PRESETS) as Array<
                    [
                      keyof typeof THEME_PRESETS,
                      (typeof THEME_PRESETS)[keyof typeof THEME_PRESETS]
                    ]
                  >
                ).map(([key, preset]) => {
                  const colors = resolveThemeColors(
                    key,
                    settings.colorMode,
                    settings.customTheme
                  )
                  return (
                    <button
                      key={key}
                      type="button"
                      className={`theme-swatch${settings.themePreset === key ? ' is-active' : ''}`}
                      onClick={() =>
                        void saveAppearance(
                          { themePreset: key },
                          tr(
                            `已切换为${preset.label}主题`,
                            `Theme switched to ${themePresetName(key, 'en')}.`,
                            `已切換為${themePresetName(key, 'zh-TW')}主題`
                          )
                        )
                      }
                    >
                      <span
                        className="theme-swatch__preview"
                        style={{
                          background: colors.background,
                          color: colors.text,
                          borderColor: colors.accent
                        }}
                      >
                        <i style={{ background: colors.accent }} />
                        <b />
                        <em />
                      </span>
                      <span>{themePresetName(key, settings.language)}</span>
                      {settings.themePreset === key && <Check size={14} />}
                    </button>
                  )
                })}
              </div>

              <div
                className={`custom-theme-editor${settings.themePreset === 'custom' ? ' is-active' : ''}`}
              >
                {(
                  [
                    ['background', tr('背景', 'Background', '背景')],
                    ['surface', tr('面板', 'Surface', '面板')],
                    ['text', tr('文字', 'Text', '文字')],
                    ['accent', tr('强调色', 'Accent', '強調色')]
                  ] as Array<[keyof ThemeColors, string]>
                ).map(([key, label]) => (
                  <label className="theme-color-field" key={key}>
                    <span>{label}</span>
                    <span className="theme-color-field__control">
                      <input
                        type="color"
                        value={customTheme[key]}
                        onChange={(event) => updateCustomColor(key, event.target.value)}
                        aria-label={label}
                      />
                      <code>{customTheme[key]}</code>
                    </span>
                  </label>
                ))}
                <button
                  type="button"
                  className="button button--soft custom-theme-editor__apply"
                  onClick={() => void applyCustomTheme()}
                >
                  {tr('应用自定义配色', 'Apply custom theme', '套用自訂配色')}
                </button>
              </div>

              <div className="settings-inline-actions">
                <span className="settings-hint">
                  {tr(
                    '自定义颜色仅保存在本地保险库中',
                    'Custom colors stay in the local vault.',
                    '自訂顏色僅儲存在本機保險庫中'
                  )}
                </span>
                <button className="text-button" onClick={() => void resetTheme()}>
                  <RotateCcw size={14} />
                  {tr('恢复默认主题', 'Reset theme', '恢復預設主題')}
                </button>
              </div>
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

              <label className={`switch-row proxy-switch-row${proxy.mode === 'system' ? ' is-disabled' : ''}`}>
                <span>
                  <strong>{tr('启用自定义代理', 'Enable custom proxy', '啟用自訂代理')}</strong>
                  <small>
                    {proxy.mode === 'system'
                      ? tr('跟随系统模式无需单独启用', 'System mode does not need a separate switch', '跟隨系統模式無需另外啟用')
                      : tr('关闭后 AutoLogin 将直接连接网络', 'When disabled, AutoLogin connects directly', '關閉後 AutoLogin 將直接連線網路')}
                  </small>
                </span>
                <input
                  type="checkbox"
                  checked={proxy.mode === 'custom' && proxy.enabled}
                  disabled={proxy.mode === 'system'}
                  onChange={(event) => updateProxy('enabled', event.target.checked)}
                />
                <span className="switch" aria-hidden="true" />
              </label>

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
                    disabled={proxy.mode === 'system' || !proxy.enabled}
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
                    disabled={proxy.mode === 'system' || !proxy.enabled}
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
                    disabled={proxy.mode === 'system' || !proxy.enabled}
                  />
                </label>
                <label className="field proxy-fields__wide">
                  <span className="field__label">{tr('绕过代理', 'Bypass list', '略過代理')}</span>
                  <input
                    className="filter-control"
                    value={proxy.bypassList}
                    onChange={(event) => updateProxy('bypassList', event.target.value)}
                    placeholder="localhost, 127.0.0.1, ::1"
                    disabled={proxy.mode === 'system' || !proxy.enabled}
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
                    className="button button--ghost"
                    onClick={() => void testProxyConnection()}
                    disabled={proxyTesting}
                  >
                    {proxyTesting ? (
                      <LoaderCircle size={15} className="spin" />
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
            title={tr('导入、导出与备份', 'Import, export and backups', '匯入、匯出與備份')}
            description={tr(
              '管理数据目录、加密配置导出、账号导入和启动备份。',
              'Manage data location, encrypted export, account import and startup backups.',
              '管理資料目錄、加密設定匯出、帳號匯入和啟動備份。'
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
              <div className="settings-inline-actions">
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
              </div>
            </div>

            <div className="settings-card">
              <SettingsCardHeading
                icon={<Download size={17} />}
                title={tr('配置导出', 'Configuration export', '設定匯出')}
                description={tr(
                  '导出的 .autologin 文件是当前保险库的 AES-256-GCM 加密快照，需使用导出时的主密码解密，不会写出明文密码。',
                  'The exported .autologin file is an AES-256-GCM encrypted vault snapshot. It requires the master password used at export time and never writes plaintext passwords.',
                  '匯出的 .autologin 檔案是目前保險庫的 AES-256-GCM 加密快照，需使用匯出時的主密碼解密，不會寫出明文密碼。'
                )}
              />
              <div className="settings-inline-actions">
                <button className="button button--primary" onClick={() => void exportVault()}>
                  <Download size={15} />
                  {tr('导出加密配置', 'Export encrypted configuration', '匯出加密設定')}
                </button>
                <button className="button button--ghost" onClick={() => void exportCsvTemplate()}>
                  <FileDown size={15} />
                  {tr('下载 CSV 模板', 'Download CSV template', '下載 CSV 範本')}
                </button>
              </div>
            </div>

            <div className="settings-card">
              <SettingsCardHeading
                icon={<Upload size={17} />}
                title={tr('账号导入', 'Account import', '帳號匯入')}
                description={tr(
                  '导入会合并到当前保险库；同名站点且登录地址一致的记录会复用已有站点。',
                  'Imports merge into the current vault. Existing sites are reused when both name and sign-in URL match.',
                  '匯入會合併到目前保險庫；同名站點且登入網址一致的記錄會重複使用現有站點。'
                )}
              />
              <div className="data-import-actions">
                <button
                  className="button button--soft"
                  onClick={() => void importCsv()}
                  disabled={importBusy}
                >
                  {importBusy ? (
                    <LoaderCircle size={15} className="spin" />
                  ) : (
                    <FileSpreadsheet size={15} />
                  )}
                  {tr('导入标准 CSV', 'Import standard CSV', '匯入標準 CSV')}
                </button>
                <button
                  className="button button--soft"
                  onClick={() => void chooseKdbx()}
                  disabled={importBusy}
                >
                  {importBusy ? (
                    <LoaderCircle size={15} className="spin" />
                  ) : (
                    <Import size={15} />
                  )}
                  {tr('导入 KeePassXC (.kdbx)', 'Import KeePassXC (.kdbx)', '匯入 KeePassXC (.kdbx)')}
                </button>
              </div>
              <div className="data-mapping">
                <div>
                  <strong>{tr('CSV 字段映射', 'CSV field mapping', 'CSV 欄位對應')}</strong>
                  <code>
                    siteName,startUrl,siteGroup,username,password,autoSubmit,favorite
                  </code>
                  <small>
                    {tr(
                      '必填：siteName、startUrl、username、password。布尔值支持 true/false、1/0、yes/no。',
                      'Required: siteName, startUrl, username, password. Booleans accept true/false, 1/0 and yes/no.',
                      '必填：siteName、startUrl、username、password。布林值支援 true/false、1/0、yes/no。'
                    )}
                  </small>
                </div>
                <div>
                  <strong>{tr('KeePassXC 字段映射', 'KeePassXC field mapping', 'KeePassXC 欄位對應')}</strong>
                  <code>Title → siteName · URL → startUrl · UserName · Password · Group</code>
                  <small>
                    {tr(
                      '仅导入包含有效 http/https URL、用户名和密码的登录记录，不读取附件或密钥文件。',
                      'Only login entries with a valid http/https URL, username and password are imported. Attachments and key files are not read.',
                      '僅匯入包含有效 http/https URL、使用者名稱和密碼的登入記錄，不讀取附件或金鑰檔案。'
                    )}
                  </small>
                </div>
              </div>
              {importResult && (
                <div className="data-import-result">
                  <Check size={16} />
                  <div>
                    <strong>
                      {tr(
                        `已新增 ${importResult.sitesCreated} 个站点和 ${importResult.accountsCreated} 个账号`,
                        `${importResult.sitesCreated} sites and ${importResult.accountsCreated} accounts imported`,
                        `已新增 ${importResult.sitesCreated} 個站點和 ${importResult.accountsCreated} 個帳號`
                      )}
                    </strong>
                    <small>
                      {tr(
                        `跳过 ${importResult.skipped} 条记录`,
                        `${importResult.skipped} records skipped`,
                        `略過 ${importResult.skipped} 筆記錄`
                      )}
                    </small>
                    {importResult.warnings.length > 0 && (
                      <ul>
                        {importResult.warnings.map((warning, index) => (
                          <li key={`${warning}-${index}`}>{warning}</li>
                        ))}
                      </ul>
                    )}
                  </div>
                </div>
              )}
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

        {module === 'appLogs' && (
          <SettingsPanel
            icon={<BookOpen size={18} />}
            title={tr('软件日志', 'App logs', '軟體日誌')}
            description={tr(
              '查看应用启动、保险库、网络代理和更新相关的本地运行日志。',
              'Review local runtime logs for startup, vault, proxy and update events.',
              '查看應用程式啟動、保險庫、網路代理和更新相關的本機執行日誌。'
            )}
          >
            <div className="settings-card app-logs-card">
              <div className="app-logs-toolbar">
                <div>
                  <strong>{tr('本地运行记录', 'Local runtime logs', '本機執行記錄')}</strong>
                  <small>
                    {appLogs.length} {tr('条记录', 'entries', '筆記錄')}
                  </small>
                </div>
                <div>
                  <button
                    type="button"
                    className="button button--ghost button--small"
                    onClick={() => void loadAppLogs()}
                    disabled={appLogsLoading}
                  >
                    {appLogsLoading ? (
                      <LoaderCircle size={14} className="spin" />
                    ) : (
                      <RefreshCw size={14} />
                    )}
                    {tr('刷新', 'Refresh', '重新整理')}
                  </button>
                  <button
                    type="button"
                    className="button button--danger-ghost button--small"
                    onClick={() => setAppLogsClearOpen(true)}
                    disabled={appLogs.length === 0 || appLogsLoading}
                  >
                    <Trash2 size={14} />
                    {tr('清除日志', 'Clear logs', '清除日誌')}
                  </button>
                </div>
              </div>

              {appLogsLoading ? (
                <div className="app-logs-empty">
                  <LoaderCircle size={18} className="spin" />
                  {tr('正在读取软件日志', 'Reading app logs', '正在讀取軟體日誌')}
                </div>
              ) : appLogs.length === 0 ? (
                <div className="app-logs-empty">
                  <BookOpen size={19} />
                  {tr('暂无软件日志', 'No app logs yet', '暫無軟體日誌')}
                </div>
              ) : (
                <div className="app-log-list">
                  {appLogs.map((entry) => (
                    <article className="app-log-row" key={entry.id}>
                      <span className={`app-log-level is-${entry.level}`}>
                        {appLogLevelLabel(entry.level, tr)}
                      </span>
                      <div className="app-log-row__content">
                        <div>
                          <strong>{entry.message}</strong>
                          <span>{appLogCategoryLabel(entry.category, tr)}</span>
                        </div>
                        {entry.details && <p>{entry.details}</p>}
                      </div>
                      <time dateTime={entry.timestamp}>
                        {formatDate(entry.timestamp, {
                          dateStyle: 'short',
                          timeStyle: 'medium'
                        })}
                      </time>
                    </article>
                  ))}
                </div>
              )}
            </div>

            {appLogsClearOpen && (
              <ConfirmDialog
                title={tr('清除全部软件日志？', 'Clear all app logs?', '清除全部軟體日誌？')}
                description={tr(
                  `将永久删除当前 ${appLogs.length} 条软件日志，不会影响账号、登录日志或网站会话。`,
                  `Permanently delete ${appLogs.length} app log entries. Accounts, login history and website sessions are unaffected.`,
                  `將永久刪除目前 ${appLogs.length} 筆軟體日誌，不會影響帳號、登入日誌或網站工作階段。`
                )}
                confirmLabel={tr('确认清除', 'Clear logs', '確認清除')}
                danger
                busy={appLogsClearing}
                onConfirm={() => void clearApplicationLogs()}
                onClose={() => setAppLogsClearOpen(false)}
              />
            )}
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
                <span>Electron</span>
                <strong>{about?.electronVersion ?? '—'}</strong>
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
                >
                  {checkingUpdates ? (
                    <LoaderCircle size={15} className="spin" />
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
            </div>
          </SettingsPanel>
        )}

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

      {kdbxSelection && (
        <Modal
          title={tr('输入 KeePassXC 主密码', 'Enter KeePassXC master password', '輸入 KeePassXC 主密碼')}
          eyebrow={tr('KDBX 解密导入', 'KDBX ENCRYPTED IMPORT', 'KDBX 解密匯入')}
          onClose={() => {
            if (kdbxBusy) return
            setKdbxSelection(null)
            setKdbxPassword('')
            setKdbxError('')
          }}
          width="520px"
        >
          <form className="kdbx-password-form" onSubmit={importKdbx}>
            <div className="kdbx-file-summary">
              <span className="kdbx-file-summary__icon">
                <KeyRound size={15} />
              </span>
              <code title={kdbxSelection.fileName}>{kdbxSelection.fileName}</code>
              <span className="settings-location__badge">{formatBytes(kdbxSelection.size)}</span>
            </div>
            <p className="modal-description">
              {tr(
                '主密码只在主进程内存中用于解密此文件，不会写入日志或保存到磁盘。',
                'The master password is used only in main-process memory to decrypt this file. It is never logged or written to disk.',
                '主密碼只在主程序記憶體中用於解密此檔案，不會寫入日誌或儲存到磁碟。'
              )}
            </p>
            <label className="field">
              <span className="field__label">
                {tr('数据库主密码', 'Database master password', '資料庫主密碼')}
              </span>
              <span className="input-shell">
                <KeyRound size={16} />
                <input
                  type="password"
                  value={kdbxPassword}
                  onChange={(event) => setKdbxPassword(event.target.value)}
                  data-autofocus
                  autoComplete="current-password"
                />
              </span>
            </label>
            {kdbxError && <p className="form-error">{kdbxError}</p>}
            <div className="modal-actions">
              <button
                type="button"
                className="button button--ghost"
                onClick={() => setKdbxSelection(null)}
                disabled={kdbxBusy}
              >
                {tr('取消', 'Cancel', '取消')}
              </button>
              <button type="submit" className="button button--primary" disabled={kdbxBusy}>
                {kdbxBusy ? (
                  <LoaderCircle size={15} className="spin" />
                ) : (
                  <Import size={15} />
                )}
                {kdbxBusy
                  ? tr('正在解密…', 'Decrypting…', '正在解密…')
                  : tr('解密并导入', 'Decrypt and import', '解密並匯入')}
              </button>
            </div>
          </form>
        </Modal>
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
    appearance: tr('外观主题', 'Appearance', '外觀主題'),
    network: tr('网络代理', 'Network proxy', '網路代理'),
    security: tr('安全与隐私', 'Security & privacy', '安全性與隱私'),
    data: tr('数据与备份', 'Data & backups', '資料與備份'),
    appLogs: tr('软件日志', 'App logs', '軟體日誌'),
    about: tr('关于与更新', 'About & updates', '關於與更新')
  }
  return titles[module]
}

function appLogLevelLabel(
  level: AppLogEntry['level'],
  tr: (zhCN: string, en: string, zhTW: string) => string
): string {
  if (level === 'success') return tr('成功', 'Success', '成功')
  if (level === 'warning') return tr('提醒', 'Warning', '提醒')
  if (level === 'error') return tr('错误', 'Error', '錯誤')
  return tr('信息', 'Info', '資訊')
}

function appLogCategoryLabel(
  category: string,
  tr: (zhCN: string, en: string, zhTW: string) => string
): string {
  const labels: Record<string, [string, string, string]> = {
    startup: ['应用启动', 'Startup', '應用程式啟動'],
    vault: ['保险库', 'Vault', '保險庫'],
    proxy: ['网络代理', 'Network proxy', '網路代理'],
    update: ['应用更新', 'App update', '應用程式更新'],
    data: ['数据操作', 'Data', '資料操作'],
    login: ['登录任务', 'Login task', '登入工作'],
    settings: ['设置', 'Settings', '設定']
  }
  const label = labels[category]
  return label ? tr(label[0], label[1], label[2]) : category
}

function platformLabel(platform: string): string {
  if (platform === 'win32') return 'Windows x64'
  if (platform === 'darwin') return 'macOS'
  if (platform === 'linux') return 'Linux'
  return platform
}

function themePresetName(preset: ThemePreset, language: string): string {
  const names: Record<ThemePreset, [string, string, string]> = {
    magpie: ['defalut', 'defalut', 'defalut'],
    warm: ['暖砂', 'Warm Sand', '暖砂'],
    sage: ['鼠尾草', 'Sage', '鼠尾草'],
    ocean: ['海盐', 'Sea Salt', '海鹽'],
    rose: ['陶粉', 'Clay Rose', '陶粉'],
    custom: ['自定义', 'Custom', '自訂']
  }
  return language === 'en'
    ? names[preset][1]
    : language === 'zh-TW'
      ? names[preset][2]
      : names[preset][0]
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
