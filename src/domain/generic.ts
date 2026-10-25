import type { AvailabilityException, Checkin, DailyPlan, DateStr, FocusSession, Goal, GoalLifecycle, GoalPlanPolicy, GoalStatusEvent, WeeklyAvailability } from './types'
import { addDays, diffDays, weekDates, rangeDays } from './dates'
import { computeGoalProgress } from './progress'
import { getEffectiveStudyMinutes } from './focus'
import { round2 } from './milestone'
import { MIN_ACTIVE_DAYS_FOR_PREDICTION } from './prediction'

/** 11 项通用功能的领域纯函数（生命周期/预算/重排/分析/对比/长期报告）。 */

/* ---------------- 功能13：目标生命周期 ---------------- */

export const MANUAL_STATUSES = ['active', 'paused', 'cancelled', 'archived'] as const

export function effectiveStatus(
  goal: Goal,
  lifecycle: GoalLifecycle | undefined,
  checkins: Checkin[],
): 'active' | 'paused' | 'cancelled' | 'archived' | 'completed' {
  const manual = lifecycle?.manualStatus ?? 'active'
  if (manual !== 'active') return manual
  // completed 是展示态：由有效打卡动态推导，删除打卡后自动回算
  if (computeGoalProgress(goal, checkins.filter((c) => c.goalId === goal.id)).isCompleted) return 'completed'
  return 'active'
}

export function canCheckin(status: ReturnType<typeof effectiveStatus>): boolean {
  return status === 'active' || status === 'completed'
}

/** 状态切换的合法转换（幂等：同状态重复设置视为 no-op） */
export function statusTransition(from: string, to: string): string | null {
  if (from === to) return 'unchanged'
  return null // 其余转换全部允许；写入层生成事件
}

export function makeStatusEvent(
  goalId: string,
  from: GoalLifecycle['manualStatus'] | 'none',
  to: GoalLifecycle['manualStatus'],
  reason: string | null,
  now: string,
): GoalStatusEvent {
  return { id: `ev-${goalId}-${now}`, goalId, from, to, reason, occurredAt: now }
}

/** 今日页筛选 */
export function filterGoalsByStatus<T>(
  goals: T[],
  statusOf: (g: T) => string,
  filter: 'active' | 'completed' | 'paused' | 'cancelled' | 'archived' | 'all',
): T[] {
  if (filter === 'all') return goals
  return goals.filter((g) => statusOf(g) === filter)
}

/* ---------------- 功能2：每周学习时间预算 ---------------- */

export function budgetForDate(
  date: DateStr,
  weekly: WeeklyAvailability[],
  exceptions: AvailabilityException[],
): number | null {
  const ex = exceptions.find((e) => e.date === date)
  if (ex) return ex.availableMinutes
  const wd = weekly.find((w) => w.weekday === dayOfWeek(date))
  return wd ? wd.availableMinutes : null
}

function dayOfWeek(date: DateStr): number {
  const [y, m, d] = date.split('-').map(Number)
  const js = new Date(y, m - 1, d).getDay()
  return js === 0 ? 7 : js
}

export interface DayBudgetStat {
  date: DateStr
  budget: number | null
  plannedMinutes: number
  actualMinutes: number
  /** 未配置=true */
  unconfigured: boolean
}

export interface WeekBudgetStats {
  days: DayBudgetStat[]
  totalBudget: number
  totalPlanned: number
  totalActual: number
  overBudgetDays: number
  unconfiguredDays: number
}

