import { useEffect, useMemo, useRef, useState } from 'react'
import { CircleAlert, Import, LoaderCircle } from 'lucide-react'
import type {
  ImportMissingField,
  ImportPreview,
  ImportPreviewCandidate
} from '@shared/types'
import { useI18n } from '../i18n'
import { Modal } from './Modal'

export function ImportPreviewDialog({
  preview,
  busy,
  onClose,
  onConfirm
}: {
  preview: ImportPreview
  busy: boolean
  onClose: () => void
  onConfirm: (selectedIndexes: number[]) => Promise<void>
}): React.JSX.Element {
  const { tr } = useI18n()
  const [selected, setSelected] = useState<Set<number>>(
    () =>
      new Set(
        preview.candidates
          .filter((candidate) => candidate.defaultSelected)
          .map((candidate) => candidate.index)
      )
  )
  const readyGroupRef = useRef<HTMLInputElement>(null)
  const selectableGroupRef = useRef<HTMLInputElement>(null)
  const readyCandidates = useMemo(
    () =>
      preview.candidates.filter(
        (candidate) => candidate.missingFields.length === 0
      ),
    [preview.candidates]
  )
  const selectableCandidates = useMemo(
    () =>
      preview.candidates.filter(
        (candidate) => candidate.missingFields.length > 0
      ),
    [preview.candidates]
  )
  const readySelectedCount = readyCandidates.filter((candidate) =>
    selected.has(candidate.index)
  ).length
  const selectableSelectedCount = selectableCandidates.filter((candidate) =>
    selected.has(candidate.index)
  ).length
  const selectedNeedsReview = selectableCandidates.some(
    (candidate) =>
      selected.has(candidate.index) &&
      candidate.missingFields.some(
        (field) => field === 'startUrl' || field === 'password'
      )
  )
  const allReadySelected =
    readyCandidates.length > 0 && readySelectedCount === readyCandidates.length
  const allSelectableSelected =
    selectableCandidates.length > 0 &&
    selectableSelectedCount === selectableCandidates.length

  useEffect(() => {
    if (readyGroupRef.current) {
      readyGroupRef.current.indeterminate =
        readySelectedCount > 0 && !allReadySelected
    }
  }, [allReadySelected, readySelectedCount])

  useEffect(() => {
    if (selectableGroupRef.current) {
      selectableGroupRef.current.indeterminate =
        selectableSelectedCount > 0 && !allSelectableSelected
    }
  }, [allSelectableSelected, selectableSelectedCount])

  function toggleCandidate(index: number, checked: boolean): void {
    if (!checked && readyCandidates.some((candidate) => candidate.index === index)) {
      return
    }
    setSelected((current) => {
      const next = new Set(current)
      if (checked) next.add(index)
      else next.delete(index)
      return next
    })
  }

  function toggleGroup(
    candidates: ImportPreviewCandidate[],
    checked: boolean
  ): void {
    setSelected((current) => {
      const next = new Set(current)
      for (const candidate of candidates) {
        if (checked) next.add(candidate.index)
        else next.delete(candidate.index)
      }
      return next
    })
  }

  return (
    <Modal
      title={tr('选择要导入的条目', 'Choose entries to import', '選擇要匯入的項目')}
      eyebrow={tr('导入预览', 'IMPORT PREVIEW', '匯入預覽')}
      width="680px"
      className="import-preview-dialog"
      onClose={busy ? () => undefined : onClose}
    >
      <div className="import-preview-dialog__body">
        <div className="import-preview-dialog__summary">
          <span className="import-preview-dialog__file">
            <Import size={15} />
            <code title={preview.fileName}>{preview.fileName}</code>
          </span>
          <span>
            {tr(
              `${preview.candidates.length} 条记录`,
              `${preview.candidates.length} entries`,
              `${preview.candidates.length} 個項目`
            )}
          </span>
        </div>

        <div className="import-preview-dialog__kpis">
          <div className="is-ready">
            <strong>{preview.readyCount}</strong>
            <span>{tr('可直接导入', 'Ready', '可直接匯入')}</span>
          </div>
          <div className="is-selectable">
            <strong>{preview.selectableCount}</strong>
            <span>{tr('可选择导入', 'Review', '可選擇匯入')}</span>
          </div>
          <div className="is-blocked">
            <strong>{preview.blockedCount}</strong>
            <span>{tr('无法导入', 'Blocked', '無法匯入')}</span>
          </div>
          <div>
            <strong>{selected.size}</strong>
            <span>{tr('当前已选', 'Selected', '目前已選')}</span>
          </div>
        </div>

        <div className="import-preview-dialog__scroll">
          {readyCandidates.length > 0 && (
            <section className="import-preview-group">
              <label className="import-preview-group__header">
                <input
                  ref={readyGroupRef}
                  type="checkbox"
                  checked={allReadySelected}
                  disabled
                />
                <strong>{tr('可直接导入', 'Ready to import', '可直接匯入')}</strong>
                <span>
                  {tr(
                    `${readySelectedCount}/${readyCandidates.length} 已选`,
                    `${readySelectedCount}/${readyCandidates.length} selected`,
                    `${readySelectedCount}/${readyCandidates.length} 已選`
                  )}
                </span>
              </label>
              <div className="import-preview-group__rows">
                {readyCandidates.map((candidate) => (
                  <CandidateRow
                    key={candidate.index}
                    candidate={candidate}
                    checked={selected.has(candidate.index)}
                    locked
                    onChange={(checked) =>
                      toggleCandidate(candidate.index, checked)
                    }
                  />
                ))}
              </div>
            </section>
          )}

          {selectableCandidates.length > 0 && (
            <section className="import-preview-group is-selectable">
              <label className="import-preview-group__header">
                <input
                  ref={selectableGroupRef}
                  type="checkbox"
                  checked={allSelectableSelected}
                  onChange={(event) =>
                    toggleGroup(selectableCandidates, event.target.checked)
                  }
                />
                <strong>
                  {tr('可选择导入', 'Choose to import', '可選擇匯入')}
                </strong>
                <span>
                  {tr(
                    '勾选后按占位值入库，缺用户名以 - 占位',
                    'Selected entries use placeholders; missing usernames become -',
                    '勾選後以預留值匯入，缺使用者名稱以 - 代替'
                  )}
                </span>
              </label>
              <div className="import-preview-group__rows">
                {selectableCandidates.map((candidate) => (
                  <CandidateRow
                    key={candidate.index}
                    candidate={candidate}
                    checked={selected.has(candidate.index)}
                    onChange={(checked) =>
                      toggleCandidate(candidate.index, checked)
                    }
                  />
                ))}
              </div>
            </section>
          )}
        </div>

        {selectedNeedsReview && (
          <div className="import-preview-dialog__notice">
            <CircleAlert size={15} />
            <span>
              {tr(
                '缺地址条目导入后会进入“待补全”分组；缺密码条目无法自动登录，需要在账号编辑中补全。',
                'Entries without a URL are placed in “Needs review”; entries without a password require completion before sign-in.',
                '缺位址項目匯入後會進入「待補全」群組；缺密碼項目無法自動登入，需要在帳號編輯中補全。'
              )}
            </span>
          </div>
        )}

        {preview.blockedCount > 0 && preview.skipDetails.length > 0 && (
          <details className="import-preview-dialog__blocked">
            <summary>
              {tr(
                `${preview.blockedCount} 条无法导入`,
                `${preview.blockedCount} cannot be imported`,
                `${preview.blockedCount} 個無法匯入`
              )}
            </summary>
            <div>
              {preview.skipDetails.slice(0, 30).map((detail, index) => (
                <p key={`${detail.rowNumber}-${index}`}>
                  <span>#{String(detail.rowNumber).padStart(2, '0')}</span>
                  <strong>{detail.title || tr('未命名条目', 'Untitled', '未命名項目')}</strong>
                  <small>{detail.reason}</small>
                </p>
              ))}
            </div>
          </details>
        )}

        <div className="modal-actions">
          <button
            type="button"
            className="button button--ghost"
            onClick={onClose}
            disabled={busy}
          >
            {tr('取消', 'Cancel', '取消')}
          </button>
          <button
            type="button"
            className={`button button--primary${busy ? ' is-loading' : ''}`}
            onClick={() =>
              void onConfirm([...selected].sort((left, right) => left - right))
            }
            disabled={busy || selected.size === 0}
            aria-busy={busy}
          >
            {busy ? <LoaderCircle size={15} className="spin" /> : <Import size={15} />}
            {busy
              ? tr('正在导入…', 'Importing…', '正在匯入…')
              : tr(
                  `导入所选 ${selected.size} 条`,
                  `Import ${selected.size} selected`,
                  `匯入所選 ${selected.size} 個`
                )}
          </button>
        </div>
      </div>
    </Modal>
  )
}

