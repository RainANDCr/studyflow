import type { AppSettings, Checkin, DateStr, Goal } from '../domain/types'
import { SCHEMA_VERSION } from '../domain/types'
import { addDays, diffDays, isoAtLocalTime, maxDate, weekStart } from '../domain/dates'

/**
 * 首次启动种子数据（isDemo=true）。
 * 日期全部相对「首次启动当日」生成，覆盖：
 * - 正常连续打卡（含已填/未填分钟数混合）；
 * - 1 条最近六天内的补记（统计按 Checkin.date 归属）；
 * - 1 个「昨日缺卡但被每周弹性休息日宽免」的目标（黄卡）；
 * - 尽力构造「同周第二个缺卡日」的目标（红卡；若昨日恰好是周一、
 *   同周无更早日期，则自然退化为黄卡——开发用固定日期 fixture 见测试）。
 */

export interface SeedData {
  goals: Goal[]
  checkins: Checkin[]
  settings: AppSettings
}

function uuid(prefix: string, key: string): string {
  return `${prefix}-${key}`
}

export function buildSeedData(today: DateStr): SeedData {
  const now = isoAtLocalTime(today, 9, 0)
  const g1: Goal = {
    id: uuid('demo', 'goal-words'),
    name: '背英语单词',
    unit: '词',
    totalAmount: 2000,
    startDate: addDays(today, -27),
    deadline: addDays(today, 60),
    color: 'violet',
    obstacle: '容易被手机消息打断',
    ifThenPlan: '如果被打断，就先开勿扰模式，再学 15 分钟',
    weeklyRestEnabled: true,
    isDemo: true,
    createdAt: isoAtLocalTime(addDays(today, -27), 8),
    updatedAt: now,
  }
  const g2: Goal = {
    id: uuid('demo', 'goal-book'),
    name: '读《人类简史》',
    unit: '页',
    totalAmount: 440,
    startDate: addDays(today, -20),
    deadline: addDays(today, 40),
    color: 'emerald',
    obstacle: '章节太长，不想开始',
    ifThenPlan: '如果不想开始，就先读 5 页',
    weeklyRestEnabled: true,
    isDemo: true,
    createdAt: isoAtLocalTime(addDays(today, -20), 8),
    updatedAt: now,
  }
  const g3: Goal = {
    id: uuid('demo', 'goal-python'),
    name: 'Python 入门课',
    unit: '节',
    totalAmount: 36,
    startDate: addDays(today, -13),
    deadline: addDays(today, 50),
    color: 'blue',
    obstacle: '晚上总想刷视频',
    ifThenPlan: '如果想刷视频，就先完成 1 节课再刷',
    weeklyRestEnabled: true,
    isDemo: true,
    createdAt: isoAtLocalTime(addDays(today, -13), 8),
    updatedAt: now,
  }
  const goals = [g1, g2, g3]
  const checkins: Checkin[] = []
  const push = (
    goal: Goal,
    date: DateStr,
    amount: number,
    minutes: number | null,
    opts: { note?: string; isBackfill?: boolean; createdOn?: DateStr } = {},
  ) => {
    const createdOn = opts.createdOn ?? date
    checkins.push({
      id: uuid('demo', `c-${goal.id.slice(5)}-${date}`),
      goalId: goal.id,
      date,
      amount,
      minutes,
      note: opts.note ?? null,
      isBackfill: opts.isBackfill ?? false,
      isDemo: true,
      milestoneId: null,
      createdAt: isoAtLocalTime(createdOn, 20, (date.charCodeAt(9) * 7) % 60),
      updatedAt: isoAtLocalTime(createdOn, 20, (date.charCodeAt(9) * 7) % 60),
    })
  }

  const yesterday = addDays(today, -1)

  // —— 目标1：稳定节奏，昨天有打卡，今天待打卡；两处不同周的宽免休息日
  const g1Misses = new Set([addDays(today, -22), addDays(today, -15)]) // 相隔 7 天，必在不同自然周
  for (let i = 27; i >= 1; i--) {
    const d = addDays(today, -i)
    if (g1Misses.has(d)) continue
    const amount = 40 + ((i * 7) % 16)
    const minutes = i % 3 === 0 ? 25 : null
    push(g1, d, amount, minutes)
  }
  // 近 6 天内补记 1 条（归属 today-5，实际录入于昨天）
  push(g1, addDays(today, -5), 45, 30, { isBackfill: true, note: '周五漏记，补上', createdOn: yesterday })

  // —— 目标2：每天打卡至昨天前一日，昨日缺卡 = 本周首个缺卡 → 弹性休息日宽免（黄卡）
  for (let i = 20; i >= 2; i--) {
    const d = addDays(today, -i)
    const minutes = i === 8 ? 40 : null
    push(g2, d, 16 + ((i * 5) % 10), minutes)
  }

  // —— 目标3：同周内先缺一天（消耗休息额度），昨日再缺 → 连续中断（红卡）
  const g3From = maxDate(g3.startDate, weekStart(yesterday))
  for (let d = g3.startDate; d < g3From; d = addDays(d, 1)) {
    push(g3, d, 1 + (d.charCodeAt(9) % 2), 45 + (d.charCodeAt(9) % 15))
  }
  if (diffDays(yesterday, g3From) >= 1) {
    // [g3From, yesterday-2] 打卡，缺 yesterday-1（宽免日），缺 yesterday（中断）
    for (let d = g3From; d <= addDays(yesterday, -2); d = addDays(d, 1)) {
      const isBackfillDay = d === addDays(today, -6)
      if (isBackfillDay) {
        push(g3, d, 2, null, { isBackfill: true, note: '当天忘记录，补记', createdOn: yesterday })
      } else {
        push(g3, d, 1 + (d.charCodeAt(9) % 2), d === addDays(today, -9) ? null : 50)
      }
    }
  } else {
    // 昨日是周一：同周无更早日期，红卡不可构造，退化为连续打卡（黄卡由昨日缺卡呈现）
    for (let d = g3From; d <= addDays(yesterday, -1); d = addDays(d, 1)) {
      push(g3, d, 1 + (d.charCodeAt(9) % 2), 50)
    }
  }

  return {
    goals,
    checkins,
    settings: { schemaVersion: SCHEMA_VERSION, demoSeeded: true, lastSavedAt: now },
  }
}
