// TS qoidalari ↔ HAQIQIY bazadagi funksiyalar (migratsiyalar qo'llangan PGlite): bir xil vektorlar
// ikkala tomondan o'tkaziladi. src/domain/*.pg.test.ts dan farqi — SQL ifodani qayta yozmaydi,
// private.* / public.* funksiyalari va triggerlarni aynan chaqiradi (kerakli qatorlar seed qilinadi).
// Har vektor alohida tranzaksiyada (rollback).
import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { asUser, createDb, one, rows, scalar, type Db, type Tx } from './_harness'
import { raw, sys } from './_tx'
import { buildTwoCompanies, type CompanyFixture } from './_fixtures'
import { add as addDec, cmp, mul as mulDec, type Dec } from '../../../src/domain/decimal'
import { findDuplicateEntry, type EntryFingerprint } from '../../../src/domain/rules/duplicateEntry'
import { distanceMetersRounded, isOutsideSite } from '../../../src/domain/rules/geo'
import { cashAging, type CashEntry } from '../../../src/domain/rules/cashAging'
import { purchasePrices, toBaseQty } from '../../../src/domain/units'
import { evaluatePrice, type PricePoint } from '../../../src/domain/alerts/priceDeviation'
import { evaluateReceipt } from '../../../src/domain/alerts/receiptMismatch'
import { avgDailyOut, forecastDays, type ForecastMovement } from '../../../src/domain/forecast'

let db: Db
let A: CompanyFixture

beforeAll(async () => {
  db = await createDb()
  ;({ A } = await buildTwoCompanies(db))
})
afterAll(async () => {
  await db?.close()
})

const P = (role: keyof CompanyFixture['users']): string => A.users[role].profileId

/** Ikkala qiymat null yoki son sifatida teng. */
function same(a: Dec | null | undefined, b: Dec | null | undefined): boolean {
  if (a === null || a === undefined || b === null || b === undefined) return (a ?? null) === (b ?? null)
  return cmp(a, b) === 0
}

/** Admin nomidan tranzaksiya (rollback); ichida postgres sifatida ishlash uchun `sys`. */
const inTx = <T>(fn: (tx: Tx) => Promise<T>): Promise<T> => asUser(db, A.users.admin.authUid, fn)

/** Yangi material (asosiy birlik qatori trigger bilan yaratiladi) — boshqa yozuvlar aralashmasin. */
async function newMaterial(tx: Tx, baseUnit = 'kg'): Promise<{ id: string; baseUnitId: string }> {
  return sys(tx, async () => {
    const id = await scalar<string>(tx, `insert into public.materials (company_id, name, base_unit) values ($1, $2, $3) returning id`, [
      A.id,
      `Parity ${randomUUID().slice(0, 8)}`,
      baseUnit,
    ])
    const baseUnitId = await scalar<string>(tx, `select id from public.material_units where material_id = $1 and factor = 1`, [id])
    return { id, baseUnitId }
  })
}

async function newObject(tx: Tx, extra: { lat?: string; lng?: string; radius?: number } = {}): Promise<string> {
  return sys(tx, () =>
    scalar<string>(
      tx,
      `insert into public.objects (company_id, name, lat, lng, radius_m) values ($1, $2, $3, $4, coalesce($5, 300)) returning id`,
      [A.id, `Parity obj ${randomUUID().slice(0, 8)}`, extra.lat ?? null, extra.lng ?? null, extra.radius ?? null],
    ),
  )
}

/** Triggerlarsiz harakat (barcha ustunlar aniq). */
async function rawMovement(
  tx: Tx,
  m: {
    type: string
    obj: string
    mat: { id: string; baseUnitId: string }
    qty: Dec
    at: string
    by?: string | null
    purchaseId?: string
    transferId?: string
    countId?: string
    geo?: { lat: string; lng: string; acc: number | null }
  },
): Promise<string> {
  const id = randomUUID()
  await raw(
    tx,
    `insert into public.movements (id, company_id, type, object_id, material_id, unit_id, qty_input, unit_input, qty_base,
        occurred_at, created_at, created_by, purchase_id, geo_lat, geo_lng, geo_accuracy_m, geo_status, transfer_id, inventory_count_id)
     values ($1, $2, $3::public.movement_type, $4, $5, $6, $7, 'kg', $7, $8::timestamptz, $8::timestamptz, $9, $10, $11, $12, $13, $14, $15, $16)`,
    [
      id,
      A.id,
      m.type,
      m.obj,
      m.mat.id,
      m.mat.baseUnitId,
      m.qty,
      m.at,
      m.by ?? null,
      m.purchaseId ?? null,
      m.geo?.lat ?? null,
      m.geo?.lng ?? null,
      m.geo?.acc ?? null,
      m.geo ? 'ok' : null,
      m.transferId ?? null,
      m.countId ?? null,
    ],
  )
  return id
}

