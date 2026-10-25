import Dexie, { type Table } from 'dexie'
import type { AppSettings, Checkin, DailyPlan, Exam, ExamDayAvailability, ExamGoalLink, ExamPhase, ExamPlanSlot, ExamReviewItem, FocusSession, GlobalStudyAvailability, Goal, KnowledgeItem, MasteryAssessment, Milestone, MilestoneStep, StudyCalendarPreference, V4Table, WeeklyReview } from '../domain/types'
import type { ExportPayloadInput } from '../domain/validation'
import { SCHEMA_VERSION } from '../domain/types'
import type { StudyRepository } from './types'

interface SettingsRow {
  key: string
  value: AppSettings
}

class StudyflowDb extends Dexie {
  goals!: Table<Goal, string>
  checkins!: Table<Checkin, string>
  reviews!: Table<WeeklyReview, string>
  settings!: Table<SettingsRow, string>
  dailyPlans!: Table<DailyPlan, string>
  milestones!: Table<Milestone, string>
  milestoneSteps!: Table<MilestoneStep, string>
  focusSessions!: Table<FocusSession, string>
  calendarPrefs!: Table<StudyCalendarPreference, string>
  knowledgeItems!: Table<KnowledgeItem, string>
  masteryAssessments!: Table<MasteryAssessment, string>
  exams!: Table<Exam, string>
  examGoalLinks!: Table<ExamGoalLink, string>
  examPhases!: Table<ExamPhase, string>
  examDayAvailabilities!: Table<ExamDayAvailability, string>
  globalAvailabilities!: Table<GlobalStudyAvailability, string>
  examPlanSlots!: Table<ExamPlanSlot, string>
  examReviewItems!: Table<ExamReviewItem, string>
  goalLifecycles!: Table<Record<string, unknown>, string>
  goalStatusEvents!: Table<Record<string, unknown>, string>
  weeklyAvailability!: Table<Record<string, unknown>, number>
  availabilityExceptions!: Table<Record<string, unknown>, string>
  goalPlanPolicies!: Table<Record<string, unknown>, string>
  planRevisions!: Table<Record<string, unknown>, string>
  studyNotes!: Table<Record<string, unknown>, string>
  studyResumePoints!: Table<Record<string, unknown>, string>
  studyReports!: Table<Record<string, unknown>, string>

  constructor() {
    super('studyflow')
    // schema version 1（初始实体）；v2 新增五大功能实体并给 checkins 加 milestoneId 索引。
    // 历史版本定义禁止修改，升级策略只允许追加。
    this.version(1).stores({
      goals: 'id, updatedAt',
      checkins: 'id, goalId, date, [goalId+date]',
      reviews: 'weekStart',
      settings: 'key',
    })
    this.version(2).stores({
      checkins: 'id, goalId, date, milestoneId, [goalId+date], [goalId+milestoneId]',
      dailyPlans: 'id, goalId, date, [goalId+date]',
      milestones: 'id, goalId, [goalId+sortOrder]',
      milestoneSteps: 'id, milestoneId, [milestoneId+sortOrder]',
      focusSessions: 'id, goalId, status, startedAt, linkedCheckinId',
      calendarPrefs: 'goalId',
    })
    // v4：11 项通用功能（生命周期/预算/修订/随记/断点/报告）
    this.version(4).stores({
      goalLifecycles: 'goalId, manualStatus',
      goalStatusEvents: 'id, goalId, occurredAt',
      weeklyAvailability: 'weekday',
      availabilityExceptions: 'date',
      goalPlanPolicies: 'goalId',
      planRevisions: 'id, createdAt',
      studyNotes: 'id, goalId, date, [goalId+date]',
      studyResumePoints: 'goalId',
      studyReports: 'id, periodType, periodStart',
    })
    // v3：双轨进度 + 考试冲刺
    this.version(3).stores({
      knowledgeItems: 'id, goalId, milestoneId, [goalId+isArchived], [goalId+sortOrder]',
      masteryAssessments: 'id, knowledgeItemId, [knowledgeItemId+assessedAt], localDate',
      exams: 'id, examDate, status',
      examGoalLinks: 'id, examId, goalId, [examId+goalId]',
      examPhases: 'id, examId, [examId+sortOrder]',
      examDayAvailabilities: 'id, examId, date, [examId+date]',
      globalAvailabilities: 'date',
      examPlanSlots: 'id, examId, goalId, date, [examId+date], isLocked',
      examReviewItems: 'id, examId, goalId, [examId+sortOrder], knowledgeItemId',
    })
  }
}

