import { useCallback, useEffect, useState } from 'react'
import { Button, Card } from '../../components/ui'
import { useToast } from '../../components/feedback'
import { IconMonitor, IconMoon, IconSun } from '../../components/icons'
import { useThemePreference } from '../../state/theme'

/* ================= 功能15：个性化工作台（本机偏好，localStorage） ================= */

export interface WorkspacePrefs {
  showStats: boolean
  showExamCard: boolean
  showQuickActions: boolean
  density: 'cozy' | 'compact'
  hiddenGoals: string[]
}

const KEY = 'studyflow-workspace-prefs'

export const DEFAULT_PREFS: WorkspacePrefs = {
  showStats: true,
  showExamCard: true,
  showQuickActions: true,
  density: 'cozy',
  hiddenGoals: [],
}

export function getWorkspacePrefs(): WorkspacePrefs {
  try {
    const raw = localStorage.getItem(KEY)
    return raw ? { ...DEFAULT_PREFS, ...(JSON.parse(raw) as Partial<WorkspacePrefs>) } : DEFAULT_PREFS
  } catch {
    return DEFAULT_PREFS
  }
}

export function setWorkspacePrefs(prefs: WorkspacePrefs): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(prefs))
    window.dispatchEvent(new Event('studyflow-workspace-changed'))
  } catch {
    // 存储不可用时仅本次会话生效
  }
}

export function useWorkspacePrefs(): [WorkspacePrefs, (p: WorkspacePrefs) => void] {
  const [prefs, setPrefs] = useState<WorkspacePrefs>(getWorkspacePrefs)
  useEffect(() => {
    const onChange = () => setPrefs(getWorkspacePrefs())
    window.addEventListener('studyflow-workspace-changed', onChange)
    return () => window.removeEventListener('studyflow-workspace-changed', onChange)
  }, [])
  const update = useCallback((p: WorkspacePrefs) => setWorkspacePrefs(p), [])
  return [prefs, update]
}

/** 「我的」页设置卡片：卡片显隐 / 密度 / 恢复默认（不清空学习数据） */
export function WorkspaceSettingsCard() {
  const [prefs, update] = useWorkspacePrefs()
  const toast = useToast()
  const toggles: Array<{ key: keyof Pick<WorkspacePrefs, 'showStats' | 'showExamCard' | 'showQuickActions'>; label: string }> = [
    { key: 'showStats', label: '今日统计卡' },
    { key: 'showExamCard', label: '考试冲刺摘要' },
    { key: 'showQuickActions', label: '快捷操作按钮（开始 / 记建议量）' },
  ]
  return (
    <Card className="px-4 py-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-ink">工作台个性化</h2>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => {
            update(DEFAULT_PREFS)
            toast.success('已恢复默认布局（学习数据不受影响）')
          }}
        >
          恢复默认布局
        </Button>
      </div>
      <div className="space-y-2">
        {toggles.map((t) => (
          <label key={t.key} className="flex cursor-pointer items-center justify-between gap-3 rounded-xl border border-line/70 px-3 py-2 text-xs">
            <span className="text-ink2">{t.label}</span>
            <input
              type="checkbox"
              checked={prefs[t.key]}
              onChange={(e) => update({ ...prefs, [t.key]: e.target.checked })}
              className="accent-[rgb(var(--c-primary))]"
              aria-label={t.label}
            />
          </label>
        ))}
        <div className="flex items-center justify-between gap-3 rounded-xl border border-line/70 px-3 py-2 text-xs">
          <span className="text-ink2">信息密度</span>
          <div className="flex gap-1">
            {(
              [
                ['cozy', '舒适'],
                ['compact', '紧凑'],
              ] as const
            ).map(([v, l]) => (
              <button
                key={v}
                type="button"
                aria-pressed={prefs.density === v}
                onClick={() => update({ ...prefs, density: v })}
                className={`rounded-lg px-2.5 py-1 text-[11px] font-medium ${prefs.density === v ? 'bg-primarySoft text-primary' : 'border border-line text-ink3'}`}
              >
                {l}
              </button>
            ))}
          </div>
        </div>
      </div>
      <p className="mt-2 text-[11px] leading-relaxed text-ink3">
        偏好仅保存在本机（localStorage），与主题偏好一致；不同设备互不相通。隐藏只是布局调整，所有功能仍可从对应页面进入。
      </p>
    </Card>
  )
}

/* ================= 右上角：主题快捷切换 + GitHub 仓库直达 ================= */

export function TopBarActions() {
  const [pref, setPref] = useThemePreference()
  const repoUrl = (import.meta.env.VITE_GITHUB_REPO as string | undefined) ?? 'https://github.com/RainANDCr/studyflow'
  const next = pref === 'dark' ? 'light' : pref === 'light' ? 'system' : 'dark'
  const icon = pref === 'dark' ? <IconMoon /> : pref === 'light' ? <IconSun /> : <IconMonitor />
  const label = pref === 'dark' ? '深色' : pref === 'light' ? '浅色' : '跟随系统'
  return (
    <div className="flex items-center gap-1.5">
      <button
        type="button"
        onClick={() => setPref(next)}
        aria-label={`切换主题（当前：${label}）`}
        title={`主题：${label}（点击切换）`}
        className="rounded-lg p-2 text-ink2 transition-colors hover:bg-surface2 hover:text-ink"
      >
        <span className="text-base">{icon}</span>
      </button>
      <a
        href={repoUrl}
        target="_blank"
        rel="noreferrer"
        aria-label="打开 GitHub 仓库"
        title="GitHub 仓库"
        className="rounded-lg p-2 text-ink2 transition-colors hover:bg-surface2 hover:text-ink"
      >
        <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true">
          <path d="M12 .5C5.65.5.5 5.65.5 12c0 5.08 3.29 9.39 7.86 10.91.58.11.79-.25.79-.55v-1.94c-3.2.7-3.87-1.54-3.87-1.54-.52-1.33-1.28-1.68-1.28-1.68-1.04-.71.08-.7.08-.7 1.15.08 1.76 1.18 1.76 1.18 1.03 1.76 2.7 1.25 3.35.96.1-.75.4-1.25.72-1.54-2.55-.29-5.23-1.28-5.23-5.68 0-1.26.45-2.28 1.18-3.09-.12-.29-.51-1.46.11-3.05 0 0 .96-.31 3.15 1.18a10.9 10.9 0 0 1 5.74 0c2.18-1.49 3.14-1.18 3.14-1.18.63 1.59.24 2.76.12 3.05.74.81 1.18 1.83 1.18 3.09 0 4.41-2.69 5.38-5.25 5.66.41.36.78 1.06.78 2.14v3.17c0 .3.21.67.8.55A11.51 11.51 0 0 0 23.5 12C23.5 5.65 18.35.5 12 .5Z" />
        </svg>
      </a>
    </div>
  )
}
