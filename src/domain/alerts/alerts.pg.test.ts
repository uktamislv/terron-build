// @vitest-environment node
// Farq qoidalari formulalarini haqiqiy PostgreSQL `numeric` (PGlite) bilan solishtirish.
// SQL ifodalar — db-architect'ning `private.*` funksiyalaridagi bilan aynan bir xil.
// Tasodifiy holatlar deterministik seed bilan.
import { PGlite } from '@electric-sql/pglite'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { parseDec } from '../decimal'
import { evaluatePrice, weightedAverage, type PricePoint } from './priceDeviation'
import { receiptDiffPct } from './receiptMismatch'

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

/** Musbat (yoki 0) o'nlik: butun qism ≤ maxInt, kasr ≤ maxFrac xona; ba'zan oxiri 5. */
function randDec(rnd: () => number, maxInt: number, maxFrac: number, nonZero = false): string {
  for (;;) {
    const intLen = randInt(rnd, 0, maxInt)
    const fracLen = randInt(rnd, 0, maxFrac)
    let frac = digits(rnd, fracLen)
    if (fracLen > 0 && rnd() < 0.3) frac = frac.slice(0, -1) + '5'
    const s = `${intLen === 0 ? '0' : digits(rnd, intLen)}${fracLen > 0 ? `.${frac}` : ''}`
    if (nonZero && /^[0.]*$/.test(s)) continue
    return s
  }
}

/** a ga yaqin qiymat (±20 %) — chegaraga yaqin holatlar uchun; ≥ 0. */
function near(rnd: () => number, a: string, frac: number): string {
  return (Number(a) * (0.8 + rnd() * 0.4)).toFixed(frac)
}

const toJson = (pts: PricePoint[]) => JSON.stringify(pts.map((p) => ({ t: p.totalAmount, q: p.qtyBase })))
const c = (v: string | null) => (v === null ? null : parseDec(v))

const N = 320

