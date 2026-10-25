import { closeAlert } from './alertsRepo'
import { CASH_HISTORY_LIMIT, issueAdvance, listCashHistory } from './cashRepo'
import { createMovement } from './movementsRepo'
import { checkPurchasePrice, createPurchase, listMyPurchases, listPurchases } from './purchasesRepo'
import { createSupplier } from './suppliersRepo'

type Call = [string, ...unknown[]]

const fake = vi.hoisted(() => ({ calls: [] as [string, ...unknown[]][], results: [] as unknown[] }))

function fakeQuery(calls: Call[], result: () => unknown): unknown {
  const q: unknown = new Proxy(
    {},
    {
      get(_target, prop: string) {
        if (prop === 'then') {
          return (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
            Promise.resolve(result()).then(resolve, reject)
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
      return fakeQuery(fake.calls, () => fake.results.shift())
    },
    rpc: (fn: string, args: unknown) => {
      fake.calls.push(['rpc', fn, args])
      return Promise.resolve(fake.results.shift())
    },
  }),
}))

beforeEach(() => {
  fake.calls.length = 0
  fake.results.length = 0
})

const arg = (method: string) => fake.calls.find((c) => c[0] === method)?.[1]

const raw = {
  id: 'pu1',
  qty_input: '3',
  qty_base: '150',
  total_amount: '1250000',
  object: { name: 'Obyekt A' },
  material: { name: 'Sement', base_unit: 'kg' },
  buyer: { full_name: 'Ali' },
  supplier: null,
}

const input = {
  id: 'd1',
  companyId: 'c',
  objectId: 'o',
  materialId: 'm',
  unitId: 'u',
  qtyInput: '3',
  totalAmount: '1250000',
  buyerId: 'p1',
}

describe('purchasesRepo', () => {
  it('createPurchase: summa va miqdor satr; narxlar yuborilmaydi', async () => {
    fake.results.push({ data: raw, error: null })
    const saved = await createPurchase({ ...input, note: ' ', receiptPhotoPath: '' })
    expect(arg('insert')).toEqual({
      id: 'd1',
      company_id: 'c',
      object_id: 'o',
      material_id: 'm',
      unit_id: 'u',
      qty_input: '3',
      total_amount: '1250000',
      supplier_id: null,
      receipt_photo_path: null,
      note: null,
      buyer_id: 'p1',
    })
    expect(String(arg('select'))).toContain('price_per_base::text')
    expect(saved).toMatchObject({ material_name: 'Sement', base_unit: 'kg', buyer_name: 'Ali', alert_types: [] })
  })

  it('createPurchase: purchases_pkey 23505 (hint\'siz) — saqlangan qator qaytadi', async () => {
    fake.results.push({ data: null, error: { code: '23505', message: 'violates "purchases_pkey"', hint: null } })
    fake.results.push({ data: raw, error: null })
    fake.results.push({ data: [{ purchase_id: 'pu1', received_qty_base: '100', remaining_qty_base: '50', receipt_count: 1 }], error: null })
    fake.results.push({ data: [], error: null })
    const saved = await createPurchase(input)
    expect(saved.id).toBe('pu1')
    expect(saved.receipt).toMatchObject({ received_qty_base: '100', remaining_qty_base: '50' })
  })

  it('createPurchase: hint\'li 23505 — xato', async () => {
    fake.results.push({ data: null, error: { code: '23505', message: 'x', hint: 'ops_photo_reused' } })
    await expect(createPurchase(input)).rejects.toMatchObject({ code: 'ops_photo_reused' })
  })

  it('listPurchases: qabul holati va ochiq alert turlari qo‘shiladi', async () => {
    fake.results.push({ data: [raw], error: null, count: 1 })
    fake.results.push({ data: [{ purchase_id: 'pu1', received_qty_base: '160', remaining_qty_base: '-10', receipt_count: 2 }], error: null })
    fake.results.push({ data: [{ purchase_id: 'pu1', type: 'xarid_qabul_farqi' }], error: null })
    const page = await listPurchases({ buyerId: 'p1' }, 0)
    expect(page.rows[0]?.receipt?.received_qty_base).toBe('160')
    expect(page.rows[0]?.alert_types).toEqual(['xarid_qabul_farqi'])
    expect(fake.calls).toContainEqual(['in', 'status', ['yangi', 'korildi']])
    expect(fake.calls).toContainEqual(['eq', 'buyer_id', 'p1'])
  })
})

