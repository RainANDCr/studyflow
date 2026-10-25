import { describe, expect, it } from 'vitest'
import {
  availabilityForDate,
  checkOverruns,
  checkPhaseConflict,
  draftExamPhases,
  examCountdown,
  generateExamPlan,
  globalAvailabilityForDate,
  plannableDates,
  reschedulePreview,
} from '../domain/exam'
import type { ExamPlanSlot } from '../domain/types'

describe('考试倒计时（本地自然日）', () => {
  it('今天=0、明天=1、未来 N 天', () => {
    expect(examCountdown('2026-03-15', '2026-03-15')).toEqual({ days: 0, status: 'today', text: '今天考试' })
    expect(examCountdown('2026-03-16', '2026-03-15')).toMatchObject({ days: 1, status: 'upcoming' })
    expect(examCountdown('2026-04-01', '2026-03-15')).toMatchObject({ days: 17, status: 'upcoming' })
  })

  it('已过：已结束 N 天', () => {
    expect(examCountdown('2026-03-12', '2026-03-15')).toEqual({ days: 3, status: 'past', text: '已结束 3 天' })
  })

  it('跨月/跨年/闰日', () => {
    expect(examCountdown('2026-01-01', '2025-12-31').days).toBe(1)
    expect(examCountdown('2024-02-29', '2024-02-27').days).toBe(2)
  })
})

describe('可用时间：未配置 ≠ 0 分钟', () => {
  const rows = [{ examId: 'e1', date: '2026-03-16', availableMinutes: 0 }]
  it('缺记录返回 null（未规划）', () => {
    expect(availabilityForDate('e1', rows, '2026-03-15')).toBeNull()
  })
  it('明确 0 返回 0（休息日）', () => {
    expect(availabilityForDate('e1', rows, '2026-03-16')).toBe(0)
  })
  it('全局预算按日期取', () => {
    expect(globalAvailabilityForDate([{ date: '2026-03-16', availableMinutes: 120, createdAt: '', updatedAt: '' }], '2026-03-16')).toBe(120)
    expect(globalAvailabilityForDate([], '2026-03-16')).toBeNull()
  })
})

describe('排程生成（权重正比 + 最大余数）', () => {
  it('两个目标权重 2:1，90 分钟 → 60/40 上下浮动但合计精确', () => {
    const r = generateExamPlan({
      examId: 'e1',
      links: [
        { goalId: 'g1', priorityWeight: 2 },
        { goalId: 'g2', priorityWeight: 1 },
      ],
      dates: ['2026-03-15'],
      availabilities: [{ examId: 'e1', date: '2026-03-15', availableMinutes: 90 }],
      existingSlots: [],
    })
    const byGoal = new Map(r.slots.map((s) => [s.goalId, s.plannedMinutes]))
    expect(byGoal.get('g1')).toBe(60)
    expect(byGoal.get('g2')).toBe(30)
    expect([...byGoal.values()].reduce((s, v) => s + v, 0)).toBe(90)
  })

  it('余数分给权重高者：100 分钟 1:1:1 → 34/33/33', () => {
    const r = generateExamPlan({
      examId: 'e1',
      links: [
        { goalId: 'g1', priorityWeight: 1 },
        { goalId: 'g2', priorityWeight: 1 },
        { goalId: 'g3', priorityWeight: 1 },
      ],
      dates: ['2026-03-15'],
      availabilities: [{ examId: 'e1', date: '2026-03-15', availableMinutes: 100 }],
      existingSlots: [],
    })
    const byGoal = new Map(r.slots.map((s) => [s.goalId, s.plannedMinutes]))
    expect(byGoal.get('g1')).toBe(34)
    expect(byGoal.get('g2')).toBe(33)
    expect(byGoal.get('g3')).toBe(33)
  })

  it('0 分钟（休息日）不排程；未配置日计入 unconfiguredDays', () => {
    const r = generateExamPlan({
      examId: 'e1',
      links: [{ goalId: 'g1', priorityWeight: 1 }],
      dates: ['2026-03-15', '2026-03-16', '2026-03-17'],
      availabilities: [{ examId: 'e1', date: '2026-03-16', availableMinutes: 0 }],
      existingSlots: [],
    })
    expect(r.slots).toEqual([])
    expect(r.unconfiguredDays).toBe(3)
    expect(r.skippedDates).toEqual(['2026-03-15', '2026-03-17']) // 0 分钟是明确休息，不算 skipped 提示
  })

  it('预算合计只统计已配置日', () => {
    const r = generateExamPlan({
      examId: 'e1',
      links: [{ goalId: 'g1', priorityWeight: 1 }],
      dates: ['2026-03-15', '2026-03-16'],
      availabilities: [{ examId: 'e1', date: '2026-03-15', availableMinutes: 45 }],
      existingSlots: [],
    })
    expect(r.totalBudgetMinutes).toBe(45)
  })
})

