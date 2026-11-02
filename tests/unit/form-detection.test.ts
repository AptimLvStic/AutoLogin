// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RecipeStep } from '../../src/shared/types'

import {
  executeStep,
  findChallengeField,
  inspectPage,
  shouldAutoSubmit
} from '../../src/shared/form-detection'

const rect = {
  bottom: 40,
  height: 40,
  left: 0,
  right: 200,
  top: 0,
  width: 200,
  x: 0,
  y: 0,
  toJSON: () => ({})
} as DOMRect

beforeEach(() => {
  document.body.innerHTML = ''
  vi.spyOn(HTMLElement.prototype, 'getClientRects').mockReturnValue({
    0: rect,
    length: 1,
    item: () => rect
  } as unknown as DOMRectList)
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
    configurable: true,
    value: vi.fn()
  })
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('generic form detection', () => {
  it('recognizes a standard username, password and submit form', () => {
    document.body.innerHTML = `
      <form>
        <label for="username">用户名</label>
        <input id="username" name="username" autocomplete="username" />
        <label for="password">密码</label>
        <input id="password" name="password" type="password" autocomplete="current-password" />
        <button id="login" type="submit">登录</button>
      </form>
    `

    const detection = inspectPage()
    expect(detection.username?.id).toBe('username')
    expect(detection.password?.id).toBe('password')
    expect(detection.submit?.id).toBe('login')
    expect(detection.confidence).toBe('high')
  })

  it('detects OTP and captcha fields but ignores a normal promo code field', () => {
    document.body.innerHTML = `
      <form>
        <input id="username" name="username" autocomplete="username" />
        <input id="password" name="password" type="password" />
        <input id="otp" name="verificationCode" maxlength="6" autocomplete="one-time-code" />
        <button type="submit">登录</button>
      </form>
      <form>
        <input id="promo" name="promoCode" maxlength="8" />
      </form>
    `

    expect(findChallengeField()?.id).toBe('otp')

    document.body.innerHTML = `
      <form>
        <input id="promo" name="promoCode" maxlength="8" />
        <button type="submit">提交</button>
      </form>
    `
    expect(findChallengeField()).toBeUndefined()
  })

  it('uses a visible captcha image to find an adjacent short code field', () => {
    document.body.innerHTML = `
      <form>
        <img alt="图形验证码" src="/captcha.png" />
        <input id="code" name="code" maxlength="6" />
        <button type="submit">登录</button>
      </form>
    `
    expect(findChallengeField()?.id).toBe('code')
  })
})

describe('recipe step safety', () => {
  it('does not pause a next-step click because of a challenge in another form', () => {
    document.body.innerHTML = `
      <form id="identity">
        <input id="username" name="username" autocomplete="username" />
        <button id="next" type="button">下一步</button>
      </form>
      <form id="second-factor">
        <input id="otp" name="verificationCode" maxlength="6" />
      </form>
    `
    const step: RecipeStep = {
      id: 'next-step',
      type: 'click',
      selector: { candidates: ['#next'] }
    }
    const result = executeStep(step, 'user', 'secret')
    expect(result.found).toBe(true)
    expect(result.clicked).toBe(true)
    expect(result.challengeDetected).toBe(false)
  })

  it('pauses before a submit click when the challenge belongs to the same form', () => {
    document.body.innerHTML = `
      <form>
        <input id="username" name="username" autocomplete="username" />
        <input id="password" name="password" type="password" />
        <input id="otp" name="verificationCode" maxlength="6" />
        <button id="login" type="submit">登录</button>
      </form>
    `
    const step: RecipeStep = {
      id: 'submit',
      type: 'click',
      selector: { candidates: ['#login'] }
    }
    const result = executeStep(step, 'user', 'secret')
    expect(result.challengeDetected).toBe(true)
    expect(result.clicked).toBe(false)
    expect(document.activeElement?.id).toBe('otp')
  })
})

describe('submit policy', () => {
  it('submits only once when all safety conditions are met', () => {
    expect(
      shouldAutoSubmit({
        autoSubmit: true,
        confidence: 'high',
        submitDetected: true,
        credentialsFilled: true
      })
    ).toBe(true)
    expect(
      shouldAutoSubmit({
        autoSubmit: false,
        confidence: 'high',
        submitDetected: true,
        credentialsFilled: true
      })
    ).toBe(false)
    expect(
      shouldAutoSubmit({
        autoSubmit: true,
        confidence: 'medium',
        submitDetected: true,
        credentialsFilled: true
      })
    ).toBe(false)
  })
})
