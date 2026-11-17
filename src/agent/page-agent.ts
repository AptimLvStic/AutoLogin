import type { RecipeStep } from '../shared/types'
import {
  delay,
  executeStep,
  fillGeneric,
  fillInput,
  findChallengeField,
  focusChallenge,
  inspectPage,
  scoreChallenge,
  scoreUsername,
  selectorFor
} from '../shared/form-detection'

type AgentCommand =
  | {
      type: 'fill-generic'
      username: string
      password: string
      autoSubmit: boolean
      recording: boolean
    }
  | {
      type: 'fill-manual'
      username: string
      password: string
      autoSubmit: boolean
      selectors: {
        username?: string
        password?: string
        submit?: string
      }
    }
  | {
      type: 'test-selector'
      field: 'username' | 'password' | 'submit'
      selector: string
    }
  | { type: 'record-start' }
  | { type: 'record-stop' }
  | { type: 'record-pause' }
  | { type: 'record-resume' }
  | { type: 'record-clear-dedupe' }
  | {
      type: 'record-copy-source'
      source: 'username' | 'password'
      digest: string
      expiresAt: number
    }
  | { type: 'capture-login-form' }
  | { type: 'detect-challenge' }
  | { type: 'run-step'; step: RecipeStep; username: string; password: string }

interface AgentBridge {
  handleCommand: (command: AgentCommand) => Promise<unknown>
}

declare global {
  interface Window {
    __autologinSend?: (payload: string) => void
    __autologinAgent?: AgentBridge
  }
}

