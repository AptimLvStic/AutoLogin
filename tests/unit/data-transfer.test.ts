import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  Consts,
  Kdbx,
  KdbxCredentials,
  ProtectedValue
} from 'kdbxweb'
import {
  configureKdbxArgon2,
  mergeImportedLogins,
  parseCsvImport,
  parseKdbxImport
} from '../../src/main/data-transfer'
import { DEFAULT_APP_SETTINGS } from '../../src/shared/theme'
import type { VaultData } from '../../src/shared/types'

const directories: string[] = []

afterEach(() => {
  while (directories.length > 0) {
    rmSync(directories.pop()!, { recursive: true, force: true })
  }
})

function createDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), 'autologin-transfer-'))
  directories.push(directory)
  return directory
}

function emptyVault(): VaultData {
  return {
    schemaVersion: 1,
    sites: [],
    accounts: [],
    favoriteGroups: [],
    settings: structuredClone(DEFAULT_APP_SETTINGS)
  }
}

describe('data transfer', () => {
  it('parses a standard CSV template and merges valid rows transactionally', async () => {
    const directory = createDirectory()
    const path = join(directory, 'accounts.csv')
    writeFileSync(
      path,
      [
        '\uFEFFsiteName,startUrl,siteGroup,username,password,autoSubmit,favorite',
        '"Work portal","https://work.example/login","工作","first@example.com","one","true","false"',
        '"Work portal","https://work.example/login","工作","second@example.com","two","yes","1"',
        '"Broken","https://broken.example/login","","missing-password","","true","false"'
      ].join('\r\n'),
      'utf8'
    )

    const parsed = await parseCsvImport(path)
    expect(parsed.candidates).toHaveLength(2)
    expect(parsed.skipped).toBe(1)
    expect(parsed.warnings[0]).toContain('第 4 行')
    expect(parsed.warnings[0]).not.toContain('missing-password')

    const merged = mergeImportedLogins(emptyVault(), 'csv', parsed)
    expect(merged.result).toMatchObject({
      source: 'csv',
      sitesCreated: 1,
      accountsCreated: 2,
      skipped: 1
    })
    expect(merged.data.sites[0]).toMatchObject({
      name: 'Work portal',
      group: '工作',
      autoSubmit: true
    })
    expect(merged.data.accounts.map((account) => account.password)).toEqual(['one', 'two'])
    expect(merged.data.accounts[1]?.favorite).toBe(true)
  })

  it('skips duplicate credentials and rejects conflicting site URLs', async () => {
    const directory = createDirectory()
    const path = join(directory, 'duplicates.csv')
    writeFileSync(
      path,
      [
        'siteName,startUrl,siteGroup,username,password,autoSubmit,favorite',
        '"Existing","https://example.com/login","","same@example.com","secret","true","false"'
      ].join('\r\n'),
      'utf8'
    )
    const parsed = await parseCsvImport(path)
    const vault = emptyVault()
    const first = mergeImportedLogins(vault, 'csv', parsed)
    const second = mergeImportedLogins(first.data, 'csv', parsed)
    expect(second.result.accountsCreated).toBe(0)
    expect(second.result.skipped).toBe(1)
    expect(second.result.warnings[0]).toContain('相同用户名')
  })

  it('imports KeePassXC entries from an Argon2d KDBX database', async () => {
    const directory = createDirectory()
    const path = join(directory, 'passwords.kdbx')
    await writeKdbxFixture(path, Consts.KdfId.Argon2d)

    const parsed = await parseKdbxImport(path, 'correct horse battery staple')
    expect(parsed.warnings).toEqual([])
    expect(parsed.candidates).toHaveLength(1)
    expect(parsed.candidates[0]).toMatchObject({
      siteName: 'KeePass Portal',
      startUrl: 'https://keepass.example/login',
      username: 'keeper@example.com',
      password: 'keepass-secret',
      siteGroup: '工作'
    })

    await expect(parseKdbxImport(path, 'wrong password')).rejects.toThrow(
      '无法解密此 KeePassXC 数据库'
    )
  })

  it('imports KeePassXC entries from an Argon2id KDBX database', async () => {
    const directory = createDirectory()
    const path = join(directory, 'passwords-argon2id.kdbx')
    await writeKdbxFixture(path, Consts.KdfId.Argon2id)

    const parsed = await parseKdbxImport(path, 'correct horse battery staple')
    expect(parsed.candidates).toHaveLength(1)
    expect(parsed.candidates[0]).toMatchObject({
      siteName: 'KeePass Portal',
      username: 'keeper@example.com',
      password: 'keepass-secret'
    })
  })
})

async function writeKdbxFixture(path: string, kdf: string): Promise<void> {
  configureKdbxArgon2()
  const credentials = new KdbxCredentials(
    ProtectedValue.fromString('correct horse battery staple')
  )
  await credentials.ready
  const database = Kdbx.create(credentials, 'AutoLogin Test')
  database.setKdf(kdf)
  const root = database.getDefaultGroup()
  const group = database.createGroup(root, '工作')
  const entry = database.createEntry(group)
  entry.fields.set('Title', 'KeePass Portal')
  entry.fields.set('URL', 'https://keepass.example/login')
  entry.fields.set('UserName', 'keeper@example.com')
  entry.fields.set('Password', ProtectedValue.fromString('keepass-secret'))
  writeFileSync(path, Buffer.from(await database.save()))
}
