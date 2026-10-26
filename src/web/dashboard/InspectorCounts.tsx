// Tekshiruvchi veb bosh sahifasi: o'zi o'tkazgan oxirgi inventarizatsiyalar holati bilan (qoralama,
// yakunlangan, qoldiq tuzatilgan). Ko'r-ko'rona sanash — qoldiq va farqlar ko'rsatilmaydi.
import { ClipboardCheck } from 'lucide-react'
import { INVENTORY_TONE } from '@/components/statusTones'
import { Badge, Card, EmptyState, EntryRow, RetryNotice, SkeletonRows } from '@/components/ui'
import { listCounts } from '@/data/inventoryRepo'
import type { InventoryCount } from '@/data/types'
import { t } from '@/i18n'
import { formatDateTime } from '@/lib/format'
import { useLoad } from '@/lib/useLoad'

const RECENT = 10

function statusBadge(c: InventoryCount) {
  if (c.applied_at) return <Badge tone="ok">{t.tg.mine.countApplied}</Badge>
  return <Badge tone={INVENTORY_TONE[c.status]}>{t.inventory.statuses[c.status]}</Badge>
}

export function InspectorCounts({ profileId }: { profileId: string }) {
  const counts = useLoad(() => listCounts({ createdBy: profileId }).then((r) => r.rows.slice(0, RECENT)), profileId)
  return (
    <Card title={t.reports.inspectorRecent} bodyClassName="flex flex-col gap-3 p-4 md:p-5">
      <p className="text-sm text-muted">{t.reports.inspectorNote}</p>
      {counts.loading && <SkeletonRows rows={3} />}
      {counts.error && <RetryNotice message={counts.error} onRetry={counts.reload} />}
      {counts.data && counts.data.length === 0 && <EmptyState icon={<ClipboardCheck strokeWidth={1.5} />} title={t.reports.inspectorEmpty} />}
      {counts.data && counts.data.length > 0 && (
        <ul className="flex flex-col gap-2" aria-label={t.reports.inspectorRecent}>
          {counts.data.map((c) => (
            <EntryRow
              key={c.id}
              as="li"
              testId="inspector-count"
              kind="neutral"
              icon={<ClipboardCheck className="size-5" strokeWidth={1.75} />}
              title={c.object_name ?? '—'}
              badge={statusBadge(c)}
              meta={
                <>
                  <span>{t.tg.mine.countItems(c.item_count)}</span>
                  <span className="tabular">{formatDateTime(c.created_at)}</span>
                </>
              }
            />
          ))}
        </ul>
      )}
    </Card>
  )
}
