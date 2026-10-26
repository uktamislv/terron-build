// Mini App ekranlari uchun umumiy kichik bo'laklar (UI to'plami ustida).
import type { ReactNode } from 'react'
import { Check, ChevronLeft, CircleCheck, Star } from 'lucide-react'
import { choiceClass, cx } from '@/components/ui'

/** Saqlash tasdig'i: belgi, matn va ixtiyoriy ikkinchi qator (obyekt, summa) — role="status". */
export function SavedBanner({ children, meta }: { children: ReactNode; meta?: ReactNode }) {
  return (
    <div role="status" className="flex animate-pop-in items-start gap-3 rounded-xl border border-ok/25 bg-ok-bg px-4 py-3 text-ok">
      <CircleCheck aria-hidden className="mt-0.5 size-5 shrink-0" strokeWidth={2} />
      <div className="flex min-w-0 flex-col gap-0.5">
        <p className="font-semibold">{children}</p>
        {meta && <p className="tabular text-sm">{meta}</p>}
      </div>
    </div>
  )
}

/** Bo'lim sarlavhasi (20 px — design-system: bo'lim/kartochka sarlavhasi). */
export function SectionTitle({ children, className }: { children: ReactNode; className?: string }) {
  return <h2 className={cx('text-xl font-semibold text-ink', className)}>{children}</h2>
}

/** Katta material plitkasi: nom (2 qatorgacha), ostida birlik yoki holat. */
export function MaterialTile({
  name,
  sub,
  done = false,
  pinned = false,
  onClick,
}: {
  name: string
  sub: ReactNode
  /** Sanalgan — yashil chegara va belgi. */
  done?: boolean
  /** Ko'p ishlatiladigan (to'r tepasida) — ko'k chegara va yulduzcha. */
  pinned?: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      data-counted={done ? 'true' : undefined}
      data-pinned={pinned ? 'true' : undefined}
      onClick={onClick}
      className={choiceClass({ selected: done, shape: 'tile', tone: 'ok', highlight: pinned })}
    >
      <span className="line-clamp-2 text-base leading-snug font-semibold text-ink">{name}</span>
      <span className={cx('flex items-center gap-1 text-xs', done ? 'font-semibold text-ok' : 'text-muted')}>
        {done && <Check aria-hidden className="size-3.5" strokeWidth={2.5} />}
        {pinned && !done && <Star aria-hidden className="size-3.5 fill-brand text-brand" strokeWidth={1.75} />}
        {sub}
      </span>
    </button>
  )
}

/** "← Orqaga" — ekran ichidagi qaytish havolasi. */
export function BackLink({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="-ml-2 inline-flex min-h-11 items-center gap-1 self-start rounded-lg pr-3 pl-1 text-sm font-semibold text-brand hover:bg-ice"
    >
      <ChevronLeft aria-hidden className="size-5" strokeWidth={2} />
      {label}
    </button>
  )
}
