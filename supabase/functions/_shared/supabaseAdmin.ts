// Deno'ga xos: service_role bilan Supabase admin klient va logic.ts `deps` larining
// umumiy realizatsiyalari. Faqat index.ts lardan import qilinadi; vitest/tsc typecheck'dan
// tashqarida (CI'da `deno check` tekshiradi).
//
// MUHIM: verifyOtp (sessiya olish) har safar YANGI vaqtinchalik klientda chaqiriladi.
// Umumiy admin klientda chaqirilsa, sessiya klient xotirasiga yozilib, keyingi so'rovlar
// service_role o'rniga foydalanuvchi JWT'si bilan ketardi.

import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2.118.0'
import type {
  AuthEvent,
  AuthUserInfo,
  CreateAuthUserInput,
  CreateAuthUserResult,
  LoginKind,
  UpdateAuthUserInput,
  UpdateAuthUserResult,
} from './authUsers.ts'

const CLIENT_OPTS = {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
} as const

function requireEnv(name: string): string {
  const v = Deno.env.get(name)
  if (!v) throw new Error(`${name} sozlanmagan`)
  return v
}

let adminClient: SupabaseClient | null = null

/** service_role klient (RLS'ni chetlab o'tadi). Bitta nusxa — sessiya saqlanmaydi. */
export function getAdminClient(): SupabaseClient {
  if (adminClient === null) {
    adminClient = createClient(requireEnv('SUPABASE_URL'), requireEnv('SUPABASE_SERVICE_ROLE_KEY'), CLIENT_OPTS)
  }
  return adminClient
}

/** Faqat verifyOtp uchun — har chaqiruvda yangi, hech qayerda saqlanmaydi. */
function ephemeralClient(): SupabaseClient {
  const key = Deno.env.get('SUPABASE_ANON_KEY') || requireEnv('SUPABASE_SERVICE_ROLE_KEY')
  return createClient(requireEnv('SUPABASE_URL'), key, CLIENT_OPTS)
}

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

interface AuthErrorLike {
  code?: string
  status?: number
  message?: string
}

function isEmailExists(err: AuthErrorLike): boolean {
  if (err.code === 'email_exists' || err.code === 'user_already_exists') return true
  return /already (been )?registered|already exists/i.test(err.message ?? '')
}

function isWeakPassword(err: AuthErrorLike): boolean {
  return err.code === 'weak_password' || /password should|weak password/i.test(err.message ?? '')
}

function isUserNotFound(err: AuthErrorLike): boolean {
  return err.code === 'user_not_found' || err.status === 404
}

export async function getAuthUserEmail(authUserId: string): Promise<string | null> {
  const { data, error } = await getAdminClient().auth.admin.getUserById(authUserId)
  if (error) {
    if (isUserNotFound(error)) return null
    throw new Error(`getUserById: ${error.message}`)
  }
  return data.user?.email ?? null
}

/**
 * Email bo'yicha auth user (bazadagi `public.svc_auth_user_id_by_email`, faqat service_role).
 * `generateLink` ishlatilmaydi — u mavjud bo'lmagan user'ni yaratib yuboradi.
 */
export async function findAuthUserByEmail(email: string): Promise<AuthUserInfo | null> {
  const { data: id, error } = await getAdminClient().rpc('svc_auth_user_id_by_email', { p_email: email })
  if (error) throw new Error(`svc_auth_user_id_by_email: ${error.message}`)
  if (typeof id !== 'string' || id === '') return null
  const { data, error: getErr } = await getAdminClient().auth.admin.getUserById(id)
  if (getErr) {
    if (isUserNotFound(getErr)) return null
    throw new Error(`getUserById: ${getErr.message}`)
  }
  if (!data.user) return null
  return {
    id: data.user.id,
    email: data.user.email ?? null,
    app_metadata: (data.user.app_metadata ?? {}) as Record<string, unknown>,
  }
}

