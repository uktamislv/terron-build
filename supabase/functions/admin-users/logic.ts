// admin-users — veb login berish / parolni tiklash (docs/auth-design.md, "Admin").
// Sof mantiq: tashqi bog'liqliklar `deps` orqali. Parol hech qachon javobda va logda yo'q.

import { isSyntheticEmail, loginEmailFromPhone } from '../_shared/loginEmail.ts'
import { errMessage, isRecord, isUuid, respond, type HandlerResult, type LogFn } from '../_shared/handler.ts'
import type {
  AuthAdminDeps,
  LoginKind,
  LogAuthEventFn,
  UpdateAuthUserInput,
  UpdateAuthUserResult,
} from '../_shared/authUsers.ts'

export interface CallerProfile {
  id: string
  company_id: string
  role: string
  /** `profiles.login_kind` — `change_password` faqat 'web' akkauntga ruxsat etiladi. */
  login_kind: LoginKind
}

export interface TargetProfile {
  id: string
  company_id: string
  role: string
  phone: string
  auth_user_id: string | null
}

export interface AdminUsersDeps extends AuthAdminDeps {
  /** JWT → auth user id (`auth.getUser(jwt)`). Yaroqsiz bo'lsa null. */
  getAuthUserIdFromJwt: (jwt: string) => Promise<string | null>
  /** Chaqiruvchining faol profili (o'chirilmagan, `is_active`, firma faol). */
  getActiveProfileByAuthUserId: (authUserId: string) => Promise<CallerProfile | null>
  /** Maqsad profil (o'chirilmagan). */
  getProfileById: (profileId: string) => Promise<TargetProfile | null>
  /** Mavjud auth user'ni yangilaydi (`email_confirm: true`). */
  updateAuthUser: (authUserId: string, input: UpdateAuthUserInput) => Promise<UpdateAuthUserResult>
  /** `profiles.auth_user_id = authUserId, login_kind = kind` — faqat hozir auth_user_id null bo'lsa. */
  linkAuthUser: (profileId: string, authUserId: string, kind: LoginKind) => Promise<boolean>
  /**
   * Shu auth user'ga oxirgi marta bog'langan profil firmasi (o'chirilganlar ham, `updated_at` bo'yicha
   * eng oxirgisi). Yo'q bo'lsa null. Yetim auth user'ni o'chirishdan oldin tekshiriladi.
   */
  lastProfileCompanyByAuthUserId: (authUserId: string) => Promise<string | null>
  /**
   * Mavjud login almashtirildi: `svc_alert_login_set(p_target_profile, p_actor)` — `login_ozgardi`
   * alerti va egasiga `login_changed` xabari. Xato tashlasa — faqat log (parol allaqachon o'rnatilgan).
   */
  alertLoginSet: (targetProfileId: string, actorProfileId: string, firstLogin: boolean) => Promise<void>
  /** `profiles.login_kind` ni yozadi (auth_user_id bor profil). */
  setLoginKind: (profileId: string, kind: LoginKind) => Promise<void>
  /**
   * Audit 3 (E2): `svc_phone_in_other_company(p_company_id, p_phone)` — shu telefon BOSHQA firmaning
   * o'chirilmagan profilida bormi (telefon login emaili global — to'qnashuv).
   */
  phoneInOtherCompany: (companyId: string, phone: string) => Promise<boolean>
  logAuthEvent: LogAuthEventFn
  log: LogFn
}

/**
 * Faqat tizim egasi (super_admin) yaratadigan / beradigan rollar (DB: `profile_protected`).
 * admin-users faqat login beradi (profil yaratmaydi, rol o'zgartirmaydi) — service_role bilan
 * yozganda trigger ushlamaydi, shuning uchun login berishdagi cheklovlar shu yerda tekshiriladi.
 */
export const PROTECTED_ROLES: readonly string[] = ['admin', 'direktor']

export const MIN_PASSWORD_LEN = 8
/** bcrypt 72 baytdan keyingisini e'tiborsiz qoldiradi — ortig'ini rad etamiz. */
export const MAX_PASSWORD_LEN = 72

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function bearer(authHeader: string | null): string | null {
  if (typeof authHeader !== 'string') return null
  const m = /^Bearer\s+(\S+)$/i.exec(authHeader.trim())
  return m ? (m[1] as string) : null
}

