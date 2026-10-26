import { useEffect, useState } from 'react'
import { ClipboardList } from 'lucide-react'
import { Badge, EntryRow, Qty, RetryNotice, SkeletonRows } from '@/components/ui'
import { REQUEST_TONE } from '@/components/statusTones'
import { listMyRequests } from '@/data/requestsRepo'
import type { MaterialRequest } from '@/data/types'
import { unitLabel } from '@/domain/units'
import { t } from '@/i18n'
import { errorText } from '@/i18n/errorText'
import { formatDate, formatDateTime } from '@/lib/format'
import { SectionTitle } from '../ui'

const tr = t.tg.request
const LIMIT = 20


/** "Mening so'rovlarim" — oxirgi so'rovlar holati bilan. `reloadKey` o'zgarsa qayta yuklanadi. */
export function MyRequests({ profileId, reloadKey }: { profileId: string; reloadKey: number }) {
  const [rows, setRows] = useState<MaterialRequest[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [retryKey, setRetryKey] = useState(0)

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
  }, [profileId, reloadKey, retryKey])

  return <MyRequestsView rows={rows} error={error} onRetry={() => setRetryKey((k) => k + 1)} />
}

/** So'rovlar ro'yxati (taqdimot). */
export function MyRequestsView({ rows, error, onRetry }: { rows: MaterialRequest[] | null; error: string | null; onRetry: () => void }) {
  return (
    <section aria-label={tr.mine} className="flex flex-col gap-2 border-t border-line pt-5">
      <SectionTitle>{tr.mine}</SectionTitle>
      {error && <RetryNotice message={error} onRetry={onRetry} />}
      {!rows && !error && <SkeletonRows rows={2} />}
      {rows && rows.length === 0 && <p className="text-sm text-muted">{tr.mineEmpty}</p>}
      {rows && rows.length > 0 && (
        <ul className="flex flex-col gap-2">
          {rows.map((r) => (
            <EntryRow
              key={r.id}
              as="li"
              testId="my-request"
              // So'rov qatori chizig'i — neytral; holat belgida (info / ok / neutral)
              kind="neutral"
              icon={<ClipboardList className="size-5" strokeWidth={1.75} />}
              title={r.material_name ?? ''}
              badge={<Badge tone={REQUEST_TONE[r.status]}>{t.requests.statuses[r.status]}</Badge>}
              meta={
                <>
                  <span>{r.object_name}</span>
                  <span className="tabular">{formatDateTime(r.created_at)}</span>
                  {r.needed_by && <span>{tr.neededShort(formatDate(`${r.needed_by}T12:00:00+05:00`))}</span>}
                  {r.status === 'rad' && r.decision_note && <span className="text-danger">{tr.reason(r.decision_note)}</span>}
                </>
              }
              trailing={<Qty value={r.qty_input} unit={unitLabel({ unit: r.unit_input, variant: r.unit_variant })} />}
            />
          ))}
        </ul>
      )}
    </section>
  )
}
