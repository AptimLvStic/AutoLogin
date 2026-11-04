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

  await page.locator('.account-row').first().click()
  const drawer = page.locator('.account-drawer')
  await expectAccountDrawerControlsAligned(drawer)
  await drawer.getByRole('radio', { name: /手动配置/ }).check()
  const selectorRows = drawer.locator('.selector-config-row')
  await expect(selectorRows).toHaveCount(3)
  await selectorRows.nth(0).locator('input').fill('#username')
  await selectorRows.nth(1).locator('input').fill('#password')
  await selectorRows.nth(2).locator('input').fill('#login')

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
    loginStrategy: 'manual',
    manualSelectors: {
      username: '#username',
      password: '#password',
      submit: '#login'
    }
  })

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
  await page.locator('.batch-status').click()
  const logsPage = page.locator('.logs-page')
  await expect(logsPage.getByRole('heading', { name: '登录日志' })).toBeVisible()
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
  await logsPage.getByLabel('每页条数').selectOption('10')
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

test('searches accounts and uses centered table columns with icon-only actions', async () => {
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
  await expect(page.locator('.account-list__header')).toContainText('最后更新')
  await expect(page.locator('.account-list__header')).toContainText('分组')
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
  await page.getByRole('button', { name: '搜索账号', exact: true }).click()
  await expect(searchField).toHaveClass(/is-expanded/)

  await expect(page.locator('.account-list__header .account-col--site')).toHaveCSS(
    'text-align',
    'left'
  )
  const centeredColumns = [
    '.account-col--username',
    '.account-col--group',
    '.account-col--updated',
    '.account-col--status'
  ]
  for (const selector of centeredColumns) {
    await expect(page.locator(`.account-list__header ${selector}`)).toHaveCSS(
      'text-align',
      'center'
    )
  }
  const firstRow = page.locator('.account-row').first()
  await expect(firstRow.locator('.account-identity')).toHaveCSS('justify-content', 'flex-start')
  await expect(firstRow.locator('.account-username')).toHaveCSS('justify-content', 'center')
  await expect(firstRow.locator('.account-group-cell')).toHaveCSS('justify-content', 'center')
  await expect(firstRow.locator('.account-updated')).toHaveCSS('text-align', 'center')
  await expect(firstRow.locator('.account-status-cell')).toHaveCSS('justify-content', 'center')

  const addButton = page.getByRole('button', { name: '添加账号', exact: true })
  const refreshButton = page.getByRole('button', { name: '刷新', exact: true })
  const batchButton = page.getByRole('button', { name: '批量操作', exact: true })
  await expect(addButton).toHaveText('')
  await expect(addButton).toHaveCSS('box-shadow', 'none')
  await expect(refreshButton).toHaveText('')
  await expect(batchButton).toHaveText('')
  await expect(alphaRow.getByRole('button', { name: '登录', exact: true })).toHaveText('')
  await expect(alphaRow.getByRole('button', { name: '编辑', exact: true })).toHaveText('')
  await expect(page.locator('.sidebar-nav__item').filter({ hasText: '收藏' })).toHaveCount(0)

  await page.locator('.sidebar-nav__item').filter({ hasText: '账号' }).click()
  await page.getByRole('button', { name: '搜索账号', exact: true }).click()
  await page.getByRole('textbox', { name: '搜索账号' }).fill('beta@example.test')
  await expect(page.locator('.account-row')).toHaveCount(1)
  await expect(page.locator('.account-row')).toContainText('搜索站点 B')

  await page.getByRole('textbox', { name: '搜索账号' }).press('Escape')
  await expect(searchField).not.toHaveClass(/is-expanded/)
})

