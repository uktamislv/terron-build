// Batch 12 — 20261106000001_automation.sql: sozlamalar, A–K qoidalari, guardlar va
// hint'lar, cron funksiyalari, chek keshi, outbox qabul qiluvchilari, svc_* RPC'lar,
// stock_forecast, cash_balances (qaytarish), firma izolyatsiyasi.
// Shartnoma: docs/automation-design.md ("Bildirishnoma payloadlari").
import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { asUser, createDb, one, rows, scalar, type Db, type Queryable, type Row, type Tx } from './_harness'
import { buildTwoCompanies, type CompanyFixture } from './_fixtures'

let db: Db
let A: CompanyFixture
let B: CompanyFixture
let kgId: string
let qopId: string
let m2Id: string

beforeAll(async () => {
  db = await createDb()
  ;({ A, B } = await buildTwoCompanies(db))
  kgId = await scalar<string>(db, `select id from public.material_units where material_id = $1 and unit = 'kg'`, [A.ids.m1])
  qopId = A.ids.u1!
  m2Id = await scalar<string>(db, `select id from public.material_units where material_id = $1 and factor = 1`, [A.ids.m2])
})
afterAll(async () => {
  await db?.close()
})

// ----------------------------------------------------------------------------
// Yordamchilar
// ----------------------------------------------------------------------------
type Role = keyof CompanyFixture['users']

/** `OK:<qatorlar>` yoki `<errcode>:<hint>` (savepoint bilan — tx davom etadi). */
async function res(tx: Queryable, sql: string, params: unknown[] = []): Promise<string> {
  const r = await resFull(tx, sql, params)
  return r.key
}

async function resFull(tx: Queryable, sql: string, params: unknown[] = []): Promise<{ key: string; msg: string }> {
  await tx.exec('savepoint b12_try')
  try {
    const r = await tx.query(sql, params)
    await tx.exec('release savepoint b12_try')
    return { key: `OK:${r.affectedRows || r.rows.length}`, msg: '' }
  } catch (e) {
    await tx.exec('rollback to savepoint b12_try')
    const err = e as { code?: string; hint?: string; message?: string }
    return { key: `${err.code ?? '?'}:${err.hint ?? ''}`, msg: err.message ?? '' }
  }
}

/** Shu tranzaksiya ichida tizim (postgres) sifatida — RLS'siz. */
async function sys<T>(tx: Tx, fn: () => Promise<T>): Promise<T> {
  await tx.exec('reset role')
  try {
    return await fn()
  } finally {
    await tx.exec('set local role authenticated')
  }
}

/** Triggerlarsiz (vaqt ustunlarini orqaga surish uchun). */
async function raw(tx: Tx, sql: string, params: unknown[] = []): Promise<void> {
  await sys(tx, async () => {
    await tx.exec('set local session_replication_role = replica')
    await tx.query(sql, params)
    await tx.exec('set local session_replication_role = origin')
  })
}

const as = <T>(role: Role, fn: (tx: Tx) => Promise<T>, co: CompanyFixture = A): Promise<T> =>
  asUser(db, co.users[role].authUid, fn)

const P = (role: Role, co: CompanyFixture = A): string => co.users[role].profileId

async function mv(
  tx: Queryable,
  type: 'kirim' | 'chiqim',
  obj: string,
  qty: string,
  o: { mat?: string; unit?: string; at?: string; extra?: Row } = {},
): Promise<string> {
  const extra = o.extra ?? {}
  const cols = Object.keys(extra)
  return scalar<string>(
    tx,
    `insert into public.movements (company_id, type, object_id, material_id, unit_id, qty_input, unit_input, qty_base, occurred_at${cols.map((c) => `, ${c}`).join('')})
     values ($1, $2, $3, $4, $5, $6, '-', 0, coalesce($7::timestamptz, now())${cols.map((_, i) => `, $${i + 8}`).join('')}) returning id`,
    [A.id, type, obj, o.mat ?? A.ids.m1, o.unit ?? (o.mat === A.ids.m2 ? m2Id : kgId), qty, o.at ?? null, ...Object.values(extra)],
  )
}

async function purchase(
  tx: Queryable,
  me: string,
  o: { obj: string; qty: string; total: string; mat?: string; unit?: string; buyer?: string; at?: string; extra?: Row },
): Promise<string> {
  const extra = o.extra ?? {}
  const cols = Object.keys(extra)
  return scalar<string>(
    tx,
    `insert into public.purchases (company_id, buyer_id, object_id, material_id, unit_id, qty_input, unit_input, qty_base,
        unit_price, price_per_base, total_amount, purchased_at, created_by${cols.map((c) => `, ${c}`).join('')})
     values ($1, $2, $3, $4, $5, $6, '-', 0, 0, 0, $7, coalesce($8::timestamptz, now()), $9${cols.map((_, i) => `, $${i + 10}`).join('')})
     returning id`,
    [A.id, o.buyer ?? me, o.obj, o.mat ?? A.ids.m1, o.unit ?? (o.mat === A.ids.m2 ? m2Id : kgId), o.qty, o.total, o.at ?? null, me,
     ...Object.values(extra)],
  )
}

interface AlertRow {
  id: string
  status: string
  severity: string
  details: Row
  object_id: string | null
  material_id: string | null
  movement_id: string | null
  purchase_id: string | null
  request_id: string | null
}

const alertsOf = (tx: Tx, type: string, where = 'true', params: unknown[] = [], co = A.id): Promise<AlertRow[]> =>
  sys(tx, () =>
    rows<AlertRow>(
      tx,
      `select id, status::text, severity::text, details, object_id, material_id, movement_id, purchase_id, request_id
         from public.alerts where company_id = '${co}' and type::text = '${type}' and (${where})
        order by created_at, (select min(l.id) from public.audit_log l where l.record_id = alerts.id), id`,
      params,
    ),
  )

const outboxOf = (tx: Tx, alertId: string): Promise<Row[]> =>
  sys(tx, () => rows(tx, `select kind, payload from public.notification_outbox where alert_id = $1 order by created_at`, [alertId]))

const photoPath = (co = A.id): string => `${co}/2026/10/${randomUUID()}.jpg`
const sha = (c: string): string => c.repeat(64)

// ============================================================================
// Sxema, sozlamalar, enum, cron
// ============================================================================
describe('sxema va sozlamalar', () => {
  it('yangi alert turlari enum`da', async () => {
    const r = await scalar<string[]>(db, `select enum_range(null::public.alert_type)::text[]`)
    for (const t of [
      'kirim_manbasiz', 'manfiy_qoldiq', 'takroriy_yozuv', 'joylashuv_farqi', 'smetasiz_chiqim',
      'chek_farqi', 'sorovdan_ortiq_xarid', 'podotchet_muddati', 'podotchet_manfiy',
    ]) {
      expect(r).toContain(t)
    }
  })

  it('companies: standart qiymatlar', async () => {
    const r = await one(
      db,
      `select photo_required_amount, cash_max_days, duplicate_window_minutes, request_overbuy_pct::text,
              alert_remind_hours, forecast_days_warn from public.companies where id = $1`,
      [A.id],
    )
    expect(r).toEqual({
      photo_required_amount: null,
      cash_max_days: 14,
      duplicate_window_minutes: 10,
      request_overbuy_pct: '20.00',
      alert_remind_hours: 48,
      forecast_days_warn: 3,
    })
  })

  it('admin sozlamalarni o`zgartiradi; direktor — 0 qator; chegaradan tashqari — 23514', async () => {
    const admin = await as('admin', async (tx) => ({
      ok: await res(tx, `update public.companies set cash_max_days = 7, photo_required_amount = 500000, forecast_days_warn = 5 where id = $1`, [A.id]),
      bad: await res(tx, `update public.companies set cash_max_days = 0 where id = $1`, [A.id]),
      badPct: await res(tx, `update public.companies set request_overbuy_pct = -1 where id = $1`, [A.id]),
      badAmt: await res(tx, `update public.companies set photo_required_amount = 0 where id = $1`, [A.id]),
      other: await res(tx, `update public.companies set cash_max_days = 7 where id = $1`, [B.id]),
    }))
    expect(admin).toEqual({ ok: 'OK:1', bad: '23514:', badPct: '23514:', badAmt: '23514:', other: 'OK:0' })
    expect(await as('direktor', (tx) => res(tx, `update public.companies set cash_max_days = 7 where id = $1`, [A.id]))).toBe('OK:0')
  })

  it('objects: lat/lng juft, radius standart 300', async () => {
    const r = await as('admin', async (tx) => ({
      onlyLat: await res(tx, `update public.objects set lat = 41.3 where id = $1`, [A.ids.obj3]),
      range: await res(tx, `update public.objects set lat = 91, lng = 1 where id = $1`, [A.ids.obj3]),
      ok: await res(tx, `update public.objects set lat = 41.311081, lng = 69.240562 where id = $1`, [A.ids.obj3]),
      radius: await scalar<number>(tx, `select radius_m from public.objects where id = $1`, [A.ids.obj3]),
    }))
    expect(r).toEqual({ onlyLat: '23514:', range: '23514:', ok: 'OK:1', radius: 300 })
  })

  it('cron ishlari ro`yxatda', async () => {
    const r = await rows(db, `select jobname, schedule, command from cron.job where jobname in
      ('terron-alert-reminders','terron-request-overdue','terron-cash-check','terron-cash-statement') order by jobname`)
    expect(r).toEqual([
      { jobname: 'terron-alert-reminders', schedule: '27 * * * *', command: 'select private.enqueue_alert_reminders()' },
      { jobname: 'terron-cash-check', schedule: '10 4 * * *', command: 'select private.evaluate_cash_advances()' },
      { jobname: 'terron-cash-statement', schedule: '0 4 * * 1', command: 'select private.enqueue_cash_statements()' },
      { jobname: 'terron-request-overdue', schedule: '0 4 * * *', command: 'select private.enqueue_request_overdue()' },
    ])
  })

  it('ruxsatlar: private qoida funksiyalari va svc_* — authenticated/anon ga yopiq; stock_forecast — authenticated', async () => {
    const fns = [
      'private.enqueue_alert_reminders(timestamptz)',
      'private.enqueue_request_overdue(date)',
      'private.evaluate_cash_advances(timestamptz)',
      'private.enqueue_cash_statements(date)',
      'private.evaluate_kirim_source(uuid)',
      'private.low_stock_count(uuid)',
      'public.svc_outbox_recipients(uuid)',
      'public.svc_mark_alert_seen(bigint, uuid)',
      'public.svc_upsert_receipt_lookup(uuid, uuid, text, text, text, jsonb, numeric, text, text, timestamptz)',
    ]
    for (const f of fns) {
      expect(await scalar<boolean>(db, `select has_function_privilege('authenticated', $1, 'execute')`, [f]), f).toBe(false)
      expect(await scalar<boolean>(db, `select has_function_privilege('anon', $1, 'execute')`, [f]), f).toBe(false)
    }
    for (const f of fns.filter((x) => x.startsWith('public.svc'))) {
      expect(await scalar<boolean>(db, `select has_function_privilege('service_role', $1, 'execute')`, [f]), f).toBe(true)
    }
    expect(await scalar<boolean>(db, `select has_function_privilege('authenticated', 'public.stock_forecast(uuid)', 'execute')`)).toBe(true)
    expect(await scalar<boolean>(db, `select has_function_privilege('anon', 'public.stock_forecast(uuid)', 'execute')`)).toBe(false)
  })
})