/** 本周预算统计：计划分钟来自 DailyPlan？（数量层）——这里统计「有估时的目标计划折算分钟 + 专注/打卡实际分钟」 */
export function weekBudgetStats(
  weekStart: DateStr,
  weekly: WeeklyAvailability[],
  exceptions: AvailabilityException[],
  policies: GoalPlanPolicy[],
  plans: DailyPlan[],
  checkins: Checkin[],
  sessions: FocusSession[],
): WeekBudgetStats {
  const days = weekDates(weekStart).map<DayBudgetStat>((date) => {
    const budget = budgetForDate(date, weekly, exceptions)
    // 计划分钟：仅对配置了估时的目标把 plannedAmount 折算分钟（无估时目标不计入分钟层）
    const plannedMinutes = round2(
      plans
        .filter((p) => p.date === date)
        .reduce((s, p) => {
          const policy = policies.find((x) => x.goalId === p.goalId)
          if (!policy?.minutesPerUnit) return s
          return s + p.plannedAmount * policy.minutesPerUnit
        }, 0),
    )
    const actualMinutes = getEffectiveStudyMinutes(
      checkins.filter((c) => c.date === date),
      sessions.filter((s) => s.startedAt.slice(0, 10) <= date && (s.endedAt ?? s.startedAt).slice(0, 10) >= date),
      { from: date, to: date },
    )
    return { date, budget, plannedMinutes, actualMinutes, unconfigured: budget === null }
  })
  const configured = days.filter((d) => !d.unconfigured)
  return {
    days,
    totalBudget: configured.reduce((s, d) => s + (d.budget ?? 0), 0),
    totalPlanned: round2(days.reduce((s, d) => s + d.plannedMinutes, 0)),
    totalActual: round2(days.reduce((s, d) => s + d.actualMinutes, 0)),
    overBudgetDays: days.filter((d) => d.budget !== null && d.plannedMinutes > d.budget).length,
    unconfiguredDays: days.length - configured.length,
  }
}

/** 每单位分钟的数据驱动估计：≥3 条有效配对样本（amount>0 且 minutes>0，同目标） */
export const MIN_SAMPLES_FOR_ESTIMATE = 3

export function estimateMinutesPerUnit(
  goalId: string,
  checkins: Checkin[],
): { minutesPerUnit: number; sampleCount: number } | null {
  const samples = checkins.filter((c) => c.goalId === goalId && c.amount > 0 && c.minutes !== null && c.minutes > 0)
  if (samples.length < MIN_SAMPLES_FOR_ESTIMATE) return null
  const totalMinutes = samples.reduce((s, c) => s + (c.minutes ?? 0), 0)
  const totalAmount = samples.reduce((s, c) => s + c.amount, 0)
  if (totalAmount <= 0) return null
  return { minutesPerUnit: round2(totalMinutes / totalAmount), sampleCount: samples.length }
}

/* ---------------- 功能4：自适应计划重排 ---------------- */

export type RescheduleTrigger =
  | 'yesterdayMissed'
  | 'todayOverachieved'
  | 'checkinChanged'
  | 'deadlineChanged'
  | 'lifecycleResumed'

export interface RescheduleSuggestion {
  goalId: string
  goalName: string
  trigger: RescheduleTrigger
  detail: string
}

/** 触发检测（只建议不自动写入）：昨日计划量 > 昨日实际完成量 */
export function detectRescheduleNeeds(
  goals: Goal[],
  plans: DailyPlan[],
  checkins: Checkin[],
  today: DateStr,
): RescheduleSuggestion[] {
  const out: RescheduleSuggestion[] = []
  const yesterday = addDays(today, -1)
  for (const g of goals) {
    const planned = plans
      .filter((p) => p.goalId === g.id && p.date === yesterday)
      .reduce((s, p) => s + p.plannedAmount, 0)
    if (planned <= 0) continue
    const actual = checkins.filter((c) => c.goalId === g.id && c.date === yesterday).reduce((s, c) => s + c.amount, 0)
    if (actual < planned) {
      out.push({
        goalId: g.id,
        goalName: g.name,
        trigger: 'yesterdayMissed',
        detail: `昨天计划 ${planned} ${g.unit}，实际完成 ${actual} ${g.unit}，剩余可滚入后续日期`,
      })
    }
  }
  return out
}

/** 数据驱动估时的样本阈值提示（供重排/预算 UI 标注） */
export function estimateAvailableFor(goalId: string, policies: GoalPlanPolicy[]): boolean {
  const p = policies.find((x) => x.goalId === goalId)
  return !!p?.minutesPerUnit && (p.estimateSource === 'manual' || (p.estimateSource === 'derived' && (p.estimateSampleCount ?? 0) >= MIN_SAMPLES_FOR_ESTIMATE))
}

/* ---------------- 功能9/11：效率分析与计划对比 ---------------- */

