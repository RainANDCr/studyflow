import { useMemo, useState } from 'react'
import { useAppData } from '../../state/AppData'
import { systemClock } from '../../domain/clock'
import { formatFullCN, weekdayShort } from '../../domain/dates'
import { checkinsOfGoal, computeGoalProgress } from '../../domain/progress'
import { sortGoalsForToday } from '../../domain/streak'
import { Button, Card, EmptyState, StatTile } from '../../components/ui'
import { ConfirmDialog, useToast } from '../../components/feedback'
import { IconCalendar, IconChevronDown, IconPlus, IconSparkles, IconTarget } from '../../components/icons'
import { FocusPanel } from '../focus/FocusPanel'
import { GoalCard } from './GoalCard'
import { GoalFormDialog } from './GoalFormDialog'
import { CheckinDialog } from './CheckinDialog'
import { CalendarView } from '../calendar/CalendarView'
import { BatchCheckinDialog, useGoalStatusFilter } from '../generic/GenericUI'
import { getWorkspacePrefs, useWorkspacePrefs } from '../generic/Workspace'
import { ExamView } from '../exam/ExamView'
import { ExamSummaryCard } from './ExamSummaryCard'
import type { Goal } from '../../domain/types'

function greeting(): string {
  const h = systemClock.now().getHours()
  if (h < 6) return '夜深了'
  if (h < 12) return '早上好'
  if (h < 14) return '中午好'
  if (h < 18) return '下午好'
  return '晚上好'
}

