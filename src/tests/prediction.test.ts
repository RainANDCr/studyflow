import { describe, expect, it } from 'vitest'
import { MIN_ACTIVE_DAYS_FOR_PREDICTION, predictCompletion } from '../domain/prediction'
import { makeCheckin, makeGoal } from './helpers'

const TODAY = '2026-03-15' // 周日

describe('近 7 天速度与预计完成日', () => {
  it('阈值常量为 3', () => {
    expect(MIN_ACTIVE_DAYS_FOR_PREDICTION).toBe(3)
  })

  it('有效打卡日不足 3 天 → 暂无推算', () => {
    const goal = makeGoal({ totalAmount: 100, startDate: '2026-03-01', deadline: '2026-04-15' })
    const two = [makeCheckin(goal.id, '2026-03-13', 10), makeCheckin(goal.id, '2026-03-14', 20)]
    const r = predictCompletion(goal, two, TODAY)
    expect(r.status).toBe('insufficient')
    expect(r.activeDays).toBe(2)
  })

  it('满 3 天：无打卡日以 0 计入分母（7 个日历日），今天算第 1 天推算', () => {
    const goal = makeGoal({ totalAmount: 100, startDate: '2026-03-01', deadline: '2026-04-15' })
    const checkins = [
      makeCheckin(goal.id, '2026-03-12', 10),
      makeCheckin(goal.id, '2026-03-13', 20),
      makeCheckin(goal.id, '2026-03-14', 30),
    ]
    const r = predictCompletion(goal, checkins, TODAY)
    expect(r.status).toBe('active')
    expect(r.activeDays).toBe(3)
    expect(r.windowDays).toBe(7)
    // speed = 60/7，remaining 40 → ceil(4.67)=5 天 → projected = TODAY + 4
    expect(r.projectedDate).toBe('2026-03-19')
    expect(r.comparison).toEqual({ kind: 'early', days: 27 })
  })

  it('剩余量不足一天速度时，预计完成日就是今天（口径：今天算第 1 天）', () => {
    const goal = makeGoal({ totalAmount: 61, startDate: '2026-03-01', deadline: '2026-04-15' })
    const checkins = [
      makeCheckin(goal.id, '2026-03-12', 20),
      makeCheckin(goal.id, '2026-03-13', 20),
      makeCheckin(goal.id, '2026-03-14', 20),
    ]
    const r = predictCompletion(goal, checkins, TODAY)
    // speed = 60/7 ≈ 8.57，remaining = 1 → ceil(0.117) = 1 → projected = TODAY
    expect(r.projectedDate).toBe(TODAY)
  })

  it('恰好按截止日完成 → onTime；拖后 → late', () => {
    const goal = makeGoal({ totalAmount: 100, startDate: '2026-03-01', deadline: '2026-03-16' })
    const checkins = [
      makeCheckin(goal.id, '2026-03-12', 10),
      makeCheckin(goal.id, '2026-03-13', 20),
      makeCheckin(goal.id, '2026-03-14', 30),
    ]
    const r = predictCompletion(goal, checkins, TODAY)
    expect(r.projectedDate).toBe('2026-03-19')
    expect(r.comparison).toEqual({ kind: 'late', days: 3 })
    // 把截止日设为预计完成日 → onTime
    const goal2 = makeGoal({ totalAmount: 100, startDate: '2026-03-01', deadline: '2026-03-19' })
    expect(predictCompletion(goal2, checkins, TODAY).comparison).toEqual({ kind: 'onTime', days: 0 })
  })

  it('窗口按目标开始日截断：分母只算有效日历日', () => {
    const goal = makeGoal({ totalAmount: 100, startDate: '2026-03-13', deadline: '2026-04-15' })
    const checkins = [
      makeCheckin(goal.id, '2026-03-13', 10),
      makeCheckin(goal.id, '2026-03-14', 10),
      makeCheckin(goal.id, TODAY, 10),
    ]
    const r = predictCompletion(goal, checkins, TODAY)
    expect(r.windowDays).toBe(3)
    expect(r.activeDays).toBe(3)
    // speed = 10/天，remaining 70 → 7 天 → projected = TODAY + 6
    expect(r.projectedDate).toBe('2026-03-21')
  })

  it('已完成目标用实际完成日，不虚构未来日期', () => {
    const goal = makeGoal({ totalAmount: 30, startDate: '2026-03-01', deadline: '2026-04-15' })
    const checkins = [
      makeCheckin(goal.id, '2026-03-10', 10),
      makeCheckin(goal.id, '2026-03-13', 20),
    ]
    const r = predictCompletion(goal, checkins, TODAY)
    expect(r.status).toBe('completed')
    expect(r.actualCompletionDate).toBe('2026-03-13')
    expect(r.projectedDate).toBeNull()
  })

  it('补记改变统计归属：按 Checkin.date 而非录入时间参与窗口', () => {
    const goal = makeGoal({ totalAmount: 100, startDate: '2026-03-01', deadline: '2026-04-15' })
    const base = [makeCheckin(goal.id, '2026-03-14', 20)]
    // 只有 1 个活跃日 → 不足
    expect(predictCompletion(goal, base, TODAY).status).toBe('insufficient')
    // 补记两天（录入时间是今天，但归属日期在窗口内）
    const withBackfill = [
      ...base,
      makeCheckin(goal.id, '2026-03-13', 20, { isBackfill: true, createdAt: `${TODAY}T21:00:00.000Z` }),
      makeCheckin(goal.id, '2026-03-12', 20, { isBackfill: true, createdAt: `${TODAY}T21:00:00.000Z` }),
    ]
    const r = predictCompletion(goal, withBackfill, TODAY)
    expect(r.status).toBe('active')
    expect(r.activeDays).toBe(3)
    // speed = 60/7，remaining 40 → 5 天
    expect(r.projectedDate).toBe('2026-03-19')
  })

  it('窗口内总量为 0（不可能但防御）不产生推算', () => {
    const goal = makeGoal({ totalAmount: 100, startDate: '2026-03-01', deadline: '2026-04-15' })
    const r = predictCompletion(goal, [], TODAY)
    expect(r.status).toBe('insufficient')
  })
})
