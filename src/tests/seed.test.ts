import { describe, expect, it } from 'vitest'
import { buildSeedData } from '../storage/seed'
import { addDays } from '../domain/dates'
import { checkinsOfGoal, computeGoalProgress } from '../domain/progress'
import { getYesterdayMissedState } from '../domain/streak'
import type { Goal } from '../domain/types'

/** 种子数据使用相对日期生成；对状态（黄卡/红卡）做「可能退化」的诚实断言（昨日为周一时红卡不可构造）。 */
describe('首次启动种子数据', () => {
  const today = '2026-10-25'
  const yesterday = addDays(today, -1)
  const seed = buildSeedData(today)

  it('三个演示目标，全部标记 isDemo', () => {
    expect(seed.goals).toHaveLength(3)
    expect(seed.goals.every((g) => g.isDemo)).toBe(true)
    expect(seed.checkins.every((c) => c.isDemo)).toBe(true)
    expect(seed.checkins.length).toBeGreaterThan(10)
  })

  it('演示记录日期都在目标区间内且不含今天/未来', () => {
    for (const g of seed.goals) {
      for (const c of checkinsOfGoal(seed.checkins, g.id)) {
        expect(c.date >= g.startDate).toBe(true)
        expect(c.date <= yesterday).toBe(true)
      }
    }
  })

  it('存在补记记录：isBackfill=true 且在最近 6 天内', () => {
    const backfills = seed.checkins.filter((c) => c.isBackfill)
    expect(backfills.length).toBeGreaterThanOrEqual(2)
    for (const c of backfills) {
      expect(c.date <= yesterday).toBe(true)
      expect(c.date >= addDays(today, -6)).toBe(true)
      expect(c.createdAt.slice(0, 10)).not.toBe(c.date) // 录入时间晚于归属日期
    }
  })

  it('分钟数混合填写：既有明确填写也有留空（null）', () => {
    expect(seed.checkins.some((c) => c.minutes !== null)).toBe(true)
    expect(seed.checkins.some((c) => c.minutes === null)).toBe(true)
  })

  it('四 Tab 首开即有可测试状态：目标2 呈现宽免（黄卡），目标3 呈现中断或宽免', () => {
    const g2 = seed.goals.find((g) => g.name.includes('人类简史')) as Goal
    const g3 = seed.goals.find((g) => g.name.includes('Python')) as Goal
    const s2 = getYesterdayMissedState(g2, checkinsOfGoal(seed.checkins, g2.id), today)
    expect(s2.level).toBe('forgiven')
    const s3 = getYesterdayMissedState(g3, checkinsOfGoal(seed.checkins, g3.id), today)
    expect(['broken', 'forgiven']).toContain(s3.level)
    if (s3.level === 'broken') {
      // 中断必有同周更早的缺卡（宽免额度被更早的一天占用）
      expect(s3.description).toContain('中断')
    }
  })

  it('没有一个演示目标已经完成（保持进行中的真实状态）', () => {
    for (const g of seed.goals) {
      expect(computeGoalProgress(g, checkinsOfGoal(seed.checkins, g.id)).isCompleted).toBe(false)
    }
  })
})
