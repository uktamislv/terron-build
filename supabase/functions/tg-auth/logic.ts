// tg-auth — Mini App kirishi (docs/auth-design.md, "Telegram Mini App kirish" 1–2).
// Sof mantiq: barcha tashqi bog'liqliklar `deps` orqali keladi (index.ts — Deno realizatsiyasi,
// logic.test.ts — soxta). Node va Deno'da ishlaydi.

import { verifyInitData } from '../_shared/telegramAuth.ts'
import { telegramAuthEmail } from '../_shared/loginEmail.ts'
import {
  errMessage,
  isRecord,
  randomPassword,
  respond,
  type HandlerResult,
  type LogFn,
} from '../_shared/handler.ts'
import type { AuthAdminDeps, LoginKind, LogAuthEventFn } from '../_shared/authUsers.ts'

/** `telegram_user_id` bo'yicha topilgan o'chirilmagan profil (firma holati bilan). */
export interface TgProfile {
  id: string
  company_id: string
  role: string
  full_name: string
  auth_user_id: string | null
  is_active: boolean
  /** Firma `is_active` va o'chirilmagan. */
  company_active: boolean
}

export interface TgSession {
  access_token: string
  refresh_token: string
  expires_at: number
}

export interface TgAuthDeps extends AuthAdminDeps {
  env: { botToken: string | undefined; maxAgeSec?: number }
  /** Joriy vaqt, ms. */
  now: () => number
  /** O'chirilmagan profil (`deleted_at is null`), `telegram_user_id = id`. Yo'q bo'lsa null. */
  findProfileByTelegramId: (telegramUserId: number) => Promise<TgProfile | null>
  /** auth.users dagi email. Foydalanuvchi yo'q bo'lsa null. */
  getAuthUserEmail: (authUserId: string) => Promise<string | null>
  /** JWT (access_token) → auth user id (`auth.getUser`). Yaroqsiz bo'lsa null. */
  getAuthUserIdFromJwt: (jwt: string) => Promise<string | null>
  /** `profiles.auth_user_id = authUserId, login_kind = kind` — faqat hozir auth_user_id null bo'lsa. */
  linkAuthUser: (profileId: string, authUserId: string, kind: LoginKind) => Promise<boolean>
  /** magiclink → hashed_token → verifyOtp → sessiya. Xat yuborilmaydi. */
  createSession: (email: string) => Promise<TgSession>
  /** initData takroriy ishlatilishidan himoya (index.ts — izolyat bo'yicha bitta nusxa). */
  replayGuard?: InitDataReplayGuard
  /**
   * Muvaffaqiyatli kirish — `svc_touch_chat(p_chat_id)` (shaxsiy chat id = Telegram user id).
   * Xato — faqat log.
   */
  touchChat?: (chatId: number) => Promise<void>
  logAuthEvent: LogAuthEventFn
  log: LogFn
}

/**
 * Amaldagi sessiyani tasdiqlash (qayta yuklash) uchun initData imzosi qabul qilinadigan eng katta yosh.
 * Yangi sessiya berilmaydi — faqat `access_token` egasi profilga mos ekani tasdiqlanadi.
 */
export const TG_AUTH_RELOAD_MAX_AGE_SEC = 86_400
/** YANGI sessiya uchun initData 15 daqiqadan eski bo'lmasin (audit: 1 soat → 15 daqiqa). */
export const TG_AUTH_MAX_AGE_SEC = 900
/**
 * Bir xil initData (hash) bilan qayta YANGI sessiya so'rash — shu oraliqdan keyin rad etiladi.
 * Oraliq Mini App ochilishidagi parallel / takroriy chaqiruvlar (React StrictMode, qayta urinish) uchun.
 */
export const REPLAY_GRACE_MS = 10_000
/** Telegram'da faqat veb orqali kiradigan rollar (Mini App sessiyasi berilmaydi). */
export const WEB_ONLY_ROLES: readonly string[] = ['super_admin']

