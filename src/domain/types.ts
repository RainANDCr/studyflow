/** 本地日历日期，格式 YYYY-MM-DD。业务中所有「日期」均指该类型，绝不混用 UTC ISO 时间戳。 */
export type DateStr = string

export type ColorKey = (typeof COLOR_KEYS)[number]

export const COLOR_KEYS = ['violet', 'emerald', 'blue', 'rose', 'amber', 'cyan'] as const

export const COLOR_HEX: Record<ColorKey, string> = {
  violet: '#7c5cff',
  emerald: '#10a678',
  blue: '#2f7cf6',
  rose: '#f0567a',
  amber: '#e8a23c',
  cyan: '#18b3c6',
}

/** 当前面板在 UI 上的中文名（用于无障碍描述，颜色不作为唯一辨识手段） */
export const COLOR_NAMES: Record<ColorKey, string> = {
  violet: '紫',
  emerald: '绿',
  blue: '蓝',
  rose: '玫红',
  amber: '琥珀',
  cyan: '青',
}

export interface Goal {
  id: string
  name: string
  /** 自定义单位：单词 / 页 / 课时 / 题 / 小节 等 */
  unit: string
  totalAmount: number
  startDate: DateStr
  deadline: DateStr
  color: ColorKey
  /** 最容易拦住我的障碍（可选） */
  obstacle: string | null
  /** 如果它出现，我就……（可选，WOOP 预案） */
  ifThenPlan: string | null
  weeklyRestEnabled: boolean
  isDemo: boolean
  createdAt: string
  updatedAt: string
}

export interface Checkin {
  id: string
  goalId: string
  /** 实际归属的本地日历日期（统计、补记、连续天数、周报与推算都以它为准） */
  date: DateStr
  amount: number
  /** 未填写必须是 null，不可臆测 */
  minutes: number | null
  note: string | null
  isBackfill: boolean
  isDemo: boolean
  /** 关联的里程碑；null = 未归属阶段（不参与阶段进度，但始终计入主目标总进度） */
  milestoneId: string | null
  createdAt: string
  updatedAt: string
}

export interface WeeklyReview {
  id: string
  /** 本地周一日期，唯一 */
  weekStart: DateStr
  keep: string
  problem: string
  tryNext: string
  nextPlan: string
  createdAt: string
  updatedAt: string
}

export interface AppSettings {
  schemaVersion: number
  demoSeeded: boolean
  lastSavedAt: string | null
}

export const SCHEMA_VERSION = 4

/* ---------------- 五大功能新增实体 ---------------- */

/** 学习日历计划：goalId+date 唯一；计划只是「准备做」，实际完成只由 Checkin 决定。 */
export interface DailyPlan {
  id: string
  goalId: string
  date: DateStr
  plannedAmount: number
  source: 'auto' | 'manual'
  isDemo: boolean
  createdAt: string
  updatedAt: string
}

/** 里程碑：主目标的有序阶段；量化进度只由关联的 Checkin 求和。 */
export interface Milestone {
  id: string
  goalId: string
  title: string
  plannedAmount: number
  startDate: DateStr | null
  dueDate: DateStr | null
  sortOrder: number
  color: ColorKey | null
  isDemo: boolean
  createdAt: string
  updatedAt: string
}

/** 里程碑小步骤：纯勾选清单，不参与量化进度。 */
export interface MilestoneStep {
  id: string
  milestoneId: string
  title: string
  isDone: boolean
  doneAt: string | null
  sortOrder: number
  createdAt: string
  updatedAt: string
}

export type FocusSessionStatus = 'active' | 'completed' | 'interrupted' | 'abandoned'

/** 专注会话：内部统一存秒；focusedSeconds 为实际有效专注秒数（扣除暂停）。 */
export interface FocusSession {
  id: string
  goalId: string | null
  milestoneId: string | null
  startedAt: string
  endedAt: string | null
  plannedSeconds: number
  focusedSeconds: number
  status: FocusSessionStatus
  /** 关联的打卡；关联后投入分钟按 Checkin.minutes 统计，会话不再叠加 */
  linkedCheckinId: string | null
  /** 已累计的暂停秒数（恢复计时用） */
  pausedSeconds: number
  /** 暂停开始的时间戳；null=计时中或已结束 */
  lastPauseAt: string | null
  isDemo: boolean
  createdAt: string
  updatedAt: string
}

/** 每目标学习日历偏好：与「每周弹性休息日」是两套独立规则。 */
export interface StudyCalendarPreference {
  goalId: string
  /** 学习日（1=周一 … 7=周日） */
  studyWeekdays: number[]
  /** 排除的特定日期（考试周、旅行等） */
  excludedDates: DateStr[]
  /** 每日计划上限；null=不设上限 */
  dailyCap: number | null
}

/* ---------------- 双轨进度 + 考试冲刺（v3） ---------------- */

/** 知识点：掌握覆盖率的最小单元；weight 仅用于掌握率，与目标单位量无关。 */
export interface KnowledgeItem {
  id: string
  goalId: string
  milestoneId: string | null
  title: string
  description: string | null
  /** 有限正数，默认 1 */
  weight: number
  sortOrder: number
  /** 归档后不纳入当前掌握率分母，保留全部评估历史 */
  isArchived: boolean
  isDemo: boolean
  createdAt: string
  updatedAt: string
}

export type MasteryRating = 0 | 1 | 2 | 3 | 4

/** 掌握度自评事件：追加保存不覆盖；当前掌握结果 = 最新一条的计算投影 */
export interface MasteryAssessment {
  id: string
  knowledgeItemId: string
  rating: MasteryRating
  assessedAt: string
  /** 自评归属的本地日历日（补录按此显示，不用录入时间冒充学习日期） */
  localDate: DateStr
  note: string | null
  source: 'self'
  isDemo: boolean
  createdAt: string
}

