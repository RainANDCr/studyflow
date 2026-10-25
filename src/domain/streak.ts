import type { Checkin, DateStr, Goal } from './types'
import { addDays, diffDays, maxDate, minDate, rangeDays, weekEnd, weekStart as weekStartOf } from './dates'
import { findActualCompletionDate, sumAmountOnDate } from './progress'

/**
 * 连续打卡与每周弹性休息日。
 *
 * 定义：
 * - 一周 = 周一 00:00 至下周一 00:00 前（本地日期）；
 * - weeklyRestEnabled=true 时每周宽免 1 个缺卡日（本周首个缺卡日），第二个缺卡日打断连续；
 * - 每周额度独立、不累计；周跨月/跨年同样成立（全部按日期字符串比较）；
 * - 今天尚未结束 → 今天不算漏打卡；序列锚点：今天有打卡则含今天，否则从昨天往回；
 * - 缺卡日必须落在 [max(周开始, 目标开始日), min(周末, 昨天)] 内才计为漏卡；
 * - 已完成目标不再制造新的漏卡（漏卡统计止于实际完成日）。
 */

export interface WeeklyRestState {
  weekStart: DateStr
  /** 该周已发生的漏卡日期（升序） */
  missDates: DateStr[]
  /** 被宽免的休息日（每周第一个漏卡日；未启用则为 null） */
  restDate: DateStr | null
  /** 打断连续的那一天（第二个漏卡日；未启用时为第一个漏卡日） */
  brokenByMiss: DateStr | null
}

export function getWeeklyRestState(
  goal: Goal,
  goalCheckins: Checkin[],
  targetWeekStart: DateStr,
  today: DateStr,
): WeeklyRestState {
  const wStart = maxDate(targetWeekStart, goal.startDate)
  let wEnd = minDate(weekEnd(targetWeekStart), addDays(today, -1)) // 截止到昨天
  const completion = findActualCompletionDate(goal, goalCheckins)
  if (completion) wEnd = minDate(wEnd, completion) // 完成日当天必然有打卡，不影响

  const missDates: DateStr[] = []
  if (wStart <= wEnd) {
    for (const d of rangeDays(wStart, wEnd)) {
      if (sumAmountOnDate(goalCheckins, d) <= 0) missDates.push(d)
    }
  }
  const restDate = goal.weeklyRestEnabled && missDates.length > 0 ? missDates[0] : null
  const brokenByMiss =
    missDates.length === 0
      ? null
      : goal.weeklyRestEnabled
        ? missDates.length >= 2
          ? missDates[1]
          : null
        : missDates[0]
  return { weekStart: targetWeekStart, missDates, restDate, brokenByMiss }
}

export interface StreakResult {
  /** 当前连续天数 */
  current: number
  /** 是否包含今天（今天已有打卡） */
  includesToday: boolean
}

/**
 * 从锚点（今天有打卡=今天，否则昨天）向前逐日回溯：
 * 有效日 = 有打卡 或 是所在周的宽免休息日；遇到无效日、或早于目标开始日即停。
 * 已完成目标的序列冻结在完成日。
 */
export function calculateStreak(goal: Goal, goalCheckins: Checkin[], today: DateStr): StreakResult {
  const completion = findActualCompletionDate(goal, goalCheckins)
  const doneToday = sumAmountOnDate(goalCheckins, today) > 0
  let anchor = doneToday ? today : addDays(today, -1)
  if (completion && anchor > completion) anchor = completion

  if (anchor < goal.startDate) return { current: 0, includesToday: false }

  let streak = 0
  let includesToday = false
  let d = anchor
  if (doneToday && anchor === today) includesToday = true
  while (d >= goal.startDate) {
    const hasCheckin = sumAmountOnDate(goalCheckins, d) > 0
    if (hasCheckin) {
      streak++
    } else {
      const rest = goal.weeklyRestEnabled
        ? getWeeklyRestState(goal, goalCheckins, weekStartOf(d), today).restDate
        : null
      if (rest === d) streak++
      else break
    }
    d = addDays(d, -1)
  }
  return { current: streak, includesToday }
}

export type YesterdayMissedLevel = 'notTracked' | 'none' | 'forgiven' | 'broken'

export interface YesterdayMissedState {
  level: YesterdayMissedLevel
  /** broken 时的「把剩余计划滚入今日」建议量 */
  rollIntoToday: number | null
  description: string
}

/**
 * 昨日缺卡分类：
 * - notTracked：昨天早于目标开始日，或目标已完成（已完成目标不再制造漏卡）；
 * - none：昨天有打卡（或今天即开始日等无意义场景）；
 * - forgiven：昨天缺卡但消耗了所在周（注意：是昨天所在的自然周，可能与今天不同周）
 *             的每周弹性休息额度 → 黄卡「连续记录仍保留」；
 * - broken：该周额度已耗尽或未启用休息日 → 红卡「连续中断」。
 */
export function getYesterdayMissedState(
  goal: Goal,
  goalCheckins: Checkin[],
  today: DateStr,
): YesterdayMissedState {
  const yesterday = addDays(today, -1)
  if (yesterday < goal.startDate) {
    return { level: 'notTracked', rollIntoToday: null, description: '目标尚未开始跟踪' }
  }
  if (findActualCompletionDate(goal, goalCheckins)) {
    return { level: 'notTracked', rollIntoToday: null, description: '目标已完成' }
  }
  if (sumAmountOnDate(goalCheckins, yesterday) > 0) {
    return { level: 'none', rollIntoToday: null, description: '' }
  }
  // 昨天缺卡：判定属于「昨天所在周」的休息额度
  const state = getWeeklyRestState(goal, goalCheckins, weekStartOf(yesterday), today)
  const done = goalCheckins.reduce((s, c) => s + c.amount, 0)
  const remaining = Math.max(0, goal.totalAmount - done)
  if (state.restDate === yesterday) {
    return {
      level: 'forgiven',
      rollIntoToday: null,
      description: '昨天用了本周弹性休息日，连续记录仍保留',
    }
  }
  return {
    level: 'broken',
    rollIntoToday: remaining && remaining > 0 ? remaining : null,
    description: '昨天缺卡且本周休息额度已用完，连续记录中断',
  }
}

/** 今日页排序：红卡 > 黄卡 > 已逾期 > 未开始 > 进行中（临近截止优先）> 已完成置底 */
export function goalSortWeight(goal: Goal, goalCheckins: Checkin[], today: DateStr): number {
  const missed = getYesterdayMissedState(goal, goalCheckins, today)
  if (missed.level === 'broken') return 0
  if (missed.level === 'forgiven') return 1
  if (today > goal.deadline) return 2
  if (today < goal.startDate) return 3
  if (findActualCompletionDate(goal, goalCheckins)) return 9
  return 4
}

export function sortGoalsForToday(
  goals: Goal[],
  allCheckins: Checkin[],
  today: DateStr,
): Goal[] {
  return [...goals].sort((a, b) => {
    const wa = goalSortWeight(a, allCheckins.filter((c) => c.goalId === a.id), today)
    const wb = goalSortWeight(b, allCheckins.filter((c) => c.goalId === b.id), today)
    if (wa !== wb) return wa - wb
    return diffDays(a.deadline, b.deadline) // 截止越近越靠前
  })
}
