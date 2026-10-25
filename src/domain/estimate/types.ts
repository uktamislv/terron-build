// Smeta importi (Batch 7) — umumiy turlar.

/**
 * SheetJS `sheet_to_json(ws, { header: 1, raw: true })` katagi.
 * Sana kataklari satr ko'rinishida keladi (frontend `raw` bilan o'qiganda).
 */
export type Cell = string | number | boolean | null

export type EstimateField = 'name' | 'unit' | 'qty' | 'price' | 'sum' | 'type' | 'code'

/** Maydon → ustun indeksi (0 dan). */
export type ColumnMapping = Partial<Record<EstimateField, number>>

export const ESTIMATE_FIELDS: readonly EstimateField[] = ['name', 'unit', 'qty', 'price', 'sum', 'type', 'code']

export const REQUIRED_FIELDS = ['name', 'unit', 'qty'] as const
export type RequiredField = (typeof REQUIRED_FIELDS)[number]
