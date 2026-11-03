import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test'
import { assertChromiumBrowser, discoverDefaultBrowser } from '../../src/main/browser-discovery'
import { CdpClient } from '../../src/main/cdp-client'
import { startFixtureServer, type FixtureServer } from './fixtures'

const electronPath =
  process.env.AUTOLOGIN_ELECTRON_PATH?.trim() || (require('electron') as string)
const workspace = process.cwd()
const e2eDataRoot = resolve(workspace, 'work', 'e2e-data')
const defaultBrowser = discoverDefaultBrowser(
  process.env.AUTOLOGIN_BROWSER_EXECUTABLE?.trim() || undefined
)
assertChromiumBrowser(defaultBrowser)

test.describe.configure({ mode: 'serial' })

let application: ElectronApplication
let page: Page
let server: FixtureServer
let untrustedServer: FixtureServer
let userDataDirectory: string

test.beforeAll(async () => {
  mkdirSync(e2eDataRoot, { recursive: true })
  server = await startFixtureServer()
  untrustedServer = await startFixtureServer()
})

test.beforeEach(async () => {
  userDataDirectory = mkdtempSync(join(e2eDataRoot, 'profile-'))
  application = await electron.launch({
    executablePath: electronPath,
    args: [
      ...(process.env.AUTOLOGIN_E2E_NO_SANDBOX === '1'
        ? ['--no-sandbox', '--disable-gpu']
        : []),
      join(workspace, 'out', 'main', 'index.js')
    ],
    cwd: workspace,
    env: {
      ...process.env,
      AUTOLOGIN_USER_DATA_DIR: userDataDirectory,
      AUTOLOGIN_BROWSER_EXECUTABLE: defaultBrowser.executablePath,
      AUTOLOGIN_BROWSER_HEADLESS: '1',
      AUTOLOGIN_E2E_DISABLE_SANDBOX:
        process.env.AUTOLOGIN_E2E_NO_SANDBOX === '1' ? '1' : '0',
      ELECTRON_ENABLE_LOGGING: process.env.ELECTRON_ENABLE_LOGGING ?? '0',
      LOCALAPPDATA: resolve(workspace, 'work', 'appdata')
    }
  })
  page = await application.firstWindow()
  await page.waitForLoadState('domcontentloaded')
})

test.afterEach(async () => {
  try {
    if (page && !page.isClosed()) {
      await page.evaluate(() => window.autologin.login.close()).catch(() => undefined)
    }
    if (application) {
      await application.close()
    }
  } finally {
    await waitFor(async () => !findExternalBrowserEndpoint(), 3_000).catch(() => undefined)
    rmSync(userDataDirectory, {
      recursive: true,
      force: true,
      maxRetries: 20,
      retryDelay: 200
    })
  }
})

test.afterAll(async () => {
  await Promise.all([server.close(), untrustedServer.close()])
})

