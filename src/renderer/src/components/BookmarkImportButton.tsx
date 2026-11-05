import { useState } from 'react'
import { Bookmark, Download, LoaderCircle } from 'lucide-react'
import type { DataImportResult } from '@shared/types'
import { useI18n } from '../i18n'

export function BookmarkImportButton({
  onImported,
  notify,
  showLabel = false
}: {
  onImported: (result: DataImportResult) => void
  notify: (kind: 'success' | 'error' | 'info', message: string) => void
  showLabel?: boolean
}): React.JSX.Element {
  const { tr } = useI18n()
  const [busy, setBusy] = useState(false)

  async function importBookmarks(): Promise<void> {
    if (busy) return
    setBusy(true)
    try {
      const result = await window.autologin.data.importBookmarks()
      if (!result) return
      onImported(result)
      notify(
        'success',
        tr(
          `已新增 ${result.sitesCreated} 个书签站点、${result.accountsCreated} 个书签账号`,
          `${result.sitesCreated} bookmark sites and ${result.accountsCreated} bookmark accounts imported.`,
          `已新增 ${result.sitesCreated} 個書籤站點、${result.accountsCreated} 個書籤帳號`
        )
      )
    } catch (error) {
      notify(
        'error',
        error instanceof Error
          ? error.message
          : tr('导入浏览器书签失败', 'Could not import browser bookmarks.', '匯入瀏覽器書籤失敗')
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <button
      type="button"
      className={showLabel ? 'button button--primary' : 'account-tabs__tool'}
      onClick={() => void importBookmarks()}
      disabled={busy}
      aria-label={tr('导入浏览器书签', 'Import browser bookmarks', '匯入瀏覽器書籤')}
      title={tr('导入浏览器书签', 'Import browser bookmarks', '匯入瀏覽器書籤')}
      aria-busy={busy}
    >
      {busy ? <LoaderCircle size={15} className="spin" /> : <Bookmark size={15} />}
      {showLabel && (
        <span>
          {busy
            ? tr('正在导入…', 'Importing…', '正在匯入…')
            : tr('导入浏览器书签', 'Import browser bookmarks', '匯入瀏覽器書籤')}
        </span>
      )}
    </button>
  )
}

export function BookmarkExportButton({
  tabId,
  notify,
  showLabel = false
}: {
  tabId: string
  notify: (kind: 'success' | 'error' | 'info', message: string) => void
  showLabel?: boolean
}): React.JSX.Element {
  const { tr } = useI18n()
  const [busy, setBusy] = useState(false)

  async function exportBookmarks(): Promise<void> {
    if (busy || !tabId) return
    setBusy(true)
    try {
      const result = await window.autologin.data.exportTab({ tabId })
      if (!result.canceled) {
        notify(
          'success',
          tr(
            `书签已导出：${result.fileName ?? ''}`,
            `Bookmarks exported: ${result.fileName ?? ''}`,
            `書籤已匯出：${result.fileName ?? ''}`
          )
        )
      }
    } catch (error) {
      notify(
        'error',
        error instanceof Error
          ? error.message
          : tr('导出浏览器书签失败', 'Could not export browser bookmarks.', '匯出瀏覽器書籤失敗')
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <button
      type="button"
      className={showLabel ? 'button button--soft' : 'account-tabs__tool'}
      onClick={() => void exportBookmarks()}
      disabled={busy || !tabId}
      aria-label={tr('导出浏览器书签', 'Export browser bookmarks', '匯出瀏覽器書籤')}
      title={tr('导出浏览器书签', 'Export browser bookmarks', '匯出瀏覽器書籤')}
      aria-busy={busy}
    >
      {busy ? <LoaderCircle size={15} className="spin" /> : <Download size={15} />}
      {showLabel && (
        <span>
          {busy
            ? tr('正在导出…', 'Exporting…', '正在匯出…')
            : tr('导出浏览器书签', 'Export browser bookmarks', '匯出瀏覽器書籤')}
        </span>
      )}
    </button>
  )
}
