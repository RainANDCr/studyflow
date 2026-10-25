import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Checkin, FocusSession, Milestone } from '../../domain/types'
import { FOCUS_PRESETS, clampFocusMinutes, finishSession, getEffectiveStudyMinutes, getFocusedSeconds, getRemainingSeconds, isRunning, pauseSession, resumeSession, summarizeFocus } from '../../domain/focus'
import { addDays, toDateStr, weekStart as weekStartOf } from '../../domain/dates'
import { useAppData } from '../../state/AppData'
import { Button, Field, Input, StatTile } from '../../components/ui'
import { Modal, useToast } from '../../components/feedback'
import { IconCheck, IconMoon, IconTrash, IconX } from '../../components/icons'
import { ProgressRing } from '../../components/ProgressRing'

function fmtMinutes(sec: number): string {
  const m = sec / 60
  return Number.isInteger(m) ? String(m) : String(Math.round(m * 10) / 10)
}

function fmtClock(sec: number): string {
  const s = Math.max(0, Math.ceil(sec))
  const mm = String(Math.floor(s / 60)).padStart(2, '0')
  const ss = String(s % 60).padStart(2, '0')
  return `${mm}:${ss}`
}

type Phase = 'setup' | 'running' | 'result'

/** 可用时的浏览器通知；失败静默降级为页面提示 */
function tryNotify(title: string, body: string): void {
  try {
    if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
      new Notification(title, { body })
    }
  } catch {
    // 通知不可用属正常降级
  }
}

/**
 * 番茄钟专注面板：全屏二级视图。
 * 计时以 Date.now 差值计算（持久化恢复），interval 只负责刷新显示；
 * 会话状态实时落库，页面刷新/应用重启后可继续、保存已完成部分或放弃。
 */
