import { describe, expect, it } from 'vitest'
import {
  averageSplit,
  checkMilestoneTotalConflict,
  getGoalMilestoneTimeline,
  getMilestoneProgress,
  getUnassignedCheckins,
  milestoneQuantitativeVsSteps,
  timeSplit,
  unassignedAmount,
} from '../domain/milestone'
import { makeCheckin, makeGoal } from './helpers'
import type { Milestone } from '../domain/types'

const TODAY = '2026-03-15'

function ms(p: Partial<Milestone>): Milestone {
  return {
    id: p.id ?? 'm1',
    goalId: p.goalId ?? 'g1',
    title: p.title ?? '第一阶段',
    plannedAmount: p.plannedAmount ?? 100,
    startDate: p.startDate ?? null,
    dueDate: p.dueDate ?? null,
    sortOrder: p.sortOrder ?? 0,
    color: p.color ?? null,
    isDemo: p.isDemo ?? false,
    createdAt: '',
    updatedAt: '',
    ...p,
  }
}

describe('里程碑进度与主目标口径分离', () => {
  it('阶段量只由关联打卡求和；主目标进度包含全部打卡', () => {
    const m1 = ms({ id: 'm1', plannedAmount: 100 })
    const checkins = [
      makeCheckin('g1', '2026-03-01', 30, { milestoneId: 'm1' }),
      makeCheckin('g1', '2026-03-02', 20),
      makeCheckin('g1', '2026-03-03', 50, { milestoneId: 'm1' }),
    ]
    const p = getMilestoneProgress(m1, checkins, TODAY)
    expect(p.done).toBe(80)
    expect(p.percent).toBe(80)
    expect(p.isCompleted).toBe(false)
    // 主目标完成量 = 全部打卡之和（80 + 20），与阶段口径独立
    const total = checkins.reduce((s, c) => s + c.amount, 0)
    expect(total).toBe(100)
  })

  it('勾选步骤不改变量化进度（两种口径分离）', () => {
    const m1 = ms({ id: 'm1', plannedAmount: 100 })
    const steps = [
      { id: 's1', milestoneId: 'm1', title: '看完章节', isDone: true, doneAt: null, sortOrder: 0, createdAt: '', updatedAt: '' },
      { id: 's2', milestoneId: 'm1', title: '做练习', isDone: true, doneAt: null, sortOrder: 1, createdAt: '', updatedAt: '' },
      { id: 's3', milestoneId: 'm1', title: '总结', isDone: false, doneAt: null, sortOrder: 2, createdAt: '', updatedAt: '' },
    ]
    const r = milestoneQuantitativeVsSteps(m1, [], steps, TODAY)
    expect(r.quantitativePercent).toBe(0) // 无打卡
    expect(r.stepsDone).toBe(2) // 步骤勾了 2/3
    expect(r.stepsTotal).toBe(3)
  })

  it('阶段逾期：dueDate < 今天且未完成', () => {
    const m = ms({ id: 'm1', plannedAmount: 100, dueDate: '2026-03-10' })
    expect(getMilestoneProgress(m, [], TODAY).overdueDays).toBe(5)
    const done = getMilestoneProgress(m, [makeCheckin('g1', '2026-03-01', 100, { milestoneId: 'm1' })], TODAY)
    expect(done.overdueDays).toBeNull() // 已完成不显示逾期
    const future = ms({ id: 'm1', plannedAmount: 100, dueDate: '2026-04-01' })
    expect(getMilestoneProgress(future, [], TODAY).overdueDays).toBeNull()
  })

  it('时间轴：排序、下一里程碑定位', () => {
    const items = [
      ms({ id: 'm2', title: '第二', plannedAmount: 100, sortOrder: 1 }),
      ms({ id: 'm1', title: '第一', plannedAmount: 100, sortOrder: 0 }),
    ]
    const t = getGoalMilestoneTimeline(items, [makeCheckin('g1', '2026-03-01', 100, { milestoneId: 'm1' })], TODAY)
    expect(t.items.map((i) => i.milestone.id)).toEqual(['m1', 'm2'])
    expect(t.items[0].isCompleted).toBe(true)
    expect(t.next?.milestone.id).toBe('m2')
    expect(t.totalPlanned).toBe(200)
  })

  it('未分配记录与批量关联的原料', () => {
    const checkins = [
      makeCheckin('g1', '2026-03-01', 20),
      makeCheckin('g1', '2026-03-02', 30),
      makeCheckin('g1', '2026-03-03', 40, { milestoneId: 'm1' }),
      makeCheckin('g2', '2026-03-03', 50), // 其他目标不算
    ]
    const un = getUnassignedCheckins('g1', checkins)
    expect(un).toHaveLength(2)
    expect(unassignedAmount('g1', checkins)).toBe(50)
  })

  it('阶段总量超出主目标总量 → 显式冲突（允许未分完余量）', () => {
    const goal = makeGoal({ id: 'g1', totalAmount: 440 })
    expect(checkMilestoneTotalConflict(goal, [ms({ plannedAmount: 100 }), ms({ plannedAmount: 200 })])).toBeNull()
    const conflict = checkMilestoneTotalConflict(goal, [ms({ plannedAmount: 300 }), ms({ plannedAmount: 200 })])
    expect(conflict).toEqual({ over: 60, totalPlanned: 500 })
  })
})

describe('半自动拆分（本地计算）', () => {
  it('平均拆分：商/余数，总和恰等于待拆量', () => {
    const parts = averageSplit(500, 3, 0)
    expect(parts.map((p) => p.plannedAmount)).toEqual([167, 167, 166])
    expect(parts.reduce((s, p) => s + p.plannedAmount, 0)).toBe(500)
    expect(parts.map((p) => p.title)).toEqual(['阶段 1', '阶段 2', '阶段 3'])
  })

  it('平均拆分从已有阶段后继续编号', () => {
    const parts = averageSplit(100, 2, 2)
    expect(parts.map((p) => p.title)).toEqual(['阶段 3', '阶段 4'])
  })

  it('按时间分段：日期均分且最后一段截止到 to', () => {
    const parts = timeSplit(440, '2026-03-01', '2026-03-31', 3, 0)
    expect(parts).toHaveLength(3)
    expect(parts[0].startDate).toBe('2026-03-01')
    expect(parts[0].dueDate).toBe('2026-03-10')
    expect(parts[1].startDate).toBe('2026-03-11')
    expect(parts[2].dueDate).toBe('2026-03-31')
    expect(parts.reduce((s, p) => s + p.plannedAmount, 0)).toBe(440)
  })
})
