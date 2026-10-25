// Tarix (Batch 10): audit_log yozuvidagi old_data / new_data dan o'zgargan maydonlar ro'yxati.
// Sof funksiya: jadval nomi berilsa, tartib `fieldOrder(table)` bo'yicha.

import { fieldOrder } from './fields'

export interface FieldChange {
  field: string
  before: unknown
  after: unknown
}

/** Hech qachon ko'rsatilmaydigan texnik maydonlar. */
export const TECHNICAL_FIELDS: readonly string[] = Object.freeze([
  'id',
  'company_id',
  'created_at',
  'updated_at',
  'created_by',
])

type Data = Record<string, unknown>

/** Kalitlari tartiblangan kanonik JSON — jsonb obyektlarni kalit tartibidan qat'i nazar taqqoslash uchun. */
export function canonicalJson(value: unknown): string {
  if (value === undefined) return 'null'
  if (value === null || typeof value !== 'object') {
    const s = JSON.stringify(value)
    return s === undefined ? 'null' : s
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  const obj = value as Data
  const keys = Object.keys(obj)
    .filter((k) => obj[k] !== undefined)
    .sort()
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`).join(',')}}`
}

function sameValue(a: unknown, b: unknown): boolean {
  return canonicalJson(a) === canonicalJson(b)
}

function isEmpty(v: unknown): boolean {
  return v === null || v === undefined
}

function get(data: Data | null, field: string): unknown {
  if (!data || !Object.hasOwn(data, field)) return null
  const v = data[field]
  return v === undefined ? null : v
}

/** deleted_at faqat soft delete (null → qiymat) yoki tiklash (qiymat → null) bo'lganda ko'rinadi. */
function showDeletedAt(oldData: Data | null, newData: Data | null): boolean {
  if (!oldData || !newData) return false
  return isEmpty(get(oldData, 'deleted_at')) !== isEmpty(get(newData, 'deleted_at'))
}

function orderFields(fields: string[], table: string | undefined): string[] {
  const order = table ? fieldOrder(table) : []
  const rank = new Map(order.map((f, i) => [f, i]))
  return [...fields].sort((a, b) => {
    const ra = rank.get(a)
    const rb = rank.get(b)
    if (ra !== undefined && rb !== undefined) return ra - rb
    if (ra !== undefined) return -1
    if (rb !== undefined) return 1
    return a < b ? -1 : a > b ? 1 : 0
  })
}

/**
 * old_data va new_data orasidagi farq.
 * - `changedFields` berilsa — faqat shu maydonlar (audit_log.changed_fields); aks holda chuqur taqqoslash.
 * - Texnik maydonlar chiqariladi; `deleted_at` faqat SOFT_DELETE / RESTORE da.
 * - INSERT (old null) — qiymati bor barcha maydonlar `before: null` bilan.
 * - `table` berilsa tartib `fieldOrder(table)` bo'yicha, qolganlari alifbo bo'yicha.
 */
export function diffRecord(
  oldData: Record<string, unknown> | null,
  newData: Record<string, unknown> | null,
  changedFields?: string[] | null,
  table?: string,
): FieldChange[] {
  if (!oldData && !newData) return []
  const includeDeletedAt = showDeletedAt(oldData, newData)

  const allowed = (field: string): boolean => {
    if (TECHNICAL_FIELDS.includes(field)) return false
    if (field === 'deleted_at') return includeDeletedAt
    return true
  }

  let candidates: string[]
  if (changedFields) {
    candidates = [...new Set(changedFields)]
  } else {
    const keys = new Set<string>([...Object.keys(oldData ?? {}), ...Object.keys(newData ?? {})])
    candidates = [...keys]
  }

  const changes: FieldChange[] = []
  for (const field of candidates) {
    if (!allowed(field)) continue
    const before = oldData ? get(oldData, field) : null
    const after = newData ? get(newData, field) : null
    if (!changedFields) {
      // Yaratish / yo'q bo'lish: bo'sh qiymatli maydonlar mazmunsiz
      if ((!oldData || !newData) && isEmpty(before) && isEmpty(after)) continue
      if (sameValue(before, after)) continue
    }
    changes.push({ field, before, after })
  }

  const order = orderFields(
    changes.map((c) => c.field),
    table,
  )
  const byField = new Map(changes.map((c) => [c.field, c]))
  return order.map((f) => byField.get(f) as FieldChange)
}
