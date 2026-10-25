// Davr tugmalari + ixtiyoriy oraliq (dd.mm.yyyy) + obyekt filtri.
import { useState } from 'react'
import { Button, TextField } from '@/components/ui'
import type { ObjectRow } from '@/data/types'
import { PERIOD_PRESETS, periodRange, validateRange, type PeriodPreset } from '@/domain/reports'
import { t } from '@/i18n'
import { SelectField } from '../fields'
import { isoToUz, MAX_RANGE_DAYS, parseUzDate, type DashboardQuery } from './query'

const tr = t.reports

export function PeriodBar({
  query,
  todayIso,
  objects,
  onChange,
}: {
  query: DashboardQuery
  todayIso: string
  objects: ObjectRow[]
  onChange: (next: { from: string; to: string; objectId: string }) => void
}) {
  const [customOpen, setCustomOpen] = useState(query.preset === null)
  const [fromText, setFromText] = useState(isoToUz(query.from))
  const [toText, setToText] = useState(isoToUz(query.to))
  const [rangeError, setRangeError] = useState<string | null>(null)

  const pickPreset = (p: PeriodPreset) => {
    const r = periodRange(p, todayIso)
    setCustomOpen(false)
    setRangeError(null)
    setFromText(isoToUz(r.from))
    setToText(isoToUz(r.to))
    onChange({ ...r, objectId: query.objectId })
  }

  const applyCustom = () => {
    const from = parseUzDate(fromText)
    const to = parseUzDate(toText)
    if (!from || !to) {
      setRangeError(tr.rangeErrors.invalid)
      return
    }
    const check = validateRange(from, to, MAX_RANGE_DAYS)
    if (check !== 'ok') {
      setRangeError(tr.rangeErrors[check])
      return
    }
    setRangeError(null)
    onChange({ from, to, objectId: query.objectId })
  }

  const custom = customOpen || query.preset === null

  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-4">
      <div role="group" aria-label={tr.period} className="flex flex-wrap gap-2">
        {PERIOD_PRESETS.map((p) => {
          const active = !custom && query.preset === p
          return (
            <button
              key={p}
              type="button"
              aria-pressed={active}
              onClick={() => pickPreset(p)}
              className={`min-h-11 rounded-xl px-3 text-sm font-medium ${
                active ? 'bg-brand text-white' : 'bg-brand-light text-brand-dark hover:bg-brand/10'
              }`}
            >
              {tr.presets[p]}
            </button>
          )
        })}
        <button
          type="button"
          aria-pressed={custom}
          onClick={() => setCustomOpen(true)}
          className={`min-h-11 rounded-xl px-3 text-sm font-medium ${
            custom ? 'bg-brand text-white' : 'bg-brand-light text-brand-dark hover:bg-brand/10'
          }`}
        >
          {tr.custom}
        </button>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 lg:items-end">
        {custom && (
          <>
            <TextField
              label={tr.from}
              inputMode="numeric"
              placeholder={tr.datePlaceholder}
              value={fromText}
              onChange={(e) => setFromText(e.target.value)}
              error={rangeError}
            />
            <TextField
              label={tr.to}
              inputMode="numeric"
              placeholder={tr.datePlaceholder}
              value={toText}
              onChange={(e) => setToText(e.target.value)}
            />
            <Button onClick={applyCustom}>{tr.apply}</Button>
          </>
        )}
        <SelectField label={tr.object} value={query.objectId} onChange={(v) => onChange({ from: query.from, to: query.to, objectId: v })}>
          <option value="">{tr.allObjects}</option>
          {objects.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
        </SelectField>
      </div>
    </div>
  )
}
