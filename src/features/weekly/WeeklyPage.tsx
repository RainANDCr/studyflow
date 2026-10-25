import { useEffect, useMemo, useState } from 'react'
import { useAppData } from '../../state/AppData'
import type { WeeklyReview } from '../../domain/types'
import { addDays, formatMD, weekEnd, weekStart as weekStartOf, weekDates, weekdayShort } from '../../domain/dates'
import { compareWeeks, generateWeeklyReportText, summarizeRange } from '../../domain/weekly'
import { Button, Card, SectionTitle, StatTile, TextArea } from '../../components/ui'
import { useToast } from '../../components/feedback'
import {
  IconCalendar,
  IconChevronLeft,
  IconChevronRight,
  IconCopy,
  IconInbox,
  IconMinusTrend,
  IconSparkles,
  IconTrendDown,
  IconTrendUp,
} from '../../components/icons'
import type { MetricDelta } from '../../domain/weekly'
import { LongReportTab } from '../generic/GenericViews'

const REVIEW_FIELDS: Array<{ key: keyof Pick<WeeklyReview, 'keep' | 'problem' | 'tryNext' | 'nextPlan'>; label: string; placeholder: string }> = [
  { key: 'keep', label: '保持 · 这周做得好的', placeholder: '例如：每天固定 20:30 开始，不再拖到睡前' },
  { key: 'problem', label: '问题 · 哪里卡住了', placeholder: '例如：周三周四被加班打断，没有补上' },
  { key: 'tryNext', label: '尝试 · 下周想试的办法', placeholder: '例如：被打断就改成次日早上补 15 分钟' },
  { key: 'nextPlan', label: '下周预案 · 具体安排', placeholder: '例如：单词目标提到每日 60 词，读完第 3 章' },
]

