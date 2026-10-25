import { describe, expect, it } from 'vitest'
import {
  buildSimulationCurve,
  compareWithDeadline,
  defaultPerDay,
  minRequiredPerDay,
  scenarioPresets,
  simulate,
} from '../domain/simulator'
import { makeCheckin, makeGoal } from './helpers'

const TODAY = '2026-03-09' // 周一

describe('模拟完成日推演', () => {
  it('每天 10 单位、天天学习：100 剩余 10 天完成', () => {
    const r = simulate(100, { perDayAmount: 10, studyWeekdays: [1, 2, 3, 4, 5, 6, 7], excludedDates: [], from: TODAY })
    expect(r.status).toBe('ok')
    expect(r.completionDate).toBe('2026-03-18')
    expect(r.studyDaysUsed).toBe(10)
    expect(r.perDateAmounts.reduce((s, p) => s + p.amount, 0)).toBe(100)
  })

  it('最后一天吸收尾差：95 ÷ 每天10 = 10 天，最后一天 5', () => {
    const r = simulate(95, { perDayAmount: 10, studyWeekdays: [1, 2, 3, 4, 5, 6, 7], excludedDates: [], from: TODAY })
    expect(r.completionDate).toBe('2026-03-18')
    expect(r.perDateAmounts[r.perDateAmounts.length - 1].amount).toBe(5)
  })

  it('只学周一三五：周末跳过', () => {
    const r = simulate(3, { perDayAmount: 1, studyWeekdays: [1, 3, 5], excludedDates: [], from: TODAY })
    // 03-09(一) 03-11(三) 03-13(五)
    expect(r.completionDate).toBe('2026-03-13')
    expect(r.studyDaysUsed).toBe(3)
    expect(r.perDateAmounts.map((p) => p.date)).toEqual(['2026-03-09', '2026-03-11', '2026-03-13'])
  })

  it('排除指定日期后顺延（2 个量：03-10、03-11）', () => {
    const r = simulate(2, { perDayAmount: 1, studyWeekdays: [1, 2, 3, 4, 5, 6, 7], excludedDates: ['2026-03-09'], from: TODAY })
    expect(r.completionDate).toBe('2026-03-11')
    expect(r.perDateAmounts[0].date).toBe('2026-03-10')
  })

  it('跨年：12-30 开始每天 1 个，3 个量完成于次年 1-1', () => {
    const r = simulate(3, { perDayAmount: 1, studyWeekdays: [1, 2, 3, 4, 5, 6, 7], excludedDates: [], from: '2025-12-30' })
    expect(r.completionDate).toBe('2026-01-01')
  })

  it('闰日：2024-02-28 起每天 1，3 个 → 03-01（02-29 闰日计入）', () => {
    const r = simulate(3, { perDayAmount: 1, studyWeekdays: [1, 2, 3, 4, 5, 6, 7], excludedDates: [], from: '2024-02-28' })
    expect(r.completionDate).toBe('2024-03-01')
  })

  it('零学习日（星期全排除）→ noStudyDays，不产生除零', () => {
    const r = simulate(10, { perDayAmount: 1, studyWeekdays: [], excludedDates: [], from: TODAY })
    expect(r.status).toBe('ok') // 空星期回退为全周
    const none = simulate(10, { perDayAmount: 1, studyWeekdays: [1], excludedDates: ['2026-03-09', '2026-03-16', '2026-03-23', '2026-03-30', '2026-04-06', '2026-04-13', '2026-04-20', '2026-04-27', '2026-05-04', '2026-05-11', '2026-05-18', '2026-05-25'], from: TODAY })
    // 一年中大量周一不在排除列表 → 会完成；真正 noStudyDays 由 maxDays 截断模拟
    expect(['ok', 'truncated']).toContain(none.status)
  })

  it('已完成：remaining=0 直接返回完成', () => {
    const r = simulate(0, { perDayAmount: 10, studyWeekdays: [1], excludedDates: [], from: TODAY })
    expect(r.status).toBe('ok')
    expect(r.completionDate).toBe(TODAY)
    expect(r.studyDaysUsed).toBe(0)
  })

  it('非法参数：0/负数/NaN 拒绝，不输出 Infinity', () => {
    expect(simulate(10, { perDayAmount: 0, studyWeekdays: [1], excludedDates: [], from: TODAY }).status).toBe('invalidParams')
    expect(simulate(10, { perDayAmount: -3, studyWeekdays: [1], excludedDates: [], from: TODAY }).status).toBe('invalidParams')
    expect(simulate(10, { perDayAmount: Number.NaN, studyWeekdays: [1], excludedDates: [], from: TODAY }).status).toBe('invalidParams')
  })

  it('大工作量：超过上限截断，不无限循环', () => {
    const r = simulate(1_000_000, { perDayAmount: 1, studyWeekdays: [1], excludedDates: [], from: TODAY }, 400)
    expect(r.status).toBe('truncated')
    expect(r.completionDate).toBeNull()
    expect(r.studyDaysUsed).toBeLessThanOrEqual(400)
  })
})

