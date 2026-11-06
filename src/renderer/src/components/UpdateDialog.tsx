import { useState } from 'react'
import {
  CheckCircle2,
  Download,
  ExternalLink,
  LoaderCircle,
  RefreshCw,
  TriangleAlert,
  X
} from 'lucide-react'
import type { AppUpdateState } from '@shared/types'
import { useI18n } from '../i18n'
import { Modal } from './Modal'

export function UpdateDialog({
  state,
  onLater,
  onDownload,
  onCancel,
  onInstall,
  onOpenRelease,
  onRetry
}: {
  state: AppUpdateState
  onLater: () => void
  onDownload: () => void
  onCancel: () => Promise<void>
  onInstall: () => void
  onOpenRelease: () => void
  onRetry: () => void
}): React.JSX.Element {
  const { tr, formatDate } = useI18n()
  const [cancelling, setCancelling] = useState(false)
  const latestVersion = state.latestVersion ? `v${state.latestVersion}` : ''
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
        <UpdateProgress
          className="update-dialog__progress"
          state={state}
          cancelling={cancelling}
          onCancel={async () => {
            if (cancelling) return
            setCancelling(true)
            try {
              await onCancel()
            } finally {
              setCancelling(false)
            }
          }}
        />
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

export function UpdateProgress({
  state,
  onCancel,
  cancelling = false,
  className
}: {
  state: Pick<
    AppUpdateState,
    | 'phase'
    | 'percent'
    | 'transferred'
    | 'total'
    | 'bytesPerSecond'
    | 'message'
    | 'downloadMode'
  >
  onCancel?: () => void
  cancelling?: boolean
  className?: string
}): React.JSX.Element {
  const { tr } = useI18n()
  const progress = Math.max(0, Math.min(100, state.percent ?? 0))

  return (
    <div className={`update-progress${className ? ` ${className}` : ''}`} aria-live="polite">
      <div className="update-progress__meta">
        <span>
          {state.phase === 'downloaded'
            ? tr('更新下载完成', 'Update downloaded', '更新下載完成')
            : state.message ??
              tr('正在下载更新', 'Downloading update', '正在下載更新')}
        </span>
        <strong>{Math.round(progress)}%</strong>
      </div>
      <div
        className="update-progress__track"
        role="progressbar"
        aria-label={tr('更新下载进度', 'Update download progress', '更新下載進度')}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(progress)}
      >
        <span style={{ width: `${progress}%` }} />
      </div>
      <div className="update-progress__footer">
        {state.phase === 'downloaded' ? (
          <small>{tr('下载已完成', 'Download complete', '下載已完成')}</small>
        ) : (
          <small>
            {formatBytes(state.transferred)} / {formatBytes(state.total)}
            {state.bytesPerSecond ? ` · ${formatBytes(state.bytesPerSecond)}/s` : ''}
          </small>
        )}
        {onCancel && state.phase === 'downloading' && (
          <button
            type="button"
            className="button button--ghost button--small update-progress__cancel"
            onClick={onCancel}
            disabled={cancelling}
          >
            {cancelling ? (
              <LoaderCircle size={13} className="spin" />
            ) : (
              <X size={13} />
            )}
            {cancelling
              ? tr('正在取消…', 'Cancelling…', '正在取消…')
              : tr('取消下载', 'Cancel download', '取消下載')}
          </button>
        )}
      </div>
    </div>
  )
}

export function Markdown({ content }: { content: string }): React.JSX.Element {
  const lines = normalizeMarkdown(content).split('\n')
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

    if (/^\s*([-*_])(?:\s*\1){2,}\s*$/.test(line)) {
      blocks.push(<hr key={`rule-${index}`} />)
      index += 1
      continue
    }

    const heading = /^(#{1,6})\s+(.+)$/.exec(line)
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

    if (/^\s*>\s?/.test(line)) {
      const quote: string[] = []
      while (index < lines.length && /^\s*>\s?/.test(lines[index] ?? '')) {
        quote.push((lines[index] ?? '').replace(/^\s*>\s?/, ''))
        index += 1
      }
      blocks.push(
        <blockquote key={`quote-${index}`}>{renderInline(quote.join(' '))}</blockquote>
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
        /^(#{1,6})\s+/.test(next) ||
        /^\s*[-*]\s+/.test(next) ||
        /^\s*>\s?/.test(next) ||
        /^\s*\d+\.\s+/.test(next) ||
        /^\s*([-*_])(?:\s*\1){2,}\s*$/.test(next) ||
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
  const tokenPattern =
    /(!\[[^\]]*\]\([^)]+\)|\[[^\]]+\]\([^)]+\)|\*\*[^*]+\*\*|__[^_]+__|~~[^~]+~~|`[^`]+`|\*[^*]+\*|_[^_]+_)/g
  const parts = value.split(tokenPattern)
  return parts.map((part, index) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return <strong key={index}>{part.slice(2, -2)}</strong>
    }
    if (part.startsWith('__') && part.endsWith('__')) {
      return <strong key={index}>{part.slice(2, -2)}</strong>
    }
    if (part.startsWith('~~') && part.endsWith('~~')) {
      return <del key={index}>{part.slice(2, -2)}</del>
    }
    if (part.startsWith('`') && part.endsWith('`')) {
      return <code key={index}>{part.slice(1, -1)}</code>
    }
    if (part.startsWith('*') && part.endsWith('*')) {
      return <em key={index}>{part.slice(1, -1)}</em>
    }
    if (part.startsWith('_') && part.endsWith('_')) {
      return <em key={index}>{part.slice(1, -1)}</em>
    }
    const image = /^!\[([^\]]*)\]\(([^)]+)\)$/.exec(part)
    if (image) {
      return image[1] || ''
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
    return stripRawHtml(part)
  })
}

function normalizeMarkdown(value: string): string {
  return stripRawHtml(
    value
      .replace(/\r\n?/g, '\n')
      .replace(/\u00a0/g, ' ')
      .replace(/<a\b[^>]*href=["']([^"']+)["'][^>]*>(.*?)<\/a>/gi, '[$2]($1)')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<li\b[^>]*>/gi, '\n- ')
      .replace(/<\/(?:p|div|section|article|details|summary|h[1-6]|ul|ol)>/gi, '\n')
  )
}

function stripRawHtml(value: string): string {
  const decoded = value
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
  return decoded.replace(/<\/?[a-z][^>]*>/gi, '')
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
