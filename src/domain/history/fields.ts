// Tarix (Batch 10): jadval × maydon → qiymat turi (formatlash uchun) va maydonlar tartibi.
// Ustunlar ro'yxati supabase/migrations/*.sql dan olingan; yangi ustun qo'shilsa — shu yerga ham.

export type FieldKind =
  | 'money'
  | 'qty'
  | 'pct'
  | 'date'
  | 'datetime'
  | 'ref_object'
  | 'ref_material'
  | 'ref_profile'
  | 'ref_unit'
  | 'ref_supplier'
  | 'ref_purchase'
  | 'enum'
  | 'bool'
  | 'text'
  | 'json'

type TableSpec = {
  /** Ma'no bo'yicha birinchi keladigan maydonlar (nom / material / miqdor / summa). */
  readonly primary: readonly string[]
  /** Jadvalga xos ustunlar (umumiy texnik ustunlardan tashqari) va ularning turi. */
  readonly columns: Readonly<Record<string, FieldKind>>
}

/** Har biznes jadvalda bor umumiy ustunlar. */
const COMMON_COLUMNS: Readonly<Record<string, FieldKind>> = {
  id: 'text',
  company_id: 'text',
  created_by: 'ref_profile',
  created_at: 'datetime',
  updated_at: 'datetime',
  deleted_at: 'datetime',
}

const UNIT_INPUT_COLUMNS: Readonly<Record<string, FieldKind>> = {
  material_id: 'ref_material',
  unit_id: 'ref_unit',
  qty_input: 'qty',
  unit_input: 'text',
  unit_variant: 'text',
  qty_base: 'qty',
}

const TABLES: Readonly<Record<string, TableSpec>> = {
  companies: {
    primary: ['name'],
    columns: {
      name: 'text',
      receipt_mismatch_pct: 'pct',
      price_deviation_pct: 'pct',
      price_avg_window: 'qty',
      estimate_increase_pct: 'pct',
      transfer_receive_hours: 'qty',
      photo_required_amount: 'money',
      cash_max_days: 'qty',
      duplicate_window_minutes: 'qty',
      request_overbuy_pct: 'pct',
      alert_remind_hours: 'qty',
      forecast_days_warn: 'qty',
      quiet_hours_start: 'text',
      quiet_hours_end: 'text',
      timezone: 'text',
      is_active: 'bool',
    },
  },
  profiles: {
    primary: ['full_name', 'role', 'phone'],
    columns: {
      full_name: 'text',
      role: 'enum',
      phone: 'text',
      auth_user_id: 'text',
      login_kind: 'enum',
      telegram_user_id: 'text',
      telegram_chat_id: 'text',
      is_active: 'bool',
      telegram_blocked_at: 'datetime',
      notify_workflow: 'bool',
    },
  },
  objects: {
    primary: ['name', 'address', 'status'],
    columns: { name: 'text', address: 'text', status: 'enum', lat: 'text', lng: 'text', radius_m: 'qty' },
  },
  object_members: {
    primary: ['object_id', 'profile_id'],
    columns: { object_id: 'ref_object', profile_id: 'ref_profile' },
  },
  materials: {
    primary: ['name', 'base_unit', 'waste_pct'],
    columns: {
      name: 'text',
      base_unit: 'text',
      waste_pct: 'pct',
      category: 'text',
      is_active: 'bool',
      photo_required: 'bool',
    },
  },
  material_units: {
    primary: ['material_id', 'unit', 'factor', 'variant'],
    columns: { material_id: 'ref_material', unit: 'text', factor: 'qty', variant: 'text' },
  },
  material_aliases: {
    primary: ['material_id', 'alias', 'lang'],
    columns: { material_id: 'ref_material', alias: 'text', lang: 'enum' },
  },
  suppliers: {
    primary: ['name', 'phone'],
    columns: { name: 'text', phone: 'text', note: 'text', tin: 'text', merged_into: 'ref_supplier' },
  },
  cash_advances: {
    primary: ['recipient_id', 'amount', 'issued_at'],
    columns: { recipient_id: 'ref_profile', amount: 'money', issued_at: 'datetime', note: 'text', kind: 'enum' },
  },
  purchases: {
    primary: [
      'material_id',
      'qty_input',
      'unit_input',
      'unit_variant',
      'qty_base',
      'total_amount',
      'unit_price',
      'price_per_base',
      'object_id',
      'buyer_id',
      'supplier_id',
    ],
    columns: {
      ...UNIT_INPUT_COLUMNS,
      buyer_id: 'ref_profile',
      object_id: 'ref_object',
      supplier_id: 'ref_supplier',
      total_amount: 'money',
      unit_price: 'money',
      price_per_base: 'money',
      receipt_photo_path: 'text',
      purchased_at: 'datetime',
      note: 'text',
      request_id: 'text',
      payment_source: 'enum',
      receipt_fiscal_sign: 'text',
      receipt_terminal_id: 'text',
      receipt_no: 'text',
      receipt_verified: 'bool',
      receipt_total: 'money',
      seller_tin: 'text',
      receipt_photo_sha256: 'text',
      geo_lat: 'text',
      geo_lng: 'text',
      geo_accuracy_m: 'qty',
      geo_status: 'enum',
    },
  },
  transfers: {
    primary: [
      'material_id',
      'qty_input',
      'unit_input',
      'unit_variant',
      'qty_base',
      'from_object_id',
      'to_object_id',
      'status',
    ],
    columns: {
      ...UNIT_INPUT_COLUMNS,
      from_object_id: 'ref_object',
      to_object_id: 'ref_object',
      status: 'enum',
      note: 'text',
      received_qty_base: 'qty',
      received_at: 'datetime',
      received_by: 'ref_profile',
      cancel_reason: 'text',
    },
  },
  inventory_counts: {
    primary: ['object_id', 'status', 'counted_at'],
    columns: {
      object_id: 'ref_object',
      status: 'enum',
      counted_at: 'datetime',
      note: 'text',
      applied_at: 'datetime',
      applied_by: 'ref_profile',
      submitted_at: 'datetime',
    },
  },
  inventory_count_items: {
    primary: ['material_id', 'qty_counted', 'qty_input', 'unit_id', 'qty_expected', 'price_per_base'],
    columns: {
      inventory_count_id: 'text',
      material_id: 'ref_material',
      qty_counted: 'qty',
      qty_expected: 'qty',
      qty_input: 'qty',
      unit_id: 'ref_unit',
      price_per_base: 'money',
      note: 'text',
      counted_at: 'datetime',
    },
  },
  estimates: {
    primary: ['title', 'object_id', 'version', 'is_current'],
    columns: {
      object_id: 'ref_object',
      version: 'text',
      title: 'text',
      estimate_date: 'date',
      source_file_name: 'text',
      is_current: 'bool',
      import_hash: 'text',
    },
  },
  estimate_items: {
    primary: ['name', 'item_type', 'material_id', 'qty', 'unit', 'unit_id', 'unit_price', 'norm_qty_base'],
    columns: {
      estimate_id: 'text',
      item_type: 'enum',
      name: 'text',
      material_id: 'ref_material',
      unit: 'text',
      unit_id: 'ref_unit',
      qty: 'qty',
      unit_price: 'money',
      line_sum: 'money',
      norm_qty_base: 'qty',
      sort_order: 'text',
      code: 'text',
      row_number: 'text',
    },
  },
  material_requests: {
    primary: ['material_id', 'qty_input', 'unit_input', 'unit_variant', 'qty_base', 'object_id', 'status'],
    columns: {
      ...UNIT_INPUT_COLUMNS,
      object_id: 'ref_object',
      status: 'enum',
      needed_by: 'date',
      decided_by: 'ref_profile',
      decided_at: 'datetime',
      decision_note: 'text',
      purchase_id: 'ref_purchase',
      note: 'text',
    },
  },
  movements: {
    primary: ['type', 'material_id', 'qty_input', 'unit_input', 'unit_variant', 'qty_base', 'object_id'],
    columns: {
      ...UNIT_INPUT_COLUMNS,
      type: 'enum',
      object_id: 'ref_object',
      purchase_id: 'ref_purchase',
      transfer_id: 'text',
      inventory_count_id: 'text',
      photo_path: 'text',
      occurred_at: 'datetime',
      note: 'text',
      photo_sha256: 'text',
      geo_lat: 'text',
      geo_lng: 'text',
      geo_accuracy_m: 'qty',
      geo_status: 'enum',
    },
  },
  alerts: {
    primary: ['type', 'status', 'severity', 'material_id', 'object_id'],
    columns: {
      type: 'enum',
      status: 'enum',
      severity: 'enum',
      object_id: 'ref_object',
      material_id: 'ref_material',
      purchase_id: 'ref_purchase',
      movement_id: 'text',
      request_id: 'text',
      inventory_count_id: 'text',
      details: 'json',
      closed_by: 'ref_profile',
      closed_at: 'datetime',
      close_note: 'text',
    },
  },
  estimate_import_templates: {
    primary: ['name', 'sheet_name', 'header_row'],
    columns: {
      name: 'text',
      header_signature: 'text',
      mapping: 'json',
      sheet_name: 'text',
      header_row: 'text',
      last_used_at: 'datetime',
    },
  },
}

