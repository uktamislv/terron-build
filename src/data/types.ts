// Bazadagi qatorlar tiplari (qo'lda; generatsiya qilingan tiplar hali yo'q).
// Ustun nomlari docs/db-design.md va supabase/migrations bilan bir xil.
import type { Dec } from '@/domain/decimal'
import type { MovementType } from '@/domain/movements'
import type { Role } from '@/domain/roles'

/** Auth akkaunt turi — faqat o'qiladi, server (Edge Function) yozadi. */
export type LoginKind = 'none' | 'tg' | 'web'

export type ObjectStatus = 'faol' | 'yakunlangan' | 'toxtatilgan'

export const OBJECT_STATUSES: readonly ObjectStatus[] = ['faol', 'yakunlangan', 'toxtatilgan']

export interface Profile {
  id: string
  company_id: string
  /** Faqat o'qiladi — Edge Function (service_role) yozadi. */
  auth_user_id: string | null
  /** Faqat o'qiladi: web — veb parol bor, tg — faqat Telegram, none — akkaunt yo'q. */
  login_kind: LoginKind
  role: Role
  full_name: string
  /** E.164: +998901234567 */
  phone: string
  /** Faqat o'qiladi — Telegram bog'lash (service_role) yozadi. */
  telegram_user_id: number | null
  is_active: boolean
  created_by: string | null
  created_at: string
  updated_at: string
  deleted_at: string | null
  /** Bot bloklangan vaqt (admin ko'radi); null — bloklanmagan. Eski bazada — undefined. */
  telegram_blocked_at?: string | null
  /** Ish oqimi xabarlari (so'rov, o'tkazma, xarid) — profil o'zi o'zgartiradi. */
  notify_workflow?: boolean
}

/**
 * Boshqa xodim haqida ko'rsatiladigan ma'lumot (`profile_directory`): ism, rol, faollik.
 * Admin bo'lmagan rollar `profiles` dan faqat o'zini ko'radi — ro'yxatlar shu tipda.
 */
export type PersonRef = Pick<Profile, 'id' | 'full_name' | 'role' | 'is_active'>

export interface ObjectRow {
  id: string
  company_id: string
  name: string
  address: string | null
  status: ObjectStatus
  /** Batch 12 (D): obyekt koordinatasi `numeric(9,6)` satr sifatida; kiritilmagan — null. */
  lat?: Dec | null
  lng?: Dec | null
  /** Ruxsat etilgan masofa, metr (standart 300). */
  radius_m?: number | null
  created_by: string | null
  created_at: string
  updated_at: string
  deleted_at: string | null
}

export interface ObjectMember {
  id: string
  company_id: string
  object_id: string
  profile_id: string
  created_by: string | null
  created_at: string
  updated_at: string
  deleted_at: string | null
}

/** Komponentlar uchun sessiya — Supabase tiplari tashqariga chiqmaydi. */
export interface AuthSession {
  userId: string
  email: string | null
  /** admin-users set_login dan keyin true — veb panelda parol o'zgartirish majburiy */
  mustChangePassword: boolean
}

/** Muqobil nom tili. */
/** `code` — smetadagi shifr (resurs smetasi importi, faqat RPC orqali yoziladi). */
export type AliasLang = 'ru' | 'uz' | 'code'

export const ALIAS_LANGS: readonly AliasLang[] = ['ru', 'uz']

/**
 * Material birligi: 1 `unit` = `factor` asosiy birlik.
 * `factor` — `numeric(20,10)` satr sifatida (float'ga aylantirilmaydi).
 */
export interface MaterialUnit {
  id: string
  company_id: string
  material_id: string
  unit: string
  factor: Dec
  variant: string | null
  created_at: string
  updated_at: string
}

export interface MaterialAlias {
  id: string
  company_id: string
  material_id: string
  alias: string
  lang: AliasLang
  created_at: string
  updated_at: string
}

/** Material — o'chirilmagan birliklari va muqobil nomlari bilan birga. */
export interface Material {
  id: string
  company_id: string
  name: string
  base_unit: string
  category: string | null
  /** `numeric(6,2)` satr sifatida. */
  waste_pct: Dec
  is_active: boolean
  /** Batch 12 (E): kirim/xaridda rasm majburiy. */
  photo_required?: boolean
  created_by: string | null
  created_at: string
  updated_at: string
  units: MaterialUnit[]
  aliases: MaterialAlias[]
}

