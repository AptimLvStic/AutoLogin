import { useMemo, useState } from 'react'
import { ArrowRight, Check, Globe2, Layers3, LoaderCircle } from 'lucide-react'
import type { AccountWithSite, Site } from '@shared/types'
import { Modal } from './Modal'

interface SiteEntry {
  site: Site
  accountIds: string[]
}

export function BatchLoginModal({
  accounts,
  sites,
  onClose,
  onStart
}: {
  accounts: AccountWithSite[]
  sites: Site[]
  onClose: () => void
  onStart: (accountIds: string[]) => Promise<boolean>
}): React.JSX.Element {
  const [selectedSiteIds, setSelectedSiteIds] = useState<Set<string>>(() => new Set())
  const [busy, setBusy] = useState(false)

  const entries = useMemo<SiteEntry[]>(() => {
    const accountIdsBySite = new Map<string, string[]>()
    for (const account of accounts) {
      const current = accountIdsBySite.get(account.siteId) ?? []
      current.push(account.id)
      accountIdsBySite.set(account.siteId, current)
    }
    return sites.flatMap((site) => {
      const accountIds = accountIdsBySite.get(site.id)
      return accountIds?.length ? [{ site, accountIds }] : []
    })
  }, [accounts, sites])

  const groups = useMemo(() => {
    const grouped = new Map<string, SiteEntry[]>()
    for (const entry of entries) {
      const group = entry.site.group?.trim() || '未分组'
      const current = grouped.get(group) ?? []
      current.push(entry)
      grouped.set(group, current)
    }
    return [...grouped.entries()].sort(([left], [right]) => {
      if (left === '未分组') return 1
      if (right === '未分组') return -1
      return left.localeCompare(right, 'zh-CN')
    })
  }, [entries])

  const selectedAccounts = entries
    .filter((entry) => selectedSiteIds.has(entry.site.id))
    .reduce((count, entry) => count + entry.accountIds.length, 0)

  function toggleSite(siteId: string): void {
    setSelectedSiteIds((current) => {
      const next = new Set(current)
      if (next.has(siteId)) {
        next.delete(siteId)
      } else {
        next.add(siteId)
      }
      return next
    })
  }

  async function start(): Promise<void> {
    const accountIds = entries
      .filter((entry) => selectedSiteIds.has(entry.site.id))
      .flatMap((entry) => entry.accountIds)
    if (accountIds.length === 0) {
      return
    }
    setBusy(true)
    try {
      if (await onStart(accountIds)) {
        onClose()
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      title="批量打开站点"
      eyebrow="OPEN MULTIPLE SESSIONS"
      onClose={onClose}
      width="700px"
      className="batch-login-modal"
    >
      <div className="batch-picker">
        <div className="batch-picker__intro">
          <div>
            <h3>选择要打开的站点</h3>
            <p>所选账号会在同一浏览器窗口中按标签页并行打开，最多同时处理 3 个。</p>
            <p className="batch-picker__hint">
              同一站点的多个账号共享该窗口的 Cookie，请避免同时登录不同账号。
            </p>
          </div>
          <div className="batch-picker__quick-actions">
            <button
              type="button"
              className="text-button"
              onClick={() => setSelectedSiteIds(new Set(entries.map((entry) => entry.site.id)))}
            >
              全选
            </button>
            <button
              type="button"
              className="text-button"
              onClick={() => setSelectedSiteIds(new Set())}
            >
              清空
            </button>
          </div>
        </div>

        <div className="batch-picker__list">
          {groups.map(([group, groupEntries]) => (
            <section className="batch-picker__group" key={group}>
              <div className="batch-picker__group-heading">
                <Layers3 size={14} />
                <span>{group}</span>
                <small>{groupEntries.length}</small>
              </div>
              {groupEntries.map(({ site, accountIds }) => {
                const selected = selectedSiteIds.has(site.id)
                return (
                  <label
                    className={`batch-site-row${selected ? ' is-selected' : ''}`}
                    key={site.id}
                  >
                    <input
                      type="checkbox"
                      checked={selected}
                      onChange={() => toggleSite(site.id)}
                    />
                    <span className="batch-site-row__check" aria-hidden="true">
                      {selected && <Check size={13} />}
                    </span>
                    <span className="monogram monogram--small">
                      {site.name.slice(0, 1).toUpperCase()}
                    </span>
                    <span className="batch-site-row__identity">
                      <strong>{site.name}</strong>
                      <small>
                        <Globe2 size={12} />
                        {safeHostname(site.startUrl)}
                      </small>
                    </span>
                    <em>{accountIds.length} 个账号</em>
                  </label>
                )
              })}
            </section>
          ))}
        </div>

        <div className="batch-picker__footer">
          <span>
            已选 <strong>{selectedSiteIds.size}</strong> 个站点，<strong>{selectedAccounts}</strong>{' '}
            个账号
          </span>
          <div className="modal-actions">
            <button type="button" className="button button--ghost" onClick={onClose}>
              取消
            </button>
            <button
              type="button"
              className="button button--primary"
              onClick={() => void start()}
              disabled={busy || selectedSiteIds.size === 0}
            >
              {busy ? <LoaderCircle size={16} className="spin" /> : <ArrowRight size={16} />}
              {busy ? '正在打开…' : '打开所选站点'}
            </button>
          </div>
        </div>
      </div>
    </Modal>
  )
}

function safeHostname(value: string): string {
  try {
    return new URL(value).hostname.replace(/^www\./, '')
  } catch {
    return value
  }
}