/** Web 端实现：浏览器 IndexedDB（Dexie），数据在重启浏览器后保留（除非用户清除站点数据）。 */
export class WebIndexedDbRepository implements StudyRepository {
  readonly kind = 'indexeddb' as const
  private db: StudyflowDb | null = null

  private get store(): StudyflowDb {
    if (!this.db) throw new Error('数据库尚未初始化，请先调用 init()')
    return this.db
  }

  async init(): Promise<void> {
    if (!this.db) {
      this.db = new StudyflowDb()
      await this.db.open()
    }
  }

  async getAllGoals(): Promise<Goal[]> {
    return this.store.goals.toArray()
  }

  async createGoal(goal: Goal): Promise<void> {
    await this.store.goals.add(goal)
  }

  async updateGoal(goal: Goal): Promise<void> {
    await this.store.goals.put(goal)
  }

  async deleteGoal(goalId: string): Promise<void> {
    await this.store.transaction(
      'rw',
      [this.store.goals, this.store.checkins, this.store.dailyPlans, this.store.milestones, this.store.milestoneSteps, this.store.focusSessions, this.store.knowledgeItems, this.store.masteryAssessments, this.store.examGoalLinks, this.store.examPlanSlots, this.store.examReviewItems, this.store.goalLifecycles, this.store.goalStatusEvents, this.store.goalPlanPolicies, this.store.studyNotes, this.store.studyResumePoints],
      async () => {
        // 既有语义：删除目标级联删除其全部打卡记录
        await this.store.checkins.where('goalId').equals(goalId).delete()
        const msIds = (await this.store.milestones.where('goalId').equals(goalId).toArray()).map((m) => m.id)
        for (const mid of msIds) {
          await this.store.milestoneSteps.where('milestoneId').equals(mid).delete()
        }
        await this.store.milestones.where('goalId').equals(goalId).delete()
        await this.store.dailyPlans.where('goalId').equals(goalId).delete()
        // v3：知识点（连带评估）、考试关联、该目标的排程与清单；考试本体保留
        const kIds = (await this.store.knowledgeItems.where('goalId').equals(goalId).toArray()).map((k) => k.id)
        for (const kid of kIds) {
          await this.store.masteryAssessments.where('knowledgeItemId').equals(kid).delete()
        }
        await this.store.knowledgeItems.where('goalId').equals(goalId).delete()
        await this.store.examGoalLinks.where('goalId').equals(goalId).delete()
        await this.store.examPlanSlots.where('goalId').equals(goalId).delete()
        await this.store.examReviewItems.where('goalId').equals(goalId).delete()
        // v4：生命周期/事件/策略/随记/断点清除
        await this.store.goalLifecycles.delete(goalId)
        const evIds = (await this.store.goalStatusEvents.where('goalId').equals(goalId).toArray()).map((e) => String(e.id))
        await this.store.goalStatusEvents.bulkDelete(evIds)
        await this.store.goalPlanPolicies.delete(goalId)
        const noteIds = (await this.store.studyNotes.where('goalId').equals(goalId).toArray()).map((n) => String(n.id))
        await this.store.studyNotes.bulkDelete(noteIds)
        await this.store.studyResumePoints.delete(goalId)
        // 专注历史保留，仅解除归属
        await this.store.focusSessions.where('goalId').equals(goalId).modify({ goalId: null, milestoneId: null })
        await this.store.goals.delete(goalId)
      },
    )
  }

