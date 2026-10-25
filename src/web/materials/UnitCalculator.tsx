import { useState } from 'react'
import { TextField } from '@/components/ui'
import type { Material } from '@/data/types'
import { toBaseQty, unitLabel, validateQtyInput } from '@/domain/units'
import { t } from '@/i18n'
import { formatQty } from '@/lib/format'

const tc = t.materials.calc

/**
 * "Miqdor + birlik → asosiy birlikda". Hisob `toBaseQty` bilan — bazadagi
 * `round(qty_input * factor, 6)` bilan aynan bir xil. Batch 4 kirish formasining oldindan ko'rinishi.
 */
export function UnitCalculator({ material }: { material: Material }) {
  const [qty, setQty] = useState('')
  const [unitId, setUnitId] = useState(material.units[0]?.id ?? '')
  const unit = material.units.find((u) => u.id === unitId) ?? material.units[0]
  const check = validateQtyInput(qty)
  const result = check.ok && unit ? toBaseQty(check.value, unit.factor) : null

  if (!unit) return null

  return (
    <section aria-label={tc.title} className="flex flex-col gap-3 rounded-xl bg-slate-50 p-3">
      <div>
        <h3 className="font-semibold text-slate-900">{tc.title}</h3>
        <p className="text-xs text-slate-500">{tc.hint}</p>
      </div>
      <TextField
        label={tc.qty}
        inputMode="decimal"
        value={qty}
        onChange={(e) => setQty(e.target.value)}
        error={qty.trim() && !check.ok ? tc.errQty : null}
      />
      <fieldset>
        <legend className="mb-1.5 text-sm font-medium text-slate-700">{tc.unit}</legend>
        <div className="flex flex-wrap gap-2">
          {material.units.map((u) => (
            <button
              key={u.id}
              type="button"
              aria-pressed={u.id === unit.id}
              onClick={() => setUnitId(u.id)}
              className={`min-h-11 rounded-xl border px-3 text-sm font-medium ${
                u.id === unit.id ? 'border-brand bg-brand text-white' : 'border-slate-300 bg-white text-slate-800'
              }`}
            >
              {unitLabel(u)}
            </button>
          ))}
        </div>
      </fieldset>
      <p className="text-sm text-slate-700">
        {tc.result}:{' '}
        <output aria-label={tc.result} className="text-lg font-semibold text-brand-dark">
          {result !== null ? `${formatQty(result)} ${material.base_unit}` : '—'}
        </output>
      </p>
    </section>
  )
}