/** Triggerlarsiz xarid (narxlar — total / qty dan, solishtirishga ta'sir qilmaydi). */
async function rawPurchase(
  tx: Tx,
  p: { obj: string; mat: { id: string; baseUnitId: string }; qty: Dec; total: Dec; at: string; createdAt?: string; by?: string; buyer?: string; source?: 'podotchet' | 'firma' },
): Promise<string> {
  const id = randomUUID()
  const buyer = p.buyer ?? P('taminotchi')
  await raw(
    tx,
    `insert into public.purchases (id, company_id, buyer_id, object_id, material_id, unit_id, qty_input, unit_input, qty_base,
        unit_price, price_per_base, total_amount, purchased_at, created_at, created_by, payment_source)
     values ($1, $2, $3, $4, $5, $6, $7, 'kg', $7, 0, 0, $8, $9::timestamptz, $10::timestamptz, $11, $12)`,
    [id, A.id, buyer, p.obj, p.mat.id, p.mat.baseUnitId, p.qty, p.total, p.at, p.createdAt ?? p.at, p.by ?? buyer, p.source ?? 'firma'],
  )
  return id
}

const T0 = '2026-10-20T10:00:00+05:00'
const plusMin = (iso: string, min: number): string => new Date(Date.parse(iso) + min * 60_000).toISOString()
const plusDays = (iso: string, d: number): string => new Date(Date.parse(iso) + d * 86_400_000).toISOString()

// ============================================================================
// Birlik konvertatsiyasi: tg_compute_qty (qty_base) va xarid narxlari
// ============================================================================
describe('birlik konvertatsiyasi — toBaseQty ↔ tg_compute_qty; purchasePrices ↔ xarid triggeri', () => {
  const vectors: Array<[Dec, Dec]> = [
    ['3', '50'],
    ['1.5', '50'],
    ['0.333333', '3'],
    ['2', '0.3333333333'],
    ['7', '0.0000001'],
    ['12345.678901', '1.2345678901'],
    ['0.000001', '0.5'],
    ['999999.999999', '1000'],
    ['1', '1'],
    ['0.5', '0.0000015'],
  ]
  it.each(vectors)('qty %s × factor %s', async (qty, factor) => {
    const r = await inTx(async (tx) => {
      const mat = await newMaterial(tx)
      const obj = A.ids.obj1!
      return sys(tx, async () => {
        const unitId = await scalar<string>(
          tx,
          `insert into public.material_units (company_id, material_id, unit, factor) values ($1, $2, 'birlik', $3) returning id`,
          [A.id, mat.id, factor],
        )
        const mv = await one<{ q: string }>(
          tx,
          `insert into public.movements (company_id, type, object_id, material_id, unit_id, qty_input, unit_input, qty_base)
           values ($1, 'kirim', $2, $3, $4, $5, '-', 0) returning qty_base::text as q`,
          [A.id, obj, mat.id, unitId, qty],
        )
        return mv.q
      })
    })
    expect(same(r, toBaseQty(qty, factor)), `${r} ≠ ${toBaseQty(qty, factor)}`).toBe(true)
  })

  const prices: Array<[Dec, Dec, Dec]> = [
    // total, qty_input, factor
    ['1250000', '3', '50'],
    ['100', '3', '1'],
    ['1000000', '7', '0.3333333333'],
    ['0', '2', '50'],
    ['99999.99', '0.000001', '1'],
    ['1', '3', '3'],
    ['123456789.12', '12345.678901', '1.2345678901'],
  ]
  it.each(prices)('xarid: jami %s, miqdor %s, factor %s — unit_price, price_per_base', async (total, qty, factor) => {
    const r = await inTx(async (tx) => {
      const mat = await newMaterial(tx)
      return sys(tx, async () => {
        const unitId = await scalar<string>(
          tx,
          `insert into public.material_units (company_id, material_id, unit, factor) values ($1, $2, 'birlik', $3) returning id`,
          [A.id, mat.id, factor],
        )
        return one<{ qb: string; up: string; ppb: string }>(
          tx,
          `insert into public.purchases (company_id, buyer_id, object_id, material_id, unit_id, qty_input, unit_input, qty_base,
             unit_price, price_per_base, total_amount)
           values ($1, $2, $3, $4, $5, $6, '-', 0, 0, 0, $7)
           returning qty_base::text as qb, unit_price::text as up, price_per_base::text as ppb`,
          [A.id, P('taminotchi'), A.ids.obj1, mat.id, unitId, qty, total],
        )
      })
    })
    const ts = purchasePrices(total, qty, toBaseQty(qty, factor))
    expect(same(r.qb, toBaseQty(qty, factor))).toBe(true)
    expect({ up: same(r.up, ts.unitPrice), ppb: same(r.ppb, ts.pricePerBase) }, JSON.stringify({ sql: r, ts })).toEqual({ up: true, ppb: true })
  })
})

