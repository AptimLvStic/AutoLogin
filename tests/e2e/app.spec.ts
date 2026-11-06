import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import {
  test,
  expect,
  _electron as electron,
  type ElectronApplication,
  type Locator,
  type Page
} from '@playwright/test'
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
      AUTOLOGIN_DATA_LOCATION_POINTER_DIR: join(userDataDirectory, 'stable-location'),
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
  await expect(page.locator('.auth-story .brand-lockup')).toHaveCount(0)
  await createVault(page)
  await expect(page.locator('.sidebar-label')).toHaveCount(0)
  const titlebarLogo = page.locator('.window-titlebar__logo')
  await expect(titlebarLogo).toBeVisible()
  expect(await titlebarLogo.evaluate((image) => (image as HTMLImageElement).naturalWidth)).toBeGreaterThan(0)

  const expandedWidth = await page.locator('.sidebar').evaluate((element) => element.getBoundingClientRect().width)
  await page.getByRole('button', { name: '隐藏菜单栏' }).click()
  await expect(page.locator('.app-shell')).toHaveClass(/is-sidebar-collapsed/)
  await expect(page.getByRole('button', { name: '显示菜单栏' })).toBeVisible()
  await expect
    .poll(() => page.locator('.sidebar').evaluate((element) => element.getBoundingClientRect().width))
    .toBeLessThan(70)
  const collapsedWidth = await page
    .locator('.sidebar')
    .evaluate((element) => element.getBoundingClientRect().width)
  expect(expandedWidth).toBeGreaterThan(collapsedWidth)
  await page.getByRole('button', { name: '显示菜单栏' }).click()
  await expect(page.locator('.app-shell')).not.toHaveClass(/is-sidebar-collapsed/)

  await addAccount(page, {
    siteName: '标准登录',
    startUrl: `${server.baseUrl}/login`,
    label: '主账号',
    username: 'tester@example.test',
    password: 'secret-password'
  })

  await page.locator('.account-row').first().dblclick()
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
  await detailsDrawer.getByRole('button', { name: '关闭', exact: true }).click()

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

  await page.locator('.account-row').first().dblclick()
  const drawer = page.locator('.account-drawer')
  await expect(drawer).toBeVisible()
  await drawer.getByRole('button', { name: '清除会话' }).click()
  const confirm = page.locator('.confirm-dialog')
  await expect(confirm).toBeVisible()
  await confirm.getByRole('button', { name: '清除会话' }).click({ force: true })
  await expect(page.locator('.toast')).toContainText('网站会话已清除')
  expect(existsSync(join(userDataDirectory, 'BrowserProfiles', 'batch'))).toBe(false)
  await drawer.getByRole('button', { name: '关闭', exact: true }).click()

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

