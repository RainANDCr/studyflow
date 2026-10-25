import type { AppSettings, Checkin, DailyPlan, Exam, ExamDayAvailability, ExamGoalLink, ExamPhase, ExamPlanSlot, ExamReviewItem, FocusSession, GlobalStudyAvailability, Goal, KnowledgeItem, MasteryAssessment, Milestone, MilestoneStep, StudyCalendarPreference, V4Table, WeeklyReview } from '../domain/types'
import type { ExportPayloadInput } from '../domain/validation'

export type StorageKind = 'indexeddb' | 'sqlite'

/**
 * 统一数据访问接口：Web（IndexedDB）与原生（SQLite）行为一致。
 * UI 与业务层只依赖本接口，平台判断只允许出现在 storage/index.ts 适配层。
 */
export interface StudyRepository {
  readonly kind: StorageKind
  /** 打开/升级数据库并执行迁移；幂等。 */
  init(): Promise<void>
  getAllGoals(): Promise<Goal[]>
  createGoal(goal: Goal): Promise<void>
  updateGoal(goal: Goal): Promise<void>
  /** 级联删除对应打卡记录 */
  deleteGoal(goalId: string): Promise<void>
  getAllCheckins(): Promise<Checkin[]>
  addCheckin(checkin: Checkin): Promise<void>
  deleteCheckin(checkinId: string): Promise<void>
  /** 批量归属/取消归属里程碑（未分配区手动关联） */
  updateCheckinsMilestone(checkinIds: string[], milestoneId: string | null): Promise<void>

  /* ---- 学习日历（DailyPlan，goalId+date 唯一，upsert 幂等） ---- */
  getAllDailyPlans(): Promise<DailyPlan[]>
  getDailyPlansByGoal(goalId: string): Promise<DailyPlan[]>
  upsertDailyPlans(plans: DailyPlan[]): Promise<void>
  /** 自动重排应用：新增/修改与删除在同一事务内完成，禁止半成功 */
  applyDailyPlanChanges(upserts: DailyPlan[], deleteIds: string[]): Promise<void>
  deleteDailyPlan(planId: string): Promise<void>

  /* ---- 里程碑 ---- */
  getAllMilestones(): Promise<Milestone[]>
  getMilestonesByGoal(goalId: string): Promise<Milestone[]>
  upsertMilestones(milestones: Milestone[]): Promise<void>
  deleteMilestone(milestoneId: string): Promise<void>
  /** 删除里程碑后其打卡仅置 milestoneId=null（不删记录） */
  getAllMilestoneSteps(): Promise<MilestoneStep[]>
  upsertMilestoneSteps(steps: MilestoneStep[]): Promise<void>
  deleteMilestoneStep(stepId: string): Promise<void>

  /* ---- 专注会话 ---- */
  getAllFocusSessions(): Promise<FocusSession[]>
  upsertFocusSession(session: FocusSession): Promise<void>
  deleteFocusSession(sessionId: string): Promise<void>

  /* ---- 学习日历偏好 ---- */
  getCalendarPref(goalId: string): Promise<StudyCalendarPreference | null>
  saveCalendarPref(pref: StudyCalendarPreference): Promise<void>
  getAllCalendarPrefs(): Promise<StudyCalendarPreference[]>

  /* ---- v3：知识点与自评 ---- */
  getAllKnowledgeItems(): Promise<KnowledgeItem[]>
  upsertKnowledgeItems(items: KnowledgeItem[]): Promise<void>
  /** 删除知识点连带其全部评估历史（同事务） */
  deleteKnowledgeItem(itemId: string): Promise<void>
  getAllAssessments(): Promise<MasteryAssessment[]>
  upsertAssessments(assessments: MasteryAssessment[]): Promise<void>
  deleteAssessment(assessmentId: string): Promise<void>

  /* ---- v3：考试冲刺 ---- */
  getAllExams(): Promise<Exam[]>
  upsertExams(exams: Exam[]): Promise<void>
  /** 删除考试连带其关联/阶段/可用时间/排程/清单（同事务）；不动 Goal/Checkin/Milestone/评估 */
  deleteExam(examId: string): Promise<void>
  getAllExamGoalLinks(): Promise<ExamGoalLink[]>
  upsertExamGoalLinks(links: ExamGoalLink[]): Promise<void>
  deleteExamGoalLink(linkId: string): Promise<void>
  getAllExamPhases(): Promise<ExamPhase[]>
  upsertExamPhases(phases: ExamPhase[]): Promise<void>
  deleteExamPhase(phaseId: string): Promise<void>
  getAllExamDayAvailabilities(): Promise<ExamDayAvailability[]>
  upsertExamDayAvailabilities(rows: ExamDayAvailability[]): Promise<void>
  deleteExamDayAvailability(id: string): Promise<void>
  getAllGlobalAvailabilities(): Promise<GlobalStudyAvailability[]>
  upsertGlobalAvailability(row: GlobalStudyAvailability): Promise<void>
  getAllExamPlanSlots(): Promise<ExamPlanSlot[]>
  upsertExamPlanSlots(slots: ExamPlanSlot[]): Promise<void>
  deleteExamPlanSlot(slotId: string): Promise<void>
  getAllExamReviewItems(): Promise<ExamReviewItem[]>
  upsertExamReviewItems(items: ExamReviewItem[]): Promise<void>
  deleteExamReviewItem(itemId: string): Promise<void>

  /* ---- v4：通用小表子仓储（生命周期/预算/修订/随记/断点/报告等） ---- */
  getV4All(table: V4Table): Promise<unknown[]>
  putV4(table: V4Table, rows: unknown[]): Promise<void>
  deleteV4(table: V4Table, keys: string[]): Promise<void>
  getWeeklyReview(weekStart: string): Promise<WeeklyReview | null>
  getAllReviews(): Promise<WeeklyReview[]>
  /** 按 weekStart 更新而不重复插入 */
  upsertWeeklyReview(review: WeeklyReview): Promise<void>
  getSettings(): Promise<AppSettings | null>
  saveSettings(settings: AppSettings): Promise<void>
  /** 仅清除演示数据（isDemo=true 的目标与打卡），不影响用户自建内容 */
  clearDemoData(): Promise<void>
  /** 清空全部业务数据并重置设置 */
  clearAll(): Promise<void>
  /** 导入：replace=整库替换；merge=跳过重复 ID 保留现有。接受 v1/v2 备份 */
  replaceAll(payload: ExportPayloadInput, mode: 'replace' | 'merge'): Promise<{ goals: number; checkins: number; reviews: number; skipped: number }>
  close(): Promise<void>
}

export class StorageError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message)
    this.name = 'StorageError'
  }
}
