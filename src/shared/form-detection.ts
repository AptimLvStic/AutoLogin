import type { RecipeStep, SelectorSpec } from './types'

export type DetectionConfidence = 'high' | 'medium' | 'low'

export interface Detection {
  username?: HTMLInputElement
  password?: HTMLInputElement
  challenge?: HTMLInputElement
  submit?: HTMLElement
  form?: HTMLFormElement
  confidence: DetectionConfidence
}

export interface FillResult {
  formFound: boolean
  usernameFilled: boolean
  passwordFilled: boolean
  challengeDetected: boolean
  submitted: boolean
  confidence: DetectionConfidence
}

export interface StepResult {
  stepId: string
  found: boolean
  challengeDetected: boolean
  clicked: boolean
}

interface FillOptions {
  username: string
  password: string
  autoSubmit: boolean
}

interface FillHooks {
  recording: boolean
  onRecordStep: (step: RecipeStep) => void
  onChallengeDetected: () => void
}

const DEFERRED_ACTION_DELAY_MS = 50

export async function fillGeneric(
  options: FillOptions,
  hooks: FillHooks
): Promise<FillResult> {
  const detection = await waitForLoginForm()
  const formFound = Boolean(
    detection.username ||
      detection.password ||
      detection.challenge ||
      detection.form ||
      detection.submit
  )
  let usernameFilled = false
  let passwordFilled = false

  if (detection.username) {
    fillInput(detection.username, options.username)
    usernameFilled = true
    if (hooks.recording) {
      hooks.onRecordStep(inputStep('fillUsername', detection.username))
    }
  }
  if (detection.password) {
    fillInput(detection.password, options.password)
    passwordFilled = true
    if (hooks.recording) {
      hooks.onRecordStep(inputStep('fillPassword', detection.password))
    }
  }

  const challenge = detection.challenge ?? findChallengeField()
  if (challenge) {
    focusChallenge(challenge)
    if (hooks.recording) {
      hooks.onRecordStep(inputStep('focusChallenge', challenge))
    }
    hooks.onChallengeDetected()
    return {
      formFound,
      usernameFilled,
      passwordFilled,
      challengeDetected: true,
      submitted: false,
      confidence: detection.confidence
    }
  }

  const shouldSubmit = shouldAutoSubmit({
    autoSubmit: options.autoSubmit,
    confidence: detection.confidence,
    submitDetected: Boolean(detection.submit),
    credentialsFilled: usernameFilled || passwordFilled
  })

  if (shouldSubmit && detection.submit) {
    await delay(260)
    const latest = inspectPage()
    const lateChallenge = latest.challenge ?? findChallengeField()
    if (lateChallenge) {
      focusChallenge(lateChallenge)
      if (hooks.recording) {
        hooks.onRecordStep(inputStep('focusChallenge', lateChallenge))
      }
      hooks.onChallengeDetected()
      return {
        formFound: true,
        usernameFilled,
        passwordFilled,
        challengeDetected: true,
        submitted: false,
        confidence: latest.confidence
      }
    }
    clickElement(latest.submit ?? detection.submit)
  }

  return {
    formFound,
    usernameFilled,
    passwordFilled,
    challengeDetected: false,
    submitted: shouldSubmit,
    confidence: detection.confidence
  }
}

export function shouldAutoSubmit(input: {
  autoSubmit: boolean
  confidence: DetectionConfidence
  submitDetected: boolean
  credentialsFilled: boolean
}): boolean {
  return (
    input.autoSubmit &&
    input.confidence === 'high' &&
    input.submitDetected &&
    input.credentialsFilled
  )
}

