// E bo'lim — QR orqali tasdiqlangan chek (rasm majburiyatidan ozod qiladi). Server qoidasi bilan bir xil:
// soliq.uz javobidagi chek jami yoki biror qator summasi xarid summasidan ko'pi bilan 1 so'm farq qiladi
// VA chek sanasi xarid sanasidan ±3 kun ichida. Chek jami noma'lum (null) — hech qachon tasdiqlanmaydi.

import { abs, cmp, sub, type Dec } from '../decimal'
import { RECEIPT_TOTAL_TOLERANCE } from './receiptTotal'

/** Chek va xarid sanalari orasidagi ruxsat etilgan farq (kun, chegara kiradi). */
export const RECEIPT_DATE_TOLERANCE_DAYS = 3

export interface ReceiptVerifiedInput {
  /** soliq.uz javobidagi chek jami; null — javob yo'q yoki jami o'qilmadi. */
  lookupTotal: Dec | null
  /** Chek qatorlari (summasi). */
  lookupItems: readonly { sum: Dec }[]
  /** Chekdagi sana-vaqt (ISO); null — noma'lum. */
  lookupReceiptAt: string | null
  /** Xarid summasi (so'm). */
  totalAmount: Dec | null
  /** Xarid sanasi (ISO). */
  purchasedAt: string
}

function within(a: Dec, b: Dec): boolean {
  return cmp(abs(sub(a, b)), RECEIPT_TOTAL_TOLERANCE) <= 0
}

export function receiptVerified(p: ReceiptVerifiedInput): boolean {
  if (p.lookupTotal === null || p.totalAmount === null) return false
  const total = p.totalAmount
  const sumMatches = within(p.lookupTotal, total) || p.lookupItems.some((i) => within(i.sum, total))
  if (!sumMatches) return false
  if (!p.lookupReceiptAt) return false
  const receiptAt = Date.parse(p.lookupReceiptAt)
  const purchasedAt = Date.parse(p.purchasedAt)
  if (!Number.isFinite(receiptAt) || !Number.isFinite(purchasedAt)) return false
  return Math.abs(receiptAt - purchasedAt) <= RECEIPT_DATE_TOLERANCE_DAYS * 24 * 60 * 60 * 1000
}
