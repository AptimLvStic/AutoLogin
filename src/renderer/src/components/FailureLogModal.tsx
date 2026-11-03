import { useEffect, useState } from 'react'
import { FileText, LoaderCircle, RefreshCw, TriangleAlert } from 'lucide-react'
import type { FailureLogEntry } from '@shared/types'
import { Modal } from './Modal'

export function FailureLogModal({
  onClose,
  notify
}: {
  onClose: () => void
  notify: (kind: 'success' | 'error' | 'info', message: string) => void
}): React.JSX.Element {
  const [entries, setEntries] = useState<FailureLogEntry[]>([])
  const [loading, setLoading] = useState(true)

  async function load(): Promise<void> {
    setLoading(true)
    try {
      setEntries(await window.autologin.app.listFailureLogs())
    } catch (error) {
      notify('error', error instanceof Error ? error.message : '读取失败日志失败')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [])

  return (
    <Modal
      title="失败日志"
      eyebrow="LOCAL FAILURE HISTORY"
      onClose={onClose}
      width="720px"
      className="failure-log-modal"
    >
      <div className="failure-log-toolbar">
        <p>仅保留最近 200 条脱敏记录，不包含密码、Cookie、验证码或完整 URL。</p>
        <div className="settings-inline-actions">
          <button className="button button--soft" onClick={() => void load()} disabled={loading}>
            {loading ? <LoaderCircle size={15} className="spin" /> : <RefreshCw size={15} />}
            刷新
          </button>
          <button
            className="button button--ghost"
            onClick={() => void window.autologin.app.openFailureLog()}
          >
            <FileText size={15} />
            打开原始日志
          </button>
        </div>
      </div>

      {loading ? (
        <div className="failure-log-empty">
          <LoaderCircle size={22} className="spin" />
          <span>正在读取本地日志</span>
        </div>
      ) : entries.length === 0 ? (
        <div className="failure-log-empty">
          <FileText size={24} />
          <strong>还没有失败记录</strong>
          <span>批量打开出现失败或需要人工接管时，会记录在这里。</span>
        </div>
      ) : (
        <div className="failure-log-list">
          {entries.map((entry) => (
            <article className="failure-log-row" key={`${entry.batchId}:${entry.accountId}:${entry.timestamp}`}>
              <span className={`failure-log-status is-${entry.status}`}>
                {entry.status === 'timeout'
                  ? '超时'
                  : entry.status === 'manual'
                    ? '待人工'
                    : '失败'}
              </span>
              <div>
                <strong>
                  {entry.accountLabel}
                  <span> · {entry.siteName}</span>
                </strong>
                <p>{entry.reason}</p>
              </div>
              <time dateTime={entry.timestamp}>{formatTimestamp(entry.timestamp)}</time>
            </article>
          ))}
        </div>
      )}
    </Modal>
  )
}

function formatTimestamp(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return '时间未知'
  }
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  }).format(date)
}
