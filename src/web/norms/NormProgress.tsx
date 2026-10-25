import { cmp, type Dec } from '@/domain/decimal'
import { formatQty } from '@/lib/format'

/** Smeta ishlatilishi foizi: progress chizig'i (100 % dan oshsa — qizil, 100 % da to'xtaydi). */
export function NormProgress({ pct, label }: { pct: Dec | null; label?: string }) {
  if (pct === null) return null
  const over = cmp(pct, '100') > 0
  const width = over ? 100 : Math.max(0, Math.min(100, Number(pct)))
  return (
    <div className="flex min-w-24 flex-col gap-1">
      <div
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={width}
        aria-label={label}
        className="h-2 w-full overflow-hidden rounded-full bg-slate-100"
      >
        <div className={`h-full rounded-full ${over ? 'bg-danger' : 'bg-brand'}`} style={{ width: `${width}%` }} />
      </div>
      <span className={`text-xs ${over ? 'font-semibold text-danger' : 'text-slate-600'}`}>{formatQty(pct, 1)}%</span>
    </div>
  )
}