// ============================================================================
// Takroriy yozuv: findDuplicateEntry ↔ private.evaluate_duplicate (first_id)
// ============================================================================
describe('takroriy yozuv — findDuplicateEntry ↔ private.evaluate_duplicate', () => {
  interface Rec {
    kind: 'kirim' | 'chiqim' | 'purchase'
    by: 'prorab' | 'omborchi'
    qty: Dec
    total?: Dec
    min: number
    otherMaterial?: boolean
  }
  interface V {
    name: string
    window: number
    prev: Rec[]
    next: Rec
  }
  const V: V[] = [
    { name: 'aynan bir xil, 5 daqiqa', window: 10, prev: [{ kind: 'kirim', by: 'prorab', qty: '5', min: 0 }], next: { kind: 'kirim', by: 'prorab', qty: '5', min: 5 } },
    { name: '"5" = "5.000000"', window: 10, prev: [{ kind: 'chiqim', by: 'prorab', qty: '5.000000', min: 0 }], next: { kind: 'chiqim', by: 'prorab', qty: '5', min: 1 } },
    { name: 'chegarada (aynan 10 daqiqa)', window: 10, prev: [{ kind: 'kirim', by: 'prorab', qty: '5', min: 0 }], next: { kind: 'kirim', by: 'prorab', qty: '5', min: 10 } },
    { name: 'oynadan tashqarida (11 daqiqa)', window: 10, prev: [{ kind: 'kirim', by: 'prorab', qty: '5', min: 0 }], next: { kind: 'kirim', by: 'prorab', qty: '5', min: 11 } },
    { name: 'boshqa miqdor', window: 10, prev: [{ kind: 'kirim', by: 'prorab', qty: '5', min: 0 }], next: { kind: 'kirim', by: 'prorab', qty: '5.000001', min: 1 } },
    { name: 'boshqa muallif', window: 10, prev: [{ kind: 'kirim', by: 'omborchi', qty: '5', min: 0 }], next: { kind: 'kirim', by: 'prorab', qty: '5', min: 1 } },
    { name: 'kirim va chiqim — turli tur', window: 10, prev: [{ kind: 'kirim', by: 'prorab', qty: '5', min: 0 }], next: { kind: 'chiqim', by: 'prorab', qty: '5', min: 1 } },
    { name: 'boshqa material', window: 10, prev: [{ kind: 'kirim', by: 'prorab', qty: '5', min: 0, otherMaterial: true }], next: { kind: 'kirim', by: 'prorab', qty: '5', min: 1 } },
    { name: 'oldingisi keyinroq (yosh < 0)', window: 10, prev: [{ kind: 'kirim', by: 'prorab', qty: '5', min: 5 }], next: { kind: 'kirim', by: 'prorab', qty: '5', min: 1 } },
    // Bazada oyna 1..1440 (audit_fixes: 0 — taqiqlangan); eng kichik oyna chegarasi
    { name: 'oyna 1: 1 daqiqa — takror', window: 1, prev: [{ kind: 'kirim', by: 'prorab', qty: '5', min: 0 }], next: { kind: 'kirim', by: 'prorab', qty: '5', min: 1 } },
    { name: 'oyna 1: 2 daqiqa — yo`q', window: 1, prev: [{ kind: 'kirim', by: 'prorab', qty: '5', min: 0 }], next: { kind: 'kirim', by: 'prorab', qty: '5', min: 2 } },
    {
      name: 'bir nechta mos — eng erta (first_id)',
      window: 30,
      prev: [
        { kind: 'kirim', by: 'prorab', qty: '5', min: 10 },
        { kind: 'kirim', by: 'prorab', qty: '5', min: 2 },
        { kind: 'kirim', by: 'prorab', qty: '5', min: 25 },
      ],
      next: { kind: 'kirim', by: 'prorab', qty: '5', min: 26 },
    },
    { name: 'xarid: miqdor va summa teng', window: 10, prev: [{ kind: 'purchase', by: 'prorab', qty: '3', total: '300', min: 0 }], next: { kind: 'purchase', by: 'prorab', qty: '3', total: '300.00', min: 4 } },
    { name: 'xarid: summa boshqa', window: 10, prev: [{ kind: 'purchase', by: 'prorab', qty: '3', total: '300', min: 0 }], next: { kind: 'purchase', by: 'prorab', qty: '3', total: '301', min: 4 } },
  ]

  it.each(V.map((v) => [v.name, v] as const))('%s', async (_n, v) => {
    const r = await inTx(async (tx) => {
      const mat = await newMaterial(tx)
      const other = await newMaterial(tx)
      const obj = A.ids.obj1!
      await raw(tx, `update public.companies set duplicate_window_minutes = $2 where id = $1`, [A.id, v.window])
      const ins = (x: Rec): Promise<string> => {
        const at = plusMin(T0, x.min)
        const m = x.otherMaterial ? other : mat
        return x.kind === 'purchase'
          ? rawPurchase(tx, { obj, mat: m, qty: x.qty, total: x.total ?? '0', at, by: P(x.by), buyer: P(x.by) })
          : rawMovement(tx, { type: x.kind, obj, mat: m, qty: x.qty, at, by: P(x.by) })
      }
      const prevIds: string[] = []
      for (const x of v.prev) prevIds.push(await ins(x))
      const nextId = await ins(v.next)
      const table = v.next.kind === 'purchase' ? 'purchases' : 'movements'
      const first = await sys(tx, async () => {
        await tx.query(`select private.evaluate_duplicate($1, $2)`, [table, nextId])
        const a = await rows<{ f: string }>(
          tx,
          `select details ->> 'first_id' as f from public.alerts where type = 'takroriy_yozuv' and details ->> 'record_id' = $1`,
          [nextId],
        )
        return a[0]?.f ?? null
      })
      return { prevIds, nextId, first, matId: mat.id, otherId: other.id }
    })
    const fp = (x: Rec, id: string): EntryFingerprint => ({
      id,
      createdBy: P(x.by),
      kind: x.kind,
      objectId: A.ids.obj1!,
      materialId: x.otherMaterial ? r.otherId : r.matId,
      qtyBase: x.qty,
      totalAmount: x.total ?? null,
      createdAt: plusMin(T0, x.min),
    })
    const ts = findDuplicateEntry(
      v.prev.map((x, i) => fp(x, r.prevIds[i]!)),
      fp(v.next, r.nextId),
      v.window,
    )
    expect(r.first).toBe(ts?.id ?? null)
  })
})

