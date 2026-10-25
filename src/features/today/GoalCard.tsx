import { useMemo, useState } from 'react'
import type { Checkin, Goal, KnowledgeItem, MasteryAssessment, Milestone } from '../../domain/types'
import { getMasteryStats } from '../../domain/dualTrack'
import { COLOR_HEX } from '../../domain/types'
import { diffDays, formatMD } from '../../domain/dates'
import { checkinsOfGoal, computeGoalProgress } from '../../domain/progress'
import { computeTodaySuggestion } from '../../domain/suggestion'
import { predictCompletion } from '../../domain/prediction'
import { calculateStreak, getYesterdayMissedState } from '../../domain/streak'
import { ProgressRing } from '../../components/ProgressRing'
import { LifecycleControls, QuickActions } from '../generic/GenericUI'
import { Badge, Button, CompletionMark, ProgressBar } from '../../components/ui'
import { IconAlert, IconCheck, IconChevronDown, IconClock, IconEdit, IconFlame, IconMoon, IconTrash } from '../../components/icons'

function fmtNum(n: number): string {
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 10) / 10)
}

export function GoalCard({
  goal,
  allCheckins,
  today,
  onCheckin,
  onEdit,
  onDelete,
  milestones = [],
  knowledgeItems = [],
  assessments = [],
  onOpenFocus,
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
}) {
  const [expanded, setExpanded] = useState(false)
  const computed = useMemo(() => {
    const goalCheckins = checkinsOfGoal(allCheckins, goal.id)
    return {
      goalCheckins,
      progress: computeGoalProgress(goal, goalCheckins),
      suggestion: computeTodaySuggestion(goal, goalCheckins, today),
      streak: calculateStreak(goal, goalCheckins, today),
      prediction: predictCompletion(goal, goalCheckins, today),
      yesterday: getYesterdayMissedState(goal, goalCheckins, today),
    }
  }, [goal, allCheckins, today])
  const { progress, suggestion, streak, prediction, yesterday } = computed
  const masterySummary = useMemo(
    () => getMasteryStats(knowledgeItems.filter((k) => k.goalId === goal.id && !k.isArchived), assessments),
    [knowledgeItems, assessments, goal.id],
  )
  const nextMilestone = useMemo(
    () =>
      milestones
        .filter((m) => m.goalId === goal.id)
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .find((m) => checkinsOfGoal(allCheckins, goal.id).filter((c) => c.milestoneId === m.id).reduce((s, c) => s + c.amount, 0) < m.plannedAmount) ?? null,
    [milestones, goal, allCheckins],
  )

  const deadlineDays = diffDays(goal.deadline, today)

  const suggestionText = () => {
    if (suggestion.kind === 'completed') return '已完成'
    if (suggestion.kind === 'notStarted') return `${formatMD(goal.startDate)} 开始`
    if (suggestion.kind === 'overdue') return `滚入今日 ${fmtNum(suggestion.suggestion)}`
    return `${fmtNum(suggestion.suggestion)} ${goal.unit}`
  }
  const predictionText = () => {
    if (prediction.status === 'completed') {
      return prediction.actualCompletionDate ? `${formatMD(prediction.actualCompletionDate)}完成` : '已完成'
    }
    if (prediction.status === 'insufficient') return '暂无推算'
    const dateText = prediction.projectedDate ? formatMD(prediction.projectedDate) : ''
    if (!prediction.comparison) return dateText
    if (prediction.comparison.kind === 'onTime') return `${dateText} · 预计按时`
    if (prediction.comparison.kind === 'early') return `${dateText} · 预计提前 ${prediction.comparison.days} 天`
    return `${dateText} · 预计拖后 ${prediction.comparison.days} 天`
  }

  if (progress.isCompleted) {
    return (
      <div className="rounded-xl2 border border-ok/30 bg-okSoft/40">
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          className="flex w-full items-center gap-3 px-4 py-3 text-left"
        >
          <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: COLOR_HEX[goal.color] }} />
          <span className="flex-1 truncate text-sm font-medium text-ink">{goal.name}</span>
          <CompletionMark />
          <span className="tnum text-xs text-ink3">{fmtNum(progress.done)} / {fmtNum(goal.totalAmount)} {goal.unit}</span>
          <IconChevronDown className={`text-ink3 transition-transform ${expanded ? 'rotate-180' : ''}`} />
        </button>
        {expanded && (
          <div className="space-y-2 border-t border-ok/20 px-4 py-3 text-xs text-ink2">
            <p>
              实际完成日：
              {prediction.actualCompletionDate ? `${formatMD(prediction.actualCompletionDate)}（${diffDays(goal.deadline, prediction.actualCompletionDate!) >= 0 ? '截止前' : '超出截止'} ${Math.abs(diffDays(goal.deadline, prediction.actualCompletionDate!))} 天）` : '—'}
            </p>
            <p>历史打卡 {computed.goalCheckins.length} 条已保留，可到「看板」查看明细。</p>
            <div className="flex gap-2 pt-1">
              <Button size="sm" variant="ghost" onClick={onEdit}>
                <IconEdit /> 编辑
              </Button>
              <Button size="sm" variant="ghost" className="text-danger" onClick={onDelete}>
                <IconTrash /> 删除
              </Button>
            </div>
          </div>
        )}
      </div>
    )
  }

  return (
    <article className="animate-rise rounded-xl2 border border-line/70 bg-surface shadow-card">
      <div className="flex items-start gap-3 px-4 pt-4">
        <span className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: COLOR_HEX[goal.color] }} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <h3 className="truncate text-[15px] font-semibold text-ink">{goal.name}</h3>
            {goal.isDemo && <Badge tone="neutral">示例</Badge>}
          </div>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-ink3">
            <span className="tnum">总量 {fmtNum(goal.totalAmount)} {goal.unit}</span>
            <span aria-hidden="true">·</span>
            <span>截止 {formatMD(goal.deadline)}</span>
            {today < goal.startDate ? (
              <Badge tone="neutral">{formatMD(goal.startDate)} 开始</Badge>
            ) : suggestion.kind === 'overdue' ? (
              <Badge tone="danger">已逾期 {suggestion.overdueDays} 天</Badge>
            ) : deadlineDays <= 3 ? (
              <Badge tone={deadlineDays === 0 ? 'warn' : 'neutral'}>{deadlineDays === 0 ? '今天截止' : `剩 ${deadlineDays} 天`}</Badge>
            ) : (
              <span>剩 {deadlineDays} 天</span>
            )}
          </p>
        </div>
        <ProgressRing percent={progress.percentCapped} color={COLOR_HEX[goal.color]} size={54} stroke={5}>
          <span className="tnum text-xs font-bold text-ink">{Math.round(progress.percentCapped)}%</span>
        </ProgressRing>
      </div>

      <div className="px-4 pt-3">
        <ProgressBar percent={progress.percentCapped} color={goal.color} />
        <p className="tnum mt-1.5 text-xs text-ink3">
          已完成 {fmtNum(progress.done)} / {fmtNum(goal.totalAmount)} {goal.unit}
        </p>
      </div>

      <div className="grid grid-cols-3 divide-x divide-line/70 border-b border-line/70 px-4 py-3 text-center">
        <div>
          <p className="text-[11px] text-ink3">今日建议</p>
          <p className="tnum mt-0.5 text-sm font-semibold text-primary">{suggestionText()}</p>
        </div>
        <div>
          <p className="flex items-center justify-center gap-1 text-[11px] text-ink3">
            <IconFlame className="text-xs" /> 连续
          </p>
          <p className="tnum mt-0.5 text-sm font-semibold text-ink">
            {streak.current > 0 ? `${streak.current} 天` : '—'}
          </p>
        </div>
        <div>
          <p className="text-[11px] text-ink3">预计完成</p>
          <p className="mt-0.5 text-[13px] font-semibold leading-5 text-ink">{predictionText()}</p>
        </div>
      </div>

      {masterySummary.hasItems && (
        <div className="border-b border-line/70 px-4 py-2">
          <p className="tnum text-[11px] text-ink3">
            知识掌握 {masterySummary.masteryCoverage}%（已掌握 {masterySummary.counts.mastered} · 待巩固 {masterySummary.counts.weak} · 待评估 {masterySummary.counts.unevaluated}）· 前往「看板」自测
          </p>
        </div>
      )}

      {nextMilestone && (
        <div className="border-b border-line/70 px-4 py-2.5">
          <p className="text-xs text-ink2">
            <span className="font-medium text-ink">下一阶段：</span>
            {nextMilestone.title}
            <span className="tnum ml-1.5 text-ink3">
              {fmtNum(nextMilestone.plannedAmount)} {goal.unit}
            </span>
            <span className="ml-1.5 text-ink3">· 在「看板 → 阶段计划」中管理</span>
          </p>
        </div>
      )}

      {(goal.obstacle || goal.ifThenPlan) && (
        <div className="space-y-1 border-b border-line/70 px-4 py-3 text-xs leading-relaxed">
          {goal.obstacle && (
            <p className="text-ink2">
              <span className="font-medium text-ink">障碍：</span>
              {goal.obstacle}
            </p>
          )}
          {goal.ifThenPlan && (
            <p className="text-ink2">
              <span className="font-medium text-ink">预案：</span>
              {goal.ifThenPlan}
            </p>
          )}
        </div>
      )}

      {yesterday.level === 'forgiven' && (
        <div className="border-b border-line/70 px-4 py-3">
          <div className="flex items-start gap-2.5 rounded-xl bg-warnSoft px-3 py-2.5 text-xs leading-relaxed text-warn">
            <IconMoon className="mt-0.5 shrink-0 text-sm" />
            <span>
              昨天没有打卡，已自动使用本周<b>弹性休息日</b>，连续记录仍保留。今天继续打卡即可。
            </span>
          </div>
        </div>
      )}
      {yesterday.level === 'broken' && (
        <div className="border-b border-line/70 px-4 py-3">
          <div className="rounded-xl bg-dangerSoft px-3 py-2.5 text-xs leading-relaxed text-danger">
            <p className="flex items-start gap-2.5">
              <IconAlert className="mt-0.5 shrink-0 text-sm" />
              <span>
                昨天缺卡且本周休息额度已用完，<b>连续记录中断</b>。不修改历史，从今天重新开始。
              </span>
            </p>
            {yesterday.rollIntoToday && (
              <p className="mt-1.5 pl-6">
                建议把剩余计划滚入今日：
                <b className="tnum"> {fmtNum(yesterday.rollIntoToday)} {goal.unit}</b>
              </p>
            )}
          </div>
        </div>
      )}
      {suggestion.kind === 'overdue' && (
        <div className="border-b border-line/70 px-4 py-3">
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-dangerSoft px-3 py-2.5 text-xs text-danger">
            <span>
              已逾期 <b className="tnum">{suggestion.overdueDays}</b> 天，剩余 {fmtNum(suggestion.remaining)} {goal.unit}
            </span>
            <div className="flex gap-2">
              <Button size="sm" variant="danger" onClick={onCheckin}>
                <IconCheck /> 立即打卡
              </Button>
              <Button size="sm" variant="secondary" onClick={onEdit}>
                <IconClock /> 调整计划
              </Button>
            </div>
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 px-4 py-3">
        {suggestion.kind !== 'overdue' && (
          <Button size="sm" onClick={onCheckin}>
            <IconCheck /> 立即打卡
          </Button>
        )}
        <QuickActions goal={goal} onOpenFocus={onOpenFocus ?? (() => undefined)} />
        <Button size="sm" variant="secondary" onClick={onEdit}>
          <IconEdit /> 编辑
        </Button>
        <Button size="sm" variant="ghost" className="ml-auto text-ink3 hover:text-danger" aria-label={`删除目标 ${goal.name}`} onClick={onDelete}>
          <IconTrash className="text-base" />
        </Button>
      </div>

      <LifecycleControls goal={goal} />
    </article>
  )
}
