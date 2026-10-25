import { isPkeyConflict, toRepoError } from './errors'
import { EXPORT_MAX_ROWS, fetchAll } from './fetchAll'
import { softDeleteById, updateById } from './rowUpdate'
import { getSupabase } from './supabaseClient'
import type { CashAdvance, CashAdvanceKind, CashBalance } from './types'

const BALANCE_COLUMNS =
  'company_id, profile_id, issued_total::text, returned_total::text, spent_total::text, balance::text, last_issued_at, last_spent_at'

const ADVANCE_SELECT =
  'id, company_id, recipient_id, kind, amount::text, issued_at, note, created_by, created_at, deleted_at, ' +
  'recipient:profiles!cash_advances_recipient_fkey(full_name), ' +
  'creator:profiles!cash_advances_created_by_fkey(full_name)'

const SPENT_SELECT =
  'id, buyer_id, total_amount::text, purchased_at, note, deleted_at, ' +
  'buyer:profiles!purchases_buyer_fkey(full_name), ' +
  'material:materials!purchases_material_fkey(name), ' +
  'object:objects!purchases_object_fkey(name)'

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

type RawAdvance = Omit<CashAdvance, 'recipient_name' | 'created_by_name'> & {
  recipient: { full_name: string } | null
  creator: { full_name: string } | null
}

function normalizeAdvance(raw: RawAdvance): CashAdvance {
  const { recipient, creator, ...rest } = raw
  return { ...rest, recipient_name: recipient?.full_name ?? null, created_by_name: creator?.full_name ?? null }
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
      if (existing) return normalizeAdvance(existing as unknown as RawAdvance)
    }
    throw toRepoError(error)
  }
  return normalizeAdvance(data as unknown as RawAdvance)
}

/** Tarix yozuvi: berilgan pul, qaytarilgan pul yoki xaridga sarflangan pul. */
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
      id: string
      profileId: string
      profileName: string | null
      amount: string
      at: string
      note: string | null
      materialName: string | null
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
  buyer: { full_name: string } | null
  material: { name: string } | null
  object: { name: string } | null
}

/**
 * Berilgan va sarflangan pul tarixi (yangisi birinchi). `profileId` — bitta odam bo'yicha.
 * `includeDeleted` — o'chirilgan berilmalar ham (RLS ruxsat bergan rollarga).
 */
export async function listCashHistory(
  opts: { profileId?: string; includeDeleted?: boolean } = {},
): Promise<CashHistoryEntry[]> {
  let issuedQ = getSupabase().from('cash_advances').select(ADVANCE_SELECT)
  let spentQ = getSupabase().from('purchases').select(SPENT_SELECT)
  if (!opts.includeDeleted) {
    issuedQ = issuedQ.is('deleted_at', null)
    spentQ = spentQ.is('deleted_at', null)
  }
  if (opts.profileId) {
    issuedQ = issuedQ.eq('recipient_id', opts.profileId)
    spentQ = spentQ.eq('buyer_id', opts.profileId)
  }
  const [issued, spent] = await Promise.all([
    issuedQ.order('issued_at', { ascending: false }).limit(CASH_HISTORY_LIMIT),
    spentQ.order('purchased_at', { ascending: false }).limit(CASH_HISTORY_LIMIT),
  ])
  if (issued.error) throw toRepoError(issued.error)
  if (spent.error) throw toRepoError(spent.error)
  const entries = mergeHistory(
    (issued.data ?? []) as unknown as RawAdvance[],
    (spent.data ?? []) as unknown as RawSpent[],
  )
  // Ikki manba birlashtirilgach sana bo'yicha tartiblanadi, keyin umumiy chegara bo'yicha kesiladi
  return entries.slice(0, CASH_HISTORY_LIMIT)
}

function mergeHistory(issued: RawAdvance[], spent: RawSpent[]): CashHistoryEntry[] {
  const entries: CashHistoryEntry[] = [
    ...issued.map(normalizeAdvance).map(
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
        id: p.id,
        profileId: p.buyer_id,
        profileName: p.buyer?.full_name ?? null,
        amount: p.total_amount,
        at: p.purchased_at,
        note: p.note,
        materialName: p.material?.name ?? null,
        objectName: p.object?.name ?? null,
        deletedAt: p.deleted_at,
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
  return mergeHistory(issued, spent)
}

export function softDeleteAdvance(id: string): Promise<void> {
  return softDeleteById('cash_advances', id)
}

/** Tiklash — faqat admin (baza `restore_admin_only`). */
export function restoreAdvance(id: string): Promise<void> {
  return updateById('cash_advances', id, { deleted_at: null })
}
