import { isPkeyConflict, toRepoError } from './errors'
import { EXPORT_MAX_ROWS, fetchAll } from './fetchAll'
import { softDeleteById, updateById } from './rowUpdate'
import { directoryNames } from './profileDirectory'
import { getSupabase } from './supabaseClient'
import type { CashAdvance, CashAdvanceKind, CashBalance } from './types'

const BALANCE_COLUMNS =
  'company_id, profile_id, issued_total::text, returned_total::text, spent_total::text, balance::text, last_issued_at, last_spent_at'

const ADVANCE_SELECT =
  'id, company_id, recipient_id, kind, amount::text, issued_at, note, created_by, created_at, deleted_at'

const SPENT_SELECT =
  'id, buyer_id, total_amount::text, purchased_at, note, deleted_at, ' +
  'material:materials!purchases_material_fkey(name), ' +
  'object:objects!purchases_object_fkey(name)'

const EXPENSE_SPENT_SELECT =
  'id, payer_id, amount::text, spent_at, note, deleted_at, ' +
  'category:expense_categories!expenses_category_fkey(name), ' +
  'object:objects!expenses_object_fkey(name)'

export const CASH_HISTORY_LIMIT = 200

/** Balans qatori yo'q (hech narsa berilmagan va sarflanmagan) — nol. */
export function emptyBalance(companyId: string, profileId: string): CashBalance {
  return {
    company_id: companyId,
    profile_id: profileId,
    issued_total: '0',
    returned_total: '0',
    spent_total: '0',
    balance: '0',
    last_issued_at: null,
    last_spent_at: null,
  }
}

/** Joriy foydalanuvchining qo'lidagi pul (`cash_balances`, RLS chaqiruvchi huquqida). */
export async function getMyBalance(companyId: string, profileId: string): Promise<CashBalance> {
  const { data, error } = await getSupabase()
    .from('cash_balances')
    .select(BALANCE_COLUMNS)
    .eq('profile_id', profileId)
    .maybeSingle()
  if (error) throw toRepoError(error)
  return (data as unknown as CashBalance | null) ?? emptyBalance(companyId, profileId)
}

/** Odamlar bo'yicha qo'limdagi pul (admin, direktor, buxgalter — hamma; boshqalar — o'zi). */
export async function listBalances(): Promise<CashBalance[]> {
  const { data, error } = await getSupabase().from('cash_balances').select(BALANCE_COLUMNS)
  if (error) throw toRepoError(error)
  return (data ?? []) as unknown as CashBalance[]
}

export interface NewAdvance {
  /** Klient id'si — qayta urinishda ikki marta berilmasin. */
  id: string
  companyId: string
  recipientId: string
  /** Dec satr, so'm. */
  amount: string
  /** ISO; berilmasa — server `now()`. */
  issuedAt?: string | null
  note?: string | null
  /** Batch 12 (I): `qaytarildi` — odam pulni qaytardi (balansdan ayriladi). Standart — `berildi`. */
  kind?: CashAdvanceKind
}

type RawAdvance = Omit<CashAdvance, 'recipient_name' | 'created_by_name'>

function normalizeAdvance(raw: RawAdvance, names?: Map<string, { full_name: string }>): CashAdvance {
  return {
    ...raw,
    recipient_name: names?.get(raw.recipient_id)?.full_name ?? null,
    created_by_name: raw.created_by ? (names?.get(raw.created_by)?.full_name ?? null) : null,
  }
}

/** Ismlar — `profile_directory` dan (admin bo'lmaganlar `profiles` dan faqat o'zini ko'radi). */
async function advancesWithNames(rows: RawAdvance[]): Promise<CashAdvance[]> {
  if (rows.length === 0) return []
  const names = await directoryNames(rows.flatMap((r) => [r.recipient_id, r.created_by]))
  return rows.map((r) => normalizeAdvance(r, names))
}

/** Pul berish (podotchet). Idempotent: `cash_advances_pkey` 23505 — saqlangan qator qaytariladi. */
export async function issueAdvance(input: NewAdvance): Promise<CashAdvance> {
  const note = input.note?.trim()
  const row: Record<string, unknown> = {
    id: input.id,
    company_id: input.companyId,
    recipient_id: input.recipientId,
    amount: input.amount,
    note: note ? note : null,
  }
  if (input.kind === 'qaytarildi') row.kind = 'qaytarildi'
  if (input.issuedAt) row.issued_at = input.issuedAt
  const { data, error } = await getSupabase().from('cash_advances').insert(row).select(ADVANCE_SELECT).single()
  if (error) {
    if (isPkeyConflict(error, 'cash_advances_pkey')) {
      const { data: existing } = await getSupabase()
        .from('cash_advances')
        .select(ADVANCE_SELECT)
        .eq('id', input.id)
        .maybeSingle()
      if (existing) return (await advancesWithNames([existing as unknown as RawAdvance]))[0] as CashAdvance
    }
    throw toRepoError(error)
  }
  return (await advancesWithNames([data as unknown as RawAdvance]))[0] as CashAdvance
}

