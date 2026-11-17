import { isTauri } from '@tauri-apps/api/core'
import type { EmbeddedBrowserBounds } from '@shared/types'

export function embeddedBrowserBounds(element: HTMLElement): EmbeddedBrowserBounds | null {
  const rect = element.getBoundingClientRect()
  if (rect.width < 1 || rect.height < 1) {
    return null
  }
  const zoom = isTauri()
    ? Number.parseFloat(
        getComputedStyle(document.documentElement).getPropertyValue('--interface-scale')
      ) || 1
    : 1
  return {
    x: rect.left * zoom,
    y: rect.top * zoom,
    width: rect.width * zoom,
    height: rect.height * zoom
  }
}
