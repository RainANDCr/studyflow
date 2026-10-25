import { useMemo, useState } from 'react'
import type { DateStr, Exam, ExamDayAvailability, ExamGoalLink, ExamPlanSlot, GlobalStudyAvailability, Goal } from '../../domain/types'
import {
  checkOverruns,
  generateExamPlan,
  plannableDates,
  reschedulePreview,
} from '../../domain/exam'
import { formatMD, weekdayShort } from '../../domain/dates'
import { Button, Card, Field, Input } from '../../components/ui'
import { Modal } from '../../components/feedback'
import { IconPlus, IconTrash } from '../../components/icons'

const WEEKDAYS = ['一', '二', '三', '四', '五', '六', '日']

interface Props {
  exam: Exam
  links: ExamGoalLink[]
  goals: Goal[]
  availabilities: ExamDayAvailability[]
  globalAvailabilities: GlobalStudyAvailability[]
  slots: ExamPlanSlot[]
  today: DateStr
  upsertExamDayAvailabilities: (rows: ExamDayAvailability[]) => Promise<void>
  deleteExamDayAvailabilityById: ((id: string) => Promise<void>) | undefined
  upsertGlobalAvailability: (row: GlobalStudyAvailability) => Promise<void>
  upsertExamPlanSlots: (slots: ExamPlanSlot[]) => Promise<void>
  deleteExamPlanSlotById: (id: string) => Promise<void>
  onNotify: (msg: string, kind: 'success' | 'error' | 'info') => void
}

