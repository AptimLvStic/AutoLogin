import {
  closeSync,
  copyFileSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  writeSync
} from 'node:fs'
import { promises as fsPromises } from 'node:fs'
import { dirname, join } from 'node:path'
import { markStage } from './block-watchdog'
import { randomBytes } from 'node:crypto'
import { createCipheriv, createDecipheriv } from 'node:crypto'
import { argon2id } from 'hash-wasm'
import { vaultDataSchema } from '@shared/schemas'
import { DEFAULT_APP_SETTINGS } from '@shared/theme'
import {
  ACCOUNT_TAB_COLORS,
  DEFAULT_ACCOUNT_TAB_ID
} from '@shared/types'
import type {
  AccountTab,
  AppSettings,
  AppSettingsPatch,
  AutoLockMinutes,
  VaultData,
  VaultStatus
} from '@shared/types'

const KDF_MEMORY_KIB = 64 * 1024
const KDF_ITERATIONS = 3
const KDF_PARALLELISM = 1
const KEY_LENGTH = 32
const SALT_LENGTH = 16
const IV_LENGTH = 12

/**
 * fsync 在慢盘、接近写满的机械盘或被同步软件占用的目录上可能长时间不返回，
 * 一旦挂住会阻塞主进程事件循环，导致所有 IPC（保存、撤销、暂停）一起无响应。
 * 这里给 fsync 设上限：超时后继续完成 rename，数据仍是完整的，
 * 最坏情况是断电时丢掉最后这一次写入，好过整个应用卡死。
 */
const ENVELOPE_SYNC_TIMEOUT_MS = 3_000

export type ExportEnvelopeFormat = 'autologin-vault' | 'autologin-csv'

interface VaultEnvelope {
  format: ExportEnvelopeFormat
  version: 1
  kdf: {
    name: 'argon2id'
    salt: string
    memoryKiB: number
    iterations: number
    parallelism: number
    keyLength: number
  }
  cipher: {
    name: 'aes-256-gcm'
    iv: string
    tag: string
  }
  ciphertext: string
}

interface DecryptedEnvelope {
  data: VaultData
  key: Buffer
  salt: Buffer
}

export interface VaultSaveOptions {
  tabIds?: string[]
}

export class VaultError extends Error {
  constructor(
    message: string,
    readonly code: 'WRONG_PASSWORD' | 'CORRUPTED' | 'LOCKED' | 'EXISTS' | 'INVALID'
  ) {
    super(message)
    this.name = 'VaultError'
  }
}

interface VaultTabKey {
  key: Buffer
  salt: Buffer
}

interface VaultShell {
  schemaVersion: 2
  tabs: AccountTab[]
  settings: AppSettings
  favoriteGroups: string[]
  tabBlobs: Record<string, string>
  /** 书签标签页没有密码，内容以明文保存在外壳里。 */
  plain: TabSlice
}

type TabSlice = {
  sites: VaultData['sites']
  accounts: VaultData['accounts']
  groupDefinitions: VaultData['groupDefinitions']
  deletedAccounts: VaultData['deletedAccounts']
}

function sliceForTab(data: VaultData, tabId: string): TabSlice {
  return {
    sites: data.sites.filter((item) => item.tabId === tabId),
    accounts: data.accounts.filter((item) => item.tabId === tabId),
    groupDefinitions: data.groupDefinitions.filter((item) => item.tabId === tabId),
    deletedAccounts: data.deletedAccounts.filter((item) => item.tabId === tabId)
  }
}

function parseTabSlice(raw: unknown, tab: AccountTab): TabSlice {
  const source = (raw ?? {}) as Partial<TabSlice>
  const candidate: VaultData = {
    schemaVersion: 1,
    tabs: [tab],
    sites: Array.isArray(source.sites) ? source.sites : [],
    accounts: Array.isArray(source.accounts) ? source.accounts : [],
    groupDefinitions: Array.isArray(source.groupDefinitions) ? source.groupDefinitions : [],
    deletedAccounts: Array.isArray(source.deletedAccounts) ? source.deletedAccounts : [],
    favoriteGroups: [],
    settings: DEFAULT_APP_SETTINGS
  }
  const parsed = vaultDataSchema.safeParse(candidate)
  if (!parsed.success) {
    throw new VaultError('数据库内容已损坏', 'CORRUPTED')
  }
  return {
    sites: parsed.data.sites,
    accounts: parsed.data.accounts,
    groupDefinitions: parsed.data.groupDefinitions,
    deletedAccounts: parsed.data.deletedAccounts
  }
}

