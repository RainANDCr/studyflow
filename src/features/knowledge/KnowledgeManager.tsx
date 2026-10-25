import { useMemo, useState } from 'react'
import type { Goal, KnowledgeItem, MasteryRating, Milestone } from '../../domain/types'
import { getMasteryStats, getItemCurrentRating } from '../../domain/dualTrack'
import { useAppData } from '../../state/AppData'
import { Badge, Button, Field, Input, TextArea } from '../../components/ui'
import { ConfirmDialog, Modal, useToast } from '../../components/feedback'
import { IconCheck, IconPlus, IconX } from '../../components/icons'
import { KnowledgeDetailBody, ratingBadgeClass, ratingText } from './QuickAssess'

type FilterKey = 'all' | 'weak' | 'unevaluated' | 'mastered' | 'archived'

const FILTERS: Array<{ key: FilterKey; label: string }> = [
  { key: 'all', label: '全部' },
  { key: 'weak', label: '待巩固' },
  { key: 'unevaluated', label: '待评估' },
  { key: 'mastered', label: '已掌握' },
  { key: 'archived', label: '已归档' },
]

function bucketOfRating(r: MasteryRating | null): Exclude<FilterKey, 'all' | 'archived'> {
  if (r === null) return 'unevaluated'
  return r >= 3 ? 'mastered' : 'weak'
}

/**
 * 知识点管理器（目标详情二级弹窗）：
 * 列表/搜索/筛选/批量粘贴添加/编辑/归档/删除二次确认；点击知识点查看详情与再次自评。
 */
