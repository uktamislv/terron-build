import { toRepoError } from './errors'
import { correctEntry, cancelOwnEntry } from './correctionsRepo'
import { createExpenseCategory, listExpenseCategories, restoreExpenseCategory, softDeleteExpenseCategory, updateExpenseCategory } from './expenseCategoriesRepo'
import {
  createExpense,
  getMyExpenseCategoryUsage,
  listExpenses,
  listMyExpenses,
  NO_OBJECT,
  restoreExpense,
  softDeleteExpense,
} from './expensesRepo'
import { getEstimateVsSpend, getNormOverview, getSpendBreakdown, normalizeSummary } from './reportsRepo'

type Call = [string, ...unknown[]]

const fake = vi.hoisted(() => ({
  calls: [] as [string, ...unknown[]][],
  results: [] as unknown[],
  people: [] as { id: string; full_name: string; role: string }[],
}))

function fakeQuery(calls: Call[], result: () => unknown): unknown {
  const q: unknown = new Proxy(
    {},
    {
      get(_t, prop: string) {
        if (prop === 'then') {
          return (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) => Promise.resolve(result()).then(resolve, reject)
        }
        return (...args: unknown[]) => {
          calls.push([prop, ...args])
          return q
        }
      },
    },
  )
  return q
}

vi.mock('./supabaseClient', () => ({
  isSupabaseConfigured: () => true,
  getSupabase: () => ({
    from: (table: string) => {
      fake.calls.push(['from', table])
      if (table === 'profile_directory') return fakeQuery(fake.calls, () => ({ data: fake.people, error: null }))
      if (table === 'alerts') return fakeQuery(fake.calls, () => ({ data: [{ type: 'takroriy_yozuv', record_id: 'e1' }], error: null }))
      return fakeQuery(fake.calls, () => fake.results.shift() ?? { data: [], error: null })
    },
    rpc: (fn: string, args: unknown) => {
      fake.calls.push(['rpc', fn, args])
      return Promise.resolve(fake.results.shift() ?? { data: null, error: null })
    },
  }),
}))

beforeEach(() => {
  fake.calls.length = 0
  fake.results.length = 0
  fake.people.length = 0
})

const arg = (method: string) => fake.calls.find((c) => c[0] === method)?.[1]
const raw = {
  id: 'e1',
  company_id: 'c',
  category_id: 'k1',
  object_id: null,
  amount: '41000',
  spent_at: '2026-11-02T05:00:00Z',
  payer_id: 'p1',
  payment_source: 'podotchet',
  created_by: 'p1',
  created_at: '2026-11-02T05:00:00Z',
  deleted_at: null,
  category: { name: 'Oziq-ovqat' },
  object: null,
  supplier: null,
}