export function FocusPanel({ open, onClose, initialGoalId }: { open: boolean; onClose: () => void; initialGoalId?: string | null }) {
  const { goals, checkins, focusSessions, milestones, today, addCheckin, saveFocusSession } = useAppData()
  const toast = useToast()
  const [phase, setPhase] = useState<Phase>('setup')
  const [goalId, setGoalId] = useState(initialGoalId ?? '')
  const [milestoneId, setMilestoneId] = useState('')
  const [preset, setPreset] = useState(() => {
    const saved = Number(localStorage.getItem('studyflow-focus-preset'))
    return Number.isInteger(saved) && saved >= 0 && saved <= 3 ? saved : 0
  })
  const [customFocus, setCustomFocus] = useState(() => localStorage.getItem('studyflow-focus-custom') ?? '30')
  const [customBreak, setCustomBreak] = useState(() => localStorage.getItem('studyflow-focus-break') ?? '5')
  const [session, setSession] = useState<FocusSession | null>(null)
  const [, setTick] = useState(0)
  const [resultData, setResultData] = useState<{ focusedSeconds: number; completed: boolean; session: FocusSession } | null>(null)
  const [checkinAmount, setCheckinAmount] = useState('')
  const [alsoCheckin, setAlsoCheckin] = useState(false)
  const [checkinMinutes, setCheckinMinutes] = useState('')
  const [savingResult, setSavingResult] = useState(false)
  const savedRef = useRef(false)

  const goal = goals.find((g) => g.id === goalId) ?? null
  const goalMilestones: Milestone[] = goal
    ? milestones.filter((m) => m.goalId === goal.id).sort((a, b) => a.sortOrder - b.sortOrder)
    : []

  // 恢复提示：打开面板时发现未结束会话
  const activeSession = useMemo(() => focusSessions.find((s) => s.status === 'active') ?? null, [focusSessions])
  const [recoveryPrompt, setRecoveryPrompt] = useState<FocusSession | null>(null)
  useEffect(() => {
    if (open && activeSession && !session && phase === 'setup') {
      setRecoveryPrompt(activeSession)
    }
  }, [open, activeSession, session, phase])

  // 计时 tick：仅刷新 UI
  useEffect(() => {
    if (phase !== 'running' || !session || !isRunning(session)) return
    const t = window.setInterval(() => setTick((n) => n + 1), 1000)
    return () => window.clearInterval(t)
  }, [phase, session])

  // 计时进行中时关闭面板 → 会话已在库中，提示后关闭（倒计时在后台按墙钟推进）
  const handleClose = () => {
    onClose()
  }

  const startFocus = async () => {
    const focusMin = clampFocusMinutes(preset === 3 ? Number(customFocus) : FOCUS_PRESETS[preset].focusMinutes)
    if (focusMin === null) {
      toast.error('专注时长需为 1–240 分钟')
      return
    }
    const now = new Date()
    const s: FocusSession = {
      id: `focus-${Date.now()}`,
      goalId: goalId || null,
      milestoneId: goalId && milestoneId ? milestoneId : null,
      startedAt: now.toISOString(),
      endedAt: null,
      plannedSeconds: focusMin * 60,
      focusedSeconds: 0,
      status: 'active',
      linkedCheckinId: null,
      pausedSeconds: 0,
      lastPauseAt: null,
      isDemo: goal?.isDemo ?? false,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    }
    try {
      await saveFocusSession(s)
      setSession(s)
      savedRef.current = false
      setPhase('running')
    } catch (err) {
      toast.error(err instanceof Error ? `无法开始：${err.message}` : '无法开始专注，请重试')
    }
  }

  const updateSession = useCallback(
    async (next: FocusSession) => {
      setSession(next)
      try {
        await saveFocusSession(next)
      } catch {
        toast.error('会话状态保存失败，计时继续；请勿关闭前再次操作')
      }
    },
    [saveFocusSession, toast],
  )

  const doPause = () => session && void updateSession(pauseSession(session, Date.now()))
  const doResume = () => session && void updateSession(resumeSession(session, Date.now()))

  const doFinish = (status: 'completed' | 'interrupted') => {
    if (!session) return
    const { session: finished, focusedSeconds, completed } = finishSession(session, Date.now(), status)
    void updateSession(finished)
    setResultData({ focusedSeconds, completed, session: finished })
    setAlsoCheckin(false)
    setCheckinAmount('')
    setCheckinMinutes(fmtMinutes(focusedSeconds))
    setPhase('result')
    if (completed) {
      tryNotify('专注完成', `本次专注 ${fmtMinutes(focusedSeconds)} 分钟，去确认记录吧`)
    }
  }

  const abandonSession = async () => {
    if (!session) return
    const { session: finished } = finishSession(session, Date.now(), 'abandoned')
    await saveFocusSession(finished)
    setSession(null)
    setPhase('setup')
    toast.info('已放弃本次专注，不保存任何记录')
  }

  const saveResult = async () => {
    if (!resultData || savedRef.current) return
    setSavingResult(true)
    try {
      let linkedCheckinId: string | null = null
      if (alsoCheckin && goal) {
        const amount = Number(checkinAmount)
        if (!Number.isFinite(amount) || amount <= 0) {
          toast.error('请填写本次实际完成量（专注 ≠ 完成量）')
          setSavingResult(false)
          return
        }
        const minutesVal = checkinMinutes.trim() === '' ? null : Number(checkinMinutes)
        if (minutesVal !== null && (!Number.isInteger(minutesVal) || minutesVal < 0)) {
          toast.error('分钟数需为非负整数或留空')
          setSavingResult(false)
          return
        }
        // 打卡归属会话开始的本地日历日（跨午夜以开始日为准）
        const sessionDate = toDateStr(new Date(resultData.session.startedAt))
        const checkin: Checkin = await addCheckin({
          goalId: goal.id,
          date: sessionDate <= today ? sessionDate : today,
          amount,
          minutes: minutesVal,
          note: `专注 ${fmtMinutes(resultData.focusedSeconds)} 分钟`,
          isBackfill: false,
          milestoneId: resultData.session.milestoneId ?? null,
        })
        linkedCheckinId = checkin.id
      }
      // 关联打卡后会话不再独立计分钟（去重口径由 getEffectiveStudyMinutes 保证）
      await saveFocusSession({ ...resultData.session, linkedCheckinId })
      savedRef.current = true
      toast.success(
        linkedCheckinId
          ? '已保存专注记录并关联打卡'
          : '已保存专注记录（未创建打卡，不会虚构完成量）',
      )
      setSession(null)
      setResultData(null)
      setPhase('setup')
    } catch (err) {
      toast.error(err instanceof Error ? `保存失败：${err.message}（会话已保留，可重试）` : '保存失败，会话已保留，可重试')
    } finally {
      setSavingResult(false)
    }
  }

  const recover = async (mode: 'continue' | 'savePartial' | 'discard') => {
    const s = recoveryPrompt
    if (!s) return
    setRecoveryPrompt(null)
    if (mode === 'continue') {
      // 若已暂停则保持暂停状态恢复展示
      setSession(s)
      setPhase('running')
      return
    }
    const now = Date.now()
    if (mode === 'savePartial') {
      const wasRunning = isRunning(s)
      const paused = wasRunning ? pauseSession(s, now) : s
      const { session: finished, focusedSeconds } = finishSession(paused, wasRunning ? now : new Date(s.lastPauseAt ?? s.startedAt).getTime(), 'interrupted')
      if (focusedSeconds <= 0) {
        await saveFocusSession({ ...finished, status: 'abandoned' })
        toast.info('上次会话没有有效专注时间，已放弃')
      } else {
        await saveFocusSession(finished)
        setResultData({ focusedSeconds, completed: false, session: finished })
        setCheckinMinutes(fmtMinutes(focusedSeconds))
        setPhase('result')
        toast.info('已保存上次会话的已完成部分，请确认')
      }
      setSession(null)
      return
    }
    await saveFocusSession({ ...s, status: 'abandoned', endedAt: new Date(now).toISOString(), updatedAt: new Date(now).toISOString() })
    toast.info('上次会话已放弃')
  }

  const weekFrom = weekStartOf(today)
  const todayFocus = summarizeFocus(focusSessions, checkins, today, today)
  const weekFocus = summarizeFocus(focusSessions, checkins, weekFrom, addDays(weekFrom, 6))
  const pomodoroIndex = todayFocus.sessionCount + 1

  // 环形倒计时数据
  const remaining = session ? getRemainingSeconds(session, Date.now()) : 0
  const focusedSec = session ? getFocusedSeconds(session, Date.now()) : 0
  const percent = session ? (focusedSec / session.plannedSeconds) * 100 : 0
  const running = session ? isRunning(session) : false

  // 今天已专注时长（独立会话）
  const todayIndependentMinutes = useMemo(() => {
    const checkinsToday = checkins.filter((c) => c.date === today)
    return getEffectiveStudyMinutes(checkinsToday, focusSessions.filter((s) => toDateStr(new Date(s.startedAt)) === today && s.status !== 'abandoned'))
  }, [checkins, focusSessions, today])

  return (
    <Modal open={open} onClose={handleClose} title="番茄钟 · 专注模式" dismissable>
      {recoveryPrompt && (
        <div className="fixed inset-0 z-[75] flex items-center justify-center bg-black/50 px-4">
          <div className="w-full max-w-sm rounded-2xl bg-surface p-5 shadow-pop">
            <h3 className="text-base font-semibold text-ink">有未结束的专注会话</h3>
            <p className="mt-1.5 text-xs leading-relaxed text-ink2">
              上次会话开始于 {new Date(recoveryPrompt.startedAt).toLocaleString()}，计划 {fmtMinutes(recoveryPrompt.plannedSeconds)} 分钟，
              已计 {fmtMinutes(getFocusedSeconds(recoveryPrompt, Date.now()))} 分钟。请选择如何处理：
            </p>
            <div className="mt-4 space-y-2">
              <Button className="w-full" onClick={() => void recover('continue')}>
                继续这次专注
              </Button>
              <Button variant="secondary" className="w-full" onClick={() => void recover('savePartial')}>
                保存已完成部分
              </Button>
              <Button variant="ghost" className="w-full" onClick={() => void recover('discard')}>
                放弃（不生成记录）
              </Button>
            </div>
          </div>
        </div>
      )}

      {phase === 'setup' && (
        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-3">
            <StatTile label="今日已专注" value={`${fmtMinutes(todayIndependentMinutes * 60)} 分`} sub="有效投入（去重口径）" />
            <StatTile label="今日会话" value={todayFocus.sessionCount} sub="次" />
            <StatTile label="本周有效" value={`${fmtMinutes(weekFocus.effectiveMinutes * 60)} 分`} sub={`${weekFocus.sessionCount} 次专注`} />
          </div>

          <Field label="关联目标（可选）" htmlFor="focus-goal">
            <select
              id="focus-goal"
              value={goalId}
              onChange={(e) => {
                setGoalId(e.target.value)
                setMilestoneId('')
              }}
              className="h-10 w-full rounded-xl border border-line bg-surface px-3 text-sm text-ink"
            >
              <option value="">不关联（单纯计时）</option>
              {goals.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </select>
          </Field>

          {goal && goalMilestones.length > 0 && (
            <Field label="关联阶段（可选）" htmlFor="focus-milestone">
              <select id="focus-milestone" value={milestoneId} onChange={(e) => setMilestoneId(e.target.value)} className="h-10 w-full rounded-xl border border-line bg-surface px-3 text-sm text-ink">
                <option value="">不关联</option>
                {goalMilestones.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.title}
                  </option>
                ))}
              </select>
            </Field>
          )}

          <Field label="专注 / 休息时长" hint="休息时长不计入学习投入分钟">
            <div className="flex flex-wrap gap-2">
              {FOCUS_PRESETS.map((p, i) => (
                <button
                  key={p.label}
                  type="button"
                  aria-pressed={preset === i}
                  onClick={() => setPreset(i)}
                  className={`rounded-xl px-3.5 py-2 text-sm font-medium transition-colors ${preset === i ? 'gradient-primary text-white' : 'border border-line text-ink2'}`}
                >
                  {p.label}
                </button>
              ))}
              <button
                type="button"
                aria-pressed={preset === 3}
                onClick={() => setPreset(3)}
                className={`rounded-xl px-3.5 py-2 text-sm font-medium transition-colors ${preset === 3 ? 'gradient-primary text-white' : 'border border-line text-ink2'}`}
              >
                自定义
              </button>
            </div>
          </Field>

          {preset === 3 && (
            <div className="grid grid-cols-2 gap-3">
              <Field label="专注分钟（1–240）" htmlFor="focus-custom">
                <Input id="focus-custom" type="number" min={1} max={240} value={customFocus} onChange={(e) => setCustomFocus(e.target.value)} />
              </Field>
              <Field label="休息分钟" htmlFor="break-custom">
                <Input id="break-custom" type="number" min={1} max={60} value={customBreak} onChange={(e) => setCustomBreak(e.target.value)} />
              </Field>
            </div>
          )}

          <Button size="lg" className="w-full" onClick={() => void startFocus()}>
            开始第 {pomodoroIndex} 个番茄
          </Button>

          <RecentSessions />
        </div>
      )}

      {phase === 'running' && session && (
        <div className="flex flex-col items-center gap-4 py-2">
          <p className="text-xs text-ink3">
            第 {pomodoroIndex} 个番茄{goal ? ` · ${goal.name}` : ' · 单纯计时'}
          </p>
          <ProgressRing percent={percent} color="#7c5cff" size={200} stroke={12}>
            <span className="tnum text-4xl font-bold text-ink">{fmtClock(remaining)}</span>
            <span className="mt-1 text-xs text-ink3">{running ? '专注中' : '已暂停'}</span>
          </ProgressRing>
          <p className="tnum text-xs text-ink3">
            已专注 {fmtMinutes(focusedSec)} / {fmtMinutes(session.plannedSeconds)} 分钟
          </p>
          <div className="flex flex-wrap justify-center gap-2">
            {running ? (
              <Button variant="secondary" onClick={() => void doPause()}>
                <IconMoon /> 暂停
              </Button>
            ) : (
              <Button onClick={() => void doResume()}>
                <IconCheck /> 继续
              </Button>
            )}
            <Button variant="secondary" onClick={() => doFinish('interrupted')}>
              提前结束
            </Button>
            <Button variant="ghost" className="text-danger" onClick={() => void abandonSession()}>
              <IconX /> 放弃
            </Button>
          </div>
          <p className="max-w-xs text-center text-[11px] leading-relaxed text-ink3">
            关闭此窗口或切换页面不会中断计时（按墙钟时间推进）；专注结束后先确认结果，不会自动生成打卡。
          </p>
        </div>
      )}

      {phase === 'result' && resultData && (
        <div className="space-y-4">
          <div className="rounded-xl2 bg-primarySoft px-4 py-4 text-center">
            <p className="text-sm font-semibold text-primary">
              {resultData.completed ? '专注完成！' : '专注已结束'}
            </p>
            <p className="tnum mt-1 text-3xl font-bold text-ink">{fmtMinutes(resultData.focusedSeconds)} 分钟</p>
            <p className="mt-1 text-xs text-ink3">
              {resultData.completed ? '达到计划时长' : '未达计划时长，已如实记录'}
            </p>
          </div>

          <label className="flex cursor-pointer items-start gap-2.5 rounded-xl border border-line px-3.5 py-3 text-xs">
            <input type="checkbox" checked={alsoCheckin} onChange={(e) => setAlsoCheckin(e.target.checked)} className="mt-0.5 accent-[rgb(var(--c-primary))]" />
            <span>
              <b className="text-ink">同时创建打卡</b>：专注时长不等于完成量，请如实填写本次完成的数量。若只保存专注记录，请勿勾选。
            </span>
          </label>

          {alsoCheckin && goal && (
            <div className="grid grid-cols-2 gap-3">
              <Field label={`完成数量（${goal.unit}，必填）`} htmlFor="focus-checkin-amount">
                <Input id="focus-checkin-amount" type="number" min={0} step="any" value={checkinAmount} onChange={(e) => setCheckinAmount(e.target.value)} placeholder="本次实际完成" />
              </Field>
              <Field label="投入分钟（可修改）" htmlFor="focus-checkin-minutes" hint="默认为本次有效专注分钟">
                <Input id="focus-checkin-minutes" type="number" min={0} step={1} value={checkinMinutes} onChange={(e) => setCheckinMinutes(e.target.value)} />
              </Field>
            </div>
          )}

          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => void saveResult()} disabled={savingResult}>
              只保存专注记录
            </Button>
            <Button onClick={() => void saveResult()} loading={savingResult} disabled={!alsoCheckin && false}>
              <IconCheck /> 保存记录{alsoCheckin && goal ? '并打卡' : ''}
            </Button>
          </div>
        </div>
      )}
    </Modal>
  )
}

