// Bazadagi qatorlar tiplari (qo'lda; generatsiya qilingan tiplar hali yo'q).
// Ustun nomlari docs/db-design.md va supabase/migrations bilan bir xil.
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
