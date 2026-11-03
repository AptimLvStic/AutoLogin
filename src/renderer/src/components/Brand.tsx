import logoUrl from '../assets/app-logo.png'

export function BrandMark({ compact = false }: { compact?: boolean }): React.JSX.Element {
  return (
    <div className={`brand-lockup${compact ? ' brand-lockup--compact' : ''}`}>
      <img className="brand-mark brand-mark--image" src={logoUrl} alt="" aria-hidden="true" />
      <span className="brand-copy">
        <strong>AutoLogin</strong>
        {!compact && <small>LOCAL LOGIN DESK</small>}
      </span>
    </div>
  )
}
