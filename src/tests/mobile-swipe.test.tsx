// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useMobileTabSwipe } from '../app/useMobileTabSwipe'

function Surface({ onSwipe }: { onSwipe: (direction: -1 | 1) => void }) {
  return (
    <main {...useMobileTabSwipe(onSwipe)}>
      <p>页面内容</p>
      <input aria-label="学习随记" />
      <div data-testid="chart" style={{ overflowX: 'auto' }}>图表</div>
    </main>
  )
}

function swipe(target: Element, from = [220, 200], to = [80, 210]) {
  fireEvent.touchStart(target, { touches: [{ clientX: from[0], clientY: from[1] }] })
  fireEvent.touchMove(target, { touches: [{ clientX: to[0], clientY: to[1] }] })
  fireEvent.touchEnd(target, { touches: [], changedTouches: [{ clientX: to[0], clientY: to[1] }] })
}

beforeEach(() => { Object.defineProperty(window, 'innerWidth', { configurable: true, value: 390 }) })
afterEach(cleanup)

describe('手机左右滑动切页', () => {
  it('左滑进入下一页，右滑返回上一页', () => {
    const onSwipe = vi.fn()
    render(<Surface onSwipe={onSwipe} />)
    swipe(screen.getByText('页面内容'))
    swipe(screen.getByText('页面内容'), [80, 200], [220, 210])
    expect(onSwipe.mock.calls).toEqual([[1], [-1]])
  })

  it('纵向滚动和短距离移动不切页', () => {
    const onSwipe = vi.fn()
    render(<Surface onSwipe={onSwipe} />)
    const target = screen.getByText('页面内容')
    swipe(target, [220, 200], [200, 400])
    swipe(target, [220, 200], [180, 210])
    expect(onSwipe).not.toHaveBeenCalled()
  })

  it('输入框、系统返回边缘和横向图表保留原操作', () => {
    const onSwipe = vi.fn()
    render(<Surface onSwipe={onSwipe} />)
    swipe(screen.getByRole('textbox'))
    swipe(screen.getByText('页面内容'), [10, 200], [220, 210])
    const chart = screen.getByTestId('chart')
    Object.defineProperties(chart, { scrollWidth: { value: 700 }, clientWidth: { value: 300 } })
    swipe(chart)
    expect(onSwipe).not.toHaveBeenCalled()
  })

  it('弹窗打开时不切走底层页面', () => {
    const onSwipe = vi.fn()
    render(<><Surface onSwipe={onSwipe} /><div role="dialog" aria-modal="true">新建目标</div></>)
    swipe(screen.getByText('页面内容'))
    expect(onSwipe).not.toHaveBeenCalled()
  })

  it('多点触控或取消手势不触发切页', () => {
    const onSwipe = vi.fn()
    render(<Surface onSwipe={onSwipe} />)
    const target = screen.getByText('页面内容')
    fireEvent.touchStart(target, { touches: [{ clientX: 220, clientY: 200 }] })
    fireEvent.touchMove(target, { touches: [{ clientX: 200, clientY: 210 }, { clientX: 100, clientY: 100 }] })
    fireEvent.touchEnd(target, { touches: [], changedTouches: [{ clientX: 80, clientY: 210 }] })
    fireEvent.touchStart(target, { touches: [{ clientX: 220, clientY: 200 }] })
    fireEvent.touchCancel(target)
    fireEvent.touchEnd(target, { touches: [], changedTouches: [{ clientX: 80, clientY: 210 }] })
    expect(onSwipe).not.toHaveBeenCalled()
  })

  it('桌面布局不响应手机切页手势', () => {
    const onSwipe = vi.fn()
    render(<Surface onSwipe={onSwipe} />)
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1280 })
    swipe(screen.getByText('页面内容'))
    expect(onSwipe).not.toHaveBeenCalled()
  })
})
