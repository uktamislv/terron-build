// Xarajat turlari (`expense_categories`): ko'rish — firma a'zolari (tekshiruvchidan tashqari),
// qo'shish / o'zgartirish / o'chirish / tiklash — admin (RLS). Nom firma ichida takrorlanmaydi
// (`expense_category_duplicate`). docs/expenses-design.md, 1.
import { toRepoError } from './errors'
import { softDeleteById, updateById } from './rowUpdate'
import { scopeCompany } from './companyScope'
import { getSupabase } from './supabaseClient'
import type { ExpenseCategory } from './types'

export const EXPENSE_CATEGORY_COLUMNS =
  'id, company_id, name, monthly_limit::text, photo_required, is_active, sort_order, created_by, created_at, updated_at, deleted_at'

export const EXPENSE_CATEGORY_NAME_MAX = 80

export interface NewExpenseCategory {
  companyId: string
  name: string
  /** Dec satr (so'm) yoki null — limitsiz. */
  monthlyLimit?: string | null
  photoRequired?: boolean
  sortOrder?: number
}

export interface ExpenseCategoryPatch {
  name?: string
  monthlyLimit?: string | null
  photoRequired?: boolean
  isActive?: boolean
  sortOrder?: number
}

function patchRow(p: ExpenseCategoryPatch): Record<string, unknown> {
  const row: Record<string, unknown> = {}
  if (p.name !== undefined) row.name = p.name.trim().slice(0, EXPENSE_CATEGORY_NAME_MAX)
  if (p.monthlyLimit !== undefined) row.monthly_limit = p.monthlyLimit || null
  if (p.photoRequired !== undefined) row.photo_required = p.photoRequired
  if (p.isActive !== undefined) row.is_active = p.isActive
  if (p.sortOrder !== undefined) row.sort_order = p.sortOrder
  return row
}

/** Turlar `sort_order`, keyin nom bo'yicha. `includeDeleted` — o'chirilganlar ham (admin, direktor ko'radi). */
export async function listExpenseCategories(opts: { includeDeleted?: boolean } = {}): Promise<ExpenseCategory[]> {
  let q = scopeCompany(getSupabase().from('expense_categories').select(EXPENSE_CATEGORY_COLUMNS))
  if (!opts.includeDeleted) q = q.is('deleted_at', null)
  const { data, error } = await q.order('sort_order').order('name')
  if (error) throw toRepoError(error)
  return (data ?? []) as unknown as ExpenseCategory[]
}

export async function createExpenseCategory(input: NewExpenseCategory): Promise<ExpenseCategory> {
  const row = {
    company_id: input.companyId,
    ...patchRow({
      name: input.name,
      monthlyLimit: input.monthlyLimit ?? null,
      photoRequired: input.photoRequired ?? false,
      sortOrder: input.sortOrder ?? 0,
    }),
  }
  const { data, error } = await getSupabase().from('expense_categories').insert(row).select(EXPENSE_CATEGORY_COLUMNS).single()
  if (error) throw toRepoError(error)
  return data as unknown as ExpenseCategory
}

/** Nom, oylik limit, "rasm majburiy", faol/nofaol, tartib. */
export function updateExpenseCategory(id: string, patch: ExpenseCategoryPatch): Promise<void> {
  return updateById('expense_categories', id, patchRow(patch))
}

/**
 * Tartibni qayta yozish rejasi: berilgan tartibdagi har tur `sort_order = o'rni + 1`; o'zgarmaganlari tashlanadi.
 */
export function sortOrderPatches(ordered: readonly Pick<ExpenseCategory, 'id' | 'sort_order'>[]): { id: string; sortOrder: number }[] {
  return ordered.flatMap((c, i) => (c.sort_order === i + 1 ? [] : [{ id: c.id, sortOrder: i + 1 }]))
}

export function softDeleteExpenseCategory(id: string): Promise<void> {
  return softDeleteById('expense_categories', id)
}

export function restoreExpenseCategory(id: string): Promise<void> {
  return updateById('expense_categories', id, { deleted_at: null })
}
