// O'z yozuvini tuzatish oynasi (RPC `correct_entry`, docs/audit-fixes.md D1) — sof funksiyalar.
// Server qoidasi bilan bir xil: muallif — yaratilgandan 30 daqiqa ichida, faqat bog'lanmagan yozuv.
// Admin — istalgan vaqtda (veb). UI faqat tugmani ko'rsatish uchun; haqiqiy tekshiruv serverda.
import { parseSumInput } from './cash'
import { cmp, type Dec } from './decimal'
import type { MovementType } from './movements'
import { validateQtyInput, type QtyError } from './units'

export const CORRECTION_WINDOW_MS = 30 * 60 * 1000

export interface CorrectableEntry {
  /** Xarajat (`expenses`) — bog'lanish yo'q: doim tuzatish mumkin (oyna ichida). */
  table: 'movements' | 'purchases' | 'expenses'
  createdBy: string | null
  createdAt: string
  deletedAt: string | null
  /** Harakat turi (faqat `movements`). */
  movementType?: MovementType
  /** Harakat bog'langan xarid (kirim → xarid). Noma'lum (undefined) — bog'langan deb olinadi. */
  purchaseId?: string | null
  /** O'tkazma harakati (`movements.transfer_id`). */
  transferId?: string | null
  /** Inventarizatsiya tuzatishi (`movements.inventory_count_id`). */
  inventoryCountId?: string | null
  /** Xaridga bog'langan tirik kirimlar soni (`purchase_receipts.receipt_count`); noma'lum — null. */
  linkedReceipts?: number | null
}

/** Yozuv bog'lanmaganmi (server `correct_linked` bermaydimi). Noma'lum bog'lanish — bog'langan deb olinadi. */
export function isUnlinked(e: CorrectableEntry): boolean {
  if (e.table === 'expenses') return true
  if (e.table === 'movements') {
    // Aniq null bo'lishi shart: maydon yuklanmagan (undefined) — bog'langan deb olinadi
    return (
      (e.movementType === 'kirim' || e.movementType === 'chiqim') &&
      e.purchaseId === null &&
      (e.transferId ?? null) === null &&
      (e.inventoryCountId ?? null) === null
    )
  }
  return e.linkedReceipts === 0
}

/** Oynaning qolgan vaqti (ms), manfiy — o'tgan; sana noto'g'ri — null. */
function rawRemainingMs(createdAt: string, nowIso: string): number | null {
  const created = Date.parse(createdAt)
  const now = Date.parse(nowIso)
  if (!Number.isFinite(created) || !Number.isFinite(now)) return null
  return created + CORRECTION_WINDOW_MS - now
}

/** Muallif uchun qolgan vaqt (ms); oyna o'tgan — 0. */
export function correctionRemainingMs(createdAt: string, nowIso: string): number {
  return Math.max(0, rawRemainingMs(createdAt, nowIso) ?? 0)
}

/**
 * Muallif o'zi tuzata oladimi (Mini App "Yozuvlarim"): o'zi kiritgan, o'chirilmagan, bog'lanmagan
 * va 30 daqiqa o'tmagan. Qolgan vaqt bilan.
 */
export function selfCorrection(e: CorrectableEntry, myProfileId: string, nowIso: string): { allowed: boolean; remainingMs: number } {
  // Chegara kiritiladi (server: now() <= created_at + 30 min)
  const raw = rawRemainingMs(e.createdAt, nowIso)
  const allowed = e.createdBy === myProfileId && !e.deletedAt && isUnlinked(e) && raw !== null && raw >= 0
  return { allowed, remainingMs: allowed ? Math.max(0, raw ?? 0) : 0 }
}

/** Admin (veb) tuzata oladimi: o'chirilmagan va bog'lanmagan — vaqt cheklovisiz. */
export function adminCorrection(e: CorrectableEntry): boolean {
  return !e.deletedAt && isUnlinked(e)
}

/**
 * Qolgan butun daqiqalar (pastga yaxlitlanadi): 12:30 → 12. 0 — oxirgi daqiqa ("1 daqiqadan kam").
 * Matn — `t.correction.minutesLeft`.
 */
export function remainingMinutes(ms: number): number {
  return Math.max(0, Math.floor(ms / 60_000))
}

export interface CorrectionDraft {
  table: 'movements' | 'purchases'
  /** Asl qiymatlar (o'zgarmagan maydon yuborilmaydi). */
  original: { qtyInput: Dec; unitId: string; totalAmount?: Dec | null; note?: string | null; materialId?: string; objectId?: string }
  qtyInput: string
  unitId: string | null
  /** Faqat xarid: summa kiritilishi ("1 250 000"). */
  totalInput?: string
  /** Tuzatish sababi — majburiy (RPC `p_reason`, audit va direktor xabarida). */
  reason: string
  /** Yozuv izohi — ixtiyoriy; berilmasa yoki o'zgarmasa eski izoh qoladi. */
  note?: string
  /** Muallif: boshqa material (birlik shu materialniki bo'lishi shart — server tekshiradi). */
  materialId?: string | null
  /** Muallif: boshqa obyekt. */
  objectId?: string | null
}

export type CorrectionErrorField = 'qty' | 'unit' | 'total' | 'reason'
export type CorrectionError = QtyError | 'required' | 'invalid'

export interface CorrectionValue {
  /** null — o'zgarmaydi. */
  qtyInput: Dec | null
  unitId: string | null
  totalAmount: Dec | null
  reason: string
  /** Yangi izoh; null — o'zgarmaydi (bo'sh satr — izohni o'chirish). */
  note: string | null
  /** Yangi material / obyekt (faqat muallif, 30 daqiqa); null — o'zgarmaydi. */
  materialId: string | null
  objectId: string | null
}

/**
 * Tuzatish formasini tekshiradi: miqdor (0 dan katta), birlik, xaridda summa (0 dan katta) va
 * majburiy sabab. O'zgarmagan maydonlar `null` (RPC — "o'zgarmaydi").
 */
export function validateCorrection(
  d: CorrectionDraft,
): { ok: true; value: CorrectionValue } | { ok: false; errors: Partial<Record<CorrectionErrorField, CorrectionError>> } {
  const errors: Partial<Record<CorrectionErrorField, CorrectionError>> = {}
  const materialChanged = Boolean(d.materialId && d.original.materialId && d.materialId !== d.original.materialId)
  const objectChanged = Boolean(d.objectId && d.original.objectId && d.objectId !== d.original.objectId)
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
  const reason = d.reason.trim()
  if (!reason) errors.reason = 'required'
  if (!qty.ok || Object.keys(errors).length > 0) return { ok: false, errors }
  const sameQty = cmp(qty.value, d.original.qtyInput) === 0
  const sameTotal = total === null || (d.original.totalAmount != null && cmp(total, d.original.totalAmount) === 0)
  const note = d.note === undefined ? null : d.note.trim()
  const sameNote = note === null || note === (d.original.note ?? '').trim()
  return {
    ok: true,
    value: {
      qtyInput: sameQty ? null : qty.value,
      // Material o'zgarsa — birlik doim yuboriladi (yangi materialniki)
      unitId: d.unitId === d.original.unitId && !materialChanged ? null : d.unitId,
      totalAmount: d.table === 'purchases' && !sameTotal ? total : null,
      reason,
      note: sameNote ? null : note,
      materialId: materialChanged ? (d.materialId ?? null) : null,
      objectId: objectChanged ? (d.objectId ?? null) : null,
    },
  }
}
