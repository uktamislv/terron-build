// Hisobot RPC'lari (docs/reports-design.md). Hammasi `security invoker` — RLS chaqiruvchi huquqida:
// har kim faqat o'zi ko'ra oladigan qismni oladi. Pul `text` (Dec satr), sonlar — int.
import type { Dec } from '@/domain/decimal'
import { toRepoError } from './errors'
import { getSupabase } from './supabaseClient'

export interface DashboardSummary {
  kirim_count: number
  chiqim_count: number
  purchases_count: number
  purchases_sum: Dec
  cash_issued_sum: Dec
  /** Batch 12 (I): davrda qaytarilgan pul (`cash_issued_sum` — faqat berilgan). */
  cash_returned_sum: Dec
  cash_on_hand_total: Dec
  /** Musbat balanslar yig'indisi (xodimlar qo'lidagi pul). */
  cash_outstanding_sum: Dec
  /** Manfiy balanslar yig'indisi (firma xodimlarga qarzdor — o'z pulidan sarflagan). */
  cash_owed_to_staff_sum: Dec
  alerts_open: number
  alerts_serious_open: number
  alerts_new_in_period: number
  unreceived_purchases_count: number
  pending_transfers_count: number
  pending_requests_count: number
  objects_over_norm_count: number
  /** Botni bloklagan faol xodimlar (admin/direktor ko'radi; boshqalarga 0). */
  telegram_blocked_count: number
  /** Joriy foydalanuvchining o'zi botni bloklagan — Telegram xabarlari kelmaydi. */
  telegram_me_blocked: boolean
  /** Xarajatlar (ombordan tashqari) — davrda soni va summasi. */
  expense_count: number
  expense_sum: Dec
  /** Tur bo'yicha top 5 (summa kamayish tartibida). */
  expense_by_category: ExpenseByCategory[]
  /** Umumiy xarajat: xaridlar + xarajatlar. */
  spend_total_sum: Dec
}

export interface ExpenseByCategory {
  category_id: string | null
  category_name: string | null
  sum: Dec
  count: number
}

export interface DailyRow {
  /** `yyyy-mm-dd` (Toshkent kuni) */
  day: string
  kirim_count: number
  chiqim_count: number
  purchases_sum: Dec
  alerts_count: number
}

export type SpendGroup = 'material' | 'object' | 'buyer' | 'supplier' | 'category'
export const SPEND_GROUPS: readonly SpendGroup[] = ['material', 'object', 'category', 'buyer', 'supplier']

export interface SpendRow {
  /** Guruh kaliti (sotuvchisiz xarid, obyektsiz xarajat — null). */
  key: string | null
  label: string | null
  /** Material xaridlari. */
  purchases_sum: Dec
  purchases_count: number
  /** Boshqa xarajatlar (`expenses`); `material` guruhida — doim 0. */
  expenses_sum: Dec
  expenses_count: number
  /** purchases_sum + expenses_sum. */
  total_sum: Dec
}

export interface NormOverviewRow {
  object_id: string
  object_name: string | null
  material_id: string
  material_name: string | null
  base_unit: string | null
  norm_qty_base: Dec
  allowed_qty_base: Dec
  consumed_qty_base: Dec
  /** Norma 0 bo'lsa — null. */
  usage_pct: Dec | null
  /** Material "smetaga kirmaydi" — norma ogohlantirishi yo'q (sarf ko'rinadi). Eski javobda yo'q — false. */
  outside_estimate?: boolean
}

export interface ReportRange {
  /** `yyyy-mm-dd` */
  from: string
  to: string
  objectId?: string | null
}

const COUNT_KEYS = [
  'kirim_count',
  'chiqim_count',
  'purchases_count',
  'alerts_open',
  'alerts_serious_open',
  'alerts_new_in_period',
  'unreceived_purchases_count',
  'pending_transfers_count',
  'pending_requests_count',
  'objects_over_norm_count',
  'telegram_blocked_count',
  'expense_count',
] as const
const MONEY_KEYS = [
  'purchases_sum',
  'cash_issued_sum',
  'cash_returned_sum',
  'cash_on_hand_total',
  'cash_outstanding_sum',
  'cash_owed_to_staff_sum',
  'expense_sum',
  'spend_total_sum',
] as const

function int(v: unknown): number {
  const n = Number(v ?? 0)
  return Number.isFinite(n) ? n : 0
}

function dec(v: unknown): Dec {
  if (v === null || v === undefined || v === '') return '0'
  return String(v)
}

function decOrNull(v: unknown): Dec | null {
  return v === null || v === undefined || v === '' ? null : String(v)
}

function rangeArgs(r: ReportRange) {
  return { p_from: r.from, p_to: r.to, p_object_id: r.objectId || null }
}

export function normalizeSummary(raw: unknown): DashboardSummary {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const out = {} as Record<string, number | Dec>
  for (const k of COUNT_KEYS) out[k] = int(o[k])
  for (const k of MONEY_KEYS) out[k] = dec(o[k])
  const byCat = Array.isArray(o.expense_by_category) ? (o.expense_by_category as unknown[]) : []
  return {
    ...(out as unknown as DashboardSummary),
    telegram_me_blocked: o.telegram_me_blocked === true,
    expense_by_category: byCat
      .filter((x): x is Record<string, unknown> => typeof x === 'object' && x !== null)
      .map((x) => ({
        category_id: x.category_id ? String(x.category_id) : null,
        category_name: x.category_name === null || x.category_name === undefined ? null : String(x.category_name),
        sum: dec(x.sum),
        count: int(x.count),
      })),
  }
}

