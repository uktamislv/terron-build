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
  /**
   * Tinch soatlar (Asia/Tashkent, "HH:mm"): shu oraliqda jiddiy bo'lmagan ogohlantirishlar Telegram'ga
   * oyna oxirida yuboriladi. Ikkalasidan biri null — o'chiq.
   */
  quietHoursStart: string | null
  quietHoursEnd: string | null
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
  quietHoursStart: '22:00',
  quietHoursEnd: '07:00',
}

const SETTINGS_COLUMNS =
  'receipt_mismatch_pct::text, price_deviation_pct::text, price_avg_window, photo_required_amount::text, ' +
  'cash_max_days, duplicate_window_minutes, request_overbuy_pct::text, alert_remind_hours, forecast_days_warn, ' +
  'quiet_hours_start::text, quiet_hours_end::text'

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
  quiet_hours_start?: string | null
  quiet_hours_end?: string | null
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
    // Ustun yo'q (eski baza) — standart; null — o'chiq
    quietHoursStart: row.quiet_hours_start === undefined ? d.quietHoursStart : hhmm(row.quiet_hours_start),
    quietHoursEnd: row.quiet_hours_end === undefined ? d.quietHoursEnd : hhmm(row.quiet_hours_end),
  }
}

/** Postgres `time` ("22:00:00") → "22:00"; noto'g'ri yoki null — null. */
export function hhmm(v: string | null | undefined): string | null {
  const m = /^(\d{2}):(\d{2})/.exec(v ?? '')
  return m ? `${m[1]}:${m[2]}` : null
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
  if (patch.quietHoursStart !== undefined) row.quiet_hours_start = patch.quietHoursStart
  if (patch.quietHoursEnd !== undefined) row.quiet_hours_end = patch.quietHoursEnd
  return updateById('companies', companyId, row)
}

/** `notification_health()` → oxirgi xatolar. */
export interface NotificationError {
  id: string
  kind: string
  status: string
  lastError: string | null
  attempts: number
  updatedAt: string | null
}

export interface BlockedProfile {
  profileId: string
  fullName: string
  role: string
  blockedAt: string | null
}

/** Telegram xabarlari holati (admin): oxirgi yuborilgan, tiqilib qolgan, 7 kunda xato, bloklaganlar. */
export interface NotificationHealth {
  lastSentAt: string | null
  stuckPendingCount: number
  failed7dCount: number
  lastErrors: NotificationError[]
  blockedProfiles: BlockedProfile[]
}

function arr(v: unknown): Record<string, unknown>[] {
  return Array.isArray(v) ? v.filter((x): x is Record<string, unknown> => typeof x === 'object' && x !== null) : []
}

function strOrNull(v: unknown): string | null {
  return typeof v === 'string' && v !== '' ? v : null
}

export function normalizeHealth(raw: unknown): NotificationHealth {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  return {
    lastSentAt: strOrNull(r.last_sent_at),
    stuckPendingCount: num(r.stuck_pending_count as number | null, 0),
    failed7dCount: num(r.failed_7d_count as number | null, 0),
    lastErrors: arr(r.last_errors).map((e) => ({
      id: String(e.id ?? ''),
      kind: String(e.kind ?? ''),
      status: String(e.status ?? ''),
      lastError: strOrNull(e.last_error),
      attempts: num(e.attempts as number | null, 0),
      updatedAt: strOrNull(e.updated_at),
    })),
    blockedProfiles: arr(r.blocked_profiles).map((p) => ({
      profileId: String(p.profile_id ?? ''),
      fullName: String(p.full_name ?? ''),
      role: String(p.role ?? ''),
      blockedAt: strOrNull(p.telegram_blocked_at),
    })),
  }
}

/** RPC `notification_health()` — faqat admin (`notification_health_forbidden`). */
export async function getNotificationHealth(): Promise<NotificationHealth> {
  const { data, error } = await getSupabase().rpc('notification_health')
  if (error) throw toRepoError(error)
  return normalizeHealth(data)
}
