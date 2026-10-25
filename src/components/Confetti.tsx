import { useEffect, useMemo, useState } from 'react'

const CONFETTI_COLORS = ['#7c5cff', '#4f46e5', '#10a678', '#2f7cf6', '#e8a23c', '#f0567a']

/** 首次完成目标的轻量彩带：纯本地 CSS 动画渲染，尊重 prefers-reduced-motion（样式表中已降级隐藏）。 */
export function Confetti({ active, onDone }: { active: boolean; onDone?: () => void }) {
  const [renderKey, setRenderKey] = useState(0)
  useEffect(() => {
    if (active) {
      setRenderKey((k) => k + 1)
      const t = window.setTimeout(() => onDone?.(), 2600)
      return () => window.clearTimeout(t)
    }
  }, [active, onDone])

  const pieces = useMemo(
    () =>
      Array.from({ length: 90 }, (_, i) => ({
        id: i,
        left: Math.random() * 100,
        dx: (Math.random() - 0.5) * 240,
        delay: Math.random() * 0.5,
        duration: 1.6 + Math.random() * 1.1,
        color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
        size: 6 + Math.random() * 5,
      })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [renderKey],
  )

  if (!active) return null

  return (
    <div aria-hidden="true" className="pointer-events-none fixed inset-0 z-[90] overflow-hidden">
      {pieces.map((p) => (
        <span
          key={`${renderKey}-${p.id}`}
          className="confetti-piece"
          style={{
            left: `${p.left}%`,
            width: p.size,
            height: p.size * 1.7,
            backgroundColor: p.color,
            animationDelay: `${p.delay}s`,
            animationDuration: `${p.duration}s`,
            ['--dx' as string]: `${p.dx}px`,
          }}
        />
      ))}
    </div>
  )
}
