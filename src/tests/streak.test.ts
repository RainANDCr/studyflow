import { describe, expect, it } from 'vitest'
import { calculateStreak, getWeeklyRestState, getYesterdayMissedState } from '../domain/streak'
import { makeCheckin, makeGoal } from './helpers'

// 2026-03 日历：03-02 周一，03-08 周日，03-09 周一，03-14 周六，03-15 周日，03-16 周一
const TODAY = '2026-03-15'

function days(from: string, to: string, skip: string[] = []): string[] {
  const out: string[] = []
  let d = from
  let guard = 0
  while (d <= to && guard++ < 400) {
    if (!skip.includes(d)) out.push(d)
    const [y, m, day] = d.split('-').map(Number)
    const next = new Date(y, m - 1, day + 1)
    d = `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}-${String(next.getDate()).padStart(2, '0')}`
  }
  return out
}

describe('每周弹性休息日与连续打卡', () => {
  it('连续打卡：昨天有打卡、今天未打卡 → 从昨天回溯', () => {
    const goal = makeGoal({ startDate: '2026-03-01', totalAmount: 1000 })
    const checkins = days('2026-03-08', '2026-03-14').map((d) => makeCheckin(goal.id, d, 20))
    const s = calculateStreak(goal, checkins, TODAY)
    expect(s).toEqual({ current: 7, includesToday: false })
  })

  it('今天已有打卡则包含今天', () => {
    const goal = makeGoal({ startDate: '2026-03-01', totalAmount: 1000 })
    const checkins = days('2026-03-09', TODAY).map((d) => makeCheckin(goal.id, d, 20))
    const s = calculateStreak(goal, checkins, TODAY)
    expect(s).toEqual({ current: 7, includesToday: true })
  })

  it('今天尚未结束：今天没有打卡不算漏打卡，不打断连续', () => {
    const goal = makeGoal({ startDate: '2026-03-01', totalAmount: 1000 })
    const checkins = days('2026-03-13', '2026-03-14').map((d) => makeCheckin(goal.id, d, 20))
    const s = calculateStreak(goal, checkins, TODAY)
    expect(s.current).toBe(2)
    expect(getYesterdayMissedState(goal, checkins, TODAY).level).toBe('none')
  })

  it('每周首个缺卡日被宽免（黄卡），连续不断', () => {
    const goal = makeGoal({ startDate: '2026-03-01', totalAmount: 1000 })
    // 本周（03-09 起）周一到周五打卡，周六（03-14，昨天）缺卡
    const checkins = days('2026-03-09', '2026-03-13').map((d) => makeCheckin(goal.id, d, 20))
    const state = getYesterdayMissedState(goal, checkins, TODAY)
    expect(state.level).toBe('forgiven')
    const s = calculateStreak(goal, checkins, TODAY)
    // 03-14（宽免）+ 03-09..03-13 = 6 天
    expect(s.current).toBe(6)
    const week = getWeeklyRestState(goal, checkins, '2026-03-09', TODAY)
    expect(week.restDate).toBe('2026-03-14')
    expect(week.brokenByMiss).toBeNull()
  })

  it('同周第二个缺卡日打断连续（红卡）', () => {
    const goal = makeGoal({ startDate: '2026-03-01', totalAmount: 1000 })
    // 周五 03-13 与周六 03-14（昨天）都缺卡
    const checkins = days('2026-03-09', '2026-03-12').map((d) => makeCheckin(goal.id, d, 20))
    const state = getYesterdayMissedState(goal, checkins, TODAY)
    expect(state.level).toBe('broken')
    expect(state.rollIntoToday).toBe(1000 - 80)
    expect(calculateStreak(goal, checkins, TODAY).current).toBe(0)
    const week = getWeeklyRestState(goal, checkins, '2026-03-09', TODAY)
    expect(week.restDate).toBe('2026-03-13')
    expect(week.brokenByMiss).toBe('2026-03-14')
  })

  it('每周额度独立不累计：两周各缺 1 天都被宽免', () => {
    const goal = makeGoal({ startDate: '2026-03-02', totalAmount: 5000 })
    // 上周缺周三（03-04），本周缺周五（03-13），其余全打卡
    const checkins = days('2026-03-02', '2026-03-14', ['2026-03-04', '2026-03-13']).map((d) =>
      makeCheckin(goal.id, d, 20),
    )
    const s = calculateStreak(goal, checkins, TODAY)
    // 03-02..03-14 共 13 天全部有效（2 天用宽免）
    expect(s.current).toBe(13)
    expect(getWeeklyRestState(goal, checkins, '2026-03-02', TODAY).restDate).toBe('2026-03-04')
    expect(getWeeklyRestState(goal, checkins, '2026-03-09', TODAY).restDate).toBe('2026-03-13')
  })

  it('休息日属于昨天所在的自然周：今天周一、昨天周日缺卡是上周的额度', () => {
    const monday = '2026-03-16'
    const goal = makeGoal({ startDate: '2026-03-02', totalAmount: 5000 })
    // 03-09..03-14 打卡，03-15（周日，昨天）缺卡，今天 03-16 周一未打卡
    const checkins = days('2026-03-09', '2026-03-14').map((d) => makeCheckin(goal.id, d, 20))
    const state = getYesterdayMissedState(goal, checkins, monday)
    expect(state.level).toBe('forgiven')
    expect(calculateStreak(goal, checkins, monday).current).toBe(7)
  })

  it('未启用每周休息日：任何缺卡都直接中断', () => {
    const goal = makeGoal({ startDate: '2026-03-01', totalAmount: 1000, weeklyRestEnabled: false })
    const checkins = days('2026-03-09', '2026-03-13').map((d) => makeCheckin(goal.id, d, 20))
    expect(getYesterdayMissedState(goal, checkins, TODAY).level).toBe('broken')
    expect(calculateStreak(goal, checkins, TODAY).current).toBe(0)
  })

  it('补记纠正历史：补上缺卡日后从 broken 变 forgiven、连续恢复', () => {
    const goal = makeGoal({ startDate: '2026-03-01', totalAmount: 1000 })
    const base = days('2026-03-09', '2026-03-12').map((d) => makeCheckin(goal.id, d, 20))
    expect(getYesterdayMissedState(goal, base, TODAY).level).toBe('broken')
    // 补记 03-13（周五）后，昨天 03-14 成为本周首个缺卡 → 宽免
    const fixed = [...base, makeCheckin(goal.id, '2026-03-13', 20, { isBackfill: true })]
    expect(getYesterdayMissedState(goal, fixed, TODAY).level).toBe('forgiven')
    expect(calculateStreak(goal, fixed, TODAY).current).toBe(6)
  })

  it('删除记录后重新推算：连续天数立即回退', () => {
    const goal = makeGoal({ startDate: '2026-03-01', totalAmount: 1000 })
    const all = days('2026-03-09', '2026-03-14').map((d) => makeCheckin(goal.id, d, 20))
    expect(calculateStreak(goal, all, TODAY).current).toBe(6)
    // 删除周三与周四两条 → 本周出现两个缺卡日，宽免只吸收第一个，连续在 03-13 打断
    const removed = all.filter((c) => c.date !== '2026-03-12' && c.date !== '2026-03-13')
    expect(calculateStreak(goal, removed, TODAY).current).toBe(1) // 只剩 03-14（昨天）
    const week = getWeeklyRestState(goal, removed, '2026-03-09', TODAY)
    expect(week.restDate).toBe('2026-03-12')
    expect(week.brokenByMiss).toBe('2026-03-13')
  })

  it('计算不早于目标开始日：开始前不算缺卡', () => {
    const goal = makeGoal({ startDate: '2026-03-12', totalAmount: 100 })
    const checkins = [makeCheckin(goal.id, '2026-03-12', 10), makeCheckin(goal.id, '2026-03-13', 10)]
    // 昨日 03-14 缺卡 → 本周首个 → 宽免；03-12 前的天数不参与
    const s = calculateStreak(goal, checkins, TODAY)
    expect(s.current).toBe(3) // 03-12、03-13、03-14（宽免）
    expect(getYesterdayMissedState(goal, checkins, TODAY).level).toBe('forgiven')
  })

  it('已完成目标不再制造新的漏卡', () => {
    const goal = makeGoal({ startDate: '2026-03-01', totalAmount: 40 })
    const checkins = days('2026-03-08', '2026-03-09').map((d) => makeCheckin(goal.id, d, 20))
    // 03-09 完成；03-10 之后都没打卡也不算漏卡
    const state = getYesterdayMissedState(goal, checkins, TODAY)
    expect(state.level).toBe('notTracked')
    // 连续序列冻结在完成日
    expect(calculateStreak(goal, checkins, TODAY).current).toBe(2)
  })

  it('周跨月/跨年：2025-12-29 周与 2026-01-05 周各自宽免', () => {
    const goal = makeGoal({ startDate: '2025-12-29', totalAmount: 5000 })
    // 第 1 周缺 12-31，第 2 周缺 01-06，其余打卡到 01-10（周六），today = 01-11 周日
    const checkins = days('2025-12-29', '2026-01-10', ['2025-12-31', '2026-01-06']).map((d) =>
      makeCheckin(goal.id, d, 20),
    )
    expect(getWeeklyRestState(goal, checkins, '2025-12-29', '2026-01-11').restDate).toBe('2025-12-31')
    expect(getWeeklyRestState(goal, checkins, '2026-01-05', '2026-01-11').restDate).toBe('2026-01-06')
    expect(calculateStreak(goal, checkins, '2026-01-11').current).toBe(13) // 12-29..01-10 全部有效
  })
})