describe('expensesRepo', () => {
  it('createExpense: obyektsiz — object_id null, izoh qirqiladi, to‘lovchi va pul manbai; ism va tur nomi', async () => {
    fake.people.push({ id: 'p1', full_name: 'Ali', role: 'haydovchi' })
    fake.results.push({ data: raw, error: null })
    const e = await createExpense({
      id: 'e1',
      companyId: 'c',
      categoryId: 'k1',
      objectId: null,
      amount: '41000',
      note: '  tushlik  ',
      payerId: 'p1',
      paymentSource: 'firma',
      geo: { status: 'denied' },
    })
    const row = arg('insert') as Record<string, unknown>
    expect(row).toMatchObject({ id: 'e1', category_id: 'k1', object_id: null, amount: '41000', note: 'tushlik', payer_id: 'p1', payment_source: 'firma', geo_status: 'denied' })
    expect(row).not.toHaveProperty('receipt_photo_sha256')
    expect(row).not.toHaveProperty('spent_at')
    expect(e).toMatchObject({ category_name: 'Oziq-ovqat', object_name: null, payer_name: 'Ali' })
  })

  it('createExpense: qayta urinish (expenses_pkey 23505) — saqlangan qator o‘qiladi', async () => {
    fake.results.push({ data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint "expenses_pkey"' } })
    fake.results.push({ data: raw, error: null })
    const e = await createExpense({ id: 'e1', companyId: 'c', categoryId: 'k1', objectId: 'o1', amount: '1' })
    expect(e.id).toBe('e1')
  })

  it('listExpenses: filtrlar ("Umumiy" — object_id is null), tartib, alert belgilari details.record_id bo‘yicha', async () => {
    fake.results.push({ data: [raw], error: null, count: 1 })
    const page = await listExpenses({ categoryId: 'k1', objectId: NO_OBJECT, payerId: 'p1', from: 'A', to: 'B' })
    expect(fake.calls).toContainEqual(['is', 'object_id', null])
    expect(fake.calls).toContainEqual(['eq', 'category_id', 'k1'])
    expect(fake.calls).toContainEqual(['eq', 'payer_id', 'p1'])
    expect(fake.calls).toContainEqual(['gte', 'spent_at', 'A'])
    expect(fake.calls).toContainEqual(['lt', 'spent_at', 'B'])
    expect(fake.calls).toContainEqual(['is', 'deleted_at', null])
    expect(fake.calls).toContainEqual(['eq', 'details->>table', 'expenses'])
    expect(page.total).toBe(1)
    expect(page.rows[0]?.alert_types).toEqual(['takroriy_yozuv'])
  })

  it('listMyExpenses: to‘lovchi yoki kirituvchi', async () => {
    fake.results.push({ data: [raw], error: null })
    await listMyExpenses('p1', 10)
    expect(fake.calls).toContainEqual(['or', 'payer_id.eq.p1,created_by.eq.p1'])
    expect(fake.calls).toContainEqual(['limit', 10])
  })

  it('softDelete / restore', async () => {
    fake.results.push({ data: { id: 'e1' }, error: null }, { data: { id: 'e1' }, error: null })
    await softDeleteExpense('e1')
    await restoreExpense('e1')
    const updates = fake.calls.filter((c) => c[0] === 'update').map((c) => c[1] as Record<string, unknown>)
    expect(updates[0]?.deleted_at).toBeTruthy()
    expect(updates[1]).toEqual({ deleted_at: null })
  })

  it('my_expense_category_usage', async () => {
    fake.results.push({ data: [{ category_id: 'k1', use_count: '3', last_used_at: 'x' }], error: null })
    expect(await getMyExpenseCategoryUsage(30)).toEqual([{ categoryId: 'k1', useCount: 3, lastUsedAt: 'x' }])
    expect(fake.calls).toContainEqual(['rpc', 'my_expense_category_usage', { p_days: 30 }])
  })

  it('correct_entry(expenses): faqat summa, izoh, sabab, obyekt; miqdor/birlik/material — null', async () => {
    fake.results.push({ data: null, error: null })
    await correctEntry({ table: 'expenses', id: 'e1', qtyInput: null, unitId: null, totalAmount: '45000', reason: ' chek ', note: null, objectId: 'o1', materialId: 'm' })
    expect(fake.calls).toContainEqual([
      'rpc',
      'correct_entry',
      { p_table: 'expenses', p_id: 'e1', p_qty_input: null, p_unit_id: null, p_total_amount: '45000', p_reason: 'chek', p_note: null, p_material_id: null, p_object_id: 'o1' },
    ])
    fake.results.push({ data: null, error: null })
    await cancelOwnEntry('expenses', 'e1', 'ikki marta')
    expect(fake.calls).toContainEqual(['rpc', 'cancel_own_entry', { p_table: 'expenses', p_id: 'e1', p_reason: 'ikki marta' }])
  })
})

describe('expenseCategoriesRepo', () => {
  it('list: o‘chirilmaganlar, sort_order va nom bo‘yicha', async () => {
    fake.results.push({ data: [], error: null })
    await listExpenseCategories()
    expect(fake.calls).toContainEqual(['is', 'deleted_at', null])
    expect(fake.calls).toContainEqual(['order', 'sort_order'])
  })

  it('create / update / softDelete / restore', async () => {
    fake.results.push({ data: { id: 'k1' }, error: null })
    await createExpenseCategory({ companyId: 'c', name: '  Ijara ', monthlyLimit: '5000000', photoRequired: true, sortOrder: 7 })
    expect(arg('insert')).toEqual({ company_id: 'c', name: 'Ijara', monthly_limit: '5000000', photo_required: true, sort_order: 7 })
    fake.calls.length = 0
    fake.results.push({ data: { id: 'k1' }, error: null })
    await updateExpenseCategory('k1', { monthlyLimit: null, isActive: false })
    expect(arg('update')).toEqual({ monthly_limit: null, is_active: false })
    fake.results.push({ data: { id: 'k1' }, error: null }, { data: { id: 'k1' }, error: null })
    await softDeleteExpenseCategory('k1')
    await restoreExpenseCategory('k1')
  })

  it('hint kalitlari', () => {
    expect(toRepoError({ code: '23505', hint: 'expense_category_duplicate' }).code).toBe('expense_category_duplicate')
    expect(toRepoError({ code: 'P0001', hint: 'expense_category_inactive' }).code).toBe('expense_category_inactive')
    expect(toRepoError({ code: '23514', hint: 'expense_payer_invalid' }).code).toBe('expense_payer_invalid')
  })
})

describe('reportsRepo — xarajatlar', () => {
  it('normalizeSummary: expense_count, expense_sum, expense_by_category, spend_total_sum', () => {
    const s = normalizeSummary({
      expense_count: '3',
      expense_sum: '120000.00',
      spend_total_sum: '1120000.00',
      expense_by_category: [{ category_id: 'k1', category_name: 'Oziq-ovqat', sum: '100000.00', count: 2 }, null],
    })
    expect(s.expense_count).toBe(3)
    expect(s.expense_sum).toBe('120000.00')
    expect(s.spend_total_sum).toBe('1120000.00')
    expect(s.expense_by_category).toEqual([{ category_id: 'k1', category_name: 'Oziq-ovqat', sum: '100000.00', count: 2 }])
    expect(normalizeSummary({}).expense_by_category).toEqual([])
  })

  it('spend_breakdown: yangi ustunlar va category guruhi', async () => {
    fake.results.push({
      data: [{ key: 'k1', label: 'Oziq-ovqat', purchases_sum: '0', purchases_count: 0, expenses_sum: '100', expenses_count: 2, total_sum: '100' }],
      error: null,
    })
    const rows = await getSpendBreakdown({ from: '2026-11-01', to: '2026-11-30' }, 'category')
    expect(fake.calls).toContainEqual(['rpc', 'spend_breakdown', { p_from: '2026-11-01', p_to: '2026-11-30', p_object_id: null, p_group: 'category' }])
    expect(rows[0]).toEqual({ key: 'k1', label: 'Oziq-ovqat', purchases_sum: '0', purchases_count: 0, expenses_sum: '100', expenses_count: 2, total_sum: '100' })
  })

  it('norm_overview.outside_estimate', async () => {
    fake.results.push({ data: [{ object_id: 'o', material_id: 'm', outside_estimate: true }], error: null })
    expect((await getNormOverview())[0]?.outside_estimate).toBe(true)
  })

  it('smeta va haqiqiy: material va boshqa xarajat alohida', async () => {
    // spend_breakdown (rpc) birinchi chaqiriladi, keyin estimates so'rovi kutiladi
    fake.results.push({
      data: [{ key: 'o1', label: 'A', purchases_sum: '100', purchases_count: 1, expenses_sum: '30', expenses_count: 1, total_sum: '130' }],
      error: null,
    })
    fake.results.push({ data: [], error: null })
    fake.results.push({ data: [{ id: 'o1', name: 'A' }], error: null })
    const rows = await getEstimateVsSpend({ from: '2026-11-01', to: '2026-11-30' })
    expect(rows).toEqual([{ object_id: 'o1', object_name: 'A', estimate_sum: null, spent_sum: '130', material_sum: '100', expense_sum: '30' }])
  })
})