export class VaultManager {
  private readonly shellPath: string
  private readonly backupPath: string
  private readonly legacyPath: string
  private shell: VaultShell | null = null
  private data: VaultData | null = null
  private readonly tabKeys = new Map<string, VaultTabKey>()
  private lockTimer: NodeJS.Timeout | null = null
  private autoLockMinutes: AutoLockMinutes = 10
  private beforeSaveListener: ((data: VaultData) => void) | null = null
  private saveListener:
    | ((data: VaultData, options?: VaultSaveOptions) => void)
    | null = null

  constructor(userDataPath: string, private readonly onLocked: () => void) {
    mkdirSync(userDataPath, { recursive: true })
    this.shellPath = join(userDataPath, 'vault.json')
    this.backupPath = join(userDataPath, 'vault.json.bak')
    this.legacyPath = join(userDataPath, 'vault.enc')
  }

  /** 备份/覆盖安装只认这一个路径：新格式是 vault.json，迁移前是 vault.enc。 */
  get path(): string {
    return existsSync(this.shellPath) ? this.shellPath : this.legacyPath
  }

  get backup(): string {
    return this.backupPath
  }

  get legacyPasswordRequired(): boolean {
    return !existsSync(this.shellPath) && existsSync(this.legacyPath)
  }

  status(): VaultStatus {
    this.initShell()
    return {
      initialized: existsSync(this.shellPath) || existsSync(this.legacyPath),
      unlocked: this.tabKeys.size > 0,
      autoLockMinutes: this.autoLockMinutes,
      legacyPasswordRequired: this.legacyPasswordRequired,
      tabs: (this.shell?.tabs ?? []).map((tab) => ({
        id: tab.id,
        locked: this.isTabLocked(tab.id)
      }))
    }
  }

  /**
   * 读取明文外壳（标签页列表、外观设置、各库的加密载荷）。启动、状态查询、
   * 备份恢复之后都必须走这里，确保内存视图和磁盘一致。
   */
  initShell(): boolean {
    if (this.data) return true
    if (!existsSync(this.shellPath)) return false
    try {
      const raw = JSON.parse(readFileSync(this.shellPath, 'utf8')) as Partial<VaultShell>
      if (raw.schemaVersion !== 2 || !Array.isArray(raw.tabs) || !raw.settings) {
        return false
      }
      this.shell = {
        schemaVersion: 2,
        tabs: raw.tabs,
        settings: raw.settings,
        favoriteGroups: Array.isArray(raw.favoriteGroups) ? raw.favoriteGroups : [],
        tabBlobs:
          raw.tabBlobs && typeof raw.tabBlobs === 'object' ? { ...raw.tabBlobs } : {},
        plain: {
          sites: Array.isArray(raw.plain?.sites) ? raw.plain.sites : [],
          accounts: Array.isArray(raw.plain?.accounts) ? raw.plain.accounts : [],
          groupDefinitions: Array.isArray(raw.plain?.groupDefinitions)
            ? raw.plain.groupDefinitions
            : [],
          deletedAccounts: Array.isArray(raw.plain?.deletedAccounts)
            ? raw.plain.deletedAccounts
            : []
        }
      }
      this.assembleData()
      this.autoLockMinutes = this.shell.settings.autoLockMinutes
      return true
    } catch {
      return false
    }
  }

  isTabLocked(tabId: string): boolean {
    const tab = this.shell?.tabs.find((item) => item.id === tabId)
    if (!tab) return true
    if (tab.source === 'bookmarks') return false
    return !this.tabKeys.has(tabId)
  }

  async create(): Promise<VaultStatus> {
    if (existsSync(this.shellPath) || existsSync(this.legacyPath)) {
      throw new VaultError('保险库已存在', 'EXISTS')
    }
    this.shell = {
      schemaVersion: 2,
      tabs: [],
      settings: structuredClone(DEFAULT_APP_SETTINGS),
      favoriteGroups: [],
      tabBlobs: {},
      plain: { sites: [], accounts: [], groupDefinitions: [], deletedAccounts: [] }
    }
    this.tabKeys.clear()
    this.assembleData()
    this.autoLockMinutes = this.shell.settings.autoLockMinutes
    this.persistShell()
    this.scheduleLock()
    return this.status()
  }

