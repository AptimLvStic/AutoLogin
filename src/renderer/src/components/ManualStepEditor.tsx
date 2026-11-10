import { useState } from 'react'
import {
  GripVertical,
  KeyRound,
  ListChecks,
  LoaderCircle,
  Plus,
  RefreshCw,
  SlidersHorizontal,
  Trash2
} from 'lucide-react'
import type {
  AccountWithSite,
  RecipeStep,
  SelectorTestField,
  SelectorTestResult,
  SelectorSpec
} from '@shared/types'
import { useI18n } from '../i18n'

export type ManualStepAction =
  | 'fillUsername'
  | 'fillPassword'
  | 'click'
  | 'press'
  | 'focusChallenge'

export const MANUAL_STEP_ACTIONS: ManualStepAction[] = [
  'fillUsername',
  'fillPassword',
  'click',
  'press',
  'focusChallenge'
]

export function ManualStepEditor({
  steps,
  onChange,
  selectorTests,
  selectorTesting,
  onTest,
  disabled = false,
  emptyText,
  addLabel,
  footerText
}: {
  steps: RecipeStep[]
  onChange: (steps: RecipeStep[], invalidatedStepId?: string) => void
  selectorTests: Record<string, SelectorTestResult>
  selectorTesting: string | null
  onTest: (step: RecipeStep) => void
  disabled?: boolean
  emptyText?: string
  addLabel?: string
  footerText?: string
}): React.JSX.Element {
  const { tr } = useI18n()
  const [draggedStepId, setDraggedStepId] = useState<string | null>(null)

  function updateStep(
    stepId: string,
    updater: (step: RecipeStep) => RecipeStep
  ): void {
    onChange(
      steps.map((step) => (step.id === stepId ? updater(step) : step)),
      stepId
    )
  }

  function moveStep(sourceId: string, targetId: string): void {
    if (sourceId === targetId) return
    const sourceIndex = steps.findIndex((step) => step.id === sourceId)
    const targetIndex = steps.findIndex((step) => step.id === targetId)
    if (sourceIndex < 0 || targetIndex < 0) return
    const next = [...steps]
    const [moved] = next.splice(sourceIndex, 1)
    if (!moved) return
    next.splice(targetIndex, 0, moved)
    onChange(next)
  }

  return (
    <>
      <div className="manual-selector-panel__fields">
        {steps.length === 0 && (
          <div className="manual-step-empty">
            <ListChecks size={18} />
            <span>
              {emptyText ??
                tr(
                  '还没有步骤。添加“输入用户名”和“输入密码”后，再按需添加点击或验证码步骤。',
                  'No steps yet. Add username and password actions, then optional click or challenge steps.',
                  '還沒有步驟。新增「輸入使用者名稱」和「輸入密碼」後，再按需要新增點擊或驗證碼步驟。'
                )}
            </span>
          </div>
        )}
        {steps.map((step, index) => {
          const result = selectorTests[step.id]
          return (
            <div
              className={`manual-step-row${draggedStepId === step.id ? ' is-dragging' : ''}`}
              key={step.id}
              onDragOver={(event) => {
                if (!draggedStepId) return
                event.preventDefault()
                event.dataTransfer.dropEffect = 'move'
              }}
              onDrop={(event) => {
                event.preventDefault()
                if (draggedStepId) moveStep(draggedStepId, step.id)
                setDraggedStepId(null)
              }}
            >
              <span
                className="manual-step-row__handle"
                draggable={!disabled}
                onDragStart={(event) => {
                  event.dataTransfer.effectAllowed = 'move'
                  event.dataTransfer.setData('text/plain', step.id)
                  setDraggedStepId(step.id)
                }}
                onDragEnd={() => setDraggedStepId(null)}
                aria-label={tr(
                  `拖拽步骤 ${index + 1}`,
                  `Drag step ${index + 1}`,
                  `拖曳步驟 ${index + 1}`
                )}
                title={tr('拖拽排序', 'Drag to reorder', '拖曳排序')}
              >
                <GripVertical size={14} />
              </span>
              <select
                className="filter-control manual-step-row__action"
                aria-label={tr(
                  `步骤 ${index + 1} 动作类型`,
                  `Step ${index + 1} action`,
                  `步驟 ${index + 1} 動作類型`
                )}
                value={step.type}
                disabled={disabled}
                onChange={(event) =>
                  updateStep(step.id, (current) =>
                    changeManualStepType(
                      current,
                      event.target.value as ManualStepAction
                    )
                  )
                }
              >
                {MANUAL_STEP_ACTIONS.map((action) => (
                  <option value={action} key={action}>
                    {manualStepActionLabel(action, tr)}
                  </option>
                ))}
              </select>
              <span className="manual-step-row__selector-cell">
                <span className="input-shell">
                  <SlidersHorizontal size={15} />
                  <input
                    aria-label={tr(
                      `步骤 ${index + 1} Selector`,
                      `Step ${index + 1} selector`,
                      `步驟 ${index + 1} Selector`
                    )}
                    value={manualStepSelector(step)}
                    disabled={disabled}
                    onChange={(event) =>
                      updateStep(step.id, (current) =>
                        updateManualStepSelector(current, event.target.value)
                      )
                    }
                    placeholder={selectorPlaceholderForAction(step.type)}
                    spellCheck={false}
                    autoComplete="off"
                  />
                </span>
                {step.type === 'press' && (
                  <span className="input-shell manual-step-row__key-field">
                    <KeyRound size={15} />
                    <input
                      aria-label={tr(
                        `步骤 ${index + 1} 按键`,
                        `Step ${index + 1} key`,
                        `步驟 ${index + 1} 按鍵`
                      )}
                      value={step.key}
                      disabled={disabled}
                      onChange={(event) =>
                        updateStep(step.id, (current) =>
                          current.type === 'press'
                            ? { ...current, key: event.target.value }
                            : current
                        )
                      }
                      placeholder="Enter"
                      spellCheck={false}
                      autoComplete="off"
                    />
                  </span>
                )}
                {result && (
                  <small
                    className={`selector-config-row__result${
                      result.found ? ' is-success' : ' is-error'
                    }`}
                  >
                    {result.message}
                  </small>
                )}
              </span>
              <button
                type="button"
                className="button button--ghost button--small"
                onClick={() => onTest(step)}
                disabled={disabled || selectorTesting !== null}
              >
                {selectorTesting === step.id ? (
                  <LoaderCircle size={13} className="spin" />
                ) : (
                  <RefreshCw size={13} />
                )}
                {tr('测试', 'Test', '測試')}
              </button>
              <button
                type="button"
                className="icon-button icon-button--small manual-step-row__delete"
                onClick={() => onChange(
                  steps.filter((current) => current.id !== step.id),
                  step.id
                )}
                disabled={disabled}
                aria-label={tr(
                  `删除步骤 ${index + 1}`,
                  `Delete step ${index + 1}`,
                  `刪除步驟 ${index + 1}`
                )}
                title={tr('删除步骤', 'Delete step', '刪除步驟')}
              >
                <Trash2 size={14} />
              </button>
            </div>
          )
        })}
      </div>
      <footer className="manual-selector-panel__footer">
        <button
          type="button"
          className="button button--ghost button--small"
          onClick={() =>
            onChange([...steps, createManualStep(nextManualStepType(steps))])
          }
          disabled={disabled}
        >
          <Plus size={13} />
          {addLabel ?? tr('添加步骤', 'Add step', '新增步驟')}
        </button>
        <small>
          {footerText ??
            tr(
              '按从上到下的顺序执行',
              'Steps run from top to bottom',
              '步驟會由上到下執行'
            )}
        </small>
      </footer>
    </>
  )
}

