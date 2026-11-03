import { readFile, stat } from 'node:fs/promises'
import { basename } from 'node:path'
import { randomUUID } from 'node:crypto'
import { parse } from 'csv-parse/sync'
import {
  CryptoEngine,
  Kdbx,
  KdbxCredentials,
  KdbxEntry,
  KdbxGroup,
  ProtectedValue
} from 'kdbxweb'
import { argon2d, argon2id } from 'hash-wasm'
import type { DataImportResult, StoredAccount, VaultData } from '@shared/types'

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

export function mergeImportedLogins(
  vaultData: VaultData,
  source: 'csv' | 'kdbx',
  parsed: ParsedImport
): { data: VaultData; result: DataImportResult } {
  const data = structuredClone(vaultData)
  const warnings = [...parsed.warnings]
  let skipped = parsed.skipped
  let sitesCreated = 0
  let accountsCreated = 0
  const now = new Date().toISOString()

  const sitesByName = new Map(
    data.sites.map((site) => [normalizeSiteName(site.name), site] as const)
  )

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
      siteId: site.id,
      label: site.name,
      username: candidate.username,
      password: candidate.password,
      favorite: candidate.favorite,
      loginStrategy: 'auto',
      createdAt: now,
      updatedAt: now
    }
    data.accounts.push(account)
    accountsCreated += 1
  }

  return {
    data,
    result: {
      source,
      sitesCreated,
      accountsCreated,
      skipped,
      warnings: warnings.slice(0, 30)
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
