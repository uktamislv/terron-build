// Excel eksport uchun sof yordamchilar (SheetJS ga beriladigan qiymatlar).
import { parseDec, type Dec } from '../decimal'
import { isoToDayNumber } from './period'

const DANGEROUS_START = /^[=+\-@\t\r]/

/** Formula injection himoyasi: xavfli belgi bilan boshlangan matn oldiga `'` qo'yiladi. */
export function safeCell(value: string): string {
  return DANGEROUS_START.test(value) ? `'${value}` : value
}

/** JS son → kanonik Dec (eksponentali "1e-7", "1e+21" ham). Faqat aylanib qaytishni tekshirish uchun. */
function numberToDec(n: number): Dec | null {
  if (!Number.isFinite(n)) return null
  const s = String(n)
  const m = /^(-?)(\d+)(?:\.(\d+))?e([+-]\d+)$/.exec(s)
  if (!m) return parseDec(s)
  const sign = m[1] ?? ''
  const intPart = m[2] ?? ''
  const digits = intPart + (m[3] ?? '')
  const point = intPart.length + Number(m[4]) // kasr nuqtasining yangi o'rni
  let out: string
  if (point <= 0) out = `0.${'0'.repeat(-point)}${digits}`
  else if (point >= digits.length) out = digits + '0'.repeat(point - digits.length)
  else out = `${digits.slice(0, point)}.${digits.slice(point)}`
  return parseDec(sign + out)
}

/** Qiymatli raqamlar soni (oldingi nollarsiz, kasr qismi bilan). "0" → 0. */
function significantDigits(canon: Dec): number {
  return canon.replace('-', '').replace('.', '').replace(/^0+/, '').length
}

/**
 * Aniq o'nlik qiymat → Excel son katagi. ≤ 15 qiymatli raqam va `Number` orqali aylanib qaytganda
 * aynan o'zi bo'lsa — son; aks holda (aniqlik yo'qolardi) — kanonik matn. `Number` faqat chiqish
 * uchun, hisob uchun emas. Noto'g'ri qiymat → xato.
 */
export function decToExcelNumber(dec: Dec): number | string {
  const canon = parseDec(dec)
  if (canon === null) throw new Error(`reports: noto'g'ri o'nlik: ${JSON.stringify(dec)}`)
  if (significantDigits(canon) > 15) return canon
  const n = Number(canon)
  return numberToDec(n) === canon ? n : canon
}

const DAY_1899_12_31 = -25568 // isoToDayNumber('1899-12-31')
const DAY_1900_03_01 = -25508 // isoToDayNumber('1900-03-01')

/**
 * ISO sana (Toshkent kuni, faqat sana qismi) → Excel seriya raqami (1900 tizimi).
 * 1900-03-01 dan boshlab Excel'ning "29.02.1900" xatosi hisobga olinadi
 * (1900-01-01 → 1, 1900-03-01 → 61, 2026-01-01 → 46023). Vaqt qismi (`2026-01-01T10:00`) tashlanadi.
 */
export function isoToExcelDate(iso: string): number {
  const day = isoToDayNumber(iso.slice(0, 10))
  if (day === null || day <= DAY_1899_12_31) throw new Error(`reports: noto'g'ri sana: ${JSON.stringify(iso)}`)
  const serial = day - DAY_1899_12_31
  return day >= DAY_1900_03_01 ? serial + 1 : serial
}
