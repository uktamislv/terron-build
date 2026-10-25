// Batch 12 (K): bosh ekrandagi "Tugayotganlar" → so'rov formasi. Router `state` orqali uzatiladi.

export interface RequestPrefill {
  objectId: string
  materialId: string
  /** Asosiy birlikdagi miqdor taklifi (Dec satr) yoki null. */
  qtyBase: string | null
  /** Izoh (masalan "O'tkazma so'raladi …"). */
  note: string | null
}

export function makePrefillState(prefill: RequestPrefill): { prefill: RequestPrefill } {
  return { prefill }
}

/** `location.state` dan xavfsiz o'qish (noma'lum shakl — null). */
export function readPrefill(state: unknown): RequestPrefill | null {
  if (typeof state !== 'object' || state === null) return null
  const p = (state as { prefill?: unknown }).prefill
  if (typeof p !== 'object' || p === null) return null
  const r = p as Record<string, unknown>
  if (typeof r.objectId !== 'string' || typeof r.materialId !== 'string') return null
  return {
    objectId: r.objectId,
    materialId: r.materialId,
    qtyBase: typeof r.qtyBase === 'string' ? r.qtyBase : null,
    note: typeof r.note === 'string' ? r.note : null,
  }
}
