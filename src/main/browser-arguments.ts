import type { ProxySettings } from '@shared/types'

/** Environment fallback so packaged deployments can pin intranet CAs. */
export const TRUSTED_SPKI_ENV = 'AUTOLOGIN_TLS_SPKI_LIST'

/** Base64 of a SHA-256 digest: 32 bytes -> 43 chars, with optional padding. */
const SPKI_PATTERN = /^[A-Za-z0-9+/]{40,50}={0,2}$/

export interface BrowserLaunchArgumentsInput {
  profileDirectory: string
  headless: boolean
  proxy?: ProxySettings
  initialUrl?: string
  /**
   * SHA-256 SPKI fingerprints (base64) of certificates allowed to bypass TLS
   * validation. Empty by default: every certificate is verified, so a MITM
   * proxy or a hijacked DNS answer cannot receive filled credentials.
   */
  trustedCertificateSpkiList?: string[]
}

/**
 * Normalises a comma/space separated fingerprint list. Invalid entries are
 * dropped rather than rejected: one typo must not silently downgrade TLS for
 * every site, so a malformed list simply falls back to strict verification.
 */
export function parseTrustedCertificateSpkiList(raw: string | undefined): string[] {
  if (!raw) {
    return []
  }
  const unique = new Set<string>()
  for (const entry of raw.split(/[,\s]+/)) {
    const value = entry.trim()
    if (value && SPKI_PATTERN.test(value)) {
      unique.add(value)
    }
  }
  return [...unique]
}

export function proxyArguments(proxy: ProxySettings | undefined): string[] {
  if (!proxy || proxy.mode === 'system' || !proxy.enabled || !proxy.host.trim()) {
    return []
  }
  const bypass = proxy.bypassList
    .split(/[;,]/)
    .map((entry) => entry.trim())
    .filter(Boolean)
    .join(';')
  return [
    `--proxy-server=${proxy.protocol}://${proxy.host.trim()}:${proxy.port}`,
    ...(bypass ? [`--proxy-bypass-list=${bypass}`] : [])
  ]
}

export function buildBrowserArguments(
  options: BrowserLaunchArgumentsInput,
  env: Record<string, string | undefined> = process.env
): string[] {
  const trusted = options.trustedCertificateSpkiList
    ? parseTrustedCertificateSpkiList(options.trustedCertificateSpkiList.join(','))
    : parseTrustedCertificateSpkiList(env[TRUSTED_SPKI_ENV])

  return [
    `--user-data-dir=${options.profileDirectory}`,
    '--remote-debugging-address=127.0.0.1',
    '--remote-debugging-port=0',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-background-mode',
    // Never pass the blanket --ignore-certificate-errors flag: it disables
    // verification for public sites too, and credentials are typed into pages.
    // Only explicitly pinned intranet certificates may bypass verification.
    ...(trusted.length ? [`--ignore-certificate-errors-spki-list=${trusted.join(',')}`] : []),
    ...proxyArguments(options.proxy),
    ...(options.headless
      ? [
          '--headless=new',
          '--disable-gpu',
          '--disable-background-timer-throttling',
          '--disable-backgrounding-occluded-windows',
          '--disable-renderer-backgrounding'
        ]
      : []),
    '--new-window',
    options.initialUrl ?? 'about:blank'
  ]
}
