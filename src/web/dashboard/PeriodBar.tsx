// Davr tugmalari + ixtiyoriy oraliq (dd.mm.yyyy) + obyekt filtri.
import { useState } from 'react'
import { CalendarRange } from 'lucide-react'
import { Button, chipClass, FilterBar, TextField } from '@/components/ui'
import type { ObjectRow } from '@/data/types'
import { PERIOD_PRESETS, periodRange, validateRange, type PeriodPreset } from '@/domain/reports'
import { t } from '@/i18n'
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
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-2 md:flex-row md:flex-wrap md:items-center">
        <div role="group" aria-label={tr.period} className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4 md:mx-0 md:px-0">
          {PERIOD_PRESETS.map((p) => {
            const active = !custom && query.preset === p
            return (
              <button key={p} type="button" aria-pressed={active} onClick={() => pickPreset(p)} className={chipClass(active)}>
                {tr.presets[p]}
              </button>
            )
          })}
          <button type="button" aria-pressed={custom} onClick={() => setCustomOpen(true)} className={chipClass(custom)}>
            <CalendarRange aria-hidden className="size-4" strokeWidth={1.75} />
            {tr.custom}
          </button>
        </div>
        <span aria-hidden className="hidden h-6 w-px bg-line md:block" />
        <FilterBar
          filters={[
            {
              kind: 'select',
              key: 'object',
              label: tr.object,
              value: query.objectId,
              onChange: (v) => onChange({ from: query.from, to: query.to, objectId: v }),
              options: [{ value: '', label: tr.allObjects }, ...objects.map((o) => ({ value: o.id, label: o.name }))],
            },
          ]}
        />
      </div>
      {custom && (
        <div className="grid gap-3 rounded-2xl border border-line bg-paper p-4 sm:grid-cols-[1fr_1fr_auto] sm:items-start">
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
          <Button className="sm:mt-7" onClick={applyCustom}>
            {tr.apply}
          </Button>
        </div>
      )}
    </div>
  )
}
