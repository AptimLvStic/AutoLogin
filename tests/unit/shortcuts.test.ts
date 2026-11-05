import { describe, expect, it } from 'vitest'
import {
  displayKeyboardShortcut,
  matchesKeyboardShortcut,
  shortcutFromKeyboardEvent
} from '../../src/shared/shortcuts'

describe('keyboard shortcuts', () => {
  it('normalizes modifier combinations', () => {
    expect(
      shortcutFromKeyboardEvent({
        key: 'c',
        ctrlKey: true
      })
    ).toBe('Ctrl+C')
    expect(
      shortcutFromKeyboardEvent({
        key: 'K',
        ctrlKey: true,
        shiftKey: true
      })
    ).toBe('Ctrl+Shift+K')
  })

  it('rejects unmodified text keys and modifier-only presses', () => {
    expect(shortcutFromKeyboardEvent({ key: 'c' })).toBeNull()
    expect(shortcutFromKeyboardEvent({ key: 'Control', ctrlKey: true })).toBeNull()
    expect(shortcutFromKeyboardEvent({ key: 'F8' })).toBe('F8')
  })

  it('matches and displays configured shortcuts', () => {
    expect(
      matchesKeyboardShortcut(
        { key: 'c', ctrlKey: true },
        'Ctrl+C'
      )
    ).toBe(true)
    expect(
      matchesKeyboardShortcut(
        { key: 'c', ctrlKey: true, shiftKey: true },
        'Ctrl+C'
      )
    ).toBe(false)
    expect(displayKeyboardShortcut('Ctrl+Shift+C')).toBe('Ctrl + Shift + C')
  })
})
