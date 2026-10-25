import type { AppSettings, Checkin, ColorKey, DailyPlan, Exam, ExamDayAvailability, ExamGoalLink, ExamPhase, ExamPlanSlot, ExamPriority, ExamReviewItem, ExamStatus, FocusSession, GlobalStudyAvailability, Goal, KnowledgeItem, MasteryAssessment, Milestone, MilestoneStep, StudyCalendarPreference, V4Table, WeeklyReview } from '../domain/types'
import { SCHEMA_VERSION } from '../domain/types'
import type { ExportPayloadInput } from '../domain/validation'
import type { StudyRepository } from './types'
import { SQLITE_MIGRATIONS } from './migrations/sqlite'

/**
 * 原生端实现（Windows / Android，Tauri 2 + tauri-plugin-sql + SQLite）。
 * 数据库文件保存在应用私有数据目录，安装后离线可用。
 *
 * 说明：本类依赖 Tauri 运行时（仅原生窗口中存在），通过 storage/index.ts
 * 动态导入加载；Web 构建不会实例化它。本机未安装 Rust 工具链时无法集成测试，
 * 接口行为与 WebIndexedDbRepository 保持一致（共享契约见 src/tests/storage.test.ts）。
 */

const DB_URI = 'sqlite:studyflow.db'

interface GoalRow {
  id: string
  name: string
  unit: string
  total_amount: number
  start_date: string
  deadline: string
  color: string
  obstacle: string | null
  if_then_plan: string | null
  weekly_rest_enabled: number
  is_demo: number
  created_at: string
  updated_at: string
}

interface CheckinRow {
  id: string
  goal_id: string
  date: string
  amount: number
  minutes: number | null
  note: string | null
  is_backfill: number
  is_demo: number
  milestone_id: string | null
  created_at: string
  updated_at: string
}

interface ReviewRow {
  id: string
  week_start: string
  keep_text: string
  problem: string
  try_next: string
  next_plan: string
  created_at: string
  updated_at: string
}

/** 与 @tauri-apps/plugin-sql 的 Database 结构兼容的最小接口 */
interface Db {
  select<T>(query: string, values?: unknown[]): Promise<T[]>
  execute(query: string, values?: unknown[]): Promise<number>
  close(): Promise<void>
}

const b2i = (b: boolean) => (b ? 1 : 0)
const i2b = (i: unknown) => i === 1 || i === true

function rowToGoal(r: GoalRow): Goal {
  return {
    id: r.id,
    name: r.name,
    unit: r.unit,
    totalAmount: r.total_amount,
    startDate: r.start_date,
    deadline: r.deadline,
    color: r.color as ColorKey,
    obstacle: r.obstacle,
    ifThenPlan: r.if_then_plan,
    weeklyRestEnabled: i2b(r.weekly_rest_enabled),
    isDemo: i2b(r.is_demo),
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }
}

function rowToCheckin(r: CheckinRow): Checkin {
  return {
    id: r.id,
    goalId: r.goal_id,
    date: r.date,
    amount: r.amount,
    minutes: r.minutes,
    note: r.note,
    isBackfill: i2b(r.is_backfill),
    isDemo: i2b(r.is_demo),
    milestoneId: r.milestone_id ?? null,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }
}

function rowToReview(r: ReviewRow): WeeklyReview {
  return {
    id: r.id,
    weekStart: r.week_start,
    keep: r.keep_text,
    problem: r.problem,
    tryNext: r.try_next,
    nextPlan: r.next_plan,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }
}

/* ---------------- v2 新实体行映射 ---------------- */

interface DailyPlanRow {
  id: string
  goal_id: string
  date: string
  planned_amount: number
  source: string
  is_demo: number
  created_at: string
  updated_at: string
}

interface MilestoneRow {
  id: string
  goal_id: string
  title: string
  planned_amount: number
  start_date: string | null
  due_date: string | null
  sort_order: number
  color: string | null
  is_demo: number
  created_at: string
  updated_at: string
}

interface StepRow {
  id: string
  milestone_id: string
  title: string
  is_done: number
  done_at: string | null
  sort_order: number
  created_at: string
  updated_at: string
}

interface FocusSessionRow {
  id: string
  goal_id: string | null
  milestone_id: string | null
  started_at: string
  ended_at: string | null
  planned_seconds: number
  focused_seconds: number
  status: string
  linked_checkin_id: string | null
  paused_seconds: number
  last_pause_at: string | null
  is_demo: number
  created_at: string
  updated_at: string
}

interface PrefRow {
  goal_id: string
  study_weekdays: string
  excluded_dates: string
  daily_cap: number | null
}

function rowToPlan(r: DailyPlanRow): DailyPlan {
  return {
    id: r.id,
    goalId: r.goal_id,
    date: r.date,
    plannedAmount: r.planned_amount,
    source: r.source as 'auto' | 'manual',
    isDemo: i2b(r.is_demo),
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }
}

function rowToMilestone(r: MilestoneRow): Milestone {
  return {
    id: r.id,
    goalId: r.goal_id,
    title: r.title,
    plannedAmount: r.planned_amount,
    startDate: r.start_date,
    dueDate: r.due_date,
    sortOrder: r.sort_order,
    color: (r.color as ColorKey | null) ?? null,
    isDemo: i2b(r.is_demo),
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }
}

function rowToStep(r: StepRow): MilestoneStep {
  return {
    id: r.id,
    milestoneId: r.milestone_id,
    title: r.title,
    isDone: i2b(r.is_done),
    doneAt: r.done_at,
    sortOrder: r.sort_order,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }
}

function rowToSession(r: FocusSessionRow): FocusSession {
  return {
    id: r.id,
    goalId: r.goal_id,
    milestoneId: r.milestone_id,
    startedAt: r.started_at,
    endedAt: r.ended_at,
    plannedSeconds: r.planned_seconds,
    focusedSeconds: r.focused_seconds,
    status: r.status as FocusSession['status'],
    linkedCheckinId: r.linked_checkin_id,
    pausedSeconds: r.paused_seconds,
    lastPauseAt: r.last_pause_at,
    isDemo: i2b(r.is_demo),
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }
}

/* ---------------- v3 行映射 ---------------- */

interface KnowledgeRow {
  id: string
  goal_id: string
  milestone_id: string | null
  title: string
  description: string | null
  weight: number
  sort_order: number
  is_archived: number
  is_demo: number
  created_at: string
  updated_at: string
}

interface AssessmentRow {
  id: string
  knowledge_item_id: string
  rating: number
  assessed_at: string
  local_date: string
  note: string | null
  source: string
  is_demo: number
  created_at: string
}

