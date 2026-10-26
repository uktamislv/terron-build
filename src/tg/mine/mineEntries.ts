// Telegram ilovasi "Yozuvlarim" — yozuv turlari va ro'yxatni birlashtirish (sof).
import type { BugReport } from '@/data/bugReportsRepo'
import type { CashAdvance, InventoryCount, MaterialRequest, Movement, Purchase, Transfer } from '@/data/types'
import { can, type Role } from '@/domain/roles'

export const MINE_LIMIT = 50

export type Entry =
  | { kind: 'movement'; key: string; at: string; row: Movement }
  | { kind: 'purchase'; key: string; at: string; row: Purchase }
  | { kind: 'request'; key: string; at: string; row: MaterialRequest }
  | { kind: 'transfer'; key: string; at: string; row: Transfer }
  | { kind: 'count'; key: string; at: string; row: InventoryCount }
  | { kind: 'cash'; key: string; at: string; row: CashAdvance }
  | { kind: 'bug'; key: string; at: string; row: BugReport }

export type PlanEntry = Extract<Entry, { kind: 'request' | 'transfer' }>
export type RecordEntry = Extract<Entry, { kind: 'movement' | 'purchase' }>
export type OtherEntry = Extract<Entry, { kind: 'count' | 'cash' | 'bug' }>

export interface Sources {
  purchases: boolean
  requests: boolean
  counts: boolean
  cashRecipient: boolean
  cashCreator: boolean
}

/** Rol bo'yicha qaysi ro'yxatlar yuklanadi (keraksiz so'rov yo'q). */
export function mineSources(role: Role): Sources {
  return {
    purchases: can(role, 'create_purchase'),
    requests: can(role, 'create_request'),
    counts: can(role, 'run_inventory'),
    // Pul oluvchi — xarid kiritadiganlar; pul beruvchi — admin, buxgalter
    cashRecipient: can(role, 'create_purchase'),
    cashCreator: can(role, 'issue_cash'),
  }
}

/**
 * Kirim/chiqim, xaridlar, so'rovlar, o'tkazmalar, sanashlar, pul va xatolik xabarlari aralash, kiritilgan
 * vaqt bo'yicha (yangisi birinchi). O'tkazmalar yuklangan bo'lsa, ularning `transfer_out` harakati
 * alohida ko'rsatilmaydi (takror bo'lmasin).
 */
export function mergeEntries(
  movements: Movement[],
  purchases: Purchase[],
  requests: MaterialRequest[] = [],
  transfers: Transfer[] | null = null,
  extra: { counts?: InventoryCount[]; cash?: CashAdvance[]; bugs?: BugReport[] } = {},
): Entry[] {
  const shownMovements = transfers ? movements.filter((m) => m.type !== 'transfer_out') : movements
  const cash = [...new Map((extra.cash ?? []).map((c) => [c.id, c])).values()]
  const list: Entry[] = [
    ...shownMovements.map((row): Entry => ({ kind: 'movement', key: `m:${row.id}`, at: row.created_at, row })),
    ...purchases.map((row): Entry => ({ kind: 'purchase', key: `p:${row.id}`, at: row.created_at, row })),
    ...requests.map((row): Entry => ({ kind: 'request', key: `r:${row.id}`, at: row.created_at, row })),
    ...(transfers ?? []).map((row): Entry => ({ kind: 'transfer', key: `t:${row.id}`, at: row.created_at, row })),
    ...(extra.counts ?? []).map((row): Entry => ({ kind: 'count', key: `c:${row.id}`, at: row.created_at, row })),
    ...cash.map((row): Entry => ({ kind: 'cash', key: `a:${row.id}`, at: row.created_at, row })),
    ...(extra.bugs ?? []).map((row): Entry => ({ kind: 'bug', key: `b:${row.id}`, at: row.created_at, row })),
  ]
  return list.sort((a, b) => Date.parse(b.at) - Date.parse(a.at)).slice(0, MINE_LIMIT)
}

