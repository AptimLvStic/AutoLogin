import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useI18n } from '../i18n'

export const LOG_PAGE_SIZES = [10, 20, 50, 100, 200] as const
export type LogPageSize = (typeof LOG_PAGE_SIZES)[number]

export function LogPagination({
  count,
  page,
  pageCount,
  pageSize,
  onPageChange,
  onPageSizeChange
}: {
  count: number
  page: number
  pageCount: number
  pageSize: LogPageSize
  onPageChange: (page: number) => void
  onPageSizeChange: (pageSize: LogPageSize) => void
}): React.JSX.Element {
  const { tr } = useI18n()

  return (
    <footer className="account-pagination log-pagination">
      <span>
        {tr(
          '共 {count} 条，第 {page}/{pages} 页',
          '{count} records, page {page} of {pages}',
          '共 {count} 筆，第 {page}/{pages} 頁',
          { count, page, pages: pageCount }
        )}
      </span>
      <div className="account-pagination__controls">
        <label className="account-pagination__size">
          <span>{tr('每页条数', 'Rows per page', '每頁筆數')}</span>
          <select
            aria-label={tr('每页条数', 'Rows per page', '每頁筆數')}
            value={pageSize}
            onChange={(event) =>
              onPageSizeChange(Number(event.target.value) as LogPageSize)
            }
          >
            {LOG_PAGE_SIZES.map((size) => (
              <option key={size} value={size}>
                {tr(`${size} 条`, `${size} rows`, `${size} 筆`)}
              </option>
            ))}
          </select>
        </label>
        <div className="account-pagination__nav">
          <button
            className="icon-button icon-button--small"
            onClick={() => onPageChange(Math.max(1, page - 1))}
            disabled={page <= 1}
            aria-label={tr('上一页', 'Previous page', '上一頁')}
          >
            <ChevronLeft size={16} />
          </button>
          <button
            className="icon-button icon-button--small"
            onClick={() => onPageChange(Math.min(pageCount, page + 1))}
            disabled={page >= pageCount}
            aria-label={tr('下一页', 'Next page', '下一頁')}
          >
            <ChevronRight size={16} />
          </button>
        </div>
      </div>
    </footer>
  )
}
