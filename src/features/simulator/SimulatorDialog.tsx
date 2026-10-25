import { useEffect, useMemo, useState } from 'react'
import type { DateStr, Goal } from '../../domain/types'
import { COLOR_HEX } from '../../domain/types'
import { formatMD, weekdayShort } from '../../domain/dates'
import { buildReschedulePreview, normalizePrefs } from '../../domain/dailyPlan'
import {
  buildSimulationCurve,
  compareWithDeadline,
  curveScales,
  defaultPerDay,
  scenarioPresets,
  simulationContext,
  simulate,
} from '../../domain/simulator'
import { useAppData } from '../../state/AppData'
import { Button, Field, Input } from '../../components/ui'
import { Modal, useToast } from '../../components/feedback'
import { IconX } from '../../components/icons'

function fmt(n: number): string {
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100)
}

const WEEKDAY_LABELS = ['一', '二', '三', '四', '五', '六', '日']

/**
 * 计划模拟器（沙盘推演）：调整假设观察完成日，绝不写 Checkin / 不改 Goal.deadline。
 * 「应用到计划」仅经预览确认后写未来 DailyPlan（与日历共用事务）。
 */
export function SimulatorDialog({ open, onClose, goal }: { open: boolean; onClose: () => void; goal: Goal | null }) {
  const { checkins, dailyPlans, today, getCalendarPref, applyDailyPlanChanges } = useAppData()
  const toast = useToast()
  const [perDay, setPerDay] = useState(5)
  const [weekdays, setWeekdays] = useState<number[]>([1, 2, 3, 4, 5, 6, 7])
  const [excluded, setExcluded] = useState<DateStr[]>([])
  const [newExcluded, setNewExcluded] = useState('')
  const [prefsLoaded, setPrefsLoaded] = useState(false)
  const [confirmApply, setConfirmApply] = useState<{ upserts: number; removals: number } | null>(null)
  const [applying, setApplying] = useState(false)

  const ctx = useMemo(() => (goal ? simulationContext(goal, checkins, today, null) : null), [goal, checkins, today])

  useEffect(() => {
    if (!open || !goal) return
    let cancelled = false
    void getCalendarPref(goal.id).then((p) => {
      if (cancelled) return
      const base = normalizePrefs(p)
      setWeekdays(base.studyWeekdays)
      setExcluded(base.excludedDates)
      const c = simulationContext(goal, checkins, today, p)
      setPerDay(defaultPerDay(c.remaining, c.minRequired))
      setPrefsLoaded(true)
    })
    return () => {
      cancelled = true
      setPrefsLoaded(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, goal?.id])

  const applyPreview = useMemo(() => {
    if (!goal || !ctx) return null
    const params0 = { perDayAmount: perDay, studyWeekdays: weekdays, excludedDates: excluded, from: today }
    const sim0 = simulate(ctx.remaining, params0)
    if (sim0.status !== 'ok') return null
    const existing = dailyPlans.filter((p) => p.goalId === goal.id)
    return buildReschedulePreview(goal.id, existing, sim0.perDateAmounts.map((p) => ({ date: p.date, plannedAmount: p.amount })), today)
  }, [goal, ctx, perDay, weekdays, excluded, today, dailyPlans])

  if (!goal || !ctx) return null

  const params = { perDayAmount: perDay, studyWeekdays: weekdays, excludedDates: excluded, from: today }
  const sim = simulate(ctx.remaining, params)
  const comparison = compareWithDeadline(sim.completionDate, goal.deadline)
  const curve = buildSimulationCurve(goal, checkins, params, ctx.remaining)
  const scales = curveScales(curve.future, goal.totalAmount, goal.deadline)
  const presets = scenarioPresets(perDay)

  const doApply = async () => {
    if (!applyPreview) return
    setApplying(true)
    try {
      const now = new Date().toISOString()
      await applyDailyPlanChanges(
        applyPreview.upserts.map((u) => ({ ...u, isDemo: goal.isDemo, id: `plan-${u.goalId}-${u.date}`, createdAt: now, updatedAt: now })),
        applyPreview.removals.map((r) => r.id),
      )
      toast.success(`已把模拟方案写入日历计划：更新 ${applyPreview.upserts.length} 项，移除 ${applyPreview.removals.length} 项（未创建打卡）`)
      setConfirmApply(null)
      onClose()
    } catch (err) {
      toast.error(err instanceof Error ? `应用失败：${err.message}` : '应用失败，请重试')
    } finally {
      setApplying(false)
    }
  }

  /* SVG 曲线绘制 */
  const W = 520
  const H = 150
  const padL = 30
  const padB = 18
  const lineOf = (pts: Array<{ date: DateStr; cumulative: number }>) =>
    pts
      .map((p, i) => {
        const x = padL + (scales!.x(p.date) * (W - padL - 8))
        const y = H - padB - scales!.y(p.cumulative) * (H - padB - 10)
        return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`
      })
      .join(' ')

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`计划模拟器 · ${goal.name}`}
      footer={
        <div className="flex items-center justify-between gap-2">
          <p className="text-[11px] text-ink3">沙盘推演：不会写打卡、不会改截止日</p>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={onClose}>
              关闭
            </Button>
            <Button
              disabled={sim.status !== 'ok' || (applyPreview?.upserts.length ?? 0) + (applyPreview?.removals.length ?? 0) === 0}
              onClick={() => setConfirmApply({ upserts: applyPreview?.upserts.length ?? 0, removals: applyPreview?.removals.length ?? 0 })}
            >
              应用到日历计划…
            </Button>
          </div>
        </div>
      }
    >
      <div className="space-y-4">
        {/* 现状 */}
        <div className="tnum grid grid-cols-4 gap-2 rounded-xl bg-base px-3 py-2.5 text-center text-xs">
          <div>
            <p className="text-[10px] text-ink3">总量</p>
            <p className="mt-0.5 font-semibold text-ink">{fmt(goal.totalAmount)} {goal.unit}</p>
          </div>
          <div>
            <p className="text-[10px] text-ink3">已完成</p>
            <p className="mt-0.5 font-semibold text-ok">{fmt(ctx.done)}</p>
          </div>
          <div>
            <p className="text-[10px] text-ink3">剩余</p>
            <p className="mt-0.5 font-semibold text-primary">{fmt(ctx.remaining)}</p>
          </div>
          <div>
            <p className="text-[10px] text-ink3">截止</p>
            <p className="mt-0.5 font-semibold text-ink">{formatMD(goal.deadline)}</p>
          </div>
        </div>

        {/* 实测 vs 假设 严格区分 */}
        <div className="grid grid-cols-2 gap-2 text-xs">
          <div className="rounded-xl border border-line px-3 py-2">
            <p className="text-[10px] font-semibold text-ink3">近 7 天实测速度预测</p>
            <p className="mt-1 text-ink">
              {ctx.realSpeedPrediction.status === 'active' && ctx.realSpeedPrediction.projectedDate
                ? `${formatMD(ctx.realSpeedPrediction.projectedDate)}（真实打卡推算）`
                : '暂无推算（有效打卡日不足 3 天）'}
            </p>
          </div>
          <div className="rounded-xl border border-primary/40 bg-primarySoft/40 px-3 py-2">
            <p className="text-[10px] font-semibold text-primary">模拟完成日（你的假设）</p>
            <p className="mt-1 text-ink">
              {sim.status === 'ok' && sim.completionDate ? `${formatMD(sim.completionDate)} ${weekdayShort(sim.completionDate)}` : sim.status === 'truncated' ? '超过可推演范围' : sim.status === 'invalidParams' ? '参数无效' : '—'}
            </p>
          </div>
        </div>

        {/* 参数 */}
        <div className="space-y-3 rounded-xl border border-line/70 px-3.5 py-3">
          <Field label={`每学习日完成量（${goal.unit}）`} htmlFor="sim-perday">
            <div className="flex items-center gap-3">
              <input
                type="range"
                min={0.1}
                max={Math.max(10, Math.ceil(ctx.remaining / 2))}
                step={goal.totalAmount % 1 === 0 ? 1 : 0.1}
                value={perDay}
                onChange={(e) => setPerDay(Number(e.target.value))}
                className="flex-1 accent-[rgb(var(--c-primary))]"
                aria-label="每学习日完成量滑块"
              />
              <Input id="sim-perday" type="number" min={0.1} step="any" value={perDay} onChange={(e) => setPerDay(Number(e.target.value))} className="h-9 w-24" />
            </div>
          </Field>
          <div>
            <p className="mb-1.5 text-[13px] font-medium text-ink2">学习星期</p>
            <div className="flex gap-1.5">
              {WEEKDAY_LABELS.map((label, idx) => {
                const day = idx + 1
                const on = weekdays.includes(day)
                return (
                  <button
                    key={day}
                    type="button"
                    aria-pressed={on}
                    aria-label={`周${label}`}
                    onClick={() => setWeekdays(on ? weekdays.filter((d) => d !== day) : [...weekdays, day].sort())}
                    className={`h-8 w-8 rounded-lg text-xs font-medium transition-colors ${on ? 'gradient-primary text-white' : 'border border-line text-ink3'}`}
                  >
                    {label}
                  </button>
                )
              })}
            </div>
          </div>
          <div>
            <p className="mb-1.5 text-[13px] font-medium text-ink2">排除日期（{excluded.length}）</p>
            <div className="mb-2 flex flex-wrap gap-1.5">
              {excluded.map((d) => (
                <span key={d} className="tnum inline-flex items-center gap-1 rounded-md bg-surface2 px-2 py-1 text-[11px] text-ink2">
                  {formatMD(d)}
                  <button type="button" aria-label={`移除 ${d}`} onClick={() => setExcluded(excluded.filter((x) => x !== d))} className="text-ink3 hover:text-danger">
                    <IconX className="text-xs" />
                  </button>
                </span>
              ))}
              {excluded.length === 0 && <span className="text-[11px] text-ink3">无</span>}
            </div>
            <div className="flex items-end gap-2">
              <Input type="date" value={newExcluded} onChange={(e) => setNewExcluded(e.target.value)} aria-label="添加排除日期" className="h-9 w-40" />
              <Button size="sm" variant="secondary" disabled={!newExcluded} onClick={() => { if (newExcluded && !excluded.includes(newExcluded)) setExcluded([...excluded, newExcluded].sort()); setNewExcluded('') }}>
                添加
              </Button>
            </div>
          </div>
          {/* 预设（假设情景） */}
          <div>
            <p className="mb-1.5 text-[13px] font-medium text-ink2">假设情景预设</p>
            <div className="flex flex-wrap gap-2">
              {presets.map((p) => (
                <Button key={p.key} size="sm" variant={p.key === 'current' ? 'soft' : 'secondary'} title={p.note} onClick={() => setPerDay(p.perDay)}>
                  {p.label}（{fmt(p.perDay)} {goal.unit}/日）
                </Button>
              ))}
            </div>
          </div>
          {/* 只填分钟不换算的提示 */}
          <p className="text-[11px] leading-relaxed text-ink3">
            每日可用学习时长无法直接换算完成量（缺少「单位/分钟」依据），因此不提供时间→数量换算；请直接设定每学习日数量。
          </p>
        </div>

        {/* 结果 */}
        <div className="tnum grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
          <div className="rounded-xl bg-base px-3 py-2.5 text-center">
            <p className="text-[10px] text-ink3">所需学习日</p>
            <p className="mt-0.5 font-semibold text-ink">{sim.studyDaysUsed} 天</p>
          </div>
          <div className="rounded-xl bg-base px-3 py-2.5 text-center">
            <p className="text-[10px] text-ink3">对比截止日</p>
            <p className={`mt-0.5 font-semibold ${comparison.kind === 'early' ? 'text-ok' : comparison.kind === 'late' ? 'text-danger' : 'text-ink'}`}>
              {comparison.kind === 'early' ? `提前 ${comparison.days} 天` : comparison.kind === 'late' ? `拖后 ${comparison.days} 天` : comparison.kind === 'onTime' ? '预计按时' : '—'}
            </p>
          </div>
          <div className="rounded-xl bg-base px-3 py-2.5 text-center">
            <p className="text-[10px] text-ink3">截止前最低量/日</p>
            <p className="mt-0.5 font-semibold text-ink">{ctx.minRequired ? `${fmt(ctx.minRequired.perDay)} ${goal.unit}` : '无可学习日'}</p>
          </div>
          <div className="rounded-xl bg-base px-3 py-2.5 text-center">
            <p className="text-[10px] text-ink3">截止前模拟余量</p>
            <p className="mt-0.5 font-semibold text-ink">
              {sim.status === 'ok' && sim.completionDate && sim.completionDate <= goal.deadline ? '可完成' : '无法按期完成'}
            </p>
          </div>
        </div>

        {/* SVG 累计曲线 */}
        {scales && (
          <div className="rounded-xl border border-line/70 px-2 py-3">
            <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="累计完成量模拟曲线：实线为真实历史，虚线为未来假设">
              <line x1={padL} y1={H - padB} x2={W - 8} y2={H - padB} stroke="rgb(var(--c-line))" />
              <line x1={padL} y1={10} x2={padL} y2={H - padB} stroke="rgb(var(--c-line))" />
              {/* 截止日竖线 */}
              {(() => {
                const x = padL + scales.x(goal.deadline) * (W - padL - 8)
                return (
                  <>
                    <line x1={x} y1={10} x2={x} y2={H - padB} stroke="rgb(var(--c-danger))" strokeDasharray="4 3" />
                    <text x={x - 4} y={10} fontSize={9} fill="rgb(var(--c-danger))" textAnchor="end">
                      截止 {formatMD(goal.deadline)}
                    </text>
                  </>
                )
              })()}
              {/* 总量横线 */}
              <line x1={padL} y1={H - padB - scales.y(goal.totalAmount) * (H - padB - 10)} x2={W - 8} y2={H - padB - scales.y(goal.totalAmount) * (H - padB - 10)} stroke="rgb(var(--c-ink3))" strokeDasharray="2 4" />
              <text x={padL + 4} y={H - padB - scales.y(goal.totalAmount) * (H - padB - 10) - 3} fontSize={9} fill="rgb(var(--c-ink3))">
                总量 {fmt(goal.totalAmount)}
              </text>
              {/* 历史实线 */}
              <path d={lineOf(curve.past)} fill="none" stroke={COLOR_HEX[goal.color]} strokeWidth={2} />
              {/* 未来虚线 */}
              <path d={lineOf(curve.future)} fill="none" stroke={COLOR_HEX[goal.color]} strokeWidth={2} strokeDasharray="5 4" opacity={0.85} />
              <text x={padL} y={H - 4} fontSize={9} fill="rgb(var(--c-ink3))">
                {formatMD(scales.from)}
              </text>
              <text x={W - 8} y={H - 4} fontSize={9} fill="rgb(var(--c-ink3))" textAnchor="end">
                {formatMD(scales.to)}
              </text>
            </svg>
            <p className="px-2 text-[10px] text-ink3">实线 = 真实打卡累计；虚线 = 假设情景推演（非预测）。</p>
          </div>
        )}

        {sim.status === 'noStudyDays' && (
          <p className="rounded-xl bg-warnSoft px-3 py-2.5 text-xs text-warn">当前学习星期与排除日期下没有任何可学习日，无法推演。请放宽条件。</p>
        )}
        {sim.status === 'truncated' && (
          <p className="rounded-xl bg-warnSoft px-3 py-2.5 text-xs text-warn">
            按当前假设 {Math.min(3650, 3650)} 天内无法完成（工作量过大或学习日过少）。建议提高每日量、增加学习星期或修改截止日。
          </p>
        )}
        {!prefsLoaded && <p className="text-[11px] text-ink3">正在读取日历偏好…</p>}
      </div>

      {/* 应用确认 */}
      {confirmApply && applyPreview && (
        <Modal
          open
          onClose={() => setConfirmApply(null)}
          title="把模拟方案写入日历计划"
          footer={
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setConfirmApply(null)}>
                取消
              </Button>
              <Button onClick={() => void doApply()} loading={applying}>
                确认写入 {confirmApply.upserts + confirmApply.removals > 0 ? `（${confirmApply.upserts + confirmApply.removals} 项变更）` : ''}
              </Button>
            </div>
          }
        >
          <div className="space-y-2.5 text-sm leading-relaxed text-ink2">
            <p>
              将按模拟假设更新「{goal.name}」未来日期的日历计划：<b className="tnum text-ink">更新 {confirmApply.upserts} 项、移除 {confirmApply.removals} 项</b>（手动安排与历史不受影响）。
            </p>
            <ul className="list-disc space-y-1 pl-5 text-xs">
              <li>只写入 <b>DailyPlan</b>（准备做什么）；<b>不会创建任何打卡记录</b>，完成量仍以真实打卡为准。</li>
              <li>不会修改目标截止日{sim.completionDate && sim.completionDate > goal.deadline ? '；注意：模拟完成日超出截止日，建议先到「编辑目标」调整截止日' : ''}。</li>
              <li>写入后可在「今日 → 学习日历」查看与调整。</li>
            </ul>
          </div>
        </Modal>
      )}
    </Modal>
  )
}

