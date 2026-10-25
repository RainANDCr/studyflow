import { describe, expect, it } from 'vitest'
import { computeCheckinPrefill, computeTodaySuggestion, getAllowedBackfillDates } from '../domain/suggestion'
import { computeGoalProgress, findActualCompletionDate } from '../domain/progress'
import { makeCheckin, makeGoal } from './helpers'

const TODAY = '2026-03-15' // 周日

describe('今日建议量', () => {
  it('截止日为今天：remainingDays=1，建议量=剩余量', () => {
    const goal = makeGoal({ totalAmount: 100, deadline: TODAY })
    const checkins = [makeCheckin(goal.id, '2026-03-10', 60)]
    expect(computeTodaySuggestion(goal, checkins, TODAY)).toEqual({
      kind: 'active',
      suggestion: 40,
      remaining: 40,
      remainingDays: 1,
    })
  })

  it('截止日为明天：除以 2 并向上取整', () => {
    const goal = makeGoal({ totalAmount: 100, deadline: '2026-03-16' })
    const checkins = [makeCheckin(goal.id, '2026-03-10', 59)]
    const s = computeTodaySuggestion(goal, checkins, TODAY)
    expect(s.kind).toBe('active')
    if (s.kind === 'active') {
      expect(s.remainingDays).toBe(2)
      expect(s.suggestion).toBe(21) // ceil(41/2)
    }
  })

  it('同一天多次打卡：完成总量按记录求和，而不是打卡次数', () => {
    const goal = makeGoal({ totalAmount: 100, deadline: '2026-03-20' })
    const checkins = [
      makeCheckin(goal.id, '2026-03-14', 10),
      makeCheckin(goal.id, '2026-03-14', 15),
      makeCheckin(goal.id, '2026-03-14', 5),
    ]
    const p = computeGoalProgress(goal, checkins)
    expect(p.done).toBe(30)
    expect(p.remaining).toBe(70)
    expect(p.percentCapped).toBe(30)
  })

  it('已完成返回 completed（建议 0），允许超量但圆环封顶 100%', () => {
    const goal = makeGoal({ totalAmount: 100, deadline: '2026-03-20' })
    const checkins = [
      makeCheckin(goal.id, '2026-03-12', 90),
      makeCheckin(goal.id, '2026-03-13', 30),
    ]
    const s = computeTodaySuggestion(goal, checkins, TODAY)
    expect(s.kind).toBe('completed')
    const p = computeGoalProgress(goal, checkins)
    expect(p.isCompleted).toBe(true)
    expect(p.percentCapped).toBe(100)
    expect(p.percentRaw).toBeGreaterThan(100)
    expect(findActualCompletionDate(goal, checkins)).toBe('2026-03-13')
  })

  it('逾期：不除以 0 或负数，给出明确逾期天数与滚入今日量', () => {
    const goal = makeGoal({ totalAmount: 100, deadline: '2026-03-13' })
    const checkins = [makeCheckin(goal.id, '2026-03-12', 40)]
    const s = computeTodaySuggestion(goal, checkins, TODAY)
    expect(s).toEqual({ kind: 'overdue', overdueDays: 2, suggestion: 60, remaining: 60 })
  })

  it('未开始（开始日在未来）', () => {
    const goal = makeGoal({ startDate: '2026-03-16' })
    expect(computeTodaySuggestion(goal, [], TODAY).kind).toBe('notStarted')
  })

  it('打卡预填：今日建议量 - 今日已记录量，下限 0', () => {
    const goal = makeGoal({ totalAmount: 100, deadline: '2026-03-19' }) // 今天起含截止日共 5 天
    const checkins = [
      makeCheckin(goal.id, '2026-03-13', 48), // 昨日完成
      makeCheckin(goal.id, TODAY, 7),
      makeCheckin(goal.id, TODAY, 5), // 今日已完成 12
    ]
    // remaining = 100-60 = 40, days = 5 → 建议 8；今日已记 12 → 预填 0
    expect(computeCheckinPrefill(goal, checkins, TODAY)).toBe(0)
    const goal2 = makeGoal({ totalAmount: 100, deadline: '2026-03-19' })
    const checkins2 = [makeCheckin(goal2.id, '2026-03-13', 40)]
    // remaining 60 / 5 天 = 12
    expect(computeCheckinPrefill(goal2, checkins2, TODAY)).toBe(12)
  })

  it('补记日期：最近 6 个过去自然日、不早于开始日、不含未来', () => {
    const goal = makeGoal({ startDate: '2026-03-01' })
    expect(getAllowedBackfillDates(goal, TODAY)).toEqual([
      '2026-03-14',
      '2026-03-13',
      '2026-03-12',
      '2026-03-11',
      '2026-03-10',
      '2026-03-09',
    ])
    const lateGoal = makeGoal({ startDate: '2026-03-13' })
    expect(getAllowedBackfillDates(lateGoal, TODAY)).toEqual(['2026-03-14', '2026-03-13'])
    const justStarted = makeGoal({ startDate: TODAY })
    expect(getAllowedBackfillDates(justStarted, TODAY)).toEqual([])
  })
})