/** Bosh sahifa kartochkalari. Noto'g'ri davr — `report_period_invalid`. */
export async function getDashboardSummary(r: ReportRange): Promise<DashboardSummary> {
  const { data, error } = await getSupabase().rpc('dashboard_summary', rangeArgs(r))
  if (error) throw toRepoError(error)
  return normalizeSummary(data)
}

/** Kunlik dinamika (bo'sh kunlar ham keladi). */
export async function getDashboardDaily(r: ReportRange): Promise<DailyRow[]> {
  const { data, error } = await getSupabase().rpc('dashboard_daily', rangeArgs(r))
  if (error) throw toRepoError(error)
  return ((data ?? []) as Record<string, unknown>[]).map((d) => ({
    day: String(d.day ?? '').slice(0, 10),
    kirim_count: int(d.kirim_count),
    chiqim_count: int(d.chiqim_count),
    purchases_sum: dec(d.purchases_sum),
    alerts_count: int(d.alerts_count),
  }))
}

/** Xarajat taqsimoti (summa bo'yicha kamayish tartibida). */
export async function getSpendBreakdown(r: ReportRange, group: SpendGroup): Promise<SpendRow[]> {
  const { data, error } = await getSupabase().rpc('spend_breakdown', { ...rangeArgs(r), p_group: group })
  if (error) throw toRepoError(error)
  return ((data ?? []) as Record<string, unknown>[]).map((d) => ({
    key: d.key ? String(d.key) : null,
    label: d.label === null || d.label === undefined ? null : String(d.label),
    purchases_sum: dec(d.purchases_sum),
    purchases_count: int(d.purchases_count),
    expenses_sum: dec(d.expenses_sum),
    expenses_count: int(d.expenses_count),
    // Eski javobda total_sum yo'q — xaridlar summasi
    total_sum: d.total_sum === null || d.total_sum === undefined || d.total_sum === '' ? dec(d.purchases_sum) : String(d.total_sum),
  }))
}

/** Smeta va haqiqiy sarf (joriy smetali obyektlar). */
export async function getNormOverview(objectId?: string | null): Promise<NormOverviewRow[]> {
  const { data, error } = await getSupabase().rpc('norm_overview', { p_object_id: objectId || null })
  if (error) throw toRepoError(error)
  return ((data ?? []) as Record<string, unknown>[]).map((d) => ({
    object_id: String(d.object_id),
    object_name: d.object_name === null || d.object_name === undefined ? null : String(d.object_name),
    material_id: String(d.material_id),
    material_name: d.material_name === null || d.material_name === undefined ? null : String(d.material_name),
    base_unit: d.base_unit === null || d.base_unit === undefined ? null : String(d.base_unit),
    norm_qty_base: dec(d.norm_qty_base),
    allowed_qty_base: dec(d.allowed_qty_base),
    consumed_qty_base: dec(d.consumed_qty_base),
    usage_pct: decOrNull(d.usage_pct),
    outside_estimate: d.outside_estimate === true,
  }))
}

/** Obyekt bo'yicha smeta jami va haqiqiy xarajat (so'm) — bitta o'qda pul (turli birliklar aralashmaydi). */
export interface EstimateSpendRow {
  object_id: string
  object_name: string | null
  /** Joriy smeta jami (`estimate_totals.total_sum`); joriy smeta yo'q — null. */
  estimate_sum: Dec | null
  /** Tanlangan davrdagi jami (`spend_breakdown` → obyekt, `total_sum`): material + boshqa xarajat. */
  spent_sum: Dec
  /** Material xaridlari. */
  material_sum?: Dec
  /** Boshqa xarajatlar (oziq-ovqat, yoqilg'i …). */
  expense_sum?: Dec
}

/**
 * Smeta va haqiqiy (pul): obyektlarning joriy smetasi jami (`estimate_totals`) va davrdagi xaridlar
 * (`spend_breakdown` → obyekt). RLS — chaqiruvchi ko'ra oladigan obyektlar.
 */
export async function getEstimateVsSpend(r: ReportRange): Promise<EstimateSpendRow[]> {
  const sb = getSupabase()
  let q = sb.from('estimates').select('id, object_id').eq('is_current', true).is('deleted_at', null)
  if (r.objectId) q = q.eq('object_id', r.objectId)
  const [{ data: estimates, error: estError }, spend] = await Promise.all([q, getSpendBreakdown(r, 'object')])
  if (estError) throw toRepoError(estError)
  const current = (estimates ?? []) as { id: string; object_id: string }[]
  const totals = new Map<string, Dec>()
  if (current.length > 0) {
    const { data, error } = await sb
      .from('estimate_totals')
      .select('estimate_id, object_id, total_sum::text')
      .in('estimate_id', current.map((e) => e.id))
    if (error) throw toRepoError(error)
    for (const t of (data ?? []) as unknown as { object_id: string; total_sum: string | null }[]) {
      totals.set(t.object_id, dec(t.total_sum))
    }
  }
  const ids = new Set<string>([...totals.keys(), ...spend.filter((s) => s.key).map((s) => s.key as string)])
  if (ids.size === 0) return []
  const { data: objects, error: objError } = await sb.from('objects').select('id, name').in('id', [...ids])
  if (objError) throw toRepoError(objError)
  const names = new Map(((objects ?? []) as { id: string; name: string }[]).map((o) => [o.id, o.name]))
  const spent = new Map(spend.filter((s) => s.key).map((s) => [s.key as string, s]))
  return [...ids].map((id) => ({
    object_id: id,
    object_name: names.get(id) ?? spend.find((s) => s.key === id)?.label ?? null,
    estimate_sum: totals.get(id) ?? null,
    spent_sum: spent.get(id)?.total_sum ?? '0',
    material_sum: spent.get(id)?.purchases_sum ?? '0',
    expense_sum: spent.get(id)?.expenses_sum ?? '0',
  }))
}
