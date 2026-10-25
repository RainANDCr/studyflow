import type { DateStr, Exam, ExamPlanSlot, GlobalStudyAvailability } from './types'
import { addDays, diffDays, dayOfWeekMon1 } from './dates'
import { round2 } from './milestone'

/**
 * 考试冲刺领域算法（纯函数）。
 * - ExamPlanSlot.plannedMinutes 是时间预算层，与 DailyPlan.plannedAmount（目标量）并列、不可相加；
 * - 不做「分钟→单词/页」换算（无可靠个人速度）；
 * - 全局预算未配置必须明示，不猜某考试上限为全局；
 * - 重排只动未来 + 未锁定（isLocked=false）的 generated 条目。
 */

export interface ExamCountdown {
  days: number
  status: 'today' | 'upcoming' | 'past'
  text: string
}

/** 本地自然日倒计时：考试日=0、未来 N 天、已过「已结束 N 天」 */
export function examCountdown(examDate: DateStr, today: DateStr): ExamCountdown {
  const d = diffDays(examDate, today)
  if (d === 0) return { days: 0, status: 'today', text: '今天考试' }
  if (d > 0) return { days: d, status: 'upcoming', text: `距考试还有 ${d} 天` }
  return { days: -d, status: 'past', text: `已结束 ${-d} 天` }
}

/** 目标某天的可用分钟；null=未规划（区别于明确 0） */
export function availabilityForDate(
  examId: string,
  rows: Array<{ examId: string; date: DateStr; availableMinutes: number }>,
  date: DateStr,
): number | null {
  const row = rows.find((r) => r.examId === examId && r.date === date)
  return row ? row.availableMinutes : null
}

export function globalAvailabilityForDate(
  rows: GlobalStudyAvailability[],
  date: DateStr,
): number | null {
  return rows.find((r) => r.date === date)?.availableMinutes ?? null
}

/** 某考试某天已排的分钟合计 */
export function plannedMinutesForDate(slots: ExamPlanSlot[], examId: string, date: DateStr): number {
  return slots.filter((s) => s.examId === examId && s.date === date).reduce((sum, s) => sum + s.plannedMinutes, 0)
}

/** 所有考试某天的已排分钟合计（全局超额检测用） */
export function plannedMinutesAllExamsForDate(slots: ExamPlanSlot[], date: DateStr): number {
  return slots.filter((s) => s.date === date).reduce((sum, s) => sum + s.plannedMinutes, 0)
}

export interface OverrunWarning {
  kind: 'exam' | 'global'
  date: DateStr
  planned: number
  limit: number
  message: string
}

/** 单考试 + 全局超额检测；全局未配置时返回明确提示而不是「未超额」 */
export function checkOverruns(
  slots: ExamPlanSlot[],
  availabilities: Array<{ examId: string; date: DateStr; availableMinutes: number }>,
  globalRows: GlobalStudyAvailability[],
  dates: DateStr[],
): { warnings: OverrunWarning[]; globalConfigured: boolean } {
  const warnings: OverrunWarning[] = []
  let globalConfigured = false
  for (const date of dates) {
    const perExam = new Map<string, number>()
    for (const s of slots.filter((x) => x.date === date)) {
      perExam.set(s.examId, (perExam.get(s.examId) ?? 0) + s.plannedMinutes)
    }
    for (const [examId, planned] of perExam) {
      if (planned <= 0) continue
      const limit = availabilityForDate(examId, availabilities, date)
      if (limit !== null && planned > limit) {
        warnings.push({
          kind: 'exam',
          date,
          planned,
          limit,
          message: `某考试在 ${date} 已排 ${planned} 分钟，超过该日可用 ${limit} 分钟`,
        })
      }
    }
    const gLimit = globalAvailabilityForDate(globalRows, date)
    if (gLimit !== null) {
      globalConfigured = true
      const allPlanned = plannedMinutesAllExamsForDate(slots, date)
      if (allPlanned > gLimit) {
        warnings.push({
          kind: 'global',
          date,
          planned: allPlanned,
          limit: gLimit,
          message: `所有考试在 ${date} 合计 ${allPlanned} 分钟，超过全局预算 ${gLimit} 分钟`,
        })
      }
    }
  }
  return { warnings, globalConfigured }
}