const err = (status: number, error: string): HandlerResult => respond(status, { error })

/** Ichki xato: javobda `internal`, logda sabab. */
class AdminUsersError extends Error {}

/** Parol tekshiruvi: xato kodi yoki null (yaroqli). */
function passwordError(password: unknown): HandlerResult | null {
  if (typeof password !== 'string') return err(400, 'invalid_request')
  if (password.length < MIN_PASSWORD_LEN) return err(400, 'weak_password')
  if (new TextEncoder().encode(password).length > MAX_PASSWORD_LEN) return err(400, 'password_too_long')
  return null
}

/**
 * Amallar:
 *  - `set_login` — admin xodimga login (email / telefon) va vaqtinchalik parol beradi;
 *    `app_metadata.must_change_password = true`.
 *  - `change_password` — foydalanuvchi O'Z parolini almashtiradi (audit 3, E3): parol server
 *    tomonidan o'rnatiladi va shu bilan birga belgi olib tashlanadi. Belgi `app_metadata` da —
 *    foydalanuvchi uni `auth.updateUser` bilan o'zi o'chira olmaydi.
 */
export async function handleAdminUsers(
  authHeader: string | null,
  body: unknown,
  deps: AdminUsersDeps,
): Promise<HandlerResult> {
  if (isRecord(body) && body.action === 'change_password') return handleChangePassword(authHeader, body, deps)
  return handleSetLogin(authHeader, body, deps)
}

async function handleChangePassword(
  authHeader: string | null,
  body: Record<string, unknown>,
  deps: AdminUsersDeps,
): Promise<HandlerResult> {
  const password = body.password
  const bad = passwordError(password)
  if (bad !== null) return bad
  const jwt = bearer(authHeader)
  if (jwt === null) return err(401, 'unauthorized')
  try {
    const authUserId = await deps.getAuthUserIdFromJwt(jwt)
    if (authUserId === null) return err(401, 'unauthorized')
    const me = await deps.getActiveProfileByAuthUserId(authUserId)
    if (me === null) return err(403, 'forbidden')
    // Audit 3 tekshiruvi (1): faqat veb login (admin `set_login` bergan). Telegram sintetik akkaunti
    // (`login_kind = 'tg'`) o'ziga parol qo'ysa — initData/HMAC va admin nazoratini chetlab veb'ga
    // email+parol bilan kirar edi (o'g'irlangan 1 soatlik tg JWT doimiy parolga aylanardi).
    if (me.login_kind !== 'web') {
      deps.log('warn', 'admin-users: change_password — veb login emas, rad etildi', { profile_id: me.id })
      return err(403, 'forbidden')
    }
    const res = await deps.updateAuthUser(authUserId, {
      password: password as string,
      appMetadata: { must_change_password: false },
      // Eski akkauntlar (belgi user_metadata da edi) — u ham tozalanadi
      userMetadata: { must_change_password: false },
    })
    if (!res.ok) {
      if (res.reason === 'weak_password') return weak(deps, me.id)
      throw new AdminUsersError(`updateAuthUser: ${res.reason}`)
    }
    deps.log('info', 'admin-users: change_password', { profile_id: me.id })
    return respond(200, { ok: true })
  } catch (e) {
    deps.log('error', 'admin-users: ichki xato (change_password)', { error: errMessage(e) })
    return err(500, 'internal')
  }
}