  /** 旧版单一主密码保险库：迁移成「每个库各自密码」，一次输入即可全部打开。 */
  async unlock(password: string): Promise<VaultStatus> {
    return this.unlockLegacy(password)
  }

  async unlockLegacy(password: string): Promise<VaultStatus> {
    if (!existsSync(this.legacyPath)) {
      throw new VaultError('保险库尚未创建', 'INVALID')
    }
    const text = readFileSync(this.legacyPath, 'utf8')
    const envelope = parseEnvelope(text, 'autologin-vault')
    const decrypted = await decryptEnvelope(envelope, password)
    const parsed = vaultDataSchema.safeParse(decrypted.data)
    if (!parsed.success) {
      decrypted.key.fill(0)
      throw new VaultError('保险库文件已损坏', 'CORRUPTED')
    }
    const data = parsed.data
    const salt = Buffer.from(envelope.kdf.salt, 'base64')
    const tabBlobs: Record<string, string> = {}
    for (const tab of data.tabs) {
      if (tab.source === 'bookmarks') continue
      const slice = sliceForTab(data, tab.id)
      tabBlobs[tab.id] = JSON.stringify(
        buildEnvelopeFromKey(
          Buffer.from(JSON.stringify(slice), 'utf8'),
          decrypted.key,
          salt,
          'autologin-vault'
        )
      )
    }
    const shell: VaultShell = {
      schemaVersion: 2,
      tabs: data.tabs,
      settings: data.settings,
      favoriteGroups: data.favoriteGroups,
      tabBlobs,
      plain: this.plainSlice(data)
    }
    this.writeShellFile(shell, false)
    renameSync(this.legacyPath, this.legacyPath + '.migrated')
    if (existsSync(this.legacyPath + '.bak')) {
      try {
        rmSync(this.legacyPath + '.bak', { force: true })
      } catch {
        // 旧备份删不掉不影响迁移，下次清扫再处理。
      }
    }
    this.shell = shell
    this.data = data
    this.tabKeys.clear()
    for (const tab of data.tabs) {
      if (tab.source === 'bookmarks') continue
      this.tabKeys.set(tab.id, { key: Buffer.from(decrypted.key), salt: Buffer.from(salt) })
    }
    this.autoLockMinutes = data.settings.autoLockMinutes
    this.scheduleLock()
    return this.status()
  }

  /** 关闭全部数据库；外壳与设置仍然可用。 */
  lock(): VaultStatus {
    this.clearLockTimer()
    for (const tabId of Array.from(this.tabKeys.keys())) {
      this.dropTabRows(tabId)
    }
    this.tabKeys.clear()
    this.onLocked()
    return this.status()
  }

  lockTab(tabId: string): VaultStatus {
    if (this.tabKeys.has(tabId)) {
      this.dropTabRows(tabId)
      this.tabKeys.delete(tabId)
    }
    this.clearLockTimer()
    this.scheduleLock()
    this.onLocked()
    return this.status()
  }

  async unlockTab(tabId: string, password: string): Promise<VaultStatus> {
    const shell = this.requireShell()
    const tab = shell.tabs.find((item) => item.id === tabId)
    if (!tab) {
      throw new VaultError('数据库不存在', 'INVALID')
    }
    if (tab.source === 'bookmarks') {
      return this.status()
    }
    const existing = shell.tabBlobs[tabId]
    if (!existing) {
      const salt = randomBytes(SALT_LENGTH)
      const key = await deriveKey(password, salt)
      this.tabKeys.set(tabId, { key, salt })
      this.save()
      return this.status()
    }
    const envelope = parseEnvelope(existing, 'autologin-vault')
    const decrypted = await decryptEnvelope(envelope, password)
    const slice = parseTabSlice(decrypted.data, tab)
    this.tabKeys.set(tabId, {
      key: decrypted.key,
      salt: Buffer.from(envelope.kdf.salt, 'base64')
    })
    this.mergeSlice(tabId, slice)
    this.scheduleLock()
    return this.status()
  }

