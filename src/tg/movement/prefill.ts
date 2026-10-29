// Kirim/chiqim formasiga oldindan to'ldirish: "Qoldiq" qatori (chiqim), xarid saqlangandan keyin "Qabul
// qilish (kirim)", "Qabul kutilmoqda" ro'yxati. Router `state` orqali.
import type { EntryType } from '@/domain/movements'

export interface MovementPrefill {
  type: EntryType
  objectId: string
  materialId: string
  /** Kirim: qabul qilinadigan miqdor (asosiy birlikda) — masalan xaridning qolgan qismi. */
  qtyBase?: string
  /** Kirim: bog'lanadigan xarid (ochiq xaridlar ro'yxatida bo'lsa tanlanadi). */
  purchaseId?: string
}

export function makeMovementPrefillState(prefill: MovementPrefill): { movementPrefill: MovementPrefill } {
  return { movementPrefill: prefill }
}

/** `location.state` dan xavfsiz o'qish (noma'lum shakl — null). */
export function readMovementPrefill(state: unknown): MovementPrefill | null {
  if (typeof state !== 'object' || state === null) return null
  const p = (state as { movementPrefill?: unknown }).movementPrefill
  if (typeof p !== 'object' || p === null) return null
  const r = p as Record<string, unknown>
  if (typeof r.objectId !== 'string' || typeof r.materialId !== 'string') return null
  const out: MovementPrefill = { type: r.type === 'kirim' ? 'kirim' : 'chiqim', objectId: r.objectId, materialId: r.materialId }
  // Miqdor va xarid — faqat kirimda; noto'g'ri shakl — e'tiborsiz
  if (out.type === 'kirim') {
    if (typeof r.qtyBase === 'string' && /^\d+(\.\d+)?$/.test(r.qtyBase)) out.qtyBase = r.qtyBase
    if (typeof r.purchaseId === 'string' && r.purchaseId !== '') out.purchaseId = r.purchaseId
  }
  return out
}