// ============================================================================
// Joylashuv: distanceMetersRounded ↔ private.geo_distance_m; isOutsideSite ↔ private.evaluate_geo
// ============================================================================
describe('joylashuv — geo_distance_m va evaluate_geo', () => {
  const pts: Array<[string, string, string, string]> = [
    ['41.311081', '69.240562', '41.311081', '69.240562'],
    ['41.311081', '69.240562', '41.313000', '69.240562'],
    ['41.311081', '69.240562', '41.299496', '69.240073'],
    ['41.311081', '69.240562', '39.654500', '66.975800'],
    ['0.000000', '0.000000', '0.000000', '180.000000'],
    ['89.999999', '0.000000', '-89.999999', '0.000000'],
    ['-33.868800', '151.209300', '51.507400', '-0.127800'],
    ['41.311081', '69.240562', '41.311081', '69.244200'],
  ]
  it.each(pts)('masofa (%s, %s) → (%s, %s)', async (a, b, c, d) => {
    const sql = await scalar<number>(db, `select private.geo_distance_m($1::numeric, $2::numeric, $3::numeric, $4::numeric)`, [a, b, c, d])
    expect(sql).toBe(distanceMetersRounded(Number(a), Number(b), Number(c), Number(d)))
  })

  // Obyekt (41.311081, 69.240562); har vektor: radius, aniqlik, yozuv koordinatasi
  const site = { lat: '41.311081', lng: '69.240562' }
  const V: Array<{ name: string; radius: number; acc: number | null; lat: string; lng: string; noSite?: boolean }> = [
    { name: 'joyida', radius: 300, acc: 10, lat: '41.311500', lng: '69.240562' },
    { name: 'uzoqda', radius: 300, acc: 10, lat: '41.320000', lng: '69.240562' },
    { name: 'aniqlik radius bilan cheklanadi', radius: 100, acc: 5000, lat: '41.314000', lng: '69.240562' },
    { name: 'aniqlik ichiga oladi', radius: 300, acc: 200, lat: '41.315000', lng: '69.240562' },
    { name: 'aniqlik null', radius: 300, acc: null, lat: '41.314000', lng: '69.240562' },
    { name: 'kichik radius', radius: 10, acc: 0, lat: '41.311200', lng: '69.240562' },
    { name: 'obyekt koordinatasi yo`q', radius: 300, acc: 10, lat: '41.400000', lng: '69.240562', noSite: true },
  ]
  it.each(V.map((v) => [v.name, v] as const))('tashqarida: %s', async (_n, v) => {
    const r = await inTx(async (tx) => {
      const obj = await newObject(tx, v.noSite ? { radius: v.radius } : { ...site, radius: v.radius })
      const mat = await newMaterial(tx)
      const mv = await rawMovement(tx, { type: 'kirim', obj, mat, qty: '1', at: T0, by: P('prorab'), geo: { lat: v.lat, lng: v.lng, acc: v.acc } })
      return sys(tx, async () => {
        await tx.query(`select private.evaluate_geo($1)`, [mv])
        return rows<{ d: number }>(tx, `select (details ->> 'distance_m')::int as d from public.alerts where type = 'joylashuv_farqi' and movement_id = $1`, [mv])
      })
    })
    const ts = isOutsideSite({
      siteLat: v.noSite ? null : site.lat,
      siteLng: v.noSite ? null : site.lng,
      radiusM: v.radius,
      lat: v.lat,
      lng: v.lng,
      accuracyM: v.acc,
    })
    expect(r.length === 1).toBe(ts === true)
    if (ts) expect(r[0]!.d).toBe(distanceMetersRounded(Number(site.lat), Number(site.lng), Number(v.lat), Number(v.lng)))
  })
})

