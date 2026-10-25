// @vitest-environment node
// normalizeAlias (JS) va bazadagi private.norm_name (SQL) bir xil natija berishini tekshiradi.
// Migratsiyalar PGlite'da qo'llanadi (supabase/tests/sql/_harness.ts).
import type { PGlite } from '@electric-sql/pglite'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { normalizeAlias } from './aliases'

// Harness Node API'lariga tayanadi; tsconfig.app (brauzer turlari) uni tekshirmasligi uchun
// dinamik import qilinadi.
const HARNESS: string = '../../supabase/tests/sql/_harness.ts'
type Db = PGlite

let db: Db

beforeAll(async () => {
  const { createDb } = (await import(/* @vite-ignore */ HARNESS)) as { createDb: () => Promise<Db> }
  db = await createDb()
}, 300_000)

afterAll(async () => {
  await db?.close()
})

/** mulberry32 — deterministik PRNG */
function prng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// Tasodifiy satrlar shu "alifbo"dan: lotin, kirill (ё/Ё bilan), raqamlar, tinish belgilari,
// o'zbekcha belgilar, har xil bo'sh joylar (shu jumladan norm_name ro'yxatida YO'Q bo'lganlar),
// emoji va boshqa Unicode.
const ALPHABET = [
  ...'abcxyzABCXYZ',
  ...'цементЦЕМЕНТпесокПЕСОКщебеньЩЕБЕНЬ',
  'ё',
  'Ё',
  'ё',
  'Ё',
  ...'0123456789',
  ...".,-()/×Ø'ʻʼ‘’",
  ...'oʻgʻOʻGʻ',
  ' ',
  ' ',
  ' ',
  '\t',
  '\n',
  '\r',
  ' ',
  ' ',
  ' ',
  ' ', // ingichka probel — ro'yxatda yo'q
  '　', // ideografik probel — ro'yxatda yo'q
  '​', // nol kenglikdagi probel — ro'yxatda yo'q
  '\v',
  '\f',
  '😀',
  '🧱',
  'ß',
  'İ',
  'Σ',
  'ς',
  'Ä',
  'Ž',
]

function randomString(rnd: () => number): string {
  const len = Math.floor(rnd() * 16)
  let s = ''
  for (let i = 0; i < len; i++) s += ALPHABET[Math.floor(rnd() * ALPHABET.length)]
  return s
}

const MANUAL = [
  '',
  ' ',
  '   ',
  'Цемент М500',
  '  Цемент   М500  ',
  'цемент  м500',
  'ЦЕМЕНТ М500',
  'Sement M500',
  'Цемент M500', // lotin M
  'Щёбень',
  'ЩЁБЕНЬ',
  'ёЁ',
  'Цемент\tМ500',
  '\tЦемент М500\t',
  'Цемент М500',
  ' Цемент ',
  'Цемент М500',
  'Цемент М500',
  'Цемент  \t\n\r М500',
  '\n\r\t',
  'Цемент М500',
  'Цемент　М500',
  'Кирпич 🧱',
  '😀',
  "G'isht",
  'Gʻisht oʻq',
  'Armatura Ø12',
  'Kafel 30×30 sm',
  'Straße',
  'İstanbul',
  'ΣΟΦΟΣ',
  'ǅ Ⅻ Ⓐ ΣΑΣ',
  'ΣΑΣ, Σ.',
]

async function normName(s: string): Promise<string> {
  const r = await db.query<{ r: string }>('select private.norm_name($1) as r', [s])
  const v = r.rows[0]?.r
  if (v === undefined) throw new Error('norm_name: natija yo\'q')
  return v
}

describe('normalizeAlias = private.norm_name', () => {
  it('qo\'lda tanlangan holatlar', async () => {
    for (const s of MANUAL) {
      expect(normalizeAlias(s), JSON.stringify(s)).toBe(await normName(s))
    }
  })

  it('320 ta tasodifiy satr (deterministik seed)', async () => {
    const rnd = prng(20261025)
    for (let i = 0; i < 320; i++) {
      const s = randomString(rnd)
      expect(normalizeAlias(s), JSON.stringify(s)).toBe(await normName(s))
    }
  })
})
