import type { Session } from '@supabase/supabase-js'
import { loginEmailFromPhone } from '@shared/loginEmail'
import { looksLikePhone, normalizePhone } from '@shared/phone'
import { RepoError, toRepoError } from './errors'
import { invokeFunction } from './functions'
import { PROFILE_COLUMNS } from './profilesRepo'
import { getSupabase, isSupabaseConfigured } from './supabaseClient'
import type { AuthSession, Profile } from './types'

export type SignInError = 'not_configured' | 'invalid_login' | 'invalid_credentials' | 'network' | 'unknown'
export type SignInResult = { ok: true } | { ok: false; error: SignInError }

/**
 * `reopen` — initData eskirgan yoki takroriy (`invalid_init_data`, `init_data_replayed`): ilovani yopib,
 * qayta ochish kerak. `web_only` — rol Mini App uchun emas (`role_web_only`, masalan super_admin).
 */
export type TelegramSignInStatus = 'ok' | 'need_contact' | 'inactive' | 'invalid' | 'reopen' | 'web_only'

export const MIN_PASSWORD_LENGTH = 10

function toAuthSession(session: Session | null): AuthSession | null {
  if (!session) return null
  const meta = (session.user.user_metadata ?? {}) as { must_change_password?: unknown }
  return {
    userId: session.user.id,
    email: session.user.email ?? null,
    mustChangePassword: meta.must_change_password === true,
  }
}

/**
 * Kiritilgan login (email yoki telefon) → Supabase Auth email.
 * Telefon bo'lsa: normalizePhone → loginEmailFromPhone (sintetik email). Noto'g'ri bo'lsa null.
 */
export function resolveLoginEmail(login: string): string | null {
  const value = login.trim()
  if (!value) return null
  if (looksLikePhone(value)) {
    const phone = normalizePhone(value)
    return phone ? loginEmailFromPhone(phone) : null
  }
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) ? value.toLowerCase() : null
}

export async function signInWithPassword(login: string, password: string): Promise<SignInResult> {
  if (!isSupabaseConfigured()) return { ok: false, error: 'not_configured' }
  const email = resolveLoginEmail(login)
  if (!email) return { ok: false, error: 'invalid_login' }
  try {
    const { error } = await getSupabase().auth.signInWithPassword({ email, password })
    if (!error) return { ok: true }
    if (error.status === 400 || error.code === 'invalid_credentials') {
      return { ok: false, error: 'invalid_credentials' }
    }
    if (!error.status) return { ok: false, error: 'network' }
    return { ok: false, error: 'unknown' }
  } catch {
    return { ok: false, error: 'network' }
  }
}

export async function signOut(): Promise<void> {
  if (!isSupabaseConfigured()) return
  await getSupabase().auth.signOut()
}

/** Faqat shu qurilmadagi sessiyani tozalaydi (serverga murojaatsiz, boshqa qurilmalar tegilmaydi). */
export async function clearLocalSession(): Promise<void> {
  if (!isSupabaseConfigured()) return
  await getSupabase().auth.signOut({ scope: 'local' })
}

export async function getSession(): Promise<AuthSession | null> {
  if (!isSupabaseConfigured()) return null
  const { data } = await getSupabase().auth.getSession()
  return toAuthSession(data.session)
}

/** Sessiya o'zgarishiga obuna. Qaytgan funksiya obunani bekor qiladi. */
export function onAuthChange(cb: (session: AuthSession | null) => void): () => void {
  if (!isSupabaseConfigured()) return () => undefined
  const { data } = getSupabase().auth.onAuthStateChange((_event, session) => {
    // Callback ichida boshqa supabase chaqiruvlari qilinmaydi (supabase-js qulflanishi)
    cb(toAuthSession(session))
  })
  return () => data.subscription.unsubscribe()
}

/** Parolni o'zgartiradi va "majburiy o'zgartirish" belgisini olib tashlaydi. */
export async function changePassword(password: string): Promise<void> {
  if (password.length < MIN_PASSWORD_LENGTH) throw new RepoError('weak_password')
  const { error } = await getSupabase().auth.updateUser({
    password,
    data: { must_change_password: false },
  })
  if (error) throw toRepoError(error)
}

/**
 * Mini App kirishi: xom initData `tg-auth` Edge Function'da HMAC bilan tekshiriladi.
 * Mavjud sessiya bo'lsa uning access token'i ham yuboriladi; server `session: null` qaytarsa
 * mavjud sessiya saqlanadi. Tarmoq xatosida RepoError('network').
 */
export async function telegramSignIn(initData: string): Promise<TelegramSignInStatus> {
  if (!isSupabaseConfigured()) throw new RepoError('not_configured')
  if (!initData) return 'invalid'
  const supabase = getSupabase()
  const { data: current } = await supabase.auth.getSession()
  const accessToken = current.session?.access_token
  const result = await invokeFunction<
    | {
        status: 'ok'
        session: { access_token: string; refresh_token: string; expires_at: number } | null
      }
    | { status: 'need_contact' }
  >('tg-auth', accessToken ? { initData, access_token: accessToken } : { initData })

  if (!result.ok) {
    if (result.network) throw new RepoError('network')
    const code = result.body?.error
    if (code === 'role_web_only') return 'web_only'
    if (code === 'invalid_init_data' || code === 'init_data_replayed') return 'reopen'
    if (result.status === 403) return 'inactive'
    if (result.status === 401) return 'invalid'
    throw new RepoError('unknown', result.body?.error)
  }
  if (result.data.status === 'need_contact') return 'need_contact'
  if (result.data.status !== 'ok') throw new RepoError('unknown')

  // session === null — server mavjud sessiyani tasdiqladi, uni saqlaymiz
  if (result.data.session) {
    const { access_token, refresh_token } = result.data.session
    const { error } = await supabase.auth.setSession({ access_token, refresh_token })
    if (error) throw toRepoError(error)
  }
  return 'ok'
}

/**
 * Joriy foydalanuvchining faol profili (RLS orqali). Profil nofaol, o'chirilgan yoki firma
 * nofaol bo'lsa RLS hech narsa ko'rsatmaydi — null qaytadi.
 * Tarmoq yoki server xatosida RepoError tashlanadi — bu "profil yo'q" degani emas.
 */
export async function getMyProfile(): Promise<Profile | null> {
  const supabase = getSupabase()
  // Lokal sessiyadan (tarmoqsiz) — getUser tarmoq xatosini "foydalanuvchi yo'q" ga aylantirib yuborardi
  const { data: sessionData, error: sessionError } = await supabase.auth.getSession()
  if (sessionError) throw toRepoError(sessionError)
  const userId = sessionData.session?.user.id
  if (!userId) return null
  const { data, error } = await supabase
    .from('profiles')
    .select(PROFILE_COLUMNS)
    .eq('auth_user_id', userId)
    .is('deleted_at', null)
    .eq('is_active', true)
    .maybeSingle()
  if (error) throw toRepoError(error)
  return (data as Profile | null) ?? null
}