  async getAllCheckins(): Promise<Checkin[]> {
    return this.store.checkins.toArray()
  }

  async addCheckin(checkin: Checkin): Promise<void> {
    await this.store.checkins.add(checkin)
  }

  async deleteCheckin(checkinId: string): Promise<void> {
    await this.store.transaction('rw', this.store.checkins, this.store.focusSessions, async () => {
      // 同事务解除专注会话关联，保留合法会话（改为独立计时记录）
      await this.store.focusSessions.where('linkedCheckinId').equals(checkinId).modify({ linkedCheckinId: null })
      await this.store.checkins.delete(checkinId)
    })
  }

  async updateCheckinsMilestone(checkinIds: string[], milestoneId: string | null): Promise<void> {
    for (const id of checkinIds) {
      const existing = await this.store.checkins.get(id)
      if (existing) await this.store.checkins.put({ ...existing, milestoneId, updatedAt: new Date().toISOString() })
    }
  }

  /* ---- 学习日历 ---- */

  async getAllDailyPlans(): Promise<DailyPlan[]> {
    return this.store.dailyPlans.toArray()
  }

  async getDailyPlansByGoal(goalId: string): Promise<DailyPlan[]> {
    return this.store.dailyPlans.where('goalId').equals(goalId).toArray()
  }

  async upsertDailyPlans(plans: DailyPlan[]): Promise<void> {
    // goalId+date 唯一：upsert 语义保证重复保存是幂等更新
    await this.store.transaction('rw', this.store.dailyPlans, async () => {
      for (const plan of plans) {
        const existing = await this.store.dailyPlans.where('[goalId+date]').equals([plan.goalId, plan.date]).first()
        if (existing) await this.store.dailyPlans.put({ ...plan, id: existing.id })
        else await this.store.dailyPlans.add(plan)
      }
    })
  }

  async deleteDailyPlan(planId: string): Promise<void> {
    await this.store.dailyPlans.delete(planId)
  }

  async applyDailyPlanChanges(upserts: DailyPlan[], deleteIds: string[]): Promise<void> {
    await this.store.transaction('rw', [this.store.dailyPlans], async () => {
      for (const plan of upserts) {
        const existing = await this.store.dailyPlans.where('[goalId+date]').equals([plan.goalId, plan.date]).first()
        if (existing) await this.store.dailyPlans.put({ ...plan, id: existing.id })
        else await this.store.dailyPlans.add(plan)
      }
      for (const id of deleteIds) {
        await this.store.dailyPlans.delete(id)
      }
    })
  }

  /* ---- 里程碑 ---- */

  async getAllMilestones(): Promise<Milestone[]> {
    return this.store.milestones.toArray()
  }

  async getMilestonesByGoal(goalId: string): Promise<Milestone[]> {
    const rows = await this.store.milestones.where('goalId').equals(goalId).toArray()
    return rows.sort((a, b) => a.sortOrder - b.sortOrder)
  }

  async upsertMilestones(milestones: Milestone[]): Promise<void> {
    await this.store.milestones.bulkPut(milestones)
  }

  async deleteMilestone(milestoneId: string): Promise<void> {
    await this.store.transaction('rw', [this.store.milestones, this.store.milestoneSteps, this.store.checkins, this.store.knowledgeItems], async () => {
      // 关联打卡与知识点仅置空归属，绝不级联删除
      await this.store.checkins.where('milestoneId').equals(milestoneId).modify({ milestoneId: null })
      await this.store.knowledgeItems.where('milestoneId').equals(milestoneId).modify({ milestoneId: null })
      await this.store.milestoneSteps.where('milestoneId').equals(milestoneId).delete()
      await this.store.milestones.delete(milestoneId)
    })
  }

  async getAllMilestoneSteps(): Promise<MilestoneStep[]> {
    return this.store.milestoneSteps.toArray()
  }

