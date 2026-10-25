import type { Checkin, DateStr, FocusSession, Goal, WeeklyReview } from './types'
import { addDays, diffDays, formatFullCN, formatMD, weekEnd, weekStart as weekStartOf, weekdayShort } from './dates'
import { checkinsInRange } from './progress'
import { getEffectiveStudyMinutes, splitSessionByDate } from './focus'

/**
 * 周报：一周固定周一至周日。
 * - 分目标汇总（保留单位），绝不把「词 + 页 + 节」累加成虚假总量；
 * - 分钟数只统计明确填写的记录；
 * - 当前未结束的周与上一周「周一到当前星期几」同日数窗口比较；
 *   历史完整周与上一个完整周比较；
 * - 环比零基数：上期 0 本期 >0 →「上期为 0 / 本期新增」；两期皆 0 →「持平」。
 */

export interface GoalWeekStat {
  goalId: string
  name: string
  unit: string
  color: string
  amount: number
  checkinCount: number
  /** 有打卡的自然日数量 */
  activeDays: number
  /** 明确填写的分钟数合计 */
  minutes: number
}

export interface WeekSummary {
  from: DateStr
  to: DateStr
  goalStats: GoalWeekStat[]
  totalCheckins: number
  /** 任意目标有打卡的自然日数量 */
  totalActiveDays: number
  totalMinutes: number
}

export function summarizeRange(
  goals: Goal[],
  allCheckins: Checkin[],
  from: DateStr,
  to: DateStr,
  /** 统一有效分钟口径：填写的打卡分钟 + 未关联打卡的专注会话（已关联不叠加） */
  focusSessions: FocusSession[] = [],
): WeekSummary {
  const goalStats: GoalWeekStat[] = []
  let totalCheckins = 0
  const activeDaySet = new Set<DateStr>()
  const inRangeCheckins = checkinsInRange(allCheckins, from, to)
  const goalMinutes = new Map<string, number>()
  for (const g of goals) {
    const inRange = checkinsInRange(
      allCheckins.filter((c) => c.goalId === g.id),
      from,
      to,
    )
    const checkinMinutes = inRange.reduce((s, c) => s + (c.minutes ?? 0), 0)
    // 该目标未关联打卡的专注会话（按跨午夜拆分归属日计）
    const sessionMinutes = focusSessions
      .filter((fs) => fs.goalId === g.id && fs.linkedCheckinId === null)
      .reduce((sum, fs) => {
        for (const b of splitSessionByDate(fs)) {
          if (b.date >= from && b.date <= to) sum += b.minutes
        }
        return sum
      }, 0)
    if (sessionMinutes > 0) goalMinutes.set(g.id, checkinMinutes + sessionMinutes)
    if (inRange.length === 0 && !(sessionMinutes > 0)) continue
    const days = new Set(inRange.map((c) => c.date))
    days.forEach((d) => activeDaySet.add(d))
    goalStats.push({
      goalId: g.id,
      name: g.name,
      unit: g.unit,
      color: g.color,
      amount: inRange.reduce((s, c) => s + c.amount, 0),
      checkinCount: inRange.length,
      activeDays: days.size,
      minutes: checkinMinutes + sessionMinutes,
    })
    totalCheckins += inRange.length
  }
  const totalMinutes = getEffectiveStudyMinutes(inRangeCheckins, focusSessions, { from, to })
  return {
    from,
    to,
    goalStats,
    totalCheckins,
    totalActiveDays: activeDaySet.size,
    totalMinutes,
  }
}

export type DeltaKind = 'up' | 'down' | 'flat' | 'newFromZero'

export interface MetricDelta {
  label: string
  current: number
  previous: number
  unit: string
  deltaKind: DeltaKind
  delta: number
  percentText: string
}

export function computeDelta(label: string, unit: string, current: number, previous: number): MetricDelta {
  const delta = current - previous
  let deltaKind: DeltaKind = 'flat'
  let percentText = '持平'
  if (previous === 0 && current > 0) {
    deltaKind = 'newFromZero'
    percentText = '上期为 0 / 本期新增'
  } else if (previous > 0) {
    const pct = (delta / previous) * 100
    deltaKind = delta > 0 ? 'up' : delta < 0 ? 'down' : 'flat'
    if (delta > 0) percentText = `+${Math.round(pct)}%`
    else if (delta < 0) percentText = `-${Math.round(Math.abs(pct))}%`
    else percentText = '持平'
  }
  return { label, unit, current, previous, deltaKind, delta, percentText }
}

