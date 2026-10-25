import { z } from 'zod'
import { COLOR_KEYS } from './types'
import { isValidDateStr } from './dates'

/** Zod 校验：表单输入、实体持久化、JSON 导入共用同一套规则。 */

const isoTs = z.string().min(1)

export const dateStrSchema = z
  .string()
  .refine(isValidDateStr, { message: '日期格式需为 YYYY-MM-DD' })

export const goalInputSchema = z
  .object({
    name: z.string().trim().min(1, '请填写目标名称').max(60, '名称最长 60 字'),
    unit: z.string().trim().min(1, '请填写单位，例如：词 / 页 / 节').max(10, '单位最长 10 字'),
    totalAmount: z
      .number({ invalid_type_error: '总量需为数字' })
      .positive('总量必须大于 0')
      .max(1_000_000, '总量过大'),
    startDate: dateStrSchema,
    deadline: dateStrSchema,
    color: z.enum(COLOR_KEYS),
    obstacle: z.string().trim().max(120, '最长 120 字').nullable(),
    ifThenPlan: z.string().trim().max(160, '最长 160 字').nullable(),
    weeklyRestEnabled: z.boolean(),
  })
  .refine((g) => g.deadline >= g.startDate, {
    message: '截止日不能早于开始日',
    path: ['deadline'],
  })

export type GoalInput = z.infer<typeof goalInputSchema>

export const checkinInputSchema = z
  .object({
    goalId: z.string().min(1),
    date: dateStrSchema,
    amount: z
      .number({ invalid_type_error: '数量需为数字' })
      .positive('数量必须大于 0')
      .max(1_000_000, '数量过大'),
    minutes: z
      .number({ invalid_type_error: '分钟数需为数字' })
      .int('分钟数需为整数')
      .min(0, '分钟数不能为负')
      .max(24 * 60, '一天最多 1440 分钟')
      .nullable(),
    note: z.string().trim().max(200, '备注最长 200 字').nullable(),
    isBackfill: z.boolean(),
    /** 可选关联里程碑（必须是同目标下的阶段，由调用方校验） */
    milestoneId: z.string().min(1).nullable().optional(),
  })

export type CheckinInput = z.infer<typeof checkinInputSchema>

export const weeklyReviewInputSchema = z.object({
  keep: z.string().trim().max(500, '最长 500 字'),
  problem: z.string().trim().max(500, '最长 500 字'),
  tryNext: z.string().trim().max(500, '最长 500 字'),
  nextPlan: z.string().trim().max(500, '最长 500 字'),
})

export type WeeklyReviewInput = z.infer<typeof weeklyReviewInputSchema>

/* ---------- JSON 导入导出 ---------- */

export const goalRecordSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  unit: z.string().min(1),
  totalAmount: z.number().positive(),
  startDate: dateStrSchema,
  deadline: dateStrSchema,
  color: z.enum(COLOR_KEYS),
  obstacle: z.string().nullable(),
  ifThenPlan: z.string().nullable(),
  weeklyRestEnabled: z.boolean(),
  isDemo: z.boolean(),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
})

export const checkinRecordSchema = z
  .object({
    id: z.string().min(1),
    goalId: z.string().min(1),
    date: dateStrSchema,
    amount: z.number().positive(),
    minutes: z.number().int().min(0).nullable(),
    note: z.string().nullable(),
    isBackfill: z.boolean(),
    isDemo: z.boolean(),
    /** v1 备份无此字段 → 归一化为 null（未归属阶段） */
    milestoneId: z.string().min(1).nullable().optional().default(null),
    createdAt: z.string().min(1),
    updatedAt: z.string().min(1),
  })
  .refine((c) => c.minutes === null || c.minutes >= 0, { message: '分钟数非法' })

export const weeklyReviewRecordSchema = z.object({
  id: z.string().min(1),
  weekStart: dateStrSchema,
  keep: z.string(),
  problem: z.string(),
  tryNext: z.string(),
  nextPlan: z.string(),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
})

/* ---------------- v2 新实体（导入导出/持久化共用） ---------------- */

export const dailyPlanRecordSchema = z.object({
  id: z.string().min(1),
  goalId: z.string().min(1),
  date: dateStrSchema,
  plannedAmount: z.number().positive(),
  source: z.enum(['auto', 'manual']),
  isDemo: z.boolean(),
  createdAt: isoTs,
  updatedAt: isoTs,
})

export const milestoneRecordSchema = z.object({
  id: z.string().min(1),
  goalId: z.string().min(1),
  title: z.string().min(1),
  plannedAmount: z.number().positive(),
  startDate: dateStrSchema.nullable(),
  dueDate: dateStrSchema.nullable(),
  sortOrder: z.number().int(),
  color: z.enum(COLOR_KEYS).nullable(),
  isDemo: z.boolean(),
  createdAt: isoTs,
  updatedAt: isoTs,
})

