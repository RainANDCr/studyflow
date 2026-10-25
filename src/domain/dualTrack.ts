import type { Checkin, DateStr, Goal, KnowledgeItem, MasteryAssessment, MasteryRating, Milestone } from './types'
import { computeGoalProgress, type GoalProgress } from './progress'
import { round2 } from './milestone'

/**
 * 双轨进度计算契约（纯函数）。
 *
 * 轨道 A「内容完成率」：唯一来源是既有 computeGoalProgress（Σ Checkin.amount / totalAmount），
 * 不因知识点勾选、自评或专注时间变化。
 * 轨道 B「掌握覆盖率」：分母 = 未归档 KnowledgeItem 的权重和（weight 必须有限正数）；
 * 每个知识点取最新有效评估（按 assessedAt + id 稳定排序）：
 *   rating >= 3 → 已掌握；0–2 → 待巩固；无评估 → 待评估。
 * 无知识点 → 两项覆盖率均为 null（UI 显示「暂无掌握数据」，绝不渲染编造的 0%/100%）；
 * 有知识点但全部未评估 → masteryCoverage = 0 且全部计入「待评估」（区别于未建立）。
 */

export function getLatestAssessment(itemId: string, assessments: MasteryAssessment[]): MasteryAssessment | null {
  const list = assessments
    .filter((a) => a.knowledgeItemId === itemId)
    .sort((a, b) => {
      if (a.assessedAt !== b.assessedAt) return a.assessedAt < b.assessedAt ? -1 : 1
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
    })
  return list.length > 0 ? list[list.length - 1] : null
}

export function getItemCurrentRating(itemId: string, assessments: MasteryAssessment[]): MasteryRating | null {
  return getLatestAssessment(itemId, assessments)?.rating ?? null
}

export type MasteryBucket = 'mastered' | 'weak' | 'unevaluated'

export function bucketOf(rating: MasteryRating | null): MasteryBucket {
  if (rating === null) return 'unevaluated'
  return rating >= 3 ? 'mastered' : 'weak'
}

export interface ItemMasteryState {
  item: KnowledgeItem
  rating: MasteryRating | null
  bucket: MasteryBucket
  /** 评估条数 */
  assessmentCount: number
}

export interface MasteryStats {
  /** 无未归档知识点时为 false（UI 显示「暂无掌握数据」） */
  hasItems: boolean
  totalWeight: number
  masteredWeight: number
  assessedWeight: number
  /** null = 无知识点；0–100 */
  masteryCoverage: number | null
  /** 辅助指标：已评估权重占比 */
  assessmentCoverage: number | null
  counts: { mastered: number; weak: number; unevaluated: number; total: number }
  byItem: ItemMasteryState[]
}

export function getMasteryStats(items: KnowledgeItem[], assessments: MasteryAssessment[]): MasteryStats {
  const active = items.filter((i) => !i.isArchived && Number.isFinite(i.weight) && i.weight > 0)
  const byItem: ItemMasteryState[] = active.map((item) => {
    const rating = getItemCurrentRating(item.id, assessments)
    return {
      item,
      rating,
      bucket: bucketOf(rating),
      assessmentCount: assessments.filter((a) => a.knowledgeItemId === item.id).length,
    }
  })
  if (active.length === 0) {
    return {
      hasItems: false,
      totalWeight: 0,
      masteredWeight: 0,
      assessedWeight: 0,
      masteryCoverage: null,
      assessmentCoverage: null,
      counts: { mastered: 0, weak: 0, unevaluated: 0, total: 0 },
      byItem: [],
    }
  }
  const totalWeight = round2(active.reduce((s, i) => s + i.weight, 0))
  const masteredWeight = round2(byItem.filter((x) => x.bucket === 'mastered').reduce((s, x) => s + x.item.weight, 0))
  const assessedWeight = round2(byItem.filter((x) => x.bucket !== 'unevaluated').reduce((s, x) => s + x.item.weight, 0))
  const counts = {
    mastered: byItem.filter((x) => x.bucket === 'mastered').length,
    weak: byItem.filter((x) => x.bucket === 'weak').length,
    unevaluated: byItem.filter((x) => x.bucket === 'unevaluated').length,
    total: active.length,
  }
  return {
    hasItems: true,
    totalWeight,
    masteredWeight,
    assessedWeight,
    masteryCoverage: totalWeight > 0 ? round2((masteredWeight / totalWeight) * 100) : null,
    assessmentCoverage: totalWeight > 0 ? round2((assessedWeight / totalWeight) * 100) : null,
    counts,
    byItem,
  }
}

/** 目标维度：内容完成率（轨道 A）+ 掌握覆盖率（轨道 B） */
export function getDualTrackStats(
  goal: Goal,
  checkins: Checkin[],
  items: KnowledgeItem[],
  assessments: MasteryAssessment[],
): { content: GoalProgress; mastery: MasteryStats } {
  const goalItems = items.filter((i) => i.goalId === goal.id)
  return {
    content: computeGoalProgress(goal, checkins.filter((c) => c.goalId === goal.id)),
    mastery: getMasteryStats(goalItems, assessments),
  }
}

/** 里程碑维度的知识点掌握情况（里程碑量化进度仍只来自其 Checkin，不在此处） */
export function getMilestoneKnowledge(
  milestone: Milestone,
  items: KnowledgeItem[],
  assessments: MasteryAssessment[],
): MasteryStats {
  return getMasteryStats(items.filter((i) => i.milestoneId === milestone.id), assessments)
}

/** 薄弱项队列排序（可解释）：待评估单列；待巩固按「等级低 → 久未评估」优先；已掌握垫底 */
export function sortWeakItems(
  states: ItemMasteryState[],
  assessments: MasteryAssessment[],
  today: DateStr,
): Array<ItemMasteryState & { reason: string }> {
  const rank = (b: MasteryBucket, rating: MasteryRating | null): number => {
    if (b === 'unevaluated') return 1
    if (b === 'weak') return 2 + (2 - (rating ?? 0)) // rating 0 → 4, 2 → 2
    return 9
  }
  return states
    .map((st) => {
      let reason: string
      if (st.bucket === 'unevaluated') reason = '尚未自评，建议先做一次评估'
      else if (st.bucket === 'weak') {
        const latest = getLatestAssessment(st.item.id, assessments)
        const daysAgo = latest ? Math.max(0, daysBetween(latest.localDate, today)) : null
        reason = `自评 ${st.rating} 分${daysAgo !== null ? `，距今 ${daysAgo} 天` : ''}`
      } else reason = `已掌握（自评 ${st.rating} 分）`
      return { ...st, reason }
    })
    .sort((a, b) => {
      const ra = rank(a.bucket, a.rating)
      const rb = rank(b.bucket, b.rating)
      if (ra !== rb) return ra - rb
      return a.item.sortOrder - b.item.sortOrder
    })
}

function daysBetween(a: string, b: string): number {
  const [ay, am, ad] = a.split('-').map(Number)
  const [by, bm, bd] = b.split('-').map(Number)
  return Math.round((new Date(by, bm - 1, bd).getTime() - new Date(ay, am - 1, ad).getTime()) / 86_400_000)
}
