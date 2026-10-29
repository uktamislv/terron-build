// Farq qoidasi 1 — "Xarid ≠ qabul" (docs/purchase-design.md). Bazadagi `private.*` bilan bir xil:
//   diff_pct = round(abs(received - purchased) * 100 / purchased, 2)
// received/purchased — `numeric(20,6)`; PostgreSQL bo'linmasi `pgNumericDiv` bilan takrorlanadi.

import { abs, cmp, isZero, mul, pgNumericDiv, round, sub, type Dec } from '../decimal'

export type ReceiptStatus = 'ok' | 'over' | 'under' | 'pending'
export type ReceiptSeverity = 'ogohlantirish' | 'jiddiy' | null

export interface ReceiptInput {
  purchasedQtyBase: Dec
  receivedQtyBase: Dec
  /** Xarid vaqti (ISO 8601). */
  purchasedAt: string
  /**
   * Xarid kiritilgan vaqt (`created_at`, ISO 8601). Berilsa, kutish `max(purchasedAt, createdAt)`
   * dan hisoblanadi — orqa sana bilan kiritilgan xarid darhol "kam" bo'lmaydi (bazadagi kabi).
   */
  createdAt?: string
  /** Joriy vaqt (ISO 8601) — argument sifatida, `Date.now()` emas. */
  nowIso: string
  /** Firma sozlamasi `receipt_mismatch_pct`. */
  thresholdPct: Dec
}

export interface ReceiptResult {
  status: ReceiptStatus
  diffPct: Dec
  severity: ReceiptSeverity
}

/** `qty_base` ustunining dscale'i — numeric(20,6). */
const QTY_DSCALE = 6
const UNDER_DELAY_MS = 24 * 60 * 60 * 1000

/** round(abs(received - purchased) * 100 / purchased, 2) — PostgreSQL bilan bit-bit. */
export function receiptDiffPct(purchasedQtyBase: Dec, receivedQtyBase: Dec): Dec {
  if (isZero(purchasedQtyBase)) throw new Error('receiptMismatch: xarid miqdori 0')
  const numerator = mul(abs(sub(receivedQtyBase, purchasedQtyBase)), '100')
  return round(pgNumericDiv(numerator, purchasedQtyBase, QTY_DSCALE, QTY_DSCALE), 2)
}

function parseTime(iso: string, name: string): number {
  const t = Date.parse(iso)
  if (Number.isNaN(t)) throw new Error(`receiptMismatch: noto'g'ri vaqt ${name}: ${JSON.stringify(iso)}`)
  return t
}

/**
 * Xarid va bog'langan kirim(lar)ni solishtiradi.
 * - `diffPct <= threshold` → ok;
 * - ortiqcha → over (darhol);
 * - kam → max(xarid, kiritilgan) vaqtidan ≥ 24 soat o'tgan bo'lsa under, aks holda pending.
 * severity: ok/pending → null; chegara > 0 va `diffPct >= 3 × threshold` → jiddiy; aks holda ogohlantirish.
 */
export function evaluateReceipt(p: ReceiptInput): ReceiptResult {
  const diffPct = receiptDiffPct(p.purchasedQtyBase, p.receivedQtyBase)
  if (cmp(diffPct, p.thresholdPct) <= 0) return { status: 'ok', diffPct, severity: null }
  let status: ReceiptStatus
  if (cmp(p.receivedQtyBase, p.purchasedQtyBase) > 0) {
    status = 'over'
  } else {
    const start = Math.max(
      parseTime(p.purchasedAt, 'purchasedAt'),
      p.createdAt === undefined ? -Infinity : parseTime(p.createdAt, 'createdAt'),
    )
    const elapsed = parseTime(p.nowIso, 'nowIso') - start
    status = elapsed >= UNDER_DELAY_MS ? 'under' : 'pending'
  }
  if (status === 'pending') return { status, diffPct, severity: null }
  // chegara 0 bo'lsa har qanday farq "jiddiy" bo'lib qolmasin
  const severity = cmp(p.thresholdPct, '0') > 0 && cmp(diffPct, mul(p.thresholdPct, '3')) >= 0 ? 'jiddiy' : 'ogohlantirish'
  return { status, diffPct, severity }
}