function DeltaChip({ delta }: { delta: MetricDelta }) {
  const icon =
    delta.deltaKind === 'up' ? <IconTrendUp /> : delta.deltaKind === 'down' ? <IconTrendDown /> : <IconMinusTrend />
  const tone =
    delta.deltaKind === 'up'
      ? 'bg-okSoft text-ok'
      : delta.deltaKind === 'down'
        ? 'bg-dangerSoft text-danger'
        : 'bg-surface2 text-ink3'
  return (
    <span className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium ${tone}`} title={`上期 ${delta.previous} ${delta.unit}`}>
      {icon}
      {delta.percentText}
    </span>
  )
}

export function WeeklyPage() {
  const { goals, checkins, reviews, focusSessions, today, saveWeeklyReview } = useAppData()
  const [mode, setMode] = useState<'weekly' | 'long'>('weekly')
  const toast = useToast()
  const currentWeekStart = useMemo(() => weekStartOf(today), [today])
  const [selectedWeek, setSelectedWeek] = useState(currentWeekStart)
  const [editor, setEditor] = useState({ keep: '', problem: '', tryNext: '', nextPlan: '' })
  const [saving, setSaving] = useState(false)
  const [reportText, setReportText] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  const review = useMemo(() => reviews.find((r) => r.weekStart === selectedWeek) ?? null, [reviews, selectedWeek])

  useEffect(() => {
    setEditor({
      keep: review?.keep ?? '',
      problem: review?.problem ?? '',
      tryNext: review?.tryNext ?? '',
      nextPlan: review?.nextPlan ?? '',
    })
    setReportText(null)
    setCopied(false)
  }, [review, selectedWeek])

  const isCurrentWeek = selectedWeek === currentWeekStart
  const canGoNext = selectedWeek < currentWeekStart

  const { summary, comparison } = useMemo(() => {
    const rangeTo = isCurrentWeek ? today : weekEnd(selectedWeek)
    const s = summarizeRange(goals, checkins, selectedWeek, rangeTo, focusSessions)
    return { summary: s, comparison: compareWeeks(goals, checkins, selectedWeek, today) }
  }, [goals, checkins, focusSessions, selectedWeek, today, isCurrentWeek])
  if (mode === 'long') {
    return (
      <div className="space-y-4">
        <header className="flex items-center gap-2">
          <h1 className="text-lg font-bold text-ink">长期学习报告</h1>
          <Button size="sm" variant="ghost" className="ml-auto" onClick={() => setMode('weekly')}>
            ← 返回周报
          </Button>
        </header>
        <LongReportTab />
      </div>
    )
  }


  const save = async () => {
    setSaving(true)
    try {
      await saveWeeklyReview(selectedWeek, editor)
      toast.success('复盘已保存到本地')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '保存失败，内容已保留，可重试')
    } finally {
      setSaving(false)
    }
  }

  const generate = () => {
    const tempReview: WeeklyReview = {
      id: 'temp',
      weekStart: selectedWeek,
      keep: editor.keep,
      problem: editor.problem,
      tryNext: editor.tryNext,
      nextPlan: editor.nextPlan,
      createdAt: '',
      updatedAt: '',
    }
    setReportText(generateWeeklyReportText(goals, checkins, selectedWeek, today, tempReview))
    setCopied(false)
  }

  const copy = async () => {
    if (!reportText) return
    try {
      await navigator.clipboard.writeText(reportText)
      setCopied(true)
      toast.success('周报文本已复制到剪贴板')
    } catch {
      // 剪贴板 API 不可用时的降级：选中文本让用户手动复制
      toast.info('浏览器未授权剪贴板，请长按/选中文本手动复制')
    }
  }

  const weekEmpty = summary.goalStats.length === 0
  const rangeText = `${formatMD(selectedWeek)} - ${formatMD(isCurrentWeek ? today : weekEnd(selectedWeek))}`

  return (
    <div className="space-y-4">
      <header>
        <div className="flex items-center justify-between gap-2">
          <div>
            <h1 className="text-xl font-bold text-ink">周报</h1>
            <p className="mt-0.5 text-xs text-ink3">一周 = 周一至周日。本周进行中时，与上周同期（周一至同 weekday）做同口径比较。</p>
          </div>
          <Button size="sm" variant="secondary" onClick={() => setMode('long')}>
            长期报告（月/季/年）
          </Button>
        </div>
      </header>

      <Card className="px-4 py-3.5">
        <div className="flex items-center justify-between gap-2">
          <Button
            size="sm"
            variant="secondary"
            aria-label="上一周"
            onClick={() => setSelectedWeek((w) => addDays(w, -7))}
          >
            <IconChevronLeft /> 上一周
          </Button>
          <div className="text-center">
            <p className="text-sm font-semibold text-ink">
              {rangeText}
              {isCurrentWeek && <span className="ml-1.5 rounded-md bg-primarySoft px-1.5 py-0.5 text-[11px] font-medium text-primary">本周</span>}
            </p>
            <div className="mt-1 flex justify-center gap-2.5 text-[11px] text-ink3">
              {weekDates(selectedWeek).map((d) => (
                <span key={d} className={d === today ? 'font-bold text-primary' : ''}>
                  {weekdayShort(d).slice(1)}
                </span>
              ))}
            </div>
          </div>
          <div className="flex gap-1">
            <Button size="sm" variant="secondary" disabled={!canGoNext} aria-label="下一周" onClick={() => setSelectedWeek((w) => addDays(w, 7))}>
              下一周 <IconChevronRight />
            </Button>
          </div>
        </div>
        {!isCurrentWeek && (
          <div className="mt-2 text-center">
            <button type="button" className="text-xs text-primary underline-offset-2 hover:underline" onClick={() => setSelectedWeek(currentWeekStart)}>
              回到本周
            </button>
          </div>
        )}
      </Card>

      {weekEmpty ? (
        <Card className="px-4 py-8">
          <div className="mx-auto max-w-sm text-center">
            <span className="text-3xl text-ink3"><IconInbox /></span>
            <p className="mt-2 text-sm font-medium text-ink">这一周还没有学习记录</p>
            <p className="mt-1 text-xs leading-relaxed text-ink3">
              没有数据就不编造成果。去「今日」完成一次打卡，或翻到更早的周查看历史。
            </p>
          </div>
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-3 gap-3">
            {comparison.metrics.map((m) => (
              <StatTile
                key={m.label}
                label={`${m.label}${isCurrentWeek ? '（与上周同期比）' : '（与上一周比）'}`}
                value={
                  <span>
                    {m.current}
                    <span className="ml-0.5 text-xs font-normal text-ink3">{m.unit}</span>
                  </span>
                }
                sub={<DeltaChip delta={m} />}
              />
            ))}
          </div>

          <Card className="px-4 py-4">
            <SectionTitle title="分目标完成量" extra={<span className="text-[11px] text-ink3">各单位独立统计，不做跨单位加总</span>} />
            <ul className="divide-y divide-line/60">
              {summary.goalStats.map((gs) => {
                const delta = comparison.goalMetrics.find((m) => m.label === gs.name)
                return (
                  <li key={gs.goalId} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5 text-sm">
                    <span className="min-w-0 flex-1 truncate font-medium text-ink">{gs.name}</span>
                    <span className="tnum text-ink2">
                      {gs.amount} <span className="text-xs">{gs.unit}</span>
                    </span>
                    <span className="tnum text-xs text-ink3">
                      {gs.activeDays} 天 · {gs.checkinCount} 次{gs.minutes > 0 ? ` · ${gs.minutes} 分钟` : ''}
                    </span>
                    {delta && <DeltaChip delta={delta} />}
                  </li>
                )
              })}
            </ul>
          </Card>
        </>
      )}

      <Card className="px-4 py-4">
        <SectionTitle icon={<IconCalendar />} title="每周复盘 · 保持 / 问题 / 尝试 / 下周预案" extra={<span className="text-[11px] text-ink3">保存后重开仍在</span>} />
        <div className="space-y-3">
          {REVIEW_FIELDS.map((f) => (
            <div key={f.key}>
              <label htmlFor={`review-${f.key}`} className="mb-1.5 block text-[13px] font-medium text-ink2">
                {f.label}
              </label>
              <TextArea
                id={`review-${f.key}`}
                rows={2}
                maxLength={500}
                value={editor[f.key]}
                placeholder={f.placeholder}
                onChange={(e) => setEditor((ed) => ({ ...ed, [f.key]: e.target.value }))}
              />
            </div>
          ))}
          <div className="flex items-center justify-between gap-2 pt-1">
            <p className="text-[11px] text-ink3">按周更新，不会重复插入；同一周再次保存即覆盖。</p>
            <Button onClick={() => void save()} loading={saving}>
              保存复盘
            </Button>
          </div>
        </div>
      </Card>

      <Card className="px-4 py-4">
        <SectionTitle icon={<IconSparkles />} title="生成周报文本" />
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={generate}>
            <IconSparkles /> 生成周报文本
          </Button>
          {reportText && (
            <Button variant="soft" onClick={() => void copy()}>
              <IconCopy /> {copied ? '已复制' : '复制到剪贴板'}
            </Button>
          )}
        </div>
        {reportText && (
          <textarea
            readOnly
            value={reportText}
            aria-label="周报文本"
            className="mt-3 h-72 w-full rounded-xl border border-line bg-base p-3.5 font-mono text-xs leading-relaxed text-ink2"
            onFocus={(e) => e.currentTarget.select()}
          />
        )}
      </Card>
    </div>
  )
}
