import { readFile, stat } from 'node:fs/promises'
import { basename } from 'node:path'
import { randomUUID } from 'node:crypto'
import { parse } from 'csv-parse/sync'
import {
  Consts,
  CryptoEngine,
  Kdbx,
  KdbxCredentials,
  KdbxEntry,
  KdbxGroup,
  ProtectedValue
} from 'kdbxweb'
import { argon2d, argon2id } from 'hash-wasm'
import { DEFAULT_ACCOUNT_TAB_ID, GROUP_PATH_SEPARATOR } from '@shared/types'
import type {
  AccountTab,
  AccountTabSource,
  DataImportResult,
  GroupDefinition,
  Site,
  StoredAccount,
  VaultData
} from '@shared/types'

const MAX_IMPORT_BYTES = 50 * 1024 * 1024
const MAX_IMPORT_ROWS = 1_000

export const CSV_TEMPLATE_HEADERS = [
  'siteName',
  'startUrl',
  'siteGroup',
  'username',
  'password',
  'autoSubmit',
  'favorite'
] as const

export const CSV_TEMPLATE = [
  '# AutoLogin CSV 导入模板',
  '# 必填列：siteName（站点名称）、startUrl（http/https 登录地址）、username（用户名）、password（密码）',
  '# 可选列：siteGroup（分组，多级用 " / " 分隔）、autoSubmit（true/false）、favorite（true/false）',
  '# 每一行代表一个账号；以 # 开头的行会被忽略。',
  CSV_TEMPLATE_HEADERS.join(','),
  '"示例站点","https://example.com/login","工作","name@example.com","replace-me","true","false"'
].join('\r\n')

export interface ImportedLoginCandidate {
  siteName: string
  startUrl: string
  siteGroup?: string
  username: string
  password: string
  autoSubmit: boolean
  favorite: boolean
  rowNumber: number
}

export interface ParsedImport {
  candidates: ImportedLoginCandidate[]
  warnings: string[]
  skipped: number
}

let argon2Configured = false

export async function parseCsvImport(path: string): Promise<ParsedImport> {
  const buffer = await readBoundedFile(path)
  const text = decodeCsvBuffer(buffer)
  let records: Record<string, string>[]

  try {
    records = parse(text, {
      bom: true,
      comment: '#',
      columns: (header: string[]) =>
        header.map((value) => value.trim().replace(/^\uFEFF/, '')),
      skip_empty_lines: true,
      trim: true,
      relax_column_count: false,
      relax_quotes: false
    }) as Record<string, string>[]
  } catch (error) {
    throw new Error(
      `CSV 格式无效：${error instanceof Error ? error.message : '无法解析文件'}`
    )
  }

  if (records.length === 0) {
    throw new Error('CSV 文件没有可导入的数据行')
  }
  if (records.length > MAX_IMPORT_ROWS) {
    throw new Error(`单次最多导入 ${MAX_IMPORT_ROWS} 行账号`)
  }

  const headers = new Set(Object.keys(records[0] ?? {}))
  const missing = ['siteName', 'startUrl', 'username', 'password'].filter(
    (header) => !headers.has(header)
  )
  if (missing.length > 0) {
    throw new Error(`CSV 缺少必要列：${missing.join(', ')}`)
  }

  const candidates: ImportedLoginCandidate[] = []
  const warnings: string[] = []
  let skipped = 0

  records.forEach((record, index) => {
    const rowNumber = index + 2
    const siteName = clean(record.siteName)
    const rawUrl = clean(record.startUrl)
    const username = clean(record.username)
    const password = record.password ?? ''

    if (!siteName && !rawUrl && !username && !password) {
      return
    }
    const reason = validateCandidateFields(siteName, rawUrl, username, password)
    if (reason) {
      skipped += 1
      warnings.push(`第 ${rowNumber} 行已跳过：${reason}`)
      return
    }

    candidates.push({
      siteName,
      startUrl: normalizeImportUrl(rawUrl),
      siteGroup: optionalGroup(record.siteGroup),
      username,
      password,
      autoSubmit: parseBoolean(record.autoSubmit, true),
      favorite: parseBoolean(record.favorite, false),
      rowNumber
    })
  })

  if (candidates.length === 0) {
    throw new Error(warnings[0] ?? 'CSV 中没有可导入的有效账号')
  }
  return { candidates, warnings, skipped }
}

