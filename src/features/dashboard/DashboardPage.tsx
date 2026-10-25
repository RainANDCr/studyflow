import { useMemo, useState } from 'react'
import type { Checkin, Goal } from '../../domain/types'
import { COLOR_HEX } from '../../domain/types'
import { formatMD, weekdayShort } from '../../domain/dates'
import { checkinsOfGoal, computeGoalProgress, sortByDate } from '../../domain/progress'
import { predictCompletion } from '../../domain/prediction'
import { calculateStreak } from '../../domain/streak'
import { useAppData } from '../../state/AppData'
import { ProgressRing } from '../../components/ProgressRing'
import { MinutesChart } from '../../components/MinutesChart'
import { Heatmap } from '../../components/Heatmap'
import { Badge, Button, Card, SectionTitle } from '../../components/ui'
import { ConfirmDialog, useToast } from '../../components/feedback'
import { IconClock, IconEdit, IconTrash } from '../../components/icons'
import { GoalFormDialog } from '../today/GoalFormDialog'
import { CheckinDialog } from '../today/CheckinDialog'
import { MilestonePanel } from '../milestones/MilestonePanel'
import { SimulatorDialog } from '../simulator/SimulatorDialog'
import { AnalyticsView } from '../generic/GenericViews'
import { MasterySection } from '../knowledge/MasterySection'
import { NotesBlock, ResumeBlock } from '../generic/GenericUI'

function fmtNum(n: number): string {
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 10) / 10)
}

