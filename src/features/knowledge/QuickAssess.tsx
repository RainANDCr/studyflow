import { useEffect, useState } from 'react'
import type { DateStr, KnowledgeItem, MasteryAssessment, MasteryRating } from '../../domain/types'
import { getItemCurrentRating, getLatestAssessment } from '../../domain/dualTrack'
import { addDays, formatMD, weekdayShort } from '../../domain/dates'
import { useAppData } from '../../state/AppData'
import { Button, Field, Input } from '../../components/ui'
import { useToast } from '../../components/feedback'

export const RATING_LEVELS: Array<{ value: MasteryRating; label: string; desc: string; tone: 'ok' | 'warn' | 'neutral' }> = [
  { value: 0, label: '0 · 完全不会', desc: '看到题目毫无思路', tone: 'warn' },
  { value: 1, label: '1 · 有印象', desc: '有印象但不会独立完成', tone: 'warn' },
  { value: 2, label: '2 · 需要提示', desc: '需要提示才能完成', tone: 'warn' },
  { value: 3, label: '3 · 独立完成', desc: '可以独立完成', tone: 'ok' },
  { value: 4, label: '4 · 熟练迁移', desc: '可以熟练应用并迁移', tone: 'ok' },
]

export function ratingBadgeClass(rating: MasteryRating | null): string {
  if (rating === null) return 'bg-surface2 text-ink3'
  return rating >= 3 ? 'bg-okSoft text-ok' : 'bg-warnSoft text-warn'
}

export function ratingText(rating: MasteryRating | null): string {
  if (rating === null) return '未评估'
  return `${rating} 分`
}

/**
 * 快速自评表单：5 个互斥等级，用户必须明确选择才保存；
 * 评估为真实自愿录入（source=self），绝不因打卡/计时/打开页面自动生成。
 * 支持补录最近 6 个过去自然日（localDate 显示归属日，不用录入时间冒充）。
 */