test('uses the Windows default browser, reuses the session and clears it', async () => {
  await createVault(page)
  await addAccount(page, {
    siteName: '标准登录',
    startUrl: `${server.baseUrl}/login`,
    label: '主账号',
    username: 'tester@example.test',
    password: 'secret-password'
  })

  await page.locator('.account-row').first().click()
  const detailsDrawer = page.locator('.account-drawer')
  await detailsDrawer.getByRole('button', { name: '复制用户名' }).click()
  await expect(page.getByRole('status')).toContainText('用户名已复制')
  expect(await application.evaluate(({ clipboard }) => clipboard.readText())).toBe(
    'tester@example.test'
  )
  await detailsDrawer.getByRole('button', { name: '复制密码' }).click()
  await expect(page.getByRole('status')).toContainText('密码已复制')
  expect(await application.evaluate(({ clipboard }) => clipboard.readText())).toBe(
    'secret-password'
  )
  await page.locator('.drawer-backdrop').click({ position: { x: 10, y: 10 } })

  const firstBatchId = await currentBatchId(page)
  await page.locator('.account-row').first().getByRole('button', { name: '登录' }).click()
  await waitForNewBatch(page, firstBatchId, {
    active: false,
    success: 1,
    failed: 0,
    manual: 0
  })
  await expect.poll(() => targetSnapshot(application, server.baseUrl)).toMatchObject({
    found: true,
    pathname: '/home',
    welcome: 'Welcome back'
  })
  expect(existsSync(join(userDataDirectory, 'BrowserProfiles', 'batch'))).toBe(true)
  expect(
    await application.evaluate(
      ({ webContents }, baseUrl) =>
        webContents.getAllWebContents().some((contents) => contents.getURL().startsWith(baseUrl)),
      server.baseUrl
    )
  ).toBe(false)
  expect(
    await evaluateInTarget(
      application,
      server.baseUrl,
      `({
        requireType: typeof window.require,
        processType: typeof window.process,
        autologinType: typeof window.autologin
      })`
    )
  ).toEqual({
    requireType: 'undefined',
    processType: 'undefined',
    autologinType: 'undefined'
  })

  await page.getByRole('button', { name: '立即锁定' }).click()
  await expect(page.getByRole('heading', { name: '保险库已锁定' })).toBeVisible()

  await page.getByPlaceholder('输入主密码').fill('correct horse battery staple')
  await page.getByRole('button', { name: '解锁保险库' }).click()
  await expect(page.getByRole('heading', { name: '全部账号' })).toBeVisible()

  const secondBatchId = await currentBatchId(page)
  await page.locator('.account-row').first().getByRole('button', { name: '登录' }).click()
  await waitForNewBatch(page, secondBatchId, {
    active: false,
    success: 1,
    failed: 0,
    manual: 0
  })
  await expect
    .poll(() => targetSnapshot(application, server.baseUrl), { timeout: 15000 })
    .toMatchObject({ found: true, pathname: '/home' })

  await page.locator('.account-row').first().click()
  const drawer = page.locator('.account-drawer')
  await expect(drawer).toBeVisible()
  await drawer.getByRole('button', { name: '清除会话' }).click()
  const confirm = page.locator('.confirm-dialog')
  await expect(confirm).toBeVisible()
  await confirm.getByRole('button', { name: '清除会话' }).click()
  await expect(page.locator('.toast')).toContainText('网站会话已清除')
  expect(existsSync(join(userDataDirectory, 'BrowserProfiles', 'batch'))).toBe(false)
  await page.locator('.drawer-backdrop').click({ position: { x: 10, y: 10 } })

  const thirdBatchId = await currentBatchId(page)
  await page.locator('.account-row').first().getByRole('button', { name: '登录' }).click()
  await waitForNewBatch(page, thirdBatchId, {
    active: false,
    success: 1,
    failed: 0,
    manual: 0
  })
  await expect
    .poll(() => targetSnapshot(application, server.baseUrl), { timeout: 15000 })
    .toMatchObject({ found: true, pathname: '/home' })
})

test('pauses on a captcha and resumes after manual verification', async () => {
  await createVault(page)
  await addAccount(page, {
    siteName: '验证码登录',
    startUrl: `${server.baseUrl}/captcha`,
    label: '验证码账号',
    username: 'tester@example.test',
    password: 'secret-password',
    group: '安全'
  })

  const previousBatchId = await currentBatchId(page)
  await page.locator('.account-row').first().getByRole('button', { name: '登录' }).click()
  await waitForNewBatch(page, previousBatchId, {
    active: false,
    success: 0,
    failed: 1,
    manual: 1
  })
  await expect
    .poll(() => targetSnapshot(application, server.baseUrl), { timeout: 15000 })
    .toMatchObject({
      found: true,
      pathname: '/captcha',
      username: 'tester@example.test',
      password: 'secret-password',
      activeName: 'verificationCode'
    })
  await expect(page.locator('.batch-status')).toContainText('成功 0 / 失败 1 · 待人工 1')
  await page.locator('.batch-status').click()
  const logsPage = page.locator('.logs-page')
  await expect(logsPage.getByRole('heading', { name: '登录日志' })).toBeVisible()
  await expect(logsPage.locator('.log-table__row')).toContainText('验证码账号')
  await expect(logsPage.locator('.log-table__row')).toContainText('待人工')

  const today = await page.evaluate(() => {
    const date = new Date()
    return [
      date.getFullYear(),
      String(date.getMonth() + 1).padStart(2, '0'),
      String(date.getDate()).padStart(2, '0')
    ].join('-')
  })
  await logsPage.getByLabel('日期').fill(today)
  await logsPage.getByLabel('账号').selectOption({ label: '验证码账号' })
  await logsPage.getByLabel('分组').selectOption({ label: '安全' })
  await logsPage.getByLabel('状态').selectOption('manual')
  await logsPage.getByLabel('每页条数').selectOption('10')
  await expect(logsPage.locator('.log-table__row')).toHaveCount(1)
  await page.locator('.sidebar-nav__item').filter({ hasText: '全部账号' }).click()

  const failureLog = join(userDataDirectory, 'logs', 'login-failures.jsonl')
  await expect
    .poll(() => (existsSync(failureLog) ? readFileSync(failureLog, 'utf8') : ''), {
      timeout: 5000
    })
    .toContain('"status":"manual"')
  const logContents = readFileSync(failureLog, 'utf8')
  expect(logContents).not.toContain('secret-password')
  expect(logContents).not.toContain('tester@example.test')
  expect(logContents).not.toContain(server.baseUrl)

  await executeInTarget(
    application,
    server.baseUrl,
    `(() => {
      const otp = document.querySelector('#otp');
      otp.value = '123456';
      otp.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: '123456' }));
      otp.dispatchEvent(new Event('change', { bubbles: true }));
      document.querySelector('#captcha-submit').click();
    })();`
  )

  await expect.poll(() => targetSnapshot(application, server.baseUrl), { timeout: 15000 }).toMatchObject({
    found: true,
    pathname: '/home'
  })
  await waitForBatch(page, {
    active: false,
    success: 1,
    failed: 0,
    manual: 0
  })
  await expect(page.locator('.batch-status')).toContainText('成功 1 / 失败 0')
})