export function KnowledgeManager({
  open,
  onClose,
  goal,
  initialFilter = 'all',
}: {
  open: boolean
  onClose: () => void
  goal: Goal
  initialFilter?: FilterKey
}) {
  const { knowledgeItems, assessments, milestones, upsertKnowledgeItems, deleteKnowledgeItemById } = useAppData()
  const toast = useToast()
  const [filter, setFilter] = useState<FilterKey>(initialFilter)
  const [search, setSearch] = useState('')
  const [groupByMilestone, setGroupByMilestone] = useState(false)
  const [detailId, setDetailId] = useState<string | null>(null)
  const [editing, setEditing] = useState<KnowledgeItem | null>(null)
  const [formOpen, setFormOpen] = useState(false)
  const [batchOpen, setBatchOpen] = useState(false)
  const [batchText, setBatchText] = useState('')
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [form, setForm] = useState({ title: '', description: '', weight: '1', milestoneId: '' })

  const goalMilestones: Milestone[] = milestones.filter((m) => m.goalId === goal.id).sort((a, b) => a.sortOrder - b.sortOrder)
  const all = useMemo(() => knowledgeItems.filter((k) => k.goalId === goal.id).sort((a, b) => a.sortOrder - b.sortOrder), [knowledgeItems, goal.id])
  const stats = useMemo(() => getMasteryStats(all, assessments), [all, assessments])

  const filtered = useMemo(() => {
    let list = all
    if (filter === 'archived') list = list.filter((k) => k.isArchived)
    else {
      list = list.filter((k) => !k.isArchived)
      if (filter !== 'all') {
        list = list.filter((k) => {
          const r = getItemCurrentRating(k.id, assessments)
          return bucketOfRating(r) === filter
        })
      }
    }
    if (search.trim()) {
      const q = search.trim().toLowerCase()
      list = list.filter((k) => k.title.toLowerCase().includes(q) || (k.description ?? '').toLowerCase().includes(q))
    }
    return list
  }, [all, filter, search, assessments])

  const openCreate = () => {
    setEditing(null)
    setForm({ title: '', description: '', weight: '1', milestoneId: '' })
    setFormOpen(true)
  }

  const openEdit = (k: KnowledgeItem) => {
    setEditing(k)
    setForm({ title: k.title, description: k.description ?? '', weight: String(k.weight), milestoneId: k.milestoneId ?? '' })
    setFormOpen(true)
  }

  const submitForm = async () => {
    const title = form.title.trim()
    if (!title) {
      toast.error('请填写知识点标题')
      return
    }
    const weight = Number(form.weight)
    if (!Number.isFinite(weight) || weight <= 0) {
      toast.error('权重需为正数（仅用于掌握覆盖率，与单词数/页数无关）')
      return
    }
    const now = new Date().toISOString()
    const record: KnowledgeItem = {
      id: editing?.id ?? `ki-${goal.id}-${now}`,
      goalId: goal.id,
      milestoneId: form.milestoneId || null,
      title,
      description: form.description.trim() ? form.description : null,
      weight,
      sortOrder: editing?.sortOrder ?? all.filter((k) => !k.isArchived).length,
      isArchived: editing?.isArchived ?? false,
      isDemo: goal.isDemo,
      createdAt: editing?.createdAt ?? now,
      updatedAt: now,
    }
    try {
      await upsertKnowledgeItems(editing ? [record] : [...all, record])
      toast.success(editing ? '知识点已更新' : '知识点已添加')
      setFormOpen(false)
    } catch (err) {
      toast.error(err instanceof Error ? `保存失败：${err.message}（数据未保存，可重试）` : '保存失败，可重试')
    }
  }

  const submitBatch = async () => {
    const lines = batchText
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
    const seen = new Set(all.map((k) => k.title))
    const previews: Array<{ title: string; duplicate: boolean }> = lines.map((l) => ({ title: l, duplicate: seen.has(l) || lines.indexOf(l) !== lines.lastIndexOf(l) }))
    const toAdd = lines.filter((l, i) => !seen.has(l) && lines.indexOf(l) === i)
    if (toAdd.length === 0) {
      toast.info('没有可添加的新知识点（重复项已跳过）')
      return
    }
    const now = new Date().toISOString()
    const records: KnowledgeItem[] = toAdd.map((title, i) => ({
      id: `ki-${goal.id}-${now}-${i}`,
      goalId: goal.id,
      milestoneId: null,
      title,
      description: null,
      weight: 1,
      sortOrder: all.length + i,
      isArchived: false,
      isDemo: goal.isDemo,
      createdAt: now,
      updatedAt: now,
    }))
    try {
      await upsertKnowledgeItems([...all, ...records])
      toast.success(`已添加 ${records.length} 个知识点${previews.some((p) => p.duplicate) ? '，重复行已跳过' : ''}`)
      setBatchOpen(false)
      setBatchText('')
    } catch (err) {
      toast.error(err instanceof Error ? `保存失败：${err.message}（数据未保存，可重试）` : '保存失败，可重试')
    }
  }

  const move = async (k: KnowledgeItem, dir: -1 | 1) => {
    const siblings = all.filter((x) => !x.isArchived && x.milestoneId === k.milestoneId)
    const idx = siblings.findIndex((x) => x.id === k.id)
    const other = siblings[idx + dir]
    if (!other) return
    const now = new Date().toISOString()
    await upsertKnowledgeItems([
      { ...k, sortOrder: other.sortOrder, updatedAt: now },
      { ...other, sortOrder: k.sortOrder, updatedAt: now },
    ])
  }

  const toggleArchive = async (k: KnowledgeItem) => {
    const now = new Date().toISOString()
    await upsertKnowledgeItems([{ ...k, isArchived: !k.isArchived, updatedAt: now }])
    toast.success(k.isArchived ? '已取消归档（重新计入掌握率）' : '已归档（保留评估历史，退出掌握率分母）')
  }

  const doDelete = async () => {
    if (!deleteId) return
    try {
      await deleteKnowledgeItemById(deleteId)
      toast.success('知识点及其评估历史已删除')
      setDeleteId(null)
      setDetailId(null)
    } catch (err) {
      toast.error(err instanceof Error ? `删除失败：${err.message}（数据未变，可重试）` : '删除失败，可重试')
    }
  }

  const detail = detailId ? all.find((k) => k.id === detailId) ?? null : null
  const deleteTarget = deleteId ? all.find((k) => k.id === deleteId) ?? null : null

  const grouped = useMemo(() => {
    if (!groupByMilestone) return [{ key: '', label: '', items: filtered }]
    const groups = new Map<string, KnowledgeItem[]>()
    for (const k of filtered) {
      const key = k.milestoneId ?? ''
      groups.set(key, [...(groups.get(key) ?? []), k])
    }
    return [...groups.entries()].map(([key, items]) => ({
      key,
      label: key ? (goalMilestones.find((m) => m.id === key)?.title ?? '已删除阶段') : '未分组',
      items,
    }))
  }, [groupByMilestone, filtered, goalMilestones])

  return (
    <Modal open={open} onClose={onClose} title={`知识点管理 · ${goal.name}`}>
      <div className="space-y-4">
        {stats.hasItems ? (
          <div className="tnum flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl bg-base px-3.5 py-2.5 text-xs text-ink2">
            <span>
              共 {stats.counts.total} 个未归档知识点 · 权重合计 {stats.totalWeight}
            </span>
            <span className="text-ok">已掌握 {stats.counts.mastered}</span>
            <span className="text-warn">待巩固 {stats.counts.weak}</span>
            <span className="text-ink3">待评估 {stats.counts.unevaluated}</span>
            <span className="text-ink3">已评估覆盖率 {stats.assessmentCoverage}%</span>
          </div>
        ) : (
          <p className="rounded-xl bg-base px-3.5 py-2.5 text-xs text-ink3">还没有知识点。添加后通过真实自评得到「掌握覆盖率」（自评结果，不代表客观成绩）。</p>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="搜索标题或说明" aria-label="搜索知识点" className="h-9 w-44" />
          <div className="flex flex-wrap gap-1" role="radiogroup" aria-label="筛选">
            {FILTERS.map((f) => (
              <button
                key={f.key}
                type="button"
                role="radio"
                aria-checked={filter === f.key}
                onClick={() => setFilter(f.key)}
                className={`rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors ${filter === f.key ? 'bg-primarySoft text-primary' : 'border border-line text-ink3'}`}
              >
                {f.label}
              </button>
            ))}
          </div>
          <label className="ml-auto flex cursor-pointer items-center gap-1.5 text-xs text-ink2">
            <input type="checkbox" checked={groupByMilestone} onChange={(e) => setGroupByMilestone(e.target.checked)} className="accent-[rgb(var(--c-primary))]" />
            按阶段分组
          </label>
        </div>

        {filtered.length === 0 ? (
          <p className="rounded-xl border border-dashed border-line px-3.5 py-4 text-center text-xs text-ink3">
            {filter === 'archived' ? '没有已归档的知识点。' : filter === 'weak' ? '没有待巩固的知识点——继续保持！' : '没有匹配的知识点。'}
          </p>
        ) : (
          <div className="space-y-3">
            {grouped.map((group) => (
              <div key={group.key} className="space-y-1.5">
                {group.label && <p className="text-[11px] font-semibold text-ink3">{group.label}</p>}
                <ul className="divide-y divide-line/60 rounded-xl border border-line/70">
                  {group.items.map((k) => {
                    const r = getItemCurrentRating(k.id, assessments)
                    return (
                      <li key={k.id} className={`flex items-center gap-2 px-3 py-2 ${k.isArchived ? 'opacity-50' : ''}`}>
                        <button type="button" className="min-w-0 flex-1 text-left" onClick={() => setDetailId(k.id)}>
                          <p className="truncate text-sm text-ink">{k.title}</p>
                          <p className="tnum text-[11px] text-ink3">
                            权重 {k.weight}
                            {k.milestoneId ? ` · ${goalMilestones.find((m) => m.id === k.milestoneId)?.title ?? ''}` : ''}
                          </p>
                        </button>
                        {k.isArchived && <Badge tone="neutral">已归档</Badge>}
                        <span className={`rounded-md px-1.5 py-0.5 text-[10px] font-medium ${ratingBadgeClass(r)}`}>{ratingText(r)}</span>
                        <button type="button" aria-label={`编辑 ${k.title}`} className="rounded-lg p-1 text-ink3 hover:text-primary" onClick={() => openEdit(k)}>
                          编辑
                        </button>
                      </li>
                    )
                  })}
                </ul>
              </div>
            ))}
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={openCreate}>
            <IconPlus /> 添加知识点
          </Button>
          <Button size="sm" variant="secondary" onClick={() => setBatchOpen(true)}>
            批量粘贴添加
          </Button>
        </div>
      </div>

      {/* 单个添加/编辑 */}
      <Modal
        open={formOpen}
        onClose={() => setFormOpen(false)}
        title={editing ? '编辑知识点' : '添加知识点'}
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setFormOpen(false)}>
              取消
            </Button>
            <Button onClick={() => void submitForm()}>{editing ? '保存' : '添加'}</Button>
          </div>
        }
      >
        <form className="space-y-3.5" onSubmit={(e) => { e.preventDefault(); void submitForm() }}>
          <Field label="标题" htmlFor="ki-title">
            <Input id="ki-title" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="如：二叉树的三种遍历" maxLength={80} />
          </Field>
          <Field label="说明（可选）" htmlFor="ki-desc">
            <TextArea id="ki-desc" rows={2} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="关键思路、易错点" maxLength={300} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="权重" htmlFor="ki-weight" hint="仅用于掌握覆盖率，与单词数/页数无关">
              <Input id="ki-weight" type="number" min={0.1} step="any" value={form.weight} onChange={(e) => setForm({ ...form, weight: e.target.value })} />
            </Field>
            <Field label="所属阶段（可选）" htmlFor="ki-ms">
              <select id="ki-ms" value={form.milestoneId} onChange={(e) => setForm({ ...form, milestoneId: e.target.value })} className="h-10 w-full rounded-xl border border-line bg-surface px-3 text-sm text-ink">
                <option value="">不归属</option>
                {goalMilestones.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.title}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <button type="submit" className="hidden" aria-hidden="true" />
        </form>
      </Modal>

      {/* 批量粘贴 */}
      <Modal
        open={batchOpen}
        onClose={() => setBatchOpen(false)}
        title="批量粘贴添加知识点"
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setBatchOpen(false)}>
              取消
            </Button>
            <Button onClick={() => void submitBatch()}>添加去重后的条目</Button>
          </div>
        }
      >
        <div className="space-y-3">
          <Field label="每行一个标题（自动去空行与重复）" htmlFor="ki-batch">
            <TextArea
              id="ki-batch"
              rows={8}
              value={batchText}
              onChange={(e) => setBatchText(e.target.value)}
              placeholder={'栈的定义与操作\n队列与双端队列\n哈希表原理'}
            />
          </Field>
          {(() => {
            const lines = batchText.split('\n').map((l) => l.trim()).filter(Boolean)
            const seen = new Set(all.map((k) => k.title))
            const dup = lines.filter((l, i) => seen.has(l) || lines.indexOf(l) !== i)
            return (
              <p className="text-xs text-ink3">
                共 {lines.length} 行，新增 {lines.filter((l, i) => !seen.has(l) && lines.indexOf(l) === i).length} 个
                {dup.length > 0 && `，跳过重复 ${dup.length} 个`}。纯本地处理，不调用任何在线服务。
              </p>
            )
          })()}
        </div>
      </Modal>

      {/* 详情 */}
      <Modal open={!!detail} onClose={() => setDetailId(null)} title={detail?.title ?? ''}>
        {detail && (
          <KnowledgeDetailBody
            item={detail}
            onDelete={(id) => setDeleteId(id)}
          />
        )}
        {detail && (
          <div className="mt-3 flex flex-wrap gap-2 border-t border-line/70 pt-3">
            <Button size="sm" variant="secondary" onClick={() => openEdit(detail)}>
              编辑信息
            </Button>
            <Button size="sm" variant="ghost" onClick={() => void toggleArchive(detail)}>
              {detail.isArchived ? <IconCheck /> : <IconX />} {detail.isArchived ? '取消归档' : '归档'}
            </Button>
            <Button size="sm" variant="ghost" disabled={!detail.isArchived} onClick={() => void move(detail, -1)} title="上移（仅未归档可排序）">
              上移
            </Button>
            <Button size="sm" variant="ghost" disabled={!detail.isArchived} onClick={() => void move(detail, 1)} title="下移">
              下移
            </Button>
          </div>
        )}
      </Modal>

      <ConfirmDialog
        open={!!deleteId}
        title="删除知识点"
        danger
        confirmText="删除知识点"
        message={
          <span>
            将删除「{deleteTarget?.title}」及其 <b className="text-danger">{assessments.filter((a) => a.knowledgeItemId === deleteId).length}</b>{' '}
            条评估历史。若只想暂时移出统计，建议改为「归档」。
          </span>
        }
        onConfirm={() => void doDelete()}
        onClose={() => setDeleteId(null)}
      />
    </Modal>
  )
}

