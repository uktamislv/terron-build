// Xarajatlar (ombordan tashqari: oziq-ovqat, yoqilg'i, transport …) — docs/expenses-design.md.
// Qoldiqqa ta'sir qilmaydi; podotchet xarajat to'lovchining qo'lidagi puldan ayiriladi (server).
// Tuzatish va bekor qilish — `correct_entry('expenses', …)` / `cancel_own_entry` (src/data/correctionsRepo.ts).
import { decEq, ensureSameDraft } from './draftConflict'
import { isPkeyConflict, toRepoError } from './errors'
import { chunkOpts, fetchAll, inChunks, type ChunkOpts } from './fetchAll'
import { geoColumns, GEO_SELECT } from './geo'
import { attachNames } from './profileDirectory'
import { softDeleteById, updateById } from './rowUpdate'
import { cleanTin } from './suppliersRepo'
import { scopeCompany } from './companyScope'
import { getSupabase } from './supabaseClient'
import type { AlertType, Expense, GeoFix, PaymentSource } from './types'
import type { PurchaseReceiptQr } from './purchasesRepo'

// numeric ustunlar `::text` — aniqlik yo'qolmasin. Embed'lar FK nomi bilan (kompozit FK'lar).
const EXPENSE_COLUMNS =
  'id, company_id, category_id, object_id, amount::text, spent_at, payer_id, payment_source, supplier_id, note, ' +
  'receipt_photo_path, receipt_photo_sha256, receipt_fiscal_sign, receipt_terminal_id, receipt_no, receipt_verified, ' +
  'receipt_total::text, seller_tin, created_by, created_at, deleted_at, ' +
  GEO_SELECT
export const EXPENSE_SELECT =
  `${EXPENSE_COLUMNS}, ` +
  'category:expense_categories!expenses_category_fkey(name), ' +
  'object:objects!expenses_object_fkey(name), ' +
  'supplier:suppliers!expenses_supplier_fkey(name)'

export const EXPENSES_PAGE_SIZE = 50
export const EXPENSE_NOTE_MAX = 500

/** Filtrdagi "Umumiy (obyektsiz)" qiymati (`object_id is null`). */
export const NO_OBJECT = 'none'

export interface NewExpense {
  /** Klientda yaratilgan id (qoralama) — qayta urinishda ikki marta yozilmaslik uchun. */
  id: string
  companyId: string
  categoryId: string
  /** null — "Umumiy" (obyektsiz). */
  objectId: string | null
  /** Dec satr, so'm. */
  amount: string
  note?: string | null
  /** To'lovchi; berilmasa — joriy foydalanuvchi. Admin boshqa xodim nomidan. */
  payerId?: string | null
  /** ISO; berilmasa — server `now()`. */
  spentAt?: string | null
  supplierId?: string | null
  receiptPhotoPath?: string | null
  receipt?: PurchaseReceiptQr | null
  geo?: GeoFix | null
  /** Faqat admin / super_admin / buxgalter tanlaydi; null — server qoidasi (xarid bilan bir xil). */
  paymentSource?: PaymentSource | null
}

export interface ExpenseFilters {
  categoryId?: string
  /** Obyekt id'si yoki `NO_OBJECT` ("Umumiy"). */
  objectId?: string
  payerId?: string
  /** ISO, shu vaqtdan (kiritilgan). */
  from?: string
  /** ISO, shu vaqtgacha (kiritilmagan). */
  to?: string
  includeDeleted?: boolean
}

export interface ExpensePage {
  rows: Expense[]
  total: number
}

type RawExpense = Omit<Expense, 'category_name' | 'object_name' | 'supplier_name' | 'payer_name' | 'alert_types'> & {
  category: { name: string } | null
  object: { name: string } | null
  supplier: { name: string } | null
}

function normalize(raw: RawExpense): Expense {
  const { category, object, supplier, ...rest } = raw
  return {
    ...rest,
    category_name: category?.name ?? null,
    object_name: object?.name ?? null,
    supplier_name: supplier?.name ?? null,
    payer_name: null,
    alert_types: [],
  }
}

