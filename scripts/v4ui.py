import io

# ============ GoalCard（今日）: 生命周期 + QuickActions ============
p = 'src/features/today/GoalCard.tsx'
s = io.open(p, encoding='utf-8').read()
if 'QuickActions' not in s:
    s = s.replace("import { ProgressRing } from '../../components/ProgressRing'",
                  "import { ProgressRing } from '../../components/ProgressRing'\nimport { LifecycleControls, QuickActions } from '../generic/GenericUI'")
    # 展开折叠区与底部按钮行：在底部按钮区后追加 LifecycleControls；在按钮区前加 QuickActions
    s = s.replace("""      <div className="flex items-center gap-2 px-4 py-3">
        {suggestion.kind !== 'overdue' && (
          <Button size="sm" onClick={onCheckin}>
            <IconCheck /> 立即打卡
          </Button>
        )}""",
"""      <div className="flex flex-wrap items-center gap-2 px-4 py-3">
        {suggestion.kind !== 'overdue' && (
          <Button size="sm" onClick={onCheckin}>
            <IconCheck /> 立即打卡
          </Button>
        )}
        <QuickActions goal={goal} onOpenFocus={onOpenFocus} />""")
    # 组件 props 增加 onOpenFocus
    s = s.replace("""  onOpenFocus = () => {},
}: {
  goal: Goal
  allCheckins: Checkin[]
  today: string
  onCheckin: () => void
  onEdit: () => void
  onDelete: () => void
  milestones?: Milestone[]
  knowledgeItems?: KnowledgeItem[]
  assessments?: MasteryAssessment[]
}) {""",
"""  onOpenFocus,
}: {
  goal: Goal
  allCheckins: Checkin[]
  today: string
  onCheckin: () => void
  onEdit: () => void
  onDelete: () => void
  milestones?: Milestone[]
  knowledgeItems?: KnowledgeItem[]
  assessments?: MasteryAssessment[]
  onOpenFocus?: (goalId: string) => void
}) {""")
    s = s.replace("""  onEdit,
  onDelete,
  milestones = [],
  knowledgeItems = [],
  assessments = [],
}: {""",
"""  onEdit,
  onDelete,
  milestones = [],
  knowledgeItems = [],
  assessments = [],
  onOpenFocus,
}: {""")
    # LifecycleControls 挂底部（非完成态卡片）
    s = s.replace("""          <IconTrash className="text-base" />
        </Button>
      </div>
    </article>
  )
}""",
"""          <IconTrash className="text-base" />
        </Button>
      </div>

      <LifecycleControls goal={goal} />
    </article>
  )
}""")
    io.open(p, 'w', encoding='utf-8', newline='\n').write(s)
print('GoalCard ok')

# ============ GoalDetailCard（看板）: Resume + Notes ============
p = 'src/features/dashboard/DashboardPage.tsx'
s = io.open(p, encoding='utf-8').read()
if 'ResumeBlock' not in s:
    s = s.replace("import { MasterySection } from '../knowledge/MasterySection'",
                  "import { MasterySection } from '../knowledge/MasterySection'\nimport { NotesBlock, ResumeBlock } from '../generic/GenericUI'")
    s = s.replace("""      <MilestonePanel goal={goal} />
      <MasterySection goal={goal} />""",
"""      <ResumeBlock goal={goal} />
      <MilestonePanel goal={goal} />
      <MasterySection goal={goal} />
      <NotesBlock goal={goal} />""")
    # 看板 header 加分析中心按钮 + 二级视图
    s = s.replace("""import { SimulatorDialog } from '../simulator/SimulatorDialog'""",
"""import { SimulatorDialog } from '../simulator/SimulatorDialog'
import { AnalyticsView } from '../generic/GenericViews'""")
    s = s.replace("""export function DashboardPage() {
  const { goals, checkins, focusSessions, today, deleteCheckin } = useAppData()""",
"""export function DashboardPage() {
  const { goals, checkins, focusSessions, today, deleteCheckin } = useAppData()
  const [analyticsOpen, setAnalyticsOpen] = useState(false)
  if (analyticsOpen) {
    return <AnalyticsView onBack={() => setAnalyticsOpen(false)} />
  }""")
    s = s.replace("""        <p className="mt-0.5 text-xs text-ink3">所有目标的进度、记录与近 14 天投入分钟数，全部来自本地数据实时计算。</p>
      </header>""",
"""        <p className="mt-0.5 text-xs text-ink3">所有目标的进度、记录与近 14 天投入分钟数，全部来自本地数据实时计算。</p>
        <Button size="sm" variant="secondary" className="mt-2" onClick={() => setAnalyticsOpen(true)}>
          打开分析中心（投入 / 兑现率 / 计划对比）
        </Button>
      </header>""")
    io.open(p, 'w', encoding='utf-8', newline='\n').write(s)
print('Dashboard ok')

