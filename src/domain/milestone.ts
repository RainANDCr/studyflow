import type { Checkin, DateStr, Goal, Milestone, MilestoneStep } from './types'

/**
 * 里程碑领域规则（纯函数）。
 * - 主目标完成量 = Σ该目标全部 Checkin.amount（无论是否关联里程碑）；
 * - 里程碑量化进度 = Σ指向该里程碑的 Checkin.amount；勾选步骤不改变任何量化进度；
 * - milestoneId=null 的记录归入「未分配」，可后续批量关联；
 * - 阶段计划量允许未分完（余量），但总和超出主目标总量时必须显式提示。
 */

export function round2(n: number): number {
  return Math.round(n * 100) / 100
}

export function milestoneDone(milestone: Milestone, checkins: Checkin[]): number {
  return round2(checkins.filter((c) => c.milestoneId === milestone.id).reduce((s, c) => s + c.amount, 0))
}

export interface MilestoneProgress {
  milestone: Milestone
  done: number
  /** 0–100 封顶 */
  percent: number
  isCompleted: boolean
  /** 逾期天数（dueDate < 今天且未完成）；无 dueDate 或未逾期为 null */
  overdueDays: number | null
}

export function getMilestoneProgress(
  milestone: Milestone,
  checkins: Checkin[],
  today: DateStr,
): MilestoneProgress {
  const done = milestoneDone(milestone, checkins)
  const percent = milestone.plannedAmount > 0 ? Math.min(100, (done / milestone.plannedAmount) * 100) : 0
  return {
    milestone,
    done,
    percent,
    isCompleted: done >= milestone.plannedAmount,
    overdueDays:
      !milestone.dueDate || done >= milestone.plannedAmount || today <= milestone.dueDate
        ? null
        : (function () {
            const [y, m, d] = milestone.dueDate!.split('-').map(Number)
            const [ty, tm, td] = today.split('-').map(Number)
            return Math.round(
              (new Date(ty, tm - 1, td).getTime() - new Date(y, m - 1, d).getTime()) / 86_400_000,
            )
          })(),
  }
}

/** 排序后的里程碑进度（含未开始的下一里程碑定位） */
export function getGoalMilestoneTimeline(
  goalMilestones: Milestone[],
  checkins: Checkin[],
  today: DateStr,
): { items: MilestoneProgress[]; next: MilestoneProgress | null; totalPlanned: number } {
  const items = [...goalMilestones]
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((m) => getMilestoneProgress(m, checkins, today))
  return {
    items,
    next: items.find((i) => !i.isCompleted) ?? null,
    totalPlanned: round2(goalMilestones.reduce((s, m) => s + m.plannedAmount, 0)),
  }
}

/** 未分配记录：goalId 匹配且 milestoneId 为空的打卡 */
export function getUnassignedCheckins(goalId: string, checkins: Checkin[]): Checkin[] {
  return checkins.filter((c) => c.goalId === goalId && (c.milestoneId ?? null) === null)
}

export function unassignedAmount(goalId: string, checkins: Checkin[]): number {
  return round2(getUnassignedCheckins(goalId, checkins).reduce((s, c) => s + c.amount, 0))
}

/** 阶段总量校验：超出主目标总量时返回冲突（允许「尚未拆分的余量」） */
export function checkMilestoneTotalConflict(goal: Goal, milestones: Milestone[]): { over: number; totalPlanned: number } | null {
  const totalPlanned = round2(milestones.filter((m) => m.goalId === goal.id).reduce((s, m) => s + m.plannedAmount, 0))
  const over = round2(totalPlanned - goal.totalAmount)
  return over > 0 ? { over, totalPlanned } : null
}

/** 关联合法性：里程碑必须属于同一目标 */
export function canLinkMilestone(goalId: string, milestone: Milestone | null | undefined): boolean {
  return !!milestone && milestone.goalId === goalId
}

/* ---------------- 半自动拆分（全部本地计算，无 AI） ---------------- */

export interface SplitDraft {
  title: string
  plannedAmount: number
  startDate: DateStr | null
  dueDate: DateStr | null
}

/**
 * 平均拆分：商/余数保证 Σ阶段量 = 总量 - 已分出去的量。
 * 传入 excludeTotal（已存在里程碑的计划量之和）。
 */
export function averageSplit(totalToSplit: number, n: number, startIndex: number): SplitDraft[] {
  const remainderCount = Math.max(1, Math.floor(n))
  const base = Math.floor(totalToSplit / remainderCount)
  const rem = totalToSplit % remainderCount
  return Array.from({ length: remainderCount }, (_, i) => ({
    title: `阶段 ${startIndex + i + 1}`,
    plannedAmount: base + (i < rem ? 1 : 0),
    startDate: null,
    dueDate: null,
  }))
}

/** 按时间分段：把 [from, to] 均分 n 段，每段用平均拆分的数量 */
export function timeSplit(
  totalToSplit: number,
  from: DateStr,
  to: DateStr,
  n: number,
  startIndex: number,
): SplitDraft[] {
  const amounts = averageSplit(totalToSplit, n, 0)
  const [fy, fm, fd] = from.split('-').map(Number)
  const [ty, tm, td] = to.split('-').map(Number)
  const fromMs = new Date(fy, fm - 1, fd).getTime()
  const toMs = new Date(ty, tm - 1, td).getTime()
  const span = Math.max(0, toMs - fromMs)
  return amounts.map((a, i) => {
    const segStart = fromMs + (span / n) * i
    const segEnd = i === n - 1 ? toMs : fromMs + (span / n) * (i + 1) - 86_400_000
    return {
      ...a,
      title: `阶段 ${startIndex + i + 1}`,
      startDate: toDateStrLocal(segStart),
      dueDate: toDateStrLocal(segEnd),
    }
  })
}

function toDateStrLocal(ms: number): DateStr {
  const d = new Date(ms)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/* ---------------- 步骤清单（纯勾选，不参与量化） ---------------- */

export function stepsCompletion(steps: MilestoneStep[]): { done: number; total: number; percent: number } {
  const total = steps.length
  const done = steps.filter((s) => s.isDone).length
  return { done, total, percent: total > 0 ? (done / total) * 100 : 0 }
}

/** 步骤完成率不得混同量化进度：此函数明确分离两种口径 */
export function milestoneQuantitativeVsSteps(
  milestone: Milestone,
  checkins: Checkin[],
  steps: MilestoneStep[],
  today: DateStr,
): { quantitativePercent: number; stepsDone: number; stepsTotal: number } {
  const qp = getMilestoneProgress(milestone, checkins, today)
  const sc = stepsCompletion(steps.filter((s) => s.milestoneId === milestone.id))
  return { quantitativePercent: qp.percent, stepsDone: sc.done, stepsTotal: sc.total }
}