test('stops automation when a site redirects outside trusted origins', async () => {
  await createVault(page)
  const crossOriginUrl = `${server.baseUrl}/cross-origin?target=${encodeURIComponent(
    `${untrustedServer.baseUrl}/login`
  )}`
  await addAccount(page, {
    siteName: '跨域跳转',
    startUrl: crossOriginUrl,
    label: '跨域账号',
    username: 'tester@example.test',
    password: 'secret-password'
  })

  const previousBatchId = await currentBatchId(page)
  await page.locator('.account-row').first().getByRole('button', { name: '登录' }).click()
  await waitForNewBatch(page, previousBatchId, {
    active: false,
    success: 0,
    failed: 1,
    manual: 1
  })
  const batchState = await page.evaluate(() => window.autologin.login.getBatchState())
  expect(batchState?.items[0]?.message).toContain('未授权域名')
  await expect(page.locator('.batch-status')).toContainText('成功 0 / 失败 1 · 待人工 1')
  const failureLog = join(userDataDirectory, 'logs', 'login-failures.jsonl')
  await expect
    .poll(() => (existsSync(failureLog) ? readFileSync(failureLog, 'utf8') : ''), {
      timeout: 5000
    })
    .toContain('"status":"manual"')
  expect(readFileSync(failureLog, 'utf8')).not.toContain(untrustedServer.baseUrl)
  await expect
    .poll(() => targetSnapshot(application, untrustedServer.baseUrl), { timeout: 15000 })
    .toMatchObject({
      found: true,
      pathname: '/login',
      username: '',
      password: ''
    })
})

test('searches accounts and filters favorites', async () => {
  await createVault(page)
  await addAccount(page, {
    siteName: '搜索站点 A',
    startUrl: `${server.baseUrl}/login`,
    label: 'Alpha 账号',
    username: 'alpha@example.test',
    password: 'secret-password'
  })
  await addAccount(page, {
    siteName: '搜索站点 B',
    startUrl: `${server.baseUrl}/captcha`,
    label: 'Beta 账号',
    username: 'beta@example.test',
    password: 'secret-password'
  })

  const alphaRow = page.locator('.account-row').filter({ hasText: 'Alpha 账号' })
  await alphaRow.click()
  const accountDrawer = page.locator('.account-drawer')
  await accountDrawer.getByRole('checkbox', { name: /加入收藏/ }).check()
  await accountDrawer.getByRole('button', { name: '保存修改' }).click()
  await page.locator('.sidebar-nav__item').filter({ hasText: '收藏' }).click()
  await expect(alphaRow).toBeVisible()
  await expect(page.locator('.account-row').filter({ hasText: 'Beta 账号' })).toHaveCount(0)

  await page.locator('.sidebar-nav__item').filter({ hasText: '全部账号' }).click()
  await page.getByRole('textbox', { name: '搜索账号' }).fill('beta@example.test')
  await expect(page.locator('.account-row')).toHaveCount(1)
  await expect(page.locator('.account-row')).toContainText('Beta 账号')
})