// ============================================================================
// A. Kirim manbasi
// ============================================================================
describe('A: kirim_manbasiz va xarid nomzodlari', () => {
  it('ochiq xarid bor → open_purchase (belgi, outbox yo`q); bog`lansa — yopiladi (linked)', async () => {
    const r = await as('admin', async (tx) => {
      const p = await purchase(tx, P('admin'), { obj: A.ids.obj3!, qty: '100', total: '100000' })
      const k = await mv(tx, 'kirim', A.ids.obj3!, '30')
      const a1 = await alertsOf(tx, 'kirim_manbasiz', `movement_id = $1`, [k])
      const ob = await outboxOf(tx, a1[0]!.id)
      await tx.query(`update public.movements set purchase_id = $2 where id = $1`, [k, p])
      const a2 = await alertsOf(tx, 'kirim_manbasiz', `movement_id = $1`, [k])
      return { p, k, a1, ob, a2 }
    })
    expect(r.a1).toHaveLength(1)
    expect(r.a1[0]).toMatchObject({ severity: 'belgi', status: 'yangi', object_id: A.ids.obj3, material_id: A.ids.m1 })
    expect(r.a1[0]!.details).toMatchObject({
      reason: 'open_purchase',
      qty_base: 30,
      base_unit: 'kg',
      open_purchase_ids: [r.p],
      candidate_purchase_id: null,
    })
    expect(r.ob).toEqual([])
    expect(r.a2[0]).toMatchObject({ status: 'yopildi' })
    expect(r.a2[0]!.details).toMatchObject({ auto_closed: true, closed_reason: 'linked' })
  })

  it('manba yo`q (7 kun) → no_source; 7 kun oldingi xarid (chegara) — manba hisoblanadi', async () => {
    const r = await as('admin', async (tx) => {
      // obj3 + m2: o'tkazma yo'q (fixture o'tkazmalari m1)
      const none = await mv(tx, 'kirim', A.ids.obj3!, '5', { mat: A.ids.m2 })
      const p = await purchase(tx, P('admin'), {
        obj: A.ids.obj3!, mat: A.ids.m2, qty: '5', total: '5000', at: '2026-09-01T10:00:00Z',
      })
      await mv(tx, 'kirim', A.ids.obj3!, '5', { mat: A.ids.m2, at: '2026-09-01T11:00:00Z', extra: { purchase_id: p } })
      const edge = await mv(tx, 'kirim', A.ids.obj3!, '1', { mat: A.ids.m2, at: '2026-09-08T10:00:00Z' })
      const after = await mv(tx, 'kirim', A.ids.obj3!, '1', { mat: A.ids.m2, at: '2026-09-08T10:00:01Z' })
      return {
        none: await alertsOf(tx, 'kirim_manbasiz', `movement_id = $1`, [none]),
        edge: await alertsOf(tx, 'kirim_manbasiz', `movement_id = $1`, [edge]),
        after: await alertsOf(tx, 'kirim_manbasiz', `movement_id = $1`, [after]),
      }
    })
    expect(r.none.map((a) => a.details.reason)).toEqual(['no_source'])
    expect(r.edge).toEqual([])
    expect(r.after.map((a) => a.details.reason)).toEqual(['no_source'])
  })

  it('o`tkazma manba hisoblanadi; chiqim va inventarizatsiya tuzatishi — alert yo`q', async () => {
    const r = await as('admin', async (tx) => {
      const k = await mv(tx, 'kirim', A.ids.obj3!, '1') // tr_2to3 (m1 → obj3) — manba, ochiq xarid yo'q
      const c = await mv(tx, 'chiqim', A.ids.obj3!, '1', { mat: A.ids.m2 })
      return {
        k: await alertsOf(tx, 'kirim_manbasiz', `movement_id = $1`, [k]),
        c: await alertsOf(tx, 'kirim_manbasiz', `movement_id = $1`, [c]),
      }
    })
    expect(r).toEqual({ k: [], c: [] })
  })

  it('nomzodlar farqni yopsa — xarid ≠ qabul alerti yo`q, kirim nomzod sifatida belgilanadi', async () => {
    const r = await as('admin', async (tx) => {
      const p = await purchase(tx, P('admin'), {
        obj: A.ids.obj3!, mat: A.ids.m2, qty: '100', total: '100000',
        at: new Date(Date.now() - 30 * 3600_000).toISOString(),
      })
      const k = await mv(tx, 'kirim', A.ids.obj3!, '98', { mat: A.ids.m2, at: new Date(Date.now() - 29 * 3600_000).toISOString() })
      await sys(tx, () => tx.query(`select private.evaluate_purchase_receipt($1)`, [p]))
      return {
        p,
        k,
        diff: await alertsOf(tx, 'xarid_qabul_farqi', `purchase_id = $1`, [p]),
        mark: await alertsOf(tx, 'kirim_manbasiz', `movement_id = $1`, [k]),
      }
    })
    expect(r.diff).toEqual([])
    expect(r.mark).toHaveLength(1)
    expect(r.mark[0]).toMatchObject({ purchase_id: r.p, status: 'yangi' })
    expect(r.mark[0]!.details).toMatchObject({ reason: 'open_purchase', candidate_purchase_id: r.p })
  })

  it('nomzodlar yopmasa — alert details.unlinked_candidates; bog`lansa — nomzodlar olib tashlanadi', async () => {
    const r = await as('admin', async (tx) => {
      const p = await purchase(tx, P('admin'), {
        obj: A.ids.obj3!, mat: A.ids.m2, qty: '100', total: '100000',
        at: new Date(Date.now() - 30 * 3600_000).toISOString(),
      })
      const k = await mv(tx, 'kirim', A.ids.obj3!, '50', { mat: A.ids.m2, at: new Date(Date.now() - 29 * 3600_000).toISOString() })
      // 72 soatdan tashqari (oldin) — nomzod emas
      await mv(tx, 'kirim', A.ids.obj3!, '40', { mat: A.ids.m2, at: new Date(Date.now() - 31 * 3600_000).toISOString() })
      await sys(tx, () => tx.query(`select private.evaluate_purchase_receipt($1)`, [p]))
      const a1 = await alertsOf(tx, 'xarid_qabul_farqi', `purchase_id = $1`, [p])
      await tx.query(`update public.movements set purchase_id = $2 where id = $1`, [k, p])
      const a2 = await alertsOf(tx, 'xarid_qabul_farqi', `purchase_id = $1`, [p])
      return { k, a1, a2 }
    })
    expect(r.a1).toHaveLength(1)
    expect(r.a1[0]!.details).toMatchObject({
      purchased_qty_base: 100,
      received_qty_base: 0,
      direction: 'under',
      unlinked_candidates: [{ movement_id: r.k, qty_base: 50 }],
      unlinked_qty_base: 50,
    })
    expect(r.a2[0]!.details).toMatchObject({ received_qty_base: 50 })
    expect(r.a2[0]!.details).not.toHaveProperty('unlinked_candidates')
  })
})

// ============================================================================
// B. Manfiy qoldiq, o'tkazma qoldig'i
// ============================================================================
describe('B: manfiy_qoldiq va transfer_insufficient_stock', () => {
  it('chiqim qoldiqni manfiy qilsa — bitta ochiq alert (yangilanadi), outbox bir marta; qoldiq tiklansa — yopiladi', async () => {
    const r = await as('admin', async (tx) => {
      const c1 = await mv(tx, 'chiqim', A.ids.obj3!, '10')
      const a1 = await alertsOf(tx, 'manfiy_qoldiq')
      const c2 = await mv(tx, 'chiqim', A.ids.obj3!, '5')
      const a2 = await alertsOf(tx, 'manfiy_qoldiq')
      const ob = await outboxOf(tx, a2[0]!.id)
      await mv(tx, 'kirim', A.ids.obj3!, '15')
      const a3 = await alertsOf(tx, 'manfiy_qoldiq')
      return { c1, c2, a1, a2, ob, a3 }
    })
    expect(r.a1).toHaveLength(1)
    expect(r.a1[0]).toMatchObject({ severity: 'ogohlantirish', object_id: A.ids.obj3, material_id: A.ids.m1, movement_id: r.c1 })
    expect(r.a1[0]!.details).toEqual({ stock_after: -10, qty_base: 10, unit: 'kg', movement_type: 'chiqim', movement_deleted: false })
    expect(r.a2).toHaveLength(1)
    expect(r.a2[0]).toMatchObject({ movement_id: r.c2 })
    expect(r.a2[0]!.details).toMatchObject({ stock_after: -15, qty_base: 5 })
    expect(r.ob).toHaveLength(1)
    expect(r.ob[0]!.payload).toMatchObject({ type: 'manfiy_qoldiq', object_name: 'A obj3' })
    expect(r.a3[0]).toMatchObject({ status: 'yopildi' })
    expect(r.a3[0]!.details).toMatchObject({ auto_closed: true, closed_reason: 'stock_restored', stock_after: 0 })
  })

  it('stock_restored bilan yopilgandan keyin 24 soat ichida — yangi alert yo`q, yopilgani qayta ochiladi (audit2 L3)', async () => {
    const r = await as('admin', async (tx) => {
      await mv(tx, 'chiqim', A.ids.obj3!, '10')
      await mv(tx, 'kirim', A.ids.obj3!, '10')
      const c3 = await mv(tx, 'chiqim', A.ids.obj3!, '4')
      const a1 = await alertsOf(tx, 'manfiy_qoldiq')
      // qoldiq tiklanadi (yopiladi), yopilish 24 soatdan eski — yangi alert yaratiladi
      await mv(tx, 'kirim', A.ids.obj3!, '4')
      await raw(tx, `update public.alerts set closed_at = now() - interval '25 hours' where id = $1`, [a1[0]!.id])
      await mv(tx, 'chiqim', A.ids.obj3!, '1')
      const a2 = await alertsOf(tx, 'manfiy_qoldiq')
      return { c3, a1, a2 }
    })
    expect(r.a1).toHaveLength(1)
    expect(r.a1[0]).toMatchObject({ status: 'yangi', movement_id: r.c3 })
    expect(r.a1[0]!.details).toMatchObject({ stock_after: -4, qty_base: 4, reopen_count: 1 })
    expect(r.a1[0]!.details).toHaveProperty('reopened_at')
    expect(r.a2.map((a) => a.status)).toEqual(['yopildi', 'yangi'])
    expect(r.a2[1]!.details).toMatchObject({ stock_after: -1 })
  })

  it('kirim (chiqim emas) ochiq alert bo`lmasa — qoldiq hisoblanmaydi / alert yo`q', async () => {
    const r = await as('admin', async (tx) => {
      // manfiy qoldiq kirimdan oldin ham alert bermaydi (chiqim emas): obj3 m1 da 0 → kirim 1
      await mv(tx, 'kirim', A.ids.obj3!, '1')
      return alertsOf(tx, 'manfiy_qoldiq')
    })
    expect(r).toEqual([])
  })

  it('qoldiq aynan 0 — alert yo`q', async () => {
    const r = await as('admin', async (tx) => {
      await mv(tx, 'chiqim', A.ids.obj1!, '100') // obj1: 100 kg
      return alertsOf(tx, 'manfiy_qoldiq')
    })
    expect(r).toEqual([])
  })

  it('create_transfer: manbadan ko`p — 22023 transfer_insufficient_stock (xabarda mavjud qoldiq); teng — OK', async () => {
    const r = await as('prorab', async (tx) => ({
      over: await resFull(tx, `select public.create_transfer($1, $2, $3, $4, $5, 3, null)`,
        [randomUUID(), A.ids.obj1, A.ids.obj2, A.ids.m1, qopId]),
      exact: await res(tx, `select public.create_transfer($1, $2, $3, $4, $5, 2, null)`,
        [randomUUID(), A.ids.obj1, A.ids.obj2, A.ids.m1, qopId]),
      after: await res(tx, `select public.create_transfer($1, $2, $3, $4, $5, 0.001, null)`,
        [randomUUID(), A.ids.obj1, A.ids.obj2, A.ids.m1, kgId]),
    }))
    expect(r.over.key).toBe('22023:transfer_insufficient_stock')
    expect(r.over.msg).toContain('100 kg')
    expect(r.exact).toBe('OK:1')
    expect(r.after).toBe('22023:transfer_insufficient_stock')
  })
})