export async function parseKdbxImport(
  path: string,
  password: string
): Promise<ParsedImport> {
  configureKdbxArgon2()
  const buffer = await readBoundedFile(path)
  const credentials = new KdbxCredentials(ProtectedValue.fromString(password))
  await credentials.ready

  let database: Kdbx
  try {
    database = await Kdbx.load(toArrayBuffer(buffer), credentials)
  } catch {
    throw new Error('无法解密此 KeePassXC 数据库，请检查主密码或数据库是否损坏')
  }

  const candidates: ImportedLoginCandidate[] = []
  const warnings: string[] = []
  let skipped = 0
  let rowNumber = 1

  const visit = (group: KdbxGroup): void => {
    if (
      group.uuid.equals(database.meta.recycleBinUuid) ||
      group.name?.toLocaleLowerCase() === 'recycle bin'
    ) {
      return
    }

    for (const entry of group.entries) {
      rowNumber += 1
      if (candidates.length >= MAX_IMPORT_ROWS) {
        throw new Error(`单次最多导入 ${MAX_IMPORT_ROWS} 条 KeePassXC 记录`)
      }
      const candidate = kdbxEntryToCandidate(entry, group, rowNumber)
      if (candidate.kind === 'skip') {
        skipped += 1
        warnings.push(candidate.warning)
      } else {
        candidates.push(candidate.value)
      }
    }
    for (const child of group.groups) {
      visit(child)
    }
  }

  for (const root of database.groups) {
    visit(root)
  }

  if (candidates.length === 0) {
    throw new Error(
      warnings[0] ?? 'KeePassXC 数据库中没有包含有效网址、用户名和密码的登录记录'
    )
  }
  return { candidates, warnings, skipped }
}

export async function parseBookmarksImport(path: string): Promise<ParsedImport> {
  const buffer = await readBoundedFile(path)
  const text = decodeCsvBuffer(buffer)
  if (!/<DL\b/i.test(text)) {
    throw new Error('文件不是可识别的浏览器书签 HTML')
  }

  const candidates: ImportedLoginCandidate[] = []
  const warnings: string[] = []
  const folders: string[] = []
  let skipped = 0
  let rowNumber = 0
  const tokenPattern =
    /<H3\b[^>]*>([\s\S]*?)<\/H3>|<A\b[^>]*\bhref\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/A>|<\/DL\s*>/gi

  for (const match of text.matchAll(tokenPattern)) {
    rowNumber += 1
    if (match[1] !== undefined) {
      const folder = sanitizeBookmarkText(match[1])
      if (folder) folders.push(folder)
      continue
    }
    if (match[0].toLocaleLowerCase().startsWith('</dl')) {
      if (folders.length > 0) folders.pop()
      continue
    }

    if (candidates.length >= MAX_IMPORT_ROWS) {
      throw new Error(`单次最多导入 ${MAX_IMPORT_ROWS} 个浏览器书签`)
    }
    const rawUrl = match[2]?.trim() ?? ''
    if (!isValidImportUrl(rawUrl)) {
      skipped += 1
      warnings.push(`第 ${rowNumber} 个书签已跳过：网址不是有效的 http/https 地址`)
      continue
    }
    const title = sanitizeBookmarkText(match[3] ?? '').slice(0, 80)
    const siteName = (title || hostnameOf(rawUrl)).slice(0, 80)
    const siteGroup = folders
      .map((folder) => folder.slice(0, 20))
      .filter(Boolean)
      .join(GROUP_PATH_SEPARATOR)
      .slice(0, 80)
    candidates.push({
      siteName,
      startUrl: normalizeImportUrl(rawUrl),
      siteGroup: siteGroup || undefined,
      username: '',
      password: '',
      autoSubmit: true,
      favorite: false,
      rowNumber
    })
  }

  if (candidates.length === 0) {
    throw new Error(warnings[0] ?? '浏览器书签文件中没有可导入的网站')
  }
  return { candidates, warnings, skipped }
}