test('persists dark mode, language, themes and interface scale with separate resets', async () => {
  await createVault(page)
  await addAccount(page, {
    siteName: '主题测试站点',
    startUrl: `${server.baseUrl}/login`,
    label: '主题测试账号',
    username: 'theme@example.test',
    password: 'secret-password'
  })

  const settingsNav = page.locator('.sidebar-nav__item').filter({ hasText: '设置' })
  await expect(settingsNav).toBeVisible()
  await expect(
    page.locator('.sidebar-action').filter({ hasText: '设置' })
  ).toHaveCount(0)
  await settingsNav.click()

  const settings = page.locator('.settings-page')
  await expect(settings.getByRole('heading', { name: '外观与语言' })).toBeVisible()

  await settings.getByRole('button', { name: '暗色' }).click()
  await expect
    .poll(() => page.evaluate(() => window.autologin.settings.get()))
    .toMatchObject({ colorMode: 'dark' })
  await expect
    .poll(() => page.evaluate(() => document.documentElement.dataset.colorMode))
    .toBe('dark')

  await settings.getByRole('button', { name: 'English' }).click()
  await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible()
  await settings.getByRole('button', { name: '繁體中文' }).click()
  await expect(page.getByRole('heading', { name: '設定', exact: true })).toBeVisible()
  await settings.getByRole('button', { name: '简体中文' }).click()
  await expect(page.getByRole('heading', { name: '设置', exact: true })).toBeVisible()

  await settings.getByRole('button', { name: '海盐' }).click()
  await expect
    .poll(() => page.evaluate(() => window.autologin.settings.get()))
    .toMatchObject({ themePreset: 'ocean', interfaceScale: 100 })
  await expect
    .poll(() =>
      page.evaluate(() =>
        getComputedStyle(document.documentElement).getPropertyValue('--accent').trim()
      )
    )
    .toBe('#56ACBA')

  await settings.getByLabel('强调色', { exact: true }).evaluate((element) => {
    const input = element as HTMLInputElement
    const valueSetter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      'value'
    )?.set
    valueSetter?.call(input, '#123456')
    input.dispatchEvent(new Event('input', { bubbles: true }))
    input.dispatchEvent(new Event('change', { bubbles: true }))
  })
  await settings.getByRole('button', { name: '应用自定义配色' }).click()
  await expect
    .poll(() => page.evaluate(() => window.autologin.settings.get()))
    .toMatchObject({
      themePreset: 'custom',
      customTheme: { accent: '#123456' }
    })
  await expect(settings.locator('.custom-theme-editor')).toHaveClass(/is-active/)

  await settings.getByRole('button', { name: '恢复默认主题' }).click()
  await expect
    .poll(() => page.evaluate(() => window.autologin.settings.get()))
    .toMatchObject({ themePreset: 'warm' })

  await settings.getByRole('slider', { name: '界面比例' }).fill('125')
  await expect
    .poll(() => page.evaluate(() => window.autologin.settings.get()))
    .toMatchObject({ interfaceScale: 125 })
  await page.locator('.sidebar-nav__item').filter({ hasText: '全部账号' }).click()

  await page.locator('.account-row').first().click()
  const editDrawer = page.locator('.account-drawer')
  await expect(editDrawer.getByRole('heading', { name: '主题测试账号' })).toBeVisible()
  const scaledMetrics = await editDrawer.evaluate((element) => ({
    clientHeight: element.clientHeight,
    scrollHeight: element.scrollHeight,
    top: element.getBoundingClientRect().top,
    bottom: element.getBoundingClientRect().bottom
  }))
  expect(scaledMetrics.scrollHeight).toBeLessThanOrEqual(scaledMetrics.clientHeight + 1)
  expect(scaledMetrics.top).toBeGreaterThanOrEqual(0)
  expect(scaledMetrics.bottom).toBeLessThanOrEqual(
    (await page.evaluate(() => window.innerHeight)) + 1
  )
  await editDrawer.getByRole('button', { name: '取消' }).click()

  await settingsNav.click()
  await settings.getByRole('button', { name: '恢复默认比例' }).click()
  await expect
    .poll(() => page.evaluate(() => window.autologin.settings.get()))
    .toMatchObject({ interfaceScale: 100 })

  await expect(settings.getByRole('heading', { name: '关于 AutoLogin' })).toBeVisible()
  await expect(settings.getByRole('heading', { name: '检查更新' })).toBeVisible()
  await expect(settings.getByRole('heading', { name: '数据保存位置' })).toBeVisible()
  const runtimeVersion = await application.evaluate(({ app }) => app.getVersion())
  await expect(settings.locator('.settings-about-grid')).toContainText(`v${runtimeVersion}`)
  await expect(settings.locator('.settings-location code')).toContainText(userDataDirectory)
  await settings.getByRole('button', { name: '检查更新' }).click()
  await expect(settings.locator('.settings-update-status')).toBeVisible({ timeout: 12000 })
})

