import { describe, expect, it } from 'vitest'
import { ROLES } from '@/domain/roles'
import { guideText, guideWordCount, guides } from './guides.uz'

describe('guides.uz', () => {
  it('har bir rol uchun qo‘llanma bor', () => {
    for (const role of ROLES) expect(guides[role], role).toBeDefined()
    expect(Object.keys(guides).sort()).toEqual([...ROLES].sort())
  })

  it('bo‘sh matn yo‘q, bo‘limlar to‘ldirilgan', () => {
    for (const role of ROLES) {
      const g = guides[role]
      expect(g.daily.length, role).toBeGreaterThan(0)
      expect(g.rules.length, role).toBeGreaterThan(0)
      expect(g.alerts.length, role).toBeGreaterThan(0)
      for (const d of g.daily) expect(d.steps.length, `${role}: ${d.title}`).toBeGreaterThan(0)
      for (const s of guideText(g)) expect(s.trim(), role).not.toBe('')
    }
  })

  it('har rol bir sahifaga sig‘adi (≤ 400 so‘z)', () => {
    for (const role of ROLES) expect(guideWordCount(guides[role]), role).toBeLessThanOrEqual(400)
  })

  it('har qo‘llanmada “Xatolik haqida xabar berish” tugmasi tilga olingan', () => {
    for (const role of ROLES) expect(guides[role].help, role).toContain('“Xatolik haqida xabar berish”')
  })

  it('o‘/g‘ uchun uz.ts dagi kabi ‘ (U+2018) ishlatiladi, ASCII apostrof yo‘q', () => {
    for (const role of ROLES) {
      for (const s of guideText(guides[role])) {
        expect(s, role).not.toMatch(/[og]['`’]/i)
        expect(s, role).not.toContain("'")
      }
    }
  })
})