export interface GeneratePlanInput {
  examId: string
  /** 关联目标及权重 */
  links: Array<{ goalId: string; priorityWeight: number }>
  /** 日期范围（含端点，本地自然日，已过日期不应传入） */
  dates: DateStr[]
  /** 每天可用分钟（examId+date），缺记录视为未规划 → 该日跳过并提示 */
  availabilities: Array<{ examId: string; date: DateStr; availableMinutes: number }>
  /** 现有未来未锁定 generated 条目将被替换 */
  existingSlots: ExamPlanSlot[]
}

export interface GeneratedSlot {
  date: DateStr
  goalId: string
  plannedMinutes: number
}

export interface GeneratePlanResult {
  slots: GeneratedSlot[]
  /** 每日可用分钟合计（仅已配置日） */
  totalBudgetMinutes: number
  /** 有多少天未配置可用时间（这些天不排程） */
  unconfiguredDays: number
  skippedDates: DateStr[]
}

/**
 * 按权重正比把每日可用分钟分给各目标；不做单位换算。
 * 权重份额取整：整数分钟（floor+余数分配给权重高者，稳定排序）。
 */
export function generateExamPlan(input: GeneratePlanInput): GeneratePlanResult {
  const links = input.links.filter((l) => l.priorityWeight > 0)
  const slots: GeneratedSlot[] = []
  let totalBudgetMinutes = 0
  let unconfiguredDays = 0
  const skippedDates: DateStr[] = []
  if (links.length === 0) return { slots, totalBudgetMinutes: 0, unconfiguredDays: input.dates.length, skippedDates: [...input.dates] }
  const sorted = [...links].sort((a, b) => b.priorityWeight - a.priorityWeight)
  const weightSum = round2(sorted.reduce((s, l) => s + l.priorityWeight, 0))
  for (const date of input.dates) {
    const available = availabilityForDate(input.examId, input.availabilities, date)
    if (available === null || available <= 0) {
      unconfiguredDays++
      if (available === null) skippedDates.push(date)
      continue
    }
    totalBudgetMinutes += available
    // 权重正比 + 最大余数法（按权重降序稳定分配余数）
    const shares = sorted.map((l) => Math.floor((available * l.priorityWeight) / weightSum))
    let remainder = available - shares.reduce((s, v) => s + v, 0)
    for (let i = 0; remainder > 0 && i < sorted.length; i++, remainder--) shares[i]++
    for (let i = 0; i < sorted.length; i++) {
      if (shares[i] > 0) slots.push({ date, goalId: sorted[i].goalId, plannedMinutes: shares[i] })
    }
  }
  return { slots, totalBudgetMinutes, unconfiguredDays, skippedDates }
}

/** 重排差异预览：只替换「未来 + 未锁定 + generated」；历史/锁定/手动条目原样保留 */
export function reschedulePreview(
  existingSlots: ExamPlanSlot[],
  fresh: Array<{ date: DateStr; goalId: string; plannedMinutes: number }>,
  today: DateStr,
): { upserts: Array<{ date: DateStr; goalId: string; plannedMinutes: number }>; removalIds: string[]; untouched: number; lockedKept: number } {
  const replaceable = existingSlots.filter((s) => s.source === 'generated' && !s.isLocked && s.date > today)
  const lockedOrPastOrManual = existingSlots.filter((s) => !(s.source === 'generated' && !s.isLocked && s.date > today))
  const occupied = new Set(lockedOrPastOrManual.map((s) => `${s.date}|${s.goalId}`))
  const upserts = fresh.filter((f) => !occupied.has(`${f.date}|${f.goalId}`) && f.plannedMinutes > 0)
  const freshKeys = new Set(upserts.map((f) => `${f.date}|${f.goalId}`))
  const valueOf = (key: string) => fresh.find((f) => `${f.date}|${f.goalId}` === key)?.plannedMinutes
  // 同键但数量不同 → 视为替换（旧条目删除、新值写入）；数量相同 → untouched
  const removalIds = replaceable
    .filter((s) => {
      const key = `${s.date}|${s.goalId}`
      if (!freshKeys.has(key)) return true
      return valueOf(key) !== s.plannedMinutes
    })
    .map((s) => s.id)
  return {
    upserts,
    removalIds,
    untouched: replaceable.filter((s) => valueOf(`${s.date}|${s.goalId}`) === s.plannedMinutes).length,
    lockedKept: lockedOrPastOrManual.length,
  }
}