test('supports grouped favorites, drawer editing and checkbox batch tabs in one browser', async () => {
  await createVault(page)
  await addAccount(page, {
    siteName: '工作站点',
    startUrl: `${server.baseUrl}/login`,
    label: '工作主账号',
    username: 'tester@example.test',
    password: 'secret-password',
    group: '工作'
  })

  await page.getByRole('button', { name: '添加账号' }).first().click()
  const accountDrawer = page.locator('.account-drawer')
  await expect(accountDrawer).toBeVisible()
  await accountDrawer.getByRole('button', { name: '已有站点' }).click()
  await expect(accountDrawer.locator('select')).toHaveCount(0)
  await accountDrawer.locator('.site-picker__trigger').click()
  await expect(accountDrawer.getByRole('listbox', { name: '选择站点' })).toBeVisible()
  await accountDrawer.getByRole('option', { name: /工作站点/ }).click()
  await accountDrawer.getByRole('button', { name: '取消' }).click()

  await addAccount(page, {
    siteName: '备用站点',
    startUrl: `${untrustedServer.baseUrl}/login`,
    label: '工作副账号',
    username: 'tester@example.test',
    password: 'secret-password',
    group: '工作'
  })
  await expect(page.locator('.account-row')).toHaveCount(2)
  const groupRow = page.locator('.sidebar-group-row').filter({ hasText: '工作' })
  await expect(groupRow).toBeVisible()
  await expect(groupRow).toContainText('2')
  await expect(groupRow).not.toContainText('工作主账号')
  const allAccountsNav = page.locator('.sidebar-nav__item').filter({ hasText: '全部账号' })
  await allAccountsNav.click()
  await expect(groupRow).toHaveCount(0)
  await allAccountsNav.click()
  await expect(groupRow).toBeVisible()
  await expect(
    page.locator('.sidebar-actions').getByRole('button', { name: '添加账号' })
  ).toHaveCount(0)

  const secondaryRow = page.locator('.account-row').filter({ hasText: '工作副账号' })
  await expect(secondaryRow.getByRole('button', { name: '编辑' })).toBeVisible()
  await expect(secondaryRow.getByRole('button', { name: '登录' })).toBeVisible()
  await secondaryRow.click()
  const editDrawer = page.locator('.account-drawer')
  await expect(editDrawer.getByRole('heading', { name: '工作副账号' })).toBeVisible()
  const drawerMetrics = await editDrawer.evaluate((element) => ({
    clientHeight: element.clientHeight,
    scrollHeight: element.scrollHeight,
    bottom: element.getBoundingClientRect().bottom
  }))
  expect(drawerMetrics.scrollHeight).toBeLessThanOrEqual(drawerMetrics.clientHeight + 1)
  expect(drawerMetrics.bottom).toBeLessThanOrEqual(await page.evaluate(() => window.innerHeight))
  await editDrawer.getByPlaceholder('例如：主账号').fill('工作副账号（已编辑）')
  await editDrawer.getByRole('button', { name: '保存修改' }).click()
  await expect(
    page.locator('.account-row').filter({ hasText: '工作副账号（已编辑）' })
  ).toBeVisible()

  await page.locator('.sidebar-nav__item').filter({ hasText: '收藏' }).click()
  const favoriteGroupRow = page.locator('.favorite-group-picker__row').filter({ hasText: '工作' })
  await expect(favoriteGroupRow).toBeVisible()
  await favoriteGroupRow.click()
  await expect(favoriteGroupRow).toHaveAttribute('aria-pressed', 'true')
  const favoriteGroup = page.locator('.favorite-group').filter({ hasText: '工作' })
  await expect(favoriteGroup).toBeVisible()
  await expect(favoriteGroup.locator('.account-row')).toHaveCount(2)
  await allAccountsNav.click()

  const mainRow = page.locator('.account-row').filter({ hasText: '工作主账号' })
  const editedRow = page.locator('.account-row').filter({ hasText: '工作副账号（已编辑）' })
  await mainRow.getByRole('checkbox').check()
  await editedRow.getByRole('checkbox').check()
  await expect(page.locator('.batch-selection-bar')).toContainText('2 个账号已选')

  const previousBatchId = await currentBatchId(page)
  await page.locator('.batch-selection-bar').getByRole('button', { name: '打开已选' }).click()
  await waitForNewBatch(page, previousBatchId, {
    active: false,
    success: 2,
    failed: 0,
    manual: 0
  })
  await expect(page.locator('.batch-status')).toContainText('成功 2 / 失败 0')
  const browserTargets = await externalBrowserTargets()
  expect(
    browserTargets.filter(
      (target) =>
        target.type === 'page' &&
        (target.url.startsWith(server.baseUrl) ||
          target.url.startsWith(untrustedServer.baseUrl))
    )
  ).toHaveLength(2)
  expect(externalBrowserProfileNames()).toEqual(['batch'])
})

