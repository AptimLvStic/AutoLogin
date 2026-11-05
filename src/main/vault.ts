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
import { dirname, join } from 'node:path'
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

interface VaultEnvelope {
  format: 'autologin-vault'
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

export class VaultError extends Error {
  constructor(
    message: string,
    readonly code: 'WRONG_PASSWORD' | 'CORRUPTED' | 'LOCKED' | 'EXISTS' | 'INVALID'
  ) {
    super(message)
    this.name = 'VaultError'
  }
}

export class VaultManager {
  private readonly vaultPath: string
  private readonly backupPath: string
  private key: Buffer | null = null
  private salt: Buffer | null = null
  private data: VaultData | null = null
  private lockTimer: NodeJS.Timeout | null = null
  private autoLockMinutes: AutoLockMinutes = 10
  private saveListener: ((data: VaultData) => void) | null = null

  constructor(
    userDataPath: string,
    private readonly onLocked: () => void
  ) {
    mkdirSync(userDataPath, { recursive: true })
    this.vaultPath = join(userDataPath, 'vault.enc')
    this.backupPath = join(userDataPath, 'vault.enc.bak')
  }

  get path(): string {
    return this.vaultPath
  }

  get backup(): string {
    return this.backupPath
  }

  status(): VaultStatus {
    return {
      initialized: existsSync(this.vaultPath),
      unlocked: this.data !== null,
      autoLockMinutes: this.autoLockMinutes
    }
  }

  async create(masterPassword: string): Promise<VaultStatus> {
    if (existsSync(this.vaultPath)) {
      throw new VaultError('保险库已存在', 'EXISTS')
    }

    const data: VaultData = {
      schemaVersion: 1,
      tabs: [createLocalTab()],
      sites: [],
      accounts: [],
      groupDefinitions: [],
      deletedAccounts: [],
      favoriteGroups: [],
      settings: structuredClone(DEFAULT_APP_SETTINGS)
    }

    const salt = randomBytes(SALT_LENGTH)
    const key = await deriveKey(masterPassword, salt)
    this.data = data
    this.key = key
    this.salt = salt
    this.autoLockMinutes = data.settings.autoLockMinutes
    this.writeEncrypted()
    this.scheduleLock()
    return this.status()
  }

  async unlock(masterPassword: string): Promise<VaultStatus> {
    if (!existsSync(this.vaultPath)) {
      throw new VaultError('保险库尚未创建', 'INVALID')
    }

    try {
      const decrypted = await this.decryptFile(this.vaultPath, masterPassword)
      this.applyDecrypted(decrypted)
    } catch (error) {
      if (!existsSync(this.backupPath)) {
        throw normalizeUnlockError(error)
      }

      try {
        const recovered = await this.decryptFile(this.backupPath, masterPassword)
        copyFileSync(this.backupPath, this.vaultPath)
        this.applyDecrypted(recovered)
      } catch {
        throw normalizeUnlockError(error)
      }
    }

    this.scheduleLock()
    return this.status()
  }

  lock(): VaultStatus {
    this.clearLockTimer()
    if (this.key) {
      this.key.fill(0)
    }
    this.key = null
    this.salt = null
    this.data = null
    this.onLocked()
    return this.status()
  }

  touch(): void {
    if (this.data) {
      this.scheduleLock()
    }
  }

  setSaveListener(listener: ((data: VaultData) => void) | null): void {
    this.saveListener = listener
  }

  requireData(): VaultData {
    if (!this.data) {
      throw new VaultError('保险库已锁定', 'LOCKED')
    }
    this.touch()
    return this.data
  }

  save(): void {
    this.requireData()
    this.writeEncrypted()
    this.touch()
  }

  getSettings(): AppSettings {
    return structuredClone(this.requireData().settings)
  }