test('fills one-click credentials after a delayed login form renders', async () => {
  await createVault(page)
  await addAccount(page, {
    siteName: '延迟登录',
    startUrl: `${server.baseUrl}/delayed-login`,
    label: '延迟账号',
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

  await expect
    .poll(() => targetSnapshot(application, server.baseUrl), { timeout: 15000 })
    .toMatchObject({
      found: true,
      pathname: '/delayed-login',
      username: 'tester@example.test',
      password: 'secret-password'
    })
})

test('saves and tests manual selectors, then uses them for login', async () => {
  await createVault(page)
  await addAccount(page, {
    siteName: '手动定位登录',
    startUrl: `${server.baseUrl}/login`,
    label: '手动账号',
    username: 'tester@example.test',
    password: 'secret-password'
  })

  await page.locator('.account-row').first().dblclick()
  const drawer = page.locator('.account-drawer')
  await expectAccountDrawerControlsAligned(drawer)
  const savedPasswordHeight = await drawer
    .locator('.drawer-saved-password')
    .evaluate((element) => element.getBoundingClientRect().height)
  await drawer.getByRole('radio', { name: /手动配置/ }).check()
  await expect
    .poll(() =>
      drawer
        .locator('.drawer-saved-password')
        .evaluate((element) => element.getBoundingClientRect().height)
    )
    .toBeCloseTo(savedPasswordHeight, 0)
  await drawer.getByRole('button', { name: '添加步骤' }).click()
  await drawer.getByRole('button', { name: '添加步骤' }).click()
  await drawer.getByRole('button', { name: '添加步骤' }).click()
  const selectorRows = drawer.locator('.manual-step-row')
  await expect(selectorRows).toHaveCount(3)
  await expect(selectorRows.nth(0).getByLabel('步骤 1 动作类型')).toHaveValue(
    'fillUsername'
  )
  await expect(selectorRows.nth(1).getByLabel('步骤 2 动作类型')).toHaveValue(
    'fillPassword'
  )
  await expect(selectorRows.nth(2).getByLabel('步骤 3 动作类型')).toHaveValue('click')
  await selectorRows.nth(0).getByLabel('步骤 1 Selector').fill('#username')
  await selectorRows.nth(1).getByLabel('步骤 2 Selector').fill('#password')
  await selectorRows.nth(2).getByLabel('步骤 3 Selector').fill('#login')

  await selectorRows.nth(0).getByRole('button', { name: '测试' }).click()
  await expect(selectorRows.nth(0)).toContainText('已找到可见的匹配元素', {
    timeout: 20000
  })
  await drawer.getByRole('button', { name: '保存修改' }).click()

  const stored = await page.evaluate(async () => {
    const accounts = await window.autologin.accounts.list()
    return accounts[0]
  })
  expect(stored).toMatchObject({
    loginStrategy: 'manual'
  })
  expect(
    stored.manualSteps?.map((step) => ({
      type: step.type,
      selector: 'selector' in step ? step.selector?.candidates[0] : undefined
    }))
  ).toEqual([
    { type: 'fillUsername', selector: '#username' },
    { type: 'fillPassword', selector: '#password' },
    { type: 'click', selector: '#login' }
  ])

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
  await expect(page.locator('.batch-status')).toBeVisible()
  await page.locator('.batch-status').click({ force: true })
  const logsPage = page.locator('.logs-page')
  await expect(logsPage.getByRole('heading', { name: '登录日志' })).toBeVisible({
    timeout: 10000
  })
  await expect(logsPage.locator('.logs-tabs')).toBeVisible()
  await expect(logsPage.getByRole('tab', { name: '登录日志' })).toHaveAttribute(
    'aria-selected',
    'true'
  )
  await expect(logsPage.locator('.page-breadcrumb > span')).toHaveText('日志')
  await expect(logsPage.locator('.log-table__row')).toContainText('验证码登录')
  await expect(logsPage.locator('.log-table__row')).toContainText('待人工')
  expect(
    await logsPage
      .locator('.log-table__row strong')
      .first()
      .evaluate((element) => Number.parseFloat(getComputedStyle(element).fontSize))
  ).toBeGreaterThanOrEqual(12)

  const today = await page.evaluate(() => {
    const date = new Date()
    return [
      date.getFullYear(),
      String(date.getMonth() + 1).padStart(2, '0'),
      String(date.getDate()).padStart(2, '0')
    ].join('-')
  })
  await logsPage.getByLabel('日期').fill(today)
  await logsPage.getByLabel('站点名称').selectOption({ label: '验证码登录' })
  await logsPage.getByLabel('分组').selectOption({ label: '安全' })
  await logsPage.getByLabel('状态').selectOption('manual')
  await selectPageSize(logsPage, '每页条数', 10)
  await expect(logsPage.locator('.log-table__row')).toHaveCount(1)
  await page.locator('.sidebar-nav__item').filter({ hasText: '账号' }).click()

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

  await openLogPage(page, '登录日志')
  await logsPage.getByLabel('状态').selectOption('manual')
  const manualRow = logsPage.locator('.log-table__row').filter({ hasText: '待人工' })
  await manualRow.getByRole('checkbox').check()
  await expect(logsPage.getByRole('button', { name: '批量删除' })).toBeEnabled()
  await manualRow.getByRole('button', { name: '查看详情' }).click()
  const detailModal = page.locator('.log-detail-modal')
  await expect(detailModal).toContainText('完整错误说明')
  await expect(detailModal).toContainText('验证码')
  await expect(detailModal.locator('.log-detail-summary > *')).toHaveCount(2)
  expect(
    await detailModal
      .locator('.log-detail-grid dd')
      .first()
      .evaluate((element) => Number.parseFloat(getComputedStyle(element).fontSize))
  ).toBeGreaterThanOrEqual(12)
  expect(
    await detailModal
      .locator('.log-detail-redaction')
      .evaluate((element) => Number.parseFloat(getComputedStyle(element).fontSize))
  ).toBeGreaterThanOrEqual(12)
  await page.locator('.modal-backdrop').click({ position: { x: 10, y: 10 } })
  await logsPage.getByRole('button', { name: '批量删除' }).click()
  await page.locator('.confirm-dialog').getByRole('button', { name: '确认删除' }).click()
  await expect(page.locator('.toast')).toContainText('已删除 1 条日志')
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

test('searches accounts and renders left-aligned table columns with icon-only actions', async () => {
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

  const alphaRow = page.locator('.account-row').filter({ hasText: '搜索站点 A' })
  await expect(alphaRow).toHaveCSS('cursor', 'default')
  await expect(page.locator('.account-tab').first()).toHaveCSS('cursor', 'default')
  await expect(page.locator('.account-list__header')).toContainText('最后更新')
  await expect(page.locator('.account-list__header')).toContainText('分组')
  await expect(page.locator('.account-list__header')).toContainText('站点 URL')
  await expect(
    page.locator('.account-list__header').getByRole('button', { name: '选择显示列' })
  ).toHaveCount(0)
  await expect(page.locator('.result-count')).toHaveCount(0)
  await expect(page.getByRole('button', { name: '批量操作' })).toBeDisabled()
  await expect(page.getByRole('button', { name: '批量登录' })).toBeDisabled()
  await expect(page.getByRole('button', { name: '删除账号' })).toBeDisabled()
  await alphaRow.getByRole('checkbox').check()
  await expect(page.getByRole('button', { name: '批量操作' })).toBeEnabled()
  await expect(page.getByRole('button', { name: '批量登录' })).toBeEnabled()
  await expect(page.getByRole('button', { name: '删除账号' })).toBeEnabled()
  await alphaRow.getByRole('checkbox').uncheck()

  const searchField = page.locator('.search-field--expandable')
  await expect(searchField).not.toHaveClass(/is-expanded/)
  const toolbarGap = await page.evaluate(() => {
    const header = document.querySelector<HTMLElement>('.library-header')
    const toolbar = document.querySelector<HTMLElement>('.library-toolbar')
    if (!header || !toolbar) return null
    return (
      toolbar.getBoundingClientRect().top -
      header.getBoundingClientRect().bottom
    )
  })
  expect(toolbarGap).not.toBeNull()
  expect(toolbarGap!).toBeLessThanOrEqual(6)
  await expect(page.locator('.library-toolbar')).toHaveCSS('margin-top', '0px')
  await expect(page.locator('.library-toolbar')).toHaveCSS('min-height', '42px')
  await page.getByRole('button', { name: '搜索账号', exact: true }).click()
  await expect(searchField).toHaveClass(/is-expanded/)

  await expect(page.locator('.account-list__header .account-col--site')).toHaveCSS(
    'text-align',
    'left'
  )
  const leftAlignedColumns = [
    '.account-col--username',
    '.account-col--group',
    '.account-col--updated',
    '.account-col--status',
    '.account-col--actions'
  ]
  for (const selector of leftAlignedColumns) {
    await expect(page.locator(`.account-list__header ${selector}`)).toHaveCSS(
      'text-align',
      'left'
    )
  }
  await expect(page.locator('.account-list__header .account-col--url')).toHaveCSS(
    'text-align',
    'left'
  )
  const firstRow = page.locator('.account-row').first()
  await expect(firstRow.locator('.account-identity')).toHaveCSS('justify-content', 'flex-start')
  await expect(firstRow.locator('.account-username')).toHaveCSS('justify-content', 'flex-start')
  await expect(firstRow.locator('.account-group-cell')).toHaveCSS('justify-content', 'flex-start')
  await expect(firstRow.locator('.account-updated')).toHaveCSS('text-align', 'left')
  await expect(firstRow.locator('.account-status-cell')).toHaveCSS('justify-content', 'flex-start')
  await expect(firstRow.locator('.account-site-url')).toHaveCSS('text-align', 'left')
  await expect(firstRow.locator('.account-site-url')).toHaveCSS(
    'justify-content',
    'flex-start'
  )
  const rowHeight = await firstRow.evaluate((element) => element.getBoundingClientRect().height)
  expect(rowHeight).toBeLessThanOrEqual(48)

  const addButton = page.getByRole('button', { name: '添加账号', exact: true })
  const refreshButton = page.getByRole('button', { name: '刷新', exact: true })
  const batchButton = page.getByRole('button', { name: '批量操作', exact: true })
  await expect(addButton).toHaveText('')
  await expect(addButton).toHaveCSS('box-shadow', 'none')
  await expect(refreshButton).toHaveText('')
  await expect(batchButton).toHaveText('')
  await expect(alphaRow.getByRole('button', { name: '登录', exact: true })).toHaveText('')
  await expect(alphaRow.getByRole('button', { name: '编辑', exact: true })).toHaveCount(0)
  await expect(
    alphaRow.getByRole('button', { name: '复制账号内容', exact: true })
  ).toHaveCount(0)
  await expect(page.locator('.sidebar-nav__item').filter({ hasText: '收藏' })).toHaveCount(0)
  await refreshButton.click()
  await expect(refreshButton).toBeDisabled()
  await expect(refreshButton.locator('.loading-spinner')).toHaveCSS('animation-name', 'spin')
  await expect(refreshButton).toBeEnabled({ timeout: 2000 })

  await page.locator('.sidebar-nav__item').filter({ hasText: '账号' }).click()
  await page.getByRole('button', { name: '搜索账号', exact: true }).click()
  await page.getByRole('textbox', { name: '搜索账号' }).fill('beta@example.test')
  await expect(page.locator('.account-row')).toHaveCount(1)
  await expect(page.locator('.account-row')).toContainText('搜索站点 B')

  await page.getByRole('textbox', { name: '搜索账号' }).press('Escape')
  await expect(searchField).not.toHaveClass(/is-expanded/)
})

test('shows the account page scrollbar only when rows exceed the viewport', async () => {
  await createVault(page)
  await addAccount(page, {
    siteName: '滚动条测试站点',
    startUrl: `${server.baseUrl}/login`,
    label: '滚动条测试账号',
    username: 'scroll-test@example.test',
    password: 'secret-password'
  })

  const scrollContainer = page.locator(
    '.library-content-scroll--accounts .library-view-main'
  )
  const tableScrollContainer = page.locator('.account-table-scroll')
  await expect(scrollContainer).toHaveCSS('scrollbar-gutter', 'auto')
  await expect(page.locator('.library-content-scroll--accounts')).toHaveCSS(
    'overflow-y',
    'hidden'
  )
  await expect
    .poll(() =>
      tableScrollContainer.evaluate(
        (element) => element.scrollHeight <= element.clientHeight + 1
      )
    )
    .toBe(true)

  await page.evaluate(async () => {
    const [account] = await window.autologin.accounts.list()
    for (let index = 0; index < 24; index += 1) {
      await window.autologin.accounts.duplicate([account.id])
    }
  })
  await page.getByRole('button', { name: '刷新', exact: true }).click()
  await selectPageSize(page, '账号每页条数', 50)
  await expect(page.locator('.account-row')).toHaveCount(25)
  await expect
    .poll(() =>
      tableScrollContainer.evaluate(
        (element) => element.scrollHeight > element.clientHeight + 1
      )
    )
    .toBe(true)
})

test('reorders sibling groups and nests a dragged group with breadcrumb and toast updates', async () => {
  await createVault(page)
  await addAccount(page, {
    siteName: '分组拖拽 A',
    startUrl: `${server.baseUrl}/login`,
    label: '分组拖拽 A',
    username: 'alpha@example.test',
    password: 'secret-password',
    group: 'Alpha'
  })
  await addAccount(page, {
    siteName: '分组拖拽 B',
    startUrl: `${server.baseUrl}/captcha`,
    label: '分组拖拽 B',
    username: 'beta@example.test',
    password: 'secret-password',
    group: 'Beta'
  })

  const alphaGroup = page
    .locator('.account-subnav__group-row')
    .filter({ hasText: 'Alpha' })
  const betaGroup = page
    .locator('.account-subnav__group-row')
    .filter({ hasText: 'Beta' })
  await expect(page.locator('.account-subnav__item--group')).toHaveCount(3)
  await expect(alphaGroup).toBeVisible()
  await expect(betaGroup).toBeVisible()

  await betaGroup
    .locator('.account-subnav__drag-handle')
    .dragTo(alphaGroup.locator('.account-subnav__item--group'), {
      targetPosition: { x: 24, y: 2 }
    })

  await expect
    .poll(() => page.evaluate(async () => (await window.autologin.settings.get()).groupOrder))
    .toEqual(['Beta', 'Alpha', '__autologin:ungrouped__'])
  await expect(page.locator('.account-subnav__item--group').nth(0)).toContainText('Beta')
  await expect(page.locator('.account-subnav__item--group').nth(1)).toContainText('Alpha')
  const ungroupedGroup = page
    .locator('.account-subnav__group-row--ungrouped')
    .filter({ hasText: '未分组' })
  const dragAlignment = await alphaGroup.evaluate((row) => {
    const handle = row.querySelector<HTMLElement>('.account-subnav__drag-handle')
    const button = row.querySelector<HTMLElement>('.account-subnav__item--group')
    if (!handle || !button) return Number.POSITIVE_INFINITY
    const handleRect = handle.getBoundingClientRect()
    const buttonRect = button.getBoundingClientRect()
    return Math.abs(
      handleRect.top + handleRect.height / 2 - (buttonRect.top + buttonRect.height / 2)
    )
  })
  expect(dragAlignment).toBeLessThan(1)
  await ungroupedGroup
    .locator('.account-subnav__drag-handle')
    .dragTo(betaGroup.locator('.account-subnav__item--group'), {
      targetPosition: { x: 24, y: 2 }
    })
  await expect
    .poll(() => page.evaluate(async () => (await window.autologin.settings.get()).groupOrder))
    .toEqual(['__autologin:ungrouped__', 'Beta', 'Alpha'])
  await expect(page.locator('.account-subnav__item--group').nth(0)).toContainText('未分组')

  await betaGroup
    .locator('.account-subnav__drag-handle')
    .dragTo(alphaGroup.locator('.account-subnav__item--group'), {
      targetPosition: { x: 40, y: 18 }
    })
  await expect(page.locator('.toast')).toContainText('分组已移动到“Alpha”')
  const toastPlacement = await page.locator('.toast').evaluate((element) => {
    const rect = element.getBoundingClientRect()
    const style = getComputedStyle(element)
    return {
      centerDelta: Math.abs(rect.left + rect.width / 2 - window.innerWidth / 2),
      top: rect.top,
      background: style.backgroundColor,
      color: style.color
    }
  })
  expect(toastPlacement.centerDelta).toBeLessThan(4)
  expect(toastPlacement.top).toBeLessThan(100)
  expect(toastPlacement.background).not.toBe('rgba(28, 37, 33, 0.96)')
  await expect(page.locator('.page-breadcrumb')).toContainText('Alpha')
  await expect(page.locator('.page-breadcrumb h1')).toHaveText('Beta')
  await expect(page.locator('.page-breadcrumb button')).toHaveCount(0)
  const movedGroup = page.locator('.account-subnav__group-row').filter({ hasText: 'Beta' })
  await expect(movedGroup).toBeVisible()
  const alphaRow = page.locator('.account-subnav__group-row').filter({ hasText: 'Alpha' })
  expect(
    await movedGroup.evaluate((element) => Number.parseFloat(getComputedStyle(element).paddingLeft))
  ).toBeGreaterThan(
    await alphaRow.evaluate((element) => Number.parseFloat(getComputedStyle(element).paddingLeft))
  )
})

test('drags accounts between groups and persists account ordering', async () => {
  await createVault(page)
  await addAccount(page, {
    siteName: '账号拖拽 A',
    startUrl: `${server.baseUrl}/login`,
    label: '账号拖拽 A',
    username: 'account-drag-a@example.test',
    password: 'secret-password'
  })
  await addAccount(page, {
    siteName: '账号拖拽 B',
    startUrl: `${server.baseUrl}/captcha`,
    label: '账号拖拽 B',
    username: 'account-drag-b@example.test',
    password: 'secret-password'
  })

  await page.evaluate(() =>
    window.autologin.groups.create({
      name: '拖拽目标'
    })
  )
  await page.getByRole('button', { name: '刷新' }).click()
  const targetGroup = page
    .locator('.account-subnav__group-row')
    .filter({ hasText: '拖拽目标' })
  await expect(targetGroup).toBeVisible()

  const accountA = page
    .locator('.account-row')
    .filter({ hasText: '账号拖拽 A' })
  const accountB = page
    .locator('.account-row')
    .filter({ hasText: '账号拖拽 B' })
  await accountA.dragTo(targetGroup.locator('.account-subnav__item--group'))
  await expect(page.locator('.toast')).toContainText('已将 1 个账号移动到“拖拽目标”')
  await expect
    .poll(() =>
      page.evaluate(async () => {
        const accounts = await window.autologin.accounts.list()
        return accounts.find((account) => account.site.name === '账号拖拽 A')?.site.group
      })
    )
    .toBe('拖拽目标')
  await expect(accountA.locator('.account-group-cell')).toContainText('拖拽目标')

  const sourceBox = await accountB.locator('.account-row-drag-handle').boundingBox()
  const targetBox = await accountA.boundingBox()
  expect(sourceBox).not.toBeNull()
  expect(targetBox).not.toBeNull()
  await page.mouse.move(
    sourceBox!.x + sourceBox!.width / 2,
    sourceBox!.y + sourceBox!.height / 2
  )
  await page.mouse.down()
  await page.mouse.move(targetBox!.x + 40, targetBox!.y + 2, { steps: 12 })
  await expect(page.locator('.account-row.is-dragging')).toHaveCount(1)
  await expect(page.locator('.account-row.is-drop-before')).toHaveCount(1)
  await page.mouse.up()
  await expect
    .poll(() =>
      page.evaluate(async () => {
        const accounts = await window.autologin.accounts.list()
        return accounts
          .filter((account) => account.site.name.startsWith('账号拖拽'))
          .sort((left, right) => (left.sortOrder ?? 0) - (right.sortOrder ?? 0))
          .map((account) => account.site.name)
      })
    )
    .toEqual(['账号拖拽 B', '账号拖拽 A'])
  await expect(page.locator('.account-row').nth(0)).toContainText('账号拖拽 B')
  await expect(page.locator('.account-row').nth(1)).toContainText('账号拖拽 A')
})

test('bulk deletes selected accounts after confirmation', async () => {
  await createVault(page)
  await addAccount(page, {
    siteName: '批量删除 A',
    startUrl: `${server.baseUrl}/login`,
    label: '批量删除 A',
    username: 'delete-a@example.test',
    password: 'secret-password'
  })
  await addAccount(page, {
    siteName: '批量删除 B',
    startUrl: `${server.baseUrl}/captcha`,
    label: '批量删除 B',
    username: 'delete-b@example.test',
    password: 'secret-password'
  })

  await page.getByRole('checkbox', { name: '选择站点 批量删除 A', exact: true }).check()
  await page.getByRole('checkbox', { name: '选择站点 批量删除 B', exact: true }).check()
  await page.getByRole('button', { name: '删除账号' }).click()
  const confirm = page.locator('.confirm-dialog')
  await expect(confirm).toContainText('2 个账号')
  await confirm.getByRole('button', { name: '移入回收站' }).click()
  await expect(page.locator('.toast')).toContainText('已将 2 个账号移入回收站')
  await expect(page.locator('.account-row')).toHaveCount(0)
  await expect(page.getByRole('button', { name: '批量操作' })).toBeDisabled()
  await expect(page.getByRole('button', { name: '批量登录' })).toBeDisabled()
  await expect(page.getByRole('button', { name: '删除账号' })).toBeDisabled()
  await expect(
    page.locator('.sidebar-nav__item').filter({ hasText: '回收站' }).locator('small')
  ).toHaveCount(0)

  await page.locator('.sidebar-nav__item').filter({ hasText: '回收站' }).click()
  const trashPage = page.locator('.trash-page')
  await expect(trashPage.locator('.trash-row')).toHaveCount(2)
  const retentionTrigger = trashPage.getByRole('button', { name: '回收站保留天数' })
  await expect(retentionTrigger).toContainText('7 天')
  await retentionTrigger.click()
  await expect(
    trashPage.getByRole('menuitemradio', { name: /天$/ })
  ).toHaveCount(4)
  await trashPage.getByRole('menuitemradio', { name: '30 天' }).click()
  await expect(page.locator('.toast')).toContainText('保留天数已设为 30 天')
  await expect
    .poll(() => page.evaluate(() => window.autologin.settings.get()))
    .toMatchObject({ trashRetentionDays: 30 })
  await trashPage.locator('.trash-row').first().getByRole('button', { name: '恢复' }).click()
  await expect(page.locator('.toast')).toContainText('账号已恢复')
  await expect(trashPage.locator('.trash-row')).toHaveCount(1)
  await trashPage
    .getByRole('checkbox', { name: '选择回收站全部账号' })
    .check()
  await trashPage.getByRole('button', { name: '批量恢复' }).click()
  await expect(page.locator('.toast')).toContainText('已恢复 1 个账号')
  await expect(trashPage.locator('.trash-row')).toHaveCount(0)
  await page.locator('.sidebar-nav__item').filter({ hasText: '账号' }).click()
  await expect(page.locator('.account-row')).toHaveCount(2)
  await page.getByRole('checkbox', { name: '选择当前页全部账号' }).check()
  await page.getByRole('button', { name: '删除账号' }).click()
  await page
    .locator('.confirm-dialog')
    .getByRole('button', { name: '移入回收站' })
    .click()
  await page.locator('.sidebar-nav__item').filter({ hasText: '回收站' }).click()
  await expect(trashPage.locator('.trash-row')).toHaveCount(2)
  await trashPage
    .getByRole('checkbox', { name: '选择回收站全部账号' })
    .check()
  await trashPage.getByRole('button', { name: '批量删除' }).click()
  await page
    .locator('.confirm-dialog')
    .getByRole('button', { name: '永久删除' })
    .click()
  await expect(page.locator('.toast')).toContainText('已永久删除 2 个账号')
  await expect(trashPage.locator('.trash-row')).toHaveCount(0)
})

test('resizes, hides and restores the account subnav, and creates three group levels', async () => {
  await createVault(page)
  await addAccount(page, {
    siteName: '分组层级站点',
    startUrl: `${server.baseUrl}/login`,
    label: '分组层级账号',
    username: 'group-level@example.test',
    password: 'secret-password'
  })

  const layout = page.locator('.library-view-layout--accounts')
  const subnav = page.locator('.account-subnav')
  const resizer = page.locator('.account-subnav__resizer')
  const initialWidth = await subnav.evaluate((element) => element.getBoundingClientRect().width)
  const resizerBox = await resizer.boundingBox()
  expect(resizerBox).not.toBeNull()
  await page.mouse.move(resizerBox!.x + 4, resizerBox!.y + 80)
  await page.mouse.down()
  await page.mouse.move(resizerBox!.x + 70, resizerBox!.y + 80, { steps: 8 })
  await page.mouse.up()
  await expect
    .poll(() => subnav.evaluate((element) => element.getBoundingClientRect().width))
    .toBeGreaterThan(initialWidth + 40)
  const savedWidth = await page.evaluate(() =>
    Number(window.localStorage.getItem('autologin.account.subnav.width'))
  )
  expect(savedWidth).toBeGreaterThanOrEqual(128)
  expect(savedWidth).toBeLessThanOrEqual(320)

  await page.getByRole('button', { name: '隐藏账号侧边栏' }).click()
  await expect(layout).toHaveClass(/is-account-subnav-hidden/)
  await expect(subnav).toHaveCount(0)
  await expect
    .poll(() =>
      page.evaluate(() => window.localStorage.getItem('autologin.account.subnav.hidden'))
    )
    .toBe('1')
  await page.getByRole('button', { name: '展开账号侧边栏' }).click()
  await expect(subnav).toBeVisible()
  await page.waitForTimeout(300)

  await expect(page.locator('.account-subnav__edge-toggle')).toHaveCount(0)
  const collapseButton = page.getByRole('button', { name: '隐藏账号侧边栏' })
  await expect(collapseButton).toHaveText('')
  await expect(collapseButton).toHaveCSS('box-shadow', 'none')
  const headerBox = await page.locator('.library-header').boundingBox()
  const breadcrumbNavBox = await page.locator('.page-breadcrumb').boundingBox()
  const collapseBox = await collapseButton.boundingBox()
  const toolbarBox = await page.locator('.library-toolbar').boundingBox()
  const subnavBox = await subnav.boundingBox()
  expect(headerBox).not.toBeNull()
  expect(breadcrumbNavBox).not.toBeNull()
  expect(collapseBox).not.toBeNull()
  expect(toolbarBox).not.toBeNull()
  expect(subnavBox).not.toBeNull()
  expect(collapseBox!.y).toBeLessThan(toolbarBox!.y)
  expect(collapseBox!.x).toBeGreaterThanOrEqual(headerBox!.x)
  expect(collapseBox!.x + collapseBox!.width).toBeLessThan(breadcrumbNavBox!.x)
  expect(
    Math.abs(
      collapseBox!.y +
        collapseBox!.height / 2 -
        (breadcrumbNavBox!.y + breadcrumbNavBox!.height / 2)
    )
  ).toBeLessThan(2)
  expect(
    Math.abs(
      collapseBox!.y +
        collapseBox!.height / 2 -
        (headerBox!.y + headerBox!.height / 2)
    )
  ).toBeLessThan(2)
  await expect(page.locator('.library-header')).toHaveCSS('flex-wrap', 'nowrap')
  await expect(page.locator('.library-header__actions')).toHaveCSS(
    'flex-wrap',
    'nowrap'
  )
  await expect(page.locator('.account-subnav__header')).toHaveText('')
  await expect(layout).not.toHaveClass(/is-account-subnav-hidden/)
  const dividerMetrics = await page.locator('.account-subnav-shell').evaluate((element) => {
    const shell = element.getBoundingClientRect()
    const parent = element.parentElement?.getBoundingClientRect()
    const style = getComputedStyle(element)
    return {
      height: shell.height,
      parentHeight: parent?.height ?? 0,
      borderRightWidth: style.borderRightWidth,
      borderRightStyle: style.borderRightStyle
    }
  })
  expect(dividerMetrics.height).toBeCloseTo(dividerMetrics.parentHeight, 0)
  expect(Number.parseFloat(dividerMetrics.borderRightWidth)).toBeGreaterThan(0)
  expect(dividerMetrics.borderRightStyle).toBe('solid')
  await expect
    .poll(() =>
      page.locator('.library-content-scroll').evaluate(
        (element) => element.scrollWidth <= element.clientWidth + 1
      )
    )
    .toBe(true)

  await page.getByRole('button', { name: '新增一级分组' }).click()
  const groupPopover = page.locator('.group-create-popover')
  await expect(groupPopover).toBeVisible()
  await groupPopover.getByLabel('分组名称').fill('Parent')
  await groupPopover.getByRole('button', { name: '创建' }).click()
  await expect(page.locator('.toast')).toContainText('分组已创建')

  const parentRow = page.locator('.account-subnav__group-row').filter({ hasText: 'Parent' })
  await expect(parentRow).toHaveCount(1)
  const groupRowStructure = await parentRow.evaluate((element) => {
    const children = Array.from(element.children) as HTMLElement[]
    const groupButton = element.querySelector<HTMLButtonElement>(
      ':scope > .account-subnav__item--group'
    )
    return {
      rowContainers: children.map((child) =>
        child.classList.contains('account-subnav__drag-handle')
          ? 'drag'
          : child.matches('button.account-subnav__item--group')
            ? 'group'
            : child.classList.contains('account-subnav__add-group')
              ? 'add'
              : 'other'
      ),
      groupButtonChildren: groupButton
        ? Array.from(groupButton.children).map((child) => child.className)
        : [],
      nestedButtons: groupButton?.querySelectorAll('button').length ?? -1
    }
  })
  expect(groupRowStructure.rowContainers).toEqual(['drag', 'group', 'add'])
  expect(groupRowStructure.groupButtonChildren.at(-1)).toContain(
    'account-subnav__tree-spacer'
  )
  expect(groupRowStructure.nestedButtons).toBe(0)
  await expect(parentRow.locator('.account-subnav__tree-chevron')).toHaveCount(0)
  await expect(parentRow.locator('.account-subnav__tree-spacer')).toHaveCount(1)
  await expect(page.locator('.toast')).toHaveCount(0, { timeout: 6000 })
  await page.getByRole('button', { name: '新增一级分组' }).click()
  await groupPopover.getByLabel('分组名称').fill('Parent')
  await groupPopover.getByLabel('分组名称').press('Enter')
  await expect(groupPopover).toContainText('同级分组名称已存在')
  await groupPopover.getByLabel('分组名称').fill('Bad/Name')
  await groupPopover.getByLabel('分组名称').press('Enter')
  await expect(groupPopover).toContainText('分组名称不能包含特殊字符')
  await page.keyboard.press('Escape')
  await expect(groupPopover).toHaveCount(0)
  await parentRow.getByRole('button', { name: '在“Parent”下新增子分组' }).click()
  await expect(groupPopover).toBeVisible()
  await groupPopover.getByLabel('分组名称').fill('Child')
  await groupPopover.getByLabel('分组名称').press('Enter')
  const childRow = page.locator('.account-subnav__group-row').filter({ hasText: 'Child' })
  await expect(childRow).toBeVisible()
  await expect(parentRow.locator('.account-subnav__tree-chevron')).toHaveCount(1)
  await expect(childRow.locator('.account-subnav__tree-chevron')).toHaveCount(0)
  await expect(childRow.locator('.account-subnav__tree-spacer')).toHaveCount(1)
  await childRow.getByRole('button', { name: '在“Child”下新增子分组' }).click()
  await groupPopover.getByLabel('分组名称').fill('Grand')
  await groupPopover.getByLabel('分组名称').press('Enter')
  const grandRow = page.locator('.account-subnav__group-row').filter({ hasText: 'Grand' })
  await expect(grandRow).toBeVisible()
  await expect(grandRow.getByRole('button', { name: /新增子分组/ })).toHaveCount(0)
  await expect(childRow.locator('.account-subnav__tree-chevron')).toHaveCount(1)
  const parentIndent = await parentRow.evaluate((element) =>
    Number.parseFloat(getComputedStyle(element).paddingLeft)
  )
  const childIndent = await childRow.evaluate((element) =>
    Number.parseFloat(getComputedStyle(element).paddingLeft)
  )
  const grandIndent = await grandRow.evaluate((element) =>
    Number.parseFloat(getComputedStyle(element).paddingLeft)
  )
  expect(childIndent).toBeGreaterThan(parentIndent)
  expect(grandIndent).toBeGreaterThan(childIndent)
  await expect(grandRow.locator('.account-subnav__tree-chevron')).toHaveCount(0)
  await expect(grandRow.locator('.account-subnav__tree-spacer')).toHaveCount(1)
  const ungroupedGroup = page
    .locator('.account-subnav__group-row--ungrouped')
    .filter({ hasText: '未分组' })
  await expect(ungroupedGroup.locator('.account-subnav__tree-chevron')).toHaveCount(0)
  await expect(ungroupedGroup.locator('.account-subnav__tree-spacer')).toHaveCount(1)
  const ungroupedColumns = await ungroupedGroup
    .locator('.account-subnav__item--group')
    .evaluate((button) => {
      const icon = button.querySelector('svg')?.getBoundingClientRect()
      const badge = button.querySelector('small')?.getBoundingClientRect()
      return icon && badge
        ? {
            iconX: icon.x + icon.width / 2,
            iconY: icon.y + icon.height / 2,
            badgeX: badge.x + badge.width / 2,
            badgeY: badge.y + badge.height / 2
          }
        : null
    })
  const parentColumns = await parentRow
    .locator('.account-subnav__item--group')
    .evaluate((button) => {
      const icon = button.querySelector('svg')?.getBoundingClientRect()
      return icon
        ? {
            iconX: icon.x + icon.width / 2,
            iconY: icon.y + icon.height / 2,
            hasBadge: Boolean(button.querySelector('small'))
          }
        : null
    })
  expect(ungroupedColumns).not.toBeNull()
  expect(parentColumns).not.toBeNull()
  expect(Math.abs(ungroupedColumns!.iconX - parentColumns!.iconX)).toBeLessThan(1)
  expect(Math.abs(ungroupedColumns!.iconY - ungroupedColumns!.badgeY)).toBeLessThan(1)
  expect(parentColumns!.hasBadge).toBe(false)
  const groupsAccordion = page.locator('.account-subnav__groups-accordion')
  const allAccountsButton = page.locator('.account-subnav__all-button')
  await allAccountsButton.click()
  await expect(groupsAccordion).toHaveCSS('visibility', 'hidden')
  await expect(parentRow).toBeHidden()
  await allAccountsButton.click()
  await expect(parentRow).toBeVisible()
  await parentRow.getByRole('button', { name: '收起“Parent”' }).click()
  await expect(childRow).toHaveCount(0)
  await expect(grandRow).toHaveCount(0)
  await expect(parentRow).toBeVisible()
  await parentRow.getByRole('button', { name: '展开“Parent”' }).click()
  await expect(childRow).toBeVisible()
  await expect(grandRow).toBeVisible()
  await parentRow.locator('.account-subnav__item--group').click()
  await expect(childRow).toHaveCount(0)
  await expect(parentRow).toBeVisible()
  const breadcrumbFontSizes = await page.locator('.page-breadcrumb').evaluate((breadcrumb) => {
    const nodes = [
      breadcrumb.querySelector<HTMLElement>(':scope > span'),
      ...breadcrumb.querySelectorAll<HTMLElement>('.page-breadcrumb__crumb--static, h1')
    ].filter((node): node is HTMLElement => Boolean(node))
    return nodes.map((node) => getComputedStyle(node).fontSize)
  })
  expect(new Set(breadcrumbFontSizes).size).toBe(1)
  await parentRow.getByRole('button', { name: '展开“Parent”' }).click()
  await expect(childRow).toBeVisible()
  await expect(page.locator('.account-subnav__edge-toggle')).toHaveCount(0)

  await allAccountsButton.click()
  await application.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0]?.setSize(960, 640)
  })
  await page.waitForTimeout(250)
  const compactLayout = await layout.evaluate((element) => ({
    display: getComputedStyle(element).display,
    columns: getComputedStyle(element).gridTemplateColumns,
    pageOverflow:
      document.querySelector<HTMLElement>('.library-content-scroll')!.scrollWidth >
      document.querySelector<HTMLElement>('.library-content-scroll')!.clientWidth
  }))
  expect(compactLayout.display).toBe('grid')
  expect(compactLayout.columns.split(' ').length).toBeGreaterThan(1)
  expect(compactLayout.pageOverflow).toBe(false)
  const tableHeaders = page.locator('.account-list__header')
  for (const selector of [
    '.account-col--site',
    '.account-col--username',
    '.account-col--group',
    '.account-col--updated',
    '.account-col--status',
    '.account-col--url'
  ]) {
    await expect(tableHeaders.locator(selector)).toBeVisible()
  }
  const firstCompactRow = page.locator('.account-row').first()
  const compactStatusBadge = firstCompactRow.locator('.account-status-cell .recipe-badge')
  await expect(compactStatusBadge).toHaveCSS('font-size', '0px')
  await expect(compactStatusBadge).toHaveCSS('width', '20px')

  const columnsButton = page.getByRole('button', { name: '选择显示列' })
  await expect(columnsButton).toHaveCount(0)
  await tableHeaders.click({ button: 'right', position: { x: 24, y: 15 } })
  const columnMenu = page.locator('.account-column-menu')
  await expect(columnMenu).toBeVisible()
  await page.waitForTimeout(180)
  const tableHeaderBox = await tableHeaders.boundingBox()
  const columnMenuBox = await columnMenu.boundingBox()
  expect(tableHeaderBox).not.toBeNull()
  expect(columnMenuBox).not.toBeNull()
  expect(Math.abs(columnMenuBox!.x - (tableHeaderBox!.x + 24))).toBeLessThan(2)
  expect(columnMenuBox!.y).toBeGreaterThanOrEqual(8)
  expect(columnMenuBox!.y + columnMenuBox!.height).toBeLessThanOrEqual(
    (await page.evaluate(() => window.innerHeight)) + 1
  )
  const fitContent = columnMenu.getByRole('menuitemradio', { name: '适应内容' })
  await expect(fitContent).toHaveAttribute('aria-checked', 'false')
  await expect(
    columnMenu.getByRole('menuitemradio', { name: '适应窗口' })
  ).toHaveAttribute('aria-checked', 'true')
  const windowColumnTemplate = await tableHeaders.evaluate(
    (header) => getComputedStyle(header).gridTemplateColumns
  )
  await fitContent.click()
  await expect(columnMenu).toBeHidden()
  await expect
    .poll(() =>
      page.evaluate(() =>
        window.localStorage.getItem('autologin.account.columnSizing')
      )
    )
    .toBe('content')
  const contentColumnTemplate = await tableHeaders.evaluate(
    (header) => getComputedStyle(header).gridTemplateColumns
  )
  expect(contentColumnTemplate).not.toBe(windowColumnTemplate)
  await tableHeaders.click({ button: 'right', position: { x: 24, y: 15 } })
  await expect(columnMenu).toBeVisible()
  await columnMenu.getByRole('menuitemradio', { name: '适应窗口' }).click()
  await expect
    .poll(() =>
      page.evaluate(() =>
        window.localStorage.getItem('autologin.account.columnSizing')
      )
    )
    .toBe('window')
  await page.waitForTimeout(180)
  const siteHeaderCell = tableHeaders.locator('[data-column-key="site"]')
  const siteResizer = siteHeaderCell.locator('.account-column-resizer')
  const siteWidthBefore = await siteHeaderCell.evaluate(
    (element) => element.getBoundingClientRect().width
  )
  const siteResizerBox = await siteResizer.boundingBox()
  expect(siteResizerBox).not.toBeNull()
  await page.mouse.move(
    siteResizerBox!.x + siteResizerBox!.width / 2,
    siteResizerBox!.y + siteResizerBox!.height / 2
  )
  await page.mouse.down()
  await page.mouse.move(
    siteResizerBox!.x + siteResizerBox!.width / 2 + 36,
    siteResizerBox!.y + siteResizerBox!.height / 2,
    { steps: 5 }
  )
  await page.mouse.up()
  await expect
    .poll(() =>
      page.evaluate(() =>
        window.localStorage.getItem('autologin.account.columnSizing')
      )
    )
    .toBe('manual')
  await expect
    .poll(() =>
      siteHeaderCell.evaluate((element) => element.getBoundingClientRect().width)
    )
    .toBeGreaterThan(siteWidthBefore + 20)
  await expect
    .poll(() =>
      page.evaluate(() => {
        const saved = window.localStorage.getItem('autologin.account.columnWidths')
        return saved ? Number(JSON.parse(saved).site) : 0
      })
    )
    .toBeGreaterThan(siteWidthBefore + 20)
  await tableHeaders.click({ button: 'right', position: { x: 24, y: 15 } })
  await expect(columnMenu).toBeVisible()
  const urlColumnToggle = columnMenu.getByRole('menuitemcheckbox', {
    name: '站点 URL'
  })
  await expect(urlColumnToggle).toHaveAttribute('aria-checked', 'true')
  await urlColumnToggle.click()
  await expect(urlColumnToggle).toHaveAttribute('aria-checked', 'false')
  await expect(tableHeaders.locator('.account-col--url')).toBeHidden()
  await expect(firstCompactRow.locator('.account-site-url')).toBeHidden()
  await expect
    .poll(() =>
      page.evaluate(() =>
        JSON.parse(
          window.localStorage.getItem('autologin.account.visibleColumns') ?? '[]'
        )
      )
    )
    .not.toContain('url')
  const alignedColumnTemplates = await page.locator('.account-list').evaluate((list) => {
    const header = list.querySelector<HTMLElement>('.account-list__header')
    const row = list.querySelector<HTMLElement>('.account-row')
    return {
      header: header ? getComputedStyle(header).gridTemplateColumns : '',
      row: row ? getComputedStyle(row).gridTemplateColumns : ''
    }
  })
  expect(alignedColumnTemplates.header).toBe(alignedColumnTemplates.row)
  await page.keyboard.press('Escape')
  await expect(columnMenu).toBeHidden()
  await tableHeaders.click({ button: 'right', position: { x: 24, y: 15 } })
  await columnMenu.getByRole('menuitemcheckbox', { name: '站点 URL' }).click()
  await expect(tableHeaders.locator('.account-col--url')).toBeVisible()
  await expect(firstCompactRow.locator('.account-site-url')).toBeVisible()
  await page.keyboard.press('Escape')

  const toolbarAlignment = await page.locator('.library-toolbar').evaluate((toolbar) => {
    const actions = toolbar.querySelector<HTMLElement>('.library-toolbar__actions')
    const toolbarRect = toolbar.getBoundingClientRect()
    const actionsRect = actions?.getBoundingClientRect()
    return actionsRect ? Math.abs(toolbarRect.right - actionsRect.right) : Number.POSITIVE_INFINITY
  })
  expect(toolbarAlignment).toBeLessThan(6)
  const toolbarRow = await page.locator('.library-toolbar').evaluate((toolbar) => {
    const search = toolbar.querySelector<HTMLElement>('.search-field--expandable')
    const add = toolbar.querySelector<HTMLElement>('.library-toolbar__actions .button--primary')
    const searchRect = search?.getBoundingClientRect()
    const addRect = add?.getBoundingClientRect()
    return searchRect && addRect
      ? {
          searchCenter: searchRect.top + searchRect.height / 2,
          addCenter: addRect.top + addRect.height / 2
        }
      : null
  })
  expect(toolbarRow).not.toBeNull()
  expect(Math.abs(toolbarRow!.searchCenter - toolbarRow!.addCenter)).toBeLessThan(3)
  await collapseButton.click()
  await expect(layout).toHaveClass(/is-account-subnav-hidden/)
  const expandButton = page.getByRole('button', { name: '展开账号侧边栏' })
  await expect(expandButton).toBeVisible()
  await page.waitForTimeout(300)
  const collapsedButtonBox = await expandButton.boundingBox()
  const collapsedHeaderBox = await page.locator('.library-header').boundingBox()
  expect(collapsedButtonBox).not.toBeNull()
  expect(collapsedHeaderBox).not.toBeNull()
  expect(Math.abs(collapsedButtonBox!.x - collapsedHeaderBox!.x)).toBeLessThan(3)
  for (const selector of [
    '.account-col--site',
    '.account-col--username',
    '.account-col--group',
    '.account-col--updated',
    '.account-col--status',
    '.account-col--url'
  ]) {
    await expect(tableHeaders.locator(selector)).toBeVisible()
  }
  await expect(page.locator('.vault-indicator')).toHaveCount(0)
})

test('paginates a dense account tab, keeps tabs fixed and resizes the subnav', async () => {
  await createVault(page)
  const siteId = await page.evaluate(
    async (startUrl) => {
      const site = await window.autologin.sites.save({
        name: '密集账号站点',
        startUrl,
        autoSubmit: true
      })
      return site.id
    },
    `${server.baseUrl}/login`
  )
  await page.evaluate(
    async ({ targetSiteId }) => {
      for (let index = 0; index < 120; index += 1) {
        await window.autologin.accounts.create({
          siteId: targetSiteId,
          label: `密集账号 ${index + 1}`,
          username: `dense-${index + 1}@example.test`,
          password: 'secret-password'
        })
      }
    },
    { targetSiteId: siteId }
  )
  await page.evaluate(async () => {
    for (let index = 0; index < 30; index += 1) {
      await window.autologin.groups.create({
        name: `滚动分组 ${index + 1}`
      })
    }
  })
  await page.getByRole('button', { name: '刷新' }).click()
  await expect(page.locator('.account-row')).toHaveCount(20, { timeout: 15000 })

  const rowCheckboxes = page.getByRole('checkbox', {
    name: /^选择站点 密集账号站点/
  })
  await rowCheckboxes.first().check()
  await rowCheckboxes.nth(2).click({ modifiers: ['Shift'] })
  await expect(rowCheckboxes.nth(0)).toBeChecked()
  await expect(rowCheckboxes.nth(1)).toBeChecked()
  await expect(rowCheckboxes.nth(2)).toBeChecked()
  const selectCurrentPage = page.getByRole('checkbox', {
    name: '选择当前页全部账号'
  })
  await selectCurrentPage.click()
  await expect(rowCheckboxes.nth(19)).toBeChecked()
  await selectCurrentPage.click()
  await expect(rowCheckboxes.nth(0)).not.toBeChecked()

  await page.evaluate(async () => {
    for (let index = 0; index < 9; index += 1) {
      await window.autologin.tabs.create({ name: `密集标签 ${index + 1}` })
    }
  })
  await page.getByRole('button', { name: '刷新' }).click()
  const tabScroll = page.locator('.account-tabs__scroll')
  await expect
    .poll(() =>
      tabScroll.evaluate((element) => ({
        overflowX: getComputedStyle(element).overflowX,
        scrollbarWidth: getComputedStyle(element).scrollbarWidth,
        overflowing: element.scrollWidth > element.clientWidth
      }))
    )
    .toMatchObject({
      overflowX: 'auto',
      scrollbarWidth: 'none',
      overflowing: true
    })
  await expect(page.locator('.account-tab.is-active')).toHaveCSS(
    'border-top-left-radius',
    '10px'
  )
  await page.locator('.account-tabs').dispatchEvent('contextmenu', {
    bubbles: true,
    clientX: 120,
    clientY: 24
  })
  await expect(page.locator('.account-context-menu')).toHaveCount(0)

  const groupScroller = page.locator('.account-subnav__groups-inner')
  await expect(groupScroller).toHaveCSS('overflow-y', 'auto')
  await expect
    .poll(() =>
      groupScroller.evaluate(
        (element) => element.scrollHeight > element.clientHeight
      )
    )
    .toBe(true)

  const pagination = page.locator('.account-pagination')
  await expect(page.locator('.library-content-scroll--accounts > .account-tabs')).toHaveCSS(
    'margin-top',
    '20px'
  )
  await expect(pagination).toHaveCSS('padding-top', '10px')
  await expect(pagination).toHaveCSS('padding-right', '2px')
  await expect(pagination).toHaveCSS('padding-bottom', '10px')
  await expect(pagination).toHaveCSS('padding-left', '2px')
  await expect(pagination).toContainText('共 120 个账号，第 1/6 页')
  await expect(
    page.locator('.account-table-scroll + .account-pagination')
  ).toBeVisible()
  await selectPageSize(page, '账号每页条数', 10)
  await expect(page.locator('.account-row')).toHaveCount(10)
  await expect(pagination).toContainText('共 120 个账号，第 1/12 页')
  await page.getByRole('button', { name: '下一页' }).click()
  await expect(pagination).toContainText('共 120 个账号，第 2/12 页')
  await expect(page.locator('.account-row')).toHaveCount(10)

  await selectPageSize(page, '账号每页条数', 50)
  await expect(page.locator('.account-row')).toHaveCount(50)
  await expect(pagination).toContainText('共 120 个账号，第 1/3 页')

  const accountPageScroll = page.locator(
    '.library-content-scroll--accounts .account-table-scroll'
  )
  const firstTabsTop = await page
    .locator('.account-tabs')
    .evaluate((element) => element.getBoundingClientRect().top)
  await accountPageScroll.evaluate((element) => {
    element.scrollTop = 900
  })
  await expect
    .poll(() =>
      page.evaluate(() => {
        const scroll = document.querySelector<HTMLElement>(
          '.library-content-scroll--accounts .account-table-scroll'
        )
        const tabs = document.querySelector<HTMLElement>('.account-tabs')
        if (!scroll || !tabs) return null
        return {
          position: getComputedStyle(tabs).position,
          scrolling: scroll.scrollTop > 0
        }
      })
    )
    .toMatchObject({ position: 'relative', scrolling: true })
  expect(
    Math.abs(
      (await page
        .locator('.account-tabs')
        .evaluate((element) => element.getBoundingClientRect().top)) -
        firstTabsTop
    )
  ).toBeLessThanOrEqual(1)
  await accountPageScroll.evaluate((element) => {
    element.scrollTop = 0
  })
  const alignment = await page.evaluate(() => {
    const allAccounts = document.querySelector<HTMLElement>(
      '.account-subnav__all-row'
    )
    const breadcrumb = document.querySelector<HTMLElement>('.library-header')
    if (!allAccounts || !breadcrumb) return null
    const allRect = allAccounts.getBoundingClientRect()
    const breadcrumbRect = breadcrumb.getBoundingClientRect()
    return {
      allCenter: allRect.top + allRect.height / 2,
      breadcrumbCenter: breadcrumbRect.top + breadcrumbRect.height / 2
    }
  })
  expect(alignment).not.toBeNull()
  expect(
    Math.abs(alignment!.allCenter - alignment!.breadcrumbCenter)
  ).toBeLessThanOrEqual(1)

  const pageScrollBeforeGroupScroll = await accountPageScroll.evaluate(
    (element) => element.scrollTop
  )
  await groupScroller.evaluate((element) => {
    element.scrollTop = element.scrollHeight
  })
  await expect
    .poll(() => groupScroller.evaluate((element) => element.scrollTop))
    .toBeGreaterThan(0)
  expect(
    await accountPageScroll.evaluate((element) => element.scrollTop)
  ).toBe(pageScrollBeforeGroupScroll)

  const layout = page.locator('.library-view-layout--accounts')
  const resizer = page.locator('.account-subnav__resizer')
  const beforeWidth = await layout.evaluate((element) =>
    Number.parseFloat(
      getComputedStyle(element).getPropertyValue('--account-subnav-width') || '0'
    )
  )
  const resizerBox = await resizer.boundingBox()
  expect(resizerBox).not.toBeNull()
  await page.mouse.move(
    resizerBox!.x + 4,
    resizerBox!.y + 80
  )
  await page.mouse.down()
  await page.mouse.move(
    resizerBox!.x + 52,
    resizerBox!.y + 80,
    { steps: 24 }
  )
  await expect
    .poll(() =>
      layout.evaluate((element) =>
        Number.parseFloat(
          getComputedStyle(element).getPropertyValue('--account-subnav-width') || '0'
        )
      )
    )
    .toBeGreaterThan(beforeWidth + 36)
  await page.mouse.up()
  await expect
    .poll(() => page.evaluate(() => window.localStorage.getItem('autologin.account.subnav.width')))
    .not.toBeNull()
})

test('cancels an active batch login from the account toolbar', async () => {
  await createVault(page)
  const siteId = await page.evaluate(
    async (startUrl) => {
      const site = await window.autologin.sites.save({
        name: '可中断批量站点',
        startUrl,
        autoSubmit: true
      })
      return site.id
    },
    `${server.baseUrl}/login`
  )
  await page.evaluate(
    async ({ targetSiteId }) => {
      for (let index = 0; index < 20; index += 1) {
        await window.autologin.accounts.create({
          siteId: targetSiteId,
          label: '可中断批量站点',
          username: `cancel-${index + 1}@example.test`,
          password: 'secret-password'
        })
      }
    },
    { targetSiteId: siteId }
  )
  await page.getByRole('button', { name: '刷新' }).click()
  await expect(page.locator('.account-row')).toHaveCount(20, { timeout: 15000 })
  await page.getByRole('checkbox', { name: '选择当前页全部账号' }).check()

  const previousBatchId = await currentBatchId(page)
  await page.getByRole('button', { name: '批量登录' }).click()
  const cancelButton = page.getByRole('button', { name: '中断批量登录' })
  await expect(cancelButton).toBeVisible({ timeout: 15000 })
  await cancelButton.click()

  await expect
    .poll(
      () =>
        page.evaluate(async (previousId) => {
          const state = await window.autologin.login.getBatchState()
          return {
            newBatch: Boolean(state?.batchId && state.batchId !== previousId),
            active: state?.active ?? null,
            canceled: state?.canceled ?? 0
          }
        }, previousBatchId),
      { timeout: 15000 }
    )
    .toMatchObject({ newBatch: true, active: false })
  expect(
    await page.evaluate(async () => (await window.autologin.login.getBatchState())?.canceled)
  ).toBeGreaterThan(0)
  await expect(page.locator('.batch-status')).toContainText('已中断')
})

test('edits and copies accounts from the right-click menu', async () => {
  await createVault(page)
  await addAccount(page, {
    siteName: '复制菜单站点',
    startUrl: `${server.baseUrl}/login`,
    label: '复制菜单账号',
    username: 'copy-menu@example.test',
    password: 'secret-password'
  })

  const row = page.locator('.account-row').filter({ hasText: '复制菜单站点' })
  await expect(row.getByRole('button', { name: '编辑', exact: true })).toHaveCount(0)
  await expect(
    row.getByRole('button', { name: '复制账号内容', exact: true })
  ).toHaveCount(0)

  await row.click()
  await expect(page.locator('.account-drawer')).toHaveCount(0)
  await row.dblclick()
  const editor = page.locator('.account-drawer')
  await expect(editor.getByRole('heading', { name: '复制菜单站点' })).toBeVisible()
  await editor.getByRole('button', { name: '关闭', exact: true }).click()

  const accountPageScroll = page.locator('.library-content-scroll--accounts')
  const pageBox = await accountPageScroll.boundingBox()
  expect(pageBox).not.toBeNull()
  await page.mouse.click(
    pageBox!.x + pageBox!.width - 16,
    pageBox!.y + pageBox!.height - 16,
    { button: 'right' }
  )
  const pageMenu = page.locator('.account-context-menu')
  await expect(pageMenu).toBeVisible()
  await expect(pageMenu.getByRole('menuitem')).toHaveCount(1)
  await pageMenu.getByRole('menuitem', { name: '新增账号' }).click()
  await expect(editor.getByRole('heading', { name: '添加登录账号' })).toBeVisible()
  await editor.getByRole('button', { name: '关闭', exact: true }).click()

  await row.click({ button: 'right' })
  const accountMenu = page.locator('.account-context-menu')
  await expect(accountMenu).toBeVisible()
  await expect(accountMenu.getByRole('menuitem')).toHaveCount(6)
  await expect(
    accountMenu.getByRole('menuitem', { name: '删除账号' })
  ).toBeVisible()
  await accountMenu.getByRole('menuitem', { name: '编辑账号' }).click()
  await expect(editor.getByRole('heading', { name: '复制菜单站点' })).toBeVisible()
  await editor.getByRole('button', { name: '关闭', exact: true }).click()

  await row.click({ button: 'right' })
  await expect(accountMenu).toBeVisible()
  await accountMenu.getByRole('menuitem', { name: '复制用户名' }).click()
  await expect(accountMenu).toHaveCount(0)
  await expect(page.getByRole('status')).toContainText('用户名已复制')
  expect(await application.evaluate(({ clipboard }) => clipboard.readText())).toBe(
    'copy-menu@example.test'
  )

  await row.click({ button: 'right' })
  await accountMenu.getByRole('menuitem', { name: '复制密码' }).click()
  await expect(page.getByRole('status')).toContainText('密码已复制')
  expect(await application.evaluate(({ clipboard }) => clipboard.readText())).toBe(
    'secret-password'
  )

  await row.click({ button: 'right' })
  await accountMenu.getByRole('menuitem', { name: '复制 URL' }).click()
  await expect(page.getByRole('status')).toContainText('站点 URL 已复制')
  expect(await application.evaluate(({ clipboard }) => clipboard.readText())).toBe(
    `${server.baseUrl}/login`
  )

  await row.click({ button: 'right' })
  await accountMenu.getByRole('menuitem', { name: '复制账号' }).click()
  await expect(accountMenu).toHaveCount(0)
  await expect(page.locator('.toast')).toContainText('已创建')
  const copied = await page.evaluate(async () => (await window.autologin.accounts.list()).find(
    (account) => account.label.includes('副本')
  ))
  expect(copied?.favorite).toBe(false)
})

test('keeps the account context menu at the pointer after scrolling', async () => {
  await createVault(page)
  const siteId = await page.evaluate(
    async (startUrl) => {
      const site = await window.autologin.sites.save({
        name: '滚动菜单站点',
        startUrl,
        autoSubmit: true
      })
      return site.id
    },
    `${server.baseUrl}/login`
  )
  await page.evaluate(
    async ({ targetSiteId }) => {
      for (let index = 0; index < 30; index += 1) {
        await window.autologin.accounts.create({
          siteId: targetSiteId,
          label: `滚动菜单账号 ${index + 1}`,
          username: `scroll-menu-${index + 1}@example.test`,
          password: 'secret-password'
        })
      }
    },
    { targetSiteId: siteId }
  )
  await page.getByRole('button', { name: '刷新' }).click()
  const rows = page.locator('.account-row')
  await expect(rows).toHaveCount(20, { timeout: 15000 })

  const tableScroller = page.locator('.account-table-scroll')
  await tableScroller.evaluate((element) => {
    element.scrollTop = element.scrollHeight
  })
  await page.waitForTimeout(250)
  const target = rows.nth(19)
  const rowBox = await target.boundingBox()
  expect(rowBox).not.toBeNull()
  const pointerX = rowBox!.x + rowBox!.width * 0.4
  const pointerY = rowBox!.y + rowBox!.height / 2
  await page.mouse.click(pointerX, pointerY, { button: 'right' })

  const menu = page.locator('.account-context-menu')
  await expect(menu).toBeVisible()
  await expect(menu).toHaveCSS('position', 'fixed')
  const menuBox = await menu.boundingBox()
  expect(menuBox).not.toBeNull()
  const opensBelow = Math.abs(menuBox!.y - pointerY)
  const opensAbove = Math.abs(menuBox!.y + menuBox!.height - pointerY)
  expect(Math.min(opensBelow, opensAbove)).toBeLessThanOrEqual(10)
})

test('uses a configurable, disabled-by-default account copy shortcut', async () => {
  await createVault(page)
  await addAccount(page, {
    siteName: '键盘快捷站点',
    startUrl: `${server.baseUrl}/login`,
    label: '键盘快捷账号',
    username: 'keyboard@example.test',
    password: 'secret-password'
  })

  await expect(page.locator('.toast')).toHaveCount(0, { timeout: 6000 })
  await page.keyboard.press('Control+c')
  await expect(page.getByRole('status')).toHaveCount(0)
  await page.keyboard.press('Control+v')
  await expect(page.locator('.account-row')).toHaveCount(1)

  await page.locator('.sidebar-actions').getByRole('button', { name: '设置' }).click()
  const settings = page.locator('.settings-page')
  await expect(settings).toContainText('集中管理 AutoLogin 内部快捷键')
  const shortcutToggle = settings.getByRole('checkbox', {
    name: /启用 AutoLogin 内部快捷键/
  })
  await expect(shortcutToggle).not.toBeChecked()
  await shortcutToggle.check()
  const shortcutInput = settings.getByRole('textbox', { name: '账号复制快捷键' })
  await shortcutInput.focus()
  await shortcutInput.press('Control+Shift+c')
  await expect
    .poll(() => page.evaluate(() => window.autologin.settings.get()))
    .toMatchObject({
      accountCopyShortcutEnabled: true,
      accountCopyShortcut: 'Ctrl+Shift+C'
    })

  await page.locator('.sidebar-nav__item').filter({ hasText: '账号' }).click()
  await page
    .getByRole('checkbox', { name: '选择站点 键盘快捷站点', exact: true })
    .check()
  await page.keyboard.press('Control+Shift+c')
  await expect(page.getByRole('status')).toContainText('已复制 1 个账号')

  await page.keyboard.press('Control+v')
  await expect(page.locator('.account-row')).toHaveCount(2)
  await expect(
    page.locator('.account-row').filter({ hasText: '键盘快捷站点 副本' })
  ).toHaveCount(1)
  await expect(page.getByRole('status')).toContainText('已粘贴 1 个账号')
  await expect(
    page.getByRole('checkbox', { name: '选择站点 键盘快捷站点 副本', exact: true })
  ).toBeChecked()

  await page.keyboard.press('Delete')
  const confirm = page.locator('.confirm-dialog')
  await expect(confirm).toContainText('1 个账号')
  await confirm.getByRole('button', { name: '移入回收站' }).click()
  await expect(page.locator('.account-row')).toHaveCount(1)
})

test('downloads and persists an editable site icon', async () => {
  await createVault(page)
  await page.getByRole('button', { name: '添加账号' }).first().click()
  const editor = page.locator('.account-drawer')
  await expect(editor).toBeVisible()
  if ((await editor.getByRole('button', { name: '新站点' }).count()) > 0) {
    await editor.getByRole('button', { name: '新站点' }).click()
  }
  await editor.getByPlaceholder('例如：工作台').fill('图标测试站点')
  await editor.getByPlaceholder('https://example.com/login').fill(`${server.baseUrl}/login`)
  await editor.getByPlaceholder('邮箱或账号').fill('icon@example.test')
  await editor.getByPlaceholder('输入登录密码').fill('secret-password')

  const iconPreview = editor.locator('.site-icon-editor__preview')
  await expect(editor.locator('.site-icon-editor__file-input')).toBeHidden()
  await editor.getByRole('button', { name: '获取网站图标' }).click()
  await expect(editor.getByRole('button', { name: '获取网站图标' })).toBeEnabled({
    timeout: 10000
  })
  await expect(iconPreview.locator('img')).toHaveAttribute(
    'src',
    /^data:image\/svg\+xml;base64,/
  )

  await editor.getByRole('button', { name: '添加账号' }).click()
  const row = page.locator('.account-row').filter({ hasText: '图标测试站点' })
  await expect(row.locator('.monogram--image img')).toHaveAttribute(
    'src',
    /^data:image\/svg\+xml;base64,/
  )

  await row.dblclick()
  await expect(editor.locator('.site-icon-editor__preview img')).toBeVisible()
  await editor.getByPlaceholder('例如：工作台').fill('未提交的站点名称')
  await editor.getByRole('button', { name: '取消' }).click()
  await row.dblclick()
  await expect(editor.getByPlaceholder('例如：工作台')).toHaveValue('图标测试站点')
  await expect(editor.getByRole('button', { name: '保存修改' })).toBeVisible()
  await editor.getByRole('button', { name: '移除图标' }).click()
  await expect(editor.locator('.site-icon-editor__preview img')).toHaveCount(0)
  await editor.getByRole('button', { name: '获取网站图标' }).click()
  await expect(editor.locator('.site-icon-editor__preview img')).toBeVisible()
  await editor.getByRole('button', { name: '保存修改' }).click()
  await expect(page.locator('.account-row').filter({ hasText: '图标测试站点' })).toBeVisible()
})

test('keeps bookmarks visit-only and exposes the access log page', async () => {
  await createVault(page)
  await page.evaluate(async (startUrl) => {
    const tab = await window.autologin.tabs.create({
      name: '书签测试',
      source: 'bookmarks'
    })
    const site = await window.autologin.sites.save({
      tabId: tab.id,
      name: '书签测试站点',
      startUrl,
      autoSubmit: false
    })
    await window.autologin.accounts.create({
      siteId: site.id,
      label: '书签测试',
      username: '',
      password: ''
    })
  }, `${server.baseUrl}/login`)
  await page.getByRole('button', { name: '刷新', exact: true }).click()

  const bookmarksNav = page
    .locator('.sidebar-nav')
    .getByRole('button', { name: '书签' })
  await bookmarksNav.click()
  await expect(page.locator('.page-breadcrumb h1')).toHaveText('全部书签')
  await expect(page.getByRole('button', { name: '新增书签标签页' })).toBeVisible()
  await expect(page.getByRole('button', { name: '导入浏览器书签' }).first()).toBeVisible()
  await expect(page.getByRole('button', { name: '导出浏览器书签' })).toBeVisible()
  await expect(page.getByRole('button', { name: '批量登录' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: '批量操作' })).toHaveCount(0)
  await expect(page.locator('.account-list__header .account-col--status')).toHaveCount(0)

  const bookmarkRow = page
    .locator('.account-row')
    .filter({ hasText: '书签测试站点' })
  await expect(bookmarkRow.getByRole('button', { name: '访问' })).toBeVisible()
  await expect(bookmarkRow.getByRole('button', { name: '登录' })).toHaveCount(0)
  await expect(bookmarkRow).toContainText('书签')
  await bookmarkRow.dblclick()
  const editor = page.locator('.account-drawer')
  await expect(editor).toBeVisible()
  await expect(editor.getByPlaceholder('邮箱或账号')).toHaveCount(0)
  await expect(editor.getByPlaceholder('输入登录密码')).toHaveCount(0)
  await expect(editor.getByText('自动识别', { exact: true })).toHaveCount(0)
  await editor.getByRole('button', { name: '取消' }).click()
  await expect(editor).toHaveCount(0)

  await openLogPage(page, '访问日志')
  const accessLogsPage = page.locator('.access-logs-page')
  await expect(accessLogsPage.getByRole('heading', { name: '访问日志' })).toBeVisible()
  await expect(accessLogsPage.locator('.logs-tabs').getByRole('tab')).toHaveCount(3)
  await expect(accessLogsPage.getByLabel('日期')).toBeVisible()
  await expect(accessLogsPage.getByLabel('站点名称')).toBeVisible()
  await expect(accessLogsPage.getByLabel('分组')).toBeVisible()
  await expect(accessLogsPage.getByLabel('状态')).toBeVisible()
  await expect(accessLogsPage.getByText('暂无数据')).toBeVisible()

  const bookmarkAccountId = await page.evaluate(async () => {
    const [account] = await window.autologin.accounts.list()
    return account.id
  })
  await page.evaluate(
    (accountId) => window.autologin.accounts.deleteMany([accountId]),
    bookmarkAccountId
  )
  await page.locator('.sidebar-nav__item').filter({ hasText: '回收站' }).click()
  const trashPage = page.locator('.trash-page')
  await expect(trashPage.getByRole('tab')).toHaveCount(2)
  await trashPage.getByRole('tab', { name: '书签' }).click()
  await expect(trashPage.locator('.trash-list__header')).toContainText('标签')
  await expect(trashPage.locator('.trash-list__header')).not.toContainText('用户名')
  const deletedBookmark = trashPage.locator('.trash-row').filter({ hasText: '书签测试站点' })
  await expect(deletedBookmark).toContainText('书签测试')
  await deletedBookmark.getByRole('button', { name: '恢复书签' }).click()
  await expect(page.locator('.toast')).toContainText('书签已恢复')
})

test('closes a tab without deleting its encrypted AutoLogin snapshot', async () => {
  await createVault(page)
  const initialTabs = await page.evaluate(() => window.autologin.tabs.list())

  await page.getByRole('button', { name: '新增标签页或打开数据库' }).click()
  await page.getByRole('menuitem', { name: '新增本地数据库' }).click()
  await expect(page.locator('.toast')).toContainText('数据库已创建')
  await expect
    .poll(() => page.evaluate(() => window.autologin.tabs.list().then((tabs) => tabs.length)))
    .toBe(initialTabs.length + 1)

  const createdTab = await page.evaluate(async (knownIds) => {
    const tabs = await window.autologin.tabs.list()
    return tabs.find((tab) => !knownIds.includes(tab.id))
  }, initialTabs.map((tab) => tab.id))
  expect(createdTab).toBeDefined()
  expect(createdTab!.name).toBe('本地数据库 1')
  const visibleAccountTabs = page.locator('.account-tab')
  await expect(visibleAccountTabs).toHaveCount(initialTabs.length + 1)
  const firstTab = visibleAccountTabs.first()
  await firstTab.dispatchEvent('click')
  await expect(firstTab).toHaveClass(/is-active/)
  expect(createdTab!.databaseFileName).toBe(`${createdTab!.name}.autologin`)
  const snapshotPath = join(
    userDataDirectory,
    'tabs',
    createdTab!.databaseFileName!
  )
  await expect.poll(() => existsSync(snapshotPath)).toBe(true)
  expect(
    existsSync(join(userDataDirectory, 'tabs', `tab-${createdTab!.id}.autologin`))
  ).toBe(false)
  expect(
    existsSync(join(userDataDirectory, 'tabs', 'tab-local.autologin'))
  ).toBe(false)
  const tabVisuals = await firstTab.evaluate((activeTab) => {
    const inactiveTab = activeTab.parentElement?.querySelector<HTMLElement>(
      '.account-tab:not(.is-active)'
    )
    const activeName =
      activeTab.querySelector<HTMLElement>('.account-tab__name')
    const inactiveName =
      inactiveTab?.querySelector<HTMLElement>('.account-tab__name')
    const indicator = getComputedStyle(activeTab, '::after')
    return {
      activeBackground: getComputedStyle(activeTab).backgroundColor,
      inactiveBackground: inactiveTab
        ? getComputedStyle(inactiveTab).backgroundColor
        : '',
      activeWeight: activeName ? getComputedStyle(activeName).fontWeight : '',
      inactiveWeight: inactiveName
        ? getComputedStyle(inactiveName).fontWeight
        : '',
      indicatorHeight: indicator.height,
      indicatorColor: indicator.backgroundColor
    }
  })
  expect(tabVisuals.inactiveBackground).not.toBe(tabVisuals.activeBackground)
  expect(Number(tabVisuals.activeWeight)).toBeGreaterThan(
    Number(tabVisuals.inactiveWeight)
  )
  expect(tabVisuals.indicatorHeight).toBe('2px')
  expect(tabVisuals.indicatorColor).not.toBe('rgba(0, 0, 0, 0)')

  const nextLocalDatabase = await page.evaluate(() =>
    window.autologin.tabs.create({ source: 'local' })
  )
  expect(nextLocalDatabase.name).toBe('本地数据库 2')

  const renamedTab = await page.evaluate(
    (tabId) =>
      window.autologin.tabs.update(tabId, {
        name: '重命名数据库测试'
      }),
    createdTab!.id
  )
  const renamedSnapshotPath = join(
    userDataDirectory,
    'tabs',
    renamedTab.databaseFileName ?? ''
  )
  expect(renamedTab.databaseFileName).toMatch(/\.autologin$/)
  await expect.poll(() => existsSync(renamedSnapshotPath)).toBe(true)
  expect(existsSync(snapshotPath)).toBe(false)

  await page
    .getByRole('button', { name: `关闭“${createdTab!.name}”数据库` })
    .click()
  await expect(
    page.getByRole('button', { name: `关闭“${createdTab!.name}”数据库` })
  ).toHaveCount(0)
  await expect
    .poll(() =>
      page.evaluate(
        async (tabId) =>
          (await window.autologin.tabs.list()).find((tab) => tab.id === tabId)
            ?.hidden ?? false,
        createdTab!.id
      )
    )
    .toBe(true)
  expect(existsSync(renamedSnapshotPath)).toBe(true)
})

test('defers an available update prompt until the vault is unlocked', async () => {
  await expect(page.getByRole('heading', { name: '创建你的本地保险库' })).toBeVisible()
  await application.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0]?.webContents.send('app:update-state', {
      phase: 'available',
      currentVersion: '0.9.8',
      latestVersion: '99.0.1',
      releaseName: 'AutoLogin v99.0.1',
      releaseNotes: '## 更新内容\n\n- 解锁后显示更新提示',
      interactive: true,
      message: '发现新版本 v99.0.1'
    })
  })
  await expect(page.locator('.update-dialog')).toHaveCount(0)
  await createVault(page)
  const updateDialog = page.locator('.update-dialog')
  await expect(updateDialog).toBeVisible()
  await expect(updateDialog).toContainText('v99.0.1')
  await updateDialog.getByRole('button', { name: '稍后提醒' }).click()
  await expect(updateDialog).toHaveCount(0)
})

