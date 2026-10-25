import { describe, expect, it } from 'vitest'
import {
  buildReschedulePreview,
  distributeRemaining,
  getDayPlanStatus,
  monthGridDates,
} from '../domain/dailyPlan'
import { makeCheckin, makeGoal } from './helpers'
import type { DailyPlan } from '../domain/types'

const TODAY = '2026-03-09' // 周一

function plan(goalId: string, date: string, plannedAmount: number, source: 'auto' | 'manual' = 'auto', id = `p-${date}`): DailyPlan {
  return { id, goalId, date, plannedAmount, source, isDemo: false, createdAt: '', updatedAt: '' }
}

describe('自动分配引擎（商/余数）', () => {
  it('整数剩余量：每天之和恰等于剩余量，余数分给前段', () => {
    const goal = makeGoal({ totalAmount: 100, startDate: '2026-03-01', deadline: '2026-03-13' })
    const r = distributeRemaining(goal, null, [], TODAY)
    expect(r.kind).toBe('ok')
    if (r.kind !== 'ok') return
    // 03-09..03-13 共 5 个学习日（周一到周五... 实际是 9,10,11,12,13 全周7天制 = 5 天）
    expect(r.studyDayCount).toBe(5)
    const sum = r.plans.reduce((s, p) => s + p.plannedAmount, 0)
    expect(sum).toBe(100)
    // 100/5=20 余 0
    expect(r.plans.every((p) => p.plannedAmount === 20)).toBe(true)
  })

  it('余数分给前面的天数：99 分 4 天 = 25,25,25,24', () => {
    const goal = makeGoal({ totalAmount: 99, startDate: '2026-03-09', deadline: '2026-03-12' })
    const r = distributeRemaining(goal, null, [], TODAY)
    if (r.kind !== 'ok') throw new Error(String(r.kind))
    expect(r.plans.map((p) => p.plannedAmount)).toEqual([25, 25, 25, 24])
    expect(r.plans.reduce((s, p) => s + p.plannedAmount, 0)).toBe(99)
  })

  it('已完成打卡扣除剩余量；全部完成返回 completed', () => {
    const goal = makeGoal({ totalAmount: 100, startDate: '2026-03-01', deadline: '2026-03-13' })
    const r = distributeRemaining(goal, null, [makeCheckin(goal.id, '2026-03-08', 40)], TODAY)
    if (r.kind !== 'ok') throw new Error(String(r.kind))
    expect(r.plans.reduce((s, p) => s + p.plannedAmount, 0)).toBe(60)
    const done = distributeRemaining(goal, null, [makeCheckin(goal.id, '2026-03-08', 100)], TODAY)
    expect(done.kind).toBe('completed')
  })

  it('已完成目标不生成未来新计划（completed）', () => {
    const goal = makeGoal({ totalAmount: 10, startDate: '2026-03-01', deadline: '2026-03-13' })
    expect(distributeRemaining(goal, null, [makeCheckin(goal.id, '2026-03-01', 12)], TODAY).kind).toBe('completed')
  })

  it('截止日就是今天：分 1 天；截止日已过：逾期明细', () => {
    const goal = makeGoal({ totalAmount: 50, startDate: '2026-03-01', deadline: TODAY })
    const r = distributeRemaining(goal, null, [], TODAY)
    if (r.kind !== 'ok') throw new Error(String(r.kind))
    expect(r.plans).toHaveLength(1)
    expect(r.plans[0].plannedAmount).toBe(50)

    const overdue = makeGoal({ totalAmount: 50, startDate: '2026-03-01', deadline: '2026-03-05' })
    const r2 = distributeRemaining(overdue, null, [makeCheckin(overdue.id, '2026-03-03', 20)], TODAY)
    expect(r2).toEqual({ kind: 'overdue', overdueDays: 4, remaining: 30 })
  })

  it('学习星期过滤：只排周一三五', () => {
    const goal = makeGoal({ totalAmount: 30, startDate: TODAY, deadline: '2026-03-15' })
    const r = distributeRemaining(goal, { goalId: goal.id, studyWeekdays: [1, 3, 5], excludedDates: [], dailyCap: null }, [], TODAY)
    if (r.kind !== 'ok') throw new Error(String(r.kind))
    // 03-09(一) 03-11(三) 03-13(五)
    expect(r.plans.map((p) => p.date)).toEqual(['2026-03-09', '2026-03-11', '2026-03-13'])
    expect(r.plans.every((p) => p.plannedAmount === 10)).toBe(true)
  })

  it('排除特定日期后重排；排除导致无学习日时明确报错', () => {
    const goal = makeGoal({ totalAmount: 20, startDate: TODAY, deadline: '2026-03-10' })
    const r = distributeRemaining(goal, { goalId: goal.id, studyWeekdays: [1, 2, 3, 4, 5, 6, 7], excludedDates: ['2026-03-09'], dailyCap: null }, [], TODAY)
    if (r.kind !== 'ok') throw new Error(String(r.kind))
    expect(r.plans.map((p) => p.date)).toEqual(['2026-03-10'])
    const none = distributeRemaining(goal, { goalId: goal.id, studyWeekdays: [1], excludedDates: ['2026-03-09'], dailyCap: null }, [], TODAY)
    expect(none.kind).toBe('noStudyDays')
  })

  it('每日上限不足：报容量错误并给出所需量，不静默丢任务', () => {
    const goal = makeGoal({ totalAmount: 100, startDate: TODAY, deadline: '2026-03-10' }) // 2 天 × 50
    const r = distributeRemaining(goal, { goalId: goal.id, studyWeekdays: [1, 2, 3, 4, 5, 6, 7], excludedDates: [], dailyCap: 30 }, [], TODAY)
    expect(r).toMatchObject({ kind: 'capacity', requiredPerDay: 50, cap: 30 })
  })

  it('整数剩余量分不尽时走商/余数：10 分 4 天 = 3,3,2,2', () => {
    const goal = makeGoal({ totalAmount: 10, startDate: TODAY, deadline: '2026-03-12' }) // 09..12 共 4 天
    const r = distributeRemaining(goal, null, [], TODAY)
    if (r.kind !== 'ok') throw new Error(String(r.kind))
    expect(r.plans.map((p) => p.plannedAmount)).toEqual([3, 3, 2, 2])
    expect(r.plans.reduce((s, p) => s + p.plannedAmount, 0)).toBe(10)
  })

  it('小数单位：尾差在最后一天吸收，总和精确', () => {
    const goal = makeGoal({ totalAmount: 10.5, startDate: TODAY, deadline: '2026-03-12' }) // 09..12 共 4 天
    const r = distributeRemaining(goal, null, [], TODAY)
    if (r.kind !== 'ok') throw new Error(String(r.kind))
    const amounts = r.plans.map((p) => p.plannedAmount)
    expect(amounts[0]).toBe(2.63) // round2(10.5/4)
    expect(amounts[3]).toBeCloseTo(10.5 - 2.63 * 3, 2) // 最后一天吸收尾差
    expect(Math.round(amounts.reduce((s, v) => s + v, 0) * 100) / 100).toBe(10.5)
  })
})