  async verifyTabPassword(tabId: string, password: string): Promise<boolean> {
    const shell = this.requireShell()
    const tab = shell.tabs.find((item) => item.id === tabId)
    if (tab?.source === 'bookmarks') return true
    const blob = shell.tabBlobs[tabId]
    if (!blob) return false
    try {
      const envelope = parseEnvelope(blob, 'autologin-vault')
      const decrypted = await decryptEnvelope(envelope, password)
      decrypted.key.fill(0)
      return true
    } catch {
      return false
    }
  }

  async changeTabPassword(tabId: string, currentPassword: string, nextPassword: string): Promise<void> {
    const shell = this.requireShell()
    const tab = shell.tabs.find((item) => item.id === tabId)
    if (!tab) {
      throw new VaultError('数据库不存在', 'INVALID')
    }
    if (tab.source === 'bookmarks') {
      throw new VaultError('书签数据库不需要密码', 'INVALID')
    }
    const blob = shell.tabBlobs[tabId]
    if (!blob) {
      const salt = randomBytes(SALT_LENGTH)
      const key = await deriveKey(nextPassword, salt)
      this.tabKeys.set(tabId, { key, salt })
      this.save()
      return
    }
    const envelope = parseEnvelope(blob, 'autologin-vault')
    const decrypted = await decryptEnvelope(envelope, currentPassword)
    const slice = this.tabKeys.has(tabId) && this.data
      ? sliceForTab(this.data, tabId)
      : parseTabSlice(decrypted.data, tab)
    decrypted.key.fill(0)
    const salt = randomBytes(SALT_LENGTH)
    const key = await deriveKey(nextPassword, salt)
    this.tabKeys.set(tabId, { key, salt })
    if (!this.data) {
      this.assembleData()
    }
    this.mergeSlice(tabId, slice)
    this.save()
  }

  requireData(): VaultData {
    if (!this.data) {
      throw new VaultError('保险库已锁定', 'LOCKED')
    }
    return this.data
  }

  peekData(): VaultData | null {
    return this.data
  }

  getSettings(): AppSettings {
    return this.data?.settings ?? this.shell?.settings ?? DEFAULT_APP_SETTINGS
  }

  updateSettings(patch: AppSettingsPatch): AppSettings {
    const data = this.requireData()
    data.settings = { ...data.settings, ...patch }
    if (this.shell) this.shell.settings = data.settings
    this.autoLockMinutes = data.settings.autoLockMinutes
    this.save()
    return data.settings
  }

  setSaveListener(
    listener: (data: VaultData, options?: VaultSaveOptions) => void
  ): void {
    this.saveListener = listener
  }

  setBeforeSaveListener(listener: (data: VaultData) => void): void {
    this.beforeSaveListener = listener
  }

  save(options?: VaultSaveOptions): void {
    const data = this.requireData()
    this.beforeSaveListener?.(data)
    this.persistShell()
    this.saveListener?.(data, options)
    this.touch()
  }

  async saveAsync(options?: VaultSaveOptions): Promise<void> {
    markStage('vault.saveAsync 进入')
    this.save(options)
    markStage('vault.saveAsync 写盘完成')
    await fsPromises.access(this.shellPath)
  }

  touch(): void {
    if (!this.data) return
    this.scheduleLock()
  }

  private scheduleLock(): void {
    this.clearLockTimer()
    if (this.autoLockMinutes <= 0) return
    if (this.tabKeys.size === 0) return
    const timeout = this.autoLockMinutes * 60 * 1000
    this.lockTimer = setTimeout(() => {
      this.lockTimer = null
      this.lock()
    }, timeout)
    this.lockTimer.unref?.()
  }

  private clearLockTimer(): void {
    if (this.lockTimer) {
      clearTimeout(this.lockTimer)
      this.lockTimer = null
    }
  }

  private requireShell(): VaultShell {
    this.initShell()
    if (!this.shell) {
      throw new VaultError('保险库尚未创建', 'LOCKED')
    }
    return this.shell
  }

  private assembleData(): void {
    const shell = this.shell
    if (!shell) {
      this.data = null
      return
    }
    this.data = {
      schemaVersion: 1,
      tabs: shell.tabs,
      sites: [...shell.plain.sites],
      accounts: [...shell.plain.accounts],
      groupDefinitions: [...shell.plain.groupDefinitions],
      deletedAccounts: [...shell.plain.deletedAccounts],
      favoriteGroups: shell.favoriteGroups,
      settings: shell.settings
    }
  }

