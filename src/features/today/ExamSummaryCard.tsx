import { useMemo } from 'react'
import { useAppData } from '../../state/AppData'
import { examCountdown } from '../../domain/exam'
import { formatMD } from '../../domain/dates'
import { Card } from '../../components/ui'
import { IconCalendar } from '../../components/icons'

/** 今日页「考试冲刺」摘要卡：最近 2 场 active 考试的倒计时与今日计划分钟；无考试不占位。 */
export function ExamSummaryCard({ onOpen }: { onOpen: () => void }) {
  const { exams, examPlanSlots, today } = useAppData()

  const active = useMemo(
    () =>
      exams
        .filter((e) => e.status === 'active' && e.examDate >= today)
        .sort((a, b) => a.examDate.localeCompare(b.examDate))
        .slice(0, 2),
    [exams, today],
  )

  if (active.length === 0) return null

  return (
    <Card className="px-4 py-3.5">
      <button type="button" className="w-full text-left" onClick={onOpen} aria-label="进入考试冲刺">
        <div className="mb-2 flex items-center gap-2">
          <IconCalendar className="text-primary" />
          <span className="text-xs font-semibold text-ink2">考试冲刺</span>
          <span className="ml-auto text-[11px] text-primary">进入 →</span>
        </div>
        <div className={active.length > 1 ? 'grid grid-cols-2 gap-3' : ''}>
          {active.map((e) => {
            const cd = examCountdown(e.examDate, today)
            const planned = examPlanSlots.filter((s) => s.examId === e.id && s.date === today).reduce((s, x) => s + x.plannedMinutes, 0)
            return (
              <div key={e.id}>
                <div className="flex items-baseline gap-2">
                  <p className="tnum text-xl font-bold text-primary">{cd.days}</p>
                  <p className="text-[11px] text-ink3">天</p>
                  {cd.status === 'today' && <p className="text-xs font-bold text-danger">今天考试</p>}
                </div>
                <p className="truncate text-xs font-medium text-ink">{e.title}</p>
                <p className="tnum text-[11px] text-ink3">
                  {formatMD(e.examDate)} · 今日计划 {planned} 分钟
                </p>
              </div>
            )
          })}
        </div>
      </button>
    </Card>
  )
}
