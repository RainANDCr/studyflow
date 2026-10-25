import { useMemo, useState } from 'react'
import type { Checkin, DateStr, FocusSession, Goal } from '../domain/types'
import { COLOR_HEX } from '../domain/types'
import { addDays, formatMD, weekdayShort } from '../domain/dates'
import { splitSessionByDate } from '../domain/focus'
import { EmptyState } from './ui'
import { IconChart } from './icons'

/**
 * 近 14 天「每日学习投入分钟数」SVG 堆叠柱状图（自行实现，非图表库）。
 * - 横轴 14 个自然日（含今天），纵轴分钟；
 * - 每个目标使用其配色；悬停 / 点击显示各目标分钟数、当日总分钟；
 * - 未填写分钟数的记录不计入（绝不臆测时长）；
 * - 图例同时列出目标名称，颜色不是唯一辨识手段；移动端横向滚动。
 */
export function MinutesChart({ goals, checkins, focusSessions = [], today }: { goals: Goal[]; checkins: Checkin[]; focusSessions?: FocusSession[]; today: DateStr }) {
  const [selected, setSelected] = useState<number | null>(null)

  const days = useMemo(
    () => Array.from({ length: 14 }, (_, i) => addDays(today, i - 13)),
    [today],
  )

  const stacked = useMemo(() => {
    const perGoal = new Map<string, string>() // goalId → hex
    for (const g of goals) perGoal.set(g.id, COLOR_HEX[g.color])
    const rows = days.map((d) => {
      const byGoal = new Map<string, number>()
      for (const c of checkins) {
        if (c.date !== d || c.minutes === null) continue
        byGoal.set(c.goalId, (byGoal.get(c.goalId) ?? 0) + c.minutes)
      }
      // 未关联打卡的专注会话（统一有效分钟口径；已关联的经打卡分钟体现）
      for (const s of focusSessions) {
        if (s.linkedCheckinId !== null || !s.goalId) continue
        for (const b of splitSessionByDate(s)) {
          if (b.date === d && b.minutes > 0) byGoal.set(s.goalId, (byGoal.get(s.goalId) ?? 0) + b.minutes)
        }
      }
      const total = [...byGoal.values()].reduce((s, v) => s + v, 0)
      return { date: d, byGoal, total }
    })
    return rows
  }, [days, goals, checkins, focusSessions])

  const chartGoals = useMemo(() => {
    const withMinutes = new Set<string>()
    for (const row of stacked) for (const gid of row.byGoal.keys()) withMinutes.add(gid)
    return goals.filter((g) => withMinutes.has(g.id))
  }, [goals, stacked])

  const maxTotal = Math.max(30, ...stacked.map((r) => r.total))
  const hasData = stacked.some((r) => r.total > 0)

  const W = 504
  const H = 150
  const barW = 18
  const padL = 34 // 左侧 Y 轴数字专用边距，柱状区从 padL 起，避免与数字重叠
  const plotW = W - padL
  const colW = plotW / 14
  const y = (minutes: number) => H - (minutes / maxTotal) * (H - 18) - 4

  const gridLines = [0, 0.25, 0.5, 0.75, 1]
  const selectedRow = selected !== null ? stacked[selected] : null

  return (
    <div>
      <div className="relative">
        <div className="overflow-x-auto pb-1">
          <div className="min-w-[430px]">
            <svg
              viewBox={`0 0 ${W} ${H + 26}`}
              className="w-full"
              role="img"
              aria-label={`近 14 天每日学习投入分钟数堆叠柱状图，最高一日 ${maxTotal} 分钟`}
            >
              {gridLines.map((f) => {
                const gy = H - f * (H - 18) - 4
                const val = Math.round(maxTotal * f)
                return (
                  <g key={f}>
                    <line x1={padL} x2={W} y1={gy} y2={gy} stroke="rgb(var(--c-line))" strokeWidth={1} strokeDasharray={f === 0 ? '' : '3 4'} />
                    <text x={padL - 5} y={gy - 3} fontSize={9} fill="rgb(var(--c-ink3))" textAnchor="end">
                      {f === 0 ? '' : val}
                    </text>
                  </g>
                )
              })}
              {stacked.map((row, i) => {
                const x = padL + i * colW + (colW - barW) / 2
                let acc = 0
                const isToday = row.date === today
                return (
                  <g
                    key={row.date}
                    onClick={() => setSelected(selected === i ? null : i)}
                    onMouseEnter={() => setSelected(i)}
                    onMouseLeave={() => setSelected((s) => (s === i ? null : s))}
                  >
                    <rect x={padL + i * colW} y={0} width={colW} height={H + 26} fill="transparent" />
                    {row.total === 0 && (
                      <rect x={x} y={y(4) - 2} width={barW} height={2} rx={1} fill="rgb(var(--c-line))" />
                    )}
                    {chartGoals.map((g) => {
                      const m = row.byGoal.get(g.id)
                      if (!m) return null
                      const yTop = y(acc + m)
                      const hgt = y(acc) - y(acc + m)
                      acc += m
                      return (
                        <rect
                          key={g.id}
                          x={x}
                          y={yTop}
                          width={barW}
                          height={Math.max(1, hgt)}
                          rx={2.5}
                          fill={COLOR_HEX[g.color]}
                          opacity={selected === null || selected === i ? 1 : 0.45}
                        />
                      )
                    })}
                    <text
                      x={padL + i * colW + colW / 2}
                      y={H + 12}
                      fontSize={9.5}
                      textAnchor="middle"
                      fill={isToday ? 'rgb(var(--c-primary))' : 'rgb(var(--c-ink3))'}
                      fontWeight={isToday ? 700 : 400}
                    >
                      {formatMD(row.date).replace('月', '/').replace('日', '')}
                    </text>
                    <text
                      x={padL + i * colW + colW / 2}
                      y={H + 23}
                      fontSize={9}
                      textAnchor="middle"
                      fill={isToday ? 'rgb(var(--c-primary))' : 'rgb(var(--c-ink3))'}
                      fontWeight={isToday ? 700 : 400}
                    >
                      {weekdayShort(row.date).slice(1)}
                    </text>
                  </g>
                )
              })}
            </svg>
          </div>
        </div>
        {selectedRow && selectedRow.total > 0 && (
          <div
            className="animate-pop pointer-events-none absolute top-0 z-10 -translate-x-1/2 rounded-xl border border-line bg-surface px-3 py-2 text-xs shadow-pop"
            style={{ left: `${((padL + (selected! + 0.5) * colW) / W) * 100}%` }}
          >
            <p className="mb-1 font-semibold text-ink">
              {formatMD(selectedRow.date)} {weekdayShort(selectedRow.date)} · 共 {selectedRow.total} 分钟
            </p>
            <ul className="space-y-0.5">
              {chartGoals
                .filter((g) => selectedRow.byGoal.has(g.id))
                .map((g) => (
                  <li key={g.id} className="flex items-center gap-1.5 text-ink2">
                    <span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: COLOR_HEX[g.color] }} />
                    {g.name}：{selectedRow.byGoal.get(g.id)} 分钟
                  </li>
                ))}
            </ul>
          </div>
        )}
      </div>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1.5">
        {chartGoals.map((g) => (
          <span key={g.id} className="flex items-center gap-1.5 text-xs text-ink2">
            <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: COLOR_HEX[g.color] }} />
            {g.name}
          </span>
        ))}
      </div>
      {!hasData && (
        <div className="mt-2">
          <EmptyState
            icon={<IconChart />}
            title="近 14 天暂无已填写分钟数的记录"
            description="打卡时填写「分钟数」后，这里会展示每日投入柱状图；未填写分钟数的记录不会计入。"
          />
        </div>
      )}
      <p className="mt-2 text-[11px] leading-relaxed text-ink3">
        悬停或点击柱子查看各目标当日分钟数。统一有效分钟口径：明确填写的打卡分钟 + 未关联打卡的专注会话（已关联的经打卡统计，不重复）。
      </p>
    </div>
  )
}