interface ExamRow {
  id: string
  title: string
  exam_date: string
  exam_time: string | null
  start_date: string | null
  status: string
  notes: string | null
  is_demo: number
  created_at: string
  updated_at: string
}

interface LinkRow {
  id: string
  exam_id: string
  goal_id: string
  priority_weight: number
  is_demo: number
  created_at: string
}

interface PhaseRow {
  id: string
  exam_id: string
  title: string
  start_date: string
  end_date: string
  sort_order: number
  focus_note: string | null
  is_demo: number
  created_at: string
  updated_at: string
}

interface DayAvailRow {
  id: string
  exam_id: string
  date: string
  available_minutes: number
  source: string
  is_demo: number
  created_at: string
  updated_at: string
}

interface GlobalAvailRow {
  date: string
  available_minutes: number
  created_at: string
  updated_at: string
}

interface SlotRow {
  id: string
  exam_id: string
  goal_id: string
  date: string
  planned_minutes: number
  title: string | null
  knowledge_item_id: string | null
  phase_id: string | null
  source: string
  is_locked: number
  is_demo: number
  created_at: string
  updated_at: string
}

interface ReviewItemRow {
  id: string
  exam_id: string
  title: string
  knowledge_item_id: string | null
  goal_id: string | null
  priority: string
  done_at: string | null
  note: string | null
  sort_order: number
  is_demo: number
  created_at: string
  updated_at: string
}

function rowToKnowledge(r: KnowledgeRow): KnowledgeItem {
  return {
    id: r.id,
    goalId: r.goal_id,
    milestoneId: r.milestone_id,
    title: r.title,
    description: r.description,
    weight: r.weight,
    sortOrder: r.sort_order,
    isArchived: i2b(r.is_archived),
    isDemo: i2b(r.is_demo),
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }
}

function rowToAssessment(r: AssessmentRow): MasteryAssessment {
  return {
    id: r.id,
    knowledgeItemId: r.knowledge_item_id,
    rating: r.rating as MasteryAssessment['rating'],
    assessedAt: r.assessed_at,
    localDate: r.local_date,
    note: r.note,
    source: 'self',
    isDemo: i2b(r.is_demo),
    createdAt: r.created_at,
  }
}

function rowToExam(r: ExamRow): Exam {
  return {
    id: r.id,
    title: r.title,
    examDate: r.exam_date,
    examTime: r.exam_time,
    startDate: r.start_date,
    status: r.status as ExamStatus,
    notes: r.notes,
    isDemo: i2b(r.is_demo),
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }
}

function rowToLink(r: LinkRow): ExamGoalLink {
  return {
    id: r.id,
    examId: r.exam_id,
    goalId: r.goal_id,
    priorityWeight: r.priority_weight,
    isDemo: i2b(r.is_demo),
    createdAt: r.created_at,
  }
}

function rowToPhase(r: PhaseRow): ExamPhase {
  return {
    id: r.id,
    examId: r.exam_id,
    title: r.title,
    startDate: r.start_date,
    endDate: r.end_date,
    sortOrder: r.sort_order,
    focusNote: r.focus_note,
    isDemo: i2b(r.is_demo),
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }
}

function rowToDayAvail(r: DayAvailRow): ExamDayAvailability {
  return {
    id: r.id,
    examId: r.exam_id,
    date: r.date,
    availableMinutes: r.available_minutes,
    source: r.source as 'manual' | 'generated',
    isDemo: i2b(r.is_demo),
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }
}

function rowToGlobalAvail(r: GlobalAvailRow): GlobalStudyAvailability {
  return { date: r.date, availableMinutes: r.available_minutes, createdAt: r.created_at, updatedAt: r.updated_at }
}

function rowToSlot(r: SlotRow): ExamPlanSlot {
  return {
    id: r.id,
    examId: r.exam_id,
    goalId: r.goal_id,
    date: r.date,
    plannedMinutes: r.planned_minutes,
    title: r.title,
    knowledgeItemId: r.knowledge_item_id,
    phaseId: r.phase_id,
    source: r.source as 'manual' | 'generated',
    isLocked: i2b(r.is_locked),
    isDemo: i2b(r.is_demo),
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }
}

function rowToReviewItem(r: ReviewItemRow): ExamReviewItem {
  return {
    id: r.id,
    examId: r.exam_id,
    title: r.title,
    knowledgeItemId: r.knowledge_item_id,
    goalId: r.goal_id,
    priority: r.priority as ExamPriority,
    doneAt: r.done_at,
    note: r.note,
    sortOrder: r.sort_order,
    isDemo: i2b(r.is_demo),
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }
}

function rowToPref(r: PrefRow): StudyCalendarPreference {
  let weekdays: number[] = []
  let excluded: string[] = []
  try {
    weekdays = JSON.parse(r.study_weekdays) as number[]
    excluded = JSON.parse(r.excluded_dates) as string[]
  } catch {
    // 损坏的偏好按默认值处理
  }
  return { goalId: r.goal_id, studyWeekdays: weekdays, excludedDates: excluded, dailyCap: r.daily_cap }
}

export class TauriSqliteRepository implements StudyRepository {
  readonly kind = 'sqlite' as const
  private db: Db | null = null

  private get store(): Db {
    if (!this.db) throw new Error('数据库尚未初始化，请先调用 init()')
    return this.db
  }

  async init(): Promise<void> {
    if (this.db) return
    const { default: Database } = await import('@tauri-apps/plugin-sql')
    this.db = (await Database.load(DB_URI)) as unknown as Db
    await this.store.execute('PRAGMA foreign_keys = ON')
    await this.migrate()
  }

  private async migrate(): Promise<void> {
    const rows = await this.store.select<{ user_version: number }>('PRAGMA user_version')
    const current = typeof rows[0]?.user_version === 'number' ? rows[0].user_version : 0
    for (let v = current; v < SQLITE_MIGRATIONS.length; v++) {
      const statements = SQLITE_MIGRATIONS[v]
      await this.transaction(async () => {
        for (const sql of statements) await this.store.execute(sql)
        await this.store.execute(`PRAGMA user_version = ${v + 1}`)
      })
    }
  }

  /** 单连接 SQLite 上用 BEGIN/COMMIT 保证原子性；失败回滚并向上抛错。 */
  private async transaction<T>(fn: () => Promise<T>): Promise<T> {
    await this.store.execute('BEGIN')
    try {
      const result = await fn()
      await this.store.execute('COMMIT')
      return result
    } catch (err) {
      await this.store.execute('ROLLBACK').catch(() => undefined)
      throw err
    }
  }

