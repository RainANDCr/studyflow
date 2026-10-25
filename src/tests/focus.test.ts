import { describe, expect, it } from 'vitest'
import {
  clampFocusMinutes,
  finishSession,
  getEffectiveMinutesByGoal,
  getEffectiveStudyMinutes,
  getFocusedSeconds,
  getRemainingSeconds,
  pauseSession,
  resumeSession,
  splitSessionByDate,
  summarizeFocus,
} from '../domain/focus'
import { makeCheckin, makeGoal } from './helpers'
import type { FocusSession } from '../domain/types'

const T0 = new Date('2026-03-15T22:00:00+08:00').getTime() // 本地 22:00（跨午夜用例起点）

function session(p: Partial<FocusSession>): FocusSession {
  return {
    id: 'f1',
    goalId: null,
    milestoneId: null,
    startedAt: new Date(T0).toISOString(),
    endedAt: null,
    plannedSeconds: 1500,
    focusedSeconds: 0,
    status: 'active',
    linkedCheckinId: null,
    pausedSeconds: 0,
    lastPauseAt: null,
    isDemo: false,
    createdAt: '',
    updatedAt: '',
    ...p,
  }
}

describe('专注计时（墙钟差值，不依赖 interval）', () => {
  it('计时中：有效秒数 = (now - start)/1000 - 已暂停秒，封顶 planned', () => {
    const s = session({ plannedSeconds: 1500 })
    expect(getFocusedSeconds(s, T0 + 25 * 60 * 1000)).toBe(1500) // 封顶
    expect(getFocusedSeconds(s, T0 + 60 * 1000)).toBe(60)
    expect(getRemainingSeconds(s, T0 + 60 * 1000)).toBe(1440)
  })

  it('暂停/继续：暂停段不计入', () => {
    let s = session({})
    s = pauseSession(s, T0 + 10 * 60 * 1000) // 计 600 秒后暂停
    expect(s.pausedSeconds).toBe(600)
    expect(s.lastPauseAt).not.toBeNull()
    // 暂停期间时间流逝也不增加
    expect(getFocusedSeconds(s, T0 + 30 * 60 * 1000)).toBe(600)
    s = resumeSession(s, T0 + 15 * 60 * 1000)
    expect(s.lastPauseAt).toBeNull()
    // 恢复后从 600 秒继续累计（暂停的 5 分钟不计）
    expect(getFocusedSeconds(s, T0 + 20 * 60 * 1000)).toBe(900)
  })

  it('刷新/重启恢复：只依赖持久化字段与当前时间', () => {
    // 已计 300 秒后暂停：暂停期间无论何时读取都冻结在 300
    const s = session({ plannedSeconds: 1500, pausedSeconds: 300, lastPauseAt: new Date(T0 + 300_000).toISOString() })
    expect(getFocusedSeconds(s, T0 + 300_000)).toBe(300)
    expect(getFocusedSeconds(s, T0 + 900_000)).toBe(300) // 仍在暂停
  })

  it('结束：完成与提前中断；系统时钟倒流不产生负值', () => {
    const s = session({})
    const done = finishSession(s, T0 + 1500_000, 'completed')
    expect(done.focusedSeconds).toBe(1500)
    expect(done.session.status).toBe('completed')
    const early = finishSession(s, T0 + 300_000, 'interrupted')
    expect(early.focusedSeconds).toBe(300)
    expect(early.session.status).toBe('interrupted')
    // 时钟异常（早于开始）：不产生负的专注秒
    const weird = finishSession(s, T0 - 60_000, 'interrupted')
    expect(weird.focusedSeconds).toBe(0)
  })

  it('时长校验：1–240 分钟，非法拒绝', () => {
    expect(clampFocusMinutes(0)).toBeNull()
    expect(clampFocusMinutes(-5)).toBeNull()
    expect(clampFocusMinutes(241)).toBeNull()
    expect(clampFocusMinutes(25)).toBe(25)
    expect(clampFocusMinutes(50.4)).toBe(50)
  })
})

