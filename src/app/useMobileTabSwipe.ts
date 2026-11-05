import { useRef, type TouchEvent } from 'react'

/** 手机主页面切换，保留纵向滚动、系统边缘手势和控件内的操作。 */
export function useMobileTabSwipe(onSwipe: (direction: -1 | 1) => void) {
  const start = useRef<{ x: number; y: number; time: number } | null>(null)

  const onTouchStart = (event: TouchEvent<HTMLElement>) => {
    start.current = null
    if (window.innerWidth >= 768 || event.touches.length !== 1) return
    if (document.querySelector('[aria-modal="true"]')) return
    const target = event.target
    if (!(target instanceof Element)) return
    if (target.closest('button, a, input, textarea, select, [contenteditable], [role="slider"], [data-no-tab-swipe]')) return
    for (let node: Element | null = target; node && node !== event.currentTarget; node = node.parentElement) {
      if (node.scrollWidth > node.clientWidth && /auto|scroll/.test(getComputedStyle(node).overflowX)) return
    }
    const touch = event.touches[0]
    if (touch.clientX < 24 || touch.clientX > window.innerWidth - 24) return
    start.current = { x: touch.clientX, y: touch.clientY, time: Date.now() }
  }

  const onTouchMove = (event: TouchEvent<HTMLElement>) => {
    const origin = start.current
    if (!origin) return
    if (event.touches.length !== 1) {
      start.current = null
      return
    }
    const touch = event.touches[0]
    const dx = Math.abs(touch.clientX - origin.x)
    const dy = Math.abs(touch.clientY - origin.y)
    if (dy > 12 && dy > dx) start.current = null
  }

  const onTouchEnd = (event: TouchEvent<HTMLElement>) => {
    const origin = start.current
    start.current = null
    if (!origin || event.changedTouches.length !== 1 || event.touches.length > 0) return
    if (document.querySelector('[aria-modal="true"]') || window.innerWidth >= 768) return
    const touch = event.changedTouches[0]
    const dx = touch.clientX - origin.x
    const dy = touch.clientY - origin.y
    if (Date.now() - origin.time > 700 || Math.abs(dx) < 64 || Math.abs(dx) < Math.abs(dy) * 1.5) return
    onSwipe(dx < 0 ? 1 : -1)
  }

  return { onTouchStart, onTouchMove, onTouchEnd, onTouchCancel: () => { start.current = null } }
}