describe('boshqa repo idempotentligi', () => {
  it('createMovement: purchaseId faqat kirimda yuboriladi', async () => {
    fake.results.push({ data: { id: 'mv1' }, error: null })
    await createMovement({ id: 'd', companyId: 'c', type: 'kirim', objectId: 'o', materialId: 'm', unitId: 'u', qtyInput: '1', purchaseId: 'pu1' })
    expect((arg('insert') as Record<string, unknown>).purchase_id).toBe('pu1')
    fake.calls.length = 0
    fake.results.push({ data: { id: 'mv2' }, error: null })
    await createMovement({ id: 'd', companyId: 'c', type: 'chiqim', objectId: 'o', materialId: 'm', unitId: 'u', qtyInput: '1', purchaseId: 'pu1' })
    expect(arg('insert')).not.toHaveProperty('purchase_id')
  })

  it('issueAdvance: cash_advances_pkey 23505 — saqlangan qator', async () => {
    fake.results.push({ data: null, error: { code: '23505', message: 'violates "cash_advances_pkey"', hint: null } })
    fake.results.push({ data: { id: 'ca1', amount: '500000', recipient: { full_name: 'Ali' }, creator: null }, error: null })
    const saved = await issueAdvance({ id: 'ca1', companyId: 'c', recipientId: 'p1', amount: '500000' })
    expect(saved).toMatchObject({ id: 'ca1', recipient_name: 'Ali' })
  })

  it('createSupplier: supplier_duplicate — shu nomli mavjud sotuvchi qaytadi', async () => {
    fake.results.push({ data: null, error: { code: '23505', message: 'x', hint: 'supplier_duplicate' } })
    fake.results.push({ data: null, error: null })
    fake.results.push({ data: [{ id: 's1', name: 'Chilonzor  Bozori' }], error: null })
    const s = await createSupplier({ id: 'new', companyId: 'c', name: ' chilonzor bozori ' })
    expect(s.id).toBe('s1')
    expect((arg('insert') as Record<string, unknown>).name).toBe('chilonzor bozori')
  })
})

describe('sharh tuzatishlari (repo)', () => {
  it('checkPurchasePrice: RPC check_purchase_price, narx satr; noma’lum javob → ok', async () => {
    fake.results.push({ data: 'high', error: null })
    expect(await checkPurchasePrice('m1', '8333.3333')).toBe('high')
    expect(fake.calls).toContainEqual(['rpc', 'check_purchase_price', { p_material_id: 'm1', p_price_per_base: '8333.3333' }])
    fake.results.push({ data: 'weird', error: null })
    expect(await checkPurchasePrice('m1', '1')).toBe('ok')
  })

  it('listMyPurchases: buyer_id yoki created_by = men', async () => {
    fake.results.push({ data: [], error: null })
    await listMyPurchases('p1', 50)
    expect(fake.calls).toContainEqual(['or', 'buyer_id.eq.p1,created_by.eq.p1'])
  })

  it('listCashHistory: ikki manba birlashtirilib sana bo‘yicha tartiblanadi va umumiy chegara bilan kesiladi', async () => {
    const day = (i: number) => new Date(Date.UTC(2026, 0, 1) + i * 3600_000).toISOString()
    const issued = Array.from({ length: CASH_HISTORY_LIMIT }, (_, i) => ({ id: 'a' + i, recipient_id: 'p', amount: '1', issued_at: day(2 * i) }))
    const spent = Array.from({ length: CASH_HISTORY_LIMIT }, (_, i) => ({ id: 's' + i, buyer_id: 'p', total_amount: '1', purchased_at: day(2 * i + 1) }))
    fake.results.push({ data: issued, error: null }, { data: spent, error: null })
    const rows = await listCashHistory({ includeDeleted: true })
    expect(rows).toHaveLength(CASH_HISTORY_LIMIT)
    // eng yangisi — oxirgi xarid (2*199+1 soat)
    expect(rows[0]?.id).toBe('s' + (CASH_HISTORY_LIMIT - 1))
    expect(rows[1]?.id).toBe('a' + (CASH_HISTORY_LIMIT - 1))
    // includeDeleted — ikkala jadvalda ham deleted_at filtri yo'q
    expect(fake.calls.filter((c) => c[0] === 'is')).toEqual([])
  })

  it('listCashHistory: odatda o‘chirilganlar ikkala manbada ham chiqarilmaydi', async () => {
    fake.results.push({ data: [], error: null }, { data: [], error: null })
    await listCashHistory({})
    expect(fake.calls.filter((c) => c[0] === 'is')).toEqual([
      ['is', 'deleted_at', null],
      ['is', 'deleted_at', null],
    ])
  })

  it('closeAlert: sabab qirqiladi (500), bo‘sh — null; closed_by yuborilmaydi', async () => {
    fake.results.push({ data: { id: 'a1' }, error: null })
    await closeAlert('a1', '  ' + 'x'.repeat(600))
    const row = arg('update') as Record<string, unknown>
    expect(row.status).toBe('yopildi')
    expect(String(row.close_note)).toHaveLength(500)
    expect(row).not.toHaveProperty('closed_by')
    fake.calls.length = 0
    fake.results.push({ data: { id: 'a1' }, error: null })
    await closeAlert('a1', '   ')
    expect((arg('update') as Record<string, unknown>).close_note).toBeNull()
  })
})
