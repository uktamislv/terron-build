import {
  createEstimateMaterials,
  importEstimate,
  listEstimateItems,
  listEstimates,
  rememberEstimateAliases,
  setCurrentEstimate,
} from './estimatesRepo'
import { saveTemplate } from './estimateTemplatesRepo'

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

const all = (method: string) => fake.calls.filter((c) => c[0] === method)

describe('estimatesRepo', () => {
  it('importEstimate: RPC argumentlari — p_items satr qiymatlar bilan, norm_qty_base yo‘q', async () => {
    fake.results.push({ data: 'e9', error: null })
    const items = [
      { item_type: 'material' as const, name: 'Sement', material_id: 'm', unit: 'т', unit_id: 'u', qty: '2.5', unit_price: '1500000', code: '1', row_number: 4, sort_order: 1 },
    ]
    const id = await importEstimate({ id: 'e9', objectId: 'o', title: ' Smeta ', sourceFileName: 'a.xlsx', estimateDate: null, items })
    expect(id).toBe('e9')
    expect(all('rpc')[0]).toEqual([
      'rpc',
      'import_estimate',
      { p_id: 'e9', p_object_id: 'o', p_title: 'Smeta', p_source_file_name: 'a.xlsx', p_estimate_date: null, p_items: items },
    ])
  })

  it('importEstimate: estimate_item_invalid — server xabari foydalanuvchiga', async () => {
    fake.results.push({ data: null, error: { code: '22023', hint: 'estimate_item_invalid', message: 'Qator 12: miqdor 0' } })
    await expect(importEstimate({ id: 'e', objectId: 'o', title: 't', sourceFileName: null, estimateDate: null, items: [] })).rejects.toMatchObject({
      code: 'estimate_item_invalid',
      userMessage: 'Qator 12: miqdor 0',
    })
  })

  it('setCurrentEstimate: RPC', async () => {
    fake.results.push({ data: null, error: null })
    await setCurrentEstimate('e1')
    expect(all('rpc')[0]).toEqual(['rpc', 'set_current_estimate', { p_estimate_id: 'e1' }])
  })

  it('listEstimates: soni va jami estimate_totals view’dan (barcha qatorlar tortilmaydi)', async () => {
    fake.results.push({ data: [{ id: 'e1' }, { id: 'e2' }], error: null })
    fake.results.push({ data: [{ estimate_id: 'e1', row_count: 1001, material_count: 7, total_sum: '100.50' }], error: null })
    const list = await listEstimates('o')
    expect(list).toMatchObject([
      { id: 'e1', item_count: 1001, material_count: 7, total_sum: '100.50' },
      { id: 'e2', item_count: 0, material_count: 0, total_sum: '0' },
    ])
    expect(all('from').map((c) => c[1])).toEqual(['estimates', 'estimate_totals'])
    expect(String(all('select')[1]?.[1])).toContain('total_sum::text')
    expect(all('in')[0]).toEqual(['in', 'estimate_id', ['e1', 'e2']])
  })

  it('listEstimateItems: numeric ::text va material nomi', async () => {
    fake.results.push({
      data: [{ id: 'i1', qty: '2', material: { name: 'Sement', base_unit: 'kg' } }],
      error: null,
    })
    const items = await listEstimateItems('e1')
    expect(String(all('select')[0]?.[1])).toContain('norm_qty_base::text')
    expect(items[0]).toMatchObject({ material_name: 'Sement', base_unit: 'kg' })
    expect(items[0]).not.toHaveProperty('material')
  })

  it('saveTemplate: imzo bo‘yicha topilsa — update, aks holda insert', async () => {
    fake.results.push({ data: { id: 'tpl1' }, error: null })
    fake.results.push({ error: null })
    await saveTemplate({ companyId: 'c', name: 'T', headerSignature: 'a|b', mapping: { name: 0 }, sheetName: 'S', headerRow: 1 })
    expect(all('update')[0]?.[1]).toMatchObject({ mapping: { name: 0 }, sheet_name: 'S', header_row: 1 })
    expect(all('insert')).toHaveLength(0)

    fake.calls.length = 0
    fake.results.push({ data: null, error: null })
    fake.results.push({ error: null })
    await saveTemplate({ companyId: 'c', name: 'T', headerSignature: 'a|b', mapping: { name: 0 }, sheetName: null, headerRow: 0 })
    expect(all('insert')[0]?.[1]).toMatchObject({ company_id: 'c', header_signature: 'a|b', mapping: { name: 0 } })
  })

  it('createEstimateMaterials: RPC p_items, 2000 tadan bo‘lib, natija tartibda', async () => {
    const items = Array.from({ length: 2001 }, (_, i) => ({
      key: `k${i}`,
      name: `Material ${i}`,
      base_unit: 'dona',
      code: `00${i}`,
      alias: `МАТЕРИАЛ ${i}`,
      units: i === 0 ? [{ unit: '100 dona', factor: '100', variant: null }] : null,
    }))
    fake.results.push({ data: items.slice(0, 2000).map((it, i) => ({ key: it.key, material_id: `m${i}`, created: true })), error: null })
    fake.results.push({ data: [{ key: 'k2000', material_id: 'm2000', created: false }], error: null })
    const res = await createEstimateMaterials(items)
    const rpc = all('rpc')
    expect(rpc).toHaveLength(2)
    expect(rpc[0]?.[1]).toBe('estimate_create_materials')
    expect((rpc[0]?.[2] as { p_items: unknown[] }).p_items).toHaveLength(2000)
    expect((rpc[0]?.[2] as { p_items: unknown[] }).p_items[0]).toEqual(items[0])
    expect((rpc[1]?.[2] as { p_items: unknown[] }).p_items).toEqual([items[2000]])
    expect(res).toHaveLength(2001)
    expect(res[2000]).toEqual({ key: 'k2000', material_id: 'm2000', created: false })
  })

  it('createEstimateMaterials: estimate_materials_forbidden', async () => {
    fake.results.push({ data: null, error: { code: '42501', hint: 'estimate_materials_forbidden', message: 'x' } })
    await expect(
      createEstimateMaterials([{ key: 'k', name: 'n', base_unit: 'kg', code: null, alias: null, units: null }]),
    ).rejects.toMatchObject({ code: 'estimate_materials_forbidden' })
  })

  it('rememberEstimateAliases: RPC; bo‘sh ro‘yxat — chaqiruvsiz', async () => {
    expect(await rememberEstimateAliases('e1', [])).toBe(0)
    expect(all('rpc')).toHaveLength(0)
    fake.results.push({ data: 3, error: null })
    const items = [{ material_id: 'm1', code: '009219', name: 'ВОДА' }]
    expect(await rememberEstimateAliases('e1', items)).toBe(3)
    expect(all('rpc')[0]).toEqual(['rpc', 'remember_estimate_aliases', { p_estimate_id: 'e1', p_items: items }])
  })

  it('rememberEstimateAliases: estimate_aliases_invalid — server xabari', async () => {
    fake.results.push({ data: null, error: { code: '22023', hint: 'estimate_aliases_invalid', message: 'Qator 2: material topilmadi yoki o‘chirilgan' } })
    await expect(rememberEstimateAliases('e1', [{ material_id: 'x', code: null, name: null }])).rejects.toMatchObject({
      code: 'estimate_aliases_invalid',
      userMessage: 'Qator 2: material topilmadi yoki o‘chirilgan',
    })
  })
})
