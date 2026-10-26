// Xaridning qabul holati — Telegram ilovasi "Yozuvlar" uchun qisqa uch holat (sof funksiya).
// Batafsil (chegara, 24 soat) — veb `receiptState` (src/web/purchases/receiptStatus.ts).
// Chegara — firma `receipt_mismatch_pct` (veb va `evaluateReceipt` bilan bir xil): farq chegaradan
// oshmasa — "Qabul qilindi" (masalan 500 kg dan 498 kg — 0,4 %).
import { receiptDiffPct } from './alerts/receiptMismatch'
import { cmp, isZero, type Dec } from './decimal'

export type SimpleReceiptStatus = 'received' | 'partial' | 'pending'

/**
 * Qabul qilingan miqdor (asosiy birlikda) bo'yicha: 0 — "Kutilmoqda"; xarid miqdoriga yetdi, oshdi yoki
 * farq `thresholdPct` dan oshmaydi — "Qabul qilindi"; aks holda — "Qisman". Holat noma'lum — null.
 */
export function simpleReceiptStatus(
  qtyBase: Dec,
  receivedQtyBase: Dec | null | undefined,
  thresholdPct: Dec = '0',
): SimpleReceiptStatus | null {
  if (receivedQtyBase === null || receivedQtyBase === undefined) return null
  if (isZero(receivedQtyBase)) return 'pending'
  if (cmp(receivedQtyBase, qtyBase) >= 0 || isZero(qtyBase)) return 'received'
  return cmp(receiptDiffPct(qtyBase, receivedQtyBase), thresholdPct) <= 0 ? 'received' : 'partial'
}
