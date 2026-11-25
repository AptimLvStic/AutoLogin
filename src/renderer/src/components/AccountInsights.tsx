import { useMemo, useState } from 'react'
import {
  ArrowUpRight,
  ChevronDown,
  Copy,
  Globe2,
  KeyRound,
  RefreshCw,
  ShieldCheck,
  Users
} from 'lucide-react'
import type { AccountWithSite } from '@shared/types'
import { useI18n } from '../i18n'
import { SiteMark } from './SiteMark'

interface AccountInsightsProps {
  accounts: AccountWithSite[]
  onOpenAccount: (account: AccountWithSite) => void
}

type InsightsTab = 'identity' | 'site' | 'password'

interface IdentityGroup {
  key: string
  username: string
  accounts: AccountWithSite[]
  sites: AccountWithSite[]
  lastUsed?: string
  sharesPassword: boolean
  recorded: number
}

interface SiteGroup {
  id: string
  site: AccountWithSite['site']
  accounts: AccountWithSite[]
}

function normalizeIdentity(username: string): string {
  const value = username.trim().toLocaleLowerCase()
  return value.includes('@') ? value.replace(/\+[^@]*@/, '@') : value
}

function daysSince(value?: string): number | null {
  if (!value) return null
  const time = new Date(value).getTime()
  if (Number.isNaN(time)) return null
  return Math.max(0, Math.floor((Date.now() - time) / 86_400_000))
}

function relativeDays(value: string | undefined, tr: (zh: string, en: string, tw: string) => string): string {
  const days = daysSince(value)
  if (days === null) return tr('从未使用', 'Never used', '從未使用')
  if (days === 0) return tr('今天使用', 'Used today', '今天使用')
  if (days === 1) return tr('昨天使用', 'Used yesterday', '昨天使用')
  if (days < 30) return tr(`${days} 天前使用`, `Used ${days} days ago`, `${days} 天前使用`)
  const months = Math.floor(days / 30)
  return tr(`${months} 个月前使用`, `Used ${months} months ago`, `${months} 個月前使用`)
}

function latest(...values: Array<string | undefined>): string | undefined {
  return values.filter((value): value is string => Boolean(value)).sort().at(-1)
}