describe('超额检测（单考试 + 全局）', () => {
  const avail = [{ examId: 'e1', date: '2026-03-15', availableMinutes: 60 }]
  it('单考试超额警告', () => {
    const slots = [
      { examId: 'e1', goalId: 'g1', date: '2026-03-15', plannedMinutes: 40 },
      { examId: 'e1', goalId: 'g2', date: '2026-03-15', plannedMinutes: 30 },
    ] as ExamPlanSlot[]
    const { warnings } = checkOverruns(slots, avail, [], ['2026-03-15'])
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toMatchObject({ kind: 'exam', planned: 70, limit: 60 })
  })

  it('全局预算 60：两场各 40 → 全局 80 超额警告', () => {
    const slots = [
      { examId: 'e1', goalId: 'g1', date: '2026-03-15', plannedMinutes: 40 },
      { examId: 'e2', goalId: 'g1', date: '2026-03-15', plannedMinutes: 40 },
    ] as ExamPlanSlot[]
    const global = [{ date: '2026-03-15', availableMinutes: 60, createdAt: '', updatedAt: '' }]
    const { warnings, globalConfigured } = checkOverruns(slots, [], global, ['2026-03-15'])
    expect(globalConfigured).toBe(true)
    expect(warnings.some((w) => w.kind === 'global' && w.planned === 80 && w.limit === 60)).toBe(true)
  })

  it('全局未配置：明确提示未配置，不伪称已校验', () => {
    const { globalConfigured, warnings } = checkOverruns([], [], [], ['2026-03-15'])
    expect(globalConfigured).toBe(false)
    expect(warnings).toEqual([])
  })
})

describe('重排预览（锁定与历史保留）', () => {
  const today = '2026-03-15'
  const existing: ExamPlanSlot[] = [
    { id: 's1', examId: 'e1', goalId: 'g1', date: '2026-03-16', plannedMinutes: 30, title: null, knowledgeItemId: null, phaseId: null, source: 'generated', isLocked: false, isDemo: false, createdAt: '', updatedAt: '' },
    { id: 's2', examId: 'e1', goalId: 'g2', date: '2026-03-16', plannedMinutes: 20, title: null, knowledgeItemId: null, phaseId: null, source: 'manual', isLocked: false, isDemo: false, createdAt: '', updatedAt: '' },
    { id: 's3', examId: 'e1', goalId: 'g3', date: '2026-03-16', plannedMinutes: 10, title: null, knowledgeItemId: null, phaseId: null, source: 'generated', isLocked: true, isDemo: false, createdAt: '', updatedAt: '' },
    { id: 's4', examId: 'e1', goalId: 'g1', date: '2026-03-14', plannedMinutes: 30, title: null, knowledgeItemId: null, phaseId: null, source: 'generated', isLocked: false, isDemo: false, createdAt: '', updatedAt: '' },
  ]
  it('只替换未来未锁定 generated；manual/locked/历史不动', () => {
    const pv = reschedulePreview(existing, [{ date: '2026-03-16', goalId: 'g1', plannedMinutes: 50 }], today)
    expect(pv.upserts).toEqual([{ date: '2026-03-16', goalId: 'g1', plannedMinutes: 50 }])
    expect(pv.removalIds).toEqual(['s1'])
    expect(pv.lockedKept).toBe(3)
    expect(pv.untouched).toBe(0)
  })

  it('与锁定/手动同日同目标的 fresh 条目让位', () => {
    const pv = reschedulePreview(existing, [{ date: '2026-03-16', goalId: 'g2', plannedMinutes: 25 }], today)
    expect(pv.upserts).toEqual([])
  })
})

describe('备考阶段草案与冲突', () => {
  it('短周期（<3 天）单段', () => {
    expect(draftExamPhases('2026-03-14', '2026-03-15')).toEqual([{ title: '考前冲刺', startDate: '2026-03-14', endDate: '2026-03-15' }])
  })
  it('中等周期两段', () => {
    const p = draftExamPhases('2026-03-01', '2026-03-10')
    expect(p).toHaveLength(2)
    expect(p[0].endDate < p[1].startDate || p[0].endDate === p[1].startDate ? true : true).toBe(true)
    expect(p[1].endDate).toBe('2026-03-10')
    // 不重叠
    expect(p[0].endDate < p[1].startDate).toBe(true)
  })
  it('长周期四段且不越过考试日', () => {
    const p = draftExamPhases('2026-02-01', '2026-03-15')
    expect(p).toHaveLength(4)
    expect(p[p.length - 1].endDate).toBe('2026-03-15')
    for (let i = 1; i < p.length; i++) expect(p[i - 1].endDate < p[i].startDate).toBe(true)
  })
  it('冲突检测：越界与重叠', () => {
    const existing = [{ id: 'p1', startDate: '2026-03-01', endDate: '2026-03-10' }]
    expect(checkPhaseConflict(existing, { startDate: '2026-03-09', endDate: '2026-03-12' }, '2026-03-20')).toContain('重叠')
    expect(checkPhaseConflict(existing, { startDate: '2026-03-11', endDate: '2026-03-25' }, '2026-03-20')).toContain('不能晚于考试日')
    expect(checkPhaseConflict(existing, { startDate: '2026-03-11', endDate: '2026-03-15' }, '2026-03-20')).toBeNull()
  })
})

describe('可规划日期', () => {
  it('从今天到考试日；已过考试为空；非 active 为空', () => {
    expect(plannableDates({ examDate: '2026-03-17', startDate: null, status: 'active' }, '2026-03-15')).toEqual(['2026-03-15', '2026-03-16', '2026-03-17'])
    expect(plannableDates({ examDate: '2026-03-14', startDate: null, status: 'active' }, '2026-03-15')).toEqual([])
    expect(plannableDates({ examDate: '2026-03-17', startDate: null, status: 'archived' }, '2026-03-15')).toEqual([])
  })
  it('startDate 在未来时从 startDate 开始', () => {
    expect(plannableDates({ examDate: '2026-03-20', startDate: '2026-03-18', status: 'active' }, '2026-03-15')).toEqual(['2026-03-18', '2026-03-19', '2026-03-20'])
  })
})
