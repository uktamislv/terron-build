// Rollar, menyu bandlari va UI ruxsatlari — sof funksiyalar (React'siz).
// Manba: docs/auth-design.md ("Rollar va menyu") va docs/db-design.md ("Kirish matritsasi").
// MUHIM: `can()` faqat UI qulayligi uchun (tugmani ko'rsatish/yashirish). Xavfsizlik — RLS'da.

export type Role =
  | 'super_admin'
  | 'admin'
  | 'direktor'
  | 'buxgalter'
  | 'taminotchi'
  | 'prorab'
  | 'omborchi'
  | 'haydovchi'
  | 'tekshiruvchi'

export const ROLES: readonly Role[] = Object.freeze([
  'super_admin',
  'admin',
  'direktor',
  'buxgalter',
  'taminotchi',
  'prorab',
  'omborchi',
  'haydovchi',
  'tekshiruvchi',
] as const)

export function isRole(x: unknown): x is Role {
  return typeof x === 'string' && (ROLES as readonly string[]).includes(x)
}

export type WebNavKey =
  | 'dashboard'
  | 'materials'
  | 'movements'
  | 'purchases'
  | 'cash'
  | 'estimates'
  | 'requests'
  | 'alerts'
  | 'history'
  | 'users'
  | 'objects'

export type TgNavKey = 'home' | 'movement' | 'purchase' | 'request' | 'inventory' | 'mine'

/** Barcha veb bandlar — barqaror tartib (yon menyudagi tartib). */
const WEB_ORDER: readonly WebNavKey[] = [
  'dashboard',
  'materials',
  'movements',
  'purchases',
  'cash',
  'estimates',
  'requests',
  'alerts',
  'history',
  'users',
  'objects',
]

/** Barcha Mini App bandlar — barqaror tartib (pastki menyudagi tartib). */
const TG_ORDER: readonly TgNavKey[] = ['home', 'movement', 'purchase', 'request', 'inventory', 'mine']

const WEB_NAV: Record<Role, readonly WebNavKey[]> = {
  super_admin: WEB_ORDER,
  admin: WEB_ORDER,
  direktor: ['dashboard', 'movements', 'purchases', 'cash', 'estimates', 'requests', 'alerts', 'history'],
  buxgalter: ['dashboard', 'materials', 'movements', 'purchases', 'cash', 'estimates', 'alerts'],
  taminotchi: ['dashboard', 'materials', 'purchases', 'requests'],
  prorab: ['dashboard', 'movements', 'requests'],
  omborchi: ['dashboard', 'movements'],
  haydovchi: [],
  // Ko'r-ko'rona sanash: tekshiruvchi qoldiq va harakatlarni ko'rmaydi (Batch 8)
  tekshiruvchi: ['dashboard'],
}

const TG_NAV: Record<Role, readonly TgNavKey[]> = {
  super_admin: ['home', 'movement', 'purchase', 'inventory', 'mine'],
  admin: ['home', 'movement', 'purchase', 'inventory', 'mine'],
  direktor: ['home', 'mine'],
  buxgalter: ['mine'],
  taminotchi: ['purchase', 'mine'],
  prorab: ['movement', 'purchase', 'request', 'mine'],
  omborchi: ['movement', 'mine'],
  haydovchi: ['purchase', 'mine'],
  tekshiruvchi: ['inventory', 'mine'],
}

function ordered<K>(order: readonly K[], allowed: readonly K[]): K[] {
  return order.filter((k) => allowed.includes(k))
}

/** Veb yon menyu bandlari (yangi massiv; tartib `WEB_ORDER` bo'yicha). */
export function webNavFor(role: Role): WebNavKey[] {
  return ordered(WEB_ORDER, WEB_NAV[role] ?? [])
}

/** Mini App pastki menyu bandlari (yangi massiv; tartib `TG_ORDER` bo'yicha). */
export function tgNavFor(role: Role): TgNavKey[] {
  return ordered(TG_ORDER, TG_NAV[role] ?? [])
}

export type Action =
  | 'manage_users'
  | 'manage_objects'
  | 'manage_catalog'
  | 'issue_cash'
  | 'create_purchase'
  | 'create_movement'
  | 'create_request'
  | 'approve_request'
  | 'mark_request_purchased'
  | 'manage_transfers'
  | 'apply_inventory'
  | 'run_inventory'
  | 'view_audit'
  | 'view_alerts'
  | 'manage_alerts'
  | 'restore_records'
  | 'manage_estimates'

const ADMINS: readonly Role[] = ['super_admin', 'admin']

/** docs/db-design.md kirish matritsasidagi "qo'shish"/"o'zgartirish" ustunlari asosida. */
const ACTIONS: Record<Action, readonly Role[]> = {
  manage_users: ADMINS, // profiles: admin
  manage_objects: ADMINS, // objects, object_members: admin
  manage_catalog: ADMINS, // materials, material_units, material_aliases, suppliers: admin
  issue_cash: [...ADMINS, 'buxgalter'], // cash_advances: admin, buxgalter
  create_purchase: [...ADMINS, 'taminotchi', 'prorab', 'haydovchi'], // purchases insert
  create_movement: [...ADMINS, 'prorab', 'omborchi'], // movements insert (kirim/chiqim)
  create_request: [...ADMINS, 'prorab'], // material_requests insert
  approve_request: ADMINS, // material_requests: kutilmoqda → tasdiqlandi | rad (Batch 8: faqat admin, decision_note)
  mark_request_purchased: [...ADMINS, 'taminotchi'], // material_requests: tasdiqlandi → xarid_qilindi (+ purchase_id)
  manage_transfers: ADMINS, // veb: o'tkazmani bekor qilish (cancel_transfer)
  apply_inventory: ADMINS, // apply_inventory_adjustments — qoldiqni tuzatish
  run_inventory: [...ADMINS, 'tekshiruvchi'], // inventory_counts insert
  view_audit: [...ADMINS, 'direktor'], // audit_log select
  view_alerts: [...ADMINS, 'direktor', 'buxgalter'], // alerts select
  manage_alerts: ADMINS, // alerts update (Ko'rildi / Yopish)
  restore_records: ADMINS, // deleted_at -> null (restore_admin_only)
  manage_estimates: [...ADMINS, 'buxgalter'], // estimates, estimate_items: import va joriy qilish
}

export function can(role: Role, action: Action): boolean {
  return ACTIONS[action]?.includes(role) ?? false
}
