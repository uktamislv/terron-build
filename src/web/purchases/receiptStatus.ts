// Xarid qabul holati — ko'rsatish uchun. Qoida `evaluateReceipt` (domain, bazadagi bilan bir xil),
// chegara — firma `receipt_mismatch_pct`.
import type { Purchase } from '@/data/types'
import { evaluateReceipt } from '@/domain/alerts'
import { isZero } from '@/domain/decimal'

export type ReceiptState = 'full' | 'approx' | 'over' | 'under' | 'pending' | 'none' | 'unknown'

/** To'liq / chegara ichida — yashil; kutilmoqda (24 soat o'tmagan) — sariq; ortiqcha, kam, qabul qilinmagan — qizil. */
export const RECEIPT_TONE: Record<ReceiptState, 'ok' | 'warn' | 'danger' | null> = {
  full: 'ok',
  approx: 'ok',
  pending: 'warn',
  over: 'danger',
  under: 'danger',
  none: 'danger',
  unknown: null,
}

export function receiptState(
  p: Pick<Purchase, 'qty_base' | 'receipt' | 'purchased_at'>,
  thresholdPct: string,
  nowIso: string,
): ReceiptState {
  if (!p.receipt || isZero(p.qty_base)) return 'unknown'
  const received = p.receipt.received_qty_base
  const result = evaluateReceipt({
    purchasedQtyBase: p.qty_base,
    receivedQtyBase: received,
    purchasedAt: p.purchased_at,
    nowIso,
    thresholdPct,
  })
  if (result.status === 'ok') return isZero(result.diffPct) ? 'full' : 'approx'
  if (result.status === 'under' && isZero(received)) return 'none'
  return result.status
}
