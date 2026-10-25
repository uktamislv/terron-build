import { describe, expect, it } from 'vitest'
import { avgDailyOut, forecastDays, isRunningOut, suggestRequestQty, type ForecastMovement } from './forecast'

describe('forecastDays', () => {
  it('avg 0 yoki manfiy → null', () => {
    expect(forecastDays('100', '0')).toBeNull()
    expect(forecastDays('100', '-1')).toBeNull()
    expect(forecastDays('0', '0')).toBeNull()
  })
  it('qoldiq 0 yoki manfiy → "0"', () => {
    expect(forecastDays('0', '5')).toBe('0')
    expect(forecastDays('-10', '5')).toBe('0')
  })
  it('oddiy bo\'linma', () => {
    expect(forecastDays('100', '5')).toBe('20')
    expect(forecastDays('10', '3')).toBe('3.3')
    expect(forecastDays('20', '3')).toBe('6.7')
  })
  it('half away from zero: 0.25 → 0.3', () => {
    expect(forecastDays('1', '4')).toBe('0.3')
    expect(forecastDays('0.05', '1')).toBe('0.1')
  })
  it('juda kichik o\'rtacha → katta son, float xatosiz', () => {
    expect(forecastDays('1000000', '0.000001')).toBe('1000000000000')
  })
  it('kasr qoldiq', () => {
    expect(forecastDays('12.5', '0.714286')).toBe('17.5')
  })
})

describe('isRunningOut', () => {
  it('chegara kiradi', () => {
    expect(isRunningOut('3')).toBe(true)
    expect(isRunningOut('3.1')).toBe(false)
    expect(isRunningOut('0')).toBe(true)
    expect(isRunningOut(null)).toBe(false)
    expect(isRunningOut('5', 5)).toBe(true)
  })
})

describe('avgDailyOut', () => {
  const T = '2026-10-26'
  const c = (qtyBase: string, date: string, type: ForecastMovement['type'] = 'chiqim'): ForecastMovement => ({ type, qtyBase, date })
  it('bo\'sh → 0', () => {
    expect(avgDailyOut([], T)).toBe('0')
  })
  it('14 kun oynasi: bugun va 13 kun oldin kiradi, 14 kun oldin — yo\'q', () => {
    expect(avgDailyOut([c('14', T)], T)).toBe('1')
    expect(avgDailyOut([c('14', '2026-10-13')], T)).toBe('1')
    expect(avgDailyOut([c('14', '2026-10-12')], T)).toBe('0')
  })
  it('kelajak sana — hisobga olinmaydi', () => {
    expect(avgDailyOut([c('14', '2026-10-27')], T)).toBe('0')
  })
  it('faqat chiqim', () => {
    const ms = [c('7', T), c('100', T, 'kirim'), c('100', T, 'transfer_out'), c('-50', T, 'inventory_adjust'), c('100', T, 'transfer_in')]
    expect(avgDailyOut(ms, T)).toBe('0.5')
  })
  it('6 xonagacha yaxlitlash', () => {
    expect(avgDailyOut([c('10', T)], T)).toBe('0.714286')
    expect(avgDailyOut([c('1', T)], T)).toBe('0.071429')
  })
  it('days parametr', () => {
    expect(avgDailyOut([c('7', T), c('7', '2026-10-19')], T, 7)).toBe('1')
    expect(avgDailyOut([c('7', T), c('7', '2026-10-20')], T, 7)).toBe('2')
  })
  it('noto\'g\'ri days yoki sana → xato', () => {
    expect(() => avgDailyOut([], T, 0)).toThrow()
    expect(() => avgDailyOut([], T, 1.5)).toThrow()
    expect(() => avgDailyOut([c('1', 'x')], T)).toThrow()
  })
})

describe('suggestRequestQty', () => {
  it('7 kunlik sarf', () => {
    expect(suggestRequestQty('2.5')).toBe('17.5')
  })
  it('smeta qoldig\'i kam bo\'lsa — smeta qoldig\'i', () => {
    expect(suggestRequestQty('2.5', 7, '10')).toBe('10')
  })
  it('smeta qoldig\'i ko\'p yoki teng — 7 kunlik sarf', () => {
    expect(suggestRequestQty('2.5', 7, '100')).toBe('17.5')
    expect(suggestRequestQty('2.5', 7, '17.5')).toBe('17.5')
  })
  it('null natijalar: sarf 0, smeta 0 yoki manfiy, days noto\'g\'ri', () => {
    expect(suggestRequestQty('0')).toBeNull()
    expect(suggestRequestQty('2', 7, '0')).toBeNull()
    expect(suggestRequestQty('2', 7, '-5')).toBeNull()
    expect(suggestRequestQty('2', 0)).toBeNull()
    expect(suggestRequestQty('-1')).toBeNull()
  })
  it('smeta null — cheklovsiz', () => {
    expect(suggestRequestQty('0.714286', 7, null)).toBe('5.000002')
  })
})
