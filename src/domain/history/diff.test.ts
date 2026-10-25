import { describe, expect, it } from 'vitest'
import { canonicalJson, diffRecord } from './diff'

const base = {
  id: 'm1',
  company_id: 'c1',
  created_by: 'p1',
  created_at: '2026-10-25T10:00:00+05:00',
  updated_at: '2026-10-25T10:00:00+05:00',
  deleted_at: null,
}

describe('canonicalJson', () => {
  it("kalit tartibiga bog'liq emas", () => {
    expect(canonicalJson({ a: 1, b: { y: 2, x: [1, { q: 1, p: 2 }] } })).toBe(
      canonicalJson({ b: { x: [1, { p: 2, q: 1 }], y: 2 }, a: 1 }),
    )
  })
  it('undefined va null', () => {
    expect(canonicalJson(undefined)).toBe('null')
    expect(canonicalJson({ a: undefined, b: 1 })).toBe('{"b":1}')
    expect(canonicalJson([undefined])).toBe('[null]')
  })
  it('massiv tartibi muhim', () => {
    expect(canonicalJson([1, 2])).not.toBe(canonicalJson([2, 1]))
  })
})

describe('diffRecord — INSERT', () => {
  it("barcha mazmunli maydonlar before: null, texnik va bo'sh maydonlarsiz", () => {
    const row = { ...base, name: 'Sement M400', base_unit: 'kg', waste_pct: 2, category: null, is_active: true }
    expect(diffRecord(null, row, null, 'materials')).toEqual([
      { field: 'name', before: null, after: 'Sement M400' },
      { field: 'base_unit', before: null, after: 'kg' },
      { field: 'waste_pct', before: null, after: 2 },
      { field: 'is_active', before: null, after: true },
    ])
  })

  it("false, 0 va '' mazmunli (bo'sh emas)", () => {
    expect(diffRecord(null, { is_active: false, qty: 0, note: '' })).toEqual([
      { field: 'is_active', before: null, after: false },
      { field: 'note', before: null, after: '' },
      { field: 'qty', before: null, after: 0 },
    ])
  })

  it("INSERT da deleted_at qiymati bo'lsa ham ko'rinmaydi", () => {
    expect(diffRecord(null, { ...base, deleted_at: '2026-10-25', name: 'x' })).toEqual([
      { field: 'name', before: null, after: 'x' },
    ])
  })
})

describe('diffRecord — UPDATE', () => {
  const old = { ...base, type: 'kirim', qty_input: 30, qty_base: 1500, note: 'a', object_id: 'o1' }

  it("faqat o'zgargan maydonlar, updated_at chiqariladi", () => {
    const next = { ...old, qty_input: 40, qty_base: 2000, updated_at: '2026-10-26T00:00:00Z' }
    expect(diffRecord(old, next, null, 'movements')).toEqual([
      { field: 'qty_input', before: 30, after: 40 },
      { field: 'qty_base', before: 1500, after: 2000 },
    ])
  })

  it("o'zgarish yo'q → []", () => {
    expect(diffRecord(old, { ...old })).toEqual([])
  })

  it("texnik maydonlar o'zgarsa ham chiqariladi", () => {
    const next = { ...old, id: 'x', company_id: 'c2', created_at: 'z', created_by: 'p9', updated_at: 'y' }
    expect(diffRecord(old, next)).toEqual([])
  })

  it('kalit faqat bir tomonda — null bilan', () => {
    expect(diffRecord({ a: 1 }, { b: 2 })).toEqual([
      { field: 'a', before: 1, after: null },
      { field: 'b', before: null, after: 2 },
    ])
  })

  it('undefined va null teng', () => {
    expect(diffRecord({ a: undefined, b: 1 }, { a: null, b: 1 })).toEqual([])
  })

  it('jsonb — chuqur va kalit tartibisiz taqqoslash', () => {
    const a = { ...base, details: { avg: '100', items: [{ id: 1, q: 2 }], meta: { x: 1, y: 2 } } }
    const same = { ...base, details: { meta: { y: 2, x: 1 }, items: [{ q: 2, id: 1 }], avg: '100' } }
    expect(diffRecord(a, same, null, 'alerts')).toEqual([])
    const changed = { ...base, details: { avg: '100', items: [{ id: 1, q: 3 }], meta: { x: 1, y: 2 } } }
    expect(diffRecord(a, changed, null, 'alerts')).toEqual([
      { field: 'details', before: a.details, after: changed.details },
    ])
  })

  it("son va satr farqli (JSON qiymat bo'yicha)", () => {
    expect(diffRecord({ amount: 100 }, { amount: '100' })).toHaveLength(1)
  })

  it("o'chirilmagan yozuvda deleted_at ko'rinmaydi (null → null)", () => {
    expect(diffRecord({ ...old }, { ...old, note: 'b' }).map((c) => c.field)).toEqual(['note'])
  })

  it("o'chirilgan yozuvda deleted_at sanasi o'zgarsa ham ko'rinmaydi", () => {
    const d1 = { ...old, deleted_at: '2026-10-25T10:00:00Z' }
    const d2 = { ...old, deleted_at: '2026-10-26T10:00:00Z', note: 'b' }
    expect(diffRecord(d1, d2).map((c) => c.field)).toEqual(['note'])
  })
})

