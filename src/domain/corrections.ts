// O'z yozuvini tuzatish oynasi (RPC `correct_entry`, docs/audit-fixes.md D1) — sof funksiyalar.
// Server qoidasi bilan bir xil: muallif — yaratilgandan 30 daqiqa ichida, faqat bog'lanmagan yozuv.
// Admin — istalgan vaqtda (veb). UI faqat tugmani ko'rsatish uchun; haqiqiy tekshiruv serverda.
import { parseSumInput } from './cash'
import { cmp, type Dec } from './decimal'
import type { MovementType } from './movements'
import { validateQtyInput, type QtyError } from './units'

export const CORRECTION_WINDOW_MS = 30 * 60 * 1000

export interface CorrectableEntry {
  table: 'movements' | 'purchases'
  createdBy: string | null
  createdAt: string
  deletedAt: string | null
  /** Harakat turi (faqat `movements`). */
  movementType?: MovementType
  /** Harakat bog'langan xarid (kirim → xarid). */
  purchaseId?: string | null
  /** Xaridga bog'langan tirik kirimlar soni (`purchase_receipts.receipt_count`); noma'lum — null. */
  linkedReceipts?: number | null
}

/** Yozuv bog'lanmaganmi (server `correct_linked` bermaydimi). Noma'lum bog'lanish — bog'langan deb olinadi. */
export function isUnlinked(e: CorrectableEntry): boolean {
  if (e.table === 'movements') {
    return (e.movementType === 'kirim' || e.movementType === 'chiqim') && !e.purchaseId
  }
  return e.linkedReceipts === 0
}

/** Muallif uchun qolgan vaqt (ms); oyna o'tgan — 0. */
export function correctionRemainingMs(createdAt: string, nowIso: string): number {
  const created = Date.parse(createdAt)
  const now = Date.parse(nowIso)
  if (!Number.isFinite(created) || !Number.isFinite(now)) return 0
  return Math.max(0, created + CORRECTION_WINDOW_MS - now)
}

/**
 * Muallif o'zi tuzata oladimi (Mini App "Yozuvlarim"): o'zi kiritgan, o'chirilmagan, bog'lanmagan
 * va 30 daqiqa o'tmagan. Qolgan vaqt bilan.
 */
export function selfCorrection(e: CorrectableEntry, myProfileId: string, nowIso: string): { allowed: boolean; remainingMs: number } {
  const remainingMs = correctionRemainingMs(e.createdAt, nowIso)
  const allowed = e.createdBy === myProfileId && !e.deletedAt && isUnlinked(e) && remainingMs > 0
  return { allowed, remainingMs: allowed ? remainingMs : 0 }
}

/** Admin (veb) tuzata oladimi: o'chirilmagan va bog'lanmagan — vaqt cheklovisiz. */
export function adminCorrection(e: CorrectableEntry): boolean {
  return !e.deletedAt && isUnlinked(e)
}

/** Qolgan vaqt "mm:ss" (daqiqa:soniya) — tugmadagi sanoq uchun. */
export function formatRemaining(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000))
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

export interface CorrectionDraft {
  table: 'movements' | 'purchases'
  /** Asl qiymatlar (o'zgarmagan maydon yuborilmaydi). */
  original: { qtyInput: Dec; unitId: string; totalAmount?: Dec | null }
  qtyInput: string
  unitId: string | null
  /** Faqat xarid: summa kiritilishi ("1 250 000"). */
  totalInput?: string
  note: string
}

export type CorrectionErrorField = 'qty' | 'unit' | 'total' | 'note'
export type CorrectionError = QtyError | 'required' | 'invalid'

export interface CorrectionValue {
  /** null — o'zgarmaydi. */
  qtyInput: Dec | null
  unitId: string | null
  totalAmount: Dec | null
  note: string
}

/**
 * Tuzatish formasini tekshiradi: miqdor (0 dan katta), birlik, xaridda summa (0 dan katta) va
 * majburiy sabab. O'zgarmagan maydonlar `null` (RPC — "o'zgarmaydi").
 */
export function validateCorrection(
  d: CorrectionDraft,
): { ok: true; value: CorrectionValue } | { ok: false; errors: Partial<Record<CorrectionErrorField, CorrectionError>> } {
  const errors: Partial<Record<CorrectionErrorField, CorrectionError>> = {}
  const qty = validateQtyInput(d.qtyInput)
  if (!qty.ok) errors.qty = qty.reason === 'empty' ? 'required' : qty.reason
  if (!d.unitId) errors.unit = 'required'
  let total: Dec | null = null
  if (d.table === 'purchases') {
    const raw = d.totalInput ?? ''
    if (raw.trim() === '') errors.total = 'required'
    else {
      total = parseSumInput(raw)
      if (total === null || cmp(total, '0') <= 0) errors.total = 'invalid'
    }
  }
  const note = d.note.trim()
  if (!note) errors.note = 'required'
  if (!qty.ok || Object.keys(errors).length > 0) return { ok: false, errors }
  const sameQty = cmp(qty.value, d.original.qtyInput) === 0
  const sameTotal = total === null || (d.original.totalAmount != null && cmp(total, d.original.totalAmount) === 0)
  return {
    ok: true,
    value: {
      qtyInput: sameQty ? null : qty.value,
      unitId: d.unitId === d.original.unitId ? null : d.unitId,
      totalAmount: d.table === 'purchases' && !sameTotal ? total : null,
      note,
    },
  }
}