// ============================================================================
// C. Takroriy yozuv
// ============================================================================
describe('C: takroriy_yozuv', () => {
  it('harakat: shu odam/obyekt/material/tur/miqdor — record (belgi), first_id; boshqa miqdor yoki tur — yo`q', async () => {
    const r = await as('prorab', async (tx) => {
      const k1 = await mv(tx, 'kirim', A.ids.obj1!, '7')
      const k2 = await mv(tx, 'kirim', A.ids.obj1!, '7')
      const k3 = await mv(tx, 'kirim', A.ids.obj1!, '8')
      const c1 = await mv(tx, 'chiqim', A.ids.obj1!, '7')
      return { k1, k2, k3, c1, a: await alertsOf(tx, 'takroriy_yozuv') }
    })
    expect(r.a).toHaveLength(1)
    expect(r.a[0]).toMatchObject({ severity: 'belgi', movement_id: r.k2, purchase_id: null })
    expect(r.a[0]!.details).toEqual({
      kind: 'record',
      table: 'movements',
      record_id: r.k2,
      first_id: r.k1,
      window_minutes: 10,
      qty_base: 7,
      total_amount: null,
      movement_type: 'kirim',
    })
  })

  it('oyna: aynan 10 daqiqa — takror; 10 daqiqa + 1 s — yo`q; oyna 0 — endi ruxsat yo`q (audit B2)', async () => {
    const run = async (gapSec: number, windowMin = 10): Promise<number> =>
      as('prorab', async (tx) => {
        if (windowMin !== 10) {
          await sys(tx, () => tx.query(`update public.companies set duplicate_window_minutes = $2 where id = $1`, [A.id, windowMin]))
        }
        const k1 = await mv(tx, 'kirim', A.ids.obj1!, '9')
        await raw(tx, `update public.movements set created_at = now() - make_interval(secs => $2) where id = $1`, [k1, gapSec])
        await mv(tx, 'kirim', A.ids.obj1!, '9')
        return (await alertsOf(tx, 'takroriy_yozuv')).length
      })
    expect(await run(600)).toBe(1)
    expect(await run(601)).toBe(0)
    // audit_fixes B2: 0 (qoida o'chiq) — CHECK 1..1440
    const zero = await as('admin', (tx) =>
      sys(tx, () => res(tx, `update public.companies set duplicate_window_minutes = 0 where id = $1`, [A.id])),
    )
    expect(zero).toBe('23514:')
  })

  it('xarid: shu xaridor, miqdor va summa — record; boshqa summa — yo`q', async () => {
    const r = await as('taminotchi', async (tx) => {
      const me = P('taminotchi')
      const p1 = await purchase(tx, me, { obj: A.ids.obj2!, qty: '10', total: '12000' })
      const p2 = await purchase(tx, me, { obj: A.ids.obj2!, qty: '10', total: '12000' })
      await purchase(tx, me, { obj: A.ids.obj2!, qty: '10', total: '12001' })
      return { p1, p2, a: await alertsOf(tx, 'takroriy_yozuv') }
    })
    expect(r.a).toHaveLength(1)
    expect(r.a[0]).toMatchObject({ purchase_id: r.p2 })
    expect(r.a[0]!.details).toMatchObject({ kind: 'record', table: 'purchases', first_id: r.p1, total_amount: 12000, movement_type: null })
  })

  // audit_fixes B5: klient yuborgan xesh e'tiborsiz (null); xeshni faqat svc_set_photo_hash yozadi.
  it('rasm xeshi: klient qiymati e`tiborsiz; svc — format (photo_sha256_invalid), katta harf normallashadi; boshqa yozuvda — photo (ogohlantirish, outbox)', async () => {
    const r = await as('admin', async (tx) => {
      const clientBad = await res(tx, `insert into public.movements (company_id, type, object_id, material_id, unit_id, qty_input, unit_input, qty_base, photo_path, photo_sha256)
        values ($1, 'kirim', $2, $3, $4, 1, '-', 0, $5, 'xyz')`, [A.id, A.ids.obj1, A.ids.m1, kgId, photoPath()])
      const k = await mv(tx, 'kirim', A.ids.obj1!, '1', { extra: { photo_path: photoPath(), photo_sha256: sha('A') } })
      const clientStored = await scalar<string | null>(tx, `select photo_sha256 from public.movements where id = $1`, [k])
      const bad = await sys(tx, () => res(tx, `select public.svc_set_photo_hash('movements', $1, 'xyz')`, [k]))
      const set = await sys(tx, () => scalar<boolean>(tx, `select public.svc_set_photo_hash('movements', $1, $2)`, [k, sha('A')]))
      const stored = await scalar<string>(tx, `select photo_sha256 from public.movements where id = $1`, [k])
      // rasmsiz yozuv — xesh yozilmaydi (false)
      const noPath = await mv(tx, 'kirim', A.ids.obj1!, '2', { extra: { photo_sha256: sha('a') } })
      const noPathSet = await sys(tx, () => scalar<boolean>(tx, `select public.svc_set_photo_hash('movements', $1, $2)`, [noPath, sha('a')]))
      const noPathSha = await scalar<string | null>(tx, `select photo_sha256 from public.movements where id = $1`, [noPath])
      const p = await purchase(tx, P('admin'), {
        obj: A.ids.obj1!, qty: '1', total: '10', extra: { receipt_photo_path: photoPath(), receipt_photo_sha256: ` ${sha('a')} ` },
      })
      const beforeSvc = (await alertsOf(tx, 'takroriy_yozuv', `details ->> 'kind' = 'photo'`)).length
      await sys(tx, () => tx.query(`select public.svc_set_photo_hash('purchases', $1, $2)`, [p, ` ${sha('A')} `]))
      const a = await alertsOf(tx, 'takroriy_yozuv', `details ->> 'kind' = 'photo'`)
      return { clientBad, clientStored, bad, set, k, stored, noPathSet, noPathSha, p, beforeSvc, a, ob: a[0] ? await outboxOf(tx, a[0].id) : [] }
    })
    expect(r.clientBad).toBe('OK:1')
    expect(r.clientStored).toBeNull()
    expect(r.bad).toBe('23514:photo_sha256_invalid')
    expect(r.set).toBe(true)
    expect(r.noPathSet).toBe(false)
    expect(r.beforeSvc).toBe(0)
    expect(r.stored).toBe(sha('a'))
    expect(r.noPathSha).toBeNull()
    expect(r.a).toHaveLength(1)
    expect(r.a[0]).toMatchObject({ severity: 'ogohlantirish', purchase_id: r.p })
    expect(r.a[0]!.details).toEqual({
      kind: 'photo', table: 'purchases', record_id: r.p, first_id: r.k, first_table: 'movements', sha256: sha('a'),
    })
    expect(r.ob).toHaveLength(1)
  })

  it('boshqa firmadagi bir xil xesh — alert yo`q', async () => {
    const r = await as('admin', async (tx) => {
      await sys(tx, () =>
        tx.query(`insert into public.movements (company_id, type, object_id, material_id, qty_input, unit_input, qty_base, photo_path, photo_sha256)
                  values ($1, 'kirim', $2, $3, 1, 'kg', 1, $4, $5)`, [B.id, B.ids.obj1, B.ids.m1, photoPath(B.id), sha('b')]),
      )
      await mv(tx, 'kirim', A.ids.obj1!, '1', { extra: { photo_path: photoPath(), photo_sha256: sha('b') } })
      return alertsOf(tx, 'takroriy_yozuv', `details ->> 'kind' = 'photo'`)
    })
    expect(r).toEqual([])
  })
})

