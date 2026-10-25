// Umumiy kichik UI elementlari (veb va Mini App). Bosiladigan joylar kamida 44 px.
import { useEffect, useId, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode } from 'react'
import { t } from '@/i18n'

type Variant = 'primary' | 'secondary' | 'danger' | 'ghost'

const variants: Record<Variant, string> = {
  primary: 'bg-brand text-white hover:bg-brand/90 disabled:bg-brand/50',
  secondary: 'border border-slate-300 bg-white text-slate-800 hover:bg-slate-50 disabled:opacity-60',
  danger: 'border border-danger/30 bg-white text-danger hover:bg-danger/5 disabled:opacity-60',
  ghost: 'text-brand hover:bg-brand-light disabled:opacity-60',
}

export function Button({
  variant = 'primary',
  className = '',
  type = 'button',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return (
    <button
      type={type}
      className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-4 text-sm font-medium transition-colors disabled:cursor-not-allowed ${variants[variant]} ${className}`}
      {...props}
    />
  )
}

export function Spinner({ label = t.common.loading }: { label?: string }) {
  return (
    <div role="status" className="flex items-center justify-center gap-3 p-6 text-slate-600">
      <span className="size-5 animate-spin rounded-full border-2 border-brand border-t-transparent" aria-hidden />
      <span className="text-sm">{label}</span>
    </div>
  )
}

export function FullPageSpinner({ label }: { label?: string }) {
  return (
    <div className="flex min-h-screen items-center justify-center">
      <Spinner label={label} />
    </div>
  )
}

export function Notice({ tone = 'danger', children }: { tone?: 'danger' | 'warn' | 'ok' | 'info'; children: ReactNode }) {
  const tones = {
    danger: 'border-danger/20 bg-danger/5 text-danger',
    warn: 'border-warn/20 bg-warn/5 text-warn',
    ok: 'border-ok/20 bg-ok/5 text-ok',
    info: 'border-brand/20 bg-brand-light text-brand-dark',
  }
  return (
    <div role={tone === 'danger' ? 'alert' : 'status'} className={`rounded-xl border px-4 py-3 text-sm ${tones[tone]}`}>
      {children}
    </div>
  )
}

export function TextField({
  label,
  error,
  hint,
  className = '',
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { label: string; error?: string | null; hint?: string }) {
  const id = useId()
  return (
    <div className={`flex flex-col gap-1.5 ${className}`}>
      <label htmlFor={id} className="text-sm font-medium text-slate-700">
        {label}
      </label>
      <input
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={error || hint ? `${id}-desc` : undefined}
        className={`min-h-11 rounded-xl border px-3 text-base outline-none focus:border-brand focus:ring-2 focus:ring-brand/20 ${
          error ? 'border-danger' : 'border-slate-300'
        }`}
        {...props}
      />
      {(error || hint) && (
        <p id={`${id}-desc`} className={`text-xs ${error ? 'text-danger' : 'text-slate-500'}`}>
          {error || hint}
        </p>
      )}
    </div>
  )
}

export function Modal({
  title,
  onClose,
  children,
  size = 'md',
}: {
  title: string
  onClose: () => void
  children: ReactNode
  /** md — formalar, lg — ko'p bo'limli karta (masalan material). */
  size?: 'md' | 'lg'
}) {
  const titleId = useId()
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/40 sm:items-center sm:p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={`flex max-h-[92vh] w-full ${size === 'lg' ? 'max-w-2xl' : 'max-w-lg'} flex-col rounded-t-2xl bg-white shadow-xl sm:rounded-2xl`}
      >
        <div className="flex items-center justify-between gap-2 border-b border-slate-200 px-5 py-3">
          <h2 id={titleId} className="text-lg font-semibold text-brand-dark">
            {title}
          </h2>
          <button
            type="button"
            aria-label={t.common.close}
            onClick={onClose}
            className="inline-flex size-11 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100"
          >
            <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>
        <div className="overflow-y-auto px-5 py-4">{children}</div>
      </div>
    </div>
  )
}
