// Material tanlash (veb): qidiruv + natijalar tugmalari (matn yozib nom kiritilmaydi — faqat tanlanadi).
import { useMemo, useState } from 'react'
import { Check } from 'lucide-react'
import { choiceClass, SearchBox } from '@/components/ui'
import type { Material } from '@/data/types'
import { t } from '@/i18n'
import { matchesQuery } from '../materials/materialFilter'

const tm = t.tg.movement
const MAX_RESULTS = 8

export function MaterialPicker({
  materials,
  value,
  onChange,
  error,
}: {
  materials: readonly Material[]
  value: string | null
  onChange: (id: string) => void
  error?: string | null
}) {
  const [query, setQuery] = useState('')
  const [changing, setChanging] = useState(value === null)
  const selected = materials.find((m) => m.id === value) ?? null
  const results = useMemo(() => materials.filter((m) => matchesQuery(m, query)).slice(0, MAX_RESULTS), [materials, query])

  if (selected && !changing) {
    return (
      <div className="flex flex-col gap-1.5">
        <span className="text-sm font-medium text-ink">{tm.material}</span>
        <div className="flex min-h-11 items-center gap-2 rounded-xl border border-brand bg-ice py-1 pr-1 pl-3">
          <Check aria-hidden className="size-4 shrink-0 text-brand" strokeWidth={2} />
          <span className="min-w-0 flex-1 truncate text-sm font-semibold text-navy">{selected.name}</span>
          <button
            type="button"
            className="min-h-11 shrink-0 rounded-lg px-3 text-sm font-semibold text-brand hover:bg-paper"
            onClick={() => setChanging(true)}
          >
            {tm.change}
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-1.5" role="group" aria-label={tm.material}>
      <span className="text-sm font-medium text-ink">{tm.material}</span>
      <SearchBox label={tm.search} value={query} onChange={setQuery} placeholder={tm.search} size="md" />
      <div className="flex max-h-64 flex-col gap-1.5 overflow-y-auto">
        {results.length === 0 && <p className="text-sm text-muted">{tm.notFound}</p>}
        {results.map((m) => (
          <button
            key={m.id}
            type="button"
            aria-pressed={m.id === value}
            className={choiceClass({ selected: m.id === value, shape: 'row' })}
            onClick={() => {
              onChange(m.id)
              setChanging(false)
              setQuery('')
            }}
          >
            <span className="min-w-0 flex-1 truncate">{m.name}</span>
            <span className="shrink-0 text-xs text-muted">{m.base_unit}</span>
          </button>
        ))}
      </div>
      {error && (
        <p role="alert" className="text-xs text-danger">
          {error}
        </p>
      )}
    </div>
  )
}
