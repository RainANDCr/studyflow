import type { Checkin, DateStr, Goal, StudyCalendarPreference } from './types'
import { addDays, dayOfWeekMon1, diffDays, parseDate, rangeDays, toDateStr } from './dates'
import { normalizePrefs } from './dailyPlan'
import { predictCompletion } from './prediction'
import { round2 } from './milestone'

/**
 * 计划模拟器（纯函数）：调整假设条件观察完成日变化。
 * - 只做沙盘推演：结果绝不写 Checkin、不改 Goal.deadline；「应用到计划」由 UI 层
 *   经 buildReschedulePreview + 事务写 DailyPlan（且仅未来日期）。
 * - 「模拟完成日」来自用户假设；「预计完成日」（predictCompletion）来自近 7 天真实
 *   速度——两者严格区分标签，绝不混淆。
 * - 内部 O(天数) 迭代，maxDays 上限防卡死；绝不输出 NaN/Infinity/Invalid Date。
 */

export const MAX_SIMULATE_DAYS = 3650 // 10 年上限

export interface SimulationParams {
  /** 每个学习日计划完成量（>0，按目标单位） */
  perDayAmount: number
  /** 学习星期（1=周一…7=周日） */
  studyWeekdays: number[]
  /** 排除日期 */
  excludedDates: DateStr[]
  /** 起始日（默认今天） */
  from: DateStr
}

export interface SimulationResult {
  status: 'ok' | 'noStudyDays' | 'invalidParams' | 'truncated'
  /** 模拟完成日（ok 时存在；truncated 时为 null） */
  completionDate: DateStr | null
  /** 用掉的学习日数 */
  studyDaysUsed: number
  /** 实际迭代的天数（供 UI 显示范围） */
  lastConsideredDate: DateStr | null
  /** 每个学习日的假设计划量（用于应用到日历） */
  perDateAmounts: Array<{ date: DateStr; amount: number }>
}

function isStudyDay(d: DateStr, weekdays: number[], excluded: Set<DateStr>): boolean {
  return weekdays.includes(dayOfWeekMon1(d)) && !excluded.has(d)
}

export function simulate(
  remaining: number,
  params: SimulationParams,
  maxDays = MAX_SIMULATE_DAYS,
): SimulationResult {
  const empty: SimulationResult = { status: 'ok', completionDate: null, studyDaysUsed: 0, lastConsideredDate: null, perDateAmounts: [] }
  if (!Number.isFinite(remaining) || remaining < 0) return { ...empty, status: 'invalidParams' }
  if (!Number.isFinite(params.perDayAmount) || params.perDayAmount <= 0) return { ...empty, status: 'invalidParams' }
  if (remaining === 0) return { ...empty, completionDate: params.from } // 已完成
  const weekdays = params.studyWeekdays.length ? params.studyWeekdays : [1, 2, 3, 4, 5, 6, 7]
  const excluded = new Set(params.excludedDates)

  let acc = 0
  let studyDaysUsed = 0
  const perDateAmounts: Array<{ date: DateStr; amount: number }> = []
  let d = params.from
  for (let i = 0; i < maxDays; i++) {
    if (isStudyDay(d, weekdays, excluded)) {
      studyDaysUsed++
      const amount = Math.min(params.perDayAmount, round2(remaining - acc))
      acc = round2(acc + amount)
      perDateAmounts.push({ date: d, amount })
      if (acc >= remaining) {
        return { status: 'ok', completionDate: d, studyDaysUsed, lastConsideredDate: d, perDateAmounts }
      }
    }
    d = addDays(d, 1)
  }
  return { status: 'truncated', completionDate: null, studyDaysUsed, lastConsideredDate: addDays(params.from, maxDays - 1), perDateAmounts }
}

/** 达到截止日所需的每学习日最低量（按假设的学习星期/排除日）；无可学习日返回 null */
export function minRequiredPerDay(
  remaining: number,
  deadline: DateStr,
  prefs: StudyCalendarPreference | null,
  today: DateStr,
): { perDay: number; studyDayCount: number } | null {
  if (remaining <= 0) return { perDay: 0, studyDayCount: 0 }
  const p = normalizePrefs(prefs)
  const start = today < deadline ? today : deadline
  const studyDays = rangeDays(start, deadline).filter((d) => isStudyDay(d, p.studyWeekdays, new Set(p.excludedDates)))
  if (studyDays.length === 0) return null
  return { perDay: Math.ceil(remaining / studyDays.length), studyDayCount: studyDays.length }
}

export interface SimulationCurvePoint {
  date: DateStr
  /** 累计完成量 */
  cumulative: number
  /** true = 未来假设段（虚线渲染） */
  isFuture: boolean
}