  async getAllGoals(): Promise<Goal[]> {
    const rows = await this.store.select<GoalRow>('SELECT * FROM goals')
    return rows.map(rowToGoal)
  }

  async createGoal(goal: Goal): Promise<void> {
    await this.store.execute(
      'INSERT INTO goals (id, name, unit, total_amount, start_date, deadline, color, obstacle, if_then_plan, weekly_rest_enabled, is_demo, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)',
      [goal.id, goal.name, goal.unit, goal.totalAmount, goal.startDate, goal.deadline, goal.color, goal.obstacle, goal.ifThenPlan, b2i(goal.weeklyRestEnabled), b2i(goal.isDemo), goal.createdAt, goal.updatedAt],
    )
  }

  async updateGoal(goal: Goal): Promise<void> {
    await this.store.execute(
      'UPDATE goals SET name = $1, unit = $2, total_amount = $3, start_date = $4, deadline = $5, color = $6, obstacle = $7, if_then_plan = $8, weekly_rest_enabled = $9, is_demo = $10, updated_at = $11 WHERE id = $12',
      [goal.name, goal.unit, goal.totalAmount, goal.startDate, goal.deadline, goal.color, goal.obstacle, goal.ifThenPlan, b2i(goal.weeklyRestEnabled), b2i(goal.isDemo), goal.updatedAt, goal.id],
    )
  }

  async deleteGoal(goalId: string): Promise<void> {
    await this.transaction(async () => {
      // 既有语义：级联删除打卡；专注历史保留但解除归属
      await this.store.execute('UPDATE focus_sessions SET goal_id = NULL, milestone_id = NULL WHERE goal_id = $1', [goalId])
      await this.store.execute('DELETE FROM daily_plans WHERE goal_id = $1', [goalId])
      await this.store.execute('DELETE FROM milestones WHERE goal_id = $1', [goalId])
      // v3：知识点（连带评估）、考试关联、该目标的排程与清单；考试本体保留
      await this.store.execute('DELETE FROM mastery_assessments WHERE knowledge_item_id IN (SELECT id FROM knowledge_items WHERE goal_id = $1)', [goalId])
      await this.store.execute('DELETE FROM knowledge_items WHERE goal_id = $1', [goalId])
      await this.store.execute('DELETE FROM exam_goal_links WHERE goal_id = $1', [goalId])
      await this.store.execute('DELETE FROM exam_plan_slots WHERE goal_id = $1', [goalId])
      await this.store.execute('DELETE FROM exam_review_items WHERE goal_id = $1', [goalId])
      await this.store.execute('DELETE FROM goal_lifecycles WHERE goal_id = $1', [goalId])
      await this.store.execute('DELETE FROM goal_status_events WHERE goal_id = $1', [goalId])
      await this.store.execute('DELETE FROM goal_plan_policies WHERE goal_id = $1', [goalId])
      await this.store.execute('DELETE FROM study_notes WHERE goal_id = $1', [goalId])
      await this.store.execute('DELETE FROM study_resume_points WHERE goal_id = $1', [goalId])
      await this.store.execute('DELETE FROM checkins WHERE goal_id = $1', [goalId])
      await this.store.execute('DELETE FROM goals WHERE id = $1', [goalId])
    })
  }

  async getAllCheckins(): Promise<Checkin[]> {
    const rows = await this.store.select<CheckinRow>('SELECT * FROM checkins')
    return rows.map(rowToCheckin)
  }

  async addCheckin(checkin: Checkin): Promise<void> {
    await this.store.execute(
      'INSERT INTO checkins (id, goal_id, date, amount, minutes, note, is_backfill, is_demo, milestone_id, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)',
      [checkin.id, checkin.goalId, checkin.date, checkin.amount, checkin.minutes, checkin.note, b2i(checkin.isBackfill), b2i(checkin.isDemo), checkin.milestoneId ?? null, checkin.createdAt, checkin.updatedAt],
    )
  }

  async deleteCheckin(checkinId: string): Promise<void> {
    await this.transaction(async () => {
      // 同事务解除专注会话关联，保留合法会话
      await this.store.execute('UPDATE focus_sessions SET linked_checkin_id = NULL WHERE linked_checkin_id = $1', [checkinId])
      await this.store.execute('DELETE FROM checkins WHERE id = $1', [checkinId])
    })
  }

  async updateCheckinsMilestone(checkinIds: string[], milestoneId: string | null): Promise<void> {
    await this.transaction(async () => {
      for (const id of checkinIds) {
        await this.store.execute('UPDATE checkins SET milestone_id = $1, updated_at = $2 WHERE id = $3', [
          milestoneId,
          new Date().toISOString(),
          id,
        ])
      }
    })
  }

  /* ---- 学习日历 ---- */

  async getAllDailyPlans(): Promise<DailyPlan[]> {
    const rows = await this.store.select<DailyPlanRow>('SELECT * FROM daily_plans')
    return rows.map(rowToPlan)
  }

  async getDailyPlansByGoal(goalId: string): Promise<DailyPlan[]> {
    const rows = await this.store.select<DailyPlanRow>('SELECT * FROM daily_plans WHERE goal_id = $1', [goalId])
    return rows.map(rowToPlan)
  }

  async upsertDailyPlans(plans: DailyPlan[]): Promise<void> {
    await this.transaction(async () => {
      for (const p of plans) {
        await this.store.execute(
          'INSERT INTO daily_plans (id, goal_id, date, planned_amount, source, is_demo, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) ON CONFLICT(goal_id, date) DO UPDATE SET planned_amount = $4, source = $5, is_demo = $6, updated_at = $8',
          [p.id, p.goalId, p.date, p.plannedAmount, p.source, b2i(p.isDemo), p.createdAt, p.updatedAt],
        )
      }
    })
  }

  async deleteDailyPlan(planId: string): Promise<void> {
    await this.store.execute('DELETE FROM daily_plans WHERE id = $1', [planId])
  }

  async applyDailyPlanChanges(upserts: DailyPlan[], deleteIds: string[]): Promise<void> {
    await this.transaction(async () => {
      for (const p of upserts) {
        await this.store.execute(
          'INSERT INTO daily_plans (id, goal_id, date, planned_amount, source, is_demo, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) ON CONFLICT(goal_id, date) DO UPDATE SET planned_amount = $4, source = $5, is_demo = $6, updated_at = $8',
          [p.id, p.goalId, p.date, p.plannedAmount, p.source, b2i(p.isDemo), p.createdAt, p.updatedAt],
        )
      }
      for (const id of deleteIds) {
        await this.store.execute('DELETE FROM daily_plans WHERE id = $1', [id])
      }
    })
  }

