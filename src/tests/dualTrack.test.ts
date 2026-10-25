import { describe, expect, it } from 'vitest'
import { bucketOf, getDualTrackStats, getLatestAssessment, getItemCurrentRating, getMasteryStats } from '../domain/dualTrack'
import { makeCheckin, makeGoal } from './helpers'
import type { KnowledgeItem, MasteryAssessment } from '../domain/types'

function item(p: Partial<KnowledgeItem>): KnowledgeItem {
  return {
    id: p.id ?? 'k1',
    goalId: p.goalId ?? 'g1',
    milestoneId: p.milestoneId ?? null,
    title: p.title ?? '链表',
    description: p.description ?? null,
    weight: p.weight ?? 1,
    sortOrder: p.sortOrder ?? 0,
    isArchived: p.isArchived ?? false,
    isDemo: p.isDemo ?? false,
    createdAt: '',
    updatedAt: '',
    ...p,
  }
}

function assess(p: Partial<MasteryAssessment>): MasteryAssessment {
  return {
    id: p.id ?? 'a1',
    knowledgeItemId: p.knowledgeItemId ?? 'k1',
    rating: (p.rating ?? 3) as MasteryAssessment['rating'],
    assessedAt: p.assessedAt ?? '2026-03-15T10:00:00.000Z',
    localDate: p.localDate ?? '2026-03-15',
    note: p.note ?? null,
    source: 'self',
    isDemo: false,
    createdAt: p.assessedAt ?? '2026-03-15T10:00:00.000Z',
    ...p,
  }
}

describe('掌握覆盖率计算契约', () => {
  it('无知识点：两项覆盖率均为 null（不是 0%）', () => {
    const st = getMasteryStats([], [])
    expect(st.hasItems).toBe(false)
    expect(st.masteryCoverage).toBeNull()
    expect(st.assessmentCoverage).toBeNull()
  })

  it('4 个等权知识点评估 4/3/2/未评估 → 掌握 50%、已评估 75%', () => {
    const items = ['k1', 'k2', 'k3', 'k4'].map((id) => item({ id }))
    const assessments = [
      assess({ id: 'a1', knowledgeItemId: 'k1', rating: 4 }),
      assess({ id: 'a2', knowledgeItemId: 'k2', rating: 3 }),
      assess({ id: 'a3', knowledgeItemId: 'k3', rating: 2 }),
    ]
    const st = getMasteryStats(items, assessments)
    expect(st.masteryCoverage).toBe(50)
    expect(st.assessmentCoverage).toBe(75)
    expect(st.counts).toEqual({ mastered: 2, weak: 1, unevaluated: 1, total: 4 })
  })

  it('更新第三项 2→3 → 75% / 75%', () => {
    const items = ['k1', 'k2', 'k3', 'k4'].map((id) => item({ id }))
    const assessments = [
      assess({ id: 'a1', knowledgeItemId: 'k1', rating: 4 }),
      assess({ id: 'a2', knowledgeItemId: 'k2', rating: 3 }),
      assess({ id: 'a3', knowledgeItemId: 'k3', rating: 3 }),
    ]
    const st = getMasteryStats(items, assessments)
    expect(st.masteryCoverage).toBe(75)
    expect(st.assessmentCoverage).toBe(75)
  })

  it('有权重但全部未评估：掌握 0% + 全部待评估（区别于未建立）', () => {
    const st = getMasteryStats([item({ id: 'k1' }), item({ id: 'k2' })], [])
    expect(st.hasItems).toBe(true)
    expect(st.masteryCoverage).toBe(0)
    expect(st.assessmentCoverage).toBe(0)
    expect(st.counts.unevaluated).toBe(2)
  })

  it('同点多次评估 4→1→3 取最新；按 assessedAt+id 稳定排序', () => {
    const assessments = [
      assess({ id: 'a1', rating: 4, assessedAt: '2026-03-10T08:00:00.000Z' }),
      assess({ id: 'a2', rating: 1, assessedAt: '2026-03-12T08:00:00.000Z' }),
      assess({ id: 'a3', rating: 3, assessedAt: '2026-03-14T08:00:00.000Z' }),
    ]
    expect(getItemCurrentRating('k1', assessments)).toBe(3)
    // 同 assessedAt 时按 id 决胜（稳定）
    const tie = [assess({ id: 'b', rating: 2, assessedAt: '2026-03-15T08:00:00.000Z' }), assess({ id: 'a', rating: 4, assessedAt: '2026-03-15T08:00:00.000Z' })]
    expect(getLatestAssessment('k1', tie)?.id).toBe('b')
  })

  it('删除最后一条评估 → 回退到前一条结果', () => {
    const assessments = [
      assess({ id: 'a1', rating: 1, assessedAt: '2026-03-10T08:00:00.000Z' }),
      assess({ id: 'a2', rating: 4, assessedAt: '2026-03-12T08:00:00.000Z' }),
    ]
    expect(getItemCurrentRating('k1', assessments)).toBe(4)
    const afterDelete = assessments.filter((a) => a.id !== 'a2')
    expect(getItemCurrentRating('k1', afterDelete)).toBe(1)
  })

  it('权重 1→2 影响百分比，但 Checkin/Goal 完成量完全不变', () => {
    const goal = makeGoal({ id: 'g1', totalAmount: 100 })
    const checkins = [makeCheckin('g1', '2026-03-01', 50)]
    const items = [item({ id: 'k1', weight: 1, goalId: 'g1' }), item({ id: 'k2', weight: 1, goalId: 'g1' })]
    const assessments = [assess({ id: 'a1', knowledgeItemId: 'k1', rating: 4 })]
    const before = getDualTrackStats(goal, checkins, items, assessments)
    expect(before.content.done).toBe(50)
    expect(before.mastery.masteryCoverage).toBe(50)
    const items2 = items.map((i) => (i.id === 'k1' ? { ...i, weight: 2 } : i))
    const after = getDualTrackStats(goal, checkins, items2, assessments)
    expect(after.content.done).toBe(50) // 内容轨道不变
    expect(after.mastery.masteryCoverage).toBe(66.67) // 2/3 权重
  })

  it('归档知识点退出分母，保留历史', () => {
    const items = [item({ id: 'k1' }), item({ id: 'k2', isArchived: true })]
    const assessments = [assess({ id: 'a1', knowledgeItemId: 'k1', rating: 4 }), assess({ id: 'a2', knowledgeItemId: 'k2', rating: 0 })]
    const st = getMasteryStats(items, assessments)
    expect(st.counts.total).toBe(1)
    expect(st.masteryCoverage).toBe(100)
    expect(st.counts.weak).toBe(0) // k2 已归档不计
  })

  it('bucketOf 分档', () => {
    expect(bucketOf(null)).toBe('unevaluated')
    expect(bucketOf(0)).toBe('weak')
    expect(bucketOf(2)).toBe('weak')
    expect(bucketOf(3)).toBe('mastered')
    expect(bucketOf(4)).toBe('mastered')
  })

  it('无效权重被忽略（防御 NaN）', () => {
    const st = getMasteryStats([item({ id: 'k1', weight: Number.NaN }), item({ id: 'k2', weight: 1 })], [assess({ id: 'a1', knowledgeItemId: 'k2', rating: 3 })])
    expect(st.counts.total).toBe(1)
    expect(st.masteryCoverage).toBe(100)
  })
})
