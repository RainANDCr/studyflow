import { describe, expect, it } from 'vitest'
import {
  addDays,
  diffDays,
  isValidDateStr,
  parseDate,
  rangeDays,
  toDateStr,
  todayStr,
  weekDates,
  weekStart,
} from '../domain/dates'
import { fixedClock } from '../domain/clock'

describe('本地日期算法', () => {
  it('toDateStr 使用本地时区字段，不经过 UTC（本地 23:59 / 00:01 不跨日）', () => {
    const lateNight = new Date(2026, 9, 25, 23, 59, 0)
    const earlyMorning = new Date(2026, 9, 26, 0, 1, 0)
    expect(toDateStr(lateNight)).toBe('2026-10-25')
    expect(toDateStr(earlyMorning)).toBe('2026-10-26')
  })

  it('todayStr 遵循注入时钟的本地日期', () => {
    expect(todayStr(fixedClock('2026-10-25T23:59:00'))).toBe('2026-10-25')
    expect(todayStr(fixedClock('2026-10-26T00:01:00'))).toBe('2026-10-26')
  })

  it('addDays 跨月、跨年、闰日', () => {
    expect(addDays('2026-01-31', 1)).toBe('2026-02-01')
    expect(addDays('2026-02-28', 1)).toBe('2026-03-01') // 2026 非闰年
    expect(addDays('2024-02-28', 1)).toBe('2024-02-29') // 2024 闰年
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01')
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28')
    expect(addDays('2026-10-25', -6)).toBe('2026-10-19')
  })

  it('diffDays 为自然日差，跨月/跨年正确', () => {
    expect(diffDays('2026-03-01', '2026-03-01')).toBe(0)
    expect(diffDays('2026-03-02', '2026-03-01')).toBe(1)
    expect(diffDays('2026-03-01', '2026-02-28')).toBe(1)
    expect(diffDays('2027-01-01', '2026-12-31')).toBe(1)
    expect(diffDays('2026-02-28', '2026-03-01')).toBe(-1)
  })

  it('weekStart：周一回到本周一，周日回到上一个周一', () => {
    // 2026-03-02 是周一，2026-03-08 是周日
    expect(weekStart('2026-03-02')).toBe('2026-03-02')
    expect(weekStart('2026-03-03')).toBe('2026-03-02')
    expect(weekStart('2026-03-08')).toBe('2026-03-02')
    expect(weekStart('2026-03-09')).toBe('2026-03-09')
    expect(weekStart('2026-03-15')).toBe('2026-03-09')
    // 跨月边界：2026-03-01（周日）所在周从 02-23（周一）开始
    expect(weekStart('2026-03-01')).toBe('2026-02-23')
    // 跨年边界：2025-12-29 是周一
    expect(weekStart('2026-01-01')).toBe('2025-12-29')
  })

  it('weekDates 与 rangeDays 返回闭区间日期', () => {
    expect(weekDates('2026-03-02')).toHaveLength(7)
    expect(weekDates('2026-03-02')[6]).toBe('2026-03-08')
    expect(rangeDays('2026-03-01', '2026-02-28')).toEqual([])
    expect(rangeDays('2026-03-01', '2026-03-03')).toEqual(['2026-03-01', '2026-03-02', '2026-03-03'])
  })

  it('parseDate 锚定当地正午，往返一致', () => {
    const d = parseDate('2026-10-25')
    expect(d.getFullYear()).toBe(2026)
    expect(d.getMonth()).toBe(9)
    expect(d.getDate()).toBe(25)
    expect(d.getHours()).toBe(12)
    expect(toDateStr(d)).toBe('2026-10-25')
  })

  it('isValidDateStr 拒绝非法日期', () => {
    expect(isValidDateStr('2026-02-30')).toBe(false)
    expect(isValidDateStr('2026-13-01')).toBe(false)
    expect(isValidDateStr('2026-2-1')).toBe(false)
    expect(isValidDateStr('2026-02-29')).toBe(false)
    expect(isValidDateStr('2024-02-29')).toBe(true)
    expect(isValidDateStr('2026-10-25')).toBe(true)
  })
})