  /* ---- 里程碑 ---- */

  async getAllMilestones(): Promise<Milestone[]> {
    const rows = await this.store.select<MilestoneRow>('SELECT * FROM milestones ORDER BY sort_order')
    return rows.map(rowToMilestone)
  }

  async getMilestonesByGoal(goalId: string): Promise<Milestone[]> {
    const rows = await this.store.select<MilestoneRow>('SELECT * FROM milestones WHERE goal_id = $1 ORDER BY sort_order', [goalId])
    return rows.map(rowToMilestone)
  }

  async upsertMilestones(milestones: Milestone[]): Promise<void> {
    await this.transaction(async () => {
      for (const m of milestones) {
        await this.store.execute(
          'INSERT INTO milestones (id, goal_id, title, planned_amount, start_date, due_date, sort_order, color, is_demo, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) ON CONFLICT(id) DO UPDATE SET title = $3, planned_amount = $4, start_date = $5, due_date = $6, sort_order = $7, color = $8, is_demo = $9, updated_at = $11',
          [m.id, m.goalId, m.title, m.plannedAmount, m.startDate, m.dueDate, m.sortOrder, m.color, b2i(m.isDemo), m.createdAt, m.updatedAt],
        )
      }
    })
  }

  async deleteMilestone(milestoneId: string): Promise<void> {
    await this.transaction(async () => {
      // 关联打卡与知识点仅置空归属，绝不级联删除
      await this.store.execute('UPDATE checkins SET milestone_id = NULL WHERE milestone_id = $1', [milestoneId])
      await this.store.execute('UPDATE focus_sessions SET milestone_id = NULL WHERE milestone_id = $1', [milestoneId])
      await this.store.execute('UPDATE knowledge_items SET milestone_id = NULL WHERE milestone_id = $1', [milestoneId])
      await this.store.execute('DELETE FROM milestone_steps WHERE milestone_id = $1', [milestoneId])
      await this.store.execute('DELETE FROM milestones WHERE id = $1', [milestoneId])
    })
  }

  async getAllMilestoneSteps(): Promise<MilestoneStep[]> {
    const rows = await this.store.select<StepRow>('SELECT * FROM milestone_steps ORDER BY sort_order')
    return rows.map(rowToStep)
  }

  async upsertMilestoneSteps(steps: MilestoneStep[]): Promise<void> {
    await this.transaction(async () => {
      for (const s of steps) {
        await this.store.execute(
          'INSERT INTO milestone_steps (id, milestone_id, title, is_done, done_at, sort_order, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) ON CONFLICT(id) DO UPDATE SET title = $3, is_done = $4, done_at = $5, sort_order = $6, updated_at = $8',
          [s.id, s.milestoneId, s.title, b2i(s.isDone), s.doneAt, s.sortOrder, s.createdAt, s.updatedAt],
        )
      }
    })
  }

  async deleteMilestoneStep(stepId: string): Promise<void> {
    await this.store.execute('DELETE FROM milestone_steps WHERE id = $1', [stepId])
  }

  /* ---- 专注会话 ---- */

  async getAllFocusSessions(): Promise<FocusSession[]> {
    const rows = await this.store.select<FocusSessionRow>('SELECT * FROM focus_sessions')
    return rows.map(rowToSession)
  }

  async upsertFocusSession(session: FocusSession): Promise<void> {
    await this.store.execute(
      'INSERT INTO focus_sessions (id, goal_id, milestone_id, started_at, ended_at, planned_seconds, focused_seconds, status, linked_checkin_id, paused_seconds, last_pause_at, is_demo, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14) ON CONFLICT(id) DO UPDATE SET goal_id = $2, milestone_id = $3, ended_at = $5, focused_seconds = $7, status = $8, linked_checkin_id = $9, paused_seconds = $10, last_pause_at = $11, updated_at = $14',
      [session.id, session.goalId, session.milestoneId, session.startedAt, session.endedAt, session.plannedSeconds, session.focusedSeconds, session.status, session.linkedCheckinId, session.pausedSeconds, session.lastPauseAt, b2i(session.isDemo), session.createdAt, session.updatedAt],
    )
  }

  async deleteFocusSession(sessionId: string): Promise<void> {
    await this.store.execute('DELETE FROM focus_sessions WHERE id = $1', [sessionId])
  }

  /* ---- 学习日历偏好 ---- */

  async getCalendarPref(goalId: string): Promise<StudyCalendarPreference | null> {
    const rows = await this.store.select<PrefRow>('SELECT * FROM calendar_prefs WHERE goal_id = $1', [goalId])
    return rows[0] ? rowToPref(rows[0]) : null
  }

  async saveCalendarPref(pref: StudyCalendarPreference): Promise<void> {
    await this.store.execute(
      'INSERT INTO calendar_prefs (goal_id, study_weekdays, excluded_dates, daily_cap) VALUES ($1, $2, $3, $4) ON CONFLICT(goal_id) DO UPDATE SET study_weekdays = $2, excluded_dates = $3, daily_cap = $4',
      [pref.goalId, JSON.stringify(pref.studyWeekdays), JSON.stringify(pref.excludedDates), pref.dailyCap],
    )
  }

  async getWeeklyReview(weekStart: string): Promise<WeeklyReview | null> {
    const rows = await this.store.select<ReviewRow>('SELECT * FROM weekly_reviews WHERE week_start = $1', [weekStart])
    return rows[0] ? rowToReview(rows[0]) : null
  }

  async getAllReviews(): Promise<WeeklyReview[]> {
    const rows = await this.store.select<ReviewRow>('SELECT * FROM weekly_reviews')
    return rows.map(rowToReview)
  }

  private async upsertReviewSql(review: WeeklyReview): Promise<void> {
    await this.store.execute(
      'INSERT INTO weekly_reviews (id, week_start, keep_text, problem, try_next, next_plan, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) ON CONFLICT(week_start) DO UPDATE SET keep_text = $3, problem = $4, try_next = $5, next_plan = $6, updated_at = $8',
      [review.id, review.weekStart, review.keep, review.problem, review.tryNext, review.nextPlan, review.createdAt, review.updatedAt],
    )
  }

  async upsertWeeklyReview(review: WeeklyReview): Promise<void> {
    await this.upsertReviewSql(review)
  }