export type ExamStatus = 'active' | 'completed' | 'archived'

/** 考试档案：examDate 为本地自然日；已过考试停止生成未来计划但保留历史 */
export interface Exam {
  id: string
  title: string
  examDate: DateStr
  examTime: string | null
  startDate: DateStr | null
  status: ExamStatus
  notes: string | null
  isDemo: boolean
  createdAt: string
  updatedAt: string
}

/** 考试-目标关联：不复制目标与打卡；priorityWeight 正数，用于建议份额 */
export interface ExamGoalLink {
  id: string
  examId: string
  goalId: string
  priorityWeight: number
  isDemo: boolean
  createdAt: string
}

/** 备考阶段：同考试内日期不重叠且不越过考试日（冲突报错，不静默覆盖） */
export interface ExamPhase {
  id: string
  examId: string
  title: string
  startDate: DateStr
  endDate: DateStr
  sortOrder: number
  focusNote: string | null
  isDemo: boolean
  createdAt: string
  updatedAt: string
}

/** 每天可投入时间：0=明确休息；缺记录=尚未规划（二者语义不同） */
export interface ExamDayAvailability {
  id: string
  examId: string
  date: DateStr
  availableMinutes: number
  source: 'manual' | 'generated'
  isDemo: boolean
  createdAt: string
  updatedAt: string
}

/** 跨考试全局每日总预算：date 唯一；未配置必须明示，不得猜某考试上限为全局 */
export interface GlobalStudyAvailability {
  date: DateStr
  availableMinutes: number
  createdAt: string
  updatedAt: string
}

/** 考试学习排程条目：时间预算层，不是 Checkin.amount 也不是实际专注分钟 */
export interface ExamPlanSlot {
  id: string
  examId: string
  goalId: string
  date: DateStr
  plannedMinutes: number
  title: string | null
  knowledgeItemId: string | null
  phaseId: string | null
  source: 'manual' | 'generated'
  isLocked: boolean
  isDemo: boolean
  createdAt: string
  updatedAt: string
}

export type ExamPriority = 'high' | 'medium' | 'low'

/** 考前重点清单：勾选只改 doneAt，不改评分/打卡/专注 */
export interface ExamReviewItem {
  id: string
  examId: string
  title: string
  knowledgeItemId: string | null
  goalId: string | null
  priority: ExamPriority
  doneAt: string | null
  note: string | null
  sortOrder: number
  isDemo: boolean
  createdAt: string
  updatedAt: string
}

/* ---------------- 11 项通用功能（v4） ---------------- */

export type GoalManualStatus = 'active' | 'paused' | 'cancelled' | 'archived'

/** 目标生命周期：manualStatus 与「completed 由进度推导」分离 */
export interface GoalLifecycle {
  goalId: string
  manualStatus: GoalManualStatus
  /** 暂停/取消原因（可选） */
  note: string | null
  pausedAt: string | null
  isDemo: boolean
  updatedAt: string
}

export interface GoalStatusEvent {
  id: string
  goalId: string
  from: GoalManualStatus | 'none'
  to: GoalManualStatus
  reason: string | null
  occurredAt: string
}

/** 每周可用时间（本地周一起 1..7）；未设置≠0 */
export interface WeeklyAvailability {
  weekday: number
  availableMinutes: number
  updatedAt: string
}

/** 特定日期覆盖常规星期预算 */
export interface AvailabilityException {
  date: DateStr
  availableMinutes: number
  reason: string | null
  updatedAt: string
}

/** 目标计划策略：优先级与估时（manual=用户手填；derived=有足够样本的数据估计） */
export interface GoalPlanPolicy {
  goalId: string
  priority: number
  minutesPerUnit: number | null
  estimateSource: 'manual' | 'derived' | null
  estimateSampleCount: number | null
  updatedAt: string
}

/** 计划修订：重排历史与撤销快照 */
export interface PlanRevision {
  id: string
  createdAt: string
  effectiveFrom: DateStr
  trigger: string
  reason: string | null
  /** 变更摘要（写入 N 项 / 移除 M 项） */
  diffSummary: string
  /** 被替换前的未来 auto 计划快照（JSON），用于安全撤销 */
  undoSnapshot: string | null
}

/** 学习随记：纯文本，可关联目标/日期；不影响完成量与掌握率 */
export interface StudyNote {
  id: string
  goalId: string | null
  date: DateStr
  body: string
  mood: '进展' | '困难' | '调整' | '其他' | null
  createdAt: string
  updatedAt: string
}

/** 学习断点：每目标一条最新记录 */
export interface StudyResumePoint {
  goalId: string
  lastPosition: string | null
  nextAction: string | null
  updatedAt: string
}

export type ReportPeriodType = 'month' | 'quarter' | 'year'

/** 长期报告快照：保存统计口径与用户文字，可回看当时版本 */
export interface StudyReport {
  id: string
  periodType: ReportPeriodType
  periodStart: DateStr
  periodEnd: DateStr
  /** 统计快照 JSON */
  snapshot: string
  text: string
  createdAt: string
  updatedAt: string
}

/** v4 通用子仓储表名（小表整表加载；类型断言集中在校验过的 service 层） */
export type V4Table =
  | 'goalLifecycles'
  | 'goalStatusEvents'
  | 'weeklyAvailability'
  | 'availabilityExceptions'
  | 'goalPlanPolicies'
  | 'planRevisions'
  | 'studyNotes'
  | 'studyResumePoints'
  | 'studyReports'