  /** 书签库的明文行（无密码库），写外壳时整体保存。 */
  private plainSlice(data: VaultData): TabSlice {
    const bookmarkTabIds = new Set(
      data.tabs.filter((tab) => tab.source === 'bookmarks').map((tab) => tab.id)
    )
    const pick = <T extends { tabId: string }>(rows: T[]): T[] =>
      rows.filter((row) => bookmarkTabIds.has(row.tabId))
    return {
      sites: pick(data.sites),
      accounts: pick(data.accounts),
      groupDefinitions: pick(data.groupDefinitions),
      deletedAccounts: pick(data.deletedAccounts)
    }
  }

  private dropTabRows(tabId: string): void {
    const data = this.data
    if (!data) return
    data.sites = data.sites.filter((item) => item.tabId !== tabId)
    data.accounts = data.accounts.filter((item) => item.tabId !== tabId)
    data.groupDefinitions = data.groupDefinitions.filter((item) => item.tabId !== tabId)
    data.deletedAccounts = data.deletedAccounts.filter((item) => item.tabId !== tabId)
  }

  private mergeSlice(tabId: string, slice: TabSlice): void {
    const data = this.requireData()
    this.dropTabRows(tabId)
    data.sites.push(...slice.sites.map((item) => ({ ...item, tabId })))
    data.accounts.push(...slice.accounts.map((item) => ({ ...item, tabId })))
    data.groupDefinitions.push(
      ...slice.groupDefinitions.map((item) => ({ ...item, tabId }))
    )
    data.deletedAccounts.push(...slice.deletedAccounts.map((item) => ({ ...item, tabId })))
  }

  private persistShell(): void {
    const shell = this.requireShell()
    const data = this.requireData()
    const tabBlobs: Record<string, string> = {}
    for (const tab of data.tabs) {
      // 书签数据库没有密码，数据以明文保存在外壳的 plain 字段里。
      if (tab.source === 'bookmarks') continue
      const tabKey = this.tabKeys.get(tab.id)
      if (tabKey) {
        const slice = sliceForTab(data, tab.id)
        tabBlobs[tab.id] = JSON.stringify(
          buildEnvelopeFromKey(
            Buffer.from(JSON.stringify(slice), 'utf8'),
            tabKey.key,
            tabKey.salt,
            'autologin-vault'
          )
        )
      } else {
        const existing = shell.tabBlobs[tab.id]
        if (existing) tabBlobs[tab.id] = existing
      }
    }
    const next: VaultShell = {
      schemaVersion: 2,
      tabs: data.tabs,
      settings: data.settings,
      favoriteGroups: data.favoriteGroups,
      tabBlobs,
      plain: this.plainSlice(data)
    }
    this.writeShellFile(next, true)
    this.shell = next
  }

  private writeShellFile(shell: VaultShell, keepBackup: boolean): void {
    const serialized = JSON.stringify(shell, null, 2)
    if (keepBackup && existsSync(this.shellPath)) {
      try {
        copyFileSync(this.shellPath, this.backupPath)
      } catch {
        // 备份失败不影响主文件写入。
      }
    }
    const tempPath = this.shellPath + '.' + process.pid + '.tmp'
    const file = openSync(tempPath, 'w', 0o600)
    try {
      writeSync(file, serialized)
      fsyncSync(file)
    } finally {
      closeSync(file)
    }
    renameSync(tempPath, this.shellPath)
  }

  async exportEncryptedTo(destination: string, password: string): Promise<void> {
    const data = this.requireData()
    const serialized = await encryptBufferWithPassword(
      Buffer.from(JSON.stringify(data), 'utf8'),
      password,
      'autologin-vault'
    )
    writeSerializedEnvelope(destination, serialized)
  }

  copyEncryptedTo(destination: string): void {
    copyFileSync(this.path, destination)
  }

  async readEncryptedSnapshot(sourcePath: string, password: string): Promise<VaultData> {
    const text = await fsPromises.readFile(sourcePath, 'utf8')
    const envelope = parseEnvelope(text, 'autologin-vault')
    const decrypted = await decryptEnvelope(envelope, password)
    const parsed = vaultDataSchema.safeParse(decrypted.data)
    decrypted.key.fill(0)
    if (!parsed.success) {
      throw new VaultError('保险库文件已损坏', 'CORRUPTED')
    }
    return parsed.data
  }