// ============================================================================
// Narx og'ishi: evaluatePrice ↔ private.price_check
// ============================================================================
describe('narx og`ishi — evaluatePrice ↔ private.price_check', () => {
  interface V {
    name: string
    window: number
    threshold: Dec
    /** [jami, miqdor, necha kun oldin] — eskidan yangiga. */
    history: Array<[Dec, Dec, number]>
    price: Dec
  }
  const V: V[] = [
    { name: 'tarix yo`q', window: 5, threshold: '8', history: [], price: '100' },
    { name: 'bitta nuqta — o`rtacha yo`q', window: 5, threshold: '8', history: [['1000', '10', 3]], price: '150' },
    { name: 'oddiy — chegarada (8 %)', window: 5, threshold: '8', history: [['1000', '10', 5], ['1000', '10', 2]], price: '108' },
    { name: 'chegaradan ozgina yuqori', window: 5, threshold: '8', history: [['1000', '10', 5], ['1000', '10', 2]], price: '108.0001' },
    { name: 'past (−50 %)', window: 5, threshold: '8', history: [['1000', '10', 5], ['1000', '10', 2]], price: '50' },
    {
      name: 'og`irlikli o`rtacha, oyna 2 (eski arzonlar tashqarida)',
      window: 2,
      threshold: '10',
      history: [['10', '1', 30], ['10', '1', 20], ['3000', '10', 5], ['1000', '3', 1]],
      price: '320',
    },
    {
      name: '90 kunlik oyna sekin o`sishni ushlaydi',
      window: 2,
      threshold: '8',
      history: [['1000', '10', 80], ['1000', '10', 70], ['1100', '10', 60], ['1200', '10', 3], ['1250', '10', 1]],
      price: '125',
    },
    { name: '90 kundan eski — 90 kunlikka kirmaydi', window: 5, threshold: '8', history: [['500', '10', 200], ['500', '10', 150], ['1000', '10', 2], ['1000', '10', 1]], price: '100' },
    { name: 'kasr miqdorlar', window: 5, threshold: '8', history: [['1000000', '3.333333', 4], ['777777.77', '2.5', 2], ['123.45', '0.000123', 1]], price: '330000.1234' },
  ]

  it.each(V.map((v) => [v.name, v] as const))('%s', async (_n, v) => {
    const now = '2026-10-25T12:00:00+05:00'
    const r = await inTx(async (tx) => {
      const mat = await newMaterial(tx)
      await raw(tx, `update public.companies set price_deviation_pct = $2, price_avg_window = $3 where id = $1`, [A.id, v.threshold, v.window])
      for (const [total, qty, days] of v.history) {
        await rawPurchase(tx, { obj: A.ids.obj1!, mat, qty, total, at: plusDays(now, -days) })
      }
      return sys(tx, () =>
        one<{ avg_n: string | null; diff_n: string | null; avg_90: string | null; diff_90: string | null; direction: string }>(
          tx,
          `select avg_n::text, diff_n::text, avg_90::text, diff_90::text, direction
             from private.price_check($1, $2, $3::numeric, $4::timestamptz, $4::timestamptz, null)`,
          [A.id, mat.id, v.price, now],
        ),
      )
    })
    const pts = (h: Array<[Dec, Dec, number]>): PricePoint[] => h.map(([totalAmount, qtyBase]) => ({ totalAmount, qtyBase }))
    const newestFirst = [...v.history].reverse()
    const ts = evaluatePrice({
      pricePerBase: v.price,
      lastN: pts(newestFirst.slice(0, v.window)),
      last90: pts(newestFirst.filter(([, , d]) => d <= 90)),
      thresholdPct: v.threshold,
    })
    expect(
      {
        direction: r.direction,
        avgN: same(r.avg_n, ts.avgN),
        diffN: same(r.diff_n, ts.diffN),
        avg90: same(r.avg_90, ts.avg90),
        diff90: same(r.diff_90, ts.diff90),
      },
      JSON.stringify({ sql: r, ts }),
    ).toEqual({ direction: ts.direction, avgN: true, diffN: true, avg90: true, diff90: true })
  })
})

