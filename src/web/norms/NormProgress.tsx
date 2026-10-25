import { cmp, type Dec } from '@/domain/decimal'
import { formatQty } from '@/lib/format'

/**
 * Smeta ishlatilishi foizi — "daraja chizig'i" (LevelBar uslubida): 100 % dan oshsa chiziq chegaradan
 * o'tib qizaradi, chegara belgisi qoladi. `role="progressbar"` (aria-valuenow 0–100) saqlangan.
 */
export function NormProgress({ pct, label }: { pct: Dec | null; label?: string }) {
  if (pct === null) return null
  const over = cmp(pct, '100') > 0
  // Faqat chizish uchun (raqam — ko'rsatish; hisob domain'da)
  const n = Math.max(0, Number(pct))
  const width = over ? 100 : Math.min(100, n)
  const scale = over ? Math.min(n / 100, 2) : 1
  const mark = 1 / scale
  const warn = !over && n >= 90
  return (
    <div className="flex min-w-28 items-center gap-2">
      <div
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={width}
        aria-label={label}
        className="relative h-2 flex-1 overflow-hidden rounded-full bg-line/70"
      >
        <div
          className={`absolute inset-y-0 left-0 rounded-full ${over ? 'bg-danger' : warn ? 'bg-warn' : 'bg-brand'}`}
          style={{ width: `${over ? mark * 100 : width}%` }}
        />
        {over && (
          <>
            <div className="absolute inset-y-0 rounded-r-full bg-danger/55" style={{ left: `${mark * 100}%`, right: 0 }} />
            <div aria-hidden className="absolute inset-y-0 w-0.5 bg-ink" style={{ left: `calc(${mark * 100}% - 1px)` }} />
          </>
        )}
      </div>
      <span className={`tabular w-14 shrink-0 text-right text-xs ${over ? 'font-semibold text-danger' : 'text-muted'}`}>
        {formatQty(pct, 1)}%
      </span>
    </div>
  )
}
