import { toRepoError } from './errors'
import { updateById } from './rowUpdate'
import { getSupabase } from './supabaseClient'

/** Firma sozlamalari — farq qoidalari va avtomatlashtirish chegaralari (foiz/summa `numeric` → satr). */
export interface CompanySettings {
  receiptMismatchPct: string
  priceDeviationPct: string
  priceAvgWindow: number
  /** Batch 12 (E): shu summadan (so'm) katta xaridda chek rasmi majburiy; null — o'chiq. */
  photoRequiredAmount: string | null
  /** Batch 12 (I): podotchet necha kundan keyin "muddati o'tgan". */
  cashMaxDays: number
  /** Batch 12 (C): takroriy yozuv oynasi, daqiqa. */
  duplicateWindowMinutes: number
  /** Batch 12 (H): so'rovdan necha foiz ko'p xarid — alert. */
  requestOverbuyPct: string
  /** Batch 12 (J): ochiq alert necha soatdan keyin qayta eslatiladi. */
  alertRemindHours: number
  /** Batch 12 (K): necha kun yoki kamroq qolsa "tugayapti". */
  forecastDaysWarn: number
}

/** Bazadagi standart qiymatlar (sozlama o'qilmasa — UI shular bilan ishlaydi). */
export const DEFAULT_COMPANY_SETTINGS: CompanySettings = {
  receiptMismatchPct: '2',
  priceDeviationPct: '8',
  priceAvgWindow: 5,
  photoRequiredAmount: null,
  cashMaxDays: 14,
  duplicateWindowMinutes: 10,
  requestOverbuyPct: '20',
  alertRemindHours: 48,
  forecastDaysWarn: 3,
}

const SETTINGS_COLUMNS =
  'receipt_mismatch_pct::text, price_deviation_pct::text, price_avg_window, photo_required_amount::text, ' +
  'cash_max_days, duplicate_window_minutes, request_overbuy_pct::text, alert_remind_hours, forecast_days_warn'

interface RawSettings {
  receipt_mismatch_pct: string
  price_deviation_pct: string
  price_avg_window: number
  photo_required_amount?: string | null
  cash_max_days?: number | null
  duplicate_window_minutes?: number | null
  request_overbuy_pct?: string | null
  alert_remind_hours?: number | null
  forecast_days_warn?: number | null
}

function num(v: number | string | null | undefined, fallback: number): number {
  const n = Number(v)
  return v === null || v === undefined || !Number.isFinite(n) ? fallback : n
}

export function normalizeSettings(row: RawSettings): CompanySettings {
  const d = DEFAULT_COMPANY_SETTINGS
  return {
    receiptMismatchPct: row.receipt_mismatch_pct,
    priceDeviationPct: row.price_deviation_pct,
    priceAvgWindow: num(row.price_avg_window, d.priceAvgWindow),
    photoRequiredAmount: row.photo_required_amount ?? null,
    cashMaxDays: num(row.cash_max_days, d.cashMaxDays),
    duplicateWindowMinutes: num(row.duplicate_window_minutes, d.duplicateWindowMinutes),
    requestOverbuyPct: row.request_overbuy_pct ?? d.requestOverbuyPct,
    alertRemindHours: num(row.alert_remind_hours, d.alertRemindHours),
    forecastDaysWarn: num(row.forecast_days_warn, d.forecastDaysWarn),
  }
}

export async function getCompanySettings(companyId: string): Promise<CompanySettings> {
  const { data, error } = await getSupabase().from('companies').select(SETTINGS_COLUMNS).eq('id', companyId).single()
  if (error) throw toRepoError(error)
  return normalizeSettings(data as unknown as RawSettings)
}

/** Admin: sozlamalarni saqlash (RLS — faqat admin). Faqat berilgan maydonlar yoziladi. */
export function updateCompanySettings(companyId: string, patch: Partial<CompanySettings>): Promise<void> {
  const row: Record<string, unknown> = {}
  if (patch.receiptMismatchPct !== undefined) row.receipt_mismatch_pct = patch.receiptMismatchPct
  if (patch.priceDeviationPct !== undefined) row.price_deviation_pct = patch.priceDeviationPct
  if (patch.priceAvgWindow !== undefined) row.price_avg_window = patch.priceAvgWindow
  if (patch.photoRequiredAmount !== undefined) row.photo_required_amount = patch.photoRequiredAmount
  if (patch.cashMaxDays !== undefined) row.cash_max_days = patch.cashMaxDays
  if (patch.duplicateWindowMinutes !== undefined) row.duplicate_window_minutes = patch.duplicateWindowMinutes
  if (patch.requestOverbuyPct !== undefined) row.request_overbuy_pct = patch.requestOverbuyPct
  if (patch.alertRemindHours !== undefined) row.alert_remind_hours = patch.alertRemindHours
  if (patch.forecastDaysWarn !== undefined) row.forecast_days_warn = patch.forecastDaysWarn
  return updateById('companies', companyId, row)
}
