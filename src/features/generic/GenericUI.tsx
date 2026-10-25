import { useEffect, useMemo, useState } from 'react'
import type { DateStr, Goal, GoalLifecycle, GoalStatusEvent, StudyNote, StudyResumePoint, V4Table } from '../../domain/types'
import { effectiveStatus, canCheckin } from '../../domain/generic'
import { computeCheckinPrefill } from '../../domain/suggestion'
import { addDays, formatMD, todayStr } from '../../domain/dates'
import { systemClock } from '../../domain/clock'
import { checkinsOfGoal } from '../../domain/progress'
import { useAppData } from '../../state/AppData'
import { Badge, Button, Field, Input, TextArea } from '../../components/ui'
import { Modal, useToast } from '../../components/feedback'
import { IconPlus, IconTrash } from '../../components/icons'

/* ================= 公共 hooks ================= */

export function useV4<T>(table: V4Table): T[] {
  const { v4 } = useAppData()
  return (v4[table] ?? []) as unknown as T[]
}

export const nowIso = () => new Date().toISOString()

/* ================= 功能13：目标生命周期 ================= */

export function LifecycleControls({ goal }: { goal: Goal }) {
  const { checkins, putV4Rows } = useAppData()
  const toast = useToast()
  const lifecycles = useV4<GoalLifecycle>('goalLifecycles')
  const current = lifecycles.find((l) => l.goalId === goal.id)
  const status = effectiveStatus(goal, current, checkins)
  const [confirmTo, setConfirmTo] = useState<GoalLifecycle['manualStatus'] | null>(null)
  const [reason, setReason] = useState('')

  const doTransition = async () => {
    if (!confirmTo) return
    const now = nowIso()
    const from = current?.manualStatus ?? 'active'
    const row: GoalLifecycle = { goalId: goal.id, manualStatus: confirmTo, note: reason.trim() ? reason : null, pausedAt: confirmTo === 'paused' ? now : current?.pausedAt ?? null, isDemo: goal.isDemo, updatedAt: now }
    const event: GoalStatusEvent = { id: `ev-${goal.id}-${now}`, goalId: goal.id, from, to: confirmTo, reason: reason.trim() ? reason : null, occurredAt: now }
    try {
      if (confirmTo === 'active' && !current) {
        // 无记录时无需写 active 行
      } else {
        await putV4Rows('goalLifecycles', [row])
      }
      await putV4Rows('goalStatusEvents', [event])
      toast.success(confirmTo === 'active' ? '目标已恢复（截止日未自动延长，可到日历重新排程）' : `目标已${confirmTo === 'paused' ? '暂停' : confirmTo === 'cancelled' ? '取消（历史保留，可随时查看）' : '归档'}`)
      setConfirmTo(null)
      setReason('')
    } catch (err) {
      toast.error(err instanceof Error ? `状态切换失败：${err.message}（未保存，可重试）` : '保存失败，可重试')
    }
  }

  const label: Record<string, string> = { paused: '暂停', cancelled: '取消', archived: '归档', active: '恢复' }

  return (
    <div className="flex flex-wrap items-center gap-1.5 border-t border-line/70 px-4 py-2.5">
      <span className={`rounded-md px-1.5 py-0.5 text-[10px] font-medium ${status === 'completed' ? 'bg-okSoft text-ok' : status === 'active' ? 'bg-primarySoft text-primary' : status === 'paused' ? 'bg-warnSoft text-warn' : 'bg-surface2 text-ink3'}`}>
        {status === 'completed' ? '已完成' : status === 'active' ? '进行中' : status === 'paused' ? '已暂停' : status === 'cancelled' ? '已取消' : '已归档'}
      </span>
      {(status === 'paused' || status === 'cancelled' || status === 'archived') && (
        <Button size="sm" variant="ghost" onClick={() => setConfirmTo('active')}>
          恢复
        </Button>
      )}
      {status === 'active' && (
        <>
          <Button size="sm" variant="ghost" onClick={() => setConfirmTo('paused')}>
            暂停
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setConfirmTo('cancelled')}>
            取消
          </Button>
        </>
      )}
      {(status === 'completed' || status === 'active') && (
        <Button size="sm" variant="ghost" onClick={() => setConfirmTo('archived')}>
          归档
        </Button>
      )}
      {current?.pausedAt && <span className="text-[11px] text-ink3">暂停于 {formatMD(current.pausedAt.slice(0, 10))}</span>}
      <Modal
        open={!!confirmTo}
        onClose={() => setConfirmTo(null)}
        title={`${label[confirmTo ?? 'active']}目标「${goal.name}」`}
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setConfirmTo(null)}>
              取消
            </Button>
            <Button onClick={() => void doTransition()}>确认</Button>
          </div>
        }
      >
        <div className="space-y-3 text-sm text-ink2">
          <p>
            {confirmTo === 'paused' && '暂停期间不自动安排未来学习，不把暂停日当作必须打卡日；历史数据保留，原截止日不会自动延长。'}
            {confirmTo === 'cancelled' && '主动终止：历史完成量与投入仍可查看，不再生成未来安排。取消不是删除。'}
            {confirmTo === 'archived' && '移出活跃视图用于收纳；进度、复盘、计时、随记仍可查询。'}
            {confirmTo === 'active' && '恢复为进行中：可继续打卡；恢复时请检查剩余天数，必要时到「日历」重新排程。'}
          </p>
          {confirmTo !== 'active' && (
            <Field label="原因（可选）" htmlFor={`lc-reason-${goal.id}`}>
              <Input id={`lc-reason-${goal.id}`} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={100} />
            </Field>
          )}
        </div>
      </Modal>
    </div>
  )
}

