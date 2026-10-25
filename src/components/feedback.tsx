import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'
import { Button, Input } from './ui'
import { IconAlert, IconCheckCircle, IconInfo, IconX } from './icons'

/* ---------------- Toast ---------------- */

interface Toast {
  id: number
  kind: 'success' | 'error' | 'info'
  text: string
}

interface ToastContextValue {
  success: (text: string) => void
  error: (text: string) => void
  info: (text: string) => void
}

const ToastContext = createContext<ToastContextValue | null>(null)

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])
  const seq = useRef(0)

  const push = useCallback((kind: Toast['kind'], text: string) => {
    const id = ++seq.current
    setToasts((ts) => [...ts, { id, kind, text }])
    window.setTimeout(() => {
      setToasts((ts) => ts.filter((t) => t.id !== id))
    }, 3400)
  }, [])

  const value = {
    success: (text: string) => push('success', text),
    error: (text: string) => push('error', text),
    info: (text: string) => push('info', text),
  }

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        aria-live="polite"
        className="pointer-events-none fixed inset-x-0 bottom-[calc(env(safe-area-inset-bottom,0px)+76px)] z-[80] flex flex-col items-center gap-2 px-4 md:bottom-8"
      >
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`animate-rise pointer-events-auto flex max-w-sm items-start gap-2 rounded-xl px-3.5 py-2.5 text-sm text-white shadow-pop ${
              t.kind === 'success' ? 'bg-ok' : t.kind === 'error' ? 'bg-danger' : 'gradient-primary'
            }`}
          >
            <span className="mt-0.5 text-[1.1em]">
              {t.kind === 'success' ? <IconCheckCircle /> : t.kind === 'error' ? <IconAlert /> : <IconInfo />}
            </span>
            <span className="leading-snug">{t.text}</span>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast 必须在 ToastProvider 内使用')
  return ctx
}

/* ---------------- Modal ---------------- */

export function Modal({
  open,
  onClose,
  title,
  children,
  footer,
  dismissable = true,
}: {
  open: boolean
  onClose: () => void
  title: string
  children: ReactNode
  footer?: ReactNode
  dismissable?: boolean
}) {
  const dialogRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    // 焦点管理：打开后聚焦对话框内首个可聚焦元素或对话框本身
    const el = dialogRef.current
    if (el) {
      const focusable = el.querySelector<HTMLElement>('input, textarea, select, button, [href], [tabindex]:not([tabindex="-1"])')
      ;(focusable ?? el).focus()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && dismissable) onClose()
      if (e.key === 'Tab' && el) {
        // 简易焦点圈定
        const items = Array.from(
          el.querySelectorAll<HTMLElement>('input, textarea, select, button, [href], [tabindex]:not([tabindex="-1"])'),
        ).filter((n) => !(n as HTMLButtonElement).disabled && n.offsetParent !== null)
        if (items.length === 0) return
        const first = items[0]
        const last = items[items.length - 1]
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault()
          last.focus()
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault()
          first.focus()
        }
      }
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = prevOverflow
      document.removeEventListener('keydown', onKey)
    }
  }, [open, onClose, dismissable])

  if (!open) return null

  return createPortal(
    <div className="fixed inset-0 z-[70] flex items-end justify-center sm:items-center" role="presentation">
      <div
        className="absolute inset-0 bg-black/45 backdrop-blur-[2px]"
        onClick={() => dismissable && onClose()}
        aria-hidden="true"
      />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className="animate-pop relative z-10 flex max-h-[88dvh] w-full flex-col overflow-hidden rounded-t-2xl bg-surface shadow-pop focus:outline-none sm:m-4 sm:max-w-lg sm:rounded-2xl"
      >
        <div className="flex items-center justify-between gap-2 border-b border-line/70 px-5 py-3.5">
          <h2 className="text-[15px] font-semibold text-ink">{title}</h2>
          {dismissable && (
            <button
              type="button"
              onClick={onClose}
              aria-label="关闭"
              className="rounded-lg p-1.5 text-ink3 transition-colors hover:bg-surface2 hover:text-ink"
            >
              <IconX className="text-lg" />
            </button>
          )}
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer && <div className="border-t border-line/70 px-5 py-3.5">{footer}</div>}
      </div>
    </div>,
    document.body,
  )
}

/* ---------------- ConfirmDialog ---------------- */

export function ConfirmDialog({
  open,
  title,
  message,
  confirmText = '确认',
  cancelText = '取消',
  danger = false,
  requireText,
  busy = false,
  onConfirm,
  onClose,
}: {
  open: boolean
  title: string
  message: ReactNode
  confirmText?: string
  cancelText?: string
  danger?: boolean
  /** 需要手动输入的确认词（例如「清空」） */
  requireText?: string
  busy?: boolean
  onConfirm: () => void
  onClose: () => void
}) {
  const [typed, setTyped] = useState('')
  useEffect(() => {
    if (open) setTyped('')
  }, [open])

  const canConfirm = !requireText || typed.trim() === requireText

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            {cancelText}
          </Button>
          <Button variant={danger ? 'danger' : 'primary'} onClick={onConfirm} disabled={!canConfirm || busy} loading={busy}>
            {confirmText}
          </Button>
        </div>
      }
    >
      <div className="space-y-3">
        <div className="flex items-start gap-2.5 text-sm leading-relaxed text-ink2">{message}</div>
        {requireText && (
          <Input
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            placeholder={`输入「${requireText}」以确认`}
            aria-label={`输入 ${requireText} 确认操作`}
          />
        )}
      </div>
    </Modal>
  )
}