/** Tarixda ko'rinadigan jadvallar — `z_audit` trigger ulangan barcha biznes jadvallari. */
export const HISTORY_TABLES: readonly string[] = Object.freeze(Object.keys(TABLES))

/** Jadvalning barcha ma'lum ustunlari (umumiy texnik ustunlar bilan). Noma'lum jadval — []. */
export function tableColumns(table: string): string[] {
  const spec = Object.hasOwn(TABLES, table) ? TABLES[table] : undefined
  if (!spec) return []
  const common = Object.keys(COMMON_COLUMNS).filter((c) => !(table === 'companies' && c === 'company_id'))
  return [...new Set([...Object.keys(spec.columns), ...common])]
}

/** Maydon qiymatining turi. Noma'lum jadval/maydon — umumiy qoidalar, oxiri `text`. */
export function fieldKind(table: string, field: string): FieldKind {
  const spec = Object.hasOwn(TABLES, table) ? TABLES[table] : undefined
  if (spec && Object.hasOwn(spec.columns, field)) return spec.columns[field] as FieldKind
  if (Object.hasOwn(COMMON_COLUMNS, field)) return COMMON_COLUMNS[field] as FieldKind
  if (field.endsWith('_at')) return 'datetime'
  return 'text'
}

/**
 * Maydonlar tartibi: avval ma'no bo'yicha asosiylari (nom / material / miqdor / summa),
 * keyin qolgan ustunlar alifbo tartibida. Noma'lum jadval — [].
 */
export function fieldOrder(table: string): string[] {
  const spec = Object.hasOwn(TABLES, table) ? TABLES[table] : undefined
  if (!spec) return []
  const primary = [...spec.primary]
  const rest = tableColumns(table)
    .filter((c) => !primary.includes(c))
    .sort()
  return [...primary, ...rest]
}