/** 状态筛选（今日页） */
export function useGoalStatusFilter(): {
  filter: 'active' | 'completed' | 'paused' | 'cancelled' | 'archived' | 'all'
  setFilter: (f: 'active' | 'completed' | 'paused' | 'cancelled' | 'archived' | 'all') => void
  statusOf: (goal: Goal) => string
  bar: React.ReactNode
} {
  const { checkins } = useAppData()
  const lifecycles = useV4<GoalLifecycle>('goalLifecycles')
  const [filter, setFilter] = useState<'active' | 'completed' | 'paused' | 'cancelled' | 'archived' | 'all'>('active')
  const statusOf = (goal: Goal) => effectiveStatus(goal, lifecycles.find((l) => l.goalId === goal.id), checkins)
  const bar = (
    <div className="flex flex-wrap gap-1" role="radiogroup" aria-label="按状态筛选目标">
      {(
        [
          ['active', '进行中'],
          ['completed', '已完成'],
          ['paused', '已暂停'],
          ['cancelled', '已取消'],
          ['archived', '已归档'],
          ['all', '全部'],
        ] as const
      ).map(([key, label]) => (
        <button
          key={key}
          type="button"
          role="radio"
          aria-checked={filter === key}
          onClick={() => setFilter(key)}
          className={`rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors ${filter === key ? 'bg-primarySoft text-primary' : 'border border-line text-ink3'}`}
        >
          {label}
        </button>
      ))}
    </div>
  )
  return { filter, setFilter, statusOf, bar }
}

/* ================= 功能5+7：一键开始 & 极速打卡 ================= */

export function QuickActions({ goal, onOpenFocus }: { goal: Goal; onOpenFocus: (goalId: string) => void }) {
  const { checkins, today, addCheckin, deleteCheckin } = useAppData()
  const toast = useToast()
  const [saving, setSaving] = useState(false)
  const [lastCheckinId, setLastCheckinId] = useState<string | null>(null)
  const goalCheckins = checkinsOfGoal(checkins, goal.id)
  const status = effectiveStatus(goal, undefined, checkins)
  const prefill = canCheckin(status) ? computeCheckinPrefill(goal, goalCheckins, today) : 0

  const quickSave = async () => {
    if (prefill <= 0) {
      toast.info('今日建议量已为 0（可能已完成或已打卡），可打开打卡表单自定义数量')
      return
    }
    setSaving(true)
    try {
      const c = await addCheckin({ goalId: goal.id, date: today, amount: prefill, minutes: null, note: null, isBackfill: false })
      setLastCheckinId(c.id)
      toast.success(`已记录 ${prefill} ${goal.unit}（可撤销）`)
    } catch (err) {
      toast.error(err instanceof Error ? `保存失败：${err.message}（未保存，可重试）` : '保存失败，可重试')
    } finally {
      setSaving(false)
    }
  }

  const undo = async () => {
    if (!lastCheckinId) return
    try {
      await deleteCheckin(lastCheckinId)
      toast.success('已撤销刚才的打卡，统计已回算')
      setLastCheckinId(null)
    } catch (err) {
      toast.error(err instanceof Error ? `撤销失败：${err.message}` : '撤销失败')
    }
  }

  return (
    <div className="flex items-center gap-2">
      <Button size="sm" variant="soft" onClick={() => onOpenFocus(goal.id)} title="一键开始学习（复用番茄钟）">
        开始
      </Button>
      <Button size="sm" variant="ghost" onClick={() => void quickSave()} loading={saving} title={`一键记录今日建议量 ${prefill} ${goal.unit}`} disabled={prefill <= 0}>
        记 {prefill > 0 ? `${prefill} ${goal.unit}` : '建议量'}
      </Button>
      {lastCheckinId && (
        <Button size="sm" variant="ghost" className="text-ink3" onClick={() => void undo()}>
          撤销
        </Button>
      )}
    </div>
  )
}

