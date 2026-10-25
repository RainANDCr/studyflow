import { useMemo, useState } from 'react'
import type { DateStr, Exam, ExamGoalLink, ExamPhase } from '../../domain/types'
import { examCountdown, draftExamPhases, checkPhaseConflict } from '../../domain/exam'
import { getEffectiveStudyMinutes } from '../../domain/focus'
import { formatMD } from '../../domain/dates'
import { useAppData } from '../../state/AppData'
import { examInputSchema } from '../../domain/validation'
import { Badge, Button, Card, EmptyState, Field, Input, TextArea } from '../../components/ui'
import { ConfirmDialog, Modal, useToast } from '../../components/feedback'
import { IconCalendar, IconChevronLeft, IconPlus, IconTarget, IconTrash, IconX } from '../../components/icons'
import { ExamScheduleTab } from './ExamScheduleTab'
import { ExamWeakTab, ExamReviewTab } from './ExamWeakTab'

function fmtMinutes(n: number): string {
  return `${n} 分钟`
}

interface FormState {
  title: string
  examDate: string
  examTime: string
  startDate: string
  notes: string
}

const emptyForm: FormState = { title: '', examDate: '', examTime: '', startDate: '', notes: '' }

/** 考试冲刺二级视图（今日页进入；不占底部主 Tab）。 */
export function ExamView({ onBack }: { onBack: () => void }) {
  const { exams, examGoalLinks, goals, checkins, focusSessions, examPhases, examPlanSlots, today, upsertExams, deleteExamById, upsertExamGoalLinks, deleteExamGoalLinkById, upsertExamPhases, deleteExamPhaseById, upsertExamDayAvailabilities, upsertGlobalAvailability, globalAvailabilities, upsertExamPlanSlots, deleteExamPlanSlotById, examReviewItems, upsertExamReviewItems, deleteExamReviewItemById, examDayAvailabilities, knowledgeItems } = useAppData()
  const toast = useToast()
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<Exam | null>(null)
  const [form, setForm] = useState<FormState>(emptyForm)
  const [formError, setFormError] = useState('')
  const [deleteExam, setDeleteExam] = useState<Exam | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [tab, setTab] = useState<'overview' | 'phases' | 'schedule' | 'weak' | 'review'>('overview')
  const [goalLinkOpen, setGoalLinkOpen] = useState(false)
  const [linkGoalId, setLinkGoalId] = useState('')
  const [linkWeight, setLinkWeight] = useState('2')
  const [unlinkTarget, setUnlinkTarget] = useState<ExamGoalLink | null>(null)
  const [phaseForm, setPhaseForm] = useState<{ open: boolean; editing: ExamPhase | null; title: string; startDate: string; endDate: string; focusNote: string; error: string | null }>({ open: false, editing: null, title: '', startDate: '', endDate: '', focusNote: '', error: null })
  const [confirmDraft, setConfirmDraft] = useState<Array<{ title: string; startDate: DateStr; endDate: DateStr }> | null>(null)

  const sortedExams = useMemo(
    () => [...exams].sort((a, b) => (a.status === 'archived' ? 1 : 0) - (b.status === 'archived' ? 1 : 0) || a.examDate.localeCompare(b.examDate)),
    [exams],
  )
  const selected = selectedId ? exams.find((e) => e.id === selectedId) ?? null : null
  const selectedLinks = useMemo(() => examGoalLinks.filter((l) => l.examId === selected?.id), [examGoalLinks, selected?.id])
  const selectedPhases = useMemo(() => examPhases.filter((p) => p.examId === selected?.id).sort((a, b) => a.startDate.localeCompare(b.startDate)), [examPhases, selected?.id])

  const openCreate = () => {
    setEditing(null)
    setForm(emptyForm)
    setFormError('')
    setFormOpen(true)
  }

  const openEdit = (e: Exam) => {
    setEditing(e)
    setForm({ title: e.title, examDate: e.examDate, examTime: e.examTime ?? '', startDate: e.startDate ?? '', notes: e.notes ?? '' })
    setFormError('')
    setFormOpen(true)
  }

  const submitExam = async () => {
    const parsed = examInputSchema.safeParse({
      title: form.title,
      examDate: form.examDate,
      examTime: form.examTime || null,
      startDate: form.startDate || null,
      notes: form.notes || null,
    })
    if (!parsed.success) {
      setFormError(parsed.error.issues[0]?.message ?? '表单校验未通过')
      return
    }
    const now = new Date().toISOString()
    try {
      await upsertExams([
        {
          id: editing?.id ?? `exam-${now}`,
          title: parsed.data.title,
          examDate: parsed.data.examDate,
          examTime: parsed.data.examTime,
          startDate: parsed.data.startDate,
          status: editing?.status ?? 'active',
          notes: parsed.data.notes,
          isDemo: false,
          createdAt: editing?.createdAt ?? now,
          updatedAt: now,
        },
      ])
      toast.success(editing ? '考试已更新' : '考试已创建。下一步：关联学习目标并设置可用时间。')
      setFormOpen(false)
      if (!editing?.id && parsed.data) setSelectedId(`exam-${now}`)
    } catch (err) {
      setFormError(err instanceof Error ? `保存失败：${err.message}（数据未保存，可重试）` : '保存失败，可重试')
    }
  }

  const doDeleteExam = async () => {
    if (!deleteExam) return
    setDeleting(true)
    try {
      await deleteExamById(deleteExam.id)
      toast.success('考试及其阶段/排程/清单已删除；学习目标、打卡、里程碑、专注与评估全部保留')
      setDeleteExam(null)
      if (selectedId === deleteExam.id) setSelectedId(null)
    } catch (err) {
      toast.error(err instanceof Error ? `删除失败：${err.message}` : '删除失败，可重试')
    } finally {
      setDeleting(false)
    }
  }

  const submitLink = async () => {
    if (!selected) return
    const goal = goals.find((g) => g.id === linkGoalId)
    if (!goal) {
      toast.error('请选择要关联的学习目标')
      return
    }
    const weight = Number(linkWeight)
    if (!Number.isFinite(weight) || weight <= 0) {
      toast.error('优先权重需为正数（例如 1/2/3）')
      return
    }
    if (selectedLinks.some((l) => l.goalId === linkGoalId)) {
      toast.info('该目标已关联本场考试')
      return
    }
    const now = new Date().toISOString()
    await upsertExamGoalLinks([
      ...selectedLinks,
      { id: `egl-${now}`, examId: selected.id, goalId: linkGoalId, priorityWeight: weight, isDemo: false, createdAt: now },
    ])
    toast.success(`已关联「${goal.name}」（权重 ${weight}，不复制目标与打卡）`)
    setGoalLinkOpen(false)
    setLinkGoalId('')
  }

  /* ---- 阶段 ---- */
  const submitPhase = async () => {
    if (!selected) return
    const title = phaseForm.title.trim()
    if (!title || !phaseForm.startDate || !phaseForm.endDate) {
      setPhaseForm((f) => ({ ...f, error: '请填写阶段名称与起止日期' }))
      return
    }
    if (phaseForm.startDate > phaseForm.endDate) {
      setPhaseForm((f) => ({ ...f, error: '开始日不能晚于结束日' }))
      return
    }
    const conflict = checkPhaseConflict(selectedPhases, { id: phaseForm.editing?.id, startDate: phaseForm.startDate, endDate: phaseForm.endDate }, selected.examDate)
    if (conflict) {
      setPhaseForm((f) => ({ ...f, error: conflict }))
      return
    }
    const now = new Date().toISOString()
    const record: ExamPhase = {
      id: phaseForm.editing?.id ?? `eph-${now}`,
      examId: selected.id,
      title,
      startDate: phaseForm.startDate,
      endDate: phaseForm.endDate,
      sortOrder: phaseForm.editing?.sortOrder ?? selectedPhases.length,
      focusNote: phaseForm.focusNote.trim() ? phaseForm.focusNote : null,
      isDemo: false,
      createdAt: phaseForm.editing?.createdAt ?? now,
      updatedAt: now,
    }
    try {
      await upsertExamPhases(phaseForm.editing ? [record] : [...selectedPhases, record])
      toast.success(phaseForm.editing ? '阶段已更新' : '阶段已创建')
      setPhaseForm((f) => ({ ...f, open: false, error: null }))
    } catch (err) {
      setPhaseForm((f) => ({ ...f, error: err instanceof Error ? `保存失败：${err.message}` : '保存失败，可重试' }))
    }
  }

  const generateDraft = () => {
    if (!selected) return
    const start = selected.startDate && selected.startDate > today ? selected.startDate : today
    if (start > selected.examDate) {
      toast.error('备考开始日已晚于考试日，请先编辑考试日期')
      return
    }
    const draft = draftExamPhases(start, selected.examDate)
    if (draft.length === 0) {
      toast.error('无法生成阶段：考试日期早于备考开始日')
      return
    }
    setConfirmDraft(draft)
  }

  const applyDraft = async () => {
    if (!selected || !confirmDraft) return
    const now = new Date().toISOString()
    const records: ExamPhase[] = confirmDraft.map((d, i) => ({
      id: `eph-${now}-${i}`,
      examId: selected.id,
      title: d.title,
      startDate: d.startDate,
      endDate: d.endDate,
      sortOrder: selectedPhases.length + i,
      focusNote: null,
      isDemo: false,
      createdAt: now,
      updatedAt: now,
    }))
    try {
      await upsertExamPhases([...selectedPhases, ...records])
      toast.success(`已创建 ${records.length} 个备考阶段`)
      setConfirmDraft(null)
    } catch (err) {
      toast.error(err instanceof Error ? `保存失败：${err.message}` : '保存失败，可重试')
    }
  }

  /* ---- 总览数据 ---- */
  const todayPlanMinutes = selected ? examPlanSlots.filter((s) => s.examId === selected.id && s.date === today).reduce((s, x) => s + x.plannedMinutes, 0) : 0
  const todayActualMinutes = selected
    ? getEffectiveStudyMinutes(
        checkins.filter((c) => c.date === today && selectedLinks.some((l) => l.goalId === c.goalId)),
        focusSessions.filter((s) => s.startedAt.startsWith(today)),
      )
    : 0

  if (!selected) {
    return (
      <div className="space-y-4">
        <header className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={onBack} aria-label="返回今日列表">
            <IconChevronLeft /> 返回
          </Button>
          <h1 className="text-lg font-bold text-ink">考试冲刺</h1>
          <Button size="sm" className="ml-auto" onClick={openCreate}>
            <IconPlus /> 新建考试
          </Button>
        </header>
        {sortedExams.length === 0 ? (
          <EmptyState
            icon={<IconTarget />}
            title="还没有考试档案"
            description="创建考试（如期末考、六级），关联已有学习目标，规划可用时间与冲刺阶段。倒计时与原目标进度互不干扰。"
            action={
              <Button onClick={openCreate}>
                <IconPlus /> 新建考试
              </Button>
            }
          />
        ) : (
          <div className="space-y-3">
            {sortedExams.map((e) => {
              const cd = examCountdown(e.examDate, today)
              const links = examGoalLinks.filter((l) => l.examId === e.id).length
              const phases = examPhases.filter((p) => p.examId === e.id)
              const currentPhase = phases.find((p) => today >= p.startDate && today <= p.endDate)
              return (
                <Card key={e.id} className="px-4 py-3.5">
                  <button type="button" className="w-full text-left" onClick={() => setSelectedId(e.id)}>
                    <div className="flex items-center gap-2">
                      <h3 className="flex-1 truncate text-sm font-semibold text-ink">{e.title}</h3>
                      {e.status !== 'active' && <Badge tone="neutral">{e.status === 'completed' ? '已完成' : '已归档'}</Badge>}
                      <span className={`tnum rounded-lg px-2 py-1 text-xs font-bold ${cd.status === 'past' ? 'bg-surface2 text-ink3' : cd.status === 'today' ? 'bg-dangerSoft text-danger' : 'bg-primarySoft text-primary'}`}>
                        {cd.text}
                      </span>
                    </div>
                    <p className="tnum mt-1 text-[11px] text-ink3">
                      {formatMD(e.examDate)}
                      {e.examTime ? ` ${e.examTime}` : ''} · 关联 {links} 个目标{currentPhase ? ` · 当前阶段：${currentPhase.title}` : phases.length > 0 ? ` · ${phases.length} 个阶段` : ' · 未设置阶段'}
                    </p>
                  </button>
                </Card>
              )
            })}
          </div>
        )}
        <ExamFormModal open={formOpen} onClose={() => setFormOpen(false)} title="新建考试" form={form} setForm={setForm} error={formError} submit={submitExam} />
        <ConfirmDialog open={!!deleteExam} title="删除考试" danger confirmText="删除考试" busy={deleting} message={<span>将删除「{deleteExam?.title}」及其阶段、可用时间、排程与考前清单。<b>学习目标、打卡、里程碑、专注记录与知识点评估全部保留</b>。</span>} onConfirm={() => void doDeleteExam()} onClose={() => setDeleteExam(null)} />
      </div>
    )
  }

  const cd = examCountdown(selected.examDate, today)
  const tabs: Array<{ key: typeof tab; label: string }> = [
    { key: 'overview', label: '总览' },
    { key: 'phases', label: `阶段${selectedPhases.length ? `（${selectedPhases.length}）` : ''}` },
    { key: 'schedule', label: '时间与排程' },
    { key: 'weak', label: '薄弱项' },
    { key: 'review', label: `考前清单${examReviewItems.filter((r) => r.examId === selected.id).length ? `（${examReviewItems.filter((r) => r.examId === selected.id).length}）` : ''}` },
  ]

  return (
    <div className="space-y-4">
      <header className="flex items-center gap-2">
        <Button variant="ghost" size="sm" onClick={() => setSelectedId(null)} aria-label="返回考试列表">
          <IconChevronLeft /> 全部考试
        </Button>
        <h1 className="min-w-0 flex-1 truncate text-lg font-bold text-ink">{selected.title}</h1>
        <span className={`tnum shrink-0 rounded-lg px-2.5 py-1.5 text-sm font-bold ${cd.status === 'past' ? 'bg-surface2 text-ink3' : cd.status === 'today' ? 'bg-dangerSoft text-danger' : 'gradient-primary text-white'}`}>
          {cd.text}
        </span>
      </header>

      <div className="flex gap-1 overflow-x-auto pb-1" role="tablist" aria-label="考试功能分区">
        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={tab === t.key}
            onClick={() => setTab(t.key)}
            className={`shrink-0 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${tab === t.key ? 'gradient-primary text-white' : 'border border-line text-ink3'}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'overview' && (
        <div className="space-y-4">
          <Card className="px-4 py-4">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-ink">关联学习目标（{selectedLinks.length}）</h2>
              <Button size="sm" variant="secondary" onClick={() => setGoalLinkOpen(true)}>
                <IconPlus /> 关联目标
              </Button>
            </div>
            {selectedLinks.length === 0 ? (
              <p className="mt-2 rounded-xl bg-base px-3 py-2.5 text-xs text-ink3">
                还未关联目标。选择已有目标（或先去「今日」创建），关联只是建立优先关系，<b>不复制目标、不改变截止日与打卡</b>。
              </p>
            ) : (
              <ul className="mt-2 divide-y divide-line/60">
                {selectedLinks.map((l) => {
                  const g = goals.find((x) => x.id === l.goalId)
                  return (
                    <li key={l.id} className="flex items-center gap-2 py-2 text-xs">
                      <IconTarget className="text-ink3" />
                      <span className="min-w-0 flex-1 truncate font-medium text-ink">{g?.name ?? '目标已删除'}</span>
                      <span className="tnum text-ink3">权重 {l.priorityWeight}</span>
                      <button type="button" aria-label={`取消关联 ${g?.name ?? ''}`} className="rounded-lg p-1 text-ink3 hover:text-danger" onClick={() => setUnlinkTarget(l)}>
                        <IconX />
                      </button>
                    </li>
                  )
                })}
              </ul>
            )}
          </Card>

          <div className="grid grid-cols-3 gap-3">
            <Card className="px-3 py-3 text-center">
              <p className="text-[11px] text-ink3">今日计划（预算）</p>
              <p className="tnum mt-1 text-lg font-bold text-primary">{fmtMinutes(todayPlanMinutes)}</p>
            </Card>
            <Card className="px-3 py-3 text-center">
              <p className="text-[11px] text-ink3">今日实际投入</p>
              <p className="tnum mt-1 text-lg font-bold text-ok">{todayActualMinutes > 0 ? fmtMinutes(todayActualMinutes) : '未记录时长'}</p>
            </Card>
            <Card className="px-3 py-3 text-center">
              <p className="text-[11px] text-ink3">考试日期</p>
              <p className="tnum mt-1 text-lg font-bold text-ink">{formatMD(selected.examDate)}</p>
            </Card>
          </div>
          <p className="text-[11px] leading-relaxed text-ink3">
            「计划分钟」是时间预算（ExamPlanSlot），与目标的完成量（单词/页）分属两层，不相加；实际投入使用统一去重口径（填写的打卡分钟 + 未关联打卡的专注会话）。
            {cd.status === 'past' && ' 考试已结束：停止生成新计划，历史全部保留。'}
          </p>

          {selected.notes && <Card className="px-4 py-3 text-xs leading-relaxed text-ink2">{selected.notes}</Card>}

          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="secondary" onClick={() => openEdit(selected)}>
              编辑考试信息
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() =>
                void upsertExams([{ ...selected, status: selected.status === 'archived' ? 'active' : 'archived', updatedAt: new Date().toISOString() }]).then(() =>
                  toast.success(selected.status === 'archived' ? '已重新启用' : '已归档（保留全部历史）'),
                )
              }
            >
              {selected.status === 'archived' ? '重新启用' : '归档'}
            </Button>
            <Button size="sm" variant="ghost" className="text-danger" onClick={() => setDeleteExam(selected)}>
              <IconTrash /> 删除考试
            </Button>
          </div>
        </div>
      )}

      {tab === 'phases' && (
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs text-ink3">阶段按时间排列、互不重叠、不越过考试日。</p>
            <div className="flex gap-2">
              <Button size="sm" variant="secondary" onClick={generateDraft}>
                <IconCalendar /> 生成建议草案
              </Button>
              <Button size="sm" onClick={() => setPhaseForm({ open: true, editing: null, title: '', startDate: today, endDate: selected.examDate, focusNote: '', error: null })}>
                <IconPlus /> 手动添加
              </Button>
            </div>
          </div>
          {selectedPhases.length === 0 ? (
            <EmptyState icon={<IconCalendar />} title="还没有备考阶段" description="可一键按备考天数生成「基础/强化/冲刺/回顾」草案（短周期自动简化），再手动微调。" />
          ) : (
            <ol className="space-y-2">
              {selectedPhases.map((p, i) => {
                const isCurrent = today >= p.startDate && today <= p.endDate
                const isPast = today > p.endDate
                return (
                  <li key={p.id} className={`rounded-xl border px-3.5 py-3 ${isCurrent ? 'border-primary/40 bg-primarySoft/30' : 'border-line/70'}`}>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="tnum flex h-6 w-6 items-center justify-center rounded-full bg-surface2 text-[11px] font-bold text-ink2">{i + 1}</span>
                      <p className="flex-1 truncate text-sm font-medium text-ink">{p.title}</p>
                      {isCurrent && <Badge tone="primary">进行中</Badge>}
                      {isPast && <Badge tone="neutral">已结束</Badge>}
                    </div>
                    <p className="tnum mt-1 text-[11px] text-ink3">
                      {formatMD(p.startDate)} - {formatMD(p.endDate)}（{fmtMinutes2Days(p.startDate, p.endDate)}）
                      {p.focusNote ? ` · ${p.focusNote}` : ''}
                    </p>
                    <p className="text-[11px] text-ink3">时间进度：{phaseTimeProgress(p.startDate, p.endDate, today)}%</p>
                    <div className="mt-1.5 flex gap-1.5">
                      <Button size="sm" variant="ghost" onClick={() => setPhaseForm({ open: true, editing: p, title: p.title, startDate: p.startDate, endDate: p.endDate, focusNote: p.focusNote ?? '', error: null })}>
                        编辑
                      </Button>
                      <Button size="sm" variant="ghost" className="text-danger" onClick={() => void deleteExamPhaseById(p.id).then(() => toast.success('阶段已删除'))}>
                        删除
                      </Button>
                    </div>
                  </li>
                )
              })}
            </ol>
          )}
        </div>
      )}

      {tab === 'schedule' && (
        <ExamScheduleTab
          exam={selected}
          links={selectedLinks}
          goals={goals}
          availabilities={examDayAvailabilities}
          globalAvailabilities={globalAvailabilities}
          slots={examPlanSlots}
          today={today}
          upsertExamDayAvailabilities={upsertExamDayAvailabilities}
          deleteExamDayAvailabilityById={undefined}
          upsertGlobalAvailability={upsertGlobalAvailability}
          upsertExamPlanSlots={upsertExamPlanSlots}
          deleteExamPlanSlotById={deleteExamPlanSlotById}
          onNotify={(msg, kind) => (kind === 'error' ? toast.error(msg) : kind === 'info' ? toast.info(msg) : toast.success(msg))}
        />
      )}

      {tab === 'weak' && <ExamWeakTab exam={selected} links={selectedLinks} />}

      {tab === 'review' && (
        <ExamReviewTab
          exam={selected}
          items={examReviewItems.filter((r) => r.examId === selected.id)}
          goals={goals}
          knowledgeItems={knowledgeItems}
          upsert={upsertExamReviewItems}
          remove={deleteExamReviewItemById}
          onNotify={(msg, kind) => (kind === 'error' ? toast.error(msg) : kind === 'info' ? toast.info(msg) : toast.success(msg))}
        />
      )}

      <ExamFormModal open={formOpen} onClose={() => setFormOpen(false)} title={editing ? '编辑考试' : '新建考试'} form={form} setForm={setForm} error={formError} submit={submitExam} />
      <ConfirmDialog
        open={!!unlinkTarget}
        title="取消关联目标"
        message={<span>将解除「{goals.find((g) => g.id === unlinkTarget?.goalId)?.name}」与本场考试的关联。目标本身、打卡与已生成的排程条目保留。</span>}
        confirmText="取消关联"
        onConfirm={() => unlinkTarget && void deleteExamGoalLinkById(unlinkTarget.id).then(() => { toast.success('已取消关联'); setUnlinkTarget(null) })}
        onClose={() => setUnlinkTarget(null)}
      />
      <ConfirmDialog open={!!deleteExam} title="删除考试" danger confirmText="删除考试" busy={deleting} message={<span>将删除「{deleteExam?.title}」及其阶段、可用时间、排程与考前清单。<b>学习目标、打卡、里程碑、专注记录与知识点评估全部保留</b>。</span>} onConfirm={() => void doDeleteExam()} onClose={() => setDeleteExam(null)} />

      {/* 阶段表单 */}
      <Modal
        open={phaseForm.open}
        onClose={() => setPhaseForm((f) => ({ ...f, open: false, error: null }))}
        title={phaseForm.editing ? '编辑阶段' : '添加阶段'}
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setPhaseForm((f) => ({ ...f, open: false, error: null }))}>
              取消
            </Button>
            <Button onClick={() => void submitPhase()}>保存</Button>
          </div>
        }
      >
        <div className="space-y-3.5">
          <Field label="阶段名称" htmlFor="eph-title">
            <Input id="eph-title" value={phaseForm.title} onChange={(e) => setPhaseForm((f) => ({ ...f, title: e.target.value }))} placeholder="如：基础巩固（可用任意名称）" maxLength={40} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="开始日" htmlFor="eph-start">
              <Input id="eph-start" type="date" value={phaseForm.startDate} onChange={(e) => setPhaseForm((f) => ({ ...f, startDate: e.target.value }))} />
            </Field>
            <Field label="结束日（含）" htmlFor="eph-end">
              <Input id="eph-end" type="date" value={phaseForm.endDate} onChange={(e) => setPhaseForm((f) => ({ ...f, endDate: e.target.value }))} />
            </Field>
          </div>
          <Field label="关键重点（可选）" htmlFor="eph-note">
            <TextArea id="eph-note" rows={2} value={phaseForm.focusNote} onChange={(e) => setPhaseForm((f) => ({ ...f, focusNote: e.target.value }))} maxLength={200} />
          </Field>
          {phaseForm.error && (
            <p role="alert" className="rounded-xl bg-dangerSoft px-3 py-2.5 text-xs text-danger">
              {phaseForm.error}（不会静默覆盖已有阶段）
            </p>
          )}
        </div>
      </Modal>

      <ConfirmDialog
        open={!!confirmDraft}
        title="确认写入阶段草案"
        confirmText="写入这些阶段"
        message={
          <div className="space-y-2">
            <p>将按备考天数生成以下阶段（日期互不重叠、不超过考试日）：</p>
            <ul className="tnum space-y-1 text-xs">
              {confirmDraft?.map((d) => (
                <li key={d.title}>
                  {d.title}：{formatMD(d.startDate)} - {formatMD(d.endDate)}
                </li>
              ))}
            </ul>
          </div>
        }
        onConfirm={() => void applyDraft()}
        onClose={() => setConfirmDraft(null)}
      />

      {/* 关联目标 */}
      <Modal
        open={goalLinkOpen}
        onClose={() => setGoalLinkOpen(false)}
        title="关联学习目标"
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setGoalLinkOpen(false)}>
              取消
            </Button>
            <Button onClick={() => void submitLink()}>关联</Button>
          </div>
        }
      >
        <div className="space-y-3.5">
          {goals.length === 0 ? (
            <p className="text-xs text-ink3">还没有学习目标。请先去「今日」创建目标，再回到这里关联。</p>
          ) : (
            <>
              <Field label="选择目标" htmlFor="link-goal">
                <select id="link-goal" value={linkGoalId} onChange={(e) => setLinkGoalId(e.target.value)} className="h-10 w-full rounded-xl border border-line bg-surface px-3 text-sm text-ink">
                  <option value="">请选择</option>
                  {goals
                    .filter((g) => !selectedLinks.some((l) => l.goalId === g.id))
                    .map((g) => (
                      <option key={g.id} value={g.id}>
                        {g.name}
                      </option>
                    ))}
                </select>
              </Field>
              <Field label="优先权重（正数，用于建议份额）" htmlFor="link-weight">
                <Input id="link-weight" type="number" min={0.1} step="any" value={linkWeight} onChange={(e) => setLinkWeight(e.target.value)} />
              </Field>
            </>
          )}
        </div>
      </Modal>
    </div>
  )
}

function ExamFormModal({
  open,
  onClose,
  title,
  form,
  setForm,
  error,
  submit,
}: {
  open: boolean
  onClose: () => void
  title: string
  form: FormState
  setForm: (f: FormState) => void
  error: string
  submit: () => Promise<void>
}) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            取消
          </Button>
          <Button onClick={() => void submit()}>保存</Button>
        </div>
      }
    >
      <form
        className="space-y-3.5"
        onSubmit={(e) => {
          e.preventDefault()
          void submit()
        }}
      >
        <Field label="考试名称" htmlFor="exam-title">
          <Input id="exam-title" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="如：数据结构期末考试" maxLength={60} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="考试日期" htmlFor="exam-date">
            <Input id="exam-date" type="date" value={form.examDate} onChange={(e) => setForm({ ...form, examDate: e.target.value })} />
          </Field>
          <Field label="具体时间（可选）" htmlFor="exam-time">
            <Input id="exam-time" type="time" value={form.examTime} onChange={(e) => setForm({ ...form, examTime: e.target.value })} />
          </Field>
        </div>
        <Field label="备考开始日（可选）" htmlFor="exam-start" hint="默认从今天开始规划">
          <Input id="exam-start" type="date" value={form.startDate} onChange={(e) => setForm({ ...form, startDate: e.target.value })} />
        </Field>
        <Field label="备注（可选）" htmlFor="exam-notes">
          <TextArea id="exam-notes" rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} maxLength={300} />
        </Field>
        {error && (
          <p role="alert" className="rounded-xl bg-dangerSoft px-3 py-2.5 text-xs text-danger">
            {error}
          </p>
        )}
        <button type="submit" className="hidden" aria-hidden="true" />
      </form>
    </Modal>
  )
}

function fmtMinutes2Days(from: DateStr, to: DateStr): string {
  const [fy, fm, fd] = from.split('-').map(Number)
  const [ty, tm, td] = to.split('-').map(Number)
  const days = Math.round((new Date(ty, tm - 1, td).getTime() - new Date(fy, fm - 1, fd).getTime()) / 86_400_000) + 1
  return `${days} 天`
}

function phaseTimeProgress(from: DateStr, to: DateStr, today: DateStr): number {
  const [fy, fm, fd] = from.split('-').map(Number)
  const [ty, tm, td] = to.split('-').map(Number)
  const [ny, nm, nd] = today.split('-').map(Number)
  const total = Math.round((new Date(ty, tm - 1, td).getTime() - new Date(fy, fm - 1, fd).getTime()) / 86_400_000) + 1
  const elapsed = Math.min(total, Math.max(0, Math.round((new Date(ny, nm - 1, nd).getTime() - new Date(fy, fm - 1, fd).getTime()) / 86_400_000) + 1))
  return Math.round((elapsed / Math.max(1, total)) * 100)
}

