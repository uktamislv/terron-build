// Xaridning qabul holati — Telegram ilovasi "Yozuvlarim" uchun qisqa uch holat (sof funksiya).
// Batafsil (chegara, 24 soat) — veb `receiptState` (src/web/purchases/receiptStatus.ts).
import { cmp, isZero, type Dec } from './decimal'

export type SimpleReceiptStatus = 'received' | 'partial' | 'pending'

/**
 * Qabul qilingan miqdor (asosiy birlikda) bo'yicha: 0 — "Kutilmoqda", xarid miqdoriga yetdi yoki oshdi —
 * "Qabul qilindi", orasida — "Qisman". Holat noma'lum (view ko'rinmadi) — null.
 */
export function simpleReceiptStatus(qtyBase: Dec, receivedQtyBase: Dec | null | undefined): SimpleReceiptStatus | null {
  if (receivedQtyBase === null || receivedQtyBase === undefined) return null
  if (isZero(receivedQtyBase)) return 'pending'
  return cmp(receivedQtyBase, qtyBase) >= 0 ? 'received' : 'partial'
}
