import { useState } from 'react'
import { CheckCircle2, ChevronDown, ChevronUp, CircleAlert } from 'lucide-react'
import type { DataImportResult } from '@shared/types'
import { useI18n } from '../i18n'
import { Modal } from './Modal'

const VISIBLE_SKIP_COUNT = 3

export function ImportResultDialog({
  result,
  onClose,
  onView
}: {
  result: DataImportResult
  onClose: () => void
  onView: () => void
}): React.JSX.Element {
  const { tr } = useI18n()
  const [expanded, setExpanded] = useState(false)
  const skipDetails =
    result.skipDetails.length > 0
      ? result.skipDetails
      : result.warnings.map((warning, index) => ({
          rowNumber: index + 1,
          title: '',
          reason: warning
        }))
  const visibleSkipDetails = expanded
    ? skipDetails
    : skipDetails.slice(0, VISIBLE_SKIP_COUNT)
  const remainingSkipDetails = Math.max(0, skipDetails.length - VISIBLE_SKIP_COUNT)
  const failed = result.accountsCreated === 0
  const failureReason = result.warnings[0] ?? skipDetails[0]?.reason ?? ''
  const sourceLabel =
    result.source === 'kdbx'
      ? 'KeePassXC'
      : result.source === 'csv'
        ? 'CSV'
        : result.source === 'bookmarks'
          ? tr('浏览器书签', 'Browser bookmarks', '瀏覽器書籤')
          : 'AutoLogin'
  const viewLabel =
    result.source === 'bookmarks'
      ? tr('查看导入的书签', 'View imported bookmarks', '檢視匯入的書籤')
      : tr('查看导入的账号', 'View imported accounts', '檢視匯入的帳號')

  return (
    <Modal
      title={tr('导入完成', 'Import complete', '匯入完成')}
      eyebrow={tr('导入结果', 'IMPORT RESULT', '匯入結果')}
      width="520px"
      className="import-result-dialog"
      onClose={onClose}
    >
      <div className="import-result-dialog__body">
        <div
          className={`import-result-dialog__hero${failed ? ' is-failure' : ''}`}
        >
          <span className="import-result-dialog__hero-icon">
            {failed ? <CircleAlert size={19} /> : <CheckCircle2 size={19} />}
          </span>
          <div>
            <strong>
              {failed
                ? tr(
                    `${sourceLabel} 未导入账号`,
                    `${sourceLabel} imported no accounts`,
                    `${sourceLabel} 未匯入帳號`
                  )
                : tr(
                    `${sourceLabel} 导入完成`,
                    `${sourceLabel} import complete`,
                    `${sourceLabel} 匯入完成`
                  )}
            </strong>
            <span>{result.tabName}</span>
          </div>
        </div>

        {failed && failureReason && (
          <div className="import-result-dialog__failure">
            <CircleAlert size={15} />
            <span>{failureReason}</span>
          </div>
        )}

        <div
          className={`import-result-dialog__kpis${
            skipDetails.length === 0 ? ' is-three' : ''
          }`}
        >
          <div>
            <strong>{result.accountsCreated}</strong>
            <span>{tr('已导入', 'Imported', '已匯入')}</span>
          </div>
          {skipDetails.length > 0 && (
            <div className="is-warning">
              <strong>{result.skipped}</strong>
              <span>{tr('已跳过', 'Skipped', '已略過')}</span>
            </div>
          )}
          <div>
            <strong>{result.groupsCreated}</strong>
            <span>{tr('新建分组', 'Groups created', '新增分組')}</span>
          </div>
          <div>
            <strong>{result.maxDepth || '—'}</strong>
            <span>{tr('最大层级', 'Max depth', '最大層級')}</span>
          </div>
        </div>

        {skipDetails.length > 0 && (
          <section className="import-result-dialog__skipped" aria-label={tr('跳过的条目', 'Skipped entries', '略過的項目')}>
            <header>
              <strong>{tr('跳过明细', 'Skipped entries', '略過明細')}</strong>
              <span>
                {tr(`${skipDetails.length} 条`, `${skipDetails.length} entries`, `${skipDetails.length} 個項目`)}
              </span>
            </header>
            <div className="import-result-dialog__skip-list">
              {visibleSkipDetails.map((detail, index) => (
                <div
                  className="import-result-dialog__skip-row"
                  key={`${detail.rowNumber}-${detail.title}-${index}`}
                >
                  <span>#{String(detail.rowNumber).padStart(2, '0')}</span>
                  <strong title={detail.title}>{detail.title || tr('未命名条目', 'Untitled entry', '未命名項目')}</strong>
                  <small>{detail.reason}</small>
                </div>
              ))}
            </div>
            {remainingSkipDetails > 0 && (
              <button
                type="button"
                className="import-result-dialog__expand"
                onClick={() => setExpanded((current) => !current)}
                aria-expanded={expanded}
              >
                {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                {expanded
                  ? tr('收起跳过明细', 'Collapse skipped entries', '收合略過明細')
                  : tr(
                      `展开查看其余 ${remainingSkipDetails} 条`,
                      `Show ${remainingSkipDetails} more`,
                      `展開查看其餘 ${remainingSkipDetails} 個`
                    )}
              </button>
            )}
          </section>
        )}

        <p className="import-result-dialog__note">
          {tr(
            '单次导入上限为 1,000 条；无法识别的记录保留在跳过明细中，可在导入预览里选择导入的不完整记录已按占位值保存。',
            'Each import is limited to 1,000 entries. Unrecognized records remain in the skipped list; incomplete entries selected in the preview were saved with placeholders.',
            '單次匯入上限為 1,000 個項目；無法辨識的記錄保留在略過明細中，已在匯入預覽勾選的不完整記錄會以預留值儲存。'
          )}
        </p>

        <div className="modal-actions">
          <button type="button" className="button button--ghost" onClick={onClose}>
            {tr('关闭', 'Close', '關閉')}
          </button>
          <button
            type="button"
            className="button button--primary"
            onClick={onView}
            disabled={result.accountsCreated === 0}
          >
            {viewLabel}
          </button>
        </div>
      </div>
    </Modal>
  )
}
