import { describe, expect, it } from 'vitest'
import { guideMarkdownFiles } from './guidesMarkdown'

// docs/qollanma/*.md — xom matn (Vite ?raw)
const DOCS = import.meta.glob('/docs/qollanma/*.md', { query: '?raw', import: 'default', eager: true }) as Record<string, string>

describe('docs/qollanma — guides.uz.ts bilan aynan bir xil', () => {
  it.each(Object.entries(guideMarkdownFiles()))('%s — `npm run guides:md` natijasi bilan bir xil', (name, expected) => {
    const actual = (DOCS[`/docs/qollanma/${name}`] ?? '').replace(/\r\n/g, '\n')
    expect(actual).toBe(expected)
  })

  it('docs/qollanma da ortiqcha (generatsiya qilinmagan) fayl yo‘q', () => {
    const generated = Object.keys(guideMarkdownFiles()).map((n) => `/docs/qollanma/${n}`).sort()
    expect(Object.keys(DOCS).sort()).toEqual(generated)
  })

  it('eskirgan nomlar yo‘q (Mini App, Ombor harakatlari, Qo‘limdagi pul, Inventar, Yozuvlarim)', () => {
    for (const [name, text] of Object.entries(guideMarkdownFiles())) {
      expect(text, name).not.toMatch(/Mini App|Ombor harakatlari|Qo‘limdagi pul|Inventar\b|Yozuvlarim/)
    }
  })
})
