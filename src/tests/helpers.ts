import type { Checkin, Goal } from '../domain/types'

let seq = 0

export function makeGoal(p: Partial<Goal> = {}): Goal {
  seq++
  return {
    id: p.id ?? `goal-${seq}`,
    name: p.name ?? `目标${seq}`,
    unit: p.unit ?? '词',
    totalAmount: p.totalAmount ?? 100,
    startDate: p.startDate ?? '2026-01-01',
    deadline: p.deadline ?? '2026-04-01',
    color: p.color ?? 'violet',
    obstacle: p.obstacle ?? null,
    ifThenPlan: p.ifThenPlan ?? null,
    weeklyRestEnabled: p.weeklyRestEnabled ?? true,
    isDemo: p.isDemo ?? false,
    createdAt: p.createdAt ?? '2026-01-01T08:00:00.000Z',
    updatedAt: p.updatedAt ?? '2026-01-01T08:00:00.000Z',
    ...p,
  }
}

export function makeCheckin(goalId: string, date: string, amount: number, p: Partial<Checkin> = {}): Checkin {
  seq++
  return {
    id: p.id ?? `checkin-${seq}`,
    goalId,
    date,
    amount,
    minutes: p.minutes ?? null,
    note: p.note ?? null,
    isBackfill: p.isBackfill ?? false,
    isDemo: p.isDemo ?? false,
    milestoneId: p.milestoneId ?? null,
    createdAt: p.createdAt ?? `${date}T12:00:00.000Z`,
    updatedAt: p.updatedAt ?? `${date}T12:00:00.000Z`,
    ...p,
  }
}