  updateSettings(patch: AppSettingsPatch): AppSettings {
    const data = this.requireData()
    data.settings = {
      ...data.settings,
      ...patch,
      ...(patch.proxy ? { proxy: { ...data.settings.proxy, ...patch.proxy } } : {}),
      ...(patch.customTheme
        ? { customTheme: { ...data.settings.customTheme, ...patch.customTheme } }
        : {})
    }
    this.autoLockMinutes = data.settings.autoLockMinutes
    this.save()
    this.scheduleLock()
    return structuredClone(data.settings)
  }

  async changePassword(currentPassword: string, nextPassword: string): Promise<void> {
    const data = this.requireData()
    const envelope = this.readEnvelope(this.vaultPath)

    try {
      await decryptEnvelope(envelope, currentPassword)
    } catch {
      throw new VaultError('当前主密码不正确', 'WRONG_PASSWORD')
    }

    const nextSalt = randomBytes(SALT_LENGTH)
    const nextKey = await deriveKey(nextPassword, nextSalt)
    if (this.key) {
      this.key.fill(0)
    }
    this.key = nextKey
    this.salt = nextSalt
    this.data = data
    this.writeEncrypted()
    // The previous backup was encrypted with the old password, so replace it
    // with the newly encrypted vault to prevent the old key from unlocking it.
    copyFileSync(this.vaultPath, this.backupPath)
    this.scheduleLock()
  }

  copyEncryptedTo(destination: string): void {
    this.requireData()
    this.readEnvelope(this.vaultPath)
    copyFileSync(this.vaultPath, destination)
  }

  async readEncryptedSnapshot(path: string, password: string): Promise<VaultData> {
    try {
      const decrypted = await this.decryptFile(path, password)
      const data = structuredClone(decrypted.data)
      decrypted.key.fill(0)
      return data
    } catch (error) {
      throw normalizeUnlockError(error)
    }
  }

  writeEncryptedSnapshot(destination: string, snapshot: VaultData): void {
    this.requireData()
    this.writeEnvelope(destination, snapshot)
  }

  restoreEncryptedFrom(sourcePath: string): VaultStatus {
    this.readEnvelope(sourcePath)
    this.clearLockTimer()
    if (this.key) {
      this.key.fill(0)
    }
    this.key = null
    this.salt = null
    this.data = null

    const tempPath = `${this.vaultPath}.${process.pid}.restore.tmp`
    mkdirSync(dirname(this.vaultPath), { recursive: true })
    copyFileSync(sourcePath, tempPath)
    try {
      const file = openSync(tempPath, 'r+')
      try {
        fsyncSync(file)
      } finally {
        closeSync(file)
      }
      if (existsSync(this.vaultPath)) {
        rmSync(this.vaultPath, { force: true })
      }
      renameSync(tempPath, this.vaultPath)
      copyFileSync(this.vaultPath, this.backupPath)
    } catch (error) {
      rmSync(tempPath, { force: true })
      throw error
    }
    this.onLocked()
    return this.status()
  }

  clearAllFiles(): void {
    this.lock()
    for (const filePath of [this.vaultPath, this.backupPath]) {
      if (existsSync(filePath)) {
        rmSync(filePath, { force: true })
      }
    }
  }

  private applyDecrypted(decrypted: DecryptedEnvelope): void {
    if (this.key) {
      this.key.fill(0)
    }
    const normalized = normalizeVaultData(decrypted.data)
    this.data = normalized
    this.key = decrypted.key
    this.salt = decrypted.salt
    this.autoLockMinutes = normalized.settings.autoLockMinutes
    if (JSON.stringify(normalized) !== JSON.stringify(decrypted.data)) {
      this.writeEncrypted()
    }
  }

  private async decryptFile(path: string, password: string): Promise<DecryptedEnvelope> {
    const envelope = this.readEnvelope(path)
    const result = await decryptEnvelope(envelope, password)
    const parsed = vaultDataSchema.safeParse(result.data)
    if (!parsed.success) {
      throw new VaultError('保险库数据结构无效', 'CORRUPTED')
    }
    return {
      data: parsed.data as VaultData,
      key: result.key,
      salt: Buffer.from(envelope.kdf.salt, 'base64')
    }
  }