/**
 * Izohni o'zgartirish (admin, buxgalter). Summa va sana o'zgarmaydi (`cash_amount_locked`) —
 * faqat `note` yuboriladi.
 */
export async function updateAdvanceNote(id: string, note: string | null): Promise<void> {
  const clean = note?.trim().slice(0, 1000)
  return updateById('cash_advances', id, { note: clean ? clean : null })
}

/** Tarix yozuvi: berilgan pul, qaytarilgan pul yoki xarid / xarajatga sarflangan pul. */
export type CashHistoryEntry =
  | {
      kind: 'issued' | 'returned'
      id: string
      profileId: string
      profileName: string | null
      amount: string
      at: string
      note: string | null
      createdByName: string | null
      deletedAt: string | null
    }
  | {
      kind: 'spent'
      /** `purchase` — material xaridi; `expense` — boshqa xarajat (oziq-ovqat, yoqilg'i …). Yo'q — xarid. */
      source?: 'purchase' | 'expense'
      id: string
      profileId: string
      profileName: string | null
      amount: string
      at: string
      note: string | null
      /** Xaridda — material, xarajatda — xarajat turi. */
      materialName: string | null
      /** Xarajatda null — "Umumiy" (obyektsiz) yoki obyekt ko'rinmaydi. */
      objectName: string | null
      deletedAt: string | null
    }

interface RawSpent {
  id: string
  buyer_id: string
  total_amount: string
  purchased_at: string
  note: string | null
  deleted_at: string | null
  material: { name: string } | null
  object: { name: string } | null
}

interface RawExpenseSpent {
  id: string
  payer_id: string
  amount: string
  spent_at: string
  note: string | null
  deleted_at: string | null
  category: { name: string } | null
  object: { name: string } | null
}

/**
 * Berilgan va sarflangan pul tarixi (yangisi birinchi). `profileId` — bitta odam bo'yicha. Sarflangan —
 * podotchetdan to'langan xaridlar va xarajatlar. `includeDeleted` — o'chirilganlar ham (RLS ruxsat bergan rollarga).
 */
export async function listCashHistory(
  opts: { profileId?: string; includeDeleted?: boolean } = {},
): Promise<CashHistoryEntry[]> {
  let issuedQ = getSupabase().from('cash_advances').select(ADVANCE_SELECT)
  // Firma to'lagan xaridlar / xarajatlar ('firma') podotchet hisobiga kirmaydi
  let spentQ = getSupabase().from('purchases').select(SPENT_SELECT).eq('payment_source', 'podotchet')
  let expenseQ = getSupabase().from('expenses').select(EXPENSE_SPENT_SELECT).eq('payment_source', 'podotchet')
  if (!opts.includeDeleted) {
    issuedQ = issuedQ.is('deleted_at', null)
    spentQ = spentQ.is('deleted_at', null)
    expenseQ = expenseQ.is('deleted_at', null)
  }
  if (opts.profileId) {
    issuedQ = issuedQ.eq('recipient_id', opts.profileId)
    spentQ = spentQ.eq('buyer_id', opts.profileId)
    expenseQ = expenseQ.eq('payer_id', opts.profileId)
  }
  const [issued, spent, expenses] = await Promise.all([
    issuedQ.order('issued_at', { ascending: false }).limit(CASH_HISTORY_LIMIT),
    spentQ.order('purchased_at', { ascending: false }).limit(CASH_HISTORY_LIMIT),
    expenseQ.order('spent_at', { ascending: false }).limit(CASH_HISTORY_LIMIT),
  ])
  if (issued.error) throw toRepoError(issued.error)
  if (spent.error) throw toRepoError(spent.error)
  if (expenses.error) throw toRepoError(expenses.error)
  const entries = await mergeHistory(
    (issued.data ?? []) as unknown as RawAdvance[],
    (spent.data ?? []) as unknown as RawSpent[],
    (expenses.data ?? []) as unknown as RawExpenseSpent[],
  )
  // Manbalar birlashtirilgach sana bo'yicha tartiblanadi, keyin umumiy chegara bo'yicha kesiladi
  return entries.slice(0, CASH_HISTORY_LIMIT)
}