describe('alerts formulalari = PostgreSQL (PGlite)', () => {
  it(`receipt: round(abs(received - purchased) * 100 / purchased, 2) — ${N} holat`, async () => {
    const rnd = prng(20261105)
    for (let i = 0; i < N; i++) {
      const purchased = randDec(rnd, rnd() < 0.1 ? 14 : 6, 6, true)
      const kind = rnd()
      const received = kind < 0.15 ? '0' : kind < 0.6 ? near(rnd, purchased, 6) : randDec(rnd, rnd() < 0.1 ? 14 : 6, 6)
      const r = await db.query<{ r: string }>(
        `select round(abs(r - p) * 100 / p, 2)::text as r
           from (select $1::numeric(20,6) as p, $2::numeric(20,6) as r) x`,
        [purchased, received],
      )
      expect(receiptDiffPct(purchased, received), `${received} vs ${purchased}`).toBe(parseDec(r.rows[0]!.r))
    }
  })

  it(`receipt: received = coalesce(sum(qty_base), 0) bir nechta kirim — ${N} holat`, async () => {
    const rnd = prng(77)
    for (let i = 0; i < N; i++) {
      const purchased = randDec(rnd, 6, 6, true)
      const k = randInt(rnd, 0, 4)
      const parts = Array.from({ length: k }, () => ((Number(purchased) / k) * (0.8 + rnd() * 0.4)).toFixed(randInt(rnd, 0, 6)))
      const r = await db.query<{ r: string; s: string }>(
        `with k as (select unnest($2::text[])::numeric(20,6) as q),
              x as (select $1::numeric(20,6) as p, (select coalesce(sum(q), 0) from k) as r)
         select round(abs(r - p) * 100 / p, 2)::text as r, r::text as s from x`,
        [purchased, parts],
      )
      const received = parseDec(r.rows[0]!.s)!
      expect(receiptDiffPct(purchased, received), `${received} vs ${purchased}`).toBe(parseDec(r.rows[0]!.r))
    }
  })

  it(`price: og'irlikli avg (N va 90 kun), diff, high/low — ${N} holat`, async () => {
    const rnd = prng(808)
    /** Tasodifiy xarid: qty numeric(20,6), total numeric(18,2) ≈ qty × narx. */
    const point = (big: boolean, base: string): PricePoint => {
      const qty = randDec(rnd, big ? 6 : 4, 6, true)
      const unit = rnd() < 0.8 ? near(rnd, base, 4) : randDec(rnd, big ? 8 : 6, 4)
      let total = (Number(qty) * Number(unit)).toFixed(2)
      if (total.length > 18) total = randDec(rnd, 15, 2)
      return { totalAmount: total, qtyBase: qty }
    }
    for (let i = 0; i < N; i++) {
      const big = rnd() < 0.1
      const base = randDec(rnd, big ? 8 : 6, 4, true)
      const lastN = Array.from({ length: randInt(rnd, 0, 10) }, () => point(big, base))
      const last90 = Array.from({ length: randInt(rnd, 0, 15) }, () => point(big, base))
      const kind = rnd()
      const price = kind < 0.6 ? near(rnd, base, 4) : kind < 0.8 ? (Number(base) * rnd() * 0.6).toFixed(4) : randDec(rnd, big ? 8 : 6, 4)
      const threshold = randDec(rnd, 2, 2)
      const lowPct = rnd() < 0.5 ? '50' : randDec(rnd, 2, 2)
      const r = await db.query<{ avg_n: string | null; diff_n: string | null; avg_90: string | null; diff_90: string | null; dir: string }>(
        `with n as (select (e->>'t')::numeric(18,2) as t, (e->>'q')::numeric(20,6) as q from jsonb_array_elements($2::jsonb) e),
              d as (select (e->>'t')::numeric(18,2) as t, (e->>'q')::numeric(20,6) as q from jsonb_array_elements($3::jsonb) e),
              a as (select (select case when count(*) >= 2 then round(sum(t) / nullif(sum(q), 0), 4) end from n where t > 0) as avg_n,
                           (select case when count(*) >= 2 then round(sum(t) / nullif(sum(q), 0), 4) end from d where t > 0) as avg_90,
                           $1::numeric(18,4) as price),
              f as (select avg_n, avg_90,
                           case when avg_n <> 0 then round((price - avg_n) * 100 / avg_n, 2) end as diff_n,
                           case when avg_90 <> 0 then round((price - avg_90) * 100 / avg_90, 2) end as diff_90
                      from a)
         select avg_n::text, diff_n::text, avg_90::text, diff_90::text,
                case when diff_n > $4::numeric(6,2) or diff_90 > $4::numeric(6,2) then 'high'
                     when diff_n <= -$5::numeric(6,2) or diff_90 <= -$5::numeric(6,2) then 'low'
                     else 'ok' end as dir
           from f`,
        [price, toJson(lastN), toJson(last90), threshold, lowPct],
      )
      const row = r.rows[0]!
      const ours = evaluatePrice({ pricePerBase: price, lastN, last90, thresholdPct: threshold, lowPct })
      const ctx = `${price} | N=${toJson(lastN)} | 90=${toJson(last90)}`
      expect(ours, ctx).toEqual({ direction: row.dir, avgN: c(row.avg_n), diffN: c(row.diff_n), avg90: c(row.avg_90), diff90: c(row.diff_90) })
      expect(weightedAverage(lastN), ctx).toBe(c(row.avg_n))
    }
  })

  it('belgilangan chegaraviy holatlar', async () => {
    const receipt: [string, string][] = [
      ['3', '1'],
      ['3', '2'],
      ['7', '6'],
      ['0.000001', '99999999999999.999999'],
      ['99999999999999.999999', '0.000001'],
      ['1000', '1000.05'],
      ['0.000003', '0.000002'],
    ]
    for (const [p, rcv] of receipt) {
      const r = await db.query<{ r: string }>('select round(abs($2::numeric(20,6) - $1::numeric(20,6)) * 100 / $1::numeric(20,6), 2)::text as r', [p, rcv])
      expect(receiptDiffPct(p, rcv), `${rcv} vs ${p}`).toBe(parseDec(r.rows[0]!.r))
    }
    const fixed: PricePoint[][] = [
      [{ totalAmount: '4', qtyBase: '3' }, { totalAmount: '0.01', qtyBase: '0.000001' }],
      [{ totalAmount: '100000', qtyBase: '1' }, { totalAmount: '10000000', qtyBase: '200' }],
      [{ totalAmount: '9999999999999999.99', qtyBase: '0.000001' }, { totalAmount: '0.01', qtyBase: '0.000001' }],
      [{ totalAmount: '1', qtyBase: '3' }, { totalAmount: '1', qtyBase: '3' }, { totalAmount: '0.01', qtyBase: '7' }],
    ]
    for (const pts of fixed) {
      const r = await db.query<{ r: string }>(
        `select round(sum((e->>'t')::numeric(18,2)) / sum((e->>'q')::numeric(20,6)), 4)::text as r from jsonb_array_elements($1::jsonb) e`,
        [toJson(pts)],
      )
      expect(weightedAverage(pts), toJson(pts)).toBe(parseDec(r.rows[0]!.r))
    }
  })
})