export function executeStep(
  step: RecipeStep,
  username: string,
  password: string
): StepResult {
  if (step.type === 'focusChallenge') {
    const challenge = step.selector ? findBySelector(step.selector) : findChallengeField()
    if (challenge instanceof HTMLInputElement) {
      focusChallenge(challenge)
      return {
        stepId: step.id,
        found: true,
        challengeDetected: true,
        clicked: false
      }
    }
    return { stepId: step.id, found: false, challengeDetected: false, clicked: false }
  }

  const element = findBySelector(step.selector)
  if (!element) {
    return { stepId: step.id, found: false, challengeDetected: false, clicked: false }
  }

  if (step.type === 'fillUsername' && element instanceof HTMLInputElement) {
    fillInput(element, username)
    return { stepId: step.id, found: true, challengeDetected: false, clicked: false }
  }

  if (step.type === 'fillPassword' && element instanceof HTMLInputElement) {
    fillInput(element, password)
    return { stepId: step.id, found: true, challengeDetected: false, clicked: false }
  }

  const challenge = findChallengeField()
  if (challenge && challengeSharesForm(element, challenge)) {
    focusChallenge(challenge)
    return {
      stepId: step.id,
      found: true,
      challengeDetected: true,
      clicked: false
    }
  }

  if (step.type === 'click') {
    clickElement(element)
    return { stepId: step.id, found: true, challengeDetected: false, clicked: true }
  }

  if (step.type === 'press') {
    window.setTimeout(() => pressElement(element, step.key), DEFERRED_ACTION_DELAY_MS)
    return { stepId: step.id, found: true, challengeDetected: false, clicked: true }
  }

  return { stepId: step.id, found: false, challengeDetected: false, clicked: false }
}

async function waitForLoginForm(): Promise<Detection> {
  let detection = inspectPage()
  for (let attempt = 0; attempt < 10; attempt += 1) {
    if (detection.password || detection.challenge || detection.form) {
      return detection
    }
    await delay(180)
    detection = inspectPage()
  }
  return detection
}

export function inspectPage(): Detection {
  const usernameCandidates = Array.from(document.querySelectorAll('input'))
    .filter(isVisible)
    .filter(isUsernameCandidate)
    .map((element) => ({
      element: element as HTMLInputElement,
      score: scoreUsername(element as HTMLInputElement)
    }))
    .sort((a, b) => b.score - a.score)

  const passwordCandidates = Array.from(document.querySelectorAll('input[type="password"]'))
    .filter(isVisible)
    .filter((element) => element.getAttribute('autocomplete') !== 'new-password')
    .map((element) => ({
      element: element as HTMLInputElement,
      score: scorePassword(element as HTMLInputElement)
    }))
    .sort((a, b) => b.score - a.score)

  const challenge = findChallengeField()
  const password = passwordCandidates[0]?.element
  const username = usernameCandidates[0]?.element
  const form = password?.closest('form') ?? username?.closest('form') ?? null
  const submit = findSubmitElement(form)
  const confidence: DetectionConfidence =
    password && username && submit ? 'high' : password && username ? 'medium' : 'low'

  return { username, password, challenge, submit, form: form ?? undefined, confidence }
}

function isUsernameCandidate(element: Element): boolean {
  if (!(element instanceof HTMLInputElement) || element.type === 'password') {
    return false
  }
  const blockedTypes = new Set([
    'hidden',
    'submit',
    'button',
    'checkbox',
    'radio',
    'file',
    'image',
    'reset',
    'search'
  ])
  if (blockedTypes.has(element.type)) {
    return false
  }
  return scoreUsername(element) >= 2
}

export function scoreUsername(input: HTMLInputElement): number {
  const autocomplete = (input.autocomplete || '').toLowerCase()
  const metadata = fieldMetadata(input)
  let score = 0
  if (autocomplete === 'username') score += 5
  if (input.type === 'email' || autocomplete === 'email') score += 4
  if (/(user|email|login|account|phone|mobile)/i.test(metadata)) score += 3
  if (/(用户名|邮箱|账号|手机号|手机|登录名)/i.test(metadata)) score += 3
  if (input.form?.querySelector('input[type="password"]')) score += 2
  if (input.value) score += 1
  return score
}

function scorePassword(input: HTMLInputElement): number {
  const autocomplete = (input.autocomplete || '').toLowerCase()
  const metadata = fieldMetadata(input)
  let score = 5
  if (autocomplete === 'current-password') score += 4
  if (/(password|passwd|pwd)/i.test(metadata)) score += 2
  if (/(密码|口令)/i.test(metadata)) score += 2
  if (input.form?.querySelector('input:not([type="password"])')) score += 1
  return score
}