async function mergeHistory(issued: RawAdvance[], spent: RawSpent[], expenses: RawExpenseSpent[] = []): Promise<CashHistoryEntry[]> {
  const names = await directoryNames([
    ...issued.flatMap((r) => [r.recipient_id, r.created_by]),
    ...spent.map((p) => p.buyer_id),
    ...expenses.map((e) => e.payer_id),
  ])
  const entries: CashHistoryEntry[] = [
    ...issued.map((r) => normalizeAdvance(r, names)).map(
      (a): CashHistoryEntry => ({
        kind: a.kind === 'qaytarildi' ? 'returned' : 'issued',
        id: a.id,
        profileId: a.recipient_id,
        profileName: a.recipient_name,
        amount: a.amount,
        at: a.issued_at,
        note: a.note,
        createdByName: a.created_by_name,
        deletedAt: a.deleted_at,
      }),
    ),
    ...spent.map(
      (p): CashHistoryEntry => ({
        kind: 'spent',
        source: 'purchase',
        id: p.id,
        profileId: p.buyer_id,
        profileName: names.get(p.buyer_id)?.full_name ?? null,
        amount: p.total_amount,
        at: p.purchased_at,
        note: p.note,
        materialName: p.material?.name ?? null,
        objectName: p.object?.name ?? null,
        deletedAt: p.deleted_at,
      }),
    ),
    ...expenses.map(
      (e): CashHistoryEntry => ({
        kind: 'spent',
        source: 'expense',
        id: e.id,
        profileId: e.payer_id,
        profileName: names.get(e.payer_id)?.full_name ?? null,
        amount: e.amount,
        at: e.spent_at,
        note: e.note,
        materialName: e.category?.name ?? null,
        objectName: e.object?.name ?? null,
        deletedAt: e.deleted_at,
      }),
    ),
  ]
  return entries.sort((a, b) => Date.parse(b.at) - Date.parse(a.at))
}

/**
 * Eksport: berilgan va sarflangan pulning to'liq tarixi (har manba 1000 tadan, jami ≤ 50 000).
 */
export async function listAllCashHistory(
  opts: { profileId?: string; includeDeleted?: boolean } = {},
  signal?: AbortSignal,
): Promise<CashHistoryEntry[]> {
  const issued = await fetchAll<RawAdvance>(
    async (req) => {
      let q = getSupabase()
        .from('cash_advances')
        .select(ADVANCE_SELECT, req.first ? { count: 'exact' } : undefined)
        .lte('created_at', req.before)
      if (!opts.includeDeleted) q = q.is('deleted_at', null)
      if (opts.profileId) q = q.eq('recipient_id', opts.profileId)
      let ranged = q.order('issued_at', { ascending: false }).order('id').range(req.from, req.to)
      if (req.signal) ranged = ranged.abortSignal(req.signal)
      const { data, error, count } = await ranged
      if (error) throw toRepoError(error)
      return { rows: (data ?? []) as unknown as RawAdvance[], total: count ?? null }
    },
    { signal },
  )
  const spent = await fetchAll<RawSpent>(
    async (req) => {
      let q = getSupabase()
        .from('purchases')
        .select(SPENT_SELECT, req.first ? { count: 'exact' } : undefined)
        .eq('payment_source', 'podotchet')
        .lte('created_at', req.before)
      if (!opts.includeDeleted) q = q.is('deleted_at', null)
      if (opts.profileId) q = q.eq('buyer_id', opts.profileId)
      let ranged = q.order('purchased_at', { ascending: false }).order('id').range(req.from, req.to)
      if (req.signal) ranged = ranged.abortSignal(req.signal)
      const { data, error, count } = await ranged
      if (error) throw toRepoError(error)
      return { rows: (data ?? []) as unknown as RawSpent[], total: count ?? null }
    },
    { signal, max: EXPORT_MAX_ROWS - issued.length },
  )
  const expenses = await fetchAll<RawExpenseSpent>(
    async (req) => {
      let q = getSupabase()
        .from('expenses')
        .select(EXPENSE_SPENT_SELECT, req.first ? { count: 'exact' } : undefined)
        .eq('payment_source', 'podotchet')
        .lte('created_at', req.before)
      if (!opts.includeDeleted) q = q.is('deleted_at', null)
      if (opts.profileId) q = q.eq('payer_id', opts.profileId)
      let ranged = q.order('spent_at', { ascending: false }).order('id').range(req.from, req.to)
      if (req.signal) ranged = ranged.abortSignal(req.signal)
      const { data, error, count } = await ranged
      if (error) throw toRepoError(error)
      return { rows: (data ?? []) as unknown as RawExpenseSpent[], total: count ?? null }
    },
    { signal, max: Math.max(1, EXPORT_MAX_ROWS - issued.length - spent.length) },
  )
  return mergeHistory(issued, spent, expenses)
}

export function softDeleteAdvance(id: string): Promise<void> {
  return softDeleteById('cash_advances', id)
}

/** Tiklash — faqat admin (baza `restore_admin_only`). */
export function restoreAdvance(id: string): Promise<void> {
  return updateById('cash_advances', id, { deleted_at: null })
}

/**
 * "Yozuvlarim" (Telegram ilovasi): `recipient` — menga berilgan / mendan qaytarilgan pul;
 * `creator` — men bergan (buxgalter, admin). Yangisi birinchi, o'chirilmaganlar.
 */
export async function listMyAdvances(profileId: string, as: 'recipient' | 'creator', limit = 50): Promise<CashAdvance[]> {
  const { data, error } = await getSupabase()
    .from('cash_advances')
    .select(ADVANCE_SELECT)
    .eq(as === 'recipient' ? 'recipient_id' : 'created_by', profileId)
    .is('deleted_at', null)
    .order('issued_at', { ascending: false })
    .limit(limit)
  if (error) throw toRepoError(error)
  return advancesWithNames((data ?? []) as unknown as RawAdvance[])
}
