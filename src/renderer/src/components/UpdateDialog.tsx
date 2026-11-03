import { CheckCircle2, Download, ExternalLink, LoaderCircle, RefreshCw, TriangleAlert } from 'lucide-react'
import type { AppUpdateState } from '@shared/types'
import { useI18n } from '../i18n'
import { Modal } from './Modal'

export function UpdateDialog({
  state,
  onLater,
  onDownload,
  onInstall,
  onOpenRelease,
  onRetry
}: {
  state: AppUpdateState
  onLater: () => void
  onDownload: () => void
  onInstall: () => void
  onOpenRelease: () => void
  onRetry: () => void
}): React.JSX.Element {
  const { tr, formatDate } = useI18n()
  const latestVersion = state.latestVersion ? `v${state.latestVersion}` : ''
  const progress = Math.max(0, Math.min(100, state.percent ?? 0))
  const releaseDate = state.releaseDate
    ? formatDate(state.releaseDate, { dateStyle: 'medium' })
    : ''

  return (
    <Modal
      title={
        state.phase === 'error'
          ? tr('检查更新失败', 'Update check failed', '檢查更新失敗')
          : latestVersion
          ? tr(`发现新版本 ${latestVersion}`, `Update ${latestVersion} available`, `發現新版本 ${latestVersion}`)
          : tr('发现新版本', 'Update available', '發現新版本')
      }
      eyebrow={tr('应用内更新', 'IN-APP UPDATE', '應用程式內更新')}
      onClose={onLater}
      width="650px"
      className="update-dialog"
    >
      <div className="update-dialog__release">
        <span
          className={`update-dialog__status is-${state.phase === 'downloaded' ? 'ready' : state.phase}`}
        >
          {state.phase === 'downloaded' ? (
            <CheckCircle2 size={17} />
          ) : state.phase === 'error' ? (
            <TriangleAlert size={17} />
          ) : state.phase === 'downloading' ? (
            <LoaderCircle size={17} className="spin" />
          ) : (
            <Download size={17} />
          )}
        </span>
        <div>
          <strong>{state.releaseName ?? `AutoLogin ${latestVersion}`}</strong>
          <small>
            {tr('当前版本', 'Current version', '目前版本')} v{state.currentVersion}
            {latestVersion ? ` · ${tr('最新版本', 'Latest version', '最新版本')} ${latestVersion}` : ''}
            {releaseDate ? ` · ${releaseDate}` : ''}
          </small>
        </div>
      </div>

      <div className="update-dialog__changelog">
        <span className="update-dialog__label">CHANGELOG</span>
        <div className="update-dialog__markdown">
          <Markdown
            content={
              state.releaseNotes ??
              tr(
                '本次更新包含体验优化与稳定性改进。',
                'This update includes experience and reliability improvements.',
                '本次更新包含體驗最佳化與穩定性改進。'
              )
            }
          />
        </div>
      </div>

      {state.phase === 'downloading' && (
        <div className="update-dialog__progress" aria-live="polite">
          <div className="update-dialog__progress-meta">
            <span>{tr('正在下载更新', 'Downloading update', '正在下載更新')}</span>
            <strong>{Math.round(progress)}%</strong>
          </div>
          <div
            className="update-dialog__progress-track"
            role="progressbar"
            aria-label={tr('更新下载进度', 'Update download progress', '更新下載進度')}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(progress)}
          >
            <span style={{ width: `${progress}%` }} />
          </div>
          <small>
            {formatBytes(state.transferred)} / {formatBytes(state.total)}
            {state.bytesPerSecond ? ` · ${formatBytes(state.bytesPerSecond)}/s` : ''}
          </small>
        </div>
      )}

      {state.phase === 'error' && state.message && (
        <p className="update-dialog__error">{state.message}</p>
      )}

      <div className="update-dialog__actions">
        <button type="button" className="button button--ghost" onClick={onLater}>
          {tr('稍后提醒', 'Later', '稍後提醒')}
        </button>
        <button type="button" className="text-button" onClick={onOpenRelease}>
          {tr('打开发布页', 'Open release page', '開啟發佈頁')}
          <ExternalLink size={13} />
        </button>
        <span className="update-dialog__action-spacer" />
        {state.phase === 'available' && (
          <button type="button" className="button button--primary" onClick={onDownload}>
            <Download size={15} />
            {tr('立即更新', 'Update now', '立即更新')}
          </button>
        )}
        {state.phase === 'downloading' && (
          <button type="button" className="button button--primary" disabled>
            <LoaderCircle size={15} className="spin" />
            {tr('下载中', 'Downloading', '下載中')}
          </button>
        )}
        {state.phase === 'downloaded' && (
          <button type="button" className="button button--primary" onClick={onInstall}>
            <RefreshCw size={15} />
            {tr('重启并安装', 'Restart and install', '重新啟動並安裝')}
          </button>
        )}
        {state.phase === 'error' && (
          <button type="button" className="button button--primary" onClick={onRetry}>
            <RefreshCw size={15} />
            {tr('重新检查', 'Check again', '重新檢查')}
          </button>
        )}
      </div>
    </Modal>
  )
}

