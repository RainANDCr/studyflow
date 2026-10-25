import type { Checkin, DateStr, FocusSession } from './types'
import { addDays, diffDays, weekStart as weekStartOf } from './dates'
import { splitSessionByDate } from './focus'

/**
 * 学习热力图数据（纯函数）。GitHub 贡献格子风格但用 StudyFlow 紫色梯度。
 * 两种展示口径（切换明确标注）：
 * A. 打卡活跃度 = 当日本地 Checkin 条数（minutes=null 也算打卡行为，但不等于有分钟）；
 * B. 有效学习分钟 = 统一 getEffectiveStudyMinutes 口径（填写分钟 + 未关联打卡的专注会话）。
 * 0 表示「无已记录活动」，不等于「用户一定没学习」。
 */

export type HeatmapMode = 'activity' | 'minutes'

export interface HeatmapDay {
  date: DateStr
  /** 当日打卡条数 */
  checkinCount: number
  /** 当日有打卡的不同目标数 */
  goalCount: number
  /** 当日有效学习分钟（去重口径） */
  effectiveMinutes: number
  /** 当日投入最多的目标（按分钟，其次按打卡量） */
  topGoalIds: string[]
}

export interface HeatmapData {
  days: Map<DateStr, HeatmapDay>
  from: DateStr
  to: DateStr
}

export function buildHeatmapData(
  checkins: Checkin[],
  focusSessions: FocusSession[],
  from: DateStr,
  to: DateStr,
): HeatmapData {
  const days = new Map<DateStr, HeatmapDay>()
  const ensure = (d: DateStr): HeatmapDay => {
    let day = days.get(d)
    if (!day) {
      day = { date: d, checkinCount: 0, goalCount: 0, effectiveMinutes: 0, topGoalIds: [] }
      days.set(d, day)
    }
    return day
  }
  const goalMinutesByDate = new Map<DateStr, Map<string, number>>()

  for (const c of checkins) {
    if (c.date < from || c.date > to) continue
    const day = ensure(c.date)
    day.checkinCount++
    const gm = goalMinutesByDate.get(c.date) ?? new Map<string, number>()
    if (c.minutes !== null) gm.set(c.goalId, (gm.get(c.goalId) ?? 0) + c.minutes)
    goalMinutesByDate.set(c.date, gm)
  }
  // 专注会话（未关联打卡的独立计时）按跨午夜拆分归属
  for (const s of focusSessions) {
    if (s.linkedCheckinId !== null) continue
    for (const b of splitSessionByDate(s)) {
      if (b.date < from || b.date > to || b.seconds <= 0) continue
      ensure(b.date) // 纯专注日（无打卡）也要生成格子
      const gm = goalMinutesByDate.get(b.date) ?? new Map<string, number>()
      if (s.goalId) gm.set(s.goalId, (gm.get(s.goalId) ?? 0) + b.minutes)
      goalMinutesByDate.set(b.date, gm)
    }
  }
  // 汇总每日
  for (const [date, day] of days) {
    const gm = goalMinutesByDate.get(date)
    day.goalCount = new Set(checkins.filter((c) => c.date === date).map((c) => c.goalId)).size
    let total = 0
    if (gm) {
      for (const [, m] of gm) total += m
      day.topGoalIds = [...gm.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([id]) => id)
    }
    day.effectiveMinutes = Math.round(total * 100) / 100
  }
  return { days, from, to }
}

/** 强度档位（0–4）：分钟口径按固定阈值（15/30/60 分钟），活跃度按打卡条数（1 / 2–3 / 4–5 / 6+）。 */
export const MINUTE_TIERS = [15, 30, 60] as const
export const ACTIVITY_TIERS = [2, 4, 6] as const

export function tierOf(value: number, mode: HeatmapMode): 0 | 1 | 2 | 3 | 4 {
  if (value <= 0) return 0
  const tiers = mode === 'minutes' ? MINUTE_TIERS : ACTIVITY_TIERS
  if (value < tiers[0]) return 1
  if (value < tiers[1]) return 2
  if (value < tiers[2]) return 3
  return 4
}

export const HEAT_COLORS = [
  'rgb(var(--c-surface2))',
  '#e6dfff',
  '#c9b8ff',
  '#a585ff',
  '#7c5cff',
] as const

export const TIER_LABELS: Record<HeatmapMode, string[]> = {
  activity: ['无记录', '1 次', '2–3 次', '4–5 次', '6 次以上'],
  minutes: ['无记录', '<15 分钟', '15–29 分钟', '30–59 分钟', '≥60 分钟'],
}

/** 热力图网格：每列一周（周一起始），返回按列分组的日期与月份标签位置 */
export function buildHeatmapGrid(from: DateStr, to: DateStr): { columns: DateStr[][]; monthLabels: Array<{ col: number; label: string }> } {
  const gridStart = weekStartOf(from)
  const totalDays = diffDays(to, gridStart) + 1
  const weeks = Math.ceil(totalDays / 7)
  const columns: DateStr[][] = []
  const monthLabels: Array<{ col: number; label: string }> = []
  let lastMonth = ''
  for (let w = 0; w < weeks; w++) {
    const colStart = addDays(gridStart, w * 7)
    const col = Array.from({ length: 7 }, (_, i) => addDays(colStart, i))
    columns.push(col)
    const firstInMonth = col.find((d) => d >= from)
    if (firstInMonth) {
      const label = `${Number(firstInMonth.slice(5, 7))}月`
      if (label !== lastMonth) {
        monthLabels.push({ col: w, label })
        lastMonth = label
      }
    }
  }
  return { columns, monthLabels }
}
