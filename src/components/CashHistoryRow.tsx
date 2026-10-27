// Pul tarixi qatori — veb "Podotchet" va Telegram ilovasi "Qo'limda → Pul tarixi" uchun YAGONA ko'rinish:
// berildi — "+" va yashil, qaytarildi / xarid — "−" (muammo emas, qizil emas); belgi va chiziq bir xil.
import { HandCoins, Receipt, ShoppingCart, Undo2 } from 'lucide-react'
import { Badge, EntryRow, type EntryKind, Money } from '@/components/ui'
import type { CashHistoryEntry } from '@/data/cashRepo'
import { t } from '@/i18n'
import { formatDateTime } from '@/lib/format'

const tc = t.cash
const ic = { className: 'size-5', strokeWidth: 1.75, 'aria-hidden': true } as const

const STRIPE: Record<CashHistoryEntry['kind'], EntryKind> = { issued: 'ok', returned: 'neutral', spent: 'xarid' }

function CashIcon({ entry }: { entry: CashHistoryEntry }) {
  if (entry.kind === 'issued') return <HandCoins {...ic} />
  if (entry.kind === 'returned') return <Undo2 {...ic} />
  return 'source' in entry && entry.source === 'expense' ? <Receipt {...ic} /> : <ShoppingCart {...ic} />
}

/** Sarflangan qatorda: xarid — material, xarajat — tur; xarajat obyektsiz bo'lsa — "Umumiy". */
function spentParts(h: Extract<CashHistoryEntry, { kind: 'spent' }>, perspective: 'person' | 'self'): string[] {
  const objectName = h.source === 'expense' ? (h.objectName ?? t.expenses.general) : h.objectName
  return (perspective === 'person' ? [h.materialName, objectName] : [objectName]).filter((x): x is string => Boolean(x))
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
  const kindLabel = h.kind === 'spent' && 'source' in h && h.source === 'expense' ? t.expenses.cashKind : tc.kinds[h.kind]
  const title = perspective === 'person' ? (h.profileName ?? kindLabel) : h.kind === 'spent' ? (h.materialName ?? kindLabel) : kindLabel
  return (
    <EntryRow
      as="li"
      testId={testId}
      kind={STRIPE[h.kind]}
      icon={<CashIcon entry={h} />}
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
            spentParts(h, perspective).length > 0 && <span>{spentParts(h, perspective).join(', ')}</span>
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