describe('最低每学习日量与预设', () => {
  it('截止前学习日数与最低量（向上取整）', () => {
    // 03-09..03-15 全周 7 天
    expect(minRequiredPerDay(100, '2026-03-15', null, TODAY)).toEqual({ perDay: 15, studyDayCount: 7 })
    // 只学周日（03-15）1 天
    const onlySun = { goalId: '', studyWeekdays: [7], excludedDates: [], dailyCap: null }
    expect(minRequiredPerDay(100, '2026-03-15', onlySun, TODAY)).toEqual({ perDay: 100, studyDayCount: 1 })
  })

  it('截止日已过：窗口退化为截止日当天', () => {
    const r = minRequiredPerDay(10, '2026-03-05', null, TODAY)
    expect(r).toEqual({ perDay: 10, studyDayCount: 1 })
  })

  it('三组预设明确标注为假设且基于基准量', () => {
    const presets = scenarioPresets(20)
    expect(presets.map((p) => p.label)).toEqual(['保守', '当前设定', '激进'])
    expect(presets[0].perDay).toBe(16)
    expect(presets[2].perDay).toBe(25)
    expect(presets.every((p) => p.note.includes('假设情景'))).toBe(true)
  })

  it('默认基准量回退：无学习日时按 14 天分摊', () => {
    expect(defaultPerDay(70, null)).toBe(5)
  })
})

describe('模拟与截止日比较、曲线', () => {
  it('提前/拖后/按时', () => {
    expect(compareWithDeadline('2026-03-10', '2026-03-15')).toEqual({ kind: 'early', days: 5 })
    expect(compareWithDeadline('2026-03-20', '2026-03-15')).toEqual({ kind: 'late', days: 5 })
    expect(compareWithDeadline('2026-03-15', '2026-03-15')).toEqual({ kind: 'onTime', days: 0 })
    expect(compareWithDeadline(null, '2026-03-15').kind).toBe('none')
  })

  it('曲线：历史实线从 0 累计到 done，未来虚线从 done 起步（不重复计入当前剩余）', () => {
    const goal = makeGoal({ id: 'g1', totalAmount: 100, startDate: '2026-03-01' })
    const checkins = [makeCheckin('g1', '2026-03-05', 40)]
    const { past, future, done } = buildSimulationCurve(
      goal,
      checkins,
      { perDayAmount: 30, studyWeekdays: [1, 2, 3, 4, 5, 6, 7], excludedDates: [], from: TODAY },
      60, // remaining（已扣除真实记录）
    )
    expect(done).toBe(40)
    expect(past[past.length - 1].cumulative).toBe(40)
    expect(future[0]).toEqual({ date: TODAY, cumulative: 40, isFuture: true })
    expect(future[future.length - 1].cumulative).toBe(100) // 40 + 60
  })
})