/** Batch 12 (D): joylashuv holati — `ok` (olindi), `denied` (ruxsat yo'q), `unavailable` (olinmadi). */
export type GeoStatus = 'ok' | 'denied' | 'unavailable'

/** Yozuv paytidagi joylashuv ustunlari (`movements`, `purchases`). Eski yozuvlar va veb — null. */
export interface GeoColumns {
  geo_lat?: Dec | null
  geo_lng?: Dec | null
  geo_accuracy_m?: number | null
  geo_status?: GeoStatus | null
}

/** Saqlashda yuboriladigan joylashuv (Mini App). `ok` bo'lmasa — koordinatasiz. */
export interface GeoFix {
  status: GeoStatus
  /** Dec satr (6 kasr xonagacha). */
  lat?: Dec
  lng?: Dec
  /** Aniqlik, metr (butun). */
  accuracyM?: number
}

/** `movements.type` — bazadagi `movement_type` enum (domain bilan bir xil). */
export type MovementKind = MovementType

export const MOVEMENT_KINDS: readonly MovementKind[] = ['kirim', 'chiqim', 'transfer_out', 'transfer_in', 'inventory_adjust']

/**
 * Ombor harakati — obyekt, material va kiritgan profil nomlari bilan.
 * Miqdorlar `numeric` → satr (`::text`), float'ga aylantirilmaydi.
 */
export interface Movement extends GeoColumns {
  id: string
  company_id: string
  type: MovementKind
  object_id: string
  material_id: string
  unit_id: string
  qty_input: Dec
  unit_input: string
  unit_variant: string | null
  qty_base: Dec
  purchase_id: string | null
  /** O'tkazma harakati — bog'langan (tuzatib bo'lmaydi). */
  transfer_id?: string | null
  /** Inventarizatsiya tuzatishi — bog'langan. */
  inventory_count_id?: string | null
  photo_path: string | null
  /** Batch 12 (C): rasm SHA-256 (hex), klient hisoblaydi. */
  photo_sha256?: string | null
  occurred_at: string
  note: string | null
  created_by: string | null
  created_at: string
  deleted_at: string | null
  object_name: string | null
  material_name: string | null
  base_unit: string | null
  created_by_name: string | null
}

/** `stock_balances` qatori: obyekt × material qoldig'i asosiy birlikda. */
export interface StockBalance {
  company_id: string
  object_id: string
  material_id: string
  qty_base: Dec
  last_movement_at: string | null
}

/** `suppliers` — sotuvchilar. */
export interface Supplier {
  id: string
  company_id: string
  name: string
  phone: string | null
  note: string | null
  /** Batch 12 (G): STIR (INN) — chek QR bo'yicha topish uchun. */
  tin?: string | null
  created_at: string
  deleted_at: string | null
}

/** `purchase_receipts` view qatori — xarid qabul holati (asosiy birlikda). */
export interface PurchaseReceipt {
  received_qty_base: Dec
  remaining_qty_base: Dec
  receipt_count: number
  last_received_at: string | null
}

export type AlertType =
  | 'xarid_qabul_farqi'
  | 'ozi_qabul_qilgan'
  | 'narx_ogishi'
  | 'normadan_oshish'
  | 'inventarizatsiya_kamomadi'
  | 'smetadan_ortiq_sorov'
  | 'yozuv_ochirildi'
  | 'smeta_ozgarishi'
  | 'otkazma_farqi'
  | 'yozuv_tiklandi'
  // Batch 12 (docs/automation-design.md)
  | 'kirim_manbasiz'
  | 'manfiy_qoldiq'
  | 'takroriy_yozuv'
  | 'joylashuv_farqi'
  | 'smetasiz_chiqim'
  | 'chek_farqi'
  | 'sorovdan_ortiq_xarid'
  | 'podotchet_muddati'
  | 'podotchet_manfiy'
  // Audit tuzatishlari (docs/audit-fixes.md, "Yangi alert turlari")
  | 'yozuv_ozgartirildi'
  | 'yozuv_tuzatildi'
  | 'sozlama_ozgardi'
  | 'login_ozgardi'
  | 'podotchet_belgisi'
  | 'sotuvchi_stir_farqi'
  // Audit 2 (20261109000001_audit2_fixes.sql)
  | 'xarid_boshqa_nomidan'
  | 'sotuvchi_birlashtirildi'