test('records and replays a multi-step login flow', async () => {
  await createVault(page)
  await addAccount(page, {
    siteName: '多步骤登录',
    startUrl: `${server.baseUrl}/multi/step1`,
    label: '多步骤账号',
    username: 'tester@example.test',
    password: 'secret-password'
  })

  await page.locator('.account-row').first().click()
  const accountDrawer = page.locator('.account-drawer')
  await expect(accountDrawer).toBeVisible()
  await accountDrawer.getByRole('button', { name: '录制登录流程' }).click()
  await expect(page.getByText('正在录制登录流程')).toBeVisible()

  await expect
    .poll(() => targetSnapshot(application, server.baseUrl), { timeout: 15000 })
    .toMatchObject({
      found: true,
      pathname: '/multi/step1',
      username: 'tester@example.test'
    })
  await executeInTarget(application, server.baseUrl, `document.querySelector('#next').click();`)
  await expect
    .poll(() => targetSnapshot(application, server.baseUrl), { timeout: 15000 })
    .toMatchObject({
      found: true,
      pathname: '/multi/step2',
      password: 'secret-password'
    })
  await expect(page.getByText(/已完成 [3-9][0-9]* 个步骤/)).toBeVisible({ timeout: 10000 })
  await executeInTarget(application, server.baseUrl, `document.querySelector('#multi-login').click();`)
  await expect
    .poll(() => targetSnapshot(application, server.baseUrl), { timeout: 15000 })
    .toMatchObject({ found: true, pathname: '/home' })

  await page.getByRole('button', { name: '结束录制' }).click()
  await expect(page.getByRole('heading', { name: '全部账号' })).toBeVisible()
  await expect(page.locator('.account-row').first()).toContainText('已录制')
  const recordedTypes = await page.evaluate(async () => {
    const sites = await window.autologin.sites.list()
    return sites[0]?.recipe?.steps.map((step) => step.type) ?? []
  })
  expect(recordedTypes).toEqual(['fillUsername', 'click', 'fillPassword', 'click'])

  await page.locator('.account-row').first().click()
  await page.locator('.account-drawer').getByRole('button', { name: '清除会话' }).click()
  await page.locator('.confirm-dialog').getByRole('button', { name: '清除会话' }).click()
  await expect(page.locator('.toast')).toContainText('网站会话已清除')
  await page.locator('.drawer-backdrop').click({ position: { x: 10, y: 10 } })

  const previousBatchId = await currentBatchId(page)
  await page.locator('.account-row').first().getByRole('button', { name: '登录' }).click()
  await waitForNewBatch(page, previousBatchId, {
    active: false,
    success: 1,
    failed: 0,
    manual: 0
  })
  await expect
    .poll(() => targetSnapshot(application, server.baseUrl), { timeout: 15000 })
    .toMatchObject({ found: true, pathname: '/home' })
})

