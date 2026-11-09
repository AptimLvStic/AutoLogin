import { useEffect, useRef, useState } from 'react'
import {
  Download,
  FolderOpen,
  FileDown,
  FileSpreadsheet,
  Import,
  KeyRound,
  LoaderCircle,
  LockKeyhole,
  Plus,
  Upload
} from 'lucide-react'
import type {
  AutologinSelection,
  CsvImportMode,
  DataExportFormat,
  DataImportResult,
  FileOperationResult,
  KdbxSelection
} from '@shared/types'
import { useI18n } from '../i18n'
import { Modal } from './Modal'

export function AccountTransferControls({
  tabId,
  onCreateTab,
  onImported,
  notify,
  renderControls = true,
  openDatabaseRequest = 0,
  onDatabaseBusyChange,
  creatingTab = false
}: {
  tabId: string
  onCreateTab: () => Promise<void>
  onImported: (result: DataImportResult) => void
  notify: (kind: 'success' | 'error' | 'info', message: string) => void
  renderControls?: boolean
  openDatabaseRequest?: number
  onDatabaseBusyChange?: (busy: boolean) => void
  creatingTab?: boolean
}): React.JSX.Element {
  const { tr } = useI18n()
  const [menuOpen, setMenuOpen] = useState(false)
  const [createMenuOpen, setCreateMenuOpen] = useState(false)
  const [importBusy, setImportBusy] = useState(false)
  const [templateBusy, setTemplateBusy] = useState(false)
  const [exportBusy, setExportBusy] = useState(false)
  const [exportMenuOpen, setExportMenuOpen] = useState(false)
  const [kdbxSelection, setKdbxSelection] = useState<KdbxSelection | null>(null)
  const [databasePassword, setDatabasePassword] = useState('')
  const [kdbxError, setKdbxError] = useState('')
  const [kdbxBusy, setKdbxBusy] = useState(false)
  const [autologinSelection, setAutologinSelection] =
    useState<AutologinSelection | null>(null)
  const [autologinPassword, setAutologinPassword] = useState('')
  const [autologinError, setAutologinError] = useState('')
  const [autologinBusy, setAutologinBusy] = useState(false)
  const [exportPasswordOpen, setExportPasswordOpen] = useState(false)
  const [exportPassword, setExportPassword] = useState('')
  const [exportPasswordConfirm, setExportPasswordConfirm] = useState('')
  const [exportPasswordError, setExportPasswordError] = useState('')
  const groupRef = useRef<HTMLDivElement>(null)
  const createGroupRef = useRef<HTMLDivElement>(null)
  const exportGroupRef = useRef<HTMLDivElement>(null)
  const lastOpenDatabaseRequestRef = useRef(0)

  useEffect(() => {
    onDatabaseBusyChange?.(creatingTab || importBusy || kdbxBusy || autologinBusy)
  }, [autologinBusy, creatingTab, importBusy, kdbxBusy, onDatabaseBusyChange])

  useEffect(() => {
    if (
      openDatabaseRequest <= 0 ||
      lastOpenDatabaseRequestRef.current === openDatabaseRequest
    ) {
      return
    }
    lastOpenDatabaseRequestRef.current = openDatabaseRequest
    void chooseDatabase()
  }, [openDatabaseRequest])

  useEffect(() => {
    if (!menuOpen) return
    const closeOnPointer = (event: PointerEvent): void => {
      if (event.target instanceof Node && groupRef.current?.contains(event.target)) {
        return
      }
      setMenuOpen(false)
    }
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setMenuOpen(false)
    }
    document.addEventListener('pointerdown', closeOnPointer)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('pointerdown', closeOnPointer)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [menuOpen])

  useEffect(() => {
    if (!createMenuOpen) return
    const closeOnPointer = (event: PointerEvent): void => {
      if (
        event.target instanceof Node &&
        createGroupRef.current?.contains(event.target)
      ) {
        return
      }
      setCreateMenuOpen(false)
    }
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setCreateMenuOpen(false)
    }
    document.addEventListener('pointerdown', closeOnPointer)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('pointerdown', closeOnPointer)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [createMenuOpen])

  useEffect(() => {
    if (!exportMenuOpen) return
    const closeOnPointer = (event: PointerEvent): void => {
      if (
        event.target instanceof Node &&
        exportGroupRef.current?.contains(event.target)
      ) {
        return
      }
      setExportMenuOpen(false)
    }
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setExportMenuOpen(false)
    }
    document.addEventListener('pointerdown', closeOnPointer)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('pointerdown', closeOnPointer)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [exportMenuOpen])

  function acceptImport(result: DataImportResult): void {
    onImported(result)
    notify(
      'success',
      tr(
        `已新增 ${result.sitesCreated} 个站点、${result.accountsCreated} 个账号`,
        `${result.sitesCreated} sites and ${result.accountsCreated} accounts imported.`,
        `已新增 ${result.sitesCreated} 個站點、${result.accountsCreated} 個帳號`
      )
    )
  }

  async function importCsv(mode: CsvImportMode): Promise<void> {
    if (importBusy) return
    setMenuOpen(false)
    setImportBusy(true)
    try {
      const result = await window.autologin.data.importCsv({ mode, tabId })
      if (result) acceptImport(result)
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

  async function chooseDatabase(): Promise<void> {
    if (importBusy) return
    setMenuOpen(false)
    setCreateMenuOpen(false)
    setImportBusy(true)
    try {
      const selection = await window.autologin.data.chooseDatabase()
      if (!selection) {
        notify('info', tr('已取消打开数据库', 'Opening the database was cancelled.', '已取消開啟資料庫'))
        return
      }
      if (selection.kind === 'existing') {
        onImported({
          source: selection.source,
          tabId: selection.tabId,
          tabName: selection.tabName,
          sitesCreated: 0,
          accountsCreated: 0,
          skipped: 0,
          warnings: []
        })
        notify(
          'success',
          tr(
            `已打开数据库：${selection.tabName}`,
            `Database opened: ${selection.tabName}`,
            `已開啟資料庫：${selection.tabName}`
          )
        )
      } else if (selection.kind === 'kdbx') {
        setKdbxSelection(selection)
        setDatabasePassword('')
        setKdbxError('')
      } else {
        setAutologinSelection(selection)
        setAutologinPassword('')
        setAutologinError('')
      }
    } catch (error) {
      notify(
        'error',
        error instanceof Error
          ? error.message
          : tr('打开本地数据库失败', 'Could not open the local database.', '開啟本機資料庫失敗')
      )
    } finally {
      setImportBusy(false)
    }
  }

  async function importKdbx(event: React.FormEvent): Promise<void> {
    event.preventDefault()
    if (!kdbxSelection || !databasePassword) {
      setKdbxError(
        tr('请输入数据库主密码', 'Enter the database master password.', '請輸入資料庫主密碼')
      )
      return
    }
    if (kdbxBusy) return
    setKdbxBusy(true)
    setKdbxError('')
    try {
      const result = await window.autologin.data.importDatabase({
        token: kdbxSelection.token,
        password: databasePassword
      })
      setKdbxSelection(null)
      setDatabasePassword('')
      acceptImport(result)
    } catch (error) {
      setKdbxError(
        error instanceof Error
          ? error.message
          : tr('导入 KDBX 数据库失败', 'Could not import the KDBX database.', '匯入 KDBX 資料庫失敗')
      )
    } finally {
      setKdbxBusy(false)
    }
  }

  async function importAutologin(event: React.FormEvent): Promise<void> {
    event.preventDefault()
    if (!autologinSelection || !autologinPassword) {
      setAutologinError(
        tr('请输入配置文件主密码', 'Enter the configuration master password.', '請輸入設定檔主密碼')
      )
      return
    }
    if (autologinBusy) return
    setAutologinBusy(true)
    setAutologinError('')
    try {
      const result = await window.autologin.data.importDatabase({
        token: autologinSelection.token,
        password: autologinPassword
      })
      setAutologinSelection(null)
      setAutologinPassword('')
      acceptImport(result)
    } catch (error) {
      setAutologinError(
        error instanceof Error
          ? error.message
          : tr(
              '导入 AutoLogin 配置文件失败',
              'Could not import the AutoLogin configuration.',
              '匯入 AutoLogin 設定檔失敗'
            )
      )
    } finally {
      setAutologinBusy(false)
    }
  }

  async function exportCsvTemplate(): Promise<void> {
    if (templateBusy) return
    setMenuOpen(false)
    setTemplateBusy(true)
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
      } else {
        notify('info', tr('已取消保存 CSV 模板', 'CSV template save cancelled.', '已取消儲存 CSV 範本'))
      }
    } catch (error) {
      notify(
        'error',
        error instanceof Error
          ? error.message
          : tr('保存 CSV 模板失败', 'Could not save CSV template.', '儲存 CSV 範本失敗')
      )
    } finally {
      setTemplateBusy(false)
    }
  }

  async function exportTab(
    format: DataExportFormat,
    password?: string
  ): Promise<FileOperationResult> {
    if (exportBusy) return { canceled: true }
    setExportBusy(true)
    try {
      const result = await window.autologin.data.exportTab({
        tabId,
        format,
        password
      })
      if (!result.canceled) {
        notify(
          'success',
          tr(
            `已导出：${result.fileName ?? ''}`,
            `Exported: ${result.fileName ?? ''}`,
            `已匯出：${result.fileName ?? ''}`
          )
        )
      } else {
        notify('info', tr('已取消导出', 'Export cancelled.', '已取消匯出'))
      }
      return result
    } catch (error) {
      notify(
        'error',
        error instanceof Error
          ? error.message
          : tr('导出配置失败', 'Could not export configuration.', '匯出設定失敗')
      )
      throw error
    } finally {
      setExportBusy(false)
    }
  }

  function beginExport(format: DataExportFormat): void {
    if (exportBusy) return
    setExportMenuOpen(false)
    if (format === 'kdbx') {
      setExportPassword('')
      setExportPasswordConfirm('')
      setExportPasswordError('')
      setExportPasswordOpen(true)
      return
    }
    void exportTab(format).catch(() => undefined)
  }

  async function exportKdbx(event: React.FormEvent): Promise<void> {
    event.preventDefault()
    if (exportPassword.length < 10) {
      setExportPasswordError(
        tr('数据库主密码至少需要 10 个字符', 'Use at least 10 characters.', '資料庫主密碼至少需要 10 個字元')
      )
      return
    }
    if (exportPassword !== exportPasswordConfirm) {
      setExportPasswordError(
        tr('两次输入的密码不一致', 'The passwords do not match.', '兩次輸入的密碼不一致')
      )
      return
    }
    setExportPasswordError('')
    try {
      const result = await exportTab('kdbx', exportPassword)
      if (!result.canceled) setExportPasswordOpen(false)
    } catch {
      // The shared export handler already reports the error.
    }
  }

  const exportLabel = tr('导出', 'Export', '匯出')

  return (
    <>
      {renderControls && (
        <div className="account-transfer-controls">
      <div className="account-tabs__tool-group" ref={createGroupRef}>
        <button
          type="button"
          className="account-tabs__add"
          onClick={() => setCreateMenuOpen((open) => !open)}
          disabled={creatingTab || importBusy || kdbxBusy || autologinBusy}
          aria-label={tr(
            '新增标签页或打开数据库',
            'Add tab or open database',
            '新增標籤頁或開啟資料庫'
          )}
          title={tr(
            '新增标签页或打开数据库',
            'Add tab or open database',
            '新增標籤頁或開啟資料庫'
          )}
          aria-haspopup="menu"
          aria-expanded={createMenuOpen}
        >
          {creatingTab || importBusy || kdbxBusy || autologinBusy ? (
            <LoaderCircle size={15} className="spin" />
          ) : (
            <Plus size={15} />
          )}
        </button>
        {createMenuOpen && (
          <div className="account-import-menu account-create-menu" role="menu">
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setCreateMenuOpen(false)
                void onCreateTab()
              }}
            >
              <Plus size={15} />
              <span>
                {tr('新增本地数据库', 'New local database', '新增本機資料庫')}
              </span>
            </button>
            <button type="button" role="menuitem" onClick={() => void chooseDatabase()}>
              <FolderOpen size={15} />
              <span>
                {tr(
                  '打开本地数据库',
                  'Open local database',
                  '開啟本機資料庫'
                )}
              </span>
            </button>
          </div>
        )}
      </div>
      <div className="account-tabs__tool-group" ref={groupRef}>
        <button
          type="button"
          className="account-tabs__tool"
          onClick={() => setMenuOpen((open) => !open)}
          disabled={importBusy || templateBusy || creatingTab}
          aria-label={tr('导入账号', 'Import accounts', '匯入帳號')}
          title={tr('导入账号', 'Import accounts', '匯入帳號')}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
        >
          {importBusy || templateBusy ? (
            <LoaderCircle size={15} className="spin" />
          ) : (
            <Upload size={15} />
          )}
        </button>
        {menuOpen && (
          <div className="account-import-menu" role="menu">
            <button type="button" role="menuitem" onClick={() => void importCsv('current')}>
              <FileSpreadsheet size={15} />
              <span>
                {tr(
                  '当前数据库导入标准CSV',
                  'Import standard CSV into current database',
                  '目前資料庫匯入標準CSV'
                )}
              </span>
            </button>
            <button type="button" role="menuitem" onClick={() => void importCsv('new')}>
              <FileSpreadsheet size={15} />
              <span>
                {tr(
                  '新数据库导入标准CSV',
                  'Import standard CSV into new database',
                  '新資料庫匯入標準CSV'
                )}
              </span>
            </button>
            <span className="account-import-menu__divider" aria-hidden="true" />
            <button type="button" role="menuitem" onClick={() => void exportCsvTemplate()}>
              <FileDown size={15} />
              <span>{tr('下载 CSV 模板', 'Download CSV template', '下載 CSV 範本')}</span>
            </button>
          </div>
        )}
      </div>
      <div className="account-tabs__tool-group" ref={exportGroupRef}>
        <button
          type="button"
          className="account-tabs__tool"
          onClick={() => setExportMenuOpen((open) => !open)}
          disabled={exportBusy || !tabId}
          aria-label={exportLabel}
          title={exportLabel}
          aria-haspopup="menu"
          aria-expanded={exportMenuOpen}
        >
          {exportBusy ? (
            <LoaderCircle size={15} className="spin" />
          ) : (
            <Download size={15} />
          )}
        </button>
        {exportMenuOpen && (
          <div className="account-import-menu account-export-menu" role="menu">
            <button
              type="button"
              role="menuitem"
              onClick={() => beginExport('autologin')}
            >
              <LockKeyhole size={15} />
              <span>
                {tr(
                  '导出 AutoLogin 格式',
                  'Export AutoLogin format',
                  '匯出 AutoLogin 格式'
                )}
              </span>
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={() => beginExport('csv')}
            >
              <FileSpreadsheet size={15} />
              <span>{tr('导出 CSV 格式', 'Export CSV format', '匯出 CSV 格式')}</span>
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={() => beginExport('kdbx')}
            >
              <KeyRound size={15} />
              <span>
                {tr(
                  '导出 KeePassXC 格式',
                  'Export KeePassXC format',
                  '匯出 KeePassXC 格式'
                )}
              </span>
            </button>
          </div>
        )}
      </div>
        </div>
      )}

      {kdbxSelection && (
        <Modal
          title={tr('输入 KDBX 主密码', 'Enter KDBX master password', '輸入 KDBX 主密碼')}
          eyebrow={tr('KDBX 解密导入', 'KDBX ENCRYPTED IMPORT', 'KDBX 解密匯入')}
          onClose={() => {
            if (kdbxBusy) return
            setKdbxSelection(null)
            setDatabasePassword('')
            setKdbxError('')
          }}
          width="520px"
        >
          <form className="kdbx-password-form" onSubmit={importKdbx}>
            <div className="kdbx-file-summary">
              <span className="kdbx-file-summary__icon">
                <Import size={15} />
              </span>
              <code title={kdbxSelection.fileName}>{kdbxSelection.fileName}</code>
              <span className="settings-location__badge">
                {formatBytes(kdbxSelection.size)}
              </span>
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
                  value={databasePassword}
                  onChange={(event) => setDatabasePassword(event.target.value)}
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
                onClick={() => {
                  setKdbxSelection(null)
                  setDatabasePassword('')
                  setKdbxError('')
                }}
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

      {autologinSelection && (
        <Modal
          title={tr(
            '输入 AutoLogin 配置主密码',
            'Enter AutoLogin master password',
            '輸入 AutoLogin 設定主密碼'
          )}
          eyebrow={tr(
            'AutoLogin 配置导入',
            'AUTOLOGIN ENCRYPTED IMPORT',
            'AutoLogin 設定匯入'
          )}
          onClose={() => {
            if (autologinBusy) return
            setAutologinSelection(null)
            setAutologinPassword('')
            setAutologinError('')
          }}
          width="520px"
        >
          <form className="kdbx-password-form" onSubmit={importAutologin}>
            <div className="kdbx-file-summary">
              <span className="kdbx-file-summary__icon">
                <LockKeyhole size={15} />
              </span>
              <code title={autologinSelection.fileName}>
                {autologinSelection.fileName}
              </code>
              <span className="settings-location__badge">
                {formatBytes(autologinSelection.size)}
              </span>
            </div>
            <p className="modal-description">
              {tr(
                '此密码是导出该配置时使用的 AutoLogin 主密码。解密后的账号会导入新的标签页，不会覆盖当前保险库。',
                'Use the master password that protected the exported file. Imported accounts are added to new tabs without replacing the current vault.',
                '此密碼是匯出該設定時使用的 AutoLogin 主密碼。解密後的帳號會匯入新標籤頁，不會覆蓋目前保險庫。'
              )}
            </p>
            <label className="field">
              <span className="field__label">
                {tr('配置主密码', 'Configuration master password', '設定主密碼')}
              </span>
              <span className="input-shell">
                <KeyRound size={16} />
                <input
                  type="password"
                  value={autologinPassword}
                  onChange={(event) => setAutologinPassword(event.target.value)}
                  data-autofocus
                  autoComplete="current-password"
                />
              </span>
            </label>
            {autologinError && <p className="form-error">{autologinError}</p>}
            <div className="modal-actions">
              <button
                type="button"
                className="button button--ghost"
                onClick={() => {
                  setAutologinSelection(null)
                  setAutologinPassword('')
                  setAutologinError('')
                }}
                disabled={autologinBusy}
              >
                {tr('取消', 'Cancel', '取消')}
              </button>
              <button type="submit" className="button button--primary" disabled={autologinBusy}>
                {autologinBusy ? (
                  <LoaderCircle size={15} className="spin" />
                ) : (
                  <Import size={15} />
                )}
                {autologinBusy
                  ? tr('正在解密…', 'Decrypting…', '正在解密…')
                  : tr('解密并导入', 'Decrypt and import', '解密並匯入')}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {exportPasswordOpen && (
        <Modal
          title={tr('设置 KDBX 主密码', 'Set a KDBX master password', '設定 KDBX 主密碼')}
          eyebrow={tr('KDBX 数据库导出', 'KDBX DATABASE EXPORT', 'KDBX 資料庫匯出')}
          onClose={() => {
            if (exportBusy) return
            setExportPasswordOpen(false)
            setExportPassword('')
            setExportPasswordConfirm('')
            setExportPasswordError('')
          }}
          width="520px"
        >
          <form className="kdbx-password-form" onSubmit={exportKdbx}>
            <p className="modal-description">
              {tr(
                '当前标签页会导出为 KDBX 数据库。请设置该数据库的主密码，密码不会保存到 AutoLogin。',
                'The current tab will be exported as a KDBX database. Set its master password; AutoLogin does not store it.',
                '目前標籤頁會匯出為 KDBX 資料庫。請設定該資料庫的主密碼，密碼不會儲存到 AutoLogin。'
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
                  value={exportPassword}
                  onChange={(event) => setExportPassword(event.target.value)}
                  data-autofocus
                  autoComplete="new-password"
                />
              </span>
            </label>
            <label className="field">
              <span className="field__label">
                {tr('确认主密码', 'Confirm master password', '確認主密碼')}
              </span>
              <span className="input-shell">
                <LockKeyhole size={16} />
                <input
                  type="password"
                  value={exportPasswordConfirm}
                  onChange={(event) => setExportPasswordConfirm(event.target.value)}
                  autoComplete="new-password"
                />
              </span>
            </label>
            {exportPasswordError && <p className="form-error">{exportPasswordError}</p>}
            <div className="modal-actions">
              <button
                type="button"
                className="button button--ghost"
                onClick={() => {
                  setExportPasswordOpen(false)
                  setExportPassword('')
                  setExportPasswordConfirm('')
                  setExportPasswordError('')
                }}
                disabled={exportBusy}
              >
                {tr('取消', 'Cancel', '取消')}
              </button>
              <button type="submit" className="button button--primary" disabled={exportBusy}>
                {exportBusy ? (
                  <LoaderCircle size={15} className="spin" />
                ) : (
                  <Download size={15} />
                )}
                {exportBusy
                  ? tr('正在导出…', 'Exporting…', '正在匯出…')
                  : tr('导出 KDBX', 'Export KDBX', '匯出 KDBX')}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </>
  )
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