export function findChallengeField(): HTMLInputElement | undefined {
  const inputs = Array.from(document.querySelectorAll('input')).filter(
    (element): element is HTMLInputElement =>
      element instanceof HTMLInputElement &&
      isVisible(element) &&
      !['password', 'hidden', 'submit', 'button', 'checkbox', 'radio'].includes(element.type)
  )
  const scored = inputs
    .map((input) => ({ input, score: scoreChallenge(input) }))
    .filter((entry) => entry.score >= 3)
    .sort((a, b) => b.score - a.score)
  if (scored[0]) {
    return scored[0].input
  }

  const challengeVisual = Array.from(
    document.querySelectorAll('img, canvas, iframe, [class*="captcha" i], [id*="captcha" i]')
  ).some((element) => {
    const metadata = `${element.getAttribute('src') ?? ''} ${element.getAttribute('alt') ?? ''} ${element.getAttribute('class') ?? ''} ${element.getAttribute('id') ?? ''}`
    return /(captcha|验证码|verify|verification)/i.test(metadata) && isVisible(element)
  })
  if (!challengeVisual) {
    return undefined
  }
  return inputs.find((input) => scoreChallenge(input) >= 1)
}

export function scoreChallenge(input: HTMLInputElement): number {
  const metadata = fieldMetadata(input)
  const autocomplete = (input.autocomplete || '').toLowerCase()
  let score = 0
  if (autocomplete === 'one-time-code') score += 6
  if (
    /(captcha|otp|verification|verify|one[-_ ]?time[-_ ]?code|security[-_ ]?code|sms[-_ ]?code|auth(?:entication)?[-_ ]?code)/i.test(
      metadata
    )
  ) {
    score += 4
  } else if (/\bcode\b/i.test(metadata)) {
    score += 1
  }
  if (/(验证码|校验码|动态码|短信码|安全码|图形码)/i.test(metadata)) score += 4
  if (input.maxLength > 0 && input.maxLength <= 8) score += 1
  return score
}

function challengeSharesForm(element: HTMLElement, challenge: HTMLElement): boolean {
  const targetForm = element.closest('form')
  const challengeForm = challenge.closest('form')
  if (targetForm || challengeForm) {
    return Boolean(targetForm && challengeForm && targetForm === challengeForm)
  }
  const targetDialog = element.closest('[role="dialog"]')
  return Boolean(targetDialog && targetDialog === challenge.closest('[role="dialog"]'))
}

export function findSubmitElement(form: HTMLFormElement | null): HTMLElement | undefined {
  const scope: ParentNode = form ?? document
  const candidates = Array.from(
    scope.querySelectorAll(
      'button, input[type="submit"], [role="button"], a[role="button"], button[type="button"]'
    )
  ).filter(
    (element): element is HTMLElement =>
      element instanceof HTMLElement && isVisible(element)
  )
  const scored = candidates
    .map((element) => ({ element, score: scoreSubmit(element) }))
    .filter((entry) => entry.score >= 2)
    .sort((a, b) => b.score - a.score)
  return scored[0]?.element
}

export function scoreSubmit(element: HTMLElement): number {
  const text = `${element.textContent ?? ''} ${element.getAttribute('aria-label') ?? ''} ${element.getAttribute('value') ?? ''}`.trim()
  let score = 0
  if (element instanceof HTMLButtonElement && element.type === 'submit') score += 4
  if (element instanceof HTMLInputElement && element.type === 'submit') score += 4
  if (/(登录|登入|登陆|提交|继续|下一步|sign\s*in|log\s*in|login|continue|next|submit)/i.test(text)) {
    score += 5
  }
  if (element.getAttribute('form') === 'login') score += 1
  return score
}

function fieldMetadata(input: HTMLInputElement): string {
  const labels = Array.from(input.labels ?? [])
    .map((label) => label.textContent ?? '')
    .join(' ')
  return [
    input.name,
    input.id,
    input.placeholder,
    input.getAttribute('aria-label') ?? '',
    input.getAttribute('data-testid') ?? '',
    labels
  ].join(' ')
}

export function fillInput(input: HTMLInputElement, value: string): void {
  input.focus()
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
  if (setter) {
    setter.call(input, value)
  } else {
    input.value = value
  }
  input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: value }))
  input.dispatchEvent(new Event('change', { bubbles: true }))
  input.blur()
}

export function focusChallenge(challenge?: HTMLInputElement): void {
  if (!challenge) {
    return
  }
  challenge.focus()
  challenge.scrollIntoView({ block: 'center', behavior: 'smooth' })
  challenge.select()
}