# ============ TodayPage: 状态筛选 + 批量记录 + onOpenFocus ============
p = 'src/features/today/TodayPage.tsx'
s = io.open(p, encoding='utf-8').read()
if 'BatchCheckinDialog' not in s:
    s = s.replace("import { CalendarView } from '../calendar/CalendarView'",
                  "import { CalendarView } from '../calendar/CalendarView'\nimport { BatchCheckinDialog, useGoalStatusFilter } from '../generic/GenericUI'")
    s = s.replace("  const [examView, setExamView] = useState(false)",
                  "  const [examView, setExamView] = useState(false)\n  const [batchOpen, setBatchOpen] = useState(false)\n  const statusFilter = useGoalStatusFilter()")
    s = s.replace("""  const sorted = useMemo(() => sortGoalsForToday(goals, checkins, today), [goals, checkins, today])""",
"""  const sortedAll = useMemo(() => sortGoalsForToday(goals, checkins, today), [goals, checkins, today])
  const sorted = useMemo(
    () => sortedAll.filter((g) => statusFilter.filter === 'all' || statusFilter.statusOf(g) === statusFilter.filter),
    [sortedAll, statusFilter],
  )""")
    # 筛选条 + 批量按钮：header 之后
    s = s.replace("""      <ExamSummaryCard onOpen={() => setExamView(true)} />""",
"""      <ExamSummaryCard onOpen={() => setExamView(true)} />

      <div className="flex flex-wrap items-center gap-2">
        {statusFilter.bar}
        <Button size="sm" variant="secondary" className="ml-auto" onClick={() => setBatchOpen(true)}>
          批量记录
        </Button>
      </div>""")
    # FocusPanel 预选目标：openFocus 回调
    s = s.replace("      <FocusPanel open={focusOpen} onClose={() => setFocusOpen(false)} />",
"""      <FocusPanel open={focusOpen} onClose={() => setFocusOpen(false)} initialGoalId={focusGoalId} />""")
    s = s.replace("  const [focusOpen, setFocusOpen] = useState(false)",
                  "  const [focusOpen, setFocusOpen] = useState(false)\n  const [focusGoalId, setFocusGoalId] = useState<string | null>(null)")
    s = s.replace("""              onCheckin={() => setCheckinGoal(g)}
              onEdit={() => openEdit(g)}
              onDelete={() => setDeletingGoal(g)}
            />
          )),
          """,
"""              onCheckin={() => setCheckinGoal(g)}
              onEdit={() => openEdit(g)}
              onDelete={() => setDeletingGoal(g)}
              onOpenFocus={(gid) => {
                setFocusGoalId(gid)
                setFocusOpen(true)
              }}
            />
          )),
          """)
    s = s.replace("""      <BatchCheckinDialog open={batchOpen} onClose={() => setBatchOpen(false)} />
      <FocusPanel""", """      <FocusPanel""")
    # 简化：直接在 FocusPanel 行前插入 Batch（避免上面 replace 冲突）
    s = s.replace("""      <FocusPanel open={focusOpen} onClose={() => setFocusOpen(false)} initialGoalId={focusGoalId} />""",
"""      <BatchCheckinDialog open={batchOpen} onClose={() => setBatchOpen(false)} />
      <FocusPanel open={focusOpen} onClose={() => setFocusOpen(false)} initialGoalId={focusGoalId} />""")
    io.open(p, 'w', encoding='utf-8', newline='\n').write(s)
print('Today ok')