test('persists appearance, language and interface scale with separate resets', async () => {
  await createVault(page)
  await addAccount(page, {
    siteName: '主题测试站点',
    startUrl: `${server.baseUrl}/login`,
    label: '主题测试账号',
    username: 'theme@example.test',
    password: 'secret-password'
  })

  await expect(page.getByRole('button', { name: '导入账号' })).toBeVisible()
  await expect(page.getByRole('button', { name: '导出加密配置' })).toBeVisible()
  await page.getByRole('button', { name: '导入账号' }).click()
  const importMenu = page.locator('.account-import-menu')
  await expect(
    importMenu.getByRole('menuitem', { name: '当前数据库导入标准CSV' })
  ).toBeVisible()
  await expect(
    importMenu.getByRole('menuitem', { name: '新数据库导入标准CSV' })
  ).toBeVisible()
  await expect(importMenu.getByRole('menuitem', { name: '导入 KDBX 数据库' })).toHaveCount(0)
  await expect(importMenu.getByRole('menuitem', { name: '导入浏览器书签' })).toHaveCount(0)
  await expect(importMenu.getByRole('menuitem', { name: '下载 CSV 模板' })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(importMenu).toHaveCount(0)
  await page.getByRole('button', { name: '新增标签页或打开数据库' }).click()
  const createMenu = page.locator('.account-create-menu')
  await expect(createMenu.getByRole('menuitem', { name: '新增本地数据库' })).toBeVisible()
  await expect(
    createMenu.getByRole('menuitem', { name: '📁 打开本地数据库' })
  ).toBeVisible()
  await expect(
    createMenu.getByRole('menuitem', { name: '打开 KDBX 数据库' })
  ).toHaveCount(0)
  await page.keyboard.press('Escape')
  await expect(createMenu).toHaveCount(0)

  const bookmarksNav = page
    .locator('.sidebar-nav')
    .getByRole('button', { name: '书签' })
  await expect(bookmarksNav).toBeVisible()
  await bookmarksNav.click()
  await expect(page.locator('.page-breadcrumb h1')).toHaveText('全部书签')
  await expect(page.getByRole('button', { name: '导入浏览器书签' }).first()).toBeVisible()

  const passwordGeneratorNav = page
    .locator('.sidebar-nav')
    .getByRole('button', { name: '密码生成器' })
  await expect(passwordGeneratorNav).toBeVisible()
  await passwordGeneratorNav.click()
  await expect(page.locator('.password-generator-page')).toBeVisible()
  await expect(
    page.locator('.password-generator-page .password-generator__preview code')
  ).not.toHaveText('')
  await expect(
    page.locator('.password-generator-page > .password-generator')
  ).toHaveCSS('box-shadow', 'none')

  const settingsNav = page
    .locator('.sidebar-actions')
    .getByRole('button', { name: '设置' })
  await expect(settingsNav).toBeVisible()
  await expect(page.locator('.window-titlebar')).toBeVisible()
  await expect(page.locator('.window-controls')).toHaveCount(0)
  await expect(page.locator('.sidebar-nav__item').filter({ hasText: '设置' })).toHaveCount(0)
  await expect(page.locator('.sidebar-section--preferences')).toHaveCount(0)
  await settingsNav.click()

  const settings = page.locator('.settings-page')
  await expect(page.locator('.page-breadcrumb')).toBeVisible()
  const resetScaleButton = settings.getByRole('button', { name: '恢复默认比例' })
  const resetFontButton = settings.getByRole('button', { name: '恢复默认字体大小' })
  const resetAllButton = settings.getByRole('button', { name: '恢复默认设置' })
  for (const button of [resetScaleButton, resetFontButton, resetAllButton]) {
    await expect(button).toHaveCSS('border-top-width', '0px')
    await expect(button).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')
  }
  for (const button of [resetScaleButton, resetFontButton, resetAllButton]) {
    const alignment = await button.evaluate((element) => {
      const card = element.closest<HTMLElement>('.settings-card')
      if (!card) return null
      const cardBox = card.getBoundingClientRect()
      const buttonBox = element.getBoundingClientRect()
      const paddingRight = Number.parseFloat(getComputedStyle(card).paddingRight)
      return {
        rightGap: cardBox.right - paddingRight - buttonBox.right,
        leftGap: buttonBox.left - cardBox.left
      }
    })
    expect(alignment).not.toBeNull()
    expect(Math.abs(alignment!.rightGap)).toBeLessThan(2)
    expect(alignment!.leftGap).toBeGreaterThan(80)
  }
  await expect(settings.locator('.page-breadcrumb > span').first()).toHaveText('设置')
  await expect(settings.locator('.settings-footer')).toHaveCount(0)
  await expect(settings.getByRole('tab')).toHaveCount(5)
  await expect(settings.getByRole('tab', { name: '外观主题' })).toHaveCount(0)
  await expect(settings.locator('.settings-panel__header')).toHaveCount(0)
  const settingsWidth = await settings.evaluate((element) => {
    const panel = element.querySelector<HTMLElement>('.settings-panel')
    return {
      page: element.getBoundingClientRect().width,
      panel: panel?.getBoundingClientRect().width ?? 0
    }
  })
  expect(settingsWidth.panel).toBeGreaterThan(settingsWidth.page * 0.9)
  await expect(page.locator('.library-content-scroll--settings')).toHaveCSS(
    'overflow-y',
    'hidden'
  )
  const settingsBody = settings.locator('.settings-page__body')
  await expect(settingsBody).toHaveCSS('overflow-y', 'auto')
  await page.waitForTimeout(300)
  const settingsStickyTop = await settings
    .locator('.settings-page__sticky')
    .evaluate((element) => element.getBoundingClientRect().top)
  await settingsBody.evaluate((element) => {
    element.scrollTop = element.scrollHeight
  })
  const settingsStickyTopAfterScroll = await settings
    .locator('.settings-page__sticky')
    .evaluate((element) => element.getBoundingClientRect().top)
  expect(Math.abs(settingsStickyTopAfterScroll - settingsStickyTop)).toBeLessThan(1)
  const spinAnimation = await page.evaluate(() => {
    const sample = document.createElement('span')
    sample.className = 'spin'
    document.body.append(sample)
    const style = getComputedStyle(sample)
    const result = {
      name: style.animationName,
      duration: style.animationDuration,
      iteration: style.animationIterationCount
    }
    sample.remove()
    return result
  })
  expect(spinAnimation).toEqual({
    name: 'spin',
    duration: '1s',
    iteration: 'infinite'
  })
  await expect(settingsNav).toHaveClass(/is-active/)
  const appearanceGroup = settings.getByRole('group', { name: '外观', exact: true })
  await expect(appearanceGroup.getByRole('button')).toHaveText([
    '亮色',
    '暗色',
    '跟随系统'
  ])

  await appearanceGroup.getByRole('button', { name: '暗色' }).click()
  await expect
    .poll(() => page.evaluate(() => window.autologin.settings.get()))
    .toMatchObject({ colorMode: 'dark' })
  await expect
    .poll(() => page.evaluate(() => document.documentElement.dataset.colorMode))
    .toBe('dark')

  await appearanceGroup.getByRole('button', { name: '跟随系统' }).click()
  await expect
    .poll(() => page.evaluate(() => window.autologin.settings.get()))
    .toMatchObject({ colorMode: 'system' })
  await expect
    .poll(() => page.evaluate(() => document.documentElement.dataset.colorMode))
    .toMatch(/^(light|dark)$/)

  await settings.getByRole('button', { name: 'English' }).click()
  await expect(settings.locator('.page-breadcrumb h2')).toHaveText('General')
  await settings.getByRole('button', { name: '繁體中文' }).click()
  await expect(settings.locator('.page-breadcrumb h2')).toHaveText('一般設定')
  await settings.getByRole('button', { name: '简体中文' }).click()
  await expect(settings.locator('.page-breadcrumb h2')).toHaveText('通用配置')

  await settings.getByRole('slider', { name: '界面比例' }).fill('125')
  await expect
    .poll(() => page.evaluate(() => window.autologin.settings.get()))
    .toMatchObject({ interfaceScale: 125 })
  const fontSizeSelector = settings.getByRole('group', { name: '文字大小' })
  await expect(fontSizeSelector.getByRole('button')).toHaveText([
    '80%',
    '100%',
    '125%',
    '150%'
  ])
  await fontSizeSelector.getByRole('button', { name: '125%', exact: true }).click()
  await expect
    .poll(() => page.evaluate(() => window.autologin.settings.get()))
    .toMatchObject({ fontSizeScale: 125 })
  await expect
    .poll(() =>
      page.evaluate(() =>
        getComputedStyle(document.documentElement).getPropertyValue('--font-scale').trim()
      )
    )
    .toBe('1.25')
  expect(
    await settings
      .locator('.page-breadcrumb h2')
      .evaluate((element) => Number.parseFloat(getComputedStyle(element).fontSize))
  ).toBeGreaterThan(13)
  await page.locator('.sidebar-nav__item').filter({ hasText: '账号' }).click()

  await page.locator('.account-row').first().dblclick()
  const editDrawer = page.locator('.account-drawer')
  await expect(editDrawer.getByRole('heading', { name: '主题测试站点' })).toBeVisible()
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
  await editDrawer.getByRole('button', { name: '关闭' }).click()

  await page.locator('.sidebar-actions').getByRole('button', { name: '设置' }).click()
  await settings.getByRole('button', { name: '恢复默认比例' }).click()
  await expect
    .poll(() => page.evaluate(() => window.autologin.settings.get()))
    .toMatchObject({ interfaceScale: 100 })
  await settings.getByRole('button', { name: '恢复默认字体大小' }).click()
  await expect
    .poll(() => page.evaluate(() => window.autologin.settings.get()))
    .toMatchObject({ fontSizeScale: 100 })
  await expect
    .poll(() =>
      page.evaluate(() =>
        getComputedStyle(document.documentElement).getPropertyValue('--font-scale').trim()
      )
    )
    .toBe('1')
  await expect(
    fontSizeSelector.getByRole('button', { name: '100%', exact: true })
  ).toHaveAttribute('aria-pressed', 'true')
  expect(
    await settings
      .locator('.page-breadcrumb h2')
      .evaluate((element) => Number.parseFloat(getComputedStyle(element).fontSize))
  ).toBeLessThan(13)

  await settings.getByRole('tab', { name: '数据与备份' }).click()
  await expect(settings.getByRole('heading', { name: '数据保存位置' })).toBeVisible()
  await expect(settings.getByRole('heading', { name: '自动备份' })).toBeVisible()
  await expect(settings.getByRole('button', { name: '导出加密配置' })).toHaveCount(0)
  await expect(
    settings.getByRole('button', { name: '当前数据库导入标准CSV' })
  ).toHaveCount(0)
  const restoreLocationButton = settings.getByRole('button', { name: '恢复默认位置' })
  await expect(restoreLocationButton).toBeVisible()
  await expect(restoreLocationButton).toBeDisabled()
  await expect(restoreLocationButton).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')
  const restoreLocationAlignment = await restoreLocationButton.evaluate((element) => {
    const card = element.closest<HTMLElement>('.settings-card')
    if (!card) return null
    const cardBox = card.getBoundingClientRect()
    const buttonBox = element.getBoundingClientRect()
    const paddingRight = Number.parseFloat(getComputedStyle(card).paddingRight)
    return cardBox.right - paddingRight - buttonBox.right
  })
  expect(restoreLocationAlignment).not.toBeNull()
  expect(Math.abs(restoreLocationAlignment!)).toBeLessThan(2)
  const runtimeVersion = await application.evaluate(({ app }) => app.getVersion())
  await expect(settings.locator('.settings-location code')).toContainText(userDataDirectory)
  await settings.getByRole('tab', { name: '关于与更新' }).click()
  await expect(settings.getByRole('heading', { name: '关于 AutoLogin' })).toBeVisible()
  await expect(settings.getByRole('heading', { name: '检查更新' })).toBeVisible()
  await expect(settings.locator('.settings-about-grid')).toContainText(`v${runtimeVersion}`)
  const checkUpdateButton = settings.locator('.settings-update-row .button--soft')
  await checkUpdateButton.click()
  await expect(checkUpdateButton).toBeDisabled()
  await expect(checkUpdateButton.locator('.loading-spinner')).toHaveCSS(
    'animation-name',
    'spin'
  )
  await expect(settings.locator('.settings-update-status')).toBeVisible({ timeout: 12000 })
  const updateDialog = page.locator('.update-dialog')
  if ((await updateDialog.count()) > 0) {
    await updateDialog.getByRole('button', { name: '稍后提醒' }).click()
    await expect(updateDialog).toHaveCount(0)
  }
  await application.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0]?.webContents.send('app:update-state', {
      phase: 'available',
      currentVersion: '0.8.5',
      latestVersion: '99.0.0',
      releaseName: 'AutoLogin v99.0.0',
      releaseNotes: '## 更新内容\n\n- 下载进度测试',
      interactive: true,
      message: '发现新版本 v99.0.0'
    })
  })
  await expect(updateDialog).toBeVisible()
  await updateDialog.getByRole('button', { name: '稍后提醒' }).click()
  await expect(updateDialog).toHaveCount(0)
  await application.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0]?.webContents.send('app:update-state', {
      phase: 'downloading',
      currentVersion: '0.8.5',
      latestVersion: '99.0.0',
      releaseName: 'AutoLogin v99.0.0',
      releaseNotes: '## 更新内容\n\n- 下载进度测试',
      interactive: true,
      percent: 48,
      transferred: 48 * 1024 * 1024,
      total: 100 * 1024 * 1024,
      bytesPerSecond: 4 * 1024 * 1024,
      message: '正在下载更新…'
    })
  })
  const settingsUpdate = settings.locator('.settings-active-update')
  await expect(settingsUpdate).toBeVisible()
  await expect(settingsUpdate.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '48')
  await expect(settingsUpdate.getByRole('button', { name: '取消下载' })).toBeVisible()
  const sidebarUpdateProgress = page.locator('.sidebar-update-progress')
  await expect(sidebarUpdateProgress).toBeVisible()
  await expect(
    sidebarUpdateProgress.getByRole('progressbar', { name: '更新下载进度' })
  ).toHaveAttribute('aria-valuenow', '48')
  await page.locator('.sidebar-nav__item').filter({ hasText: '账号' }).click()
  await expect(page.locator('.account-tabs')).toBeVisible()
  await sidebarUpdateProgress.click()
  await expect(settings).toBeVisible()
  await expect(settings.getByRole('tab', { name: '关于与更新' })).toHaveAttribute(
    'aria-selected',
    'true'
  )
  await application.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0]?.webContents.send('app:update-state', {
      phase: 'up-to-date',
      currentVersion: '0.8.5',
      interactive: true,
      message: '当前已是最新版本'
    })
  })

  await settings.getByRole('tab', { name: '网络代理' }).click()
  await expect(settings.getByRole('heading', { name: '代理模式' })).toBeVisible()
  await expect(settings.getByRole('button', { name: '测试连接' })).toBeVisible()
  await expect(settings.locator('.proxy-advanced-row')).toBeVisible()
  await expect(settings.getByRole('button', { name: '测试设置' })).toHaveCount(0)
  const proxyProtocol = settings.getByRole('combobox', { name: '协议' })
  const proxyHost = settings.getByRole('textbox', { name: '服务器' })
  const proxyPort = settings.getByRole('spinbutton', { name: '端口' })
  const proxyBypass = settings.getByRole('textbox', { name: '绕过代理' })
  await expect(proxyProtocol).toBeEnabled()
  await expect(proxyHost).toBeEnabled()
  await expect(proxyPort).toBeEnabled()
  await expect(proxyBypass).toBeEnabled()
  const testUrlInput = settings.getByRole('textbox', { name: '测试 URL' })
  await expect(testUrlInput).toHaveValue('https://www.google.com/')
  const testConnectionButton = settings.locator('.proxy-test-button')
  await testConnectionButton.click()
  await expect(testConnectionButton).toBeDisabled()
  await expect(testConnectionButton.locator('.loading-spinner')).toHaveCSS(
    'animation-name',
    'spin'
  )
  await expect(settings.locator('.proxy-test-result')).toBeVisible({ timeout: 12000 })
  await expect
    .poll(() =>
      page.evaluate(async () => {
        const logs = await window.autologin.app.listAppLogs(100)
        return logs.some(
          (entry) =>
            entry.category === 'proxy' &&
            entry.message.includes('网络代理连通性测试') &&
            entry.message.includes('https://www.google.com/')
        )
      })
    )
    .toBe(true)

  await testUrlInput.fill(
    'https://example.com/proxy-check'
  )
  await expect(testUrlInput).toHaveValue('https://example.com/proxy-check')
  await settings.getByRole('radio', { name: /跟随系统/ }).check()
  await expect(proxyProtocol).toBeDisabled()
  await expect(proxyHost).toBeDisabled()
  await expect(proxyPort).toBeDisabled()
  await expect(proxyBypass).toBeDisabled()
  await expect(testUrlInput).toBeEnabled()
  await settings.getByRole('button', { name: '保存代理配置' }).click()
  await expect
    .poll(() => page.evaluate(() => window.autologin.settings.get()))
    .toMatchObject({
      proxy: {
        mode: 'system',
        protocol: 'http',
        port: 8080,
        testUrl: 'https://example.com/proxy-check'
      }
    })
  await openLogPage(page, '软件日志')
  const appLogsPage = page.locator('.app-logs-page')
  await expect(appLogsPage.getByRole('heading', { name: '软件日志' })).toBeVisible()
  await expect(appLogsPage.locator('.logs-tabs').getByRole('tab')).toHaveCount(3)
  await expect(
    appLogsPage.getByRole('tab', { name: '软件日志' })
  ).toHaveAttribute('aria-selected', 'true')
  await appLogsPage.getByLabel('状态').selectOption('info')
  await selectPageSize(appLogsPage, '每页条数', 10)
  await appLogsPage.getByLabel('状态').selectOption('all')
  await expect(
    appLogsPage.locator('.app-log-row').filter({ hasText: '网络代理连通性测试' }).first()
  ).toBeVisible()
  const firstAppLogRow = appLogsPage.locator('.app-log-row').first()
  await expect(firstAppLogRow).toBeVisible()
  await expect(
    appLogsPage.locator('.app-log-row').filter({ hasText: '应用设置已更新' }).first()
  ).toBeVisible()
  await expect
    .poll(() =>
      page.evaluate(async () =>
        (await window.autologin.app.listAppLogs(500)).some(
          (entry) =>
            entry.category === 'startup' && entry.message.includes('AutoLogin v')
        )
      )
    )
    .toBe(true)
  await firstAppLogRow.getByRole('checkbox').check()
  const deleteAppLogsButton = appLogsPage.getByRole('button', { name: '批量删除' })
  await expect(deleteAppLogsButton).toBeEnabled()
  await deleteAppLogsButton.click()
  await page.locator('.confirm-dialog').getByRole('button', { name: '确认删除' }).click()
  await expect(page.locator('.toast')).toContainText('已删除 1 条软件日志')
})

