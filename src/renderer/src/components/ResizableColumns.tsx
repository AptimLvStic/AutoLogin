import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Check, GripVertical, Maximize2, MoveHorizontal } from 'lucide-react'
import { useI18n } from '../i18n'

export type TableColumnSizing = 'content' | 'window' | 'manual'

export interface TableColumnDefinition<Key extends string> {
  key: Key
  label: string
  track: string
  defaultWidth: number
  minWidth: number
  hideable?: boolean
}

interface ResizableColumnsOptions<Key extends string> {
  storageKey: string
  columns: readonly TableColumnDefinition<Key>[]
  tableRef: React.RefObject<HTMLElement | null>
  headerSelector: string
  rowSelector: string
  measureKey: string
  menuLabel: string
  checkboxTrack?: string
}

const COLUMN_MAX_WIDTH = 520

export function useResizableColumns<Key extends string>({
  storageKey,
  columns,
  tableRef,
  headerSelector,
  rowSelector,
  measureKey,
  menuLabel,
  checkboxTrack = '26px'
}: ResizableColumnsOptions<Key>): {
  visibleOrderedColumns: Key[]
  gridTemplateColumns: string
  openMenu: (event: React.MouseEvent<HTMLElement>) => void
  renderResizer: (key: Key, label: string) => React.JSX.Element
  menu: React.ReactNode
} {
  const { tr } = useI18n()
  const columnByKey = useMemo(
    () => new Map(columns.map((column) => [column.key, column])),
    [columns]
  )
  const configurableKeys = useMemo(
    () => columns.filter((column) => column.hideable !== false).map((column) => column.key),
    [columns]
  )
  const fixedKeys = useMemo(
    () => columns.filter((column) => column.hideable === false).map((column) => column.key),
    [columns]
  )
  const defaults = useMemo(
    () =>
      Object.fromEntries(columns.map((column) => [column.key, column.defaultWidth])) as Record<
        Key,
        number
      >,
    [columns]
  )
  const [visibleColumns, setVisibleColumns] = useState<Set<Key>>(() => {
    try {
      const stored = window.localStorage.getItem(`${storageKey}.visibleColumns`)
      const values = stored ? (JSON.parse(stored) as unknown) : null
      if (!Array.isArray(values)) return new Set(columns.map((column) => column.key))
      const valid = new Set(
        values.filter(
          (value): value is Key =>
            typeof value === 'string' &&
            columns.some((column) => column.key === value)
        )
      )
      for (const key of fixedKeys) valid.add(key)
      return valid
    } catch {
      return new Set(columns.map((column) => column.key))
    }
  })
  const [columnOrder, setColumnOrder] = useState<Key[]>(() => {
    try {
      const stored = window.localStorage.getItem(`${storageKey}.columnOrder`)
      const values = stored ? (JSON.parse(stored) as unknown) : null
      const valid = Array.isArray(values)
        ? values.filter(
            (value): value is Key =>
              typeof value === 'string' && configurableKeys.includes(value as Key)
          )
        : []
      return [
        ...new Set(valid),
        ...configurableKeys.filter((key) => !valid.includes(key))
      ]
    } catch {
      return [...configurableKeys]
    }
  })
  const [sizing, setSizing] = useState<TableColumnSizing>(() => {
    const stored = window.localStorage.getItem(`${storageKey}.columnSizing`)
    return stored === 'content' || stored === 'manual' || stored === 'window'
      ? stored
      : 'window'
  })
  const [manualWidths, setManualWidths] = useState<Record<Key, number>>(() => {
    try {
      const stored = window.localStorage.getItem(`${storageKey}.columnWidths`)
      const values = stored ? (JSON.parse(stored) as unknown) : null
      if (!values || typeof values !== 'object') return { ...defaults }
      const record = values as Record<string, unknown>
      return Object.fromEntries(
        columns.map((column) => {
          const value = record[column.key]
          return [
            column.key,
            typeof value === 'number' && Number.isFinite(value)
              ? Math.max(column.minWidth, Math.min(COLUMN_MAX_WIDTH, value))
              : column.defaultWidth
          ]
        })
      ) as Record<Key, number>
    } catch {
      return { ...defaults }
    }
  })
  const [fitContentWidths, setFitContentWidths] = useState<Record<Key, number>>(
    () => ({ ...defaults })
  )
  const [menuOpen, setMenuOpen] = useState(false)
  const [menuPosition, setMenuPosition] = useState({ left: 0, top: 0 })
  const [draggedKey, setDraggedKey] = useState<Key | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const resizeCleanupRef = useRef<(() => void) | null>(null)

  const visibleOrderedColumns = useMemo(
    () => [
      ...columnOrder.filter((key) => visibleColumns.has(key)),
      ...fixedKeys.filter((key) => visibleColumns.has(key))
    ],
    [columnOrder, fixedKeys, visibleColumns]
  )

  const gridTemplateColumns = useMemo(() => {
    const widths =
      sizing === 'content'
        ? fitContentWidths
        : sizing === 'manual'
          ? manualWidths
          : null
    return [
      checkboxTrack,
      ...visibleOrderedColumns.map((key) => {
        const column = columnByKey.get(key)
        if (!column) return '0px'
        if (!widths) return column.track
        return `${widths[key]}px`
      })
    ].join(' ')
  }, [
    checkboxTrack,
    columnByKey,
    fitContentWidths,
    manualWidths,
    sizing,
    visibleOrderedColumns
  ])

  useEffect(() => {
    window.localStorage.setItem(
      `${storageKey}.visibleColumns`,
      JSON.stringify(columns.filter((column) => visibleColumns.has(column.key)).map((column) => column.key))
    )
  }, [columns, storageKey, visibleColumns])

  useEffect(() => {
    window.localStorage.setItem(
      `${storageKey}.columnOrder`,
      JSON.stringify(columnOrder)
    )
  }, [columnOrder, storageKey])

  useEffect(() => {
    window.localStorage.setItem(`${storageKey}.columnSizing`, sizing)
  }, [sizing, storageKey])

  useEffect(() => {
    window.localStorage.setItem(
      `${storageKey}.columnWidths`,
      JSON.stringify(manualWidths)
    )
  }, [manualWidths, storageKey])

  useEffect(() => {
    if (sizing !== 'content') return
    const table = tableRef.current
    const header = table?.querySelector<HTMLElement>(headerSelector)
    if (!table || !header) return
    const rows = [...table.querySelectorAll<HTMLElement>(rowSelector)]
    const frame = window.requestAnimationFrame(() => {
      const probe = document.createElement('div')
      probe.style.cssText =
        'position:fixed;left:-10000px;top:0;display:flex;flex-direction:column;align-items:flex-start;width:max-content;visibility:hidden;pointer-events:none;'
      document.body.append(probe)
      const measure = (source: HTMLElement | null): number => {
        if (!source) return 0
        const clone = source.cloneNode(true) as HTMLElement
        clone.querySelectorAll('[data-column-resizer]').forEach((node) => node.remove())
        clone.style.cssText =
          'display:flex;width:max-content;min-width:0;max-width:none;align-items:center;'
        probe.append(clone)
        const width = clone.getBoundingClientRect().width
        clone.remove()
        return width
      }
      try {
        const next = { ...defaults }
        for (const key of visibleOrderedColumns) {
          const column = columnByKey.get(key)
          if (!column) continue
          const cells = [
            header.querySelector<HTMLElement>(`[data-column-key="${key}"]`),
            ...rows.map((row) =>
              row.querySelector<HTMLElement>(`[data-column-key="${key}"]`)
            )
          ]
          const contentWidth = Math.max(0, ...cells.map(measure))
          next[key] = Math.max(
            column.minWidth,
            Math.min(COLUMN_MAX_WIDTH, Math.ceil(contentWidth + 20))
          )
        }
        setFitContentWidths((current) =>
          visibleOrderedColumns.every((key) => current[key] === next[key])
            ? current
            : next
        )
      } finally {
        probe.remove()
      }
    })
    return () => window.cancelAnimationFrame(frame)
  }, [
    columnByKey,
    defaults,
    headerSelector,
    measureKey,
    rowSelector,
    sizing,
    tableRef,
    visibleOrderedColumns
  ])

  useEffect(() => {
    if (!menuOpen) return
    const closeOnPointer = (event: PointerEvent): void => {
      if (event.target instanceof Node && menuRef.current?.contains(event.target)) {
        return
      }
      setMenuOpen(false)
    }
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setMenuOpen(false)
    }
    const close = (): void => setMenuOpen(false)
    document.addEventListener('pointerdown', closeOnPointer)
    document.addEventListener('keydown', closeOnEscape)
    window.addEventListener('blur', close)
    window.addEventListener('resize', close)
    return () => {
      document.removeEventListener('pointerdown', closeOnPointer)
      document.removeEventListener('keydown', closeOnEscape)
      window.removeEventListener('blur', close)
      window.removeEventListener('resize', close)
    }
  }, [menuOpen])

  useEffect(() => () => resizeCleanupRef.current?.(), [])

  function openMenu(event: React.MouseEvent<HTMLElement>): void {
    event.preventDefault()
    event.stopPropagation()
    const menuWidth = 224
    const menuHeight = 310
    setMenuPosition({
      left: Math.max(8, Math.min(event.clientX, window.innerWidth - menuWidth - 8)),
      top:
        event.clientY + menuHeight + 8 <= window.innerHeight
          ? event.clientY
          : Math.max(8, event.clientY - menuHeight)
    })
    setMenuOpen(true)
  }

  function chooseSizing(next: TableColumnSizing): void {
    setSizing(next)
    setMenuOpen(false)
  }

  function toggleColumn(key: Key): void {
    if (fixedKeys.includes(key)) return
    setVisibleColumns((current) => {
      const next = new Set(current)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  function moveColumn(source: Key, target: Key): void {
    if (source === target) return
    setColumnOrder((current) => {
      const from = current.indexOf(source)
      const to = current.indexOf(target)
      if (from < 0 || to < 0) return current
      const next = [...current]
      next.splice(from, 1)
      next.splice(to, 0, source)
      return next
    })
  }

  function beginResize(event: React.PointerEvent<HTMLSpanElement>, key: Key): void {
    if (event.button !== 0) return
    const column = columnByKey.get(key)
    const header = event.currentTarget.closest<HTMLElement>(headerSelector)
    if (!column || !header) return
    event.preventDefault()
    event.stopPropagation()
    setMenuOpen(false)
    const measured = { ...defaults }
    for (const cell of header.querySelectorAll<HTMLElement>(':scope > [data-column-key]')) {
      const cellKey = cell.dataset.columnKey as Key | undefined
      if (cellKey) measured[cellKey] = Math.round(cell.getBoundingClientRect().width)
    }
    const startX = event.clientX
    const startWidth = measured[key]
    setSizing('manual')
    setManualWidths(measured)
    resizeCleanupRef.current?.()
    document.body.classList.add('is-resizing-table-column')
    const onPointerMove = (moveEvent: PointerEvent): void => {
      const nextWidth = Math.max(
        column.minWidth,
        Math.min(COLUMN_MAX_WIDTH, startWidth + moveEvent.clientX - startX)
      )
      setManualWidths((current) => ({ ...current, [key]: nextWidth }))
    }
    const cleanup = (): void => {
      document.removeEventListener('pointermove', onPointerMove)
      document.removeEventListener('pointerup', cleanup)
      document.removeEventListener('pointercancel', cleanup)
      document.body.classList.remove('is-resizing-table-column')
      if (resizeCleanupRef.current === cleanup) resizeCleanupRef.current = null
    }
    resizeCleanupRef.current = cleanup
    document.addEventListener('pointermove', onPointerMove)
    document.addEventListener('pointerup', cleanup)
    document.addEventListener('pointercancel', cleanup)
  }

  function renderResizer(key: Key, label: string): React.JSX.Element {
    return (
      <span
        className="account-column-resizer log-column-resizer"
        role="separator"
        aria-orientation="vertical"
        aria-label={tr(`调整${label}列宽`, `Resize ${label} column`, `調整${label}欄寬`)}
        data-column-resizer
        onPointerDown={(event) => beginResize(event, key)}
      />
    )
  }

  const menu = menuOpen
    ? createPortal(
        <div
          className="account-column-menu log-column-menu"
          role="menu"
          aria-label={menuLabel}
          ref={menuRef}
          style={{ left: menuPosition.left, top: menuPosition.top }}
        >
          <span className="account-column-menu__label">
            {tr('列尺寸', 'Column sizing', '欄位尺寸')}
          </span>
          <button
            type="button"
            role="menuitemradio"
            aria-checked={sizing === 'content'}
            className={sizing === 'content' ? 'is-checked' : undefined}
            onClick={() => chooseSizing('content')}
          >
            <span className="account-column-menu__icon">
              <Maximize2 size={14} />
            </span>
            <span>{tr('适应内容', 'Fit content', '適應內容')}</span>
          </button>
          <button
            type="button"
            role="menuitemradio"
            aria-checked={sizing !== 'content'}
            className={sizing !== 'content' ? 'is-checked' : undefined}
            onClick={() => chooseSizing('window')}
          >
            <span className="account-column-menu__icon">
              <MoveHorizontal size={14} />
            </span>
            <span>{tr('适应窗口', 'Fit window', '適應視窗')}</span>
          </button>
          <div className="account-column-menu__divider" aria-hidden="true" />
          <span className="account-column-menu__label">
            {tr('显示列', 'Visible columns', '顯示欄位')}
          </span>
          {columnOrder.map((key) => {
            const column = columnByKey.get(key)
            if (!column) return null
            const checked = visibleColumns.has(key)
            return (
              <button
                type="button"
                role="menuitemcheckbox"
                aria-checked={checked}
                className={`${checked ? 'is-checked' : ''}${
                  draggedKey === key ? ' is-dragging' : ''
                }`}
                key={key}
                onClick={() => toggleColumn(key)}
                draggable
                onDragStart={(event) => {
                  event.dataTransfer.effectAllowed = 'move'
                  event.dataTransfer.setData('text/plain', key)
                  setDraggedKey(key)
                }}
                onDragEnd={() => setDraggedKey(null)}
                onDragOver={(event) => {
                  event.preventDefault()
                  event.dataTransfer.dropEffect = 'move'
                }}
                onDrop={(event) => {
                  event.preventDefault()
                  if (draggedKey) moveColumn(draggedKey, key)
                  setDraggedKey(null)
                }}
                title={tr(
                  '拖拽调整列顺序',
                  'Drag to reorder columns',
                  '拖曳調整欄位順序'
                )}
              >
                <span className="account-column-menu__drag" aria-hidden="true">
                  <GripVertical size={12} />
                </span>
                <span className="account-column-menu__check">
                  {checked && <Check size={12} />}
                </span>
                <span>{column.label}</span>
              </button>
            )
          })}
        </div>,
        document.body
      )
    : null

  return {
    visibleOrderedColumns,
    gridTemplateColumns,
    openMenu,
    renderResizer,
    menu
  }
}