  /** 单库镜像文件：用该库自己的密钥加密，锁定状态下禁止写。 */
  writeTabSnapshot(destination: string, tabId: string, snapshot: VaultData): void {
    const tabKey = this.tabKeys.get(tabId)
    if (!tabKey) {
      throw new VaultError('数据库已锁定', 'LOCKED')
    }
    const envelope = buildEnvelopeFromKey(
      Buffer.from(JSON.stringify(snapshot), 'utf8'),
      tabKey.key,
      tabKey.salt,
      'autologin-vault'
    )
    writeSerializedEnvelope(destination, JSON.stringify(envelope))
  }

  writeEncryptedSnapshot(destination: string, snapshot: VaultData): void {
    const tabId = snapshot.tabs[0]?.id
    if (!tabId) {
      throw new VaultError('快照缺少数据库标识', 'INVALID')
    }
    this.writeTabSnapshot(destination, tabId, snapshot)
  }

  restoreEncryptedFrom(sourcePath: string): void {
    const text = readFileSync(sourcePath, 'utf8')
    let parsed: Partial<VaultShell> | null = null
    try {
      parsed = JSON.parse(text) as Partial<VaultShell>
    } catch {
      parsed = null
    }
    if (!parsed || parsed.schemaVersion !== 2 || !parsed.tabBlobs) {
      throw new VaultError(
        '该备份来自旧版单一主密码保险库，已无法在新版本中直接恢复',
        'INVALID'
      )
    }
    this.tabKeys.clear()
    this.clearLockTimer()
    this.shell = null
    this.data = null
    copyFileSync(sourcePath, this.shellPath)
    if (existsSync(this.backupPath)) {
      try {
        rmSync(this.backupPath, { force: true })
      } catch {
        // 忽略
      }
    }
    this.initShell()
  }

  clearAllFiles(): void {
    this.tabKeys.clear()
    this.clearLockTimer()
    this.shell = null
    this.data = null
    for (const target of [
      this.shellPath,
      this.backupPath,
      this.legacyPath,
      this.legacyPath + '.bak',
      this.legacyPath + '.migrated'
    ]) {
      try {
        rmSync(target, { force: true })
      } catch {
        // 忽略
      }
    }
  }
}
async function deriveKey(password: string, salt: Buffer): Promise<Buffer> {
  const key = await argon2id({
    password,
    salt,
    parallelism: KDF_PARALLELISM,
    iterations: KDF_ITERATIONS,
    memorySize: KDF_MEMORY_KIB,
    hashLength: KEY_LENGTH,
    outputType: 'binary'
  })
  return Buffer.from(key)
}

async function decryptEnvelope(
  envelope: VaultEnvelope,
  password: string
): Promise<{ data: unknown; key: Buffer }> {
  const salt = Buffer.from(envelope.kdf.salt, 'base64')
  const key = await deriveKey(password, salt)
  try {
    const decipher = createDecipheriv(
      'aes-256-gcm',
      key,
      Buffer.from(envelope.cipher.iv, 'base64')
    )
    decipher.setAuthTag(Buffer.from(envelope.cipher.tag, 'base64'))
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(envelope.ciphertext, 'base64')),
      decipher.final()
    ])
    return { data: JSON.parse(plaintext.toString('utf8')), key }
  } catch {
    key.fill(0)
    throw new VaultError('密码不正确，或加密文件已损坏', 'WRONG_PASSWORD')
  }
}

/**
 * 用任意密码把一个二进制载荷封装成 AutoLogin 信封（argon2id + AES-256-GCM）。
 * 导出数据库（autologin-vault）与加密 CSV（autologin-csv）共用这套格式。
 */
export async function encryptBufferWithPassword(
  plaintext: Buffer,
  password: string,
  format: ExportEnvelopeFormat
): Promise<string> {
  const salt = randomBytes(SALT_LENGTH)
  const key = await deriveKey(password, salt)
  try {
    return JSON.stringify(buildEnvelopeFromKey(plaintext, key, salt, format))
  } finally {
    key.fill(0)
  }
}