# ============ CalendarView: 预算按钮 + 触发卡 ============
p = 'src/features/calendar/CalendarView.tsx'
s = io.open(p, encoding='utf-8').read()
if 'BudgetDialog' not in s:
    s = s.replace("import { CheckinDialog } from '../today/CheckinDialog'",
                  "import { CheckinDialog } from '../today/CheckinDialog'\nimport { BudgetDialog, RescheduleCard } from '../generic/GenericViews'")
    s = s.replace("""  const [pendingMove, setPendingMove] = useState<{ plan: DailyPlan; toDate: DateStr } | null>(null)""",
"""  const [pendingMove, setPendingMove] = useState<{ plan: DailyPlan; toDate: DateStr } | null>(null)
  const [budgetOpen, setBudgetOpen] = useState(false)""")
    s = s.replace("""          <Button
            size="sm"
            variant="secondary"
            onClick={() => {
              setMonth(today.slice(0, 7))""",
"""          <Button size="sm" variant="secondary" onClick={() => setBudgetOpen(true)}>
            时间预算
          </Button>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => {
              setMonth(today.slice(0, 7))""")
    s = s.replace("""      <Card className="px-3 py-3">""",
"""      <RescheduleCard onApply={(g) => void openAutoSchedule(g)} />

      <Card className="px-3 py-3">""")
    s = s.replace("""      <CheckinDialog open={!!checkinGoal} onClose={() => setCheckinGoal(null)} goal={checkinGoal} />""",
"""      <CheckinDialog open={!!checkinGoal} onClose={() => setCheckinGoal(null)} goal={checkinGoal} />
      <BudgetDialog open={budgetOpen} onClose={() => setBudgetOpen(false)} />""")
    # 确认排程后写修订记录：替换 confirmAutoSchedule 使用 revision 版本
    s = s.replace("""  const confirmAutoSchedule = async () => {
    if (!autoSchedule?.preview) return
    const { upserts, removals } = autoSchedule.preview
    const now = new Date().toISOString()
    try {
      await applyDailyPlanChanges(
        upserts.map((u) => ({ ...u, isDemo: autoSchedule.goal.isDemo, id: `plan-${u.goalId}-${u.date}`, createdAt: now, updatedAt: now })),
        removals.map((r) => r.id),
      )
      toast.success(`已应用排程：更新 ${upserts.length} 项，移除 ${removals.length} 项`)
      setAutoSchedule(null)
    } catch (err) {
      toast.error(err instanceof Error ? `排程失败：${err.message}` : '排程失败，请重试')
    }
  }""",
"""  const confirmAutoSchedule = async () => {
    if (!autoSchedule?.preview) return
    const { upserts, removals } = autoSchedule.preview
    const now = new Date().toISOString()
    try {
      const existing = dailyPlans.filter((p) => p.goalId === autoSchedule.goal.id && p.date > today && p.source === 'auto')
      await applyDailyPlanChanges(
        upserts.map((u) => ({ ...u, isDemo: autoSchedule.goal.isDemo, id: `plan-${u.goalId}-${u.date}`, createdAt: now, updatedAt: now })),
        removals.map((r) => r.id),
      )
      await putV4Rows('planRevisions', [
        {
          id: `rev-${now}`,
          createdAt: now,
          effectiveFrom: today,
          trigger: 'auto-reschedule',
          reason: `自动排程「${autoSchedule.goal.name}」`,
          diffSummary: `更新 ${upserts.length} 项，移除 ${removals.length} 项`,
          undoSnapshot: existing.length > 0 ? JSON.stringify(existing) : null,
        },
      ])
      toast.success(`已应用排程并记录修订：更新 ${upserts.length} 项，移除 ${removals.length} 项`)
      setAutoSchedule(null)
    } catch (err) {
      toast.error(err instanceof Error ? `排程失败：${err.message}` : '排程失败，请重试')
    }
  }""")
    s = s.replace("""  const { goals, checkins, dailyPlans, today, saveDailyPlans, applyDailyPlanChanges, getCalendarPref, saveCalendarPref } = useAppData()""",
"""  const { goals, checkins, dailyPlans, today, saveDailyPlans, applyDailyPlanChanges, getCalendarPref, saveCalendarPref, putV4Rows } = useAppData()""")
    io.open(p, 'w', encoding='utf-8', newline='\n').write(s)
print('Calendar ok')

# ============ WeeklyPage: 长期报告 tab ============
p = 'src/features/weekly/WeeklyPage.tsx'
s = io.open(p, encoding='utf-8').read()
if 'LongReportTab' not in s:
    s = s.replace("import type { MetricDelta } from '../../domain/weekly'",
                  "import type { MetricDelta } from '../../domain/weekly'\nimport { LongReportTab } from '../generic/GenericViews'")
    s = s.replace("""export function WeeklyPage() {
  const { goals, checkins, reviews, focusSessions, today, saveWeeklyReview } = useAppData()""",
"""export function WeeklyPage() {
  const { goals, checkins, reviews, focusSessions, today, saveWeeklyReview } = useAppData()
  const [mode, setMode] = useState<'weekly' | 'long'>('weekly')
  if (mode === 'long') {
    return (
      <div className="space-y-4">
        <header className="flex items-center gap-2">
          <h1 className="text-lg font-bold text-ink">长期学习报告</h1>
          <Button size="sm" variant="ghost" className="ml-auto" onClick={() => setMode('weekly')}>
            ← 返回周报
          </Button>
        </header>
        <LongReportTab />
      </div>
    )
  }""")
    s = s.replace("""      <header>
        <h1 className="text-xl font-bold text-ink">周报</h1>
        <p className="mt-0.5 text-xs text-ink3">一周 = 周一至周日。本周进行中时，与上周同期（周一至同 weekday）做同口径比较。</p>
      </header>""",
"""      <header>
        <div className="flex items-center justify-between gap-2">
          <div>
            <h1 className="text-xl font-bold text-ink">周报</h1>
            <p className="mt-0.5 text-xs text-ink3">一周 = 周一至周日。本周进行中时，与上周同期（周一至同 weekday）做同口径比较。</p>
          </div>
          <Button size="sm" variant="secondary" onClick={() => setMode('long')}>
            长期报告（月/季/年）
          </Button>
        </div>
      </header>""")
    io.open(p, 'w', encoding='utf-8', newline='\n').write(s)
print('Weekly ok')
