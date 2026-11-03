import { useEffect, useRef, useState } from 'react'
import {
  Check,
  Download,
  ExternalLink,
  FolderOpen,
  Info,
  KeyRound,
  Languages,
  LoaderCircle,
  LockKeyhole,
  Moon,
  Palette,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
  Sun,
  Trash2,
  TriangleAlert
} from 'lucide-react'
import {
  AUTO_LOCK_OPTIONS,
  INTERFACE_SCALE_MAX,
  INTERFACE_SCALE_MIN,
  INTERFACE_SCALE_STEP,
  type AboutInfo,
  type AppLanguage,
  type AppSettings,
  type AppSettingsPatch,
  type AutoLockMinutes,
  type ColorMode,
  type DataLocationInfo,
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
import { ConfirmDialog } from './Modal'
import { PasswordStrength } from './PasswordStrength'

export function SettingsPage({
  settings,
  appVersion,
  onSettingsChange,
  onOpenLogs,
  onClearAllData,
  notify
}: {
  settings: AppSettings
  appVersion: string
  onSettingsChange: (patch: AppSettingsPatch) => Promise<void>
  onOpenLogs: () => void
  onClearAllData: () => Promise<void>
  notify: (kind: 'success' | 'error' | 'info', message: string) => void
}): React.JSX.Element {
  const { tr } = useI18n()
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
  const scaleSaveTimer = useRef<number | null>(null)

  useEffect(() => {
    setAutoLock(settings.autoLockMinutes)
  }, [settings.autoLockMinutes])

  useEffect(() => {
    setCustomTheme(settings.customTheme)
    setInterfaceScale(settings.interfaceScale)
  }, [settings.customTheme, settings.interfaceScale])

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
      notify('error', error instanceof Error ? error.message : tr('设置保存失败', 'Could not save setting.', '設定儲存失敗'))
    }
  }

  async function saveAppearance(patch: AppSettingsPatch, message: string): Promise<void> {
    try {
      await onSettingsChange(patch)
      notify('success', message)
    } catch (error) {
      notify('error', error instanceof Error ? error.message : tr('外观设置保存失败', 'Could not save appearance.', '外觀設定儲存失敗'))
    }
  }

  function scheduleScaleSave(value: number): void {
    setInterfaceScale(value)
    if (scaleSaveTimer.current) window.clearTimeout(scaleSaveTimer.current)
    scaleSaveTimer.current = window.setTimeout(() => {
      void saveAppearance(
        { interfaceScale: value },
        tr('界面比例已设为 {value}%', 'Interface scale set to {value}%.', '介面比例已設為 {value}%', { value })
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
      { themePreset: 'warm', customTheme: DEFAULT_THEME_COLORS },
      tr('主题配色已恢复默认', 'Theme reset to default.', '主題配色已恢復預設')
    )
  }

  async function resetScale(): Promise<void> {
    if (scaleSaveTimer.current) {
      window.clearTimeout(scaleSaveTimer.current)
      scaleSaveTimer.current = null
    }
    setInterfaceScale(100)
    await saveAppearance({ interfaceScale: 100 }, tr('界面比例已恢复默认', 'Interface scale reset to default.', '介面比例已恢復預設'))
  }

  async function resetAllSettings(): Promise<void> {
    if (scaleSaveTimer.current) {
      window.clearTimeout(scaleSaveTimer.current)
      scaleSaveTimer.current = null
    }
    setAutoLock(DEFAULT_APP_SETTINGS.autoLockMinutes)
    setCustomTheme(DEFAULT_APP_SETTINGS.customTheme)
    setInterfaceScale(DEFAULT_APP_SETTINGS.interfaceScale)
    await saveAppearance(
      {
        autoLockMinutes: DEFAULT_APP_SETTINGS.autoLockMinutes,
        colorMode: DEFAULT_APP_SETTINGS.colorMode,
        language: DEFAULT_APP_SETTINGS.language,
        themePreset: DEFAULT_APP_SETTINGS.themePreset,
        customTheme: DEFAULT_APP_SETTINGS.customTheme,
        interfaceScale: DEFAULT_APP_SETTINGS.interfaceScale
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
      notify('error', tr('新主密码至少需要 10 个字符', 'The new master password needs at least 10 characters.', '新主密碼至少需要 10 個字元'))
      return
    }
    if (nextPassword !== confirmPassword) {
      notify('error', tr('两次输入的新主密码不一致', 'The new master passwords do not match.', '兩次輸入的新主密碼不一致'))
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
      notify('error', error instanceof Error ? error.message : tr('主密码修改失败', 'Could not change master password.', '主密碼修改失敗'))
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
        notify('success', tr('数据目录已迁移，重启 AutoLogin 后继续使用', 'Data location moved. Restart AutoLogin to continue.', '資料目錄已遷移，重新啟動 AutoLogin 後繼續使用'))
      }
    } catch (error) {
      notify('error', error instanceof Error ? error.message : tr('数据目录迁移失败', 'Could not move data location.', '資料目錄遷移失敗'))
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
        message: error instanceof Error ? error.message : tr('检查更新失败', 'Could not check for updates.', '檢查更新失敗')
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
      notify('error', error instanceof Error ? error.message : tr('清除数据失败', 'Could not clear data.', '清除資料失敗'))
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
        translate(language, '界面语言已切换为简体中文', 'Language switched to English.', '介面語言已切換為繁體中文')
      )
    } catch (error) {
      notify('error', error instanceof Error ? error.message : tr('语言设置保存失败', 'Could not save language.', '語言設定儲存失敗'))
    }
  }

  return (
    <>
      <section className="page-section settings-page">
        <div className="page-section__intro">
          <span className="eyebrow">PREFERENCES & SECURITY</span>
          <h2>{tr('设置', 'Settings', '設定')}</h2>
          <p>{tr('外观、语言、安全与本地数据设置。', 'Appearance, language, security and local data.', '外觀、語言、安全性與本機資料設定。')}</p>
        </div>

        <div className="settings-stack settings-stack--embedded">
          <section className="settings-section">
            <div className="settings-section__heading">
              <span className="settings-icon"><Palette size={18} /></span>
              <div>
                <h3>{tr('外观与语言', 'Appearance and language', '外觀與語言')}</h3>
                <p>{tr('选择亮色或暗色模式、界面语言和主题配色。', 'Choose light or dark mode, language and theme colors.', '選擇亮色或暗色模式、介面語言和主題配色。')}</p>
              </div>
            </div>

            <div className="settings-control-row">
              <span className="settings-control-row__label">{tr('颜色模式', 'Color mode', '色彩模式')}</span>
              <div className="segmented-control" role="group" aria-label={tr('颜色模式', 'Color mode', '色彩模式')}>
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
              <span className="settings-control-row__label"><Languages size={14} /> {tr('界面语言', 'Language', '介面語言')}</span>
              <div className="segmented-control segmented-control--language" role="group" aria-label={tr('界面语言', 'Language', '介面語言')}>
                {([
                  ['zh-CN', '简体中文'],
                  ['en', 'English'],
                  ['zh-TW', '繁體中文']
                ] as Array<[AppLanguage, string]>).map(([value, label]) => (
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

            <div className="theme-preset-grid" role="group" aria-label={tr('主题预设', 'Theme presets', '主題預設')}>
              {(Object.entries(THEME_PRESETS) as Array<
                [keyof typeof THEME_PRESETS, (typeof THEME_PRESETS)[keyof typeof THEME_PRESETS]]
              >).map(([key, preset]) => {
                const colors = resolveThemeColors(key, settings.colorMode, settings.customTheme)
                return (
                  <button
                    key={key}
                    type="button"
                    className={`theme-swatch${settings.themePreset === key ? ' is-active' : ''}`}
                    onClick={() =>
                      void saveAppearance(
                        { themePreset: key },
                        tr(`已切换为${preset.label}主题`, `Theme switched to ${themePresetName(key, 'en')}.`, `已切換為${themePresetName(key, 'zh-TW')}主題`)
                      )
                    }
                  >
                    <span
                      className="theme-swatch__preview"
                      style={{ background: colors.background, color: colors.text, borderColor: colors.accent }}
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

            <div className={`custom-theme-editor${settings.themePreset === 'custom' ? ' is-active' : ''}`}>
              {([
                ['background', tr('背景', 'Background', '背景')],
                ['surface', tr('面板', 'Surface', '面板')],
                ['text', tr('文字', 'Text', '文字')],
                ['accent', tr('强调色', 'Accent', '強調色')]
              ] as Array<[keyof ThemeColors, string]>).map(([key, label]) => (
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
              <button type="button" className="button button--soft custom-theme-editor__apply" onClick={() => void applyCustomTheme()}>
                {tr('应用自定义配色', 'Apply custom theme', '套用自訂配色')}
              </button>
            </div>

            <div className="settings-inline-actions">
              <span className="settings-hint">{tr('自定义颜色仅保存在本地保险库中', 'Custom colors stay in the local vault.', '自訂顏色僅儲存在本機保險庫中')}</span>
              <button className="text-button" onClick={() => void resetTheme()}>
                <RotateCcw size={14} />
                {tr('恢复默认主题', 'Reset theme', '恢復預設主題')}
              </button>
            </div>
          </section>

          <section className="settings-section">
            <div className="settings-section__heading">
              <span className="settings-icon"><RefreshCw size={18} /></span>
              <div>
                <h3>{tr('界面比例', 'Interface scale', '介面比例')}</h3>
                <p>{tr('按当前窗口调整界面缩放，默认 100%。', 'Adjust interface scale for this window. Default is 100%.', '依目前視窗調整介面縮放，預設為 100%。')}</p>
              </div>
            </div>
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
              <span className="settings-hint">{tr('可在 80% 至 125% 之间调整', 'Adjustable from 80% to 125%.', '可在 80% 至 125% 之間調整')}</span>
              <button className="text-button" onClick={() => void resetScale()}>
                <RotateCcw size={14} />
                {tr('恢复默认比例', 'Reset scale', '恢復預設比例')}
              </button>
            </div>
          </section>

          <section className="settings-section">
            <div className="settings-section__heading">
              <span className="settings-icon"><LockKeyhole size={18} /></span>
              <div>
                <h3>{tr('自动锁定', 'Auto-lock', '自動鎖定')}</h3>
                <p>{tr('应用闲置一段时间后隐藏保险库内容，网站会话会保留。', 'Hide vault contents after inactivity while keeping website sessions.', '應用程式閒置一段時間後隱藏保險庫內容，網站工作階段會保留。')}</p>
              </div>
            </div>
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
          </section>

          <section className="settings-section">
            <div className="settings-section__heading">
              <span className="settings-icon"><KeyRound size={18} /></span>
              <div>
                <h3>{tr('修改主密码', 'Change master password', '修改主密碼')}</h3>
                <p>{tr('修改后会使用新的密钥重新加密整个保险库。', 'The entire vault is re-encrypted with the new key.', '修改後會使用新的金鑰重新加密整個保險庫。')}</p>
              </div>
            </div>
            <form className="settings-password-form" onSubmit={submitPassword}>
              <label className="field">
                <span className="field__label">{tr('当前主密码', 'Current master password', '目前主密碼')}</span>
                <span className="input-shell">
                  <input type="password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} autoComplete="current-password" />
                </span>
              </label>
              <div className="field-row">
                <label className="field">
                  <span className="field__label">{tr('新主密码', 'New master password', '新主密碼')}</span>
                  <span className="input-shell">
                    <input type="password" value={nextPassword} onChange={(event) => setNextPassword(event.target.value)} autoComplete="new-password" />
                  </span>
                </label>
                <label className="field">
                  <span className="field__label">{tr('确认新密码', 'Confirm new password', '確認新密碼')}</span>
                  <span className="input-shell">
                    <input type="password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} autoComplete="new-password" />
                  </span>
                </label>
              </div>
              {nextPassword && <PasswordStrength password={nextPassword} />}
              <button
                className="button button--soft button--align-self"
                type="submit"
                disabled={changingPassword || !currentPassword || nextPassword.length < 10 || nextPassword !== confirmPassword}
              >
                {changingPassword ? tr('正在更新…', 'Updating…', '正在更新…') : tr('更新主密码', 'Update master password', '更新主密碼')}
              </button>
            </form>
          </section>

          <section className="settings-section">
            <div className="settings-section__heading">
              <span className="settings-icon"><FolderOpen size={18} /></span>
              <div>
                <h3>{tr('数据保存位置', 'Data location', '資料儲存位置')}</h3>
                <p>{tr('保险库、账号配置、登录日志和浏览器会话都保存在此目录。', 'Vault, accounts, login logs and browser sessions are stored here.', '保險庫、帳號設定、登入日誌和瀏覽器工作階段都儲存在此目錄。')}</p>
              </div>
            </div>
            <div className="settings-location">
              <code>{dataLocation?.directory ?? tr('正在读取…', 'Loading…', '正在讀取…')}</code>
              <span className="settings-location__badge">
                {dataLocation?.isDefault ? tr('默认位置', 'Default', '預設位置') : tr('自定义位置', 'Custom', '自訂位置')}
              </span>
            </div>
            {dataLocation?.restartRequired && (
              <div className="settings-notice">
                <TriangleAlert size={16} />
                <span>{tr('数据已迁移，需要重启应用完成切换。', 'Data moved. Restart the app to finish switching.', '資料已遷移，需要重新啟動應用程式完成切換。')}</span>
                <button className="text-button" onClick={() => void window.autologin.app.restart()}>
                  {tr('立即重启', 'Restart now', '立即重新啟動')}
                </button>
              </div>
            )}
            <div className="settings-inline-actions">
              <button className="button button--soft" onClick={() => void chooseLocation()} disabled={locationBusy}>
                {locationBusy ? <LoaderCircle size={15} className="spin" /> : <FolderOpen size={15} />}
                {locationBusy ? tr('正在迁移…', 'Moving…', '正在遷移…') : tr('更改位置', 'Change location', '變更位置')}
              </button>
              <button className="button button--ghost" onClick={() => void window.autologin.app.openDataLocation()}>
                {tr('打开目录', 'Open folder', '開啟目錄')}
              </button>
            </div>
          </section>

          <section className="settings-section">
            <div className="settings-section__heading">
              <span className="settings-icon"><Info size={18} /></span>
              <div>
                <h3>{tr('关于 AutoLogin', 'About AutoLogin', '關於 AutoLogin')}</h3>
                <p>{tr('本地优先的 Windows 登录入口管理工具。', 'A local-first login workspace for Windows.', '本機優先的 Windows 登入入口管理工具。')}</p>
              </div>
            </div>
            <div className="settings-about-grid">
              <span>{tr('版本', 'Version', '版本')}</span>
              <strong>v{about?.version ?? appVersion}</strong>
              <span>Electron</span>
              <strong>{about?.electronVersion ?? '—'}</strong>
              <span>{tr('平台', 'Platform', '平台')}</span>
              <strong>{about ? platformLabel(about.platform) : 'Windows'}</strong>
            </div>
            <div className="settings-inline-actions">
              <button className="text-button" onClick={() => void window.autologin.app.openRepository()}>
                {tr('源代码仓库', 'Source repository', '原始碼儲存庫')} <ExternalLink size={13} />
              </button>
              <button className="text-button" onClick={() => void window.autologin.app.openPrivacy()}>
                {tr('隐私说明', 'Privacy', '隱私說明')}
              </button>
            </div>
          </section>

          <section className="settings-section">
            <div className="settings-section__heading">
              <span className="settings-icon"><Download size={18} /></span>
              <div>
                <h3>{tr('检查更新', 'Check for updates', '檢查更新')}</h3>
                <p>{tr('从 GitHub Releases 获取版本信息，不会上传任何本地数据。', 'Read version information from GitHub Releases without uploading local data.', '從 GitHub Releases 取得版本資訊，不會上傳任何本機資料。')}</p>
              </div>
            </div>
            <div className="settings-update-row">
              <button className="button button--soft" onClick={() => void checkUpdates()} disabled={checkingUpdates}>
                {checkingUpdates ? <LoaderCircle size={15} className="spin" /> : <RefreshCw size={15} />}
                {checkingUpdates ? tr('正在检查…', 'Checking…', '正在檢查…') : tr('检查更新', 'Check now', '檢查更新')}
              </button>
              <button className="button button--ghost" onClick={() => void window.autologin.app.openReleases()}>
                {tr('打开发布页', 'Open releases', '開啟發佈頁')}
              </button>
            </div>
            {updateResult && (
              <div className={`settings-update-status is-${updateResult.status}`}>
                {updateResult.status === 'available' ? <Download size={16} /> : updateResult.status === 'up-to-date' ? <Check size={16} /> : <TriangleAlert size={16} />}
                <span>
                  <strong>{updateResult.message}</strong>
                  {updateResult.latestVersion && (
                    <small>{tr(`当前 v${updateResult.currentVersion} · 最新 v${updateResult.latestVersion}`, `Current v${updateResult.currentVersion} · Latest v${updateResult.latestVersion}`, `目前 v${updateResult.currentVersion} · 最新 v${updateResult.latestVersion}`)}</small>
                  )}
                </span>
                {updateResult.status === 'available' && (
                  <button className="text-button" onClick={() => void window.autologin.app.openReleases()}>
                    {tr('查看发布', 'View release', '查看發佈')}
                  </button>
                )}
              </div>
            )}
          </section>

          <section className="settings-section settings-section--split">
            <div className="settings-section__heading">
              <span className="settings-icon"><ShieldCheck size={18} /></span>
              <div>
                <h3>{tr('隐私与登录日志', 'Privacy and login logs', '隱私與登入日誌')}</h3>
                <p>{tr('日志仅记录账号名称、站点名称和脱敏原因，不记录密码、Cookie、验证码或完整 URL。', 'Logs contain account and site names plus redacted reasons only. Passwords, cookies, verification codes and full URLs are excluded.', '日誌僅記錄帳號名稱、站點名稱和去識別化原因，不記錄密碼、Cookie、驗證碼或完整網址。')}</p>
              </div>
            </div>
            <button className="text-button text-button--inline" onClick={onOpenLogs}>
              {tr('查看登录日志', 'View login logs', '查看登入日誌')}
            </button>
          </section>

          <section className="settings-section settings-section--split">
            <div className="settings-section__heading">
              <span className="settings-icon"><RotateCcw size={18} /></span>
              <div>
                <h3>{tr('重置默认配置', 'Reset defaults', '重設預設設定')}</h3>
                <p>{tr('恢复亮色模式、简体中文、默认主题、100% 比例和 10 分钟自动锁定。', 'Restore light mode, Simplified Chinese, default theme, 100% scale and 10-minute auto-lock.', '恢復亮色模式、簡體中文、預設主題、100% 比例和 10 分鐘自動鎖定。')}</p>
              </div>
            </div>
            <button className="button button--soft" onClick={() => void resetAllSettings()}>
              <RotateCcw size={15} />
              {tr('恢复默认设置', 'Restore defaults', '恢復預設設定')}
            </button>
          </section>

          <section className="settings-section settings-section--danger">
            <div className="settings-section__heading">
              <span className="settings-icon settings-icon--danger"><Trash2 size={18} /></span>
              <div>
                <h3>{tr('清除所有本地数据', 'Clear all local data', '清除所有本機資料')}</h3>
                <p>{tr('删除保险库、账号密码、录制流程和全部网站会话。', 'Delete the vault, credentials, recorded flows and all website sessions.', '刪除保險庫、帳號密碼、錄製流程和全部網站工作階段。')}</p>
              </div>
            </div>
            <button className="button button--danger-ghost" onClick={() => setClearOpen(true)}>
              {tr('清除全部数据', 'Clear all data', '清除全部資料')}
            </button>
          </section>

          <footer className="settings-footer">
            <span>AutoLogin v{appVersion}</span>
            <span><Check size={13} /> {tr('本地优先', 'Local-first', '本機優先')}</span>
          </footer>
        </div>
      </section>

      {clearOpen && (
        <ConfirmDialog
          title={tr('清除所有本地数据？', 'Clear all local data?', '清除所有本機資料？')}
          description={tr(
            '所有账号、密码、录制流程和网站会话都会被永久删除，无法恢复。',
            'All accounts, passwords, recorded flows and website sessions will be permanently deleted.',
            '所有帳號、密碼、錄製流程和網站工作階段都會被永久刪除，無法復原。'
          )}
          confirmLabel={tr('永久清除', 'Delete permanently', '永久清除')}
          danger
          busy={clearBusy}
          onConfirm={() => void clearAll()}
          onClose={() => setClearOpen(false)}
        />
      )}
    </>
  )
}

function platformLabel(platform: string): string {
  if (platform === 'win32') return 'Windows x64'
  if (platform === 'darwin') return 'macOS'
  if (platform === 'linux') return 'Linux'
  return platform
}

function themePresetName(preset: ThemePreset, language: string): string {
  const names: Record<ThemePreset, [string, string, string]> = {
    warm: ['暖砂', 'Warm Sand', '暖砂'],
    sage: ['鼠尾草', 'Sage', '鼠尾草'],
    ocean: ['海盐', 'Sea Salt', '海鹽'],
    rose: ['陶粉', 'Clay Rose', '陶粉'],
    custom: ['自定义', 'Custom', '自訂']
  }
  return language === 'en' ? names[preset][1] : language === 'zh-TW' ? names[preset][2] : names[preset][0]
}