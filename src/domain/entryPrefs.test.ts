import { describe, expect, it } from 'vitest'
import {
  ENTRY_PREFS_MAX,
  getEntryPref,
  normalizeEntryPref,
  parseEntryPrefs,
  rememberEntryPref,
  serializeEntryPrefs,
  type EntryPref,
} from './entryPrefs'

const p = (materialId: string, qty = '10', unitId = 'u-kg', userId = 'user1'): EntryPref => ({ userId, materialId, unitId, qty })

describe('normalizeEntryPref', () => {
  it('to\'g\'ri yozuv, miqdor kanonik', () => {
    expect(normalizeEntryPref({ ...p('m1'), qty: '1,50' })).toEqual({ ...p('m1'), qty: '1.5' })
  })
  it.each([
    ['null', null],
    ['satr', 'x'],
    ['userId bo\'sh', { ...p('m1'), userId: '' }],
    ['materialId son', { ...p('m1'), materialId: 5 }],
    ['unitId uzun', { ...p('m1'), unitId: 'x'.repeat(65) }],
    ['id bo\'sh joy bilan', { ...p('m1'), unitId: ' u' }],
    ['miqdor 0', { ...p('m1'), qty: '0' }],
    ['miqdor manfiy', { ...p('m1'), qty: '-1' }],
    ['miqdor matn', { ...p('m1'), qty: 'abc' }],
    ['miqdor son turi', { ...p('m1'), qty: 5 }],
  ])('%s → null', (_n, v) => {
    expect(normalizeEntryPref(v)).toBeNull()
  })
})

describe('serialize / parse', () => {
  it('aylanma (round-trip)', () => {
    const list = [p('m1'), p('m2', '2.5', 'u-t'), p('m1', '3', 'u-kg', 'user2')]
    expect(parseEntryPrefs(serializeEntryPrefs(list))).toEqual(list)
  })
  it.each([null, undefined, '', 'not json', '42', 'null', '[]', '{"v":2,"items":[]}', '{"v":1}', '{"v":1,"items":{}}'])(
    'buzilgan kirish %s → []',
    (raw) => {
      expect(parseEntryPrefs(raw)).toEqual([])
    },
  )
  it('noto\'g\'ri yozuvlar tashlanadi, takroriy kalit — birinchisi qoladi', () => {
    const raw = JSON.stringify({
      v: 1,
      items: [
        { u: 'user1', m: 'm1', unit: 'a', q: '1' },
        null,
        { u: 'user1', m: 'm2', unit: 'a', q: '-1' },
        { u: 'user1', m: 'm1', unit: 'b', q: '2' },
        { u: 'user1', m: 'm3', unit: 'c', q: '3' },
      ],
    })
    expect(parseEntryPrefs(raw)).toEqual([p('m1', '1', 'a'), p('m3', '3', 'c')])
  })
  it('200 dan ortig\'i kesiladi (parse va serialize)', () => {
    const many = Array.from({ length: 250 }, (_, i) => p(`m${i}`))
    expect(parseEntryPrefs(serializeEntryPrefs(many))).toHaveLength(ENTRY_PREFS_MAX)
    const raw = JSON.stringify({ v: 1, items: many.map((x) => ({ u: x.userId, m: x.materialId, unit: x.unitId, q: x.qty })) })
    const parsed = parseEntryPrefs(raw)
    expect(parsed).toHaveLength(ENTRY_PREFS_MAX)
    expect(parsed[0]?.materialId).toBe('m0')
  })
})

describe('getEntryPref', () => {
  it('foydalanuvchi + material bo\'yicha', () => {
    const list = [p('m1', '1'), p('m1', '9', 'u', 'user2')]
    expect(getEntryPref(list, 'user2', 'm1')?.qty).toBe('9')
    expect(getEntryPref(list, 'user1', 'm2')).toBeNull()
    expect(getEntryPref([], 'user1', 'm1')).toBeNull()
  })
})

describe('rememberEntryPref', () => {
  it('yangisi boshiga, eski shu kalit olib tashlanadi', () => {
    const list = [p('m1', '1'), p('m2', '2')]
    const next = rememberEntryPref(list, p('m2', '5'))
    expect(next).toEqual([p('m2', '5'), p('m1', '1')])
    expect(list).toEqual([p('m1', '1'), p('m2', '2')]) // kirish o'zgarmaydi
  })
  it('LRU: 200 dan oshsa eng eskisi tashlanadi', () => {
    const full = Array.from({ length: ENTRY_PREFS_MAX }, (_, i) => p(`m${i}`))
    const next = rememberEntryPref(full, p('new'))
    expect(next).toHaveLength(ENTRY_PREFS_MAX)
    expect(next[0]?.materialId).toBe('new')
    expect(next.some((x) => x.materialId === `m${ENTRY_PREFS_MAX - 1}`)).toBe(false)
  })
  it('noto\'g\'ri yozuv → o\'zgarmagan nusxa', () => {
    const list = [p('m1')]
    const next = rememberEntryPref(list, p('m2', '0'))
    expect(next).toEqual(list)
    expect(next).not.toBe(list)
  })
  it('miqdor normallashtiriladi', () => {
    expect(rememberEntryPref([], p('m1', '2,50'))[0]?.qty).toBe('2.5')
  })
})