export interface EfficiencyStats {
  /** 有效投入分钟（去重口径） */
  totalMinutes: number
  /** 明确 minutes=null 的打卡条数（未知分钟，不视为 0） */
  unknownMinutesCount: number
  /** 有打卡的自然日数 */
  activeDays: number
  /** 计划兑现率：有计划的「日期-目标」组合中 实际≥计划 的占比（%）；无计划返回 null */
  planFulfillment: number | null
  plannedCombos: number
  fulfilledCombos: number
  /** 单位时间产出：同目标同单位样本的完成量/小时（按目标返回，不跨单位合并） */
  outputPerHour: Array<{ goalId: string; unit: string; perHour: number; sampleCount: number }>
}

export function efficiencyStats(
  goals: Goal[],
  checkins: Checkin[],
  sessions: FocusSession[],
  plans: DailyPlan[],
  from: DateStr,
  to: DateStr,
): EfficiencyStats {
  const inRange = (d: DateStr) => d >= from && d <= to
  const rangeCheckins = checkins.filter((c) => inRange(c.date))
  const totalMinutes = getEffectiveStudyMinutes(rangeCheckins, sessions.filter((s) => (s.endedAt ?? s.startedAt).slice(0, 10) >= from && (s.endedAt ?? s.startedAt).slice(0, 10) <= to))
  const unknownMinutesCount = rangeCheckins.filter((c) => c.minutes === null).length
  const activeDays = new Set(rangeCheckins.map((c) => c.date)).size

  let plannedCombos = 0
  let fulfilledCombos = 0
  for (const g of goals) {
    const gPlans = plans.filter((p) => p.goalId === g.id && inRange(p.date))
    for (const p of gPlans) {
      plannedCombos++
      const actual = checkins.filter((c) => c.goalId === g.id && c.date === p.date).reduce((s, c) => s + c.amount, 0)
      if (actual >= p.plannedAmount) fulfilledCombos++
    }
  }
  const planFulfillment = plannedCombos > 0 ? round2((fulfilledCombos / plannedCombos) * 100) : null

  const outputPerHour = goals
    .map((g) => {
      const samples = rangeCheckins.filter((c) => c.goalId === g.id && c.minutes !== null && c.minutes > 0 && c.amount > 0)
      if (samples.length === 0) return { goalId: g.id, unit: g.unit, perHour: 0, sampleCount: 0 }
      const minutes = samples.reduce((s, c) => s + (c.minutes ?? 0), 0)
      const amount = samples.reduce((s, c) => s + c.amount, 0)
      return { goalId: g.id, unit: g.unit, perHour: round2((amount / minutes) * 60), sampleCount: samples.length }
    })
    .filter((x) => x.sampleCount > 0)

  return { totalMinutes, unknownMinutesCount, activeDays, planFulfillment, plannedCombos, fulfilledCombos, outputPerHour }
}

export interface PlanActualDay {
  date: DateStr
  byGoal: Array<{ goalId: string; name: string; unit: string; planned: number; actual: number; diff: number; hasPlan: boolean }>
}

/** 周对比：按目标分组（绝不跨单位求和）；无计划日不计入未完成分母 */
export function planVsActualWeek(
  goals: Goal[],
  plans: DailyPlan[],
  checkins: Checkin[],
  weekStart: DateStr,
): PlanActualDay[] {
  return weekDates(weekStart).map((date) => {
    const byGoal = goals
      .map((g) => {
        const planned = plans.filter((p) => p.goalId === g.id && p.date === date).reduce((s, p) => s + p.plannedAmount, 0)
        const actual = checkins.filter((c) => c.goalId === g.id && c.date === date).reduce((s, c) => s + c.amount, 0)
        const hasPlan = plans.some((p) => p.goalId === g.id && p.date === date)
        return { goalId: g.id, name: g.name, unit: g.unit, planned, actual, diff: round2(actual - planned), hasPlan }
      })
      .filter((x) => x.hasPlan || x.actual > 0)
    return { date, byGoal }
  })
}

/* ---------------- 功能12：长期报告 ---------------- */

export interface PeriodRange {
  start: DateStr
  end: DateStr
}