export function initialManualSteps(account: AccountWithSite | undefined): RecipeStep[] {
  if (account?.manualSteps?.length) {
    return structuredClone(account.manualSteps)
  }
  if (!account?.manualSelectors) return []
  return manualSelectorsToSteps(account.manualSelectors)
}

export function manualSelectorsToSteps(
  selectors: AccountWithSite['manualSelectors']
): RecipeStep[] {
  if (!selectors) return []
  return (
    [
      ['fillUsername', selectors.username],
      ['fillPassword', selectors.password],
      ['click', selectors.submit]
    ] as const
  ).flatMap(([action, selector]) =>
    selector?.trim() ? [createManualStep(action, selector)] : []
  )
}

export function createManualStep(
  action: ManualStepAction,
  selector = '',
  key = 'Enter'
): RecipeStep {
  const base = {
    id: crypto.randomUUID(),
    selector: { candidates: [selector] }
  }
  if (action === 'click') {
    return { ...base, type: 'click', navigationExpected: true }
  }
  if (action === 'press') {
    return { ...base, type: 'press', key }
  }
  return { ...base, type: action }
}

export function manualStepSelectorSpec(step: RecipeStep): SelectorSpec {
  return 'selector' in step && step.selector
    ? step.selector
    : { candidates: [''] }
}

