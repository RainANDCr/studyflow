import { useEffect, useRef, useState } from 'react'
import type { Goal } from '../../domain/types'
import { formatMD, weekdayShort } from '../../domain/dates'
import { getAllowedBackfillDates } from '../../domain/suggestion'
import { computeCheckinPrefill } from '../../domain/suggestion'
import { checkinsOfGoal } from '../../domain/progress'
import { useAppData } from '../../state/AppData'
import { Button, Field, Input, TextArea } from '../../components/ui'
import { Modal, useToast } from '../../components/feedback'

function fmtPlan(n: number): string {
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100)
}

/** 打卡表单：数量预填（今日建议量 - 今日已记录量，可改）、分钟数选填、日期（今天或最近六天）、备注、可选关联里程碑。 */
export function CheckinDialog({ open, onClose, goal }: { open: boolean; onClose: () => void; goal: Goal | null }) {
  const { today, addCheckin, checkins, milestones } = useAppData()
  const toast = useToast()
  const [amount, setAmount] = useState('')
  const [minutes, setMinutes] = useState('')
  const [date, setDate] = useState(today)
  const [note, setNote] = useState('')
  const [milestoneId, setMilestoneId] = useState('')
  const [amountError, setAmountError] = useState('')
  const [minutesError, setMinutesError] = useState('')
  const [saving, setSaving] = useState(false)

  // 打卡数据经 ref 读取：表单只在打开/切换目标/日期翻转时重置，
  // 避免外部数据刷新（数组引用变化）清空用户正在输入的内容。
  const checkinsRef = useRef(checkins)
  checkinsRef.current = checkins

  useEffect(() => {
    if (!open || !goal) return
    const prefill = computeCheckinPrefill(goal, checkinsOfGoal(checkinsRef.current, goal.id), today)
    setAmount(prefill > 0 ? String(prefill) : '')
    setMinutes('')
    setDate(today)
    setNote('')
    setAmountError('')
    setMinutesError('')
    // 默认预选第一个未完成的阶段
    const goalMs = milestones.filter((m) => m.goalId === goal.id).sort((a, b) => a.sortOrder - b.sortOrder)
    const current = goalMs.find(
      (m) => checkinsRef.current.filter((c) => c.milestoneId === m.id).reduce((s, c) => s + c.amount, 0) < m.plannedAmount,
    )
    setMilestoneId(current?.id ?? '')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, goal?.id, today])

  if (!goal) return null

  const goalMs = milestones.filter((m) => m.goalId === goal.id).sort((a, b) => a.sortOrder - b.sortOrder)
  const backfillDates = getAllowedBackfillDates(goal, today)

  const submit = async () => {
    const amountNum = Number(amount)
    if (!Number.isFinite(amountNum) || amountNum <= 0) {
      setAmountError('请填写大于 0 的数量')
      return
    }
    let minutesVal: number | null = null
    if (minutes.trim() !== '') {
      const m = Number(minutes)
      if (!Number.isInteger(m) || m < 0 || m > 1440) {
        setMinutesError('分钟数需为 0–1440 的整数，或留空')
        return
      }
      minutesVal = m
    }
    setSaving(true)
    try {
      await addCheckin({
        goalId: goal.id,
        date,
        amount: amountNum,
        minutes: minutesVal,
        note: note.trim() ? note : null,
        isBackfill: date < today,
        milestoneId: milestoneId || null,
      })
      toast.success(date < today ? `已补记 ${formatMD(date)} 的打卡` : '已保存打卡')
      onClose()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '保存失败，请重试')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`打卡 · ${goal.name}`}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            取消
          </Button>
          <Button onClick={() => void submit()} loading={saving}>
            保存打卡
          </Button>
        </div>
      }
    >
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault()
          void submit()
        }}
      >
        <div className="grid grid-cols-[1fr_auto] items-end gap-3">
          <Field label={`完成数量（单位：${goal.unit}）`} htmlFor="checkin-amount" error={amountError} hint="预填的是今日建议量，可自行修改">
            <Input
              id="checkin-amount"
              type="number"
              inputMode="decimal"
              min={0}
              step="any"
              value={amount}
              onChange={(e) => {
                setAmount(e.target.value)
                setAmountError('')
              }}
              placeholder="0"
            />
          </Field>
          <span className="pb-3 text-sm text-ink3">{goal.unit}</span>
        </div>
        <Field label="投入分钟数（选填）" htmlFor="checkin-minutes" error={minutesError} hint="留空则不计入分钟统计，不会自动估算">
          <Input
            id="checkin-minutes"
            type="number"
            inputMode="numeric"
            min={0}
            max={1440}
            step={1}
            value={minutes}
            onChange={(e) => {
              setMinutes(e.target.value)
              setMinutesError('')
            }}
            placeholder="如 25"
          />
        </Field>
        <Field label="记录日期" htmlFor="checkin-date" hint="只能补记最近 6 天，且不早于目标开始日">
          <select
            id="checkin-date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="h-10 w-full rounded-xl border border-line bg-surface px-3 text-sm text-ink focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/15"
          >
            <option value={today}>今天（{formatMD(today)} {weekdayShort(today)}）</option>
            {backfillDates.map((d) => (
              <option key={d} value={d}>
                {formatMD(d)} {weekdayShort(d)}（补记）
              </option>
            ))}
          </select>
        </Field>
        <Field label="关联阶段（可选）" htmlFor="checkin-milestone" hint="用于阶段进度统计；不选择则计入「未分配」，不影响主目标进度">
          {goalMs.length > 0 ? (
            <select
              id="checkin-milestone"
              value={milestoneId}
              onChange={(e) => setMilestoneId(e.target.value)}
              className="h-10 w-full rounded-xl border border-line bg-surface px-3 text-sm text-ink focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/15"
            >
              <option value="">不关联（未分配）</option>
              {goalMs.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.title}（{fmtPlan(m.plannedAmount)} {goal.unit}）
                </option>
              ))}
            </select>
          ) : (
            <p className="text-xs text-ink3">该目标还没有阶段，可在「看板 → 阶段计划」中创建。</p>
          )}
        </Field>
        <Field label="备注（选填）" htmlFor="checkin-note">
          <TextArea
            id="checkin-note"
            rows={2}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="一句话记录当下的状态"
            maxLength={200}
          />
        </Field>
        <button type="submit" className="hidden" aria-hidden="true" />
      </form>
    </Modal>
  )
}
