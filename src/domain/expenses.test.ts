import { describe, expect, it } from 'vitest'
import {
  defaultExpenseObject,
  expensePhotoRequired,
  findDuplicateExpense,
  limitStatus,
  parseMonthlyLimit,
  rankExpenseCategories,
  tashkentMonthRange,
  validateExpenseAmount,
  validateExpenseCorrection,
  type ExpenseFingerprint,
} from './expenses'

const cat = (id: string, name: string, sort_order: number, extra: Partial<{ is_active: boolean; deleted_at: string | null }> = {}) => ({
  id,
  name,
  sort_order,
  is_active: true,
  deleted_at: null,
  ...extra,
})

describe('validateExpenseAmount', () => {
  it('bo‘sh — required, 0 va noto‘g‘ri — invalid, guruhlangan summa — Dec', () => {
    expect(validateExpenseAmount('')).toEqual({ ok: false, error: 'required' })
    expect(validateExpenseAmount('0')).toEqual({ ok: false, error: 'invalid' })
    expect(validateExpenseAmount('abc')).toEqual({ ok: false, error: 'invalid' })
    expect(validateExpenseAmount('41 000')).toEqual({ ok: true, value: '41000' })
    expect(validateExpenseAmount('1 250,5')).toEqual({ ok: true, value: '1250.5' })
  })
})

describe('rankExpenseCategories', () => {
  it('ko‘p ishlatilgani oldinda, keyin oxirgi vaqt, keyin sort_order va nom; nofaol/o‘chirilgan — yo‘q', () => {
    const cats = [
      cat('a', 'Oziq-ovqat', 1),
      cat('b', 'Yoqilg‘i', 2),
      cat('c', 'Transport', 3),
      cat('d', 'Boshqa', 4),
      cat('x', 'Nofaol', 0, { is_active: false }),
      cat('y', 'O‘chirilgan', 0, { deleted_at: '2026-11-01T00:00:00Z' }),
    ]
    const usage = [
      { categoryId: 'c', useCount: 5, lastUsedAt: '2026-11-01T10:00:00Z' },
      { categoryId: 'b', useCount: 2, lastUsedAt: '2026-11-02T10:00:00Z' },
      { categoryId: 'd', useCount: 2, lastUsedAt: '2026-11-03T10:00:00Z' },
    ]
    expect(rankExpenseCategories(cats, usage).map((c) => c.id)).toEqual(['c', 'd', 'b', 'a'])
    expect(rankExpenseCategories(cats, []).map((c) => c.id)).toEqual(['a', 'b', 'c', 'd'])
  })
})

describe('expensePhotoRequired (xarid qoidasi bilan bir xil)', () => {
  it('tur belgisi, summa chegarasi (kiradi), QR — ozod', () => {
    expect(expensePhotoRequired({ amount: '10', thresholdAmount: null, categoryPhotoRequired: true, qrVerified: false })).toBe('category')
    expect(expensePhotoRequired({ amount: '500000', thresholdAmount: '500000', categoryPhotoRequired: false, qrVerified: false })).toBe('amount')
    expect(expensePhotoRequired({ amount: '499999', thresholdAmount: '500000', categoryPhotoRequired: false, qrVerified: false })).toBeNull()
    expect(expensePhotoRequired({ amount: '900000', thresholdAmount: '500000', categoryPhotoRequired: true, qrVerified: true })).toBeNull()
  })
})

describe('findDuplicateExpense', () => {
  const base: ExpenseFingerprint = { id: 'n', createdBy: 'me', categoryId: 'c1', objectId: null, amount: '41000', createdAt: '2026-11-01T10:10:00Z' }
  it('shu muallif, tur, obyekt (null ham teng), summa — oyna ichida', () => {
    const prev = [{ ...base, id: 'p1', amount: '41000.00', createdAt: '2026-11-01T10:05:00Z' }]
    expect(findDuplicateExpense(prev, base, 10)?.id).toBe('p1')
    expect(findDuplicateExpense(prev, { ...base, objectId: 'o1' }, 10)).toBeNull()
    expect(findDuplicateExpense(prev, { ...base, categoryId: 'c2' }, 10)).toBeNull()
    expect(findDuplicateExpense(prev, { ...base, amount: '41001' }, 10)).toBeNull()
    expect(findDuplicateExpense(prev, { ...base, createdBy: 'other' }, 10)).toBeNull()
    expect(findDuplicateExpense(prev, base, 4)).toBeNull()
    expect(findDuplicateExpense(prev, base, 0)).toBeNull()
  })
  it('eng erta mos yozuv', () => {
    const prev = [
      { ...base, id: 'p2', createdAt: '2026-11-01T10:08:00Z' },
      { ...base, id: 'p1', createdAt: '2026-11-01T10:02:00Z' },
    ]
    expect(findDuplicateExpense(prev, base, 10)?.id).toBe('p1')
  })
})

describe('limit va oy', () => {
  it('limitStatus', () => {
    expect(limitStatus('100', null)).toBeNull()
    expect(limitStatus('120', '100')).toEqual({ over: true, overBy: '20', remaining: '0' })
    expect(limitStatus('80', '100')).toEqual({ over: false, overBy: '0', remaining: '20' })
  })
  it('tashkentMonthRange — Toshkent oyi (UTC+5)', () => {
    expect(tashkentMonthRange('2026-11-30T20:00:00Z')).toEqual({ from: '2026-12-01', to: '2026-12-31', month: '2026-12' })
    expect(tashkentMonthRange('2026-02-10T00:00:00Z')).toEqual({ from: '2026-02-01', to: '2026-02-28', month: '2026-02' })
  })
  it('parseMonthlyLimit: bo‘sh — limitsiz, 0 — xato', () => {
    expect(parseMonthlyLimit('')).toEqual({ ok: true, value: null })
    expect(parseMonthlyLimit('5 000 000')).toEqual({ ok: true, value: '5000000' })
    expect(parseMonthlyLimit('0')).toEqual({ ok: false })
  })
})

describe('defaultExpenseObject', () => {
  it('bitta obyekt — o‘sha; oxirgisi — ro‘yxatda bo‘lsa; aks holda Umumiy (null)', () => {
    expect(defaultExpenseObject(['o1'], 'none')).toBe('o1')
    expect(defaultExpenseObject(['o1', 'o2'], 'o2')).toBe('o2')
    expect(defaultExpenseObject(['o1', 'o2'], 'o9')).toBeNull()
    expect(defaultExpenseObject(['o1', 'o2'], 'none')).toBeNull()
    expect(defaultExpenseObject([], null)).toBeNull()
  })
})

describe('validateExpenseCorrection', () => {
  const original = { amount: '41000', note: 'tushlik', objectId: null }
  it('sabab majburiy, summa > 0', () => {
    expect(validateExpenseCorrection({ original, amountInput: '0', objectId: null, note: '', reason: '' })).toEqual({
      ok: false,
      errors: { amount: 'invalid', reason: 'required' },
    })
  })
  it('o‘zgarmagan maydonlar — null', () => {
    const r = validateExpenseCorrection({ original, amountInput: '41 000', objectId: null, note: 'tushlik', reason: ' xato ' })
    expect(r).toEqual({ ok: true, value: { totalAmount: null, objectId: null, note: null, reason: 'xato' } })
  })
  it('yangi summa, obyekt va izoh', () => {
    const r = validateExpenseCorrection({ original, amountInput: '45 000', objectId: 'o1', note: '', reason: 'chek' })
    expect(r).toEqual({ ok: true, value: { totalAmount: '45000', objectId: 'o1', note: '', reason: 'chek' } })
  })
})
