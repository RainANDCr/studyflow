import type { Checkin, DateStr, Goal } from './types'

/** 打卡记录通用聚合工具。 */

export function checkinsOfGoal(all: Checkin[], goalId: string): Checkin[] {
  return all.filter((c) => c.goalId === goalId)
}

/** 某日完成总量（同一天多条打卡先求和） */
export function sumAmountOnDate(checkins: Checkin[], date: DateStr): number {
  return checkins.filter((c) => c.date === date).reduce((s, c) => s + c.amount, 0)
}

/** 全部合法记录的总量 */
export function sumAmount(checkins: Checkin[]): number {
  return checkins.reduce((s, c) => s + c.amount, 0)
}

/** 有打卡（amount > 0 已由校验保证）的不同自然日列表（升序） */
export function activeDates(checkins: Checkin[]): DateStr[] {
  const set = new Set(checkins.map((c) => c.date))
  return [...set].sort()
}

/** 某闭区间内的记录 */
export function checkinsInRange(checkins: Checkin[], from: DateStr, to: DateStr): Checkin[] {
  return checkins.filter((c) => c.date >= from && c.date <= to)
}

/** 传入记录按日期升序（稳定） */
export function sortByDate<T extends { date: DateStr; createdAt?: string }>(arr: T[]): T[] {
  return [...arr].sort((a, b) =>
    a.date === b.date ? String(a.createdAt ?? '').localeCompare(String(b.createdAt ?? '')) : a.date < b.date ? -1 : 1,
  )
}

export interface GoalProgress {
  totalAmount: number
  done: number
  remaining: number
  /** 0–100，圆环最多 100% */
  percentCapped: number
  /** 允许超量时的真实比例（可能 >100） */
  percentRaw: number
  isCompleted: boolean
}

export function computeGoalProgress(goal: Goal, goalCheckins: Checkin[]): GoalProgress {
  const done = sumAmount(goalCheckins)
  const remaining = Math.max(0, goal.totalAmount - done)
  const percentRaw = goal.totalAmount > 0 ? (done / goal.totalAmount) * 100 : 0
  return {
    totalAmount: goal.totalAmount,
    done,
    remaining,
    percentCapped: Math.min(100, percentRaw),
    percentRaw,
    isCompleted: done >= goal.totalAmount,
  }
}

/** 累计量首次达到总量的日期（已完成目标的实际完成日） */
export function findActualCompletionDate(goal: Goal, goalCheckins: Checkin[]): DateStr | null {
  if (!computeGoalProgress(goal, goalCheckins).isCompleted) return null
  let acc = 0
  for (const c of sortByDate(goalCheckins)) {
    acc += c.amount
    if (acc >= goal.totalAmount) return c.date
  }
  return null
}
