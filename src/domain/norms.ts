// Farq qoidalari 4 va 6 — norma (smeta) va so'rov. Bazadagi `norm_usage` / `private.*` bilan bir xil:
//   allowed  = round(norm * (1 + waste / 100), 6)
//   over_pct = round((consumed - allowed) * 100 / allowed, 2)   -- ≥ 25 → jiddiy
//   usage    = round(consumed * 100 / allowed, 1)
// Ustun turlari: norm / consumed / allowed — numeric(20,6) (dscale 6), waste_pct — numeric(6,2).
// Bo'linmalar PostgreSQL `numeric / numeric` aniqligida (`pgNumericDiv`) — bit-bit moslik uchun.

import { add, cmp, isZero, mul, pgNumericDiv, round, sub, type Dec } from './decimal'

const QTY_DSCALE = 6
const WASTE_DSCALE = 2
const SEVERE_OVER_PCT = '25'

export type NormStatus = 'ok' | 'over' | 'not_in_estimate'
export type NormSeverity = 'ogohlantirish' | 'jiddiy'

export interface NormInput {
  /** Joriy smetadagi Σ norm_qty_base (0 — material smetada yo'q). */
  normQtyBase: Dec
  /** materials.waste_pct (masalan "5" = 5 %). */
  wastePct: Dec
  /** Obyektdagi o'chirilmagan chiqimlar Σ qty_base. */
  consumedQtyBase: Dec
}

export interface NormResult {
  status: NormStatus
  allowed: Dec
  overPct: Dec | null
  severity: NormSeverity | null
}

export interface RequestInput {
  requestedQtyBase: Dec
  allowedQtyBase: Dec
  consumedQtyBase: Dec
  /** Obyektga kelgan: kirim + transfer_in − transfer_out (Σ qty_base). */
  deliveredQtyBase: Dec
  /** Shu obyekt + material bo'yicha boshqa ochiq (kutilmoqda + tasdiqlandi) so'rovlar. */
  otherOpenQtyBase: Dec
}

export interface RequestResult {
  over: boolean
  /** allowed − max(consumed, delivered) − otherOpen (manfiy bo'lishi mumkin). */
  available: Dec
  /** max(requested − available, 0). */
  overQty: Dec
}

/** Isrof bilan norma: round(norm * (1 + waste / 100), 6). */
export function allowedQty(norm: Dec, wastePct: Dec): Dec {
  const factor = add('1', pgNumericDiv(wastePct, '100', WASTE_DSCALE, 0))
  return round(mul(norm, factor), QTY_DSCALE)
}

/** round((consumed - allowed) * 100 / allowed, 2); allowed = 0 → null. */
function overPctOf(consumed: Dec, allowed: Dec): Dec | null {
  if (isZero(allowed)) return null
  return round(pgNumericDiv(mul(sub(consumed, allowed), '100'), allowed, QTY_DSCALE, QTY_DSCALE), 2)
}

/**
 * Qoida 4 — normadan oshish.
 * norm = 0 va sarf > 0 → not_in_estimate (ogohlantirish); consumed ≤ allowed → ok;
 * aks holda over, overPct ≥ 25 → jiddiy.
 */
export function evaluateNorm(p: NormInput): NormResult {
  const allowed = allowedQty(p.normQtyBase, p.wastePct)
  const consumed = p.consumedQtyBase
  if (isZero(p.normQtyBase) || isZero(allowed)) {
    if (cmp(consumed, '0') > 0) return { status: 'not_in_estimate', allowed, overPct: null, severity: 'ogohlantirish' }
    return { status: 'ok', allowed, overPct: null, severity: null }
  }
  if (cmp(consumed, allowed) <= 0) return { status: 'ok', allowed, overPct: null, severity: null }
  const overPct = overPctOf(consumed, allowed)
  const severity: NormSeverity = overPct !== null && cmp(overPct, SEVERE_OVER_PCT) >= 0 ? 'jiddiy' : 'ogohlantirish'
  return { status: 'over', allowed, overPct, severity }
}

/**
 * Qoida 6 — smetadan ortiq so'rov.
 * available = allowed − greatest(consumed, delivered) − otherOpen: "xarid qilindi" so'rovlar
 * otherOpen dan chiqadi, lekin kelgan (hali chiqim qilinmagan) material shu yerda hisobga olinadi.
 */
export function evaluateRequest(p: RequestInput): RequestResult {
  const used = cmp(p.deliveredQtyBase, p.consumedQtyBase) > 0 ? p.deliveredQtyBase : p.consumedQtyBase
  const available = sub(sub(p.allowedQtyBase, used), p.otherOpenQtyBase)
  const diff = sub(p.requestedQtyBase, available)
  const over = cmp(diff, '0') > 0
  return { over, available, overQty: over ? diff : '0' }
}

/** UI progress: round(consumed * 100 / allowed, 1); allowed = 0 → null. */
export function usagePct(consumed: Dec, allowed: Dec): Dec | null {
  if (isZero(allowed)) return null
  return round(pgNumericDiv(mul(consumed, '100'), allowed, QTY_DSCALE, QTY_DSCALE), 1)
}
