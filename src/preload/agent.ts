import type { RecipeStep } from '../shared/types'
import {
  delay,
  executeStep,
  fillGeneric,
  fillInput,
  findChallengeField,
  focusChallenge,
  scoreChallenge,
  scoreSubmit,
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
  let recordingListenersAttached = false
  const recordedKeys = new Set<string>()
  let lastActivityReport = 0

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
      attachRecordingListeners()
      return { ok: true }
    }

    if (command.type === 'record-stop') {
      recording = false
      recordedKeys.clear()
      return { ok: true }
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
        if (!recording) {
          return
        }
        const target = event.target
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
      'click',
      (event) => {
        if (!recording) {
          return
        }
        const target = event.target
        if (!(target instanceof Element)) {
          return
        }
        const clickable = target.closest(
          'button, input[type="submit"], [role="button"], a[role="button"]'
        )
        if (!(clickable instanceof HTMLElement) || scoreSubmit(clickable) < 2) {
          return
        }
        recordStep({
          id: crypto.randomUUID(),
          type: 'click',
          selector: selectorFor(clickable),
          navigationExpected: true
        })
      },
      true
    )
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

  function recordStep(step: RecipeStep): void {
    const selectorKey =
      step.type === 'focusChallenge'
        ? (step.selector?.candidates.join('|') ?? '')
        : step.selector.candidates.join('|')
    const key = `${step.type}:${selectorKey}`
    if (recordedKeys.has(key)) {
      return
    }
    recordedKeys.add(key)
    sendEvent({ type: 'record-action', step })
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
