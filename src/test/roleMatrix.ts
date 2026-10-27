// ============================================================================
// Yagona rol matritsasi — UI ruxsatlari (`src/domain/roles.ts` → `can()`) va bazadagi
// RLS (supabase/tests/sql/role_matrix.sql.test.ts) SHU fayldan tekshiriladi.
// Manba: docs/db-design.md ("Kirish matritsasi") va docs/auth-design.md.
//
// Ikki tomon bir-biridan "siljisa" test yiqiladi:
//   - roles.test.ts: `can(role, action)` === ACTION_ROLES[action];
//   - role_matrix.sql.test.ts: haqiqiy INSERT/UPDATE natijasi === TABLE_INSERT / TABLE_UPDATE;
//   - ikkala testda: ACTION_SOURCE bo'yicha action rollari jadval rollari bilan bir xil.
// Faqat test kodi import qiladi (ishlab chiqarish kodi emas).
// ============================================================================

import type { Action, Role } from '../domain/roles'

export const MATRIX_ROLES: readonly Role[] = [
  'super_admin',
  'admin',
  'direktor',
  'buxgalter',
  'taminotchi',
  'prorab',
  'omborchi',
  'haydovchi',
  'tekshiruvchi',
]

/** supabase/tests/sql/_fixtures.ts BUSINESS_TABLES bilan bir xil (SQL testi tenglikni tekshiradi). */
export const MATRIX_TABLES = [
  'companies',
  'profiles',
  'objects',
  'object_members',
  'materials',
  'material_units',
  'material_aliases',
  'suppliers',
  'cash_advances',
  'purchases',
  'transfers',
  'inventory_counts',
  'inventory_count_items',
  'estimates',
  'estimate_items',
  'estimate_import_templates',
  'material_requests',
  'movements',
  'alerts',
  // 20261111000001_expenses
  'expense_categories',
  'expenses',
] as const
export type MatrixTable = (typeof MATRIX_TABLES)[number]

const ADMINS: Role[] = ['super_admin', 'admin']

/** UI amallari → ruxsat etilgan rollar (`can()`). */
export const ACTION_ROLES: Record<Action, readonly Role[]> = {
  manage_users: ADMINS,
  manage_objects: ADMINS,
  manage_catalog: ADMINS,
  issue_cash: [...ADMINS, 'buxgalter'],
  create_purchase: [...ADMINS, 'taminotchi', 'prorab', 'haydovchi'],
  create_movement: [...ADMINS, 'prorab', 'omborchi'],
  create_request: [...ADMINS, 'prorab'],
  approve_request: ADMINS,
  mark_request_purchased: [...ADMINS, 'taminotchi'],
  manage_transfers: ADMINS,
  apply_inventory: ADMINS,
  run_inventory: [...ADMINS, 'tekshiruvchi'],
  view_audit: [...ADMINS, 'direktor'],
  view_alerts: [...ADMINS, 'direktor', 'buxgalter'],
  manage_alerts: ADMINS,
  restore_records: ADMINS,
  manage_estimates: [...ADMINS, 'buxgalter'],
  create_expense: [...ADMINS, 'buxgalter', 'taminotchi', 'prorab', 'haydovchi'],
  manage_expense_categories: ADMINS,
}

/**
 * Jadvalga to'g'ridan-to'g'ri INSERT (RLS). Bo'sh — faqat RPC orqali (smeta: import_estimate,
 * o'tkazma: create_transfer, alert: tizim).
 */
export const TABLE_INSERT: Record<MatrixTable, readonly Role[]> = {
  companies: ['super_admin'],
  profiles: ADMINS,
  objects: ADMINS,
  object_members: ADMINS,
  materials: ADMINS,
  material_units: ADMINS,
  material_aliases: ADMINS,
  // Batch 5: xarid kiritadigan rollar yangi sotuvchi qo'shadi (o'zgartirish — admin)
  suppliers: [...ADMINS, 'taminotchi', 'haydovchi', 'prorab'],
  cash_advances: [...ADMINS, 'buxgalter'],
  // buyer_id = o'zi, obj1 (prorab a'zo)
  purchases: [...ADMINS, 'taminotchi', 'haydovchi', 'prorab'],
  movements: [...ADMINS, 'prorab', 'omborchi'],
  inventory_counts: [...ADMINS, 'tekshiruvchi'],
  // ic_obj1 — tekshiruvchi yaratgan, draft
  inventory_count_items: [...ADMINS, 'tekshiruvchi'],
  estimates: [],
  estimate_items: [],
  estimate_import_templates: [...ADMINS, 'buxgalter'],
  material_requests: [...ADMINS, 'prorab'],
  transfers: [],
  alerts: [],
  expense_categories: ADMINS,
  // payer_id = o'zi; obj1 — prorab, haydovchi a'zo
  expenses: [...ADMINS, 'buxgalter', 'taminotchi', 'prorab', 'haydovchi'],
}

