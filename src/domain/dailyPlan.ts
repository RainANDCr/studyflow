import type { Checkin, DailyPlan, DateStr, Goal, StudyCalendarPreference } from './types'
import { addDays, dayOfWeekMon1, diffDays, rangeDays } from './dates'
import { sumAmountOnDate } from './progress'

/**
 * 学习日历自动分配引擎（纯函数）。
 *
 * 口径约束：
 * - 剩余量 = max(0, 总量 - Σ有效打卡)，从「今天」起分摊到截止日（含当日）；
 * - 只在今日及以后生成/更新 auto 计划，绝不篡改历史计划或历史打卡；
 * - source='manual' 是用户锁定项，自动重排永不覆盖；
 * - 整数单位用商/余数保证每天之和恰等于剩余量；小数单位用 2 位精度、最后一天吸收尾差；
 * - 「每周弹性休息日」与这里的 studyWeekdays/excludedDates 是两套独立规则，互不读写。
 */

export const DEFAULT_STUDY_WEEKDAYS = [1, 2, 3, 4, 5, 6, 7]

export function normalizePrefs(prefs: StudyCalendarPreference | null): StudyCalendarPreference {
  return {
    goalId: prefs?.goalId ?? '',
    studyWeekdays: prefs?.studyWeekdays?.length ? prefs.studyWeekdays : DEFAULT_STUDY_WEEKDAYS,
    excludedDates: prefs?.excludedDates ?? [],
    dailyCap: prefs?.dailyCap ?? null,
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

export type AutoScheduleResult =
  | { kind: 'ok'; plans: Array<Omit<DailyPlan, 'id' | 'createdAt' | 'updatedAt' | 'isDemo'>>; studyDayCount: number }
  | { kind: 'completed' }
  | { kind: 'overdue'; overdueDays: number; remaining: number }
  | { kind: 'noStudyDays'; from: DateStr; to: DateStr }
  | { kind: 'capacity'; requiredPerDay: number; cap: number; studyDayCount: number }

/**
 * 商/余数分配。整数：前 rem 天每天 base+1，其余 base，总和恰等于 remaining。
 * 小数：每天 round2(remaining/n)，最后一天 = remaining - 前面之和（吸收尾差）。
 */
export function distributeRemaining(
  goal: Goal,
  prefs: StudyCalendarPreference | null,
  checkins: Checkin[],
  today: DateStr,
): AutoScheduleResult {
  const p = normalizePrefs(prefs)
  const done = checkins.filter((c) => c.goalId === goal.id).reduce((s, c) => s + c.amount, 0)
  const remaining = Math.max(0, round2(goal.totalAmount - done))
  if (remaining <= 0) return { kind: 'completed' }
  if (today > goal.deadline) {
    return { kind: 'overdue', overdueDays: diffDays(today, goal.deadline), remaining }
  }
  const start = today < goal.startDate ? goal.startDate : today
  const allDays = rangeDays(start, goal.deadline)
  const studyDays = allDays.filter(
    (d) => p.studyWeekdays.includes(dayOfWeekMon1(d)) && !p.excludedDates.includes(d),
  )
  if (studyDays.length === 0) {
    return { kind: 'noStudyDays', from: start, to: goal.deadline }
  }
  const isInteger = Number.isInteger(remaining)
  const plans = studyDays.map((date, i) => {
    if (isInteger) {
      const base = Math.floor(remaining / studyDays.length)
      const rem = remaining % studyDays.length
      return { goalId: goal.id, date, plannedAmount: base + (i < rem ? 1 : 0), source: 'auto' as const }
    }
    const per = i < studyDays.length - 1 ? round2(remaining / studyDays.length) : round2(remaining - round2(remaining / studyDays.length) * (studyDays.length - 1))
    return { goalId: goal.id, date, plannedAmount: per, source: 'auto' as const }
  })
  const maxPerDay = Math.max(...plans.map((pl) => pl.plannedAmount))
  if (p.dailyCap !== null && maxPerDay > p.dailyCap) {
    return {
      kind: 'capacity',
      requiredPerDay: isInteger ? Math.ceil(remaining / studyDays.length) : round2(remaining / studyDays.length),
      cap: p.dailyCap,
      studyDayCount: studyDays.length,
    }
  }
  return { kind: 'ok', plans, studyDayCount: studyDays.length }
}

export interface ReschedulePreview {
  /** 将写入的（含新增与修改；manual 同日优先时不生成） */
  upserts: Array<Omit<DailyPlan, 'id' | 'createdAt' | 'updatedAt' | 'isDemo'>>
  /** 将删除的既有 auto 计划 id（新方案未覆盖的未来日期） */
  removals: Array<{ id: string; date: DateStr; plannedAmount: number }>
  /** 保持不变的数量 */
  unchanged: number
  /** 被手动计划占用的日期数（自动项让位） */
  manualKept: number
}

/**
 * 重新自动排程预览：只重排今日及以后的 auto 项。
 * 同日存在 manual 计划 → 该日让位给 manual（不入 upserts）。
 * 历史日期（< today）一律不动。
 */
export function buildReschedulePreview(
  goalId: string,
  existingPlans: DailyPlan[],
  fresh: Array<{ date: DateStr; plannedAmount: number }>,
  today: DateStr,
): ReschedulePreview {
  const future = existingPlans.filter((pl) => pl.date >= today)
  const manualByDate = new Map(future.filter((pl) => pl.source === 'manual').map((pl) => [pl.date, pl]))
  const freshByDate = new Map(fresh.map((f) => [f.date, f]))
  const upserts: ReschedulePreview['upserts'] = []
  let unchanged = 0
  let manualKept = 0
  for (const [date, f] of freshByDate) {
    const manual = manualByDate.get(date)
    if (manual) {
      manualKept++
      continue
    }
    const old = future.find((pl) => pl.date === date && pl.source === 'auto')
    if (old && old.plannedAmount === f.plannedAmount) {
      unchanged++
      continue
    }
    upserts.push({ goalId, date, plannedAmount: f.plannedAmount, source: 'auto' })
  }
  const removals = future
    .filter((pl) => pl.source === 'auto' && !freshByDate.has(pl.date))
    .map((pl) => ({ id: pl.id, date: pl.date, plannedAmount: pl.plannedAmount }))
  return { upserts, removals, unchanged, manualKept }
}

export interface DayPlanStatus {
  date: DateStr
  /** 该日计划总量（无计划为 0） */
  planned: number
  /** 该日实际打卡总量 */
  actual: number
  /** 计划条目（含每目标拆分） */
  items: Array<{ plan: DailyPlan; goal: Goal; actual: number }>
  /** 涉及的目标（含当天只有打卡没有计划的目标） */
  goals: Goal[]
}

/** 某日「计划 X / 实际 Y」状态；实际只由 Checkin 聚合，绝不把计划当完成。 */
export function getDayPlanStatus(
  date: DateStr,
  goals: Goal[],
  plans: DailyPlan[],
  checkins: Checkin[],
): DayPlanStatus {
  const goalById = new Map(goals.map((g) => [g.id, g]))
  const dayPlans = plans.filter((p) => p.date === date)
  const items: DayPlanStatus['items'] = []
  const goalSet = new Set<string>()
  for (const plan of dayPlans) {
    const goal = goalById.get(plan.goalId)
    if (!goal) continue
    items.push({ plan, goal, actual: sumAmountOnDate(checkins.filter((c) => c.goalId === plan.goalId), date) })
    goalSet.add(plan.goalId)
  }
  // 当天只有打卡（无计划）的目标也列出，便于对比
  for (const c of checkins.filter((x) => x.date === date)) {
    goalSet.add(c.goalId)
  }
  return {
    date,
    planned: items.reduce((s, i) => s + i.plan.plannedAmount, 0),
    actual: checkins.filter((c) => c.date === date).reduce((s, c) => s + c.amount, 0),
    items,
    goals: [...goalSet].map((id) => goalById.get(id)).filter((g): g is Goal => !!g),
  }
}

/** 某月/某周的日历网格日期列表（周一起始）。month: 'YYYY-MM' */
export function monthGridDates(month: string): DateStr[] {
  const [y, m] = month.split('-').map(Number)
  const first = `${month}-01`
  const firstDow = dayOfWeekMon1(first)
  const gridStart = addDays(first, -(firstDow - 1))
  const daysInMonth = new Date(y, m, 0).getDate()
  const last = `${month}-${String(daysInMonth).padStart(2, '0')}`
  const lastDow = dayOfWeekMon1(last)
  const gridEnd = addDays(last, 7 - lastDow)
  return rangeDays(gridStart, gridEnd)
}
