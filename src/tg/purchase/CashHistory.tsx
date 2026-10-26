// "Qo'limda" kartasi bosilganda: menga berilgan, mendan qaytarilgan pul va xaridlarga sarflangan
// pul tarixi (yangisi birinchi). Haydovchi, ta'minotchi, prorab.
import { Wallet } from 'lucide-react'
import { CashHistoryRow } from '@/components/CashHistoryRow'
import { EmptyState, RetryNotice, SkeletonRows } from '@/components/ui'
import { listCashHistory } from '@/data/cashRepo'
import { t } from '@/i18n'
import { useLoad } from '@/lib/useLoad'

const tc = t.tg.cashHistory

export function CashHistory({ profileId }: { profileId: string }) {
  const history = useLoad(() => listCashHistory({ profileId }), profileId)
  return (
    <div className="flex flex-col gap-3" data-testid="cash-history">
      <p className="text-sm text-muted">{tc.intro}</p>
      {history.loading && <SkeletonRows rows={3} />}
      {history.error && <RetryNotice message={history.error} onRetry={history.reload} />}
      {history.data && history.data.length === 0 && <EmptyState icon={<Wallet strokeWidth={1.5} />} title={tc.empty} />}
      {history.data && history.data.length > 0 && (
        <ul className="flex flex-col gap-2" aria-label={tc.title}>
          {history.data.map((h) => (
            <CashHistoryRow key={`${h.kind}:${h.id}`} entry={h} perspective="self" />
          ))}
        </ul>
      )}
    </div>
  )
}