export function selectorFor(element: Element): SelectorSpec {
  const candidates: string[] = []
  const push = (selector: string | undefined): void => {
    if (selector && !candidates.includes(selector)) {
      candidates.push(selector)
    }
  }

  const dataTestId = element.getAttribute('data-testid')
  if (dataTestId) {
    push(`[data-testid="${cssEscape(dataTestId)}"]`)
  }

  const id = element.id
  if (id && document.querySelectorAll(`#${cssEscape(id)}`).length === 1) {
    push(`#${cssEscape(id)}`)
  }

  const name = element.getAttribute('name')
  if (name) {
    push(`${element.tagName.toLowerCase()}[name="${cssEscape(name)}"]`)
  }

  const autocomplete = element.getAttribute('autocomplete')
  if (autocomplete) {
    push(`${element.tagName.toLowerCase()}[autocomplete="${cssEscape(autocomplete)}"]`)
  }

  const ariaLabel = element.getAttribute('aria-label')
  if (ariaLabel) {
    push(`${element.tagName.toLowerCase()}[aria-label="${cssEscape(ariaLabel)}"]`)
  }

  push(cssPath(element))

  const text = element.textContent?.trim().replace(/\s+/g, ' ').slice(0, 80)
  return {
    candidates: candidates.slice(0, 8),
    text: text || undefined
  }
}

function inputStep(
  type: 'fillUsername' | 'fillPassword' | 'focusChallenge',
  input: HTMLInputElement
): RecipeStep {
  return {
    id: crypto.randomUUID(),
    type,
    selector: selectorFor(input)
  }
}

function clickElement(element: HTMLElement): void {
  element.focus()
  window.setTimeout(() => element.click(), DEFERRED_ACTION_DELAY_MS)
}

function pressElement(element: HTMLElement, key: string): void {
  element.focus()
  element.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }))
  element.dispatchEvent(new KeyboardEvent('keyup', { key, bubbles: true, cancelable: true }))
  if (key === 'Enter') {
    const form = element.closest('form')
    if (form && typeof form.requestSubmit === 'function') {
      form.requestSubmit()
    }
  }
}

function findBySelector(selector: SelectorSpec): HTMLElement | null {
  for (const candidate of selector.candidates) {
    try {
      const element = document.querySelector(candidate)
      if (element instanceof HTMLElement && isVisible(element)) {
        return element
      }
    } catch {
      // Ignore a stale or unsupported selector and try the next fallback.
    }
  }

  if (selector.text) {
    const normalized = selector.text.toLowerCase()
    const candidates = Array.from(
      document.querySelectorAll('button, input[type="submit"], [role="button"]')
    )
    return (
      (candidates.find((element) => {
        const text = `${element.textContent ?? ''} ${element.getAttribute('value') ?? ''}`
          .trim()
          .replace(/\s+/g, ' ')
          .toLowerCase()
        return text === normalized || text.includes(normalized)
      }) as HTMLElement | undefined) ?? null
    )
  }
  return null
}

function cssPath(element: Element): string {
  const parts: string[] = []
  let current: Element | null = element
  while (current && current !== document.body && parts.length < 5) {
    let part = current.tagName.toLowerCase()
    if (current.id) {
      part = `#${cssEscape(current.id)}`
      parts.unshift(part)
      break
    }
    const parent = current.parentElement
    if (parent) {
      const siblings = Array.from(parent.children).filter(
        (child) => child.tagName === current?.tagName
      )
      if (siblings.length > 1) {
        part += `:nth-of-type(${siblings.indexOf(current) + 1})`
      }
    }
    parts.unshift(part)
    current = current.parentElement
  }
  return parts.join(' > ')
}

function isVisible(element: Element): boolean {
  if (!(element instanceof HTMLElement)) {
    return false
  }
  const style = window.getComputedStyle(element)
  return (
    style.display !== 'none' &&
    style.visibility !== 'hidden' &&
    style.opacity !== '0' &&
    element.getClientRects().length > 0
  )
}

function cssEscape(value: string): string {
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') {
    return CSS.escape(value)
  }
  return value.replace(/(["\\])/g, '\\$1')
}

export function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}
