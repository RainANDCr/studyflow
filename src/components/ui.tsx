import { forwardRef, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type TextareaHTMLAttributes } from 'react'
import { IconCheck, IconSpinner } from './icons'
import { COLOR_HEX } from '../domain/types'
import type { ColorKey } from '../domain/types'

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'soft'
type ButtonSize = 'sm' | 'md' | 'lg'

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: ButtonSize
  loading?: boolean
}

const buttonVariants: Record<ButtonVariant, string> = {
  primary: 'gradient-primary text-white shadow-card hover:opacity-90 active:opacity-80',
  secondary: 'bg-surface text-ink border border-line hover:border-primary/50 hover:text-primary',
  ghost: 'text-ink2 hover:bg-surface2 hover:text-ink',
  danger: 'bg-danger text-white hover:opacity-90',
  soft: 'bg-primarySoft text-primary hover:brightness-97',
}

const buttonSizes: Record<ButtonSize, string> = {
  sm: 'h-8 px-3 text-[13px] rounded-lg gap-1',
  md: 'h-10 px-4 text-sm rounded-xl gap-1.5',
  lg: 'h-12 px-6 text-base rounded-xl2 gap-2',
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'primary', size = 'md', loading = false, className = '', children, disabled, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      disabled={disabled || loading}
      className={`inline-flex select-none items-center justify-center font-medium transition-all focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:pointer-events-none disabled:opacity-50 ${buttonVariants[variant]} ${buttonSizes[size]} ${className}`}
      {...rest}
    >
      {loading && <IconSpinner className="text-[1.1em]" />}
      {children}
    </button>
  )
})

export function Card({ className = '', children }: { className?: string; children: ReactNode }) {
  return (
    <div className={`rounded-xl2 border border-line/70 bg-surface shadow-card ${className}`}>{children}</div>
  )
}

export function SectionTitle({ icon, title, extra }: { icon?: ReactNode; title: string; extra?: ReactNode }) {
  return (
    <div className="mb-3 flex items-center justify-between gap-2">
      <h2 className="flex items-center gap-2 text-[15px] font-semibold text-ink">
        {icon && <span className="text-primary text-[1.15em]">{icon}</span>}
        {title}
      </h2>
      {extra}
    </div>
  )
}

export function Field({
  label,
  htmlFor,
  error,
  hint,
  children,
}: {
  label: string
  htmlFor?: string
  error?: string
  hint?: string
  children: ReactNode
}) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={htmlFor} className="block text-[13px] font-medium text-ink2">
        {label}
      </label>
      {children}
      {hint && !error && <p className="text-xs text-ink3">{hint}</p>}
      {error && (
        <p role="alert" className="text-xs text-danger">
          {error}
        </p>
      )}
    </div>
  )
}

const controlClass =
  'w-full rounded-xl border border-line bg-surface px-3.5 text-sm text-ink placeholder:text-ink3 transition-colors focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/15 disabled:bg-surface2'

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input(
  { className = '', ...rest },
  ref,
) {
  return <input ref={ref} className={`${controlClass} h-10 ${className}`} {...rest} />
})

export const TextArea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function TextArea(
  { className = '', rows = 3, ...rest },
  ref,
) {
  return <textarea ref={ref} rows={rows} className={`${controlClass} py-2.5 leading-relaxed ${className}`} {...rest} />
})

export function Toggle({
  checked,
  onChange,
  label,
  id,
}: {
  checked: boolean
  onChange: (v: boolean) => void
  label: string
  id?: string
}) {
  // 整行都是开关：文字与轨道同属一个 role=switch 按钮，命中区更大；
  // 关闭态用中性灰轨道（bg-ink3/45），避免「白钮 + 近白轨道」在浅色/深色下都看不清。
  return (
    <button
      id={id}
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="flex w-full cursor-pointer items-center justify-between gap-4 rounded-lg py-0.5 text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
    >
      <span className="text-[13px] font-medium leading-snug text-ink2">{label}</span>
      <span
        aria-hidden="true"
        className={`relative h-7 w-12 shrink-0 rounded-full transition-colors duration-200 ${checked ? 'gradient-primary' : 'bg-ink3/45'}`}
      >
        <span
          className={`absolute top-1 h-5 w-5 rounded-full bg-white shadow-md ring-1 ring-black/10 transition-transform duration-200 ${
            checked ? 'translate-x-[26px]' : 'translate-x-1'
          }`}
        />
      </span>
    </button>
  )
}

type BadgeTone = 'primary' | 'ok' | 'warn' | 'danger' | 'neutral' | 'backfill'

const badgeTones: Record<BadgeTone, string> = {
  primary: 'bg-primarySoft text-primary',
  ok: 'bg-okSoft text-ok',
  warn: 'bg-warnSoft text-warn',
  danger: 'bg-dangerSoft text-danger',
  neutral: 'bg-surface2 text-ink2',
  backfill: 'bg-primarySoft text-primary',
}

export function Badge({ tone = 'neutral', children }: { tone?: BadgeTone; children: ReactNode }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium leading-4 ${badgeTones[tone]}`}>
      {children}
    </span>
  )
}

export function ColorDot({ color, size = 10 }: { color: ColorKey; size?: number }) {
  return (
    <span
      aria-hidden="true"
      style={{ width: size, height: size, backgroundColor: COLOR_HEX[color] }}
      className="inline-block shrink-0 rounded-full"
    />
  )
}

export function goalColorHex(color: ColorKey): string {
  return COLOR_HEX[color]
}

export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon: ReactNode
  title: string
  description?: string
  action?: ReactNode
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-xl2 border border-dashed border-line bg-surface/60 px-6 py-10 text-center">
      <span className="text-3xl text-ink3">{icon}</span>
      <p className="text-sm font-medium text-ink">{title}</p>
      {description && <p className="max-w-xs text-xs leading-relaxed text-ink3">{description}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  )
}

export function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`animate-pulse rounded-lg bg-surface2 ${className}`} />
}

export function ProgressBar({ percent, color }: { percent: number; color: ColorKey }) {
  return (
    <div
      role="progressbar"
      aria-valuenow={Math.round(percent)}
      aria-valuemin={0}
      aria-valuemax={100}
      className="h-2 w-full overflow-hidden rounded-full bg-surface2"
    >
      <div
        className="h-full rounded-full transition-[width] duration-500"
        style={{ width: `${Math.min(100, Math.max(0, percent))}%`, backgroundColor: COLOR_HEX[color] }}
      />
    </div>
  )
}

export function StatTile({ label, value, sub }: { label: string; value: ReactNode; sub?: ReactNode }) {
  return (
    <div className="rounded-xl border border-line/70 bg-surface px-3 py-2.5">
      <p className="text-[11px] text-ink3">{label}</p>
      <p className="tnum mt-0.5 text-lg font-semibold text-ink">{value}</p>
      {sub && <p className="tnum mt-0.5 text-[11px] text-ink3">{sub}</p>}
    </div>
  )
}

export function CompletionMark({ text = '已完成' }: { text?: string }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-okSoft px-2 py-0.5 text-[11px] font-medium text-ok">
      <IconCheck className="text-[1.1em]" />
      {text}
    </span>
  )
}