  private readEnvelope(path: string): VaultEnvelope {
    try {
      const parsed = JSON.parse(readFileSync(path, 'utf8')) as Partial<VaultEnvelope>
      if (
        parsed.format !== 'autologin-vault' ||
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
      throw new VaultError('保险库文件已损坏或格式不正确', 'CORRUPTED')
    }
  }

  private writeEncrypted(): void {
    if (!this.key || !this.salt || !this.data) {
      throw new VaultError('保险库已锁定', 'LOCKED')
    }
    this.writeEnvelope(this.vaultPath, this.data, true)
    this.saveListener?.(this.data)
  }

  private writeEnvelope(
    destination: string,
    snapshot: VaultData,
    updateBackup = false
  ): void {
    if (!this.key || !this.salt) {
      throw new VaultError('保险库已锁定', 'LOCKED')
    }

    const plaintext = Buffer.from(JSON.stringify(snapshot), 'utf8')
    const iv = randomBytes(IV_LENGTH)
    const cipher = createCipheriv('aes-256-gcm', this.key, iv)
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()])
    const tag = cipher.getAuthTag()

    const envelope: VaultEnvelope = {
      format: 'autologin-vault',
      version: 1,
      kdf: {
        name: 'argon2id',
        salt: this.salt.toString('base64'),
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

    const tempPath = `${destination}.${process.pid}.tmp`
    mkdirSync(dirname(destination), { recursive: true })
    const file = openSync(tempPath, 'w', 0o600)
    try {
      writeSync(file, JSON.stringify(envelope))
      fsyncSync(file)
    } finally {
      closeSync(file)
    }

    if (updateBackup && existsSync(this.vaultPath)) {
      copyFileSync(this.vaultPath, this.backupPath)
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

  private scheduleLock(): void {
    this.clearLockTimer()
    if (!this.data) {
      return
    }
    this.lockTimer = setTimeout(() => {
      this.lock()
    }, this.autoLockMinutes * 60 * 1000)
    this.lockTimer.unref()
  }

  private clearLockTimer(): void {
    if (this.lockTimer) {
      clearTimeout(this.lockTimer)
      this.lockTimer = null
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
    throw new VaultError('主密码不正确或保险库已损坏', 'WRONG_PASSWORD')
  }
}

function normalizeUnlockError(error: unknown): VaultError {
  if (error instanceof VaultError) {
    return error
  }
  return new VaultError('主密码不正确或保险库已损坏', 'WRONG_PASSWORD')
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
    name: '本地账号',
    color: ACCOUNT_TAB_COLORS[0],
    source: 'local',
    hidden: false,
    createdAt: now,
    updatedAt: now
  }
}

function normalizeVaultData(input: VaultData): VaultData {
  const data = structuredClone(input)
  const tabsById = new Map<string, AccountTab>()
  for (const tab of data.tabs) {
    if (!tabsById.has(tab.id)) tabsById.set(tab.id, tab)
  }
  if (!tabsById.has(DEFAULT_ACCOUNT_TAB_ID)) {
    const local = createLocalTab()
    data.tabs.unshift(local)
    tabsById.set(local.id, local)
  }
  data.tabs = [...tabsById.values()]

  const normalizeTabId = (tabId: string | undefined): string =>
    tabId && tabsById.has(tabId) ? tabId : DEFAULT_ACCOUNT_TAB_ID

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

  if (!data.settings.groupOrders[DEFAULT_ACCOUNT_TAB_ID] && data.settings.groupOrder.length > 0) {
    data.settings.groupOrders[DEFAULT_ACCOUNT_TAB_ID] = [...data.settings.groupOrder]
  }
  if (data.settings.proxy.mode === 'custom') {
    data.settings.proxy.enabled = true
  }
  return data
}
