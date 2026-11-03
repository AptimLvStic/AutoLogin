// @vitest-environment jsdom

import React from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { I18nProvider } from '../../src/renderer/src/i18n'
import { Modal } from '../../src/renderer/src/components/Modal'

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
})

describe('Modal', () => {
  it('keeps autofocus on the target input across parent rerenders', () => {
    act(() => {
      root.render(
        React.createElement(
          I18nProvider,
          {
            language: 'zh-CN',
            children: React.createElement(FocusHarness)
          }
        )
      )
    })

    const input = document.querySelector<HTMLInputElement>('input[aria-label="主密码"]')
    if (!input) throw new Error('未找到主密码输入框')
    expect(document.activeElement).toBe(input)

    const valueSetter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      'value'
    )?.set
    for (const value of ['a', 'ab', 'abc']) {
      act(() => {
        valueSetter?.call(input, value)
        input.dispatchEvent(new Event('input', { bubbles: true }))
      })
      expect(document.activeElement).toBe(input)
    }
    expect(input.value).toBe('abc')
  })
})

function FocusHarness(): React.JSX.Element {
  const [value, setValue] = React.useState('')
  return React.createElement(
    Modal,
    {
      title: '测试弹窗',
      onClose: () => undefined,
      children: React.createElement('input', {
        'aria-label': '主密码',
        'data-autofocus': true,
        value,
        onChange: (event: React.ChangeEvent<HTMLInputElement>) =>
          setValue(event.target.value)
      })
    }
  )
}
