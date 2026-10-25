// Mini App ekranlari uchun umumiy kichik bo'laklar (UI to'plami ustida).
import type { ReactNode } from 'react'
import { ChevronLeft, CircleCheck, Search } from 'lucide-react'
import { cx, Notice } from '@/components/ui'
import { t } from '@/i18n'

/** Saqlash tasdig'i: ✓ belgisi va matn (role="status"). */
export function SavedBanner({ children }: { children: ReactNode }) {
  return (
    <div role="status" className="flex animate-pop-in items-start gap-3 rounded-xl border border-ok/25 bg-ok-bg px-4 py-3 text-ok">
      <CircleCheck aria-hidden className="mt-0.5 size-5 shrink-0" strokeWidth={2} />
      <p className="font-semibold">{children}</p>
    </div>
  )
}

/** Yuklash xatosi va "Qayta urinish" (Notice ichida). */
export function LoadError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <Notice>
      {message}{' '}
      <button type="button" className="ml-1 inline-flex min-h-11 items-center px-1 font-semibold underline" onClick={onRetry}>
        {t.common.retry}
      </button>
    </Notice>
  )
}

/** Bo'lim sarlavhasi (kichik, kulrang emas — ink). */
export function SectionTitle({ children, className }: { children: ReactNode; className?: string }) {
  return <h2 className={cx('text-base font-semibold text-ink', className)}>{children}</h2>
}

/** Qidiruv maydoni (16 px, belgi bilan). */
export function SearchBox({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div className="relative">
      <Search aria-hidden className="pointer-events-none absolute top-1/2 left-3.5 size-5 -translate-y-1/2 text-muted" strokeWidth={1.75} />
      <input
        type="search"
        aria-label={label}
        placeholder={label}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="min-h-12 w-full rounded-xl border border-line bg-paper pr-3 pl-11 text-base outline-none placeholder:text-muted/70 focus:border-brand focus:ring-3 focus:ring-brand/15"
      />
    </div>
  )
}

/** Katta material plitkasi: nom (2 qatorgacha), ostida birlik yoki holat. */
export function MaterialTile({
  name,
  sub,
  done = false,
  onClick,
}: {
  name: string
  sub: ReactNode
  /** Sanalgan / tanlangan — yashil chegara. */
  done?: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      data-counted={done ? 'true' : undefined}
      onClick={onClick}
      className={cx(
        'flex min-h-[76px] flex-col items-start justify-between gap-1 rounded-xl border bg-paper px-3 py-2.5 text-left transition-colors active:bg-ice',
        done ? 'border-ok/45 bg-ok-bg/60' : 'border-line hover:border-brand/40',
      )}
    >
      <span className="line-clamp-2 text-base leading-snug font-semibold text-ink">{name}</span>
      <span className={cx('text-xs', done ? 'font-semibold text-ok' : 'text-muted')}>{sub}</span>
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

/** Kartadagi "nom — qiymat" qatorlari (dl). */
export function DetailList({ children }: { children: ReactNode }) {
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2.5 rounded-xl border border-line bg-paper p-4 text-sm [&>dd]:text-ink [&>dt]:text-muted">
      {children}
    </dl>
  )
}
