import { describe, expect, it } from 'vitest'
import { diffEstimates, diffKey, type DiffItem } from './diff'

function mat(id: string, qty: string, price: string | null, extra: Partial<DiffItem> = {}): DiffItem {
  return { key: `m:${id}`, name: id, materialId: id, qtyBase: qty, qty, unit: 'kg', price, ...extra }
}

function work(name: string, unit: string, qty: string, price: string | null): DiffItem {
  return { key: diffKey({ itemType: 'ish', materialId: null, name, unit }), name, materialId: null, qtyBase: null, qty, unit, price }
}

describe('diffKey', () => {
  it('material — id bo\'yicha', () => {
    expect(diffKey({ itemType: 'material', materialId: 'abc', name: 'Цемент', unit: 'т' })).toBe('m:abc')
  })

  it('ish — normallashtirilgan nom va birlik', () => {
    expect(diffKey({ itemType: 'ish', materialId: null, name: '  Разработка  грунта ', unit: 'М3' })).toBe(
      'w:разработка грунта|м3',
    )
    expect(diffKey({ itemType: 'ish', materialId: null, name: 'Щёбень', unit: 'т' })).toBe(
      diffKey({ itemType: 'ish', materialId: null, name: 'ЩЕБЕНЬ', unit: 'Т' }),
    )
  })

  it('materialsiz material — ish kabi kalit', () => {
    expect(diffKey({ itemType: 'material', materialId: null, name: 'Kafel', unit: 'm2' })).toBe('w:kafel|m2')
  })
})

describe('diffEstimates', () => {
  it('qo\'shilgan, olib tashlangan, o\'zgargan, o\'zgarmagan', () => {
    const prev = [mat('sement', '1000', '1450'), mat('qum', '50', '120'), work('Terish', 'm3', '10', '350000')]
    const next = [mat('sement', '1200', '1450'), work('terish', 'M3', '10', '350000'), mat('kafel', '40', '95000')]
    const d = diffEstimates(prev, next)
    expect(d.added.map((x) => x.key)).toEqual(['m:kafel'])
    expect(d.removed.map((x) => x.key)).toEqual(['m:qum'])
    expect(d.changed).toEqual([
      {
        key: 'm:sement',
        name: 'sement',
        qtyBefore: '1000',
        qtyAfter: '1200',
        unitBefore: 'kg',
        unitAfter: 'kg',
        qtyBaseBefore: '1000',
        qtyBaseAfter: '1200',
        priceBefore: '1450',
        priceAfter: '1450',
      },
    ])
    expect(d.unchangedCount).toBe(1)
    expect(d.totalBefore).toBe('4956000') // 1 450 000 + 6 000 + 3 500 000
    expect(d.totalAfter).toBe('9040000') // 1 740 000 + 3 500 000 + 3 800 000
  })

  it('takroriy material yig\'iladi: qty qo\'shiladi, narx — og\'irlikli o\'rtacha', () => {
    const prev = [mat('sement', '15', '1460000')]
    const next = [mat('sement', '12.5', '1450000'), mat('sement', '2.5', '1500000')]
    const d = diffEstimates(prev, next)
    // (12.5 × 1 450 000 + 2.5 × 1 500 000) / 15 = 21 875 000 / 15 = 1 458 333.333… → 1458333.33
    expect(d.changed).toHaveLength(1)
    expect(d.changed[0]).toMatchObject({ qtyBefore: '15', qtyAfter: '15', priceBefore: '1460000', priceAfter: '1458333.33' })
    expect(d.totalAfter).toBe('21875000')
    expect(d.totalBefore).toBe('21900000')
  })

  it('takroriy material, bir xil narx — o\'zgarmagan', () => {
    const d = diffEstimates([mat('a', '10', '5')], [mat('a', '4', '5'), mat('a', '6', '5')])
    expect(d.unchangedCount).toBe(1)
    expect(d.changed).toEqual([])
  })

  it('line_sum bo\'lsa jami shu bo\'yicha (qty × yaxlitlangan narx emas)', () => {
    const d = diffEstimates(
      [mat('a', '7', '21.43')],
      [mat('a', '7', '21.43', { lineSum: '150' }), mat('b', '3', '10', { lineSum: null })],
    )
    expect(d.totalBefore).toBe('150.01')
    expect(d.totalAfter).toBe('180')
  })

  it('narxsiz qatorlar: o\'rtacha faqat narxlilar bo\'yicha, jami 0 qo\'shadi', () => {
    const d = diffEstimates([], [mat('a', '10', null), mat('a', '5', '100'), mat('b', '1', null)])
    expect(d.added).toEqual([
      { key: 'm:a', name: 'a', materialId: 'a', qtyBase: '15', qty: '15', unit: 'kg', price: '100' },
      { key: 'm:b', name: 'b', materialId: 'b', qtyBase: '1', qty: '1', unit: 'kg', price: null },
    ])
    expect(d.totalAfter).toBe('500')
  })

  it('birlik boshqa, asosiy birlikda miqdor bir xil — o\'zgarmagan', () => {
    const prev = [mat('sement', '2', '1450000', { unit: 't', qtyBase: '2000' })]
    const next = [mat('sement', '2000', '1450000', { unit: 'kg', qtyBase: '2000' })]
    expect(diffEstimates(prev, next).unchangedCount).toBe(1)
  })

  it('qtyBase yo\'q bo\'lsa — qty va birlik bo\'yicha', () => {
    const prev = [work('Terish', 'm3', '10', '1')]
    const next = [{ ...work('Terish', 'm3', '10', '1'), unit: 'm2' }]
    expect(diffEstimates(prev, next).changed).toHaveLength(1)
  })

  it('narx null → qiymat o\'zgarish hisoblanadi', () => {
    const d = diffEstimates([mat('a', '1', null)], [mat('a', '1', '10')])
    expect(d.changed[0]).toMatchObject({ priceBefore: null, priceAfter: '10' })
  })

  it('qtyBase bittasida null bo\'lsa guruh qtyBase — null', () => {
    const d = diffEstimates([], [mat('a', '1', null), mat('a', '2', null, { qtyBase: null })])
    expect(d.added[0]?.qtyBase).toBeNull()
  })

  it('jami 2 xonaga yaxlitlanadi (half away from zero)', () => {
    const d = diffEstimates([mat('a', '0.333', '0.015')], [])
    // 0.004995 → 0
    expect(d.totalBefore).toBe('0')
    expect(diffEstimates([mat('a', '1.5', '0.33')], []).totalBefore).toBe('0.5') // 0.495 → 0.50
  })

  it('bo\'sh ro\'yxatlar', () => {
    expect(diffEstimates([], [])).toEqual({
      added: [],
      removed: [],
      changed: [],
      unchangedCount: 0,
      totalBefore: '0',
      totalAfter: '0',
    })
  })
})