// ============================================================================
// D. Joylashuv
// ============================================================================
describe('D: joylashuv_farqi', () => {
  it('geo_distance_m: ekvatorda 0.001° = 111 m; bir nuqta — 0', async () => {
    expect(await scalar<number>(db, `select private.geo_distance_m(0, 0, 0, 0.001)`)).toBe(111)
    expect(await scalar<number>(db, `select private.geo_distance_m(41.311081, 69.240562, 41.321081, 69.240562)`)).toBe(1112)
    expect(await scalar<number>(db, `select private.geo_distance_m(41.3, 69.2, 41.3, 69.2)`)).toBe(0)
  })

  it('radius + aniqlikdan uzoq — belgi; yaqin / aniqlik qoplasa / denied / xarid — yo`q; geo ustunlari sharti', async () => {
    const r = await as('admin', async (tx) => {
      await tx.query(`update public.objects set lat = 41.311081, lng = 69.240562 where id = $1`, [A.ids.obj3])
      const geo = (lat: number, acc: number | null): Row => ({ geo_status: 'ok', geo_lat: lat, geo_lng: 69.240562, geo_accuracy_m: acc })
      const far = await mv(tx, 'kirim', A.ids.obj3!, '1', { mat: A.ids.m2, extra: geo(41.321081, 20) })
      const near = await mv(tx, 'kirim', A.ids.obj3!, '1', { mat: A.ids.m2, extra: geo(41.311081, 5) })
      const covered = await mv(tx, 'kirim', A.ids.obj3!, '1', { mat: A.ids.m2, extra: geo(41.316081, 256) }) // 556 = 300 + 256 — ichkarida
      // aniqlik radius bilan cheklanadi: 1112 > 300 + min(900, 300)
      const capped = await mv(tx, 'kirim', A.ids.obj3!, '1', { mat: A.ids.m2, extra: geo(41.321081, 900) })
      const denied = await mv(tx, 'kirim', A.ids.obj3!, '1', { mat: A.ids.m2, extra: { geo_status: 'denied' } })
      await purchase(tx, P('admin'), { obj: A.ids.obj3!, mat: A.ids.m2, qty: '1', total: '1', extra: geo(41.321081, 5) })
      const bad = await res(tx, `insert into public.movements (company_id, type, object_id, material_id, unit_id, qty_input, unit_input, qty_base, geo_status)
        values ($1, 'kirim', $2, $3, $4, 1, '-', 0, 'ok')`, [A.id, A.ids.obj3, A.ids.m2, m2Id])
      const badDenied = await res(tx, `insert into public.movements (company_id, type, object_id, material_id, unit_id, qty_input, unit_input, qty_base, geo_status, geo_lat, geo_lng)
        values ($1, 'kirim', $2, $3, $4, 1, '-', 0, 'denied', 1, 1)`, [A.id, A.ids.obj3, A.ids.m2, m2Id])
      return { far, near, covered, capped, denied, bad, badDenied, a: await alertsOf(tx, 'joylashuv_farqi') }
    })
    expect(r.a.map((a) => a.movement_id)).toEqual([r.far, r.capped])
    expect(r.a[1]!.details).toMatchObject({ distance_m: 1112, radius_m: 300, accuracy_m: 900 })
    expect(r.a[0]).toMatchObject({ severity: 'belgi', movement_id: r.far, object_id: A.ids.obj3 })
    expect(r.a[0]!.details).toEqual({
      distance_m: 1112, radius_m: 300, accuracy_m: 20,
      geo_lat: 41.321081, geo_lng: 69.240562, object_lat: 41.311081, object_lng: 69.240562,
      movement_type: 'kirim',
    })
    expect(r.bad).toBe('23514:')
    expect(r.badDenied).toBe('23514:')
  })

  it('obyekt koordinatasi yo`q — alert yo`q; kunlik hisobotda geo_denied_count', async () => {
    const r = await as('admin', async (tx) => {
      await mv(tx, 'kirim', A.ids.obj2!, '1', { extra: { geo_status: 'ok', geo_lat: 1, geo_lng: 1 } })
      await mv(tx, 'kirim', A.ids.obj2!, '1', { extra: { geo_status: 'denied' } })
      await mv(tx, 'kirim', A.ids.obj2!, '1', { extra: { geo_status: 'unavailable' } })
      await purchase(tx, P('admin'), { obj: A.ids.obj2!, qty: '1', total: '1', extra: { geo_status: 'denied' } })
      const st = await sys(tx, () =>
        scalar<Row>(tx, `select private.daily_report_stats($1, now() - interval '1 hour', now() + interval '1 hour')`, [A.id]),
      )
      return { a: await alertsOf(tx, 'joylashuv_farqi'), denied: st.geo_denied_count, unavailable: st.geo_unavailable_count }
    })
    expect(r).toEqual({ a: [], denied: 2, unavailable: 1 })
  })
})

// ============================================================================
// E. Rasm majburiy
// ============================================================================
describe('E: photo_required', () => {
  it('xarid summasi chegaradan (>=) — rasm majburiy; kichik — yo`q; rasm bilan — OK', async () => {
    const r = await as('admin', async (tx) => {
      await tx.query(`update public.companies set photo_required_amount = 1000000 where id = $1`, [A.id])
      const me = P('admin')
      return {
        eq: await res(tx, `select 1 from (select 1) x`).then(() =>
          resFull(tx, `insert into public.purchases (company_id, buyer_id, object_id, material_id, unit_id, qty_input, unit_input, qty_base, unit_price, price_per_base, total_amount, created_by)
            values ($1, $2, $3, $4, $5, 1, '-', 0, 0, 0, 1000000, $2)`, [A.id, me, A.ids.obj1, A.ids.m1, kgId]).then((x) => x.key)),
        less: await res(tx, `insert into public.purchases (company_id, buyer_id, object_id, material_id, unit_id, qty_input, unit_input, qty_base, unit_price, price_per_base, total_amount, created_by)
            values ($1, $2, $3, $4, $5, 1, '-', 0, 0, 0, 999999.99, $2)`, [A.id, me, A.ids.obj1, A.ids.m1, kgId]),
        photo: await res(tx, `insert into public.purchases (company_id, buyer_id, object_id, material_id, unit_id, qty_input, unit_input, qty_base, unit_price, price_per_base, total_amount, created_by, receipt_photo_path)
            values ($1, $2, $3, $4, $5, 1, '-', 0, 0, 0, 2000000, $2, $6)`, [A.id, me, A.ids.obj1, A.ids.m1, kgId, photoPath()]),
      }
    })
    expect(r).toEqual({ eq: '23514:photo_required', less: 'OK:1', photo: 'OK:1' })
  })

  it('material photo_required: xarid va kirimda majburiy, chiqimda emas; QR tasdiqlangan xarid — rasmsiz OK', async () => {
    const r = await as('admin', async (tx) => {
      await tx.query(`update public.materials set photo_required = true where id = $1`, [A.ids.m2])
      const me = P('admin')
      const sign = '123456789012'
      await sys(tx, () =>
        tx.query(`select public.svc_upsert_receipt_lookup($1, $2, $3, 'T1', '77', '{}'::jsonb, 5000, '123456789', 'Do''kon', now())`,
          [A.id, me, sign]),
      )
      const ins = (extra: string, vals: unknown[]): Promise<string> =>
        res(tx, `insert into public.purchases (company_id, buyer_id, object_id, material_id, unit_id, qty_input, unit_input, qty_base, unit_price, price_per_base, total_amount, created_by${extra ? ', ' + extra : ''})
          values ($1, $2, $3, $4, $5, 1, '-', 0, 0, 0, 5000, $2${vals.map((_, i) => `, $${i + 6}`).join('')})`,
          [A.id, me, A.ids.obj1, A.ids.m2, m2Id, ...vals])
      const noPhoto = await ins('', [])
      const fakeVerified = await ins('receipt_fiscal_sign, receipt_verified', ['999999999999', true])
      const qr = await ins('receipt_fiscal_sign', [sign])
      const qrRow = await one(tx, `select receipt_verified, receipt_total::text, seller_tin from public.purchases where receipt_fiscal_sign = $1`, [sign])
      const kirim = await res(tx, `insert into public.movements (company_id, type, object_id, material_id, unit_id, qty_input, unit_input, qty_base)
        values ($1, 'kirim', $2, $3, $4, 1, '-', 0)`, [A.id, A.ids.obj1, A.ids.m2, m2Id])
      const chiqim = await res(tx, `insert into public.movements (company_id, type, object_id, material_id, unit_id, qty_input, unit_input, qty_base)
        values ($1, 'chiqim', $2, $3, $4, 1, '-', 0)`, [A.id, A.ids.obj1, A.ids.m2, m2Id])
      const kirimPhoto = await res(tx, `insert into public.movements (company_id, type, object_id, material_id, unit_id, qty_input, unit_input, qty_base, photo_path)
        values ($1, 'kirim', $2, $3, $4, 1, '-', 0, $5)`, [A.id, A.ids.obj1, A.ids.m2, m2Id, photoPath()])
      return { noPhoto, fakeVerified, qr, qrRow, kirim, chiqim, kirimPhoto }
    })
    expect(r).toEqual({
      noPhoto: '23514:photo_required',
      fakeVerified: '23514:photo_required', // keshda yo'q — receipt_verified = false (server)
      qr: 'OK:1',
      qrRow: { receipt_verified: true, receipt_total: '5000.00', seller_tin: '123456789' },
      kirim: '23514:photo_required',
      chiqim: 'OK:1',
      kirimPhoto: 'OK:1',
    })
  })
})

// ============================================================================
// F. Smetasiz chiqim
// ============================================================================
describe('F: smetasiz_chiqim', () => {
  it('smetasiz obyekt: kuniga bitta alert, count/materials yangilanadi, outbox bir marta; smetali obyekt — yo`q', async () => {
    const r = await as('admin', async (tx) => {
      const c1 = await mv(tx, 'chiqim', A.ids.obj3!, '2', { at: new Date(Date.now() - 60_000).toISOString() })
      const c2 = await mv(tx, 'chiqim', A.ids.obj3!, '3', { mat: A.ids.m2 })
      await mv(tx, 'chiqim', A.ids.obj1!, '1')
      const a = await alertsOf(tx, 'smetasiz_chiqim')
      const ob = await outboxOf(tx, a[0]!.id)
      await tx.query(`update public.movements set deleted_at = now() where id = $1`, [c2])
      const a2 = await alertsOf(tx, 'smetasiz_chiqim')
      const day = await scalar<string>(tx, `select to_char((now() at time zone 'Asia/Tashkent')::date, 'YYYY-MM-DD')`)
      return { c1, c2, a, ob, a2, day }
    })
    expect(r.a).toHaveLength(1)
    expect(r.a[0]).toMatchObject({ severity: 'ogohlantirish', object_id: A.ids.obj3, material_id: null, movement_id: r.c2 })
    expect(r.a[0]!.details).toEqual({
      first_day: r.day,
      last_day: r.day,
      day: r.day,
      days: 1,
      count: 2,
      materials: [
        { material_id: A.ids.m2, material_name: 'A qum', qty_base: 3, base_unit: 'm³' },
        { material_id: A.ids.m1, material_name: 'A sement', qty_base: 2, base_unit: 'kg' },
      ],
      last_movement_id: r.c2,
    })
    expect(r.ob).toHaveLength(1)
    expect(r.a2).toHaveLength(1)
    expect(r.a2[0]!.details).toMatchObject({ count: 1, last_movement_id: r.c1 })
  })

  it('obyekt bo`yicha bitta ochiq alert kunlar davomida (days, first_day/last_day); joriy smeta paydo bo`lsa — estimate_added', async () => {
    const r = await as('admin', async (tx) => {
      const y = new Date(Date.now() - 86400_000).toISOString()
      await mv(tx, 'chiqim', A.ids.obj3!, '2', { at: y })
      await mv(tx, 'chiqim', A.ids.obj3!, '3')
      const a1 = await alertsOf(tx, 'smetasiz_chiqim')
      const days = await one<{ y: string; t: string }>(tx, `select to_char(($1::timestamptz at time zone 'Asia/Tashkent')::date, 'YYYY-MM-DD') as y,
        to_char((now() at time zone 'Asia/Tashkent')::date, 'YYYY-MM-DD') as t`, [y])
      // joriy smeta (smeta RPC GUC'i bilan — import_estimate ichidagidek)
      await sys(tx, async () => {
        await tx.query(`select set_config('terron.estimate_rpc', 'on', true)`)
        await tx.query(`insert into public.estimates (company_id, object_id, version, title, is_current) values ($1, $2, 1, 'S', true)`, [A.id, A.ids.obj3])
        await tx.query(`select set_config('terron.estimate_rpc', 'off', true)`)
      })
      const a2 = await alertsOf(tx, 'smetasiz_chiqim')
      await mv(tx, 'chiqim', A.ids.obj3!, '1')
      const a3 = await alertsOf(tx, 'smetasiz_chiqim')
      return { a1, days, a2, a3 }
    })
    expect(r.a1).toHaveLength(1)
    expect(r.a1[0]!.details).toMatchObject({ first_day: r.days.y, last_day: r.days.t, day: r.days.t, days: 2, count: 2 })
    expect(r.a2[0]).toMatchObject({ status: 'yopildi' })
    expect(r.a2[0]!.details).toMatchObject({ auto_closed: true, closed_reason: 'estimate_added' })
    expect(r.a3).toHaveLength(1)
  })
})