  async upsertMilestoneSteps(steps: MilestoneStep[]): Promise<void> {
    await this.store.milestoneSteps.bulkPut(steps)
  }

  async deleteMilestoneStep(stepId: string): Promise<void> {
    await this.store.milestoneSteps.delete(stepId)
  }

  /* ---- 专注会话 ---- */

  async getAllFocusSessions(): Promise<FocusSession[]> {
    return this.store.focusSessions.toArray()
  }

  async upsertFocusSession(session: FocusSession): Promise<void> {
    await this.store.focusSessions.put(session)
  }

  async deleteFocusSession(sessionId: string): Promise<void> {
    await this.store.focusSessions.delete(sessionId)
  }

  /* ---- 学习日历偏好 ---- */

  async getCalendarPref(goalId: string): Promise<StudyCalendarPreference | null> {
    return (await this.store.calendarPrefs.where('goalId').equals(goalId).first()) ?? null
  }

  async saveCalendarPref(pref: StudyCalendarPreference): Promise<void> {
    await this.store.calendarPrefs.put(pref)
  }

  async getWeeklyReview(weekStart: string): Promise<WeeklyReview | null> {
    return (await this.store.reviews.where('weekStart').equals(weekStart).first()) ?? null
  }

  async getAllReviews(): Promise<WeeklyReview[]> {
    return this.store.reviews.toArray()
  }

  async upsertWeeklyReview(review: WeeklyReview): Promise<void> {
    await this.store.reviews.put({ ...review, weekStart: review.weekStart })
  }

  async getSettings(): Promise<AppSettings | null> {
    const row = await this.store.settings.where('key').equals('app').first()
    return row?.value ?? null
  }

  async saveSettings(settings: AppSettings): Promise<void> {
    await this.store.settings.put({ key: 'app', value: { ...settings, schemaVersion: SCHEMA_VERSION } })
  }

  /* ---- v3：知识点与自评 ---- */

  async getAllKnowledgeItems(): Promise<KnowledgeItem[]> {
    return this.store.knowledgeItems.toArray()
  }

  async upsertKnowledgeItems(items: KnowledgeItem[]): Promise<void> {
    await this.store.knowledgeItems.bulkPut(items)
  }

  async deleteKnowledgeItem(itemId: string): Promise<void> {
    await this.store.transaction('rw', [this.store.knowledgeItems, this.store.masteryAssessments], async () => {
      await this.store.masteryAssessments.where('knowledgeItemId').equals(itemId).delete()
      await this.store.knowledgeItems.delete(itemId)
    })
  }

  async getAllAssessments(): Promise<MasteryAssessment[]> {
    return this.store.masteryAssessments.toArray()
  }

  async upsertAssessments(assessments: MasteryAssessment[]): Promise<void> {
    await this.store.masteryAssessments.bulkPut(assessments)
  }

  async deleteAssessment(assessmentId: string): Promise<void> {
    await this.store.masteryAssessments.delete(assessmentId)
  }

  /* ---- v3：考试冲刺 ---- */

  async getAllExams(): Promise<Exam[]> {
    return this.store.exams.toArray()
  }

  async upsertExams(exams: Exam[]): Promise<void> {
    await this.store.exams.bulkPut(exams)
  }

  async deleteExam(examId: string): Promise<void> {
    await this.store.transaction(
      'rw',
      [this.store.exams, this.store.examGoalLinks, this.store.examPhases, this.store.examDayAvailabilities, this.store.examPlanSlots, this.store.examReviewItems],
      async () => {
        await this.store.examGoalLinks.where('examId').equals(examId).delete()
        await this.store.examPhases.where('examId').equals(examId).delete()
        await this.store.examDayAvailabilities.where('examId').equals(examId).delete()
        await this.store.examPlanSlots.where('examId').equals(examId).delete()
        await this.store.examReviewItems.where('examId').equals(examId).delete()
        await this.store.exams.delete(examId)
      },
    )
  }

