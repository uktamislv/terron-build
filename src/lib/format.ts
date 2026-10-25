import { parseDec, round, type Dec } from '@/domain/decimal'
import { formatDecUz } from '@/domain/units'

export const TIME_ZONE = 'Asia/Tashkent'

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

/**
 * Pul summasi so'mda, minglik ajratuvchi bo'sh joy: "1 250 000 so'm".
 * Qiymat bazadan `numeric` sifatida string bo'lib keladi — float'ga aylantirilmaydi.
 */
export function formatSum(value: string | bigint): string {
  const raw = String(value).trim()
  const negative = raw.startsWith('-')
  const [intPart = '0', fracPart] = raw.replace(/^[-+]/, '').split('.')
  const grouped = intPart.replace(/^0+(?=\d)/, '').replace(/\B(?=(\d{3})+(?!\d))/g, ' ')
  const frac = fracPart && /[1-9]/.test(fracPart) ? `,${fracPart.replace(/0+$/, '')}` : ''
  return `${negative ? '-' : ''}${grouped}${frac} so‘m`
}

/**
 * Miqdor (`numeric` → Dec satr) o'zbekcha formatda: kasr — vergul, minglik — bo'sh joy.
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