// ============================================================================
// G. Chek QR
// ============================================================================
describe('G: chek', () => {
  it('fiskal belgi firma bo`yicha bitta: 23505 receipt_already_used (kim, qachon); boshqa firma — OK; o`chirilgandan keyin — OK; tiklash — rad', async () => {
    const sign = '555555555555'
    const r = await as('admin', async (tx) => {
      const me = P('admin')
      const p1 = await purchase(tx, me, { obj: A.ids.obj1!, qty: '1', total: '100', buyer: P('taminotchi'), extra: { receipt_fiscal_sign: sign } })
      const dup = await resFull(tx, `insert into public.purchases (company_id, buyer_id, object_id, material_id, unit_id, qty_input, unit_input, qty_base, unit_price, price_per_base, total_amount, created_by, receipt_fiscal_sign)
        values ($1, $2, $3, $4, $5, 1, '-', 0, 0, 0, 100, $2, $6)`, [A.id, me, A.ids.obj1, A.ids.m1, kgId, sign])
      const otherCo = await sys(tx, () =>
        res(tx, `insert into public.purchases (company_id, buyer_id, object_id, material_id, qty_input, unit_input, qty_base, unit_price, total_amount, receipt_fiscal_sign)
          values ($1, $2, $3, $4, 1, 'kg', 1, 1, 1, $5)`, [B.id, P('admin', B), B.ids.obj1, B.ids.m1, sign]),
      )
      await tx.query(`update public.purchases set deleted_at = now() where id = $1`, [p1])
      const p2 = await res(tx, `insert into public.purchases (company_id, buyer_id, object_id, material_id, unit_id, qty_input, unit_input, qty_base, unit_price, price_per_base, total_amount, created_by, receipt_fiscal_sign)
        values ($1, $2, $3, $4, $5, 1, '-', 0, 0, 0, 100, $2, $6)`, [A.id, me, A.ids.obj1, A.ids.m1, kgId, sign])
      const restore = await res(tx, `select public.restore_record('purchases', $1)`, [p1])
      return { dup, otherCo, p2, restore }
    })
    expect(r.dup.key).toBe('23505:receipt_already_used')
    expect(r.dup.msg).toContain('A taminotchi')
    expect(r.dup.msg).toMatch(/\d{2}\.\d{2}\.\d{4} \d{2}:\d{2}/)
    expect(r.otherCo).toBe('OK:1')
    expect(r.p2).toBe('OK:1')
    expect(r.restore).toBe('23505:receipt_already_used')
  })

  it('chek_farqi: farq aynan 1 — yo`q; > 1 — ogohlantirish; tuzatilsa yopiladi; receipt_total null — yo`q', async () => {
    const r = await as('admin', async (tx) => {
      const me = P('admin')
      // QR skanerlangan, lekin sahifa ochilmagan (keshsiz) — receipt_total klientdan saqlanadi
      const ok = await purchase(tx, me, { obj: A.ids.obj1!, qty: '1', total: '1001', extra: { receipt_total: '1000', receipt_fiscal_sign: '700000000001' } })
      const none = await purchase(tx, me, { obj: A.ids.obj1!, qty: '2', total: '5000' })
      const bad = await purchase(tx, me, { obj: A.ids.obj1!, qty: '3', total: '1001.01', extra: { receipt_total: '1000', receipt_fiscal_sign: '700000000003' } })
      // fiskal belgisiz receipt_total foydalanuvchi sessiyasida saqlanmaydi → alert yo'q
      const noSign = await purchase(tx, me, { obj: A.ids.obj1!, qty: '4', total: '9999', extra: { receipt_total: '1', seller_tin: '123456789' } })
      const noSignRow = await one(tx, `select receipt_total, seller_tin from public.purchases where id = $1`, [noSign])
      const a1 = await alertsOf(tx, 'chek_farqi')
      const ob = await outboxOf(tx, a1[0]!.id)
      await tx.query(`update public.purchases set total_amount = 1000.5 where id = $1`, [bad])
      const a2 = await alertsOf(tx, 'chek_farqi')
      return { ok, none, bad, a1, ob, a2, noSignRow }
    })
    expect(r.noSignRow).toEqual({ receipt_total: null, seller_tin: null })
    expect(r.a1).toHaveLength(1)
    expect(r.a1[0]).toMatchObject({ severity: 'ogohlantirish', purchase_id: r.bad })
    expect(r.a1[0]!.details).toEqual({
      receipt_total: 1000, total_amount: 1001.01, diff: 1.01, receipt_fiscal_sign: '700000000003', receipt_verified: false,
    })
    expect(r.ob).toHaveLength(1)
    expect(r.a2[0]).toMatchObject({ status: 'yopildi' })
    expect(r.a2[0]!.details).toMatchObject({ closed_reason: 'within_threshold' })
  })

  it('P1-1: keshdagi chek — klient yuborgan noto`g`ri receipt_total / seller_tin o`rniga keshdagisi; chek_farqi', async () => {
    const r = await as('taminotchi', async (tx) => {
      const me = P('taminotchi')
      await sys(tx, () =>
        tx.query(`select public.svc_upsert_receipt_lookup($1, $2, '800000000001', 'T', '1', '{"items":[{"name":"Sement"}]}', 5000, '301111111', 'S', now())`, [A.id, me]),
      )
      const p = await purchase(tx, me, {
        obj: A.ids.obj2!, qty: '1', total: '4000',
        extra: { receipt_fiscal_sign: '800000000001', receipt_total: '4000', seller_tin: '999999999', receipt_verified: false },
      })
      const row = await one(tx, `select receipt_verified, receipt_total::text, seller_tin from public.purchases where id = $1`, [p])
      // keyingi tahrirda ham (UPDATE) klient qiymati qaytmaydi
      await sys(tx, () => tx.query(`update public.purchases set receipt_total = 4000 where id = $1`, [p]))
      const upd = await scalar<string>(tx, `select receipt_total::text from public.purchases where id = $1`, [p])
      return { p, row, upd, a: await alertsOf(tx, 'chek_farqi', 'purchase_id = $1', [p]) }
    })
    // audit2 L1: bir qatorli chek summasi mos kelmasa — tasdiqlanmaydi
    expect(r.row).toEqual({ receipt_verified: false, receipt_total: '5000.00', seller_tin: '301111111' })
    expect(r.a).toHaveLength(1)
    expect(r.a[0]!.details).toMatchObject({ receipt_total: 5000, total_amount: 4000, diff: -1000, receipt_verified: false })
    // foydalanuvchi sessiyasidagi UPDATE da ham — keshdagi qiymat
    expect(r.upd).toBe('5000.00')
  })

  it('P2-1: keshda seller_tin va total null bo`lsa ham — endi tasdiqlanmaydi (audit B6); klient STIR saqlanadi', async () => {
    const r = await as('taminotchi', async (tx) => {
      const me = P('taminotchi')
      await sys(tx, () =>
        tx.query(`select public.svc_upsert_receipt_lookup($1, null, '800000000002', null, null, '{}', null, null, null, null)`, [A.id]),
      )
      const p = await purchase(tx, me, {
        obj: A.ids.obj2!, qty: '1', total: '700', extra: { receipt_fiscal_sign: '800000000002', receipt_total: '700', seller_tin: '302222222' },
      })
      return one(tx, `select receipt_verified, receipt_total::text, seller_tin from public.purchases where id = $1`, [p])
    })
    // audit_fixes B6: keshda summa, qator va chek sanasi yo'q — tasdiqlanmaydi (STIR baribir saqlanadi)
    expect(r).toEqual({ receipt_verified: false, receipt_total: '700.00', seller_tin: '302222222' })
  })

  it('P2-2: ko`p qatorli chek (payload.items > 1) — chek_farqi yo`q (jami taqqoslanmaydi)', async () => {
    const r = await as('taminotchi', async (tx) => {
      const me = P('taminotchi')
      await sys(tx, () =>
        tx.query(`select public.svc_upsert_receipt_lookup($1, null, '800000000003', null, null, '{"items":[{"name":"a"},{"name":"b"}]}', 9000, null, null, null)`, [A.id]),
      )
      const p = await purchase(tx, me, { obj: A.ids.obj2!, qty: '1', total: '3000', extra: { receipt_fiscal_sign: '800000000003' } })
      return {
        total: await scalar<string>(tx, `select receipt_total::text from public.purchases where id = $1`, [p]),
        a: await alertsOf(tx, 'chek_farqi', 'purchase_id = $1', [p]),
      }
    })
    expect(r).toEqual({ total: '9000.00', a: [] })
  })

  it('P2-8: Telegram "Ko`rildi" belgilari qayta baholashda saqlanadi (chek_farqi)', async () => {
    const r = await as('admin', async (tx) => {
      const p = await purchase(tx, P('admin'), { obj: A.ids.obj1!, qty: '1', total: '2000', extra: { receipt_fiscal_sign: '800000000004', receipt_total: '1000' } })
      const a = (await alertsOf(tx, 'chek_farqi', 'purchase_id = $1', [p]))[0]!
      await sys(tx, async () => {
        await tx.query(`update public.profiles set telegram_user_id = 9101 where id = $1`, [P('admin')])
        await tx.query(`select public.svc_mark_alert_seen(9101, $1)`, [a.id])
      })
      await tx.query(`update public.purchases set total_amount = 2500 where id = $1`, [p])
      return (await alertsOf(tx, 'chek_farqi', 'purchase_id = $1', [p]))[0]!
    })
    expect(r.status).toBe('korildi')
    expect(r.details).toMatchObject({ total_amount: 2500, diff: 1500, seen_by_name: 'A admin', seen_via: 'telegram' })
  })

  it('suppliers.tin: format, dublikat — supplier_tin_duplicate; boshqa firma — OK', async () => {
    const r = await as('taminotchi', async (tx) => ({
      ok: await res(tx, `insert into public.suppliers (company_id, name, tin, created_by) values ($1, 'STIR do''kon', '301234567', $2)`, [A.id, P('taminotchi')]),
      dup: await res(tx, `insert into public.suppliers (company_id, name, tin, created_by) values ($1, 'Boshqa nom', ' 301234567 ', $2)`, [A.id, P('taminotchi')]),
      bad: await res(tx, `insert into public.suppliers (company_id, name, tin, created_by) values ($1, 'Nom 3', '12ab', $2)`, [A.id, P('taminotchi')]),
      other: await sys(tx, () => res(tx, `insert into public.suppliers (company_id, name, tin) values ($1, 'B STIR', '301234567')`, [B.id])),
    }))
    expect(r).toEqual({ ok: 'OK:1', dup: '23505:supplier_tin_duplicate', bad: '23514:', other: 'OK:1' })
  })

  it('receipt_lookups: o`z firmasi o`qiydi, boshqa firma — yo`q; authenticated yoza olmaydi; svc upsert — bitta qator', async () => {
    const r = await as('prorab', async (tx) => {
      const id1 = await sys(tx, () =>
        scalar<string>(tx, `select public.svc_upsert_receipt_lookup($1, $2, '111111111111', 'T', '1', '{"a":1}', 100, null, 'S', null)`, [A.id, P('prorab')]),
      )
      const id2 = await sys(tx, () =>
        scalar<string>(tx, `select public.svc_upsert_receipt_lookup($1, null, '111111111111', null, null, '{"a":2}', 101.555, null, null, null)`, [A.id]),
      )
      await sys(tx, () =>
        tx.query(`select public.svc_upsert_receipt_lookup($1, null, '222222222222', null, null, '{}', 1, null, null, null)`, [B.id]),
      )
      const seen = await rows(tx, `select fiscal_sign, total::text, payload, created_by from public.receipt_lookups order by fiscal_sign`)
      const ins = await res(tx, `insert into public.receipt_lookups (company_id, fiscal_sign) values ($1, '333')`, [A.id])
      const upd = await res(tx, `update public.receipt_lookups set total = 1 where id = $1`, [id1])
      const invalid = await sys(tx, () =>
        res(tx, `select public.svc_upsert_receipt_lookup($1, null, '  ', null, null, null, null, null, null, null)`, [A.id]),
      )
      return { same: id1 === id2, seen, ins, upd, invalid }
    })
    expect(r.same).toBe(true)
    expect(r.seen).toEqual([{ fiscal_sign: '111111111111', total: '101.56', payload: { a: 2 }, created_by: P('prorab') }])
    expect(r.ins).toBe('42501:')
    expect(r.upd).toBe('42501:')
    expect(r.invalid).toBe('22023:receipt_lookup_invalid')
  })
})