  async getAllExamGoalLinks(): Promise<ExamGoalLink[]> {
    return this.store.examGoalLinks.toArray()
  }

  async upsertExamGoalLinks(links: ExamGoalLink[]): Promise<void> {
    await this.store.examGoalLinks.bulkPut(links)
  }

  async deleteExamGoalLink(linkId: string): Promise<void> {
    await this.store.examGoalLinks.delete(linkId)
  }

  async getAllExamPhases(): Promise<ExamPhase[]> {
    return this.store.examPhases.toArray()
  }

  async upsertExamPhases(phases: ExamPhase[]): Promise<void> {
    await this.store.examPhases.bulkPut(phases)
  }

  async deleteExamPhase(phaseId: string): Promise<void> {
    await this.store.examPhases.delete(phaseId)
  }

  async getAllExamDayAvailabilities(): Promise<ExamDayAvailability[]> {
    return this.store.examDayAvailabilities.toArray()
  }

  async upsertExamDayAvailabilities(rows: ExamDayAvailability[]): Promise<void> {
    // examId+date 唯一：upsert 语义
    await this.store.transaction('rw', [this.store.examDayAvailabilities], async () => {
      for (const row of rows) {
        const existing = await this.store.examDayAvailabilities.where('[examId+date]').equals([row.examId, row.date]).first()
        if (existing) await this.store.examDayAvailabilities.put({ ...row, id: existing.id })
        else await this.store.examDayAvailabilities.add(row)
      }
    })
  }

  async deleteExamDayAvailability(id: string): Promise<void> {
    await this.store.examDayAvailabilities.delete(id)
  }

  async getAllGlobalAvailabilities(): Promise<GlobalStudyAvailability[]> {
    return this.store.globalAvailabilities.toArray()
  }

  async upsertGlobalAvailability(row: GlobalStudyAvailability): Promise<void> {
    await this.store.globalAvailabilities.put(row)
  }

  async getAllExamPlanSlots(): Promise<ExamPlanSlot[]> {
    return this.store.examPlanSlots.toArray()
  }

  async upsertExamPlanSlots(slots: ExamPlanSlot[]): Promise<void> {
    await this.store.examPlanSlots.bulkPut(slots)
  }

  async deleteExamPlanSlot(slotId: string): Promise<void> {
    await this.store.examPlanSlots.delete(slotId)
  }

  async getAllExamReviewItems(): Promise<ExamReviewItem[]> {
    return this.store.examReviewItems.toArray()
  }

  async upsertExamReviewItems(items: ExamReviewItem[]): Promise<void> {
    await this.store.examReviewItems.bulkPut(items)
  }

  async deleteExamReviewItem(itemId: string): Promise<void> {
    await this.store.examReviewItems.delete(itemId)
  }

  async getAllCalendarPrefs(): Promise<StudyCalendarPreference[]> {
    return this.store.calendarPrefs.toArray()
  }

  /* ---- v4 通用子仓储 ---- */

  async getV4All(table: V4Table): Promise<unknown[]> {
    const store = (this.store as unknown as Record<string, { toArray(): Promise<unknown[]> }>)[table]
    return store.toArray()
  }

  async putV4(table: V4Table, rows: unknown[]): Promise<void> {
    const store = (this.store as unknown as Record<string, { bulkPut(rows: unknown[]): Promise<unknown> }>)[table]
    await store.bulkPut(rows)
  }

  async deleteV4(table: V4Table, keys: string[]): Promise<void> {
    const store = (this.store as unknown as Record<string, { bulkDelete(keys: string[]): Promise<unknown> }>)[table]
    await store.bulkDelete(keys)
  }

