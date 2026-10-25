// Firma sozlamalari formasi — sof funksiyalar (matn ↔ qiymat, chegaralar — docs/db-design.md, Batch 12).
import type { CompanySettings } from '@/data/companiesRepo'
import { parseSumInput, formatSumInput } from '@/domain/cash'
import { cmp, parseDec, scaleOf } from '@/domain/decimal'

export type SettingsKey = keyof CompanySettings
export type SettingsForm = Record<SettingsKey, string>

/** Butun son maydonlari va chegaralari. */
export const INT_LIMITS = {
  priceAvgWindow: [1, 50],
  cashMaxDays: [1, 365],
  duplicateWindowMinutes: [0, 1440],
  alertRemindHours: [1, 720],
  forecastDaysWarn: [1, 60],
} as const satisfies Partial<Record<SettingsKey, readonly [number, number]>>

/** Foiz maydonlari va yuqori chegarasi. */
export const PCT_LIMITS = {
  receiptMismatchPct: 100,
  priceDeviationPct: 100,
  requestOverbuyPct: 1000,
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
  }
}

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
  if (Object.keys(errors).length > 0) return { ok: false, errors }
  return { ok: true, value: { ...ints, ...pcts, photoRequiredAmount: amount } }
}