describe('diffEstimates — bir material turli birliklarda (т va кг)', () => {
  const tonna = (qty: string, price: string, extra: Partial<DiffItem> = {}): DiffItem =>
    mat('sement', qty, price, { unit: 'т', qtyBase: String(Number(qty) * 1000), ...extra })
  const kg = (qty: string, price: string, extra: Partial<DiffItem> = {}): DiffItem =>
    mat('sement', qty, price, { unit: 'кг', qtyBase: qty, ...extra })

  it('asosiy birlik ma\'lum — guruh kg da: miqdor Σ qtyBase, narx Σ line_sum / Σ qtyBase', () => {
    const prev = [tonna('10', '1450000', { baseUnit: 'кг', lineSum: '14500000' })]
    const next = [tonna('8', '1450000', { baseUnit: 'кг' }), kg('2000', '1500', { baseUnit: 'кг' })]
    const d = diffEstimates(prev, next)
    expect(d.added).toEqual([])
    expect(d.removed).toEqual([])
    expect(d.changed).toHaveLength(1)
    // 8 т + 2000 кг = 10 000 кг (8 + 2000 = 2008 "т" emas)
    expect(d.changed[0]).toMatchObject({
      key: 'm:sement',
      qtyBefore: '10000',
      qtyAfter: '10000',
      unitBefore: 'кг',
      unitAfter: 'кг',
      // (8 × 1 450 000 + 2000 × 1500) / 10 000 = 1460
      priceBefore: '1450',
      priceAfter: '1460',
    })
    expect(d.totalAfter).toBe('14600000')
  })

  it('asosiy birlik noma\'lum — birlik bo\'yicha alohida guruhlar (qo\'shilmaydi)', () => {
    const prev = [tonna('10', '1450000')]
    const next = [tonna('8', '1450000'), kg('2000', '1500')]
    const d = diffEstimates(prev, next)
    expect(d.changed.map((c) => [c.key, c.qtyBefore, c.qtyAfter, c.unitAfter])).toEqual([['m:sement|т', '10', '8', 'т']])
    expect(d.added.map((a) => [a.key, a.qty, a.unit])).toEqual([['m:sement|кг', '2000', 'кг']])
  })

  it('bitta birlik — avvalgidek (asosiy birlik berilsa ham)', () => {
    const d = diffEstimates([tonna('10', '5', { baseUnit: 'кг' })], [tonna('4', '5', { baseUnit: 'кг' }), tonna('6', '5', { baseUnit: 'кг' })])
    expect(d.unchangedCount).toBe(1)
  })
})
