import type { Checkin, DateStr, Goal } from './types'
import { addDays, diffDays, maxDate } from './dates'
import { computeGoalProgress, findActualCompletionDate, sumAmount, checkinsInRange } from './progress'

/** 近 7 天速度推算：至少 3 个不同有效打卡日才给出预测（常量，禁止魔法数字散落）。 */
export const MIN_ACTIVE_DAYS_FOR_PREDICTION = 3
export const PREDICTION_WINDOW_DAYS = 7

export interface PredictionResult {
  status: 'completed' | 'insufficient' | 'active'
  /** 窗口内不同有效打卡日数量 */
  activeDays: number
  /** 参与速度分母的有效日历日数量（窗口按开始日截断后） */
  windowDays: number
  /** 单位/日；active 时存在 */
  averageSpeed: number | null
  /** 预计完成日（今天算第 1 天推算） */
  projectedDate: DateStr | null
  /** 完成目标时的实际完成日 */
  actualCompletionDate: DateStr | null
  comparison: { kind: 'early' | 'late' | 'onTime'; days: number } | null
}

/**
 * 规则：
 * - 窗口 = 以今天为终点的最多近 7 个日历日，早于目标开始日的日期不计入分母；
 * - 没有打卡的有效日期以 0 参与速度计算；
 * - <3 个有效打卡日或平均速度 ≤0 → 暂无推算；
 * - 预计完成日按「今天算第 1 天」：projected = today + ceil(remaining/speed) - 1；
 * - 已完成目标用实际完成日，不再虚构未来日期。
 */
export function predictCompletion(
  goal: Goal,
  goalCheckins: Checkin[],
  today: DateStr,
): PredictionResult {
  const progress = computeGoalProgress(goal, goalCheckins)
  if (progress.isCompleted) {
    return {
      status: 'completed',
      activeDays: 0,
      windowDays: 0,
      averageSpeed: null,
      projectedDate: null,
      actualCompletionDate: findActualCompletionDate(goal, goalCheckins),
      comparison: null,
    }
  }

  const windowStart = maxDate(addDays(today, -(PREDICTION_WINDOW_DAYS - 1)), goal.startDate)
  const windowDays = diffDays(today, windowStart) + 1
  const inWindow = checkinsInRange(goalCheckins, windowStart, today)
  const activeDays = new Set(inWindow.map((c) => c.date)).size
  const base = { activeDays, windowDays }

  if (activeDays < MIN_ACTIVE_DAYS_FOR_PREDICTION) {
    return { status: 'insufficient', ...base, averageSpeed: null, projectedDate: null, actualCompletionDate: null, comparison: null }
  }
  const averageSpeed = sumAmount(inWindow) / windowDays
  if (!(averageSpeed > 0)) {
    return { status: 'insufficient', ...base, averageSpeed: null, projectedDate: null, actualCompletionDate: null, comparison: null }
  }
  const remainingDaysNeeded = Math.ceil(progress.remaining / averageSpeed)
  const projectedDate = addDays(today, remainingDaysNeeded - 1)
  const d = diffDays(goal.deadline, projectedDate)
  // 预计日早于截止日（d>0）→ 提前；晚于截止日（d<0）→ 拖后
  const comparison =
    d > 0 ? { kind: 'early' as const, days: d } : d < 0 ? { kind: 'late' as const, days: -d } : { kind: 'onTime' as const, days: 0 }
  return { status: 'active', ...base, averageSpeed, projectedDate, actualCompletionDate: null, comparison }
}
