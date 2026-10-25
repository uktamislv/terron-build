import { cx } from './cx'

/**
 * Daraja chizig'i: qiymat / chegara. 100 % dan oshsa chiziq chegaradan o'tib qizaradi
 * (chegara belgisi 100 % nuqtada qoladi). Foiz o'ngda.
 */
export function LevelBar({
  value,
  max,
  label,
  warnAt = 0.9,
  showPercent = true,
  className,
}: {
  /** Joriy qiymat (raqam — faqat ko'rsatish uchun, hisob-kitob domain'da). */
  value: number
  /** Chegara (norma, smeta). 0 yoki manfiy — chiziq bo'sh. */
  max: number
  /** Ekran o'quvchi uchun nom. */
  label: string
  /** Shu ulushdan keyin sariq. */
  warnAt?: number
  showPercent?: boolean
  className?: string
}) {
  const ratio = max > 0 ? Math.max(0, value / max) : 0
  const pct = Math.round(ratio * 100)
  const over = ratio > 1
  // Oshganda: 100 % chegara chiziqning ~80 % joyida, oshgan qism qizil
  const scale = over ? Math.min(ratio, 2) : 1
  const fill = Math.min(ratio, scale) / scale
  const mark = 1 / scale
  const tone = over ? 'bg-danger' : ratio >= warnAt ? 'bg-warn' : 'bg-brand'
  return (
    <div className={cx('flex items-center gap-3', className)}>
      <div
        role="meter"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
        aria-valuetext={`${pct}%`}
        className="relative h-2 flex-1 overflow-hidden rounded-full bg-line/70"
      >
        <span
          className={cx('absolute inset-y-0 left-0 rounded-full transition-[width] duration-300', tone)}
          style={{ width: `${(over ? mark : fill) * 100}%` }}
        />
        {over && (
          <span
            className="absolute inset-y-0 rounded-r-full bg-danger/55"
            style={{ left: `${mark * 100}%`, width: `${(fill - mark) * 100}%` }}
          />
        )}
        {over && <span aria-hidden className="absolute inset-y-[-2px] w-0.5 bg-ink" style={{ left: `calc(${mark * 100}% - 1px)` }} />}
      </div>
      {showPercent && (
        <span className={cx('tabular w-12 shrink-0 text-right text-sm font-semibold', over ? 'text-danger' : 'text-ink')}>{pct}%</span>
      )}
    </div>
  )
}