test('can clear all local data while the vault is locked', async () => {
  await createVault(page)
  await addAccount(page, {
    siteName: '锁定清理',
    startUrl: `${server.baseUrl}/login`,
    label: '清理账号',
    username: 'tester@example.test',
    password: 'secret-password'
  })
  const previousBatchId = await currentBatchId(page)
  await page.locator('.account-row').first().getByRole('button', { name: '登录' }).click()
  await waitForNewBatch(page, previousBatchId, {
    active: false,
    success: 1,
    failed: 0,
    manual: 0
  })
  await page.getByRole('button', { name: '立即锁定' }).click()
  await page.getByRole('button', { name: '忘记主密码？' }).click()
  const confirm = page.locator('.confirm-dialog')
  await expect(confirm).toBeVisible()
  await confirm.getByRole('button', { name: '清除并重新开始' }).click()
  await expect(page.getByRole('heading', { name: '创建你的本地保险库' })).toBeVisible()
  await expect(page.getByPlaceholder('至少 10 个字符')).toBeVisible()
})

async function createVault(targetPage: Page): Promise<void> {
  await expect(targetPage.getByRole('heading', { name: '创建你的本地保险库' })).toBeVisible()
  await targetPage.getByPlaceholder('至少 10 个字符').fill('correct horse battery staple')
  await targetPage.getByPlaceholder('确认主密码').fill('correct horse battery staple')
  await targetPage.getByRole('button', { name: '创建保险库' }).click()
  await expect(targetPage.getByRole('heading', { name: '全部账号' })).toBeVisible()
}

async function addAccount(
  targetPage: Page,
  account: {
    siteName: string
    startUrl: string
    label: string
    username: string
    password: string
    group?: string
  }
): Promise<void> {
  await targetPage.getByRole('button', { name: '添加账号' }).first().click()
  const drawer = targetPage.locator('.account-drawer')
  await expect(drawer).toBeVisible()
  if ((await drawer.getByPlaceholder('例如：工作台').count()) === 0) {
    await drawer.getByRole('button', { name: '新站点' }).click()
  }
  await expect(drawer.getByPlaceholder('例如：工作台')).toBeVisible()
  await drawer.getByPlaceholder('例如：工作台').fill(account.siteName)
  await drawer.getByPlaceholder('https://example.com/login').fill(account.startUrl)
  await drawer.getByPlaceholder('例如：主账号').fill(account.label)
  await drawer.getByPlaceholder('邮箱或账号').fill(account.username)
  await drawer.getByPlaceholder('输入登录密码').fill(account.password)
  if (account.group) {
    await drawer.getByPlaceholder('例如：工作、财务、个人').fill(account.group)
  }
  await drawer.getByRole('button', { name: '添加账号' }).click()
  await expect(
    targetPage.locator('.account-row').filter({ hasText: account.label })
  ).toHaveCount(1)
}

async function currentBatchId(targetPage: Page): Promise<string | null> {
  return targetPage.evaluate(async () => {
    const state = await window.autologin.login.getBatchState()
    return state?.batchId ?? null
  })
}

async function waitForNewBatch(
  targetPage: Page,
  previousBatchId: string | null,
  expected: {
    active: boolean
    success: number
    failed: number
    manual: number
  }
): Promise<void> {
  await expect
    .poll(
      () =>
        targetPage.evaluate(async (previousId) => {
          const state = await window.autologin.login.getBatchState()
          return Boolean(state?.batchId && state.batchId !== previousId)
        }, previousBatchId),
      { timeout: 35000 }
    )
    .toBe(true)
  await waitForBatch(targetPage, expected)
}

async function waitForBatch(
  targetPage: Page,
  expected: {
    active: boolean
    success: number
    failed: number
    manual: number
  }
): Promise<void> {
  await expect
    .poll(
      () =>
        targetPage.evaluate(async () => {
          const state = await window.autologin.login.getBatchState()
          return {
            active: state?.active ?? null,
            success: state?.success ?? null,
            failed: state?.failed ?? null,
            manual: state?.manual ?? null
          }
        }),
      { timeout: 35000 }
    )
    .toMatchObject(expected)
}

async function targetSnapshot(
  _app: ElectronApplication,
  baseUrl: string
): Promise<{
  found: boolean
  pathname?: string
  username?: string
  password?: string
  activeName?: string
  welcome?: string
}> {
  try {
    return (
      (await evaluateInExternalPage(
        baseUrl,
        `(() => ({
          found: true,
          pathname: window.location.pathname,
          username: document.querySelector('input[name="username"]')?.value ?? '',
          password: document.querySelector('input[name="password"]')?.value ?? '',
          activeName: document.activeElement?.getAttribute?.('name') ?? '',
          welcome: document.querySelector('#welcome')?.textContent ?? ''
        }))()`
      )) ?? { found: false }
    )
  } catch {
    return { found: false }
  }
}

