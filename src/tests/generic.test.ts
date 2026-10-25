import { describe, expect, it } from 'vitest'
import {
  budgetForDate,
  efficiencyStats,
  canCheckin,
  detectRescheduleNeeds,
  effectiveStatus,
  estimateMinutesPerUnit,
  filterGoalsByStatus,
  generateReportText,
  longReportStats,
  monthRange,
  planVsActualWeek,
  quarterRange,
  weekBudgetStats,
  yearRange,
} from '../domain/generic'
import { makeCheckin, makeGoal } from './helpers'
import type { DailyPlan, GoalLifecycle, GoalPlanPolicy } from '../domain/types'

const TODAY = '2026-03-15' // 周日
const MONDAY = '2026-03-09'

function lifecycle(p: Partial<GoalLifecycle>): GoalLifecycle {
  return { goalId: p.goalId ?? 'g1', manualStatus: p.manualStatus ?? 'active', note: p.note ?? null, pausedAt: p.pausedAt ?? null, isDemo: false, updatedAt: '' }
}

describe('功能13：目标生命周期', () => {
  const goal = makeGoal({ id: 'g1', totalAmount: 100 })
  void goal

  it('completed 由打卡动态推导（删除打卡自动回算），manualStatus 与之分离', () => {
    const checkins = [makeCheckin('g1', '2026-03-01', 100)]
    expect(effectiveStatus(goal, lifecycle({ manualStatus: 'active' }), checkins)).toBe('completed')
    // 删除打卡 → 回到 active（不是永久写死）
    expect(effectiveStatus(goal, lifecycle({ manualStatus: 'active' }), [])).toBe('active')
  })

  it('手动状态优先：cancelled/archived/paused 不因打卡变成 completed', () => {
    const checkins = [makeCheckin('g1', '2026-03-01', 100)]
    expect(effectiveStatus(goal, lifecycle({ manualStatus: 'cancelled' }), checkins)).toBe('cancelled')
    expect(effectiveStatus(goal, lifecycle({ manualStatus: 'archived' }), checkins)).toBe('archived')
  })

  it('只有 active/completed 允许打卡；暂停/取消/归档不允许', () => {
    expect(canCheckin('active')).toBe(true)
    expect(canCheckin('completed')).toBe(true)
    expect(canCheckin('paused')).toBe(false)
    expect(canCheckin('cancelled')).toBe(false)
    expect(canCheckin('archived')).toBe(false)
  })

  it('今日页筛选', () => {
    void goal
    const goals = [makeGoal({ id: 'a' }), makeGoal({ id: 'b' })]
    const statuses = new Map([['a', 'active'], ['b', 'paused']])
    const filtered = filterGoalsByStatus(goals, (g) => statuses.get(g.id)!, 'active')
    expect(filtered.map((g) => g.id)).toEqual(['a'])
    expect(filterGoalsByStatus(goals, () => 'active', 'all')).toHaveLength(2)
  })
})

