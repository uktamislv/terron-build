import { parseDec, round, type Dec } from '@/domain/decimal'
import { formatDecUz } from '@/domain/units'
import { t } from '@/i18n'

export const TIME_ZONE = 'Asia/Tashkent'

/** Minglik guruh ajratuvchi — tor bo'linmas bo'shliq (U+202F): "1 250 000" qatorda bo'linmaydi. */
export const GROUP_SEP = '\u202F'
/** Raqam va birlik orasidagi bo'linmas bo'shliq (U+00A0): "150 kg" qator oxirida ajralmaydi. */
export const UNIT_SEP = '\u00A0'
/** Ko'rsatishdagi minus belgisi (U+2212) — chiziqcha emas. */
export const MINUS = '\u2212'

function parts(date: Date, options: Intl.DateTimeFormatOptions): Record<string, string> {
  const result: Record<string, string> = {}
  for (const p of new Intl.DateTimeFormat('en-GB', { timeZone: TIME_ZONE, ...options }).formatToParts(date)) {
    result[p.type] = p.value
  }
  return result
}

/** Sana `dd.mm.yyyy` ko'rinishida, Asia/Tashkent bo'yicha. */
export function formatDate(input: Date | string): string {
  const p = parts(new Date(input), { day: '2-digit', month: '2-digit', year: 'numeric' })
  return `${p.day}.${p.month}.${p.year}`
}

/** Sana va vaqt `dd.mm.yyyy HH:mm` ko'rinishida, Asia/Tashkent bo'yicha. */
export function formatDateTime(input: Date | string): string {
  const p = parts(new Date(input), {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  })
  return `${p.day}.${p.month}.${p.year} ${p.hour}:${p.minute}`
}

/** Vaqt `HH:mm` ko'rinishida, Asia/Tashkent bo'yicha. */
export function formatTime(input: Date | string): string {
  const p = parts(new Date(input), { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
  return `${p.hour}:${p.minute}`
}

/**
 * Summa raqami (birliksiz): minglik — U+202F, kasr — vergul, minus — U+2212 ("1 250 000").
 * Qiymat bazadan `numeric` sifatida string bo'lib keladi — float'ga aylantirilmaydi.
 */
export function formatSumNumber(value: string | bigint): string {
  const raw = String(value).trim()
  const [intPart = '0', fracPart] = raw.replace(/^[-+]/, '').split('.')
  const grouped = intPart.replace(/^0+(?=\d)/, '').replace(/\B(?=(\d{3})+(?!\d))/g, GROUP_SEP)
  const frac = fracPart && /[1-9]/.test(fracPart) ? `,${fracPart.replace(/0+$/, '')}` : ''
  const negative = raw.startsWith('-') && /[1-9]/.test(raw)
  return `${negative ? MINUS : ''}${grouped}${frac}`
}

/** Pul summasi so'mda: "1 250 000 so'm" (raqam va "so'm" orasida bo'linmas bo'shliq, "so'm" — i18n). */
export function formatSum(value: string | bigint): string {
  return `${formatSumNumber(value)}${UNIT_SEP}${t.ui.sum}`
}

/**
 * Miqdor (`numeric` → Dec satr) o'zbekcha formatda: kasr — vergul, minglik — U+202F, minus — U+2212.
 * "1250.5" → "1 250,5", "50.000000" → "50". Float'ga aylantirilmaydi.
 * `maxFrac` berilsa, kasr qismi shu xonagacha yaxlitlanadi (PostgreSQL `round` kabi, half away from zero).
 * Raqam bo'lmagan qiymat o'zgarishsiz qaytadi.
 */
export function formatQty(value: Dec | bigint, maxFrac?: number): string {
  const raw = String(value).trim()
  const dec = parseDec(raw)
  if (dec === null) return raw
  return formatDecUz(maxFrac === undefined ? dec : round(dec, maxFrac))
}

/** Miqdor va birlik: "150 kg" (bo'linmas bo'shliq bilan). Birlik bo'sh bo'lsa — faqat raqam. */
export function formatQtyUnit(value: Dec | bigint, unit: string | null | undefined, maxFrac?: number): string {
  const num = formatQty(value, maxFrac)
  const u = (unit ?? '').trim()
  return u ? `${num}${UNIT_SEP}${u}` : num
}

/** Toshkent bo'yicha bugungi sana + `offsetDays` kun, `yyyy-mm-dd` (bazadagi `date` ustunlar uchun). */
export function tashkentIsoDate(offsetDays = 0, now: Date = new Date()): string {
  const p = parts(new Date(now.getTime() + offsetDays * 24 * 60 * 60 * 1000), {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  })
  return `${p.year}-${p.month}-${p.day}`
}

/** `yyyy-mm-dd` → `dd.mm.yyyy` (vaqt zonasisiz, satr darajasida). Noto'g'ri qiymat — bo'sh satr. */
export function isoDateToDisplay(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso.trim())
  return m ? `${m[3]}.${m[2]}.${m[1]}` : ''
}

/**
 * `dd.mm.yyyy` (yoki `yyyy-mm-dd`) → `yyyy-mm-dd`. Mavjud bo'lmagan sana (31.02, 13-oy) — null.
 * Kiritish maydoni (DateField) uchun; qiymat ichkarida doim ISO.
 */
export function parseDisplayDate(text: string): string | null {
  const s = text.trim()
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s)
  const dmy = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(s)
  const [y, mo, d] = iso ? [iso[1], iso[2], iso[3]] : dmy ? [dmy[3], dmy[2], dmy[1]] : []
  if (!y || !mo || !d) return null
  const year = Number(y)
  const month = Number(mo)
  const day = Number(d)
  if (year < 1900 || month < 1 || month > 12 || day < 1) return null
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate()
  if (day > daysInMonth) return null
  return `${y}-${mo}-${d}`
}

/** Kiritilayotgan sana niqobi: faqat raqamlar, nuqtalar o'zi qo'yiladi ("0511" → "05.11"). */
export function maskDateInput(text: string): string {
  const digits = text.replace(/\D/g, '').slice(0, 8)
  if (digits.length <= 2) return digits
  if (digits.length <= 4) return `${digits.slice(0, 2)}.${digits.slice(2)}`
  return `${digits.slice(0, 2)}.${digits.slice(2, 4)}.${digits.slice(4)}`
}
