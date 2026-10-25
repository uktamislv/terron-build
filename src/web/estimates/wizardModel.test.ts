import type { ParsedRow } from '@/domain/estimate'
import { makeMaterial, makeUnit } from '@/test/fixtures'
import {
  buildPlan,
  collectItems,
  columnLetter,
  estimateDateValid,
  sanitizeMapping,
  shiftRowNumbers,
  toImportItems,
  totalsDiffer,
  type WizardItem,
} from './wizardModel'

function row(n: number, over: Partial<ParsedRow>): ParsedRow {
  return { rowNumber: n, kind: 'item', name: 'X', unit: 'kg', qty: '1', price: null, sum: null, type: null, code: '', errors: [], ...over }
}

describe('collectItems', () => {
  it('bo‘lim/jami o‘tkaziladi; narx summadan; xato qator tuzatilgach kiradi', () => {
    const parsed = [
      row(2, { kind: 'section' }),
      row(3, { qty: '4', sum: '10' }),
      row(4, { kind: 'invalid', qty: null, errors: ['qty_missing'] }),
      row(5, { kind: 'invalid', name: '', errors: [] }),
      row(6, { kind: 'total' }),
    ]
    const open = collectItems(parsed, {}, {})
    expect(open).toMatchObject({ autoSkipped: 2, openInvalid: 2, invalidTotal: 2 })
    expect(open.items[0]?.price).toBe('2.5')

    const fixed = collectItems(parsed, { 4: { name: 'Y', unit: 'm', qty: '2,5', price: '' } }, { 5: true })
    expect(fixed).toMatchObject({ openInvalid: 0, userSkipped: 1 })
    expect(fixed.items.map((i) => [i.rowNumber, i.qty])).toEqual([
      [3, '4'],
      [4, '2.5'],
    ])
  })
})

describe('buildPlan', () => {
  const sement = makeMaterial('m-sem', 'Sement', 'kg', { units: [makeUnit('u-qop', 'm-sem', 'qop', '50')] })
  const it2 = (n: number, unit: string, qty: string): WizardItem => ({
    rowNumber: n,
    name: 'Sement',
    unit,
    qty,
    price: '100',
    sum: null,
    type: null,
    code: '',
    sumMismatch: false,
  })

  it('aniq moslik avtomatik; ma’lum birlik savolsiz; takroriy material ogohlantirish', () => {
    const plan = buildPlan({ items: [it2(1, 'qop', '2'), it2(2, 'QOP', '1')], materials: [sement], decisions: {}, answers: {}, canCatalog: true })
    expect(plan.unresolvedGroups).toBe(0)
    expect(plan.questions).toHaveLength(0)
    expect(plan.rows.map((r) => r.qtyBase)).toEqual(['100', '50'])
    expect(plan.rows[0]?.warnings).toContain('duplicate_material')
    expect(plan.total).toBe('300')
  })

  it('katalog huquqisiz yangi birlik javobi hal qilinmagan hisoblanadi', () => {
    const plan = buildPlan({
      items: [it2(1, 'т', '1')],
      materials: [sement],
      decisions: {},
      answers: { 'm-sem|т': { kind: 'new', unit: 'т', factor: '1000', variant: '' } },
      canCatalog: false,
    })
    expect(plan.unresolvedQuestions).toBe(1)
    expect(plan.newUnits).toHaveLength(0)
  })
})

describe('yordamchilar', () => {
  it('columnLetter va sanitizeMapping', () => {
    expect([0, 25, 26, 27].map(columnLetter)).toEqual(['A', 'Z', 'AA', 'AB'])
    expect(sanitizeMapping({ name: 1, qty: 9, unit: -1, foo: 2, price: 1.5 }, 5)).toEqual({ name: 1 })
  })
})

describe('ko‘rib chiqish tuzatishlari', () => {
  const sement = makeMaterial('m-sem', 'Sement', 'kg')
  const item = (over: Partial<WizardItem>): WizardItem => ({
    rowNumber: 3,
    name: 'Sement',
    unit: 'kg',
    qty: '1000',
    price: '1.005',
    sum: '1005',
    type: null,
    code: '',
    sumMismatch: false,
    ...over,
  })

  it('P2: narx 2 xonaga yaxlitlanadi — fayldagi jami farq qilsa ogohlantirish', () => {
    const plan = buildPlan({ items: [item({})], materials: [sement], decisions: {}, answers: {}, canCatalog: true })
    expect(plan.total).toBe('1010')
    expect(plan.fileTotal).toBe('1005')
    expect(totalsDiffer(plan)).toBe(true)
    expect(toImportItems(plan, { materials: {}, units: {} })[0]?.unit_price).toBe('1.01')
    const same = buildPlan({ items: [item({ price: '1', sum: '1000' })], materials: [sement], decisions: {}, answers: {}, canCatalog: true })
    expect(totalsDiffer(same)).toBe(false)
  })

  it('P4: birligi hal qilinmagan material qatori — xato (jimgina "ish" emas)', () => {
    const plan = buildPlan({ items: [item({ unit: 'т' })], materials: [sement], decisions: {}, answers: {}, canCatalog: true })
    expect(plan.rows[0]?.itemType).toBe('material')
    expect(() => toImportItems(plan, { materials: {}, units: {} })).toThrow(/3-qator/)
  })

  it('P6: yashirin qator standart o‘tkaziladi, aniq tanlov ustun', () => {
    const parsed = [row(4, {}), row(5, {})]
    expect(collectItems(parsed, {}, {}, new Set([5])).items.map((i) => i.rowNumber)).toEqual([4])
    expect(collectItems(parsed, {}, { 5: false }, new Set([5])).items.map((i) => i.rowNumber)).toEqual([4, 5])
  })

  it('P7: qator raqami `!ref` boshlanishiga siljiydi; sana oralig‘i', () => {
    expect(shiftRowNumbers([row(2, {})], 3)[0]?.rowNumber).toBe(5)
    const now = new Date('2026-10-25T10:00:00Z')
    expect(estimateDateValid('', now)).toBe(true)
    expect(estimateDateValid('2000-01-01', now)).toBe(true)
    expect(estimateDateValid('1999-12-31', now)).toBe(false)
    expect(estimateDateValid('2027-10-25', now)).toBe(true)
    expect(estimateDateValid('2027-10-26', now)).toBe(false)
  })

  it('O5: aniq moslikda muqobil nom saqlanmaydi', () => {
    const plan = buildPlan({ items: [item({ price: '1', sum: null })], materials: [sement], decisions: {}, answers: {}, canCatalog: true })
    expect(plan.aliases).toHaveLength(0)
  })
})
