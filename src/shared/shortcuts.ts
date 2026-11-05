export interface KeyboardShortcutLike {
  key: string
  ctrlKey?: boolean
  metaKey?: boolean
  altKey?: boolean
  shiftKey?: boolean
}

const MODIFIER_KEYS = new Set(['Alt', 'Control', 'Meta', 'Shift'])

export function shortcutFromKeyboardEvent(
  event: KeyboardShortcutLike
): string | null {
  if (MODIFIER_KEYS.has(event.key)) return null
  const key = normalizeKey(event.key)
  if (!key) return null

  const parts: string[] = []
  if (event.ctrlKey || event.metaKey) parts.push('Ctrl')
  if (event.altKey) parts.push('Alt')
  if (event.shiftKey) parts.push('Shift')
  parts.push(key)

  if (parts.length === 1 && !/^F(?:[1-9]|1[0-2])$/.test(key)) {
    return null
  }
  return parts.join('+')
}

export function matchesKeyboardShortcut(
  event: KeyboardShortcutLike,
  shortcut: string
): boolean {
  const candidate = shortcutFromKeyboardEvent(event)
  return Boolean(
    candidate &&
      candidate.toLocaleLowerCase() === shortcut.trim().toLocaleLowerCase()
  )
}

export function displayKeyboardShortcut(shortcut: string): string {
  return shortcut
    .split('+')
    .map((part) => part.trim())
    .filter(Boolean)
    .join(' + ')
}

function normalizeKey(key: string): string {
  if (key === ' ') return 'Space'
  if (key.length === 1) return key.toUpperCase()
  return key
}