// ============================================================================
// H. So'rov → xarid
// ============================================================================
describe('H: so`rov zanjiri', () => {
  async function request(tx: Tx, status: string, qtyKg: string, obj = A.ids.obj1!, neededBy: string | null = null): Promise<string> {
    return scalar<string>(
      tx,
      `insert into public.material_requests (company_id, object_id, material_id, unit_id, qty_input, unit_input, qty_base, status, needed_by, created_by)
       values ($1, $2, $3, $4, $5, '-', 0, $6, $7, $8) returning id`,
      [A.id, obj, A.ids.m1, kgId, qtyKg, status, neededBy, P('admin')],
    )
  }

  it('xarid request_id bilan → so`rov xarid_qilindi + purchase_id (taminotchi va prorab — RLS update huquqisiz ham)', async () => {
    const r = await as('admin', async (tx) => {
      const rq1 = await request(tx, 'tasdiqlandi', '100')
      const rq2 = await request(tx, 'tasdiqlandi', '10')
      let p1 = ''
      let p2 = ''
      await sys(tx, async () => {
        await tx.exec('set local role authenticated')
        await tx.query(`select set_config('request.jwt.claim.sub', $1, true)`, [A.users.taminotchi.authUid])
        p1 = await purchase(tx, P('taminotchi'), { obj: A.ids.obj1!, qty: '100', total: '100', extra: { request_id: rq1 } })
        await tx.query(`select set_config('request.jwt.claim.sub', $1, true)`, [A.users.prorab.authUid])
        p2 = await purchase(tx, P('prorab'), { obj: A.ids.obj1!, qty: '10', total: '10', extra: { request_id: rq2 } })
        await tx.query(`select set_config('request.jwt.claim.sub', $1, true)`, [A.users.admin.authUid])
      })
      const st = await sys(tx, () =>
        rows(tx, `select id, status::text, purchase_id from public.material_requests where id in ($1, $2) order by qty_base desc`, [rq1, rq2]),
      )
      return { rq1, rq2, p1, p2, st }
    })
    expect(r.st).toEqual([
      { id: r.rq1, status: 'xarid_qilindi', purchase_id: r.p1 },
      { id: r.rq2, status: 'xarid_qilindi', purchase_id: r.p2 },
    ])
  })

  it('purchase_request_invalid: kutilmoqda / rad / boshqa obyekt / boshqa firma so`rovi', async () => {
    const r = await as('admin', async (tx) => {
      const me = P('admin')
      const pend = await request(tx, 'kutilmoqda', '5')
      const rej = await request(tx, 'rad', '5')
      const other = await request(tx, 'tasdiqlandi', '5', A.ids.obj2!)
      const ins = (rq: string): Promise<string> =>
        res(tx, `insert into public.purchases (company_id, buyer_id, object_id, material_id, unit_id, qty_input, unit_input, qty_base, unit_price, price_per_base, total_amount, created_by, request_id)
          values ($1, $2, $3, $4, $5, 1, '-', 0, 0, 0, 1, $2, $6)`, [A.id, me, A.ids.obj1, A.ids.m1, kgId, rq])
      return { pend: await ins(pend), rej: await ins(rej), other: await ins(other), foreign: await ins(B.ids.mr_obj1!) }
    })
    expect(r).toEqual({
      pend: '23514:purchase_request_invalid',
      rej: '23514:purchase_request_invalid',
      other: '23514:purchase_request_invalid',
      foreign: '23503:purchase_request_invalid',
    })
  })

  it('ortiqcha xarid: aynan +20% — yo`q; oshsa — belgi; xarid o`chirilsa — so`rov tasdiqlandi ga qaytadi, alert yopiladi', async () => {
    const r = await as('admin', async (tx) => {
      const me = P('admin')
      const rq = await request(tx, 'tasdiqlandi', '100')
      const p1 = await purchase(tx, me, { obj: A.ids.obj1!, qty: '120', total: '120', extra: { request_id: rq } })
      const a0 = await alertsOf(tx, 'sorovdan_ortiq_xarid')
      const p2 = await purchase(tx, me, { obj: A.ids.obj1!, qty: '1', total: '1', extra: { request_id: rq } })
      const a1 = await alertsOf(tx, 'sorovdan_ortiq_xarid')
      const st1 = await one(tx, `select status::text, purchase_id from public.material_requests where id = $1`, [rq])
      await tx.query(`update public.purchases set deleted_at = now() where id = $1`, [p2])
      const a2 = await alertsOf(tx, 'sorovdan_ortiq_xarid')
      await tx.query(`update public.purchases set deleted_at = now() where id = $1`, [p1])
      const st2 = await one(tx, `select status::text, purchase_id from public.material_requests where id = $1`, [rq])
      return { rq, p1, p2, a0, a1, st1, a2, st2 }
    })
    expect(r.a0).toEqual([])
    expect(r.a1).toHaveLength(1)
    expect(r.a1[0]).toMatchObject({ severity: 'belgi', request_id: r.rq })
    expect([r.p1, r.p2]).toContain(r.a1[0]!.purchase_id)
    expect(r.a1[0]!.details).toEqual({
      request_qty_base: 100, purchased_qty_base: 121, over_pct: 21, threshold_pct: 20, base_unit: 'kg', purchase_count: 2,
    })
    expect(r.st1).toEqual({ status: 'xarid_qilindi', purchase_id: r.p1 })
    expect(r.a2[0]).toMatchObject({ status: 'yopildi' })
    expect(r.st2).toEqual({ status: 'tasdiqlandi', purchase_id: null })
  })

  it('cron: muddati o`tgan tasdiqlangan so`rovlar — firma bo`yicha bitta request_overdue, takroriy — 0; qabul qiluvchilar taminotchi + admin', async () => {
    const r = await as('admin', async (tx) => {
      const today = await scalar<string>(tx, `select (now() at time zone 'Asia/Tashkent')::date::text`)
      const rq = await request(tx, 'tasdiqlandi', '50', A.ids.obj1!, `${today}`)
      await raw(tx, `update public.material_requests set needed_by = needed_by - 2 where id = $1`, [rq])
      await request(tx, 'tasdiqlandi', '50', A.ids.obj1!, today) // bugun — hali o'tmagan
      return sys(tx, async () => {
        await tx.query(`update public.profiles set telegram_chat_id = 1001 where id = $1`, [P('taminotchi')])
        await tx.query(`update public.profiles set telegram_chat_id = 1002 where id = $1`, [P('admin')])
        await tx.query(`update public.profiles set telegram_chat_id = 1003 where id = $1`, [P('direktor')])
        const n1 = await scalar<number>(tx, `select private.enqueue_request_overdue($1::date)`, [today])
        const n2 = await scalar<number>(tx, `select private.enqueue_request_overdue($1::date)`, [today])
        const ob = await one<{ id: string; kind: string; report_date: string; payload: Row }>(
          tx, `select id, kind, report_date::text, payload from public.notification_outbox where kind = 'request_overdue' and company_id = $1`, [A.id])
        const rec = await rows(tx, `select chat_id::int, role from public.svc_outbox_recipients($1) order by chat_id`, [ob.id])
        return { rq, today, n1, n2, ob, rec }
      })
    })
    expect(r.n1).toBe(1)
    expect(r.n2).toBe(0)
    expect(r.ob.report_date).toBe(r.today)
    expect(r.ob.payload).toMatchObject({ date: r.today, company_name: 'A', count: 1 })
    expect((r.ob.payload.requests as Row[])[0]).toMatchObject({
      request_id: r.rq, object_name: 'A obj1', material_name: 'A sement', qty_base: 50, base_unit: 'kg', days_overdue: 2,
    })
    expect(r.rec).toEqual([{ chat_id: 1001, role: 'taminotchi' }, { chat_id: 1002, role: 'admin' }])
  })
})