export async function createAuthUser(input: CreateAuthUserInput): Promise<CreateAuthUserResult> {
  const { data, error } = await getAdminClient().auth.admin.createUser({
    email: input.email,
    password: input.password,
    email_confirm: true,
    ...(input.appMetadata ? { app_metadata: input.appMetadata } : {}),
    ...(input.userMetadata ? { user_metadata: input.userMetadata } : {}),
  })
  if (error) {
    if (isEmailExists(error)) return { ok: false, reason: 'email_exists' }
    if (isWeakPassword(error)) {
      console.warn(JSON.stringify({ level: 'warn', message: 'createUser: weak_password', code: error.code ?? null }))
      return { ok: false, reason: 'weak_password' }
    }
    throw new Error(`createUser: ${error.message}`)
  }
  if (!data.user) throw new Error('createUser: user qaytmadi')
  return { ok: true, id: data.user.id }
}

export async function updateAuthUser(authUserId: string, input: UpdateAuthUserInput): Promise<UpdateAuthUserResult> {
  const { error } = await getAdminClient().auth.admin.updateUserById(authUserId, {
    ...(input.email !== undefined ? { email: input.email, email_confirm: true } : {}),
    ...(input.password !== undefined ? { password: input.password } : {}),
    ...(input.userMetadata ? { user_metadata: input.userMetadata } : {}),
  })
  if (error) {
    if (isEmailExists(error)) return { ok: false, reason: 'email_exists' }
    if (isWeakPassword(error)) {
      console.warn(JSON.stringify({ level: 'warn', message: 'updateUserById: weak_password', code: error.code ?? null }))
      return { ok: false, reason: 'weak_password' }
    }
    if (isUserNotFound(error)) return { ok: false, reason: 'not_found' }
    throw new Error(`updateUserById: ${error.message}`)
  }
  return { ok: true }
}

/** auth user'ni butunlay o'chiradi (sessiyalari ham). profiles.auth_user_id — FK `on delete set null`. */
export async function deleteAuthUser(authUserId: string): Promise<void> {
  const { error } = await getAdminClient().auth.admin.deleteUser(authUserId)
  if (error && !isUserNotFound(error)) throw new Error(`deleteUser: ${error.message}`)
}

/** magiclink → hashed_token → verifyOtp. Xat yuborilmaydi (admin generateLink). */
export async function createSession(
  email: string,
): Promise<{ access_token: string; refresh_token: string; expires_at: number }> {
  const { data: link, error: linkErr } = await getAdminClient().auth.admin.generateLink({ type: 'magiclink', email })
  if (linkErr) throw new Error(`generateLink: ${linkErr.message}`)
  const tokenHash = link.properties?.hashed_token
  if (!tokenHash) throw new Error('generateLink: hashed_token yo\'q')

  const { data, error } = await ephemeralClient().auth.verifyOtp({ type: 'magiclink', token_hash: tokenHash })
  if (error) throw new Error(`verifyOtp: ${error.message}`)
  const s = data.session
  if (!s) throw new Error('verifyOtp: sessiya qaytmadi')
  return {
    access_token: s.access_token,
    refresh_token: s.refresh_token,
    expires_at: s.expires_at ?? Math.floor(Date.now() / 1000) + (s.expires_in ?? 3600),
  }
}

/** JWT → auth user id. Yaroqsiz bo'lsa null. */
export async function getAuthUserIdFromJwt(jwt: string): Promise<string | null> {
  const { data, error } = await getAdminClient().auth.getUser(jwt)
  if (error || !data.user) return null
  return data.user.id
}

// ---------------------------------------------------------------------------
// profiles / companies / audit
// ---------------------------------------------------------------------------

/** Faol (is_active, o'chirilmagan) firma id'lari to'plami. */
export async function activeCompanyIds(companyIds: string[]): Promise<Set<string>> {
  if (companyIds.length === 0) return new Set()
  const { data, error } = await getAdminClient()
    .from('companies')
    .select('id')
    .in('id', [...new Set(companyIds)])
    .eq('is_active', true)
    .is('deleted_at', null)
  if (error) throw new Error(`companies: ${error.message}`)
  return new Set(((data ?? []) as { id: string }[]).map((r) => r.id))
}

export interface ProfileRow {
  id: string
  company_id: string
  role: string
  full_name: string
  phone: string
  auth_user_id: string | null
  telegram_user_id: number | null
  is_active: boolean
  login_kind: LoginKind
}