describe('有效学习分钟去重（全应用统一口径）', () => {
  it('已关联会话不叠加：分钟经 Checkin.minutes 统计一次', () => {
    const checkins = [makeCheckin('g1', '2026-03-15', 20, { minutes: 30 })]
    const sessions = [
      session({ id: 'f-linked', endedAt: new Date(T0 + 1500_000).toISOString(), focusedSeconds: 1500, status: 'completed', linkedCheckinId: checkins[0].id }),
    ]
    expect(getEffectiveStudyMinutes(checkins, sessions)).toBe(30)
  })

  it('未关联会话独立计入；未填分钟打卡为 0 而非虚构', () => {
    const checkins = [makeCheckin('g1', '2026-03-15', 20, { minutes: null })]
    const sessions = [
      session({ id: 'f1', endedAt: new Date(T0 + 600_000).toISOString(), focusedSeconds: 600, status: 'completed' }),
    ]
    expect(getEffectiveStudyMinutes(checkins, sessions)).toBe(10) // 600 秒 = 10 分钟
  })

  it('删除关联打卡后（linkCheckinId 置空由存储层保证），会话重新独立计入', () => {
    const checkins: ReturnType<typeof makeCheckin>[] = []
    const sessions = [
      session({ id: 'f1', endedAt: new Date(T0 + 1500_000).toISOString(), focusedSeconds: 1500, status: 'completed', linkedCheckinId: null }),
    ]
    expect(getEffectiveStudyMinutes(checkins, sessions)).toBe(25)
  })

  it('按目标归属：已填分钟打卡 + 未关联会话；无主会话归未归属', () => {
    const checkins = [makeCheckin('g1', '2026-03-15', 10, { minutes: 20 })]
    const sessions = [
      session({ id: 'f1', goalId: 'g1', endedAt: new Date(T0 + 600_000).toISOString(), focusedSeconds: 600, status: 'completed' }),
      session({ id: 'f2', goalId: null, endedAt: new Date(T0 + 1200_000).toISOString(), focusedSeconds: 1200, status: 'completed' }),
    ]
    const r = getEffectiveMinutesByGoal(checkins, sessions)
    expect(r.byGoal.get('g1')).toBe(30) // 20 打卡 + 10 会话
    expect(r.unattributed).toBe(20)
    expect(r.total).toBe(50)
  })

  it('按日期范围过滤', () => {
    const checkins = [makeCheckin('g1', '2026-03-14', 10, { minutes: 30 }), makeCheckin('g1', '2026-03-15', 10, { minutes: 15 })]
    expect(getEffectiveStudyMinutes(checkins, [], { from: '2026-03-15', to: '2026-03-15' })).toBe(15)
  })
})

describe('跨午夜会话拆分', () => {
  it('22:00–22:30 的会话全归当日', () => {
    const s = session({ endedAt: new Date(T0 + 1800_000).toISOString(), focusedSeconds: 1800, status: 'completed' })
    const buckets = splitSessionByDate(s)
    expect(buckets).toHaveLength(1)
    expect(buckets[0].date).toBe('2026-03-15')
    expect(buckets[0].minutes).toBe(30)
  })

  it('23:50–00:20 跨午夜：拆成两天，秒数合计精确', () => {
    const start = new Date('2026-03-15T23:50:00+08:00').getTime()
    const s = session({
      startedAt: new Date(start).toISOString(),
      endedAt: new Date(start + 30 * 60 * 1000).toISOString(),
      focusedSeconds: 1800,
      status: 'completed',
    })
    const buckets = splitSessionByDate(s)
    expect(buckets.map((b) => b.date)).toEqual(['2026-03-15', '2026-03-16'])
    const totalSeconds = buckets.reduce((sum, b) => sum + b.seconds, 0)
    expect(totalSeconds).toBe(1800)
    expect(buckets[0].minutes).toBe(10) // 23:50–00:00
    expect(buckets[1].minutes).toBe(20) // 00:00–00:20
  })
})

describe('专注统计汇总', () => {
  it('今天/本周：次数与有效分钟；最近会话倒序', () => {
    const checkins = [makeCheckin('g1', '2026-03-15', 10, { minutes: 15 })]
    const sessions = [
      session({ id: 'f1', endedAt: new Date(T0 + 600_000).toISOString(), focusedSeconds: 600, status: 'completed' }),
      session({ id: 'f2', goalId: 'g1', startedAt: new Date(T0 - 3600_000).toISOString(), endedAt: new Date(T0 - 3000_000).toISOString(), focusedSeconds: 600, status: 'completed' }),
      session({ id: 'f3', status: 'abandoned', endedAt: new Date(T0).toISOString(), focusedSeconds: 0 }),
    ]
    const sum = summarizeFocus(sessions, checkins, '2026-03-09', '2026-03-15')
    expect(sum.sessionCount).toBe(2) // abandoned 不计
    // 有效分钟 = 打卡15 + 未关联会话 f1(10) + 已归属会话 f2(10) = 35
    expect(sum.effectiveMinutes).toBe(35)
    expect(sum.recent[0].id).toBe('f1')
  })

  it('周报分钟口径：同一函数产出，避免双计', () => {
    const goal = makeGoal({ id: 'g1' })
    const checkins = [makeCheckin('g1', '2026-03-15', 10, { minutes: 30 })]
    const sessions = [
      session({ id: 'f1', goalId: 'g1', endedAt: new Date(T0 + 600_000).toISOString(), focusedSeconds: 600, status: 'completed', linkedCheckinId: checkins[0].id }),
    ]
    // 关联会话的 10 分钟不再叠加 → 只有 30
    expect(getEffectiveStudyMinutes(checkins, sessions)).toBe(30)
    void goal
  })
})
