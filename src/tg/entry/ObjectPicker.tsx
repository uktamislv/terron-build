import type { ObjectRow } from '@/data/types'
import { t } from '@/i18n'
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
      <h2 className="text-sm font-semibold text-slate-700">{tm.chooseObject}</h2>
      {orderObjects(objects, lastUsed).map((o) => (
        <button
          key={o.id}
          type="button"
          aria-pressed={o.id === selectedId}
          onClick={() => onPick(o.id)}
          className={`min-h-14 rounded-2xl border px-4 text-left text-base font-semibold ${
            o.id === selectedId ? 'border-brand bg-brand-light text-brand-dark' : 'border-slate-200 text-slate-900'
          }`}
        >
          {o.name}
        </button>
      ))}
    </section>
  )
}

/** Tanlangan obyekt satri; bir nechta obyekt bo'lsa — "O'zgartirish". */
export function ObjectBar({ object, onChange }: { object: ObjectRow; onChange: (() => void) | null }) {
  return (
    <div className="flex min-h-11 items-center justify-between gap-2 rounded-xl bg-brand-light px-3 py-1 text-brand-dark">
      <span className="text-sm">
        {tm.object}: <strong>{object.name}</strong>
      </span>
      {onChange && (
        <button type="button" onClick={onChange} className="min-h-11 px-2 text-sm font-medium text-brand">
          {tm.change}
        </button>
      )}
    </div>
  )
}