/**
 * initData qayta ishlatilishidan himoya (har izolyat xotirasida, LRU). Kalit — initData `hash`,
 * muddat — `auth_date + maxAge`. CHEKLOV: Edge Function'ning har izolyati (instance) o'z xotirasiga
 * ega va qayta ishga tushganda tozalanadi — boshqa izolyatga tushgan takroriy so'rovni ushlamaydi.
 * Asosiy himoya — 15 daqiqalik muddat va HTTPS; bu qo'shimcha to'siq.
 */
export class InitDataReplayGuard {
  private readonly seen = new Map<string, { firstSeenMs: number; expiresAtMs: number }>()
  constructor(private readonly maxEntries = 10_000) {}

  /**
   * `true` — ishlatish mumkin (yangi yoki grace oralig'ida takror); `false` — qayta ishlatish.
   * @param key initData `hash`
   */
  use(key: string, nowMs: number, expiresAtMs: number, graceMs = REPLAY_GRACE_MS): boolean {
    const prev = this.seen.get(key)
    if (prev !== undefined && prev.expiresAtMs > nowMs) return nowMs - prev.firstSeenMs <= graceMs
    this.seen.delete(key)
    this.seen.set(key, { firstSeenMs: nowMs, expiresAtMs })
    this.evict(nowMs)
    return true
  }

  get size(): number {
    return this.seen.size
  }

  private evict(nowMs: number): void {
    if (this.seen.size <= this.maxEntries) return
    for (const [k, v] of this.seen) {
      if (v.expiresAtMs <= nowMs) this.seen.delete(k)
    }
    // Hali ham ko'p — eng eskilari (Map qo'shilish tartibi)
    for (const k of this.seen.keys()) {
      if (this.seen.size <= this.maxEntries) break
      this.seen.delete(k)
    }
  }
}

/** initData dagi `hash` (kichik harf); yo'q bo'lsa null. */
function initDataHash(initData: string): string | null {
  try {
    const h = new URLSearchParams(initData).get('hash')
    return h ? h.toLowerCase() : null
  } catch {
    return null
  }
}
const MAX_INIT_DATA_LEN = 8192
const MAX_TOKEN_LEN = 8192

/** Tushunarli log uchun ichki xato (javobda faqat `internal`). */
class TgAuthError extends Error {}

