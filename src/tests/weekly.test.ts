import { describe, expect, it } from 'vitest'
import { compareWeeks, computeDelta, generateWeeklyReportText, summarizeRange, comparisonWindows } from '../domain/weekly'
import { makeCheckin, makeGoal } from './helpers'

// 2026-03：03-02 周一，03-08 周日，03-09 周一，03-15 周日，03-16 周一
describe('周报统计与环比', () => {
  const g1 = makeGoal({ id: 'g1', name: '背单词', unit: '词' })
  const g2 = makeGoal({ id: 'g2', name: '读书', unit: '页' })

  it('分目标汇总保留单位，绝不跨单位加总', () => {
    const checkins = [
      makeCheckin('g1', '2026-03-09', 20, { minutes: 30 }),
      makeCheckin('g1', '2026-03-10', 20),
      makeCheckin('g2', '2026-03-09', 10, { minutes: 40 }),
    ]
    const s = summarizeRange([g1, g2], checkins, '2026-03-09', '2026-03-15')
    expect(s.goalStats).toHaveLength(2)
    const w1 = s.goalStats.find((g) => g.goalId === 'g1')
    const w2 = s.goalStats.find((g) => g.goalId === 'g2')
    expect(w1?.amount).toBe(40)
    expect(w1?.unit).toBe('词')
    expect(w2?.amount).toBe(10)
    expect(w2?.unit).toBe('页')
    // 不存在「总完成量」这类跨单位字段
    expect(Object.keys(s)).not.toContain('totalAmount')
  })

  it('分钟数只统计明确填写的记录', () => {
    const checkins = [
      makeCheckin('g1', '2026-03-09', 20, { minutes: 30 }),
      makeCheckin('g1', '2026-03-10', 20), // 未填分钟
      makeCheckin('g1', '2026-03-11', 20, { minutes: 0 }), // 明确 0 也算已填写
    ]
    const s = summarizeRange([g1], checkins, '2026-03-09', '2026-03-15')
    expect(s.goalStats[0].minutes).toBe(30)
    expect(s.totalMinutes).toBe(30)
    expect(s.goalStats[0].amount).toBe(60)
  })

  it('完整周与上一完整周同口径比较', () => {
    const checkins = [
      // 本周（03-09..03-15）
      makeCheckin('g1', '2026-03-09', 20, { minutes: 30 }),
      makeCheckin('g1', '2026-03-10', 20),
      makeCheckin('g1', '2026-03-12', 20),
      makeCheckin('g2', '2026-03-09', 10, { minutes: 40 }),
      makeCheckin('g2', '2026-03-11', 15),
      // 上周（03-02..03-08）
      makeCheckin('g1', '2026-03-02', 20, { minutes: 30 }),
      makeCheckin('g1', '2026-03-03', 20),
    ]
    const today = '2026-03-15' // 周日：本周已走满
    const { metrics, goalMetrics } = compareWeeks([g1, g2], checkins, '2026-03-09', today)
    // 学习天数 4 vs 2 → +100%
    expect(metrics[0]).toMatchObject({ current: 4, previous: 2, percentText: '+100%' })
    // 打卡次数 5 vs 2 → +150%
    expect(metrics[1]).toMatchObject({ current: 5, previous: 2, percentText: '+150%' })
    // 分钟 70 vs 30 → +133%
    expect(metrics[2]).toMatchObject({ current: 70, previous: 30, percentText: '+133%' })
    // g1 60 vs 40 → +50%；g2 25 vs 0 → 上期为 0
    expect(goalMetrics[0]).toMatchObject({ current: 60, previous: 40, percentText: '+50%' })
    expect(goalMetrics[1]).toMatchObject({ current: 25, previous: 0, percentText: '上期为 0 / 本期新增' })
  })

  it('本周未结束：与上一周「周一到当前星期几」的相同日数窗口比较', () => {
    const checkins = [
      makeCheckin('g1', '2026-03-09', 20), // 本周一
      makeCheckin('g1', '2026-03-10', 20), // 本周二
      makeCheckin('g1', '2026-03-02', 10), // 上周一（计入）
      makeCheckin('g1', '2026-03-05', 50), // 上周四（不应计入比较窗口）
    ]
    const today = '2026-03-11' // 周三：cur=03-09..03-11, prev=03-02..03-04
    const win = comparisonWindows('2026-03-09', today)
    expect(win.cur).toEqual({ from: '2026-03-09', to: '2026-03-11' })
    expect(win.prev).toEqual({ from: '2026-03-02', to: '2026-03-04' })
    const { metrics } = compareWeeks([g1], checkins, '2026-03-09', today)
    expect(metrics[1]).toMatchObject({ current: 2, previous: 1, percentText: '+100%' }) // 打卡次数
  })

  it('零基数环比：上期 0 本期新增；两期皆 0 持平；正常 ±%', () => {
    expect(computeDelta('x', '次', 5, 0)).toMatchObject({ deltaKind: 'newFromZero', percentText: '上期为 0 / 本期新增' })
    expect(computeDelta('x', '次', 0, 0)).toMatchObject({ deltaKind: 'flat', percentText: '持平' })
    expect(computeDelta('x', '次', 0, 9)).toMatchObject({ deltaKind: 'down', percentText: '-100%' })
    expect(computeDelta('x', '次', 10, 5)).toMatchObject({ deltaKind: 'up', percentText: '+100%' })
    expect(computeDelta('x', '次', 5, 5)).toMatchObject({ deltaKind: 'flat', percentText: '持平' })
  })

  it('生成周报文本：包含日期范围、统计、环比与四栏（缺失栏诚实标注）', () => {
    const checkins = [
      makeCheckin('g1', '2026-03-09', 20, { minutes: 30 }),
      makeCheckin('g2', '2026-03-10', 15),
    ]
    const text = generateWeeklyReportText([g1, g2], checkins, '2026-03-09', '2026-03-15', null)
    expect(text).toContain('知行 StudyFlow 周报')
    expect(text).toContain('3月9日 - 3月15日')
    expect(text).toContain('背单词：20 词')
    expect(text).toContain('读书：15 页')
    expect(text).toContain('30 分钟')
    expect(text).toContain('【保持】未填写')
    expect(text).toContain('【问题】未填写')
    expect(text).toContain('本地离线应用')
    const filled = {
      id: 'r1', weekStart: '2026-03-09', keep: '早起打卡', problem: '', tryNext: '', nextPlan: '',
      createdAt: '', updatedAt: '',
    }
    const text2 = generateWeeklyReportText([g1, g2], checkins, '2026-03-09', '2026-03-15', filled)
    expect(text2).toContain('【保持】早起打卡')
    expect(text2).toContain('【问题】未填写')
  })

  it('空周：不产生任何虚假统计', () => {
    const s = summarizeRange([g1, g2], [], '2026-03-09', '2026-03-15')
    expect(s.goalStats).toEqual([])
    expect(s.totalCheckins).toBe(0)
    expect(s.totalActiveDays).toBe(0)
    expect(s.totalMinutes).toBe(0)
  })
})
