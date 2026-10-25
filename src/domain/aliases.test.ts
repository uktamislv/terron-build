import { describe, expect, it } from 'vitest'
import { matchMaterialByName, normalizeAlias } from './aliases'

describe('normalizeAlias', () => {
  it('trim, ichki bo\'sh joylar, kichik harf', () => {
    expect(normalizeAlias('  Цемент   М500 ')).toBe('цемент м500')
    expect(normalizeAlias('Цемент М500')).toBe(normalizeAlias('цемент  м500'))
    expect(normalizeAlias('Sement\tM400')).toBe('sement m400')
  })

  it('ё → е', () => {
    expect(normalizeAlias('Щёбень')).toBe('щебень')
    expect(normalizeAlias('ЩЁБЕНЬ')).toBe(normalizeAlias('Щебень'))
  })

  it('lotin/kirill o\'xshash harflar o\'zgartirilmaydi', () => {
    // kirill "М" va lotin "M"
    expect(normalizeAlias('Цемент М500')).not.toBe(normalizeAlias('Цемент M500'))
  })

  it('bo\'sh satr', () => {
    expect(normalizeAlias('   ')).toBe('')
  })
})

const MATERIALS = [
  { id: 'm400', name: 'Sement M400', aliases: ['Цемент М400'] },
  { id: 'm500', name: 'Sement M500', aliases: ['Цемент М500'] },
  { id: 'qum', name: 'Qum', aliases: ['Песок'] },
  { id: 'shagal', name: "Shag'al", aliases: ['Щебень'] },
  { id: 'arm', name: 'Armatura', aliases: ['Арматура'] },
  { id: 'kafel', name: 'Kafel', aliases: ['Плитка', 'Кафель'] },
]

describe('matchMaterialByName', () => {
  it('aniq moslik — score 1 (normalizeAlias bo\'yicha)', () => {
    expect(matchMaterialByName('цемент  м500', MATERIALS)[0]).toEqual({ id: 'm500', score: 1 })
    expect(matchMaterialByName('  SEMENT M400 ', MATERIALS)[0]).toEqual({ id: 'm400', score: 1 })
    expect(matchMaterialByName('Щёбень', MATERIALS)).toEqual([{ id: 'shagal', score: 1 }])
    expect(matchMaterialByName('кафель', MATERIALS)).toEqual([{ id: 'kafel', score: 1 }])
  })

  it('marka saqlanadi: М400 М500 ga mos kelmaydi', () => {
    const r = matchMaterialByName('Цемент М400', MATERIALS)
    expect(r).toEqual([{ id: 'm400', score: 1 }])
    expect(r.find((x) => x.id === 'm500')).toBeUndefined()
  })

  it('qisman moslik: so\'z kesishmasi, aniq moslikdan past', () => {
    const r = matchMaterialByName('Цемент М500 (мешок 50 кг)', MATERIALS)
    expect(r.map((x) => x.id)).toEqual(['m500'])
    expect(r[0]!.score).toBeGreaterThan(0)
    expect(r[0]!.score).toBeLessThan(1)
  })

  it('markasiz so\'rov ikkala markaga teng, kirish tartibida', () => {
    const r = matchMaterialByName('цемент', MATERIALS)
    expect(r.map((x) => x.id)).toEqual(['m400', 'm500'])
    expect(r[0]!.score).toBe(r[1]!.score)
  })

  it('aniq moslik qisman moslikdan oldin', () => {
    const mats = [
      { id: 'a', name: 'Песок мытый', aliases: [] },
      { id: 'b', name: 'Песок', aliases: [] },
    ]
    const r = matchMaterialByName('песок', mats)
    expect(r.map((x) => x.id)).toEqual(['b', 'a'])
    expect(r[0]!.score).toBe(1)
    expect(r[1]!.score).toBeCloseTo(0.45, 10)
  })

  it('tinish belgilari so\'zlarni ajratadi', () => {
    const r = matchMaterialByName('Цемент, М500', MATERIALS)
    expect(r[0]!.id).toBe('m500')
    expect(r[0]!.score).toBeCloseTo(0.9, 10)
  })

  it('mos kelmasa yoki bo\'sh — bo\'sh ro\'yxat (0 lar chiqmaydi)', () => {
    expect(matchMaterialByName('Гипсокартон', MATERIALS)).toEqual([])
    expect(matchMaterialByName('   ', MATERIALS)).toEqual([])
    expect(matchMaterialByName('цемент', [])).toEqual([])
  })

  it('deterministik', () => {
    const a = matchMaterialByName('Цемент М500 мешок', MATERIALS)
    const b = matchMaterialByName('Цемент М500 мешок', MATERIALS)
    expect(a).toEqual(b)
  })
})