  async clearDemoData(): Promise<void> {
    // Dexie 不支持布尔索引，取全表后按 isDemo 过滤；复用 deleteGoal 的级联删除
    const demoGoalIds = (await this.store.goals.toArray()).filter((g) => g.isDemo).map((g) => g.id)
    for (const id of demoGoalIds) {
      await this.deleteGoal(id)
    }
    // 无主专注记录中可能存在演示会话；v3 演示评估/考试侧实体
    const demoSessions = (await this.store.focusSessions.toArray()).filter((x) => x.isDemo)
    for (const x of demoSessions) await this.store.focusSessions.delete(x.id)
    const demoAssessments = (await this.store.masteryAssessments.toArray()).filter((x) => x.isDemo)
    for (const x of demoAssessments) await this.store.masteryAssessments.delete(x.id)
    for (const table of [this.store.exams, this.store.examGoalLinks, this.store.examPhases, this.store.examDayAvailabilities, this.store.examPlanSlots, this.store.examReviewItems] as const) {
      const demoRows = (await table.toArray()).filter((r) => (r as { isDemo?: boolean }).isDemo === true)
      for (const r of demoRows) await table.delete(r.id)
    }
  }

  async clearAll(): Promise<void> {
    await this.store.transaction(
      'rw',
      [
        this.store.goals, this.store.checkins, this.store.reviews, this.store.settings,
        this.store.dailyPlans, this.store.milestones, this.store.milestoneSteps,
        this.store.focusSessions, this.store.calendarPrefs,
        this.store.knowledgeItems, this.store.masteryAssessments,
        this.store.exams, this.store.examGoalLinks, this.store.examPhases,
        this.store.examDayAvailabilities, this.store.globalAvailabilities,
        this.store.examPlanSlots, this.store.examReviewItems,
      ],
      async () => {
        await Promise.all([
          this.store.goals.clear(),
          this.store.checkins.clear(),
          this.store.reviews.clear(),
          this.store.settings.clear(),
          this.store.dailyPlans.clear(),
          this.store.milestones.clear(),
          this.store.milestoneSteps.clear(),
          this.store.focusSessions.clear(),
          this.store.calendarPrefs.clear(),
          this.store.knowledgeItems.clear(),
          this.store.masteryAssessments.clear(),
          this.store.exams.clear(),
          this.store.examGoalLinks.clear(),
          this.store.examPhases.clear(),
          this.store.examDayAvailabilities.clear(),
          this.store.globalAvailabilities.clear(),
          this.store.examPlanSlots.clear(),
          this.store.examReviewItems.clear(),
        ])
      },
    )
  }

