import type { Checkin, DateStr, FocusSession, Goal } from './types'
import { parseDate, toDateStr } from './dates'
import { round2 } from './milestone'

/**
 * 专注会话领域规则（纯函数，内部统一秒数）。
 *
 * 投入分钟去重口径（全应用统一）：
 * - 有效分钟 = ① Checkin.minutes 明确填写的分钟 + ② 未关联 Checkin 的 FocusSession 有效分钟；
 * - 已关联（linkedCheckinId 非空）的会话不再叠加——投入时间经 Checkin.minutes 统计一次；
 * - 绝不把缺失的分钟数补成虚构值；
 * - 跨本地午夜的会话按真实时间段拆分到两个日历日（绝对时间戳 → 当地日历日）。
 */

export const FOCUS_PRESETS = [
  { label: '25 / 5', focusMinutes: 25, breakMinutes: 5 },
  { label: '15 / 3', focusMinutes: 15, breakMinutes: 3 },
  { label: '50 / 10', focusMinutes: 50, breakMinutes: 10 },
] as const

export const MIN_FOCUS_MINUTES = 1
export const MAX_FOCUS_MINUTES = 240

export function clampFocusMinutes(minutes: number): number | null {
  if (!Number.isFinite(minutes) || minutes < MIN_FOCUS_MINUTES || minutes > MAX_FOCUS_MINUTES) return null
  return Math.round(minutes)
}

/** 会话当前是否计时中（未暂停、未结束） */
export function isRunning(session: FocusSession): boolean {
  return session.status === 'active' && session.lastPauseAt === null && session.endedAt === null
}

/**
 * 计时模型（均匀、可恢复、不依赖 interval 次数）：
 * - 运行中：focused = (now - startedAt)/1000（恢复时把 startedAt 平移掉暂停墙钟时长）；
 * - 暂停中（lastPauseAt 非空）：focused = pausedSeconds（上次暂停时的冻结快照）；
 * - 已结束：focused = focusedSeconds（落库确认值）。
 * 系统时钟异常（早于起点）一律钳制为 ≥0、≤ plannedSeconds，不产生夸大值。
 */
export function getFocusedSeconds(session: FocusSession, now: number): number {
  if (session.endedAt) return session.focusedSeconds
  if (session.lastPauseAt !== null) return Math.min(session.pausedSeconds, session.plannedSeconds)
  const startMs = new Date(session.startedAt).getTime()
  const focused = Math.floor((now - startMs) / 1000)
  return Math.min(Math.max(0, focused), session.plannedSeconds)
}

export function getRemainingSeconds(session: FocusSession, now: number): number {
  return Math.max(0, session.plannedSeconds - getFocusedSeconds(session, now))
}

/** 暂停：冻结当前有效秒数并记录暂停起点 */
export function pauseSession(session: FocusSession, now: number): FocusSession {
  if (!isRunning(session)) return session
  return {
    ...session,
    pausedSeconds: getFocusedSeconds(session, now),
    lastPauseAt: new Date(now).toISOString(),
    updatedAt: new Date(now).toISOString(),
  }
}

/** 继续：把暂停的墙钟时长平移进 startedAt，之后运行公式保持均匀 */
export function resumeSession(session: FocusSession, now: number): FocusSession {
  if (session.status !== 'active' || session.lastPauseAt === null) return session
  const pauseStart = new Date(session.lastPauseAt).getTime()
  const pausedWallMs = Math.max(0, now - pauseStart)
  const startMs = new Date(session.startedAt).getTime()
  return {
    ...session,
    startedAt: new Date(startMs + pausedWallMs).toISOString(),
    lastPauseAt: null,
    updatedAt: new Date(now).toISOString(),
  }
}

export interface FinishResult {
  session: FocusSession
  /** 实际有效专注秒数（供确认面板展示/预填打卡分钟） */
  focusedSeconds: number
  /** 是否自然完成（达到 plannedSeconds） */
  completed: boolean
}

/** 结束（完成或提前结束）：以绝对时间差核算，防系统时钟异常产生夸大值 */
export function finishSession(
  session: FocusSession,
  now: number,
  status: 'completed' | 'interrupted' | 'abandoned',
): FinishResult {
  const focused = getFocusedSeconds(session, now)
  const endedAtIso = new Date(now).toISOString()
  const next: FocusSession = {
    ...session,
    endedAt: endedAtIso,
    focusedSeconds: focused,
    status,
    lastPauseAt: null,
    updatedAt: endedAtIso,
  }
  return { session: next, focusedSeconds: focused, completed: focused >= session.plannedSeconds }
}

/* ---------------- 有效投入分钟（去重口径的唯一实现） ---------------- */

export interface EffectiveMinutesOptions {
  from?: DateStr
  to?: DateStr
}

/**
 * 全应用统一的「有效学习投入分钟」：
 * ① 打卡中明确填写的 minutes + ② 未关联 Checkin 的会话（按跨午夜拆分后的归属日计）。
 * 已关联会话不叠加。日期范围 [from, to]（含端点，按归属日）。
 */