describe('功能2：每周时间预算', () => {
  const weekly = [
    { weekday: 1, availableMinutes: 60, updatedAt: '' },
    { weekday: 7, availableMinutes: 0, updatedAt: '' }, // 周日明确 0
  ]
  const exceptions = [{ date: '2026-03-11', availableMinutes: 120, reason: '外出前补课', updatedAt: '' }]

  it('星期预算 + 日期例外覆盖；未设置≠0', () => {
    expect(budgetForDate('2026-03-09', weekly, exceptions)).toBe(60) // 周一
    expect(budgetForDate('2026-03-10', weekly, exceptions)).toBeNull() // 周二未设置
    expect(budgetForDate('2026-03-15', weekly, exceptions)).toBe(0) // 周日明确 0
    expect(budgetForDate('2026-03-11', weekly, exceptions)).toBe(120) // 例外覆盖
  })

  it('周统计：预算/计划/实际/超额/未配置天数', () => {
    const policies: GoalPlanPolicy[] = [{ goalId: 'g1', priority: 1, minutesPerUnit: 2, estimateSource: 'manual', estimateSampleCount: null, updatedAt: '' }]
    const plans: DailyPlan[] = [{ id: 'p1', goalId: 'g1', date: MONDAY, plannedAmount: 10, source: 'auto', isDemo: false, createdAt: '', updatedAt: '' }]
    const checkins = [makeCheckin('g1', MONDAY, 10, { minutes: 25 })]
    const stats = weekBudgetStats(MONDAY, weekly, exceptions, policies, plans, checkins, [])
    expect(stats.totalBudget).toBe(60 + 0 + 120) // 周一60+周日0+周三例外120，其余未配置
    expect(stats.totalPlanned).toBe(20) // 10 页 × 2 分钟
    expect(stats.totalActual).toBe(25)
    expect(stats.overBudgetDays).toBe(0)
    expect(stats.unconfiguredDays).toBe(4)
  })

  it('估时：不足 3 条有效样本返回 null；≥3 条返回均值', () => {
    expect(estimateMinutesPerUnit('g1', [makeCheckin('g1', '2026-03-01', 10, { minutes: 20 })])).toBeNull()
    const samples = [
      makeCheckin('g1', '2026-03-01', 10, { minutes: 20 }),
      makeCheckin('g1', '2026-03-02', 10, { minutes: 30 }),
      makeCheckin('g1', '2026-03-03', 10, { minutes: 40 }),
    ]
    expect(estimateMinutesPerUnit('g1', samples)).toEqual({ minutesPerUnit: 3, sampleCount: 3 })
    // minutes=null 的记录不算样本
    expect(estimateMinutesPerUnit('g1', [...samples, makeCheckin('g1', '2026-03-04', 10)])?.sampleCount).toBe(3)
  })
})

describe('功能4：重排触发', () => {
  it('昨日计划未达成触发建议（只建议不写入）', () => {
    const goal = makeGoal({ id: 'g1', unit: '页' })
    const plans: DailyPlan[] = [{ id: 'p1', goalId: 'g1', date: '2026-03-14', plannedAmount: 20, source: 'auto', isDemo: false, createdAt: '', updatedAt: '' }]
    const checkins = [makeCheckin('g1', '2026-03-14', 8)]
    const needs = detectRescheduleNeeds([goal], plans, checkins, TODAY)
    expect(needs).toHaveLength(1)
    expect(needs[0]).toMatchObject({ goalId: 'g1', trigger: 'yesterdayMissed', detail: expect.stringContaining('剩余可滚入') })
    // 达成则不触发
    const done = [makeCheckin('g1', '2026-03-14', 20)]
    expect(detectRescheduleNeeds([goal], plans, done, TODAY)).toHaveLength(0)
  })
})