export function mergeImportedLogins(
  vaultData: VaultData,
  source: Exclude<AccountTabSource, 'local'>,
  parsed: ParsedImport,
  tabId = DEFAULT_ACCOUNT_TAB_ID
): { data: VaultData; result: DataImportResult } {
  const data = structuredClone(vaultData)
  const warnings = [...parsed.warnings]
  let skipped = parsed.skipped
  let sitesCreated = 0
  let accountsCreated = 0
  const now = new Date().toISOString()

  const sitesByName = new Map(
    data.sites
      .filter((site) => site.tabId === tabId)
      .map((site) => [normalizeSiteName(site.name), site] as const)
  )
  const tab = data.tabs.find((entry) => entry.id === tabId)
  if (!tab) throw new Error('导入目标标签页不存在')

  for (const candidate of parsed.candidates) {
    const normalizedName = normalizeSiteName(candidate.siteName)
    let site = sitesByName.get(normalizedName)
    if (site) {
      if (normalizeUrlForCompare(site.startUrl) !== normalizeUrlForCompare(candidate.startUrl)) {
        throw new Error(
          `第 ${candidate.rowNumber} 条记录与已有站点“${site.name}”的登录地址不一致`
        )
      }
    } else {
      site = {
        id: randomUUID(),
        tabId,
        name: candidate.siteName,
        startUrl: candidate.startUrl,
        allowedOrigins: [new URL(candidate.startUrl).origin],
        autoSubmit: candidate.autoSubmit,
        group: candidate.siteGroup,
        createdAt: now,
        updatedAt: now
      }
      data.sites.push(site)
      sitesByName.set(normalizedName, site)
      sitesCreated += 1
    }

    const duplicate = data.accounts.some(
      (account) =>
        account.tabId === tabId &&
        account.siteId === site.id &&
        account.username.trim().toLocaleLowerCase() ===
          candidate.username.toLocaleLowerCase()
    )
    if (duplicate) {
      skipped += 1
      warnings.push(
        `第 ${candidate.rowNumber} 条记录已跳过：站点“${site.name}”已存在相同用户名的账号`
      )
      continue
    }

    const account: StoredAccount = {
      id: randomUUID(),
      tabId,
      siteId: site.id,
      label: site.name,
      username: candidate.username,
      password: candidate.password,
      favorite: candidate.favorite,
      loginStrategy: 'auto',
      sortOrder: data.accounts.filter((entry) => entry.tabId === tabId).length,
      createdAt: now,
      updatedAt: now
    }
    data.accounts.push(account)
    accountsCreated += 1
  }

  ensureImportedGroups(data, tabId, now)

  return {
    data,
    result: {
      source,
      tabId,
      tabName: tab.name,
      sitesCreated,
      accountsCreated,
      skipped,
      warnings: warnings.slice(0, 30)
    }
  }
}

export function serializeTabCsv(data: VaultData, tabId: string): string {
  const tab = data.tabs.find((entry) => entry.id === tabId)
  if (!tab) throw new Error('导出标签页不存在')
  const sites = new Map(
    data.sites
      .filter((site) => site.tabId === tabId)
      .map((site) => [site.id, site] as const)
  )
  const rows = data.accounts
    .filter((account) => account.tabId === tabId)
    .sort((left, right) => (left.sortOrder ?? 0) - (right.sortOrder ?? 0))
    .map((account) => {
      const site = sites.get(account.siteId)
      if (!site) return null
      return [
        site.name,
        site.startUrl,
        site.group ?? '',
        account.username,
        account.password,
        String(site.autoSubmit),
        String(account.favorite)
      ]
        .map(escapeCsvCell)
        .join(',')
    })
    .filter((row): row is string => row !== null)

  return `\uFEFF${[CSV_TEMPLATE_HEADERS.join(','), ...rows].join('\r\n')}\r\n`
}

