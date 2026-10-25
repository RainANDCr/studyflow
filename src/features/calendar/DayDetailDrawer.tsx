import { useEffect, useMemo, useState } from 'react'
import type { Checkin, DailyPlan, DateStr, Goal, StudyCalendarPreference } from '../../domain/types'
import { COLOR_HEX } from '../../domain/types'
import { diffDays, formatMD, formatFullCN, weekdayShort } from '../../domain/dates'
import { checkinsOfGoal, computeGoalProgress } from '../../domain/progress'
import { getDayPlanStatus, normalizePrefs } from '../../domain/dailyPlan'
import { useAppData } from '../../state/AppData'
import { Button, Field, Input } from '../../components/ui'
import { Modal, useToast } from '../../components/feedback'
import { IconCheck, IconMoon, IconPlus, IconX } from '../../components/icons'

const WEEKDAY_LABELS = ['一', '二', '三', '四', '五', '六', '日']

function fmt(n: number): string {
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100)
}

/**
 * 日期详情抽屉：按目标列出当日计划/实际/差额；
 * 支持直接打卡、调整计划量（转手动）、更改日期（手机/键盘等价于桌面拖拽）、
 * 标记该日不安排、按目标编辑「计划设置」（学习星期/排除日/每日上限）。
 */
export function DayDetailDrawer({
  date,
  goals,
  onClose,
  onCheckin,
  onSavePrefs,
}: {
  date: DateStr
  goals: Goal[]
  onClose: () => void
  onCheckin: (goal: Goal) => void
  onSavePrefs: (goalId: string, prefs: StudyCalendarPreference) => Promise<void>
}) {
  const { checkins, dailyPlans, today, saveDailyPlans, deleteDailyPlanById, getCalendarPref } = useAppData()
  const toast = useToast()
  const status = useDayStatus(date, goals, dailyPlans, checkins)
  const [editingPlanId, setEditingPlanId] = useState<string | null>(null)
  const [editAmount, setEditAmount] = useState('')
  const [movePlanId, setMovePlanId] = useState<string | null>(null)
  const [moveDate, setMoveDate] = useState('')
  const [prefGoalId, setPrefGoalId] = useState<string | null>(null)
  const [prefDraft, setPrefDraft] = useState<StudyCalendarPreference | null>(null)
  const [newExcluded, setNewExcluded] = useState('')

  useEffect(() => {
    setEditingPlanId(null)
    setMovePlanId(null)
    setPrefGoalId(null)
  }, [date])

  const openPrefs = async (goal: Goal) => {
    const saved = await getCalendarPref(goal.id)
    const base = normalizePrefs(saved)
    setPrefDraft({ ...base, goalId: goal.id })
    setPrefGoalId(goal.id)
    setNewExcluded('')
  }

  const saveAmountAsManual = async (plan: DailyPlan) => {
    const v = Number(editAmount)
    if (!Number.isFinite(v) || v <= 0) {
      toast.error('计划量需为大于 0 的数字')
      return
    }
    try {
      await saveDailyPlans([{ ...plan, plannedAmount: v, source: 'manual', updatedAt: new Date().toISOString() }])
      toast.success('已调整计划量（转为手动安排，自动排程不会覆盖）')
      setEditingPlanId(null)
    } catch (err) {
      toast.error(err instanceof Error ? `保存失败：${err.message}` : '保存失败，请重试')
    }
  }

  const movePlanToDate = async (plan: DailyPlan) => {
    if (!moveDate || !/^\d{4}-\d{2}-\d{2}$/.test(moveDate)) {
      toast.error('请选择有效的目标日期')
      return
    }
    if (moveDate === plan.date) return
    try {
      await saveDailyPlans([{ ...plan, date: moveDate, source: 'manual', updatedAt: new Date().toISOString() }])
      toast.success(`已从 ${formatMD(plan.date)} 移动到 ${formatMD(moveDate)}`)
      setMovePlanId(null)
    } catch (err) {
      toast.error(err instanceof Error ? `移动失败：${err.message}` : '移动失败，原计划保持不变')
    }
  }

  const markRestDay = async (goal: Goal) => {
    const plan = status.items.find((i) => i.goal.id === goal.id)?.plan
    try {
      if (plan) await deleteDailyPlanById(plan.id)
      const saved = await getCalendarPref(goal.id)
      const base = normalizePrefs(saved)
      if (!base.excludedDates.includes(date)) {
        await onSavePrefs(goal.id, { ...base, goalId: goal.id, excludedDates: [...base.excludedDates, date].sort() })
      } else if (!plan) {
        toast.info('该日已在此目标的排除日期中')
        return
      }
      toast.success(`已将 ${formatMD(date)} 标记为「${goal.name}」不安排学习`)
    } catch (err) {
      toast.error(err instanceof Error ? `操作失败：${err.message}` : '操作失败，请重试')
    }
  }

  return (
    <Modal open onClose={onClose} title={`${formatFullCN(date)} ${weekdayShort(date)}`}>
      <div className="space-y-4">
        {status.items.length === 0 && status.goals.length === 0 && (
          <p className="rounded-xl bg-base px-3.5 py-3 text-xs leading-relaxed text-ink3">
            这一天没有学习计划，也没有打卡记录。
            {date > today && ' （未来日期）'}
            {date < today && ' （过去日期，可通过下方打卡进行补记）'}
          </p>
        )}

        {status.items.map(({ plan, goal, actual }) => {
          const progress = computeGoalProgress(goal, checkinsOfGoal(checkins, goal.id))
          const remainingToday = Math.max(0, plan.plannedAmount - actual)
          const overdueDays = today > goal.deadline ? diffDays(today, goal.deadline) : null
          return (
            <div key={plan.id} className="rounded-xl border border-line/70 p-3">
              <div className="flex items-center gap-2">
                <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: COLOR_HEX[goal.color] }} />
                <p className="min-w-0 flex-1 truncate text-sm font-semibold text-ink">{goal.name}</p>
                {plan.source === 'manual' && <span className="rounded-md bg-surface2 px-1.5 py-0.5 text-[10px] text-ink3">手动</span>}
                {actual >= plan.plannedAmount && plan.plannedAmount > 0 && (
                  <span className="inline-flex items-center gap-1 rounded-md bg-okSoft px-1.5 py-0.5 text-[10px] font-medium text-ok">
                    <IconCheck className="text-[11px]" /> 已达成
                  </span>
                )}
              </div>
              <div className="tnum mt-2 grid grid-cols-3 gap-2 text-center text-xs">
                <div className="rounded-lg bg-base px-2 py-1.5">
                  <p className="text-[10px] text-ink3">当日计划</p>
                  <p className="mt-0.5 font-semibold text-ink">{fmt(plan.plannedAmount)} {goal.unit}</p>
                </div>
                <div className="rounded-lg bg-base px-2 py-1.5">
                  <p className="text-[10px] text-ink3">当日实际</p>
                  <p className="mt-0.5 font-semibold text-ok">{fmt(actual)} {goal.unit}</p>
                </div>
                <div className="rounded-lg bg-base px-2 py-1.5">
                  <p className="text-[10px] text-ink3">剩余计划</p>
                  <p className={`mt-0.5 font-semibold ${remainingToday > 0 ? 'text-warn' : 'text-ink3'}`}>{fmt(remainingToday)} {goal.unit}</p>
                </div>
              </div>
              <p className="tnum mt-2 text-[11px] text-ink3">
                目标总量 {fmt(goal.totalAmount)} {goal.unit} · 已完成 {fmt(progress.done)}（{Math.round(progress.percentCapped)}%）· 截止 {formatMD(goal.deadline)}
                {overdueDays !== null && <span className="text-danger"> · 已逾期 {overdueDays} 天</span>}
              </p>

              {editingPlanId === plan.id ? (
                <div className="mt-2 flex items-end gap-2">
                  <Field label="新计划量" htmlFor={`plan-amount-${plan.id}`} >
                    <Input
                      id={`plan-amount-${plan.id}`}
                      type="number"
                      min={0}
                      step="any"
                      value={editAmount}
                      onChange={(e) => setEditAmount(e.target.value)}
                      className="h-9 w-28"
                    />
                  </Field>
                  <Button size="sm" onClick={() => void saveAmountAsManual(plan)}>
                    保存
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setEditingPlanId(null)}>
                    取消
                  </Button>
                </div>
              ) : movePlanId === plan.id ? (
                <div className="mt-2 flex flex-wrap items-end gap-2">
                  <Field label="移动到" htmlFor={`move-date-${plan.id}`} hint={`源日期 ${formatMD(plan.date)}`}>
                    <Input
                      id={`move-date-${plan.id}`}
                      type="date"
                      value={moveDate}
                      onChange={(e) => setMoveDate(e.target.value)}
                      className="h-9 w-40"
                    />
                  </Field>
                  <Button size="sm" onClick={() => void movePlanToDate(plan)}>
                    确认移动
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setMovePlanId(null)}>
                    取消
                  </Button>
                </div>
              ) : (
                <div className="mt-2.5 flex flex-wrap gap-2">
                  <Button size="sm" onClick={() => onCheckin(goal)}>
                    <IconCheck /> 直接打卡
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => {
                      setEditingPlanId(plan.id)
                      setEditAmount(String(plan.plannedAmount))
                    }}
                  >
                    调整计划量
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => {
                      setMovePlanId(plan.id)
                      setMoveDate(plan.date)
                    }}
                  >
                    更改日期
                  </Button>
                  <Button size="sm" variant="ghost" className="text-ink3 hover:text-danger" onClick={() => void markRestDay(goal)}>
                    <IconMoon /> 该日不安排
                  </Button>
                </div>
              )}
            </div>
          )
        })}

        {/* 当天只有打卡、没有计划的目标 */}
        {status.goals
          .filter((g) => !status.items.some((i) => i.goal.id === g.id))
          .map((goal) => {
            const actual = status.actualByGoal.get(goal.id) ?? 0
            return (
              <div key={goal.id} className="flex items-center gap-2 rounded-xl border border-dashed border-line px-3 py-2.5">
                <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: COLOR_HEX[goal.color] }} />
                <p className="min-w-0 flex-1 truncate text-xs text-ink2">
                  {goal.name}：当日无计划，实际打卡 <b className="tnum text-ink">{fmt(actual)} {goal.unit}</b>
                </p>
                <Button size="sm" variant="ghost" onClick={() => onCheckin(goal)}>
                  继续打卡
                </Button>
              </div>
            )
          })}

        {/* 计划设置（按目标）：学习星期 / 排除日期 / 每日上限 */}
        <div className="rounded-xl border border-line/70 bg-base px-3.5 py-3">
          <p className="mb-2 text-xs font-semibold text-ink2">计划设置</p>
          {goals.length === 0 ? (
            <p className="text-xs text-ink3">没有可设置的目标。</p>
          ) : prefGoalId === null ? (
            <div className="flex flex-wrap gap-2">
              {goals.map((g) => (
                <Button key={g.id} size="sm" variant="secondary" onClick={() => void openPrefs(g)}>
                  {g.name}
                </Button>
              ))}
            </div>
          ) : prefDraft ? (
            <div className="space-y-3">
              <div>
                <p className="mb-1.5 text-[11px] text-ink3">学习星期（{goals.find((g) => g.id === prefGoalId)?.name}）</p>
                <div className="flex gap-1.5">
                  {WEEKDAY_LABELS.map((label, idx) => {
                    const day = idx + 1
                    const on = prefDraft.studyWeekdays.includes(day)
                    return (
                      <button
                        key={day}
                        type="button"
                        aria-pressed={on}
                        aria-label={`周${label}`}
                        onClick={() =>
                          setPrefDraft({
                            ...prefDraft,
                            studyWeekdays: on ? prefDraft.studyWeekdays.filter((d) => d !== day) : [...prefDraft.studyWeekdays, day].sort(),
                          })
                        }
                        className={`h-8 w-8 rounded-lg text-xs font-medium transition-colors ${
                          on ? 'gradient-primary text-white' : 'border border-line bg-surface text-ink3'
                        }`}
                      >
                        {label}
                      </button>
                    )
                  })}
                </div>
              </div>
              <div>
                <p className="mb-1.5 text-[11px] text-ink3">排除日期（考试周、旅行等，共 {prefDraft.excludedDates.length} 天）</p>
                <div className="mb-2 flex flex-wrap gap-1.5">
                  {prefDraft.excludedDates.map((d) => (
                    <span key={d} className="tnum inline-flex items-center gap-1 rounded-md bg-surface2 px-2 py-1 text-[11px] text-ink2">
                      {formatMD(d)}
                      <button
                        type="button"
                        aria-label={`移除排除日期 ${d}`}
                        onClick={() => setPrefDraft({ ...prefDraft, excludedDates: prefDraft.excludedDates.filter((x) => x !== d) })}
                        className="text-ink3 hover:text-danger"
                      >
                        <IconX className="text-xs" />
                      </button>
                    </span>
                  ))}
                  {prefDraft.excludedDates.length === 0 && <span className="text-[11px] text-ink3">无</span>}
                </div>
                <div className="flex items-end gap-2">
                  <Input
                    type="date"
                    value={newExcluded}
                    onChange={(e) => setNewExcluded(e.target.value)}
                    aria-label="添加排除日期"
                    className="h-9 w-40"
                  />
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={!newExcluded}
                    onClick={() => {
                      if (newExcluded && !prefDraft.excludedDates.includes(newExcluded)) {
                        setPrefDraft({ ...prefDraft, excludedDates: [...prefDraft.excludedDates, newExcluded].sort() })
                      }
                      setNewExcluded('')
                    }}
                  >
                    <IconPlus /> 添加
                  </Button>
                </div>
              </div>
              <Field label="每日计划上限（留空不设上限）" htmlFor="daily-cap">
                <Input
                  id="daily-cap"
                  type="number"
                  min={0}
                  step="any"
                  value={prefDraft.dailyCap ?? ''}
                  onChange={(e) => setPrefDraft({ ...prefDraft, dailyCap: e.target.value === '' ? null : Number(e.target.value) })}
                  className="h-9 w-32"
                />
              </Field>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  onClick={() => {
                    void onSavePrefs(prefGoalId, prefDraft)
                    setPrefGoalId(null)
                  }}
                >
                  保存设置
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setPrefGoalId(null)}>
                  取消
                </Button>
              </div>
              <p className="text-[11px] leading-relaxed text-ink3">
                与「每周弹性休息日」相互独立：这里只决定日历自动排程在哪些天安排任务。
              </p>
            </div>
          ) : null}
        </div>

        {date > today && status.planned > 0 && (
          <p className="rounded-xl bg-primarySoft px-3.5 py-2.5 text-[11px] leading-relaxed text-primary">
            这是未来日期：计划只是「准备做」，实际完成以当天打卡为准，现在打卡不会被计入未来日期。
          </p>
        )}
      </div>
    </Modal>
  )
}

function useDayStatus(date: DateStr, goals: Goal[], plans: DailyPlan[], checkins: Checkin[]) {
  return useMemo(() => {
    const st = getDayPlanStatus(date, goals, plans, checkins)
    const actualByGoal = new Map<string, number>()
    for (const c of checkins.filter((x) => x.date === date)) {
      actualByGoal.set(c.goalId, (actualByGoal.get(c.goalId) ?? 0) + c.amount)
    }
    return { ...st, actualByGoal }
  }, [date, goals, plans, checkins])
}
