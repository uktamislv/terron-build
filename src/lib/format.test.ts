import { formatDate, formatDateTime, formatQty, formatSum } from './format'

describe('formatDate', () => {
  it('dd.mm.yyyy formatida qaytaradi', () => {
    expect(formatDate('2026-03-07T10:00:00Z')).toBe('07.03.2026')
  })

  it('Asia/Tashkent (UTC+5) bo‘yicha kunni hisoblaydi', () => {
    // UTC 20:30 → Toshkentda ertasi kun 01:30
    expect(formatDate('2026-12-31T20:30:00Z')).toBe('01.01.2027')
  })
})

describe('formatDateTime', () => {
  it('24 soatlik vaqt bilan qaytaradi', () => {
    expect(formatDateTime('2026-03-07T10:05:00Z')).toBe('07.03.2026 15:05')
  })
})

describe('formatSum', () => {
  it('minglik ajratuvchi qo‘yadi', () => {
    expect(formatSum('1250000')).toBe('1 250 000 so‘m')
  })

  it('numeric kasr qismini saqlaydi, ortiqcha nollarni olib tashlaydi', () => {
    expect(formatSum('1250000.50')).toBe('1 250 000,5 so‘m')
    expect(formatSum('1000.00')).toBe('1 000 so‘m')
  })

  it('manfiy va nol qiymatlar', () => {
    expect(formatSum('-5000')).toBe('-5 000 so‘m')
    expect(formatSum('0')).toBe('0 so‘m')
  })

  it('float yaxlitlash xatosisiz katta sonlar', () => {
    expect(formatSum('12345678901234567.89')).toBe('12 345 678 901 234 567,89 so‘m')
  })
})

describe('formatQty', () => {
  it('kasr — vergul, minglik — bo‘sh joy, ortiqcha nollarsiz', () => {
    expect(formatQty('1250.5')).toBe('1 250,5')
    expect(formatQty('50.000000')).toBe('50')
    expect(formatQty('1.00005')).toBe('1,00005')
    expect(formatQty('0.6667000000')).toBe('0,6667')
    expect(formatQty('1250000')).toBe('1 250 000')
  })

  it('maxFrac — half away from zero bilan yaxlitlaydi', () => {
    expect(formatQty('1.23456', 2)).toBe('1,23')
    expect(formatQty('1.005', 2)).toBe('1,01')
    expect(formatQty('999.999', 2)).toBe('1 000')
    expect(formatQty('-2.5', 0)).toBe('-3')
    expect(formatQty('12.50', 2)).toBe('12,5')
  })

  it('nol, manfiy, katta son — float aniqligi yo‘qolmaydi', () => {
    expect(formatQty('0')).toBe('0')
    expect(formatQty('-0.000')).toBe('0')
    expect(formatQty('-1234.5')).toBe('-1 234,5')
    expect(formatQty('123456789012345.123456')).toBe('123 456 789 012 345,123456')
  })

  it('raqam bo‘lmagan qiymat o‘zgarishsiz qaytadi', () => {
    expect(formatQty('abc')).toBe('abc')
  })
})
