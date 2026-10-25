// Tarix yozuvlarini ko'rsatish uchun sof funksiyalar: jadval/maydon nomlari, qiymat formatlash,
// bog'langan yozuvlar id'larini yig'ish. Maydon turi — `fieldKind` (src/domain/history).
import { RECORD_DATE_COLUMNS, type AuditEntry, type RefIds, type RefKind, type RefNames } from '@/data/historyRepo'
import { diffRecord, fieldKind, type FieldChange, type FieldKind } from '@/domain/history'
import { t } from '@/i18n'
import { formatDate, formatDateTime, formatQty, formatSum, tashkentIsoDate } from '@/lib/format'

const th = t.history
export const EMPTY_VALUE = th.empty_value
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Tiklash mumkin bo'lgan jadvallar (restore_record oq ro'yxati). */
export const RESTORABLE_TABLES: readonly string[] = [
  'profiles',
  'objects',
  'object_members',
  'materials',
  'material_units',
  'material_aliases',
  'suppliers',
  'cash_advances',
  'purchases',
  'movements',
  'material_requests',
  'inventory_counts',
  'inventory_count_items',
  'estimates',
  'estimate_items',
  'estimate_import_templates',
]

export function isRestorable(table: string): boolean {
  return RESTORABLE_TABLES.includes(table)
}

export function tableLabel(table: string): string {
  return th.tables[table] ?? table
}

export function actionLabel(action: string): string {
  return th.actions[action] ?? action
}

export function fieldLabel(field: string): string {
  return th.fields[field] ?? field
}

/** Yozuv sarlavhasi: server bergan qisqa nom, bo'lmasa — jadval nomi. */
export function entryTitle(e: { record_label: string | null; table_name: string }): string {
  const label = e.record_label?.trim()
  return label ? localizeLabel(e.table_name, label) : tableLabel(e.table_name)
}

const ENUMS: Record<string, Record<string, string>> = {
  'profiles.role': t.roles,
  'profiles.login_kind': th.loginKinds,
  'objects.status': t.objects.statuses,
  'material_aliases.lang': t.materials.aliases.langNames,
  'transfers.status': t.transfers.statuses,
  'inventory_counts.status': t.inventory.statuses,
  'estimate_items.item_type': t.estimates.types,
  'material_requests.status': t.requests.statuses,
  'movements.type': t.movements.types,
  'alerts.type': t.alertTexts.types,
  'alerts.status': t.alertTexts.statuses,
  'alerts.severity': t.alertTexts.severities,
}

export function enumLabel(table: string, field: string, value: string): string {
  return ENUMS[`${table}.${field}`]?.[value] ?? value
}

const REF_KIND: Partial<Record<FieldKind, RefKind>> = {
  ref_object: 'objects',
  ref_material: 'materials',
  ref_profile: 'profiles',
  ref_unit: 'units',
  ref_supplier: 'suppliers',
}

export function refKindOf(kind: FieldKind): RefKind | null {
  return REF_KIND[kind] ?? null
}

function isEmpty(v: unknown): boolean {
  return v === null || v === undefined || (typeof v === 'string' && v.trim() === '')
}

function scalar(v: unknown): string {
  if (typeof v === 'string') return v
  if (typeof v === 'number' || typeof v === 'bigint' || typeof v === 'boolean') return String(v)
  return JSON.stringify(v)
}

/** Maydon qiymati — foydalanuvchiga ko'rinishda (summa, miqdor, sana, holat, bog'langan nom). Bo'sh — "—". */
export function formatValue(table: string, field: string, value: unknown, names: RefNames): string {
  if (isEmpty(value)) return EMPTY_VALUE
  const kind = fieldKind(table, field)
  const ref = refKindOf(kind)
  if (ref) return names[ref][scalar(value)] ?? EMPTY_VALUE
  switch (kind) {
    case 'money':
      return formatSum(scalar(value))
    case 'qty':
      return formatQty(scalar(value))
    case 'pct':
      return `${formatQty(scalar(value))} ${th.pctUnit}`
    case 'date':
      return formatDate(`${scalar(value).slice(0, 10)}T12:00:00+05:00`)
    case 'datetime': {
      const d = new Date(scalar(value))
      return Number.isNaN(d.getTime()) ? scalar(value) : formatDateTime(d)
    }
    case 'enum':
      return enumLabel(table, field, scalar(value))
    case 'bool':
      return value === true || value === 'true' ? t.common.yes : t.common.no
    case 'ref_purchase':
      return th.linked
    case 'json': {
      const s = typeof value === 'string' ? value : JSON.stringify(value)
      return s.length > 120 ? `${s.slice(0, 117)}…` : s
    }
    default: {
      // Texnik bog'lanishlar (uuid) — qisqa ko'rinishda
      const text = scalar(value)
      return UUID_RE.test(text) ? `${text.slice(0, 8)}…` : text
    }
  }
}

