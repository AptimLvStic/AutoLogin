import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { URL } from 'node:url'

export interface FixtureServer {
  baseUrl: string
  close: () => Promise<void>
}

export async function startFixtureServer(): Promise<FixtureServer> {
  const server = createServer((request, response) => {
    void handleRequest(request, response)
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve())
  })
  const address = server.address()
  if (!address || typeof address === 'string') {
    await closeServer(server)
    throw new Error('测试服务器没有启动端口')
  }
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () => closeServer(server)
  }
}

async function handleRequest(
  request: IncomingMessage,
  response: ServerResponse
): Promise<void> {
  const url = new URL(request.url ?? '/', 'http://127.0.0.1')
  const body = request.method === 'POST' ? await readBody(request) : ''
  const loggedIn = hasSessionCookie(request.headers.cookie)

  if (url.pathname === '/cross-origin') {
    const target = url.searchParams.get('target') ?? ''
    if (/^http:\/\/127\.0\.0\.1:\d+\//.test(target)) {
      response.writeHead(302, { Location: target })
      response.end()
      return
    }
    sendHtml(response, 400, '<h1>无效的测试跳转</h1>')
    return
  }

  if (url.pathname === '/login') {
    if (request.method === 'POST') {
      const params = new URLSearchParams(body)
      if (params.get('username') === 'tester@example.test' && params.get('password') === 'secret-password') {
        response.writeHead(302, {
          'Set-Cookie': 'autologin_session=standard; Path=/; SameSite=Lax',
          Location: '/home'
        })
        response.end()
        return
      }
      sendHtml(response, 401, loginPage('用户名或密码错误'))
      return
    }
    if (loggedIn) {
      response.writeHead(302, { Location: '/home' })
      response.end()
      return
    }
    sendHtml(response, 200, loginPage())
    return
  }

  if (url.pathname === '/home') {
    if (!loggedIn) {
      response.writeHead(302, { Location: '/login' })
      response.end()
      return
    }
    sendHtml(
      response,
      200,
      `<!doctype html><html lang="zh-CN"><body><main><h1 id="welcome">Welcome back</h1><p>标准登录会话已建立。</p><a href="/logout">退出</a></main></body></html>`
    )
    return
  }

  if (url.pathname === '/logout') {
    response.writeHead(302, {
      'Set-Cookie': 'autologin_session=; Path=/; Max-Age=0',
      Location: '/login'
    })
    response.end()
    return
  }

  if (url.pathname === '/captcha') {
    if (request.method === 'POST') {
      const params = new URLSearchParams(body)
      if (
        params.get('username') === 'tester@example.test' &&
        params.get('password') === 'secret-password' &&
        params.get('verificationCode') === '123456'
      ) {
        response.writeHead(302, {
          'Set-Cookie': 'autologin_session=captcha; Path=/; SameSite=Lax',
          Location: '/home'
        })
        response.end()
        return
      }
      sendHtml(response, 401, captchaPage('验证码不正确'))
      return
    }
    sendHtml(response, 200, captchaPage())
    return
  }

  if (url.pathname === '/multi/step1') {
    sendHtml(
      response,
      200,
      `<!doctype html><html lang="zh-CN"><body><form action="/multi/step2" method="get">
        <label for="username">用户名</label>
        <input id="username" name="username" autocomplete="username" />
        <button id="next" type="submit">下一步</button>
      </form></body></html>`
    )
    return
  }

  if (url.pathname === '/multi/step2') {
    sendHtml(
      response,
      200,
      `<!doctype html><html lang="zh-CN"><body><form action="/multi/login" method="post">
        <input type="hidden" name="username" value="${escapeHtml(url.searchParams.get('username') ?? '')}" />
        <label for="password">密码</label>
        <input id="password" name="password" type="password" autocomplete="current-password" />
        <button id="multi-login" type="submit">登录</button>
      </form></body></html>`
    )
    return
  }

  if (url.pathname === '/multi/login' && request.method === 'POST') {
    const params = new URLSearchParams(body)
    if (params.get('password') === 'secret-password') {
      response.writeHead(302, {
        'Set-Cookie': 'autologin_session=multi; Path=/; SameSite=Lax',
        Location: '/home'
      })
      response.end()
      return
    }
    sendHtml(response, 401, '<h1>登录失败</h1>')
    return
  }

  if (url.pathname === '/untrusted-redirect') {
    response.writeHead(302, { Location: 'https://example.com/' })
    response.end()
    return
  }

  response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
  response.end('Not found')
}

function loginPage(message = ''): string {
  return `<!doctype html>
  <html lang="zh-CN">
    <head><meta charset="utf-8"><title>Fixture Login</title></head>
    <body>
      <main>
        <h1>登录测试站</h1>
        ${message ? `<p id="error">${escapeHtml(message)}</p>` : ''}
        <form method="post" action="/login">
          <label for="username">用户名</label>
          <input id="username" name="username" autocomplete="username" />
          <label for="password">密码</label>
          <input id="password" name="password" type="password" autocomplete="current-password" />
          <button id="login" type="submit">登录</button>
        </form>
      </main>
    </body>
  </html>`
}

function captchaPage(message = ''): string {
  return `<!doctype html>
  <html lang="zh-CN">
    <head><meta charset="utf-8"><title>Fixture Captcha</title></head>
    <body>
      <main>
        <h1>验证码登录</h1>
        ${message ? `<p id="error">${escapeHtml(message)}</p>` : ''}
        <form method="post" action="/captcha">
          <label for="username">用户名</label>
          <input id="username" name="username" autocomplete="username" />
          <label for="password">密码</label>
          <input id="password" name="password" type="password" autocomplete="current-password" />
          <img alt="图形验证码" src="/captcha-image" />
          <label for="otp">验证码</label>
          <input id="otp" name="verificationCode" maxlength="6" autocomplete="one-time-code" />
          <button id="captcha-submit" type="submit">登录</button>
        </form>
      </main>
    </body>
  </html>`
}

async function readBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = []
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }
  return Buffer.concat(chunks).toString('utf8')
}

function hasSessionCookie(cookie: string | undefined): boolean {
  return Boolean(cookie?.split(';').some((part) => part.trim().startsWith('autologin_session=')))
}

function sendHtml(response: ServerResponse, statusCode: number, body: string): void {
  response.writeHead(statusCode, {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store'
  })
  response.end(body)
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()))
  })
}