  async getSettings(): Promise<AppSettings | null> {
    const rows = await this.store.select<{ value: string }>('SELECT value FROM app_settings WHERE key = $1', ['app'])
    if (rows.length === 0) return null
    try {
      const parsed = JSON.parse(rows[0].value) as AppSettings
      return { ...parsed, schemaVersion: SCHEMA_VERSION }
    } catch {
      return null
    }
  }

  async saveSettings(settings: AppSettings): Promise<void> {
    await this.store.execute(
      'INSERT INTO app_settings (key, value) VALUES ($1, $2) ON CONFLICT(key) DO UPDATE SET value = $2',
      ['app', JSON.stringify({ ...settings, schemaVersion: SCHEMA_VERSION })],
    )
  }

  /* ---- v3：知识点与自评 ---- */

  async getAllKnowledgeItems(): Promise<KnowledgeItem[]> {
    const rows = await this.store.select<KnowledgeRow>('SELECT * FROM knowledge_items ORDER BY sort_order')
    return rows.map(rowToKnowledge)
  }

  async upsertKnowledgeItems(items: KnowledgeItem[]): Promise<void> {
    await this.transaction(async () => {
      for (const k of items) {
        await this.store.execute(
          'INSERT INTO knowledge_items (id, goal_id, milestone_id, title, description, weight, sort_order, is_archived, is_demo, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) ON CONFLICT(id) DO UPDATE SET milestone_id = $3, title = $4, description = $5, weight = $6, sort_order = $7, is_archived = $8, is_demo = $9, updated_at = $11',
          [k.id, k.goalId, k.milestoneId, k.title, k.description, k.weight, k.sortOrder, b2i(k.isArchived), b2i(k.isDemo), k.createdAt, k.updatedAt],
        )
      }
    })
  }

  async deleteKnowledgeItem(itemId: string): Promise<void> {
    await this.transaction(async () => {
      await this.store.execute('DELETE FROM mastery_assessments WHERE knowledge_item_id = $1', [itemId])
      await this.store.execute('DELETE FROM knowledge_items WHERE id = $1', [itemId])
    })
  }

  async getAllAssessments(): Promise<MasteryAssessment[]> {
    const rows = await this.store.select<AssessmentRow>('SELECT * FROM mastery_assessments')
    return rows.map(rowToAssessment)
  }

  async upsertAssessments(assessments: MasteryAssessment[]): Promise<void> {
    await this.transaction(async () => {
      for (const a of assessments) {
        await this.store.execute(
          'INSERT INTO mastery_assessments (id, knowledge_item_id, rating, assessed_at, local_date, note, source, is_demo, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) ON CONFLICT(id) DO UPDATE SET rating = $3, assessed_at = $4, local_date = $5, note = $6',
          [a.id, a.knowledgeItemId, a.rating, a.assessedAt, a.localDate, a.note, a.source, b2i(a.isDemo), a.createdAt],
        )
      }
    })
  }

  async deleteAssessment(assessmentId: string): Promise<void> {
    await this.store.execute('DELETE FROM mastery_assessments WHERE id = $1', [assessmentId])
  }

  /* ---- v3：考试冲刺 ---- */

  async getAllExams(): Promise<Exam[]> {
    const rows = await this.store.select<ExamRow>('SELECT * FROM exams')
    return rows.map(rowToExam)
  }

  async upsertExams(exams: Exam[]): Promise<void> {
    await this.transaction(async () => {
      for (const e of exams) {
        await this.store.execute(
          'INSERT INTO exams (id, title, exam_date, exam_time, start_date, status, notes, is_demo, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) ON CONFLICT(id) DO UPDATE SET title = $2, exam_date = $3, exam_time = $4, start_date = $5, status = $6, notes = $7, is_demo = $8, updated_at = $10',
          [e.id, e.title, e.examDate, e.examTime, e.startDate, e.status, e.notes, b2i(e.isDemo), e.createdAt, e.updatedAt],
        )
      }
    })
  }

  async deleteExam(examId: string): Promise<void> {
    await this.transaction(async () => {
      await this.store.execute('DELETE FROM exam_goal_links WHERE exam_id = $1', [examId])
      await this.store.execute('DELETE FROM exam_phases WHERE exam_id = $1', [examId])
      await this.store.execute('DELETE FROM exam_day_availability WHERE exam_id = $1', [examId])
      await this.store.execute('DELETE FROM exam_plan_slots WHERE exam_id = $1', [examId])
      await this.store.execute('DELETE FROM exam_review_items WHERE exam_id = $1', [examId])
      await this.store.execute('DELETE FROM exams WHERE id = $1', [examId])
    })
  }

  async getAllExamGoalLinks(): Promise<ExamGoalLink[]> {
    const rows = await this.store.select<LinkRow>('SELECT * FROM exam_goal_links')
    return rows.map(rowToLink)
  }

  async upsertExamGoalLinks(links: ExamGoalLink[]): Promise<void> {
    await this.transaction(async () => {
      for (const l of links) {
        await this.store.execute(
          'INSERT INTO exam_goal_links (id, exam_id, goal_id, priority_weight, is_demo, created_at) VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT(exam_id, goal_id) DO UPDATE SET priority_weight = $4',
          [l.id, l.examId, l.goalId, l.priorityWeight, b2i(l.isDemo), l.createdAt],
        )
      }
    })
  }

  async deleteExamGoalLink(linkId: string): Promise<void> {
    await this.store.execute('DELETE FROM exam_goal_links WHERE id = $1', [linkId])
  }

  async getAllExamPhases(): Promise<ExamPhase[]> {
    const rows = await this.store.select<PhaseRow>('SELECT * FROM exam_phases ORDER BY sort_order')
    return rows.map(rowToPhase)
  }

  async upsertExamPhases(phases: ExamPhase[]): Promise<void> {
    await this.transaction(async () => {
      for (const p of phases) {
        await this.store.execute(
          'INSERT INTO exam_phases (id, exam_id, title, start_date, end_date, sort_order, focus_note, is_demo, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) ON CONFLICT(id) DO UPDATE SET title = $3, start_date = $4, end_date = $5, sort_order = $6, focus_note = $7, is_demo = $8, updated_at = $10',
          [p.id, p.examId, p.title, p.startDate, p.endDate, p.sortOrder, p.focusNote, b2i(p.isDemo), p.createdAt, p.updatedAt],
        )
      }
    })
  }

  async deleteExamPhase(phaseId: string): Promise<void> {
    await this.store.execute('DELETE FROM exam_phases WHERE id = $1', [phaseId])
  }

