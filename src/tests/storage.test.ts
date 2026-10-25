import 'fake-indexeddb/auto'
import Dexie from 'dexie'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { WebIndexedDbRepository } from '../storage/indexeddb'
import type { ExportPayloadInput } from '../domain/validation'
import { makeCheckin, makeGoal } from './helpers'

/**
 * 存储契约测试（IndexedDB 实现）。
 * SQLite 实现与本文档化契约一致，但需要 Tauri 原生运行时（见 docs/BUILD_WINDOWS.md），
 * 在无 Rust 工具链的环境下无法自动化执行，属未在本机验证项。
 */

async function freshRepo(): Promise<WebIndexedDbRepository> {
  await Dexie.delete('studyflow').catch(() => undefined)
  const repo = new WebIndexedDbRepository()
  await repo.init()
  return repo
}

let repo: WebIndexedDbRepository | null = null

beforeEach(async () => {
  repo = await freshRepo()
})

afterEach(async () => {
  await repo?.close()
  repo = null
  await Dexie.delete('studyflow').catch(() => undefined)
})

describe('WebIndexedDbRepository 契约', () => {
  it('目标与打卡 CRUD，重新打开后数据仍在（持久化）', async () => {
    const r = repo!
    const goal = makeGoal({ id: 'goal-1', name: '背单词' })
    await r.createGoal(goal)
    await r.addCheckin(makeCheckin('goal-1', '2026-03-14', 20, { minutes: 30 }))
    await r.addCheckin(makeCheckin('goal-1', '2026-03-15', 25))

    // 模拟应用重启：关闭后重新打开同一个库
    await r.close()
    const reopened = new WebIndexedDbRepository()
    await reopened.init()
    const goals = await reopened.getAllGoals()
    const checkins = await reopened.getAllCheckins()
    expect(goals).toHaveLength(1)
    expect(goals[0].name).toBe('背单词')
    expect(checkins).toHaveLength(2)
    expect(checkins.find((c) => c.date === '2026-03-14')?.minutes).toBe(30)
    expect(checkins.find((c) => c.date === '2026-03-15')?.minutes).toBeNull()
    await reopened.close()
    repo = reopened
  })

  it('删除目标级联删除其打卡记录', async () => {
    const r = repo!
    const g1 = makeGoal({ id: 'g1' })
    const g2 = makeGoal({ id: 'g2' })
    await r.createGoal(g1)
    await r.createGoal(g2)
    await r.addCheckin(makeCheckin('g1', '2026-03-14', 10))
    await r.addCheckin(makeCheckin('g1', '2026-03-15', 10))
    await r.addCheckin(makeCheckin('g2', '2026-03-15', 5))
    await r.deleteGoal('g1')
    expect(await r.getAllGoals()).toHaveLength(1)
    const remaining = await r.getAllCheckins()
    expect(remaining).toHaveLength(1)
    expect(remaining[0].goalId).toBe('g2')
  })

  it('设置读写：单行 upsert（写入时归一到当前 schema 版本）', async () => {
    const r = repo!
    expect(await r.getSettings()).toBeNull()
    await r.saveSettings({ schemaVersion: 1, demoSeeded: true, lastSavedAt: '2026-03-15T08:00:00Z' })
    expect(await r.getSettings()).toEqual({ schemaVersion: 4, demoSeeded: true, lastSavedAt: '2026-03-15T08:00:00Z' })
    await r.saveSettings({ schemaVersion: 1, demoSeeded: true, lastSavedAt: '2026-03-15T09:00:00Z' })
    expect((await r.getSettings())?.lastSavedAt).toBe('2026-03-15T09:00:00Z')
  })

  it('周复盘按 weekStart upsert，不重复插入', async () => {
    const r = repo!
    const mk = (text: string, updated: string) => ({
      id: 'review-1',
      weekStart: '2026-03-09',
      keep: text,
      problem: '',
      tryNext: '',
      nextPlan: '',
      createdAt: '2026-03-15T10:00:00Z',
      updatedAt: updated,
    })
    await r.upsertWeeklyReview(mk('第一版', '2026-03-15T10:00:00Z'))
    await r.upsertWeeklyReview(mk('第二版', '2026-03-15T11:00:00Z'))
    const review = await r.getWeeklyReview('2026-03-09')
    expect(review?.keep).toBe('第二版')
    expect((await r.getAllReviews())).toHaveLength(1)
  })

  it('clearDemoData 只清除示例，不动用户自建内容', async () => {
    const r = repo!
    const demo = makeGoal({ id: 'demo-1', isDemo: true, name: '示例目标' })
    const user = makeGoal({ id: 'user-1', isDemo: false, name: '我的目标' })
    await r.createGoal(demo)
    await r.createGoal(user)
    await r.addCheckin(makeCheckin('demo-1', '2026-03-14', 10, { isDemo: true }))
    await r.addCheckin(makeCheckin('user-1', '2026-03-14', 10))
    await r.clearDemoData()
    const goals = await r.getAllGoals()
    expect(goals).toHaveLength(1)
    expect(goals[0].id).toBe('user-1')
    expect(await r.getAllCheckins()).toHaveLength(1)
  })

  it('clearAll 清空全部数据', async () => {
    const r = repo!
    await r.createGoal(makeGoal({ id: 'g1' }))
    await r.addCheckin(makeCheckin('g1', '2026-03-14', 10))
    await r.upsertWeeklyReview({
      id: 'r1', weekStart: '2026-03-09', keep: 'k', problem: '', tryNext: '', nextPlan: '',
      createdAt: '', updatedAt: '',
    })
    await r.saveSettings({ schemaVersion: 1, demoSeeded: true, lastSavedAt: null })
    await r.clearAll()
    expect(await r.getAllGoals()).toEqual([])
    expect(await r.getAllCheckins()).toEqual([])
    expect(await r.getAllReviews()).toEqual([])
    expect(await r.getSettings()).toBeNull()
  })

  it('导入 merge：跳过重复 ID、拒绝关联缺失的记录，保留现有数据', async () => {
    const r = repo!
    const existing = makeGoal({ id: 'g-keep', name: '现有目标' })
    await r.createGoal(existing)
    await r.addCheckin({ ...makeCheckin('g-keep', '2026-03-13', 10), id: 'ck-existing' })
    const payload: ExportPayloadInput = {
      app: 'studyflow',
      schemaVersion: 1,
      exportedAt: '2026-03-15T00:00:00Z',
      goals: [existing, makeGoal({ id: 'g-new', name: '新目标' })],
      checkins: [
        makeCheckin('g-keep', '2026-03-15', 5), // 新 id、关联存在 → 导入
        { ...makeCheckin('g-keep', '2026-03-14', 10), id: 'ck-existing' }, // 重复 id → 跳过
        makeCheckin('g-ghost', '2026-03-14', 99), // 关联缺失 → 拒绝
      ],
      reviews: [],
    }
    const result = await r.replaceAll(payload, 'merge')
    expect(result.goals).toBe(1) // 只有 g-new 新增
    expect(result.checkins).toBe(1)
    expect(result.skipped).toBe(3) // 重复目标 + 重复打卡 id + 关联缺失
    const goals = await r.getAllGoals()
    expect(goals.map((g) => g.id).sort()).toEqual(['g-keep', 'g-new'])
    const checkins = await r.getAllCheckins()
    expect(checkins).toHaveLength(2)
    expect(checkins.some((c) => c.goalId === 'g-ghost')).toBe(false)
  })

  it('导入 replace：整库替换', async () => {
    const r = repo!
    await r.createGoal(makeGoal({ id: 'old' }))
    const payload: ExportPayloadInput = {
      app: 'studyflow',
      schemaVersion: 1,
      exportedAt: '2026-03-15T00:00:00Z',
      goals: [makeGoal({ id: 'new-1', name: '替换后' })],
      checkins: [makeCheckin('new-1', '2026-03-15', 8)],
      reviews: [],
    }
    const result = await r.replaceAll(payload, 'replace')
    expect(result.goals).toBe(1)
    const goals = await r.getAllGoals()
    expect(goals).toHaveLength(1)
    expect(goals[0].id).toBe('new-1')
    expect(await r.getAllCheckins()).toHaveLength(1)
  })
})
