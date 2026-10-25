// Telefon raqamlari bilan ishlash — sof funksiyalar (Deno va Node/brauzerda bir xil).
// Bazadagi check: profiles.phone ~ '^\+[0-9]{9,15}$'.

const UZ_CODE = '998'
/** Ruxsat etilgan ajratgichlar: bo'sh joy, tire, qavslar, nuqta. */
const SEPARATORS = /[\s\-().]/g
const E164 = /^\+[0-9]{9,15}$/

/**
 * Kiritilgan raqamni E.164 ko'rinishiga keltiradi (`+998901234567`).
 * - `+...` — istalgan davlat kodi, 9–15 raqam (`+998` bo'lsa aynan 12 raqam);
 * - `00...` — xalqaro prefiks, `+` bilan teng;
 * - `998XXXXXXXXX` (12 raqam) → `+998...`;
 * - `XXXXXXXXX` (9 raqam, mahalliy) → `+998...`;
 * - `8XXXXXXXXX` (10 raqam, eski format `8 90 ...`) → `+998...`.
 * Noto'g'ri bo'lsa `null`.
 */
export function normalizePhone(input: string): string | null {
  if (typeof input !== 'string') return null
  let s = input.trim().replace(SEPARATORS, '')
  if (s === '') return null

  let international = false
  if (s.startsWith('+')) {
    international = true
    s = s.slice(1)
  } else if (s.startsWith('00')) {
    international = true
    s = s.slice(2)
  }
  if (!/^[0-9]+$/.test(s)) return null

  let digits: string
  if (international) {
    digits = s
  } else if (s.length === 12 && s.startsWith(UZ_CODE)) {
    digits = s
  } else if (s.length === 9) {
    digits = UZ_CODE + s
  } else if (s.length === 10 && s.startsWith('8')) {
    digits = UZ_CODE + s.slice(1)
  } else {
    return null
  }

  if (digits.startsWith(UZ_CODE) && digits.length !== 12) return null
  if (digits.startsWith('0')) return null
  const e164 = '+' + digits
  return E164.test(e164) ? e164 : null
}

/**
 * Login formasida: kiritilgan qiymat telefonga o'xshaydimi (aks holda email deb olinadi).
 * `@` bo'lsa — hech qachon telefon emas. Faqat raqam/ajratgichlardan iborat va kamida 7 raqam
 * bo'lsa — telefon deb olinadi (keyin `normalizePhone` bilan tekshiriladi; `null` → "noto'g'ri raqam").
 */
export function looksLikePhone(input: string): boolean {
  if (typeof input !== 'string') return false
  const s = input.trim()
  if (s === '' || s.includes('@')) return false
  if (!/^\+?[0-9\s\-().]+$/.test(s)) return false
  return s.replace(/[^0-9]/g, '').length >= 7
}

/**
 * Ko'rsatish uchun: `+998901234567` → `+998 90 123 45 67`.
 * O'zbekiston raqami bo'lmasa yoki noto'g'ri bo'lsa — kirishning o'zi qaytadi.
 */
export function formatPhoneDisplay(e164: string): string {
  const m = /^\+998(\d{2})(\d{3})(\d{2})(\d{2})$/.exec(e164)
  if (!m) return e164
  return `+998 ${m[1]} ${m[2]} ${m[3]} ${m[4]}`
}
