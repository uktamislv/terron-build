// Davr tugmalari + ixtiyoriy oraliq (dd.mm.yyyy) + obyekt filtri.
import { useId, useState, type ReactNode } from 'react'
import { CalendarRange } from 'lucide-react'
import { Button, chipClass, DateField, FilterBar, type FilterDef } from '@/components/ui'
import type { ObjectRow } from '@/data/types'
import { PERIOD_PRESETS, periodRange, validateRange, type PeriodPreset } from '@/domain/reports'
import { t } from '@/i18n'
import { MAX_RANGE_DAYS, type DashboardQuery } from './query'

const tr = t.reports

export function PeriodBar({
  query,
  todayIso,
  objects,
  onChange,
  filters,
  onClear,
  extra,
}: {
  query: Pick<DashboardQuery, 'from' | 'to' | 'objectId' | 'preset'>
  todayIso: string
  objects: ObjectRow[]
  onChange: (next: { from: string; to: string; objectId: string }) => void
  /** Obyekt filtri o'rniga boshqa filtrlar (masalan, Tarix sahifasi). */
  filters?: FilterDef[]
  onClear?: () => void
  extra?: ReactNode
}) {
  const [customOpen, setCustomOpen] = useState(query.preset === null)
  // ISO (yyyy-mm-dd) — DateField niqobi va min/max tekshiruvi o'zida
  const [from, setFrom] = useState(query.from)
  const [to, setTo] = useState(query.to)
  const [rangeError, setRangeError] = useState<string | null>(null)
  const errorId = useId()

  const pickPreset = (p: PeriodPreset) => {
    const r = periodRange(p, todayIso)
    setCustomOpen(false)
    setRangeError(null)
    setFrom(r.from)
    setTo(r.to)
    onChange({ ...r, objectId: query.objectId })
  }

  const applyCustom = () => {
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
          onClear={onClear}
          extra={extra}
          filters={filters ?? [
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
        <div
          role="group"
          aria-label={tr.custom}
          aria-describedby={rangeError ? errorId : undefined}
          className="grid gap-3 rounded-2xl border border-line bg-paper p-4 sm:grid-cols-[1fr_1fr_auto] sm:items-start"
        >
          <DateField
            label={tr.from}
            value={from}
            max={to || undefined}
            onChange={(v) => {
              setFrom(v)
              setRangeError(null)
            }}
          />
          <DateField
            label={tr.to}
            value={to}
            min={from || undefined}
            onChange={(v) => {
              setTo(v)
              setRangeError(null)
            }}
          />
          <Button className="sm:mt-7" onClick={applyCustom}>
            {tr.apply}
          </Button>
          {rangeError && (
            <p id={errorId} role="alert" className="text-sm text-danger sm:col-span-3">
              {rangeError}
            </p>
          )}
        </div>
      )}
    </div>
  )
}