/** 备考阶段建议草案：按备考天数分档；不重叠、不越过考试日 */
export function draftExamPhases(
  start: DateStr,
  examDate: DateStr,
): Array<{ title: string; startDate: DateStr; endDate: DateStr }> {
  const total = diffDays(examDate, start)
  if (total < 0) return []
  if (total < 3) return [{ title: '考前冲刺', startDate: start, endDate: examDate }]
  const segments: Array<{ title: string; ratio: number }> =
    total < 14
      ? [
          { title: '基础巩固', ratio: 0.5 },
          { title: '强化冲刺', ratio: 0.5 },
        ]
      : [
          { title: '基础巩固', ratio: 0.4 },
          { title: '强化训练', ratio: 0.35 },
          { title: '冲刺模考', ratio: 0.15 },
          { title: '考前回顾', ratio: 0.1 },
        ]
  const out: Array<{ title: string; startDate: DateStr; endDate: DateStr }> = []
  let cursor = 0
  let cursorDate = start
  for (let i = 0; i < segments.length; i++) {
    const isLast = i === segments.length - 1
    const len = isLast ? total - cursor : Math.max(1, Math.round(total * segments[i].ratio))
    const endDate = addDays(cursorDate, len - 1)
    out.push({ title: segments[i].title, startDate: cursorDate, endDate: isLast ? examDate : endDate })
    cursor += len
    cursorDate = addDays(cursorDate, len)
  }
  return out
}

/** 阶段冲突检测：同考试内日期重叠或越过考试日 */
export function checkPhaseConflict(
  phases: Array<{ id: string; startDate: DateStr; endDate: DateStr }>,
  candidate: { id?: string; startDate: DateStr; endDate: DateStr },
  examDate: DateStr,
): string | null {
  if (candidate.startDate < candidate.endDate || candidate.startDate === candidate.endDate) {
    // 起止顺序由校验层保证；这里检查越界
  }
  if (candidate.endDate > examDate) return `阶段结束日（${candidate.endDate}）不能晚于考试日（${examDate}）`
  for (const p of phases) {
    if (p.id && candidate.id && p.id === candidate.id) continue
    const overlap = p.startDate <= candidate.endDate && candidate.startDate <= p.endDate
    if (overlap) return `与现有阶段（${p.startDate} ~ ${p.endDate}）日期重叠`
  }
  return null
}

/** 考试范围内应规划的日期（今天起至考试日；已过考试返回空） */
export function plannableDates(exam: Pick<Exam, 'examDate' | 'startDate' | 'status'>, today: DateStr): DateStr[] {
  if (exam.status !== 'active' || exam.examDate < today) return []
  const from = exam.startDate && exam.startDate > today ? exam.startDate : today
  const to = exam.examDate
  const out: DateStr[] = []
  for (let d = from; d <= to && out.length < 400; d = addDays(d, 1)) out.push(d)
  return out
}

/** 按星期默认值推每天可用分钟（无覆盖记录时用于预算估算展示） */
export function weekdayDefaultMinutes(weekday: number, defaults: Array<{ weekday: number; minutes: number }>): number | null {
  const hit = defaults.find((d) => d.weekday === weekday)
  return hit ? hit.minutes : null
}

export function weekdayOf(date: DateStr): number {
  return dayOfWeekMon1(date)
}
