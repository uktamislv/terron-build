// Firma sozlamalari formasi — sof funksiyalar (matn ↔ qiymat, chegaralar — docs/db-design.md, Batch 12;
// audit tuzatishlari — docs/audit-fixes.md B2: bazadagi CHECK cheklovlari bilan bir xil).
import type { CompanySettings } from '@/data/companiesRepo'
import { parseSumInput, formatSumInput } from '@/domain/cash'
import { cmp, parseDec, scaleOf } from '@/domain/decimal'

export type SettingsKey = keyof CompanySettings
export type SettingsForm = Record<SettingsKey, string>

/** Butun son maydonlari va chegaralari. */
export const INT_LIMITS = {
  priceAvgWindow: [1, 50],
  cashMaxDays: [1, 365],
  duplicateWindowMinutes: [1, 1440],
  alertRemindHours: [1, 168],
  forecastDaysWarn: [1, 60],
} as const satisfies Partial<Record<SettingsKey, readonly [number, number]>>

/** Foiz maydonlari va yuqori chegarasi. */
export const PCT_LIMITS = {
  receiptMismatchPct: 50,
  priceDeviationPct: 50,
  requestOverbuyPct: 200,
} as const satisfies Partial<Record<SettingsKey, number>>

export type IntKey = keyof typeof INT_LIMITS
export type PctKey = keyof typeof PCT_LIMITS

export function toForm(s: CompanySettings): SettingsForm {
  return {
    receiptMismatchPct: s.receiptMismatchPct,
    priceDeviationPct: s.priceDeviationPct,
    priceAvgWindow: String(s.priceAvgWindow),
    photoRequiredAmount: s.photoRequiredAmount ? formatSumInput(s.photoRequiredAmount.replace('.', ',')) : '',
    cashMaxDays: String(s.cashMaxDays),
    duplicateWindowMinutes: String(s.duplicateWindowMinutes),
    requestOverbuyPct: s.requestOverbuyPct,
    alertRemindHours: String(s.alertRemindHours),
    forecastDaysWarn: String(s.forecastDaysWarn),
    quietHoursStart: s.quietHoursStart ?? '',
    quietHoursEnd: s.quietHoursEnd ?? '',
  }
}

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/

/** "HH:mm" (00:00–23:59) yoki null. */
export function parseTime(v: string): string | null {
  const s = v.trim()
  return TIME_RE.test(s) ? s : null
}

/** Tinch soatlar tanlovi uchun: 00:00 dan 23:30 gacha har 30 daqiqa. */
export const QUIET_TIME_OPTIONS: readonly string[] = Array.from({ length: 48 }, (_, i) => {
  const h = String(Math.floor(i / 2)).padStart(2, '0')
  return `${h}:${i % 2 === 0 ? '00' : '30'}`
})

function parseInt10(v: string, [min, max]: readonly [number, number]): number | null {
  const s = v.trim()
  if (!/^\d{1,6}$/.test(s)) return null
  const n = Number(s)
  return n >= min && n <= max ? n : null
}

function parsePct(v: string, max: number): string | null {
  const d = parseDec(v.trim().replace(',', '.'))
  if (d === null || cmp(d, '0') < 0 || cmp(d, String(max)) > 0 || scaleOf(d) > 2) return null
  return d
}

export type SettingsErrors = Partial<Record<SettingsKey, true>>

/** Formani tekshiradi: xato bo'lsa — maydonlar; aks holda saqlanadigan qiymatlar. */
export function fromForm(f: SettingsForm): { ok: true; value: CompanySettings } | { ok: false; errors: SettingsErrors } {
  const errors: SettingsErrors = {}
  const ints = {} as Record<IntKey, number>
  for (const key of Object.keys(INT_LIMITS) as IntKey[]) {
    const n = parseInt10(f[key], INT_LIMITS[key])
    if (n === null) errors[key] = true
    else ints[key] = n
  }
  const pcts = {} as Record<PctKey, string>
  for (const key of Object.keys(PCT_LIMITS) as PctKey[]) {
    const d = parsePct(f[key], PCT_LIMITS[key])
    if (d === null) errors[key] = true
    else pcts[key] = d
  }
  let amount: string | null = null
  if (f.photoRequiredAmount.trim() !== '') {
    amount = parseSumInput(f.photoRequiredAmount)
    if (amount === null || cmp(amount, '0') <= 0) errors.photoRequiredAmount = true
  }
  // Tinch soatlar: ikkalasi bo'sh — o'chiq; aks holda ikkalasi to'g'ri va har xil
  let quietHoursStart: string | null = null
  let quietHoursEnd: string | null = null
  if (f.quietHoursStart.trim() !== '' || f.quietHoursEnd.trim() !== '') {
    quietHoursStart = parseTime(f.quietHoursStart)
    quietHoursEnd = parseTime(f.quietHoursEnd)
    if (quietHoursStart === null) errors.quietHoursStart = true
    if (quietHoursEnd === null) errors.quietHoursEnd = true
    if (quietHoursStart !== null && quietHoursStart === quietHoursEnd) errors.quietHoursEnd = true
  }
  if (Object.keys(errors).length > 0) return { ok: false, errors }
  return { ok: true, value: { ...ints, ...pcts, photoRequiredAmount: amount, quietHoursStart, quietHoursEnd } }
}
