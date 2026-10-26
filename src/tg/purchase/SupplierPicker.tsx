import { useId, useState } from 'react'
import { Plus } from 'lucide-react'
import { choiceClass, inputClass } from '@/components/ui'
import type { Supplier } from '@/data/types'
import { t } from '@/i18n'
import { SectionTitle } from '../ui'

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
  const errorId = `${inputId}-error`
  const selectedId = value.kind === 'existing' ? value.id : null
  const selectedIndex = selectedId ? suppliers.findIndex((s) => s.id === selectedId) : -1
  // Tanlangan sotuvchi doim ko'rinsin
  const visible = showAll || selectedIndex >= VISIBLE ? suppliers : suppliers.slice(0, VISIBLE)

  return (
    <section className="flex flex-col gap-2" aria-label={tp.supplier}>
      <div className="flex min-h-11 items-center justify-between gap-2">
        <SectionTitle>{tp.supplier}</SectionTitle>
        {value.kind !== 'none' && (
          <button
            type="button"
            onClick={() => onChange({ kind: 'none' })}
            className="min-h-11 rounded-lg px-3 text-sm font-semibold text-brand hover:bg-ice"
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
            className={choiceClass({ selected: s.id === selectedId, size: 'md' })}
          >
            {s.name}
          </button>
        ))}
        {!showAll && suppliers.length > visible.length && (
          <button
            type="button"
            onClick={() => setShowAll(true)}
            className={choiceClass({ selected: false, size: 'md' })}
          >
            {tp.supplierMore} ({suppliers.length - visible.length})
          </button>
        )}
        <button
          type="button"
          aria-pressed={value.kind === 'new'}
          onClick={() => onChange(value.kind === 'new' ? { kind: 'none' } : { kind: 'new', name: '' })}
          className={choiceClass({ selected: value.kind === 'new', size: 'md', dashed: true })}
        >
          <Plus aria-hidden className="size-4" strokeWidth={2} />
          {tp.supplierNew}
        </button>
      </div>
      {value.kind === 'new' && (
        <div className="flex flex-col gap-1.5">
          <label htmlFor={inputId} className="text-sm font-medium text-ink">
            {tp.supplierName}
          </label>
          <input
            id={inputId}
            autoComplete="off"
            maxLength={120}
            value={value.name}
            placeholder={tp.supplierNamePlaceholder}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? errorId : undefined}
            onChange={(e) => onChange({ kind: 'new', name: e.target.value })}
            className={inputClass({ size: 'lg', error })}
          />
          {error && (
            <p id={errorId} role="alert" className="text-sm text-danger">
              {tp.errors.supplierName}
            </p>
          )}
        </div>
      )}
    </section>
  )
}
