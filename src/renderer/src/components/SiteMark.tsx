import type { Site } from '@shared/types'

type SiteMarkSite = Pick<Site, 'id' | 'name' | 'icon'>

export function SiteMark({
  site,
  className = ''
}: {
  site: SiteMarkSite
  className?: string
}): React.JSX.Element {
  return (
    <span
      className={`monogram ${toneClass(site.id)}${site.icon ? ' monogram--image' : ''}${
        className ? ` ${className}` : ''
      }`}
    >
      {site.icon ? (
        <img src={site.icon} alt="" draggable={false} />
      ) : (
        (site.name.trim().slice(0, 1) || '?').toUpperCase()
      )}
    </span>
  )
}

function toneClass(id: string): string {
  let hash = 0
  for (const character of id) {
    hash = (hash * 31 + character.charCodeAt(0)) | 0
  }
  return `monogram--tone-${Math.abs(hash) % 4}`
}