const PROFILE_COLS = 'id, company_id, role, full_name, phone, auth_user_id, telegram_user_id, is_active, login_kind'

/** O'chirilmagan profil `telegram_user_id` bo'yicha (unique indeks — ko'pi bilan 1). */
export async function profileByTelegramId(telegramUserId: number): Promise<ProfileRow | null> {
  const { data, error } = await getAdminClient()
    .from('profiles')
    .select(PROFILE_COLS)
    .eq('telegram_user_id', telegramUserId)
    .is('deleted_at', null)
    .maybeSingle()
  if (error) throw new Error(`profiles(tg): ${error.message}`)
  return (data as ProfileRow | null) ?? null
}

export async function profileById(profileId: string): Promise<ProfileRow | null> {
  const { data, error } = await getAdminClient()
    .from('profiles')
    .select(PROFILE_COLS)
    .eq('id', profileId)
    .is('deleted_at', null)
    .maybeSingle()
  if (error) throw new Error(`profiles(id): ${error.message}`)
  return (data as ProfileRow | null) ?? null
}

/** auth user'ga bog'langan o'chirilmagan profil id (unique indeks — ko'pi bilan 1). */
export async function profileIdByAuthUserId(authUserId: string): Promise<string | null> {
  const { data, error } = await getAdminClient()
    .from('profiles')
    .select('id')
    .eq('auth_user_id', authUserId)
    .is('deleted_at', null)
    .maybeSingle()
  if (error) throw new Error(`profiles(auth id): ${error.message}`)
  return (data as { id: string } | null)?.id ?? null
}

/**
 * Shu auth user'ga bog'langan profillarning (o'chirilganlar ham) eng oxirgi yangilanganining
 * firmasi. Yo'q bo'lsa null. admin-users: yetim auth user'ni o'chirishdan oldin firma tekshiruvi.
 */
export async function lastProfileCompanyByAuthUserId(authUserId: string): Promise<string | null> {
  const { data, error } = await getAdminClient()
    .from('profiles')
    .select('company_id')
    .eq('auth_user_id', authUserId)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw new Error(`profiles(last company): ${error.message}`)
  return (data as { company_id: string } | null)?.company_id ?? null
}

export async function activeProfileByAuthUserId(authUserId: string): Promise<ProfileRow | null> {
  const { data, error } = await getAdminClient()
    .from('profiles')
    .select(PROFILE_COLS)
    .eq('auth_user_id', authUserId)
    .eq('is_active', true)
    .is('deleted_at', null)
    .maybeSingle()
  if (error) throw new Error(`profiles(auth): ${error.message}`)
  const p = (data as ProfileRow | null) ?? null
  if (p === null) return null
  const active = await activeCompanyIds([p.company_id])
  return active.has(p.company_id) ? p : null
}

/** Telefon bo'yicha bog'lanadigan profillar (faol, o'chirilmagan, telegram bog'lanmagan, firma faol). */
export async function linkableProfilesByPhone(e164: string): Promise<{ id: string; company_id: string }[]> {
  const { data, error } = await getAdminClient()
    .from('profiles')
    .select('id, company_id')
    .eq('phone', e164)
    .eq('is_active', true)
    .is('deleted_at', null)
    .is('telegram_user_id', null)
  if (error) throw new Error(`profiles(phone): ${error.message}`)
  const rows = (data ?? []) as { id: string; company_id: string }[]
  const active = await activeCompanyIds(rows.map((r) => r.company_id))
  return rows.filter((r) => active.has(r.company_id))
}

const UNIQUE_VIOLATION = '23505'

/** auth_user_id va login_kind ni faqat auth_user_id null bo'lsa yozadi. */
export async function linkAuthUser(profileId: string, authUserId: string, kind: LoginKind): Promise<boolean> {
  const { data, error } = await getAdminClient()
    .from('profiles')
    .update({ auth_user_id: authUserId, login_kind: kind })
    .eq('id', profileId)
    .is('auth_user_id', null)
    .is('deleted_at', null)
    .select('id')
  if (error) {
    if (error.code === UNIQUE_VIOLATION) return false
    throw new Error(`profiles(link auth): ${error.message}`)
  }
  return (data ?? []).length === 1
}

