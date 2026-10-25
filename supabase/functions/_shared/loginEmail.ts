// Sintetik login email'lari (docs/auth-design.md, "Auth akkauntlar").
// Domenlar RFC 2606 rezerv TLD `.invalid` da: hech kim egalik qila olmaydi, xat yetkazilmaydi
// (`terron.uz` kabi begona domen egasi recovery/magiclink xatlarini olib akkauntni egallardi).
// Akkauntlar `email_confirm: true` bilan yaratiladi.

export const PHONE_LOGIN_DOMAIN = 'phone.terron-build.invalid'
export const TELEGRAM_LOGIN_DOMAIN = 'tg.terron-build.invalid'

const E164 = /^\+[0-9]{9,15}$/

/** `+998901234567` → `p998901234567@phone.terron-build.invalid`. Noto'g'ri E.164 → throw. */
export function loginEmailFromPhone(e164: string): string {
  if (typeof e164 !== 'string' || !E164.test(e164)) {
    throw new Error('loginEmailFromPhone: E.164 raqam kutilgan (+998901234567)')
  }
  return `p${e164.slice(1)}@${PHONE_LOGIN_DOMAIN}`
}

/** `123` → `tg123@tg.terron-build.invalid`. Musbat butun son bo'lmasa → throw. */
export function telegramAuthEmail(telegramUserId: number): string {
  if (typeof telegramUserId !== 'number' || !Number.isSafeInteger(telegramUserId) || telegramUserId <= 0) {
    throw new Error('telegramAuthEmail: musbat butun Telegram id kutilgan')
  }
  return `tg${telegramUserId}@${TELEGRAM_LOGIN_DOMAIN}`
}

/** Email tizim yaratgan sintetik manzilmi (telefon yoki Telegram login). */
export function isSyntheticEmail(email: string): boolean {
  if (typeof email !== 'string') return false
  const e = email.trim().toLowerCase()
  return e.endsWith(`@${PHONE_LOGIN_DOMAIN}`) || e.endsWith(`@${TELEGRAM_LOGIN_DOMAIN}`)
}