// ============================================================================
// Xarid ≠ qabul: evaluateReceipt ↔ private.evaluate_purchase_receipt
// ============================================================================
describe('xarid ≠ qabul — evaluateReceipt ↔ private.evaluate_purchase_receipt', () => {
  interface V {
    name: string
    threshold: Dec
    purchased: Dec
    received: Dec[]
    /** Xariddan beri soat. */
    hours: number
  }
  const V: V[] = [
    { name: 'to`liq qabul', threshold: '2', purchased: '100', received: ['100'], hours: 30 },
    { name: 'chegarada (2 %)', threshold: '2', purchased: '100', received: ['98'], hours: 30 },
    { name: 'kam, 24 soatdan keyin — under', threshold: '2', purchased: '100', received: ['97.9'], hours: 30 },
    { name: 'kam, 24 soat ichida — pending', threshold: '2', purchased: '100', received: ['50'], hours: 5 },
    { name: 'aynan 24 soat — under', threshold: '2', purchased: '100', received: ['50'], hours: 24 },
    { name: 'ortiqcha — darhol over', threshold: '2', purchased: '100', received: ['60', '43'], hours: 1 },
    { name: 'jiddiy (≥ 3 × chegara)', threshold: '2', purchased: '100', received: ['94'], hours: 48 },
    { name: 'hech qabul qilinmagan', threshold: '5', purchased: '3.333333', received: [], hours: 100 },
    { name: 'kasr miqdorlar', threshold: '1.5', purchased: '7.777777', received: ['3.333333', '4.3'], hours: 50 },
    { name: 'chegara 0', threshold: '0', purchased: '10', received: ['10.000001'], hours: 1 },
  ]

  it.each(V.map((v) => [v.name, v] as const))('%s', async (_n, v) => {
    const purchasedAt = '2026-10-20T08:00:00+05:00'
    const now = new Date(Date.parse(purchasedAt) + v.hours * 3_600_000).toISOString()
    const r = await inTx(async (tx) => {
      const mat = await newMaterial(tx)
      const obj = await newObject(tx)
      await raw(tx, `update public.companies set receipt_mismatch_pct = $2 where id = $1`, [A.id, v.threshold])
      const p = await rawPurchase(tx, { obj, mat, qty: v.purchased, total: '1000', at: purchasedAt })
      let i = 0
      for (const q of v.received) {
        await rawMovement(tx, { type: 'kirim', obj, mat, qty: q, at: plusMin(purchasedAt, 10 + i++), by: P('omborchi'), purchaseId: p })
      }
      return sys(tx, async () => {
        await tx.query(`select private.evaluate_purchase_receipt($1, $2::timestamptz)`, [p, now])
        return rows<{ severity: string; direction: string; diff: string }>(
          tx,
          `select severity::text, details ->> 'direction' as direction, details ->> 'diff_pct' as diff
             from public.alerts where type = 'xarid_qabul_farqi' and purchase_id = $1 and status = 'yangi'`,
          [p],
        )
      })
    })
    const received = v.received.reduce<Dec>((sum, q) => addDec(sum, q), '0')
    const ts = evaluateReceipt({ purchasedQtyBase: v.purchased, receivedQtyBase: received, purchasedAt, nowIso: now, thresholdPct: v.threshold })
    if (ts.status === 'ok' || ts.status === 'pending') {
      expect(r, ts.status).toEqual([])
    } else {
      expect(r).toHaveLength(1)
      expect({ severity: r[0]!.severity, direction: r[0]!.direction, diff: same(r[0]!.diff, ts.diffPct) }).toEqual({
        severity: ts.severity,
        direction: ts.status,
        diff: true,
      })
    }
  })
})

