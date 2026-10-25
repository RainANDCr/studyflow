import { useEffect, useRef, useState } from 'react'
import { useAppData } from '../../state/AppData'
import { exportPayloadSchema, type ExportPayload } from '../../domain/validation'
import { isTauri } from '../../storage'
import { useThemePreference, type ThemePreference } from '../../state/theme'
import { WorkspaceSettingsCard } from '../generic/Workspace'
import { Button, Card, SectionTitle } from '../../components/ui'
import { ConfirmDialog, Modal, useToast } from '../../components/feedback'
import {
  IconDownload,
  IconInfo,
  IconMonitor,
  IconMoon,
  IconRefresh,
  IconSparkles,
  IconSun,
  IconTrash,
  IconUpload,
  IconUser,
} from '../../components/icons'

const THEME_OPTIONS: Array<{ value: ThemePreference; label: string; icon: React.ReactNode }> = [
  { value: 'system', label: '跟随系统', icon: <IconMonitor /> },
  { value: 'light', label: '浅色', icon: <IconSun /> },
  { value: 'dark', label: '深色', icon: <IconMoon /> },
]

function AppearanceCard() {
  const [pref, setPref] = useThemePreference()
  return (
    <Card className="px-4 py-4">
      <SectionTitle title="外观" />
      <div role="radiogroup" aria-label="外观主题" className="grid grid-cols-3 gap-2">
        {THEME_OPTIONS.map((opt) => (
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={pref === opt.value}
            onClick={() => setPref(opt.value)}
            className={`flex cursor-pointer flex-col items-center gap-1.5 rounded-xl border px-2 py-3 text-xs font-medium transition-colors ${
              pref === opt.value
                ? 'border-primary bg-primarySoft text-primary'
                : 'border-line bg-surface text-ink2 hover:border-primary/40 hover:text-ink'
            }`}
          >
            <span className="text-lg">{opt.icon}</span>
            {opt.label}
          </button>
        ))}
      </div>
      <p className="mt-2 text-[11px] leading-relaxed text-ink3">
        偏好保存在本机浏览器（仅界面外观，与学习数据无关）。「跟随系统」会随系统深浅色自动切换。
      </p>
    </Card>
  )
}

