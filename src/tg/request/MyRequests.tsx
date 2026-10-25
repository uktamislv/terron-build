import { useEffect, useState } from 'react'
import { StatusBadge } from '@/components/StatusBadge'
import { REQUEST_TONE } from '@/components/statusTones'
import { Spinner } from '@/components/ui'
import { listMyRequests } from '@/data/requestsRepo'
import type { MaterialRequest } from '@/data/types'
import { unitLabel } from '@/domain/units'
import { t } from '@/i18n'
import { errorText } from '@/i18n/errorText'
import { formatDate, formatDateTime, formatQty } from '@/lib/format'

const tr = t.tg.request
const LIMIT = 20

/** "Mening so'rovlarim" — oxirgi so'rovlar holati bilan. `reloadKey` o'zgarsa qayta yuklanadi. */
export function MyRequests({ profileId, reloadKey }: { profileId: string; reloadKey: number }) {
  const [rows, setRows] = useState<MaterialRequest[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    listMyRequests(profileId, LIMIT)
      .then((list) => {
        if (!alive) return
        setRows(list)
        setError(null)
      })
      .catch((err: unknown) => alive && setError(errorText(err)))
    return () => {
      alive = false
    }
  }, [profileId, reloadKey])

  return (
    <section aria-label={tr.mine} className="flex flex-col gap-2 border-t border-slate-200 pt-4">
      <h2 className="text-base font-semibold text-slate-900">{tr.mine}</h2>
      {error && <p className="text-sm text-danger">{error}</p>}
      {!rows && !error && <Spinner />}
      {rows && rows.length === 0 && <p className="text-sm text-slate-600">{tr.mineEmpty}</p>}
      {rows && rows.length > 0 && (
        <ul className="flex flex-col gap-2">
          {rows.map((r) => (
            <li key={r.id} data-testid="my-request" className="flex items-start justify-between gap-3 rounded-2xl border border-slate-200 p-3">
              <div className="min-w-0">
                <p className="truncate font-semibold text-slate-900">{r.material_name}</p>
                <p className="text-sm text-slate-700">
                  {formatQty(r.qty_input)} {unitLabel({ unit: r.unit_input, variant: r.unit_variant })}
                  {r.needed_by && <span className="text-slate-500"> · {tr.neededShort(formatDate(`${r.needed_by}T12:00:00+05:00`))}</span>}
                </p>
                <p className="truncate text-xs text-slate-500">
                  {r.object_name} · {formatDateTime(r.created_at)}
                </p>
                {r.status === 'rad' && r.decision_note && <p className="mt-1 text-xs text-danger">{tr.reason(r.decision_note)}</p>}
              </div>
              <StatusBadge tone={REQUEST_TONE[r.status]}>{t.requests.statuses[r.status]}</StatusBadge>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
