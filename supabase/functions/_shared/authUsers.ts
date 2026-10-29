// Auth akkauntlar bilan ishlash uchun umumiy sof turlar (tg-auth, admin-users).
// Realizatsiya — supabaseAdmin.ts (Deno), testlarda — soxta.

export type LoginKind = 'none' | 'tg' | 'web'

export interface AuthUserInfo {
  id: string
  email: string | null
  /** GoTrue `app_metadata` (faqat service_role yozadi). */
  app_metadata: Record<string, unknown>
}

export interface CreateAuthUserInput {
  email: string
  password: string
  /** `app_metadata` — foydalanuvchi o'zgartira olmaydi. */
  appMetadata?: Record<string, unknown>
  /** `user_metadata` — foydalanuvchi o'zi o'zgartira oladi (huquq / belgi uchun ishlatilmaydi). */
  userMetadata?: Record<string, unknown>
}

export interface UpdateAuthUserInput {
  email?: string
  password?: string
  /** `app_metadata` — GoTrue mavjud kalitlar bilan birlashtiradi (merge). */
  appMetadata?: Record<string, unknown>
  userMetadata?: Record<string, unknown>
}

export type CreateAuthUserResult = { ok: true; id: string } | { ok: false; reason: 'email_exists' | 'weak_password' }
export type UpdateAuthUserResult = { ok: true } | { ok: false; reason: 'email_exists' | 'weak_password' | 'not_found' }

/** Auth akkaunt boshqaruvi — ikkala funksiya uchun umumiy `deps` qismi. */
export interface AuthAdminDeps {
  /** `email_confirm: true` bilan yaratadi. */
  createAuthUser: (input: CreateAuthUserInput) => Promise<CreateAuthUserResult>
  /** Email bo'yicha (katta-kichik harf farqsiz) auth user. Yo'q bo'lsa null. */
  findAuthUserByEmail: (email: string) => Promise<AuthUserInfo | null>
  /** Shu auth user'ga bog'langan o'chirilmagan profil id. Yo'q bo'lsa null. */
  findProfileIdByAuthUserId: (authUserId: string) => Promise<string | null>
  /** auth user'ni butunlay o'chiradi (uning sessiyalari ham o'ladi). */
  deleteAuthUser: (authUserId: string) => Promise<void>
}

export type AuthEventAction = 'SET_LOGIN' | 'TG_LINK' | 'TG_AUTH_USER_CREATED'

/** audit_log ga auth hodisasi (`public.svc_log_auth_event`). Parol details'ga hech qachon qo'yilmaydi. */
export interface AuthEvent {
  company_id: string
  actor_profile_id: string | null
  target_profile_id: string
  action: AuthEventAction
  details: Record<string, unknown>
}

export type LogAuthEventFn = (event: AuthEvent) => Promise<void>
