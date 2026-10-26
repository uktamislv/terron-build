import {
  formatDate,
  formatDateTime,
  formatQty,
  formatQtyUnit,
  formatSum,
  formatSumNumber,
  formatTime,
  isoDateToDisplay,
  maskDateInput,
  parseDisplayDate,
} from './format'

/** Kutilgan qiymat oddiy bo'shliq bilan yoziladi: raqamlar orasi → U+202F, " so‘m" → U+00A0, boshidagi "-" → U+2212. */
function ui(s: string): string {
  return s
    .replace(/(\d) (?=\d)/g, '$1\u202F')
    .replace(/ (so‘m|kg)$/, '\u00A0$1')
    .replace(/^-/, '\u2212')
}

describe('formatDate', () => {
  it('dd.mm.yyyy formatida qaytaradi', () => {
    expect(formatDate('2026-03-07T10:00:00Z')).toBe('07.03.2026')
  })

  it('Asia/Tashkent (UTC+5) bo‘yicha kunni hisoblaydi', () => {
    // UTC 20:30 → Toshkentda ertasi kun 01:30
    expect(formatDate('2026-12-31T20:30:00Z')).toBe('01.01.2027')
  })
})

describe('formatTime', () => {
  it('HH:mm, Asia/Tashkent bo‘yicha', () => {
    expect(formatTime('2026-03-07T10:05:00Z')).toBe('15:05')
    expect(formatTime('2026-12-31T20:30:00Z')).toBe('01:30')
  })
})

describe('formatDateTime', () => {
  it('24 soatlik vaqt bilan qaytaradi', () => {
    expect(formatDateTime('2026-03-07T10:05:00Z')).toBe('07.03.2026 15:05')
  })
})

describe('formatSum', () => {
  it('minglik ajratuvchi qo‘yadi', () => {
    expect(formatSum('1250000')).toBe(ui('1 250 000 so‘m'))
  })

  it('numeric kasr qismini saqlaydi, ortiqcha nollarni olib tashlaydi', () => {
    expect(formatSum('1250000.50')).toBe(ui('1 250 000,5 so‘m'))
    expect(formatSum('1000.00')).toBe(ui('1 000 so‘m'))
  })

  it('manfiy va nol qiymatlar', () => {
    expect(formatSum('-5000')).toBe(ui('-5 000 so‘m'))
    expect(formatSum('0')).toBe(ui('0 so‘m'))
  })

  it('float yaxlitlash xatosisiz katta sonlar', () => {
    expect(formatSum('12345678901234567.89')).toBe(ui('12 345 678 901 234 567,89 so‘m'))
  })
})

describe('formatQty', () => {
  it('kasr — vergul, minglik — tor bo‘shliq, ortiqcha nollarsiz', () => {
    expect(formatQty('1250.5')).toBe(ui('1 250,5'))
    expect(formatQty('50.000000')).toBe(ui('50'))
    expect(formatQty('1.00005')).toBe(ui('1,00005'))
    expect(formatQty('0.6667000000')).toBe(ui('0,6667'))
    expect(formatQty('1250000')).toBe(ui('1 250 000'))
  })

  it('maxFrac — half away from zero bilan yaxlitlaydi', () => {
    expect(formatQty('1.23456', 2)).toBe(ui('1,23'))
    expect(formatQty('1.005', 2)).toBe(ui('1,01'))
    expect(formatQty('999.999', 2)).toBe(ui('1 000'))
    expect(formatQty('-2.5', 0)).toBe(ui('-3'))
    expect(formatQty('12.50', 2)).toBe(ui('12,5'))
  })

  it('nol, manfiy, katta son — float aniqligi yo‘qolmaydi', () => {
    expect(formatQty('0')).toBe(ui('0'))
    expect(formatQty('-0.000')).toBe(ui('0'))
    expect(formatQty('-1234.5')).toBe(ui('-1 234,5'))
    expect(formatQty('123456789012345.123456')).toBe(ui('123 456 789 012 345,123456'))
  })

  it('raqam bo‘lmagan qiymat o‘zgarishsiz qaytadi', () => {
    expect(formatQty('abc')).toBe('abc')
  })
})

describe('tipografik bo‘shliqlar', () => {
  it('minglik — U+202F, birlik oldidan — U+00A0, minus — U+2212', () => {
    expect(formatSum('1250000')).toBe('1\u202F250\u202F000\u00A0so‘m')
    expect(formatSumNumber('-5000')).toBe('\u22125\u202F000')
    expect(formatQty('-1234.5')).toBe('\u22121\u202F234,5')
    expect(formatQtyUnit('1500', 'kg')).toBe('1\u202F500\u00A0kg')
    expect(formatQtyUnit('3', '')).toBe('3')
  })

  it('so‘m — i18n dan', () => {
    expect(formatSum('0').endsWith('so‘m')).toBe(true)
  })
})

describe('sana kiritish (dd.mm.yyyy)', () => {
  it('ISO ↔ ko‘rinish', () => {
    expect(isoDateToDisplay('2026-11-05')).toBe('05.11.2026')
    expect(isoDateToDisplay('')).toBe('')
    expect(parseDisplayDate('05.11.2026')).toBe('2026-11-05')
    expect(parseDisplayDate('2026-11-05')).toBe('2026-11-05')
  })

  it('mavjud bo‘lmagan sana rad etiladi', () => {
    expect(parseDisplayDate('31.02.2026')).toBeNull()
    expect(parseDisplayDate('29.02.2028')).toBe('2028-02-29')
    expect(parseDisplayDate('01.13.2026')).toBeNull()
    expect(parseDisplayDate('5.11.2026')).toBeNull()
  })

  it('niqob nuqtalarni o‘zi qo‘yadi', () => {
    expect(maskDateInput('0511')).toBe('05.11')
    expect(maskDateInput('05112026')).toBe('05.11.2026')
    expect(maskDateInput('05.11.20261')).toBe('05.11.2026')
    expect(maskDateInput('0')).toBe('0')
  })
})
