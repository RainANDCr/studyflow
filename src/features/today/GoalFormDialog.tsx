import { useEffect, useState } from 'react'
import type { Goal } from '../../domain/types'
import { COLOR_HEX, COLOR_KEYS, COLOR_NAMES, type ColorKey } from '../../domain/types'
import type { GoalInput } from '../../domain/validation'
import { goalInputSchema } from '../../domain/validation'
import { addDays } from '../../domain/dates'
import { useAppData } from '../../state/AppData'
import { Button, Field, Input, TextArea, Toggle } from '../../components/ui'
import { ConfirmDialog, Modal, useToast } from '../../components/feedback'

const UNIT_SUGGESTIONS = ['词', '页', '节', '课时', '题', '小时']

interface FormState {
  name: string
  unit: string
  totalAmount: string
  startDate: string
  deadline: string
  color: ColorKey
  obstacle: string
  ifThenPlan: string
  weeklyRestEnabled: boolean
}

function initialState(goal: Goal | null, today: string): FormState {
  return {
    name: goal?.name ?? '',
    unit: goal?.unit ?? '',
    totalAmount: goal ? String(goal.totalAmount) : '',
    startDate: goal?.startDate ?? today,
    deadline: goal?.deadline ?? addDays(today, 30),
    color: goal?.color ?? 'violet',
    obstacle: goal?.obstacle ?? '',
    ifThenPlan: goal?.ifThenPlan ?? '',
    weeklyRestEnabled: goal?.weeklyRestEnabled ?? true,
  }
}