export async function serializeTabKdbx(
  data: VaultData,
  tabId: string,
  password: string
): Promise<ArrayBuffer> {
  const tab = data.tabs.find((entry) => entry.id === tabId)
  if (!tab) throw new Error('导出标签页不存在')
  const sites = new Map(
    data.sites
      .filter((site) => site.tabId === tabId)
      .map((site) => [site.id, site] as const)
  )
  configureKdbxArgon2()
  const credentials = new KdbxCredentials(ProtectedValue.fromString(password))
  await credentials.ready
  const database = Kdbx.create(credentials, tab.name)
  database.setKdf(Consts.KdfId.Argon2id)
  const root = database.getDefaultGroup()
  const groupCache = new Map<string, KdbxGroup>()

  const ensureGroup = (path: string | undefined): KdbxGroup => {
    if (!path?.trim()) return root
    const normalized = path.trim()
    const cached = groupCache.get(normalized)
    if (cached) return cached
    const segments = normalized
      .split(GROUP_PATH_SEPARATOR)
      .map((segment) => segment.trim())
      .filter(Boolean)
    let parent = root
    let currentPath = ''
    for (const segment of segments) {
      currentPath = currentPath
        ? `${currentPath}${GROUP_PATH_SEPARATOR}${segment}`
        : segment
      let group = groupCache.get(currentPath)
      if (!group) {
        group = database.createGroup(parent, segment)
        groupCache.set(currentPath, group)
      }
      parent = group
    }
    return parent
  }

  for (const account of data.accounts.filter((entry) => entry.tabId === tabId)) {
    const site = sites.get(account.siteId)
    if (!site) continue
    const group = ensureGroup(site.group)
    const entry = database.createEntry(group)
    entry.fields.set('Title', site.name)
    entry.fields.set('URL', site.startUrl)
    entry.fields.set('UserName', account.username)
    entry.fields.set('Password', ProtectedValue.fromString(account.password))
    entry.fields.set('Notes', '由 AutoLogin 导出')
  }

  return database.save()
}

export function serializeTabBookmarks(data: VaultData, tabId: string): string {
  const tab = data.tabs.find((entry) => entry.id === tabId)
  if (!tab) throw new Error('导出标签页不存在')
  const sites = new Map(
    data.sites
      .filter((site) => site.tabId === tabId)
      .map((site) => [site.id, site] as const)
  )
  const links = data.accounts
    .filter((account) => account.tabId === tabId)
    .map((account) => sites.get(account.siteId))
    .filter((site): site is NonNullable<typeof site> => Boolean(site))
    .map(
      (site) =>
        `    <DT><A HREF="${escapeHtmlAttribute(site.startUrl)}">${escapeHtmlText(site.name)}</A>`
    )
  return [
    '<!DOCTYPE NETSCAPE-Bookmark-file-1>',
    '<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">',
    '<TITLE>Bookmarks</TITLE>',
    '<H1>Bookmarks</H1>',
    '<DL><p>',
    ...links,
    '</DL><p>',
    ''
  ].join('\r\n')
}

