export function BrandMark({ compact = false }: { compact?: boolean }): React.JSX.Element {
  return (
    <div className={`brand-lockup${compact ? ' brand-lockup--compact' : ''}`}>
      <span className="brand-mark" aria-hidden="true">
        <span className="brand-mark__door" />
        <span className="brand-mark__path" />
      </span>
      <span className="brand-copy">
        <strong>AutoLogin</strong>
        {!compact && <small>LOCAL LOGIN DESK</small>}
      </span>
    </div>
  )
}
