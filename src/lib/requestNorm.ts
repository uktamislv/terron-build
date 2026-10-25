import type { NormUsage } from '@/data/types'
import { isZero } from '@/domain/decimal'
import { evaluateRequest } from '@/domain/norms'

export type RequestNormState =
  | { kind: 'no_estimate' }
  | { kind: 'not_in_estimate' }
  | { kind: 'ok' | 'over'; available: string; overQty: string }

/**
 * So'rov uchun smeta holati. `objectNorms` — obyektning barcha `norm_usage` qatorlari (bo'sh — obyektda
 * joriy smeta yo'q). `otherOpenQtyBase` berilmasa — `requested_open_qty_base` (yangi so'rov uchun).
 * Faqat ogohlantirish — saqlashni bloklamaydi.
 */
export function requestNormState(
  objectNorms: NormUsage[],
  materialId: string,
  qtyBase: string | null,
  otherOpenQtyBase?: string,
): RequestNormState {
  if (objectNorms.length === 0) return { kind: 'no_estimate' }
  const norm = objectNorms.find((n) => n.material_id === materialId)
  if (!norm || isZero(norm.norm_qty_base)) return { kind: 'not_in_estimate' }
  const r = evaluateRequest({
    requestedQtyBase: qtyBase ?? '0',
    allowedQtyBase: norm.allowed_qty_base,
    consumedQtyBase: norm.consumed_qty_base,
    deliveredQtyBase: norm.delivered_qty_base,
    otherOpenQtyBase: otherOpenQtyBase ?? norm.requested_open_qty_base,
  })
  return { kind: r.over ? 'over' : 'ok', available: r.available, overQty: r.overQty }
}