// ============================================================================
// Podotchet: cashAging ↔ private.cash_position + private.evaluate_cash_advances
// ============================================================================
describe('podotchet muddati — cashAging ↔ cash_position / evaluate_cash_advances', () => {
  interface V {
    name: string
    maxDays: number
    today: string
    entries: CashEntry[]
  }
  const V: V[] = [
    { name: 'faqat berildi, muddati o`tmagan', maxDays: 14, today: '2026-10-25', entries: [{ kind: 'berildi', amount: '1000000', date: '2026-10-11' }] },
    { name: 'aynan 14 kun — muddati o`tmagan', maxDays: 14, today: '2026-10-25', entries: [{ kind: 'berildi', amount: '1000', date: '2026-10-11' }] },
    { name: '15 kun — muddati o`tgan', maxDays: 14, today: '2026-10-25', entries: [{ kind: 'berildi', amount: '1000', date: '2026-10-10' }] },
    {
      name: 'FIFO: eski pul sarf bilan yopilgan — keyingisi ochiq',
      maxDays: 7,
      today: '2026-10-25',
      entries: [
        { kind: 'berildi', amount: '500', date: '2026-10-01' },
        { kind: 'berildi', amount: '500', date: '2026-10-20' },
        { kind: 'sarf', amount: '500', date: '2026-10-24' },
      ],
    },
    {
      name: 'FIFO: qisman yopilgan eski pul ochiq qoladi',
      maxDays: 7,
      today: '2026-10-25',
      entries: [
        { kind: 'berildi', amount: '500', date: '2026-10-01' },
        { kind: 'berildi', amount: '500', date: '2026-10-20' },
        { kind: 'sarf', amount: '300', date: '2026-10-02' },
        { kind: 'qaytarildi', amount: '100.50', date: '2026-10-03' },
      ],
    },
    {
      name: 'to`liq yopilgan (balans 0)',
      maxDays: 3,
      today: '2026-10-25',
      entries: [
        { kind: 'berildi', amount: '1000', date: '2026-09-01' },
        { kind: 'sarf', amount: '600', date: '2026-09-02' },
        { kind: 'qaytarildi', amount: '400', date: '2026-09-03' },
      ],
    },
    {
      name: 'manfiy balans',
      maxDays: 14,
      today: '2026-10-25',
      entries: [
        { kind: 'berildi', amount: '1000', date: '2026-09-01' },
        { kind: 'sarf', amount: '1500.25', date: '2026-10-20' },
      ],
    },
    { name: 'faqat sarf (berilmagan)', maxDays: 14, today: '2026-10-25', entries: [{ kind: 'sarf', amount: '10', date: '2026-10-20' }] },
  ]

  it.each(V.map((v) => [v.name, v] as const))('%s', async (_n, v) => {
    const noon = (d: string): string => `${d}T12:00:00+05:00`
    const r = await inTx(async (tx) => {
      const mat = await newMaterial(tx)
      const prof = await sys(tx, () =>
        scalar<string>(tx, `insert into public.profiles (company_id, role, full_name, phone) values ($1, 'haydovchi', 'Parity', $2) returning id`, [
          A.id,
          `+99899${String(Math.floor(Math.random() * 1e7)).padStart(7, '0')}`,
        ]),
      )
      await raw(tx, `update public.companies set cash_max_days = $2 where id = $1`, [A.id, v.maxDays])
      for (const e of v.entries) {
        if (e.kind === 'sarf') {
          await rawPurchase(tx, { obj: A.ids.obj1!, mat, qty: '1', total: e.amount, at: noon(e.date), buyer: prof, by: prof, source: 'podotchet' })
        } else {
          await raw(
            tx,
            `insert into public.cash_advances (company_id, recipient_id, kind, amount, issued_at) values ($1, $2, $3, $4, $5::timestamptz)`,
            [A.id, prof, e.kind, e.amount, noon(e.date)],
          )
        }
      }
      return sys(tx, async () => {
        const pos = await one<{ balance: string; oldest: string | null }>(
          tx,
          `select balance::text, ((oldest_open_at at time zone 'Asia/Tashkent')::date)::text as oldest from private.cash_position($1, $2)`,
          [A.id, prof],
        )
        await tx.query(`select private.evaluate_cash_advances($1::timestamptz)`, [noon(v.today)])
        const alerts = await rows<{ type: string; days: number | null }>(
          tx,
          `select type::text, (details ->> 'days_open')::int as days from public.alerts
            where type in ('podotchet_muddati', 'podotchet_manfiy') and details ->> 'profile_id' = $1 order by type`,
          [prof],
        )
        return { pos, alerts }
      })
    })
    const ts = cashAging(v.entries, v.today, v.maxDays)
    expect(same(r.pos.balance, ts.balance), `${r.pos.balance} ≠ ${ts.balance}`).toBe(true)
    expect(r.pos.oldest).toBe(ts.oldestOpenDate)
    const expected: Array<{ type: string; days: number | null }> = []
    if (ts.negative) expected.push({ type: 'podotchet_manfiy', days: null })
    if (ts.overdue) expected.push({ type: 'podotchet_muddati', days: ts.ageDays })
    expect(r.alerts).toEqual(expected.sort((a, b) => a.type.localeCompare(b.type)))
  })
})

