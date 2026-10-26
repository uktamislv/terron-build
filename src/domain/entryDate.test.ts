import { ENTRY_DATE_MARGIN_MS, entryDateBounds, entryDateFor, entryDateToIso, tashkentDateOf } from './entryDate'
import { occurredAtAllowed } from './movements'

// 26.10.2026 15:30 Toshkent (10:30 UTC)
const NOW = '2026-10-26T10:30:00.000Z'

describe('entryDate — "Bugun / Kecha / Boshqa sana"', () => {
  it('Toshkent sanasi (UTC+5): kechki 20:00 UTC — ertangi kun', () => {
    expect(tashkentDateOf(Date.parse('2026-10-26T18:59:00Z'))).toBe('2026-10-26')
    expect(tashkentDateOf(Date.parse('2026-10-26T19:00:00Z'))).toBe('2026-10-27')
  })

  it('Bugun — null (server now(), qo‘shimcha bosish yo‘q)', () => {
    expect(entryDateFor('today', '', NOW, false)).toBeNull()
    expect(entryDateToIso('2026-10-26', NOW, false)).toBeNull()
  })

  it('Kecha — kechagi kun, hozirgi soat; bazadagi oraliqda', () => {
    const iso = entryDateFor('yesterday', '', NOW, false)
    expect(iso).toBe('2026-10-25T10:30:00.000Z')
    expect(occurredAtAllowed(iso as string, NOW, false)).toBe(true)
  })

  it('3 kun oldin — oyna chetiga yaqin bo‘lsa chegara + 15 daqiqa', () => {
    const iso = entryDateToIso('2026-10-23', NOW, false) as string
    expect(Date.parse(iso)).toBe(Date.parse(NOW) - 3 * 86_400_000 + ENTRY_DATE_MARGIN_MS)
    expect(occurredAtAllowed(iso, NOW, false)).toBe(true)
  })

  it('admin bo‘lmaganlarga 4 kun oldin va kelajak — undefined; admin — eski sana mumkin', () => {
    expect(entryDateToIso('2026-10-22', NOW, false)).toBeUndefined()
    expect(entryDateToIso('2026-10-27', NOW, false)).toBeUndefined()
    expect(entryDateToIso('2026-09-01', NOW, true)).toBe('2026-09-01T10:30:00.000Z')
    expect(entryDateToIso('2026-10-27', NOW, true)).toBeUndefined()
    expect(entryDateToIso('01.10.2026', NOW, true)).toBeUndefined()
  })

  it('Boshqa sana tanlanmagan — undefined (xato ko‘rsatiladi)', () => {
    expect(entryDateFor('other', '', NOW, false)).toBeUndefined()
    expect(entryDateFor('other', '2026-10-24', NOW, false)).toBe('2026-10-24T10:30:00.000Z')
  })

  it('DateField chegaralari: admin bo‘lmaganlar — oxirgi 3 kun, admin — faqat yuqori', () => {
    expect(entryDateBounds(NOW, false)).toEqual({ min: '2026-10-23', max: '2026-10-26' })
    expect(entryDateBounds(NOW, true)).toEqual({ min: undefined, max: '2026-10-26' })
  })
})