function formatDateTime(iso: string | null): string {
  if (!iso) return '尚未写入'
  const d = new Date(iso)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

function downloadJson(filename: string, payload: unknown): boolean {
  try {
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    document.body.appendChild(a)
    a.click()
    a.remove()
    window.setTimeout(() => URL.revokeObjectURL(url), 4000)
    return true
  } catch {
    return false
  }
}

function stamp(): string {
  const d = new Date()
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}-${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}`
}

/** Web 环境的「添加到手机/桌面主屏幕」提示（仅在安全上下文可用；不支持时如实说明）。 */
function PwaCard() {
  const [promptEvent, setPromptEvent] = useState<{ prompt: () => Promise<void> } | null>(null)
  const [standalone, setStandalone] = useState(false)

  useEffect(() => {
    const onPrompt = (e: Event) => {
      e.preventDefault()
      setPromptEvent(e as unknown as { prompt: () => Promise<void> })
    }
    window.addEventListener('beforeinstallprompt', onPrompt)
    setStandalone(window.matchMedia('(display-mode: standalone)').matches)
    return () => window.removeEventListener('beforeinstallprompt', onPrompt)
  }, [])

  const isSecure = window.isSecureContext

  return (
    <Card className="px-4 py-4">
      <SectionTitle icon={<IconSparkles />} title="添加到主屏幕（可选）" />
      {standalone ? (
        <p className="text-xs leading-relaxed text-ok">已经从主屏幕独立运行。</p>
      ) : promptEvent ? (
        <div className="space-y-2">
          <p className="text-xs text-ink2">当前浏览器支持一键安装。</p>
          <Button size="sm" variant="soft" onClick={() => void promptEvent.prompt()}>
            安装到主屏幕
          </Button>
        </div>
      ) : (
        <div className="space-y-1.5 text-xs leading-relaxed text-ink2">
          <p>当前浏览器没有提供一键安装入口，可手动添加：</p>
          <ul className="list-disc space-y-1 pl-5">
            <li>Android Chrome / Edge：菜单 →「添加到主屏幕 / 安装应用」</li>
            <li>iPhone Safari：分享 →「添加到主屏幕」</li>
            <li>桌面 Chrome / Edge：地址栏右侧安装图标</li>
          </ul>
          {!isSecure && (
            <p className="text-warn">
              注意：PWA 安装功能只在 HTTPS 或本机 localhost 等安全上下文中可用，当前页面不满足该条件。
            </p>
          )}
          <p className="text-ink3">Windows / Android 安装包版本（EXE / APK）内不需要此功能，界面已自动隐藏。</p>
        </div>
      )}
    </Card>
  )
}

export function SettingsPage() {
  const {
    goals,
    checkins,
    reviews,
    settings,
    storageKind,
    refresh,
    refreshing,
    buildExportPayload,
    importPayload,
    clearDemoData,
    clearAllData,
  } = useAppData()
  const toast = useToast()
  const fileRef = useRef<HTMLInputElement>(null)
  const [importData, setImportData] = useState<ExportPayload | null>(null)
  const [importMode, setImportMode] = useState<'replace' | 'merge'>('merge')
  const [importing, setImporting] = useState(false)
  const [confirmDemo, setConfirmDemo] = useState(false)
  const [confirmAll, setConfirmAll] = useState(false)
  const [clearingDemo, setClearingDemo] = useState(false)
  const [clearingAll, setClearingAll] = useState(false)

  const demoGoalCount = goals.filter((g) => g.isDemo).length
  const demoCheckinCount = checkins.filter((c) => c.isDemo).length

  const storageName = storageKind === 'sqlite' ? '本机 SQLite 数据库' : '浏览器 IndexedDB'

  const doExport = () => {
    const payload = buildExportPayload()
    const ok = downloadJson(`studyflow-backup-${stamp()}.json`, payload)
    if (ok) toast.success(`已导出 ${payload.goals.length} 个目标、${payload.checkins.length} 条打卡记录`)
    else toast.error('导出失败：浏览器阻止了文件下载')
  }

  const onPickFile = async (file: File | undefined) => {
    if (!file) return
    try {
      const text = await file.text()
      const json: unknown = JSON.parse(text)
      const parsed = exportPayloadSchema.safeParse(json)
      if (!parsed.success) {
        toast.error(`导入失败：文件格式不正确（${parsed.error.issues[0]?.message ?? '结构校验未通过'}）`)
        return
      }
      const p = parsed.data
      if (p.schemaVersion !== 1) {
        toast.error(`导入失败：不支持的 schemaVersion=${p.schemaVersion}`)
        return
      }
      const ids = new Set<string>()
      let dup = 0
      for (const item of [...p.goals, ...p.checkins]) {
        if (ids.has(item.id)) dup++
        ids.add(item.id)
      }
      if (dup > 0) {
        toast.error(`导入失败：文件内部存在 ${dup} 个重复 ID，请检查导出文件`)
        return
      }
      setImportData(p)
      setImportMode('merge')
    } catch (err) {
      toast.error(err instanceof Error ? `导入失败：${err.message}` : '导入失败：无法解析该文件')
    } finally {
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  const doImport = async () => {
    if (!importData) return
    setImporting(true)
    try {
      // 导入前自动保留当前数据快照，便于恢复
      const snapOk = downloadJson(`studyflow-导入前快照-${stamp()}.json`, buildExportPayload())
      if (snapOk) toast.info('已自动下载导入前快照')
      const result = await importPayload(importData, importMode)
      toast.success(`导入完成：新增目标 ${result.goals}、打卡 ${result.checkins}、复盘 ${result.reviews}${result.skipped > 0 ? `，跳过 ${result.skipped} 条重复或关联缺失记录` : ''}`)
      setImportData(null)
    } catch (err) {
      toast.error(err instanceof Error ? `导入失败：${err.message}（现有数据未受影响）` : '导入失败，现有数据未受影响')
    } finally {
      setImporting(false)
    }
  }

  const doClearDemo = async () => {
    setClearingDemo(true)
    try {
      await clearDemoData()
      toast.success('示例数据已清除，你的自建内容不受影响')
      setConfirmDemo(false)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '操作失败，请重试')
    } finally {
      setClearingDemo(false)
    }
  }

  const doClearAll = async () => {
    setClearingAll(true)
    try {
      await clearAllData()
      toast.success('已清空全部本地数据（此操作不可恢复）')
      setConfirmAll(false)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '操作失败，请重试')
    } finally {
      setClearingAll(false)
    }
  }

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-xl font-bold text-ink">我的</h1>
        <p className="mt-0.5 text-xs text-ink3">本地数据状态、备份迁移与设置。没有云账号，也不会自动上传任何数据。</p>
      </header>

      <AppearanceCard />
      <WorkspaceSettingsCard />

      <Card className="px-4 py-4">
        <SectionTitle icon={<IconUser />} title="本地存储" />
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2.5 text-sm">
          <div>
            <dt className="text-[11px] text-ink3">当前存储方式</dt>
            <dd className="mt-0.5 font-medium text-ink">{storageName}</dd>
          </div>
          <div>
            <dt className="text-[11px] text-ink3">最近一次成功写入</dt>
            <dd className="tnum mt-0.5 font-medium text-ink">{formatDateTime(settings?.lastSavedAt ?? null)}</dd>
          </div>
          <div>
            <dt className="text-[11px] text-ink3">数据规模</dt>
            <dd className="tnum mt-0.5 font-medium text-ink">
              {goals.length} 个目标 · {checkins.length} 条打卡 · {reviews.length} 份周复盘
            </dd>
          </div>
          <div>
            <dt className="text-[11px] text-ink3">数据位置</dt>
            <dd className="mt-0.5 font-medium text-ink">{storageKind === 'sqlite' ? '应用私有目录，仅本机可读' : '本浏览器站点数据，清浏览器数据会丢失'}</dd>
          </div>
        </dl>
        <div className="mt-3.5">
          <Button variant="secondary" size="sm" loading={refreshing} onClick={() => void refresh().then(() => toast.success('已重新读取本地数据'))}>
            <IconRefresh /> 重新读取本地数据
          </Button>
        </div>
      </Card>

      <Card className="px-4 py-4">
        <SectionTitle icon={<IconDownload />} title="数据备份与迁移（可选）" extra={<span className="text-[11px] text-ink3">三端各自独立保存，导入导出用于手动迁移</span>} />
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" size="sm" onClick={doExport}>
            <IconDownload /> 导出 JSON
          </Button>
          <Button variant="secondary" size="sm" onClick={() => fileRef.current?.click()}>
            <IconUpload /> 导入 JSON
          </Button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            className="hidden"
            aria-label="选择要导入的 JSON 文件"
            onChange={(e) => void onPickFile(e.target.files?.[0])}
          />
        </div>
        <p className="mt-2.5 text-[11px] leading-relaxed text-ink3">
          导入会校验 schemaVersion、数据完整性与重复 ID；正式导入前自动保留当前数据快照。本应用不会自动提醒你导出。
        </p>
      </Card>

      <Card className="px-4 py-4">
        <SectionTitle title="示例数据" />
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs text-ink2">
            当前示例：{demoGoalCount} 个目标、{demoCheckinCount} 条打卡（示例项均带「示例」标记）。
          </p>
          <Button variant="secondary" size="sm" disabled={demoGoalCount === 0} onClick={() => setConfirmDemo(true)}>
            <IconTrash /> 清空示例
          </Button>
        </div>
      </Card>

      <Card className="border-danger/30 px-4 py-4">
        <SectionTitle title="危险区" />
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs text-ink2">清空全部本地数据（目标、打卡、周复盘），输入「清空」确认后执行，不可恢复。</p>
          <Button variant="danger" size="sm" disabled={goals.length === 0 && checkins.length === 0} onClick={() => setConfirmAll(true)}>
            清空全部
          </Button>
        </div>
      </Card>

      {storageKind === 'indexeddb' && !isTauri() && <PwaCard />}

      <Card className="px-4 py-4">
        <SectionTitle icon={<IconInfo />} title="关于 知行 StudyFlow" />
        <div className="space-y-1.5 text-xs leading-relaxed text-ink2">
          <p>版本 0.1.0 · 本地离线应用</p>
          <p>
            「知行」把长期目标拆成每天可完成的一小步：今日建议量、连续打卡与每周弹性休息日、近 7 天速度推算、周报复盘，全部在本机离线计算。
          </p>
          <p className="text-ink3">
            隐私承诺：无账号、无登录、无云端服务器、不上传任何个人数据。Web 版数据保存在浏览器 IndexedDB；Windows / Android
            版保存在应用私有 SQLite 数据库。三端数据彼此独立，可通过 JSON 导出/导入手动迁移。
          </p>
          <p className="text-ink3">© 2026 知行 StudyFlow · 把终点变成今天的一小步</p>
        </div>
      </Card>

      <Modal
        open={!!importData}
        onClose={() => setImportData(null)}
        title="确认导入数据"
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setImportData(null)} disabled={importing}>
              取消
            </Button>
            <Button variant="danger" onClick={() => void doImport()} loading={importing}>
              确认导入
            </Button>
          </div>
        }
      >
        {importData && (
          <div className="space-y-3 text-sm">
            <div className="rounded-xl bg-base px-3.5 py-3 text-xs leading-relaxed text-ink2">
              <p className="font-semibold text-ink">文件摘要</p>
              <p className="tnum mt-1">
                目标 {importData.goals.length} 个 · 打卡 {importData.checkins.length} 条 · 周复盘 {importData.reviews.length} 份
              </p>
              <p className="mt-0.5">导出于 {formatDateTime(importData.exportedAt)}</p>
            </div>
            <fieldset className="space-y-2">
              <legend className="text-[13px] font-medium text-ink2">导入方式</legend>
              <label className="flex cursor-pointer items-start gap-2.5 rounded-xl border border-line px-3.5 py-2.5 text-xs">
                <input
                  type="radio"
                  name="import-mode"
                  checked={importMode === 'merge'}
                  onChange={() => setImportMode('merge')}
                  className="mt-0.5 accent-[rgb(var(--c-primary))]"
                />
                <span>
                  <b className="text-ink">合并</b>：保留现有数据，跳过重复 ID 与关联缺失的记录（推荐）
                </span>
              </label>
              <label className="flex cursor-pointer items-start gap-2.5 rounded-xl border border-line px-3.5 py-2.5 text-xs">
                <input
                  type="radio"
                  name="import-mode"
                  checked={importMode === 'replace'}
                  onChange={() => setImportMode('replace')}
                  className="mt-0.5 accent-[rgb(var(--c-danger))]"
                />
                <span>
                  <b className="text-danger">替换全部</b>：清空现有目标/打卡/复盘后写入文件内容（导入前会自动下载当前数据快照）
                </span>
              </label>
            </fieldset>
          </div>
        )}
      </Modal>

      <ConfirmDialog
        open={confirmDemo}
        title="清空示例数据"
        confirmText="清除示例"
        busy={clearingDemo}
        message={<span>只删除带「示例」标记的 {demoGoalCount} 个目标和 {demoCheckinCount} 条打卡，你自己创建的目标与记录不会受影响。</span>}
        onConfirm={() => void doClearDemo()}
        onClose={() => setConfirmDemo(false)}
      />
      <ConfirmDialog
        open={confirmAll}
        title="清空全部本地数据"
        danger
        requireText="清空"
        confirmText="不可恢复地清空"
        busy={clearingAll}
        message={
          <span>
            将删除本机全部 {goals.length} 个目标、{checkins.length} 条打卡记录与 {reviews.length} 份周复盘。此操作{' '}
            <b className="text-danger">不可恢复</b>，建议先「导出 JSON」备份。
          </span>
        }
        onConfirm={() => void doClearAll()}
        onClose={() => setConfirmAll(false)}
      />
    </div>
  )
}