  async getAllExamDayAvailabilities(): Promise<ExamDayAvailability[]> {
    const rows = await this.store.select<DayAvailRow>('SELECT * FROM exam_day_availability')
    return rows.map(rowToDayAvail)
  }

  async upsertExamDayAvailabilities(rows: ExamDayAvailability[]): Promise<void> {
    await this.transaction(async () => {
      for (const a of rows) {
        await this.store.execute(
          'INSERT INTO exam_day_availability (id, exam_id, date, available_minutes, source, is_demo, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) ON CONFLICT(exam_id, date) DO UPDATE SET available_minutes = $4, source = $5, is_demo = $6, updated_at = $8',
          [a.id, a.examId, a.date, a.availableMinutes, a.source, b2i(a.isDemo), a.createdAt, a.updatedAt],
        )
      }
    })
  }

  async deleteExamDayAvailability(id: string): Promise<void> {
    await this.store.execute('DELETE FROM exam_day_availability WHERE id = $1', [id])
  }

  async getAllGlobalAvailabilities(): Promise<GlobalStudyAvailability[]> {
    const rows = await this.store.select<GlobalAvailRow>('SELECT * FROM global_availability')
    return rows.map(rowToGlobalAvail)
  }

  async upsertGlobalAvailability(row: GlobalStudyAvailability): Promise<void> {
    await this.store.execute(
      'INSERT INTO global_availability (date, available_minutes, created_at, updated_at) VALUES ($1, $2, $3, $4) ON CONFLICT(date) DO UPDATE SET available_minutes = $2, updated_at = $4',
      [row.date, row.availableMinutes, row.createdAt, row.updatedAt],
    )
  }

  async getAllExamPlanSlots(): Promise<ExamPlanSlot[]> {
    const rows = await this.store.select<SlotRow>('SELECT * FROM exam_plan_slots')
    return rows.map(rowToSlot)
  }

  async upsertExamPlanSlots(slots: ExamPlanSlot[]): Promise<void> {
    await this.transaction(async () => {
      for (const p of slots) {
        await this.store.execute(
          'INSERT INTO exam_plan_slots (id, exam_id, goal_id, date, planned_minutes, title, knowledge_item_id, phase_id, source, is_locked, is_demo, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) ON CONFLICT(id) DO UPDATE SET planned_minutes = $5, title = $6, knowledge_item_id = $7, phase_id = $8, source = $9, is_locked = $10, is_demo = $11, updated_at = $13',
          [p.id, p.examId, p.goalId, p.date, p.plannedMinutes, p.title, p.knowledgeItemId, p.phaseId, p.source, b2i(p.isLocked), b2i(p.isDemo), p.createdAt, p.updatedAt],
        )
      }
    })
  }

  async deleteExamPlanSlot(slotId: string): Promise<void> {
    await this.store.execute('DELETE FROM exam_plan_slots WHERE id = $1', [slotId])
  }

  async getAllExamReviewItems(): Promise<ExamReviewItem[]> {
    const rows = await this.store.select<ReviewItemRow>('SELECT * FROM exam_review_items ORDER BY sort_order')
    return rows.map(rowToReviewItem)
  }

  async upsertExamReviewItems(items: ExamReviewItem[]): Promise<void> {
    await this.transaction(async () => {
      for (const r of items) {
        await this.store.execute(
          'INSERT INTO exam_review_items (id, exam_id, title, knowledge_item_id, goal_id, priority, done_at, note, sort_order, is_demo, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) ON CONFLICT(id) DO UPDATE SET title = $3, knowledge_item_id = $4, goal_id = $5, priority = $6, done_at = $7, note = $8, sort_order = $9, is_demo = $10, updated_at = $12',
          [r.id, r.examId, r.title, r.knowledgeItemId, r.goalId, r.priority, r.doneAt, r.note, r.sortOrder, b2i(r.isDemo), r.createdAt, r.updatedAt],
        )
      }
    })
  }

  async deleteExamReviewItem(itemId: string): Promise<void> {
    await this.store.execute('DELETE FROM exam_review_items WHERE id = $1', [itemId])
  }

  async getAllCalendarPrefs(): Promise<StudyCalendarPreference[]> {
    const rows = await this.store.select<PrefRow>('SELECT * FROM calendar_prefs')
    return rows.map(rowToPref)
  }

  /* ---- v4 通用子仓储 ---- */

  async getV4All(table: V4Table): Promise<unknown[]> {
    const rows = await this.store.select<Record<string, unknown>>(`SELECT * FROM ${V4_SQL_NAMES[table]}`)
    return rows.map((r) => V4_ROW_MAP[table](r))
  }

  async putV4(table: V4Table, rows: unknown[]): Promise<void> {
    // v4 小表按主键 INSERT OR REPLACE（列名由实体键 camelCase → snake_case）
    await this.transaction(async () => {
      for (const row of rows) {
        const rec = row as Record<string, unknown>
        const cols = Object.keys(rec)
        const placeholders = cols.map((_, i) => `$${i + 1}`).join(', ')
        await this.store.execute(
          `INSERT OR REPLACE INTO ${V4_SQL_NAMES[table]} (${cols.map(camelToSnake).join(', ')}) VALUES (${placeholders})`,
          cols.map((c) => (typeof rec[c] === 'boolean' ? b2i(rec[c] as boolean) : rec[c])),
        )
      }
    })
  }

  async deleteV4(table: V4Table, keys: string[]): Promise<void> {
    await this.transaction(async () => {
      for (const key of keys) {
        await this.store.execute(`DELETE FROM ${V4_SQL_NAMES[table]} WHERE ${V4_PK[table]} = $1`, [key])
      }
    })
  }

  async clearDemoData(): Promise<void> {
    await this.transaction(async () => {
      await this.store.execute('DELETE FROM focus_sessions WHERE is_demo = 1')
      await this.store.execute('DELETE FROM mastery_assessments WHERE is_demo = 1')
      for (const table of ['exams', 'exam_goal_links', 'exam_phases', 'exam_day_availability', 'exam_plan_slots', 'exam_review_items']) {
        await this.store.execute(`DELETE FROM ${table} WHERE is_demo = 1`)
      }
      await this.store.execute('DELETE FROM checkins WHERE is_demo = 1')
      await this.store.execute('DELETE FROM goals WHERE is_demo = 1')
    })
  }