export const ALERT_TYPES: readonly AlertType[] = [
  'xarid_qabul_farqi',
  'ozi_qabul_qilgan',
  'narx_ogishi',
  'normadan_oshish',
  'inventarizatsiya_kamomadi',
  'smetadan_ortiq_sorov',
  'yozuv_ochirildi',
  'smeta_ozgarishi',
  'otkazma_farqi',
  'yozuv_tiklandi',
  'kirim_manbasiz',
  'manfiy_qoldiq',
  'takroriy_yozuv',
  'joylashuv_farqi',
  'smetasiz_chiqim',
  'chek_farqi',
  'sorovdan_ortiq_xarid',
  'podotchet_muddati',
  'podotchet_manfiy',
  'yozuv_ozgartirildi',
  'yozuv_tuzatildi',
  'sozlama_ozgardi',
  'login_ozgardi',
  'podotchet_belgisi',
  'sotuvchi_stir_farqi',
  'xarid_boshqa_nomidan',
  'sotuvchi_birlashtirildi',
]

export type AlertStatus = 'yangi' | 'korildi' | 'yopildi'

export const ALERT_STATUSES: readonly AlertStatus[] = ['yangi', 'korildi', 'yopildi']

export type AlertSeverity = 'belgi' | 'ogohlantirish' | 'jiddiy'

export const ALERT_SEVERITIES: readonly AlertSeverity[] = ['belgi', 'ogohlantirish', 'jiddiy']

/** Xarid — obyekt, material, xaridor va sotuvchi nomlari, qabul holati bilan. Pul va miqdor — satr. */
export type PaymentSource = 'podotchet' | 'firma'
export const PAYMENT_SOURCES: readonly PaymentSource[] = ['podotchet', 'firma']

export interface Purchase extends GeoColumns {
  id: string
  company_id: string
  buyer_id: string
  object_id: string
  material_id: string
  supplier_id: string | null
  unit_id: string
  qty_input: Dec
  unit_input: string
  unit_variant: string | null
  qty_base: Dec
  total_amount: Dec
  unit_price: Dec
  price_per_base: Dec
  receipt_photo_path: string | null
  /** Batch 12 (C): chek rasmi SHA-256 (hex). */
  receipt_photo_sha256?: string | null
  /** Batch 12 (G): chek QR — fiskal belgi, terminal, chek raqami; soliq sahifasidan tasdiqlangan. */
  receipt_fiscal_sign?: string | null
  receipt_terminal_id?: string | null
  receipt_no?: string | null
  receipt_verified?: boolean
  /**
   * Pul manbai: 'podotchet' — xaridor qo'lidagi pul (podotchet hisobiga kiradi), 'firma' — firma to'lagan
   * (podotchet va qo'ldagi pul yig'indilariga kirmaydi). Server qoidasi bilan to'ldiriladi.
   */
  payment_source?: PaymentSource
  /** Chekdagi jami (so'm), `numeric(18,2)` satr. */
  receipt_total?: Dec | null
  seller_tin?: string | null
  /** Batch 12 (H): shu so'rov bo'yicha xarid. */
  request_id?: string | null
  purchased_at: string
  note: string | null
  created_by: string | null
  created_at: string
  deleted_at: string | null
  object_name: string | null
  material_name: string | null
  base_unit: string | null
  buyer_name: string | null
  supplier_name: string | null
  /** Qabul holati (`purchase_receipts`); so'ralmagan yoki ko'rinmasa — null. */
  receipt: PurchaseReceipt | null
  /** Ochiq (yopilmagan) alert turlari — faqat ko'ra oladiganlar uchun to'ldiriladi. */
  alert_types: AlertType[]
}

