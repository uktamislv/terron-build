import { useId, useState } from 'react'
import type { Supplier } from '@/data/types'
import { t } from '@/i18n'

const tp = t.tg.purchase
const VISIBLE = 6

export type SupplierChoice = { kind: 'none' } | { kind: 'existing'; id: string } | { kind: 'new'; name: string }

/** Ixtiyoriy sotuvchi: oxirgilar tugma ko'rinishida, "Yangi" — nom yozish. */
export function SupplierPicker({
  suppliers,
  value,
  error,
  onChange,
}: {
  /** Tartib tayyor: oxirgi ishlatilganlar birinchi. */
  suppliers: Supplier[]
  value: SupplierChoice
  error: boolean
  onChange: (next: SupplierChoice) => void
}) {
  const [showAll, setShowAll] = useState(false)
  const inputId = useId()
  const selectedId = value.kind === 'existing' ? value.id : null
  const selectedIndex = selectedId ? suppliers.findIndex((s) => s.id === selectedId) : -1
  // Tanlangan sotuvchi doim ko'rinsin
  const visible = showAll || selectedIndex >= VISIBLE ? suppliers : suppliers.slice(0, VISIBLE)

  return (
    <section className="flex flex-col gap-2" aria-label={tp.supplier}>
      <div className="flex min-h-11 items-center justify-between gap-2">
        <h2 className="text-sm font-medium text-slate-700">{tp.supplier}</h2>
        {value.kind !== 'none' && (
          <button
            type="button"
            onClick={() => onChange({ kind: 'none' })}
            className="min-h-11 px-2 text-sm font-medium text-brand"
          >
            {tp.supplierClear}
          </button>
        )}
      </div>
      <div className="flex flex-wrap gap-2">
        {visible.map((s) => (
          <button
            key={s.id}
            type="button"
            aria-pressed={s.id === selectedId}
            onClick={() => onChange(s.id === selectedId ? { kind: 'none' } : { kind: 'existing', id: s.id })}
            className={`min-h-11 rounded-full border px-4 text-base ${
              s.id === selectedId ? 'border-brand bg-brand text-white' : 'border-slate-300 bg-white text-slate-800'
            }`}
          >
            {s.name}
          </button>
        ))}
        {!showAll && suppliers.length > visible.length && (
          <button
            type="button"
            onClick={() => setShowAll(true)}
            className="min-h-11 rounded-full border border-slate-300 bg-white px-4 text-base text-slate-600"
          >
            {tp.supplierMore} ({suppliers.length - visible.length})
          </button>
        )}
        <button
          type="button"
          aria-pressed={value.kind === 'new'}
          onClick={() => onChange(value.kind === 'new' ? { kind: 'none' } : { kind: 'new', name: '' })}
          className={`min-h-11 rounded-full border border-dashed px-4 text-base ${
            value.kind === 'new' ? 'border-brand bg-brand-light text-brand-dark' : 'border-slate-300 text-brand'
          }`}
        >
          {tp.supplierNew}
        </button>
      </div>
      {value.kind === 'new' && (
        <div className="flex flex-col gap-1.5">
          <label htmlFor={inputId} className="text-sm font-medium text-slate-700">
            {tp.supplierName}
          </label>
          <input
            id={inputId}
            autoComplete="off"
            maxLength={120}
            value={value.name}
            placeholder={tp.supplierNamePlaceholder}
            aria-invalid={error ? true : undefined}
            onChange={(e) => onChange({ kind: 'new', name: e.target.value })}
            className={`min-h-12 rounded-xl border px-3 text-base outline-none focus:border-brand focus:ring-2 focus:ring-brand/20 ${
              error ? 'border-danger' : 'border-slate-300'
            }`}
          />
          {error && <p className="text-sm text-danger">{tp.errors.supplierName}</p>}
        </div>
      )}
    </section>
  )
}
