// Veb panel filtr maydonlari (ombor, xaridlar, podotchet, ogohlantirishlar).
import { useId, type ReactNode } from 'react'
import { Button } from '@/components/ui'
import { t } from '@/i18n'

export function SelectField({
  label,
  value,
  onChange,
  children,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  children: ReactNode
}) {
  const id = useId()
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-medium text-slate-700">
        {label}
      </label>
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="min-h-11 rounded-xl border border-slate-300 bg-white px-3 text-base"
      >
        {children}
      </select>
    </div>
  )
}

export function DateField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  const id = useId()
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-medium text-slate-700">
        {label}
      </label>
      <input
        id={id}
        type="date"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="min-h-11 rounded-xl border border-slate-300 bg-white px-3 text-base"
      />
    </div>
  )
}

/** Sahifalash: "1–50 / 120" va Oldingi/Keyingi. */
export function Pager({
  page,
  pageSize,
  total,
  onPage,
}: {
  page: number
  pageSize: number
  total: number
  onPage: (page: number) => void
}) {
  const first = total === 0 ? 0 : page * pageSize + 1
  const last = Math.min(total, (page + 1) * pageSize)
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-sm text-slate-600">{t.ombor.pageInfo(first, last, total)}</span>
      <div className="flex gap-2">
        <Button variant="secondary" disabled={page === 0} onClick={() => onPage(page - 1)}>
          {t.ombor.prev}
        </Button>
        <Button variant="secondary" disabled={last >= total} onClick={() => onPage(page + 1)}>
          {t.ombor.next}
        </Button>
      </div>
    </div>
  )
}

/** Xato xabari va "Qayta urinish". */
export function RetryNotice({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div role="alert" className="rounded-xl border border-danger/20 bg-danger/5 px-4 py-3 text-sm text-danger">
      {message}{' '}
      <button type="button" className="ml-1 inline-flex min-h-11 items-center px-1 font-semibold underline" onClick={onRetry}>
        {t.common.retry}
      </button>
    </div>
  )
}