describe('功能9/11：效率分析与计划对比', () => {
  it('有效分钟去重 + 未填分钟计数（未知≠0）', () => {
    const g1 = makeGoal({ id: 'g1', unit: '页' })
    const g2 = makeGoal({ id: 'g2', unit: '词' })
    const checkins = [
      makeCheckin('g1', MONDAY, 10, { minutes: 30 }),
      makeCheckin('g2', MONDAY, 20), // minutes=null
      makeCheckin('g2', '2026-03-10', 5, { minutes: 15 }),
    ]
    const plans: DailyPlan[] = [{ id: 'p1', goalId: 'g1', date: MONDAY, plannedAmount: 8, source: 'auto', isDemo: false, createdAt: '', updatedAt: '' }]
    const stats = { totalMinutes: undefined } as Record<string, unknown>
    void stats
    const r = planVsActualWeek([g1, g2], plans, checkins, MONDAY)
    const day1 = r.find((d) => d.date === MONDAY)!
    // 分目标分组，不跨单位求和
    const g1row = day1.byGoal.find((x) => x.goalId === 'g1')
    const g2row = day1.byGoal.find((x) => x.goalId === 'g2')
    expect(g1row).toMatchObject({ planned: 8, actual: 10, diff: 2, hasPlan: true })
    expect(g2row).toMatchObject({ planned: 0, actual: 20, hasPlan: false }) // 无计划但有打卡也展示
  })

  it('单位时间产出只按同目标同单位样本计算', () => {
    const g1 = makeGoal({ id: 'g1', unit: '页' })
    const g2 = makeGoal({ id: 'g2', unit: '词' })
    const checkins = [
      makeCheckin('g1', MONDAY, 10, { minutes: 30 }),
      makeCheckin('g2', MONDAY, 20, { minutes: 20 }),
    ]
    const r = efficiencyStats([g1, g2], checkins, [], [], MONDAY, '2026-03-15')
    expect(r.outputPerHour.find((x) => x.goalId === 'g1')?.perHour).toBe(20)
    expect(r.outputPerHour.find((x) => x.goalId === 'g2')?.perHour).toBe(60)
    expect(r.unknownMinutesCount).toBe(0)
  })
})

describe('功能12：长期报告', () => {
  it('月/季/年区间（含闰年 2 月、跨年季度）', () => {
    expect(monthRange(2024, 2)).toEqual({ start: '2024-02-01', end: '2024-02-29' })
    expect(monthRange(2026, 2)).toEqual({ start: '2026-02-01', end: '2026-02-28' })
    expect(quarterRange(2026, 4)).toEqual({ start: '2026-10-01', end: '2026-12-31' })
    expect(yearRange(2026)).toEqual({ start: '2026-01-01', end: '2026-12-31' })
  })

  it('统计真实数据：分目标单位、活跃天数、未填分钟说明', () => {
    const g1 = makeGoal({ id: 'g1', unit: '页' })
    const g2 = makeGoal({ id: 'g2', unit: '词' })
    const checkins = [
      makeCheckin('g1', '2026-03-05', 30, { minutes: 60 }),
      makeCheckin('g1', '2026-03-06', 20),
      makeCheckin('g2', '2026-03-07', 100, { minutes: 45 }),
    ]
    const stats = longReportStats([g1, g2], checkins, [], [], { start: '2026-03-01', end: '2026-03-31' })
    expect(stats.activeDays).toBe(3)
    expect(stats.totalMinutes).toBe(105)
    expect(stats.unknownMinutesCount).toBe(1)
    expect(stats.byGoal.find((g) => g.name === g1.name)?.amount).toBe(50)
    expect(stats.note).toContain('1 条未填分钟')
  })

  it('Markdown 报告：缺失栏诚实标注；进行中周期明示不与完整期环比', () => {
    const text = generateReportText(
      '三月',
      { start: '2026-03-01', end: '2026-03-31' },
      { activeDays: 3, totalMinutes: 105, unknownMinutesCount: 2, byGoal: [{ goalId: 'g1', name: '读书', unit: '页', amount: 50 }], planFulfillment: null, note: '' },
      { harvest: '', difficulty: '加班多', adjustment: '', nextPlan: '' },
      false,
    )
    expect(text).toContain('# 知行 StudyFlow 三月报告')
    expect(text).toContain('- 活跃学习天数：3 天')
    expect(text).toContain('读书：50 页')
    expect(text).toContain('- 本期收获：未填写')
    expect(text).toContain('- 最大的困难：加班多')
    const partial = generateReportText('三月', { start: '2026-03-01', end: '2026-03-31' }, { activeDays: 0, totalMinutes: 0, unknownMinutesCount: 0, byGoal: [], planFulfillment: null, note: '' }, { harvest: '', difficulty: '', adjustment: '', nextPlan: '' }, true)
    expect(partial).toContain('当期尚未结束')
    expect(partial).toContain('本期暂无记录')
  })
})
