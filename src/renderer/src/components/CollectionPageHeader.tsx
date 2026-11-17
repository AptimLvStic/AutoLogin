import type { ReactNode } from 'react'

export function CollectionPageHeader({
  title,
  description,
  actions,
  tabs,
  filters,
  className = ''
}: {
  title: ReactNode
  description?: ReactNode
  actions?: ReactNode
  tabs: ReactNode
  filters: ReactNode
  className?: string
}): React.JSX.Element {
  return (
    <header className={`collection-page-header ${className}`.trim()}>
      <div className="collection-page-header__top">
        <div className="collection-page-header__heading">
          <h2>{title}</h2>
          {description ? <p>{description}</p> : null}
        </div>
        {actions ? <div className="collection-page-header__actions">{actions}</div> : null}
      </div>
      <div className="collection-page-header__tabs">{tabs}</div>
      <div className="collection-page-header__filters">{filters}</div>
    </header>
  )
}
