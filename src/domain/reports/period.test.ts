import { describe, expect, it } from 'vitest'
import { PERIOD_PRESETS, addDays, daysBetween, isoToDayNumber, periodRange, validateRange } from './period'

describe('isoToDayNumber', () => {
  it('epoxa va noto\'g\'ri sanalar', () => {
    expect(isoToDayNumber('1970-01-01')).toBe(0)
    expect(isoToDayNumber('2026-02-30')).toBeNull()
    expect(isoToDayNumber('2026-13-01')).toBeNull()
    expect(isoToDayNumber('2026-00-10')).toBeNull()
    expect(isoToDayNumber('25.10.2026')).toBeNull()
    expect(isoToDayNumber('')).toBeNull()
    expect(isoToDayNumber('2023-02-29')).toBeNull()
    expect(isoToDayNumber('2024-02-29')).not.toBeNull()
  })
})

describe('periodRange', () => {
  it('PERIOD_PRESETS — 6 ta', () => {
    expect(PERIOD_PRESETS).toEqual(['today', 'yesterday', 'last7', 'last30', 'thisMonth', 'lastMonth'])
  })
  it('today / yesterday', () => {
    expect(periodRange('today', '2026-10-25')).toEqual({ from: '2026-10-25', to: '2026-10-25' })
    expect(periodRange('yesterday', '2026-10-25')).toEqual({ from: '2026-10-24', to: '2026-10-24' })
  })
  it('yesterday — oy va yil boshida', () => {
    expect(periodRange('yesterday', '2026-03-01')).toEqual({ from: '2026-02-28', to: '2026-02-28' })
    expect(periodRange('yesterday', '2024-03-01')).toEqual({ from: '2024-02-29', to: '2024-02-29' })
    expect(periodRange('yesterday', '2026-01-01')).toEqual({ from: '2025-12-31', to: '2025-12-31' })
  })
  it('last7 = bugun va oldingi 6 kun', () => {
    const r = periodRange('last7', '2026-10-25')
    expect(r).toEqual({ from: '2026-10-19', to: '2026-10-25' })
    expect(daysBetween(r.from, r.to)).toBe(6)
    expect(periodRange('last7', '2026-01-03')).toEqual({ from: '2025-12-28', to: '2026-01-03' })
  })
  it('last30', () => {
    const r = periodRange('last30', '2026-03-15')
    expect(r).toEqual({ from: '2026-02-14', to: '2026-03-15' })
    expect(daysBetween(r.from, r.to)).toBe(29)
  })
  it('thisMonth — oy boshidan bugungacha', () => {
    expect(periodRange('thisMonth', '2026-10-25')).toEqual({ from: '2026-10-01', to: '2026-10-25' })
    expect(periodRange('thisMonth', '2026-10-01')).toEqual({ from: '2026-10-01', to: '2026-10-01' })
    expect(periodRange('thisMonth', '2026-10-31')).toEqual({ from: '2026-10-01', to: '2026-10-31' })
  })
  it('lastMonth — to\'liq o\'tgan oy, kabisa va yil o\'tishi', () => {
    expect(periodRange('lastMonth', '2026-10-25')).toEqual({ from: '2026-09-01', to: '2026-09-30' })
    expect(periodRange('lastMonth', '2024-03-31')).toEqual({ from: '2024-02-01', to: '2024-02-29' })
    expect(periodRange('lastMonth', '2026-03-01')).toEqual({ from: '2026-02-01', to: '2026-02-28' })
    expect(periodRange('lastMonth', '2026-01-15')).toEqual({ from: '2025-12-01', to: '2025-12-31' })
    expect(periodRange('lastMonth', '2000-03-10')).toEqual({ from: '2000-02-01', to: '2000-02-29' })
    expect(periodRange('lastMonth', '2100-03-10')).toEqual({ from: '2100-02-01', to: '2100-02-28' })
  })
  it('noto\'g\'ri bugun → xato', () => {
    expect(() => periodRange('today', '2026-02-30')).toThrow()
    expect(() => periodRange('last7', 'bugun')).toThrow()
  })
})

describe('daysBetween / addDays', () => {
  it('hisob', () => {
    expect(daysBetween('2026-10-25', '2026-10-25')).toBe(0)
    expect(daysBetween('2026-10-25', '2026-10-24')).toBe(-1)
    expect(daysBetween('2024-01-01', '2025-01-01')).toBe(366)
    expect(daysBetween('2025-01-01', '2026-01-01')).toBe(365)
    expect(addDays('2024-02-28', 1)).toBe('2024-02-29')
    expect(addDays('2026-01-01', -1)).toBe('2025-12-31')
    expect(() => daysBetween('x', '2026-01-01')).toThrow()
  })
})

describe('validateRange', () => {
  it('ok / invalid / reversed', () => {
    expect(validateRange('2026-10-25', '2026-10-25')).toBe('ok')
    expect(validateRange('2026-10-26', '2026-10-25')).toBe('reversed')
    expect(validateRange('2026-02-30', '2026-03-01')).toBe('invalid')
    expect(validateRange('', '2026-03-01')).toBe('invalid')
    expect(validateRange('2026-03-01', '01.04.2026')).toBe('invalid')
  })
  it('aynan 366 kun — ok, 367 — too_long', () => {
    expect(validateRange('2026-01-01', '2027-01-01')).toBe('ok') // 366 kun
    expect(validateRange('2026-01-01', '2027-01-02')).toBe('too_long') // 367 kun
    expect(validateRange('2024-01-01', '2024-12-31')).toBe('ok') // kabisa yili, 366 kun
    expect(validateRange('2024-01-01', '2025-01-01')).toBe('too_long')
  })
  it('maxDays parametri', () => {
    expect(validateRange('2026-01-01', '2026-01-07', 7)).toBe('ok')
    expect(validateRange('2026-01-01', '2026-01-08', 7)).toBe('too_long')
  })
})