async function handleSetLogin(
  authHeader: string | null,
  body: unknown,
  deps: AdminUsersDeps,
): Promise<HandlerResult> {
  // 1. Kirish validatsiyasi
  if (!isRecord(body)) return err(400, 'invalid_request')
  if (body.action !== 'set_login') return err(400, 'invalid_request')
  if (!isUuid(body.profile_id)) return err(400, 'invalid_request')
  const profileId = body.profile_id.toLowerCase()

  const password = body.password
  const bad = passwordError(password)
  if (bad !== null) return bad
  if (typeof password !== 'string') return err(400, 'invalid_request')

  let email: string | null = null
  if (body.email !== undefined && body.email !== null) {
    if (typeof body.email !== 'string') return err(400, 'invalid_request')
    const e = body.email.trim().toLowerCase()
    if (e !== '') {
      if (e.length > 254 || !EMAIL_RE.test(e)) return err(400, 'email_invalid')
      // Sintetik domenlar faqat tizim uchun — admin ularni qo'lda bera olmaydi.
      if (isSyntheticEmail(e)) return err(400, 'email_reserved')
      email = e
    }
  }

  // 2. Chaqiruvchi
  const jwt = bearer(authHeader)
  if (jwt === null) return err(401, 'unauthorized')

  try {
    const callerAuthId = await deps.getAuthUserIdFromJwt(jwt)
    if (callerAuthId === null) return err(401, 'unauthorized')
    const caller = await deps.getActiveProfileByAuthUserId(callerAuthId)
    if (caller === null || (caller.role !== 'admin' && caller.role !== 'super_admin')) {
      return err(403, 'forbidden')
    }

    // 3. Maqsad va huquq
    const target = await deps.getProfileById(profileId)
    if (target === null) return err(404, 'not_found')
    if (caller.role !== 'super_admin') {
      if (target.company_id !== caller.company_id) return err(403, 'forbidden')
      // admin boshqa admin / super_admin ning loginiga tegmaydi (o'zinikiga — mumkin)
      if ((target.role === 'admin' || target.role === 'super_admin') && target.id !== caller.id) {
        return err(403, 'forbidden')
      }
      // Login bor direktor: admin parol o'rnata olmaydi (akkauntni egallash xavfi) — faqat tizim egasi.
      if (target.role === 'direktor' && target.auth_user_id !== null) {
        deps.log('warn', 'admin-users: direktor loginini almashtirish rad etildi', { profile_id: target.id, by: caller.id })
        return err(403, 'forbidden_target')
      }
    }
    /** Maqsadda login bor edi — parol almashtiriladi (UI ogohlantiradi; DB maqsadga alert yozadi). */
    const existingLoginReplaced = target.auth_user_id !== null
    /**
     * 2-tur S7: admin (tizim egasi emas) himoyalangan rol (direktor / admin) profiliga BIRINCHI loginni
     * bersa — direktor va adminlarga `login_ozgardi` (first_login) alerti.
     */
    const protectedFirstLogin =
      caller.role !== 'super_admin' && target.auth_user_id === null && PROTECTED_ROLES.includes(target.role)

    const loginEmail = email ?? loginEmailFromPhone(target.phone)
    const login = email ?? target.phone
    const isSuper = caller.role === 'super_admin'

    // Audit 3 (E2): telefon login emaili global. Shu telefon boshqa firmada ham bo'lsa — rad
    // (umumiy 'conflict', boshqa firma haqida ma'lumot berilmaydi). Tizim egasi — istisno.
    if (email === null && !isSuper && (await deps.phoneInOtherCompany(target.company_id, target.phone))) {
      deps.log('warn', 'admin-users: telefon boshqa firmada ham bor — login berilmadi', { profile_id: target.id, by: caller.id })
      return err(409, 'conflict')
    }

    // Audit 3 (E3): belgi app_metadata da (foydalanuvchi o'zgartira olmaydi). GoTrue app_metadata ni
    // birlashtiradi — kind / company_id saqlanadi.
    const appFlag = { must_change_password: true }

    // 4. Auth user yaratish yoki yangilash
    let created: boolean
    if (target.auth_user_id !== null) {
      const authUserId = target.auth_user_id
      const update = () => deps.updateAuthUser(authUserId, { email: loginEmail, password, appMetadata: appFlag })
      let res = await update()
      if (!res.ok && res.reason === 'email_exists') {
        const freed = await freeEmail(deps, loginEmail, authUserId, target.company_id, isSuper)
        if (freed !== 'freed') return err(409, freed)
        res = await update()
      }
      if (!res.ok) {
        if (res.reason === 'weak_password') return weak(deps, target.id)
        if (res.reason === 'email_exists') return err(409, 'conflict')
        throw new AdminUsersError('profildagi auth user topilmadi')
      }
      await deps.setLoginKind(target.id, 'web')
      created = false
    } else {
      const create = () =>
        deps.createAuthUser({
          email: loginEmail,
          password,
          appMetadata: { kind: 'web', company_id: target.company_id, ...appFlag },
        })
      let res = await create()
      if (!res.ok && res.reason === 'email_exists') {
        const freed = await freeEmail(deps, loginEmail, null, target.company_id, isSuper)
        if (freed !== 'freed') return err(409, freed)
        res = await create()
      }
      if (!res.ok) {
        if (res.reason === 'weak_password') return weak(deps, target.id)
        return err(409, 'conflict')
      }
      const linked = await deps.linkAuthUser(target.id, res.id, 'web')
      if (!linked) {
        await deps.deleteAuthUser(res.id) // yetim qolmasin
        deps.log('warn', 'admin-users: auth user bog\'lanmadi (poyga), o\'chirildi', { profile_id: target.id })
        return err(409, 'conflict')
      }
      created = true
    }

    try {
      await deps.logAuthEvent({
        company_id: target.company_id,
        actor_profile_id: caller.id,
        target_profile_id: target.id,
        action: 'SET_LOGIN',
        details: { login, login_type: email === null ? 'phone' : 'email', created, existing_login_replaced: existingLoginReplaced },
      })
    } catch (e) {
      deps.log('error', 'admin-users: audit yozilmadi', { error: errMessage(e), profile_id: target.id })
    }
    if (existingLoginReplaced || protectedFirstLogin) {
      try {
        await deps.alertLoginSet(target.id, caller.id, !existingLoginReplaced)
      } catch (e) {
        deps.log('error', 'admin-users: login_ozgardi alerti yozilmadi', { error: errMessage(e), profile_id: target.id })
      }
    }
    deps.log('info', 'admin-users: set_login', { profile_id: target.id, by: caller.id, created })
    return respond(200, { ok: true, login, login_kind: 'web', existing_login_replaced: existingLoginReplaced })
  } catch (e) {
    deps.log('error', 'admin-users: ichki xato', { error: errMessage(e) })
    return err(500, 'internal')
  }
}