describe('diffRecord — SOFT_DELETE / RESTORE', () => {
  const old = { ...base, name: 'Obyekt 1', status: 'faol' }

  it("SOFT_DELETE — deleted_at ko'rinadi", () => {
    const next = { ...old, deleted_at: '2026-10-25T12:00:00Z', updated_at: 'x' }
    expect(diffRecord(old, next, null, 'objects')).toEqual([
      { field: 'deleted_at', before: null, after: '2026-10-25T12:00:00Z' },
    ])
  })

  it("RESTORE — deleted_at ko'rinadi", () => {
    const del = { ...old, deleted_at: '2026-10-25T12:00:00Z' }
    expect(diffRecord(del, { ...old }, null, 'objects')).toEqual([
      { field: 'deleted_at', before: '2026-10-25T12:00:00Z', after: null },
    ])
  })

  it('changedFields bilan ham deleted_at qoidasi', () => {
    const del = { ...old, deleted_at: 't' }
    expect(diffRecord(old, del, ['deleted_at'])).toEqual([{ field: 'deleted_at', before: null, after: 't' }])
    expect(diffRecord({ ...old, deleted_at: 'a' }, { ...old, deleted_at: 'b' }, ['deleted_at'])).toEqual([])
  })
})

describe('diffRecord — changedFields', () => {
  const old = { ...base, total_amount: 100, unit_price: 10, note: 'a', supplier_id: 's1' }
  const next = { ...old, total_amount: 200, unit_price: 20, note: 'b' }

  it('faqat berilgan maydonlar', () => {
    expect(diffRecord(old, next, ['note'])).toEqual([{ field: 'note', before: 'a', after: 'b' }])
  })

  it("texnik maydonlar changedFields da bo'lsa ham chiqariladi", () => {
    expect(diffRecord(old, next, ['updated_at', 'id', 'note'])).toEqual([{ field: 'note', before: 'a', after: 'b' }])
  })

  it("takrorlar bir marta, tartib jadval bo'yicha", () => {
    expect(diffRecord(old, next, ['note', 'unit_price', 'total_amount', 'note'], 'purchases')).toEqual([
      { field: 'total_amount', before: 100, after: 200 },
      { field: 'unit_price', before: 10, after: 20 },
      { field: 'note', before: 'a', after: 'b' },
    ])
  })

  it("bo'sh changedFields → []", () => {
    expect(diffRecord(old, next, [])).toEqual([])
  })

  it("yo'q maydon — null qiymatlar bilan", () => {
    expect(diffRecord(old, next, ['missing'])).toEqual([{ field: 'missing', before: null, after: null }])
  })

  it('null changedFields — chuqur taqqoslash', () => {
    expect(diffRecord(old, next, null).map((c) => c.field)).toEqual(['note', 'total_amount', 'unit_price'])
  })
})

describe('diffRecord — chegaraviy', () => {
  it('ikkalasi null → []', () => {
    expect(diffRecord(null, null)).toEqual([])
    expect(diffRecord(null, null, ['a'])).toEqual([])
  })

  it("new null (yo'q bo'lish) — after: null, bo'sh maydonlarsiz", () => {
    expect(diffRecord({ ...base, name: 'x', note: null }, null)).toEqual([{ field: 'name', before: 'x', after: null }])
  })

  it("noma'lum jadval — alifbo tartibi", () => {
    expect(diffRecord(null, { z: 1, a: 2, m: 3 }, null, 'nomalum').map((c) => c.field)).toEqual(['a', 'm', 'z'])
  })

  it("jadvalda noma'lum maydonlar ma'lumlaridan keyin, alifbo bo'yicha", () => {
    const r = diffRecord(null, { zz: 1, aa: 1, name: 'x', note: 'n' }, null, 'suppliers')
    expect(r.map((c) => c.field)).toEqual(['name', 'note', 'aa', 'zz'])
  })

  it("tartib barqaror — kalitlar tartibidan qat'i nazar", () => {
    const a = { type: 'kirim', material_id: 'm', qty_input: 1, object_id: 'o', note: 'n', photo_path: 'p' }
    const b = { photo_path: 'p', note: 'n', object_id: 'o', qty_input: 1, material_id: 'm', type: 'kirim' }
    const ra = diffRecord(null, a, null, 'movements')
    expect(ra).toEqual(diffRecord(null, b, null, 'movements'))
    expect(ra.map((c) => c.field)).toEqual(['type', 'material_id', 'qty_input', 'object_id', 'note', 'photo_path'])
  })

  it("kirish ma'lumotini o'zgartirmaydi", () => {
    const old = { a: 1, nested: { x: 1 } }
    const next = { a: 2, nested: { x: 2 } }
    const snapshot = JSON.stringify([old, next])
    diffRecord(old, next, ['nested', 'a'], 'x')
    expect(JSON.stringify([old, next])).toBe(snapshot)
  })

  it('juda katta son va manfiy qiymat', () => {
    expect(diffRecord({ qty: -5 }, { qty: 1e21 })).toEqual([{ field: 'qty', before: -5, after: 1e21 }])
  })
})
