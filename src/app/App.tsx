import { useEffect, useState } from 'react'
import { AppDataProvider, useAppData } from '../state/AppData'
import { ToastProvider, useToast } from '../components/feedback'
import { Button, Skeleton } from '../components/ui'
import { Confetti } from '../components/Confetti'
import {
  IconCalendar,
  IconChart,
  IconRefresh,
  IconTarget,
  IconUser,
} from '../components/icons'
import { TodayPage } from '../features/today/TodayPage'
import { TopBarActions } from '../features/generic/Workspace'
import { DashboardPage } from '../features/dashboard/DashboardPage'
import { WeeklyPage } from '../features/weekly/WeeklyPage'
import { SettingsPage } from '../features/settings/SettingsPage'

type TabKey = 'today' | 'dashboard' | 'weekly' | 'settings'

const TABS: Array<{ key: TabKey; label: string; icon: React.ReactNode }> = [
  { key: 'today', label: '今日', icon: <IconTarget /> },
  { key: 'dashboard', label: '看板', icon: <IconChart /> },
  { key: 'weekly', label: '周报', icon: <IconCalendar /> },
  { key: 'settings', label: '我的', icon: <IconUser /> },
]

function Logo({ compact = false }: { compact?: boolean }) {
  return (
    <span className="flex items-center gap-2">
      <span className="gradient-primary flex h-8 w-8 items-center justify-center rounded-xl text-white">
        <IconTarget className="text-lg" />
      </span>
      {!compact && (
        <span className="leading-tight">
          <span className="block text-[15px] font-bold text-ink">知行 StudyFlow</span>
          <span className="block text-[11px] text-ink3">把终点变成今天的一小步</span>
        </span>
      )}
    </span>
  )
}

function ErrorScreen({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-4 px-6 text-center">
      <span className="gradient-primary flex h-14 w-14 items-center justify-center rounded-2xl text-2xl text-white">
        <IconTarget />
      </span>
      <div>
        <h1 className="text-lg font-semibold text-ink">本地数据加载失败</h1>
        <p className="mt-1 max-w-sm text-sm leading-relaxed text-ink2">{message}</p>
        <p className="mt-1 max-w-sm text-xs text-ink3">你的数据仍保存在本机，不会因此丢失；请重试读取。</p>
      </div>
      <Button onClick={onRetry}>
        <IconRefresh /> 重试
      </Button>
    </div>
  )
}

function ShellSkeleton() {
  return (
    <div className="mx-auto w-full max-w-3xl space-y-4 px-4 py-6">
      <Skeleton className="h-16 w-2/3" />
      <div className="grid grid-cols-3 gap-3">
        <Skeleton className="h-16" />
        <Skeleton className="h-16" />
        <Skeleton className="h-16" />
      </div>
      <Skeleton className="h-40" />
      <Skeleton className="h-40" />
    </div>
  )
}

function AppShell() {
  const { ready, initError, retry, justCompletedGoalId, clearCelebration, goals } = useAppData()
  const [tab, setTab] = useState<TabKey>('today')
  const toast = useToast()

  const completedGoal = justCompletedGoalId ? goals.find((g) => g.id === justCompletedGoalId) : null
  useEffect(() => {
    if (completedGoal) {
      toast.success(`恭喜！目标「${completedGoal.name}」已完成`)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [justCompletedGoalId])

  if (initError) {
    return (
      <>
        <ErrorScreen message={initError} onRetry={() => void retry()} />
        <Confetti active={false} />
      </>
    )
  }
  if (!ready) return <ShellSkeleton />

  return (
    <div className="min-h-dvh">
      {/* PC 左侧边栏 */}
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-60 flex-col border-r border-line/70 bg-surface px-4 py-5 lg:flex">
        <Logo />
        <nav className="mt-8 space-y-1" aria-label="主导航">
          {TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              aria-current={tab === t.key ? 'page' : undefined}
              className={`flex w-full items-center gap-3 rounded-xl px-3.5 py-2.5 text-sm font-medium transition-colors ${
                tab === t.key ? 'bg-primarySoft text-primary' : 'text-ink2 hover:bg-surface2 hover:text-ink'
              }`}
            >
              <span className="text-lg">{t.icon}</span>
              {t.label}
            </button>
          ))}
        </nav>
        <div className="mt-auto flex items-center justify-between gap-2 border-t border-line/70 pt-3">
          <p className="text-[11px] leading-relaxed text-ink3">本地离线应用<br />数据保存在本机</p>
          <TopBarActions />
        </div>
      </aside>

      {/* 平板顶部横向导航 */}
      <header className="pt-safe sticky top-0 z-40 hidden border-b border-line/70 bg-surface/90 backdrop-blur md:block lg:hidden">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-4 py-2.5">
          <Logo />
          <nav className="flex gap-1" aria-label="主导航">
            {TABS.map((t) => (
              <button
                key={t.key}
                type="button"
                onClick={() => setTab(t.key)}
                aria-current={tab === t.key ? 'page' : undefined}
                className={`flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                  tab === t.key ? 'bg-primarySoft text-primary' : 'text-ink2 hover:bg-surface2'
                }`}
              >
                <span className="text-base">{t.icon}</span>
                {t.label}
              </button>
            ))}
          </nav>
        </div>
      </header>

      <div className="fixed right-2 top-2 z-40 md:hidden">
        <div className="rounded-xl border border-line/70 bg-surface/90 p-0.5 shadow-card backdrop-blur">
          <TopBarActions />
        </div>
      </div>

      <main className="lg:pl-60">
        <div className="mx-auto w-full max-w-3xl px-4 pb-28 pt-5 md:pb-10 md:pt-6 lg:max-w-4xl">
          {tab === 'today' && <TodayPage />}
          {tab === 'dashboard' && <DashboardPage />}
          {tab === 'weekly' && <WeeklyPage />}
          {tab === 'settings' && <SettingsPage />}
        </div>
      </main>

      {/* 手机底部四 Tab */}
      <nav
        aria-label="主导航"
        className="pb-safe fixed inset-x-0 bottom-0 z-40 border-t border-line/70 bg-surface/95 backdrop-blur md:hidden"
      >
        <div className="grid grid-cols-4">
          {TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              aria-current={tab === t.key ? 'page' : undefined}
              className={`flex flex-col items-center gap-0.5 py-2 text-[11px] font-medium transition-colors ${
                tab === t.key ? 'text-primary' : 'text-ink3'
              }`}
            >
              <span className="text-xl">{t.icon}</span>
              {t.label}
            </button>
          ))}
        </div>
      </nav>

      <Confetti active={!!justCompletedGoalId} onDone={clearCelebration} />
    </div>
  )
}

export default function App() {
  return (
    <ToastProvider>
      <AppDataProvider>
        <AppShell />
      </AppDataProvider>
    </ToastProvider>
  )
}
