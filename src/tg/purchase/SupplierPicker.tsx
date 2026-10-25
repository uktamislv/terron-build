import { useId, useState } from 'react'
import { Plus } from 'lucide-react'
import { cx } from '@/components/ui'
import type { Supplier } from '@/data/types'
import { t } from '@/i18n'
import { textInputClass } from '../entry/styles'
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
            className={cx(
              'min-h-11 rounded-full border px-4 text-base font-medium transition-colors',
              s.id === selectedId ? 'border-brand bg-ice font-semibold text-brand' : 'border-line bg-paper text-ink active:bg-ice',
            )}
          >
            {s.name}
          </button>
        ))}
        {!showAll && suppliers.length > visible.length && (
          <button
            type="button"
            onClick={() => setShowAll(true)}
            className="min-h-11 rounded-full border border-line bg-paper px-4 text-base text-muted active:bg-ice"
          >
            {tp.supplierMore} ({suppliers.length - visible.length})
          </button>
        )}
        <button
          type="button"
          aria-pressed={value.kind === 'new'}
          onClick={() => onChange(value.kind === 'new' ? { kind: 'none' } : { kind: 'new', name: '' })}
          className={cx(
            'inline-flex min-h-11 items-center gap-1.5 rounded-full border border-dashed px-4 text-base font-medium',
            value.kind === 'new' ? 'border-brand bg-ice text-brand' : 'border-muted/40 bg-paper text-brand',
          )}
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
            onChange={(e) => onChange({ kind: 'new', name: e.target.value })}
            className={cx(textInputClass, error ? 'border-danger' : 'border-line')}
          />
          {error && <p className="text-sm text-danger">{tp.errors.supplierName}</p>}
        </div>
      )}
    </section>
  )
}
