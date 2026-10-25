import 'fake-indexeddb/auto'
import Dexie from 'dexie'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { WebIndexedDbRepository } from '../storage/indexeddb'
import type { ExportPayloadInput } from '../domain/validation'
import { makeCheckin, makeGoal } from './helpers'

/** v1 旧 schema（无五大功能实体） */
class V1Db extends Dexie {
  goals!: Dexie.Table<Record<string, unknown>, string>
  checkins!: Dexie.Table<Record<string, unknown>, string>
  reviews!: Dexie.Table<Record<string, unknown>, string>
  settings!: Dexie.Table<Record<string, unknown>, string>
  constructor() {
    super('studyflow')
    this.version(1).stores({
      goals: 'id, updatedAt',
      checkins: 'id, goalId, date, [goalId+date]',
      reviews: 'weekStart',
      settings: 'key',
    })
  }
}

/** v1 JSON 备份结构（无新实体数组） */
function v1Payload(): ExportPayloadInput {
  const goal = makeGoal({ id: 'old-goal', name: '旧目标' })
  return {
    app: 'studyflow',
    schemaVersion: 1,
    exportedAt: '2026-01-01T00:00:00.000Z',
    goals: [goal],
    checkins: [makeCheckin('old-goal', '2026-01-05', 10, { minutes: 20 })],
    reviews: [],
  }
}

beforeEach(async () => {
  await Dexie.delete('studyflow').catch(() => undefined)
})

afterEach(async () => {
  await Dexie.delete('studyflow').catch(() => undefined)
})