// ============================================================================
// I. Podotchet
// ============================================================================
describe('I: podotchet', () => {
  it('qaytarildi: cash_balances (returned_total, balance); kind o`zgarmaydi; noto`g`ri kind — 23514; dashboard cash_returned_sum', async () => {
    const r = await as('admin', async (tx) => {
      const ret = await scalar<string>(tx, `insert into public.cash_advances (company_id, recipient_id, amount, kind, created_by)
        values ($1, $2, 100000, 'qaytarildi', $3) returning id`, [A.id, P('haydovchi'), P('admin')])
      const bal = await one(tx, `select issued_total::text, returned_total::text, spent_total::text, balance::text
        from public.cash_balances where profile_id = $1`, [P('haydovchi')])
      const lock = await res(tx, `update public.cash_advances set kind = 'berildi' where id = $1`, [ret])
      const bad = await res(tx, `insert into public.cash_advances (company_id, recipient_id, amount, kind, created_by) values ($1, $2, 1, 'boshqa', $3)`,
        [A.id, P('haydovchi'), P('admin')])
      const today = await scalar<string>(tx, `select (now() at time zone 'Asia/Tashkent')::date::text`)
      const dash = await scalar<Row>(tx, `select public.dashboard_summary($1::date, $1::date)`, [today])
      const own = await asOwn(tx)
      return { bal, lock, bad, dash, own }
    })
    expect(r.bal).toEqual({ issued_total: '1000000.00', returned_total: '100000.00', spent_total: '600000.00', balance: '300000.00' })
    expect(r.lock).toBe('P0001:cash_amount_locked')
    expect(r.bad).toBe('23514:')
    expect(r.dash).toMatchObject({ cash_issued_sum: '1500000.00', cash_returned_sum: '100000.00' })
    expect(r.own).toEqual([{ profile_id: P('haydovchi'), balance: '300000.00' }])
  })

  it('P2-6: nofaol yoki roli o`zgargan odamdan qaytarish qabul qilinadi; berish — cash_recipient_role', async () => {
    const r = await as('admin', async (tx) => {
      await sys(tx, () => tx.query(`update public.profiles set is_active = false where id = $1`, [P('haydovchi')]))
      await sys(tx, () => tx.query(`update public.profiles set role = 'omborchi' where id = $1`, [P('prorab')]))
      const ins = (who: string, kind: string): Promise<string> =>
        res(tx, `insert into public.cash_advances (company_id, recipient_id, amount, kind, created_by) values ($1, $2, 1000, $3, $4)`,
          [A.id, who, kind, P('admin')])
      return {
        retInactive: await ins(P('haydovchi'), 'qaytarildi'),
        retRole: await ins(P('prorab'), 'qaytarildi'),
        giveInactive: await ins(P('haydovchi'), 'berildi'),
        giveRole: await ins(P('prorab'), 'berildi'),
      }
    })
    expect(r).toEqual({
      retInactive: 'OK:1',
      retRole: 'OK:1',
      giveInactive: 'P0001:cash_recipient_role',
      giveRole: 'P0001:cash_recipient_role',
    })
  })

  /** Haydovchi o'zi — faqat o'z qatori. */
  async function asOwn(tx: Tx): Promise<Row[]> {
    await tx.query(`select set_config('request.jwt.claim.sub', $1, true)`, [A.users.haydovchi.authUid])
    const r = await rows(tx, `select profile_id, balance::text from public.cash_balances`)
    await tx.query(`select set_config('request.jwt.claim.sub', $1, true)`, [A.users.admin.authUid])
    return r
  }

  it('FIFO: sarf + qaytarish eng eski berilganni yopadi; oldest_open_at', async () => {
    const r = await as('admin', async (tx) => {
      // haydovchi: 1 000 000 (20 kun oldin), 500 000 (2 kun oldin); sarf 600 000
      await raw(tx, `update public.cash_advances set issued_at = now() - interval '20 days' where id = $1`, [A.ids.ca_haydovchi])
      const c2 = await scalar<string>(tx, `insert into public.cash_advances (company_id, recipient_id, amount, issued_at, created_by)
        values ($1, $2, 500000, now() - interval '2 days', $3) returning id`, [A.id, P('haydovchi'), P('admin')])
      const pos = (): Promise<Row> =>
        sys(tx, () => one(tx, `select balance::text, (oldest_open_at = (select issued_at from public.cash_advances where id = $3)) as first,
                                 (oldest_open_at = (select issued_at from public.cash_advances where id = $4)) as second
                            from private.cash_position($1, $2)`, [A.id, P('haydovchi'), A.ids.ca_haydovchi, c2]))
      const p1 = await pos()
      await purchase(tx, P('admin'), { obj: A.ids.obj2!, qty: '1', total: '300000', buyer: P('haydovchi') })
      await tx.query(`insert into public.cash_advances (company_id, recipient_id, amount, kind, created_by) values ($1, $2, 100000, 'qaytarildi', $3)`,
        [A.id, P('haydovchi'), P('admin')])
      const p2 = await pos()
      return { p1, p2 }
    })
    expect(r.p1).toEqual({ balance: '900000.00', first: true, second: false })
    // sarf 900 000 + qaytarish 100 000 = 1 000 000 → birinchisi to'liq yopildi
    expect(r.p2).toEqual({ balance: '500000.00', first: false, second: true })
  })

  it('cron: muddati (> cash_max_days, 14 kun — yo`q) va manfiy balans; takroriy — yangi alert yo`q; to`lansa — yopiladi', async () => {
    const r = await as('admin', async (tx) => {
      const run = (): Promise<number> => sys(tx, () => scalar<number>(tx, `select private.evaluate_cash_advances()`))
      await raw(tx, `update public.cash_advances set issued_at = now() - interval '14 days' where id = $1`, [A.ids.ca_haydovchi])
      const n14 = await run()
      const at14 = await alertsOf(tx, 'podotchet_muddati')
      await raw(tx, `update public.cash_advances set issued_at = now() - interval '15 days' where id = $1`, [A.ids.ca_haydovchi])
      const n15 = await run()
      const due = await alertsOf(tx, 'podotchet_muddati')
      const neg = await alertsOf(tx, 'podotchet_manfiy')
      const again = await run()
      const ob = await outboxOf(tx, due[0]!.id)
      await tx.query(`insert into public.cash_advances (company_id, recipient_id, amount, kind, created_by) values ($1, $2, 400000, 'qaytarildi', $3)`,
        [A.id, P('haydovchi'), P('admin')])
      await run()
      const closed = await alertsOf(tx, 'podotchet_muddati')
      return { n14, at14, n15, due, neg, again, ob, closed }
    })
    expect(r.at14).toEqual([])
    expect(r.due).toHaveLength(1)
    expect(r.due[0]).toMatchObject({ severity: 'ogohlantirish', object_id: null })
    expect(r.due[0]!.details).toMatchObject({
      profile_id: P('haydovchi'), profile_name: 'A haydovchi', balance: 400000, days_open: 15, max_days: 14,
    })
    // taminotchi (−600 000) va prorab (500 000 − 600 000) — manfiy
    expect(r.neg.map((a) => [a.severity, a.details.profile_id, a.details.balance]).sort()).toEqual(
      [['belgi', P('prorab'), -100000], ['belgi', P('taminotchi'), -600000]].sort(),
    )
    expect(r.n14).toBe(4) // A va B: taminotchi, prorab (cron barcha firmalar bo'yicha)
    expect(r.n15).toBe(1)
    expect(r.again).toBe(0)
    expect(r.ob).toHaveLength(1)
    expect(r.closed[0]).toMatchObject({ status: 'yopildi' })
  })

  it('haftalik cash_statement: faqat Telegram bog`langan egasiga; payload; takroriy — 0', async () => {
    const r = await as('admin', async (tx) => {
      return sys(tx, async () => {
        await tx.query(`update public.profiles set telegram_chat_id = 2001 where id = $1`, [P('haydovchi')])
        await tx.query(`update public.profiles set telegram_chat_id = 2002 where id = $1`, [P('admin')])
        const d = await scalar<string>(tx, `select ((now() at time zone 'Asia/Tashkent')::date + 1)::text`)
        const n1 = await scalar<number>(tx, `select private.enqueue_cash_statements($1::date)`, [d])
        const n2 = await scalar<number>(tx, `select private.enqueue_cash_statements($1::date)`, [d])
        const ob = await rows<{ id: string; profile_id: string; payload: Row }>(
          tx, `select id, profile_id, payload from public.notification_outbox where kind = 'cash_statement' and company_id = $1`, [A.id])
        const rec = await rows(tx, `select chat_id::int, role from public.svc_outbox_recipients($1)`, [ob[0]!.id])
        return { d, n1, n2, ob, rec }
      })
    })
    expect(r.n1).toBe(1)
    expect(r.n2).toBe(0)
    expect(r.ob).toHaveLength(1)
    expect(r.ob[0]!.profile_id).toBe(P('haydovchi'))
    expect(r.ob[0]!.payload).toMatchObject({
      date: r.d,
      profile_name: 'A haydovchi',
      company_name: 'A',
      issued_week: '1000000.00',
      spent_week: '600000.00',
      returned_week: '0.00',
      issued_total: '1000000.00',
      returned_total: '0.00',
      spent_total: '600000.00',
      balance: '400000.00',
      days_open: 1,
    })
    expect(r.rec).toEqual([{ chat_id: 2001, role: 'haydovchi' }])
  })
})