function RecentSessions() {
  const { focusSessions, deleteFocusSessionById, goals, checkins } = useAppData()
  const toast = useToast()
  const recent = useMemo(
    () =>
      [...focusSessions]
        .filter((s) => s.status !== 'active')
        .sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1))
        .slice(0, 6),
    [focusSessions],
  )
  if (recent.length === 0) {
    return <p className="rounded-xl bg-base px-3 py-2.5 text-[11px] text-ink3">还没有专注记录。完成一次专注后，这里会显示最近会话，可删除误记录。</p>
  }
  return (
    <div>
      <p className="mb-1.5 text-xs font-semibold text-ink2">最近专注</p>
      <ul className="divide-y divide-line/60">
        {recent.map((s) => {
          const goalName = s.goalId ? goals.find((g) => g.id === s.goalId)?.name ?? '已删除目标' : '单纯计时'
          const linked = s.linkedCheckinId ? checkins.some((c) => c.id === s.linkedCheckinId) : false
          return (
            <li key={s.id} className="flex items-center gap-2 py-2 text-xs">
              <span className="tnum w-32 shrink-0 text-ink3">
                {new Date(s.startedAt).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
              </span>
              <span className="tnum font-medium text-ink">{fmtMinutes(s.focusedSeconds)} 分</span>
              <span className="min-w-0 flex-1 truncate text-ink3">{goalName}</span>
              {!linked && s.focusedSeconds > 0 && <span className="rounded bg-primarySoft px-1.5 py-0.5 text-[10px] text-primary">独立计时</span>}
              {linked && <span className="rounded bg-surface2 px-1.5 py-0.5 text-[10px] text-ink3">已关联打卡</span>}
              <button
                type="button"
                aria-label="删除这条专注记录"
                className="ml-1 shrink-0 rounded-lg p-1 text-ink3 hover:bg-dangerSoft hover:text-danger"
                onClick={() => {
                  void deleteFocusSessionById(s.id).then(() => toast.success('专注记录已删除，统计已重新计算'))
                }}
              >
                <IconTrash />
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

