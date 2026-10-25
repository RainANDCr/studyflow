import { useMemo, useState } from 'react'
import type { DailyPlan, DateStr, Goal, StudyCalendarPreference } from '../../domain/types'
import { COLOR_HEX } from '../../domain/types'
import { addDays, formatMD, weekdayShort } from '../../domain/dates'
import { buildReschedulePreview, distributeRemaining, getDayPlanStatus, monthGridDates } from '../../domain/dailyPlan'
import { useAppData } from '../../state/AppData'
import { Button, Card, EmptyState } from '../../components/ui'
import { ConfirmDialog, Modal, useToast } from '../../components/feedback'
import { IconCheck, IconChevronLeft, IconChevronRight, IconPlus, IconRefresh, IconTarget, IconX } from '../../components/icons'
import { CheckinDialog } from '../today/CheckinDialog'
import { BudgetDialog, RescheduleCard } from '../generic/GenericViews'
import { DayDetailDrawer } from './DayDetailDrawer'

function fmt(n: number): string {
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100)
}

interface AutoScheduleState {
  goal: Goal
  preview: ReturnType<typeof buildReschedulePreview> | null
  error: Extract<ReturnType<typeof distributeRemaining>, { kind: 'overdue' | 'noStudyDays' | 'capacity' | 'completed' }> | null
}

