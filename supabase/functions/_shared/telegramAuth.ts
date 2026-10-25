// Telegram Mini App `initData` tekshiruvi va webhook sirini solishtirish.
// Sof TS: faqat WebCrypto (`crypto.subtle`) va `TextEncoder` — Deno, Node va brauzerda bir xil.
// Algoritm: https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
// va docs/auth-design.md ("initData tekshiruvi").

export interface TelegramUser {
  id: number
  first_name?: string
  last_name?: string
  username?: string
  language_code?: string
  is_premium?: boolean
  photo_url?: string
}

export type VerifyInitDataResult =
  | { ok: true; user: TelegramUser; authDate: number; fields: Record<string, string> }
  | { ok: false; reason: 'malformed' | 'missing_hash' | 'bad_hash' | 'expired' | 'future' | 'no_user' }

export const DEFAULT_MAX_AGE_SEC = 86400
export const DEFAULT_FUTURE_TOLERANCE_SEC = 300

const encoder = new TextEncoder()

async function hmacSha256(key: Uint8Array, message: string): Promise<Uint8Array> {
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    key as Uint8Array<ArrayBuffer>,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const sig = await crypto.subtle.sign('HMAC', cryptoKey, encoder.encode(message))
  return new Uint8Array(sig)
}

function toHex(bytes: Uint8Array): string {
  let out = ''
  for (const b of bytes) out += b.toString(16).padStart(2, '0')
  return out
}

/** `secret_key = HMAC_SHA256(key = "WebAppData", message = bot_token)`. */
export async function webAppSecretKey(botToken: string): Promise<Uint8Array> {
  return hmacSha256(encoder.encode('WebAppData'), botToken)
}

/** `data_check_string`: kalitlar alifbo tartibida, `key=value`, `\n` bilan. */
export function buildDataCheckString(fields: Record<string, string>, exclude: readonly string[]): string {
  return Object.keys(fields)
    .filter((k) => !exclude.includes(k))
    .sort()
    .map((k) => `${k}=${fields[k]}`)
    .join('\n')
}

/** `hex(HMAC_SHA256(key = secret_key, message = data_check_string))`. */
export async function computeInitDataHash(dataCheckString: string, botToken: string): Promise<string> {
  const secret = await webAppSecretKey(botToken)
  return toHex(await hmacSha256(secret, dataCheckString))
}

/**
 * Doimiy vaqtli satr taqqoslash: natija birinchi farq qilgan joyga ham, uzunlik farqiga ham
 * bog'liq holda erta tugamaydi (har doim uzunroq satr bo'yicha to'liq aylanadi).
 */
export function timingSafeEqual(a: string, b: string): boolean {
  const len = Math.max(a.length, b.length)
  let diff = a.length ^ b.length
  for (let i = 0; i < len; i++) {
    const ca = i < a.length ? a.charCodeAt(i) : 0
    const cb = i < b.length ? b.charCodeAt(i) : 0
    diff |= ca ^ cb
  }
  return diff === 0
}

/** Telegram webhook `X-Telegram-Bot-Api-Secret-Token` sarlavhasini tekshirish. */
export function checkWebhookSecret(headerValue: string | null, expected: string): boolean {
  if (typeof expected !== 'string' || expected === '') return false
  if (typeof headerValue !== 'string') return false
  return timingSafeEqual(headerValue, expected)
}

/** `initData` query satrini maydonlarga ajratadi (URL-decode). Takroriy kalit → null. */
function parseInitData(initData: string): Record<string, string> | null {
  let params: URLSearchParams
  try {
    params = new URLSearchParams(initData)
  } catch {
    return null
  }
  const fields: Record<string, string> = {}
  for (const [k, v] of params) {
    if (k === '' || Object.prototype.hasOwnProperty.call(fields, k)) return null
    fields[k] = v
  }
  return fields
}

function parseUser(raw: string | undefined): TelegramUser | null {
  if (raw === undefined) return null
  let u: unknown
  try {
    u = JSON.parse(raw)
  } catch {
    return null
  }
  if (typeof u !== 'object' || u === null || Array.isArray(u)) return null
  const id = (u as { id?: unknown }).id
  if (typeof id !== 'number' || !Number.isSafeInteger(id) || id <= 0) return null
  return u as TelegramUser
}

/**
 * Mini App `initData` ni bot tokeni bilan tekshiradi.
 *
 * Tartib: format → `hash` bormi → imzo (HMAC) → `auth_date` muddati → `user`.
 * Imzo tekshirilmaguncha hech bir maydonga ishonilmaydi.
 *
 * `signature` maydoni (Bot API 8.0+, uchinchi tomon Ed25519 tekshiruvi uchun): hujjatga ko'ra
 * `hash` hisobida faqat `hash` chiqariladi, ba'zi manbalar `signature` ni ham chiqaradi. Ikkala
 * variant ham bot tokenisiz soxtalashtirib bo'lmaydigan HMAC — shuning uchun ikkalasi qabul qilinadi.
 */
export async function verifyInitData(
  initData: string,
  botToken: string,
  opts: { nowSec?: number; maxAgeSec?: number; futureToleranceSec?: number } = {},
): Promise<VerifyInitDataResult> {
  if (typeof initData !== 'string' || initData.trim() === '') return { ok: false, reason: 'malformed' }
  if (typeof botToken !== 'string' || botToken === '') return { ok: false, reason: 'bad_hash' }

  const all = parseInitData(initData)
  if (all === null) return { ok: false, reason: 'malformed' }

  const hash = all.hash
  if (hash === undefined || hash === '') return { ok: false, reason: 'missing_hash' }
  if (!/^[0-9a-f]{64}$/i.test(hash)) return { ok: false, reason: 'bad_hash' }
  const expectedHash = hash.toLowerCase()

  const withSignature = await computeInitDataHash(buildDataCheckString(all, ['hash']), botToken)
  let valid = timingSafeEqual(withSignature, expectedHash)
  if ('signature' in all) {
    const withoutSignature = await computeInitDataHash(
      buildDataCheckString(all, ['hash', 'signature']),
      botToken,
    )
    valid = timingSafeEqual(withoutSignature, expectedHash) || valid
  }
  if (!valid) return { ok: false, reason: 'bad_hash' }

  const authDateRaw = all.auth_date
  if (authDateRaw === undefined || !/^[0-9]{1,12}$/.test(authDateRaw)) {
    return { ok: false, reason: 'malformed' }
  }
  const authDate = Number(authDateRaw)
  const nowSec = opts.nowSec ?? Math.floor(Date.now() / 1000)
  const maxAgeSec = opts.maxAgeSec ?? DEFAULT_MAX_AGE_SEC
  const futureToleranceSec = opts.futureToleranceSec ?? DEFAULT_FUTURE_TOLERANCE_SEC
  if (authDate - nowSec > futureToleranceSec) return { ok: false, reason: 'future' }
  if (nowSec - authDate > maxAgeSec) return { ok: false, reason: 'expired' }

  const user = parseUser(all.user)
  if (user === null) return { ok: false, reason: 'no_user' }

  const fields: Record<string, string> = {}
  for (const k of Object.keys(all)) if (k !== 'hash') fields[k] = all[k] as string
  return { ok: true, user, authDate, fields }
}
