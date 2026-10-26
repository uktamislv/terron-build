// Pul tarixi qatori — veb "Podotchet" va Telegram ilovasi "Qo'limda → Pul tarixi" uchun YAGONA ko'rinish:
// berildi — "+" va yashil, qaytarildi / xarid — "−" (muammo emas, qizil emas); belgi va chiziq bir xil.
import { HandCoins, ShoppingCart, Undo2 } from 'lucide-react'
import { Badge, EntryRow, type EntryKind, Money } from '@/components/ui'
import type { CashHistoryEntry } from '@/data/cashRepo'
import { t } from '@/i18n'
import { formatDateTime } from '@/lib/format'

const tc = t.cash
const ic = { className: 'size-5', strokeWidth: 1.75, 'aria-hidden': true } as const

const STRIPE: Record<CashHistoryEntry['kind'], EntryKind> = { issued: 'ok', returned: 'neutral', spent: 'xarid' }

function CashIcon({ kind }: { kind: CashHistoryEntry['kind'] }) {
  if (kind === 'issued') return <HandCoins {...ic} />
  if (kind === 'returned') return <Undo2 {...ic} />
  return <ShoppingCart {...ic} />
}

/** "+ 1 000 000 so'm" (yashil) yoki "− 250 000 so'm" (oddiy rang). */
export function CashAmount({ entry }: { entry: Pick<CashHistoryEntry, 'kind' | 'amount'> }) {
  const plus = entry.kind === 'issued'
  return (
    <span data-sign={plus ? 'plus' : 'minus'} className={`tabular inline-flex items-baseline ${plus ? 'text-ok' : 'text-ink'}`}>
      <span className="text-base font-semibold">{plus ? '+' : '−'}</span>
      <Money value={entry.amount} tone={plus ? 'ok' : undefined} signTone={false} />
    </span>
  )
}

/**
 * `person` — sarlavhada odam ismi, turi belgida (veb, ko'p odam); `self` — sarlavhada tur yoki material
 * (Telegram ilovasi, o'z puli). Berish/qaytarishda "Kiritgan: X".
 */
export function CashHistoryRow({
  entry: h,
  perspective,
  onClick,
  testId,
}: {
  entry: CashHistoryEntry
  perspective: 'person' | 'self'
  onClick?: () => void
  testId?: string
}) {
  const kindLabel = tc.kinds[h.kind]
  const title = perspective === 'person' ? (h.profileName ?? kindLabel) : h.kind === 'spent' ? (h.materialName ?? kindLabel) : kindLabel
  return (
    <EntryRow
      as="li"
      testId={testId}
      kind={STRIPE[h.kind]}
      icon={<CashIcon kind={h.kind} />}
      deleted={Boolean(h.deletedAt)}
      title={title}
      badge={
        <>
          {perspective === 'person' && <Badge tone={h.kind === 'issued' ? 'ok' : h.kind === 'returned' ? 'neutral' : 'info'}>{kindLabel}</Badge>}
          {h.deletedAt && <Badge tone="danger">{t.movements.deleted}</Badge>}
        </>
      }
      meta={
        <>
          {h.kind === 'spent' ? (
            (perspective === 'person' ? [h.materialName, h.objectName] : [h.objectName]).filter(Boolean).length > 0 && (
              <span>{(perspective === 'person' ? [h.materialName, h.objectName] : [h.objectName]).filter(Boolean).join(', ')}</span>
            )
          ) : (
            // Berildi — kim bergan; qaytarildi — kim kiritgan (pulni qabul qilgan buxgalter/admin)
            h.createdByName && <span>{h.kind === 'issued' ? tc.givenBy(h.createdByName) : tc.enteredBy(h.createdByName)}</span>
          )}
          <span className="tabular">{formatDateTime(h.at)}</span>
          {h.note && <span className="text-ink">{h.note}</span>}
        </>
      }
      trailing={<CashAmount entry={h} />}
      onClick={onClick}
    />
  )
}