// ============================================================================
// J. Eslatmalar, qabul qiluvchilar, svc_mark_alert_seen
// ============================================================================
describe('J: eslatma va Telegram tugmasi', () => {
  it('48 soatdan eski yangi alert — bir marta alert_reminder (reminded_at); belgi, 47 soat, korildi — yo`q', async () => {
    const r = await as('admin', async (tx) => {
      return sys(tx, async () => {
        const mk = async (sev: string, hours: number, status = 'yangi'): Promise<string> => {
          const id = await scalar<string>(tx, `insert into public.alerts (company_id, type, severity, status, object_id, material_id, details)
            values ($1, 'narx_ogishi', $2::public.alert_severity, $3::public.alert_status, $4, $5, '{"x":1}') returning id`,
            [A.id, sev, status, A.ids.obj1, A.ids.m1])
          await raw(tx, `update public.alerts set created_at = now() - make_interval(hours => $2) where id = $1`, [id, hours])
          await tx.exec('reset role')
          return id
        }
        const old = await mk('ogohlantirish', 49)
        await mk('belgi', 49)
        await mk('ogohlantirish', 47)
        await mk('ogohlantirish', 49, 'korildi')
        const n1 = await scalar<number>(tx, `select private.enqueue_alert_reminders()`)
        const n2 = await scalar<number>(tx, `select private.enqueue_alert_reminders()`)
        const ob = await rows<{ kind: string; alert_id: string; payload: Row }>(
          tx, `select kind, alert_id, payload from public.notification_outbox where kind = 'alert_reminder'`)
        const det = await scalar<Row>(tx, `select details from public.alerts where id = $1`, [old])
        return { old, n1, n2, ob, det }
      })
    })
    expect(r.n1).toBe(1)
    expect(r.n2).toBe(0)
    expect(r.ob).toHaveLength(1)
    expect(r.ob[0]!.alert_id).toBe(r.old)
    expect(r.ob[0]!.payload).toMatchObject({
      alert_id: r.old, type: 'narx_ogishi', severity: 'ogohlantirish', status: 'yangi',
      object_name: 'A obj1', material_name: 'A sement', base_unit: 'kg', hours_open: 49,
    })
    expect(r.det).toHaveProperty('reminded_at')
    expect((r.ob[0]!.payload.details as Row).x).toBe(1)
  })

  it('qabul qilinmagan o`tkazma alerti: direktor/admin + jo`natuvchi va qabul qiluvchi obyekt prorablari', async () => {
    const r = await as('admin', async (tx) => {
      return sys(tx, async () => {
        // obj2 ga ikkinchi prorab
        const pr2 = await scalar<string>(tx, `insert into public.profiles (company_id, role, full_name, phone, telegram_chat_id)
          values ($1, 'prorab', 'Prorab 2', '+998901112233', 3005) returning id`, [A.id])
        await tx.query(`insert into public.object_members (company_id, object_id, profile_id) values ($1, $2, $3)`, [A.id, A.ids.obj2, pr2])
        await tx.query(`update public.profiles set telegram_chat_id = 3001 where id = $1`, [P('prorab')])
        await tx.query(`update public.profiles set telegram_chat_id = 3002 where id = $1`, [P('direktor')])
        await tx.query(`update public.profiles set telegram_chat_id = 3003 where id = $1`, [P('omborchi')])
        await raw(tx, `update public.transfers set created_at = now() - interval '49 hours' where id = $1`, [A.ids.tr_1to2])
        await tx.exec('reset role')
        await tx.query(`select private.evaluate_due_transfers()`)
        const ob = await one<{ id: string }>(tx, `select o.id from public.notification_outbox o
          join public.alerts a on a.id = o.alert_id where o.kind = 'alert' and a.details ->> 'transfer_id' = $1`, [A.ids.tr_1to2])
        // oddiy alert — prorablarsiz
        const plain = await one<{ id: string }>(tx, `select o.id from public.notification_outbox o where o.kind = 'alert' and o.id <> $1 limit 1`, [ob.id])
          .catch(async () => {
            await tx.query(`insert into public.alerts (company_id, type, severity, details) values ($1, 'narx_ogishi', 'ogohlantirish', '{}')`, [A.id])
            return one<{ id: string }>(tx, `select o.id from public.notification_outbox o where o.kind = 'alert' and o.id <> $1 limit 1`, [ob.id])
          })
        return {
          rec: await rows(tx, `select chat_id::int, role from public.svc_outbox_recipients($1) order by chat_id`, [ob.id]),
          plain: await rows(tx, `select chat_id::int, role from public.svc_outbox_recipients($1) order by chat_id`, [plain.id]),
        }
      })
    })
    expect(r.rec).toEqual([
      { chat_id: 3001, role: 'prorab' },
      { chat_id: 3002, role: 'direktor' },
      { chat_id: 3005, role: 'prorab' },
    ])
    expect(r.plain).toEqual([{ chat_id: 3002, role: 'direktor' }])
  })

  it('svc_mark_alert_seen: admin — ism, korildi, idempotent; direktor / begona firma / noma`lum tg — alert_action_forbidden; yo`q alert — alert_not_found', async () => {
    const r = await as('admin', async (tx) => {
      return sys(tx, async () => {
        await tx.query(`update public.profiles set telegram_user_id = 9001 where id = $1`, [P('admin')])
        await tx.query(`update public.profiles set telegram_user_id = 9002 where id = $1`, [P('direktor')])
        await tx.query(`update public.profiles set telegram_user_id = 9003 where id = $1`, [P('admin', B)])
        await tx.exec('set local role service_role')
        const call = (tg: number, id: string): Promise<{ key: string; msg: string }> =>
          resFull(tx, `select public.svc_mark_alert_seen($1, $2) as name`, [tg, id])
        const ok = await scalar<string>(tx, `select public.svc_mark_alert_seen(9001, $1)`, [A.ids.alert1])
        const again = await scalar<string>(tx, `select public.svc_mark_alert_seen(9001, $1)`, [A.ids.alert1])
        const dir = await call(9002, A.ids.alert1!)
        const foreign = await call(9003, A.ids.alert1!)
        const unknown = await call(1, A.ids.alert1!)
        const missing = await call(9001, randomUUID())
        await tx.exec('reset role')
        const a = await one(tx, `select status::text, details ->> 'seen_by_name' as by, details ->> 'seen_via' as via from public.alerts where id = $1`, [A.ids.alert1])
        return { ok, again, dir: dir.key, foreign: foreign.key, unknown: unknown.key, missing: missing.key, a }
      })
    })
    expect(r).toEqual({
      ok: 'A admin',
      again: 'A admin',
      dir: '42501:alert_action_forbidden',
      foreign: '42501:alert_action_forbidden',
      unknown: '42501:alert_action_forbidden',
      missing: 'P0002:alert_not_found',
      a: { status: 'korildi', by: 'A admin', via: 'telegram' },
    })
  })

  it('authenticated svc_mark_alert_seen ni chaqira olmaydi', async () => {
    expect(await as('admin', (tx) => res(tx, `select public.svc_mark_alert_seen(1, $1)`, [A.ids.alert1]))).toBe('42501:')
  })
})

// ============================================================================
// K. Prognoz
// ============================================================================
describe('K: stock_forecast va low_stock_count', () => {
  it('admin obj1: qoldiq, o`rtacha (faqat chiqim, 14 kun), days_left, boshqa obyekt, smeta qoldig`i', async () => {
    const r = await as('admin', async (tx) => {
      await mv(tx, 'chiqim', A.ids.obj1!, '14')
      await mv(tx, 'chiqim', A.ids.obj1!, '28', { at: new Date(Date.now() - 20 * 86400_000).toISOString() }) // oynadan tashqari
      await tx.query(`select public.create_transfer($1, $2, $3, $4, $5, 0.2, null)`, [randomUUID(), A.ids.obj1, A.ids.obj3, A.ids.m1, qopId]) // 10 kg, o'rtachaga kirmaydi
      const f = await rows(tx, `select material_id, material_name, base_unit, stock_qty_base::text, avg_daily_qty_base::text, days_left::text,
                                       other_objects_qty_base::text, estimate_remaining_qty_base::text
                                  from public.stock_forecast($1)`, [A.ids.obj1])
      const nu = await scalar<string>(tx, `select remaining_qty_base::text from public.norm_usage where object_id = $1 and material_id = $2`, [A.ids.obj1, A.ids.m1])
      return { f, nu }
    })
    expect(r.f).toEqual([
      {
        material_id: A.ids.m1,
        material_name: 'A sement',
        base_unit: 'kg',
        stock_qty_base: '48.000000',
        avg_daily_qty_base: '1.000000',
        days_left: '48.0',
        other_objects_qty_base: '40.000000', // obj2 40 (obj3 ga o'tkazma hali qabul qilinmagan)
        estimate_remaining_qty_base: r.nu,
      },
    ])
  })

  it('days_left: avg 0 → null (stock ≤ 0 bo`lsa ham); stock ≤ 0 va avg > 0 → 0', async () => {
    const r = await as('admin', async (tx) => {
      await mv(tx, 'chiqim', A.ids.obj3!, '5', { mat: A.ids.m2, at: new Date(Date.now() - 20 * 86400_000).toISOString() }) // −5, o'rtacha 0
      await mv(tx, 'chiqim', A.ids.obj3!, '7') // m1: −7, o'rtacha 0.5
      return rows(tx, `select material_id, stock_qty_base::text, avg_daily_qty_base::text, days_left::text from public.stock_forecast($1) order by material_id`, [A.ids.obj3])
    })
    expect(r.sort((a, b) => String(a.material_id).localeCompare(String(b.material_id)))).toEqual(
      [
        { material_id: A.ids.m1, stock_qty_base: '-7.000000', avg_daily_qty_base: '0.500000', days_left: '0' },
        { material_id: A.ids.m2, stock_qty_base: '-5.000000', avg_daily_qty_base: '0.000000', days_left: null },
      ].sort((a, b) => a.material_id!.localeCompare(b.material_id!)),
    )
  })

  it('low_stock_count: days_left <= forecast_days_warn (teng — kiradi) — stock_forecast bilan bir xil; kunlik hisobotda', async () => {
    const r = await as('admin', async (tx) => {
      await mv(tx, 'chiqim', A.ids.obj1!, '70') // 30 kg qoldi, o'rtacha 5 → 6.0 kun
      const fc = await scalar<string>(tx, `select days_left::text from public.stock_forecast($1) where material_id = $2`, [A.ids.obj1, A.ids.m1])
      return sys(tx, async () => {
        const c3 = await scalar<number>(tx, `select private.low_stock_count($1)`, [A.id])
        await tx.query(`update public.companies set forecast_days_warn = 6 where id = $1`, [A.id])
        const c6 = await scalar<number>(tx, `select private.low_stock_count($1)`, [A.id])
        const st = await scalar<Row>(tx, `select private.daily_report_stats($1, now() - interval '1 day', now())`, [A.id])
        return { fc, c3, c6, low: st.low_stock_count }
      })
    })
    expect(r).toEqual({ fc: '6.0', c3: 0, c6: 1, low: 1 })
  })

  it('RLS: prorab — boshqa obyektlar ko`rinmaydi (0); haydovchi — bo`sh; boshqa firma obyekti — bo`sh', async () => {
    const prorab = await as('prorab', (tx) =>
      rows(tx, `select other_objects_qty_base::text from public.stock_forecast($1) where material_id = $2`, [A.ids.obj1, A.ids.m1]),
    )
    expect(prorab).toEqual([{ other_objects_qty_base: '0.000000' }])
    expect(await as('haydovchi', (tx) => rows(tx, `select * from public.stock_forecast($1)`, [A.ids.obj1]))).toEqual([])
    expect(await as('admin', (tx) => rows(tx, `select * from public.stock_forecast($1)`, [A.ids.obj1]), B)).toEqual([])
  })
})

// ============================================================================
// Firma izolyatsiyasi
// ============================================================================
describe('firma izolyatsiyasi', () => {
  it('A dagi hodisalar B alertlariga ta`sir qilmaydi; B admin A alertlarini ko`rmaydi', async () => {
    const r = await as('admin', async (tx) => {
      await mv(tx, 'chiqim', A.ids.obj3!, '10') // manfiy + smetasiz (A)
      const bAlerts = await sys(tx, () =>
        scalar<number>(tx, `select count(*)::int from public.alerts where company_id = $1 and type::text in ('manfiy_qoldiq','smetasiz_chiqim')`, [B.id]),
      )
      await tx.query(`select set_config('request.jwt.claim.sub', $1, true)`, [B.users.admin.authUid])
      const seen = await scalar<number>(tx, `select count(*)::int from public.alerts where company_id = $1`, [A.id])
      return { bAlerts, seen }
    })
    expect(r).toEqual({ bAlerts: 0, seen: 0 })
  })

  it('create_transfer boshqa firma obyektidan — transfer_object_not_found (qoldiq tekshiruvidan oldin)', async () => {
    const r = await as('admin', (tx) =>
      res(tx, `select public.create_transfer($1, $2, $3, $4, $5, 1000, null)`, [randomUUID(), B.ids.obj1, B.ids.obj2, B.ids.m1, B.ids.u1]),
    )
    expect(r).toBe('P0002:transfer_object_not_found')
  })
})