function weak(deps: AdminUsersDeps, profileId: string): HandlerResult {
  deps.log('warn', 'admin-users: GoTrue parolni rad etdi (weak_password)', { profile_id: profileId })
  return err(400, 'weak_password')
}

/**
 * Email band: egasini topadi. Faqat quyidagi yetim auth user o'chiriladi ('freed'):
 *  - hech bir o'chirilmagan profilga bog'lanmagan;
 *  - `app_metadata.kind = 'web'` (tg sintetik yoki begona akkaunt emas);
 *  - firmasi shu firma: `app_metadata.company_id` yoki oxirgi bog'langan profil firmasi.
 * Shu firma profilida band — 'login_taken' (409). Boshqa firma / noma'lum akkaunt — o'chirilmaydi va
 * umumiy 'conflict' (audit 3, E2: boshqa firmada login borligi oshkor qilinmaydi; tizim egasiga —
 * 'login_taken').
 */
async function freeEmail(
  deps: AdminUsersDeps,
  email: string,
  selfAuthUserId: string | null,
  companyId: string,
  isSuper: boolean,
): Promise<'freed' | 'login_taken' | 'conflict'> {
  const owner = await deps.findAuthUserByEmail(email)
  if (owner === null) return 'freed' // poyga: allaqachon bo'shagan — qayta urinib ko'ramiz
  if (owner.id === selfAuthUserId) return 'conflict'
  const taken = isSuper ? 'login_taken' : 'conflict'
  const linkedProfile = await deps.findProfileIdByAuthUserId(owner.id)
  if (linkedProfile !== null) {
    const linked = await deps.getProfileById(linkedProfile)
    if (linked !== null && linked.company_id === companyId) return 'login_taken'
    deps.log('warn', 'admin-users: login boshqa firma profilida band', { auth_user_id: owner.id })
    return taken
  }
  if (owner.app_metadata.kind !== 'web') {
    deps.log('warn', "admin-users: yetim auth user web emas — o'chirilmadi", { auth_user_id: owner.id })
    return taken
  }
  const metaCompany = typeof owner.app_metadata.company_id === 'string' ? owner.app_metadata.company_id : null
  const ownCompany = metaCompany === companyId || (await deps.lastProfileCompanyByAuthUserId(owner.id)) === companyId
  if (!ownCompany) {
    deps.log('warn', "admin-users: yetim auth user boshqa / noma'lum firmaniki — o'chirilmadi", { auth_user_id: owner.id })
    return taken
  }
  await deps.deleteAuthUser(owner.id)
  deps.log('warn', 'admin-users: yetim auth user o\'chirildi', { auth_user_id: owner.id })
  return 'freed'
}
