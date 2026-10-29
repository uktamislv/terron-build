import { describe, expect, it } from 'vitest'
import { trackViewport } from './viewport'

describe('trackViewport — klaviatura aniqlash', () => {
  it('balandlik 80 % dan kam — klaviatura ochiq', () => {
    const a = trackViewport({ maxHeight: 800, width: 390 }, { height: 800, width: 390 })
    expect(a.keyboard).toBe(false)
    expect(trackViewport(a, { height: 500, width: 390 }).keyboard).toBe(true)
  })

  it('ekran burildi (kenglik o\'zgardi) — eng katta balandlik qaytadan; vertikalga qaytgach klaviatura "ochiq" bo\'lib qolmaydi', () => {
    let s = trackViewport({ maxHeight: 0, width: 0 }, { height: 800, width: 390 })
    s = trackViewport(s, { height: 360, width: 800 }) // gorizontal
    expect(s.keyboard).toBe(false)
    expect(s.maxHeight).toBe(360)
    s = trackViewport(s, { height: 800, width: 390 }) // vertikal
    expect(s).toEqual({ maxHeight: 800, width: 390, keyboard: false })
    // Gorizontaldagi eski max (yoki aksincha) qolib ketmaydi
    s = trackViewport(s, { height: 360, width: 800 })
    expect(s.keyboard).toBe(false)
  })
})