describe('重新排程预览（manual 锁定保留）', () => {
  const goalId = 'g1'
  it('manual 日期让位、auto 旧项被移除、数量不变计 unchanged', () => {
    const existing = [
      plan(goalId, '2026-03-09', 20, 'auto', 'p1'), // 数量变 → upsert
      plan(goalId, '2026-03-10', 20, 'manual', 'p2'), // manual 锁定 → 让位
      plan(goalId, '2026-03-11', 20, 'auto', 'p3'), // 新方案同量 → unchanged
      plan(goalId, '2026-03-12', 20, 'auto', 'p4'), // 新方案无此日 → removal
      plan(goalId, '2026-03-05', 99, 'auto', 'p5'), // 历史 → 不动
    ]
    const fresh = [
      { date: '2026-03-09', plannedAmount: 25 },
      { date: '2026-03-10', plannedAmount: 20 },
      { date: '2026-03-11', plannedAmount: 20 },
      { date: '2026-03-13', plannedAmount: 30 },
    ]
    const pv = buildReschedulePreview(goalId, existing, fresh, TODAY)
    expect(pv.upserts).toEqual([
      { goalId, date: '2026-03-09', plannedAmount: 25, source: 'auto' },
      { goalId, date: '2026-03-13', plannedAmount: 30, source: 'auto' },
    ])
    expect(pv.removals.map((r) => r.id)).toEqual(['p4'])
    expect(pv.unchanged).toBe(1)
    expect(pv.manualKept).toBe(1)
  })
})

describe('当日状态与月网格', () => {
  it('计划 X / 实际 Y 动态聚合（实际只来自 Checkin）', () => {
    const g1 = makeGoal({ id: 'g1', unit: '词' })
    const g2 = makeGoal({ id: 'g2', unit: '页' })
    const plans = [plan('g1', '2026-03-09', 30, 'auto', 'pa'), plan('g2', '2026-03-09', 10, 'manual', 'pb')]
    const checkins = [makeCheckin('g1', '2026-03-09', 12), makeCheckin('g1', '2026-03-09', 8), makeCheckin('g2', '2026-03-09', 10)]
    const st = getDayPlanStatus('2026-03-09', [g1, g2], plans, checkins)
    expect(st.planned).toBe(40)
    expect(st.actual).toBe(30)
    const g1Item = st.items.find((i) => i.goal.id === 'g1')
    expect(g1Item?.actual).toBe(20) // 同日多条求和
    expect(g1Item?.plan.plannedAmount).toBe(30)
  })

  it('月网格：2026年2月（周日起始/结束跨月），全部周一起始', () => {
    const grid = monthGridDates('2026-02')
    expect(grid.length % 7).toBe(0)
    expect(grid).toContain('2026-02-01')
    expect(grid).toContain('2026-02-28')
    // 首格必为周一
    const [first] = grid
    expect(new Date(Number(first.slice(0, 4)), Number(first.slice(5, 7)) - 1, Number(first.slice(8, 10))).getDay()).toBe(1)
  })

  it('月网格跨年：2025-12 网格延伸到 2026-01', () => {
    const grid = monthGridDates('2025-12')
    expect(grid.some((d) => d.startsWith('2026-01'))).toBe(true)
  })

  it('月网格前侧补齐上月：2026-03-01 为周日，网格从 2026-02-23（周一）开始', () => {
    const grid = monthGridDates('2026-03')
    expect(grid[0]).toBe('2026-02-23')
    expect(grid[0].startsWith('2026-02')).toBe(true)
  })
})
