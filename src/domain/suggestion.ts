import type { Checkin, DateStr, Goal } from './types'
import { addDays, diffDays } from './dates'
import { computeGoalProgress, sumAmountOnDate } from './progress'

/**
 * 今日建议量。
 * - remaining = max(0, total - 已完成总量)
 * - 未完成且截止在今天或未来：remainingDays = 截止日 - 今天 + 1；建议量 = ceil(remaining / remainingDays)
 * - 已完成返回 0；逾期不除以 0/负数，明确给逾期天数。
 */

export type SuggestionState =
  | { kind: 'notStarted' } // 开始日在未来
  | { kind: 'completed' }
  | { kind: 'overdue'; overdueDays: number; suggestion: number; remaining: number } // 逾期：滚入今日的建议量 = 剩余量
  | { kind: 'active'; suggestion: number; remaining: number; remainingDays: number }

export function computeTodaySuggestion(
  goal: Goal,
  goalCheckins: Checkin[],
  today: DateStr,
): SuggestionState {
  if (today < goal.startDate) return { kind: 'notStarted' }
  const { remaining, isCompleted } = computeGoalProgress(goal, goalCheckins)
  if (isCompleted) return { kind: 'completed' }
  if (today > goal.deadline) {
    return {
      kind: 'overdue',
      overdueDays: diffDays(today, goal.deadline),
      suggestion: remaining,
      remaining,
    }
  }
  const remainingDays = diffDays(goal.deadline, today) + 1
  return {
    kind: 'active',
    suggestion: Math.ceil(remaining / remainingDays),
    remaining,
    remainingDays,
  }
}

/**
 * 打卡表单预填量：今日建议量减去今日已记录量，下限 0。
 * 逾期时预填「把剩余计划滚入今日」的剩余量。用户总是可以手动修改；
 * 预填值绝不会自动生成打卡。
 */
export function computeCheckinPrefill(
  goal: Goal,
  goalCheckins: Checkin[],
  today: DateStr,
): number {
  const state = computeTodaySuggestion(goal, goalCheckins, today)
  if (state.kind === 'completed' || state.kind === 'notStarted') return 0
  const doneToday = sumAmountOnDate(goalCheckins, today)
  return Math.max(0, state.suggestion - doneToday)
}

/** 允许补记的过去自然日：最近 6 个（昨天起往前），且不早于目标开始日，不含未来。 */
export function getAllowedBackfillDates(goal: Goal, today: DateStr): DateStr[] {
  const dates: DateStr[] = []
  for (let i = 1; i <= 6; i++) {
    const d = addDays(today, -i)
    if (d >= goal.startDate) dates.push(d)
  }
  return dates // 最近在前
}
