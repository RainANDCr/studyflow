import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import type { AppSettings, Checkin, DailyPlan, Exam, ExamDayAvailability, ExamGoalLink, ExamPhase, ExamPlanSlot, ExamReviewItem, FocusSession, GlobalStudyAvailability, Goal, KnowledgeItem, MasteryAssessment, Milestone, MilestoneStep, StudyCalendarPreference, V4Table, WeeklyReview } from '../domain/types'
import { SCHEMA_VERSION } from '../domain/types'
import type { CheckinInput, ExportPayload, ExportPayloadInput, GoalInput, WeeklyReviewInput } from '../domain/validation'
import { checkinInputSchema, goalInputSchema, weeklyReviewInputSchema } from '../domain/validation'
import { addDays, todayStr } from '../domain/dates'
import { systemClock } from '../domain/clock'
import { computeGoalProgress } from '../domain/progress'
import { createRepository } from '../storage'
import type { StorageKind, StudyRepository } from '../storage/types'

export interface ImportResult {
  goals: number
  checkins: number
  reviews: number
  skipped: number
}

interface AppDataValue {
  ready: boolean
  initError: string | null
  goals: Goal[]
  checkins: Checkin[]
  reviews: WeeklyReview[]
  dailyPlans: DailyPlan[]
  milestones: Milestone[]
  milestoneSteps: MilestoneStep[]
  focusSessions: FocusSession[]
  calendarPrefs: StudyCalendarPreference[]
  knowledgeItems: KnowledgeItem[]
  assessments: MasteryAssessment[]
  exams: Exam[]
  examGoalLinks: ExamGoalLink[]
  examPhases: ExamPhase[]
  examDayAvailabilities: ExamDayAvailability[]
  globalAvailabilities: GlobalStudyAvailability[]
  examPlanSlots: ExamPlanSlot[]
  examReviewItems: ExamReviewItem[]
  v4: Partial<Record<V4Table, unknown[]>>
  settings: AppSettings | null
  storageKind: StorageKind | null
  today: string
  refreshing: boolean
  refresh: () => Promise<void>
  /** 初始化失败后重试 */
  retry: () => Promise<void>
  createGoal: (input: GoalInput) => Promise<Goal>
  updateGoal: (goalId: string, input: GoalInput) => Promise<void>
  deleteGoal: (goalId: string) => Promise<void>
  addCheckin: (input: CheckinInput) => Promise<Checkin>
  deleteCheckin: (checkinId: string) => Promise<void>
  assignCheckinsToMilestone: (checkinIds: string[], milestoneId: string | null) => Promise<void>
  saveDailyPlans: (plans: DailyPlan[]) => Promise<void>
  applyDailyPlanChanges: (upserts: DailyPlan[], deleteIds: string[]) => Promise<void>
  deleteDailyPlanById: (planId: string) => Promise<void>
  saveMilestones: (milestones: Milestone[]) => Promise<void>
  deleteMilestoneById: (milestoneId: string) => Promise<void>
  saveMilestoneSteps: (steps: MilestoneStep[]) => Promise<void>
  deleteMilestoneStepById: (stepId: string) => Promise<void>
  saveFocusSession: (session: FocusSession) => Promise<void>
  deleteFocusSessionById: (sessionId: string) => Promise<void>
  getCalendarPref: (goalId: string) => Promise<StudyCalendarPreference | null>
  saveCalendarPref: (pref: StudyCalendarPreference) => Promise<void>
  /* ---- v3 通用写动作 ---- */
  upsertKnowledgeItems: (items: KnowledgeItem[]) => Promise<void>
  deleteKnowledgeItemById: (id: string) => Promise<void>
  upsertAssessments: (list: MasteryAssessment[]) => Promise<void>
  deleteAssessmentById: (id: string) => Promise<void>
  upsertExams: (exams: Exam[]) => Promise<void>
  deleteExamById: (id: string) => Promise<void>
  upsertExamGoalLinks: (links: ExamGoalLink[]) => Promise<void>
  deleteExamGoalLinkById: (id: string) => Promise<void>
  upsertExamPhases: (phases: ExamPhase[]) => Promise<void>
  deleteExamPhaseById: (id: string) => Promise<void>
  upsertExamDayAvailabilities: (rows: ExamDayAvailability[]) => Promise<void>
  deleteExamDayAvailabilityById: (id: string) => Promise<void>
  upsertGlobalAvailability: (row: GlobalStudyAvailability) => Promise<void>
  upsertExamPlanSlots: (slots: ExamPlanSlot[]) => Promise<void>
  deleteExamPlanSlotById: (id: string) => Promise<void>
  upsertExamReviewItems: (items: ExamReviewItem[]) => Promise<void>
  deleteExamReviewItemById: (id: string) => Promise<void>
  putV4Rows: (table: V4Table, rows: unknown[]) => Promise<void>
  deleteV4Rows: (table: V4Table, keys: string[]) => Promise<void>
  saveWeeklyReview: (weekStart: string, input: WeeklyReviewInput) => Promise<void>
  clearDemoData: () => Promise<void>
  clearAllData: () => Promise<void>
  buildExportPayload: () => ExportPayload
  importPayload: (payload: ExportPayloadInput, mode: 'replace' | 'merge') => Promise<ImportResult>
  /** 首次达成完成的目标（写入成功后触发一次彩带；UI 消费后调用 clearCelebration） */
  justCompletedGoalId: string | null
  clearCelebration: () => void
}