/** SVG 曲线数据：真实历史（累计到 done）+ 未来假设（虚线到完成或截断） */
export function buildSimulationCurve(
  goal: Goal,
  checkins: Checkin[],
  params: SimulationParams,
  remaining: number,
): { past: SimulationCurvePoint[]; future: SimulationCurvePoint[]; done: number } {
  const sorted = checkins
    .filter((c) => c.goalId === goal.id && c.date <= params.from)
    .sort((a, b) => (a.date < b.date ? -1 : 1))
  let acc = 0
  const past: SimulationCurvePoint[] = [{ date: goal.startDate, cumulative: 0, isFuture: false }]
  for (const c of sorted) {
    acc = round2(acc + c.amount)
    past.push({ date: c.date, cumulative: acc, isFuture: false })
  }
  const sim = simulate(remaining, params)
  const future: SimulationCurvePoint[] = [{ date: params.from, cumulative: acc, isFuture: true }]
  let futureAcc = acc
  for (const p of sim.perDateAmounts) {
    futureAcc = round2(futureAcc + p.amount)
    future.push({ date: p.date, cumulative: futureAcc, isFuture: true })
  }
  return { past, future, done: acc }
}

/** 三组预设（明确标注为假设情景）：保守 / 当前设定 / 激进 */
export function scenarioPresets(basePerDay: number): Array<{ key: 'conservative' | 'current' | 'aggressive'; label: string; perDay: number; note: string }> {
  const round1 = (n: number) => Math.max(0.1, Math.round(n * 10) / 10)
  return [
    { key: 'conservative', label: '保守', perDay: round1(basePerDay * 0.8), note: '按基准量的 80%（假设情景）' },
    { key: 'current', label: '当前设定', perDay: round1(basePerDay), note: '按你设定的每日量（假设情景）' },
    { key: 'aggressive', label: '激进', perDay: round1(basePerDay * 1.25), note: '按基准量的 125%（假设情景）' },
  ]
}

/** 与截止日比较的统一文案（模拟口径） */
export function compareWithDeadline(completionDate: DateStr | null, deadline: DateStr): { kind: 'early' | 'late' | 'onTime' | 'none'; days: number } {
  if (!completionDate) return { kind: 'none', days: 0 }
  const d = diffDays(deadline, completionDate)
  if (d > 0) return { kind: 'early', days: d }
  if (d < 0) return { kind: 'late', days: -d }
  return { kind: 'onTime', days: 0 }
}

/** 目标当前可模拟的输入（UI 一次性取齐） */
export function simulationContext(goal: Goal, checkins: Checkin[], today: DateStr, prefs: StudyCalendarPreference | null) {
  const done = round2(checkins.filter((c) => c.goalId === goal.id).reduce((s, c) => s + c.amount, 0))
  const remaining = Math.max(0, round2(goal.totalAmount - done))
  const prediction = predictCompletion(goal, checkins, today)
  return {
    done,
    remaining,
    deadline: goal.deadline,
    today,
    minRequired: minRequiredPerDay(remaining, goal.deadline, prefs, today),
    /** 近 7 天真实速度预测（与模拟结果严格区分标签） */
    realSpeedPrediction: prediction,
  }
}

/** 曲线 Y 轴范围与日期范围换算（供 SVG 绘制；避免 NaN） */
export function curveScales(points: Array<SimulationCurvePoint>, totalAmount: number, deadline: DateStr): { x: (d: DateStr) => number; y: (v: number) => number; from: DateStr; to: DateStr; maxCum: number } | null {
  const all = [...points]
  if (all.length === 0) return null
  const dates = all.map((p) => p.date)
  const from = dates.reduce((a, b) => (a < b ? a : b))
  const to = [deadline, ...dates].reduce((a, b) => (a > b ? a : b))
  const maxCum = Math.max(totalAmount, ...all.map((p) => p.cumulative))
  const fromMs = parseDate(from).getTime()
  const toMs = parseDate(to).getTime()
  const span = Math.max(1, toMs - fromMs)
  return {
    from,
    to,
    maxCum,
    x: (d: DateStr) => (parseDate(d).getTime() - fromMs) / span,
    y: (v: number) => (maxCum > 0 ? v / maxCum : 0),
  }
}

/** 沙盘默认基准量：剩余量 ÷ 截止前学习日（无学习日退化为剩余量÷14） */
export function defaultPerDay(remaining: number, minRequired: { perDay: number } | null): number {
  if (minRequired && minRequired.perDay > 0) return minRequired.perDay
  return Math.max(1, Math.ceil(remaining / 14))
}

export function todayFromClock(): DateStr {
  return toDateStr(new Date())
}