if (!window.__autologinAgent) {
  let recording = false
  let recordingPaused = false
  let recordingListenersAttached = false
  const recordedKeys = new Set<string>()
  let clipboardSource:
    | {
        source: 'username' | 'password'
        digest: string
        expiresAt: number
      }
    | null = null
  let pendingPointerTarget: Element | null = null
  let pendingPointerAt = 0
  let lastActivityReport = 0
  let pendingEnterTimer: number | null = null

  attachActivityListeners()

  window.__autologinAgent = {
    handleCommand
  }

  async function handleCommand(command: AgentCommand): Promise<unknown> {
    await waitForDom()
    if (!command || typeof command !== 'object') {
      return null
    }

    if (command.type === 'record-start') {
      recording = true
      recordingPaused = false
      recordedKeys.clear()
      attachRecordingListeners()
      void captureInitialForm()
      return { ok: true }
    }

    if (command.type === 'record-stop') {
      recording = false
      recordingPaused = false
      recordedKeys.clear()
      clipboardSource = null
      pendingPointerTarget = null
      if (pendingEnterTimer !== null) {
        window.clearTimeout(pendingEnterTimer)
        pendingEnterTimer = null
      }
      return { ok: true }
    }

    if (command.type === 'record-pause') {
      recordingPaused = true
      return { ok: true }
    }

    if (command.type === 'record-resume') {
      recordingPaused = false
      attachRecordingListeners()
      return { ok: true }
    }

    if (command.type === 'record-clear-dedupe') {
      recordedKeys.clear()
      return { ok: true }
    }

    if (command.type === 'record-copy-source') {
      clipboardSource = {
        source: command.source,
        digest: command.digest,
        expiresAt: command.expiresAt
      }
      return { ok: true }
    }

    if (command.type === 'capture-login-form') {
      return captureCurrentFormSteps()
    }

    if (command.type === 'detect-challenge') {
      const challenge = findChallengeField()
      if (challenge) {
        focusChallenge(challenge)
      }
      return { detected: Boolean(challenge) }
    }

    if (command.type === 'fill-generic') {
      recording = command.recording
      if (recording) {
        attachRecordingListeners()
      }
      return fillGeneric(
        {
          username: command.username,
          password: command.password,
          autoSubmit: command.autoSubmit
        },
        {
          recording,
          onRecordStep: recordStep,
          onChallengeDetected: () => sendEvent({ type: 'challenge-detected' })
        }
      )
    }

    if (command.type === 'fill-manual') {
      const usernameInput = findInputBySelector(command.selectors.username, 'username')
      const passwordInput = findInputBySelector(command.selectors.password, 'password')
      const submitElement = findElementBySelector(command.selectors.submit)
      let usernameFilled = false
      let passwordFilled = false

      if (usernameInput) {
        fillInput(usernameInput, command.username)
        usernameFilled = true
      }
      if (passwordInput) {
        fillInput(passwordInput, command.password)
        passwordFilled = true
      }

      const challenge = findChallengeField()
      if (challenge) {
        focusChallenge(challenge)
        sendEvent({ type: 'challenge-detected' })
        return {
          formFound: Boolean(usernameInput || passwordInput || submitElement),
          usernameFilled,
          passwordFilled,
          challengeDetected: true,
          submitted: false,
          confidence: usernameFilled && passwordFilled ? 'high' : 'low'
        }
      }

      const submitted =
        command.autoSubmit &&
        usernameFilled &&
        passwordFilled &&
        submitElement instanceof HTMLElement
      if (submitted && submitElement) {
        await delay(120)
        submitElement.focus()
        submitElement.click()
      }

      return {
        formFound: Boolean(usernameInput || passwordInput || submitElement),
        usernameFilled,
        passwordFilled,
        challengeDetected: false,
        submitted,
        confidence:
          usernameFilled && passwordFilled && submitElement
            ? 'high'
            : usernameFilled || passwordFilled
              ? 'medium'
              : 'low'
      }
    }

    if (command.type === 'test-selector') {
      let matches: Element[]
      try {
        matches = Array.from(document.querySelectorAll(command.selector))
      } catch {
        return {
          found: false,
          visible: false,
          count: 0,
          message: '样式定位器格式无效'
        }
      }
      const visible = matches.filter(isVisibleElement)
      const candidate = visible[0]
      const typeMatches =
        command.field === 'username'
          ? candidate instanceof HTMLInputElement && candidate.type !== 'password'
          : command.field === 'password'
            ? candidate instanceof HTMLInputElement && candidate.type === 'password'
            : candidate instanceof HTMLElement
      return {
        found: Boolean(candidate && typeMatches),
        visible: visible.length > 0,
        count: matches.length,
        message:
          matches.length === 0
            ? '未找到匹配元素'
            : !visible.length
              ? '元素存在但当前不可见'
              : !typeMatches
                ? '元素类型与目标字段不匹配'
                : '已找到可见的匹配元素'
      }
    }

    if (command.type === 'run-step') {
      return executeStep(command.step, command.username, command.password)
    }

    return null
  }

  function attachRecordingListeners(): void {
    if (recordingListenersAttached) {
      return
    }
    recordingListenersAttached = true

    document.addEventListener(
      'focusin',
      (event) => {
        if (!isRecordingActive()) {
          return
        }
        const target = eventTarget(event)
        if (!(target instanceof HTMLInputElement)) {
          return
        }
        if (scoreChallenge(target) >= 3) {
          recordInputStep('focusChallenge', target)
          sendEvent({ type: 'challenge-detected' })
        } else if (target.type === 'password') {
          recordInputStep('fillPassword', target)
        } else if (scoreUsername(target) >= 2) {
          recordInputStep('fillUsername', target)
        }
      },
      true
    )

    document.addEventListener(
      'input',
      (event) => {
        if (!isRecordingActive()) return
        const target = eventTarget(event)
        if (!(target instanceof HTMLInputElement)) return
        recordInputFromElement(target)
      },
      true
    )

    document.addEventListener(
      'change',
      (event) => {
        if (!isRecordingActive()) return
        const target = eventTarget(event)
        if (!(target instanceof HTMLInputElement)) return
        recordInputFromElement(target)
      },
      true
    )

    document.addEventListener(
      'keydown',
      (event) => {
        if (!isRecordingActive() || event.key !== 'Enter') return
        const target = eventTarget(event)
        if (!(target instanceof HTMLInputElement)) return
        if (pendingEnterTimer !== null) {
          window.clearTimeout(pendingEnterTimer)
        }
        pendingEnterTimer = window.setTimeout(() => {
          pendingEnterTimer = null
          const submit = findSubmitElementForInput(target)
          if (submit) {
            recordStep(clickStepFor(submit))
          } else {
            recordStep({
              id: crypto.randomUUID(),
              type: 'press',
              selector: selectorFor(target),
              key: 'Enter'
            })
          }
        }, 120)
      },
      true
    )

    document.addEventListener(
      'submit',
      (event) => {
        if (!isRecordingActive()) return
        if (pendingEnterTimer !== null) {
          window.clearTimeout(pendingEnterTimer)
          pendingEnterTimer = null
        }
        const form = event.target
        if (!(form instanceof HTMLFormElement)) return
        const submit = findSubmitElementForInput(form)
        if (submit) {
          recordStep(clickStepFor(submit))
          return
        }
        const active = document.activeElement
        if (active instanceof HTMLInputElement) {
          recordStep({
            id: crypto.randomUUID(),
            type: 'press',
            selector: selectorFor(active),
            key: 'Enter'
          })
        }
      },
      true
    )

    document.addEventListener(
      'mousedown',
      (event) => {
        if (!isRecordingActive()) {
          return
        }
        const target = eventTarget(event)
        if (!(target instanceof Element)) {
          return
        }
        pendingPointerTarget = target
        pendingPointerAt = Date.now()
      },
      true
    )

    document.addEventListener(
      'click',
      (event) => {
        if (!isRecordingActive() || event.button !== 0) return
        const target = eventTarget(event)
        if (!(target instanceof Element)) return
        const clicked =
          pendingPointerTarget &&
          Date.now() - pendingPointerAt <= 500 &&
          (target === pendingPointerTarget || target.contains(pendingPointerTarget))
            ? pendingPointerTarget
            : target
        pendingPointerTarget = null
        recordClickStep(clicked)
      },
      true
    )

    document.addEventListener(
      'contextmenu',
      (event) => {
        if (!isRecordingActive()) return
        const target = eventTarget(event)
        if (!(target instanceof Element)) return
        const clicked =
          pendingPointerTarget &&
          Date.now() - pendingPointerAt <= 500
            ? pendingPointerTarget
            : target
        pendingPointerTarget = null
        recordClickStep(clicked, false)
      },
      true
    )

    document.addEventListener(
      'paste',
      (event) => {
        if (!isRecordingActive()) return
        const target = eventTarget(event)
        if (!(target instanceof HTMLInputElement) && !(target instanceof HTMLTextAreaElement)) {
          return
        }
        const value = event.clipboardData?.getData('text/plain') ?? ''
        void recordPasteStep(target, value)
      },
      true
    )
  }

  function recordClickStep(target: Element, navigationExpected?: boolean): void {
    const clickable =
      target.closest(
        'button, input, select, textarea, a, label, summary, [role="button"], [role="link"], [role="menuitem"], [role="tab"], [onclick]'
      ) ?? target
    if (!(clickable instanceof HTMLElement)) return
    recordStep({
      id: crypto.randomUUID(),
      type: 'click',
      selector: selectorFor(clickable),
      navigationExpected:
        navigationExpected ??
        Boolean(
          clickable.closest(
            'a[href], button, input[type="submit"], [role="button"], [role="link"]'
          )
        )
    })
  }

  function clickStepFor(target: Element): RecipeStep {
    const clickable =
      target.closest(
        'button, input, select, textarea, a, label, summary, [role="button"], [role="link"], [role="menuitem"], [role="tab"], [onclick]'
      ) ?? target
    const element = clickable instanceof Element ? clickable : target
    return {
      id: crypto.randomUUID(),
      type: 'click',
      selector: selectorFor(element),
      navigationExpected: Boolean(
        element.closest('a[href], button, input[type="submit"], [role="button"], [role="link"]')
      )
    }
  }

  function findSubmitElementForInput(target: Element): HTMLElement | null {
    const form = target.closest('form')
    const scope: ParentNode = form ?? document
    const candidates = Array.from(
      scope.querySelectorAll(
        'button, input[type="submit"], [role="button"], button[type="button"]'
      )
    ).filter((element): element is HTMLElement => {
      if (!(element instanceof HTMLElement)) return false
      const text = `${element.textContent ?? ''} ${element.getAttribute('aria-label') ?? ''} ${element.getAttribute('value') ?? ''}`
      return (
        isVisibleElement(element) &&
        /(登录|登入|登陆|提交|继续|下一步|sign\s*in|log\s*in|login|continue|next|submit)/i.test(
          text
        )
      )
    })
    if (candidates[0]) return candidates[0]
    const submit = scope.querySelector('button[type="submit"], input[type="submit"]')
    return submit instanceof HTMLElement && isVisibleElement(submit) ? submit : null
  }

  function recordInputStep(
    type: 'fillUsername' | 'fillPassword' | 'focusChallenge',
    input: HTMLInputElement
  ): void {
    recordStep({
      id: crypto.randomUUID(),
      type,
      selector: selectorFor(input)
    })
  }

  function recordInputFromElement(input: HTMLInputElement): void {
    if (scoreChallenge(input) >= 3) {
      recordInputStep('focusChallenge', input)
      sendEvent({ type: 'challenge-detected' })
      return
    }
    if (input.type === 'password') {
      recordInputStep('fillPassword', input)
      return
    }
    if (isLikelyUsernameInput(input)) {
      recordInputStep('fillUsername', input)
    }
  }

  function isLikelyUsernameInput(input: HTMLInputElement): boolean {
    if (
      ['hidden', 'submit', 'button', 'checkbox', 'radio', 'file', 'image', 'reset', 'search'].includes(
        input.type
      ) ||
      !isVisibleElement(input)
    ) {
      return false
    }
    if (input.type === 'email' || input.type === 'tel') return true
    if (scoreUsername(input) >= 1) return true
    const form = input.closest('form')
    if (form?.querySelector('input[type="password"]')) return true
    const textInputs = Array.from(document.querySelectorAll('input')).filter(
      (element): element is HTMLInputElement =>
        element instanceof HTMLInputElement &&
        isVisibleElement(element) &&
        !['password', 'hidden', 'submit', 'button', 'checkbox', 'radio'].includes(
          element.type
        )
    )
    return textInputs.length === 1 && textInputs[0] === input
  }

  function recordStep(step: RecipeStep): void {
    const selectorKey =
      step.type === 'acceptCertWarning'
        ? ''
        : step.type === 'focusChallenge'
        ? (step.selector?.candidates.join('|') ?? '')
        : step.selector.candidates.join('|')
    const key = `${step.type}:${selectorKey}:${step.type === 'paste' ? step.source : ''}`
    if (recordedKeys.has(key)) {
      return
    }
    recordedKeys.add(key)
    sendEvent({ type: 'record-action', step })
  }

  function captureCurrentFormSteps(): RecipeStep[] {
    const detection = inspectPage()
    const steps: RecipeStep[] = []
    if (detection.username) {
      steps.push({
        id: crypto.randomUUID(),
        type: 'fillUsername',
        selector: selectorFor(detection.username)
      })
    }
    if (detection.password) {
      steps.push({
        id: crypto.randomUUID(),
        type: 'fillPassword',
        selector: selectorFor(detection.password)
      })
    }
    return steps
  }

  async function captureInitialForm(): Promise<void> {
    await waitForDom()
    for (const delayMs of [0, 350, 900]) {
      if (!isRecordingActive()) return
      if (delayMs > 0) await delay(delayMs)
      const steps = captureCurrentFormSteps()
      if (steps.length === 0) continue
      for (const step of steps) recordStep(step)
      return
    }
  }

  function eventTarget(event: Event): Element | null {
    const path = typeof event.composedPath === 'function' ? event.composedPath() : []
    const target = path.find((entry) => entry instanceof Element)
    return target instanceof Element
      ? target
      : event.target instanceof Element
        ? event.target
        : null
  }

  function isRecordingActive(): boolean {
    return recording && !recordingPaused
  }

  async function recordPasteStep(
    target: HTMLInputElement | HTMLTextAreaElement,
    value: string
  ): Promise<void> {
    let source: 'username' | 'password' | 'literal' = 'literal'
    if (clipboardSource && clipboardSource.expiresAt >= Date.now()) {
      const digest = await digestText(value)
      if (digest === clipboardSource.digest) {
        source = clipboardSource.source
        clipboardSource = null
      }
    }
    recordStep({
      id: crypto.randomUUID(),
      type: 'paste',
      selector: selectorFor(target),
      source
    })
  }

  async function digestText(value: string): Promise<string> {
    const digest = await crypto.subtle.digest(
      'SHA-256',
      new TextEncoder().encode(value)
    )
    return Array.from(new Uint8Array(digest))
      .map((byte) => byte.toString(16).padStart(2, '0'))
      .join('')
  }

  function findElementBySelector(selector: string | undefined): HTMLElement | null {
    if (!selector) return null
    try {
      const element = document.querySelector(selector)
      return element instanceof HTMLElement && isVisibleElement(element) ? element : null
    } catch {
      return null
    }
  }

  function findInputBySelector(
    selector: string | undefined,
    kind: 'username' | 'password'
  ): HTMLInputElement | null {
    const element = findElementBySelector(selector)
    if (!(element instanceof HTMLInputElement)) {
      return null
    }
    if (kind === 'password' && element.type !== 'password') {
      return null
    }
    if (kind === 'username' && element.type === 'password') {
      return null
    }
    return element
  }

  function isVisibleElement(element: Element): boolean {
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

  function attachActivityListeners(): void {
    const report = (): void => {
      const now = Date.now()
      if (now - lastActivityReport < 15_000) {
        return
      }
      lastActivityReport = now
      sendEvent({ type: 'activity' })
    }
    for (const eventName of ['pointerdown', 'keydown', 'wheel', 'touchstart'] as const) {
      document.addEventListener(eventName, report, { capture: true, passive: true })
    }
  }

  async function waitForDom(): Promise<void> {
    if (document.readyState !== 'loading') {
      return
    }
    await new Promise<void>((resolve) => {
      document.addEventListener('DOMContentLoaded', () => resolve(), { once: true })
    })
  }

  function sendEvent(payload: unknown): void {
    if (typeof window.__autologinSend !== 'function') {
      return
    }
    window.__autologinSend(JSON.stringify(payload))
  }

  void delay(0)
}