export async function handleTgAuth(body: unknown, deps: TgAuthDeps): Promise<HandlerResult> {
  if (!isRecord(body) || typeof body.initData !== 'string') {
    return respond(400, { error: 'bad_request' })
  }
  const initData = body.initData
  if (initData.length === 0 || initData.length > MAX_INIT_DATA_LEN) {
    return respond(400, { error: 'bad_request' })
  }
  let accessToken: string | null = null
  if (body.access_token !== undefined && body.access_token !== null) {
    if (typeof body.access_token !== 'string' || body.access_token.length > MAX_TOKEN_LEN) {
      return respond(400, { error: 'bad_request' })
    }
    accessToken = body.access_token === '' ? null : body.access_token
  }

  const botToken = deps.env.botToken
  if (typeof botToken !== 'string' || botToken === '') {
    deps.log('error', 'tg-auth: TELEGRAM_BOT_TOKEN sozlanmagan')
    return respond(500, { error: 'server_misconfigured' })
  }

  // Yangi sessiya uchun muddat (15 daqiqa); imzo tekshiruvi esa uzunroq (24 soat) — Mini App qayta
  // yuklanganda (initData o'sha, sessiya amaldagi) foydalanuvchi chiqarib yuborilmasin.
  const maxAgeSec = deps.env.maxAgeSec ?? TG_AUTH_MAX_AGE_SEC
  const nowSec = Math.floor(deps.now() / 1000)
  const verified = await verifyInitData(initData, botToken, {
    nowSec,
    maxAgeSec: Math.max(maxAgeSec, TG_AUTH_RELOAD_MAX_AGE_SEC),
  })
  if (!verified.ok) {
    deps.log('warn', 'tg-auth: initData rad etildi', { reason: verified.reason })
    return respond(401, { error: 'invalid_init_data' })
  }
  const tgUserId = verified.user.id
  /** initData yangi sessiya berish uchun yetarlicha yangimi (15 daqiqa). */
  const freshForNewSession = nowSec - verified.authDate <= maxAgeSec

  try {
    let profile = await deps.findProfileByTelegramId(tgUserId)
    if (profile === null) return respond(200, { status: 'need_contact' })
    if (!profile.is_active || !profile.company_active) {
      return respond(403, { error: 'inactive' })
    }
    if (WEB_ONLY_ROLES.includes(profile.role)) {
      deps.log('warn', 'tg-auth: rol faqat veb orqali kiradi', { profile_id: profile.id, role: profile.role })
      return respond(403, { error: 'role_web_only' })
    }

    // Klientda shu akkauntning amaldagi sessiyasi bo'lsa — yangisi yaratilmaydi.
    if (accessToken !== null && profile.auth_user_id !== null) {
      const uid = await deps.getAuthUserIdFromJwt(accessToken)
      if (uid !== null && uid === profile.auth_user_id) {
        await touchChat(deps, tgUserId)
        return respond(200, { status: 'ok', session: null, profile: publicProfile(profile) })
      }
    }

    // Yangi sessiya — faqat yangi initData bilan (eski initData — faqat amaldagi sessiyani tasdiqlash uchun).
    if (!freshForNewSession) {
      deps.log('warn', 'tg-auth: initData yangi sessiya uchun eski', { telegram_user_id: tgUserId })
      return respond(401, { error: 'invalid_init_data' })
    }

    // Yangi sessiya: shu initData bilan avval sessiya berilgan bo'lsa (grace'dan keyin) — rad.
    const hash = initDataHash(initData)
    if (deps.replayGuard !== undefined && hash !== null) {
      const nowMs = deps.now()
      const expiresAtMs = (verified.authDate + maxAgeSec) * 1000
      if (!deps.replayGuard.use(hash, nowMs, expiresAtMs)) {
        deps.log('warn', 'tg-auth: initData qayta ishlatildi', { telegram_user_id: tgUserId })
        return respond(401, { error: 'init_data_replayed' })
      }
    }

    // Auth akkaunt: profilda bor bo'lsa (masalan veb login) — o'sha; aks holda tg sintetik.
    let email: string
    if (profile.auth_user_id !== null) {
      email = await requireEmail(deps, profile.auth_user_id)
    } else {
      const ensured = await ensureTgAuthUser(deps, tgUserId, profile.id)
      email = ensured.email
      if (ensured.alreadyLinkedHere) {
        // Parallel so'rov shu profilga bog'lab ulgurgan — tayyor.
      } else {
        const linked = await deps.linkAuthUser(profile.id, ensured.id, 'tg')
        if (linked) {
          deps.log('info', 'tg-auth: auth user bog\'landi', { profile_id: profile.id })
          await safeAudit(deps, {
            company_id: profile.company_id,
            actor_profile_id: profile.id,
            target_profile_id: profile.id,
            action: 'TG_AUTH_USER_CREATED',
            details: { telegram_user_id: tgUserId, auth_user_id: ensured.id },
          })
        } else {
          // Poyga: boshqa so'rov bog'lab ulgurgan bo'lishi mumkin — qayta o'qiymiz.
          profile = await deps.findProfileByTelegramId(tgUserId)
          if (profile === null || !profile.is_active || !profile.company_active || profile.auth_user_id === null) {
            await deps.deleteAuthUser(ensured.id)
            throw new TgAuthError('auth user bog\'lanmadi')
          }
          if (profile.auth_user_id !== ensured.id) {
            await deps.deleteAuthUser(ensured.id) // o'zimiz yaratgan yetim
            email = await requireEmail(deps, profile.auth_user_id)
          }
        }
      }
    }

    const session = await deps.createSession(email)
    await touchChat(deps, tgUserId)
    return respond(200, {
      status: 'ok',
      session: {
        access_token: session.access_token,
        refresh_token: session.refresh_token,
        expires_at: session.expires_at,
      },
      profile: publicProfile(profile),
    })
  } catch (e) {
    deps.log('error', 'tg-auth: ichki xato', { error: errMessage(e), telegram_user_id: tgUserId })
    return respond(500, { error: 'internal' })
  }
}