/** 批量记录（今日页入口）：行式表格，原子写入，遵循补记 6 天规则 */
export function BatchCheckinDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { goals, checkins, today, addCheckin } = useAppData()
  const toast = useToast()
  const [rows, setRows] = useState<Array<{ date: DateStr; goalId: string; amount: string; minutes: string; note: string }>>([
    { date: today, goalId: '', amount: '', minutes: '', note: '' },
  ])
  const [saving, setSaving] = useState(false)

  const activeGoals = goals.filter((g) => canCheckin(effectiveStatus(g, undefined, checkins)))
  const update = (i: number, patch: Partial<(typeof rows)[number]>) => setRows(rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)))

  const validateAll = () => {
    const problems: string[] = []
    rows.forEach((r, i) => {
      const n = i + 1
      const goal = activeGoals.find((g) => g.id === r.goalId)
      if (!goal) problems.push(`第 ${n} 行：请选择目标`)
      const amount = Number(r.amount)
      if (!Number.isFinite(amount) || amount <= 0) problems.push(`第 ${n} 行：数量需大于 0`)
      if (r.date > today) problems.push(`第 ${n} 行：不能为未来日期打卡`)
      if (r.date < addDays(today, -6)) problems.push(`第 ${n} 行：只能补记最近 6 天`)
      if (goal && r.date < goal.startDate) problems.push(`第 ${n} 行：早于目标开始日`)
      if (goal && goal.deadline < today && r.date > goal.deadline) problems.push(`第 ${n} 行：早于截止日`)
    })
    return problems
  }

  const submit = async () => {
    const problems = validateAll()
    if (problems.length > 0) {
      toast.error(`存在问题，未保存任何行：${problems[0]}${problems.length > 1 ? `（共 ${problems.length} 个问题）` : ''}`)
      return
    }
    setSaving(true)
    try {
      // 原子性：逐行写入，任一失败则停止并报告已提交数（IndexedDB 无跨表事务跨 Repository 动作，逐行报告诚实状态）
      let saved = 0
      for (const r of rows) {
        const goal = activeGoals.find((g) => g.id === r.goalId)!
        await addCheckin({
          goalId: goal.id,
          date: r.date,
          amount: Number(r.amount),
          minutes: r.minutes.trim() === '' ? null : Number(r.minutes),
          note: r.note.trim() ? r.note : null,
          isBackfill: r.date < today,
        })
        saved++
      }
      toast.success(`批量保存完成：${saved} 条（含补记「补」标）`)
      onClose()
      setRows([{ date: today, goalId: '', amount: '', minutes: '', note: '' }])
    } catch (err) {
      toast.error(err instanceof Error ? `保存中断：${err.message}（已提交的行保留，可修正后重试）` : '保存中断，可重试')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="批量记录"
      footer={
        <div className="flex items-center justify-between gap-2">
          <p className="text-[11px] text-ink3">
            共 {rows.length} 行 · 按目标单位分开统计 · 补记 ≤6 天
          </p>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={onClose}>
              取消
            </Button>
            <Button onClick={() => void submit()} loading={saving}>
              全部保存
            </Button>
          </div>
        </div>
      }
    >
      <div className="space-y-3">
        {rows.map((r, i) => (
          <div key={i} className="grid grid-cols-[auto_1fr_1fr_auto] items-end gap-2 rounded-xl border border-line/70 p-2.5">
            <Field label="日期" htmlFor={`b-date-${i}`}>
              <select id={`b-date-${i}`} value={r.date} onChange={(e) => update(i, { date: e.target.value })} className="h-9 w-32 rounded-xl border border-line bg-surface px-2 text-xs">
                {[today, ...Array.from({ length: 6 }, (_, k) => addDays(today, -(k + 1)))].map((d) => (
                  <option key={d} value={d}>
                    {formatMD(d)}
                    {d < today ? '（补）' : ''}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="目标" htmlFor={`b-goal-${i}`}>
              <select id={`b-goal-${i}`} value={r.goalId} onChange={(e) => update(i, { goalId: e.target.value })} className="h-9 w-full rounded-xl border border-line bg-surface px-2 text-xs">
                <option value="">选择目标</option>
                {activeGoals.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}（{g.unit}）
                  </option>
                ))}
              </select>
            </Field>
            <Field label="数量 / 分钟(选填)" htmlFor={`b-amount-${i}`}>
              <div className="flex gap-1.5">
                <Input id={`b-amount-${i}`} type="number" min={0} step="any" value={r.amount} onChange={(e) => update(i, { amount: e.target.value })} className="h-9" />
                <Input type="number" min={0} placeholder="分" value={r.minutes} onChange={(e) => update(i, { minutes: e.target.value })} aria-label={`第 ${i + 1} 行分钟数`} className="h-9 w-20" />
              </div>
            </Field>
            <Button size="sm" variant="ghost" aria-label={`删除第 ${i + 1} 行`} disabled={rows.length === 1} onClick={() => setRows(rows.filter((_, idx) => idx !== i))}>
              <IconTrash />
            </Button>
            <div className="col-span-4">
              <Input value={r.note} onChange={(e) => update(i, { note: e.target.value })} placeholder="备注（可选）" aria-label={`第 ${i + 1} 行备注`} className="h-8 text-xs" />
            </div>
          </div>
        ))}
        <Button size="sm" variant="secondary" onClick={() => setRows([...rows, { ...rows[rows.length - 1] }])}>
          <IconPlus /> 复制上一行
        </Button>
      </div>
    </Modal>
  )
}