/** Yozuvdagi o'zgarishlar (texnik maydonlarsiz, tartibli). */
export function entryChanges(e: AuditEntry): FieldChange[] {
  const isInsert = !e.old_data
  return diffRecord(e.old_data, e.new_data, isInsert ? null : e.changed_fields, e.table_name)
}

/** Bir nechta yozuv diff'idagi bog'langan id'lar — har tur uchun takrorsiz ro'yxat. */
export function collectRefIds(items: readonly { table: string; changes: readonly FieldChange[] }[]): RefIds {
  const sets: Record<RefKind, Set<string>> = {
    objects: new Set(),
    materials: new Set(),
    profiles: new Set(),
    units: new Set(),
    suppliers: new Set(),
  }
  for (const { table, changes } of items)
    for (const c of changes) {
      const ref = refKindOf(fieldKind(table, c.field))
      if (!ref) continue
      for (const v of [c.before, c.after]) if (!isEmpty(v)) sets[ref].add(scalar(v))
    }
  return {
    objects: [...sets.objects],
    materials: [...sets.materials],
    profiles: [...sets.profiles],
    units: [...sets.units],
    suppliers: [...sets.suppliers],
  }
}

export function hasRefIds(ids: RefIds): boolean {
  return Object.values(ids).some((l: readonly string[]) => l.length > 0)
}

/** Excel uchun: "Maydon: oldin → keyin" qatorlari. */
export function changesText(table: string, changes: readonly FieldChange[], names: RefNames): string {
  return changes
    .map((c) => {
      const after = formatValue(table, c.field, c.after, names)
      const before = formatValue(table, c.field, c.before, names)
      return before === EMPTY_VALUE ? `${fieldLabel(c.field)}: ${after}` : `${fieldLabel(c.field)}: ${before} → ${after}`
    })
    .join('; ')
}

/** Ogohlantirish yozuvi nomidagi xom tur kaliti (masalan `yozuv_ochirildi`) — o'zbekcha nomga. */
export function localizeLabel(table: string, label: string): string {
  if (table !== 'alerts') return label
  const types = t.alertTexts.types as Record<string, string>
  return label.replace(/\b[a-z]+(?:_[a-z]+)+\b/g, (key) => types[key] ?? key)
}

/** Yozuv sanasi audit ma'lumotidan (xarid / podotchet / harakat). */
export function entryRecordDate(e: Pick<AuditEntry, 'table_name' | 'old_data' | 'new_data'>): string | null {
  const column = Object.hasOwn(RECORD_DATE_COLUMNS, e.table_name) ? RECORD_DATE_COLUMNS[e.table_name] : undefined
  if (!column) return null
  const v = e.new_data?.[column] ?? e.old_data?.[column]
  return typeof v === 'string' ? v : null
}

/** Sana joriy oydan (Toshkent) oldingi davrga tegishlimi — o'tgan davr hisobotlari o'zgaradi. */
export function isPastPeriod(dateIso: string, todayIso: string): boolean {
  const d = new Date(dateIso)
  if (Number.isNaN(d.getTime())) return false
  return tashkentIsoDate(0, d) < `${todayIso.slice(0, 7)}-01`
}

/** O'tkazma harakati (o'tkazma bekor qilinmaguncha tiklanmaydi). */
export function isTransferMovement(e: Pick<AuditEntry, 'table_name' | 'old_data' | 'new_data'>): boolean {
  return e.table_name === 'movements' && Boolean(e.new_data?.transfer_id ?? e.old_data?.transfer_id)
}

/** Yuklangan tarixda shu yozuv uchun keyinroq (yangiroq `id`) RESTORE bormi. */
export function restoredLater(entry: Pick<AuditEntry, 'id' | 'table_name' | 'record_id'>, loaded: readonly AuditEntry[]): boolean {
  return loaded.some((e) => e.action === 'RESTORE' && e.id > entry.id && e.table_name === entry.table_name && e.record_id === entry.record_id)
}
