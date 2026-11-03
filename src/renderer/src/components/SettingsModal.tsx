import { useEffect, useRef, useState } from 'react'
import {
  Check,
  Download,
  ExternalLink,
  FolderOpen,
  Info,
  KeyRound,
  LoaderCircle,
  LockKeyhole,
  Palette,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
  Trash2,
  TriangleAlert
} from 'lucide-react'
import {
  AUTO_LOCK_OPTIONS,
  INTERFACE_SCALE_MAX,
  INTERFACE_SCALE_MIN,
  INTERFACE_SCALE_STEP,
  type AboutInfo,
  type AppSettings,
  type AppSettingsPatch,
  type AutoLockMinutes,
  type DataLocationInfo,
  type ThemeColors,
  type UpdateCheckResult
} from '@shared/types'
import { DEFAULT_THEME_COLORS, THEME_PRESETS } from '@shared/theme'
import { Modal, ConfirmDialog } from './Modal'
import { PasswordStrength } from './PasswordStrength'

export function SettingsModal({
  settings,
  appVersion,
  onClose,
  onSettingsChange,
  onOpenFailureLogs,
  onClearAllData,
  notify
}: {
  settings: AppSettings
  appVersion: string
  onClose: () => void
  onSettingsChange: (patch: AppSettingsPatch) => Promise<void>
  onOpenFailureLogs: () => void
  onClearAllData: () => Promise<void>
  notify: (kind: 'success' | 'error' | 'info', message: string) => void
}): React.JSX.Element {
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
      if (scaleSaveTimer.current) {
        window.clearTimeout(scaleSaveTimer.current)
      }
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    void Promise.all([
      window.autologin.app.getAbout(),
      window.autologin.app.getDataLocation()
    ])
      .then(([nextAbout, nextLocation]) => {
        if (!cancelled) {
          setAbout(nextAbout)
          setDataLocation(nextLocation)
        }
      })
      .catch((error) => {
        if (!cancelled) {
          notify('error', error instanceof Error ? error.message : '无法读取应用信息')
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
      notify('success', `自动锁定已设为 ${value} 分钟`)
    } catch (error) {
      setAutoLock(settings.autoLockMinutes)
      notify('error', error instanceof Error ? error.message : '设置保存失败')
    }
  }

  async function saveAppearance(patch: AppSettingsPatch, message: string): Promise<void> {
    try {
      await onSettingsChange(patch)
      notify('success', message)
    } catch (error) {
      notify('error', error instanceof Error ? error.message : '外观设置保存失败')
    }
  }

  function scheduleScaleSave(value: number): void {
    setInterfaceScale(value)
    if (scaleSaveTimer.current) {
      window.clearTimeout(scaleSaveTimer.current)
    }
    scaleSaveTimer.current = window.setTimeout(() => {
      void saveAppearance({ interfaceScale: value }, `界面比例已设为 ${value}%`)
    }, 260)
  }

  function updateCustomColor(key: keyof ThemeColors, value: string): void {
    setCustomTheme((current) => ({ ...current, [key]: value.toUpperCase() }))
  }

  async function applyCustomTheme(): Promise<void> {
    await saveAppearance(
      { themePreset: 'custom', customTheme },
      '自定义主题已应用'
    )
  }

  async function resetTheme(): Promise<void> {
    setCustomTheme(DEFAULT_THEME_COLORS)
    await saveAppearance(
      {
        themePreset: 'warm',
        customTheme: DEFAULT_THEME_COLORS
      },
      '主题配色已恢复默认'
    )
  }

  async function resetScale(): Promise<void> {
    if (scaleSaveTimer.current) {
      window.clearTimeout(scaleSaveTimer.current)
      scaleSaveTimer.current = null
    }
    setInterfaceScale(100)
    await saveAppearance({ interfaceScale: 100 }, '界面比例已恢复默认')
  }

  async function submitPassword(event: React.FormEvent): Promise<void> {
    event.preventDefault()
    if (nextPassword.length < 10) {
      notify('error', '新主密码至少需要 10 个字符')
      return
    }
    if (nextPassword !== confirmPassword) {
      notify('error', '两次输入的新主密码不一致')
      return
    }
    setChangingPassword(true)
    try {
      await window.autologin.vault.changePassword(currentPassword, nextPassword)
      setCurrentPassword('')
      setNextPassword('')
      setConfirmPassword('')
      notify('success', '主密码已更新')
    } catch (error) {
      notify('error', error instanceof Error ? error.message : '主密码修改失败')
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
        notify('success', '数据目录已迁移，重启 AutoLogin 后继续使用')
      }
    } catch (error) {
      notify('error', error instanceof Error ? error.message : '数据目录迁移失败')
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
        message: error instanceof Error ? error.message : '检查更新失败'
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
      notify('error', error instanceof Error ? error.message : '清除数据失败')
    } finally {
      setClearBusy(false)
    }
  }

  return (
    <>
      <Modal
        title="设置"
        eyebrow="PREFERENCES & SECURITY"
        onClose={onClose}
        width="760px"
        className="settings-modal"
      >
        <div className="settings-stack">
          <section className="settings-section">
            <div className="settings-section__heading">
              <span className="settings-icon">
                <Palette size={18} />
              </span>
              <div>
                <h3>主题配色</h3>
                <p>选择预设，或使用四项颜色创建自己的主题。</p>
              </div>
            </div>
            <div className="theme-preset-grid" role="group" aria-label="主题预设">
              {(Object.entries(THEME_PRESETS) as Array<
                [keyof typeof THEME_PRESETS, (typeof THEME_PRESETS)[keyof typeof THEME_PRESETS]]
              >).map(([key, preset]) => (
                <button
                  key={key}
                  type="button"
                  className={`theme-swatch${settings.themePreset === key ? ' is-active' : ''}`}
                  onClick={() => void saveAppearance({ themePreset: key }, `已切换为${preset.label}主题`)}
                >
                  <span
                    className="theme-swatch__preview"
                    style={{
                      background: preset.colors.background,
                      color: preset.colors.text,
                      borderColor: preset.colors.accent
                    }}
                  >
                    <i style={{ background: preset.colors.accent }} />
                    <b />
                    <em />
                  </span>
                  <span>{preset.label}</span>
                  {settings.themePreset === key && <Check size={14} />}
                </button>
              ))}
            </div>

            <div
              className={`custom-theme-editor${
                settings.themePreset === 'custom' ? ' is-active' : ''
              }`}
            >
              {(
                [
                  ['background', '背景'],
                  ['surface', '面板'],
                  ['text', '文字'],
                  ['accent', '强调色']
                ] as Array<[keyof ThemeColors, string]>
              ).map(([key, label]) => (
                <label className="theme-color-field" key={key}>
                  <span>{label}</span>
                  <span className="theme-color-field__control">
                    <input
                      type="color"
                      value={customTheme[key]}
                      onChange={(event) => updateCustomColor(key, event.target.value)}
                      aria-label={`${label}颜色`}
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
                应用自定义配色
              </button>
            </div>
            <div className="settings-inline-actions">
              <span className="settings-hint">
                自定义颜色仅保存在本地保险库中
              </span>
              <button className="text-button" onClick={() => void resetTheme()}>
                <RotateCcw size={14} />
                恢复默认主题
              </button>
            </div>
          </section>

          <section className="settings-section">
            <div className="settings-section__heading">
              <span className="settings-icon">
                <RefreshCw size={18} />
              </span>
              <div>
                <h3>界面比例</h3>
                <p>按当前窗口调整界面缩放，默认 100%。</p>
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
                aria-label="界面比例"
              />
              <strong>{interfaceScale}%</strong>
            </div>
            <div className="settings-inline-actions settings-inline-actions--between">
              <span className="settings-hint">可在 80% 至 125% 之间调整</span>
              <button className="text-button" onClick={() => void resetScale()}>
                <RotateCcw size={14} />
                恢复默认比例
              </button>
            </div>
          </section>

          <section className="settings-section">
            <div className="settings-section__heading">
              <span className="settings-icon">
                <LockKeyhole size={18} />
              </span>
              <div>
                <h3>自动锁定</h3>
                <p>应用闲置一段时间后隐藏保险库内容，网站会话会保留。</p>
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
                  {minutes} 分钟
                </button>
              ))}
            </div>
          </section>

          <section className="settings-section">
            <div className="settings-section__heading">
              <span className="settings-icon">
                <KeyRound size={18} />
              </span>
              <div>
                <h3>修改主密码</h3>
                <p>修改后会使用新的密钥重新加密整个保险库。</p>
              </div>
            </div>
            <form className="settings-password-form" onSubmit={submitPassword}>
              <label className="field">
                <span className="field__label">当前主密码</span>
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
                  <span className="field__label">新主密码</span>
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
                  <span className="field__label">确认新密码</span>
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
                {changingPassword ? '正在更新…' : '更新主密码'}
              </button>
            </form>
          </section>

          <section className="settings-section">
            <div className="settings-section__heading">
              <span className="settings-icon">
                <FolderOpen size={18} />
              </span>
              <div>
                <h3>数据保存位置</h3>
                <p>保险库、账号配置、失败日志和浏览器会话都保存在此目录。</p>
              </div>
            </div>
            <div className="settings-location">
              <code>{dataLocation?.directory ?? '正在读取…'}</code>
              <span className="settings-location__badge">
                {dataLocation?.isDefault ? '默认位置' : '自定义位置'}
              </span>
            </div>
            {dataLocation?.restartRequired && (
              <div className="settings-notice">
                <TriangleAlert size={16} />
                <span>数据已迁移，需要重启应用完成切换。</span>
                <button className="text-button" onClick={() => void window.autologin.app.restart()}>
                  立即重启
                </button>
              </div>
            )}
            <div className="settings-inline-actions">
              <button
                className="button button--soft"
                onClick={() => void chooseLocation()}
                disabled={locationBusy}
              >
                {locationBusy ? <LoaderCircle size={15} className="spin" /> : <FolderOpen size={15} />}
                {locationBusy ? '正在迁移…' : '更改位置'}
              </button>
              <button
                className="button button--ghost"
                onClick={() => void window.autologin.app.openDataLocation()}
              >
                打开目录
              </button>
            </div>
          </section>

          <section className="settings-section">
            <div className="settings-section__heading">
              <span className="settings-icon">
                <Info size={18} />
              </span>
              <div>
                <h3>关于 AutoLogin</h3>
                <p>本地优先的 Windows 登录入口管理工具。</p>
              </div>
            </div>
            <div className="settings-about-grid">
              <span>版本</span>
              <strong>v{about?.version ?? appVersion}</strong>
              <span>Electron</span>
              <strong>{about?.electronVersion ?? '—'}</strong>
              <span>平台</span>
              <strong>{about ? platformLabel(about.platform) : 'Windows'}</strong>
            </div>
            <div className="settings-inline-actions">
              <button
                className="text-button"
                onClick={() => void window.autologin.app.openRepository()}
              >
                源代码仓库 <ExternalLink size={13} />
              </button>
              <button
                className="text-button"
                onClick={() => void window.autologin.app.openPrivacy()}
              >
                隐私说明
              </button>
            </div>
          </section>

          <section className="settings-section">
            <div className="settings-section__heading">
              <span className="settings-icon">
                <Download size={18} />
              </span>
              <div>
                <h3>检查更新</h3>
                <p>从 GitHub Releases 获取版本信息，不会上传任何本地数据。</p>
              </div>
            </div>
            <div className="settings-update-row">
              <button
                className="button button--soft"
                onClick={() => void checkUpdates()}
                disabled={checkingUpdates}
              >
                {checkingUpdates ? <LoaderCircle size={15} className="spin" /> : <RefreshCw size={15} />}
                {checkingUpdates ? '正在检查…' : '检查更新'}
              </button>
              <button
                className="button button--ghost"
                onClick={() => void window.autologin.app.openReleases()}
              >
                打开发布页
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
                      当前 v{updateResult.currentVersion} · 最新 v{updateResult.latestVersion}
                    </small>
                  )}
                </span>
                {updateResult.status === 'available' && (
                  <button
                    className="text-button"
                    onClick={() => void window.autologin.app.openReleases()}
                  >
                    查看发布
                  </button>
                )}
              </div>
            )}
          </section>

          <section className="settings-section settings-section--split">
            <div className="settings-section__heading">
              <span className="settings-icon">
                <ShieldCheck size={18} />
              </span>
              <div>
                <h3>隐私与本地日志</h3>
                <p>失败日志仅记录账号名称、站点名称和脱敏原因，不记录密码、Cookie、验证码或完整 URL。</p>
              </div>
            </div>
            <button
              className="text-button text-button--inline"
              onClick={onOpenFailureLogs}
            >
              查看失败日志
            </button>
          </section>

          <section className="settings-section settings-section--danger">
            <div className="settings-section__heading">
              <span className="settings-icon settings-icon--danger">
                <Trash2 size={18} />
              </span>
              <div>
                <h3>清除所有本地数据</h3>
                <p>删除保险库、账号密码、录制流程和全部网站会话。</p>
              </div>
            </div>
            <button className="button button--danger-ghost" onClick={() => setClearOpen(true)}>
              清除全部数据
            </button>
          </section>

          <footer className="settings-footer">
            <span>AutoLogin v{appVersion}</span>
            <span>
              <Check size={13} /> 本地优先
            </span>
          </footer>
        </div>
      </Modal>
      {clearOpen && (
        <ConfirmDialog
          title="清除所有本地数据？"
          description="所有账号、密码、录制流程和网站会话都会被永久删除，无法恢复。"
          confirmLabel="永久清除"
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
