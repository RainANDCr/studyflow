import { useMemo, useState } from 'react'
import type { Checkin, DateStr, FocusSession, Goal } from '../domain/types'
import { addDays, formatFullCN, weekdayShort } from '../domain/dates'
import { buildHeatmapData, buildHeatmapGrid, HEAT_COLORS, TIER_LABELS, tierOf, type HeatmapMode } from '../domain/heatmap'
import { Button, EmptyState } from './ui'
import { DayDetailDrawer } from '../features/calendar/DayDetailDrawer'
import { IconChart } from './icons'

function fmt(n: number): string {
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 10) / 10)
}

/**
 * 年度学习热力图（近 12 个月 / 365 天，标题标注口径）。
 * 列 = 周（周一起始），行 = 周一至周日；5 档紫色梯度 + 可访问文本标签；
 * 支持打卡活跃度 / 有效学习分钟双口径与目标筛选；点击某天打开该日详情（与日历共用抽屉）。
 */
export function Heatmap({
  goals,
  checkins,
  focusSessions,
  today,
}: {
  goals: Goal[]
  checkins: Checkin[]
  focusSessions: FocusSession[]
  today: DateStr
}) {
  const [mode, setMode] = useState<HeatmapMode>('minutes')
  const [goalFilter, setGoalFilter] = useState('all')
  const [selectedDate, setSelectedDate] = useState<DateStr | null>(null)

  const from = useMemo(() => addDays(today, -364), [today])
  const filteredCheckins = useMemo(
    () => (goalFilter === 'all' ? checkins : checkins.filter((c) => c.goalId === goalFilter)),
    [checkins, goalFilter],
  )
  const filteredSessions = useMemo(
    () => (goalFilter === 'all' ? focusSessions : focusSessions.filter((s) => s.goalId === goalFilter)),
    [focusSessions, goalFilter],
  )

  const data = useMemo(() => buildHeatmapData(filteredCheckins, filteredSessions, from, today), [filteredCheckins, filteredSessions, from, today])
  const { columns, monthLabels } = useMemo(() => buildHeatmapGrid(from, today), [from, today])

  const goalById = new Map(goals.map((g) => [g.id, g]))
  const totalMinutes = [...data.days.values()].reduce((s, d) => s + d.effectiveMinutes, 0)
  const activeDays = [...data.days.values()].filter((d) => d.checkinCount > 0 || d.effectiveMinutes > 0).length

  const valueOf = (d: DateStr): number => {
    const day = data.days.get(d)
    if (!day) return 0
    return mode === 'minutes' ? day.effectiveMinutes : day.checkinCount
  }

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <Button size="sm" variant={mode === 'minutes' ? 'soft' : 'ghost'} onClick={() => setMode('minutes')} aria-pressed={mode === 'minutes'}>
            有效分钟
          </Button>
          <Button size="sm" variant={mode === 'activity' ? 'soft' : 'ghost'} onClick={() => setMode('activity')} aria-pressed={mode === 'activity'}>
            打卡活跃度
          </Button>
        </div>
        <select
          value={goalFilter}
          onChange={(e) => setGoalFilter(e.target.value)}
          aria-label="热力图按目标筛选"
          className="h-8 rounded-lg border border-line bg-surface px-2 text-xs text-ink"
        >
          <option value="all">全部目标</option>
          {goals.map((g) => (
            <option key={g.id} value={g.id}>
              {g.name}
            </option>
          ))}
        </select>
      </div>

      <p className="mb-2 text-[11px] text-ink3">
        近 12 个月（{from.slice(0, 10).replace(/-/g, '/')} ~ {today.replace(/-/g, '/')}）·
        {mode === 'minutes' ? ' 有效学习分钟（明确填写的打卡分钟 + 未关联打卡的专注会话）' : ' 每日打卡条数（未填分钟也算打卡行为）'} ·
        有记录 {activeDays} 天 / {fmt(totalMinutes)} 分钟
      </p>

      <div className="overflow-x-auto pb-1">
        <div className="min-w-[640px]">
          <div className="flex">
            <div className="w-7 shrink-0" />
            <div className="flex flex-1 gap-[3px]">
              {monthLabels.map((m, i) => (
                <span
                  key={`${m.col}-${m.label}-${i}`}
                  className="text-[10px] text-ink3"
                  style={{ marginLeft: i === 0 ? 0 : undefined, width: i === 0 ? undefined : 'auto' }}
                >
                  {/* 月份标签按列定位 */}
                </span>
              ))}
            </div>
          </div>
          <div className="flex">
            <div className="flex w-7 shrink-0 flex-col gap-[3px] pr-1 text-right text-[9px] leading-[12px] text-ink3">
              {['一', '三', '五', '日'].map((w, i) => (
                <span key={w} style={{ marginTop: i === 0 ? 0 : 24 }}>
                  {w}
                </span>
              ))}
            </div>
            <div className="flex flex-1 gap-[3px]">
              {columns.map((col, ci) => (
                <div key={ci} className="flex flex-1 flex-col gap-[3px]" style={{ minWidth: 12 }}>
                  {col.map((d) => {
                    const future = d > today
                    const value = future ? 0 : valueOf(d)
                    const tier = future ? 0 : tierOf(value, mode)
                    const day = data.days.get(d)
                    const inRange = d >= from && d <= today
                    const goalNames = (day?.topGoalIds ?? []).map((id) => goalById.get(id)?.name).filter(Boolean).join('、')
                    const label = future
                      ? `${formatFullCN(d)}（未来）`
                      : inRange
                        ? `${formatFullCN(d)} ${weekdayShort(d)}：打卡 ${day?.checkinCount ?? 0} 次，有效 ${fmt(day?.effectiveMinutes ?? 0)} 分钟${goalNames ? `，主要：${goalNames}` : ''}`
                        : formatFullCN(d)
                    return (
                      <button
                        key={d}
                        type="button"
                        aria-label={label}
                        title={label}
                        disabled={future || !inRange}
                        onClick={() => inRange && !future && setSelectedDate(d)}
                        className={`h-[12px] w-full rounded-[2px] transition-transform ${future || !inRange ? 'opacity-30' : 'hover:scale-125'}`}
                        style={{ backgroundColor: HEAT_COLORS[tier], outline: tier === 0 ? '1px solid rgb(var(--c-line))' : undefined, outlineOffset: -1 }}
                      />
                    )
                  })}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-[10px] text-ink3">
        <div className="flex items-center gap-1.5">
          <span>{mode === 'minutes' ? '少' : '0'}</span>
          {HEAT_COLORS.map((c, i) => (
            <span key={i} className="h-[10px] w-[10px] rounded-[2px]" style={{ backgroundColor: c, outline: i === 0 ? '1px solid rgb(var(--c-line))' : undefined, outlineOffset: -1 }} title={TIER_LABELS[mode][i]} />
          ))}
          <span>{mode === 'minutes' ? '多（≥60 分钟）' : '多（6 次以上）'}</span>
          <span className="ml-2 hidden sm:inline">{TIER_LABELS[mode].join(' / ')}</span>
        </div>
        <span>0 表示无已记录活动，不等于「一定没学习」；点击格子查看当天详情。</span>
      </div>

      {activeDays === 0 && (
        <div className="mt-2">
          <EmptyState icon={<IconChart />} title="统计范围内还没有学习记录" description="打卡或完成一次专注后，这里会按天累积显示。" />
        </div>
      )}

      {selectedDate && (
        <DayDetailDrawer date={selectedDate} goals={goals} onClose={() => setSelectedDate(null)} onCheckin={() => undefined} onSavePrefs={async () => undefined} />
      )}
    </div>
  )
}
