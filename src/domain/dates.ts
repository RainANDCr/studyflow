import type { Clock } from './clock'

/**
 * 本地日期算法。关键约束：
 * 1) 所有「今天 / 昨天 / 周一」均按设备本地时区；
 * 2) 日历日期一律为 YYYY-MM-DD 字符串；
 * 3) 严禁 toISOString().slice(0, 10)（会把本地日期错误转成 UTC 造成跨日错位）。
 */

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

export function isValidDateStr(s: string): boolean {
  if (!DATE_RE.test(s)) return false
  const [y, m, d] = s.split('-').map(Number)
  if (m < 1 || m > 12 || d < 1 || d > 31) return false
  const dt = new Date(y, m - 1, d)
  return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d
}

/** Date → 本地 YYYY-MM-DD */
export function toDateStr(d: Date): string {
  const y = d.getFullYear()
  const m = d.getMonth() + 1
  const day = d.getDate()
  return `${y}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

export function todayStr(clock: Clock): string {
  return toDateStr(clock.now())
}

/** YYYY-MM-DD → 当地正午的 Date（正午锚点可规避 DST 偏移导致的跨日） */
export function parseDate(s: string): Date {
  const [y, m, d] = s.split('-').map(Number)
  return new Date(y, m - 1, d, 12, 0, 0, 0)
}

export function addDays(s: string, n: number): string {
  const d = parseDate(s)
  d.setDate(d.getDate() + n)
  return toDateStr(d)
}

/** a - b 的自然日差（a 晚于 b 为正） */
export function diffDays(a: string, b: string): number {
  const ms = parseDate(a).getTime() - parseDate(b).getTime()
  return Math.round(ms / 86_400_000)
}

/** 周一 = 1 … 周日 = 7 */
export function dayOfWeekMon1(s: string): number {
  const jsDay = parseDate(s).getDay() // 周日 = 0
  return jsDay === 0 ? 7 : jsDay
}

/** 该日期所在自然周的周一（一周 = 周一 00:00 至下周一 00:00 前） */
export function weekStart(s: string): string {
  return addDays(s, -(dayOfWeekMon1(s) - 1))
}

export function weekEnd(start: string): string {
  return addDays(start, 6)
}

/** 该周 7 个日期（周一起） */
export function weekDates(start: string): string[] {
  return Array.from({ length: 7 }, (_, i) => addDays(start, i))
}

/** [from, to] 闭区间逐日列表；from > to 时为空 */
export function rangeDays(from: string, to: string): string[] {
  const n = diffDays(to, from)
  if (n < 0) return []
  return Array.from({ length: n + 1 }, (_, i) => addDays(from, i))
}

export function minDate(a: string, b: string): string {
  return a <= b ? a : b
}

export function maxDate(a: string, b: string): string {
  return a >= b ? a : b
}

export function clampDate(s: string, lo: string, hi: string): string {
  return minDate(maxDate(s, lo), hi)
}

/** 10月25日 */
export function formatMD(s: string): string {
  const [, m, d] = s.split('-').map(Number)
  return `${m}月${d}日`
}

export function formatFullCN(s: string): string {
  const [y, m, d] = s.split('-').map(Number)
  return `${y}年${m}月${d}日`
}

const WEEKDAY_NAMES = ['周一', '周二', '周三', '周四', '周五', '周六', '周日']
export function weekdayShort(s: string): string {
  return WEEKDAY_NAMES[dayOfWeekMon1(s) - 1]
}

/** 构造「某本地日期的某时刻」的 ISO 时间戳（实体 createdAt/updatedAt 用） */
export function isoAtLocalTime(dateStr: string, hour = 12, minute = 0): string {
  const [y, m, d] = dateStr.split('-').map(Number)
  return new Date(y, m - 1, d, hour, minute, 0, 0).toISOString()
}
