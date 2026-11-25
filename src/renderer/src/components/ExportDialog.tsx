import { useMemo, useState } from 'react'
import type { Notify } from './Toast'
import { Download, FileJson, FileSpreadsheet, FileText, KeyRound, LockKeyhole } from 'lucide-react'
import {
  ACCOUNT_EXPORT_FIELDS,
  DEFAULT_EXPORT_FIELDS,
  type AccountExportField,
  type AccountExportFormat
} from '@shared/export'
import type { AccountWithSite, DataExportFormat } from '@shared/types'
import { Modal } from './Modal'
import { fileToastActions } from '../toast-actions'
import { useI18n } from '../i18n'

type VaultFormat = Extract<DataExportFormat, 'autologin' | 'kdbx'>
type ExportMode = 'records' | VaultFormat

const RECORD_FORMATS: Array<{
  id: AccountExportFormat
  label: string
  hint: string
  icon: typeof FileText
}> = [
  { id: 'csv', label: 'CSV', hint: 'Excel / Numbers', icon: FileSpreadsheet },
  { id: 'json', label: 'JSON', hint: '结构化数据', icon: FileJson },
  { id: 'md', label: 'Markdown', hint: '可直接阅读的报表', icon: FileText }
]

const FILE_NAME_PATTERN = /^[^<>:"/\\|?*\u0000-\u001f]+$/

export function ExportDialog({
  accounts,
  scopeLabel,
  tabId,
  vaultTabId,
  accountIds,
  defaultName,
  otpCount,
  recordsOnly = false,
  onClose,
  notify
}: {
  accounts: AccountWithSite[]
  scopeLabel: string
  tabId?: string
  vaultTabId?: string
  accountIds?: string[]
  defaultName: string
  otpCount: number
  recordsOnly?: boolean
  onClose: () => void
  notify: Notify
}): React.JSX.Element {
  const { tr } = useI18n()
  const [mode, setMode] = useState<ExportMode>('records')
  const [recordFormat, setRecordFormat] = useState<AccountExportFormat>('csv')
  const [fields, setFields] = useState<AccountExportField[]>(DEFAULT_EXPORT_FIELDS)
  const [masterPassword, setMasterPassword] = useState('')
  const [vaultPassword, setVaultPassword] = useState('')
  const [vaultPasswordConfirm, setVaultPasswordConfirm] = useState('')
  const [fileName, setFileName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const selected = useMemo(() => new Set(fields), [fields])
  const count = accounts.length
  const isVault = mode !== 'records'
  const needsPassword = isVault
  const passwordMinLength = mode === 'kdbx' ? 10 : 8
  const passwordLabel =
    mode === 'kdbx'
      ? tr('数据库主密码', 'Database master password', '資料庫主密碼')
      : tr('导出密码', 'Export password', '匯出密碼')
  const includePasswords = selected.has('password')
  const fieldOptions = recordsOnly
    ? ACCOUNT_EXPORT_FIELDS.filter((item) => item.key !== 'password')
    : ACCOUNT_EXPORT_FIELDS

  const vaultFormats: Array<{
    id: VaultFormat
    label: string
    hint: string
    icon: typeof FileText
    disabled: boolean
  }> = [
    {
      id: 'autologin',
      label: tr('AutoLogin 格式', 'AutoLogin format', 'AutoLogin 格式'),
      hint: tr('.autologin · 加密完整备份', '.autologin · encrypted full backup', '.autologin · 加密完整備份'),
      icon: LockKeyhole,
      disabled: !vaultTabId
    },
    {
      id: 'kdbx',
      label: tr('KeePassXC 格式', 'KeePassXC format', 'KeePassXC 格式'),
      hint: tr('.kdbx · 通用密码库', '.kdbx · portable vault', '.kdbx · 通用密碼庫'),
      icon: KeyRound,
      disabled: !vaultTabId
    }
  ]

  function toggleField(id: AccountExportField): void {
    setFields((current) => {
      if (current.includes(id)) {
        if (id === 'password') setMasterPassword('')
        return current.filter((item) => item !== id)
      }
      return [...current, id]
    })
  }

  function selectMode(next: ExportMode): void {
    setMode(next)
    setError('')
    setVaultPassword('')
    setVaultPasswordConfirm('')
  }

  function validateFileName(): string {
    const requested = fileName.trim()
    if (requested.length > 80) {
      return tr('文件名不能超过 80 个字符', 'Use at most 80 characters.', '檔案名稱不能超過 80 個字元')
    }
    if (requested && !FILE_NAME_PATTERN.test(requested)) {
      return tr(
        '文件名不能包含 \\ / : * ? " < > |',
        'The file name cannot contain \\ / : * ? " < > |',
        '檔案名稱不能包含 \\ / : * ? " < > |'
      )
    }
    return ''
  }

  async function submit(event: React.FormEvent): Promise<void> {
    event.preventDefault()
    if (busy) return
    const fileNameError = validateFileName()
    if (fileNameError) {
      setError(fileNameError)
      return
    }
    const requestedName = fileName.trim() || undefined

    if (mode === 'records') {
      if (fields.length === 0) {
        setError(tr('至少选择一个字段', 'Select at least one field', '至少選擇一個欄位'))
        return
      }
      if (includePasswords && !masterPassword) {
        setError(
          tr(
            '导出密码需要先输入主密码',
            'Enter the master password to export passwords',
            '匯出密碼需要先輸入主密碼'
          )
        )
        return
      }
      setBusy(true)
      setError('')
      try {
        const result = await window.autologin.data.exportRecords({
          tabId,
          accountIds,
          format: recordFormat,
          fields,
          includePasswords,
          masterPassword: includePasswords ? masterPassword : undefined,
          fileName: requestedName
        })
        if (result.canceled) {
          notify('info', tr('已取消导出', 'Export cancelled', '已取消匯出'))
          onClose()
          return
        }
        notify(
          'success',
          tr('已导出：' + (result.fileName ?? ''), 'Exported: ' + (result.fileName ?? ''), '已匯出：' + (result.fileName ?? '')),
          fileToastActions(tr, result.filePath)
        )
        onClose()
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : tr('导出失败', 'Export failed', '匯出失敗'))
      } finally {
        setBusy(false)
      }
      return
    }

    if (!vaultTabId) {
      setError(tr('请先打开一个本地数据库', 'Open a local database first', '請先開啟本機資料庫'))
      return
    }
    if (needsPassword) {
      if (vaultPassword.length < passwordMinLength) {
        setError(
          passwordMinLength === 10
            ? tr(
                '数据库主密码至少需要 10 个字符',
                'Use at least 10 characters.',
                '資料庫主密碼至少需要 10 個字元'
              )
            : tr('导出密码至少需要 8 个字符', 'Use at least 8 characters.', '匯出密碼至少需要 8 個字元')
        )
        return
      }
      if (vaultPassword !== vaultPasswordConfirm) {
        setError(tr('两次输入的密码不一致', 'The passwords do not match.', '兩次輸入的密碼不一致'))
        return
      }
    }

    setBusy(true)
    setError('')
    try {
      const result = await window.autologin.data.exportTab({
        tabId: vaultTabId,
        format: mode,
        password: needsPassword ? vaultPassword : undefined,
        fileName: requestedName
      })
      if (result.canceled) {
        notify('info', tr('已取消导出', 'Export cancelled', '已取消匯出'))
        onClose()
        return
      }
      notify(
        'success',
        tr('已导出：' + (result.fileName ?? ''), 'Exported: ' + (result.fileName ?? ''), '已匯出：' + (result.fileName ?? '')),
        fileToastActions(tr, result.filePath)
      )
      onClose()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : tr('导出失败', 'Export failed', '匯出失敗'))
    } finally {
      setBusy(false)
    }
  }

  const submitDisabled = busy || (isVault ? !vaultTabId : count === 0)

  return (
    <Modal
      title={tr('导出', 'Export', '匯出')}
      eyebrow={tr('数据导出', 'DATA EXPORT', '資料匯出')}
      onClose={() => {
        if (!busy) onClose()
      }}
      width="620px"
      className="export-dialog"
    >
      <form onSubmit={(event) => void submit(event)}>
        <p className="modal-description">
          {isVault
            ? tr(
                '导出整个数据库：包含所有分组的账号、密码与 OTP 密钥。',
                'Exports the whole database, including accounts, passwords and OTP secrets.',
                '匯出整個資料庫：包含所有分組的帳號、密碼與 OTP 密鑰。'
              )
            : tr(
                '将导出 ' + count + ' 条记录 · ' + scopeLabel + '。',
                'Export ' + count + ' records · ' + scopeLabel + '.',
                '將匯出 ' + count + ' 筆記錄 · ' + scopeLabel + '。'
              )}
        </p>

        {!recordsOnly && (
          <div className="export-dialog__section">
            <span className="export-dialog__section-title">
              {tr('账号数据（可备份、可迁移）', 'Account data (backup / migration)', '帳號資料（可備份、可移轉）')}
            </span>
            <div
              className="export-dialog__formats export-dialog__formats--vault"
              role="radiogroup"
              aria-label={tr('账号数据导出格式', 'Account data format', '帳號資料匯出格式')}
            >
              {vaultFormats.map((item) => {
                const Icon = item.icon
                return (
                  <button
                    key={item.id}
                    type="button"
                    role="radio"
                    aria-checked={mode === item.id}
                    className={'export-dialog__format' + (mode === item.id ? ' is-active' : '')}
                    onClick={() => selectMode(item.id)}
                    disabled={busy || item.disabled}
                  >
                    <Icon size={17} />
                    <strong>{item.label}</strong>
                    <small>{item.hint}</small>
                  </button>
                )
              })}
            </div>
          </div>
        )}

        <div className="export-dialog__section">
          <span className="export-dialog__section-title">
            {tr('账号记录（按需选择字段）', 'Records (pick fields)', '帳號記錄（依需求選擇欄位）')}
          </span>
          <div
            className="export-dialog__formats"
            role="radiogroup"
            aria-label={tr('记录导出格式', 'Records format', '記錄匯出格式')}
          >
            {RECORD_FORMATS.map((item) => {
              const Icon = item.icon
              const active = mode === 'records' && recordFormat === item.id
              return (
                <button
                  key={item.id}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  className={'export-dialog__format' + (active ? ' is-active' : '')}
                  onClick={() => {
                    setRecordFormat(item.id)
                    selectMode('records')
                  }}
                  disabled={busy}
                >
                  <Icon size={17} />
                  <strong>{item.label}</strong>
                  <small>{item.hint}</small>
                </button>
              )
            })}
          </div>
        </div>

        {mode === 'records' && otpCount > 0 && recordFormat !== 'json' && (
          <p className="export-dialog__warning">
            {recordsOnly
              ? tr(
                  otpCount + ' 个账号含有 OTP 密钥。记录导出不会写入 OTP 密钥。',
                  otpCount + ' accounts have OTP secrets. Record exports omit them.',
                  otpCount + ' 個帳號含有 OTP 密鑰。記錄匯出不會寫入 OTP 密鑰。'
                )
              : tr(
                  otpCount + ' 个账号含有 OTP 密钥。记录导出不会写入 OTP 密钥，需要完整备份请选择「AutoLogin 格式」。',
                  otpCount + ' accounts have OTP secrets. Record exports omit them; use the AutoLogin format for a full backup.',
                  otpCount + ' 個帳號含有 OTP 密鑰。記錄匯出不會寫入 OTP 密鑰，需要完整備份請選擇「AutoLogin 格式」。'
                )}
          </p>
        )}

        {mode === 'records' && (
          <>
            <div className="export-dialog__section">
              <span className="export-dialog__section-title">{tr('包含字段', 'Fields', '包含欄位')}</span>
              <div className="export-dialog__fields">
                {fieldOptions.map((item) => (
                  <label key={item.key} className="export-dialog__field">
                    <input
                      type="checkbox"
                      checked={selected.has(item.key)}
                      onChange={() => toggleField(item.key)}
                      disabled={busy}
                    />
                    <span>{item.label}</span>
                  </label>
                ))}
              </div>
            </div>
            {includePasswords && (
              <label className="field">
                <span className="field__label">{tr('主密码', 'Master password', '主密碼')}</span>
                <span className="input-shell">
                  <input
                    type="password"
                    value={masterPassword}
                    onChange={(event) => setMasterPassword(event.target.value)}
                    autoComplete="current-password"
                    data-autofocus
                    disabled={busy}
                  />
                </span>
              </label>
            )}
            {includePasswords && (
              <p className="form-hint">
                {tr(
                  '导出文件中的密码为明文，仅用于本次导出；需要校验当前保险库主密码。',
                  'Passwords are written in clear text for this export and require the vault master password.',
                  '匯出檔案中的密碼為明文，僅用於本次匯出；需要驗證目前保險庫主密碼。'
                )}
              </p>
            )}
          </>
        )}

        {needsPassword && (
          <>
            <label className="field">
              <span className="field__label">{passwordLabel}</span>
              <span className="input-shell">
                <input
                  type="password"
                  value={vaultPassword}
                  onChange={(event) => setVaultPassword(event.target.value)}
                  autoComplete="new-password"
                  placeholder={tr('至少 ' + passwordMinLength + ' 个字符', 'At least ' + passwordMinLength + ' characters', '至少 ' + passwordMinLength + ' 個字元')}
                  data-autofocus
                  disabled={busy}
                />
              </span>
            </label>
            <label className="field">
              <span className="field__label">{tr('确认密码', 'Confirm password', '確認密碼')}</span>
              <span className="input-shell">
                <input
                  type="password"
                  value={vaultPasswordConfirm}
                  onChange={(event) => setVaultPasswordConfirm(event.target.value)}
                  autoComplete="new-password"
                  disabled={busy}
                />
              </span>
            </label>
            <p className="form-hint">
              {tr(
                '该密码只用于加密这个导出文件，与保险库主密码无关；导入时需要输入它。',
                'This password encrypts the exported file only. It is not your vault master password and is required on import.',
                '此密碼只用於加密這個匯出檔案，與保險庫主密碼無關；匯入時需要輸入它。'
              )}
            </p>
          </>
        )}

        <label className="field">
          <span className="field__label">{tr('文件名（可选）', 'File name (optional)', '檔案名稱（選填）')}</span>
          <span className="input-shell">
            <input
              type="text"
              value={fileName}
              onChange={(event) => setFileName(event.target.value)}
              maxLength={80}
              placeholder={defaultName}
              disabled={busy}
            />
          </span>
        </label>
        {error && <p className="form-error">{error}</p>}
        <div className="modal-actions">
          <button type="button" className="button button--ghost" onClick={onClose} disabled={busy}>
            {tr('取消', 'Cancel', '取消')}
          </button>
          <button type="submit" className="button button--primary" disabled={submitDisabled}>
            <Download size={15} />
            {busy ? tr('正在导出…', 'Exporting…', '正在匯出…') : tr('导出', 'Export', '匯出')}
          </button>
        </div>
      </form>
    </Modal>
  )
}