async function executeInTarget(
  _app: ElectronApplication,
  baseUrl: string,
  script: string
): Promise<void> {
  await evaluateInTarget(_app, baseUrl, script)
}

async function evaluateInTarget<T>(
  _app: ElectronApplication,
  baseUrl: string,
  script: string
): Promise<T> {
  const value = await evaluateInExternalPage(baseUrl, script)
  return value as T
}

interface ExternalBrowserEndpoint {
  websocketUrl: string
}

interface ExternalTargetInfo {
  targetId: string
  type: string
  url: string
}

interface RuntimeEvaluateResult {
  result?: { value?: unknown }
  exceptionDetails?: { text?: string; exception?: { description?: string } }
}

function findExternalBrowserEndpoint(): ExternalBrowserEndpoint | null {
  const profilesRoot = join(userDataDirectory, 'BrowserProfiles')
  if (!existsSync(profilesRoot)) {
    return null
  }
  for (const entry of readdirSync(profilesRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) {
      continue
    }
    const portFile = join(profilesRoot, entry.name, 'DevToolsActivePort')
    if (!existsSync(portFile)) {
      continue
    }
    try {
      const [portLine, pathLine] = readFileSync(portFile, 'utf8').trim().split(/\r?\n/)
      const port = Number(portLine)
      if (
        Number.isInteger(port) &&
        port > 0 &&
        port <= 65_535 &&
        pathLine?.startsWith('/devtools/browser/')
      ) {
        return { websocketUrl: `ws://127.0.0.1:${port}${pathLine}` }
      }
    } catch {
      // The browser may still be writing the endpoint file.
    }
  }
  return null
}

function externalBrowserProfileNames(): string[] {
  const profilesRoot = join(userDataDirectory, 'BrowserProfiles')
  if (!existsSync(profilesRoot)) {
    return []
  }
  return readdirSync(profilesRoot, { withFileTypes: true })
    .filter(
      (entry) =>
        entry.isDirectory() && existsSync(join(profilesRoot, entry.name, 'DevToolsActivePort'))
    )
    .map((entry) => entry.name)
    .sort()
}

async function externalBrowserTargets(): Promise<ExternalTargetInfo[]> {
  const endpoint = findExternalBrowserEndpoint()
  if (!endpoint) {
    throw new Error('找不到外部浏览器调试端点')
  }
  const client = await CdpClient.connect(endpoint.websocketUrl, () => undefined, () => undefined)
  try {
    const targets = await client.send<{ targetInfos?: ExternalTargetInfo[] }>('Target.getTargets')
    return targets.targetInfos ?? []
  } finally {
    client.close()
  }
}

async function evaluateInExternalPage(baseUrl: string, script: string): Promise<unknown> {
  const endpoint = findExternalBrowserEndpoint()
  if (!endpoint) {
    throw new Error('找不到外部浏览器调试端点')
  }
  const client = await CdpClient.connect(endpoint.websocketUrl, () => undefined, () => undefined)
  try {
    const targets = await client.send<{ targetInfos?: ExternalTargetInfo[] }>('Target.getTargets')
    const target = (targets.targetInfos ?? []).find(
      (entry) => entry.type === 'page' && entry.url.startsWith(baseUrl)
    )
    if (!target) {
      throw new Error('找不到默认浏览器中的目标页面')
    }
    const attached = await client.send<{ sessionId: string }>('Target.attachToTarget', {
      targetId: target.targetId,
      flatten: true
    })
    const response = await client.send<RuntimeEvaluateResult>(
      'Runtime.evaluate',
      {
        expression: script,
        awaitPromise: true,
        returnByValue: true,
        userGesture: true
      },
      attached.sessionId,
      8_000
    )
    if (response.exceptionDetails) {
      throw new Error(
        response.exceptionDetails.exception?.description ||
          response.exceptionDetails.text ||
          '外部页面脚本执行失败'
      )
    }
    return response.result?.value
  } finally {
    client.close()
  }
}

async function waitFor(predicate: () => Promise<boolean>, timeoutMilliseconds: number): Promise<void> {
  const deadline = Date.now() + timeoutMilliseconds
  while (Date.now() < deadline) {
    if (await predicate()) {
      return
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 100))
  }
  throw new Error('等待条件超时')
}
