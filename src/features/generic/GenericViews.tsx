import { useMemo, useState } from 'react'
import type { AvailabilityException, Checkin, DailyPlan, DateStr, Goal, GoalPlanPolicy, PlanRevision, WeeklyAvailability } from '../../domain/types'
import { detectRescheduleNeeds, efficiencyStats, longReportStats, monthRange, planVsActualWeek, quarterRange, generateReportText, weekBudgetStats, yearRange, type PeriodRange } from '../../domain/generic'
import { buildReschedulePreview, distributeRemaining } from '../../domain/dailyPlan'
import { addDays, formatMD, weekStart as weekStartOf, weekdayShort } from '../../domain/dates'
import { useAppData } from '../../state/AppData'
import { Button, Card, Field, Input, ProgressBar, StatTile, TextArea } from '../../components/ui'
import { ConfirmDialog, Modal, useToast } from '../../components/feedback'
import { IconRefresh, IconTrash } from '../../components/icons'
import { nowIso, useV4 } from './GenericUI'

/* ================= 功能2：每周时间预算 ================= */

export function BudgetDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { checkins, dailyPlans, focusSessions, today, putV4Rows, deleteV4Rows } = useAppData()
  const toast = useToast()
  const weekly = useV4Rows<WeeklyAvailability>('weeklyAvailability') as Array<{ weekday: number; availableMinutes: number; updatedAt: string }>
  const exceptions = useV4Rows<AvailabilityException>('availabilityExceptions') as AvailabilityException[]
  const policies = useV4Rows<GoalPlanPolicy>('goalPlanPolicies') as GoalPlanPolicy[]
  const [weekStart, setWeekStart] = useState(() => weekStartOf(today))
  const [draft, setDraft] = useState<Record<number, string>>(() => {
    const d: Record<number, string> = {}
    for (const w of weekly as Array<{ weekday: number; availableMinutes: number }>) d[w.weekday] = String(w.availableMinutes)
    return d
  })
  const [exceptionDate, setExceptionDate] = useState(today)
  const [exceptionMinutes, setExceptionMinutes] = useState('')
  const [exceptionReason, setExceptionReason] = useState('')

  const stats = useMemo(() => weekBudgetStats(weekStart, weekly, exceptions, policies, dailyPlans, checkins, focusSessions), [weekStart, weekly, exceptions, policies, dailyPlans, checkins, focusSessions])

  const saveWeekly = async () => {
    const rows: WeeklyAvailability[] = []
    for (const [k, v] of Object.entries(draft)) {
      if (v === '') continue
      const n = Number(v)
      if (!Number.isInteger(n) || n < 0) {
        toast.error('分钟数需为非负整数')
        return
      }
      rows.push({ weekday: Number(k), availableMinutes: n, updatedAt: nowIso() })
    }
    try {
      await putV4Rows('weeklyAvailability', rows)
      toast.success('每周预算已保存（留空的星期视为未设置）')
    } catch (err) {
      toast.error(err instanceof Error ? `保存失败：${err.message}` : '保存失败，可重试')
    }
  }

  const addException = async () => {
    const n = Number(exceptionMinutes)
    if (!Number.isInteger(n) || n < 0) {
      toast.error('分钟数需为非负整数（0 = 明确休息）')
      return
    }
    try {
      await putV4Rows('availabilityExceptions', [
        ...exceptions.filter((e) => e.date !== exceptionDate),
        { date: exceptionDate, availableMinutes: n, reason: exceptionReason.trim() ? exceptionReason : null, updatedAt: nowIso() },
      ])
      toast.success(`${exceptionDate} 的例外已设置`)
      setExceptionMinutes('')
      setExceptionReason('')
    } catch (err) {
      toast.error(err instanceof Error ? `保存失败：${err.message}` : '保存失败，可重试')
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="每周学习时间预算">
      <div className="space-y-4">
        <div className="flex items-center justify-between gap-2">
          <Button size="sm" variant="secondary" onClick={() => setWeekStart((w) => addDays(w, -7))}>
            上一周
          </Button>
          <p className="text-sm font-semibold text-ink">
            {formatMD(weekStart)} - {formatMD(addDays(weekStart, 6))}
          </p>
          <Button size="sm" variant="secondary" onClick={() => setWeekStart((w) => addDays(w, 7))}>
            下一周
          </Button>
        </div>

        <div className="grid grid-cols-3 gap-3">
          <StatTile label="预算合计" value={`${stats.totalBudget} 分`} sub={stats.unconfiguredDays > 0 ? `${stats.unconfiguredDays} 天未设置` : '全周已设置'} />
          <StatTile label="计划折算分钟" value={`${stats.totalPlanned} 分`} sub="仅含已估时目标" />
          <StatTile label="实际投入" value={`${stats.totalActual} 分`} sub={stats.overBudgetDays > 0 ? `${stats.overBudgetDays} 天计划超预算` : '无超额日'} />
        </div>

        <div className="rounded-xl border border-line/70 p-3">
          <p className="mb-2 text-xs font-medium text-ink2">星期默认预算（留空=未设置；0=明确休息）</p>
          <div className="flex flex-wrap items-end gap-2">
            {['一', '二', '三', '四', '五', '六', '日'].map((label, i) => (
              <label key={label} className="flex w-14 flex-col items-center gap-1 text-[10px] text-ink3">
                周{label}
                <Input
                  type="number"
                  min={0}
                  value={draft[i + 1] ?? ''}
                  onChange={(e) => setDraft({ ...draft, [i + 1]: e.target.value })}
                  aria-label={`周${label}可用分钟`}
                  className="h-9 w-full px-1 text-center text-xs"
                />
              </label>
            ))}
            <Button size="sm" onClick={() => void saveWeekly()}>
              保存
            </Button>
          </div>
        </div>

        <div className="rounded-xl border border-line/70 p-3">
          <p className="mb-2 text-xs font-medium text-ink2">特定日期例外（出行/考试/休息）</p>
          <div className="flex flex-wrap items-end gap-2">
            <Field label="日期" htmlFor="exc-date">
              <Input id="exc-date" type="date" value={exceptionDate} onChange={(e) => setExceptionDate(e.target.value)} className="w-40" />
            </Field>
            <Field label="分钟" htmlFor="exc-min">
              <Input id="exc-min" type="number" min={0} value={exceptionMinutes} onChange={(e) => setExceptionMinutes(e.target.value)} className="w-20" />
            </Field>
            <Field label="原因（可选）" htmlFor="exc-reason">
              <Input id="exc-reason" value={exceptionReason} onChange={(e) => setExceptionReason(e.target.value)} className="w-36" maxLength={40} />
            </Field>
            <Button size="sm" variant="secondary" onClick={() => void addException()}>
              设置
            </Button>
          </div>
          <ul className="mt-2 space-y-1">
            {exceptions
              .filter((e) => e.date >= weekStart && e.date <= addDays(weekStart, 6))
              .map((e) => (
                <li key={e.date} className="tnum flex items-center gap-2 text-xs">
                  <span className="text-ink3">{formatMD(e.date)}</span>
                  <span className="text-ink">{e.availableMinutes === 0 ? '休息（0 分钟）' : `${e.availableMinutes} 分钟`}</span>
                  {e.reason && <span className="text-ink3">{e.reason}</span>}
                  <button
                    type="button"
                    aria-label={`删除 ${e.date} 例外`}
                    className="ml-auto text-ink3 hover:text-danger"
                    onClick={() => void deleteV4Rows('availabilityExceptions', [e.date]).then(() => toast.success('例外已删除'))}
                  >
                    <IconTrash />
                  </button>
                </li>
              ))}
            {exceptions.filter((e) => e.date >= weekStart && e.date <= addDays(weekStart, 6)).length === 0 && <li className="text-[11px] text-ink3">本周没有例外日期。</li>}
          </ul>
        </div>

        <div className="rounded-xl bg-base px-3.5 py-3">
          <p className="mb-1.5 text-xs font-semibold text-ink2">每日明细</p>
          <ul className="tnum space-y-1 text-xs">
            {stats.days.map((d) => (
              <li key={d.date} className="flex items-center gap-2">
                <span className="w-24 text-ink3">
                  {formatMD(d.date)} {weekdayShort(d.date)}
                </span>
                <span className="w-20">{d.unconfigured ? <span className="text-ink3">未设置</span> : d.budget === 0 ? <span className="text-ink3">休息</span> : `预算 ${d.budget}分`}</span>
                <span className="flex-1">
                  {d.plannedMinutes > 0 && <ProgressBar percent={d.budget ? Math.min(100, (d.plannedMinutes / d.budget) * 100) : 0} color={d.budget !== null && d.plannedMinutes > d.budget ? 'rose' : 'violet'} />}
                </span>
                <span className={d.budget !== null && d.plannedMinutes > d.budget ? 'text-danger' : 'text-ink3'}>计划 {d.plannedMinutes}分</span>
                <span className="text-ok">实际 {d.actualMinutes}分</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </Modal>
  )
}

function useV4Rows<T>(table: 'weeklyAvailability' | 'availabilityExceptions' | 'goalPlanPolicies' | 'planRevisions' | 'studyReports'): T[] {
  return useV4<T>(table)
}

/* ================= 功能4：自适应重排（触发卡 + 修订记录） ================= */

export function RescheduleCard({ onApply }: { onApply: (goal: Goal) => void }) {
  const { goals, checkins, dailyPlans, today } = useAppData()
  const planPolicies = useV4Rows<GoalPlanPolicy>('goalPlanPolicies')
  void planPolicies
  const needs = useMemo(() => detectRescheduleNeeds(goals, dailyPlans, checkins, today), [goals, dailyPlans, checkins, today])
  if (needs.length === 0) return null
  return (
    <Card className="border-warn/40 bg-warnSoft/40 px-4 py-3">
      <p className="text-xs font-semibold text-warn">计划需要调整（{needs.length}）——仅提示，不会自动改写</p>
      <ul className="mt-1.5 space-y-1">
        {needs.slice(0, 3).map((n) => (
          <li key={n.goalId} className="flex flex-wrap items-center gap-2 text-xs text-ink2">
            <span className="font-medium text-ink">{n.goalName}</span>
            <span className="text-ink3">{n.detail}</span>
            <Button size="sm" variant="secondary" onClick={() => {
              const g = goals.find((x) => x.id === n.goalId)
              if (g) onApply(g)
            }}>
              <IconRefresh /> 重新排程
            </Button>
          </li>
        ))}
      </ul>
    </Card>
  )
}

/** 带修订记录的自动排程应用（替换 CalendarView 的 confirmAutoSchedule 逻辑，写 PlanRevision） */
export async function applyAutoScheduleWithRevision(
  goal: Goal,
  checkins: Checkin[],
  dailyPlans: DailyPlan[],
  today: DateStr,
  getPrefs: () => Parameters<typeof distributeRemaining>[1],
  apply: (upserts: DailyPlan[], deleteIds: string[]) => Promise<void>,
  notify: (msg: string) => void,
  putRevisions: (rows: PlanRevision[]) => Promise<void>,
): Promise<void> {
  const result = distributeRemaining(goal, getPrefs(), checkins, today)
  if (result.kind !== 'ok') {
    notify(`无法自动排程：${result.kind === 'overdue' ? '目标已逾期' : result.kind === 'noStudyDays' ? '无可学习日' : result.kind === 'capacity' ? '每日上限不足' : '已完成'}`)
    return
  }
  const existing = dailyPlans.filter((p) => p.goalId === goal.id)
  const preview = buildReschedulePreview(goal.id, existing, result.plans, today)
  const now = nowIso()
  // 撤销快照：被移除/将被覆盖的未来 auto 计划
  const snapshot = JSON.stringify(existing.filter((p) => p.date > today && p.source === 'auto'))
  await apply(
    preview.upserts.map((u) => ({ ...u, isDemo: goal.isDemo, id: `plan-${u.goalId}-${u.date}`, createdAt: now, updatedAt: now })),
    preview.removals.map((r) => r.id),
  )
  await putRevisions([
    {
      id: `rev-${now}`,
      createdAt: now,
      effectiveFrom: today,
      trigger: 'auto-reschedule',
      reason: `自动排程「${goal.name}」`,
      diffSummary: `更新 ${preview.upserts.length} 项，移除 ${preview.removals.length} 项（不变 ${preview.unchanged}，手动让位 ${preview.manualKept}）`,
      undoSnapshot: snapshot.length > 2 ? snapshot : null,
    },
  ])
  notify(`已应用排程并记录修订：更新 ${preview.upserts.length} 项，移除 ${preview.removals.length} 项`)
}

/* ================= 功能9/11：效率分析中心 + 计划对比 ================= */

export function AnalyticsView({ onBack }: { onBack: () => void }) {
  const { goals, checkins, focusSessions, dailyPlans, today } = useAppData()
  const [range, setRange] = useState<7 | 30 | 90>(7)
  const [tab, setTab] = useState<'efficiency' | 'compare'>('efficiency')
  const from = addDays(today, -(range - 1))

  const eff = useMemo(() => efficiencyStats(goals, checkins, focusSessions, dailyPlans, from, today), [goals, checkins, focusSessions, dailyPlans, from, today])
  const prev = useMemo(() => efficiencyStats(goals, checkins, focusSessions, dailyPlans, addDays(from, -range), addDays(today, -range)), [goals, checkins, focusSessions, dailyPlans, from, today, range])
  const week = useMemo(() => planVsActualWeek(goals, dailyPlans, checkins, weekStartOf(today)), [goals, dailyPlans, checkins, today])

  const delta = (cur: number, prevV: number): string => {
    if (prevV === 0) return cur > 0 ? '上期为 0' : '持平'
    const pct = Math.round(((cur - prevV) / prevV) * 100)
    return `${pct > 0 ? '+' : ''}${pct}%`
  }

  return (
    <div className="space-y-4">
      <header className="flex items-center gap-2">
        <Button variant="ghost" size="sm" onClick={onBack}>
          ← 返回看板
        </Button>
        <h1 className="text-lg font-bold text-ink">学习效率分析中心</h1>
        <div className="ml-auto flex gap-1">
          {([7, 30, 90] as const).map((r) => (
            <Button key={r} size="sm" variant={range === r ? 'soft' : 'ghost'} onClick={() => setRange(r)}>
              {r} 天
            </Button>
          ))}
        </div>
      </header>

      <div className="flex gap-1" role="tablist">
        {(
          [
            ['efficiency', '执行指标'],
            ['compare', '计划与实际'],
          ] as const
        ).map(([k, l]) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)} className={`rounded-lg px-3 py-1.5 text-xs font-medium ${tab === k ? 'gradient-primary text-white' : 'border border-line text-ink3'}`}>
            {l}
          </button>
        ))}
      </div>

      {tab === 'efficiency' ? (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <StatTile label="有效投入分钟" value={eff.totalMinutes} sub={`环比 ${delta(eff.totalMinutes, prev.totalMinutes)}`} />
            <StatTile label="活跃天数" value={eff.activeDays} sub={`环比 ${delta(eff.activeDays, prev.activeDays)}`} />
            <StatTile label="计划兑现率" value={eff.planFulfillment === null ? '—' : `${eff.planFulfillment}%`} sub={`${eff.fulfilledCombos}/${eff.plannedCombos} 个「日-目标」`} />
            <StatTile label="未填分钟记录" value={eff.unknownMinutesCount} sub="未知≠0，不计入分钟" />
          </div>
          <p className="text-[11px] leading-relaxed text-ink3">
            口径说明：实际投入分钟 = 明确填写的打卡分钟 + 未关联打卡的专注会话（去重）；兑现率 = 有计划的「日-目标」组合中实际≥计划的占比；单位时间产出按目标分开（不同单位不合并）。
          </p>
          <Card className="px-4 py-4">
            <h2 className="mb-2 text-sm font-semibold text-ink">单位时间产出（有分钟样本的目标）</h2>
            {eff.outputPerHour.length === 0 ? (
              <p className="text-xs text-ink3">暂无「数量+分钟」配对样本。打卡时填写分钟数后可计算。</p>
            ) : (
              <ul className="divide-y divide-line/60">
                {eff.outputPerHour.map((o) => (
                  <li key={o.goalId} className="tnum flex items-center justify-between py-2 text-xs">
                    <span className="text-ink">{goals.find((g) => g.id === o.goalId)?.name}</span>
                    <span className="text-ink3">
                      {o.perHour} {goals.find((g) => g.id === o.goalId)?.unit}/小时（{o.sampleCount} 条样本）
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-[11px] text-ink3">本周（{formatMD(weekStartOf(today))} 起）逐日「计划 vs 实际」，按目标分组展示（不同单位不合并）。无计划但有打卡的日-目标也会列出。</p>
          {week.map((day) => (
            <Card key={day.date} className="px-4 py-3">
              <p className="tnum text-xs font-semibold text-ink">
                {formatMD(day.date)} {weekdayShort(day.date)}
              </p>
              {day.byGoal.length === 0 ? (
                <p className="mt-1 text-[11px] text-ink3">无计划、无打卡。</p>
              ) : (
                <ul className="mt-1.5 space-y-1">
                  {day.byGoal.map((x) => (
                    <li key={x.goalId} className="tnum flex items-center gap-2 text-xs">
                      <span className="min-w-0 flex-1 truncate text-ink2">{x.name}</span>
                      <span className="text-ink3">{x.hasPlan ? `计划 ${x.planned}` : '无计划'}</span>
                      <span className="font-medium text-ink">实际 {x.actual} {x.unit}</span>
                      <span className={x.hasPlan ? (x.diff >= 0 ? 'text-ok' : 'text-danger') : 'text-ink3'}>
                        {x.hasPlan ? (x.diff >= 0 ? `+${x.diff}` : `${x.diff}`) : ''}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}

/* ================= 功能12：长期报告 ================= */

export function LongReportTab() {
  const { goals, checkins, focusSessions, dailyPlans, putV4Rows } = useAppData()
  const toast = useToast()
    const storedReports = useV4<{ id: string; periodType: string; periodStart: string; periodEnd: string; snapshot: string; text: string; createdAt: string }>('studyReports') as Array<{ id: string; periodType: string; periodStart: string; periodEnd: string; snapshot: string; text: string; createdAt: string }>
  const [type, setType] = useState<'month' | 'quarter' | 'year'>('month')
  const [offset, setOffset] = useState(0)
  const [freeText, setFreeText] = useState({ harvest: '', difficulty: '', adjustment: '', nextPlan: '' })
  const [confirmSave, setConfirmSave] = useState<string | null>(null)

  const today = new Date()
  const range: PeriodRange = useMemo(() => {
    if (type === 'month') {
      const d = new Date(today.getFullYear(), today.getMonth() + offset, 1)
      return monthRange(d.getFullYear(), d.getMonth() + 1)
    }
    if (type === 'quarter') {
      const d = new Date(today.getFullYear(), today.getMonth() + offset * 3, 1)
      return quarterRange(d.getFullYear(), (Math.floor(d.getMonth() / 3) + 1) as 1 | 2 | 3 | 4)
    }
    return yearRange(today.getFullYear() + offset)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [type, offset])

  const isPartial = range.end >= `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
  const stats = useMemo(() => longReportStats(goals, checkins, focusSessions, dailyPlans, range), [goals, checkins, focusSessions, dailyPlans, range])
  const text = useMemo(() => generateReportText(type === 'month' ? '月度' : type === 'quarter' ? '季度' : '年度', range, stats, freeText, isPartial), [type, range, stats, freeText, isPartial])
  const periodLabel = `${type === 'month' ? '月报' : type === 'quarter' ? '季报' : '年报'} ${range.start}~${range.end}`

  const save = async () => {
    const now = nowIso()
    try {
      await putV4Rows('studyReports', [
        ...storedReports,
        {
          id: `rep-${now}`,
          periodType: type,
          periodStart: range.start,
          periodEnd: range.end,
          snapshot: JSON.stringify(stats),
          text,
          createdAt: now,
          updatedAt: now,
        },
      ])
      toast.success('报告快照已保存（之后数据变化不会篡改此快照）')
      setConfirmSave(null)
    } catch (err) {
      toast.error(err instanceof Error ? `保存失败：${err.message}` : '保存失败，可重试')
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex gap-1">
          {(
            [
              ['month', '月报'],
              ['quarter', '季报'],
              ['year', '年报'],
            ] as const
          ).map(([k, l]) => (
            <Button key={k} size="sm" variant={type === k ? 'soft' : 'ghost'} onClick={() => setType(k)}>
              {l}
            </Button>
          ))}
        </div>
        <div className="flex gap-1">
          <Button size="sm" variant="secondary" onClick={() => setOffset((o) => o - 1)}>
            ← 更早
          </Button>
          <Button size="sm" variant="secondary" disabled={offset >= 0} onClick={() => setOffset((o) => o + 1)}>
            更近 →
          </Button>
        </div>
        <span className="tnum text-xs text-ink3">
          {range.start} ~ {range.end}
          {isPartial && <span className="ml-1 text-warn">（进行中）</span>}
        </span>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <StatTile label="活跃天数" value={stats.activeDays} />
        <StatTile label="有效分钟" value={stats.totalMinutes} sub={stats.unknownMinutesCount > 0 ? `${stats.unknownMinutesCount} 条未填分钟未计入` : undefined} />
        <StatTile label="计划兑现率" value={stats.planFulfillment === null ? '—' : `${stats.planFulfillment}%`} />
      </div>

      <Card className="px-4 py-4">
        <h2 className="mb-2 text-sm font-semibold text-ink">复盘四项（本期专用，留空即可）</h2>
        <div className="space-y-2.5">
          {(
            [
              ['harvest', '本期收获'],
              ['difficulty', '最大的困难'],
              ['adjustment', '调整方法'],
              ['nextPlan', '下一期计划'],
            ] as const
          ).map(([key, label]) => (
            <Field key={key} label={label} htmlFor={`lr-${key}`}>
              <TextArea id={`lr-${key}`} rows={2} value={freeText[key]} onChange={(e) => setFreeText({ ...freeText, [key]: e.target.value })} maxLength={300} />
            </Field>
          ))}
        </div>
      </Card>

      <Card className="px-4 py-4">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-ink">报告文本（Markdown）</h2>
          <div className="flex gap-2">
            <Button size="sm" variant="secondary" onClick={() => void navigator.clipboard.writeText(text).then(() => toast.success('报告已复制')).catch(() => toast.info('浏览器未授权剪贴板，请手动选择文本复制'))}>
              复制
            </Button>
            <Button size="sm" onClick={() => setConfirmSave(text)}>
              保存本期快照
            </Button>
          </div>
        </div>
        <textarea readOnly value={text} aria-label="报告文本" className="h-72 w-full rounded-xl border border-line bg-base p-3.5 font-mono text-xs leading-relaxed text-ink2" onFocus={(e) => e.currentTarget.select()} />
        <p className="mt-1.5 text-[11px] text-ink3">
          保存后可回看历史快照（已存 {storedReports.length} 份{storedReports.length > 0 ? `：最近 ${formatMD(storedReports[storedReports.length - 1].createdAt.slice(0, 10))}` : ''}）；补记/删除后快照不变，可用最新数据重新保存为新版本。导出 .md/.txt：复制后自行保存即可。
        </p>
      </Card>

      <ConfirmDialog
        open={!!confirmSave}
        title="保存报告快照"
        confirmText="保存快照"
        message={<span>将保存 {periodLabel} 的统计快照与复盘文字。之后底层补记/删除不会改动这份快照。</span>}
        onConfirm={() => void save()}
        onClose={() => setConfirmSave(null)}
      />
    </div>
  )
}