function clean(value: string | null | undefined, max = EXPENSE_NOTE_MAX): string | null {
  const v = value?.trim().slice(0, max)
  return v ? v : null
}

/** To'lovchi ismi — `profile_directory` dan (admin bo'lmaganlar `profiles` dan faqat o'zini ko'radi). */
function withNames(rows: Expense[]): Promise<Expense[]> {
  return attachNames(rows, [['payer_id', 'payer_name']])
}

/** Ochiq alert turlari (`details.table = 'expenses'`, `details.record_id`). Ko'ra olmaydiganlarga — bo'sh. */
async function attachAlerts(rows: Expense[]): Promise<Expense[]> {
  if (rows.length === 0) return rows
  const alerts = await inChunks(
    rows.map((r) => r.id),
    async (chunk) => {
      const { data, error } = await getSupabase()
        .from('alerts')
        .select('type, details->>record_id')
        .eq('details->>table', 'expenses')
        .in('details->>record_id', chunk)
        .in('status', ['yangi', 'korildi'])
        .is('deleted_at', null)
      if (error) throw error
      return (data ?? []) as unknown as { type: AlertType; record_id: string | null }[]
    },
  ).catch(() => [] as { type: AlertType; record_id: string | null }[])
  const by = new Map<string, AlertType[]>()
  for (const a of alerts) {
    if (!a.record_id) continue
    const list = by.get(a.record_id) ?? []
    if (!list.includes(a.type)) list.push(a.type)
    by.set(a.record_id, list)
  }
  return rows.map((r) => ({ ...r, alert_types: by.get(r.id) ?? [] }))
}

async function finish(raw: RawExpense[], alerts = true): Promise<Expense[]> {
  const named = await withNames(raw.map(normalize))
  return alerts ? attachAlerts(named) : named
}

/**
 * Xarajat yaratadi. Idempotent: oldingi urinish aslida saqlangan bo'lsa, shu `id` bilan `expenses_pkey`
 * 23505 keladi — unda saqlangan qator o'qib qaytariladi; boshqa yozuv bo'lsa (tur, obyekt yoki summa farq
 * qiladi) — `draft_conflict`.
 */
export async function createExpense(input: NewExpense): Promise<Expense> {
  const row: Record<string, unknown> = {
    id: input.id,
    company_id: input.companyId,
    category_id: input.categoryId,
    object_id: input.objectId || null,
    amount: input.amount,
    note: clean(input.note),
    supplier_id: input.supplierId || null,
    receipt_photo_path: clean(input.receiptPhotoPath, 1000),
  }
  if (input.payerId) row.payer_id = input.payerId
  if (input.spentAt) row.spent_at = input.spentAt
  if (input.paymentSource) row.payment_source = input.paymentSource
  Object.assign(row, geoColumns(input.geo))
  // Chek rasmi xeshi klientdan yuborilmaydi — saqlangandan keyin `photo-hash` (functions.ts)
  if (input.receipt) {
    row.receipt_fiscal_sign = input.receipt.fiscalSign
    row.receipt_terminal_id = input.receipt.terminalId
    row.receipt_no = input.receipt.receiptNo
    row.receipt_verified = input.receipt.verified
    row.receipt_total = input.receipt.total
    row.seller_tin = cleanTin(input.receipt.sellerTin)
  }
  const { data, error } = await getSupabase().from('expenses').insert(row).select(EXPENSE_SELECT).single()
  if (error) {
    if (isPkeyConflict(error, 'expenses_pkey')) {
      const existing = await getExpenseById(input.id).catch(() => null)
      if (existing) {
        return ensureSameDraft(
          existing,
          existing.category_id === input.categoryId &&
            (existing.object_id ?? null) === (input.objectId || null) &&
            decEq(existing.amount, input.amount),
        )
      }
    }
    throw toRepoError(error)
  }
  const [saved] = await finish([data as unknown as RawExpense], false)
  return saved as Expense
}