test('reorders sibling groups and moves a group with breadcrumb and toast updates', async () => {
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
    .toEqual(['Beta', 'Alpha'])
  await expect(page.locator('.account-subnav__item--group').nth(0)).toContainText('Beta')
  await expect(page.locator('.account-subnav__item--group').nth(1)).toContainText('Alpha')

  await page
    .locator('.account-subnav__item--group')
    .filter({ hasText: 'Beta' })
    .click()
  const moveGroupButton = page.getByRole('button', { name: '移动分组', exact: true })
  await expect(moveGroupButton).toBeEnabled()
  await moveGroupButton.click()
  const moveDialog = page.locator('.group-move-modal')
  await expect(moveDialog).toBeVisible()
  await moveDialog.getByLabel('目标分组').selectOption({ label: 'Alpha' })
  await moveDialog.getByRole('button', { name: '确认移动' }).click()
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
  await expect(page.locator('.sidebar-nav__item').filter({ hasText: '回收站' })).toContainText('2')

  await page.locator('.sidebar-nav__item').filter({ hasText: '回收站' }).click()
  const trashPage = page.locator('.trash-page')
  await expect(trashPage.locator('.trash-row')).toHaveCount(2)
  const retentionSelect = trashPage.getByRole('combobox', { name: '回收站保留天数' })
  await expect(retentionSelect).toHaveValue('7')
  await expect(retentionSelect.locator('option')).toHaveCount(4)
  await retentionSelect.selectOption('30')
  await expect(page.locator('.toast')).toContainText('保留天数已设为 30 天')
  await expect
    .poll(() => page.evaluate(() => window.autologin.settings.get()))
    .toMatchObject({ trashRetentionDays: 30 })
  await trashPage.locator('.trash-row').first().getByRole('button', { name: '恢复' }).click()
  await expect(page.locator('.toast')).toContainText('账号已恢复')
  await expect(trashPage.locator('.trash-row')).toHaveCount(1)
  await page.locator('.sidebar-nav__item').filter({ hasText: '账号' }).click()
  await expect(page.locator('.account-row')).toHaveCount(1)
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

  await expect(page.locator('.account-subnav__edge-toggle')).toHaveCount(0)
  const collapseButton = page.getByRole('button', { name: '隐藏账号侧边栏' })
  await expect(collapseButton).toHaveText('')
  const breadcrumbBox = await page.locator('.library-header').boundingBox()
  const collapseBox = await collapseButton.boundingBox()
  const toolbarBox = await page.locator('.library-toolbar').boundingBox()
  expect(breadcrumbBox).not.toBeNull()
  expect(collapseBox).not.toBeNull()
  expect(toolbarBox).not.toBeNull()
  expect(toolbarBox!.y).toBeGreaterThanOrEqual(breadcrumbBox!.y + breadcrumbBox!.height - 1)
  expect(collapseBox!.y).toBeGreaterThanOrEqual(toolbarBox!.y + toolbarBox!.height - 1)
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
    const main = element.querySelector<HTMLElement>(':scope > .account-subnav__group-main')
    return {
      rowContainers: children.map((child) =>
        child.classList.contains('account-subnav__drag-handle')
          ? 'drag'
          : child.classList.contains('account-subnav__group-main')
            ? 'main'
            : child.classList.contains('account-subnav__add-group')
              ? 'add'
              : 'other'
      ),
      mainContainers: main
        ? Array.from(main.children).map((child) => child.className)
        : []
    }
  })
  expect(groupRowStructure.rowContainers).toEqual(['drag', 'main', 'add'])
  expect(groupRowStructure.mainContainers[0]).toContain('account-subnav__item--group')
  expect(groupRowStructure.mainContainers[1]).toContain('account-subnav__group-toggle')
  await page.getByRole('button', { name: '新增一级分组' }).click()
  await groupPopover.getByLabel('分组名称').fill('Parent')
  await groupPopover.getByRole('button', { name: '创建' }).click()
  await expect(groupPopover).toContainText('同级分组名称已存在')
  await groupPopover.getByLabel('分组名称').fill('Bad/Name')
  await groupPopover.getByRole('button', { name: '创建' }).click()
  await expect(groupPopover).toContainText('分组名称不能包含特殊字符')
  await page.keyboard.press('Escape')
  await expect(groupPopover).toHaveCount(0)
  await parentRow.getByRole('button', { name: '在“Parent”下新增子分组' }).click()
  await expect(groupPopover).toBeVisible()
  await groupPopover.getByLabel('分组名称').fill('Child')
  await groupPopover.getByLabel('分组名称').press('Enter')
  const childRow = page.locator('.account-subnav__group-row').filter({ hasText: 'Child' })
  await expect(childRow).toBeVisible()
  await childRow.getByRole('button', { name: '在“Child”下新增子分组' }).click()
  await groupPopover.getByLabel('分组名称').fill('Grand')
  await groupPopover.getByRole('button', { name: '创建' }).click()
  const grandRow = page.locator('.account-subnav__group-row').filter({ hasText: 'Grand' })
  await expect(grandRow).toBeVisible()
  await expect(grandRow.getByRole('button', { name: /新增子分组/ })).toHaveCount(0)
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
  await parentRow.getByRole('button', { name: '收起“Parent”' }).click()
  await expect(childRow).toHaveCount(0)
  await expect(grandRow).toHaveCount(0)
  await expect(parentRow).toBeVisible()
  await parentRow.getByRole('button', { name: '展开“Parent”' }).click()
  await expect(childRow).toBeVisible()
  await expect(grandRow).toBeVisible()
  await expect(page.locator('.account-subnav__edge-toggle')).toHaveCount(0)

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
    '.account-col--status'
  ]) {
    await expect(tableHeaders.locator(selector)).toBeVisible()
  }
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
  for (const selector of [
    '.account-col--site',
    '.account-col--username',
    '.account-col--group',
    '.account-col--updated',
    '.account-col--status'
  ]) {
    await expect(tableHeaders.locator(selector)).toBeVisible()
  }
  await expect(page.locator('.vault-indicator')).toHaveCSS('text-align', 'center')
})