export const milestoneStepRecordSchema = z.object({
  id: z.string().min(1),
  milestoneId: z.string().min(1),
  title: z.string().min(1),
  isDone: z.boolean(),
  doneAt: z.string().nullable(),
  sortOrder: z.number().int(),
  createdAt: isoTs,
  updatedAt: isoTs,
})

export const focusSessionRecordSchema = z.object({
  id: z.string().min(1),
  goalId: z.string().min(1).nullable(),
  milestoneId: z.string().min(1).nullable(),
  startedAt: isoTs,
  endedAt: z.string().nullable(),
  plannedSeconds: z.number().int().positive(),
  focusedSeconds: z.number().int().min(0),
  status: z.enum(['active', 'completed', 'interrupted', 'abandoned']),
  linkedCheckinId: z.string().min(1).nullable(),
  pausedSeconds: z.number().int().min(0),
  lastPauseAt: z.string().nullable(),
  isDemo: z.boolean(),
  createdAt: isoTs,
  updatedAt: isoTs,
})

export const calendarPrefRecordSchema = z
  .object({
    goalId: z.string().min(1),
    studyWeekdays: z.array(z.number().int().min(1).max(7)).max(7),
    excludedDates: z.array(dateStrSchema),
    dailyCap: z.number().positive().nullable(),
  })
  .refine((p) => new Set(p.studyWeekdays).size === p.studyWeekdays.length, {
    message: '学习星期重复',
  })

export type DailyPlanInput = z.infer<typeof dailyPlanRecordSchema>
export type MilestoneInput = z.infer<typeof milestoneRecordSchema>
export type FocusSessionInput = z.infer<typeof focusSessionRecordSchema>

/* 表单/界面输入 */
export const knowledgeItemInputSchema = z.object({
  goalId: z.string().min(1),
  milestoneId: z.string().min(1).nullable(),
  title: z.string().trim().min(1, '请填写知识点标题').max(80, '最长 80 字'),
  description: z.string().trim().max(300, '最长 300 字').nullable(),
  weight: z.number().refine((v) => Number.isFinite(v) && v > 0, { message: '权重需为正数' }),
})
export type KnowledgeItemInput = z.infer<typeof knowledgeItemInputSchema>

export const assessmentInputSchema = z.object({
  knowledgeItemId: z.string().min(1),
  rating: z.number().int().min(0).max(4),
  localDate: dateStrSchema,
  note: z.string().trim().max(200, '最长 200 字').nullable(),
})

export const examInputSchema = z.object({
  title: z.string().trim().min(1, '请填写考试名称').max(60, '最长 60 字'),
  examDate: dateStrSchema,
  examTime: z.string().regex(/^\d{2}:\d{2}$/, '时间格式 HH:MM').nullable(),
  startDate: dateStrSchema.nullable(),
  notes: z.string().trim().max(300, '最长 300 字').nullable(),
})
export type ExamInput = z.infer<typeof examInputSchema>

export const examPhaseInputSchema = z
  .object({
    examId: z.string().min(1),
    title: z.string().trim().min(1, '请填写阶段名称').max(40, '最长 40 字'),
    startDate: dateStrSchema,
    endDate: dateStrSchema,
    focusNote: z.string().trim().max(200, '最长 200 字').nullable(),
  })
  .refine((p) => p.startDate <= p.endDate, { message: '阶段开始日不能晚于结束日' })

export const reviewItemInputSchema = z.object({
  examId: z.string().min(1),
  title: z.string().trim().min(1, '请填写条目标题').max(80, '最长 80 字'),
  knowledgeItemId: z.string().min(1).nullable(),
  goalId: z.string().min(1).nullable(),
  priority: z.enum(['high', 'medium', 'low']),
  note: z.string().trim().max(200, '最长 200 字').nullable(),
})

/* ---------------- v3：双轨进度 + 考试冲刺 ---------------- */

export const knowledgeItemRecordSchema = z.object({
  id: z.string().min(1),
  goalId: z.string().min(1),
  milestoneId: z.string().min(1).nullable(),
  title: z.string().min(1),
  description: z.string().nullable(),
  weight: z.number().refine((v) => Number.isFinite(v) && v > 0, { message: '权重需为有限正数' }),
  sortOrder: z.number().int(),
  isArchived: z.boolean(),
  isDemo: z.boolean(),
  createdAt: isoTs,
  updatedAt: isoTs,
})

export const masteryAssessmentRecordSchema = z.object({
  id: z.string().min(1),
  knowledgeItemId: z.string().min(1),
  rating: z.number().int().min(0).max(4),
  assessedAt: isoTs,
  localDate: dateStrSchema,
  note: z.string().nullable(),
  source: z.literal('self'),
  isDemo: z.boolean(),
  createdAt: isoTs,
})