export function QuickAssess({
  item,
  onDone,
}: {
  item: KnowledgeItem
  onDone?: () => void
}) {
  const { today, assessments, upsertAssessments } = useAppData()
  const toast = useToast()
  const [rating, setRating] = useState<MasteryRating | null>(null)
  const [note, setNote] = useState('')
  const [localDate, setLocalDate] = useState<DateStr>(today)
  const [saving, setSaving] = useState(false)
  const current = getItemCurrentRating(item.id, assessments)

  useEffect(() => {
    setRating(null)
    setNote('')
    setLocalDate(today)
  }, [item.id, today])

  const backfillDates = Array.from({ length: 6 }, (_, i) => addDays(today, -(i + 1)))

  const submit = async () => {
    if (rating === null) {
      toast.error('请先选择一个掌握等级（必须明确选择）')
      return
    }
    setSaving(true)
    try {
      const now = new Date().toISOString()
      await upsertAssessments([
        {
          id: `as-${item.id}-${now}`,
          knowledgeItemId: item.id,
          rating,
          assessedAt: now,
          localDate,
          note: note.trim() ? note : null,
          source: 'self',
          isDemo: item.isDemo,
          createdAt: now,
        },
      ])
      toast.success(localDate === today ? '自评已保存' : `已补录 ${formatMD(localDate)} 的自评`)
      onDone?.()
    } catch (err) {
      toast.error(err instanceof Error ? `保存失败：${err.message}（未保存，可重试）` : '保存失败，可重试')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-3">
      <div role="radiogroup" aria-label="掌握等级" className="space-y-1.5">
        {RATING_LEVELS.map((lv) => (
          <label
            key={lv.value}
            className={`flex cursor-pointer items-center gap-2.5 rounded-xl border px-3 py-2 text-xs transition-colors ${
              rating === lv.value ? 'border-primary bg-primarySoft/60' : 'border-line hover:border-primary/40'
            }`}
          >
            <input
              type="radio"
              name={`rating-${item.id}`}
              checked={rating === lv.value}
              onChange={() => setRating(lv.value)}
              className="accent-[rgb(var(--c-primary))]"
              aria-label={lv.label}
            />
            <span className="font-medium text-ink">{lv.label}</span>
            <span className="text-ink3">{lv.desc}</span>
          </label>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="归属日期" htmlFor={`assess-date-${item.id}`} hint="可补录最近 6 天">
          <select
            id={`assess-date-${item.id}`}
            value={localDate}
            onChange={(e) => setLocalDate(e.target.value)}
            className="h-10 w-full rounded-xl border border-line bg-surface px-3 text-sm text-ink"
          >
            <option value={today}>
              今天（{formatMD(today)} {weekdayShort(today)}）
            </option>
            {backfillDates.map((d) => (
              <option key={d} value={d}>
                {formatMD(d)} {weekdayShort(d)}（补录）
              </option>
            ))}
          </select>
        </Field>
        <Field label="备注（可选）" htmlFor={`assess-note-${item.id}`}>
          <Input id={`assess-note-${item.id}`} value={note} onChange={(e) => setNote(e.target.value)} placeholder="哪里卡住了" maxLength={200} />
        </Field>
      </div>
      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] text-ink3">
          当前等级：{ratingText(current)}
          {(() => {
            const latest = getLatestAssessment(item.id, assessments)
            return latest ? ` · 最近评估 ${formatMD(latest.localDate)}` : ' · 从未评估'
          })()}
        </p>
        <Button size="sm" onClick={() => void submit()} loading={saving}>
          保存自评
        </Button>
      </div>
    </div>
  )
}

/** 评估历史时间线（按归属日显示；追加式，不覆盖） */
export function AssessmentTimeline({ itemId, assessments }: { itemId: string; assessments: MasteryAssessment[] }) {
  const list = assessments
    .filter((a) => a.knowledgeItemId === itemId)
    .sort((a, b) => (a.assessedAt < b.assessedAt ? 1 : -1))
  if (list.length === 0) return <p className="text-[11px] text-ink3">还没有评估记录。</p>
  return (
    <ol className="space-y-1.5">
      {list.map((a) => (
        <li key={a.id} className="flex items-center gap-2 text-xs">
          <span className="tnum w-24 shrink-0 text-ink3">
            {formatMD(a.localDate)} {weekdayShort(a.localDate)}
          </span>
          <span className={`rounded-md px-1.5 py-0.5 text-[10px] font-medium ${ratingBadgeClass(a.rating)}`}>{ratingText(a.rating)}</span>
          {a.note && <span className="min-w-0 flex-1 truncate text-ink3">{a.note}</span>}
          <span className="shrink-0 text-[10px] text-ink3">自评</span>
        </li>
      ))}
    </ol>
  )
}

/** 知识点详情弹窗内容：说明 + 历史时间线 + 再次自评 */
export function KnowledgeDetailBody({ item, onDelete }: { item: KnowledgeItem; onDelete?: (id: string) => void }) {
  const { assessments } = useAppData()
  const [assessing, setAssessing] = useState(false)
  return (
    <div className="space-y-4">
      {item.description && <p className="rounded-xl bg-base px-3.5 py-3 text-xs leading-relaxed text-ink2">{item.description}</p>}
      <div className="rounded-xl border border-line/70 px-3.5 py-3">
        <p className="mb-2 text-xs font-semibold text-ink2">评估历史</p>
        <AssessmentTimeline itemId={item.id} assessments={assessments} />
      </div>
      {assessing ? (
        <div className="rounded-xl border border-line/70 px-3.5 py-3">
          <p className="mb-2 text-xs font-semibold text-ink2">再次自评</p>
          <QuickAssess item={item} onDone={() => setAssessing(false)} />
        </div>
      ) : (
        <Button size="sm" variant="soft" onClick={() => setAssessing(true)}>
          开始自评
        </Button>
      )}
      <div className="flex items-center justify-between gap-2 border-t border-line/70 pt-3">
        <p className="text-[11px] text-ink3">删除知识点将同时删除其全部评估历史（{assessments.filter((a) => a.knowledgeItemId === item.id).length} 条）。</p>
        {onDelete && (
          <Button size="sm" variant="ghost" className="text-danger" onClick={() => onDelete(item.id)}>
            删除
          </Button>
        )}
      </div>
    </div>
  )
}