/** `open_purchases` RPC qatori — kirimga bog'lash uchun to'liq qabul qilinmagan xarid. */
export interface OpenPurchase {
  id: string
  purchased_at: string
  buyer_id: string | null
  buyer_name: string | null
  qty_base: Dec
  received_qty_base: Dec
  remaining_qty_base: Dec
  unit_input: string
  unit_variant: string | null
  qty_input: Dec
}

/** `cash_balances` view qatori — odamning qo'lidagi pul. */
export interface CashBalance {
  company_id: string
  profile_id: string
  issued_total: Dec
  /** Batch 12 (I): qaytarilgan pul jami (eski view'da yo'q — undefined). */
  returned_total?: Dec
  spent_total: Dec
  /** berildi − qaytarildi − xaridlar. */
  balance: Dec
  last_issued_at: string | null
  last_spent_at: string | null
}

/** Batch 12 (I): `berildi` — pul berildi, `qaytarildi` — odam ortiqcha pulni qaytardi. */
export type CashAdvanceKind = 'berildi' | 'qaytarildi'

/** `cash_advances` — berilgan (yoki qaytarilgan) pul (podotchet). */
export interface CashAdvance {
  id: string
  company_id: string
  recipient_id: string
  /** Eski qatorlarda bo'lmasa — `berildi`. */
  kind?: CashAdvanceKind
  amount: Dec
  issued_at: string
  note: string | null
  created_by: string | null
  created_at: string
  deleted_at: string | null
  recipient_name: string | null
  created_by_name: string | null
}

/** Ogohlantirish — obyekt va material nomlari bilan. `details` — qoida bo'yicha JSON. */
export interface Alert {
  id: string
  company_id: string
  type: AlertType
  status: AlertStatus
  severity: AlertSeverity
  object_id: string | null
  material_id: string | null
  purchase_id: string | null
  movement_id: string | null
  details: Record<string, unknown>
  closed_by: string | null
  closed_at: string | null
  /** Yopishda ixtiyoriy sabab (<= 500). */
  close_note: string | null
  created_at: string
  deleted_at: string | null
  object_name: string | null
  material_name: string | null
  base_unit: string | null
}

/** `estimate_items.item_type` — bazadagi `estimate_item_type` enum. */
export type EstimateItemType = 'ish' | 'material'

/** Smeta versiyasi — qatorlar soni va jami summa bilan (klientda `Dec` bilan yig'iladi). */
export interface Estimate {
  id: string
  company_id: string
  object_id: string
  version: number
  title: string
  /** `yyyy-mm-dd` yoki null. */
  estimate_date: string | null
  source_file_name: string | null
  is_current: boolean
  created_by: string | null
  created_at: string
  updated_at: string
  /** `estimate_totals` view: qatorlar va material qatorlari soni, jami summa (so'm). */
  item_count: number
  material_count: number
  total_sum: Dec
}

/** Smeta qatori — material nomi va asosiy birligi bilan. Miqdor va narx — satr. */
export interface EstimateItem {
  id: string
  estimate_id: string
  item_type: EstimateItemType
  /** Smetadagi asl nom. */
  name: string
  material_id: string | null
  /** Smetadagi birlik matni. */
  unit: string | null
  unit_id: string | null
  qty: Dec
  unit_price: Dec | null
  /** Qator summasi (numeric(18,2)); bo'lsa — haqiqiy jami (resurs smetasi), aks holda round(qty × narx, 2). */
  line_sum: Dec | null
  /** Asosiy birlikda (material bo'lsa) — bazada hisoblanadi. */
  norm_qty_base: Dec | null
  sort_order: number
  code: string | null
  row_number: number | null
  material_name: string | null
  base_unit: string | null
}

/** `estimate_import_templates` — firma uchun eslab qolingan ustun moslash shabloni. */
export interface EstimateImportTemplate {
  id: string
  company_id: string
  name: string
  header_signature: string
  /** Maydon → ustun indeksi (0 dan). */
  mapping: Record<string, number>
  sheet_name: string | null
  /** Sarlavha qatori indeksi (0 dan). */
  header_row: number | null
  last_used_at: string | null
  updated_at: string | null
  created_by_name: string | null
}

/** `material_requests.status` — bazadagi `request_status` enum. */
export type RequestStatus = 'kutilmoqda' | 'tasdiqlandi' | 'rad' | 'xarid_qilindi'