test('searches site and group pickers and applies a generated password', async () => {
  await createVault(page)
  await page.evaluate(async () => {
    await window.autologin.groups.create({ name: '研发组' })
    await window.autologin.sites.save({
      name: '站点 Alpha',
      startUrl: 'https://alpha.example.test/login',
      autoSubmit: true
    })
    await window.autologin.sites.save({
      name: '站点 Beta',
      startUrl: 'https://beta.example.test/login',
      autoSubmit: true
    })
  })
  await page.getByRole('button', { name: '刷新' }).click()

  await page.getByRole('button', { name: '添加账号' }).click()
  const editor = page.locator('.account-editor-page')
  await expect(editor).toBeVisible()

  await editor.getByRole('button', { name: '选择站点' }).click()
  const siteSearch = editor.getByRole('textbox', { name: '搜索已有站点' })
  await siteSearch.fill('Beta')
  await expect(editor.getByRole('option', { name: /站点 Beta/ })).toBeVisible()
  await expect(editor.getByRole('option', { name: /站点 Alpha/ })).toHaveCount(0)
  await editor.getByRole('option', { name: /站点 Beta/ }).click()

  await editor.getByRole('button', { name: '站点分组' }).click()
  const groupSearch = editor.getByRole('textbox', { name: '搜索站点分组' })
  await groupSearch.fill('研发')
  await expect(editor.getByRole('option', { name: /研发组/ })).toBeVisible()
  await editor.getByRole('option', { name: /研发组/ }).click()

  await editor.getByRole('button', { name: '随机密码生成器' }).click()
  const generator = page.getByRole('dialog', { name: '随机密码生成器' })
  await expect(generator).toBeVisible()
  await expect(generator.locator('.password-generator__preview code')).not.toHaveText('')
  await expect(generator.locator('.password-generator__header')).toHaveCSS(
    'cursor',
    'default'
  )
  await page.waitForTimeout(250)
  const generatorLayout = await generator.evaluate((element) => {
    const rect = element.getBoundingClientRect()
    return {
      width: rect.width,
      centerOffset: Math.abs(rect.left + rect.width / 2 - window.innerWidth / 2),
      top: rect.top
    }
  })
  expect(generatorLayout.width).toBeGreaterThanOrEqual(440)
  expect(generatorLayout.centerOffset).toBeLessThanOrEqual(3)
  expect(generatorLayout.top).toBeGreaterThanOrEqual(48)
  const dragHandle = await generator.locator('.password-generator__header').boundingBox()
  expect(dragHandle).not.toBeNull()
  await page.mouse.move(dragHandle!.x + 16, dragHandle!.y + 16)
  await page.mouse.down()
  await page.mouse.move(2, 2, { steps: 6 })
  await page.mouse.up()
  const draggedLayout = await generator.evaluate((element) => {
    const rect = element.getBoundingClientRect()
    return { left: rect.left, top: rect.top }
  })
  expect(draggedLayout.left).toBeGreaterThanOrEqual(8)
  expect(draggedLayout.top).toBeGreaterThanOrEqual(48)
  await generator.getByRole('button', { name: '使用此密码' }).click()
  await expect(generator).toHaveCount(0)
  await expect(editor.getByPlaceholder('输入登录密码')).toHaveValue(/.{8,}/)
})