describe('无损迁移（阶段0验收）', () => {
  it('v1 旧库（旧打卡无 milestoneId）升级到 v2 后数据完整可读', async () => {
    // 1) 用 v1 schema 建库并写入旧数据
    const old = new V1Db()
    await old.open()
    await old.goals.add({ ...makeGoal({ id: 'g1', name: '升级前目标', totalAmount: 100 }), milestoneId: undefined })
    await old.checkins.add({ ...makeCheckin('g1', '2026-01-05', 30) })
    await old.checkins.add({ ...makeCheckin('g1', '2026-01-06', 20, { minutes: 25 }) })
    await old.settings.add({ key: 'app', value: { schemaVersion: 1, demoSeeded: true, lastSavedAt: null } })
    old.close()

    // 2) 用 v2 仓储打开 → Dexie 执行升级
    const repo = new WebIndexedDbRepository()
    await repo.init()
    const goals = await repo.getAllGoals()
    const checkins = await repo.getAllCheckins()
    expect(goals).toHaveLength(1)
    expect(goals[0].name).toBe('升级前目标')
    expect(checkins).toHaveLength(2)
    // 老打卡 milestoneId 归一化为 null（未归属阶段），总进度不受影响
    for (const c of checkins) expect(c.milestoneId ?? null).toBeNull()
    const done = checkins.reduce((s, c) => s + c.amount, 0)
    expect(done).toBe(50)
    // 新表可用且为空
    expect(await repo.getAllDailyPlans()).toEqual([])
    expect(await repo.getAllMilestones()).toEqual([])
    expect(await repo.getAllFocusSessions()).toEqual([])
    await repo.close()
  })

  it('v1 JSON 备份仍可导入（缺省新实体数组视为空）', async () => {
    const repo = new WebIndexedDbRepository()
    await repo.init()
    const result = await repo.replaceAll(v1Payload(), 'replace')
    expect(result.goals).toBe(1)
    expect(result.checkins).toBe(1)
    expect(await repo.getAllMilestones()).toEqual([])
    await repo.close()
  })

  it('v2 备份包含新实体；关联缺失的记录被拒绝', async () => {
    const repo = new WebIndexedDbRepository()
    await repo.init()
    const now = new Date().toISOString()
    const payload: ExportPayloadInput = {
      app: 'studyflow',
      schemaVersion: 2,
      exportedAt: now,
      goals: [makeGoal({ id: 'g2' })],
      checkins: [makeCheckin('g2', '2026-02-01', 5, { milestoneId: null })],
      reviews: [],
      dailyPlans: [
        { id: 'p1', goalId: 'g2', date: '2026-02-02', plannedAmount: 10, source: 'manual', isDemo: false, createdAt: now, updatedAt: now },
        { id: 'p-bad', goalId: 'ghost', date: '2026-02-02', plannedAmount: 10, source: 'auto', isDemo: false, createdAt: now, updatedAt: now },
      ],
      milestones: [
        { id: 'm1', goalId: 'g2', title: '第一阶段', plannedAmount: 50, startDate: null, dueDate: null, sortOrder: 0, color: null, isDemo: false, createdAt: now, updatedAt: now },
      ],
      milestoneSteps: [
        { id: 's1', milestoneId: 'm1', title: '看完第一章', isDone: false, doneAt: null, sortOrder: 0, createdAt: now, updatedAt: now },
        { id: 's-bad', milestoneId: 'ghost', title: '孤儿步骤', isDone: false, doneAt: null, sortOrder: 0, createdAt: now, updatedAt: now },
      ],
      focusSessions: [
        { id: 'f1', goalId: 'g2', milestoneId: null, startedAt: now, endedAt: now, plannedSeconds: 1500, focusedSeconds: 1500, status: 'completed', linkedCheckinId: null, pausedSeconds: 0, lastPauseAt: null, isDemo: false, createdAt: now, updatedAt: now },
      ],
      calendarPrefs: [{ goalId: 'g2', studyWeekdays: [1, 2, 3, 4, 5], excludedDates: [], dailyCap: null }],
    }
    const result = await repo.replaceAll(payload, 'replace')
    expect(result.goals).toBe(1)
    expect(result.skipped).toBeGreaterThanOrEqual(2) // ghost plan + ghost step
    expect((await repo.getAllDailyPlans()).map((p) => p.id)).toEqual(['p1'])
    expect((await repo.getAllMilestones()).map((m) => m.id)).toEqual(['m1'])
    expect((await repo.getAllMilestoneSteps()).map((s) => s.id)).toEqual(['s1'])
    expect(await repo.getAllFocusSessions()).toHaveLength(1)
    expect((await repo.getCalendarPref('g2'))?.studyWeekdays).toEqual([1, 2, 3, 4, 5])
    await repo.close()
  })

  it('删除目标级联清理新实体、打卡归属解除、专注历史保留', async () => {
    const repo = new WebIndexedDbRepository()
    await repo.init()
    const now = new Date().toISOString()
    await repo.createGoal(makeGoal({ id: 'g-del' }))
    await repo.createGoal(makeGoal({ id: 'g-keep' }))
    await repo.addCheckin(makeCheckin('g-del', '2026-02-01', 5, { milestoneId: null }))
    await repo.addCheckin(makeCheckin('g-keep', '2026-02-01', 5, { milestoneId: null }))
    await repo.upsertMilestones([
      { id: 'm-del', goalId: 'g-del', title: '阶段', plannedAmount: 10, startDate: null, dueDate: null, sortOrder: 0, color: null, isDemo: false, createdAt: now, updatedAt: now },
    ])
    await repo.upsertMilestoneSteps([
      { id: 'st1', milestoneId: 'm-del', title: '步骤', isDone: false, doneAt: null, sortOrder: 0, createdAt: now, updatedAt: now },
    ])
    await repo.upsertDailyPlans([
      { id: 'dp1', goalId: 'g-del', date: '2026-02-03', plannedAmount: 5, source: 'auto', isDemo: false, createdAt: now, updatedAt: now },
    ])
    await repo.upsertFocusSession({
      id: 'fs1', goalId: 'g-del', milestoneId: null, startedAt: now, endedAt: now, plannedSeconds: 1500,
      focusedSeconds: 600, status: 'completed', linkedCheckinId: null, pausedSeconds: 0, lastPauseAt: null,
      isDemo: false, createdAt: now, updatedAt: now,
    })

    await repo.deleteGoal('g-del')

    expect((await repo.getAllGoals()).map((g) => g.id)).toEqual(['g-keep'])
    const remaining = await repo.getAllCheckins()
    expect(remaining.map((c) => c.goalId)).toEqual(['g-keep'])
    expect(await repo.getAllMilestones()).toEqual([])
    expect(await repo.getAllMilestoneSteps()).toEqual([])
    expect(await repo.getAllDailyPlans()).toEqual([])
    // 专注历史保留但已解除归属
    const sessions = await repo.getAllFocusSessions()
    expect(sessions).toHaveLength(1)
    expect(sessions[0].goalId).toBeNull()
    await repo.close()
  })

  it('删除里程碑：关联打卡保留且 milestoneId 置空', async () => {
    const repo = new WebIndexedDbRepository()
    await repo.init()
    const now = new Date().toISOString()
    await repo.createGoal(makeGoal({ id: 'g3' }))
    await repo.upsertMilestones([
      { id: 'm-x', goalId: 'g3', title: '阶段X', plannedAmount: 10, startDate: null, dueDate: null, sortOrder: 0, color: null, isDemo: false, createdAt: now, updatedAt: now },
    ])
    await repo.addCheckin(makeCheckin('g3', '2026-02-01', 7, { milestoneId: 'm-x' }))
    await repo.deleteMilestone('m-x')
    const checkins = await repo.getAllCheckins()
    expect(checkins).toHaveLength(1)
    expect(checkins[0].amount).toBe(7)
    expect(checkins[0].milestoneId).toBeNull()
    await repo.close()
  })
})