export function mergeAutologinSnapshot(
  current: VaultData,
  imported: VaultData
): { data: VaultData; result: DataImportResult } {
  const data = structuredClone(current)
  const now = new Date().toISOString()
  const importedTabs = imported.tabs.filter(
    (tab) =>
      imported.accounts.some((account) => account.tabId === tab.id) ||
      imported.sites.some((site) => site.tabId === tab.id)
  )
  if (importedTabs.length === 0) {
    throw new Error('AutoLogin 配置文件中没有可导入的账号')
  }

  const takenNames = new Set(data.tabs.map((tab) => tab.name.toLocaleLowerCase()))
  let sitesCreated = 0
  let accountsCreated = 0
  let firstTab: AccountTab | null = null

  for (const sourceTab of importedTabs) {
    const baseName = sourceTab.name.trim() || 'AutoLogin 导入'
    let tabName = baseName
    let sequence = 2
    while (takenNames.has(tabName.toLocaleLowerCase())) {
      const suffix = ` ${sequence}`
      tabName = `${baseName.slice(0, 40 - suffix.length).trimEnd()}${suffix}`
      sequence += 1
    }
    takenNames.add(tabName.toLocaleLowerCase())
    const targetTab: AccountTab = {
      id: randomUUID(),
      name: tabName,
      color: sourceTab.color,
      source: 'autologin',
      hidden: false,
      createdAt: now,
      updatedAt: now
    }
    data.tabs.push(targetTab)
    firstTab ??= targetTab

    const siteIdMap = new Map<string, string>()
    for (const site of imported.sites.filter((entry) => entry.tabId === sourceTab.id)) {
      const nextSiteId = randomUUID()
      siteIdMap.set(site.id, nextSiteId)
      data.sites.push({
        ...structuredClone(site),
        id: nextSiteId,
        tabId: targetTab.id,
        createdAt: site.createdAt || now,
        updatedAt: site.updatedAt || now
      })
      sitesCreated += 1
    }
    for (const account of imported.accounts.filter(
      (entry) => entry.tabId === sourceTab.id
    )) {
      const nextSiteId = siteIdMap.get(account.siteId)
      if (!nextSiteId) continue
      data.accounts.push({
        ...structuredClone(account),
        id: randomUUID(),
        tabId: targetTab.id,
        siteId: nextSiteId,
        sortOrder: data.accounts.filter((entry) => entry.tabId === targetTab.id).length,
        createdAt: account.createdAt || now,
        updatedAt: account.updatedAt || now
      })
      accountsCreated += 1
    }
    for (const group of imported.groupDefinitions.filter(
      (entry) => entry.tabId === sourceTab.id
    )) {
      data.groupDefinitions.push({
        ...structuredClone(group),
        tabId: targetTab.id,
        createdAt: group.createdAt || now,
        updatedAt: group.updatedAt || now
      })
    }
  }

  return {
    data,
    result: {
      source: 'autologin',
      tabId: firstTab?.id ?? '',
      tabName: firstTab?.name ?? 'AutoLogin 导入',
      sitesCreated,
      accountsCreated,
      skipped: 0,
      warnings: []
    }
  }
}

function ensureImportedGroups(data: VaultData, tabId: string, now: string): void {
  const existing = new Set(
    data.groupDefinitions
      .filter((group) => group.tabId === tabId)
      .map((group) => group.path)
  )
  const needed = new Set<string>()
  for (const site of data.sites) {
    if (site.tabId === tabId && site.group?.trim()) needed.add(site.group.trim())
  }
  for (const path of needed) {
    const segments = path.split(GROUP_PATH_SEPARATOR).map((segment) => segment.trim())
    for (let index = 1; index <= segments.length; index += 1) {
      const prefix = segments.slice(0, index).join(GROUP_PATH_SEPARATOR)
      if (existing.has(prefix)) continue
      const group: GroupDefinition = {
        tabId,
        path: prefix,
        name: segments[index - 1] ?? prefix,
        createdAt: now,
        updatedAt: now
      }
      data.groupDefinitions.push(group)
      existing.add(prefix)
    }
  }
}

function kdbxEntryToCandidate(
  entry: KdbxEntry,
  group: KdbxGroup,
  rowNumber: number
):
  | { kind: 'candidate'; value: ImportedLoginCandidate }
  | { kind: 'skip'; warning: string } {
  const title = fieldText(entry, 'Title').trim()
  const rawUrl = fieldText(entry, 'URL').trim()
  const username = fieldText(entry, 'UserName').trim()
  const password = fieldText(entry, 'Password')
  const reason = validateCandidateFields(title || hostnameOf(rawUrl), rawUrl, username, password)
  if (reason) {
    return { kind: 'skip', warning: `第 ${rowNumber} 条 KeePassXC 记录已跳过：${reason}` }
  }

  const groupName =
    group.parentGroup && group.name?.trim()
      ? group.name.trim().slice(0, 40)
      : undefined
  return {
    kind: 'candidate',
    value: {
      siteName: (title || hostnameOf(rawUrl)).slice(0, 80),
      startUrl: normalizeImportUrl(rawUrl),
      siteGroup: groupName,
      username,
      password,
      autoSubmit: true,
      favorite: false,
      rowNumber
    }
  }
}

function fieldText(entry: KdbxEntry, name: string): string {
  const value = entry.fields.get(name)
  if (value instanceof ProtectedValue) {
    return value.getText()
  }
  return typeof value === 'string' ? value : ''
}