  async clearAll(): Promise<void> {
    await this.transaction(async () => {
      await this.store.execute('DELETE FROM mastery_assessments')
      await this.store.execute('DELETE FROM knowledge_items')
      await this.store.execute('DELETE FROM exam_review_items')
      await this.store.execute('DELETE FROM exam_plan_slots')
      await this.store.execute('DELETE FROM exam_day_availability')
      await this.store.execute('DELETE FROM exam_phases')
      await this.store.execute('DELETE FROM exam_goal_links')
      await this.store.execute('DELETE FROM exams')
      await this.store.execute('DELETE FROM global_availability')
      await this.store.execute('DELETE FROM focus_sessions')
      await this.store.execute('DELETE FROM daily_plans')
      await this.store.execute('DELETE FROM milestone_steps')
      await this.store.execute('DELETE FROM milestones')
      await this.store.execute('DELETE FROM checkins')
      await this.store.execute('DELETE FROM goals')
      await this.store.execute('DELETE FROM weekly_reviews')
      await this.store.execute('DELETE FROM calendar_prefs')
      await this.store.execute('DELETE FROM app_settings')
    })
  }

  async replaceAll(payload: ExportPayloadInput, mode: 'replace' | 'merge'): Promise<{ goals: number; checkins: number; reviews: number; skipped: number }> {
    return this.transaction(async () => {
      if (mode === 'replace') {
        await this.store.execute('DELETE FROM mastery_assessments')
        await this.store.execute('DELETE FROM knowledge_items')
        await this.store.execute('DELETE FROM exam_review_items')
        await this.store.execute('DELETE FROM exam_plan_slots')
        await this.store.execute('DELETE FROM exam_day_availability')
        await this.store.execute('DELETE FROM exam_phases')
        await this.store.execute('DELETE FROM exam_goal_links')
        await this.store.execute('DELETE FROM exams')
        await this.store.execute('DELETE FROM global_availability')
        await this.store.execute('DELETE FROM focus_sessions')
        await this.store.execute('DELETE FROM daily_plans')
        await this.store.execute('DELETE FROM milestone_steps')
        await this.store.execute('DELETE FROM milestones')
        await this.store.execute('DELETE FROM checkins')
        await this.store.execute('DELETE FROM goals')
        await this.store.execute('DELETE FROM weekly_reviews')
        await this.store.execute('DELETE FROM calendar_prefs')
      }
      const existingGoals = new Set((await this.getAllGoals()).map((g) => g.id))
      const existingCheckins = new Set((await this.getAllCheckins()).map((c) => c.id))
      const existingReviews = new Set(
        (await this.store.select<{ week_start: string }>('SELECT week_start FROM weekly_reviews')).map((r) => r.week_start),
      )
      let skipped = 0
      const goals: Goal[] = []
      for (const g of payload.goals) {
        if (existingGoals.has(g.id)) skipped++
        else goals.push(g)
      }
      const validGoalIds = new Set([...existingGoals, ...goals.map((g) => g.id)])
      const checkins: Checkin[] = []
      for (const c of payload.checkins) {
        if (!validGoalIds.has(c.goalId) || existingCheckins.has(c.id)) skipped++
        // v1 备份可能缺 milestoneId：归一化为 null
        else checkins.push({ ...c, milestoneId: c.milestoneId ?? null })
      }
      const reviews: WeeklyReview[] = []
      for (const r of payload.reviews) {
        if (existingReviews.has(r.weekStart)) skipped++
        else reviews.push(r)
      }
      // 新实体关联校验（以导入后实际存在为准）
      const milestones: Milestone[] = []
      for (const m of payload.milestones ?? []) {
        if (!validGoalIds.has(m.goalId) || existingGoals.has(m.id)) skipped++
        else milestones.push(m)
      }
      const milestoneIds = new Set([
        ...(await this.store.select<{ id: string }>('SELECT id FROM milestones')).map((r) => r.id),
        ...milestones.map((m) => m.id),
      ])
      const steps: MilestoneStep[] = []
      for (const s of payload.milestoneSteps ?? []) {
        if (!milestoneIds.has(s.milestoneId)) skipped++
        else steps.push(s)
      }
      const finalCheckinIds = new Set([...existingCheckins, ...checkins.map((c) => c.id)])
      const sessions: FocusSession[] = []
      for (const s of payload.focusSessions ?? []) {
        if (s.goalId && !validGoalIds.has(s.goalId)) skipped++
        else if (s.milestoneId && !milestoneIds.has(s.milestoneId)) skipped++
        else if (s.linkedCheckinId && !finalCheckinIds.has(s.linkedCheckinId)) skipped++
        else sessions.push(s)
      }
      const plans: DailyPlan[] = []
      for (const p of payload.dailyPlans ?? []) {
        if (!validGoalIds.has(p.goalId)) skipped++
        else plans.push(p)
      }
      for (const g of goals) await this.createGoal(g)
      // v1 备份可能缺 milestoneId：写入前归一化为 null
      for (const c of checkins) await this.addCheckin({ ...c, milestoneId: c.milestoneId ?? null })
      for (const r of reviews) await this.upsertReviewSql(r)
      if (milestones.length) await this.upsertMilestones(milestones)
      if (steps.length) await this.upsertMilestoneSteps(steps)
      for (const s of sessions) await this.upsertFocusSession(s)
      if (plans.length) await this.upsertDailyPlans(plans)
      for (const pref of payload.calendarPrefs ?? []) {
        if (validGoalIds.has(pref.goalId)) await this.saveCalendarPref(pref)
      }

      /* ---- v3：关联校验后写入 ---- */
      const existingKnowledge = new Set(
        (await this.store.select<{ id: string }>('SELECT id FROM knowledge_items')).map((r) => r.id),
      )
      const knowledge: KnowledgeItem[] = []
      for (const k of payload.knowledgeItems ?? []) {
        if (!validGoalIds.has(k.goalId) || existingKnowledge.has(k.id)) skipped++
        else if (k.milestoneId && !milestoneIds.has(k.milestoneId)) skipped++
        else knowledge.push(k)
      }
      const knowledgeIds = new Set([
        ...existingKnowledge,
        ...knowledge.map((k) => k.id),
        ...(await this.getAllKnowledgeItems()).map((k) => k.id),
      ])
      const assessments: MasteryAssessment[] = []
      for (const a of payload.masteryAssessments ?? []) {
        if (!knowledgeIds.has(a.knowledgeItemId)) skipped++
        else assessments.push({ ...a, rating: a.rating as MasteryAssessment['rating'] })
      }
      const existingExams = new Set((await this.store.select<{ id: string }>('SELECT id FROM exams')).map((r) => r.id))
      const exams: Exam[] = []
      for (const e of payload.exams ?? []) {
        if (existingExams.has(e.id)) skipped++
        else exams.push(e)
      }
      const examIds = new Set([
        ...existingExams,
        ...exams.map((e) => e.id),
        ...(await this.store.select<{ id: string }>('SELECT id FROM exams')).map((r) => r.id),
      ])
      const links: ExamGoalLink[] = []
      for (const l of payload.examGoalLinks ?? []) {
        if (!examIds.has(l.examId) || !validGoalIds.has(l.goalId)) skipped++
        else links.push(l)
      }
      const phases: ExamPhase[] = []
      for (const p of payload.examPhases ?? []) {
        if (!examIds.has(p.examId)) skipped++
        else phases.push(p)
      }
      const phaseIds = new Set([
        ...(await this.store.select<{ id: string }>('SELECT id FROM exam_phases')).map((r) => r.id),
        ...phases.map((p) => p.id),
      ])
      const availabilities: ExamDayAvailability[] = []
      for (const a of payload.examDayAvailabilities ?? []) {
        if (!examIds.has(a.examId)) skipped++
        else availabilities.push(a)
      }
      const slots: ExamPlanSlot[] = []
      for (const p of payload.examPlanSlots ?? []) {
        if (!examIds.has(p.examId) || !validGoalIds.has(p.goalId)) skipped++
        else if (p.knowledgeItemId && !knowledgeIds.has(p.knowledgeItemId)) skipped++
        else if (p.phaseId && !phaseIds.has(p.phaseId)) skipped++
        else slots.push(p)
      }
      const reviewItems: ExamReviewItem[] = []
      for (const r of payload.examReviewItems ?? []) {
        if (!examIds.has(r.examId)) skipped++
        else if (r.knowledgeItemId && !knowledgeIds.has(r.knowledgeItemId)) skipped++
        else if (r.goalId && !validGoalIds.has(r.goalId)) skipped++
        else reviewItems.push(r)
      }
      // v4 通用表：goal 关联的行校验后写入
      const v4Data = payload.v4 ?? {}
      for (const [table, rows] of Object.entries(v4Data)) {
        if (!Array.isArray(rows) || rows.length === 0) continue
        const filtered = (rows as Array<Record<string, unknown>>).filter((r) => {
          const gid = r.goalId ?? r.goal_id
          if (typeof gid === 'string' && gid !== '') return validGoalIds.has(gid)
          return true
        })
        if (filtered.length > 0) await this.putV4(table as V4Table, filtered)
      }
      if (knowledge.length) await this.upsertKnowledgeItems(knowledge)
      if (assessments.length) await this.upsertAssessments(assessments)
      if (exams.length) await this.upsertExams(exams)
      if (links.length) await this.upsertExamGoalLinks(links)
      if (phases.length) await this.upsertExamPhases(phases)
      if (availabilities.length) await this.upsertExamDayAvailabilities(availabilities)
      for (const g of payload.globalAvailabilities ?? []) await this.upsertGlobalAvailability(g)
      if (slots.length) await this.upsertExamPlanSlots(slots)
      if (reviewItems.length) await this.upsertExamReviewItems(reviewItems)
      return { goals: goals.length, checkins: checkins.length, reviews: reviews.length, skipped }
    })
  }

