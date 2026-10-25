import { useMemo, useState } from 'react'
import type { Exam, ExamGoalLink, ExamReviewItem } from '../../domain/types'
import { getMasteryStats, sortWeakItems } from '../../domain/dualTrack'
import { useAppData } from '../../state/AppData'
import { Badge, Button, Card, EmptyState, Field, Input, TextArea } from '../../components/ui'
import { Modal, useToast } from '../../components/feedback'
import { IconPlus, IconX } from '../../components/icons'
import { QuickAssess, AssessmentTimeline, ratingBadgeClass, ratingText } from '../knowledge/QuickAssess'

/**
 * 薄弱项冲刺队列：关联目标的知识点按自评状态排序（待评估单列、等级低优先、久未评估提示），
 * 每项推荐理由可展示；复习卡支持再次自评与加入考前重点清单。
 */
export function ExamWeakTab({ exam, links }: { exam: Exam; links: ExamGoalLink[] }) {
  const { knowledgeItems, assessments, goals, upsertExamReviewItems, examReviewItems, today } = useAppData()
  const toast = useToast()
  const [reviewId, setReviewId] = useState<string | null>(null)

  const goalItems = useMemo(
    () =>
      knowledgeItems.filter(
        (k) => links.some((l) => l.goalId === k.goalId) && !k.isArchived,
      ),
    [knowledgeItems, links],
  )
  const stats = useMemo(() => getMasteryStats(goalItems, assessments), [goalItems, assessments])
  const weak = useMemo(
    () => sortWeakItems(stats.byItem.filter((x) => x.bucket !== 'mastered'), assessments, today),
    [stats.byItem, assessments, today],
  )
  const reviewItem = reviewId ? goalItems.find((k) => k.id === reviewId) ?? null : null

  const addToReviewList = async (itemId: string, title: string, goalId: string) => {
    const now = new Date().toISOString()
    if (examReviewItems.some((r) => r.examId === exam.id && r.knowledgeItemId === itemId)) {
      toast.info('已在考前重点清单中')
      return
    }
    try {
      await upsertExamReviewItems([
        ...examReviewItems,
        {
          id: `eri-${now}-${itemId}`,
          examId: exam.id,
          title,
          knowledgeItemId: itemId,
          goalId,
          priority: 'high',
          doneAt: null,
          note: null,
          sortOrder: examReviewItems.length,
          isDemo: false,
          createdAt: now,
          updatedAt: now,
        },
      ])
      toast.success('已加入考前重点清单（勾选清单不会改变掌握评分）')
    } catch (err) {
      toast.error(err instanceof Error ? `保存失败：${err.message}` : '保存失败，可重试')
    }
  }

  if (goalItems.length === 0) {
    return (
      <EmptyState
        icon={<IconPlus />}
        title="尚未建立知识点"
        description="薄弱项队列来自关联目标的知识点自评。没有知识点也可以正常使用冲刺计划与手动维护的考前重点清单。"
      />
    )
  }

  return (
    <div className="space-y-3">
      <p className="tnum text-xs text-ink3">
        共 {stats.counts.total} 个未归档知识点 · 待巩固 {stats.counts.weak} · 待评估 {stats.counts.unevaluated} · 已掌握 {stats.counts.mastered}（不进队列）
      </p>
      {weak.length === 0 && (
        <Card className="px-4 py-4 text-center text-xs text-ok">没有薄弱项——所有知识点都已自评 3 分及以上。继续保持！</Card>
      )}
      <ul className="space-y-2">
        {weak.map((w) => {
          const goalName = goals.find((g) => g.id === w.item.goalId)?.name ?? ''
          const inList = examReviewItems.some((r) => r.examId === exam.id && r.knowledgeItemId === w.item.id)
          return (
            <li key={w.item.id} className="rounded-xl border border-line/70 px-3.5 py-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className={`rounded-md px-1.5 py-0.5 text-[10px] font-medium ${ratingBadgeClass(w.rating)}`}>{ratingText(w.rating)}</span>
                <button type="button" className="min-w-0 flex-1 truncate text-left text-sm font-medium text-ink" onClick={() => setReviewId(w.item.id)}>
                  {w.item.title}
                </button>
                <span className="text-[11px] text-ink3">{goalName}</span>
                {!inList && (
                  <Button size="sm" variant="ghost" onClick={() => void addToReviewList(w.item.id, w.item.title, w.item.goalId)}>
                    <IconPlus /> 考前清单
                  </Button>
                )}
              </div>
              <p className="mt-1 text-[11px] text-ink3">建议优先复习：{w.reason}</p>
            </li>
          )
        })}
      </ul>
      <p className="text-[11px] leading-relaxed text-ink3">
        排序规则可解释：待评估单列（不视为最差）；待巩固按「自评等级低 → 久未评估」优先；推荐仅基于你录入的自评，不代表客观水平。
      </p>

      <Modal open={!!reviewItem} onClose={() => setReviewId(null)} title={reviewItem?.title ?? ''}>
        {reviewItem && (
          <div className="space-y-4">
            {reviewItem.description && <p className="rounded-xl bg-base px-3.5 py-3 text-xs leading-relaxed text-ink2">{reviewItem.description}</p>}
            <div className="rounded-xl border border-line/70 px-3.5 py-3">
              <p className="mb-2 text-xs font-semibold text-ink2">评估历史</p>
              <AssessmentTimeline itemId={reviewItem.id} assessments={assessments} />
            </div>
            <div className="rounded-xl border border-line/70 px-3.5 py-3">
              <p className="mb-2 text-xs font-semibold text-ink2">复习后再次自评（手动更新掌握轨道）</p>
              <QuickAssess item={reviewItem} onDone={() => toast.success('掌握轨道已更新')} />
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}


/** 考前重点清单：勾选只改 doneAt，不改评分/打卡/专注 */
export function ExamReviewTab({
  exam,
  items,
  goals,
  knowledgeItems,
  upsert,
  remove,
  onNotify,
}: {
  exam: Exam
  items: ExamReviewItem[]
  goals: Array<{ id: string; name: string }>
  knowledgeItems: Array<{ id: string; title: string }>
  upsert: (items: ExamReviewItem[]) => Promise<void>
  remove: (id: string) => Promise<void>
  onNotify: (msg: string, kind: 'success' | 'error' | 'info') => void
}) {
  const [formOpen, setFormOpen] = useState(false)
  const [form, setForm] = useState({ title: '', priority: 'medium' as ExamReviewItem['priority'], note: '', goalId: '', knowledgeItemId: '' })

  const sorted = [...items].sort((a, b) => {
    const done = Number(!!a.doneAt) - Number(!!b.doneAt)
    if (done !== 0) return done
    const pr = { high: 0, medium: 1, low: 2 } as const
    if (pr[a.priority] !== pr[b.priority]) return pr[a.priority] - pr[b.priority]
    return a.sortOrder - b.sortOrder
  })

  const submit = async () => {
    const title = form.title.trim()
    if (!title) {
      onNotify('请填写条目标题', 'error')
      return
    }
    const now = new Date().toISOString()
    try {
      await upsert([
        ...items,
        {
          id: `eri-${now}`,
          examId: exam.id,
          title,
          knowledgeItemId: form.knowledgeItemId || null,
          goalId: form.goalId || null,
          priority: form.priority,
          doneAt: null,
          note: form.note.trim() ? form.note : null,
          sortOrder: items.length,
          isDemo: false,
          createdAt: now,
          updatedAt: now,
        },
      ])
      onNotify('已加入考前重点清单', 'success')
      setFormOpen(false)
      setForm({ title: '', priority: 'medium', note: '', goalId: '', knowledgeItemId: '' })
    } catch (err) {
      onNotify(err instanceof Error ? `保存失败：${err.message}（未保存，可重试）` : '保存失败，可重试', 'error')
    }
  }

  const toggle = async (item: ExamReviewItem) => {
    const now = new Date().toISOString()
    await upsert(items.map((r) => (r.id === item.id ? { ...r, doneAt: r.doneAt ? null : now, updatedAt: now } : r)))
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs text-ink3">勾选只改变清单状态——不会自动提高掌握评分，也不生成打卡。</p>
        <Button size="sm" onClick={() => setFormOpen(true)}>
          <IconPlus /> 添加重点
        </Button>
      </div>
      {sorted.length === 0 ? (
        <EmptyState icon={<IconPlus />} title="清单还是空的" description="把考试前必须再过一遍的内容加进来：可从薄弱项一键加入，也可手动添加。" />
      ) : (
        <ul className="space-y-1.5">
          {sorted.map((r) => {
            const kn = r.knowledgeItemId ? knowledgeItems.find((k) => k.id === r.knowledgeItemId)?.title : null
            const gn = r.goalId ? goals.find((g) => g.id === r.goalId)?.name : null
            return (
              <li key={r.id} className={`flex items-center gap-2 rounded-xl border border-line/70 px-3.5 py-2.5 ${r.doneAt ? 'opacity-55' : ''}`}>
                <input
                  type="checkbox"
                  checked={!!r.doneAt}
                  onChange={() => void toggle(r)}
                  aria-label={`完成 ${r.title}`}
                  className="accent-[rgb(var(--c-ok))]"
                />
                <div className="min-w-0 flex-1">
                  <p className={`truncate text-sm text-ink ${r.doneAt ? 'line-through' : ''}`}>{r.title}</p>
                  {(kn || gn || r.note) && (
                    <p className="truncate text-[11px] text-ink3">
                      {gn && `目标：${gn}`}
                      {kn && ` · 知识点：${kn}`}
                      {r.note && ` · ${r.note}`}
                    </p>
                  )}
                </div>
                <Badge tone={r.priority === 'high' ? 'danger' : r.priority === 'medium' ? 'warn' : 'neutral'}>
                  {r.priority === 'high' ? '高' : r.priority === 'medium' ? '中' : '低'}
                </Badge>
                <button
                  type="button"
                  aria-label={`删除 ${r.title}`}
                  className="rounded-lg p-1 text-ink3 hover:text-danger"
                  onClick={() => void remove(r.id).then(() => onNotify('已删除', 'success'))}
                >
                  <IconX />
                </button>
              </li>
            )
          })}
        </ul>
      )}

      <Modal
        open={formOpen}
        onClose={() => setFormOpen(false)}
        title="添加考前重点"
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setFormOpen(false)}>
              取消
            </Button>
            <Button onClick={() => void submit()}>添加</Button>
          </div>
        }
      >
        <div className="space-y-3.5">
          <Field label="标题" htmlFor="eri-title">
            <Input id="eri-title" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} maxLength={80} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="优先级" htmlFor="eri-priority">
              <select id="eri-priority" value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value as ExamReviewItem['priority'] })} className="h-10 w-full rounded-xl border border-line bg-surface px-3 text-sm text-ink">
                <option value="high">高</option>
                <option value="medium">中</option>
                <option value="low">低</option>
              </select>
            </Field>
            <Field label="关联目标（可选）" htmlFor="eri-goal">
              <select id="eri-goal" value={form.goalId} onChange={(e) => setForm({ ...form, goalId: e.target.value })} className="h-10 w-full rounded-xl border border-line bg-surface px-3 text-sm text-ink">
                <option value="">不关联</option>
                {goals.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <Field label="关联知识点（可选）" htmlFor="eri-kn">
            <select id="eri-kn" value={form.knowledgeItemId} onChange={(e) => setForm({ ...form, knowledgeItemId: e.target.value })} className="h-10 w-full rounded-xl border border-line bg-surface px-3 text-sm text-ink">
              <option value="">不关联</option>
              {knowledgeItems.map((k) => (
                <option key={k.id} value={k.id}>
                  {k.title}
                </option>
              ))}
            </select>
          </Field>
          <Field label="复习说明（可选）" htmlFor="eri-note">
            <TextArea id="eri-note" rows={2} value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} maxLength={200} />
          </Field>
        </div>
      </Modal>
    </div>
  )
}