export function AccountInsights({ accounts, onOpenAccount }: AccountInsightsProps): React.JSX.Element {
  const { tr } = useI18n()
  const [tab, setTab] = useState<InsightsTab>('identity')
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  const identities = useMemo<IdentityGroup[]>(() => {
    const map = new Map<string, AccountWithSite[]>()
    for (const account of accounts) {
      const key = normalizeIdentity(account.username)
      const list = map.get(key) ?? []
      list.push(account)
      map.set(key, list)
    }
    return [...map.entries()]
      .map(([key, list]) => {
        const siteMap = new Map<string, AccountWithSite>()
        for (const account of list) siteMap.set(account.site.id, account)
        return {
          key,
          username: key ? list[0]?.username ?? key : tr('（未填写用户名）', '(no username)', '（未填寫使用者名稱）'),
          accounts: list,
          sites: [...siteMap.values()],
          lastUsed: latest(...list.map((account) => account.lastUsedAt ?? account.updatedAt)),
          sharesPassword: list.some((account) => account.sharesPassword),
          recorded: list.filter((account) => Boolean(account.activeRecipeId || account.recipes?.length)).length
        }
      })
      .sort(
        (a, b) =>
          Number(b.sites.length > 1) - Number(a.sites.length > 1) ||
          b.sites.length - a.sites.length ||
          a.username.localeCompare(b.username)
      )
  }, [accounts, tr])

  const siteGroups = useMemo<SiteGroup[]>(() => {
    const map = new Map<string, SiteGroup>()
    for (const account of accounts) {
      const group = map.get(account.site.id) ?? {
        id: account.site.id,
        site: account.site,
        accounts: []
      }
      group.accounts.push(account)
      map.set(account.site.id, group)
    }
    return [...map.values()].sort(
      (a, b) => b.accounts.length - a.accounts.length || a.site.name.localeCompare(b.site.name)
    )
  }, [accounts])

  const reused = identities.filter((group) => group.sites.length > 1)
  const duplicateAccounts = accounts.filter((account) => account.sharesPassword)
  const recordedAccounts = accounts.filter(
    (account) => Boolean(account.activeRecipeId || account.recipes?.length)
  )
  const staleAccounts = accounts.filter((account) => (daysSince(account.updatedAt) ?? 0) >= 90)
  const siteCount = siteGroups.length

  function toggle(key: string): void {
    setExpanded((current) => {
      const next = new Set(current)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  function renderIdentity(group: IdentityGroup): React.JSX.Element {
    const open = expanded.has(group.key) || expanded.size === 0
    return (
      <article className={`insights-identity${open ? ' is-open' : ''}`} key={group.key || 'empty'}>
        <button type="button" className="insights-identity__head" onClick={() => toggle(group.key)} aria-expanded={open}>
          <span className="insights-avatar">{group.username.slice(0, 1).toLocaleUpperCase()}</span>
          <span className="insights-identity__title">
            <strong>{group.username}</strong>
            <small>
              {group.sites.length > 1
                ? tr(
                    `复用身份 · ${group.sites.length} 个站点`,
                    `Shared identity · ${group.sites.length} sites`,
                    `重用身分 · ${group.sites.length} 個站點`
                  )
                : tr('单一站点', 'Single site', '單一站點')}
              {' · '}
              {relativeDays(group.lastUsed, tr)}
            </small>
          </span>
          <span className="insights-identity__badges">
            {group.recorded > 0 && (
              <span className="insights-badge">
                {tr(`已录入 ${group.recorded}`, `${group.recorded} recorded`, `已錄入 ${group.recorded}`)}
              </span>
            )}
            {group.sharesPassword && (
              <span className="insights-badge is-warning">
                {tr('密码重复', 'Password reused', '密碼重複')}
              </span>
            )}
            {!group.username.includes('@') && (
              <span className="insights-badge is-muted">
                {tr('无邮箱', 'No email', '無電子郵件')}
              </span>
            )}
          </span>
          <ChevronDown size={15} className="insights-identity__chevron" />
        </button>
        {open && (
          <div className="insights-identity__sites">
            {group.accounts.map((account) => (
              <button
                type="button"
                className="insights-site"
                key={account.id}
                onClick={() => onOpenAccount(account)}
              >
                <SiteMark site={account.site} />
                <span className="insights-site__name">
                  <strong>{account.site.name}</strong>
                  {account.label &&
                    account.label.trim().toLocaleLowerCase() !==
                      account.site.name.trim().toLocaleLowerCase() && (
                      <small>{account.label}</small>
                    )}
                </span>
                <span className="insights-site__meta">
                  {account.hasOtp && (
                    <span className="insights-badge is-quiet">
                      <ShieldCheck size={11} />
                      OTP
                    </span>
                  )}
                  <span>{account.site.group || tr('未分组', 'Ungrouped', '未分組')}</span>
                  <ArrowUpRight size={13} />
                </span>
              </button>
            ))}
          </div>
        )}
      </article>
    )
  }

  return (
    <section className="page-section account-insights">
      <header className="account-insights__header">
        <div>
          <p className="eyebrow">{tr('账号统计', 'Account insights', '帳號統計')}</p>
          <h2>{tr('我在哪些站点用了同一个身份', 'Where each identity is used', '我在哪些站點用了同一個身分')}</h2>
          <p className="account-insights__lede">
            {tr(
              `${accounts.length} 个账号 · ${siteCount} 个站点 · ${reused.length} 个身份被多个站点共用`,
              `${accounts.length} accounts · ${siteCount} sites · ${reused.length} identities shared across sites`,
              `${accounts.length} 個帳號 · ${siteCount} 個站點 · ${reused.length} 個身分被多個站點共用`
            )}
          </p>
        </div>
        <div className="segmented-control insights-tabs" role="tablist" aria-label={tr('统计视角', 'Grouping', '統計視角')}>
          <button type="button" role="tab" aria-selected={tab === 'identity'} className={tab === 'identity' ? 'is-active' : ''} onClick={() => setTab('identity')}>
            {tr('按身份', 'By identity', '按身分')}
          </button>
          <button type="button" role="tab" aria-selected={tab === 'site'} className={tab === 'site' ? 'is-active' : ''} onClick={() => setTab('site')}>
            {tr('按站点', 'By site', '按站點')}
          </button>
          <button type="button" role="tab" aria-selected={tab === 'password'} className={tab === 'password' ? 'is-active' : ''} onClick={() => setTab('password')}>
            {tr('重复密码', 'Reused passwords', '重複密碼')}
          </button>
        </div>
      </header>

      <div className="account-insights__stats">
        <article>
          <Users size={16} />
          <strong>{reused.length}</strong>
          <span>{tr('复用身份', 'Shared identities', '重用身分')}</span>
          <small>{tr('一个用户名 ≥ 2 个站点', 'One username on 2+ sites', '一個使用者名稱 ≥ 2 個站點')}</small>
        </article>
        <article>
          <KeyRound size={16} />
          <strong>{recordedAccounts.length}</strong>
          <span>{tr('已录入流程', 'Recorded flows', '已錄入流程')}</span>
          <small>
            {tr(
              `覆盖率 ${accounts.length ? Math.round((recordedAccounts.length / accounts.length) * 100) : 0}%`,
              `Coverage ${accounts.length ? Math.round((recordedAccounts.length / accounts.length) * 100) : 0}%`,
              `覆蓋率 ${accounts.length ? Math.round((recordedAccounts.length / accounts.length) * 100) : 0}%`
            )}
          </small>
        </article>
        <article>
          <Copy size={16} />
          <strong>{duplicateAccounts.length}</strong>
          <span>{tr('重复密码', 'Reused passwords', '重複密碼')}</span>
          <small>{tr('建议逐个更换', 'Worth rotating', '建議逐個更換')}</small>
        </article>
        <article>
          <RefreshCw size={16} />
          <strong>{staleAccounts.length}</strong>
          <span>{tr('90 天未更新', 'Stale 90+ days', '90 天未更新')}</span>
          <small>{tr('密码可能已过期', 'Password may be stale', '密碼可能已過期')}</small>
        </article>
      </div>

      {tab === 'identity' && (
        <div className="insights-list">
          {identities.length === 0 ? (
            <p className="empty-hint">{tr('还没有账号。', 'No accounts yet.', '還沒有帳號。')}</p>
          ) : (
            identities.map(renderIdentity)
          )}
        </div>
      )}

      {tab === 'site' && (
        <div className="insights-list">
          {siteGroups.map((group) => (
            <article className="insights-identity is-open" key={group.id}>
              <div className="insights-identity__head is-static">
                <SiteMark site={group.site} />
                <span className="insights-identity__title">
                  <strong>{group.site.name}</strong>
                  <small>{group.site.group || tr('未分组', 'Ungrouped', '未分組')}</small>
                </span>
                <span className="insights-identity__badges">
                  <span className="insights-badge">
                    {tr(`${group.accounts.length} 个账号`, `${group.accounts.length} accounts`, `${group.accounts.length} 個帳號`)}
                  </span>
                </span>
              </div>
              <div className="insights-identity__sites">
                {group.accounts.map((account) => (
                  <button type="button" className="insights-site" key={account.id} onClick={() => onOpenAccount(account)}>
                    <Globe2 size={14} />
                    <span className="insights-site__name">
                      <strong>{account.username || tr('未填写用户名', 'No username', '未填寫使用者名稱')}</strong>
                      <small>{account.label || tr('未命名账号', 'Unnamed account', '未命名帳號')}</small>
                    </span>
                    <span className="insights-site__meta">
                      {account.hasOtp && (
                        <span className="insights-badge is-quiet">
                          <ShieldCheck size={11} />
                          OTP
                        </span>
                      )}
                      <ArrowUpRight size={13} />
                    </span>
                  </button>
                ))}
              </div>
            </article>
          ))}
        </div>
      )}

      {tab === 'password' && (
        <div className="insights-list">
          {duplicateAccounts.length === 0 ? (
            <p className="empty-hint">
              {tr('没有发现重复密码。', 'No reused passwords found.', '沒有發現重複密碼。')}
            </p>
          ) : (
            <div className="insights-password-grid">
              {duplicateAccounts.map((account) => (
                <button type="button" className="insights-password" key={account.id} onClick={() => onOpenAccount(account)}>
                  <SiteMark site={account.site} />
                  <span>
                    <strong>{account.username || tr('未填写用户名', 'No username', '未填寫使用者名稱')}</strong>
                    <small>{account.site.name}</small>
                  </span>
                  <span className="insights-badge is-warning">{tr('重复', 'Reused', '重複')}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      <p className="account-insights__note">
        {tr(
          '用户名相同时才归为同一身份，不区分大小写；邮箱会忽略 + 后缀，纯用户名单独归组。',
          'Identities match on username, case-insensitively; email + suffixes are ignored, bare usernames stay separate.',
          '使用者名稱相同才歸為同一身分，不分大小寫；電子郵件會忽略 + 後綴，純使用者名稱單獨歸組。'
        )}
      </p>
    </section>
  )
}
