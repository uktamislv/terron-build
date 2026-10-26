import { t } from '@/i18n'
import { cx } from './cx'
import { colors } from './tokens'

/** Bitta kulrang "suyak" blok. */
export function Skeleton({ className }: { className?: string }) {
  return <span aria-hidden className={cx('block animate-pulse rounded-lg bg-line/70', className)} />
}

/** Ro'yxat/jadval yuklanmoqda — qator shakllari (spinner o'rniga). */
export function SkeletonRows({ rows = 4, label = t.common.loading }: { rows?: number; label?: string }) {
  return (
    <div role="status" aria-live="polite" className="flex flex-col gap-2">
      <span className="sr-only">{label}</span>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex items-center gap-3 rounded-xl border border-line bg-paper p-3">
          <Skeleton className="h-10 w-1 rounded-full" />
          <div className="flex flex-1 flex-col gap-2">
            <Skeleton className="h-3.5 w-2/5" />
            <Skeleton className="h-3 w-1/4" />
          </div>
          <Skeleton className="h-5 w-16" />
        </div>
      ))}
    </div>
  )
}

/** Kartochkalar yuklanmoqda. */
export function SkeletonTiles({ count = 4, label = t.common.loading }: { count?: number; label?: string }) {
  return (
    <div role="status" aria-live="polite" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <span className="sr-only">{label}</span>
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="flex flex-col gap-3 rounded-xl border border-line bg-paper p-4">
          <Skeleton className="size-8 rounded-lg" />
          <Skeleton className="h-3 w-1/2" />
          <Skeleton className="h-7 w-2/3" />
        </div>
      ))}
    </div>
  )
}

/** Umumiy yuklanish holati (eski nom saqlangan): qator skeletlari. */
export function Spinner({ label = t.common.loading }: { label?: string }) {
  return <SkeletonRows rows={3} label={label} />
}

/** Butun ekran yuklanmoqda (sessiya tekshiruvi): markazda brend belgisi pulsatsiyasi. */
export function FullPageSpinner({ label = t.common.loading }: { label?: string }) {
  return (
    <div role="status" aria-live="polite" className="min-h-app flex flex-col items-center justify-center gap-4 bg-canvas">
      <BrandMark className="size-12 animate-pulse" />
      <span className="text-sm text-muted">{label}</span>
    </div>
  )
}

/** TERRON belgisi: yuk xati varag'i — navy kvadrat ichida uchta qator, oxirgisi ko'k. */
export function BrandMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 40 40" aria-hidden className={className}>
      <rect width="40" height="40" rx="10" fill={colors.navy} />
      <rect x="10" y="11" width="20" height="3.5" rx="1.75" fill={colors.paper} />
      <rect x="10" y="18.25" width="14" height="3.5" rx="1.75" fill={colors.paper} fillOpacity="0.6" />
      <rect x="10" y="25.5" width="20" height="3.5" rx="1.75" fill={colors.brand} />
    </svg>
  )
}