  async replaceAll(payload: ExportPayloadInput, mode: 'replace' | 'merge'): Promise<{ goals: number; checkins: number; reviews: number; skipped: number }> {
    return this.store.transaction(
      'rw',
      [
        this.store.goals, this.store.checkins, this.store.reviews,
        this.store.dailyPlans, this.store.milestones, this.store.milestoneSteps,
        this.store.focusSessions, this.store.calendarPrefs,
        this.store.knowledgeItems, this.store.masteryAssessments,
        this.store.exams, this.store.examGoalLinks, this.store.examPhases,
        this.store.examDayAvailabilities, this.store.globalAvailabilities,
        this.store.examPlanSlots, this.store.examReviewItems,
      ],
      async () => {
      if (mode === 'replace') {
        await this.store.goals.clear()
        await this.store.checkins.clear()
        await this.store.reviews.clear()
        await this.store.dailyPlans.clear()
        await this.store.milestones.clear()
        await this.store.milestoneSteps.clear()
        await this.store.focusSessions.clear()
        await this.store.calendarPrefs.clear()
        await this.store.knowledgeItems.clear()
        await this.store.masteryAssessments.clear()
        await this.store.exams.clear()
        await this.store.examGoalLinks.clear()
        await this.store.examPhases.clear()
        await this.store.examDayAvailabilities.clear()
        await this.store.globalAvailabilities.clear()
        await this.store.examPlanSlots.clear()
        await this.store.examReviewItems.clear()
      }
      const existingGoals = new Set((await this.store.goals.toArray()).map((g) => g.id))
      const existingCheckins = new Set((await this.store.checkins.toArray()).map((c) => c.id))
      const existingReviews = new Set((await this.store.reviews.toArray()).map((r) => r.weekStart))
      let skipped = 0
      const goals = payload.goals.filter((g) => {
        if (existingGoals.has(g.id)) {
          skipped++
          return false
        }
        return true
      })
      const validGoalIds = new Set([...existingGoals, ...goals.map((g) => g.id)])
      const checkins = payload.checkins.filter((c) => {
        if (!validGoalIds.has(c.goalId)) {
          skipped++ // 关联缺失的记录拒绝导入
          return false
        }
        if (existingCheckins.has(c.id)) {
          skipped++
          return false
        }
        return true
      })
      const reviews = payload.reviews.filter((r) => {
        if (existingReviews.has(r.weekStart)) {
          skipped++
          return false
        }
        return true
      })

      // 新实体：以「导入后实际存在的目标/里程碑/打卡」为准做关联校验
      const finalGoalIds = validGoalIds
      const milestones = (payload.milestones ?? []).filter((m) => {
        if (!finalGoalIds.has(m.goalId) || existingGoals.has(m.id)) return (skipped++, false)
        return true
      })
      const milestoneIds = new Set([...(await this.store.milestones.toArray()).map((m) => m.id), ...milestones.map((m) => m.id)])
      const steps = (payload.milestoneSteps ?? []).filter((s) => {
        if (!milestoneIds.has(s.milestoneId)) return (skipped++, false)
        return true
      })
      const finalCheckinIds = new Set([...existingCheckins, ...checkins.map((c) => c.id)])
      const sessions = (payload.focusSessions ?? []).filter((s) => {
        if (existingCheckins.has(s.id)) return (skipped++, false)
        if (s.goalId && !finalGoalIds.has(s.goalId)) return (skipped++, false)
        if (s.milestoneId && !milestoneIds.has(s.milestoneId)) return (skipped++, false)
        if (s.linkedCheckinId && !finalCheckinIds.has(s.linkedCheckinId)) return (skipped++, false)
        return true
      })
      const plans = (payload.dailyPlans ?? []).filter((p) => {
        if (!finalGoalIds.has(p.goalId)) return (skipped++, false)
        return true
      })

      await this.store.goals.bulkAdd(goals)
      // v1 备份可能缺 milestoneId：写入前归一化为 null
      await this.store.checkins.bulkAdd(checkins.map((c) => ({ ...c, milestoneId: c.milestoneId ?? null })))
      await this.store.reviews.bulkPut(reviews)
      if (milestones.length) await this.store.milestones.bulkAdd(milestones)
      if (steps.length) await this.store.milestoneSteps.bulkAdd(steps)
      for (const s of sessions) await this.store.focusSessions.put(s)
      for (const p of plans) await this.upsertDailyPlansInTx(p)
      for (const pref of payload.calendarPrefs ?? []) {
        if (finalGoalIds.has(pref.goalId)) await this.store.calendarPrefs.put(pref)
      }

      /* ---- v3：关联校验后写入 ---- */
      const existingKnowledge = new Set((await this.store.knowledgeItems.toArray()).map((k) => k.id))
      const knowledge = (payload.knowledgeItems ?? []).filter((k) => {
        if (!finalGoalIds.has(k.goalId) || existingKnowledge.has(k.id)) return (skipped++, false)
        if (k.milestoneId && !milestoneIds.has(k.milestoneId)) return (skipped++, false)
        return true
      })
      const knowledgeIds = new Set([...existingKnowledge, ...knowledge.map((k) => k.id)])
      const assessments = (payload.masteryAssessments ?? []).filter((a) => {
        if (!knowledgeIds.has(a.knowledgeItemId)) return (skipped++, false)
        return true
      }).map((a) => ({ ...a, rating: a.rating as MasteryAssessment['rating'] }))
      const existingExams = new Set((await this.store.exams.toArray()).map((e) => e.id))
      const exams = (payload.exams ?? []).filter((e) => {
        if (existingExams.has(e.id)) return (skipped++, false)
        return true
      })
      const examIds = new Set([...existingExams, ...exams.map((e) => e.id)])
      const links = (payload.examGoalLinks ?? []).filter((l) => {
        if (!examIds.has(l.examId) || !finalGoalIds.has(l.goalId)) return (skipped++, false)
        return true
      })
      const phases = (payload.examPhases ?? []).filter((p) => {
        if (!examIds.has(p.examId)) return (skipped++, false)
        return true
      })
      const phaseIds = new Set([...(await this.store.examPhases.toArray()).map((p) => p.id), ...phases.map((p) => p.id)])
      const availabilities = (payload.examDayAvailabilities ?? []).filter((a) => {
        if (!examIds.has(a.examId)) return (skipped++, false)
        return true
      })
      const slots = (payload.examPlanSlots ?? []).filter((p) => {
        if (!examIds.has(p.examId) || !finalGoalIds.has(p.goalId)) return (skipped++, false)
        if (p.knowledgeItemId && !knowledgeIds.has(p.knowledgeItemId)) return (skipped++, false)
        if (p.phaseId && !phaseIds.has(p.phaseId)) return (skipped++, false)
        return true
      })
      const reviewItems = (payload.examReviewItems ?? []).filter((r) => {
        if (!examIds.has(r.examId)) return (skipped++, false)
        if (r.knowledgeItemId && !knowledgeIds.has(r.knowledgeItemId)) return (skipped++, false)
        if (r.goalId && !finalGoalIds.has(r.goalId)) return (skipped++, false)
        return true
      })

      // v4 通用表：goal 关联的行校验后写入
      const v4Data = payload.v4 ?? {}
      for (const [table, rows] of Object.entries(v4Data)) {
        if (!Array.isArray(rows) || rows.length === 0) continue
        const filtered = (rows as Array<Record<string, unknown>>).filter((r) => {
          const gid = r.goalId ?? r.goal_id
          if (typeof gid === 'string' && gid !== '') return finalGoalIds.has(gid)
          return true
        })
        if (filtered.length > 0) await this.putV4(table as V4Table, filtered)
      }
      if (knowledge.length) await this.store.knowledgeItems.bulkAdd(knowledge)
      await this.store.masteryAssessments.bulkPut(assessments)
      if (exams.length) await this.store.exams.bulkAdd(exams)
      await this.store.examGoalLinks.bulkPut(links)
      await this.store.examPhases.bulkPut(phases)
      for (const a of availabilities) await this.upsertExamDayAvailabilityInTx(a)
      for (const g of payload.globalAvailabilities ?? []) await this.store.globalAvailabilities.put(g)
      await this.store.examPlanSlots.bulkPut(slots)
      await this.store.examReviewItems.bulkPut(reviewItems)
      return { goals: goals.length, checkins: checkins.length, reviews: reviews.length, skipped }
    })
  }

  /** replaceAll 事务内部专用：单条考试可用时间 upsert（外层已开事务） */
  private async upsertExamDayAvailabilityInTx(row: ExamDayAvailability): Promise<void> {
    const existing = await this.store.examDayAvailabilities.where('[examId+date]').equals([row.examId, row.date]).first()
    if (existing) await this.store.examDayAvailabilities.put({ ...row, id: existing.id })
    else await this.store.examDayAvailabilities.add(row)
  }

  /** replaceAll 事务内部专用：单条计划 upsert（外层已开事务） */
  private async upsertDailyPlansInTx(plan: DailyPlan): Promise<void> {
    const existing = await this.store.dailyPlans.where('[goalId+date]').equals([plan.goalId, plan.date]).first()
    if (existing) await this.store.dailyPlans.put({ ...plan, id: existing.id })
    else await this.store.dailyPlans.add(plan)
  }

  async close(): Promise<void> {
    await this.db?.close()
    this.db = null
  }
}
