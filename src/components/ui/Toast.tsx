import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Link } from 'react-router-dom'
import { CircleAlert, CircleCheck, X } from 'lucide-react'
import { t } from '@/i18n'
import { cx } from './cx'
import { ToastContext, type ToastAction, type ToastItem, type ToastTone } from './toastContext'

const DURATION = 3000
/** Havolali xabar — o'qib, bosishga ulgurish uchun uzoqroq. */
const ACTION_DURATION = 6000

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([])
  const nextId = useRef(1)
  const dismiss = useCallback((id: number) => setItems((list) => list.filter((x) => x.id !== id)), [])
  const show = useCallback((message: string, tone: ToastTone = 'ok', action?: ToastAction) => {
    const id = nextId.current++
    setItems((list) => [...list.slice(-2), { id, message, tone, action }])
  }, [])
  const api = useMemo(() => ({ show }), [show])

  return (
    <ToastContext.Provider value={api}>
      {children}
      {createPortal(
        <div
          aria-live="polite"
          className="pointer-events-none fixed inset-x-0 bottom-[calc(5rem+env(safe-area-inset-bottom))] z-[60] flex flex-col items-center gap-2 px-4 md:bottom-6"
        >
          {items.map((item) => (
            <ToastView key={item.id} item={item} onDone={dismiss} />
          ))}
        </div>,
        document.body,
      )}
    </ToastContext.Provider>
  )
}

function ToastView({ item, onDone }: { item: ToastItem; onDone: (id: number) => void }) {
  useEffect(() => {
    const timer = setTimeout(() => onDone(item.id), item.action ? ACTION_DURATION : DURATION)
    return () => clearTimeout(timer)
  }, [item.id, item.action, onDone])
  return (
    <div
      role={item.tone === 'danger' ? 'alert' : 'status'}
      className={cx(
        'pointer-events-auto flex min-h-12 w-full max-w-sm animate-pop-in items-center gap-3 rounded-xl py-1 pr-1 pl-4 text-sm font-medium text-white shadow-float',
        item.tone === 'danger' ? 'bg-danger' : 'bg-ink',
      )}
    >
      {item.tone === 'danger' ? (
        <CircleAlert aria-hidden className="size-5 shrink-0" strokeWidth={1.75} />
      ) : (
        <CircleCheck aria-hidden className={cx('size-5 shrink-0', item.tone === 'ok' && 'text-[#7EE2A0]')} strokeWidth={1.75} />
      )}
      <span className="flex-1">{item.message}</span>
      {item.action && (
        <Link
          to={item.action.to}
          onClick={() => onDone(item.id)}
          className="inline-flex min-h-10 shrink-0 items-center rounded-lg px-2 font-semibold text-[#9DB9FF] underline-offset-2 hover:bg-white/10 hover:underline"
        >
          {item.action.label}
        </Link>
      )}
      <button
        type="button"
        aria-label={t.ui.toastClose}
        onClick={() => onDone(item.id)}
        className="inline-flex size-10 items-center justify-center rounded-lg text-white/70 hover:bg-white/10 hover:text-white"
      >
        <X aria-hidden className="size-4" strokeWidth={2} />
      </button>
    </div>
  )
}