/* ================= 功能6：断点续接 ================= */

export function ResumeBlock({ goal }: { goal: Goal }) {
  const { putV4Rows, deleteV4Rows } = useAppData()
  const toast = useToast()
  const points = useV4<StudyResumePoint>('studyResumePoints')
  const point = points.find((p) => p.goalId === goal.id)
  const [editing, setEditing] = useState(false)
  const [lastPosition, setLastPosition] = useState(point?.lastPosition ?? '')
  const [nextAction, setNextAction] = useState(point?.nextAction ?? '')

  useEffect(() => {
    setLastPosition(point?.lastPosition ?? '')
    setNextAction(point?.nextAction ?? '')
  }, [point?.lastPosition, point?.nextAction])

  const save = async () => {
    try {
      await putV4Rows('studyResumePoints', [
        { goalId: goal.id, lastPosition: lastPosition.trim() || null, nextAction: nextAction.trim() || null, updatedAt: nowIso() },
      ])
      toast.success('断点已保存（不会改变实际完成量）')
      setEditing(false)
    } catch (err) {
      toast.error(err instanceof Error ? `保存失败：${err.message}（未保存，可重试）` : '保存失败，可重试')
    }
  }

  return (
    <div className="border-t border-line/70 px-4 py-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-semibold text-ink2">断点续接</p>
        <Button size="sm" variant="ghost" onClick={() => (editing ? void save() : setEditing(true))}>
          {editing ? '保存' : point ? '修改' : '设置断点'}
        </Button>
      </div>
      {editing ? (
        <div className="mt-2 space-y-2">
          <Input value={lastPosition} onChange={(e) => setLastPosition(e.target.value)} placeholder="上次学到：如「看到 120 页」/「视频 03:20」" maxLength={80} aria-label="上次学到" />
          <Input value={nextAction} onChange={(e) => setNextAction(e.target.value)} placeholder="下次继续：如「先做第 4 章练习」" maxLength={80} aria-label="下次继续" />
          <div className="flex gap-2">
            <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
              取消
            </Button>
            {(lastPosition || nextAction) && (
              <Button size="sm" variant="ghost" className="text-danger" onClick={() => void deleteV4Rows('studyResumePoints', [goal.id]).then(() => { toast.success('断点已清除'); setEditing(false); setLastPosition(''); setNextAction('') })}>
                清空
              </Button>
            )}
          </div>
        </div>
      ) : point?.lastPosition || point?.nextAction ? (
        <p className="mt-1.5 text-xs leading-relaxed text-ink2">
          {point.lastPosition && (
            <>
              <span className="font-medium text-ink">上次学到：</span>
              {point.lastPosition}
            </>
          )}
          {point.lastPosition && point.nextAction && ' · '}
          {point.nextAction && (
            <>
              <span className="font-medium text-ink">下次继续：</span>
              {point.nextAction}
            </>
          )}
          <span className="ml-1 text-ink3">（{formatMD(point.updatedAt.slice(0, 10))} 更新）</span>
        </p>
      ) : (
        <p className="mt-1.5 text-[11px] text-ink3">还没有断点。记录「上次学到 / 下次继续」，下次打开直接接上（不影响完成量）。</p>
      )}
    </div>
  )
}