  async close(): Promise<void> {
    await this.db?.close()
    this.db = null
  }
}

/* ---------------- v4 通用子仓储映射 ---------------- */

const V4_SQL_NAMES: Record<V4Table, string> = {
  goalLifecycles: 'goal_lifecycles',
  goalStatusEvents: 'goal_status_events',
  weeklyAvailability: 'weekly_availability',
  availabilityExceptions: 'availability_exceptions',
  goalPlanPolicies: 'goal_plan_policies',
  planRevisions: 'plan_revisions',
  studyNotes: 'study_notes',
  studyResumePoints: 'study_resume_points',
  studyReports: 'study_reports',
}

const V4_PK: Record<V4Table, string> = {
  goalLifecycles: 'goal_id',
  goalStatusEvents: 'id',
  weeklyAvailability: 'weekday',
  availabilityExceptions: 'date',
  goalPlanPolicies: 'goal_id',
  planRevisions: 'id',
  studyNotes: 'id',
  studyResumePoints: 'goal_id',
  studyReports: 'id',
}

function camelToSnake(key: string): string {
  return key.replace(/[A-Z]/g, (m) => `_${m.toLowerCase()}`)
}

// 每表行映射：snake_case 行 → 实体对象（与实体字段一一对应）
const V4_ROW_MAP: Record<V4Table, (r: Record<string, unknown>) => unknown> = {
  goalLifecycles: (r) => ({
    goalId: r.goal_id,
    manualStatus: r.manual_status,
    note: r.note,
    pausedAt: r.paused_at,
    isDemo: i2b(r.is_demo),
    updatedAt: r.updated_at,
  }),
  goalStatusEvents: (r) => ({
    id: r.id,
    goalId: r.goal_id,
    from: r.from_status,
    to: r.to_status,
    reason: r.reason,
    occurredAt: r.occurred_at,
  }),
  weeklyAvailability: (r) => ({ weekday: r.weekday, availableMinutes: r.available_minutes, updatedAt: r.updated_at }),
  availabilityExceptions: (r) => ({ date: r.date, availableMinutes: r.available_minutes, reason: r.reason, updatedAt: r.updated_at }),
  goalPlanPolicies: (r) => ({
    goalId: r.goal_id,
    priority: r.priority,
    minutesPerUnit: r.minutes_per_unit,
    estimateSource: r.estimate_source,
    estimateSampleCount: r.estimate_sample_count,
    updatedAt: r.updated_at,
  }),
  planRevisions: (r) => ({
    id: r.id,
    createdAt: r.created_at,
    effectiveFrom: r.effective_from,
    trigger: r.trigger,
    reason: r.reason,
    diffSummary: r.diff_summary,
    undoSnapshot: r.undo_snapshot,
  }),
  studyNotes: (r) => ({
    id: r.id,
    goalId: r.goal_id,
    date: r.date,
    body: r.body,
    mood: r.mood,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }),
  studyResumePoints: (r) => ({ goalId: r.goal_id, lastPosition: r.last_position, nextAction: r.next_action, updatedAt: r.updated_at }),
  studyReports: (r) => ({
    id: r.id,
    periodType: r.period_type,
    periodStart: r.period_start,
    periodEnd: r.period_end,
    snapshot: r.snapshot,
    text: r.text,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }),
}