test('copies row credentials and closes the menu after a selection', async () => {
  await createVault(page)
  await addAccount(page, {
    siteName: '复制菜单站点',
    startUrl: `${server.baseUrl}/login`,
    label: '复制菜单账号',
    username: 'copy-menu@example.test',
    password: 'secret-password'
  })

  const row = page.locator('.account-row').filter({ hasText: '复制菜单站点' })
  await row.locator('.account-copy-trigger').click()
  const copyMenu = page.locator('.account-copy-menu')
  await expect(copyMenu).toBeVisible()
  await copyMenu.getByRole('menuitem', { name: '复制用户名' }).click()
  await expect(copyMenu).toHaveCount(0)
  expect(await application.evaluate(({ clipboard }) => clipboard.readText())).toBe(
    'copy-menu@example.test'
  )

  await row.locator('.account-copy-trigger').click()
  await expect(copyMenu).toBeVisible()
  await copyMenu.getByRole('menuitem', { name: '复制账号' }).click()
  await expect(copyMenu).toHaveCount(0)
  await expect(page.locator('.toast')).toContainText('已创建')
  const copied = await page.evaluate(async () => (await window.autologin.accounts.list()).find(
    (account) => account.label.includes('副本')
  ))
  expect(copied?.favorite).toBe(false)
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
  await expect(settings.locator('.page-breadcrumb > span').first()).toHaveText('设置')
  await expect(settings.locator('.settings-footer')).toHaveCount(0)
  await expect(settings.getByRole('tab')).toHaveCount(6)
  await expect(settings.locator('.settings-panel__header')).toHaveCount(0)
  const settingsWidth = await settings.evaluate((element) => {
    const panel = element.querySelector<HTMLElement>('.settings-panel')
    return {
      page: element.getBoundingClientRect().width,
      panel: panel?.getBoundingClientRect().width ?? 0
    }
  })
  expect(settingsWidth.panel).toBeGreaterThan(settingsWidth.page * 0.9)
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
  const appearanceNav = settings.getByRole('tab', { name: '外观主题' })
  await appearanceNav.click()
  await expect(settings.locator('.page-breadcrumb h2')).toHaveText('外观主题')
  await expect(settings.locator('.theme-swatch').filter({ hasText: 'defalut' })).toBeVisible()
  await expect(settingsNav).toHaveClass(/is-active/)
  await expect(appearanceNav).toHaveClass(/is-active/)

  await settings.getByRole('button', { name: '暗色' }).click()
  await expect
    .poll(() => page.evaluate(() => window.autologin.settings.get()))
    .toMatchObject({ colorMode: 'dark' })
  await expect
    .poll(() => page.evaluate(() => document.documentElement.dataset.colorMode))
    .toBe('dark')

  await settings.getByRole('button', { name: 'English' }).click()
  await expect(settings.locator('.page-breadcrumb h2')).toHaveText('Appearance')
  await settings.getByRole('button', { name: '繁體中文' }).click()
  await expect(settings.locator('.page-breadcrumb h2')).toHaveText('外觀主題')
  await settings.getByRole('button', { name: '简体中文' }).click()
  await expect(settings.locator('.page-breadcrumb h2')).toHaveText('外观主题')

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
    .toMatchObject({ themePreset: 'magpie' })

  await settings.getByRole('tab', { name: '通用配置' }).click()
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

  await page.locator('.account-row').first().click()
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
  await editDrawer.getByRole('button', { name: '取消' }).click()

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
  await expect(
    settings.getByRole('button', { name: '导出加密配置' })
  ).toBeVisible()
  await expect(settings.getByRole('button', { name: '导入标准 CSV' })).toBeVisible()
  await expect(
    settings.getByRole('button', { name: '导入 KeePassXC (.kdbx)' })
  ).toBeVisible()
  const runtimeVersion = await application.evaluate(({ app }) => app.getVersion())
  await expect(settings.locator('.settings-location code')).toContainText(userDataDirectory)
  await settings.getByRole('tab', { name: '关于与更新' }).click()
  await expect(settings.getByRole('heading', { name: '关于 AutoLogin' })).toBeVisible()
  await expect(settings.getByRole('heading', { name: '检查更新' })).toBeVisible()
  await expect(settings.locator('.settings-about-grid')).toContainText(`v${runtimeVersion}`)
  const checkUpdateButton = settings.locator('.settings-update-row .button--soft')
  await checkUpdateButton.click()
  await expect(checkUpdateButton).toBeDisabled()
  await expect(checkUpdateButton.locator('.spin')).toHaveCSS('animation-name', 'spin')
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
  const testUrlInput = settings.getByRole('textbox', { name: '测试 URL' })
  await expect(testUrlInput).toHaveValue('https://www.google.com/')
  const testConnectionButton = settings.locator('.proxy-test-button')
  await testConnectionButton.click()
  await expect(testConnectionButton).toBeDisabled()
  await expect(testConnectionButton.locator('.spin')).toHaveCSS('animation-name', 'spin')
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
  await expect(settings.getByRole('textbox', { name: '服务器' })).toBeDisabled()
  await expect(settings.getByRole('spinbutton', { name: '端口' })).toBeDisabled()
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
  await expect(appLogsPage.locator('.logs-tabs').getByRole('tab')).toHaveCount(2)
  await expect(
    appLogsPage.getByRole('tab', { name: '软件日志' })
  ).toHaveAttribute('aria-selected', 'true')
  await appLogsPage.getByLabel('状态').selectOption('info')
  await appLogsPage.getByLabel('每页条数').selectOption('10')
  await appLogsPage.getByLabel('状态').selectOption('all')
  await expect(
    appLogsPage.locator('.app-log-row').filter({ hasText: '网络代理连通性测试' }).first()
  ).toBeVisible()
  const firstAppLogRow = appLogsPage.locator('.app-log-row').first()
  await expect(firstAppLogRow).toBeVisible()
  await expect(
    appLogsPage.locator('.app-log-row').filter({ hasText: '应用启动' }).first()
  ).toContainText('AutoLogin v')
  await firstAppLogRow.getByRole('checkbox').check()
  const deleteAppLogsButton = appLogsPage.getByRole('button', { name: '批量删除' })
  await expect(deleteAppLogsButton).toBeEnabled()
  await deleteAppLogsButton.click()
  await page.locator('.confirm-dialog').getByRole('button', { name: '确认删除' }).click()
  await expect(page.locator('.toast')).toContainText('已删除 1 条软件日志')
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
  const moveGroupButton = page.getByRole('button', { name: '移动分组', exact: true })
  await expect(moveGroupButton).toBeEnabled()
  const groupAccountCheckbox = page.getByRole('checkbox', {
    name: '选择站点 工作站点',
    exact: true
  })
  await groupAccountCheckbox.check()
  await expect(moveGroupButton).toBeDisabled()
  await groupAccountCheckbox.uncheck()
  await expect(moveGroupButton).toBeEnabled()
  await expect(page.locator('.sidebar-group-row')).toHaveCount(0)
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
  await expect(secondaryRow.getByRole('button', { name: '编辑' })).toBeVisible()
  await expect(secondaryRow.getByRole('button', { name: '登录' })).toBeVisible()
  await secondaryRow.click()
  const editDrawer = page.locator('.account-drawer')
  await expect(editDrawer.getByRole('heading', { name: '备用站点' })).toBeVisible()
  await editDrawer.getByRole('radio', { name: /手动配置/ }).check()
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
  const selectorFooterGap = await editDrawer.evaluate((element) => {
    const selectors = element.querySelector<HTMLElement>('.manual-selector-panel')
    const footer = element.querySelector<HTMLElement>('.account-drawer__footer')
    return selectors && footer
      ? footer.getBoundingClientRect().top - selectors.getBoundingClientRect().bottom
      : 0
  })
  expect(selectorFooterGap).toBeGreaterThanOrEqual(24)
  await expect(
    editDrawer.locator('.selector-config-row').filter({ hasText: '提交按钮' }).getByRole('textbox')
  ).toBeVisible()
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

  await page.locator('.account-row').first().click()
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
  const recordedTypes = await page.evaluate(async () => {
    const accounts = await window.autologin.accounts.list()
    const active = accounts[0]?.recipes?.find(
      (recipe) => recipe.id === accounts[0]?.activeRecipeId
    )
    return active?.recipe.steps.map((step) => step.type) ?? []
  })
  expect(recordedTypes).toEqual(['fillUsername', 'click', 'fillPassword', 'click'])

  await page.locator('.account-row').first().click()
  await expect(page.locator('.account-drawer')).toContainText('1/3 已保存')
  await page.locator('.drawer-recipe-row').getByRole('button', { name: '查看' }).click()
  await expect(page.locator('.recipe-details-modal')).toContainText('填写用户名')
  await page.locator('.modal-backdrop').click({ position: { x: 10, y: 10 } })
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
      '.account-drawer__body > .segmented-control, .account-drawer__body .input-shell, .account-drawer__body .site-picker__trigger'
    )
    .evaluateAll((elements) =>
      elements
        .filter((element) => element.getClientRects().length > 0)
        .map((element) => element.getBoundingClientRect().height)
    )
  expect(heights.length).toBeGreaterThan(0)
  expect(Math.max(...heights) - Math.min(...heights)).toBeLessThanOrEqual(1)
}

async function openLogPage(targetPage: Page, label: '登录日志' | '软件日志'): Promise<void> {
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
