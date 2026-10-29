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

/**
 * "terron. BUILD" yozuvi (logo). O'lcham — `className` dagi `text-*` dan.
 * `onDark` — navy fon uchun: "terron" oq, BUILD och ko'k.
 */
export function Wordmark({ className, onDark = false }: { className?: string; onDark?: boolean }) {
  return (
    <span role="img" aria-label={t.app.name} className={cx('inline-flex items-baseline leading-none whitespace-nowrap', className)}>
      <span className={cx('font-black tracking-[-0.03em]', onDark ? 'text-white' : 'text-navy')}>terron</span>
      {/* Navy fonda ko'k nuqta ko'rinmaydi — och ko'k */}
      <span aria-hidden className={cx('ml-[0.05em] inline-block size-[0.24em] rounded-full', onDark ? 'bg-brand-300' : 'bg-brand')} />
      <span
        aria-hidden
        // Kichik o'lchamlarda (sarlavha) BUILD o'qilsin — kamida 11 px
        className={cx('ml-[0.3em] text-[length:max(0.38em,11px)] font-bold tracking-[0.18em]', onDark ? 'text-brand-300' : 'text-brand')}
      >
        BUILD
      </span>
    </span>
  )
}

/**
 * TERRON belgisi "Nuqtalar": 3×3 nuqta to'ri. Kulrang nuqtalar — tartibsiz ma'lumot,
 * ko'klari — tizimga kiritilgan yozuvlar; ular birga T harfini hosil qiladi.
 * Shakl `public/favicon.svg` va `public/bot-avatar.png` bilan bir xil.
 */
export function BrandMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 40 40" aria-hidden className={className}>
      <rect width="40" height="40" rx="10" fill={colors.ice} />
      {[11, 29].map((x) =>
        [20, 29].map((y) => <circle key={`${x}-${y}`} cx={x} cy={y} r="2.25" fill={colors.lineHover} />),
      )}
      {[11, 20, 29].map((x) => (
        <circle key={`t-${x}`} cx={x} cy="11" r="3" fill={colors.navy} />
      ))}
      <circle cx="20" cy="20" r="3" fill={colors.brand} />
      <circle cx="20" cy="29" r="3" fill={colors.brand} />
    </svg>
  )
}
