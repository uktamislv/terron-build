// Xarid qabul holati — ko'rsatish uchun. Qoida `evaluateReceipt` (domain, bazadagi bilan bir xil),
// chegara — firma `receipt_mismatch_pct`.
import type { Purchase } from '@/data/types'
import { evaluateReceipt, receiptDiffPct } from '@/domain/alerts'
import { add, cmp, isZero } from '@/domain/decimal'

export type ReceiptState = 'full' | 'approx' | 'over' | 'under' | 'pending' | 'none' | 'covered' | 'unknown'

/** To'liq / chegara ichida — yashil; kutilmoqda (24 soat o'tmagan) — sariq; ortiqcha, kam, qabul qilinmagan — qizil. */
export const RECEIPT_TONE: Record<ReceiptState, 'ok' | 'warn' | 'danger' | null> = {
  full: 'ok',
  approx: 'ok',
  pending: 'warn',
  over: 'danger',
  under: 'danger',
  none: 'danger',
  // Miqdor bor, lekin kirim xaridga bog'lanmagan — bog'lash kerak (qizil emas)
  covered: 'warn',
  unknown: null,
}

/**
 * Qabul holati. Kam (24 soat o'tgan) bo'lsa va bog'lanmagan nomzod kirimlar (`unlinked_qty_base`) bilan farq
 * chegara ichida — "covered" (server qoida 1 bilan bir xil: alert ochilmaydi, kirimni xaridga bog'lash kerak).
 */
export function receiptState(
  p: Pick<Purchase, 'qty_base' | 'receipt' | 'purchased_at'> & { created_at?: string },
  thresholdPct: string,
  nowIso: string,
): ReceiptState {
  if (!p.receipt || isZero(p.qty_base)) return 'unknown'
  const received = p.receipt.received_qty_base
  const result = evaluateReceipt({
    purchasedQtyBase: p.qty_base,
    receivedQtyBase: received,
    purchasedAt: p.purchased_at,
    // Orqa sana bilan kiritilgan xarid — kutish kiritilgan vaqtdan (bazadagi kabi)
    ...(p.created_at ? { createdAt: p.created_at } : {}),
    nowIso,
    thresholdPct,
  })
  if (result.status === 'ok') return isZero(result.diffPct) ? 'full' : 'approx'
  if (result.status === 'under') {
    const unlinked = p.receipt.unlinked_qty_base
    if (unlinked && cmp(unlinked, '0') > 0 && cmp(receiptDiffPct(p.qty_base, add(received, unlinked)), thresholdPct) <= 0) return 'covered'
    if (isZero(received)) return 'none'
  }
  return result.status
}
