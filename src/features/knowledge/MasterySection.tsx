import { useMemo, useState } from 'react'
import type { Goal } from '../../domain/types'
import { getDualTrackStats } from '../../domain/dualTrack'
import { useAppData } from '../../state/AppData'
import { Button, ProgressBar } from '../../components/ui'
import { IconPlus } from '../../components/icons'
import { KnowledgeManager } from './KnowledgeManager'

/**
 * 看板目标详情的「双轨进度」区块：
 * 轨道 A 内容完成率（紫，原算法）+ 轨道 B 知识掌握覆盖率（绿，真实自评）。
 * 无知识点显示「尚未建立知识点」，绝不渲染编造的 0%/100%。
 */
export function MasterySection({ goal }: { goal: Goal }) {
  const { checkins, knowledgeItems, assessments } = useAppData()
  const [managerOpen, setManagerOpen] = useState(false)
  const [managerFilter, setManagerFilter] = useState<'all' | 'weak'>('all')

  const { content, mastery } = useMemo(
    () => getDualTrackStats(goal, checkins, knowledgeItems, assessments),
    [goal, checkins, knowledgeItems, assessments],
  )

  const openManager = (filter: 'all' | 'weak') => {
    setManagerFilter(filter)
    setManagerOpen(true)
  }

  return (
    <div className="border-t border-line/70 px-4 py-3">
      <p className="mb-2.5 text-xs font-semibold text-ink2">双轨进度 · 内容完成 ≠ 知识掌握</p>
      {!mastery.hasItems ? (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-dashed border-line px-3 py-2.5">
          <p className="text-xs text-ink3">尚未建立知识点。为该目标定义知识点并通过真实自评，可获得「掌握覆盖率」。</p>
          <Button size="sm" variant="secondary" onClick={() => openManager('all')}>
            <IconPlus /> 添加知识点
          </Button>
        </div>
      ) : (
        <div className="space-y-2.5">
          <div>
            <div className="mb-1 flex items-center justify-between text-[11px]">
              <span className="text-ink2">内容完成率（打卡量）</span>
              <span className="tnum font-semibold text-ink">{Math.round(content.percentCapped)}%</span>
            </div>
            <ProgressBar percent={content.percentCapped} color={goal.color} />
          </div>
          <div>
            <div className="mb-1 flex items-center justify-between text-[11px]">
              <span className="text-ink2">知识掌握覆盖率（自评 ≥3 分为已掌握）</span>
              <span className="tnum font-semibold text-ok">{mastery.masteryCoverage}%</span>
            </div>
            <ProgressBar percent={mastery.masteryCoverage ?? 0} color="emerald" />
          </div>
          <p className="tnum flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-[11px] text-ink3">
            <span>{mastery.counts.total} 个知识点</span>
            <span className="text-ok">已掌握 {mastery.counts.mastered}</span>
            <span className="text-warn">待巩固 {mastery.counts.weak}</span>
            <span>待评估 {mastery.counts.unevaluated}</span>
            <span>已评估覆盖率 {mastery.assessmentCoverage}%（权重计）</span>
          </p>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="secondary" onClick={() => openManager('all')}>
              知识点管理 / 自测
            </Button>
            {mastery.counts.weak + mastery.counts.unevaluated > 0 && (
              <Button size="sm" variant="ghost" onClick={() => openManager('weak')}>
                复习薄弱项（{mastery.counts.weak + mastery.counts.unevaluated}）
              </Button>
            )}
          </div>
        </div>
      )}
      <KnowledgeManager open={managerOpen} onClose={() => setManagerOpen(false)} goal={goal} initialFilter={managerFilter} />
    </div>
  )
}