export function Markdown({ content }: { content: string }): React.JSX.Element {
  const lines = content.replace(/\r\n/g, '\n').split('\n')
  const blocks: React.ReactNode[] = []
  let index = 0

  while (index < lines.length) {
    const line = lines[index]?.trimEnd() ?? ''
    if (!line.trim()) {
      index += 1
      continue
    }

    if (line.trim().startsWith('```')) {
      const code: string[] = []
      index += 1
      while (index < lines.length && !lines[index]?.trim().startsWith('```')) {
        code.push(lines[index] ?? '')
        index += 1
      }
      index += 1
      blocks.push(
        <pre key={`code-${index}`}>
          <code>{code.join('\n')}</code>
        </pre>
      )
      continue
    }

    const heading = /^(#{1,4})\s+(.+)$/.exec(line)
    if (heading) {
      const level = heading[1]?.length ?? 2
      const Tag = level <= 2 ? 'h3' : 'h4'
      blocks.push(<Tag key={`heading-${index}`}>{renderInline(heading[2] ?? '')}</Tag>)
      index += 1
      continue
    }

    if (/^\s*[-*]\s+/.test(line)) {
      const items: string[] = []
      while (index < lines.length && /^\s*[-*]\s+/.test(lines[index] ?? '')) {
        items.push((lines[index] ?? '').replace(/^\s*[-*]\s+/, ''))
        index += 1
      }
      blocks.push(
        <ul key={`list-${index}`}>
          {items.map((item, itemIndex) => (
            <li key={itemIndex}>{renderInline(item)}</li>
          ))}
        </ul>
      )
      continue
    }

    if (/^\s*\d+\.\s+/.test(line)) {
      const items: string[] = []
      while (index < lines.length && /^\s*\d+\.\s+/.test(lines[index] ?? '')) {
        items.push((lines[index] ?? '').replace(/^\s*\d+\.\s+/, ''))
        index += 1
      }
      blocks.push(
        <ol key={`ordered-${index}`}>
          {items.map((item, itemIndex) => (
            <li key={itemIndex}>{renderInline(item)}</li>
          ))}
        </ol>
      )
      continue
    }

    const paragraph: string[] = [line.trim()]
    index += 1
    while (index < lines.length) {
      const next = lines[index] ?? ''
      if (
        !next.trim() ||
        /^(#{1,4})\s+/.test(next) ||
        /^\s*[-*]\s+/.test(next) ||
        /^\s*\d+\.\s+/.test(next) ||
        next.trim().startsWith('```')
      ) {
        break
      }
      paragraph.push(next.trim())
      index += 1
    }
    blocks.push(<p key={`paragraph-${index}`}>{renderInline(paragraph.join(' '))}</p>)
  }

  return <div className="markdown-content">{blocks}</div>
}

function renderInline(value: string): React.ReactNode[] {
  const tokenPattern = /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)]+\))/g
  const parts = value.split(tokenPattern)
  return parts.map((part, index) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return <strong key={index}>{part.slice(2, -2)}</strong>
    }
    if (part.startsWith('`') && part.endsWith('`')) {
      return <code key={index}>{part.slice(1, -1)}</code>
    }
    const link = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(part)
    if (link) {
      const href = link[2] ?? ''
      if (isSafeHttpUrl(href)) {
        return (
          <a key={index} href={href} target="_blank" rel="noreferrer">
            {link[1]}
          </a>
        )
      }
      return <span key={index}>{link[1]}</span>
    }
    return part
  })
}

function isSafeHttpUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

function formatBytes(value?: number): string {
  if (!value || value <= 0) return '0 B'
  if (value < 1024) return `${value} B`
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`
  if (value < 1024 * 1024 * 1024) return `${(value / 1024 / 1024).toFixed(1)} MB`
  return `${(value / 1024 / 1024 / 1024).toFixed(2)} GB`
}
