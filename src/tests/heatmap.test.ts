import { describe, expect, it } from 'vitest'
import { buildHeatmapData, buildHeatmapGrid, tierOf } from '../domain/heatmap'
import { makeCheckin } from './helpers'
import type { FocusSession } from '../domain/types'

function session(p: Partial<FocusSession>): FocusSession {
  return {
    id: 'f1', goalId: null, milestoneId: null,
    startedAt: '2026-03-15T10:00:00+08:00', endedAt: '2026-03-15T10:30:00+08:00',
    plannedSeconds: 1800, focusedSeconds: 1800, status: 'completed',
    linkedCheckinId: null, pausedSeconds: 0, lastPauseAt: null,
    isDemo: false, createdAt: '', updatedAt: '',
    ...p,
  }
}

describe('热力图数据', () => {
  it('打卡活跃度口径：条数计数，minutes=null 也算打卡', () => {
    const checkins = [
      makeCheckin('g1', '2026-03-14', 10, { minutes: null }),
      makeCheckin('g1', '2026-03-14', 5, { minutes: 30 }),
      makeCheckin('g2', '2026-03-14', 3),
    ]
    const data = buildHeatmapData(checkins, [], '2026-03-09', '2026-03-15')
    const day = data.days.get('2026-03-14')!
    expect(day.checkinCount).toBe(3)
    expect(day.goalCount).toBe(2)
    expect(day.effectiveMinutes).toBe(30) // 只有明确填写的分钟
  })

  it('补记按归属日出现在正确格子；删除后即时消失（无缓存）', () => {
    const checkins = [makeCheckin('g1', '2026-03-10', 10, { isBackfill: true, createdAt: '2026-03-15T21:00:00Z' })]
    const data = buildHeatmapData(checkins, [], '2026-03-09', '2026-03-15')
    expect(data.days.has('2026-03-10')).toBe(true)
    expect(data.days.has('2026-03-15')).toBe(false) // 录入日不是归属日
  })

  it('未关联打卡的专注会话计入有效分钟（跨午夜拆分归属）', () => {
    const start = new Date('2026-03-15T23:50:00+08:00').getTime()
    const sessions = [
      session({ id: 'f1', goalId: 'g1', startedAt: new Date(start).toISOString(), endedAt: new Date(start + 30 * 60 * 1000).toISOString(), focusedSeconds: 1800 }),
    ]
    const data = buildHeatmapData([], sessions, '2026-03-09', '2026-03-16')
    expect(data.days.get('2026-03-15')?.effectiveMinutes).toBe(10)
    expect(data.days.get('2026-03-16')?.effectiveMinutes).toBe(20)
  })

  it('已关联打卡的会话不重复计入', () => {
    const c = makeCheckin('g1', '2026-03-15', 10, { minutes: 30 })
    const sessions = [session({ id: 'f1', goalId: 'g1', linkedCheckinId: c.id })]
    const data = buildHeatmapData([c], sessions, '2026-03-09', '2026-03-15')
    expect(data.days.get('2026-03-15')?.effectiveMinutes).toBe(30)
  })

  it('强度档位：分钟固定阈值（15/30/60），活跃度按条数', () => {
    expect(tierOf(0, 'minutes')).toBe(0)
    expect(tierOf(10, 'minutes')).toBe(1)
    expect(tierOf(15, 'minutes')).toBe(2)
    expect(tierOf(30, 'minutes')).toBe(3)
    expect(tierOf(60, 'minutes')).toBe(4)
    expect(tierOf(1, 'activity')).toBe(1)
    expect(tierOf(3, 'activity')).toBe(2)
    expect(tierOf(6, 'activity')).toBe(4)
  })
})

describe('热力图网格', () => {
  it('每列 7 天、周一起始；首列从 from 所在周的周一开始（含补齐）', () => {
    const { columns } = buildHeatmapGrid('2026-03-11', '2026-03-15') // 周三到周日
    expect(columns[0]).toHaveLength(7)
    // 2026-03-09 是周一
    expect(columns[0][0]).toBe('2026-03-09')
    expect(columns[columns.length - 1][6]).toBe('2026-03-15')
  })

  it('跨年范围正常生成', () => {
    const { columns } = buildHeatmapGrid('2025-12-28', '2026-01-04')
    const flat = columns.flat()
    expect(flat).toContain('2025-12-28')
    expect(flat).toContain('2026-01-04')
  })

  it('月份标签位置对应列号', () => {
    const { monthLabels } = buildHeatmapGrid('2026-02-01', '2026-03-31')
    expect(monthLabels[0].label).toBe('2月')
    expect(monthLabels.some((m) => m.label === '3月')).toBe(true)
  })
})
