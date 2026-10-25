import { describe, expect, it } from 'vitest'
import { findDuplicateEntry, isDuplicateEntry, type EntryFingerprint } from './duplicateEntry'

const base: EntryFingerprint = {
  id: 'n',
  createdBy: 'u1',
  kind: 'kirim',
  objectId: 'o1',
  materialId: 'm1',
  qtyBase: '100',
  createdAt: '2026-10-26T10:10:00Z',
}
const prev = (over: Partial<EntryFingerprint>): EntryFingerprint => ({ ...base, id: 'p', createdAt: '2026-10-26T10:05:00Z', ...over })

describe('findDuplicateEntry', () => {
  it('bir xil yozuv 5 daqiqa oldin → takror', () => {
    const p = prev({})
    expect(findDuplicateEntry([p], base, 10)).toBe(p)
    expect(isDuplicateEntry([p], base, 10)).toBe(true)
  })
  it('aynan 10 daqiqa — kiradi, 10 daqiqa 1 soniya — yo\'q', () => {
    expect(isDuplicateEntry([prev({ createdAt: '2026-10-26T10:00:00Z' })], base, 10)).toBe(true)
    expect(isDuplicateEntry([prev({ createdAt: '2026-10-26T09:59:59Z' })], base, 10)).toBe(false)
  })
  it('bir xil vaqt (0 farq) — takror; keyingi vaqt — yo\'q', () => {
    expect(isDuplicateEntry([prev({ createdAt: base.createdAt })], base, 10)).toBe(true)
    expect(isDuplicateEntry([prev({ createdAt: '2026-10-26T10:10:01Z' })], base, 10)).toBe(false)
  })
  it('miqdor son sifatida solishtiriladi', () => {
    expect(isDuplicateEntry([prev({ qtyBase: '100.000' })], base, 10)).toBe(true)
    expect(isDuplicateEntry([prev({ qtyBase: '100.000001' })], base, 10)).toBe(false)
  })
  it.each([
    ['boshqa odam', { createdBy: 'u2' }],
    ['boshqa tur', { kind: 'chiqim' }],
    ['boshqa obyekt', { objectId: 'o2' }],
    ['prev obyekt null', { objectId: null }],
    ['boshqa material', { materialId: 'm2' }],
    ['o\'zi (bir xil id)', { id: 'n' }],
    ['noto\'g\'ri vaqt', { createdAt: 'x' }],
  ])('%s → takror emas', (_n, over) => {
    expect(isDuplicateEntry([prev(over as Partial<EntryFingerprint>)], base, 10)).toBe(false)
  })
  it('xarid: total_amount ham teng bo\'lishi kerak', () => {
    const next = { ...base, kind: 'purchase', totalAmount: '500000' }
    expect(isDuplicateEntry([prev({ kind: 'purchase', totalAmount: '500000.00' })], next, 10)).toBe(true)
    expect(isDuplicateEntry([prev({ kind: 'purchase', totalAmount: '500001' })], next, 10)).toBe(false)
    expect(isDuplicateEntry([prev({ kind: 'purchase', totalAmount: null })], next, 10)).toBe(false)
  })
  it('harakatlarda summa e\'tiborsiz (SQL movements da total yo\'q)', () => {
    expect(isDuplicateEntry([prev({ totalAmount: '5' })], { ...base, totalAmount: null }, 10)).toBe(true)
  })
  it('parity: xaridda ikkala summa null → mos emas (SQL `=` null)', () => {
    const next = { ...base, kind: 'purchase', totalAmount: null }
    expect(isDuplicateEntry([prev({ kind: 'purchase', totalAmount: null })], next, 10)).toBe(false)
  })
  it('parity: ikkala obyekt null → mos emas (SQL `=` null)', () => {
    expect(isDuplicateEntry([prev({ objectId: null })], { ...base, objectId: null }, 10)).toBe(false)
  })
  it.each(['transfer_in', 'transfer_out', 'inventory_adjust'])('parity: harakat turi %s — tekshirilmaydi', (kind) => {
    expect(isDuplicateEntry([prev({ kind })], { ...base, kind }, 10)).toBe(false)
  })
  it('parity: chiqim tekshiriladi', () => {
    expect(isDuplicateEntry([prev({ kind: 'chiqim' })], { ...base, kind: 'chiqim' }, 10)).toBe(true)
  })
  it('kinds parametri bilan boshqa turlarni yoqish/o\'chirish', () => {
    expect(isDuplicateEntry([prev({ kind: 'transfer_in' })], { ...base, kind: 'transfer_in' }, 10, ['transfer_in'])).toBe(true)
    expect(isDuplicateEntry([prev({})], base, 10, ['chiqim'])).toBe(false)
  })
  it('eng erta mos yozuv qaytadi (first_id); teng vaqtda kichik id', () => {
    const a = prev({ id: 'a', createdAt: '2026-10-26T10:08:00Z' })
    const b = prev({ id: 'b', createdAt: '2026-10-26T10:02:00Z' })
    const c = prev({ id: 'c', createdAt: '2026-10-26T10:02:00Z' })
    expect(findDuplicateEntry([a, c, b], base, 10)?.id).toBe('b')
  })
  it('bo\'sh ro\'yxat, oyna ≤ 0, noto\'g\'ri next vaqt → null', () => {
    expect(findDuplicateEntry([], base, 10)).toBeNull()
    expect(findDuplicateEntry([prev({})], base, 0)).toBeNull()
    expect(findDuplicateEntry([prev({})], base, -5)).toBeNull()
    expect(findDuplicateEntry([prev({})], base, Number.NaN)).toBeNull()
    expect(findDuplicateEntry([prev({})], { ...base, createdAt: 'yo\'q' }, 10)).toBeNull()
  })
  it('vaqt zonasi farqli yozuvlar to\'g\'ri solishtiriladi', () => {
    expect(isDuplicateEntry([prev({ createdAt: '2026-10-26T15:05:00+05:00' })], base, 10)).toBe(true)
  })
})