export async function getExpenseById(id: string): Promise<Expense> {
  const { data, error } = await getSupabase().from('expenses').select(EXPENSE_SELECT).eq('id', id).single()
  if (error) throw toRepoError(error)
  const [row] = await finish([data as unknown as RawExpense])
  return row as Expense
}

/** Xarajatlar jadvali: filtrlar, `spent_at` bo'yicha yangisi birinchi, 50 tadan sahifa (0 dan). */
export async function listExpenses(filters: ExpenseFilters = {}, page = 0): Promise<ExpensePage> {
  const start = page * EXPENSES_PAGE_SIZE
  const r = await loadExpenses(filters, start, start + EXPENSES_PAGE_SIZE - 1)
  return { rows: r.rows, total: r.total ?? 0 }
}

/** Eksport: joriy filtr bo'yicha barcha xarajatlar (1000 tadan, ≤ 50 000). */
export function listAllExpenses(filters: ExpenseFilters = {}, signal?: AbortSignal): Promise<Expense[]> {
  return fetchAll((req) => loadExpenses(filters, req.from, req.to, chunkOpts(req)), { signal })
}

async function loadExpenses(
  filters: ExpenseFilters,
  from: number,
  to: number,
  opts: ChunkOpts = { count: true },
): Promise<{ rows: Expense[]; total: number | null }> {
  let q = scopeCompany(getSupabase().from('expenses').select(EXPENSE_SELECT, opts.count ? { count: 'exact' } : undefined))
  if (!filters.includeDeleted) q = q.is('deleted_at', null)
  if (filters.categoryId) q = q.eq('category_id', filters.categoryId)
  if (filters.objectId === NO_OBJECT) q = q.is('object_id', null)
  else if (filters.objectId) q = q.eq('object_id', filters.objectId)
  if (filters.payerId) q = q.eq('payer_id', filters.payerId)
  if (filters.from) q = q.gte('spent_at', filters.from)
  if (filters.to) q = q.lt('spent_at', filters.to)
  if (opts.before) q = q.lte('created_at', opts.before)
  let ranged = q
    .order('spent_at', { ascending: false })
    .order('created_at', { ascending: false })
    .order('id')
    .range(from, to)
  if (opts.signal) ranged = ranged.abortSignal(opts.signal)
  const { data, error, count } = await ranged
  if (error) throw toRepoError(error)
  return { rows: await finish((data ?? []) as unknown as RawExpense[]), total: count ?? null }
}

/**
 * Mening xarajatlarim (Telegram ilovasi "Yozuvlar"): to'lovchi yoki kirituvchi — men. O'chirilganlari ham
 * (RLS muallifga ko'rsatadi).
 */
export async function listMyExpenses(profileId: string, limit = 50): Promise<Expense[]> {
  const { data, error } = await getSupabase()
    .from('expenses')
    .select(EXPENSE_SELECT)
    .or(`payer_id.eq.${profileId},created_by.eq.${profileId}`)
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) throw toRepoError(error)
  return finish((data ?? []) as unknown as RawExpense[], false)
}

/** O'chirish — faqat admin (expenses_update RLS). */
export function softDeleteExpense(id: string): Promise<void> {
  return softDeleteById('expenses', id)
}

/** Tiklash — faqat admin (`restore_admin_only`; nofaol tur — `expense_category_inactive`). */
export function restoreExpense(id: string): Promise<void> {
  return updateById('expenses', id, { deleted_at: null })
}

export interface ExpenseCategoryUsage {
  categoryId: string
  useCount: number
  lastUsedAt: string
}

/** Joriy foydalanuvchi oxirgi `days` kunda qaysi turlarni qancha ishlatgan (tugmalar tartibi). */
export async function getMyExpenseCategoryUsage(days = 30): Promise<ExpenseCategoryUsage[]> {
  const { data, error } = await getSupabase().rpc('my_expense_category_usage', { p_days: days })
  if (error) throw toRepoError(error)
  return ((data ?? []) as { category_id: string; use_count: number | string; last_used_at: string }[]).map((r) => ({
    categoryId: r.category_id,
    useCount: Number(r.use_count),
    lastUsedAt: r.last_used_at,
  }))
}
