import { useEffect, useRef, useState } from 'react'
import { Bookmark, Download, LoaderCircle, MoreHorizontal, Plus } from 'lucide-react'
import type { DataImportResult } from '@shared/types'
import { useI18n } from '../i18n'

export function BookmarkImportButton({
  onImported,
  notify,
  showLabel = false,
  buttonClassName
}: {
  onImported: (result: DataImportResult) => void
  notify: (kind: 'success' | 'error' | 'info', message: string) => void
  showLabel?: boolean
  buttonClassName?: string
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
      className={
        showLabel
          ? (buttonClassName ?? 'button button--primary')
          : 'account-tabs__tool'
      }
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

export function BookmarkTransferControls({
  tabId,
  creating,
  onCreate,
  onImported,
  notify
}: {
  tabId: string
  creating: boolean
  onCreate: () => Promise<void>
  onImported: (result: DataImportResult) => void
  notify: (kind: 'success' | 'error' | 'info', message: string) => void
}): React.JSX.Element {
  const { tr } = useI18n()
  const [menuOpen, setMenuOpen] = useState(false)
  const [importBusy, setImportBusy] = useState(false)
  const [exportBusy, setExportBusy] = useState(false)
  const groupRef = useRef<HTMLDivElement>(null)

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

  async function importBookmarks(): Promise<void> {
    if (importBusy) return
    setMenuOpen(false)
    setImportBusy(true)
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
      setImportBusy(false)
    }
  }

  async function exportBookmarks(): Promise<void> {
    if (exportBusy || !tabId) return
    setMenuOpen(false)
    setExportBusy(true)
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
      setExportBusy(false)
    }
  }

  return (
    <div className="account-tabs__tool-group" ref={groupRef}>
      <button
        type="button"
        className="account-tabs__tool account-tabs__more"
        onClick={() => setMenuOpen((open) => !open)}
        disabled={creating || importBusy || exportBusy}
        aria-label={tr('更多书签操作', 'More bookmark actions', '更多書籤操作')}
        title={tr('更多书签操作', 'More bookmark actions', '更多書籤操作')}
        aria-haspopup="menu"
        aria-expanded={menuOpen}
      >
        {creating || importBusy || exportBusy ? (
          <LoaderCircle size={16} className="spin" />
        ) : (
          <MoreHorizontal size={17} />
        )}
      </button>
      {menuOpen && (
        <div className="account-import-menu account-more-menu" role="menu">
          <span className="account-import-menu__label">
            {tr('书签数据库', 'Bookmark database', '書籤資料庫')}
          </span>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setMenuOpen(false)
              void onCreate()
            }}
          >
            <Plus size={15} />
            <span>{tr('新增书签标签页', 'New bookmark tab', '新增書籤標籤頁')}</span>
          </button>
          <span className="account-import-menu__divider" aria-hidden="true" />
          <span className="account-import-menu__label">
            {tr('导入与导出', 'Import and export', '匯入與匯出')}
          </span>
          <button type="button" role="menuitem" onClick={() => void importBookmarks()}>
            <Bookmark size={15} />
            <span>
              {tr('导入浏览器书签', 'Import browser bookmarks', '匯入瀏覽器書籤')}
            </span>
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => void exportBookmarks()}
            disabled={!tabId}
          >
            <Download size={15} />
            <span>
              {tr('导出浏览器书签', 'Export browser bookmarks', '匯出瀏覽器書籤')}
            </span>
          </button>
        </div>
      )}
    </div>
  )
}