export function monthRange(year: number, month: number): PeriodRange {
  const start = `${year}-${String(month).padStart(2, '0')}-01`
  const end = `${year}-${String(month).padStart(2, '0')}-${String(new Date(year, month, 0).getDate()).padStart(2, '0')}`
  return { start, end }
}

export function quarterRange(year: number, quarter: 1 | 2 | 3 | 4): PeriodRange {
  const startMonth = (quarter - 1) * 3 + 1
  const endMonth = startMonth + 2
  const [sy, sm] = [year, startMonth]
  const [ey, em] = endMonth === 12 ? [year, 12] : endMonth <= 12 ? [year, endMonth] : [year + 1, endMonth - 12]
  const start = `${sy}-${String(sm).padStart(2, '0')}-01`
  const endDay = new Date(ey, em, 0).getDate()
  const end = `${ey}-${String(em).padStart(2, '0')}-${String(endDay).padStart(2, '0')}`
  return { start, end }
}

export function yearRange(year: number): PeriodRange {
  return { start: `${year}-01-01`, end: `${year}-12-31` }
}

export interface LongReportStats {
  activeDays: number
  totalMinutes: number
  unknownMinutesCount: number
  byGoal: Array<{ goalId: string; name: string; unit: string; amount: number }>
  planFulfillment: number | null
  note: string
}

export function longReportStats(
  goals: Goal[],
  checkins: Checkin[],
  sessions: FocusSession[],
  plans: DailyPlan[],
  range: PeriodRange,
): LongReportStats {
  const eff = efficiencyStats(goals, checkins, sessions, plans, range.start, range.end)
  const byGoal = goals
    .map((g) => {
      const amount = checkins.filter((c) => c.goalId === g.id && c.date >= range.start && c.date <= range.end).reduce((s, c) => s + c.amount, 0)
      return { goalId: g.id, name: g.name, unit: g.unit, amount }
    })
    .filter((x) => x.amount > 0)
  return {
    activeDays: eff.activeDays,
    totalMinutes: eff.totalMinutes,
    unknownMinutesCount: eff.unknownMinutesCount,
    byGoal,
    planFulfillment: eff.planFulfillment,
    note:
      eff.unknownMinutesCount > 0
        ? `分钟统计仅包含明确填写的记录（${eff.unknownMinutesCount} 条未填分钟不计入，也不视为 0）`
        : '分钟统计仅包含明确填写的记录',
  }
}

/** 生成可复制的 Markdown 报告文本（真实统计，不夸大） */
export function generateReportText(
  periodLabel: string,
  range: PeriodRange,
  stats: LongReportStats,
  freeText: { harvest: string; difficulty: string; adjustment: string; nextPlan: string },
  isPartial: boolean,
): string {
  const lines: string[] = []
  lines.push(`# 知行 StudyFlow ${periodLabel}报告（${range.start} ~ ${range.end}${isPartial ? '，当期未结束' : ''}）`)
  lines.push('')
  lines.push(`- 活跃学习天数：${stats.activeDays} 天`)
  lines.push(`- 有效投入分钟：${stats.totalMinutes} 分钟（${stats.note}）`)
  lines.push(`- 计划兑现率：${stats.planFulfillment === null ? '无计划数据' : `${stats.planFulfillment}%`}`)
  if (stats.byGoal.length > 0) {
    lines.push('- 各目标完成量：')
    for (const g of stats.byGoal) lines.push(`  - ${g.name}：${g.amount} ${g.unit}`)
  } else {
    lines.push('- 各目标完成量：本期暂无记录')
  }
  lines.push('')
  lines.push('## 复盘')
  lines.push(`- 本期收获：${freeText.harvest.trim() || '未填写'}`)
  lines.push(`- 最大的困难：${freeText.difficulty.trim() || '未填写'}`)
  lines.push(`- 调整方法：${freeText.adjustment.trim() || '未填写'}`)
  lines.push(`- 下一期计划：${freeText.nextPlan.trim() || '未填写'}`)
  if (isPartial) lines.push('')
  lines.push(isPartial ? '> 当期尚未结束，以上为截至目前的累计，不与完整前期直接环比。' : '')
  return lines.filter((l) => l !== '').join('\n')
}

export { diffDays, rangeDays, MIN_ACTIVE_DAYS_FOR_PREDICTION }
