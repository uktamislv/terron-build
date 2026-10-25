import type { ReactNode } from 'react'
import { CircleAlert, CircleCheck, Info, TriangleAlert } from 'lucide-react'
import { t } from '@/i18n'
import { cx } from './cx'

export type NoticeTone = 'danger' | 'warn' | 'ok' | 'info'

const tones: Record<NoticeTone, string> = {
  danger: 'border-danger/20 bg-danger-bg text-danger',
  warn: 'border-warn/20 bg-warn-bg text-warn',
  ok: 'border-ok/20 bg-ok-bg text-ok',
  info: 'border-brand/15 bg-ice text-navy',
}

const icons: Record<NoticeTone, ReactNode> = {
  danger: <CircleAlert aria-hidden className="mt-0.5 size-5 shrink-0" strokeWidth={1.75} />,
  warn: <TriangleAlert aria-hidden className="mt-0.5 size-5 shrink-0" strokeWidth={1.75} />,
  ok: <CircleCheck aria-hidden className="mt-0.5 size-5 shrink-0" strokeWidth={1.75} />,
  info: <Info aria-hidden className="mt-0.5 size-5 shrink-0" strokeWidth={1.75} />,
}

/** Sahifa ichidagi xabar (xato — role="alert", qolgani — role="status"). */
export function Notice({ tone = 'danger', children, className }: { tone?: NoticeTone; children: ReactNode; className?: string }) {
  return (
    <div
      role={tone === 'danger' ? 'alert' : 'status'}
      className={cx('flex gap-2.5 rounded-xl border px-4 py-3 text-sm', tones[tone], className)}
    >
      {icons[tone]}
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  )
}

/** Xato xabari va "Qayta urinish". */
export function RetryNotice({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div role="alert" className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border border-danger/20 bg-danger-bg py-1 pr-1 pl-4 text-sm text-danger">
      <CircleAlert aria-hidden className="size-5 shrink-0" strokeWidth={1.75} />
      <span className="min-w-0 flex-1 py-2">{message}</span>
      <button
        type="button"
        className="inline-flex min-h-11 items-center rounded-lg px-3 font-semibold underline-offset-2 hover:bg-danger/5 hover:underline"
        onClick={onRetry}
      >
        {t.common.retry}
      </button>
    </div>
  )
}