/** 时间与排程 Tab：每日可用时间（区分未配置/0）+ 生成冲刺计划（预览/超额警告/锁定保留）+ 手动条目。 */
export function ExamScheduleTab({
  exam,
  links,
  goals,
  availabilities,
  globalAvailabilities,
  slots,
  today,
  upsertExamDayAvailabilities,
  upsertGlobalAvailability,
  upsertExamPlanSlots,
  deleteExamPlanSlotById,
  onNotify,
}: Props) {
  const dates = useMemo(() => plannableDates(exam, today), [exam, today])
  const examSlots = useMemo(() => slots.filter((s) => s.examId === exam.id), [slots, exam.id])
  const [weekdayDefaults, setWeekdayDefaults] = useState<Record<number, string>>({})
  const [globalDate, setGlobalDate] = useState(today)
  const [globalMinutes, setGlobalMinutes] = useState('')
  const [manualOpen, setManualOpen] = useState(false)
  const [manual, setManual] = useState({ date: today, goalId: '', minutes: '', title: '' })
  const [preview, setPreview] = useState<null | { upserts: Array<{ date: DateStr; goalId: string; plannedMinutes: number }>; removalIds: string[]; untouched: number; lockedKept: number; result: ReturnType<typeof generateExamPlan>; warnings: ReturnType<typeof checkOverruns> }>(null)
  const [applying, setApplying] = useState(false)

  const availabilityFor = (date: DateStr): number | null => availabilities.find((a) => a.examId === exam.id && a.date === date)?.availableMinutes ?? null
  const configured = dates.filter((d) => availabilityFor(d) !== null)
  const totalBudget = configured.reduce((s, d) => s + (availabilityFor(d) ?? 0), 0)
  const globalConfiguredDates = new Set(globalAvailabilities.map((g) => g.date))

  const fillByWeekday = async () => {
    const parsed = new Map<number, number>()
    for (const [k, v] of Object.entries(weekdayDefaults)) {
      const n = Number(v)
      if (Number.isInteger(n) && n >= 0) parsed.set(Number(k), n)
    }
    if (parsed.size === 0) {
      onNotify('请至少为一个星期设置分钟数', 'error')
      return
    }
    const now = new Date().toISOString()
    const rows: ExamDayAvailability[] = dates
      .filter((d) => parsed.has(new Date(Number(d.slice(0, 4)), Number(d.slice(5, 7)) - 1, Number(d.slice(8, 10))).getDay() === 0 ? 7 : new Date(Number(d.slice(0, 4)), Number(d.slice(5, 7)) - 1, Number(d.slice(8, 10))).getDay()))
      .map((d) => {
        const wd = new Date(Number(d.slice(0, 4)), Number(d.slice(5, 7)) - 1, Number(d.slice(8, 10))).getDay()
        const weekday = wd === 0 ? 7 : wd
        return {
          id: `eda-${exam.id}-${d}`,
          examId: exam.id,
          date: d,
          availableMinutes: parsed.get(weekday)!,
          source: 'generated' as const,
          isDemo: false,
          createdAt: now,
          updatedAt: now,
        }
      })
    try {
      await upsertExamDayAvailabilities(rows)
      onNotify(`已按星期填充 ${rows.length} 天的可用时间`, 'success')
    } catch (err) {
      onNotify(err instanceof Error ? `保存失败：${err.message}` : '保存失败，可重试', 'error')
    }
  }

  const buildPreview = () => {
    if (links.length === 0) {
      onNotify('请先在「总览」关联至少一个学习目标', 'error')
      return
    }
    if (configured.length === 0) {
      onNotify('还没有配置任何一天的可用时间。可「按星期填充」或逐日设置；未配置的天不会排程。', 'info')
      return
    }
    const result = generateExamPlan({
      examId: exam.id,
      links: links.map((l) => ({ goalId: l.goalId, priorityWeight: l.priorityWeight })),
      dates,
      availabilities,
      existingSlots: examSlots,
    })
    const fresh = result.slots
    const pv = reschedulePreview(examSlots, fresh, today)
    const warnings = checkOverruns(
      [...examSlots.filter((s) => !pv.removalIds.includes(s.id)), ...pv.upserts.map((u) => ({ ...u, id: 'new', examId: exam.id, title: null, knowledgeItemId: null, phaseId: null, source: 'generated' as const, isLocked: false, isDemo: false, createdAt: '', updatedAt: '' }))],
      availabilities,
      globalAvailabilities,
      dates,
    )
    setPreview({ ...pv, result, warnings })
  }

  const applyPlan = async () => {
    if (!preview) return
    setApplying(true)
    try {
      const now = new Date().toISOString()
      await upsertExamPlanSlots([
        ...preview.upserts.map((u) => ({
          id: `eps-${exam.id}-${u.date}-${u.goalId}`,
          examId: exam.id,
          goalId: u.goalId,
          date: u.date,
          plannedMinutes: u.plannedMinutes,
          title: null,
          knowledgeItemId: null,
          phaseId: null,
          source: 'generated' as const,
          isLocked: false,
          isDemo: false,
          createdAt: now,
          updatedAt: now,
        })),
      ])
      for (const id of preview.removalIds) {
        await deleteExamPlanSlotById(id)
      }
      onNotify(`冲刺计划已写入：更新 ${preview.upserts.length} 项，移除 ${preview.removalIds.length} 项（只是时间预算，不是打卡）`, 'success')
      setPreview(null)
    } catch (err) {
      onNotify(err instanceof Error ? `写入失败：${err.message}（可重试）` : '写入失败，可重试', 'error')
    } finally {
      setApplying(false)
    }
  }

  const addManual = async () => {
    const minutes = Number(manual.minutes)
    if (!manual.goalId || !Number.isInteger(minutes) || minutes <= 0) {
      onNotify('请选择目标并填写正整数分钟', 'error')
      return
    }
    const now = new Date().toISOString()
    try {
      await upsertExamPlanSlots([
        ...examSlots,
        {
          id: `eps-m-${now}`,
          examId: exam.id,
          goalId: manual.goalId,
          date: manual.date,
          plannedMinutes: minutes,
          title: manual.title.trim() ? manual.title : null,
          knowledgeItemId: null,
          phaseId: null,
          source: 'manual',
          isLocked: true,
          isDemo: false,
          createdAt: now,
          updatedAt: now,
        },
      ])
      onNotify('已添加手动安排（锁定，重排不会覆盖）', 'success')
      setManualOpen(false)
      setManual({ date: today, goalId: '', minutes: '', title: '' })
    } catch (err) {
      onNotify(err instanceof Error ? `保存失败：${err.message}` : '保存失败，可重试', 'error')
    }
  }

  const upcomingSlots = useMemo(() => examSlots.filter((s) => s.date >= today).sort((a, b) => a.date.localeCompare(b.date)).slice(0, 14), [examSlots, today])

  return (
    <div className="space-y-4">
      {/* 每日可用时间 */}
      <Card className="px-4 py-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-ink">每日可用时间</h2>
          <p className="tnum text-[11px] text-ink3">
            已配置 {configured.length}/{dates.length} 天 · 预算合计 {totalBudget} 分钟
            {configured.length < dates.length && <span className="text-warn">（预算未完整设置：未配置日不排程，也不算 0）</span>}
          </p>
        </div>
        <div className="mt-2.5 rounded-xl border border-line/70 p-3">
          <p className="mb-2 text-xs font-medium text-ink2">按星期批量填充</p>
          <div className="flex flex-wrap items-end gap-2">
            {WEEKDAYS.map((w, i) => (
              <label key={w} className="flex w-12 flex-col items-center gap-1 text-[10px] text-ink3">
                周{w}
                <Input
                  type="number"
                  min={0}
                  value={weekdayDefaults[i + 1] ?? ''}
                  onChange={(e) => setWeekdayDefaults({ ...weekdayDefaults, [i + 1]: e.target.value })}
                  aria-label={`周${w}可用分钟`}
                  className="h-8 w-full px-1 text-center text-xs"
                />
              </label>
            ))}
            <Button size="sm" variant="secondary" onClick={() => void fillByWeekday()}>
              填充备考期
            </Button>
          </div>
          <p className="mt-1.5 text-[11px] text-ink3">填 0 表示该星期明确休息；留空不填充。已有配置的日期会被覆盖。</p>
        </div>
        <div className="mt-2.5 max-h-56 space-y-1 overflow-y-auto rounded-xl border border-line/70 p-3">
          {dates.slice(0, 60).map((d) => {
            const v = availabilityFor(d)
            return (
              <div key={d} className="flex items-center gap-2 text-xs">
                <span className="tnum w-28 shrink-0 text-ink3">
                  {formatMD(d)} {weekdayShort(d)}
                </span>
                {v === null ? (
                  <span className="flex-1 text-[11px] text-ink3">未规划</span>
                ) : (
                  <span className={`flex-1 ${v === 0 ? 'text-ink3' : 'text-ink'}`}>{v === 0 ? '休息日（0 分钟）' : `${v} 分钟`}</span>
                )}
                <Input
                  type="number"
                  min={0}
                  defaultValue={v ?? ''}
                  key={`${d}-${v}`}
                  aria-label={`设置 ${d} 可用分钟`}
                  className="h-8 w-20"
                  onBlur={(e) => {
                    const raw = e.target.value
                    if (raw === '') return
                    const n = Number(raw)
                    if (!Number.isInteger(n) || n < 0) return
                    const now = new Date().toISOString()
                    void upsertExamDayAvailabilities([{ id: `eda-${exam.id}-${d}`, examId: exam.id, date: d, availableMinutes: n, source: 'manual', isDemo: false, createdAt: now, updatedAt: now }])
                  }}
                />
              </div>
            )
          })}
          {dates.length > 60 && <p className="text-[11px] text-ink3">…共 {dates.length} 天，滚动区域仅显示前 60 天，其余可用「按星期填充」。</p>}
          {dates.length === 0 && <p className="text-[11px] text-ink3">考试已结束或已归档，不再生成新的规划日期。</p>}
        </div>
      </Card>

      {/* 全局预算 */}
      <Card className="px-4 py-4">
        <h2 className="text-sm font-semibold text-ink">跨考试全局预算（可选）</h2>
        <p className="mt-1 text-[11px] leading-relaxed text-ink3">
          用于校验所有考试同一天的排程总和；未配置时只会提示「未配置跨考试总预算」，不会拿某场考试的上限当全局。已配置 {globalConfiguredDates.size} 天。
        </p>
        <div className="mt-2 flex items-end gap-2">
          <Field label="日期" htmlFor="global-date">
            <Input id="global-date" type="date" value={globalDate} onChange={(e) => setGlobalDate(e.target.value)} className="w-40" />
          </Field>
          <Field label="分钟" htmlFor="global-min">
            <Input id="global-min" type="number" min={0} value={globalMinutes} onChange={(e) => setGlobalMinutes(e.target.value)} className="w-24" />
          </Field>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => {
              const n = Number(globalMinutes)
              if (!Number.isInteger(n) || n < 0) {
                onNotify('请填写非负整数分钟', 'error')
                return
              }
              const now = new Date().toISOString()
              void upsertGlobalAvailability({ date: globalDate, availableMinutes: n, createdAt: now, updatedAt: now }).then(() => {
                onNotify(`全局预算已设置：${globalDate} = ${n} 分钟`, 'success')
                setGlobalMinutes('')
              })
            }}
          >
            保存
          </Button>
        </div>
      </Card>

      {/* 生成计划 */}
      <Card className="px-4 py-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-ink">冲刺计划（ExamPlanSlot · 分钟预算）</h2>
          <div className="flex gap-2">
            <Button size="sm" onClick={buildPreview} disabled={links.length === 0}>
              生成 / 重新排程
            </Button>
            <Button size="sm" variant="secondary" onClick={() => setManualOpen(true)}>
              <IconPlus /> 手动安排
            </Button>
          </div>
        </div>
        <p className="mt-1.5 text-[11px] leading-relaxed text-ink3">
          按「目标优先权重」正比分配每日可用分钟；不做分钟→单词/页换算。手动安排与历史条目在重排时保留。
        </p>
        {upcomingSlots.length === 0 ? (
          <p className="mt-2 rounded-xl bg-base px-3 py-2.5 text-xs text-ink3">还没有未来排程。设置可用时间后点「生成 / 重新排程」。</p>
        ) : (
          <ul className="mt-2 divide-y divide-line/60">
            {upcomingSlots.map((s) => {
              const g = goals.find((x) => x.id === s.goalId)
              return (
                <li key={s.id} className="flex items-center gap-2 py-2 text-xs">
                  <span className="tnum w-24 shrink-0 text-ink3">
                    {formatMD(s.date)} {weekdayShort(s.date)}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-ink">
                    {g?.name ?? '目标已删除'}
                    {s.title ? ` · ${s.title}` : ''}
                  </span>
                  {s.isLocked && <span className="rounded bg-surface2 px-1.5 py-0.5 text-[10px] text-ink3">{s.source === 'manual' ? '手动' : '锁定'}</span>}
                  <span className="tnum font-semibold text-primary">{s.plannedMinutes} 分钟</span>
                  <button type="button" aria-label="删除这条排程" className="rounded-lg p-1 text-ink3 hover:text-danger" onClick={() => void deleteExamPlanSlotById(s.id)}>
                    <IconTrash />
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </Card>

      {/* 预览 */}
      <Modal
        open={!!preview}
        onClose={() => setPreview(null)}
        title="冲刺计划预览"
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setPreview(null)}>
              取消
            </Button>
            <Button onClick={() => void applyPlan()} loading={applying} disabled={preview?.upserts.length === 0 && preview?.removalIds.length === 0}>
              确认写入
            </Button>
          </div>
        }
      >
        {preview && (
          <div className="space-y-3 text-sm">
            <p className="tnum text-xs text-ink2">
              可用预算 {preview.result.totalBudgetMinutes} 分钟（{configured.length} 个已配置日）
              {preview.result.unconfiguredDays > 0 && ` · ${preview.result.unconfiguredDays} 天未配置不排程`}
            </p>
            {preview.upserts.length === 0 && preview.removalIds.length === 0 && (
              <p className="rounded-xl bg-okSoft px-3 py-2.5 text-xs text-ok">无需变更：现有排程已与假设一致（{preview.untouched} 项不变，{preview.lockedKept} 项锁定/手动/历史保留）。</p>
            )}
            {preview.upserts.length > 0 && (
              <div>
                <p className="mb-1 text-xs font-semibold text-ink2">写入（{preview.upserts.length}）</p>
                <ul className="tnum max-h-44 space-y-1 overflow-y-auto text-xs">
                  {preview.upserts.map((u, i) => (
                    <li key={`${u.date}-${u.goalId}-${i}`} className="flex justify-between rounded-lg bg-surface2 px-2.5 py-1.5">
                      <span>
                        {formatMD(u.date)} {weekdayShort(u.date)} · {goals.find((g) => g.id === u.goalId)?.name}
                      </span>
                      <span className="font-medium text-ink">{u.plannedMinutes} 分钟</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {preview.removalIds.length > 0 && <p className="text-xs text-danger">将移除 {preview.removalIds.length} 条旧的自动条目（未来且未锁定）。</p>}
            <p className="tnum text-[11px] text-ink3">保持不变 {preview.untouched} 项 · 锁定/手动/历史保留 {preview.lockedKept} 项</p>
            {preview.warnings.warnings.length > 0 && (
              <div className="rounded-xl bg-warnSoft px-3 py-2.5 text-xs text-warn">
                {preview.warnings.warnings.map((w, i) => (
                  <p key={i}>{w.message}</p>
                ))}
              </div>
            )}
            {!preview.warnings.globalConfigured && <p className="text-[11px] text-ink3">未配置跨考试总预算：无法校验多场考试的全局超额，仅校验本场考试的单日上限。</p>}
            <p className="text-[11px] leading-relaxed text-ink3">预算不足的三个出口：降低计划分钟、调整可用时间、手动分配重点。本应用不做任何「保证提分」的承诺。</p>
          </div>
        )}
      </Modal>

      {/* 手动安排 */}
      <Modal
        open={manualOpen}
        onClose={() => setManualOpen(false)}
        title="手动安排学习时间"
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setManualOpen(false)}>
              取消
            </Button>
            <Button onClick={() => void addManual()}>添加（自动锁定）</Button>
          </div>
        }
      >
        <div className="space-y-3.5">
          <Field label="日期" htmlFor="manual-date">
            <Input id="manual-date" type="date" value={manual.date} onChange={(e) => setManual({ ...manual, date: e.target.value })} />
          </Field>
          <Field label="目标" htmlFor="manual-goal">
            <select id="manual-goal" value={manual.goalId} onChange={(e) => setManual({ ...manual, goalId: e.target.value })} className="h-10 w-full rounded-xl border border-line bg-surface px-3 text-sm text-ink">
              <option value="">请选择</option>
              {links.map((l) => (
                <option key={l.goalId} value={l.goalId}>
                  {goals.find((g) => g.id === l.goalId)?.name ?? ''}
                </option>
              ))}
            </select>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="计划分钟" htmlFor="manual-min">
              <Input id="manual-min" type="number" min={1} value={manual.minutes} onChange={(e) => setManual({ ...manual, minutes: e.target.value })} />
            </Field>
            <Field label="主题（可选）" htmlFor="manual-title">
              <Input id="manual-title" value={manual.title} onChange={(e) => setManual({ ...manual, title: e.target.value })} placeholder="如：刷真题卷 2" maxLength={40} />
            </Field>
          </div>
        </div>
      </Modal>
    </div>
  )
}