export async function decryptBufferWithPassword(
  serialized: string,
  password: string,
  format: ExportEnvelopeFormat
): Promise<Buffer> {
  const envelope = parseEnvelope(serialized, format)
  const salt = Buffer.from(envelope.kdf.salt, 'base64')
  const key = await deriveKey(password, salt)
  try {
    const decipher = createDecipheriv(
      'aes-256-gcm',
      key,
      Buffer.from(envelope.cipher.iv, 'base64')
    )
    decipher.setAuthTag(Buffer.from(envelope.cipher.tag, 'base64'))
    return Buffer.concat([
      decipher.update(Buffer.from(envelope.ciphertext, 'base64')),
      decipher.final()
    ])
  } catch {
    throw new VaultError('密码不正确或文件已损坏', 'WRONG_PASSWORD')
  } finally {
    key.fill(0)
  }
}

/**
 * 只读文件开头判断是否为加密载荷，避免在「选择文件」阶段就做完整 JSON 解析。
 */
export function detectEnvelopeFormat(text: string): ExportEnvelopeFormat | null {
  const head = text.slice(0, 256)
  if (!head.startsWith('{') || !head.includes('"format"')) {
    return null
  }
  if (head.includes('"autologin-csv"')) return 'autologin-csv'
  if (head.includes('"autologin-vault"')) return 'autologin-vault'
  return null
}

function buildEnvelopeFromKey(
  plaintext: Buffer,
  key: Buffer,
  salt: Buffer,
  format: ExportEnvelopeFormat
): VaultEnvelope {
  const iv = randomBytes(IV_LENGTH)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()])
  const tag = cipher.getAuthTag()

  return {
    format,
    version: 1,
    kdf: {
      name: 'argon2id',
      salt: salt.toString('base64'),
      memoryKiB: KDF_MEMORY_KIB,
      iterations: KDF_ITERATIONS,
      parallelism: KDF_PARALLELISM,
      keyLength: KEY_LENGTH
    },
    cipher: {
      name: 'aes-256-gcm',
      iv: iv.toString('base64'),
      tag: tag.toString('base64')
    },
    ciphertext: ciphertext.toString('base64')
  }
}

function parseEnvelope(text: string, format: ExportEnvelopeFormat): VaultEnvelope {
  const label = format === 'autologin-vault' ? '保险库文件' : 'CSV 文件'
  try {
    const parsed = JSON.parse(text) as Partial<VaultEnvelope>
    if (
      parsed.format !== format ||
      parsed.version !== 1 ||
      parsed.kdf?.name !== 'argon2id' ||
      parsed.kdf.memoryKiB !== KDF_MEMORY_KIB ||
      parsed.kdf.iterations !== KDF_ITERATIONS ||
      parsed.kdf.parallelism !== KDF_PARALLELISM ||
      parsed.kdf.keyLength !== KEY_LENGTH ||
      parsed.cipher?.name !== 'aes-256-gcm' ||
      !isBase64OfLength(parsed.kdf.salt, SALT_LENGTH) ||
      !isBase64OfLength(parsed.cipher.iv, IV_LENGTH) ||
      !isBase64OfLength(parsed.cipher.tag, 16) ||
      !isNonEmptyBase64(parsed.ciphertext)
    ) {
      throw new Error('invalid envelope')
    }
    return parsed as VaultEnvelope
  } catch {
    throw new VaultError(`${label}已损坏或格式不正确`, 'CORRUPTED')
  }
}

function writeSerializedEnvelope(destination: string, serialized: string): void {
  const tempPath = `${destination}.${process.pid}.export.tmp`
  mkdirSync(dirname(destination), { recursive: true })
  const file = openSync(tempPath, 'w', 0o600)
  try {
    writeSync(file, serialized)
    fsyncSync(file)
  } finally {
    closeSync(file)
  }

  try {
    renameSync(tempPath, destination)
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'EEXIST' || code === 'EPERM') {
      rmSync(destination, { force: true })
      renameSync(tempPath, destination)
    } else {
      rmSync(tempPath, { force: true })
      throw error
    }
  }
}

function normalizeUnlockError(error: unknown): VaultError {
  if (error instanceof VaultError) {
    return error
  }
  return new VaultError('密码不正确，或加密文件已损坏', 'WRONG_PASSWORD')
}

function isBase64OfLength(value: unknown, length: number): boolean {
  if (typeof value !== 'string' || !isBase64(value)) {
    return false
  }
  return Buffer.from(value, 'base64').length === length
}