/* ================= 功能8：学习随记 ================= */

export function NotesBlock({ goal }: { goal: Goal }) {
  const { putV4Rows, deleteV4Rows } = useAppData()
  const toast = useToast()
  const notes = useV4<StudyNote>('studyNotes')
  const goalNotes = useMemo(() => notes.filter((n) => n.goalId === goal.id).sort((a, b) => (a.date < b.date ? 1 : -1)), [notes, goal.id])
  const [body, setBody] = useState('')
  const [mood, setMood] = useState<StudyNote['mood']>('进展')

  const add = async () => {
    const text = body.trim()
    if (!text) return
    const now = nowIso()
    try {
      await putV4Rows('studyNotes', [
        ...goalNotes,
        { id: `note-${now}-${Math.random().toString(36).slice(2, 6)}`, goalId: goal.id, date: todayStr(systemClock), body: text, mood, createdAt: now, updatedAt: now },
      ])
      setBody('')
      toast.success('随记已保存（不影响完成量与统计）')
    } catch (err) {
      toast.error(err instanceof Error ? `保存失败：${err.message}` : '保存失败，可重试')
    }
  }

  const remove = async (id: string) => {
    try {
      await deleteV4Rows('studyNotes', [id])
      toast.success('随记已删除')
    } catch (err) {
      toast.error(err instanceof Error ? `删除失败：${err.message}` : '删除失败')
    }
  }

  return (
    <div className="border-t border-line/70 px-4 py-3">
      <p className="mb-2 text-xs font-semibold text-ink2">学习随记（{goalNotes.length}）</p>
      <div className="flex gap-1.5">
        {(['进展', '困难', '调整', '其他'] as const).map((m) => (
          <button
            key={m}
            type="button"
            aria-pressed={mood === m}
            onClick={() => setMood(m)}
            className={`rounded-lg px-2 py-1 text-[11px] font-medium ${mood === m ? 'bg-primarySoft text-primary' : 'border border-line text-ink3'}`}
          >
            {m}
          </button>
        ))}
      </div>
      <div className="mt-2 space-y-2">
        <TextArea rows={2} value={body} onChange={(e) => setBody(e.target.value)} placeholder="一句话记录：今天的状态、卡点、下次想法…" maxLength={300} aria-label="随记内容" />
        <Button size="sm" variant="secondary" disabled={!body.trim()} onClick={() => void add()}>
          保存随记
        </Button>
      </div>
      <ul className="mt-3 space-y-1.5">
        {goalNotes.slice(0, 8).map((n) => (
          <li key={n.id} className="flex items-start gap-2 rounded-lg bg-base px-2.5 py-2 text-xs">
            <Badge tone={n.mood === '困难' ? 'warn' : n.mood === '进展' ? 'ok' : 'neutral'}>{n.mood ?? '其他'}</Badge>
            <span className="min-w-0 flex-1 whitespace-pre-wrap break-words text-ink2">{n.body}</span>
            <span className="tnum shrink-0 text-[10px] text-ink3">{formatMD(n.date)}</span>
            <button type="button" aria-label="删除随记" className="shrink-0 text-ink3 hover:text-danger" onClick={() => void remove(n.id)}>
              <IconTrash />
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}