export async function setLoginKind(profileId: string, kind: LoginKind): Promise<void> {
  const { error } = await getAdminClient()
    .from('profiles')
    .update({ login_kind: kind })
    .eq('id', profileId)
    .is('deleted_at', null)
  if (error) throw new Error(`profiles(login_kind): ${error.message}`)
}

/**
 * telegram_user_id / chat_id ni faqat telegram_user_id null va profil hali ham shu telefon
 * bilan, faol va o'chirilmagan bo'lsa yozadi (qidiruv va yozish orasida o'zgargan bo'lsa — false).
 */
export async function linkTelegram(
  profileId: string,
  telegramUserId: number,
  chatId: number,
  e164: string,
): Promise<boolean> {
  const { data, error } = await getAdminClient()
    .from('profiles')
    .update({ telegram_user_id: telegramUserId, telegram_chat_id: chatId })
    .eq('id', profileId)
    .eq('phone', e164)
    .eq('is_active', true)
    .is('telegram_user_id', null)
    .is('deleted_at', null)
    .select('id')
  if (error) {
    if (error.code === UNIQUE_VIOLATION) return false
    throw new Error(`profiles(link tg): ${error.message}`)
  }
  return (data ?? []).length === 1
}

/** audit_log ga auth hodisasi (`public.svc_log_auth_event`, faqat service_role). */
export async function logAuthEvent(event: AuthEvent): Promise<void> {
  const { error } = await getAdminClient().rpc('svc_log_auth_event', {
    p_company_id: event.company_id,
    p_actor_profile_id: event.actor_profile_id,
    p_target_profile_id: event.target_profile_id,
    p_action: event.action,
    p_details: event.details,
  })
  if (error) throw new Error(`svc_log_auth_event: ${error.message}`)
}

// ---------------------------------------------------------------------------
// Telegram Bot API
// ---------------------------------------------------------------------------

/**
 * Bot API sendMessage. Token URL'da — shuning uchun tarmoq xatosining asl xabari
 * (unda URL bo'lishi mumkin) hech qachon qayta otilmaydi va loglanmaydi.
 */
export async function telegramSendMessage(
  botToken: string,
  chatId: number,
  text: string,
  replyMarkup?: unknown,
): Promise<void> {
  let res: Response
  try {
    res = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, ...(replyMarkup ? { reply_markup: replyMarkup } : {}) }),
      signal: AbortSignal.timeout(5000),
    })
  } catch (e) {
    const kind = e instanceof Error ? e.name : 'unknown'
    throw new Error(`telegram sendMessage: tarmoq xatosi (${kind})`)
  }
  if (!res.ok) {
    let description = ''
    try {
      description = ((await res.json()) as { description?: string }).description ?? ''
    } catch {
      // e'tiborsiz
    }
    throw new Error(`telegram sendMessage ${res.status} ${description.slice(0, 200)}`)
  }
}

/**
 * Bot API metodini chaqiradi va (status, JSON body) qaytaradi — tasniflash chaqiruvchida
 * (tg-dispatch: `classifyTelegramResponse`). Tarmoq xatosi/timeout → `null`, asl xato
 * (unda token bo'lgan URL bo'lishi mumkin) tashlanmaydi va loglanmaydi.
 */
export async function telegramCall(
  botToken: string,
  method: string,
  payload: Record<string, unknown>,
  timeoutMs = 5000,
): Promise<{ status: number; body: unknown } | { status: null; error: string }> {
  let res: Response
  try {
    res = await fetch(`https://api.telegram.org/bot${botToken}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(timeoutMs),
    })
  } catch (e) {
    const kind = e instanceof Error ? e.name : 'unknown'
    return { status: null, error: `telegram ${method}: tarmoq xatosi (${kind})` }
  }
  let body: unknown = null
  try {
    body = await res.json()
  } catch {
    // e'tiborsiz — status yetarli
  }
  return { status: res.status, body }
}
