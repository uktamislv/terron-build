// @vitest-environment node
// decimal.ts / units.ts natijalarini haqiqiy PostgreSQL `numeric` (PGlite) bilan solishtirish.
// Tasodifiy holatlar deterministik seed bilan — har ishga tushirishda bir xil.
import { PGlite } from '@electric-sql/pglite'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { add, div, mul, parseDec, pgNumericDiv, round, sub } from './decimal'
import { purchasePrices, toBaseQty } from './units'

let db: PGlite

beforeAll(async () => {
  db = await PGlite.create()
}, 120_000)

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

function randInt(rnd: () => number, min: number, max: number): number {
  return min + Math.floor(rnd() * (max - min + 1))
}

function digits(rnd: () => number, n: number): string {
  let s = ''
  for (let i = 0; i < n; i++) s += String(randInt(rnd, 0, 9))
  return s
}

/** Tasodifiy o'nlik: butun qism ≤ maxInt xona, kasr ≤ maxFrac xona; ba'zan oxiri 5 (yaxlitlash chegarasi). */
function randDec(rnd: () => number, maxInt: number, maxFrac: number, opts: { negative?: boolean; nonZero?: boolean } = {}): string {
  for (;;) {
    const intLen = randInt(rnd, 0, maxInt)
    const fracLen = randInt(rnd, 0, maxFrac)
    let frac = digits(rnd, fracLen)
    if (fracLen > 0 && rnd() < 0.3) frac = frac.slice(0, -1) + '5'
    const sign = opts.negative && rnd() < 0.4 ? '-' : ''
    const s = `${sign}${intLen === 0 ? '0' : digits(rnd, intLen)}${fracLen > 0 ? `.${frac}` : ''}`
    if (opts.nonZero && /^-?[0.]*$/.test(s)) continue
    return s
  }
}

/** PostgreSQL natijasini kanonik Dec ga (trailing nollarsiz). */
async function pg(sql: string, params: unknown[]): Promise<string> {
  const r = await db.query<{ r: string }>(sql, params)
  const v = r.rows[0]?.r
  if (v === undefined) throw new Error('pg: natija yo\'q')
  const c = parseDec(v)
  if (c === null) throw new Error(`pg: kutilmagan natija ${v}`)
  return c
}

const N = 250

