import type { RecipeStep } from '../shared/types'
import {
  delay,
  executeStep,
  fillGeneric,
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