function CandidateRow({
  candidate,
  checked,
  locked = false,
  onChange
}: {
  candidate: ImportPreviewCandidate
  checked: boolean
  locked?: boolean
  onChange: (checked: boolean) => void
}): React.JSX.Element {
  const { tr } = useI18n()
  return (
    <label className="import-preview-row">
      <input
        type="checkbox"
        checked={checked}
        disabled={locked}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span className="import-preview-row__number">
        #{String(candidate.rowNumber).padStart(2, '0')}
      </span>
      <span className="import-preview-row__identity">
        <strong>{candidate.siteName}</strong>
        <small title={candidate.startUrl}>
          {candidate.startUrl || tr('尚未填写登录地址', 'No sign-in URL', '尚未填寫登入位址')}
          {candidate.siteGroup ? ` · ${candidate.siteGroup}` : ''}
        </small>
      </span>
      <span className="import-preview-row__missing">
        {candidate.missingFields.map((field) => (
          <i key={field}>{missingFieldLabel(field, tr)}</i>
        ))}
      </span>
    </label>
  )
}

function missingFieldLabel(
  field: ImportMissingField,
  tr: ReturnType<typeof useI18n>['tr']
): string {
  switch (field) {
    case 'startUrl':
      return tr('缺地址', 'No URL', '缺位址')
    case 'username':
      return tr('缺用户名', 'No username', '缺使用者名稱')
    case 'password':
      return tr('缺密码', 'No password', '缺密碼')
  }
}