export function GoalFormDialog({ open, onClose, goal }: { open: boolean; onClose: () => void; goal: Goal | null }) {
  const { today, createGoal, updateGoal, deleteGoal, checkins } = useAppData()
  const toast = useToast()
  const [form, setForm] = useState<FormState>(() => initialState(goal, today))
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)

  useEffect(() => {
    if (open) {
      setForm(initialState(goal, today))
      setErrors({})
    }
  }, [open, goal, today])

  const relatedCount = goal ? checkins.filter((c) => c.goalId === goal.id).length : 0

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((f) => ({ ...f, [key]: value }))
    setErrors((e) => ({ ...e, [key]: '' }))
  }

  const submit = async () => {
    const input: GoalInput = {
      name: form.name,
      unit: form.unit,
      totalAmount: Number(form.totalAmount),
      startDate: form.startDate,
      deadline: form.deadline,
      color: form.color,
      obstacle: form.obstacle.trim() ? form.obstacle : null,
      ifThenPlan: form.ifThenPlan.trim() ? form.ifThenPlan : null,
      weeklyRestEnabled: form.weeklyRestEnabled,
    }
    const parsed = goalInputSchema.safeParse(input)
    if (!parsed.success) {
      const next: Record<string, string> = {}
      for (const issue of parsed.error.issues) {
        const key = String(issue.path[0] ?? '')
        if (key && !next[key]) next[key] = issue.message
      }
      setErrors(next)
      return
    }
    setSaving(true)
    try {
      if (goal) {
        await updateGoal(goal.id, parsed.data)
        toast.success('目标已更新')
      } else {
        await createGoal(parsed.data)
        toast.success('目标已创建，今天就开始一小步吧')
      }
      onClose()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '保存失败，请重试')
    } finally {
      setSaving(false)
    }
  }

  const doDelete = async () => {
    if (!goal) return
    setDeleting(true)
    try {
      await deleteGoal(goal.id)
      toast.success('目标及其打卡记录已删除')
      setConfirmDelete(false)
      onClose()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '删除失败，请重试')
    } finally {
      setDeleting(false)
    }
  }

  return (
    <>
      <Modal
        open={open}
        onClose={onClose}
        title={goal ? '编辑学习目标' : '新建学习目标'}
        footer={
          <div className="flex items-center justify-between gap-2">
            {goal ? (
              <Button variant="ghost" className="text-danger" onClick={() => setConfirmDelete(true)} disabled={saving}>
                删除目标
              </Button>
            ) : (
              <span />
            )}
            <div className="flex gap-2">
              <Button variant="ghost" onClick={onClose} disabled={saving}>
                取消
              </Button>
              <Button onClick={() => void submit()} loading={saving}>
                {goal ? '保存修改' : '创建目标'}
              </Button>
            </div>
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
          <Field label="目标名称" htmlFor="goal-name" error={errors.name}>
            <Input
              id="goal-name"
              value={form.name}
              onChange={(e) => set('name', e.target.value)}
              placeholder="例如：背英语单词"
              maxLength={60}
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="单位" htmlFor="goal-unit" error={errors.unit} hint="自定义计量单位">
              <Input
                id="goal-unit"
                value={form.unit}
                onChange={(e) => set('unit', e.target.value)}
                placeholder="词 / 页 / 节"
                maxLength={10}
                list="unit-suggestions"
              />
              <datalist id="unit-suggestions">
                {UNIT_SUGGESTIONS.map((u) => (
                  <option key={u} value={u} />
                ))}
              </datalist>
            </Field>
            <Field label="总量" htmlFor="goal-total" error={errors.totalAmount}>
              <Input
                id="goal-total"
                type="number"
                inputMode="decimal"
                min={0}
                step="any"
                value={form.totalAmount}
                onChange={(e) => set('totalAmount', e.target.value)}
                placeholder="2000"
              />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="开始日" htmlFor="goal-start" error={errors.startDate}>
              <Input id="goal-start" type="date" value={form.startDate} onChange={(e) => set('startDate', e.target.value)} />
            </Field>
            <Field label="截止日" htmlFor="goal-deadline" error={errors.deadline}>
              <Input
                id="goal-deadline"
                type="date"
                value={form.deadline}
                min={form.startDate}
                onChange={(e) => set('deadline', e.target.value)}
              />
            </Field>
          </div>
          <Field label="主题色" error={errors.color}>
            <div className="flex gap-2.5 pt-1" role="radiogroup" aria-label="主题色">
              {COLOR_KEYS.map((key) => (
                <button
                  key={key}
                  type="button"
                  role="radio"
                  aria-checked={form.color === key}
                  aria-label={`${COLOR_NAMES[key]}色`}
                  title={COLOR_NAMES[key]}
                  onClick={() => set('color', key)}
                  className={`h-8 w-8 rounded-full border-2 transition-transform ${
                    form.color === key ? 'scale-110 border-ink' : 'border-transparent hover:scale-105'
                  }`}
                  style={{ backgroundColor: COLOR_HEX[key] }}
                />
              ))}
            </div>
          </Field>
          <Field label="最容易拦住我的障碍（可选）" htmlFor="goal-obstacle" error={errors.obstacle}>
            <Input
              id="goal-obstacle"
              value={form.obstacle}
              onChange={(e) => set('obstacle', e.target.value)}
              placeholder="例如：容易被消息打断"
              maxLength={120}
            />
          </Field>
          <Field label="如果它出现，我就……（可选）" htmlFor="goal-plan" error={errors.ifThenPlan} hint="WOOP 预案：如果…就…">
            <TextArea
              id="goal-plan"
              rows={2}
              value={form.ifThenPlan}
              onChange={(e) => set('ifThenPlan', e.target.value)}
              placeholder="例如：如果被打断，就先关通知再学 15 分钟"
              maxLength={160}
            />
          </Field>
          <div className="rounded-xl border border-line/70 bg-base px-3.5 py-3">
            <Toggle
              id="goal-rest"
              checked={form.weeklyRestEnabled}
              onChange={(v) => set('weeklyRestEnabled', v)}
              label="每周弹性休息日（每周自动宽免 1 个缺卡日，不中断连续记录）"
            />
          </div>
          <button type="submit" className="hidden" aria-hidden="true" />
        </form>
      </Modal>
      <ConfirmDialog
        open={confirmDelete}
        title="删除学习目标"
        danger
        confirmText="确认删除"
        busy={deleting}
        message={
          <span>
            将删除目标「{goal?.name}」及其全部 <b className="text-danger">{relatedCount}</b> 条打卡记录，此操作不可撤销。确定继续吗？
          </span>
        }
        onConfirm={() => void doDelete()}
        onClose={() => setConfirmDelete(false)}
      />
    </>
  )
}