const AppDataContext = createContext<AppDataValue | null>(null)

function uuid(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID()
  return `id-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

export function AppDataProvider({ children }: { children: ReactNode }) {
  const [repo, setRepo] = useState<StudyRepository | null>(null)
  const [storageKind, setStorageKind] = useState<StorageKind | null>(null)
  const [ready, setReady] = useState(false)
  const [initError, setInitError] = useState<string | null>(null)
  const [goals, setGoals] = useState<Goal[]>([])
  const [checkins, setCheckins] = useState<Checkin[]>([])
  const [reviews, setReviews] = useState<WeeklyReview[]>([])
  const [dailyPlans, setDailyPlans] = useState<DailyPlan[]>([])
  const [milestones, setMilestones] = useState<Milestone[]>([])
  const [milestoneSteps, setMilestoneSteps] = useState<MilestoneStep[]>([])
  const [focusSessions, setFocusSessions] = useState<FocusSession[]>([])
  const [calendarPrefs, setCalendarPrefs] = useState<StudyCalendarPreference[]>([])
  const [knowledgeItems, setKnowledgeItems] = useState<KnowledgeItem[]>([])
  const [assessments, setAssessments] = useState<MasteryAssessment[]>([])
  const [exams, setExams] = useState<Exam[]>([])
  const [examGoalLinks, setExamGoalLinks] = useState<ExamGoalLink[]>([])
  const [examPhases, setExamPhases] = useState<ExamPhase[]>([])
  const [examDayAvailabilities, setExamDayAvailabilities] = useState<ExamDayAvailability[]>([])
  const [globalAvailabilities, setGlobalAvailabilities] = useState<GlobalStudyAvailability[]>([])
  const [examPlanSlots, setExamPlanSlots] = useState<ExamPlanSlot[]>([])
  const [examReviewItems, setExamReviewItems] = useState<ExamReviewItem[]>([])
  const [v4, setV4] = useState<Partial<Record<V4Table, unknown[]>>>({})
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [nowTick, setNowTick] = useState(() => Date.now())
  const [justCompletedGoalId, setJustCompletedGoalId] = useState<string | null>(null)
  const completedSnapshot = useRef<Set<string>>(new Set())

  const today = useMemo(() => todayStr(systemClock), [nowTick]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const t = window.setInterval(() => setNowTick(Date.now()), 60_000)
    return () => window.clearInterval(t)
  }, [])

  const loadAll = useCallback(
    async (repository: StudyRepository) => {
      const [g, c, r, st, plans, ms, steps, sessions, prefs, ks, as, ex, links, phases, days, globs, slots, reviews2, ...v4Lists] = await Promise.all([
        repository.getAllGoals(),
        repository.getAllCheckins(),
        repository.getAllReviews(),
        repository.getSettings(),
        repository.getAllDailyPlans(),
        repository.getAllMilestones(),
        repository.getAllMilestoneSteps(),
        repository.getAllFocusSessions(),
        repository.getAllCalendarPrefs(),
        repository.getAllKnowledgeItems(),
        repository.getAllAssessments(),
        repository.getAllExams(),
        repository.getAllExamGoalLinks(),
        repository.getAllExamPhases(),
        repository.getAllExamDayAvailabilities(),
        repository.getAllGlobalAvailabilities(),
        repository.getAllExamPlanSlots(),
        repository.getAllExamReviewItems(),
        ...(
          [
            'goalLifecycles', 'goalStatusEvents', 'weeklyAvailability', 'availabilityExceptions',
            'goalPlanPolicies', 'planRevisions', 'studyNotes', 'studyResumePoints', 'studyReports',
          ] as V4Table[]
        ).map((t) => repository.getV4All(t)),
      ])
      setGoals(g)
      setCheckins(c)
      setReviews(r)
      setSettings(st)
      setDailyPlans(plans)
      setMilestones(ms)
      setMilestoneSteps(steps)
      setFocusSessions(sessions)
      setCalendarPrefs(prefs)
      setKnowledgeItems(ks)
      setAssessments(as)
      setExams(ex)
      setExamGoalLinks(links)
      setExamPhases(phases)
      setExamDayAvailabilities(days)
      setGlobalAvailabilities(globs)
      setExamPlanSlots(slots)
      setExamReviewItems(reviews2)
      {
        const v4Tables: V4Table[] = ['goalLifecycles', 'goalStatusEvents', 'weeklyAvailability', 'availabilityExceptions', 'goalPlanPolicies', 'planRevisions', 'studyNotes', 'studyResumePoints', 'studyReports']
        const nextV4: Partial<Record<V4Table, unknown[]>> = {}
        v4Tables.forEach((t, i) => {
          nextV4[t] = v4Lists[i] as unknown[]
        })
        setV4(nextV4)
      }
      completedSnapshot.current = new Set(
        g.filter((goal) => computeGoalProgress(goal, c.filter((ch) => ch.goalId === goal.id)).isCompleted).map((goal) => goal.id),
      )
    },
    [],
  )

  const init = useCallback(async () => {
    setInitError(null)
    setReady(false)
    try {
      const { repo: repository, kind } = await createRepository()
      await repository.init()
      // 首次启动为空库：不插入任何演示数据（用户要求）；仅初始化设置行
      const existingSettings = await repository.getSettings()
      if (!existingSettings) {
        await repository.saveSettings({ schemaVersion: SCHEMA_VERSION, demoSeeded: true, lastSavedAt: null })
      }
      await loadAll(repository)
      setRepo(repository)
      setStorageKind(kind)
      setReady(true)
    } catch (err) {
      setInitError(err instanceof Error ? err.message : String(err))
      setReady(false)
    }
  }, [loadAll])

  useEffect(() => {
    void init()
  }, [init])

  const refresh = useCallback(async () => {
    if (!repo) return
    setRefreshing(true)
    try {
      await loadAll(repo)
    } finally {
      setRefreshing(false)
    }
  }, [repo, loadAll])

  const markSaved = useCallback(async () => {
    if (!repo) return
    const next: AppSettings = {
      schemaVersion: SCHEMA_VERSION,
      demoSeeded: settings?.demoSeeded ?? true,
      lastSavedAt: new Date().toISOString(),
    }
    await repo.saveSettings(next)
    setSettings(next)
  }, [repo, settings])

  const createGoal = useCallback(
    async (input: GoalInput) => {
      if (!repo) throw new Error('数据库不可用')
      const parsed = goalInputSchema.parse(input)
      const now = new Date().toISOString()
      const goal: Goal = {
        id: uuid(),
        ...parsed,
        obstacle: parsed.obstacle || null,
        ifThenPlan: parsed.ifThenPlan || null,
        isDemo: false,
        createdAt: now,
        updatedAt: now,
      }
      await repo.createGoal(goal)
      await markSaved()
      await loadAll(repo)
      return goal
    },
    [repo, loadAll, markSaved],
  )

  const updateGoal = useCallback(
    async (goalId: string, input: GoalInput) => {
      if (!repo) throw new Error('数据库不可用')
      const parsed = goalInputSchema.parse(input)
      const existing = goals.find((g) => g.id === goalId)
      if (!existing) throw new Error('目标不存在')
      const updated: Goal = {
        ...existing,
        ...parsed,
        obstacle: parsed.obstacle || null,
        ifThenPlan: parsed.ifThenPlan || null,
        updatedAt: new Date().toISOString(),
      }
      await repo.updateGoal(updated)
      await markSaved()
      await loadAll(repo)
    },
    [repo, goals, loadAll, markSaved],
  )

  const deleteGoal = useCallback(
    async (goalId: string) => {
      if (!repo) throw new Error('数据库不可用')
      await repo.deleteGoal(goalId)
      await markSaved()
      await loadAll(repo)
    },
    [repo, loadAll, markSaved],
  )

  const addCheckin = useCallback(
    async (input: CheckinInput) => {
      if (!repo) throw new Error('数据库不可用')
      const parsed = checkinInputSchema.parse(input)
      const goal = goals.find((g) => g.id === parsed.goalId)
      if (!goal) throw new Error('关联的目标不存在')
      const t = todayStr(systemClock)
      // 打卡日期只能是今天或最近 6 个过去自然日，且不早于目标开始日（补记规则）
      if (parsed.date > t) throw new Error('不能为未来日期打卡')
      if (parsed.date < addDays(t, -6)) throw new Error('只能补记最近 6 天内的记录')
      if (parsed.date < goal.startDate) throw new Error('该日期早于目标开始日，不能打卡')
      const wasCompleted = completedSnapshot.current.has(goal.id)
      const now = new Date().toISOString()
      // 可选里程碑必须属于同一目标
      const milestoneId = parsed.milestoneId ?? null
      if (milestoneId && !milestones.some((m) => m.id === milestoneId && m.goalId === goal.id)) {
        throw new Error('关联的阶段不存在或不属于该目标')
      }
      const checkin: Checkin = {
        id: uuid(),
        goalId: goal.id,
        date: parsed.date,
        amount: parsed.amount,
        minutes: parsed.minutes ?? null,
        note: parsed.note || null,
        isBackfill: parsed.date < t,
        isDemo: goal.isDemo,
        milestoneId,
        createdAt: now,
        updatedAt: now,
      }
      await repo.addCheckin(checkin)
      await markSaved()
      await loadAll(repo)
      // 仅首次从未完成 → 完成（且本次写入成功）触发庆祝
      const goalCheckins = checkins.filter((c) => c.goalId === goal.id)
      const after = [...goalCheckins, checkin]
      if (!wasCompleted && computeGoalProgress(goal, after).isCompleted) {
        setJustCompletedGoalId(goal.id)
      }
      return checkin
    },
    [repo, goals, checkins, milestones, loadAll, markSaved],
  )

  const deleteCheckin = useCallback(
    async (checkinId: string) => {
      if (!repo) throw new Error('数据库不可用')
      await repo.deleteCheckin(checkinId)
      await markSaved()
      await loadAll(repo)
    },
    [repo, loadAll, markSaved],
  )

  const assignCheckinsToMilestone = useCallback(
    async (checkinIds: string[], milestoneId: string | null) => {
      if (!repo) throw new Error('数据库不可用')
      await repo.updateCheckinsMilestone(checkinIds, milestoneId)
      await markSaved()
      await loadAll(repo)
    },
    [repo, loadAll, markSaved],
  )

  const saveDailyPlans = useCallback(
    async (plans: DailyPlan[]) => {
      if (!repo) throw new Error('数据库不可用')
      await repo.upsertDailyPlans(plans)
      await markSaved()
      await loadAll(repo)
    },
    [repo, loadAll, markSaved],
  )

  const applyDailyPlanChangesAction = useCallback(
    async (upserts: DailyPlan[], deleteIds: string[]) => {
      if (!repo) throw new Error('数据库不可用')
      await repo.applyDailyPlanChanges(upserts, deleteIds)
      await markSaved()
      await loadAll(repo)
    },
    [repo, loadAll, markSaved],
  )

  const deleteDailyPlanById = useCallback(
    async (planId: string) => {
      if (!repo) throw new Error('数据库不可用')
      await repo.deleteDailyPlan(planId)
      await markSaved()
      await loadAll(repo)
    },
    [repo, loadAll, markSaved],
  )

  const saveMilestones = useCallback(
    async (ms: Milestone[]) => {
      if (!repo) throw new Error('数据库不可用')
      await repo.upsertMilestones(ms)
      await markSaved()
      await loadAll(repo)
    },
    [repo, loadAll, markSaved],
  )

  const deleteMilestoneById = useCallback(
    async (milestoneId: string) => {
      if (!repo) throw new Error('数据库不可用')
      await repo.deleteMilestone(milestoneId)
      await markSaved()
      await loadAll(repo)
    },
    [repo, loadAll, markSaved],
  )

  const saveMilestoneSteps = useCallback(
    async (steps: MilestoneStep[]) => {
      if (!repo) throw new Error('数据库不可用')
      await repo.upsertMilestoneSteps(steps)
      await markSaved()
      await loadAll(repo)
    },
    [repo, loadAll, markSaved],
  )

  const deleteMilestoneStepById = useCallback(
    async (stepId: string) => {
      if (!repo) throw new Error('数据库不可用')
      await repo.deleteMilestoneStep(stepId)
      await markSaved()
      await loadAll(repo)
    },
    [repo, loadAll, markSaved],
  )

  const saveFocusSession = useCallback(
    async (session: FocusSession) => {
      if (!repo) throw new Error('数据库不可用')
      await repo.upsertFocusSession(session)
      await markSaved()
      await loadAll(repo)
    },
    [repo, loadAll, markSaved],
  )

  const deleteFocusSessionById = useCallback(
    async (sessionId: string) => {
      if (!repo) throw new Error('数据库不可用')
      await repo.deleteFocusSession(sessionId)
      await markSaved()
      await loadAll(repo)
    },
    [repo, loadAll, markSaved],
  )

  /* ---- v3 通用写动作 ---- */
  const v3Action = useCallback(
    (run: (r: StudyRepository) => Promise<void>) => async () => {
      if (!repo) throw new Error('数据库不可用')
      await run(repo)
      await markSaved()
      await loadAll(repo)
    },
    [repo, markSaved, loadAll],
  )
  const upsertKnowledgeItems = useCallback((items: KnowledgeItem[]) => v3Action((r) => r.upsertKnowledgeItems(items))(), [v3Action])
  const deleteKnowledgeItemById = useCallback((id: string) => v3Action((r) => r.deleteKnowledgeItem(id))(), [v3Action])
  const upsertAssessments = useCallback((list: MasteryAssessment[]) => v3Action((r) => r.upsertAssessments(list))(), [v3Action])
  const deleteAssessmentById = useCallback((id: string) => v3Action((r) => r.deleteAssessment(id))(), [v3Action])
  const upsertExams = useCallback((list: Exam[]) => v3Action((r) => r.upsertExams(list))(), [v3Action])
  const deleteExamById = useCallback((id: string) => v3Action((r) => r.deleteExam(id))(), [v3Action])
  const upsertExamGoalLinks = useCallback((links: ExamGoalLink[]) => v3Action((r) => r.upsertExamGoalLinks(links))(), [v3Action])
  const deleteExamGoalLinkById = useCallback((id: string) => v3Action((r) => r.deleteExamGoalLink(id))(), [v3Action])
  const upsertExamPhases = useCallback((phases: ExamPhase[]) => v3Action((r) => r.upsertExamPhases(phases))(), [v3Action])
  const deleteExamPhaseById = useCallback((id: string) => v3Action((r) => r.deleteExamPhase(id))(), [v3Action])
  const upsertExamDayAvailabilities = useCallback((rows: ExamDayAvailability[]) => v3Action((r) => r.upsertExamDayAvailabilities(rows))(), [v3Action])
  const deleteExamDayAvailabilityById = useCallback((id: string) => v3Action((r) => r.deleteExamDayAvailability(id))(), [v3Action])
  const upsertGlobalAvailability = useCallback((row: GlobalStudyAvailability) => v3Action((r) => r.upsertGlobalAvailability(row))(), [v3Action])
  const upsertExamPlanSlots = useCallback((slots: ExamPlanSlot[]) => v3Action((r) => r.upsertExamPlanSlots(slots))(), [v3Action])
  const deleteExamPlanSlotById = useCallback((id: string) => v3Action((r) => r.deleteExamPlanSlot(id))(), [v3Action])
  const upsertExamReviewItems = useCallback((items: ExamReviewItem[]) => v3Action((r) => r.upsertExamReviewItems(items))(), [v3Action])
  const deleteExamReviewItemById = useCallback((id: string) => v3Action((r) => r.deleteExamReviewItem(id))(), [v3Action])

  /* ---- v4 通用写动作（写入后重载；行对象由调用方按实体类型构造） ---- */
  const putV4Rows = useCallback(
    async (table: V4Table, rows: unknown[]) => {
      if (!repo) throw new Error('数据库不可用')
      await repo.putV4(table, rows)
      await markSaved()
      await loadAll(repo)
    },
    [repo, markSaved, loadAll],
  )
  const deleteV4Rows = useCallback(
    async (table: V4Table, keys: string[]) => {
      if (!repo) throw new Error('数据库不可用')
      await repo.deleteV4(table, keys)
      await markSaved()
      await loadAll(repo)
    },
    [repo, markSaved, loadAll],
  )

  const getCalendarPrefAction = useCallback(
    (goalId: string) => (repo ? repo.getCalendarPref(goalId) : Promise.resolve(null)),
    [repo],
  )

  const saveCalendarPrefAction = useCallback(
    async (pref: StudyCalendarPreference) => {
      if (!repo) throw new Error('数据库不可用')
      await repo.saveCalendarPref(pref)
    },
    [repo],
  )

  const saveWeeklyReview = useCallback(
    async (weekStart: string, input: WeeklyReviewInput) => {
      if (!repo) throw new Error('数据库不可用')
      const parsed = weeklyReviewInputSchema.parse(input)
      const existing = reviews.find((r) => r.weekStart === weekStart)
      const now = new Date().toISOString()
      await repo.upsertWeeklyReview({
        id: existing?.id ?? uuid(),
        weekStart,
        keep: parsed.keep,
        problem: parsed.problem,
        tryNext: parsed.tryNext,
        nextPlan: parsed.nextPlan,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      })
      await markSaved()
      await loadAll(repo)
    },
    [repo, reviews, loadAll, markSaved],
  )

  const clearDemoData = useCallback(async () => {
    if (!repo) throw new Error('数据库不可用')
    await repo.clearDemoData()
    await markSaved()
    await loadAll(repo)
  }, [repo, loadAll, markSaved])

  const clearAllData = useCallback(async () => {
    if (!repo) throw new Error('数据库不可用')
    await repo.clearAll()
    // 保留「已完成种子初始化」标记，避免清空后再次插入演示数据
    const next: AppSettings = { schemaVersion: SCHEMA_VERSION, demoSeeded: true, lastSavedAt: new Date().toISOString() }
    await repo.saveSettings(next)
    setSettings(next)
    await loadAll(repo)
  }, [repo, loadAll])

  const buildExportPayload = useCallback((): ExportPayload => {
    return {
      app: 'studyflow',
      schemaVersion: SCHEMA_VERSION,
      exportedAt: new Date().toISOString(),
      goals,
      checkins,
      reviews,
      dailyPlans,
      milestones,
      milestoneSteps,
      focusSessions,
      calendarPrefs,
      knowledgeItems,
      masteryAssessments: assessments,
      exams,
      examGoalLinks,
      examPhases,
      examDayAvailabilities,
      globalAvailabilities,
      examPlanSlots,
      examReviewItems,
      v4,
    }
  }, [goals, checkins, reviews, dailyPlans, milestones, milestoneSteps, focusSessions, calendarPrefs, knowledgeItems, assessments, exams, examGoalLinks, examPhases, examDayAvailabilities, globalAvailabilities, examPlanSlots, examReviewItems, v4])

  const importPayload = useCallback(
    async (payload: ExportPayloadInput, mode: 'replace' | 'merge') => {
      if (!repo) throw new Error('数据库不可用')
      const result = await repo.replaceAll(payload, mode)
      await markSaved()
      await loadAll(repo)
      return result
    },
    [repo, loadAll, markSaved],
  )

  const value: AppDataValue = {
    ready,
    initError,
    goals,
    checkins,
    reviews,
    dailyPlans,
    milestones,
    milestoneSteps,
    focusSessions,
    calendarPrefs,
    knowledgeItems,
    assessments,
    exams,
    examGoalLinks,
    examPhases,
    examDayAvailabilities,
    globalAvailabilities,
    examPlanSlots,
    examReviewItems,
    v4,
    settings,
    storageKind,
    today,
    refreshing,
    refresh,
    retry: init,
    createGoal,
    updateGoal,
    deleteGoal,
    addCheckin,
    deleteCheckin,
    assignCheckinsToMilestone,
    saveDailyPlans,
    applyDailyPlanChanges: applyDailyPlanChangesAction,
    deleteDailyPlanById,
    saveMilestones,
    deleteMilestoneById,
    saveMilestoneSteps,
    deleteMilestoneStepById,
    saveFocusSession,
    deleteFocusSessionById,
    getCalendarPref: getCalendarPrefAction,
    saveCalendarPref: saveCalendarPrefAction,
    putV4Rows,
    deleteV4Rows,
    upsertKnowledgeItems,
    deleteKnowledgeItemById,
    upsertAssessments,
    deleteAssessmentById,
    upsertExams,
    deleteExamById,
    upsertExamGoalLinks,
    deleteExamGoalLinkById,
    upsertExamPhases,
    deleteExamPhaseById,
    upsertExamDayAvailabilities,
    deleteExamDayAvailabilityById,
    upsertGlobalAvailability,
    upsertExamPlanSlots,
    deleteExamPlanSlotById,
    upsertExamReviewItems,
    deleteExamReviewItemById,
    saveWeeklyReview,
    clearDemoData,
    clearAllData,
    buildExportPayload,
    importPayload,
    justCompletedGoalId,
    clearCelebration: () => setJustCompletedGoalId(null),
  }

  return <AppDataContext.Provider value={value}>{children}</AppDataContext.Provider>
}

export function useAppData(): AppDataValue {
  const ctx = useContext(AppDataContext)
  if (!ctx) throw new Error('useAppData 必须在 AppDataProvider 内使用')
  return ctx
}
