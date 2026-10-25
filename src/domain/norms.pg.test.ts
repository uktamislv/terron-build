// @vitest-environment node
// Batch 8 formulalari (norma, so'rov, inventarizatsiya) — haqiqiy PostgreSQL `numeric` (PGlite) bilan.
// SQL ifodalar — docs/requests-design.md va db-architect'ning `norm_usage` / `private.*` dagi bilan aynan bir xil.
// Ustun turlari: norm / consumed / shortage — numeric(20,6), waste — numeric(6,2), price — numeric(18,4).
import { PGlite } from '@electric-sql/pglite'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { parseDec } from './decimal'
import { shortageSeverity, shortageValue } from './inventory'
import { allowedQty, evaluateNorm, evaluateRequest, usagePct } from './norms'

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

/** a ga yaqin qiymat (±40 %) — chegaraga yaqin holatlar uchun; ≥ 0. */
function near(rnd: () => number, a: string, frac: number): string {
  return (Number(a) * (0.7 + rnd() * 0.6)).toFixed(frac)
}

const c = (v: string | null) => (v === null ? null : parseDec(v))

const N = 320

describe('Batch 8 formulalari = PostgreSQL (PGlite)', () => {
  it(`norma: allowed, over_pct, usage_pct, status, severity — ${N} holat`, async () => {
    const rnd = prng(20261025)
    for (let i = 0; i < N; i++) {
      const big = rnd() < 0.1
      const normQ = rnd() < 0.08 ? '0' : randDec(rnd, big ? 14 : 6, 6, true)
      const waste = rnd() < 0.2 ? '0' : rnd() < 0.05 ? randDec(rnd, 4, 2) : randDec(rnd, 2, 2)
      const kind = rnd()
      const consumed =
        kind < 0.1 ? '0' : kind < 0.2 ? allowedQty(normQ, waste) : kind < 0.7 ? near(rnd, allowedQty(normQ, waste), 6) : randDec(rnd, big ? 14 : 6, 6)
      const r = await db.query<{ allowed: string; over_pct: string | null; usage: string | null; status: string; severity: string | null }>(
        `with x as (select $1::numeric(20,6) as n, $2::numeric(6,2) as w, $3::numeric(20,6) as c),
              a as (select n, c, round(n * (1 + w / 100), 6) as allowed from x),
              o as (select n, c, allowed,
                           case when c > allowed and allowed > 0 then round((c - allowed) * 100 / allowed, 2) end as over_pct,
                           case when allowed <> 0 then round(c * 100 / allowed, 1) end as usage
                      from a)
         select allowed::text, over_pct::text, usage::text,
                case when n = 0 and c > 0 then 'not_in_estimate' when c > allowed then 'over' else 'ok' end as status,
                case when n = 0 and c > 0 then 'ogohlantirish'
                     when c > allowed then case when over_pct >= 25 then 'jiddiy' else 'ogohlantirish' end end as severity
           from o`,
        [normQ, waste, consumed],
      )
      const row = r.rows[0]!
      const ctx = `norm=${normQ} waste=${waste} consumed=${consumed}`
      expect(allowedQty(normQ, waste), ctx).toBe(parseDec(row.allowed))
      expect(evaluateNorm({ normQtyBase: normQ, wastePct: waste, consumedQtyBase: consumed }), ctx).toEqual({
        status: row.status,
        allowed: parseDec(row.allowed),
        overPct: c(row.over_pct),
        severity: row.severity,
      })
      expect(usagePct(consumed, parseDec(row.allowed)!), ctx).toBe(c(row.usage))
    }
  })

  it(`so'rov: available, over, over_qty — ${N} holat`, async () => {
    const rnd = prng(606)
    for (let i = 0; i < N; i++) {
      const allowed = rnd() < 0.1 ? '0' : randDec(rnd, 6, 6)
      const consumed = rnd() < 0.2 ? '0' : near(rnd, allowed, randInt(rnd, 0, 6))
      const other = rnd() < 0.4 ? '0' : randDec(rnd, 5, 6)
      const requested = rnd() < 0.5 ? randDec(rnd, 6, 6) : near(rnd, allowed, 6)
      const dk = rnd()
      // delivered: 0, = consumed, manfiy (transfer_out > kirim), yoki consumed ga yaqin (±30 %)
      const delivered =
        dk < 0.15 ? '0' : dk < 0.3 ? consumed : dk < 0.4 ? `-${randDec(rnd, 3, 6, true)}` : near(rnd, consumed === '0' ? allowed : consumed, randInt(rnd, 0, 6))
      const r = await db.query<{ available: string; over: boolean; over_qty: string }>(
        `with x as (select $1::numeric(20,6) as q, $2::numeric(20,6) as a, $3::numeric(20,6) as c, $4::numeric(20,6) as o,
                           $5::numeric(20,6) as d),
              v as (select q, a - greatest(c, d) - o as available from x)
         select available::text, q > available as over, greatest(q - available, 0)::text as over_qty from v`,
        [requested, allowed, consumed, other, delivered],
      )
      const row = r.rows[0]!
      expect(
        evaluateRequest({
          requestedQtyBase: requested,
          allowedQtyBase: allowed,
          consumedQtyBase: consumed,
          deliveredQtyBase: delivered,
          otherOpenQtyBase: other,
        }),
        `${requested} | ${allowed} - max(${consumed}, ${delivered}) - ${other}`,
      ).toEqual({ over: row.over, available: parseDec(row.available), overQty: parseDec(row.over_qty) })
    }
  })

  it(`inventarizatsiya: shortage_value, severity — ${N} holat`, async () => {
    const rnd = prng(4242)
    for (let i = 0; i < N; i++) {
      const big = rnd() < 0.1
      const shortage = randDec(rnd, big ? 14 : 5, 6, true)
      const price = rnd() < 0.1 ? null : randDec(rnd, big ? 14 : 7, 4)
      const r = await db.query<{ v: string | null; sev: string }>(
        `with x as (select round($1::numeric(20,6) * $2::numeric(18,4), 2) as v)
         select v::text, case when v >= 1000000 then 'jiddiy' else 'ogohlantirish' end as sev from x`,
        [shortage, price],
      )
      const row = r.rows[0]!
      const ours = shortageValue(shortage, price)
      expect(ours, `${shortage} × ${price}`).toBe(c(row.v))
      expect(shortageSeverity(ours)).toBe(row.sev)
    }
  })

  it('belgilangan chegaraviy holatlar', async () => {
    const cases: [string, string, string][] = [
      ['100', '0', '125'],
      ['100', '5', '131.25'],
      ['3', '0', '4'],
      ['0.000001', '50', '0.000003'],
      ['0.000001', '0', '99999999999999.999999'],
      ['99999999999999.999999', '9999.99', '99999999999999.999999'],
      ['7', '33.33', '9.33331'],
      ['1', '0.01', '1.0001'],
      ['0', '5', '10'],
      ['0', '5', '0'],
    ]
    for (const [n, w, cons] of cases) {
      const r = await db.query<{ allowed: string; over_pct: string | null }>(
        `with a as (select round($1::numeric(20,6) * (1 + $2::numeric(6,2) / 100), 6) as allowed, $3::numeric(20,6) as c)
         select allowed::text, case when c > allowed and allowed > 0 then round((c - allowed) * 100 / allowed, 2) end::text as over_pct from a`,
        [n, w, cons],
      )
      const ours = evaluateNorm({ normQtyBase: n, wastePct: w, consumedQtyBase: cons })
      expect(ours.allowed, `${n} ${w} ${cons}`).toBe(parseDec(r.rows[0]!.allowed))
      expect(ours.overPct, `${n} ${w} ${cons}`).toBe(c(r.rows[0]!.over_pct))
    }
  })
})
