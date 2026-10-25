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
}

export interface ObjectRow {
  id: string
  company_id: string
  name: string
  address: string | null
  status: ObjectStatus
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
export type AliasLang = 'ru' | 'uz'

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
  created_by: string | null
  created_at: string
  updated_at: string
  units: MaterialUnit[]
  aliases: MaterialAlias[]
}

/** `movements.type` — bazadagi `movement_type` enum (domain bilan bir xil). */
export type MovementKind = MovementType

export const MOVEMENT_KINDS: readonly MovementKind[] = ['kirim', 'chiqim', 'transfer_out', 'transfer_in', 'inventory_adjust']

/**
 * Ombor harakati — obyekt, material va kiritgan profil nomlari bilan.
 * Miqdorlar `numeric` → satr (`::text`), float'ga aylantirilmaydi.
 */
export interface Movement {
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
  photo_path: string | null
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