test('opens settings from the bottom gear while the sidebar is collapsed', async () => {
  await createVault(page)
  const lockButton = page
    .locator('.sidebar-actions')
    .getByRole('button', { name: '立即锁定' })
  await expect(lockButton).toHaveText('')
  await expect(lockButton).toHaveAttribute('data-tooltip', '立即锁定')
  await page.getByRole('button', { name: '隐藏菜单栏' }).click()
  const settingsButton = page
    .locator('.sidebar-actions')
    .getByRole('button', { name: '设置' })
  await settingsButton.click()

  const settingsPage = page.locator('.settings-page')
  await expect(settingsPage).toBeVisible()
  await expect(settingsPage.getByRole('tab', { name: '通用配置' })).toBeVisible()
  await expect(page.locator('.sidebar-settings-popover')).toHaveCount(0)
  await expect(settingsButton).toHaveClass(/is-active/)
})

test('supports group actions, batch editing and one-browser tabs', async () => {
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
  await accountDrawer.getByRole('button', { name: '选择站点' }).click()
  await expect(accountDrawer.locator('.site-picker__menu')).toBeVisible()
  await accountDrawer.getByRole('option', { name: /工作站点/ }).click()
  await expect(accountDrawer.getByPlaceholder('例如：工作台')).toHaveValue('工作站点')
  const groupPicker = accountDrawer.locator('.group-picker')
  await groupPicker.getByRole('button', { name: '站点分组' }).click()
  const groupPickerMenu = groupPicker.getByRole('listbox', { name: '站点分组列表' })
  await expect(groupPickerMenu).toBeVisible()
  await expect(groupPickerMenu.getByRole('option', { name: /工作/ })).toBeVisible()
  const pickerMetrics = await groupPicker.evaluate((element) => {
    const trigger = element.querySelector<HTMLElement>('.site-picker__trigger')
    const menu = element.querySelector<HTMLElement>('.site-picker__menu')
    return {
      triggerWidth: trigger?.getBoundingClientRect().width ?? 0,
      menuWidth: menu?.getBoundingClientRect().width ?? 0,
      menuRadius: menu ? Number.parseFloat(getComputedStyle(menu).borderRadius) : 0
    }
  })
  expect(pickerMetrics.menuWidth).toBeCloseTo(pickerMetrics.triggerWidth, 0)
  expect(pickerMetrics.menuRadius).toBeGreaterThan(0)
  await groupPickerMenu.getByRole('option', { name: /工作/ }).click()
  await expect(groupPicker.getByRole('button', { name: '站点分组' })).toContainText('工作')
  await accountDrawer.getByRole('button', { name: '关闭' }).click()

  await addAccount(page, {
    siteName: '备用站点',
    startUrl: `${untrustedServer.baseUrl}/login`,
    label: '工作副账号',
    username: 'tester@example.test',
    password: 'secret-password',
    group: '工作'
  })
  await expect(page.locator('.account-row')).toHaveCount(2)
  const groupRow = page
    .locator('.account-subnav__item--group')
    .filter({ hasText: '工作' })
  await expect(groupRow).toBeVisible()
  await expect(groupRow).toContainText('2')
  await expect(groupRow).not.toContainText('工作主账号')
  const allAccountsNav = page.locator('.account-subnav__item').filter({ hasText: '全部账号' })
  const allAccountsText = await allAccountsNav.locator('span').first().boundingBox()
  const groupText = await groupRow.getByText('工作', { exact: true }).boundingBox()
  expect(allAccountsText?.x).toBeDefined()
  expect(groupText?.x).toBeDefined()
  expect(groupText!.x).toBeGreaterThan(allAccountsText!.x)
  await groupRow.click()
  await expect(page.getByRole('button', { name: '移动分组', exact: true })).toHaveCount(0)
  await expect(page.locator('.sidebar-group-row')).toHaveCount(0)
  await allAccountsNav.click()
  await expect(page.locator('.account-subnav__groups-accordion')).toHaveCSS(
    'visibility',
    'hidden'
  )
  await expect(groupRow).toBeHidden()
  await allAccountsNav.click()
  await expect(groupRow).toBeVisible()
  await expect(
    page.locator('.sidebar-actions').getByRole('button', { name: '添加账号' })
  ).toHaveCount(0)

  await expect(page.locator('.account-subnav__groups-toggle')).toHaveCount(0)
  await expect(page.getByRole('button', { name: '隐藏分组' })).toHaveCount(0)

  await groupRow.click({ button: 'right' })
  const groupMenu = page.locator('.group-context-menu')
  await expect(groupMenu).toBeVisible()
  await expect(groupMenu).not.toContainText('工作')
  await groupMenu.getByRole('menuitem', { name: '重命名分组' }).click()
  const renameModal = page.locator('.group-rename-modal')
  await expect(renameModal).toBeVisible()
  await renameModal.getByLabel('分组名称').fill('工作区')
  await renameModal.getByRole('button', { name: '保存名称' }).click()
  await expect(page.locator('.toast')).toContainText('分组已重命名')
  const renamedGroupRow = page
    .locator('.account-subnav__item--group')
    .filter({ hasText: '工作区' })
  await expect(renamedGroupRow).toContainText('2')

  await renamedGroupRow.click({ button: 'right' })
  await expect(groupMenu).toBeVisible()
  await expect(groupMenu.getByRole('menuitem', { name: /收藏分组/ })).toHaveCount(0)
  await page.keyboard.press('Escape')

  await application.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0]?.setSize(960, 640)
  })
  await page.waitForTimeout(250)
  const secondaryRow = page.locator('.account-row').filter({ hasText: '备用站点' })
  await expect(secondaryRow.getByRole('button', { name: '编辑' })).toHaveCount(0)
  await expect(secondaryRow.getByRole('button', { name: '登录' })).toBeVisible()
  await secondaryRow.dblclick()
  const editDrawer = page.locator('.account-drawer')
  await expect(editDrawer.getByRole('heading', { name: '备用站点' })).toBeVisible()
  await editDrawer.getByRole('radio', { name: /手动配置/ }).check()
  await editDrawer.getByRole('button', { name: '添加步骤' }).click()
  await editDrawer.getByRole('button', { name: '添加步骤' }).click()
  await editDrawer.getByRole('button', { name: '添加步骤' }).click()
  const drawerLayout = await editDrawer.evaluate((element) => {
    const body = element.querySelector<HTMLElement>('.account-drawer__body')
    const footer = element.querySelector<HTMLElement>('.account-drawer__footer')
    return {
      drawerBottom: element.getBoundingClientRect().bottom,
      bodyOverflow: body ? getComputedStyle(body).overflowY : '',
      bodyBottom: body?.getBoundingClientRect().bottom ?? 0,
      footerTop: footer?.getBoundingClientRect().top ?? 0,
      footerBottom: footer?.getBoundingClientRect().bottom ?? 0
    }
  })
  expect(drawerLayout.bodyOverflow).toBe('auto')
  expect(drawerLayout.bodyBottom).toBeLessThanOrEqual(drawerLayout.footerTop + 1)
  expect(drawerLayout.footerBottom).toBeLessThanOrEqual(
    (await page.evaluate(() => window.innerHeight)) + 1
  )
  expect(drawerLayout.drawerBottom).toBeLessThanOrEqual(
    (await page.evaluate(() => window.innerHeight)) + 1
  )
  await editDrawer.locator('.account-drawer__body').evaluate((element) => {
    element.scrollTop = element.scrollHeight
  })
  const selectorPanelLayout = await editDrawer.evaluate((element) => {
    const panel = element.querySelector<HTMLElement>('.manual-selector-panel')
    const fields = panel?.querySelector<HTMLElement>('.manual-selector-panel__fields')
    const rows = Array.from(panel?.querySelectorAll<HTMLElement>('.manual-step-row') ?? [])
    if (!panel || !fields || rows.length !== 3) return null
    const panelRect = panel.getBoundingClientRect()
    return {
      fieldsIsDirectChild: fields.parentElement === panel,
      rowHeights: rows.map((row) => row.getBoundingClientRect().height),
      controlHeights: rows.map(
        (row) =>
          row.querySelector<HTMLElement>('.manual-step-row__action')?.getBoundingClientRect()
            .height ?? 0
      ),
      rowsContained: rows.every((row) => {
        const rowRect = row.getBoundingClientRect()
        return (
          rowRect.top >= panelRect.top - 1 &&
          rowRect.bottom <= panelRect.bottom + 1 &&
          rowRect.left >= panelRect.left - 1 &&
          rowRect.right <= panelRect.right + 1
        )
      })
    }
  })
  expect(selectorPanelLayout).not.toBeNull()
  expect(selectorPanelLayout!.fieldsIsDirectChild).toBe(true)
  expect(selectorPanelLayout!.rowsContained).toBe(true)
  expect(Math.min(...selectorPanelLayout!.rowHeights)).toBeGreaterThanOrEqual(40)
  expect(
    Math.max(...selectorPanelLayout!.controlHeights) -
      Math.min(...selectorPanelLayout!.controlHeights)
  ).toBeLessThanOrEqual(1)
  const selectorFooterGap = await editDrawer.evaluate((element) => {
    const selectors = element.querySelector<HTMLElement>('.manual-selector-panel')
    const footer = element.querySelector<HTMLElement>('.account-drawer__footer')
    return selectors && footer
      ? footer.getBoundingClientRect().top - selectors.getBoundingClientRect().bottom
      : 0
  })
  expect(selectorFooterGap).toBeGreaterThanOrEqual(24)
  await expect(editDrawer.locator('.manual-step-row').nth(2).getByLabel('步骤 3 动作类型')).toHaveValue(
    'click'
  )
  await editDrawer.getByRole('radio', { name: /自动识别/ }).check()
  await editDrawer.getByPlaceholder('例如：工作台').fill('备用站点（已编辑）')
  await editDrawer.getByRole('button', { name: '保存修改' }).click()
  await expect(
    page.locator('.account-row').filter({ hasText: '备用站点（已编辑）' })
  ).toBeVisible()
  await application.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0]?.setSize(1180, 760)
  })
  await page.waitForTimeout(250)

  const mainRow = page.locator('.account-row').filter({ hasText: '工作站点' })
  const editedRow = page.locator('.account-row').filter({ hasText: '备用站点（已编辑）' })
  await page.getByRole('checkbox', { name: '选择站点 工作站点', exact: true }).check()
  await page
    .getByRole('checkbox', { name: '选择站点 备用站点（已编辑）', exact: true })
    .check()

  await page.getByRole('button', { name: '批量操作' }).click()
  const batchModal = page.locator('.batch-strategy-modal')
  await expect(batchModal).toBeVisible()
  await batchModal.getByRole('radio', { name: /手动配置/ }).check()
  await batchModal.getByLabel('用户名定位器').fill('input[name="username"]')
  await batchModal.getByLabel('密码定位器').fill('input[name="password"]')
  await batchModal.getByRole('button', { name: '应用设置' }).click()
  await expect(batchModal).toHaveCount(0)
  await expect
    .poll(() =>
      page.evaluate(async () =>
        (await window.autologin.accounts.list()).map((account) => account.loginStrategy)
      )
    )
    .toEqual(['manual', 'manual'])

  await mainRow.getByRole('checkbox').check()
  await editedRow.getByRole('checkbox').check()
  await page.getByRole('button', { name: '批量操作' }).click()
  await batchModal.getByRole('radio', { name: /自动识别/ }).check()
  await batchModal.getByRole('button', { name: '应用设置' }).click()
  await expect(batchModal).toHaveCount(0)
  await expect
    .poll(() =>
      page.evaluate(async () =>
        (await window.autologin.accounts.list()).map((account) => account.loginStrategy)
      )
    )
    .toEqual(['auto', 'auto'])

  await mainRow.getByRole('checkbox').check()
  await editedRow.getByRole('checkbox').check()
  await page.getByRole('button', { name: '批量操作' }).click()
  const batchLogoInput = batchModal.getByLabel('选择批量 Logo 文件')
  await batchLogoInput.setInputFiles({
    name: 'batch-logo.png',
    mimeType: 'image/png',
    buffer: Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl9sAAAAASUVORK5CYII=',
      'base64'
    )
  })
  await expect(batchModal.locator('.batch-icon-editor__preview img')).toHaveAttribute(
    'src',
    /^data:image\/png;base64,/
  )
  await batchModal.getByRole('button', { name: '应用 Logo' }).click()
  await expect(page.locator('.toast')).toContainText('已更新 2 个账号的 Logo')
  await expect(batchModal).toHaveCount(0)
  await expect(mainRow.locator('.monogram--image img')).toHaveAttribute(
    'src',
    /^data:image\/png;base64,/
  )
  await expect(editedRow.locator('.monogram--image img')).toHaveAttribute(
    'src',
    /^data:image\/png;base64,/
  )

  await mainRow.getByRole('checkbox').check()
  await editedRow.getByRole('checkbox').check()
  await page.getByRole('button', { name: '批量操作' }).click()
  const fetchSiteIconsButton = batchModal.getByRole('button', {
    name: '获取网站图标'
  })
  await expect(fetchSiteIconsButton).toBeVisible()
  await fetchSiteIconsButton.click()
  await expect(page.locator('.toast')).toContainText(
    '已获取并更新 2 个账号的网站图标',
    { timeout: 15000 }
  )
  await expect(batchModal).toHaveCount(0)
  await expect(mainRow.locator('.monogram--image img')).toHaveAttribute(
    'src',
    /^data:image\/svg\+xml;base64,/
  )
  await expect(editedRow.locator('.monogram--image img')).toHaveAttribute(
    'src',
    /^data:image\/svg\+xml;base64,/
  )

  await mainRow.getByRole('checkbox').check()
  await editedRow.getByRole('checkbox').check()
  await page.getByRole('button', { name: '批量操作' }).click()
  await batchModal.getByRole('button', { name: '复制所选账号' }).click()
  await expect(page.locator('.toast')).toContainText('已复制 2 个账号')
  await expect(page.locator('.account-row')).toHaveCount(4)
  await expect(page.locator('.account-row').filter({ hasText: '副本' })).toHaveCount(2)
  await expect(renamedGroupRow).toContainText('4')

  await page.getByRole('checkbox', { name: '选择站点 工作站点', exact: true }).check()
  await page
    .getByRole('checkbox', { name: '选择站点 备用站点（已编辑）', exact: true })
    .check()

  const previousBatchId = await currentBatchId(page)
  await page.getByRole('button', { name: '批量登录' }).click()
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

  await renamedGroupRow.click({ button: 'right' })
  await groupMenu.getByRole('menuitem', { name: '删除分组' }).click()
  const deleteGroupDialog = page.locator('.confirm-dialog')
  await expect(deleteGroupDialog).toContainText('站点会移至未分组')
  await deleteGroupDialog.getByRole('button', { name: '删除分组' }).click()
  await expect(page.locator('.toast')).toContainText('分组已删除')
  await expect(renamedGroupRow).toHaveCount(0)
  await expect(page.locator('.account-row')).toHaveCount(4)
  await expect(page.locator('.account-row').filter({ hasText: '未分组' })).toHaveCount(4)
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

  await page.locator('.account-row').first().dblclick()
  const accountDrawer = page.locator('.account-drawer')
  await expect(accountDrawer).toBeVisible()
  await accountDrawer.getByRole('button', { name: '录制新流程' }).click()
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
  const activeTab = page.locator('.account-tab.is-active')
  await expect(activeTab).toHaveCSS('box-shadow', 'none')
  await expect(activeTab).toHaveCSS('border-bottom-left-radius', '0px')
  await expect(activeTab).toHaveCSS('border-bottom-right-radius', '0px')
  const recordedTypes = await page.evaluate(async () => {
    const accounts = await window.autologin.accounts.list()
    const active = accounts[0]?.recipes?.find(
      (recipe) => recipe.id === accounts[0]?.activeRecipeId
    )
    return active?.recipe.steps.map((step) => step.type) ?? []
  })
  expect(recordedTypes).toEqual(['fillUsername', 'click', 'fillPassword', 'click'])

  await page.locator('.account-row').first().dblclick()
  await expect(page.locator('.account-drawer')).toContainText('1/3 已保存')

  await page.locator('.drawer-recipe-row').getByRole('button', { name: '编辑' }).click()
  const recipeModal = page.locator('.recipe-details-modal')
  await expect(recipeModal).toBeVisible()
  const recipeRows = recipeModal.locator('.recipe-details-step-row')
  await expect(recipeRows).toHaveCount(4)
  await expect(recipeRows.first().getByLabel('步骤 1 动作类型')).toHaveValue(
    'fillUsername'
  )
  await expect(recipeRows.first().locator('.manual-step-row__handle')).toHaveAttribute(
    'draggable',
    'true'
  )

  const firstSelector = recipeRows.first().getByLabel('步骤 1 Selector')
  await firstSelector.fill('input[name="username"]')
  await firstSelector.blur()
  await expect
    .poll(() =>
      page.evaluate(async () => {
        const accounts = await window.autologin.accounts.list()
        const active = accounts[0]?.recipes?.find(
          (recipe) => recipe.id === accounts[0]?.activeRecipeId
        )
        return active?.recipe.steps[0]?.selector?.candidates[0] ?? ''
      })
    )
    .toBe('input[name="username"]')

  await recipeRows.first().getByRole('button', { name: '测试' }).click()
  await expect(recipeRows.first()).toContainText('已找到可见的匹配元素', {
    timeout: 20000
  })

  const addRecipeStepButton = recipeModal.getByRole('button', {
    name: '添加新步骤'
  })
  await expect(addRecipeStepButton).toBeEnabled()
  await addRecipeStepButton.click()
  await expect(recipeRows).toHaveCount(5)
  const addedRow = recipeRows.last()
  await addedRow.getByLabel('步骤 5 动作类型').selectOption('click')
  await addedRow.getByLabel('步骤 5 Selector').fill('#next')
  await addedRow.getByLabel('步骤 5 Selector').blur()
  await expect
    .poll(() =>
      page.evaluate(async () => {
        const accounts = await window.autologin.accounts.list()
        const active = accounts[0]?.recipes?.find(
          (recipe) => recipe.id === accounts[0]?.activeRecipeId
        )
        const step = active?.recipe.steps.at(-1)
        return step?.type === 'click' ? step.selector.candidates[0] ?? '' : ''
      })
    )
    .toBe('#next')
  await addedRow.getByRole('button', { name: '删除步骤 5' }).click()
  await expect(recipeRows).toHaveCount(4)
  await expect
    .poll(() =>
      page.evaluate(async () => {
        const accounts = await window.autologin.accounts.list()
        const active = accounts[0]?.recipes?.find(
          (recipe) => recipe.id === accounts[0]?.activeRecipeId
        )
        return active?.recipe.steps.length ?? 0
      })
    )
    .toBe(4)
  await page.locator('.modal-backdrop').click({ position: { x: 10, y: 10 } })
  await page.locator('.account-drawer').getByRole('button', { name: '清除会话' }).click()
  await page.locator('.confirm-dialog').getByRole('button', { name: '清除会话' }).click()
  await expect(page.locator('.toast')).toContainText('网站会话已清除')
  await page
    .locator('.account-drawer')
    .getByRole('button', { name: '关闭', exact: true })
    .click()

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