function validateCandidateFields(
  siteName: string,
  rawUrl: string,
  username: string,
  password: string
): string | null {
  if (!siteName) return '站点名称为空'
  if (siteName.length > 80) return '站点名称超过 80 个字符'
  if (!rawUrl) return '登录地址为空'
  if (!isValidImportUrl(rawUrl)) return '登录地址不是有效的 http/https 地址'
  if (!username) return '用户名为空'
  if (username.length > 320) return '用户名超过 320 个字符'
  if (!password) return '密码为空'
  if (password.length > 2048) return '密码超过 2048 个字符'
  return null
}

function isValidImportUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return (
      (url.protocol === 'http:' || url.protocol === 'https:') &&
      !url.username &&
      !url.password
    )
  } catch {
    return false
  }
}

function normalizeImportUrl(value: string): string {
  return new URL(value).toString()
}

function normalizeSiteName(value: string): string {
  return value.trim().toLocaleLowerCase()
}

function normalizeUrlForCompare(value: string): string {
  try {
    return new URL(value).toString()
  } catch {
    return value.trim()
  }
}

function optionalGroup(value: string | undefined): string | undefined {
  const group = clean(value).slice(0, 40)
  return group || undefined
}

function clean(value: string | undefined): string {
  return (value ?? '').trim()
}

function escapeCsvCell(value: string): string {
  return `"${value.replace(/"/g, '""')}"`
}

function escapeHtmlText(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function escapeHtmlAttribute(value: string): string {
  return escapeHtmlText(value).replace(/'/g, '&#39;')
}

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  const normalized = clean(value).toLocaleLowerCase()
  if (!normalized) return fallback
  if (['true', '1', 'yes', 'y', '是'].includes(normalized)) return true
  if (['false', '0', 'no', 'n', '否'].includes(normalized)) return false
  return fallback
}

function hostnameOf(value: string): string {
  try {
    return new URL(value).hostname.replace(/^www\./, '')
  } catch {
    return ''
  }
}

function sanitizeBookmarkText(value: string): string {
  return decodeHtmlEntities(
    value
      .replace(/<[^>]*>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
  )
    .replace(/\s+/g, ' ')
    .trim()
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) =>
      String.fromCodePoint(Number.parseInt(code, 16))
    )
}

async function readBoundedFile(path: string): Promise<Buffer> {
  const stats = await stat(path)
  if (stats.size > MAX_IMPORT_BYTES) {
    throw new Error(`文件过大：${basename(path)} 超过 50 MB`)
  }
  const buffer = await readFile(path)
  if (buffer.byteLength > MAX_IMPORT_BYTES) {
    throw new Error(`文件过大：${basename(path)} 超过 50 MB`)
  }
  return buffer
}

function decodeCsvBuffer(buffer: Buffer): string {
  if (buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) {
    return new TextDecoder('utf-8').decode(buffer.subarray(3))
  }
  if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe) {
    return buffer.subarray(2).toString('utf16le')
  }
  if (buffer.length >= 2 && buffer[0] === 0xfe && buffer[1] === 0xff) {
    return decodeWithFallback('utf-16be', buffer.subarray(2)) ?? buffer.toString('utf8')
  }

  return (
    decodeWithFallback('utf-8', buffer) ??
    decodeWithFallback('gb18030', buffer) ??
    buffer.toString('utf8')
  )
}

function decodeWithFallback(encoding: string, buffer: Buffer): string | null {
  try {
    return new TextDecoder(encoding, { fatal: true }).decode(buffer)
  } catch {
    return null
  }
}

function toArrayBuffer(buffer: Buffer): ArrayBuffer {
  return buffer.buffer.slice(
    buffer.byteOffset,
    buffer.byteOffset + buffer.byteLength
  ) as ArrayBuffer
}

export function configureKdbxArgon2(): void {
  if (argon2Configured) return
  CryptoEngine.setArgon2Impl(
    async (password, salt, memory, iterations, length, parallelism, type, version) => {
      if (version !== 0x13) {
        throw new Error('暂不支持旧版 Argon2 v1.0 KeePassXC 数据库')
      }
      const algorithm = type === 2 ? argon2id : argon2d
      const result = await algorithm({
        password: new Uint8Array(password),
        salt: new Uint8Array(salt),
        memorySize: memory,
        iterations,
        parallelism,
        hashLength: length,
        outputType: 'binary'
      })
      return Uint8Array.from(result).buffer
    }
  )
  argon2Configured = true
}
