import { describe, expect, it } from 'vitest'
import { cashAging, type CashEntry } from './cashAging'

const T = '2026-10-26'
const b = (amount: string, date: string): CashEntry => ({ kind: 'berildi', amount, date })
const s = (amount: string, date = T): CashEntry => ({ kind: 'sarf', amount, date })
const q = (amount: string, date = T): CashEntry => ({ kind: 'qaytarildi', amount, date })

describe('cashAging', () => {
  it('bo\'sh → balans 0, ochiq yo\'q', () => {
    expect(cashAging([], T)).toEqual({ balance: '0', oldestOpenDate: null, oldestOpenRemaining: null, ageDays: null, overdue: false, negative: false })
  })
  it('bitta berilgan, sarf yo\'q', () => {
    const r = cashAging([b('1000000', '2026-10-01')], T)
    expect(r).toMatchObject({ balance: '1000000', oldestOpenDate: '2026-10-01', oldestOpenRemaining: '1000000', ageDays: 25, overdue: true })
  })
  it('FIFO: sarf eng eskisini yopadi', () => {
    const r = cashAging([b('500', '2026-10-01'), b('500', '2026-10-20'), s('600')], T)
    expect(r).toMatchObject({ balance: '400', oldestOpenDate: '2026-10-20', oldestOpenRemaining: '400', ageDays: 6, overdue: false })
  })
  it('qisman yopilgan eski berilgan — u eng eski ochiq', () => {
    const r = cashAging([b('500', '2026-10-20'), b('500', '2026-10-01'), s('100'), q('50')], T)
    expect(r).toMatchObject({ balance: '850', oldestOpenDate: '2026-10-01', oldestOpenRemaining: '350', ageDays: 25 })
  })
  it('chegara: aynan 14 kun — muddati o\'tmagan; 15 — o\'tgan', () => {
    expect(cashAging([b('1', '2026-10-12')], T).overdue).toBe(false)
    expect(cashAging([b('1', '2026-10-11')], T).overdue).toBe(true)
  })
  it('maxDays parametr', () => {
    expect(cashAging([b('1', '2026-10-24')], T, 1).overdue).toBe(true)
    expect(cashAging([b('1', '2026-10-24')], T, 2).overdue).toBe(false)
  })
  it('to\'liq yopilgan → balans 0, overdue yo\'q', () => {
    const r = cashAging([b('100', '2026-01-01'), s('70'), q('30')], T)
    expect(r).toMatchObject({ balance: '0', oldestOpenDate: null, overdue: false, negative: false })
  })
  it('manfiy balans → negative, overdue yo\'q', () => {
    const r = cashAging([b('100', '2026-01-01'), s('150')], T)
    expect(r).toMatchObject({ balance: '-50', negative: true, overdue: false, oldestOpenDate: null })
  })
  it('faqat sarf → manfiy', () => {
    expect(cashAging([s('1')], T).negative).toBe(true)
  })
  it('teng sanada kirish tartibi saqlanadi', () => {
    const r = cashAging([b('100', '2026-10-01'), b('200', '2026-10-01'), s('100')], T)
    expect(r.oldestOpenRemaining).toBe('200')
  })
  it('sarf berilgandan oldin bo\'lsa ham FIFO yopadi', () => {
    const r = cashAging([s('100', '2026-09-01'), b('100', '2026-10-01'), b('50', '2026-10-25')], T)
    expect(r).toMatchObject({ balance: '50', oldestOpenDate: '2026-10-25', ageDays: 1 })
  })
  it('tiyinlar float xatosiz', () => {
    const r = cashAging([b('0.1', '2026-10-25'), b('0.2', '2026-10-26'), s('0.3')], T)
    expect(r.balance).toBe('0')
  })
  it('noto\'g\'ri sana → xato', () => {
    expect(() => cashAging([b('1', '2026-13-01')], T)).toThrow()
  })
  it('kelajakdagi berilgan → manfiy yosh, overdue yo\'q', () => {
    expect(cashAging([b('1', '2026-10-27')], T)).toMatchObject({ ageDays: -1, overdue: false })
  })
})
