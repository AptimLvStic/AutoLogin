import { useEffect, useId, useRef, useState } from 'react'
import {
  CalendarDays,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight
} from 'lucide-react'
import { useI18n } from '../i18n'

export type LogDateRangePreset =
  | 'all'
  | 'last7'
  | 'last30'
  | 'last90'
  | 'last180'
  | 'custom'

export interface LogDateRange {
  preset: LogDateRangePreset
  start: string
  end: string
}

export function emptyLogDateRange(): LogDateRange {
  return { preset: 'all', start: '', end: '' }
}

const PRESET_DAYS: Partial<Record<LogDateRangePreset, number>> = {
  last7: 7,
  last30: 30,
  last90: 90,
  last180: 180
}

export function matchesLogDateRange(
  timestamp: string,
  range: LogDateRange,
  now = new Date()
): boolean {
  if (range.preset === 'all') return true
  const date = new Date(timestamp)
  if (Number.isNaN(date.getTime())) return false
  const key = localDateKey(date)

  if (range.preset === 'custom') {
    if (!range.start && !range.end) return true
    if (range.start && key < range.start) return false
    if (range.end && key > range.end) return false
    return true
  }

  const days = PRESET_DAYS[range.preset]
  if (!days) return true
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - (days - 1))
  return key >= localDateKey(start) && key <= localDateKey(now)
}