function GoalDetailCard({
  goal,
  allCheckins,
  today,
  onRequestDeleteCheckin,
  onCheckin,
  onEditGoal,
}: {
  goal: Goal
  allCheckins: Checkin[]
  today: string
  onRequestDeleteCheckin: (checkinId: string) => void
  onCheckin: () => void
  onEditGoal: () => void
}) {
  const [simOpen, setSimOpen] = useState(false)
  const goalCheckins = useMemo(() => checkinsOfGoal(allCheckins, goal.id), [allCheckins, goal.id])
  const progress = useMemo(() => computeGoalProgress(goal, goalCheckins), [goal, goalCheckins])
  const streak = useMemo(() => calculateStreak(goal, goalCheckins, today), [goal, goalCheckins, today])
  const prediction = useMemo(() => predictCompletion(goal, goalCheckins, today), [goal, goalCheckins, today])
  const recent = useMemo(() => sortByDate([...goalCheckins]).slice(-10).reverse(), [goalCheckins])

  const predictionText = () => {
    if (prediction.status === 'completed') return prediction.actualCompletionDate ? formatMD(prediction.actualCompletionDate) : '已完成'
    if (prediction.status === 'insufficient') return '暂无推算'
    return prediction.projectedDate ? formatMD(prediction.projectedDate) : '—'
  }

  return (
    <Card className="overflow-hidden">
      <div className="flex items-center gap-3 border-b border-line/70 px-4 py-3">
        <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: COLOR_HEX[goal.color] }} />
        <h3 className="min-w-0 flex-1 truncate text-sm font-semibold text-ink">{goal.name}</h3>
        {goal.isDemo && <Badge tone="neutral">示例</Badge>}
        <Button size="sm" variant="ghost" aria-label={`编辑目标 ${goal.name}`} onClick={onEditGoal}>
          <IconEdit />
        </Button>
        <Button size="sm" variant="ghost" aria-label={`模拟 ${goal.name} 的完成计划`} onClick={() => setSimOpen(true)}>
          模拟
        </Button>
      </div>
      <div className="flex items-center gap-4 px-4 py-4">
        <ProgressRing percent={progress.percentCapped} color={COLOR_HEX[goal.color]} size={84} stroke={8}>
          <span className="tnum text-lg font-bold text-ink">{Math.round(progress.percentCapped)}%</span>
          <span className="tnum text-[10px] text-ink3">
            {fmtNum(progress.done)}/{fmtNum(goal.totalAmount)}
          </span>
        </ProgressRing>
        <div className="grid flex-1 grid-cols-3 gap-2 text-center">
          <div>
            <p className="text-[11px] text-ink3">完成率</p>
            <p className="tnum text-sm font-semibold text-ink">{Math.round(progress.percentCapped)}%</p>
          </div>
          <div>
            <p className="text-[11px] text-ink3">连续天数</p>
            <p className="tnum text-sm font-semibold text-ink">{streak.current} 天</p>
          </div>
          <div>
            <p className="text-[11px] text-ink3">{progress.isCompleted ? '实际完成日' : '预计完成日'}</p>
            <p className="text-[13px] font-semibold leading-5 text-ink">{predictionText()}</p>
          </div>
        </div>
      </div>
      {(goal.obstacle || goal.ifThenPlan) && (
        <div className="space-y-1 border-t border-line/70 px-4 py-3 text-xs leading-relaxed text-ink2">
          {goal.obstacle && (
            <p>
              <span className="font-medium text-ink">障碍：</span>
              {goal.obstacle}
            </p>
          )}
          {goal.ifThenPlan && (
            <p>
              <span className="font-medium text-ink">预案：</span>
              {goal.ifThenPlan}
            </p>
          )}
        </div>
      )}
      <div className="border-t border-line/70 px-4 py-3">
        <div className="mb-2 flex items-center justify-between">
          <h4 className="text-xs font-semibold text-ink2">最近 10 条记录</h4>
          <Button size="sm" variant="soft" onClick={onCheckin}>
            打卡
          </Button>
        </div>
        {recent.length === 0 ? (
          <p className="py-2 text-xs text-ink3">还没有记录，点击「打卡」写下第一条。</p>
        ) : (
          <ul className="divide-y divide-line/60">
            {recent.map((c) => (
              <li key={c.id} className="flex items-center gap-2 py-2 text-xs">
                <span className="tnum w-24 shrink-0 text-ink3">
                  {formatMD(c.date)} {weekdayShort(c.date)}
                </span>
                {c.isBackfill && <Badge tone="backfill">补</Badge>}
                <span className="tnum font-medium text-ink">
                  {fmtNum(c.amount)} {goal.unit}
                </span>
                {c.minutes !== null && (
                  <span className="tnum inline-flex items-center gap-1 text-ink3">
                    <IconClock /> {c.minutes} 分钟
                  </span>
                )}
                {c.note && (
                  <span className="min-w-0 flex-1 truncate text-ink3" title={c.note}>
                    {c.note}
                  </span>
                )}
                <button
                  type="button"
                  aria-label={`删除 ${formatMD(c.date)} 的打卡记录`}
                  onClick={() => onRequestDeleteCheckin(c.id)}
                  className="ml-auto shrink-0 rounded-lg p-1.5 text-ink3 transition-colors hover:bg-dangerSoft hover:text-danger"
                >
                  <IconTrash />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <ResumeBlock goal={goal} />
      <MilestonePanel goal={goal} />
      <MasterySection goal={goal} />
      <NotesBlock goal={goal} />
      <SimulatorDialog open={simOpen} onClose={() => setSimOpen(false)} goal={goal} />
    </Card>
  )
}

export function DashboardPage() {
  const { goals, checkins, focusSessions, today, deleteCheckin } = useAppData()
  const [analyticsOpen, setAnalyticsOpen] = useState(false)
  const toast = useToast()
  const [editingGoal, setEditingGoal] = useState<Goal | null>(null)
  const [checkinGoal, setCheckinGoal] = useState<Goal | null>(null)
  const [deletingCheckinId, setDeletingCheckinId] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)

  if (analyticsOpen) {
    return <AnalyticsView onBack={() => setAnalyticsOpen(false)} />
  }
  const deletingCheckin = deletingCheckinId ? checkins.find((c) => c.id === deletingCheckinId) ?? null : null
  const deletingGoal = deletingCheckin ? goals.find((g) => g.id === deletingCheckin.goalId) : undefined

  const confirmDeleteCheckin = async () => {
    if (!deletingCheckinId) return
    setDeleting(true)
    try {
      await deleteCheckin(deletingCheckinId)
      toast.success('记录已删除，相关统计已重新计算')
      setDeletingCheckinId(null)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '删除失败，请重试')
    } finally {
      setDeleting(false)
    }
  }

  const activeGoals = goals.filter((g) => !computeGoalProgress(g, checkinsOfGoal(checkins, g.id)).isCompleted)
  const completedGoals = goals.filter((g) => computeGoalProgress(g, checkinsOfGoal(checkins, g.id)).isCompleted)

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-xl font-bold text-ink">看板</h1>
        <p className="mt-0.5 text-xs text-ink3">所有目标的进度、记录与近 14 天投入分钟数，全部来自本地数据实时计算。</p>
        <Button size="sm" variant="secondary" className="mt-2" onClick={() => setAnalyticsOpen(true)}>
          打开分析中心（投入 / 兑现率 / 计划对比）
        </Button>
      </header>

      <Card className="px-4 py-4">
        <SectionTitle title="近 14 天学习投入分钟数" />
        <MinutesChart goals={goals} checkins={checkins} focusSessions={focusSessions} today={today} />
      </Card>

      <Card className="px-4 py-4">
        <SectionTitle title="年度学习热力图" extra={<span className="text-[11px] text-ink3">近 12 个月</span>} />
        <Heatmap goals={goals} checkins={checkins} focusSessions={focusSessions} today={today} />
      </Card>

      {goals.length === 0 && (
        <Card className="px-4 py-8 text-center text-sm text-ink3">还没有目标。去「今日」创建第一个学习目标吧。</Card>
      )}

      {activeGoals.length > 0 && (
        <section className="grid gap-3 lg:grid-cols-2">
          {activeGoals.map((g) => (
            <GoalDetailCard
              key={g.id}
              goal={g}
              allCheckins={checkins}
              today={today}
              onEditGoal={() => setEditingGoal(g)}
              onCheckin={() => setCheckinGoal(g)}
              onRequestDeleteCheckin={(id) => setDeletingCheckinId(id)}
            />
          ))}
        </section>
      )}

      {completedGoals.length > 0 && (
        <section className="grid gap-3 lg:grid-cols-2">
          <h2 className="-mb-1 text-xs font-semibold text-ink3 lg:col-span-2">已完成</h2>
          {completedGoals.map((g) => (
            <GoalDetailCard
              key={g.id}
              goal={g}
              allCheckins={checkins}
              today={today}
              onEditGoal={() => setEditingGoal(g)}
              onCheckin={() => setCheckinGoal(g)}
              onRequestDeleteCheckin={(id) => setDeletingCheckinId(id)}
            />
          ))}
        </section>
      )}

      <GoalFormDialog open={!!editingGoal} onClose={() => setEditingGoal(null)} goal={editingGoal} />
      <CheckinDialog open={!!checkinGoal} onClose={() => setCheckinGoal(null)} goal={checkinGoal} />
      <ConfirmDialog
        open={!!deletingCheckinId}
        title="删除打卡记录"
        danger
        confirmText="删除"
        busy={deleting}
        message={
          <span>
            将删除「{deletingGoal?.name}」在{' '}
            {deletingCheckin ? `${formatMD(deletingCheckin.date)}（${weekdayShort(deletingCheckin.date)}）` : ''} 的这条记录（
            {deletingCheckin ? `${fmtNum(deletingCheckin.amount)} ${deletingGoal?.unit ?? ''}` : ''}）。连续天数、完成率与预计完成日都会立即重新计算。
          </span>
        }
        onConfirm={() => void confirmDeleteCheckin()}
        onClose={() => setDeletingCheckinId(null)}
      />
    </div>
  )
}