/** Jadvaldagi namunaviy qatorni to'g'ridan-to'g'ri UPDATE (RLS + ustun grantlari). */
export const TABLE_UPDATE: Record<MatrixTable, readonly Role[]> = {
  companies: ADMINS,
  profiles: ADMINS,
  objects: ADMINS,
  object_members: ADMINS,
  materials: ADMINS,
  material_units: ADMINS,
  material_aliases: ADMINS,
  suppliers: ADMINS,
  cash_advances: [...ADMINS, 'buxgalter'],
  // Muallif o'z yozuvini faqat correct_entry / cancel_own_entry orqali (30 daqiqa) o'zgartiradi
  purchases: ADMINS,
  movements: ADMINS,
  // ic_obj1 / ici_obj1 — tekshiruvchi yaratgan, draft
  inventory_counts: [...ADMINS, 'tekshiruvchi'],
  inventory_count_items: [...ADMINS, 'tekshiruvchi'],
  estimates: [...ADMINS, 'buxgalter'],
  estimate_items: [...ADMINS, 'buxgalter'],
  estimate_import_templates: [...ADMINS, 'buxgalter'],
  material_requests: [...ADMINS, 'taminotchi'],
  // o'tkazma faqat RPC (receive_transfer / cancel_transfer) orqali o'zgaradi
  transfers: [],
  alerts: ADMINS,
  expense_categories: ADMINS,
  // muallif — faqat correct_entry / cancel_own_entry orqali
  expenses: ADMINS,
}

/**
 * Bazadagi ko'rish (SELECT) bo'yicha rollar — jadval qatorlarining hammasi emas, "to'liq ro'yxat"
 * huquqi: audit_log (o'zgarishlar tarixi) va alerts (firma bo'yicha barcha ogohlantirishlar).
 * Sayt alertlari (alerts_select_site: prorab / omborchi) — alohida, role_matrix.sql.test.ts da.
 */
export const RELATION_SELECT_ALL: Record<'audit_log' | 'alerts', readonly Role[]> = {
  audit_log: [...ADMINS, 'direktor'],
  alerts: [...ADMINS, 'direktor', 'buxgalter'],
}

/**
 * Sayt alertlari (RLS `alerts_select_site`): prorab / omborchi a'zo obyektlaridagi faqat shu
 * turlarni ko'radi (o'chirilmaganlarini). prorab ro'yxati — src/data/alertsRepo SITE_ALERT_TYPES.
 */
export const SITE_ALERT_TYPES_BY_ROLE: Readonly<Partial<Record<Role, readonly string[]>>> = {
  prorab: ['normadan_oshish', 'manfiy_qoldiq', 'otkazma_farqi', 'smetadan_ortiq_sorov', 'smetasiz_chiqim'],
  omborchi: ['normadan_oshish', 'manfiy_qoldiq', 'otkazma_farqi', 'smetasiz_chiqim'],
}

export type ActionSource =
  | { kind: 'insert' | 'update'; table: MatrixTable }
  | { kind: 'select_all'; relation: keyof typeof RELATION_SELECT_ALL }
  /** RPC yoki holat o'tishi triggeri ichida tekshiriladi (`has_role(...)`) — SQL testi shu "probe" ni chaqiradi. */
  | { kind: 'guarded'; probe: GuardedProbe }

/**
 * RPC / trigger bilan himoyalangan amallar:
 *   request_approve — material_requests.status: kutilmoqda → tasdiqlandi (trigger);
 *   cancel_transfer, apply_inventory_adjustments, restore_record — RPC.
 */
export type GuardedProbe = 'request_approve' | 'cancel_transfer' | 'apply_inventory_adjustments' | 'restore_record'

/** Har UI amali qaysi baza huquqiga tayanadi — rollar to'plami aynan teng bo'lishi shart. */
export const ACTION_SOURCE: Record<Action, ActionSource> = {
  manage_users: { kind: 'insert', table: 'profiles' },
  manage_objects: { kind: 'insert', table: 'objects' },
  manage_catalog: { kind: 'insert', table: 'materials' },
  issue_cash: { kind: 'insert', table: 'cash_advances' },
  create_purchase: { kind: 'insert', table: 'purchases' },
  create_movement: { kind: 'insert', table: 'movements' },
  create_request: { kind: 'insert', table: 'material_requests' },
  approve_request: { kind: 'guarded', probe: 'request_approve' },
  mark_request_purchased: { kind: 'update', table: 'material_requests' },
  manage_transfers: { kind: 'guarded', probe: 'cancel_transfer' },
  apply_inventory: { kind: 'guarded', probe: 'apply_inventory_adjustments' },
  run_inventory: { kind: 'insert', table: 'inventory_counts' },
  view_audit: { kind: 'select_all', relation: 'audit_log' },
  view_alerts: { kind: 'select_all', relation: 'alerts' },
  manage_alerts: { kind: 'update', table: 'alerts' },
  restore_records: { kind: 'guarded', probe: 'restore_record' },
  manage_estimates: { kind: 'update', table: 'estimates' },
  create_expense: { kind: 'insert', table: 'expenses' },
  manage_expense_categories: { kind: 'insert', table: 'expense_categories' },
}

/** RPC / trigger ichidagi rol tekshiruvi — role_matrix.sql.test.ts haqiqiy chaqiruv bilan tekshiradi. */
export const GUARDED_ROLES: Record<GuardedProbe, readonly Role[]> = {
  request_approve: ADMINS,
  cancel_transfer: ADMINS,
  apply_inventory_adjustments: ADMINS,
  restore_record: ADMINS,
}

/** Action → baza tomonidagi rollar (ACTION_SOURCE bo'yicha). */
export function dbRolesFor(action: Action): readonly Role[] {
  const src = ACTION_SOURCE[action]
  switch (src.kind) {
    case 'insert':
      return TABLE_INSERT[src.table]
    case 'update':
      return TABLE_UPDATE[src.table]
    case 'select_all':
      return RELATION_SELECT_ALL[src.relation]
    case 'guarded':
      return GUARDED_ROLES[src.probe]
  }
}

/** Rollar to'plamini MATRIX_ROLES tartibida (solishtirish uchun). */
export function sortRoles(roles: readonly Role[]): Role[] {
  return MATRIX_ROLES.filter((r) => roles.includes(r))
}