export function TodayPage() {
  const { goals, checkins, today, deleteGoal, milestones, knowledgeItems, assessments } = useAppData()
  const toast = useToast()
  const [goalFormOpen, setGoalFormOpen] = useState(false)
  const [editingGoal, setEditingGoal] = useState<Goal | null>(null)
  const [checkinGoal, setCheckinGoal] = useState<Goal | null>(null)
  const [deletingGoal, setDeletingGoal] = useState<Goal | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [showCompleted, setShowCompleted] = useState(false)
  const [view, setView] = useState<'cards' | 'calendar'>('cards')
  const [focusOpen, setFocusOpen] = useState(false)
  const [focusGoalId, setFocusGoalId] = useState<string | null>(null)
  const [examView, setExamView] = useState(false)
  const [batchOpen, setBatchOpen] = useState(false)
  const statusFilter = useGoalStatusFilter()
  const [wsPrefs, updateWsPrefs] = useWorkspacePrefs()

  const sortedAll = useMemo(() => sortGoalsForToday(goals, checkins, today), [goals, checkins, today])
  const sorted = useMemo(
    () => sortedAll.filter((g) => statusFilter.filter === 'all' || statusFilter.statusOf(g) === statusFilter.filter),
    [sortedAll, statusFilter],
  )
  const { activeGoals, completedGoals, todayCheckinCount, pendingCount } = useMemo(() => {
    const done = sorted.filter((g) => computeGoalProgress(g, checkinsOfGoal(checkins, g.id)).isCompleted)
    const active = sorted.filter((g) => !done.includes(g) && today >= g.startDate)
    const pendingToday = sorted.filter((g) => {
      if (done.includes(g) || today < g.startDate) return false
      if (today > g.deadline) return true
      return true
    })
    return {
      activeGoals: active,
      completedGoals: done,
      todayCheckinCount: checkins.filter((c) => c.date === today).length,
      pendingCount: pendingToday.length,
    }
  }, [sorted, checkins, today])

  if (view === 'calendar') {
    return <CalendarView onBack={() => setView('cards')} />
  }
  if (examView) {
    return <ExamView onBack={() => setExamView(false)} />
  }

  const openCreate = () => {
    setEditingGoal(null)
    setGoalFormOpen(true)
  }
  const openEdit = (g: Goal) => {
    setEditingGoal(g)
    setGoalFormOpen(true)
  }
  const confirmDelete = async () => {
    if (!deletingGoal) return
    setDeleting(true)
    try {
      await deleteGoal(deletingGoal.id)
      toast.success('目标及其打卡记录已删除')
      setDeletingGoal(null)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '删除失败，请重试')
    } finally {
      setDeleting(false)
    }
  }

  return (
    <div className="space-y-4">
      <header className="space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold text-ink">
              {greeting()}，继续把终点拆成今天的一小步
            </h1>
            <p className="mt-0.5 text-xs text-ink3">
              {formatFullCN(today)} {weekdayShort(today)} · 数据保存在本机
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Button variant="secondary" size="sm" onClick={() => setFocusOpen(true)}>
              开始专注
            </Button>
            <Button variant="secondary" size="sm" onClick={() => setExamView(true)}>
              考试冲刺
            </Button>
            <Button variant="secondary" size="sm" onClick={() => setView('calendar')}>
              <IconCalendar /> 日历视图
            </Button>
            <Button onClick={openCreate} className="hidden md:inline-flex">
              <IconPlus /> 新建学习目标
            </Button>
          </div>
        </div>
        {wsPrefs.showStats ? (
          <div className={wsPrefs.density === 'compact' ? 'grid grid-cols-3 gap-1.5' : 'grid grid-cols-3 gap-3'}>
            <StatTile label="今日待打卡目标" value={pendingCount} sub="个进行中" />
            <StatTile label="今日已打卡" value={todayCheckinCount} sub="次" />
            <StatTile label="已完成目标" value={completedGoals.length} sub={`共 ${goals.length} 个`} />
          </div>
        ) : null}
        {!wsPrefs.showExamCard && !wsPrefs.showStats && <button type="button" className="text-[11px] text-ink3 underline-offset-2 hover:underline" onClick={() => updateWsPrefs({ ...getWorkspacePrefs(), showStats: true })}>部分卡片已隐藏，点击恢复</button>}
      </header>

      {wsPrefs.showExamCard && <ExamSummaryCard onOpen={() => setExamView(true)} />}

      <div className="flex flex-wrap items-center gap-2">
        {statusFilter.bar}
        {wsPrefs.showQuickActions && (
          <Button size="sm" variant="secondary" className="ml-auto" onClick={() => setBatchOpen(true)}>
            批量记录
          </Button>
        )}
      </div>

      {sorted.length === 0 ? (
        <EmptyState
          icon={<IconTarget />}
          title="还没有学习目标"
          description="创建第一个目标，写下总量和截止日，应用会帮你算出每天的一小步。"
          action={
            <Button onClick={openCreate}>
              <IconPlus /> 新建学习目标
            </Button>
          }
        />
      ) : (
        <div className="space-y-3">
          {activeGoals.map((g) => (
            <GoalCard
              key={g.id}
              goal={g}
              allCheckins={checkins}
              today={today}
              milestones={milestones}
              knowledgeItems={knowledgeItems}
              assessments={assessments}
              onCheckin={() => setCheckinGoal(g)}
              onEdit={() => openEdit(g)}
              onDelete={() => setDeletingGoal(g)}
              onOpenFocus={(gid) => {
                setFocusGoalId(gid)
                setFocusOpen(true)
              }}
            />
          ))}
          {activeGoals.length === 0 && (
            <EmptyState
              icon={<IconSparkles />}
              title="当前没有进行中的目标"
              description="已完成的目标会折叠在下方；新建一个目标继续前进吧。"
              action={
                <Button onClick={openCreate}>
                  <IconPlus /> 新建学习目标
                </Button>
              }
            />
          )}
          {completedGoals.length > 0 && (
            <Card>
              <button
                type="button"
                onClick={() => setShowCompleted((v) => !v)}
                aria-expanded={showCompleted}
                className="flex w-full items-center justify-between gap-2 px-4 py-3 text-left text-sm font-medium text-ink2"
              >
                <span>已完成的目标（{completedGoals.length}）</span>
                <IconChevronDown className={`transition-transform ${showCompleted ? 'rotate-180' : ''}`} />
              </button>
              {showCompleted && (
                <div className="space-y-2 px-4 pb-4">
                  {completedGoals.map((g) => (
                    <GoalCard
                      key={g.id}
                      goal={g}
                      allCheckins={checkins}
                      today={today}
                      milestones={milestones}
                      onCheckin={() => setCheckinGoal(g)}
                      onEdit={() => openEdit(g)}
                      onDelete={() => setDeletingGoal(g)}
                    />
                  ))}
                </div>
              )}
            </Card>
          )}
        </div>
      )}

      <div className="pt-2 md:hidden">
        <Button size="lg" className="w-full" onClick={openCreate}>
          <IconPlus className="text-lg" /> 新建学习目标
        </Button>
      </div>

      <BatchCheckinDialog open={batchOpen} onClose={() => setBatchOpen(false)} />
      <FocusPanel open={focusOpen} onClose={() => setFocusOpen(false)} initialGoalId={focusGoalId} />
      <GoalFormDialog open={goalFormOpen} onClose={() => setGoalFormOpen(false)} goal={editingGoal} />
      <CheckinDialog open={!!checkinGoal} onClose={() => setCheckinGoal(null)} goal={checkinGoal} />
      <ConfirmDialog
        open={!!deletingGoal}
        title="删除学习目标"
        danger
        confirmText="确认删除"
        busy={deleting}
        message={
          <span>
            将删除目标「{deletingGoal?.name}」及其全部{' '}
            <b className="text-danger">{deletingGoal ? checkins.filter((c) => c.goalId === deletingGoal.id).length : 0}</b>{' '}
            条打卡记录，此操作不可撤销。确定继续吗？
          </span>
        }
        onConfirm={() => void confirmDelete()}
        onClose={() => setDeletingGoal(null)}
      />
    </div>
  )
}