function isNonEmptyBase64(value: unknown): boolean {
  return typeof value === 'string' && value.length > 0 && isBase64(value)
}

function isBase64(value: string): boolean {
  return value.length % 4 === 0 && /^[a-zA-Z0-9+/]*={0,2}$/.test(value)
}

function createLocalTab(): AccountTab {
  const now = new Date().toISOString()
  return {
    id: DEFAULT_ACCOUNT_TAB_ID,
    name: '本地数据库',
    color: ACCOUNT_TAB_COLORS[0],
    source: 'local',
    hidden: false,
    createdAt: now,
    updatedAt: now
  }
}

function normalizeVaultData(input: VaultData, dataDirectory: string): VaultData {
  const data = structuredClone(input)
  data.tabs = data.tabs.filter(
    (tab) => !isMissingLegacyLocalTab(tab, data, dataDirectory)
  )
  const tabsById = new Map<string, AccountTab>()
  for (const tab of data.tabs) {
    if (!tabsById.has(tab.id)) tabsById.set(tab.id, tab)
  }

  const hasOrphanedData =
    data.sites.length > 0 ||
    data.accounts.length > 0 ||
    data.groupDefinitions.length > 0 ||
    data.deletedAccounts.length > 0
  if (tabsById.size === 0 && hasOrphanedData) {
    const local = createLocalTab()
    data.tabs.unshift(local)
    tabsById.set(local.id, local)
  }
  data.tabs = [...tabsById.values()]

  const normalizeTabId = (tabId: string | undefined): string =>
    tabId && tabsById.has(tabId) ? tabId : data.tabs[0]!.id

  for (const site of data.sites) {
    site.tabId = normalizeTabId(site.tabId)
  }
  for (const account of data.accounts) {
    account.tabId = normalizeTabId(account.tabId)
    const site = data.sites.find((entry) => entry.id === account.siteId)
    if (site) account.tabId = site.tabId
  }
  for (const group of data.groupDefinitions) {
    group.tabId = normalizeTabId(group.tabId)
  }
  for (const record of data.deletedAccounts) {
    record.tabId = normalizeTabId(record.tabId)
    record.site.tabId = record.tabId
    record.account.tabId = record.tabId
  }

  for (const tab of data.tabs) {
    const tabAccounts = data.accounts.filter((account) => account.tabId === tab.id)
    let nextSortOrder = Math.max(
      -1,
      ...tabAccounts.map((account) =>
        typeof account.sortOrder === 'number' ? account.sortOrder : -1
      )
    )
    for (const account of tabAccounts) {
      if (typeof account.sortOrder !== 'number') {
        nextSortOrder += 1
        account.sortOrder = nextSortOrder
      }
    }
  }

  const legacyGroupOrderTabId = tabsById.has(DEFAULT_ACCOUNT_TAB_ID)
    ? DEFAULT_ACCOUNT_TAB_ID
    : data.tabs[0]?.id
  if (
    legacyGroupOrderTabId &&
    !data.settings.groupOrders[legacyGroupOrderTabId] &&
    data.settings.groupOrder.length > 0
  ) {
    data.settings.groupOrders[legacyGroupOrderTabId] = [...data.settings.groupOrder]
  }
  if (data.settings.proxy.mode === 'custom') {
    data.settings.proxy.enabled = true
  }
  return data
}

function isMissingLegacyLocalTab(
  tab: AccountTab,
  data: VaultData,
  dataDirectory: string
): boolean {
  if (
    tab.id !== DEFAULT_ACCOUNT_TAB_ID ||
    tab.source !== 'local' ||
    tab.name !== '本地账号'
  ) {
    return false
  }
  const hasData =
    data.sites.some((site) => site.tabId === tab.id) ||
    data.accounts.some((account) => account.tabId === tab.id) ||
    data.groupDefinitions.some((group) => group.tabId === tab.id) ||
    data.deletedAccounts.some((record) => record.tabId === tab.id)
  if (hasData) return false

  const fileNames = new Set([
    ...(tab.databaseFileName ? [tab.databaseFileName] : []),
    '本地账号.autologin',
    'tab-local.autologin'
  ])
  return [...fileNames].every(
    (fileName) =>
      !existsSync(join(dataDirectory, 'tabs', 'autologin', fileName)) &&
      !existsSync(join(dataDirectory, 'tabs', fileName))
  )
}