// ============================================================================
// Tugash prognozi: avgDailyOut + forecastDays ↔ public.stock_forecast
// ============================================================================
describe('tugash prognozi — avgDailyOut / forecastDays ↔ public.stock_forecast', () => {
  interface V {
    name: string
    /** [tur, miqdor, necha kun oldin] */
    moves: Array<['kirim' | 'chiqim' | 'transfer_out' | 'inventory_adjust', Dec, number]>
  }
  const V: V[] = [
    { name: 'sarf yo`q — prognoz yo`q', moves: [['kirim', '100', 3]] },
    { name: 'oddiy', moves: [['kirim', '100', 20], ['chiqim', '14', 2]] },
    { name: 'oyna chegarasi: 13 kun oldin kiradi, 14 — yo`q', moves: [['kirim', '1000', 30], ['chiqim', '7', 13], ['chiqim', '700', 14]] },
    { name: 'bugungi chiqim', moves: [['kirim', '50', 1], ['chiqim', '3.5', 0]] },
    { name: 'qoldiq ≤ 0 → 0', moves: [['kirim', '10', 5], ['chiqim', '10', 1]] },
    { name: 'transfer_out va inventory_adjust sarf emas', moves: [['kirim', '100', 5], ['transfer_out', '30', 1], ['inventory_adjust', '-5', 1], ['chiqim', '1', 1]] },
    { name: 'kasr — yaxlitlash', moves: [['kirim', '1', 5], ['chiqim', '0.000001', 1], ['chiqim', '0.333333', 2]] },
    { name: 'katta qoldiq, kichik sarf', moves: [['kirim', '123456.789012', 10], ['chiqim', '0.07', 3]] },
  ]

  it.each(V.map((v) => [v.name, v] as const))('%s', async (_n, v) => {
    const r = await inTx(async (tx) => {
      const mat = await newMaterial(tx)
      const obj = await newObject(tx)
      const today = await scalar<string>(tx, `select ((now() at time zone 'Asia/Tashkent')::date)::text`)
      for (const [type, qty, days] of v.moves) {
        // Toshkent kuni o'rtasi — sana chegarasi aniq bo'lsin
        // transfer_out / inventory_adjust — bog'lanish majburiy (movements_links_check): fixture o'tkazma / sanash
        await rawMovement(tx, {
          type,
          obj,
          mat,
          qty,
          at: `${shiftDay(today, -days)}T12:00:00+05:00`,
          by: P('omborchi'),
          transferId: type === 'transfer_out' ? A.ids.tr_1to2 : undefined,
          countId: type === 'inventory_adjust' ? A.ids.ic_obj1 : undefined,
        })
      }
      const f = await sys(tx, () =>
        rows<{ stock: string; avg: string; days: string | null }>(
          tx,
          `select stock_qty_base::text as stock, avg_daily_qty_base::text as avg, days_left::text as days
             from public.stock_forecast($1) where material_id = $2`,
          [obj, mat.id],
        ),
      )
      return { today, f }
    })
    const tsMoves: ForecastMovement[] = v.moves.map(([type, qtyBase, days]) => ({ type, qtyBase, date: shiftDay(r.today, -days) }))
    const sign = (t: string): Dec => (t === 'chiqim' || t === 'transfer_out' ? '-1' : '1')
    const stock = v.moves.reduce<Dec>((s, [t, q]) => addDec(s, mulDec(q, sign(t))), '0')
    const avg = avgDailyOut(tsMoves, r.today)
    const days = forecastDays(stock, avg)
    expect(r.f).toHaveLength(1)
    const row = r.f[0]!
    expect({ stock: same(row.stock, stock), avg: same(row.avg, avg), days: same(row.days, days) }, JSON.stringify({ sql: row, ts: { stock, avg, days } })).toEqual({
      stock: true,
      avg: true,
      days: true,
    })
  })
})

// --- kichik yordamchilar ------------------------------------------------------
function shiftDay(day: string, delta: number): string {
  const d = new Date(`${day}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + delta)
  return d.toISOString().slice(0, 10)
}