export const examRecordSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  examDate: dateStrSchema,
  examTime: z.string().nullable(),
  startDate: dateStrSchema.nullable(),
  status: z.enum(['active', 'completed', 'archived']),
  notes: z.string().nullable(),
  isDemo: z.boolean(),
  createdAt: isoTs,
  updatedAt: isoTs,
})

export const examGoalLinkRecordSchema = z.object({
  id: z.string().min(1),
  examId: z.string().min(1),
  goalId: z.string().min(1),
  priorityWeight: z.number().positive(),
  isDemo: z.boolean(),
  createdAt: isoTs,
})

export const examPhaseRecordSchema = z
  .object({
    id: z.string().min(1),
    examId: z.string().min(1),
    title: z.string().min(1),
    startDate: dateStrSchema,
    endDate: dateStrSchema,
    sortOrder: z.number().int(),
    focusNote: z.string().nullable(),
    isDemo: z.boolean(),
    createdAt: isoTs,
    updatedAt: isoTs,
  })
  .refine((p) => p.startDate <= p.endDate, { message: '阶段开始日不能晚于结束日' })

export const examDayAvailabilityRecordSchema = z.object({
  id: z.string().min(1),
  examId: z.string().min(1),
  date: dateStrSchema,
  availableMinutes: z.number().int().min(0),
  source: z.enum(['manual', 'generated']),
  isDemo: z.boolean(),
  createdAt: isoTs,
  updatedAt: isoTs,
})

export const globalAvailabilityRecordSchema = z.object({
  date: dateStrSchema,
  availableMinutes: z.number().int().min(0),
  createdAt: isoTs,
  updatedAt: isoTs,
})

export const examPlanSlotRecordSchema = z.object({
  id: z.string().min(1),
  examId: z.string().min(1),
  goalId: z.string().min(1),
  date: dateStrSchema,
  plannedMinutes: z.number().int().min(0),
  title: z.string().nullable(),
  knowledgeItemId: z.string().min(1).nullable(),
  phaseId: z.string().min(1).nullable(),
  source: z.enum(['manual', 'generated']),
  isLocked: z.boolean(),
  isDemo: z.boolean(),
  createdAt: isoTs,
  updatedAt: isoTs,
})

export const examReviewItemRecordSchema = z.object({
  id: z.string().min(1),
  examId: z.string().min(1),
  title: z.string().min(1),
  knowledgeItemId: z.string().min(1).nullable(),
  goalId: z.string().min(1).nullable(),
  priority: z.enum(['high', 'medium', 'low']),
  doneAt: z.string().nullable(),
  note: z.string().nullable(),
  sortOrder: z.number().int(),
  isDemo: z.boolean(),
  createdAt: isoTs,
  updatedAt: isoTs,
})

/* ---------------- 导出备份：v2（新增实体），兼容导入 v1 ---------------- */

const basePayloadShape = {
  app: z.literal('studyflow'),
  schemaVersion: z.number().int().min(1),
  exportedAt: z.string().min(1),
  goals: z.array(goalRecordSchema),
  checkins: z.array(checkinRecordSchema),
  reviews: z.array(weeklyReviewRecordSchema),
}

export const exportPayloadSchema = z.object({
  ...basePayloadShape,
  schemaVersion: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]),
  dailyPlans: z.array(dailyPlanRecordSchema).optional().default([]),
  milestones: z.array(milestoneRecordSchema).optional().default([]),
  milestoneSteps: z.array(milestoneStepRecordSchema).optional().default([]),
  focusSessions: z.array(focusSessionRecordSchema).optional().default([]),
  calendarPrefs: z.array(calendarPrefRecordSchema).optional().default([]),
  knowledgeItems: z.array(knowledgeItemRecordSchema).optional().default([]),
  masteryAssessments: z.array(masteryAssessmentRecordSchema).optional().default([]),
  exams: z.array(examRecordSchema).optional().default([]),
  examGoalLinks: z.array(examGoalLinkRecordSchema).optional().default([]),
  examPhases: z.array(examPhaseRecordSchema).optional().default([]),
  examDayAvailabilities: z.array(examDayAvailabilityRecordSchema).optional().default([]),
  globalAvailabilities: z.array(globalAvailabilityRecordSchema).optional().default([]),
  examPlanSlots: z.array(examPlanSlotRecordSchema).optional().default([]),
  examReviewItems: z.array(examReviewItemRecordSchema).optional().default([]),
  /** v4 通用小表（生命周期/预算/修订/随记/断点/报告）；旧备份缺省为空 */
  v4: z.record(z.string(), z.array(z.unknown())).optional().default({}),
})

export type ExportPayload = z.infer<typeof exportPayloadSchema>
/** 导入边界接受的输入型：v1 旧文件可缺省新实体数组 */
export type ExportPayloadInput = z.input<typeof exportPayloadSchema>