export const REQUEST_STATUSES: readonly RequestStatus[] = ['kutilmoqda', 'tasdiqlandi', 'rad', 'xarid_qilindi']

/** Material so'rovi (prorab) — obyekt, material, kiritgan va hal qilgan nomlari bilan. Miqdorlar — satr. */
export interface MaterialRequest {
  id: string
  company_id: string
  object_id: string
  material_id: string
  unit_id: string
  qty_input: Dec
  unit_input: string
  unit_variant: string | null
  qty_base: Dec
  status: RequestStatus
  /** `yyyy-mm-dd` yoki null. */
  needed_by: string | null
  decided_by: string | null
  decided_at: string | null
  /** Rad etish (yoki tasdiqlash) sababi — admin yozadi. */
  decision_note: string | null
  /** "Xarid qilindi" da bog'langan xarid (ixtiyoriy). */
  purchase_id: string | null
  note: string | null
  created_by: string | null
  created_at: string
  deleted_at: string | null
  object_name: string | null
  material_name: string | null
  base_unit: string | null
  created_by_name: string | null
  decided_by_name: string | null
}

/** `transfers.status` — bazadagi `transfer_status` enum. */
export type TransferStatus = 'yuborildi' | 'qabul_qilindi' | 'bekor'

export const TRANSFER_STATUSES: readonly TransferStatus[] = ['yuborildi', 'qabul_qilindi', 'bekor']

/** Obyektlar orasidagi o'tkazma. Boshqa obyekt nomi RLS tufayli ko'rinmasligi mumkin (null). */
export interface Transfer {
  id: string
  company_id: string
  from_object_id: string
  to_object_id: string
  material_id: string
  unit_id: string
  qty_input: Dec
  unit_input: string
  unit_variant: string | null
  qty_base: Dec
  status: TransferStatus
  /** Qabul qilingan miqdor (asosiy birlikda); qabul qilinmagan — null. */
  received_qty_base: Dec | null
  received_at: string | null
  received_by: string | null
  cancel_reason: string | null
  note: string | null
  created_by: string | null
  created_at: string
  deleted_at: string | null
  from_object_name: string | null
  to_object_name: string | null
  material_name: string | null
  base_unit: string | null
  created_by_name: string | null
}

export type InventoryStatus = 'draft' | 'submitted'

/** Inventarizatsiya (sanash) hisobi. */
export interface InventoryCount {
  id: string
  company_id: string
  object_id: string
  status: InventoryStatus
  counted_at: string
  note: string | null
  applied_at: string | null
  applied_by: string | null
  created_by: string | null
  created_at: string
  updated_at: string
  object_name: string | null
  created_by_name: string | null
  /** O'chirilmagan qatorlar soni. */
  item_count: number
}

/** Sanalgan qator. `qty_counted` — asosiy birlikda (baza hisoblaydi), `qty_expected` — yuborilgandan keyin. */
export interface InventoryCountItem {
  id: string
  inventory_count_id: string
  material_id: string
  qty_counted: Dec
  qty_expected: Dec | null
  qty_input: Dec | null
  unit_id: string | null
  updated_at: string
  material_name: string | null
  base_unit: string | null
}

/** `norm_usage` view qatori — obyekt × material: norma, isrof bilan norma, sarf, ochiq so'rovlar. */
export interface NormUsage {
  company_id: string
  object_id: string
  material_id: string
  estimate_id: string | null
  norm_qty_base: Dec
  allowed_qty_base: Dec
  consumed_qty_base: Dec
  /** Obyektga yetkazilgan (kirim + transfer_in) Σ qty_base. */
  delivered_qty_base: Dec
  requested_open_qty_base: Dec
  remaining_qty_base: Dec
  usage_pct: Dec | null
}

/** `inventory_count_details` RPC qatori (yakunlangan hisob; admin, direktor). Sanalmagan — `qty_counted` null. */
export interface InventoryDetailRow {
  material_id: string
  material_name: string | null
  base_unit: string | null
  qty_input: Dec | null
  unit_id: string | null
  qty_counted: Dec | null
  qty_expected: Dec | null
  /** counted − expected (ishorali). */
  diff: Dec | null
  shortage_value: Dec | null
}
