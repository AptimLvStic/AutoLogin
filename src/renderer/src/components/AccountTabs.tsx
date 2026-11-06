import { memo, type CSSProperties, type MouseEvent, type ReactNode } from 'react'
import { LoaderCircle, Plus, X } from 'lucide-react'
import type { AccountTab, AccountTabSource } from '@shared/types'
import { useI18n } from '../i18n'

interface AccountTabsProps {
  tabs: AccountTab[]
  activeTabId: string
  bookmarkMode: boolean
  busy: boolean
  accountCounts: ReadonlyMap<string, number>
  controls: ReactNode
  onSelect: (tab: AccountTab) => void
  onOpenMenu: (event: MouseEvent<HTMLElement>, tab: AccountTab) => void
  onClose: (tab: AccountTab) => void
}

export const AccountTabs = memo(function AccountTabs({
  tabs,
  activeTabId,
  bookmarkMode,
  busy,
  accountCounts,
  controls,
  onSelect,
  onOpenMenu,
  onClose
}: AccountTabsProps): React.JSX.Element {
  const { tr } = useI18n()

  return (
    <div
      className="account-tabs"
      role="tablist"
      aria-label={
        bookmarkMode
          ? tr('书签标签页', 'Bookmark tabs', '書籤標籤頁')
          : tr('账号标签页', 'Account tabs', '帳號標籤頁')
      }
    >
      <div className="account-tabs__scroll">
        {tabs.map((tab) => (
          <div
            className={`account-tab${tab.id === activeTabId ? ' is-active' : ''}`}
            key={tab.id}
            style={{ '--tab-color': tab.color } as CSSProperties}
            onContextMenu={(event) => onOpenMenu(event, tab)}
            onClick={() => onSelect(tab)}
            title={tr(
              '单击切换，右键重命名或设置颜色',
              'Click to switch, right-click to rename or recolor',
              '點擊切換，右鍵重新命名或設定顏色'
            )}
          >
            <button
              type="button"
              role="tab"
              aria-selected={tab.id === activeTabId}
              className="account-tab__select"
            >
              <span className="account-tab__marker" aria-hidden="true" />
              <span className="account-tab__name">{tab.name}</span>
              <span className="account-tab__count">
                {accountCounts.get(tab.id) ?? 0}
              </span>
              <span className={`account-tab__source is-${tab.source}`}>
                {sourceLabel(tab.source, tr)}
              </span>
            </button>
            <button
              type="button"
              className="account-tab__close"
              aria-label={
                bookmarkMode
                  ? tr(
                      `关闭“${tab.name}”标签页`,
                      `Close “${tab.name}” tab`,
                      `關閉「${tab.name}」標籤頁`
                    )
                  : tr(
                      `关闭“${tab.name}”数据库`,
                      `Close “${tab.name}” database`,
                      `關閉「${tab.name}」資料庫`
                    )
              }
              title={
                bookmarkMode
                  ? tr('关闭标签页', 'Close tab', '關閉標籤頁')
                  : tr('关闭数据库', 'Close database', '關閉資料庫')
              }
              disabled={busy}
              onClick={(event) => {
                event.stopPropagation()
                onClose(tab)
              }}
            >
              <X size={12} />
            </button>
          </div>
        ))}
      </div>
      {controls}
    </div>
  )
})

export function DatabaseCreateIcon({ busy }: { busy: boolean }): React.JSX.Element {
  return busy ? (
    <LoaderCircle size={15} className="spin" />
  ) : (
    <Plus size={15} />
  )
}

type Translate = ReturnType<typeof useI18n>['tr']

function sourceLabel(source: AccountTabSource, tr: Translate): string {
  if (source === 'csv') return 'CSV'
  if (source === 'kdbx') return 'KDBX'
  if (source === 'bookmarks') {
    return tr('浏览器书签', 'Bookmarks', '瀏覽器書籤')
  }
  return tr('本地', 'Local', '本機')
}
