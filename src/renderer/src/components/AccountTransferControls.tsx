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
  MoreHorizontal,
  Plus,
  Upload
} from 'lucide-react'
import type {
  AutologinSelection,
  CsvFileSelection,
  CsvImportMode,
  DataExportFormat,
  DataImportResult,
  FileOperationResult,
  ImportPreview,
  KdbxSelection
} from '@shared/types'
import { useI18n } from '../i18n'
import { LoadingSpinner } from './LoadingSpinner'
import { Modal } from './Modal'
import { ImportPreviewDialog } from './ImportPreviewDialog'

const MIN_DATABASE_IMPORT_FEEDBACK_MS = 450

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
  const [importBusy, setImportBusy] = useState(false)
  const [templateBusy, setTemplateBusy] = useState(false)
  const [exportBusy, setExportBusy] = useState(false)
  const [kdbxSelection, setKdbxSelection] = useState<KdbxSelection | null>(null)
  const [databasePassword, setDatabasePassword] = useState('')
  const [kdbxError, setKdbxError] = useState('')
  const [kdbxBusy, setKdbxBusy] = useState(false)
  const [autologinSelection, setAutologinSelection] =
    useState<AutologinSelection | null>(null)
  const [autologinPassword, setAutologinPassword] = useState('')
  const [autologinError, setAutologinError] = useState('')
  const [autologinBusy, setAutologinBusy] = useState(false)
  const [importPreview, setImportPreview] = useState<ImportPreview | null>(null)
  const [importPreviewBusy, setImportPreviewBusy] = useState(false)
  const [csvSelection, setCsvSelection] = useState<CsvFileSelection | null>(null)
  const [csvPassword, setCsvPassword] = useState('')
  const [csvError, setCsvError] = useState('')
  const [csvBusy, setCsvBusy] = useState(false)
  const [exportPasswordOpen, setExportPasswordOpen] = useState(false)
  const [exportPasswordFormat, setExportPasswordFormat] =
    useState<DataExportFormat>('kdbx')
  const [exportFileName, setExportFileName] = useState('')
  const [exportPassword, setExportPassword] = useState('')
  const [exportPasswordConfirm, setExportPasswordConfirm] = useState('')
  const [exportPasswordError, setExportPasswordError] = useState('')
  const groupRef = useRef<HTMLDivElement>(null)
  const lastOpenDatabaseRequestRef = useRef(0)

  useEffect(() => {
    onDatabaseBusyChange?.(
      creatingTab ||
        importBusy ||
        kdbxBusy ||
        autologinBusy ||
        csvBusy ||
        Boolean(importPreview) ||
        importPreviewBusy
    )
  }, [
    autologinBusy,
    creatingTab,
    csvBusy,
    importBusy,
    importPreview,
    importPreviewBusy,
    kdbxBusy,
    onDatabaseBusyChange
  ])

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

  function acceptImport(result: DataImportResult): void {
    onImported(result)
  }

  function handleDatabaseImportResult(
    result: Awaited<ReturnType<typeof window.autologin.data.importDatabase>>
  ): void {
    if ('token' in result) {
      setImportPreview(result)
      return
    }
    acceptImport(result)
  }

  async function importCsv(mode: CsvImportMode): Promise<void> {
    if (importBusy) return
    setMenuOpen(false)
    setImportBusy(true)
    try {
      const selection = await window.autologin.data.chooseCsv({ mode, tabId })
      if (!selection) {
        notify('info', tr('已取消导入 CSV', 'CSV import cancelled.', '已取消匯入 CSV'))
        return
      }
      if (selection.encrypted) {
        setCsvSelection(selection)
        setCsvPassword('')
        setCsvError('')
        return
      }
      const result = await window.autologin.data.importCsv({ token: selection.token })
      if (result) setImportPreview(result)
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

  async function importCsvWithPassword(event: React.FormEvent): Promise<void> {
    event.preventDefault()
    if (!csvSelection) return
    if (!csvPassword) {
      setCsvError(
        tr('请输入导出时设置的密码', 'Enter the password set when exporting.', '請輸入匯出時設定的密碼')
      )
      return
    }
    if (csvBusy) return
    const startedAt = Date.now()
    setCsvBusy(true)
    setCsvError('')
    try {
      const result = await window.autologin.data.importCsv({
        token: csvSelection.token,
        password: csvPassword
      })
      setCsvSelection(null)
      setCsvPassword('')
      if (result) setImportPreview(result)
    } catch (error) {
      setCsvError(
        error instanceof Error
          ? error.message
          : tr('导入 CSV 失败', 'Could not import CSV.', '匯入 CSV 失敗')
      )
    } finally {
      const remaining = MIN_DATABASE_IMPORT_FEEDBACK_MS - (Date.now() - startedAt)
      if (remaining > 0) {
        await new Promise((resolve) => window.setTimeout(resolve, remaining))
      }
      setCsvBusy(false)
    }
  }

  async function chooseDatabase(): Promise<void> {
    if (importBusy) return
    setMenuOpen(false)
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
          groupsCreated: 0,
          maxDepth: 0,
          groupPaths: [],
          skipDetails: [],
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
    const startedAt = Date.now()
    setKdbxBusy(true)
    setKdbxError('')
    try {
      const result = await window.autologin.data.importDatabase({
        token: kdbxSelection.token,
        password: databasePassword
      })
      setKdbxSelection(null)
      setDatabasePassword('')
      handleDatabaseImportResult(result)
    } catch (error) {
      setKdbxError(
        error instanceof Error
          ? error.message
          : tr('导入 KDBX 数据库失败', 'Could not import the KDBX database.', '匯入 KDBX 資料庫失敗')
      )
    } finally {
      const remaining = MIN_DATABASE_IMPORT_FEEDBACK_MS - (Date.now() - startedAt)
      if (remaining > 0) {
        await new Promise((resolve) => window.setTimeout(resolve, remaining))
      }
      setKdbxBusy(false)
    }
  }

  async function importAutologin(event: React.FormEvent): Promise<void> {
    event.preventDefault()
    if (!autologinSelection || !autologinPassword) {
      setAutologinError(
        tr('请输入导出密码', 'Enter the export password.', '請輸入匯出密碼')
      )
      return
    }
    if (autologinBusy) return
    const startedAt = Date.now()
    setAutologinBusy(true)
    setAutologinError('')
    try {
      const result = await window.autologin.data.importDatabase({
        token: autologinSelection.token,
        password: autologinPassword
      })
      setAutologinSelection(null)
      setAutologinPassword('')
      handleDatabaseImportResult(result)
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
      const remaining = MIN_DATABASE_IMPORT_FEEDBACK_MS - (Date.now() - startedAt)
      if (remaining > 0) {
        await new Promise((resolve) => window.setTimeout(resolve, remaining))
      }
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
    password?: string,
    fileName?: string
  ): Promise<FileOperationResult> {
    if (exportBusy) return { canceled: true }
    setExportBusy(true)
    try {
      const result = await window.autologin.data.exportTab({
        tabId,
        format,
        password,
        fileName: fileName?.trim() || undefined
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
    setMenuOpen(false)
    setExportPasswordFormat(format)
    setExportFileName('')
    setExportPassword('')
    setExportPasswordConfirm('')
    setExportPasswordError('')
    setExportPasswordOpen(true)
  }

  async function submitExportPassword(event: React.FormEvent): Promise<void> {
    event.preventDefault()
    const requestedName = exportFileName.trim()
    if (requestedName.length > 80) {
      setExportPasswordError(
        tr('文件名不能超过 80 个字符', 'Use at most 80 characters.', '檔案名稱不能超過 80 個字元')
      )
      return
    }
    if (
      requestedName &&
      !/^[^<>:"/\\|?*\u0000-\u001f]+$/.test(requestedName)
    ) {
      setExportPasswordError(
        tr(
          '文件名不能包含 \\ / : * ? " < > |',
          'The file name cannot contain \\ / : * ? " < > |',
          '檔案名稱不能包含 \\ / : * ? " < > |'
        )
      )
      return
    }
    const minLength = exportPasswordFormat === 'kdbx' ? 10 : 8
    if (exportPassword.length < minLength) {
      setExportPasswordError(
        exportPasswordFormat === 'kdbx'
          ? tr('数据库主密码至少需要 10 个字符', 'Use at least 10 characters.', '資料庫主密碼至少需要 10 個字元')
          : tr('导出密码至少需要 8 个字符', 'Use at least 8 characters.', '匯出密碼至少需要 8 個字元')
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
      const result = await exportTab(
        exportPasswordFormat,
        exportPassword,
        requestedName
      )
      if (!result.canceled) setExportPasswordOpen(false)
    } catch {
      // The shared export handler already reports the error.
    }
  }

  async function cancelImportPreview(): Promise<void> {
    if (!importPreview || importPreviewBusy) return
    const token = importPreview.token
    setImportPreview(null)
    try {
      await window.autologin.data.cancelImportPreview({ token })
    } catch {
      // The pending preview also expires in the main process.
    }
  }

  async function commitImport(selectedIndexes: number[]): Promise<void> {
    if (!importPreview || importPreviewBusy) return
    setImportPreviewBusy(true)
    try {
      const result = await window.autologin.data.commitImport({
        token: importPreview.token,
        selectedIndexes
      })
      setImportPreview(null)
      acceptImport(result)
    } catch (error) {
      notify(
        'error',
        error instanceof Error
          ? error.message
          : tr('导入所选记录失败', 'Could not import the selected entries.', '匯入所選項目失敗')
      )
    } finally {
      setImportPreviewBusy(false)
    }
  }

  return (
    <>
      {renderControls && (
        <div className="account-transfer-controls">
          <div className="account-tabs__tool-group" ref={groupRef}>
            <button
              type="button"
              className="account-tabs__tool account-tabs__more"
              onClick={() => setMenuOpen((open) => !open)}
              disabled={
                creatingTab ||
                importBusy ||
                templateBusy ||
                exportBusy ||
                kdbxBusy ||
                autologinBusy
              }
              aria-label={tr(
                '更多数据库操作',
                'More database actions',
                '更多資料庫操作'
              )}
              title={tr(
                '更多数据库操作',
                'More database actions',
                '更多資料庫操作'
              )}
              aria-haspopup="menu"
              aria-expanded={menuOpen}
            >
              {creatingTab ||
              importBusy ||
              templateBusy ||
              exportBusy ||
              kdbxBusy ||
              autologinBusy ? (
                <LoaderCircle size={16} className="spin" />
              ) : (
                <MoreHorizontal size={17} />
              )}
            </button>
            {menuOpen && (
              <div className="account-import-menu account-more-menu" role="menu">
                <span className="account-import-menu__label">
                  {tr('数据库', 'Database', '資料庫')}
                </span>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setMenuOpen(false)
                    void onCreateTab()
                  }}
                >
                  <Plus size={15} />
                  <span>
                    {tr('新增本地数据库', 'New local database', '新增本機資料庫')}
                  </span>
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => void chooseDatabase()}
                >
                  <FolderOpen size={15} />
                  <span>
                    {tr('打开本地数据库', 'Open local database', '開啟本機資料庫')}
                  </span>
                </button>
                <span className="account-import-menu__divider" aria-hidden="true" />
                <span className="account-import-menu__label">
                  {tr('导入', 'Import', '匯入')}
                </span>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => void importCsv('current')}
                >
                  <FileSpreadsheet size={15} />
                  <span>
                    {tr(
                      '当前数据库导入标准CSV',
                      'Import standard CSV into current database',
                      '目前資料庫匯入標準CSV'
                    )}
                  </span>
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => void importCsv('new')}
                >
                  <Upload size={15} />
                  <span>
                    {tr(
                      '新数据库导入标准CSV',
                      'Import standard CSV into new database',
                      '新資料庫匯入標準CSV'
                    )}
                  </span>
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => void exportCsvTemplate()}
                >
                  <FileDown size={15} />
                  <span>
                    {tr('下载 CSV 模板', 'Download CSV template', '下載 CSV 範本')}
                  </span>
                </button>
                <span className="account-import-menu__divider" aria-hidden="true" />
                <span className="account-import-menu__label">
                  {tr('导出', 'Export', '匯出')}
                </span>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => beginExport('autologin')}
                  disabled={!tabId}
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
                  disabled={!tabId}
                >
                  <FileSpreadsheet size={15} />
                  <span>
                    {tr(
                      '导出加密 CSV（AutoLogin 导入）',
                      'Export encrypted CSV (AutoLogin import)',
                      '匯出加密 CSV（AutoLogin 匯入）'
                    )}
                  </span>
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setMenuOpen(false)
                    void exportTab('csv-plain')
                  }}
                  disabled={!tabId}
                >
                  <FileSpreadsheet size={15} />
                  <span>
                    {tr(
                      '导出明文 CSV（Excel 可直接打开）',
                      'Export plain CSV (opens in Excel)',
                      '匯出明文 CSV（Excel 可直接開啟）'
                    )}
                  </span>
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => beginExport('kdbx')}
                  disabled={!tabId}
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
          <form
            className="kdbx-password-form"
            onSubmit={importKdbx}
            aria-busy={kdbxBusy}
          >
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
                  disabled={kdbxBusy}
                />
              </span>
            </label>
            {kdbxBusy && (
              <div className="database-import-progress" role="status" aria-live="polite">
                <span className="database-import-progress__spinner">
                  <LoadingSpinner size={18} />
                </span>
                <span className="database-import-progress__copy">
                  <strong>
                    {tr(
                      '正在解密并导入数据库…',
                      'Decrypting and importing the database…',
                      '正在解密並匯入資料庫…'
                    )}
                  </strong>
                  <small>
                    {tr(
                      '正在校验主密码、读取账号与分组，请稍候',
                      'Verifying the master password and reading accounts and groups. Please wait.',
                      '正在驗證主密碼、讀取帳號與分組，請稍候'
                    )}
                  </small>
                </span>
                <span className="database-import-progress__track" aria-hidden="true" />
              </div>
            )}
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
              <button
                type="submit"
                className={`button button--primary${kdbxBusy ? ' is-loading' : ''}`}
                disabled={kdbxBusy}
                aria-busy={kdbxBusy}
              >
                {kdbxBusy ? (
                  <LoadingSpinner size={15} />
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
            '输入 AutoLogin 导出密码',
            'Enter the AutoLogin export password',
            '輸入 AutoLogin 匯出密碼'
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
          <form
            className="kdbx-password-form"
            onSubmit={importAutologin}
            aria-busy={autologinBusy}
          >
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
                '此密码是导出该配置时设置的导出密码，不是当前保险库的主密码。解密后的账号会导入新的标签页，不会覆盖当前保险库。',
                'Use the export password set when this file was exported, not your current vault master password. Imported accounts are added to new tabs without replacing the current vault.',
                '此密碼是匯出該設定時設定的匯出密碼，不是目前保險庫的主密碼。解密後的帳號會匯入新標籤頁，不會覆蓋目前保險庫。'
              )}
            </p>
            <label className="field">
              <span className="field__label">
                {tr('导出密码', 'Export password', '匯出密碼')}
              </span>
              <span className="input-shell">
                <KeyRound size={16} />
                <input
                  type="password"
                  value={autologinPassword}
                  onChange={(event) => setAutologinPassword(event.target.value)}
                  data-autofocus
                  autoComplete="current-password"
                  disabled={autologinBusy}
                />
              </span>
            </label>
            {autologinBusy && (
              <div className="database-import-progress" role="status" aria-live="polite">
                <span className="database-import-progress__spinner">
                  <LoadingSpinner size={18} />
                </span>
                <span className="database-import-progress__copy">
                  <strong>
                    {tr(
                      '正在解密并导入配置…',
                      'Decrypting and importing the configuration…',
                      '正在解密並匯入設定…'
                    )}
                  </strong>
                  <small>
                    {tr(
                      '正在校验导出密码、读取账号与分组，请稍候',
                      'Verifying the export password and reading accounts and groups. Please wait.',
                      '正在驗證匯出密碼、讀取帳號與分組，請稍候'
                    )}
                  </small>
                </span>
                <span className="database-import-progress__track" aria-hidden="true" />
              </div>
            )}
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
              <button
                type="submit"
                className={`button button--primary${autologinBusy ? ' is-loading' : ''}`}
                disabled={autologinBusy}
                aria-busy={autologinBusy}
              >
                {autologinBusy ? (
                  <LoadingSpinner size={15} />
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

      {importPreview && (
        <ImportPreviewDialog
          preview={importPreview}
          busy={importPreviewBusy}
          onClose={() => void cancelImportPreview()}
          onConfirm={commitImport}
        />
      )}

      {csvSelection && (
        <Modal
          title={tr('输入 CSV 导出密码', 'Enter the CSV export password', '輸入 CSV 匯出密碼')}
          eyebrow={tr('CSV 加密导入', 'ENCRYPTED CSV IMPORT', 'CSV 加密匯入')}
          onClose={() => {
            if (csvBusy) return
            setCsvSelection(null)
            setCsvPassword('')
            setCsvError('')
          }}
          width="520px"
        >
          <form
            className="kdbx-password-form"
            onSubmit={importCsvWithPassword}
            aria-busy={csvBusy}
          >
            <div className="kdbx-file-summary">
              <span className="kdbx-file-summary__icon">
                <FileSpreadsheet size={15} />
              </span>
              <code title={csvSelection.fileName}>{csvSelection.fileName}</code>
              <span className="settings-location__badge">
                {formatBytes(csvSelection.size)}
              </span>
            </div>
            <p className="modal-description">
              {tr(
                '该 CSV 文件已加密。请输入导出它时设置的导出密码，而不是当前保险库的主密码。',
                'This CSV file is encrypted. Enter the export password set when it was exported, not your current vault master password.',
                '此 CSV 檔案已加密。請輸入匯出它時設定的匯出密碼，而不是目前保險庫的主密碼。'
              )}
            </p>
            <label className="field">
              <span className="field__label">
                {tr('导出密码', 'Export password', '匯出密碼')}
              </span>
              <span className="input-shell">
                <KeyRound size={16} />
                <input
                  type="password"
                  value={csvPassword}
                  onChange={(event) => setCsvPassword(event.target.value)}
                  data-autofocus
                  autoComplete="current-password"
                  disabled={csvBusy}
                />
              </span>
            </label>
            {csvBusy && (
              <div className="database-import-progress" role="status" aria-live="polite">
                <span className="database-import-progress__spinner">
                  <LoadingSpinner size={18} />
                </span>
                <span className="database-import-progress__copy">
                  <strong>
                    {tr(
                      '正在解密并导入 CSV…',
                      'Decrypting and importing the CSV…',
                      '正在解密並匯入 CSV…'
                    )}
                  </strong>
                  <small>
                    {tr(
                      '正在校验导出密码、读取账号与分组，请稍候',
                      'Verifying the export password and reading accounts and groups. Please wait.',
                      '正在驗證匯出密碼、讀取帳號與分組，請稍候'
                    )}
                  </small>
                </span>
                <span className="database-import-progress__track" aria-hidden="true" />
              </div>
            )}
            {csvError && <p className="form-error">{csvError}</p>}
            <div className="modal-actions">
              <button
                type="button"
                className="button button--ghost"
                onClick={() => {
                  setCsvSelection(null)
                  setCsvPassword('')
                  setCsvError('')
                }}
                disabled={csvBusy}
              >
                {tr('取消', 'Cancel', '取消')}
              </button>
              <button
                type="submit"
                className={`button button--primary${csvBusy ? ' is-loading' : ''}`}
                disabled={csvBusy}
                aria-busy={csvBusy}
              >
                {csvBusy ? <LoadingSpinner size={15} /> : <Import size={15} />}
                {csvBusy
                  ? tr('正在解密…', 'Decrypting…', '正在解密…')
                  : tr('解密并导入', 'Decrypt and import', '解密並匯入')}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {exportPasswordOpen && (
        <Modal
          title={
            exportPasswordFormat === 'kdbx'
              ? tr('设置 KDBX 主密码', 'Set a KDBX master password', '設定 KDBX 主密碼')
              : tr('设置导出密码', 'Set an export password', '設定匯出密碼')
          }
          eyebrow={
            exportPasswordFormat === 'kdbx'
              ? tr('KDBX 数据库导出', 'KDBX DATABASE EXPORT', 'KDBX 資料庫匯出')
              : exportPasswordFormat === 'autologin'
                ? tr('AutoLogin 加密导出', 'AUTOLOGIN ENCRYPTED EXPORT', 'AUTOLOGIN 加密匯出')
                : tr('CSV 加密导出', 'ENCRYPTED CSV EXPORT', 'CSV 加密匯出')
          }
          onClose={() => {
            if (exportBusy) return
            setExportPasswordOpen(false)
            setExportFileName('')
            setExportPassword('')
            setExportPasswordConfirm('')
            setExportPasswordError('')
          }}
          width="520px"
        >
          <form className="kdbx-password-form" onSubmit={submitExportPassword}>
            <p className="modal-description">
              {exportPasswordFormat === 'kdbx'
                ? tr(
                    '当前标签页会导出为 KDBX 数据库。请设置该数据库的主密码，密码不会保存到 AutoLogin。',
                    'The current tab will be exported as a KDBX database. Set its master password; AutoLogin does not store it.',
                    '目前標籤頁會匯出為 KDBX 資料庫。請設定該資料庫的主密碼，密碼不會儲存到 AutoLogin。'
                  )
                : tr(
                    '请设置一个导出密码。导入此文件时需要输入同一密码；它不会保存到 AutoLogin，也不是当前保险库的主密码。',
                    'Set an export password. You will need the same password to import this file; AutoLogin does not store it, and it is not your vault master password.',
                    '請設定一個匯出密碼。匯入此檔案時需要輸入相同密碼；它不會儲存到 AutoLogin，也不是目前保險庫的主密碼。'
                  )}
            </p>
            <label className="field">
              <span className="field__label">
                {tr('文件名（可选）', 'File name (optional)', '檔案名稱（選填）')}
              </span>
              <span className="input-shell">
                <FileDown size={16} />
                <input
                  type="text"
                  value={exportFileName}
                  onChange={(event) => setExportFileName(event.target.value)}
                  data-autofocus
                  maxLength={80}
                  spellCheck={false}
                  placeholder={tr(
                    '留空自动生成；扩展名自动添加',
                    'Leave blank to auto-name; extension is added',
                    '留空自動產生；副檔名自動加入'
                  )}
                />
              </span>
            </label>
            <label className="field">
              <span className="field__label">
                {exportPasswordFormat === 'kdbx'
                  ? tr('数据库主密码', 'Database master password', '資料庫主密碼')
                  : tr('导出密码', 'Export password', '匯出密碼')}
              </span>
              <span className="input-shell">
                <KeyRound size={16} />
                <input
                  type="password"
                  value={exportPassword}
                  onChange={(event) => setExportPassword(event.target.value)}
                  autoComplete="new-password"
                />
              </span>
            </label>
            <label className="field">
              <span className="field__label">
                {exportPasswordFormat === 'kdbx'
                  ? tr('确认主密码', 'Confirm master password', '確認主密碼')
                  : tr('确认导出密码', 'Confirm export password', '確認匯出密碼')}
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
                  setExportFileName('')
                  setExportPassword('')
                  setExportPasswordConfirm('')
                  setExportPasswordError('')
                }}
                disabled={exportBusy}
              >
                {tr('取消', 'Cancel', '取消')}
              </button>
              <button
                type="submit"
                className={`button button--primary${exportBusy ? ' is-loading' : ''}`}
                disabled={exportBusy}
                aria-busy={exportBusy}
              >
                {exportBusy ? (
                  <LoaderCircle size={15} className="spin" />
                ) : (
                  <Download size={15} />
                )}
                {exportBusy
                  ? tr('正在导出…', 'Exporting…', '正在匯出…')
                  : exportPasswordFormat === 'kdbx'
                    ? tr('导出 KDBX', 'Export KDBX', '匯出 KDBX')
                    : tr('导出', 'Export', '匯出')}
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