export function manualStepSelector(step: RecipeStep): string {
  return manualStepSelectorSpec(step).candidates[0] ?? ''
}

export function updateManualStepSelector(
  step: RecipeStep,
  value: string
): RecipeStep {
  return {
    ...step,
    selector: {
      ...manualStepSelectorSpec(step),
      candidates: [value]
    }
  } as RecipeStep
}

export function changeManualStepType(
  step: RecipeStep,
  action: ManualStepAction
): RecipeStep {
  const selector = manualStepSelectorSpec(step)
  if (action === 'click') {
    return {
      id: step.id,
      type: 'click',
      selector,
      navigationExpected: true
    }
  }
  if (action === 'press') {
    return {
      id: step.id,
      type: 'press',
      selector,
      key: step.type === 'press' ? step.key : 'Enter'
    }
  }
  return { id: step.id, type: action, selector }
}

export function nextManualStepType(steps: RecipeStep[]): ManualStepAction {
  if (!steps.some((step) => step.type === 'fillUsername')) return 'fillUsername'
  if (!steps.some((step) => step.type === 'fillPassword')) return 'fillPassword'
  if (!steps.some((step) => step.type === 'click')) return 'click'
  return 'focusChallenge'
}

export function manualStepsAreComplete(steps: RecipeStep[]): boolean {
  return (
    steps.length > 0 &&
    steps.every((step) => Boolean(manualStepSelector(step).trim())) &&
    steps.some((step) => step.type === 'fillUsername') &&
    steps.some((step) => step.type === 'fillPassword')
  )
}

export function normalizeManualSteps(steps: RecipeStep[]): RecipeStep[] {
  return steps.map((step) => {
    const selector = manualStepSelectorSpec(step)
    return {
      ...step,
      selector: {
        ...selector,
        candidates: selector.candidates.map((candidate) => candidate.trim()).filter(Boolean)
      }
    } as RecipeStep
  })
}

export function selectorTestFieldForAction(
  action: RecipeStep['type']
): SelectorTestField {
  if (action === 'fillUsername') return 'username'
  if (action === 'fillPassword') return 'password'
  return 'submit'
}

export function selectorPlaceholderForAction(
  action: RecipeStep['type']
): string {
  if (action === 'fillUsername') return 'input[name="username"], #username'
  if (action === 'fillPassword') return 'input[type="password"], #password'
  if (action === 'focusChallenge') return 'input[name="otp"], #verification-code'
  return 'button[type="submit"], #login'
}

export function manualStepActionLabel(
  action: ManualStepAction,
  tr: (zhCN: string, en: string, zhTW: string) => string
): string {
  switch (action) {
    case 'fillUsername':
      return tr('输入用户名', 'Fill username', '輸入使用者名稱')
    case 'fillPassword':
      return tr('输入密码', 'Fill password', '輸入密碼')
    case 'click':
      return tr('点击元素', 'Click element', '點擊元素')
    case 'press':
      return tr('按下按键', 'Press key', '按下按鍵')
    case 'focusChallenge':
      return tr('聚焦验证码', 'Focus challenge', '聚焦驗證碼')
  }
}
