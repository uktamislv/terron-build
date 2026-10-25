// A bo'lim — kirim manbasi. `private.evaluate_kirim_source` bilan parity (occurred_at — kirim vaqti):
//  - `kirim_manbasiz` (belgi), faqat `kirim` va `purchase_id` null bo'lsa:
//    reason 'open_purchase' — shu obyekt+materialda ochiq (to'liq qabul qilinmagan) xarid,
//      `purchased_at ∈ [occurred_at − 14 kun, occurred_at + 1 kun]` (ikkala chegara kiradi);
//    aks holda reason 'no_source' — `[occurred_at − 7 kun, occurred_at]` oralig'ida (chegaralar kiradi)
//      shu obyekt+material uchun xarid ham, bekor qilinmagan o'tkazma ham yo'q.
//      `occurred_at` dan KEYINGI manbalar hisobga olinmaydi.
//    SQL `transfer_id` ni tekshirmaydi (o'tkazma kirimi — `transfer_in` turi), shuning uchun bu yerda ham yo'q.
//  - Nomzod kirim (`private.evaluate_purchase_receipt`): shu obyekt, material, bog'lanmagan,
//    `purchasedAt ≤ occurredAt ≤ purchasedAt + 72 soat`.

import { add, cmp, type Dec } from '../decimal'
import { receiptDiffPct } from '../alerts/receiptMismatch'
import type { MovementType } from '../movements'

export const UNSOURCED_LOOKBACK_DAYS = 7
export const OPEN_PURCHASE_BEFORE_DAYS = 14
export const OPEN_PURCHASE_AFTER_DAYS = 1
export const CANDIDATE_WINDOW_HOURS = 72

const HOUR_MS = 3_600_000
const DAY_MS = 24 * HOUR_MS

export type KirimSourceReason = 'open_purchase' | 'no_source'

export interface UnsourcedKirimInput {
  type: MovementType
  purchaseId: string | null
  /** Kirim `occurred_at` (ISO). */
  occurredAt: string
  /**
   * Shu obyekt+material bo'yicha OCHIQ xaridlarning `purchased_at` lari (o'chirilmagan, qty_base >
   * bog'langan kirimlar yig'indisi). Sana bo'yicha filtrlash shart emas — oyna shu yerda qo'llanadi.
   */
  openPurchaseDates: readonly string[]
  /**
   * Shu obyekt+material manbalari: tirik xaridlarning `purchased_at` va shu obyektga kelgan bekor
   * qilinmagan o'tkazmalarning `created_at`. Filtrlash shart emas — oyna shu yerda qo'llanadi.
   */
  sourceDates: readonly string[]
}

function anyWithin(dates: readonly string[], fromMs: number, toMs: number): boolean {
  for (const d of dates) {
    const t = Date.parse(d)
    if (Number.isFinite(t) && t >= fromMs && t <= toMs) return true
  }
  return false
}

/** Alert sababi yoki null. Ro'yxatdagi noto'g'ri sanalar e'tiborsiz; noto'g'ri `occurredAt` — xato. */
export function kirimSourceReason(p: UnsourcedKirimInput): KirimSourceReason | null {
  if (p.type !== 'kirim' || p.purchaseId !== null) return null
  const at = Date.parse(p.occurredAt)
  if (!Number.isFinite(at)) throw new Error(`unsourcedKirim: noto'g'ri vaqt: ${JSON.stringify(p.occurredAt)}`)
  const openFrom = at - OPEN_PURCHASE_BEFORE_DAYS * DAY_MS
  const openTo = at + OPEN_PURCHASE_AFTER_DAYS * DAY_MS
  if (anyWithin(p.openPurchaseDates, openFrom, openTo)) return 'open_purchase'
  if (!anyWithin(p.sourceDates, at - UNSOURCED_LOOKBACK_DAYS * DAY_MS, at)) return 'no_source'
  return null
}

/** `kirimSourceReason(p) !== null`. */
export function isUnsourcedKirim(p: UnsourcedKirimInput): boolean {
  return kirimSourceReason(p) !== null
}

export interface CandidateKirim {
  objectId: string
  materialId: string
  purchaseId: string | null
  transferId: string | null
  type: MovementType
  occurredAt: string
}

/** Kirim xaridga nomzodmi (72 soat oynasi, ikkala chegara kiradi). */
export function isPurchaseCandidate(
  kirim: CandidateKirim,
  purchase: { objectId: string; materialId: string; purchasedAt: string },
  windowHours = CANDIDATE_WINDOW_HOURS,
): boolean {
  if (kirim.type !== 'kirim' || kirim.purchaseId !== null || kirim.transferId !== null) return false
  if (kirim.objectId !== purchase.objectId || kirim.materialId !== purchase.materialId) return false
  const t = Date.parse(kirim.occurredAt)
  const p = Date.parse(purchase.purchasedAt)
  if (!Number.isFinite(t) || !Number.isFinite(p)) return false
  return t >= p && t - p <= windowHours * HOUR_MS
}

/**
 * Bog'langan kirimlar + nomzodlar farqni yopadimi: `receiptDiffPct(purchased, linked + Σ candidates)
 * ≤ thresholdPct` (qoida 1 dagi formula bilan aynan). Yopsa — "xarid ≠ qabul" alerti yaratilmaydi.
 */
export function candidatesCoverGap(
  purchasedQtyBase: Dec,
  linkedQtyBase: Dec,
  candidateQtyBase: readonly Dec[],
  thresholdPct: Dec,
): boolean {
  const total = candidateQtyBase.reduce<Dec>((acc, q) => add(acc, q), linkedQtyBase)
  return cmp(receiptDiffPct(purchasedQtyBase, total), thresholdPct) <= 0
}
