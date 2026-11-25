import { useCallback, useEffect, useMemo, useState } from 'react'
import type { Notify } from './Toast'
import {
  Eye,
  EyeOff,
  History,
  LoaderCircle,
  RotateCcw,
  Trash2
} from 'lucide-react'
import type {
  AccountWithSite,
  CredentialHistoryEntry,
  CredentialHistoryField,
  CredentialHistoryReveal
} from '@shared/types'
import { useI18n } from '../i18n'
import { ConfirmDialog, Modal } from './Modal'

type ConfirmAction = 'restore' | 'delete' | 'clear'

export function CredentialHistoryDialog({
  accountId,
  onClose,
  onRestored,
  notify
}: {
  accountId: string
  onClose: () => void
  onRestored: (account: AccountWithSite) => void
  notify: Notify
}): React.JSX.Element {
  const { tr, formatDate } = useI18n()
  const [entries, setEntries] = useState<CredentialHistoryEntry[]>([])
  const [selectedId, setSelectedId] = useState('current')
  const [reveal, setReveal] = useState<CredentialHistoryReveal | null>(null)
  const [confirmAction, setConfirmAction] = useState<ConfirmAction | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const selectedEntry = useMemo(
    () => entries.find((entry) => entry.id === selectedId) ?? entries[0],
    [entries, selectedId]
  )
  const historicalCount = entries.filter((entry) => !entry.current).length

  const loadHistory = useCallback(async (): Promise<void> => {
    setLoading(true)
    setError('')
    try {
      const nextEntries = await window.autologin.accounts.listCredentialHistory(accountId)
      setEntries(nextEntries)
      setSelectedId((current) =>
        nextEntries.some((entry) => entry.id === current)
          ? current
          : nextEntries[0]?.id ?? 'current'
      )
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : tr('读取历史记录失败', 'Could not load history.', '讀取歷史記錄失敗')
      )
    } finally {
      setLoading(false)
    }
  }, [accountId, tr])

  useEffect(() => {
    void loadHistory()
  }, [loadHistory])

  function selectEntry(entry: CredentialHistoryEntry): void {
    setSelectedId(entry.id)
    setReveal(null)
    setError('')
  }

  async function toggleReveal(): Promise<void> {
    if (!selectedEntry) return
    if (reveal) {
      setReveal(null)
      return
    }
    setBusy(true)
    setError('')
    try {
      setReveal(
        await window.autologin.accounts.revealCredentialHistory(
          accountId,
          selectedEntry.id
        )
      )
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : tr('无法显示历史凭据', 'Could not reveal credentials.', '無法顯示歷史憑據')
      )
    } finally {
      setBusy(false)
    }
  }

  async function confirmSelectedAction(): Promise<void> {
    if (!confirmAction) return
    setBusy(true)
    setError('')
    try {
      if (confirmAction === 'clear') {
        await window.autologin.accounts.clearCredentialHistory(accountId)
        notify(
          'success',
          tr('账号密码历史已全部删除', 'Credential history cleared.', '帳號密碼歷史已全部刪除')
        )
      } else {
        if (!selectedEntry || selectedEntry.current) {
          throw new Error(tr('当前账号密码版本不能执行此操作', 'This action is unavailable for the current version.', '目前帳號密碼版本不能執行此操作'))
        }
        if (confirmAction === 'restore') {
          const restored = await window.autologin.accounts.restoreCredentialHistory(
            accountId,
            selectedEntry.id
          )
          onRestored(restored)
          notify(
            'success',
            tr('历史账号密码已还原', 'Credentials restored.', '歷史帳號密碼已還原')
          )
        } else {
          await window.autologin.accounts.deleteCredentialHistory(
            accountId,
            selectedEntry.id
          )
          notify(
            'success',
            tr('历史记录已删除', 'History entry deleted.', '歷史記錄已刪除')
          )
        }
      }
      setConfirmAction(null)
      setReveal(null)
      await loadHistory()
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : tr('操作失败', 'The operation failed.', '操作失敗')
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <Modal
        title={tr('账号密码历史', 'Credential history', '帳號密碼歷史')}
        onClose={() => {
          if (!busy) onClose()
        }}
        width="900px"
        className="credential-history-modal"
      >
        <div className="credential-history-summary">
          <span>
            <History size={15} />
            {tr(
              `${historicalCount} 个历史版本`,
              `${historicalCount} historical version${historicalCount === 1 ? '' : 's'}`,
              `${historicalCount} 個歷史版本`
            )}
          </span>
          <small>
            {tr(
              '仅记录用户名和密码发生变化前的版本',
              'Only versions saved before a username or password change are recorded.',
              '僅記錄使用者名稱和密碼發生變更前的版本'
            )}
          </small>
        </div>

        <div className="credential-history-table-wrap">
          <table className="credential-history-table">
            <thead>
              <tr>
                <th>{tr('修改时间', 'Modified', '修改時間')}</th>
                <th>{tr('存在时间', 'Age', '存在時間')}</th>
                <th>{tr('差异', 'Difference', '差異')}</th>
                <th>{tr('大小', 'Size', '大小')}</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => (
                <tr
                  key={entry.id}
                  className={entry.id === selectedEntry?.id ? 'is-selected' : ''}
                  tabIndex={0}
                  aria-selected={entry.id === selectedEntry?.id}
                  onClick={() => selectEntry(entry)}
                  onKeyDown={(event) => {
                    if (event.key !== 'Enter' && event.key !== ' ') return
                    event.preventDefault()
                    selectEntry(entry)
                  }}
                >
                  <td>
                    {formatDate(entry.validUntil ?? entry.validFrom, {
                      year: 'numeric',
                      month: '2-digit',
                      day: '2-digit',
                      hour: '2-digit',
                      minute: '2-digit'
                    })}
                  </td>
                  <td>
                    {formatCredentialAge(
                      entry,
                      tr,
                      entry.validUntil ?? new Date().toISOString()
                    )}
                  </td>
                  <td>{formatChangedFields(entry.changedFields, tr)}</td>
                  <td>{formatBytes(entry.sizeBytes)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {loading && (
            <div className="credential-history-loading" role="status">
              <LoaderCircle size={18} className="spin" />
              {tr('正在读取…', 'Loading…', '正在讀取…')}
            </div>
          )}
        </div>

        {reveal && (
          <section className="credential-history-detail">
            <div>
              <span>{tr('用户名', 'Username', '使用者名稱')}</span>
              <code>{reveal.username || '—'}</code>
            </div>
            <div>
              <span>{tr('密码', 'Password', '密碼')}</span>
              <code>{reveal.password || '—'}</code>
            </div>
          </section>
        )}

        {error && <p className="form-error">{error}</p>}

        <div className="credential-history-actions">
          <button
            type="button"
            className="button button--ghost"
            onClick={() => void toggleReveal()}
            disabled={busy || loading || !selectedEntry}
          >
            {reveal ? <EyeOff size={15} /> : <Eye size={15} />}
            {reveal ? tr('隐藏', 'Hide', '隱藏') : tr('显示', 'Show', '顯示')}
          </button>
          <button
            type="button"
            className="button button--ghost"
            onClick={() => setConfirmAction('restore')}
            disabled={busy || loading || !selectedEntry || selectedEntry.current}
          >
            <RotateCcw size={15} />
            {tr('还原', 'Restore', '還原')}
          </button>
          <button
            type="button"
            className="button button--ghost"
            onClick={() => setConfirmAction('delete')}
            disabled={busy || loading || !selectedEntry || selectedEntry.current}
          >
            <Trash2 size={15} />
            {tr('删除', 'Delete', '刪除')}
          </button>
          <button
            type="button"
            className="button button--danger"
            onClick={() => setConfirmAction('clear')}
            disabled={busy || loading || historicalCount === 0}
          >
            <Trash2 size={15} />
            {tr('全部删除', 'Delete all', '全部刪除')}
          </button>
        </div>
      </Modal>

      {confirmAction && (
        <ConfirmDialog
          title={
            confirmAction === 'restore'
              ? tr('还原这组账号密码？', 'Restore these credentials?', '還原這組帳號密碼？')
              : confirmAction === 'delete'
                ? tr('删除这条历史记录？', 'Delete this history entry?', '刪除這條歷史記錄？')
                : tr('删除全部历史记录？', 'Delete all history entries?', '刪除全部歷史記錄？')
          }
          description={
            confirmAction === 'restore'
              ? tr(
                  '当前账号密码也会保存为一个历史版本，然后恢复为所选版本。',
                  'The current credentials are saved as a new history version before restoring the selected version.',
                  '目前帳號密碼也會儲存為一個歷史版本，然後還原為所選版本。'
                )
              : confirmAction === 'delete'
                ? tr(
                    '该历史版本会被永久删除，此操作不可撤销。',
                    'This historical version will be permanently deleted.',
                    '該歷史版本會被永久刪除，此操作無法復原。'
                  )
                : tr(
                    '所有历史账号密码版本都会被永久删除，当前账号密码不受影响。',
                    'All historical credential versions will be permanently deleted. The current credentials are not affected.',
                    '所有歷史帳號密碼版本都會被永久刪除，目前帳號密碼不受影響。'
                  )
          }
          confirmLabel={
            confirmAction === 'restore'
              ? tr('还原', 'Restore', '還原')
              : tr('删除', 'Delete', '刪除')
          }
          danger={confirmAction !== 'restore'}
          busy={busy}
          onConfirm={() => void confirmSelectedAction()}
          onClose={() => {
            if (!busy) setConfirmAction(null)
          }}
        />
      )}
    </>
  )
}

function formatChangedFields(
  fields: CredentialHistoryField[],
  tr: ReturnType<typeof useI18n>['tr']
): string {
  if (fields.length === 0) return '—'
  return fields
    .map((field) =>
      field === 'username' ? tr('用户名', 'Username', '使用者名稱') : tr('密码', 'Password', '密碼')
    )
    .join(tr('、', ', ', '、'))
}

function formatCredentialAge(
  entry: CredentialHistoryEntry,
  tr: ReturnType<typeof useI18n>['tr'],
  endValue: string
): string {
  const start = Date.parse(entry.validFrom)
  const end = Date.parse(endValue)
  const duration = formatDuration(
    Number.isFinite(start) && Number.isFinite(end) ? Math.max(0, end - start) : 0,
    tr
  )
  return entry.current
    ? tr(`当前（${duration}）`, `Current (${duration})`, `目前（${duration}）`)
    : tr(`大约${duration}`, `About ${duration}`, `大約${duration}`)
}

function formatDuration(milliseconds: number, tr: ReturnType<typeof useI18n>['tr']): string {
  const minutes = Math.floor(milliseconds / 60_000)
  if (minutes < 1) return tr('不到1分钟', 'less than a minute', '不到1分鐘')
  if (minutes < 60) return tr(`${minutes}分钟`, `${minutes} min`, `${minutes}分鐘`)
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return tr(`${hours}小时`, `${hours} hr`, `${hours}小時`)
  const days = Math.floor(hours / 24)
  if (days < 30) return tr(`${days}天`, `${days} days`, `${days}天`)
  const months = Math.floor(days / 30)
  if (months < 12) return tr(`${months}个月`, `${months} months`, `${months}個月`)
  return tr(`${Math.floor(months / 12)}年`, `${Math.floor(months / 12)} yr`, `${Math.floor(months / 12)}年`)
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  const kilobytes = bytes / 1024
  return `${kilobytes >= 10 ? kilobytes.toFixed(0) : kilobytes.toFixed(1)} KB`
}
