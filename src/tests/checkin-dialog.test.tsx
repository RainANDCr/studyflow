// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import * as jestDomMatchers from '@testing-library/jest-dom/matchers'
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

expect.extend(jestDomMatchers)

const addCheckinMock = vi.fn()

vi.mock('../state/AppData', () => ({
  useAppData: () => ({
    today: '2026-03-15',
    addCheckin: addCheckinMock,
    checkins: [],
    milestones: [],
  }),
}))

vi.mock('../components/feedback', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../components/feedback')>()
  return {
    ...actual,
    useToast: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }),
  }
})

import { CheckinDialog } from '../features/today/CheckinDialog'
import { makeGoal } from './helpers'

/**
 * jsdom 下受控输入的标准驱动方式：用原型 value setter 绕过 React 的
 * value tracker，再派发 input/change 事件，并用 act() 包裹确保状态同步落盘。
 */
function setValue(el: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement, value: string) {
  const proto =
    el instanceof HTMLSelectElement
      ? HTMLSelectElement.prototype
      : el instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')!.set!
  act(() => {
    setter.call(el, value)
    el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }))
  })
}

beforeEach(() => {
  addCheckinMock.mockClear()
})

afterEach(cleanup)

describe('打卡弹窗（CheckinDialog）', () => {
  it('预填今日建议量（剩余量/剩余天数，向上取整），提交按归属日期写入', async () => {
    // 剩 4 天（今天 03-15 至截止 03-18），剩余 100 → 建议 25
    const goal = makeGoal({ id: 'g1', unit: '词', totalAmount: 100, deadline: '2026-03-18' })
    render(<CheckinDialog open onClose={() => undefined} goal={goal} />)

    const amountInput = screen.getByLabelText(/完成数量/) as HTMLInputElement
    expect(amountInput.value).toBe('25')

    fireEvent.click(screen.getByRole('button', { name: '保存打卡' }))
    await waitFor(() => {
      expect(addCheckinMock).toHaveBeenCalledTimes(1)
    })
    expect(addCheckinMock).toHaveBeenCalledWith({
      goalId: 'g1',
      date: '2026-03-15',
      amount: 25,
      minutes: null,
      note: null,
      isBackfill: false,
      milestoneId: null,
    })
  })

  it('选择过去日期时标记为补记，并可填写分钟数', async () => {
    const goal = makeGoal({ id: 'g1', unit: '页', totalAmount: 440, deadline: '2026-04-15', startDate: '2026-01-01' })
    render(<CheckinDialog open onClose={() => undefined} goal={goal} />)

    setValue(screen.getByLabelText('记录日期') as HTMLSelectElement, '2026-03-14')
    setValue(screen.getByLabelText(/完成数量/) as HTMLInputElement, '20')
    setValue(screen.getByLabelText(/投入分钟数/) as HTMLInputElement, '35')
    fireEvent.click(screen.getByRole('button', { name: '保存打卡' }))

    await waitFor(() => {
      expect(addCheckinMock).toHaveBeenCalledWith({
        goalId: 'g1',
        date: '2026-03-14',
        amount: 20,
        minutes: 35,
        note: null,
        isBackfill: true,
        milestoneId: null,
      })
    })
  })

  it('数量非法（0）时不提交并显示错误', async () => {
    const goal = makeGoal({ id: 'g1', unit: '词', totalAmount: 100, deadline: '2026-03-18' })
    render(<CheckinDialog open onClose={() => undefined} goal={goal} />)
    setValue(screen.getByLabelText(/完成数量/) as HTMLInputElement, '0')
    fireEvent.click(screen.getByRole('button', { name: '保存打卡' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('请填写大于 0 的数量')
    expect(addCheckinMock).not.toHaveBeenCalled()
  })
})
