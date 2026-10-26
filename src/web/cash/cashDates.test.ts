import { describe, expect, it } from 'vitest'
import { issuedAtBounds, issuedAtIso, todayTashkent } from './cashDates'

// 26.10.2026 15:00 Toshkent
const NOW = '2026-10-26T10:00:00.000Z'

describe('podotchet sanasi — server oynasi bilan bir xil', () => {
  it('bugun — null (server now())', () => {
    expect(todayTashkent(new Date(NOW))).toBe('2026-10-26')
    expect(issuedAtIso('2026-10-26', NOW, false)).toBeNull()
  })
  it('admin bo‘lmagan: oxirgi 3 kun ichida — ISO, undan eski — undefined; 12:00 emas, hozirgi soat', () => {
    expect(issuedAtIso('2026-10-25', NOW, false)).toBe('2026-10-25T10:00:00.000Z')
    expect(issuedAtIso('2026-10-20', NOW, false)).toBeUndefined()
    expect(issuedAtBounds(NOW, false).min).toBe('2026-10-23')
  })
  it('admin — istalgan o‘tgan sana; kelajak — hech kimga', () => {
    expect(issuedAtIso('2026-09-01', NOW, true)).toBe('2026-09-01T10:00:00.000Z')
    expect(issuedAtBounds(NOW, true).min).toBeUndefined()
    expect(issuedAtIso('2026-10-27', NOW, true)).toBeUndefined()
  })
})