function publicProfile(p: TgProfile) {
  return { id: p.id, role: p.role, company_id: p.company_id, full_name: p.full_name }
}

async function requireEmail(deps: TgAuthDeps, authUserId: string): Promise<string> {
  const email = await deps.getAuthUserEmail(authUserId)
  if (email === null) throw new TgAuthError('profildagi auth user topilmadi')
  return email
}

async function safeAudit(deps: TgAuthDeps, event: Parameters<LogAuthEventFn>[0]): Promise<void> {
  try {
    await deps.logAuthEvent(event)
  } catch (e) {
    deps.log('error', 'tg-auth: audit yozilmadi', { error: errMessage(e), action: event.action })
  }
}

/**
 * `tg<T>@tg.terron-build.invalid` auth user'ini yaratadi (`app_metadata: {tg_user_id: T, kind: 'tg'}`).
 * Email band bo'lsa — mavjud user'ga parol almashtirib QAYTA ISHLATILMAYDI (akkaunt egallash xavfi):
 *  - shu profilga bog'langan → o'shani ishlatamiz (poyga);
 *  - boshqa o'chirilmagan profilga bog'langan → xato;
 *  - hech kimga bog'lanmagan va `app_metadata.tg_user_id === T` (o'zimiz yaratgan yetim) →
 *    o'chirib (eski sessiyalari ham o'ladi) qayta yaratamiz;
 *  - aks holda (begona yaratgan) → xato.
 */
async function ensureTgAuthUser(
  deps: TgAuthDeps,
  tgUserId: number,
  profileId: string,
): Promise<{ id: string; email: string; alreadyLinkedHere: boolean }> {
  const email = telegramAuthEmail(tgUserId)
  const appMetadata = { tg_user_id: tgUserId, kind: 'tg' }
  const create = () => deps.createAuthUser({ email, password: randomPassword(), appMetadata })

  const first = await create()
  if (first.ok) return { id: first.id, email, alreadyLinkedHere: false }
  if (first.reason === 'weak_password') throw new TgAuthError('createUser: weak_password (parol siyosati)')

  const existing = await deps.findAuthUserByEmail(email)
  if (existing === null) throw new TgAuthError('email band, lekin auth user topilmadi')
  const linkedProfile = await deps.findProfileIdByAuthUserId(existing.id)
  if (linkedProfile === profileId) return { id: existing.id, email, alreadyLinkedHere: true }
  if (linkedProfile !== null) throw new TgAuthError('tg auth user boshqa profilga bog\'langan')
  if (existing.app_metadata.tg_user_id !== tgUserId) {
    throw new TgAuthError('tg email band: app_metadata.tg_user_id mos emas (begona akkaunt)')
  }

  await deps.deleteAuthUser(existing.id)
  deps.log('warn', 'tg-auth: yetim tg auth user o\'chirildi va qayta yaratiladi', { telegram_user_id: tgUserId })
  const second = await create()
  if (!second.ok) throw new TgAuthError(`qayta yaratib bo'lmadi: ${second.reason}`)
  return { id: second.id, email, alreadyLinkedHere: false }
}

/** `svc_touch_chat` — xato bo'lsa faqat log (kirish buzilmaydi). */
async function touchChat(deps: TgAuthDeps, chatId: number): Promise<void> {
  if (deps.touchChat === undefined) return
  try {
    await deps.touchChat(chatId)
  } catch (e) {
    deps.log('warn', 'tg-auth: svc_touch_chat xatosi', { error: errMessage(e), telegram_user_id: chatId })
  }
}
