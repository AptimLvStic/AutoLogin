// @vitest-environment jsdom

import React from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { fireEvent } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { InfoTip } from '../../src/renderer/src/components/InfoTip'
import { I18nProvider } from '../../src/renderer/src/i18n'

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  ;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
    .IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  vi.useRealTimers()
})

function renderTip(): HTMLButtonElement {
  act(() => {
    root.render(
      React.createElement(
        I18nProvider,
        {
          language: 'zh-CN',
          children: React.createElement(
            InfoTip,
            null,
            '这段说明默认收起'
          )
        }
      )
    )
  })
  const trigger = container.querySelector<HTMLButtonElement>('button')
  if (!trigger) throw new Error('未找到说明按钮')
  return trigger
}

describe('InfoTip', () => {
  it('waits 300ms before showing details on hover', () => {
    vi.useFakeTimers()
    const trigger = renderTip()

    act(() => {
      fireEvent.mouseEnter(trigger)
      vi.advanceTimersByTime(299)
    })
    expect(container.querySelector('[role="tooltip"]')).toBeNull()

    act(() => {
      vi.advanceTimersByTime(1)
    })
    expect(container.querySelector('[role="tooltip"]')?.textContent).toBe(
      '这段说明默认收起'
    )
  })

  it('toggles from the question mark and closes on Escape', () => {
    const trigger = renderTip()

    act(() => {
      fireEvent.click(trigger)
    })
    expect(container.querySelector('[role="tooltip"]')).not.toBeNull()

    act(() => {
      fireEvent.click(trigger)
    })
    expect(container.querySelector('[role="tooltip"]')).toBeNull()

    act(() => {
      fireEvent.click(trigger)
    })
    expect(container.querySelector('[role="tooltip"]')).not.toBeNull()

    act(() => {
      fireEvent.keyDown(document, { key: 'Escape' })
    })
    expect(container.querySelector('[role="tooltip"]')).toBeNull()
  })
})
