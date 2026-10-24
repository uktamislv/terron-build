import { formatDate, formatDateTime, formatSum } from './format'

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