/** 智能学习日历：月/周视图 + 计划 vs 实际 + 拖拽改期 + 自动排程预览。二级视图，不占主 Tab。 */
export function CalendarView({ onBack }: { onBack: () => void }) {
  const { goals, checkins, dailyPlans, today, saveDailyPlans, applyDailyPlanChanges, getCalendarPref, saveCalendarPref, putV4Rows } = useAppData()
  const toast = useToast()
  const [mode, setMode] = useState<'month' | 'week'>('month')
  const [month, setMonth] = useState(() => today.slice(0, 7))
  const [weekStart, setWeekStart] = useState(() => today)
  const [selectedDate, setSelectedDate] = useState<DateStr | null>(null)
  const [goalFilter, setGoalFilter] = useState<string>('all')
  const [onlyUnfinished, setOnlyUnfinished] = useState(false)
  const [checkinGoal, setCheckinGoal] = useState<Goal | null>(null)
  const [autoSchedule, setAutoSchedule] = useState<AutoScheduleState | null>(null)
  const [pendingMove, setPendingMove] = useState<{ plan: DailyPlan; toDate: DateStr } | null>(null)
  const [budgetOpen, setBudgetOpen] = useState(false)
  const [moving, setMoving] = useState(false)

  const visibleGoals = useMemo(
    () => (goalFilter === 'all' ? goals : goals.filter((g) => g.id === goalFilter)),
    [goals, goalFilter],
  )

  const gridDates = useMemo(() => {
    if (mode === 'month') return monthGridDates(month)
    return Array.from({ length: 7 }, (_, i) => addDays(weekStart, i))
  }, [mode, month, weekStart])

  const dayStatuses = useMemo(() => {
    const map = new Map<DateStr, ReturnType<typeof getDayPlanStatus>>()
    for (const d of gridDates) {
      map.set(d, getDayPlanStatus(d, visibleGoals, dailyPlans, checkins))
    }
    return map
  }, [gridDates, visibleGoals, dailyPlans, checkins])

  const shiftMonth = (delta: number) => {
    const [y, m] = month.split('-').map(Number)
    const d = new Date(y, m - 1 + delta, 1)
    setMonth(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`)
  }

  /* ---- 拖拽改期（桌面）；失败由异常路径恢复并报错 ---- */
  const requestMove = (plan: DailyPlan, toDate: DateStr) => {
    if (plan.date === toDate) return
    setPendingMove({ plan, toDate })
  }

  const confirmMove = async () => {
    if (!pendingMove) return
    setMoving(true)
    try {
      const { plan, toDate } = pendingMove
      await saveDailyPlans([
        {
          ...plan,
          date: toDate,
          source: 'manual', // 用户改动必须保留
          updatedAt: new Date().toISOString(),
        },
      ])
      toast.success(`已将计划从 ${formatMD(plan.date)} 移动到 ${formatMD(toDate)}`)
      setPendingMove(null)
    } catch (err) {
      // 落库失败：原计划未动，界面数据来自重载后的仓库，自然恢复
      toast.error(err instanceof Error ? `移动失败：${err.message}` : '移动失败，请重试')
    } finally {
      setMoving(false)
    }
  }

  /* ---- 自动排程 ---- */
  const openAutoSchedule = async (goal: Goal) => {
    const prefs = await getCalendarPref(goal.id)
    const result = distributeRemaining(goal, prefs, checkins, today)
    if (result.kind === 'ok') {
      const existing = dailyPlans.filter((p) => p.goalId === goal.id)
      setAutoSchedule({ goal, preview: buildReschedulePreview(goal.id, existing, result.plans, today), error: null })
    } else {
      setAutoSchedule({ goal, preview: null, error: result })
    }
  }

  const confirmAutoSchedule = async () => {
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
  }

  const savePrefsFor = async (_goalId: string, prefs: StudyCalendarPreference) => {
    await saveCalendarPref(prefs)
    toast.info('计划偏好已保存。点击「自动排程」按新偏好重排。')
  }

  const activeGoalsForSchedule = goals.filter((g) => today <= g.deadline)

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={onBack} aria-label="返回今日列表">
            <IconChevronLeft /> 返回
          </Button>
          <h1 className="text-lg font-bold text-ink">学习日历</h1>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={goalFilter}
            onChange={(e) => setGoalFilter(e.target.value)}
            aria-label="按目标筛选"
            className="h-8 rounded-lg border border-line bg-surface px-2 text-xs text-ink"
          >
            <option value="all">全部目标</option>
            {goals.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </select>
          <label className="flex cursor-pointer items-center gap-1.5 text-xs text-ink2">
            <input type="checkbox" checked={onlyUnfinished} onChange={(e) => setOnlyUnfinished(e.target.checked)} className="accent-[rgb(var(--c-primary))]" />
            只看未完成
          </label>
          {activeGoalsForSchedule.length > 0 && (
            <select
              aria-label="选择目标并自动排程"
              defaultValue=""
              onChange={(e) => {
                const g = goals.find((x) => x.id === e.target.value)
                if (g) void openAutoSchedule(g)
                e.currentTarget.value = ''
              }}
              className="h-8 rounded-lg border border-primary/40 bg-primarySoft px-2 text-xs font-medium text-primary"
            >
              <option value="" disabled>
                自动排程…
              </option>
              {activeGoalsForSchedule.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </select>
          )}
        </div>
      </header>

      <RescheduleCard onApply={(g) => void openAutoSchedule(g)} />

      <Card className="px-3 py-3">
        <div className="mb-2 flex items-center justify-between gap-2">
          {mode === 'month' ? (
            <>
              <Button size="sm" variant="ghost" aria-label="上一月" onClick={() => shiftMonth(-1)}>
                <IconChevronLeft />
              </Button>
              <p className="text-sm font-semibold text-ink">{month.replace('-', ' 年 ')} 月</p>
              <Button size="sm" variant="ghost" aria-label="下一月" onClick={() => shiftMonth(1)}>
                <IconChevronRight />
              </Button>
            </>
          ) : (
            <>
              <Button size="sm" variant="ghost" aria-label="上一周" onClick={() => setWeekStart((w) => addDays(w, -7))}>
                <IconChevronLeft />
              </Button>
              <p className="text-sm font-semibold text-ink">
                {formatMD(weekStart)} - {formatMD(addDays(weekStart, 6))}
              </p>
              <Button size="sm" variant="ghost" aria-label="下一周" onClick={() => setWeekStart((w) => addDays(w, 7))}>
                <IconChevronRight />
              </Button>
            </>
          )}
        </div>
        <div className="mb-2 flex items-center justify-between text-xs">
          <div className="flex gap-1">
            <Button size="sm" variant={mode === 'month' ? 'soft' : 'ghost'} onClick={() => setMode('month')}>
              月
            </Button>
            <Button size="sm" variant={mode === 'week' ? 'soft' : 'ghost'} onClick={() => setMode('week')}>
              周
            </Button>
          </div>
          <Button size="sm" variant="secondary" onClick={() => setBudgetOpen(true)}>
            时间预算
          </Button>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => {
              setMonth(today.slice(0, 7))
              const dow = new Date(Number(today.slice(0, 4)), Number(today.slice(5, 7)) - 1, Number(today.slice(8, 10))).getDay()
              setWeekStart(addDays(today, -(dow === 0 ? 7 : dow) + 1))
            }}
          >
            回到今天
          </Button>
        </div>

        <div className="grid grid-cols-7 gap-px overflow-hidden rounded-lg bg-line/60 text-center text-[11px] text-ink3">
          {['一', '二', '三', '四', '五', '六', '日'].map((w) => (
            <div key={w} className="bg-surface py-1 font-medium">
              {w}
            </div>
          ))}
        </div>
        <div className={`grid grid-cols-7 gap-px overflow-hidden rounded-b-lg bg-line/60 ${mode === 'week' ? 'grid-rows-1' : ''}`}>
          {gridDates.map((d) => {
            const st = dayStatuses.get(d)
            if (!st) return null
            const inMonth = mode === 'week' || d.slice(0, 7) === month
            const isToday = d === today
            const items = st.items.filter((i) => {
              if (goalFilter !== 'all' && i.goal.id !== goalFilter) return false
              if (onlyUnfinished && i.actual >= i.plan.plannedAmount && i.plan.plannedAmount > 0) return false
              return true
            })
            const allDone = st.planned > 0 && st.items.every((i) => i.actual >= i.plan.plannedAmount)
            return (
              <button
                key={d}
                type="button"
                onClick={() => setSelectedDate(d)}
                onDragOver={(e) => {
                  e.preventDefault()
                  e.currentTarget.classList.add('ring-2', 'ring-primary')
                }}
                onDragLeave={(e) => e.currentTarget.classList.remove('ring-2', 'ring-primary')}
                onDrop={(e) => {
                  e.preventDefault()
                  e.currentTarget.classList.remove('ring-2', 'ring-primary')
                  const planId = e.dataTransfer.getData('text/studyflow-plan')
                  const plan = dailyPlans.find((p) => p.id === planId)
                  if (plan) requestMove(plan, d)
                }}
                aria-label={`${formatMD(d)}，计划 ${fmt(st.planned)}，实际 ${fmt(st.actual)}`}
                className={`flex min-h-[64px] flex-col gap-0.5 bg-surface p-1 text-left transition-colors hover:bg-primarySoft/40 sm:min-h-[76px] ${
                  inMonth ? '' : 'opacity-40'
                } ${isToday ? 'ring-1 ring-inset ring-primary' : ''}`}
              >
                <span className={`tnum text-[11px] font-semibold ${isToday ? 'text-primary' : 'text-ink2'}`}>
                  {Number(d.slice(8, 10))}
                </span>
                {items.slice(0, 3).map(({ plan, goal, actual }) => (
                  <span
                    key={plan.id}
                    draggable
                    onDragStart={(e) => {
                      e.dataTransfer.setData('text/studyflow-plan', plan.id)
                    }}
                    onClick={(e) => e.stopPropagation()}
                    className={`flex items-center gap-1 truncate rounded px-1 py-0.5 text-[10px] leading-tight ${
                      actual >= plan.plannedAmount && plan.plannedAmount > 0 ? 'bg-okSoft text-ok line-through opacity-80' : 'bg-surface2 text-ink2'
                    }`}
                    title={`${goal.name}：计划 ${fmt(plan.plannedAmount)} / 实际 ${fmt(actual)} ${goal.unit}`}
                  >
                    <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: COLOR_HEX[goal.color] }} />
                    <span className="tnum truncate">{fmt(plan.plannedAmount)}</span>
                  </span>
                ))}
                {items.length > 3 && <span className="tnum text-[9px] text-ink3">+{items.length - 3}</span>}
                {allDone && (
                  <span className="mt-auto flex items-center gap-0.5 text-[9px] font-medium text-ok">
                    <IconCheck className="text-[10px]" /> 已达成
                  </span>
                )}
                {st.planned === 0 && st.actual > 0 && (
                  <span className="mt-auto flex items-center gap-0.5 text-[9px] text-ok">
                    <IconCheck className="text-[10px]" />
                    {fmt(st.actual)}
                  </span>
                )}
              </button>
            )
          })}
        </div>
        <p className="mt-2 text-[11px] leading-relaxed text-ink3">
          格中数字为当日计划量（绿底划线 = 已达成）；拖动计划条到其他日期可改期（手机在日详情中更改）。点击日期查看「计划 X / 实际 Y」明细。
        </p>
      </Card>

      {goals.length === 0 && (
        <EmptyState
          icon={<IconTarget />}
          title="还没有学习目标"
          description="先在「今日」创建目标，再回到日历安排每日计划。"
          action={
            <Button onClick={onBack}>
              <IconPlus /> 去创建目标
            </Button>
          }
        />
      )}

      {selectedDate && (
        <DayDetailDrawer
          date={selectedDate}
          goals={goals}
          onClose={() => setSelectedDate(null)}
          onCheckin={(g) => setCheckinGoal(g)}
          onSavePrefs={savePrefsFor}
        />
      )}

      <CheckinDialog open={!!checkinGoal} onClose={() => setCheckinGoal(null)} goal={checkinGoal} />
      <BudgetDialog open={budgetOpen} onClose={() => setBudgetOpen(false)} />

      {/* 拖拽改期确认：明确显示源日期/目标日期 */}
      <ConfirmDialog
        open={!!pendingMove}
        title="移动计划"
        confirmText="确认移动"
        busy={moving}
        message={
          pendingMove ? (
            <span>
              将 <b>{formatMD(pendingMove.plan.date)}</b> 的计划（{fmt(pendingMove.plan.plannedAmount)}{' '}
              {goals.find((g) => g.id === pendingMove.plan.goalId)?.unit}）移动到 <b>{formatMD(pendingMove.toDate)}</b>？移动后该计划视为手动安排。
            </span>
          ) : null
        }
        onConfirm={() => void confirmMove()}
        onClose={() => setPendingMove(null)}
      />

      {/* 自动排程预览 / 错误说明 */}
      <Modal
        open={!!autoSchedule}
        onClose={() => setAutoSchedule(null)}
        title={autoSchedule ? `自动排程 · ${autoSchedule.goal.name}` : ''}
        footer={
          autoSchedule?.preview ? (
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setAutoSchedule(null)}>
                取消
              </Button>
              <Button onClick={() => void confirmAutoSchedule()}>
                <IconRefresh /> 确认应用
              </Button>
            </div>
          ) : (
            <div className="flex justify-end">
              <Button variant="ghost" onClick={() => setAutoSchedule(null)}>
                关闭
              </Button>
            </div>
          )
        }
      >
        {autoSchedule?.error && (
          <div className="space-y-3 text-sm leading-relaxed text-ink2">
            {autoSchedule.error.kind === 'completed' && <p>该目标已完成，不需要生成新计划。</p>}
            {autoSchedule.error.kind === 'overdue' && (
              <p>
                目标已逾期 <b className="tnum">{autoSchedule.error.overdueDays}</b> 天，剩余{' '}
                {fmt(autoSchedule.error.remaining)} {autoSchedule.goal.unit}。请先「调整计划」（修改截止日或总量）再排程。
              </p>
            )}
            {autoSchedule.error.kind === 'noStudyDays' && (
              <p>
                {formatMD(autoSchedule.error.from)} 至 {formatMD(autoSchedule.error.to)} 之间没有符合学习星期与排除日期设定的可安排日。请放宽「计划设置」中的学习星期或移除排除日期。
              </p>
            )}
            {autoSchedule.error.kind === 'capacity' && (
              <p>
                每日上限 {fmt(autoSchedule.error.cap)} 不足以容纳所需日均量{' '}
                <b className="tnum">{fmt(autoSchedule.error.requiredPerDay)}</b>（{autoSchedule.error.studyDayCount} 个学习日）。可选择：放宽每日上限、修改截止日延长周期，或继续手动调整。
              </p>
            )}
          </div>
        )}
        {autoSchedule?.preview && (
          <div className="space-y-3 text-sm">
            <p className="text-xs text-ink3">
              只重排今日及以后的自动计划；手动安排与历史日期不会改动。以下为变更预览：
            </p>
            {autoSchedule.preview.upserts.length === 0 && autoSchedule.preview.removals.length === 0 ? (
              <p className="rounded-xl bg-okSoft px-3 py-2.5 text-xs text-ok">
                无需变更：现有计划已与剩余量分配一致（{autoSchedule.preview.unchanged} 项保持不变）。
              </p>
            ) : (
              <>
                {autoSchedule.preview.upserts.length > 0 && (
                  <div>
                    <p className="mb-1 text-xs font-semibold text-ink2">更新 / 新增（{autoSchedule.preview.upserts.length}）</p>
                    <ul className="max-h-40 space-y-1 overflow-y-auto text-xs">
                      {autoSchedule.preview.upserts.map((u) => (
                        <li key={u.date} className="tnum flex items-center justify-between rounded-lg bg-surface2 px-2.5 py-1.5">
                          <span>
                            {formatMD(u.date)} {weekdayShort(u.date)}
                          </span>
                          <span className="font-medium text-ink">{fmt(u.plannedAmount)} {autoSchedule.goal.unit}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {autoSchedule.preview.removals.length > 0 && (
                  <div>
                    <p className="mb-1 text-xs font-semibold text-ink2">移除（{autoSchedule.preview.removals.length}）</p>
                    <ul className="max-h-32 space-y-1 overflow-y-auto text-xs">
                      {autoSchedule.preview.removals.map((r) => (
                        <li key={r.id} className="tnum flex items-center justify-between rounded-lg bg-dangerSoft/60 px-2.5 py-1.5 text-danger">
                          <span>
                            {formatMD(r.date)} {weekdayShort(r.date)}
                          </span>
                          <span className="flex items-center gap-1">
                            {fmt(r.plannedAmount)} <IconX className="text-xs" />
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                <p className="tnum text-[11px] text-ink3">
                  保持不变 {autoSchedule.preview.unchanged} 项 · 手动安排让位 {autoSchedule.preview.manualKept} 项
                </p>
              </>
            )}
          </div>
        )}
      </Modal>
    </div>
  )
}