export function LogDateFilter({
  value,
  onChange
}: {
  value: LogDateRange
  onChange: (value: LogDateRange) => void
}): React.JSX.Element {
  const { tr } = useI18n()
  const [open, setOpen] = useState(false)
  const [showCustom, setShowCustom] = useState(value.preset === 'custom')
  const [customStart, setCustomStart] = useState(value.start)
  const [customEnd, setCustomEnd] = useState(value.end)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    setShowCustom(value.preset === 'custom')
    setCustomStart(value.start)
    setCustomEnd(value.end)
  }, [open, value.end, value.preset, value.start])

  useEffect(() => {
    if (!open) return
    const closeOnPointer = (event: PointerEvent): void => {
      if (
        event.target instanceof Node &&
        containerRef.current?.contains(event.target)
      ) {
        return
      }
      setOpen(false)
    }
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setOpen(false)
    }
    const close = (): void => setOpen(false)
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
  }, [open])

  const label = dateRangeLabel(value, tr)
  const customInvalid = customRangeInvalid(customStart, customEnd)

  function choosePreset(preset: Exclude<LogDateRangePreset, 'custom'>): void {
    onChange({ preset, start: '', end: '' })
    setOpen(false)
  }

  function applyCustom(): void {
    if (customInvalid) return
    onChange({ preset: 'custom', start: customStart, end: customEnd })
    setOpen(false)
  }

  return (
    <div className="log-date-filter" ref={containerRef}>
      <button
        type="button"
        className="collection-filter-control filter-control log-date-filter__trigger"
        aria-label={tr('筛选日期', 'Filter date', '篩選日期')}
        aria-haspopup="menu"
        aria-expanded={open}
        title={label}
        onClick={() => setOpen((current) => !current)}
      >
        <CalendarDays size={15} aria-hidden="true" />
        <span>{label}</span>
        <ChevronDown size={14} aria-hidden="true" />
      </button>
      {open ? (
        <div
          className="log-date-filter__popover"
          role="menu"
          aria-label={tr('日期范围', 'Date range', '日期範圍')}
        >
          <span className="log-date-filter__label">
            {tr('快捷范围', 'Quick ranges', '快速範圍')}
          </span>
          {[
            ['all', tr('全部日期', 'All dates', '全部日期')],
            ['last7', tr('近 7 天', 'Last 7 days', '近 7 天')],
            ['last30', tr('近 30 天', 'Last 30 days', '近 30 天')],
            ['last90', tr('近 90 天', 'Last 90 days', '近 90 天')],
            ['last180', tr('近 180 天', 'Last 180 days', '近 180 天')]
          ].map(([preset, optionLabel]) => {
            const selected = value.preset === preset
            return (
              <button
                key={preset}
                type="button"
                role="menuitemradio"
                aria-checked={selected}
                className={selected ? 'is-selected' : undefined}
                onClick={() =>
                  choosePreset(
                    preset as Exclude<LogDateRangePreset, 'custom'>
                  )
                }
              >
                <span>{optionLabel}</span>
                {selected ? <Check size={14} /> : null}
              </button>
            )
          })}
          <div className="log-date-filter__divider" aria-hidden="true" />
          <button
            type="button"
            role="menuitemradio"
            aria-checked={value.preset === 'custom'}
            className={`${value.preset === 'custom' ? 'is-selected' : ''}${
              showCustom ? ' is-expanded' : ''
            }`.trim()}
            onClick={() => {
              setShowCustom(true)
              setCustomStart(value.preset === 'custom' ? value.start : '')
              setCustomEnd(value.preset === 'custom' ? value.end : '')
            }}
          >
            <span>{tr('自定义范围', 'Custom range', '自訂範圍')}</span>
            <ChevronDown size={14} className={showCustom ? 'is-open' : undefined} />
          </button>
          {showCustom ? (
            <div className="log-date-filter__custom">
              <div className="log-date-filter__custom-field">
                <span>{tr('开始日期', 'Start date', '開始日期')}</span>
                <CollectionDateField
                  value={customStart}
                  max={customEnd || undefined}
                  ariaLabel={tr('开始日期', 'Start date', '開始日期')}
                  onChange={setCustomStart}
                />
              </div>
              <div className="log-date-filter__custom-field">
                <span>{tr('结束日期', 'End date', '結束日期')}</span>
                <CollectionDateField
                  value={customEnd}
                  min={customStart || undefined}
                  ariaLabel={tr('结束日期', 'End date', '結束日期')}
                  align="end"
                  onChange={setCustomEnd}
                />
              </div>
              <div className="log-date-filter__actions">
                <button
                  type="button"
                  className="button button--ghost button--small"
                  onClick={() => setOpen(false)}
                >
                  {tr('取消', 'Cancel', '取消')}
                </button>
                <button
                  type="button"
                  className="button button--primary button--small"
                  disabled={customInvalid}
                  onClick={applyCustom}
                >
                  {tr('应用', 'Apply', '套用')}
                </button>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

function CollectionDateField({
  value,
  min,
  max,
  ariaLabel,
  align = 'start',
  onChange
}: {
  value: string
  min?: string
  max?: string
  ariaLabel: string
  align?: 'start' | 'end'
  onChange: (value: string) => void
}): React.JSX.Element {
  const { tr, language } = useI18n()
  const [open, setOpen] = useState(false)
  const [viewMonth, setViewMonth] = useState(() =>
    startOfMonth(parseDateKey(value) ?? new Date())
  )
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const dialogId = useId()

  useEffect(() => {
    if (!open) return
    setViewMonth(startOfMonth(parseDateKey(value) ?? new Date()))
    const closeOnPointer = (event: PointerEvent): void => {
      if (
        event.target instanceof Node &&
        rootRef.current?.contains(event.target)
      ) {
        return
      }
      setOpen(false)
    }
    const close = (): void => setOpen(false)
    document.addEventListener('pointerdown', closeOnPointer)
    window.addEventListener('blur', close)
    window.addEventListener('resize', close)
    return () => {
      document.removeEventListener('pointerdown', closeOnPointer)
      window.removeEventListener('blur', close)
      window.removeEventListener('resize', close)
    }
  }, [open, value])

  const days = calendarDays(viewMonth)
  const today = localDateKey(new Date())
  const monthLabel = new Intl.DateTimeFormat(language, {
    year: 'numeric',
    month: 'long'
  }).format(viewMonth)
  const weekdayLabels = Array.from({ length: 7 }, (_, index) =>
    new Intl.DateTimeFormat(language, { weekday: 'narrow' }).format(
      new Date(2024, 0, 7 + index)
    )
  )

  function selectDate(dateKey: string): void {
    onChange(dateKey)
    setOpen(false)
    window.requestAnimationFrame(() => triggerRef.current?.focus())
  }

  return (
    <div
      ref={rootRef}
      className={`log-date-filter__date-field is-${align}`}
    >
      <button
        ref={triggerRef}
        type="button"
        className={`filter-control log-date-filter__date-trigger${
          value ? ' has-value' : ''
        }`}
        aria-label={ariaLabel}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? dialogId : undefined}
        onClick={() => setOpen((current) => !current)}
      >
        <span>{value || tr('选择日期', 'Select date', '選擇日期')}</span>
        <CalendarDays size={14} aria-hidden="true" />
      </button>
      {open ? (
        <div
          id={dialogId}
          className="log-date-filter__calendar"
          role="dialog"
          aria-label={ariaLabel}
        >
          <div className="log-date-filter__calendar-header">
            <button
              type="button"
              aria-label={tr('上个月', 'Previous month', '上個月')}
              onClick={() =>
                setViewMonth(
                  new Date(
                    viewMonth.getFullYear(),
                    viewMonth.getMonth() - 1,
                    1
                  )
                )
              }
            >
              <ChevronLeft size={15} />
            </button>
            <strong>{monthLabel}</strong>
            <button
              type="button"
              aria-label={tr('下个月', 'Next month', '下個月')}
              onClick={() =>
                setViewMonth(
                  new Date(
                    viewMonth.getFullYear(),
                    viewMonth.getMonth() + 1,
                    1
                  )
                )
              }
            >
              <ChevronRight size={15} />
            </button>
          </div>
          <div className="log-date-filter__weekdays" aria-hidden="true">
            {weekdayLabels.map((weekday, index) => (
              <span key={`${weekday}-${index}`}>{weekday}</span>
            ))}
          </div>
          <div className="log-date-filter__day-grid">
            {days.map((day) => {
              const dateKey = localDateKey(day)
              const disabled = !dateInRange(dateKey, min, max)
              const outside = day.getMonth() !== viewMonth.getMonth()
              return (
                <button
                  key={dateKey}
                  type="button"
                  data-date={dateKey}
                  className={`${outside ? 'is-outside' : ''}${
                    dateKey === today ? ' is-today' : ''
                  }${dateKey === value ? ' is-selected' : ''}`.trim()}
                  disabled={disabled}
                  aria-label={new Intl.DateTimeFormat(language, {
                    dateStyle: 'medium'
                  }).format(day)}
                  aria-pressed={dateKey === value}
                  onClick={() => selectDate(dateKey)}
                >
                  {day.getDate()}
                </button>
              )
            })}
          </div>
          <div className="log-date-filter__calendar-actions">
            <button
              type="button"
              disabled={!value}
              onClick={() => selectDate('')}
            >
              {tr('清除', 'Clear', '清除')}
            </button>
            <button
              type="button"
              disabled={!dateInRange(today, min, max)}
              onClick={() => selectDate(today)}
            >
              {tr('今天', 'Today', '今天')}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  )
}

function localDateKey(date: Date): string {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0')
  ].join('-')
}

function parseDateKey(value: string): Date | null {
  if (!value) return null
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) return null
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const date = new Date(year, month - 1, day)
  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    return null
  }
  return date
}

function startOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1)
}

function calendarDays(month: Date): Date[] {
  const first = new Date(month.getFullYear(), month.getMonth(), 1)
  const start = new Date(
    month.getFullYear(),
    month.getMonth(),
    1 - first.getDay()
  )
  return Array.from(
    { length: 42 },
    (_, index) =>
      new Date(start.getFullYear(), start.getMonth(), start.getDate() + index)
  )
}

function dateInRange(value: string, min?: string, max?: string): boolean {
  if (!parseDateKey(value)) return false
  if (min && value < min) return false
  if (max && value > max) return false
  return true
}

function customRangeInvalid(start: string, end: string): boolean {
  if (!start && !end) return true
  if (start && !parseDateKey(start)) return true
  if (end && !parseDateKey(end)) return true
  return Boolean(start && end && start > end)
}

function shortDate(value: string): string {
  return value ? value.slice(5).replace('-', '/') : ''
}

function dateRangeLabel(
  value: LogDateRange,
  tr: (zhCN: string, en: string, zhTW: string) => string
): string {
  if (value.preset === 'last7') return tr('近 7 天', 'Last 7 days', '近 7 天')
  if (value.preset === 'last30') return tr('近 30 天', 'Last 30 days', '近 30 天')
  if (value.preset === 'last90') return tr('近 90 天', 'Last 90 days', '近 90 天')
  if (value.preset === 'last180') return tr('近 180 天', 'Last 180 days', '近 180 天')
  if (value.preset === 'custom') {
    const start = shortDate(value.start)
    const end = shortDate(value.end)
    if (start && end) return `${start}–${end}`
    if (start) return `${start}–`
    if (end) return `–${end}`
  }
  return tr('全部日期', 'All dates', '全部日期')
}