/** 环比窗口：未结束的周与上一周同进度日数比较；完整历史周与上一完整周比较。 */
export function comparisonWindows(targetWeekStart: DateStr, today: DateStr): { cur: WeekSummaryWindow; prev: WeekSummaryWindow } {
  const isCurrentWeek = weekStartOf(today) === targetWeekStart
  const weekEnd_ = weekEnd(targetWeekStart)
  if (isCurrentWeek) {
    const curFrom = targetWeekStart
    const curTo = today
    const spanDays = diffDays(curTo, curFrom) // 0..6
    const prevStart = addDays(targetWeekStart, -7)
    return {
      cur: { from: curFrom, to: curTo },
      prev: { from: prevStart, to: addDays(prevStart, spanDays) },
    }
  }
  return {
    cur: { from: targetWeekStart, to: weekEnd_ },
    prev: { from: addDays(targetWeekStart, -7), to: addDays(weekEnd_, -7) },
  }
}

export interface WeekSummaryWindow {
  from: DateStr
  to: DateStr
}

export interface WeeklyComparison {
  metrics: MetricDelta[]
  goalMetrics: MetricDelta[]
}

export function compareWeeks(
  goals: Goal[],
  allCheckins: Checkin[],
  targetWeekStart: DateStr,
  today: DateStr,
): WeeklyComparison {
  const { cur, prev } = comparisonWindows(targetWeekStart, today)
  const curSum = summarizeRange(goals, allCheckins, cur.from, cur.to)
  const prevSum = summarizeRange(goals, allCheckins, prev.from, prev.to)
  const metrics = [
    computeDelta('学习天数', '天', curSum.totalActiveDays, prevSum.totalActiveDays),
    computeDelta('打卡次数', '次', curSum.totalCheckins, prevSum.totalCheckins),
    computeDelta('投入分钟', '分钟', curSum.totalMinutes, prevSum.totalMinutes),
  ]
  const goalMetrics = curSum.goalStats.map((gs) => {
    const prevGs = prevSum.goalStats.find((p) => p.goalId === gs.goalId)
    return computeDelta(gs.name, gs.unit, gs.amount, prevGs?.amount ?? 0)
  })
  return { metrics, goalMetrics }
}

/** 生成可复制的中文周报文本（真实统计 + 同口径环比 + 四栏，缺失栏诚实标注）。 */
export function generateWeeklyReportText(
  goals: Goal[],
  allCheckins: Checkin[],
  targetWeekStart: DateStr,
  today: DateStr,
  review: WeeklyReview | null,
): string {
  const { cur, prev } = comparisonWindows(targetWeekStart, today)
  const isCurrent = weekStartOf(today) === targetWeekStart
  const curSum = summarizeRange(goals, allCheckins, cur.from, cur.to)
  const prevSum = summarizeRange(goals, allCheckins, prev.from, prev.to)
  const { metrics, goalMetrics } = compareWeeks(goals, allCheckins, targetWeekStart, today)

  const lines: string[] = []
  lines.push(`【知行 StudyFlow 周报】${formatMD(cur.from)} - ${formatMD(isCurrent ? today : cur.to)}${isCurrent ? '（本周进行中，与上周同口径比较）' : ''}`)
  lines.push('')
  lines.push('一、本周统计')
  if (curSum.goalStats.length === 0) {
    lines.push('  本周暂无学习记录。')
  } else {
    lines.push(`  学习天数：${curSum.totalActiveDays} 天（上周同口径 ${prevSum.totalActiveDays} 天，${metrics[0].percentText}）`)
    lines.push(`  打卡次数：${curSum.totalCheckins} 次（上周同口径 ${prevSum.totalCheckins} 次，${metrics[1].percentText}）`)
    lines.push(`  投入分钟：${curSum.totalMinutes} 分钟（含明确填写的打卡分钟与未关联打卡的专注会话；上周同口径 ${prevSum.totalMinutes} 分钟，${metrics[2].percentText}）`)
    lines.push('  分目标完成量：')
    for (const gs of curSum.goalStats) {
      const gm = goalMetrics.find((m) => m.label === gs.name)
      const cmp = prevSum.goalStats.find((p) => p.goalId === gs.goalId)
      const cmpText = cmp && cmp.amount > 0 ? `，${gm?.percentText ?? ''}` : '（上期为 0）'
      lines.push(`    · ${gs.name}：${gs.amount} ${gs.unit}，打卡 ${gs.checkinCount} 次${gs.minutes > 0 ? `，${gs.minutes} 分钟` : ''}${cmpText}`)
    }
  }
  lines.push('')
  lines.push('二、复盘')
  const fields: Array<[string, string]> = [
    ['保持', review?.keep ?? ''],
    ['问题', review?.problem ?? ''],
    ['尝试', review?.tryNext ?? ''],
    ['下周预案', review?.nextPlan ?? ''],
  ]
  for (const [label, v] of fields) {
    lines.push(`  【${label}】${v.trim() ? v.trim() : '未填写'}`)
  }
  lines.push('')
  lines.push(`生成于 ${formatFullCN(today)} ${weekdayShort(today)} · 知行 StudyFlow（本地离线应用，数据保存在本机）`)
  return lines.join('\n')
}
