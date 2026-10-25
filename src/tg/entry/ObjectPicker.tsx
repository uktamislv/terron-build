import { Building2, Check } from 'lucide-react'
import { cx } from '@/components/ui'
import type { ObjectRow } from '@/data/types'
import { t } from '@/i18n'
import { SectionTitle } from '../ui'
import { orderObjects } from './objects'

const tm = t.tg.movement

/** Obyekt tanlash ro'yxati (bir nechta obyekt bo'lsa). Kirim/chiqim va xarid ekranlari uchun umumiy. */
export function ObjectChooser({
  objects,
  selectedId,
  lastUsed,
  onPick,
}: {
  objects: ObjectRow[]
  selectedId: string | null
  lastUsed: string | null
  onPick: (id: string) => void
}) {
  return (
    <section className="flex flex-col gap-2" aria-label={tm.chooseObject}>
      <SectionTitle>{tm.chooseObject}</SectionTitle>
      {orderObjects(objects, lastUsed).map((o) => {
        const selected = o.id === selectedId
        return (
          <button
            key={o.id}
            type="button"
            aria-pressed={selected}
            onClick={() => onPick(o.id)}
            className={cx(
              'flex min-h-14 items-center justify-between gap-3 rounded-xl border px-4 text-left text-base font-semibold transition-colors',
              selected ? 'border-brand bg-ice text-navy' : 'border-line bg-paper text-ink active:bg-ice',
            )}
          >
            {o.name}
            {selected && <Check aria-hidden className="size-5 shrink-0 text-brand" strokeWidth={2} />}
          </button>
        )
      })}
    </section>
  )
}

/** Tanlangan obyekt satri; bir nechta obyekt bo'lsa — "O'zgartirish". */
export function ObjectBar({ object, onChange }: { object: ObjectRow; onChange: (() => void) | null }) {
  return (
    <div className="flex min-h-12 items-center gap-2 rounded-xl border border-line bg-paper py-1 pr-1 pl-3 text-ink">
      <Building2 aria-hidden className="size-5 shrink-0 text-muted" strokeWidth={1.75} />
      <span className="min-w-0 flex-1 truncate text-sm">
        <span className="text-muted">{tm.object}: </span>
        <strong className="font-semibold">{object.name}</strong>
      </span>
      {onChange && (
        <button type="button" onClick={onChange} className="min-h-11 shrink-0 rounded-lg px-3 text-sm font-semibold text-brand hover:bg-ice">
          {tm.change}
        </button>
      )}
    </div>
  )
}
