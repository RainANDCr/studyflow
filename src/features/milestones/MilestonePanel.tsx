import { useMemo, useState } from 'react'
import type { Checkin, Goal, Milestone, MilestoneStep } from '../../domain/types'
import { round2 } from '../../domain/milestone'
import {
  averageSplit,
  checkMilestoneTotalConflict,
  getGoalMilestoneTimeline,
  getUnassignedCheckins,
  stepsCompletion,
  timeSplit,
} from '../../domain/milestone'
import { useAppData } from '../../state/AppData'
import { Badge, Button, Field, Input, ProgressBar } from '../../components/ui'
import { ConfirmDialog, Modal, useToast } from '../../components/feedback'
import { IconChevronDown, IconPlus, IconTrash, IconX } from '../../components/icons'

function fmt(n: number): string {
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100)
}

type SplitMode = 'manual' | 'average' | 'time'

interface DraftMilestone {
  title: string
  plannedAmount: string
  startDate: string
  dueDate: string
}

const emptyDraft: DraftMilestone = { title: '', plannedAmount: '', startDate: '', dueDate: '' }

/** 阶段计划 / 里程碑面板：目标详情内的二级区域，不占今日主流程。 */
export function MilestonePanel({ goal }: { goal: Goal }) {
  const { milestones, milestoneSteps, checkins, today, saveMilestones, deleteMilestoneById, saveMilestoneSteps, deleteMilestoneStepById, assignCheckinsToMilestone } = useAppData()
  const toast = useToast()
  const [expanded, setExpanded] = useState(false)
  const [openMilestoneId, setOpenMilestoneId] = useState<string | null>(null)
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<Milestone | null>(null)
  const [splitMode, setSplitMode] = useState<SplitMode>('manual')
  const [draft, setDraft] = useState<DraftMilestone>(emptyDraft)
  const [splitCount, setSplitCount] = useState('3')
  const [splitRange, setSplitRange] = useState({ from: '', to: '' })
  const [deletingMilestone, setDeletingMilestone] = useState<Milestone | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [newStep, setNewStep] = useState('')
  const [confirmUnassignedTo, setConfirmUnassignedTo] = useState<Milestone | null>(null)

  const goalMilestones = useMemo(() => milestones.filter((m) => m.goalId === goal.id), [milestones, goal.id])
  const timeline = useMemo(() => getGoalMilestoneTimeline(goalMilestones, checkins, today), [goalMilestones, checkins, today])
  const unassigned = useMemo(() => getUnassignedCheckins(goal.id, checkins), [checkins, goal.id])
  const unassignedSum = round2(unassigned.reduce((s, c) => s + c.amount, 0))
  const conflict = checkMilestoneTotalConflict(goal, goalMilestones)

  const openCreate = () => {
    setEditing(null)
    setSplitMode('manual')
    setDraft(emptyDraft)
    setSplitCount('3')
    setFormOpen(true)
  }

  const openEdit = (m: Milestone) => {
    setEditing(m)
    setSplitMode('manual')
    setDraft({
      title: m.title,
      plannedAmount: String(m.plannedAmount),
      startDate: m.startDate ?? '',
      dueDate: m.dueDate ?? '',
    })
    setFormOpen(true)
  }

  const buildDrafts = (): Array<{ title: string; plannedAmount: number; startDate: string | null; dueDate: string | null }> => {
    if (splitMode === 'manual') {
      return [
        {
          title: draft.title.trim() || '未命名阶段',
          plannedAmount: Number(draft.plannedAmount),
          startDate: draft.startDate || null,
          dueDate: draft.dueDate || null,
        },
      ]
    }
    const n = Math.max(1, Math.min(20, Math.floor(Number(splitCount) || 0)))
    const remainingToSplit = round2(goal.totalAmount - goalMilestones.reduce((s, m) => s + m.plannedAmount, 0))
    if (splitMode === 'average') {
      return averageSplit(remainingToSplit, n, goalMilestones.length).map((d) => ({
        ...d,
        plannedAmount: d.plannedAmount,
      }))
    }
    return timeSplit(remainingToSplit, splitRange.from, splitRange.to, n, goalMilestones.length)
  }

  const submitForm = async () => {
    const drafts = buildDrafts()
    if (drafts.some((d) => !Number.isFinite(d.plannedAmount) || d.plannedAmount <= 0)) {
      toast.error('每个阶段的计划量需为大于 0 的数字')
      return
    }
    if (drafts.some((d) => !d.title.trim())) {
      toast.error('请填写阶段标题')
      return
    }
    const now = new Date().toISOString()
    const startOrder = editing
      ? editing.sortOrder
      : goalMilestones.reduce((max, m) => Math.max(max, m.sortOrder), -1) + 1
    const toSave: Milestone[] = drafts.map((d, i) => ({
      id: editing?.id ?? `ms-${goal.id}-${Date.now()}-${i}`,
      goalId: goal.id,
      title: d.title.trim(),
      plannedAmount: d.plannedAmount,
      startDate: d.startDate,
      dueDate: d.dueDate,
      sortOrder: startOrder + i,
      color: editing?.color ?? null,
      isDemo: goal.isDemo,
      createdAt: editing?.createdAt ?? now,
      updatedAt: now,
    }))
    try {
      if (editing) await saveMilestones(toSave)
      else await saveMilestones([...goalMilestones, ...toSave])
      const totalAfter = checkMilestoneTotalConflict(
        goal,
        editing ? goalMilestones.map((m) => (m.id === editing.id ? toSave[0] : m)) : [...goalMilestones, ...toSave],
      )
      toast.success(
        totalAfter
          ? `已保存，注意：阶段总量超出目标总量 ${fmt(totalAfter.over)} ${goal.unit}`
          : editing ? '阶段已更新' : `已创建 ${toSave.length} 个阶段`,
      )
      setFormOpen(false)
    } catch (err) {
      toast.error(err instanceof Error ? `保存失败：${err.message}` : '保存失败，请重试')
    }
  }

  const move = async (m: Milestone, dir: -1 | 1) => {
    const sorted = [...goalMilestones].sort((a, b) => a.sortOrder - b.sortOrder)
    const idx = sorted.findIndex((x) => x.id === m.id)
    const swapWith = sorted[idx + dir]
    if (!swapWith) return
    await saveMilestones([
      { ...m, sortOrder: swapWith.sortOrder, updatedAt: new Date().toISOString() },
      { ...swapWith, sortOrder: m.sortOrder, updatedAt: new Date().toISOString() },
    ])
  }

  const doDelete = async () => {
    if (!deletingMilestone) return
    setDeleting(true)
    try {
      await deleteMilestoneById(deletingMilestone.id)
      toast.success('阶段已删除，其打卡记录保留（已回到未分配）')
      setDeletingMilestone(null)
    } catch (err) {
      toast.error(err instanceof Error ? `删除失败：${err.message}` : '删除失败，请重试')
    } finally {
      setDeleting(false)
    }
  }

  const linkUnassigned = async (target: Milestone) => {
    try {
      await assignCheckinsToMilestone(
        unassigned.map((c) => c.id),
        target.id,
      )
      toast.success(`已将 ${unassigned.length} 条未分配记录关联到「${target.title}」`)
      setConfirmUnassignedTo(null)
    } catch (err) {
      toast.error(err instanceof Error ? `关联失败：${err.message}` : '关联失败，请重试')
    }
  }

  const addStep = async (milestoneId: string) => {
    const title = newStep.trim()
    if (!title) return
    const steps = milestoneSteps.filter((s) => s.milestoneId === milestoneId)
    const now = new Date().toISOString()
    await saveMilestoneSteps([
      ...steps,
      { id: `step-${milestoneId}-${Date.now()}`, milestoneId, title, isDone: false, doneAt: null, sortOrder: steps.length, createdAt: now, updatedAt: now },
    ])
    setNewStep('')
  }

  const toggleStep = async (step: MilestoneStep) => {
    await saveMilestoneSteps([{ ...step, isDone: !step.isDone, doneAt: !step.isDone ? new Date().toISOString() : null, updatedAt: new Date().toISOString() }])
  }

  const unlinkCheckin = async (c: Checkin) => {
    await assignCheckinsToMilestone([c.id], null)
  }

  return (
    <div className="border-t border-line/70 px-4 py-3">
      <button type="button" onClick={() => setExpanded((v) => !v)} aria-expanded={expanded} className="flex w-full items-center justify-between gap-2 text-left">
        <span className="text-xs font-semibold text-ink2">
          阶段计划 / 里程碑
          {timeline.next && (
            <span className="ml-2 font-normal text-ink3">
              下一阶段：{timeline.next.milestone.title}（{Math.round(timeline.next.percent)}%）
            </span>
          )}
        </span>
        <IconChevronDown className={`text-ink3 transition-transform ${expanded ? 'rotate-180' : ''}`} />
      </button>

      {expanded && (
        <div className="mt-3 space-y-3">
          {goalMilestones.length === 0 && (
            <p className="rounded-xl bg-base px-3 py-2.5 text-xs leading-relaxed text-ink3">
              还没有阶段。可以把「{fmt(goal.totalAmount)} {goal.unit}」拆成几个有序阶段（例如按章节或按月），逐段推进。
            </p>
          )}

          <ol className="space-y-2">
            {timeline.items.map((item, idx) => {
              const m = item.milestone
              const steps = milestoneSteps.filter((s) => s.milestoneId === m.id).sort((a, b) => a.sortOrder - b.sortOrder)
              const sc = stepsCompletion(steps)
              const isNext = timeline.next?.milestone.id === m.id
              return (
                <li key={m.id} className={`rounded-xl border px-3 py-2.5 ${isNext ? 'border-primary/40 bg-primarySoft/30' : 'border-line/70'}`}>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-surface2 text-[11px] font-bold text-ink2">{idx + 1}</span>
                    <p className="min-w-0 flex-1 truncate text-sm font-medium text-ink">{m.title}</p>
                    {item.isCompleted && <Badge tone="ok">已完成</Badge>}
                    {isNext && !item.isCompleted && <Badge tone="primary">进行中</Badge>}
                    {item.overdueDays !== null && <Badge tone="danger">逾期 {item.overdueDays} 天</Badge>}
                  </div>
                  <div className="mt-2 flex items-center gap-2">
                    <ProgressBar percent={item.percent} color={goal.color} />
                    <span className="tnum shrink-0 text-[11px] text-ink3">
                      {fmt(item.done)}/{fmt(m.plannedAmount)} {goal.unit}
                    </span>
                  </div>
                  <p className="tnum mt-1 text-[11px] text-ink3">
                    {m.startDate && m.dueDate ? `${m.startDate} ~ ${m.dueDate}` : m.dueDate ? `截止 ${m.dueDate}` : '未设时间'}
                    {sc.total > 0 && ` · 步骤 ${sc.done}/${sc.total}`}
                    {' · '}
                    <button type="button" className="text-primary hover:underline" onClick={() => setOpenMilestoneId(openMilestoneId === m.id ? null : m.id)}>
                      {openMilestoneId === m.id ? '收起' : '详情与步骤'}
                    </button>
                  </p>

                  {openMilestoneId === m.id && (
                    <div className="mt-2.5 space-y-2.5 rounded-lg bg-base px-3 py-2.5">
                      {/* 步骤清单：纯勾选，不影响量化进度 */}
                      <div className="space-y-1.5">
                        {steps.map((s) => (
                          <div key={s.id} className="flex items-center gap-2 text-xs">
                            <input
                              type="checkbox"
                              checked={s.isDone}
                              onChange={() => void toggleStep(s)}
                              aria-label={`完成步骤：${s.title}`}
                              className="accent-[rgb(var(--c-ok))]"
                            />
                            <span className={s.isDone ? 'text-ink3 line-through' : 'text-ink2'}>{s.title}</span>
                            <button
                              type="button"
                              aria-label={`删除步骤 ${s.title}`}
                              onClick={() => void deleteMilestoneStepById(s.id)}
                              className="ml-auto text-ink3 hover:text-danger"
                            >
                              <IconX className="text-xs" />
                            </button>
                          </div>
                        ))}
                      </div>
                      <div className="flex items-center gap-2">
                        <Input
                          value={newStep}
                          onChange={(e) => setNewStep(e.target.value)}
                          placeholder="添加小步骤，如：看完第 3 章"
                          className="h-8 flex-1 text-xs"
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') void addStep(m.id)
                          }}
                          aria-label="新步骤标题"
                        />
                        <Button size="sm" variant="secondary" onClick={() => void addStep(m.id)}>
                          <IconPlus /> 步骤
                        </Button>
                      </div>
                      <p className="text-[10px] text-ink3">步骤仅作清单提醒，不计入完成量；完成量只由打卡累积。</p>
                      {/* 该阶段打卡明细 */}
                      {checkins.filter((c) => c.milestoneId === m.id).length > 0 && (
                        <div className="space-y-1">
                          <p className="text-[11px] font-medium text-ink3">关联打卡（{checkins.filter((c) => c.milestoneId === m.id).length}）</p>
                          {checkins
                            .filter((c) => c.milestoneId === m.id)
                            .slice(-5)
                            .reverse()
                            .map((c) => (
                              <div key={c.id} className="tnum flex items-center gap-2 text-[11px] text-ink2">
                                <span>{c.date}</span>
                                <span>{fmt(c.amount)} {goal.unit}</span>
                                <button type="button" className="ml-auto text-ink3 hover:text-danger" onClick={() => void unlinkCheckin(c)} aria-label="取消关联">
                                  取消关联
                                </button>
                              </div>
                            ))}
                        </div>
                      )}
                      <div className="flex flex-wrap gap-1.5">
                        <Button size="sm" variant="secondary" onClick={() => openEdit(m)}>
                          编辑
                        </Button>
                        <Button size="sm" variant="ghost" disabled={idx === 0} onClick={() => void move(m, -1)}>
                          上移
                        </Button>
                        <Button size="sm" variant="ghost" disabled={idx === timeline.items.length - 1} onClick={() => void move(m, 1)}>
                          下移
                        </Button>
                        <Button size="sm" variant="ghost" className="text-danger" onClick={() => setDeletingMilestone(m)}>
                          <IconTrash /> 删除
                        </Button>
                      </div>
                    </div>
                  )}
                </li>
              )
            })}
          </ol>

          {/* 未分配记录 */}
          {unassigned.length > 0 && goalMilestones.length > 0 && (
            <div className="rounded-xl border border-dashed border-line px-3 py-2.5">
              <p className="text-xs font-medium text-ink2">
                未分配记录：{unassigned.length} 条，共 {fmt(unassignedSum)} {goal.unit}
              </p>
              <p className="mt-0.5 text-[11px] text-ink3">这些打卡未归属任何阶段（计入主目标总进度，不影响连续天数与统计）。</p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {timeline.items
                  .filter((i) => !i.isCompleted)
                  .map((i) => (
                    <Button key={i.milestone.id} size="sm" variant="secondary" onClick={() => setConfirmUnassignedTo(i.milestone)}>
                      全部关联到「{i.milestone.title}」
                    </Button>
                  ))}
              </div>
            </div>
          )}

          {conflict && (
            <p className="rounded-xl bg-warnSoft px-3 py-2.5 text-xs leading-relaxed text-warn">
              阶段计划量合计 {fmt(conflict.totalPlanned)} {goal.unit}，超出目标总量 {fmt(conflict.over)} {goal.unit}。请手动调整各阶段数量（不会自动缩放你填写的数字）。
            </p>
          )}

          <Button size="sm" variant="secondary" onClick={openCreate}>
            <IconPlus /> 添加阶段
          </Button>
        </div>
      )}

      {/* 创建/编辑 + 半自动拆分 */}
      <Modal
        open={formOpen}
        onClose={() => setFormOpen(false)}
        title={editing ? '编辑阶段' : '添加阶段'}
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setFormOpen(false)}>
              取消
            </Button>
            <Button onClick={() => void submitForm()} disabled={splitMode !== 'manual' && !draft.title && false}>
              {editing ? '保存' : splitMode === 'manual' ? '创建阶段' : '生成预览并创建'}
            </Button>
          </div>
        }
      >
        <div className="space-y-4">
          {!editing && (
            <div className="flex gap-1.5" role="radiogroup" aria-label="拆分方式">
              {(
                [
                  ['manual', '手动录入'],
                  ['average', '平均拆分'],
                  ['time', '按时间分段'],
                ] as Array<[SplitMode, string]>
              ).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={splitMode === value}
                  onClick={() => setSplitMode(value)}
                  className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                    splitMode === value ? 'bg-primarySoft text-primary' : 'border border-line text-ink3'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          )}

          {splitMode === 'manual' && (
            <>
              <Field label="阶段标题" htmlFor="ms-title">
                <Input id="ms-title" value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} placeholder="如：第 1 部分（第 1–8 章）" maxLength={40} />
              </Field>
              <div className="grid grid-cols-3 gap-3">
                <Field label={`计划量（${goal.unit}）`} htmlFor="ms-amount">
                  <Input id="ms-amount" type="number" min={0} step="any" value={draft.plannedAmount} onChange={(e) => setDraft({ ...draft, plannedAmount: e.target.value })} />
                </Field>
                <Field label="开始（可选）" htmlFor="ms-start">
                  <Input id="ms-start" type="date" value={draft.startDate} onChange={(e) => setDraft({ ...draft, startDate: e.target.value })} />
                </Field>
                <Field label="截止（可选）" htmlFor="ms-due">
                  <Input id="ms-due" type="date" value={draft.dueDate} onChange={(e) => setDraft({ ...draft, dueDate: e.target.value })} />
                </Field>
              </div>
            </>
          )}

          {splitMode === 'average' && (
            <div className="space-y-2">
              <Field label="拆成几个阶段" htmlFor="ms-split-n">
                <Input id="ms-split-n" type="number" min={1} max={20} value={splitCount} onChange={(e) => setSplitCount(e.target.value)} className="w-24" />
              </Field>
              <p className="rounded-lg bg-base px-3 py-2 text-xs text-ink2">
                将把尚未拆分的余量（{fmt(round2(goal.totalAmount - goalMilestones.reduce((s, m) => s + m.plannedAmount, 0)))} {goal.unit}）平均分成 {Math.max(1, Math.floor(Number(splitCount) || 1))} 段，数量之和精确等于余量。
              </p>
            </div>
          )}

          {splitMode === 'time' && (
            <div className="space-y-2">
              <div className="grid grid-cols-2 gap-3">
                <Field label="从" htmlFor="ms-range-from">
                  <Input id="ms-range-from" type="date" value={splitRange.from} onChange={(e) => setSplitRange({ ...splitRange, from: e.target.value })} />
                </Field>
                <Field label="到" htmlFor="ms-range-to">
                  <Input id="ms-range-to" type="date" value={splitRange.to} onChange={(e) => setSplitRange({ ...splitRange, to: e.target.value })} />
                </Field>
              </div>
              <Field label="拆成几个阶段" htmlFor="ms-split-n2">
                <Input id="ms-split-n2" type="number" min={1} max={20} value={splitCount} onChange={(e) => setSplitCount(e.target.value)} className="w-24" />
              </Field>
            </div>
          )}
        </div>
      </Modal>

      <ConfirmDialog
        open={!!deletingMilestone}
        title="删除阶段"
        danger
        confirmText="删除阶段"
        busy={deleting}
        message={
          <span>
            将删除阶段「{deletingMilestone?.title}」。其关联的打卡记录<b>会保留</b>并回到「未分配」，主目标进度、连续天数与统计不变。
          </span>
        }
        onConfirm={() => void doDelete()}
        onClose={() => setDeletingMilestone(null)}
      />

      <ConfirmDialog
        open={!!confirmUnassignedTo}
        title="批量关联打卡"
        confirmText="确认关联"
        message={
          confirmUnassignedTo ? (
            <span>
              将 {unassigned.length} 条未分配记录（共 {fmt(unassignedSum)} {goal.unit}）全部关联到「{confirmUnassignedTo.title}」？该阶段当前计划量 {fmt(confirmUnassignedTo.plannedAmount)} {goal.unit}
              {unassignedSum > confirmUnassignedTo.plannedAmount ? '，关联后会显示超额完成。' : '。'}
            </span>
          ) : null
        }
        onConfirm={() => confirmUnassignedTo && void linkUnassigned(confirmUnassignedTo)}
        onClose={() => setConfirmUnassignedTo(null)}
      />
    </div>
  )
}