export function getEffectiveStudyMinutes(
  checkins: Checkin[],
  sessions: FocusSession[],
  opts: EffectiveMinutesOptions = {},
): number {
  const inRange = (d: DateStr) => (!opts.from || d >= opts.from) && (!opts.to || d <= opts.to)
  const checkinMinutes = checkins
    .filter((c) => c.minutes !== null && inRange(c.date))
    .reduce((s, c) => s + (c.minutes ?? 0), 0)
  const sessionMinutes = sessions
    .filter((s) => s.linkedCheckinId === null)
    .reduce((sum, s) => {
      for (const bucket of splitSessionByDate(s)) {
        if (inRange(bucket.date)) sum += bucket.minutes
      }
      return sum
    }, 0)
  return round2(checkinMinutes + sessionMinutes)
}

export interface SessionDateBucket {
  date: DateStr
  /** 该自然日内的有效秒数 */
  seconds: number
  minutes: number
}

/**
 * 跨午夜拆分：按会话实际推进的时间段（含暂停推进？不——暂停段不属于任何日期）。
 * 简化且可解释的口径：有效专注秒数按「计时推进的墙钟区间」均摊；
 * 对含暂停的长会话，将有效秒数在 [startedAt, endedAt) 的墙钟区间内按比例分摊到各日。
 * DST：用绝对时间戳计算边界，归属日为每个墙钟时刻所在的本地日历日。
 */
export function splitSessionByDate(session: FocusSession): SessionDateBucket[] {
  const focusedTotal = session.focusedSeconds
  if (focusedTotal <= 0 || !session.endedAt) return []
  const startMs = new Date(session.startedAt).getTime()
  const endMs = new Date(session.endedAt).getTime()
  if (endMs <= startMs) return []
  const wallSpan = endMs - startMs

  const buckets = new Map<DateStr, number>()
  // 逐「本地日边界」切分墙钟区间
  let cursor = startMs
  let guard = 0
  while (cursor < endMs && guard++ < 400) {
    const dayStr = toDateStr(new Date(cursor))
    // 当日结束的绝对时刻 = 次日正午 - 12h（即次日 00:00 的墙钟点，用正午锚点构造避免 DST 歧义）
    const nextNoon = parseDate(addDaysStr(dayStr, 1))
    const dayEndAbs = Math.min(endMs, nextNoon.getTime() - 12 * 3600 * 1000)
    const sliceMs = Math.max(0, dayEndAbs - cursor)
    const seconds = Math.round((focusedTotal * sliceMs) / wallSpan)
    buckets.set(dayStr, (buckets.get(dayStr) ?? 0) + seconds)
    cursor = dayEndAbs
  }
  // 取整误差收尾：补到最后一个桶
  const total = [...buckets.values()].reduce((s, v) => s + v, 0)
  if (total !== focusedTotal && buckets.size > 0) {
    const lastKey = [...buckets.keys()].pop()!
    buckets.set(lastKey, (buckets.get(lastKey) ?? 0) + (focusedTotal - total))
  }
  return [...buckets.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([date, seconds]) => ({ date, seconds, minutes: round2(seconds / 60) }))
}

function addDaysStr(s: DateStr, n: number): DateStr {
  const d = parseDate(s)
  d.setDate(d.getDate() + n)
  return toDateStr(d)
}

/** 按目标归属的有效分钟（14 天堆叠图 / 热力图分目标用）；无主会话归入 unattributed */
export function getEffectiveMinutesByGoal(
  checkins: Checkin[],
  sessions: FocusSession[],
  opts: EffectiveMinutesOptions = {},
): { byGoal: Map<string, number>; unattributed: number; total: number } {
  const inRange = (d: DateStr) => (!opts.from || d >= opts.from) && (!opts.to || d <= opts.to)
  const byGoal = new Map<string, number>()
  const add = (goalId: string | null, minutes: number) => {
    if (minutes <= 0) return
    if (goalId) byGoal.set(goalId, round2((byGoal.get(goalId) ?? 0) + minutes))
  }
  for (const c of checkins) {
    if (c.minutes !== null && inRange(c.date)) add(c.goalId, c.minutes)
  }
  let unattributed = 0
  for (const s of sessions) {
    if (s.linkedCheckinId !== null) continue
    for (const b of splitSessionByDate(s)) {
      if (!inRange(b.date)) continue
      if (s.goalId) add(s.goalId, b.minutes)
      else unattributed = round2(unattributed + b.minutes)
    }
  }
  const total = round2([...byGoal.values()].reduce((s, v) => s + v, 0) + unattributed)
  return { byGoal, unattributed, total }
}

/** 今天/本周专注统计（仅未关联打卡的会话独立计入；关联的经打卡分钟体现） */
export function summarizeFocus(
  sessions: FocusSession[],
  checkins: Checkin[],
  from: DateStr,
  to: DateStr,
  goals?: Goal[],
): { sessionCount: number; effectiveMinutes: number; recent: FocusSession[] } {
  const sessionsInRange = sessions.filter((s) => {
    const d = toDateStr(new Date(s.startedAt))
    return d >= from && d <= to && s.status !== 'abandoned'
  })
  const effective = getEffectiveStudyMinutes(
    checkins.filter((c) => c.date >= from && c.date <= to),
    sessionsInRange,
  )
  void goals
  return {
    sessionCount: sessionsInRange.length,
    effectiveMinutes: effective,
    recent: [...sessionsInRange]
      .sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1))
      .slice(0, 8),
  }
}