describe('PostgreSQL numeric bilan solishtirish (PGlite)', () => {
  it(`toBaseQty = round(qty_input::numeric(20,6) * factor::numeric(20,10), 6) — ${N} holat`, async () => {
    const rnd = prng(20261025)
    for (let i = 0; i < N; i++) {
      const qty = randDec(rnd, 8, 6, { negative: true, nonZero: true })
      const factor = randDec(rnd, 6, 10, { nonZero: true })
      const expected = await pg('select round($1::numeric(20,6) * $2::numeric(20,10), 6)::text as r', [qty, factor])
      expect(toBaseQty(qty, factor), `${qty} * ${factor}`).toBe(expected)
    }
  })

  it(`round(a * b, 6), add, sub — ${N} holat`, async () => {
    const rnd = prng(42)
    for (let i = 0; i < N; i++) {
      const a = randDec(rnd, 14, 8, { negative: true })
      const b = randDec(rnd, 10, 10, { negative: true })
      const r = await db.query<{ m: string; s: string; d: string; p: string }>(
        'select round($1::numeric * $2::numeric, 6)::text as m, ($1::numeric + $2::numeric)::text as s, ($1::numeric - $2::numeric)::text as d, ($1::numeric * $2::numeric)::text as p',
        [a, b],
      )
      const row = r.rows[0]!
      expect(round(mul(a, b), 6), `round(${a} * ${b}, 6)`).toBe(parseDec(row.m))
      expect(mul(a, b), `${a} * ${b}`).toBe(parseDec(row.p))
      expect(add(a, b), `${a} + ${b}`).toBe(parseDec(row.s))
      expect(sub(a, b), `${a} - ${b}`).toBe(parseDec(row.d))
    }
  })

  it(`round(a, s) — half away from zero — ${N} holat`, async () => {
    const rnd = prng(7)
    for (let i = 0; i < N; i++) {
      const a = randDec(rnd, 12, 10, { negative: true })
      const s = randInt(rnd, 0, 8)
      const expected = await pg('select round($1::numeric, $2::int)::text as r', [a, s])
      expect(round(a, s), `round(${a}, ${s})`).toBe(expected)
    }
  })

  it(`div(a, b, s) — aniq yaxlitlash (PG'da yuqori aniqlik bilan) — ${N} holat`, async () => {
    const rnd = prng(1234)
    for (let i = 0; i < N; i++) {
      const a = randDec(rnd, 12, 6, { negative: true })
      const b = randDec(rnd, 8, 8, { negative: true, nonZero: true })
      const s = randInt(rnd, 0, 8)
      // round(a, 40) → dscale 40: PG bo'linmani ≥ 40 xona aniqlikda hisoblaydi
      const expected = await pg('select round(round($1::numeric, 40) / $2::numeric, $3::int)::text as r', [a, b, s])
      expect(div(a, b, s), `div(${a}, ${b}, ${s})`).toBe(expected)
    }
  })

  it(`pgNumericDiv = PostgreSQL a / b, round(a / b, s) — ${N} holat`, async () => {
    const rnd = prng(99)
    for (let i = 0; i < N; i++) {
      const a = randDec(rnd, 16, 6, { negative: true })
      const b = randDec(rnd, 10, 10, { negative: true, nonZero: true })
      const s = randInt(rnd, 0, 8)
      const r = await db.query<{ q: string; rq: string }>(
        'select ($1::numeric / $2::numeric)::text as q, round($1::numeric / $2::numeric, $3::int)::text as rq',
        [a, b, s],
      )
      const row = r.rows[0]!
      expect(pgNumericDiv(a, b), `${a} / ${b}`).toBe(parseDec(row.q))
      expect(round(pgNumericDiv(a, b), s), `round(${a} / ${b}, ${s})`).toBe(parseDec(row.rq))
    }
  })

  it(`purchasePrices = trigger formulalari (numeric(18,2) / numeric(20,6)) — ${N} holat`, async () => {
    const rnd = prng(500)
    for (let i = 0; i < N; i++) {
      const total = randDec(rnd, rnd() < 0.1 ? 16 : 10, 2)
      const qtyInput = randDec(rnd, rnd() < 0.1 ? 1 : 6, 6, { nonZero: true })
      const factor = randDec(rnd, 4, 10, { nonZero: true })
      const qtyBase = toBaseQty(qtyInput, factor)
      if (qtyBase === '0') continue
      const r = await db.query<{ up: string; ppb: string; qb: string }>(
        `select round($1::numeric(18,2) / $2::numeric(20,6), 2)::text as up,
                round($1::numeric(18,2) / round($2::numeric(20,6) * $3::numeric(20,10), 6)::numeric(20,6), 4)::text as ppb,
                round($2::numeric(20,6) * $3::numeric(20,10), 6)::text as qb`,
        [total, qtyInput, factor],
      )
      const row = r.rows[0]!
      expect(qtyBase).toBe(parseDec(row.qb))
      expect(purchasePrices(total, qtyInput, qtyBase), `${total} / ${qtyInput} (${qtyBase})`).toEqual({
        unitPrice: parseDec(row.up),
        pricePerBase: parseDec(row.ppb),
      })
    }
  })

  it('belgilangan chegaraviy holatlar', async () => {
    const cases: [string, string][] = [
      ['round(2.5, 0)', round('2.5', 0)],
      ['round(-2.5, 0)', round('-2.5', 0)],
      ['round(1.0000005, 6)', round('1.0000005', 6)],
      ['round(1::numeric / 3, 6)', div('1', '3', 6)],
      ['0.1 + 0.2', add('0.1', '0.2')],
      ['99999999999999.999999 * 1', mul('99999999999999.999999', '1')],
      ['round(100000.00 / 3.000000, 2)', purchasePrices('100000', '3', '150').unitPrice],
      ['round(100000.00 / 150.000000, 4)', purchasePrices('100000', '3', '150').pricePerBase],
      ['1::numeric / 3', pgNumericDiv('1', '3')],
      ['100000000000000000000::numeric / 3', pgNumericDiv('100000000000000000000', '3')],
    ]
    for (const [expr, ours] of cases) {
      expect(ours, expr).toBe(await pg(`select (${expr})::text as r`, []))
    }
  })
})
