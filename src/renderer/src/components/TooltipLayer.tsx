import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

/**
 * 2026-11-26 全局统一 tooltip。
 *
 * 全软件里 `title="…"` 一律不再交给系统原生气泡（样式不可控：浅灰方块、字体跟随系统），
 * 而是由这一层接管：悬停 / 键盘聚焦时暂时把 title 从元素上摘掉（抑制原生气泡），
 * 用与设置页 `InfoTip` 完全一致、且跟随主题的气泡渲染；指针离开或失焦时再把 title 放回去。
 * 右键（pointerdown 非主键或 contextmenu）立即收掉气泡，避免压在右键菜单之上。
 *
 * 元素可以用 `data-tip-placement="right"`（或 left / above）指定气泡方向，默认在下方。
 */

const SHOW_DELAY = 320
const FOCUS_DELAY = 80
const GAP = 7
const EDGE = 10

type Placement = 'below' | 'above' | 'left' | 'right'

function placementOf(element: HTMLElement): Placement {
  const value = element.dataset.tipPlacement
  if (value === 'right' || value === 'left' || value === 'above') {
    return value
  }
  return 'below'
}

function mergeIds(current: string | null, id: string): string {
  return current ? `${current} ${id}` : id
}

export function TooltipLayer(): React.JSX.Element | null {
  const tipId = useId()
  const [tip, setTip] = useState<{ text: string; id: number } | null>(null)
  const anchorRef = useRef<HTMLElement | null>(null)
  const textRef = useRef('')
  const timerRef = useRef<number | null>(null)
  const countRef = useRef(0)
  const bubbleRef = useRef<HTMLSpanElement>(null)
  const describedElRef = useRef<HTMLElement | null>(null)
  const describedPrevRef = useRef<string | null>(null)
  const placeRef = useRef<() => void>(() => undefined)
  const leaveRef = useRef<() => void>(() => undefined)

  useEffect(() => {
    function clearTimer(): void {
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current)
        timerRef.current = null
      }
    }

    function restoreTitle(element: HTMLElement | null, text: string): void {
      if (!element || !text || !element.isConnected) {
        return
      }
      if (!element.hasAttribute('title')) {
        element.setAttribute('title', text)
      }
    }

    function leave(): void {
      clearTimer()
      const element = anchorRef.current
      const text = textRef.current
      anchorRef.current = null
      textRef.current = ''
      setTip(null)
      restoreTitle(element, text)
    }

    leaveRef.current = leave

    function show(): void {
      timerRef.current = null
      const element = anchorRef.current
      if (!element || !element.isConnected) {
        leave()
        return
      }
      countRef.current += 1
      setTip({ text: textRef.current, id: countRef.current })
    }

    function schedule(delay: number): void {
      clearTimer()
      timerRef.current = window.setTimeout(show, delay)
    }

    function begin(element: HTMLElement, delay: number): void {
      const current = anchorRef.current
      if (current === element) {
        if (!bubbleRef.current) {
          schedule(delay)
        }
        return
      }
      if (current && (current.contains(element) || element.contains(current))) {
        return
      }
      leave()
      if (!element.isConnected) {
        return
      }
      const text = (element.getAttribute('title') ?? '').trim()
      if (!text) {
        return
      }
      anchorRef.current = element
      textRef.current = text
      element.removeAttribute('title')
      schedule(delay)
    }

    function titledFrom(target: EventTarget | null): HTMLElement | null {
      if (!(target instanceof Element)) {
        return null
      }
      const element = target.closest('[title]')
      if (!(element instanceof HTMLElement)) {
        return null
      }
      if (element === document.body || element === document.documentElement) {
        return null
      }
      return (element.getAttribute('title') ?? '').trim() ? element : null
    }

    function place(): void {
      const element = anchorRef.current
      const bubble = bubbleRef.current
      if (!element || !bubble) {
        return
      }
      const rect = element.getBoundingClientRect()
      const width = bubble.offsetWidth
      const height = bubble.offsetHeight
      const placement = placementOf(element)
      let left: number
      let top: number

      if (placement === 'right') {
        left = rect.right + GAP
        top = rect.top + rect.height / 2 - height / 2
        if (left + width > window.innerWidth - EDGE) {
          left = rect.left - GAP - width
        }
      } else if (placement === 'left') {
        left = rect.left - GAP - width
        top = rect.top + rect.height / 2 - height / 2
        if (left < EDGE) {
          left = rect.right + GAP
        }
      } else {
        left = rect.left
        top = rect.bottom + GAP
        const above = rect.top - GAP - height
        if (placement === 'above' || (top + height > window.innerHeight - EDGE && above >= EDGE)) {
          top = above
        }
      }

      left = Math.min(left, window.innerWidth - EDGE - width)
      left = Math.max(EDGE, left)
      top = Math.min(top, window.innerHeight - EDGE - height)
      top = Math.max(EDGE, top)

      bubble.style.left = `${Math.round(left)}px`
      bubble.style.top = `${Math.round(top)}px`
    }

    placeRef.current = place

    function onPointerOver(event: PointerEvent): void {
      const element = titledFrom(event.target)
      if (element) {
        begin(element, SHOW_DELAY)
      }
    }

    function onPointerOut(event: PointerEvent): void {
      const element = anchorRef.current
      if (!element) {
        return
      }
      const related = event.relatedTarget
      if (related instanceof Node && (element === related || element.contains(related))) {
        return
      }
      if (event.target instanceof Node && element.contains(event.target)) {
        leave()
      }
    }

    function onFocusIn(event: FocusEvent): void {
      const element = titledFrom(event.target)
      if (!element || event.target !== element) {
        return
      }
      if (!element.matches(':focus-visible')) {
        return
      }
      begin(element, FOCUS_DELAY)
    }

    function onFocusOut(event: FocusEvent): void {
      const element = anchorRef.current
      if (!element) {
        return
      }
      const related = event.relatedTarget
      if (related instanceof Node && (element === related || element.contains(related))) {
        return
      }
      if (event.target instanceof Node && element.contains(event.target)) {
        leave()
      }
    }

    function onPointerDown(event: PointerEvent): void {
      // 右键按下就要收掉气泡：右键菜单（标签页菜单等）会立刻在气泡位置展开，
      // 气泡层级比菜单高，不收掉就会浮在菜单之上。
      if (event.button !== 0) {
        leave()
        return
      }
      const element = anchorRef.current
      if (!element) {
        return
      }
      if (event.target instanceof Node && element.contains(event.target)) {
        return
      }
      leave()
    }

    function onContextMenu(): void {
      if (anchorRef.current) {
        leave()
      }
    }

    function onKeyDown(event: KeyboardEvent): void {
      if (event.key === 'Escape' && anchorRef.current) {
        leave()
      }
    }

    function onViewportChange(): void {
      if (anchorRef.current) {
        leave()
      }
    }

    document.addEventListener('pointerover', onPointerOver, true)
    document.addEventListener('pointerout', onPointerOut, true)
    document.addEventListener('focusin', onFocusIn, true)
    document.addEventListener('focusout', onFocusOut, true)
    document.addEventListener('pointerdown', onPointerDown, true)
    document.addEventListener('contextmenu', onContextMenu, true)
    document.addEventListener('keydown', onKeyDown, true)
    document.addEventListener('scroll', onViewportChange, true)
    document.addEventListener('wheel', onViewportChange, true)
    window.addEventListener('resize', onViewportChange)
    window.addEventListener('blur', onViewportChange)

    return () => {
      clearTimer()
      document.removeEventListener('pointerover', onPointerOver, true)
      document.removeEventListener('pointerout', onPointerOut, true)
      document.removeEventListener('focusin', onFocusIn, true)
      document.removeEventListener('focusout', onFocusOut, true)
      document.removeEventListener('pointerdown', onPointerDown, true)
      document.removeEventListener('contextmenu', onContextMenu, true)
      document.removeEventListener('keydown', onKeyDown, true)
      document.removeEventListener('scroll', onViewportChange, true)
      document.removeEventListener('wheel', onViewportChange, true)
      window.removeEventListener('resize', onViewportChange)
      window.removeEventListener('blur', onViewportChange)
    }
  }, [])

  useLayoutEffect(() => {
    if (!tip) {
      return
    }
    const element = anchorRef.current
    if (!element || !element.isConnected || !bubbleRef.current) {
      return
    }
    placeRef.current()
    if (!describedElRef.current) {
      describedElRef.current = element
      describedPrevRef.current = element.getAttribute('aria-describedby')
      element.setAttribute(
        'aria-describedby',
        mergeIds(describedPrevRef.current, tipId)
      )
    }
    return () => {
      const described = describedElRef.current
      if (!described) {
        return
      }
      describedElRef.current = null
      if (!described.isConnected) {
        return
      }
      const previous = describedPrevRef.current
      describedPrevRef.current = null
      if (previous) {
        described.setAttribute('aria-describedby', previous)
      } else {
        described.removeAttribute('aria-describedby')
      }
    }
  }, [tip, tipId])

  useEffect(() => {
    if (!tip) {
      return
    }
    const interval = window.setInterval(() => {
      const element = anchorRef.current
      if (!element || !element.isConnected) {
        leaveRef.current()
        return
      }
      placeRef.current()
    }, 200)
    return () => window.clearInterval(interval)
  }, [tip])

  if (!tip) {
    return null
  }

  return createPortal(
    <span key={tip.id} ref={bubbleRef} id={tipId} className="app-tooltip" role="tooltip">
      {tip.text}
    </span>,
    document.body
  )
}
