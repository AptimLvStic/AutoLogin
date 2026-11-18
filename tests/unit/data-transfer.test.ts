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
  CSV_TEMPLATE,
  configureKdbxArgon2,
  mergeAutologinSnapshot,
  mergeImportedLogins,
  parseBookmarksImport,
  parseCsvImport,
  parseKdbxImport,
  serializeTabCsv
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
    tabs: [
      {
        id: 'local',
        name: '本地账号',
        color: '#5C6BFF',
        source: 'local',
        hidden: false,
        createdAt: '1970-01-01T00:00:00.000Z',
        updatedAt: '1970-01-01T00:00:00.000Z'
      }
    ],
    sites: [],
    accounts: [],
    groupDefinitions: [],
    deletedAccounts: [],
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
    expect(parsed.skipDetails[0]).toMatchObject({
      rowNumber: 4,
      title: 'Broken',
      reason: '密码为空'
    })

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

  it('skips duplicate credentials without creating duplicate sites', async () => {
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

  it('imports same-title KDBX entries with different URLs under unique names', () => {
    const parsed = {
      candidates: [
        {
          siteName: 'VPN',
          startUrl: 'https://vpn-a.example/login',
          siteGroup: '大兴',
          username: 'user-a',
          password: 'secret-a',
          autoSubmit: true,
          favorite: false,
          rowNumber: 1
        },
        {
          siteName: 'VPN',
          startUrl: 'https://vpn-b.example/login',
          siteGroup: '亦庄',
          username: 'user-b',
          password: 'secret-b',
          autoSubmit: true,
          favorite: false,
          rowNumber: 2
        },
        {
          siteName: 'VPN',
          startUrl: 'https://vpn-a.example/login',
          siteGroup: '大兴',
          username: 'user-c',
          password: 'secret-c',
          autoSubmit: true,
          favorite: false,
          rowNumber: 3
        }
      ],
      warnings: [],
      skipped: 0,
      skipDetails: []
    }

    const merged = mergeImportedLogins(emptyVault(), 'kdbx', parsed)

    expect(merged.result).toMatchObject({
      sitesCreated: 2,
      accountsCreated: 3,
      skipped: 0
    })
    expect(merged.data.sites.map((site) => site.name)).toEqual([
      'VPN',
      'VPN (2)'
    ])
    expect(merged.result.warnings[0]).toContain(
      '同名但登录地址不同，已导入为“VPN (2)”'
    )
    expect(
      merged.data.accounts.filter(
        (account) => account.siteId === merged.data.sites[0]?.id
      )
    ).toHaveLength(2)
  })

  it('opens an AutoLogin snapshot with its exact file name instead of appending a copy suffix', () => {
    const imported = emptyVault()
    imported.tabs[0] = {
      ...imported.tabs[0]!,
      name: '本地数据库 4'
    }
    imported.sites = [
      {
        id: 'site-4',
        tabId: 'local',
        name: 'Example',
        startUrl: 'https://example.com/login',
        allowedOrigins: ['https://example.com'],
        autoSubmit: true,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z'
      }
    ]
    imported.accounts = [
      {
        id: 'account-4',
        tabId: 'local',
        siteId: 'site-4',
        label: 'Example',
        username: 'user@example.com',
        password: 'secret',
        favorite: false,
        loginStrategy: 'auto',
        loginBrowser: 'standalone',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z'
      }
    ]

    const merged = mergeAutologinSnapshot(emptyVault(), imported, {
      preferredTabName: '本地数据库 4',
      allowSuffixOnConflict: false
    })
    expect(merged.result.tabName).toBe('本地数据库 4')
    expect(merged.data.tabs.at(-1)?.databaseFileName).toBe('本地数据库 4.autologin')

    expect(() =>
      mergeAutologinSnapshot(merged.data, imported, {
        preferredTabName: '本地数据库 4',
        allowSuffixOnConflict: false
      })
    ).toThrow('未创建副本')
  })

  it('decodes GB18030 CSV files so Chinese site data is not garbled', async () => {
    const directory = createDirectory()
    const path = join(directory, 'gb18030.csv')
    writeFileSync(
      path,
      Buffer.from(
        '736974654e616d652c737461727455726c2c7369746547726f75702c757365726e616d652c70617373776f72642c6175746f5375626d69742c6661766f726974650d0ad6d0cec4d5beb5e32c68747470733a2f2f6578616d706c652e636f6d2f6c6f67696e2cb9a4d7f72c75736572406578616d706c652e636f6d2c7365637265742c747275652c66616c73650d0a',
        'hex'
      )
    )

    const parsed = await parseCsvImport(path)
    expect(parsed.candidates[0]).toMatchObject({
      siteName: '中文站点',
      siteGroup: '工作',
      username: 'user@example.com'
    })
  })

  it('accepts literal quotes and hash characters in CSV password fields', async () => {
    const directory = createDirectory()
    const path = join(directory, 'literal-quotes.csv')
    writeFileSync(
      path,
      [
        '\uFEFF站点名称,登录地址,分组,用户名,密码,自动提交',
        '# 这一行是模板注释，不应影响后面的字段',
        '站点 A,https://a.example/login,分组,admin,eY%zE/_"s9GY,TRUE',
        '站点 B,https://b.example/login,分组,admin,#acTe"\'8>yae,TRUE',
        '站点 C,https://c.example/login,分组,admin,"BZbA|mT,e7C1",TRUE'
      ].join('\r\n'),
      'utf8'
    )

    const parsed = await parseCsvImport(path)
    expect(parsed.candidates.map((candidate) => candidate.password)).toEqual([
      'eY%zE/_"s9GY',
      '#acTe"\'8>yae',
      'BZbA|mT,e7C1'
    ])
  })

  it('turns slash-delimited CSV groups into parent and child groups', async () => {
    const directory = createDirectory()
    const path = join(directory, 'nested-groups.csv')
    writeFileSync(
      path,
      [
        '\uFEFF站点名称,登录地址,分组,用户名,密码,自动提交',
        '站点 A,https://a.example/login,中联航/亦庄,user-a,one,true',
        '站点 B,https://b.example/login,中联航 / 大兴,user-b,two,true'
      ].join('\r\n'),
      'utf8'
    )

    const parsed = await parseCsvImport(path)
    expect(parsed.candidates.map((candidate) => candidate.siteGroup)).toEqual([
      '中联航 / 亦庄',
      '中联航 / 大兴'
    ])

    const merged = mergeImportedLogins(emptyVault(), 'csv', parsed)
    expect(
      merged.data.groupDefinitions
        .filter((group) => group.tabId === 'local')
        .map((group) => group.path)
    ).toEqual(['中联航', '中联航 / 亦庄', '中联航 / 大兴'])
    expect(merged.result).toMatchObject({
      groupsCreated: 3,
      maxDepth: 2,
      groupPaths: ['中联航 / 亦庄', '中联航 / 大兴']
    })
    expect(merged.data.sites.map((site) => site.group)).toEqual([
      '中联航 / 亦庄',
      '中联航 / 大兴'
    ])
  })

  it('adds https to host-only import URLs and records missing fields in skip details', async () => {
    const directory = createDirectory()
    const path = join(directory, 'host-only.csv')
    writeFileSync(
      path,
      [
        '\uFEFF站点名称,登录地址,分组,用户名,密码,自动提交',
        '内网站点,nas.local/login,工作,user-a,one,true',
        '缺地址,,工作,user-b,two,true'
      ].join('\r\n'),
      'utf8'
    )

    const parsed = await parseCsvImport(path)
    expect(parsed.candidates[0]).toMatchObject({
      startUrl: 'https://nas.local/login',
      siteGroup: '工作'
    })
    expect(parsed.skipped).toBe(1)
    expect(parsed.skipDetails[0]).toMatchObject({
      rowNumber: 3,
      title: '缺地址',
      reason: '登录地址为空'
    })
  })

  it('exports and imports the localized CSV template without a favorite column', async () => {
    expect(CSV_TEMPLATE.split(/\r?\n/)[4]).toBe(
      '站点名称,登录地址,分组,用户名,密码,自动提交'
    )
    expect(CSV_TEMPLATE).toContain('父分组 / 子分组')
    expect(CSV_TEMPLATE).toContain('中联航/亦庄')
    expect(CSV_TEMPLATE.split(/\r?\n/)[5]).toContain('"中联航 / 亦庄"')
    expect(CSV_TEMPLATE).not.toContain('favorite')

    const directory = createDirectory()
    const path = join(directory, 'localized.csv')
    writeFileSync(
      path,
      [
        '\uFEFF站点名称,登录地址,分组,用户名,密码,自动提交',
        '"中文站点","https://zh.example/login","工作","user@example.com","secret","false"'
      ].join('\r\n'),
      'utf8'
    )

    const parsed = await parseCsvImport(path)
    expect(parsed.candidates[0]).toMatchObject({
      siteName: '中文站点',
      siteGroup: '工作',
      username: 'user@example.com',
      autoSubmit: false,
      favorite: false
    })
    expect(serializeTabCsv(emptyVault(), 'local')).toBe(
      '\uFEFF站点名称,登录地址,分组,用户名,密码,自动提交\r\n'
    )
  })

  it('imports browser bookmark folders and ignores unsafe URLs', async () => {
    const directory = createDirectory()
    const path = join(directory, 'bookmarks.html')
    writeFileSync(
      path,
      `<!DOCTYPE NETSCAPE-Bookmark-file-1>
<DL><p>
  <DT><H3>工作</H3>
  <DL><p>
    <DT><H3>客户</H3>
    <DL><p>
      <DT><A HREF="https://example.com/login?from=bookmark">示例 &amp; 站点</A>
    </DL><p>
    <DT><A HREF="javascript:alert(1)">危险链接</A>
  </DL><p>
</DL><p>`,
      'utf8'
    )

    const parsed = await parseBookmarksImport(path)
    expect(parsed.skipped).toBe(1)
    expect(parsed.candidates).toHaveLength(1)
    expect(parsed.candidates[0]).toMatchObject({
      siteName: '示例 & 站点',
      startUrl: 'https://example.com/login?from=bookmark',
      siteGroup: '工作 / 客户',
      username: '',
      password: ''
    })

    const vault = emptyVault()
    vault.tabs.push({
      id: 'bookmarks',
      name: 'Chrome 书签',
      color: '#D97706',
      source: 'bookmarks',
      hidden: false,
      createdAt: '1970-01-01T00:00:00.000Z',
      updatedAt: '1970-01-01T00:00:00.000Z'
    })
    const merged = mergeImportedLogins(vault, 'bookmarks', parsed, 'bookmarks')
    expect(
      merged.data.groupDefinitions.map(({ tabId, path }) => ({ tabId, path }))
    ).toEqual([
      { tabId: 'bookmarks', path: '工作' },
      { tabId: 'bookmarks', path: '工作 / 客户' }
    ])
    expect(merged.data.settings.groupOrders).toEqual({
      bookmarks: ['工作', '工作 / 客户']
    })
    expect(merged.data.settings.groupOrder).toEqual([])
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

  it('preserves full KeePassXC parent group paths from nested groups', async () => {
    const directory = createDirectory()
    const path = join(directory, 'nested-groups.kdbx')
    await writeNestedKdbxFixture(path)

    const parsed = await parseKdbxImport(path, 'correct horse battery staple')
    expect(parsed.candidates.map((candidate) => candidate.siteGroup)).toEqual([
      '工作 / 邮件',
      '个人 / 邮件'
    ])
    expect(parsed.skipDetails).toHaveLength(1)
    expect(parsed.skipDetails[0]).toMatchObject({
      title: '无地址条目',
      reason: '登录地址为空'
    })

    const merged = mergeImportedLogins(emptyVault(), 'kdbx', parsed)
    expect(merged.result).toMatchObject({
      groupsCreated: 4,
      maxDepth: 2,
      groupPaths: ['工作 / 邮件', '个人 / 邮件']
    })
    expect(
      merged.data.groupDefinitions.map((group) => group.path)
    ).toEqual(['工作', '工作 / 邮件', '个人', '个人 / 邮件'])
  })

  it('derives an untitled KeePassXC site name from a protocol-less URL', async () => {
    const directory = createDirectory()
    const path = join(directory, 'host-only.kdbx')
    await writeHostOnlyKdbxFixture(path)

    const parsed = await parseKdbxImport(path, 'correct horse battery staple')
    expect(parsed.candidates).toHaveLength(1)
    expect(parsed.candidates[0]).toMatchObject({
      siteName: 'nas.local',
      startUrl: 'https://nas.local/login',
      siteGroup: '内网'
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

async function writeNestedKdbxFixture(path: string): Promise<void> {
  configureKdbxArgon2()
  const credentials = new KdbxCredentials(
    ProtectedValue.fromString('correct horse battery staple')
  )
  await credentials.ready
  const database = Kdbx.create(credentials, 'AutoLogin Test')
  database.setKdf(Consts.KdfId.Argon2id)
  const root = database.getDefaultGroup()
  const work = database.createGroup(root, '工作')
  const workMail = database.createGroup(work, '邮件')
  const personal = database.createGroup(root, '个人')
  const personalMail = database.createGroup(personal, '邮件')

  const workEntry = database.createEntry(workMail)
  workEntry.fields.set('Title', '工作邮箱')
  workEntry.fields.set('URL', 'https://mail.work.example/login')
  workEntry.fields.set('UserName', 'work@example.com')
  workEntry.fields.set('Password', ProtectedValue.fromString('work-secret'))

  const personalEntry = database.createEntry(personalMail)
  personalEntry.fields.set('Title', '个人邮箱')
  personalEntry.fields.set('URL', 'mail.personal.example/login')
  personalEntry.fields.set('UserName', 'personal@example.com')
  personalEntry.fields.set('Password', ProtectedValue.fromString('personal-secret'))

  const incomplete = database.createEntry(work)
  incomplete.fields.set('Title', '无地址条目')
  incomplete.fields.set('UserName', 'incomplete@example.com')
  incomplete.fields.set('Password', ProtectedValue.fromString('incomplete-secret'))

  writeFileSync(path, Buffer.from(await database.save()))
}

async function writeHostOnlyKdbxFixture(path: string): Promise<void> {
  configureKdbxArgon2()
  const credentials = new KdbxCredentials(
    ProtectedValue.fromString('correct horse battery staple')
  )
  await credentials.ready
  const database = Kdbx.create(credentials, 'AutoLogin Host Only')
  database.setKdf(Consts.KdfId.Argon2id)
  const root = database.getDefaultGroup()
  const intranet = database.createGroup(root, '内网')
  const entry = database.createEntry(intranet)
  entry.fields.set('URL', 'nas.local/login')
  entry.fields.set('UserName', 'nas-user')
  entry.fields.set('Password', ProtectedValue.fromString('nas-secret'))

  writeFileSync(path, Buffer.from(await database.save()))
}
