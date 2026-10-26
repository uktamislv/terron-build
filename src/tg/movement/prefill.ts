// "Qoldiq" qatori → kirim/chiqim formasi (obyekt, material va tur oldindan tanlangan). Router `state` orqali.
import type { EntryType } from '@/domain/movements'

export interface MovementPrefill {
  type: EntryType
  objectId: string
  materialId: string
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
  return { type: r.type === 'kirim' ? 'kirim' : 'chiqim', objectId: r.objectId, materialId: r.materialId }
}