async function selectPageSize(
  target: Page | Locator,
  label: string,
  size: number
): Promise<void> {
  const trigger = target.getByRole('button', { name: label, exact: true })
  await trigger.click()
  const menu = page.getByRole('menu', { name: label, exact: true })
  await expect(menu).toBeVisible()
  await expect(menu).toHaveCSS('position', 'fixed')
  const [triggerBox, menuBox] = await Promise.all([
    trigger.boundingBox(),
    menu.boundingBox()
  ])
  expect(triggerBox).not.toBeNull()
  expect(menuBox).not.toBeNull()
  expect(menuBox!.y + menuBox!.height).toBeLessThanOrEqual(triggerBox!.y + 1)
  expect(menuBox!.y).toBeGreaterThanOrEqual(40)
  await menu
    .getByRole('menuitemradio', { name: `${size} 条`, exact: true })
    .click()
  await expect(menu).toHaveCount(0)
}

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
  if (account.group) {
    const groups = await targetPage.evaluate(() => window.autologin.groups.list())
    if (!groups.some((group) => group.path === account.group)) {
      await targetPage.evaluate(
        (name) => window.autologin.groups.create({ name }),
        account.group
      )
      await targetPage.getByRole('button', { name: '刷新' }).click()
    }
  }
  await targetPage.getByRole('button', { name: '添加账号' }).first().click()
  const drawer = targetPage.locator('.account-drawer')
  await expect(drawer).toBeVisible()
  await expect(targetPage.locator('.app-shell')).toHaveClass(/is-account-editor/)
  await expect(targetPage.locator('.sidebar')).toBeHidden()
  const editorViewport = await targetPage.evaluate(() => ({
    editorWidth:
      document.querySelector<HTMLElement>('.account-editor-page')?.getBoundingClientRect()
        .width ?? 0,
    viewportWidth: window.innerWidth
  }))
  expect(editorViewport.editorWidth).toBeGreaterThan(editorViewport.viewportWidth * 0.95)
  if ((await drawer.getByRole('button', { name: '新站点' }).count()) > 0) {
    await drawer.getByRole('button', { name: '新站点' }).click()
  }
  await expectAccountDrawerControlsAligned(drawer)
  await expect(drawer.getByPlaceholder('例如：工作台')).toBeVisible()
  await drawer.getByPlaceholder('例如：工作台').fill(account.siteName)
  await drawer.getByPlaceholder('https://example.com/login').fill(account.startUrl)
  await drawer.getByPlaceholder('邮箱或账号').fill(account.username)
  await drawer.getByPlaceholder('输入登录密码').fill(account.password)
  if (account.group) {
    await drawer.getByRole('button', { name: '站点分组' }).click()
    await drawer.getByRole('listbox', { name: '站点分组列表' }).getByRole('option', {
      name: account.group
    }).click()
  }
  await drawer.getByRole('button', { name: '添加账号' }).click()
  await expect(
    targetPage.locator('.account-row').filter({ hasText: account.siteName })
  ).toHaveCount(1)
}

async function expectAccountDrawerControlsAligned(drawer: Locator): Promise<void> {
  const heights = await drawer
    .locator(
      '.account-drawer__body .segmented-control, .account-drawer__body .input-shell, .account-drawer__body .site-picker__trigger'
    )
    .evaluateAll((elements) =>
      elements
        .filter((element) => element.getClientRects().length > 0)
        .map((element) => element.getBoundingClientRect().height)
    )
  expect(heights.length).toBeGreaterThan(0)
  expect(Math.max(...heights) - Math.min(...heights)).toBeLessThanOrEqual(1)
}

async function openLogPage(
  targetPage: Page,
  label: '登录日志' | '访问日志' | '软件日志'
): Promise<void> {
  const logsButton = targetPage.getByRole('button', { name: '日志', exact: true })
  await logsButton.click()
  await expect(logsButton).toHaveClass(/is-active/)
  const tab = targetPage.locator('.logs-tabs').getByRole('tab', { name: label })
  await expect(tab).toBeVisible()
  await tab.click()
  await expect(tab).toHaveAttribute('aria-selected', 'true')
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
