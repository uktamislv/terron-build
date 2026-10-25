import { describe, expect, it } from 'vitest'
import { fillDays, topN } from './series'

interface Row {
  day: string
  sum: string
}
const empty = (day: string): Row => ({ day, sum: '0' })

describe('fillDays', () => {
  it('bo\'sh qatorlar → har kun nol', () => {
    expect(fillDays<Row>([], '2026-02-27', '2026-03-01', empty)).toEqual([
      { day: '2026-02-27', sum: '0' },
      { day: '2026-02-28', sum: '0' },
      { day: '2026-03-01', sum: '0' },
    ])
  })
  it('bitta kun', () => {
    expect(fillDays([{ day: '2026-10-25', sum: '5' }], '2026-10-25', '2026-10-25', empty)).toEqual([{ day: '2026-10-25', sum: '5' }])
  })
  it('chegaradagi kunlar saqlanadi, tashqaridagilar tashlanadi, tartiblanadi', () => {
    const rows: Row[] = [
      { day: '2026-10-03', sum: '3' },
      { day: '2026-09-30', sum: '99' },
      { day: '2026-10-01', sum: '1' },
      { day: '2026-10-04', sum: '99' },
    ]
    expect(fillDays(rows, '2026-10-01', '2026-10-03', empty)).toEqual([
      { day: '2026-10-01', sum: '1' },
      { day: '2026-10-02', sum: '0' },
      { day: '2026-10-03', sum: '3' },
    ])
  })
  it('takroriy kun — birinchisi olinadi, natijada takror yo\'q', () => {
    const out = fillDays(
      [
        { day: '2026-10-01', sum: '1' },
        { day: '2026-10-01', sum: '2' },
      ],
      '2026-10-01',
      '2026-10-02',
      empty,
    )
    expect(out).toEqual([
      { day: '2026-10-01', sum: '1' },
      { day: '2026-10-02', sum: '0' },
    ])
  })
  it('kabisa va yil o\'tishi', () => {
    expect(fillDays<Row>([], '2024-02-28', '2024-03-01', empty).map((r) => r.day)).toEqual(['2024-02-28', '2024-02-29', '2024-03-01'])
    expect(fillDays<Row>([], '2025-12-31', '2026-01-01', empty).map((r) => r.day)).toEqual(['2025-12-31', '2026-01-01'])
  })
  it('teskari yoki noto\'g\'ri oraliq → bo\'sh', () => {
    expect(fillDays<Row>([], '2026-10-02', '2026-10-01', empty)).toEqual([])
    expect(fillDays<Row>([], 'x', '2026-10-01', empty)).toEqual([])
  })
})

interface Item {
  name: string
  v: string
}
const other = (sum: string, count: number): Item => ({ name: `Boshqa (${count})`, v: sum })

describe('topN', () => {
  it('kamayish tartibi + "Boshqa"', () => {
    const rows: Item[] = [
      { name: 'a', v: '10' },
      { name: 'b', v: '30' },
      { name: 'c', v: '20' },
      { name: 'd', v: '5' },
    ]
    expect(topN(rows, 2, (r) => r.v, other)).toEqual([
      { name: 'b', v: '30' },
      { name: 'c', v: '20' },
      { name: 'Boshqa (2)', v: '15' },
    ])
  })
  it('n dan kam yoki teng qator — "Boshqa" yo\'q', () => {
    const rows: Item[] = [
      { name: 'a', v: '1' },
      { name: 'b', v: '2' },
    ]
    expect(topN(rows, 5, (r) => r.v, other)).toEqual([
      { name: 'b', v: '2' },
      { name: 'a', v: '1' },
    ])
    expect(topN(rows, 2, (r) => r.v, other)).toHaveLength(2)
    expect(topN<Item>([], 3, (r) => r.v, other)).toEqual([])
  })
  it('teng qiymatlar — asl tartib saqlanadi', () => {
    const rows: Item[] = [
      { name: 'a', v: '5' },
      { name: 'b', v: '7' },
      { name: 'c', v: '5' },
      { name: 'd', v: '5.0' },
    ]
    expect(topN(rows, 3, (r) => r.v, other).map((r) => r.name)).toEqual(['b', 'a', 'c', 'Boshqa (1)'])
  })
  it('Dec aniqligi (float xatosiz) va manfiy qiymatlar', () => {
    const rows: Item[] = [
      { name: 'a', v: '100' },
      { name: 'b', v: '0.1' },
      { name: 'c', v: '0.2' },
      { name: 'd', v: '-0.05' },
      { name: 'e', v: '9999999999999999.99' },
    ]
    const out = topN(rows, 1, (r) => r.v, other)
    expect(out[0]?.name).toBe('e')
    expect(out[1]).toEqual({ name: 'Boshqa (4)', v: '100.25' })
  })
  it('n = 0 → hammasi "Boshqa"', () => {
    expect(topN([{ name: 'a', v: '0.1' }, { name: 'b', v: '0.2' }], 0, (r) => r.v, other)).toEqual([{ name: 'Boshqa (2)', v: '0.3' }])
  })
})
