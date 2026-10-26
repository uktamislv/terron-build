// "Qo'limda" kartasi bosilganda: menga berilgan, mendan qaytarilgan pul va xaridlarga sarflangan
// pul tarixi (yangisi birinchi). Haydovchi, ta'minotchi, prorab.
import { ShoppingCart, Undo2, Wallet } from 'lucide-react'
import { EmptyState, EntryRow, type EntryKind, Money, RetryNotice, SkeletonRows } from '@/components/ui'
import { listCashHistory, type CashHistoryEntry } from '@/data/cashRepo'
import { t } from '@/i18n'
import { formatDateTime } from '@/lib/format'
import { useLoad } from '@/lib/useLoad'

const tc = t.tg.cashHistory
const ic = { className: 'size-[18px]', strokeWidth: 1.75, 'aria-hidden': true } as const

const MARK: Record<CashHistoryEntry['kind'], { kind: EntryKind; label: string }> = {
  issued: { kind: 'ok', label: t.cash.kinds.issued },
  returned: { kind: 'neutral', label: t.cash.kinds.returned },
  spent: { kind: 'xarid', label: t.cash.kinds.spent },
}

function icon(kind: CashHistoryEntry['kind']) {
  if (kind === 'issued') return <Wallet {...ic} />
  if (kind === 'returned') return <Undo2 {...ic} />
  return <ShoppingCart {...ic} />
}

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
          {history.data.map((h) => {
            const mark = MARK[h.kind]
            return (
              <EntryRow
                key={`${h.kind}:${h.id}`}
                as="li"
                kind={mark.kind}
                icon={icon(h.kind)}
                title={h.kind === 'spent' ? (h.materialName ?? mark.label) : mark.label}
                meta={
                  <>
                    {h.kind === 'spent' ? <span>{h.objectName}</span> : h.createdByName && <span>{tc.by(h.createdByName)}</span>}
                    <span className="tabular">{formatDateTime(h.at)}</span>
                  </>
                }
                // Chiqim (sarf, qaytarish) — minus belgisi bilan, lekin qizil emas (muammo emas)
                trailing={<Money value={h.kind === 'issued' ? h.amount : `-${h.amount}`} signTone={false} />}
              />
            )
          })}
        </ul>
      )}
    </div>
  )
}
