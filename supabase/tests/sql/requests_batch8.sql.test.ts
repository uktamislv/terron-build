// Batch 8 — 20261101000001_requests.sql: norm_usage, qoida 4 (normadan_oshish),
// qoida 6 (smetadan_ortiq_sorov), so'rovlar (decision_note, purchase_id), o'tkazma
// RPC'lari (otkazma_farqi), inventarizatsiya (qty_counted bazada, qoida 5, tuzatish).
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

/** `OK:<qatorlar>` yoki `<errcode>:<hint>` (savepoint bilan — tx davom etadi). */
async function res(tx: Queryable, sql: string, params: unknown[] = []): Promise<string> {
  await tx.exec('savepoint b8_try')
  try {
    const r = await tx.query(sql, params)
    await tx.exec('release savepoint b8_try')
    return `OK:${r.affectedRows || r.rows.length}`
  } catch (e) {
    await tx.exec('rollback to savepoint b8_try')
    const err = e as { code?: string; hint?: string }
    return `${err.code ?? '?'}:${err.hint ?? ''}`
  }
}

/** Shu tranzaksiya ichida tizim (postgres) sifatida — RLS'siz o'qish/yozish. */
async function sys<T>(tx: Tx, fn: () => Promise<T>): Promise<T> {
  await tx.exec('reset role')
  try {
    return await fn()
  } finally {
    await tx.exec('set local role authenticated')
  }
}

/** Shu tranzaksiya ichida vaqtincha boshqa foydalanuvchi (auth.uid) nomidan. */
async function asAuth<T>(tx: Tx, authUid: string, fn: () => Promise<T>): Promise<T> {
  const prev = await scalar<string>(tx, `select current_setting('request.jwt.claim.sub', true)`)
  await tx.query(`select set_config('request.jwt.claim.sub', $1, true)`, [authUid])
  try {
    return await fn()
  } finally {
    await tx.query(`select set_config('request.jwt.claim.sub', $1, true)`, [prev])
  }
}

const as = <T>(role: keyof CompanyFixture['users'], fn: (tx: Tx) => Promise<T>): Promise<T> =>
  asUser(db, A.users[role].authUid, fn)

async function chiqim(tx: Queryable, obj: string, qtyKg: string, mat = A.ids.m1!, unit = kgId): Promise<string> {
  return scalar<string>(
    tx,
    `insert into public.movements (company_id, type, object_id, material_id, unit_id, qty_input, unit_input, qty_base)
     values ($1, 'chiqim', $2, $3, $4, $5, '-', 0) returning id`,
    [A.id, obj, mat, unit, qtyKg],
  )
}

async function kirim(tx: Queryable, obj: string, qty: string, mat = A.ids.m1!, unit = kgId): Promise<string> {
  return scalar<string>(
    tx,
    `insert into public.movements (company_id, type, object_id, material_id, unit_id, qty_input, unit_input, qty_base)
     values ($1, 'kirim', $2, $3, $4, $5, '-', 0) returning id`,
    [A.id, obj, mat, unit, qty],
  )
}

interface AlertRow {
  id: string
  status: string
  severity: string
  details: Row
  request_id: string | null
  object_id: string | null
  material_id: string | null
  movement_id: string | null
}

const alertsOf = (tx: Queryable, type: string, where = 'true', params: unknown[] = []): Promise<AlertRow[]> =>
  rows<AlertRow>(
    tx,
    `select id, status::text, severity::text, details, request_id, object_id, material_id, movement_id
       from public.alerts where company_id = '${A.id}' and type::text = '${type}' and (${where})
      order by (select min(l.id) from public.audit_log l where l.record_id = alerts.id), id`,
    params,
  )

const stock = (tx: Queryable, obj: string, mat = A.ids.m1!): Promise<string> =>
  scalar<string>(
    tx,
    `select coalesce((select qty_base from public.stock_balances where object_id = $1 and material_id = $2), 0)::numeric(20,6)::text`,
    [obj, mat],
  )

const setWaste = (tx: Queryable, pct: string): Promise<unknown> =>
  tx.query(`update public.materials set waste_pct = $2 where id = $1`, [A.ids.m1, pct])

// ============================================================================
// norm_usage
// ============================================================================
describe('norm_usage', () => {
  it('ustunlar: norma, isrof bilan, sarf, ochiq so`rovlar, qolgan, % (obj1, m1)', async () => {
    const r = await as('admin', async (tx) => {
      await setWaste(tx, '5')
      await chiqim(tx, A.ids.obj1!, '210')
      return one(
        tx,
        `select estimate_id, norm_qty_base::text, allowed_qty_base::text, consumed_qty_base::text,
                requested_open_qty_base::text, remaining_qty_base::text, usage_pct::text
           from public.norm_usage where object_id = $1 and material_id = $2`,
        [A.ids.obj1, A.ids.m1],
      )
    })
    expect(r).toEqual({
      estimate_id: A.ids.est_obj1,
      norm_qty_base: '1000.000000',
      allowed_qty_base: '1050.000000',
      consumed_qty_base: '210.000000',
      requested_open_qty_base: '100.000000', // mr_obj1 (2 qop, kutilmoqda)
      remaining_qty_base: '840.000000',
      usage_pct: '20.0',
    })
  })

  it('smetada yo`q, lekin sarfi bor material — norm 0, usage_pct null; smetasiz obyekt (obj3) — qator yo`q', async () => {
    const r = await as('admin', async (tx) => {
      await chiqim(tx, A.ids.obj1!, '2', A.ids.m2!, m2Id)
      await chiqim(tx, A.ids.obj3!, '2')
      return {
        m2: await one(
          tx,
          `select norm_qty_base::text, allowed_qty_base::text, consumed_qty_base::text, remaining_qty_base::text, usage_pct
             from public.norm_usage where object_id = $1 and material_id = $2`,
          [A.ids.obj1, A.ids.m2],
        ),
        obj3: await scalar<number>(tx, `select count(*)::int from public.norm_usage where object_id = $1`, [A.ids.obj3]),
      }
    })
    expect(r).toEqual({
      m2: { norm_qty_base: '0.000000', allowed_qty_base: '0.000000', consumed_qty_base: '2.000000', remaining_qty_base: '-2.000000', usage_pct: null },
      obj3: 0,
    })
  })

  it('RLS: prorab — a`zo obyekt (obj1); omborchi, haydovchi — hech narsa; boshqa firma — ko`rinmaydi', async () => {
    const count = (role: 'prorab' | 'omborchi' | 'haydovchi' | 'direktor'): Promise<Row[]> =>
      as(role, (tx) =>
        rows(tx, `select object_id, company_id from public.norm_usage order by object_id`),
      )
    const pr = await count('prorab')
    expect(pr.map((x) => x.object_id)).toEqual([A.ids.obj1])
    expect(await count('omborchi')).toEqual([])
    expect(await count('haydovchi')).toEqual([])
    const dir = await count('direktor')
    expect(new Set(dir.map((x) => x.company_id))).toEqual(new Set([A.id]))
    expect(dir.map((x) => x.object_id).sort()).toEqual([A.ids.obj1, A.ids.obj2].sort())
  })

  it('anon — ruxsat yo`q', async () => {
    const r = await scalar<boolean>(db, `select has_table_privilege('anon', 'public.norm_usage', 'select')`)
    expect(r).toBe(false)
  })
})

// ============================================================================
// Qoida 4 — normadan_oshish
// ============================================================================
describe('qoida 4: normadan oshish', () => {
  it('chegara: 1050 (isrof 5%) — yo`q; 1051 — ogohlantirish, details aniq', async () => {
    const r = await as('admin', async (tx) => {
      await setWaste(tx, '5')
      await chiqim(tx, A.ids.obj1!, '1050')
      const before = (await alertsOf(tx, 'normadan_oshish')).length
      await chiqim(tx, A.ids.obj1!, '1')
      const a = await alertsOf(tx, 'normadan_oshish')
      return { before, a }
    })
    expect(r.before).toBe(0)
    expect(r.a).toHaveLength(1)
    expect(r.a[0]).toMatchObject({ status: 'yangi', severity: 'ogohlantirish', object_id: A.ids.obj1, material_id: A.ids.m1 })
    expect(r.a[0]!.details).toEqual({
      norm_qty_base: 1000.0,
      allowed_qty_base: 1050.0,
      consumed_qty_base: 1051.0,
      over_pct: 0.1,
      waste_pct: 5.0,
      estimate_id: A.ids.est_obj1,
      estimate_version: 1,
      not_in_estimate: false,
      base_unit: 'kg',
    })
  })

  it('over_pct 24.99 → ogohlantirish; 25.00 → jiddiy; bitta ochiq alert yangilanadi', async () => {
    const r = await as('admin', async (tx) => {
      // allowed = 1000; 1249.9 → 24.99 %
      const mv = await chiqim(tx, A.ids.obj1!, '1249.9')
      const a1 = await alertsOf(tx, 'normadan_oshish')
      await tx.query(`update public.movements set qty_input = 1250 where id = $1`, [mv])
      const a2 = await alertsOf(tx, 'normadan_oshish')
      return { a1: a1.map((a) => [a.severity, a.details.over_pct]), a2: a2.map((a) => [a.id === a1[0]!.id, a.severity, a.details.over_pct]) }
    })
    expect(r).toEqual({ a1: [['ogohlantirish', 24.99]], a2: [[true, 'jiddiy', 25.0]] })
  })

  it('chiqim o`chirilsa → avtomatik yopiladi (within_threshold); tiklansa — yangi alert', async () => {
    const r = await as('admin', async (tx) => {
      const mv = await chiqim(tx, A.ids.obj1!, '1200')
      await tx.query(`update public.movements set deleted_at = now() where id = $1`, [mv])
      const closed = await alertsOf(tx, 'normadan_oshish')
      await tx.query(`update public.movements set deleted_at = null where id = $1`, [mv])
      const after = await alertsOf(tx, 'normadan_oshish')
      return {
        closed: closed.map((a) => [a.status, a.details.closed_reason, a.details.auto_closed]),
        after: after.map((a) => a.status),
      }
    })
    expect(r).toEqual({ closed: [['yopildi', 'within_threshold', true]], after: ['yopildi', 'yangi'] })
  })

  it('material smetada yo`q → not_in_estimate (ogohlantirish); smetasiz obyekt — alert yo`q', async () => {
    const r = await as('admin', async (tx) => {
      await chiqim(tx, A.ids.obj1!, '3', A.ids.m2!, m2Id)
      await chiqim(tx, A.ids.obj3!, '5000')
      return alertsOf(tx, 'normadan_oshish')
    })
    expect(r).toHaveLength(1)
    expect(r[0]).toMatchObject({ severity: 'ogohlantirish', object_id: A.ids.obj1, material_id: A.ids.m2 })
    expect(r[0]!.details).toMatchObject({ not_in_estimate: true, norm_qty_base: 0, allowed_qty_base: 0, consumed_qty_base: 3, over_pct: null, base_unit: 'm³' })
  })

  it('raqamlar o`zgarmasa — alert yangilanmaydi (audit yo`q)', async () => {
    const r = await as('admin', async (tx) => {
      await chiqim(tx, A.ids.obj1!, '1100')
      const [a] = await alertsOf(tx, 'normadan_oshish')
      const n0 = await sys(tx, () => scalar<number>(tx, `select count(*)::int from public.audit_log where record_id = $1`, [a!.id]))
      await sys(tx, () => tx.query(`select private.evaluate_norm($1, $2, $3)`, [A.id, A.ids.obj1, A.ids.m1]))
      // chiqim bo'lmagan harakat — qoida 4 ishlamaydi
      await kirim(tx, A.ids.obj1!, '5')
      const n1 = await sys(tx, () => scalar<number>(tx, `select count(*)::int from public.audit_log where record_id = $1`, [a!.id]))
      return [n0, n1]
    })
    expect(r[0]).toBe(r[1])
  })

  it('qo`lda yopilgan alert bir xil raqamlarda qayta yaratilmaydi; sarf o`zgarsa — yangi', async () => {
    const r = await as('admin', async (tx) => {
      await chiqim(tx, A.ids.obj1!, '1100')
      await tx.query(`update public.alerts set status = 'yopildi', close_note = 'Tekshirildi' where type = 'normadan_oshish'`)
      await sys(tx, () => tx.query(`select private.evaluate_norm($1, $2, $3)`, [A.id, A.ids.obj1, A.ids.m1]))
      const same = (await alertsOf(tx, 'normadan_oshish')).map((a) => a.status)
      await chiqim(tx, A.ids.obj1!, '1')
      const next = (await alertsOf(tx, 'normadan_oshish')).map((a) => a.status)
      return { same, next }
    })
    expect(r).toEqual({ same: ['yopildi'], next: ['yopildi', 'yangi'] })
  })

  it('yangi smeta versiyasi (import_estimate): normasi oshsa — eski alert yopiladi (estimate_changed); kamaysa — yangi versiya bo`yicha alert', async () => {
    const imp = (tx: Queryable, qty: string): Promise<string> =>
      scalar<string>(tx, `select public.import_estimate($1, $2, 'V', null, null, $3::jsonb)`, [
        randomUUID(),
        A.ids.obj1,
        JSON.stringify([{ item_type: 'material', name: 'Sement', material_id: A.ids.m1, unit_id: kgId, qty }]),
      ])
    const r = await as('admin', async (tx) => {
      await chiqim(tx, A.ids.obj1!, '1100')
      const v2 = await imp(tx, '2000')
      const afterUp = (await alertsOf(tx, 'normadan_oshish')).map((a) => [a.status, a.details.closed_reason ?? null])
      const v3 = await imp(tx, '500')
      const afterDown = await alertsOf(tx, 'normadan_oshish', `status = 'yangi'`)
      return { v2, v3, afterUp, afterDown }
    })
    expect(r.afterUp).toEqual([['yopildi', 'estimate_changed']])
    expect(r.afterDown).toHaveLength(1)
    expect(r.afterDown[0]!.details).toMatchObject({ estimate_id: r.v3, estimate_version: 3, allowed_qty_base: 500, consumed_qty_base: 1100, over_pct: 120.0 })
    expect(r.afterDown[0]!.severity).toBe('jiddiy')
  })

  it('set_current_estimate (eski versiya) va joriy smeta o`chirilishi — qayta baholanadi', async () => {
    const r = await as('admin', async (tx) => {
      const v2 = await scalar<string>(tx, `select public.import_estimate($1, $2, 'V2', null, null, $3::jsonb)`, [
        randomUUID(),
        A.ids.obj1,
        JSON.stringify([{ item_type: 'material', name: 'Sement', material_id: A.ids.m1, unit_id: kgId, qty: '5000' }]),
      ])
      await chiqim(tx, A.ids.obj1!, '1100') // v2: 5000 — ok
      const okV2 = (await alertsOf(tx, 'normadan_oshish')).length
      await tx.query(`select public.set_current_estimate($1)`, [A.ids.est_obj1]) // v1: 1000 — oshgan
      const v1open = (await alertsOf(tx, 'normadan_oshish', `status = 'yangi'`)).map((a) => a.details.estimate_id)
      // joriy (v1) o'chirildi → joriy smeta yo'q → yopiladi
      await tx.query(`update public.estimates set deleted_at = now() where id = $1`, [A.ids.est_obj1])
      const noEst = (await alertsOf(tx, 'normadan_oshish')).map((a) => [a.status, a.details.closed_reason ?? null])
      return { v2, okV2, v1open, noEst }
    })
    expect(r.okV2).toBe(0)
    expect(r.v1open).toEqual([A.ids.est_obj1])
    expect(r.noEst).toEqual([['yopildi', 'no_current_estimate']])
  })

  it('smeta qatori o`chirilsa (joriy smeta) — norma 0 → not_in_estimate', async () => {
    const r = await as('admin', async (tx) => {
      await chiqim(tx, A.ids.obj1!, '10')
      await tx.query(`update public.estimate_items set deleted_at = now() where id = $1`, [A.ids.ei_obj1])
      return alertsOf(tx, 'normadan_oshish')
    })
    expect(r.map((a) => [a.status, a.details.not_in_estimate])).toEqual([['yangi', true]])
  })

  it('prorab chiqimi ham baholanadi (alert tizim nomidan; audit D3: prorab o`z obyektining sayt alertlarini ko`radi)', async () => {
    const r = await as('prorab', async (tx) => {
      await chiqim(tx, A.ids.obj1!, '1500')
      const visible = await scalar<string[]>(tx, `select coalesce(array_agg(distinct type::text order by type::text), '{}') from public.alerts`)
      const all = await sys(tx, () => alertsOf(tx, 'normadan_oshish'))
      return { visible, all: all.length }
    })
    expect(r).toEqual({ visible: ['manfiy_qoldiq', 'normadan_oshish'], all: 1 })
  })
})

// ============================================================================
// Qoida 6 — smetadan_ortiq_sorov
// ============================================================================
describe('qoida 6: smetadan ortiq so`rov', () => {
  const request = (tx: Queryable, obj: string, qty: string, unit = kgId): Promise<string> =>
    scalar<string>(
      tx,
      `insert into public.material_requests (company_id, object_id, material_id, unit_id, qty_input, unit_input, qty_base)
       values ($1, $2, $3, $4, $5, '-', 0) returning id`,
      [A.id, obj, A.ids.m1, unit, qty],
    )

  it('chegara (Y5): available = 1000 − max(sarf 0, yetkazilgan 100) − 100 (mr_obj1) = 800; 800 — yo`q, 801 — alert', async () => {
    const r = await as('prorab', async (tx) => {
      const ok = await request(tx, A.ids.obj1!, '800')
      return sys(tx, async () => ({ first: (await alertsOf(tx, 'smetadan_ortiq_sorov', `request_id = $1`, [ok])).length }))
    })
    expect(r.first).toBe(0)

    const r2 = await as('prorab', async (tx) => {
      const id = await request(tx, A.ids.obj1!, '801')
      return sys(tx, () => alertsOf(tx, 'smetadan_ortiq_sorov', `request_id = $1`, [id]))
    })
    expect(r2).toHaveLength(1)
    expect(r2[0]).toMatchObject({ severity: 'ogohlantirish', status: 'yangi', object_id: A.ids.obj1, material_id: A.ids.m1 })
    expect(r2[0]!.details).toEqual({
      requested_qty_base: 801,
      allowed_qty_base: 1000,
      consumed_qty_base: 0,
      delivered_qty_base: 100, // mv_obj1 kirim
      other_open_qty_base: 100,
      available_qty_base: 800,
      over_qty_base: 1,
      estimate_version: 1,
      not_in_estimate: false,
      base_unit: 'kg',
    })
  })

  it('sarf va isrof hisobga olinadi; rad etilgan so`rov "boshqa ochiq" ga kirmaydi', async () => {
    const r = await as('admin', async (tx) => {
      await setWaste(tx, '10') // allowed 1100
      await chiqim(tx, A.ids.obj1!, '300')
      await tx.query(`update public.material_requests set status = 'rad' where id = $1`, [A.ids.mr_obj1])
      const a = await request(tx, A.ids.obj1!, '800') // 1100 − 300 − 0 = 800 → ok
      const b = await request(tx, A.ids.obj1!, '1') // 800 band → available 0 → ortiq
      return {
        a: (await alertsOf(tx, 'smetadan_ortiq_sorov', `request_id = $1`, [a])).length,
        b: (await alertsOf(tx, 'smetadan_ortiq_sorov', `request_id = $1`, [b])).map((x) => x.details.available_qty_base),
      }
    })
    expect(r).toEqual({ a: 0, b: [0] })
  })

  it('joriy smetasiz obyekt (obj3) — so`rov alert yaratmaydi (qoida 4 ham — chiqim alertsiz)', async () => {
    const r = await as('admin', async (tx) => {
      const id = await request(tx, A.ids.obj3!, '99999')
      await chiqim(tx, A.ids.obj3!, '99999')
      return {
        req: (await alertsOf(tx, 'smetadan_ortiq_sorov', `request_id = $1`, [id])).length,
        norm: (await alertsOf(tx, 'normadan_oshish', `object_id = $1`, [A.ids.obj3])).length,
      }
    })
    expect(r).toEqual({ req: 0, norm: 0 })
  })

  it('joriy smeta bor, material unda yo`q (obj1, m2) → not_in_estimate, allowed 0', async () => {
    const r = await as('admin', async (tx) => {
      const id = await scalar<string>(
        tx,
        `insert into public.material_requests (company_id, object_id, material_id, unit_id, qty_input, unit_input, qty_base)
         values ($1, $2, $3, $4, 1, '-', 0) returning id`,
        [A.id, A.ids.obj1, A.ids.m2, m2Id],
      )
      return alertsOf(tx, 'smetadan_ortiq_sorov', `request_id = $1`, [id])
    })
    expect(r).toHaveLength(1)
    expect(r[0]!.details).toMatchObject({ not_in_estimate: true, estimate_version: 1, allowed_qty_base: 0, over_qty_base: 1, base_unit: 'm³' })
  })

  it('joriy smeta o`chirilsa — keyingi baholashda ochiq so`rov alerti yopiladi (no_current_estimate)', async () => {
    const r = await as('admin', async (tx) => {
      const id = await request(tx, A.ids.obj1!, '5000')
      await tx.query(`update public.estimates set deleted_at = now() where id = $1`, [A.ids.est_obj1])
      await tx.query(`update public.material_requests set qty_input = 5001 where id = $1`, [id])
      return (await alertsOf(tx, 'smetadan_ortiq_sorov', `request_id = $1`, [id])).map((a) => [a.status, a.details.closed_reason])
    })
    expect(r).toEqual([['yopildi', 'no_current_estimate']])
  })

  it('rad → request_rejected; o`chirish → request_deleted; admin miqdorni kamaytirsa → within_threshold', async () => {
    const r = await as('admin', async (tx) => {
      const a = await request(tx, A.ids.obj1!, '5000')
      const b = await request(tx, A.ids.obj1!, '5000')
      const c = await request(tx, A.ids.obj1!, '5000')
      await tx.query(`update public.material_requests set status = 'rad' where id = $1`, [a])
      await tx.query(`update public.material_requests set deleted_at = now() where id = $1`, [b])
      // c: boshqa ochiq so'rovlar: mr_obj1 (100) — a, b endi ochiq emas
      await tx.query(`update public.material_requests set qty_input = 10 where id = $1`, [c])
      const reason = async (id: string): Promise<unknown> =>
        (await alertsOf(tx, 'smetadan_ortiq_sorov', `request_id = $1`, [id])).map((x) => [x.status, x.details.closed_reason])
      return { a: await reason(a), b: await reason(b), c: await reason(c) }
    })
    expect(r).toEqual({
      a: [['yopildi', 'request_rejected']],
      b: [['yopildi', 'request_deleted']],
      c: [['yopildi', 'within_threshold']],
    })
  })

  it('alert telegram navbatiga (notification_outbox) tushadi', async () => {
    const r = await as('admin', async (tx) => {
      const id = await request(tx, A.ids.obj1!, '5000')
      const [al] = await alertsOf(tx, 'smetadan_ortiq_sorov', `request_id = $1`, [id])
      const outbox = await sys(tx, () =>
        scalar<number>(tx, `select count(*)::int from public.notification_outbox where alert_id = $1`, [al!.id]),
      )
      return { outbox }
    })
    expect(r.outbox).toBe(1)
  })
})

// ============================================================================
// So'rovlar: decision_note, purchase_id, huquqlar
// ============================================================================
describe('so`rovlar: decision_note va purchase_id', () => {
  const upd = (tx: Queryable, set: string, params: unknown[] = []): Promise<string> =>
    res(tx, `update public.material_requests set ${set} where id = $1`, [A.ids.mr_obj1, ...params])

  it('taminotchi: tasdiqlandi → xarid_qilindi + purchase_id (shu obyekt/material) — OK', async () => {
    const r = await as('taminotchi', async (tx) => [
      // O2: tasdiqlash — faqat admin (tizim sifatida o'rnatiladi)
      await asAuth(tx, A.users.admin.authUid, () =>
        res(tx, `update public.material_requests set status = 'tasdiqlandi' where id = $1`, [A.ids.mr_obj1]),
      ),
      await upd(tx, `status = 'xarid_qilindi', purchase_id = $2`, [A.ids.p_tam_obj1]),
      await scalar<string>(tx, `select purchase_id from public.material_requests where id = $1`, [A.ids.mr_obj1]),
    ])
    expect(r).toEqual(['OK:1', 'OK:1', A.ids.p_tam_obj1])
  })

  it('purchase_id: boshqa obyekt xaridi → 23514; o`chirilgan / boshqa firma xaridi → 23503; holat xarid_qilindi emas → 23514', async () => {
    const r = await as('admin', async (tx) => {
      const otherObj = await upd(tx, `status = 'xarid_qilindi', purchase_id = $2`, [A.ids.p_hay_obj2])
      const otherCo = await upd(tx, `status = 'xarid_qilindi', purchase_id = $2`, [B.ids.p_tam_obj1])
      const notStatus = await upd(tx, `status = 'tasdiqlandi', purchase_id = $2`, [A.ids.p_tam_obj1])
      await tx.query(`update public.purchases set deleted_at = now() where id = $1`, [A.ids.p_tam_obj1])
      const deleted = await upd(tx, `status = 'xarid_qilindi', purchase_id = $2`, [A.ids.p_tam_obj1])
      return { otherObj, otherCo, notStatus, deleted }
    })
    expect(r).toEqual({
      otherObj: '23514:request_purchase_invalid',
      otherCo: '23503:purchase_not_open',
      notStatus: '23514:request_purchase_invalid',
      deleted: '23503:purchase_not_open',
    })
  })

  it('taminotchi purchase_id ni xarid_qilindi bo`lmagan holatda va decision_note ni o`zgartira olmaydi', async () => {
    const r = await as('taminotchi', async (tx) => ({
      note: await upd(tx, `decision_note = 'sabab'`),
      purchase: await upd(tx, `status = 'tasdiqlandi', purchase_id = $2`, [A.ids.p_tam_obj1]),
    }))
    expect(r).toEqual({ note: '42501:request_fields_locked', purchase: '42501:request_fields_locked' })
  })

  it('admin decision_note bilan rad etadi; > 500 belgi → 23514; prorab INSERT da decision_note → null', async () => {
    const r = await as('admin', async (tx) => ({
      ok: await upd(tx, `status = 'rad', decision_note = 'Smetada yo''q'`),
      long: await upd(tx, `decision_note = $2`, ['x'.repeat(501)]),
      saved: await scalar<string>(tx, `select decision_note from public.material_requests where id = $1`, [A.ids.mr_obj1]),
    }))
    expect(r).toEqual({ ok: 'OK:1', long: '23514:', saved: "Smetada yo'q" })

    const p = await as('prorab', (tx) =>
      scalar<string | null>(
        tx,
        `insert into public.material_requests (company_id, object_id, material_id, unit_id, qty_input, unit_input, qty_base,
           decision_note)
         values ($1, $2, $3, $4, 1, '-', 0, 'o''zim') returning decision_note`,
        [A.id, A.ids.obj1, A.ids.m1, kgId],
      ),
    )
    expect(p).toBeNull()
  })

  it('prorab: a`zo bo`lmagan obyektga so`rov — 42501; boshqalarning so`rovini o`zgartira olmaydi', async () => {
    const r = await as('prorab', async (tx) => ({
      obj2: await res(
        tx,
        `insert into public.material_requests (company_id, object_id, material_id, unit_id, qty_input, unit_input, qty_base)
         values ($1, $2, $3, $4, 1, '-', 0)`,
        [A.id, A.ids.obj2, A.ids.m1, kgId],
      ),
      update: await upd(tx, `note = 'x'`),
    }))
    expect(r).toEqual({ obj2: '42501:', update: 'OK:0' })
  })
})

// ============================================================================
// O'tkazmalar
// ============================================================================
describe('o`tkazmalar', () => {
  const CREATE = `select public.create_transfer($1, $2, $3, $4, $5, $6, $7) as id`
  const create = (tx: Queryable, from: string, to: string, qty: string, id = randomUUID(), unit = qopId): Promise<string> =>
    scalar<string>(tx, CREATE, [id, from, to, A.ids.m1, unit, qty, 'izoh'])
  const tryCreate = (tx: Queryable, from: string, to: string, qty: string, id = randomUUID(), unit = qopId): Promise<string> =>
    res(tx, CREATE, [id, from, to, A.ids.m1, unit, qty, null])

  it('prorab yaratadi: transfers (yuborildi) + transfer_out; from qoldig`i kamayadi; idempotent', async () => {
    const r = await as('prorab', async (tx) => {
      const id = randomUUID()
      const s0 = await stock(tx, A.ids.obj1!)
      const t1 = await create(tx, A.ids.obj1!, A.ids.obj2!, '2', id)
      const t2 = await create(tx, A.ids.obj1!, A.ids.obj2!, '2', id)
      const reused = await tryCreate(tx, A.ids.obj1!, A.ids.obj2!, '3', id)
      const t = await one(tx, `select status::text, qty_base::text, unit_input, created_by from public.transfers where id = $1`, [id])
      const mv = await rows(tx, `select type::text, object_id, qty_base::text from public.movements where transfer_id = $1`, [id])
      return { same: t1 === id && t2 === id, reused, t, mv, s0, s1: await stock(tx, A.ids.obj1!) }
    })
    expect(r).toEqual({
      same: true,
      reused: '23505:transfer_id_reused',
      t: { status: 'yuborildi', qty_base: '100.000000', unit_input: 'qop', created_by: A.users.prorab.profileId },
      mv: [{ type: 'transfer_out', object_id: A.ids.obj1, qty_base: '100.000000' }],
      s0: '100.000000',
      s1: '0.000000',
    })
  })

  it('huquqlar: a`zo bo`lmagan obyektdan, omborchi, begona firma obyekti, bir xil obyekt, noto`g`ri miqdor', async () => {
    const pr = await as('prorab', async (tx) => ({
      notMember: await tryCreate(tx, A.ids.obj2!, A.ids.obj1!, '1'),
      foreignTo: await tryCreate(tx, A.ids.obj1!, B.ids.obj1!, '1'),
      foreignFrom: await tryCreate(tx, B.ids.obj1!, A.ids.obj1!, '1'),
      same: await tryCreate(tx, A.ids.obj1!, A.ids.obj1!, '1'),
      zero: await tryCreate(tx, A.ids.obj1!, A.ids.obj2!, '0'),
      otherUnit: await tryCreate(tx, A.ids.obj1!, A.ids.obj2!, '1', randomUUID(), m2Id),
    }))
    expect(pr).toEqual({
      notMember: '42501:transfer_forbidden',
      foreignTo: 'P0002:transfer_object_not_found',
      foreignFrom: 'P0002:transfer_object_not_found',
      same: '22023:transfer_invalid',
      zero: '22023:transfer_invalid',
      otherUnit: '23503:ops_unit_material_mismatch',
    })
    for (const role of ['omborchi', 'direktor', 'taminotchi', 'tekshiruvchi'] as const) {
      expect(await as(role, (tx) => tryCreate(tx, A.ids.obj1!, A.ids.obj2!, '1')), role).toBe('42501:transfer_forbidden')
    }
    // Batch 12: manba qoldig'i kerak (obj2 da 40 kg, 1 qop = 50 kg)
    expect(
      await as('admin', async (tx) => {
        await kirim(tx, A.ids.obj2!, '100')
        return tryCreate(tx, A.ids.obj2!, A.ids.obj3!, '1')
      }),
    ).toBe('OK:1')
  })

  it('to`g`ridan-to`g`ri INSERT/UPDATE (RPC`siz) — 42501 transfer_direct_edit', async () => {
    const r = await as('admin', async (tx) => ({
      ins: await res(
        tx,
        `insert into public.transfers (company_id, from_object_id, to_object_id, material_id, unit_id, qty_input, unit_input, qty_base)
         values ($1, $2, $3, $4, $5, 1, '-', 0)`,
        [A.id, A.ids.obj1, A.ids.obj2, A.ids.m1, kgId],
      ),
      upd: await res(tx, `update public.transfers set status = 'qabul_qilindi' where id = $1`, [A.ids.tr_1to2]),
      del: await res(tx, `update public.transfers set deleted_at = now() where id = $1`, [A.ids.tr_1to2]),
    }))
    expect(r).toEqual({ ins: '42501:transfer_direct_edit', upd: '42501:transfer_direct_edit', del: '42501:transfer_direct_edit' })
  })

  it('qabul: to obyekt a`zosi (prorab/omborchi); to qoldig`i ko`payadi; takroriy — o`zgarishsiz; boshqa miqdor — 55000', async () => {
    const r = await as('admin', async (tx) => {
      await kirim(tx, A.ids.obj2!, '200') // Batch 12: manba qoldig'i
      const id = await create(tx, A.ids.obj2!, A.ids.obj1!, '3') // 150 kg
      await tx.exec(`set local request.jwt.claim.sub = '${A.users.omborchi.authUid}'`)
      await tx.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: A.users.omborchi.authUid, role: 'authenticated' })])
      const s0 = await stock(tx, A.ids.obj1!)
      const a = await res(tx, `select public.receive_transfer($1)`, [id])
      const s1 = await stock(tx, A.ids.obj1!)
      const again = await res(tx, `select public.receive_transfer($1)`, [id])
      const againSame = await res(tx, `select public.receive_transfer($1, '3')`, [id])
      const other = await res(tx, `select public.receive_transfer($1, '2')`, [id])
      const t = await one(
        tx,
        `select status::text, received_qty_base::text, received_by, received_at is not null as at from public.transfers where id = $1`,
        [id],
      )
      const ins = await scalar<number>(tx, `select count(*)::int from public.movements where transfer_id = $1 and type = 'transfer_in'`, [id])
      const alerts = await sys(tx, () => alertsOf(tx, 'otkazma_farqi'))
      return { a, s0, s1, again, againSame, other, t, ins, alerts: alerts.length }
    })
    expect(r).toEqual({
      a: 'OK:1',
      s0: '100.000000',
      s1: '250.000000',
      again: 'OK:1',
      againSame: 'OK:1',
      other: '55000:transfer_already_received',
      t: { status: 'qabul_qilindi', received_qty_base: '150.000000', received_by: A.users.omborchi.profileId, at: true },
      ins: 1,
      alerts: 0,
    })
  })

  it('qabul: a`zo bo`lmagan prorab, direktor — 42501; begona firma — P0002; noto`g`ri miqdor — 22023', async () => {
    const tid = randomUUID()
    await asUser(db, A.users.admin.authUid, (tx) => create(tx, A.ids.obj1!, A.ids.obj2!, '1', tid), { commit: true })
    expect(await as('prorab', (tx) => res(tx, `select public.receive_transfer($1)`, [tid]))).toBe('42501:transfer_forbidden')
    expect(await as('direktor', (tx) => res(tx, `select public.receive_transfer($1)`, [tid]))).toBe('42501:transfer_forbidden')
    expect(await asUser(db, B.users.admin.authUid, (tx) => res(tx, `select public.receive_transfer($1)`, [tid]))).toBe(
      'P0002:transfer_not_found',
    )
    expect(await as('admin', (tx) => res(tx, `select public.receive_transfer($1, 'abc')`, [tid]))).toBe('22023:transfer_invalid')
    // tozalash: bekor qilish (commit)
    await asUser(db, A.users.admin.authUid, (tx) => tx.query(`select public.cancel_transfer($1, 'test')`, [tid]), { commit: true })
  })

  it('kam qabul → otkazma_farqi (ogohlantirish, under) + telegram navbati; ko`p qabul → over', async () => {
    const r = await as('admin', async (tx) => {
      await kirim(tx, A.ids.obj1!, '200') // Batch 12: manba qoldig'i
      const a = await create(tx, A.ids.obj1!, A.ids.obj2!, '3') // 150
      await tx.query(`select public.receive_transfer($1, '2.5', 'yo''lda yo''qoldi')`, [a]) // 125
      const b = await create(tx, A.ids.obj1!, A.ids.obj2!, '1') // 50
      await tx.query(`select public.receive_transfer($1, ' 1.2 ', 'Ortiqcha keldi')`, [b]) // 60 (audit B14: admin, izoh bilan)
      const al = await alertsOf(tx, 'otkazma_farqi')
      const outbox = await sys(tx, () =>
        rows<{ payload: Row }>(tx, `select payload from public.notification_outbox where alert_id = $1`, [al[0]!.id]),
      )
      const inMv = await one(tx, `select qty_input::text, unit_input, qty_base::text, note from public.movements where transfer_id = $1 and type = 'transfer_in'`, [a])
      return { a, b, al, outbox, inMv }
    })
    expect(r.al).toHaveLength(2)
    expect(r.al[0]).toMatchObject({ severity: 'ogohlantirish', object_id: A.ids.obj2, material_id: A.ids.m1 })
    expect(r.al[0]!.movement_id).toBeTruthy()
    expect(r.al[0]!.details).toEqual({
      transfer_id: r.a,
      sent_qty_base: 150,
      received_qty_base: 125,
      diff_qty_base: -25,
      direction: 'under',
      base_unit: 'kg',
      from_object_name: 'A obj1',
      to_object_name: 'A obj2',
    })
    expect(r.al[1]!.details).toMatchObject({ transfer_id: r.b, diff_qty_base: 10, direction: 'over' })
    expect(r.outbox).toHaveLength(1)
    expect(r.outbox[0]!.payload).toMatchObject({ type: 'otkazma_farqi', object_name: 'A obj2', material_name: 'A sement', base_unit: 'kg' })
    expect(r.inMv).toEqual({ qty_input: '2.500000', unit_input: 'qop', qty_base: '125.000000', note: "yo'lda yo'qoldi" })
  })

  it('bekor: transfer_out o`chiriladi, qoldiq qaytadi, yozuv_ochirildi alerti yo`q; takroriy — o`zgarishsiz; keyin qabul — 55000', async () => {
    const r = await as('prorab', async (tx) => {
      const id = await create(tx, A.ids.obj1!, A.ids.obj2!, '1')
      const s1 = await stock(tx, A.ids.obj1!)
      const c1 = await res(tx, `select public.cancel_transfer($1, 'Xato kiritildi')`, [id])
      const c2 = await res(tx, `select public.cancel_transfer($1, 'yana')`, [id])
      const s2 = await stock(tx, A.ids.obj1!)
      const t = await one(tx, `select status::text, cancel_reason from public.transfers where id = $1`, [id])
      const out = await sys(tx, () =>
        scalar<boolean>(tx, `select deleted_at is not null from public.movements where transfer_id = $1 and type = 'transfer_out'`, [id]),
      )
      const delAlerts = await sys(tx, () => alertsOf(tx, 'yozuv_ochirildi'))
      const recv = await sys(tx, async () => {
        await tx.exec('set local role authenticated')
        await tx.query(`select set_config('request.jwt.claims', $1, true), set_config('request.jwt.claim.sub', $2, true)`, [
          JSON.stringify({ sub: A.users.admin.authUid, role: 'authenticated' }),
          A.users.admin.authUid,
        ])
        return res(tx, `select public.receive_transfer($1)`, [id])
      })
      return { s1, c1, c2, s2, t, out, delAlerts: delAlerts.length, recv }
    })
    expect(r).toEqual({
      s1: '50.000000',
      c1: 'OK:1',
      c2: 'OK:1',
      s2: '100.000000',
      t: { status: 'bekor', cancel_reason: 'Xato kiritildi' },
      out: true,
      delAlerts: 0,
      recv: '55000:transfer_not_open',
    })
  })

  it('bekor: qabul qilingandan keyin — 55000; boshqa odam (omborchi) — 42501', async () => {
    const r = await as('admin', async (tx) => {
      const a = await create(tx, A.ids.obj1!, A.ids.obj2!, '1')
      await tx.query(`select public.receive_transfer($1)`, [a])
      return res(tx, `select public.cancel_transfer($1, null)`, [a])
    })
    expect(r).toBe('55000:transfer_not_open')
    const tid = randomUUID()
    await asUser(db, A.users.prorab.authUid, (tx) => create(tx, A.ids.obj1!, A.ids.obj3!, '1', tid), { commit: true })
    expect(await as('omborchi', (tx) => res(tx, `select public.cancel_transfer($1, 'x')`, [tid]))).toBe('42501:transfer_forbidden')
    expect(await as('prorab', (tx) => res(tx, `select public.cancel_transfer($1, $2)`, [tid, 'x'.repeat(501)]))).toBe(
      '22023:transfer_invalid',
    )
    await asUser(db, A.users.prorab.authUid, (tx) => tx.query(`select public.cancel_transfer($1, 'test')`, [tid]), { commit: true })
  })

  it('RLS: omborchi (obj1) kelayotgan o`tkazmani ko`radi; obj2→obj3 — ko`rmaydi', async () => {
    const r = await as('admin', async (tx) => {
      await kirim(tx, A.ids.obj2!, '100') // Batch 12: manba qoldig'i
      const inc = await create(tx, A.ids.obj2!, A.ids.obj1!, '1')
      const other = await create(tx, A.ids.obj2!, A.ids.obj3!, '1')
      await tx.query(`select set_config('request.jwt.claims', $1, true), set_config('request.jwt.claim.sub', $2, true)`, [
        JSON.stringify({ sub: A.users.omborchi.authUid, role: 'authenticated' }),
        A.users.omborchi.authUid,
      ])
      return {
        inc: await scalar<number>(tx, `select count(*)::int from public.transfers where id = $1`, [inc]),
        other: await scalar<number>(tx, `select count(*)::int from public.transfers where id = $1`, [other]),
      }
    })
    expect(r).toEqual({ inc: 1, other: 0 })
  })

  it('transfer_target_objects: firma faol obyektlari (id, nom); nofaol/o`chirilgan/boshqa firma yo`q; omborchi, haydovchi — 42501', async () => {
    const r = await as('prorab', async (tx) => {
      await sys(tx, async () => {
        await tx.query(`update public.objects set status = 'yakunlangan' where id = $1`, [A.ids.obj3])
        await tx.query(`insert into public.objects (company_id, name, deleted_at) values ($1, 'A o''chirilgan', now())`, [A.id])
      })
      const list = await rows<Row>(tx, `select * from public.transfer_target_objects()`)
      return list
    })
    expect(r).toEqual([
      { id: A.ids.obj1, name: 'A obj1' },
      { id: A.ids.obj2, name: 'A obj2' },
    ])
    const admin = await as('admin', (tx) => rows<Row>(tx, `select id from public.transfer_target_objects()`))
    expect(admin.map((x) => x.id).sort()).toEqual([A.ids.obj1, A.ids.obj2, A.ids.obj3].sort())
    for (const role of ['omborchi', 'haydovchi', 'direktor', 'tekshiruvchi'] as const) {
      expect(await as(role, (tx) => res(tx, `select * from public.transfer_target_objects()`)), role).toBe('42501:transfer_forbidden')
    }
    expect(await scalar<boolean>(db, `select has_function_privilege('anon', 'public.transfer_target_objects()', 'execute')`)).toBe(false)
  })

  it('anon RPC chaqira olmaydi', async () => {
    const r = await rows<{ f: string; x: boolean }>(
      db,
      `select f, has_function_privilege('anon', f, 'execute') as x from unnest(array[
         'public.create_transfer(uuid, uuid, uuid, uuid, uuid, numeric, text)',
         'public.receive_transfer(uuid, text, text)',
         'public.cancel_transfer(uuid, text)',
         'public.apply_inventory_adjustments(uuid)']) f`,
    )
    expect(r.every((x) => !x.x)).toBe(true)
  })
})

// ============================================================================
// Inventarizatsiya
// ============================================================================
describe('inventarizatsiya', () => {
  const addItem = (tx: Queryable, count: string, mat: string, qty: string, unit: string | null, counted = '999'): Promise<Row> =>
    one(
      tx,
      `insert into public.inventory_count_items (company_id, inventory_count_id, material_id, unit_id, qty_input, qty_counted)
       values ($1, $2, $3, $4, $5, $6) returning id, qty_input::text, unit_id, qty_counted::text`,
      [A.id, count, mat, unit, qty, counted],
    )
  const newCount = (tx: Queryable, obj = A.ids.obj1!): Promise<string> =>
    scalar<string>(tx, `insert into public.inventory_counts (company_id, object_id) values ($1, $2) returning id`, [A.id, obj])

  it('qty_counted bazada: 3 qop → 150 (klient 999 e`tiborsiz); qty_input o`zgarsa qayta hisoblanadi', async () => {
    const r = await as('tekshiruvchi', async (tx) => {
      const c = await newCount(tx)
      const a = await addItem(tx, c, A.ids.m1!, '3', qopId)
      const u = await one(tx, `update public.inventory_count_items set qty_input = 4, qty_counted = 1 where id = $1 returning qty_counted::text`, [a.id])
      const wrong = await res(
        tx,
        `insert into public.inventory_count_items (company_id, inventory_count_id, material_id, unit_id, qty_input, qty_counted)
         values ($1, $2, $3, $4, 1, 0)`,
        [A.id, c, A.ids.m2, qopId],
      )
      return { a: [a.qty_input, a.unit_id, a.qty_counted], u: u.qty_counted, wrong }
    })
    expect(r).toEqual({ a: ['3.000000', qopId, '150.000000'], u: '200.000000', wrong: '23503:ops_unit_material_mismatch' })
  })

  it('unit_id siz (eski klient): asosiy birlik, qty_input = qty_counted; eski qator (unit_id, qty_input null) — qty_counted o`zgarmaydi', async () => {
    const r = await as('tekshiruvchi', async (tx) => {
      const c = await newCount(tx)
      const a = await one(
        tx,
        `insert into public.inventory_count_items (company_id, inventory_count_id, material_id, qty_counted)
         values ($1, $2, $3, 7.5) returning id, qty_input::text, unit_id, qty_counted::text`,
        [A.id, c, A.ids.m1],
      )
      const legacy = await sys(tx, async () => {
        await tx.query(`alter table public.inventory_count_items disable trigger b_compute_counted`)
        await tx.query(`update public.inventory_count_items set unit_id = null, qty_input = null, qty_counted = 9 where id = $1`, [a.id])
        await tx.query(`alter table public.inventory_count_items enable trigger b_compute_counted`)
        return null
      })
      const u = await one(tx, `update public.inventory_count_items set qty_counted = 1, note = 'x' where id = $1 returning qty_counted::text`, [a.id])
      return { a: [a.qty_input, a.unit_id, a.qty_counted], legacy, u: u.qty_counted }
    })
    expect(r).toEqual({ a: ['7.500000', kgId, '7.500000'], legacy: null, u: '9.000000' })
  })

  it('bitta hisobda bir material ikki marta — 23505', async () => {
    const r = await as('tekshiruvchi', async (tx) => {
      const c = await newCount(tx)
      await addItem(tx, c, A.ids.m1!, '1', kgId)
      return res(
        tx,
        `insert into public.inventory_count_items (company_id, inventory_count_id, material_id, unit_id, qty_input, qty_counted)
         values ($1, $2, $3, $4, 1, 0)`,
        [A.id, c, A.ids.m1, qopId],
      )
    })
    expect(r).toBe('23505:')
  })

  it('qoida 5: kamomad alerti — narx (90 kun, Σ summa / Σ miqdor), qiymat, ogohlantirish; ortiqcha — alertda yo`q', async () => {
    const r = await as('tekshiruvchi', async (tx) => {
      const c = await newCount(tx)
      await addItem(tx, c, A.ids.m1!, '5', kgId) // expected 100 → shortage 95
      await addItem(tx, c, A.ids.m2!, '2', m2Id) // expected 0 → ortiqcha
      await tx.query(`select public.submit_inventory_count($1)`, [c])
      const al = await sys(tx, () => alertsOf(tx, 'inventarizatsiya_kamomadi', `inventory_count_id = $1`, [c]))
      return { c, al }
    })
    // p_hay_obj2, p_tam_obj1, p_pro_obj1: 3 × 600 000 / 3 × 500 kg → 1200.0000
    expect(r.al).toHaveLength(1)
    expect(r.al[0]).toMatchObject({ severity: 'ogohlantirish', object_id: A.ids.obj1, material_id: null })
    expect(r.al[0]!.details).toEqual({
      count_id: r.c,
      items: [
        {
          material_id: A.ids.m1,
          material_name: 'A sement',
          base_unit: 'kg',
          expected: 100,
          counted: 5,
          shortage: 95,
          shortage_value: 114000,
        },
      ],
      total_shortage_value: 114000,
      more_count: 0,
      not_counted: [],
      not_counted_more: 0,
      // audit_fixes A3: sanash davomidagi harakatlar
      movements_during_count: [],
      movements_during_count_total: 0,
    })
  })

  it('qoida 5: ≥ 1 000 000 so`m → jiddiy; narx yo`q material — shortage_value null; tartib — kamomad kattasidan', async () => {
    const r = await as('admin', async (tx) => {
      await kirim(tx, A.ids.obj1!, '1000') // m1: 1100
      await kirim(tx, A.ids.obj1!, '10', A.ids.m2!, m2Id) // m2: 10, xaridsiz
      const c = await newCount(tx)
      await addItem(tx, c, A.ids.m1!, '266.666667', kgId) // 833.333333 × 1200 = 999 999.9996 → 1 000 000.00
      await addItem(tx, c, A.ids.m2!, '1', m2Id) // 9 m³, narx yo'q
      await tx.query(`select public.submit_inventory_count($1)`, [c])
      const [al] = await alertsOf(tx, 'inventarizatsiya_kamomadi', `inventory_count_id = $1`, [c])
      return al!
    })
    expect(r.severity).toBe('jiddiy')
    expect(r.details.total_shortage_value).toBe(1000000)
    const items = r.details.items as Row[]
    expect(items.map((i) => [i.material_id, i.shortage, i.shortage_value])).toEqual([
      [A.ids.m1, 833.333333, 1000000],
      [A.ids.m2, 9, null],
    ])
  })

  it('qoida 5: 999 999.99 → ogohlantirish; faqat narxsiz kamomad → total null, ogohlantirish; kamomad yo`q → alert yo`q', async () => {
    const r = await as('admin', async (tx) => {
      await kirim(tx, A.ids.obj1!, '1000')
      await kirim(tx, A.ids.obj1!, '10', A.ids.m2!, m2Id)
      const c1 = await newCount(tx)
      await addItem(tx, c1, A.ids.m1!, '266.6750', kgId) // 833.325 × 1200 = 999 990.00
      await tx.query(`select public.submit_inventory_count($1)`, [c1])
      const c2 = await newCount(tx)
      await addItem(tx, c2, A.ids.m1!, '1100', kgId)
      await addItem(tx, c2, A.ids.m2!, '0', m2Id)
      await tx.query(`select public.submit_inventory_count($1)`, [c2])
      const c3 = await newCount(tx)
      await addItem(tx, c3, A.ids.m1!, '1100', kgId)
      await addItem(tx, c3, A.ids.m2!, '10', m2Id)
      await tx.query(`select public.submit_inventory_count($1)`, [c3])
      const get = async (c: string): Promise<unknown[]> =>
        (await alertsOf(tx, 'inventarizatsiya_kamomadi', `inventory_count_id = $1`, [c])).map((a) => [a.severity, a.details.total_shortage_value])
      return { c1: await get(c1), c2: await get(c2), c3: await get(c3) }
    })
    expect(r).toEqual({ c1: [['ogohlantirish', 999990]], c2: [['ogohlantirish', null]], c3: [] })
  })

  it('qoida 5: 20 tadan ko`p material — ro`yxat 20 ta, more_count', async () => {
    const r = await as('admin', async (tx) => {
      const c = await newCount(tx, A.ids.obj3!)
      for (let i = 0; i < 22; i++) {
        const m = await sys(tx, () =>
          scalar<string>(tx, `insert into public.materials (company_id, name, base_unit) values ($1, $2, 'dona') returning id`, [A.id, `Inv ${i}`]),
        )
        const u = await sys(tx, () => scalar<string>(tx, `select id from public.material_units where material_id = $1`, [m]))
        await kirim(tx, A.ids.obj3!, String(i + 1), m, u)
        await addItem(tx, c, m, '0', u)
      }
      await tx.query(`select public.submit_inventory_count($1)`, [c])
      const [al] = await alertsOf(tx, 'inventarizatsiya_kamomadi', `inventory_count_id = $1`, [c])
      return al!.details
    })
    const items = r.items as Row[]
    expect(items).toHaveLength(20)
    expect(items[0]!.shortage).toBe(22)
    expect(items[19]!.shortage).toBe(3)
    expect(r.more_count).toBe(2)
  })

  it('tuzatish: admin — inventory_adjust harakatlari, qoldiq = sanalgan; ikki marta — 55000; draft — 55000; tekshiruvchi — 42501', async () => {
    const r = await as('admin', async (tx) => {
      await kirim(tx, A.ids.obj1!, '10', A.ids.m2!, m2Id) // m2: 10
      const c = await newCount(tx)
      await addItem(tx, c, A.ids.m1!, '1.5', qopId) // 75 (expected 100 → −25)
      await addItem(tx, c, A.ids.m2!, '12', m2Id) // 12 (expected 10 → +2)
      const draft = await res(tx, `select public.apply_inventory_adjustments($1)`, [c])
      await tx.query(`select public.submit_inventory_count($1)`, [c])
      const n = await scalar<number>(tx, `select public.apply_inventory_adjustments($1)`, [c])
      const mv = await rows(
        tx,
        `select material_id, qty_input::text, qty_base::text, unit_input from public.movements
          where inventory_count_id = $1 and type = 'inventory_adjust' order by material_id`,
        [c],
      )
      const st = [await stock(tx, A.ids.obj1!), await stock(tx, A.ids.obj1!, A.ids.m2!)]
      const again = await res(tx, `select public.apply_inventory_adjustments($1)`, [c])
      const cnt = await one(tx, `select applied_at is not null as at, applied_by from public.inventory_counts where id = $1`, [c])
      return { draft, n, mv, st, again, cnt }
    })
    const expMv = [
      { material_id: A.ids.m1, qty_input: '-25.000000', qty_base: '-25.000000', unit_input: 'kg' },
      { material_id: A.ids.m2, qty_input: '2.000000', qty_base: '2.000000', unit_input: 'm³' },
    ].sort((a, b) => (a.material_id! < b.material_id! ? -1 : 1))
    expect(r).toEqual({
      draft: '55000:inventory_not_submitted',
      n: 2,
      mv: expMv,
      st: ['75.000000', '12.000000'],
      again: '55000:inventory_already_applied',
      cnt: { at: true, applied_by: A.users.admin.profileId },
    })

    const t = await as('tekshiruvchi', async (tx) => {
      const c = await newCount(tx)
      await tx.query(`select public.submit_inventory_count($1)`, [c])
      return res(tx, `select public.apply_inventory_adjustments($1)`, [c])
    })
    expect(t).toBe('42501:inventory_apply_forbidden')
  })

  it('applied_at / applied_by ni to`g`ridan-to`g`ri yozib bo`lmaydi (insert → null, update → 42501)', async () => {
    const r = await as('admin', async (tx) => {
      const ins = await one(
        tx,
        `insert into public.inventory_counts (company_id, object_id, applied_at, applied_by) values ($1, $2, now(), $3)
         returning applied_at, applied_by`,
        [A.id, A.ids.obj1, A.users.admin.profileId],
      )
      const upd = await res(tx, `update public.inventory_counts set applied_at = now() where id = $1`, [A.ids.ic_obj1])
      return { ins, upd }
    })
    expect(r).toEqual({ ins: { applied_at: null, applied_by: null }, upd: '42501:inventory_apply_direct' })
  })

  it('boshqa firma admini — P0002; inventarizatsiyada ishlatilgan birlik factor`i o`zgarmaydi', async () => {
    const { tid, unit } = await asUser(
      db,
      A.users.admin.authUid,
      async (tx) => {
        // faqat inventarizatsiyada ishlatiladigan yangi birlik
        const u = await scalar<string>(
          tx,
          `insert into public.material_units (company_id, material_id, unit, factor) values ($1, $2, 'meshok', 25) returning id`,
          [A.id, A.ids.m1],
        )
        const c = await newCount(tx, A.ids.obj3!)
        await addItem(tx, c, A.ids.m1!, '1', u)
        await tx.query(`select public.submit_inventory_count($1)`, [c])
        return { tid: c, unit: u }
      },
      { commit: true },
    )
    expect(await asUser(db, B.users.admin.authUid, (tx) => res(tx, `select public.apply_inventory_adjustments($1)`, [tid]))).toBe(
      'P0002:inventory_not_found',
    )
    expect(await as('admin', (tx) => res(tx, `update public.material_units set factor = 49 where id = $1`, [unit]))).toBe(
      'P0001:catalog_unit_in_use',
    )
  })
})

// ============================================================================
// Review tuzatishlari (Y1–Y5, O1–O7, P4, P5, P9)
// ============================================================================
describe('review: Y1 / O5 — tekshiruvchi kutilgan qoldiqni ko`rmaydi', () => {
  it('tekshiruvchi: movements, purchases, stock_balances, norm_usage, purchase_receipts — 0 qator; qty_expected — 42501', async () => {
    const r = await as('tekshiruvchi', async (tx) => {
      const out: Record<string, unknown> = {}
      for (const t of ['movements', 'purchases', 'stock_balances', 'norm_usage', 'purchase_receipts']) {
        out[t] = await scalar<number>(tx, `select count(*)::int from public.${t}`)
      }
      out.qty_expected = await res(tx, `select qty_expected from public.inventory_count_items`)
      out.price = await res(tx, `select price_per_base from public.inventory_count_items`)
      out.items = await scalar<number>(tx, `select count(*)::int from public.inventory_count_items where id = any($1::uuid[])`, [[A.ids.ici_obj1, A.ids.ici_obj2]])
      return out
    })
    expect(r).toEqual({
      movements: 0,
      purchases: 0,
      stock_balances: 0,
      norm_usage: 0,
      purchase_receipts: 0,
      qty_expected: '42501:',
      price: '42501:',
      items: 2,
    })
    // boshqa firma bo'yicha rollar o'zgarmadi
    expect(await as('taminotchi', (tx) => scalar<number>(tx, `select count(*)::int from public.stock_balances`))).toBeGreaterThan(0)
  })

  it('inventory_candidate_materials: qoldig`i ≠ 0 yoki joriy smetada — miqdorsiz; prorab — 42501; begona obyekt — P0002', async () => {
    const r = await as('tekshiruvchi', async (tx) => {
      // obj1: m1 — qoldiq 100 va smetada; m2 — chiqim 3 (qoldiq −3 ≠ 0)
      await sys(tx, () => chiqim(tx, A.ids.obj1!, '3', A.ids.m2!, m2Id))
      const cols = await rows<Row>(tx, `select * from public.inventory_candidate_materials($1)`, [A.ids.obj1])
      const obj3 = await rows<Row>(tx, `select * from public.inventory_candidate_materials($1)`, [A.ids.obj3])
      return { cols, obj3 }
    })
    const exp = [A.ids.m1!, A.ids.m2!].sort().map((material_id) => ({ material_id }))
    expect(r.cols).toEqual(exp)
    expect(r.obj3).toEqual([])
    expect(await as('prorab', (tx) => res(tx, `select * from public.inventory_candidate_materials($1)`, [A.ids.obj1]))).toBe(
      '42501:inventory_forbidden',
    )
    expect(await as('tekshiruvchi', (tx) => res(tx, `select * from public.inventory_candidate_materials($1)`, [B.ids.obj1]))).toBe(
      'P0002:inventory_object_not_found',
    )
  })

  it('submit → {has_shortage, not_counted_count} (raqamsiz); inventory_count_details — admin/direktor/buxgalter, shortage_value alert bilan bir xil', async () => {
    const r = await as('tekshiruvchi', async (tx) => {
      await sys(tx, () => kirim(tx, A.ids.obj1!, '7', A.ids.m2!, m2Id)) // m2: 7, sanalmaydi
      const c = await scalar<string>(tx, `insert into public.inventory_counts (company_id, object_id) values ($1, $2) returning id`, [
        A.id,
        A.ids.obj1,
      ])
      await tx.query(
        `insert into public.inventory_count_items (company_id, inventory_count_id, material_id, unit_id, qty_input, qty_counted)
         values ($1, $2, $3, $4, 1.333333, 0)`,
        [A.id, c, A.ids.m1, qopId],
      ) // 1.333333 qop × 50 = 66.666650 kg
      const sub = await scalar<Row>(tx, `select public.submit_inventory_count($1)`, [c])
      const tek = await res(tx, `select * from public.inventory_count_details($1)`, [c])
      const det = await asAuth(tx, A.users.direktor.authUid, () =>
        rows<Row>(
          tx,
          `select material_id, qty_counted::text, qty_expected::text, diff::text, shortage_value::text
             from public.inventory_count_details($1)`,
          [c],
        ),
      )
      const [al] = await sys(tx, () => alertsOf(tx, 'inventarizatsiya_kamomadi', `inventory_count_id = $1`, [c]))
      return { sub, tek, det, al: al! }
    })
    expect(r.sub).toEqual({ has_shortage: true, not_counted_count: 1, movements_during_count: 0 })
    expect(r.tek).toBe('42501:inventory_details_forbidden')
    expect(r.det).toEqual([
      { material_id: A.ids.m1, qty_counted: '66.666650', qty_expected: '100.000000', diff: '-33.333350', shortage_value: '40000.02' },
    ])
    const items = r.al.details.items as Row[]
    expect(items[0]!.shortage_value).toBe(40000.02) // round(33.333350 × 1200.0000, 2)
  })

  it('Y2 — sanalmagan material alertda (not_counted), total ularni ham o`z ichiga oladi', async () => {
    const r = await as('admin', async (tx) => {
      await kirim(tx, A.ids.obj1!, '4', A.ids.m2!, m2Id) // m2: 4, narxsiz
      const c = await scalar<string>(tx, `insert into public.inventory_counts (company_id, object_id) values ($1, $2) returning id`, [
        A.id,
        A.ids.obj1,
      ])
      // m1 sanalmadi (qoldiq 100 × 1200 = 120 000), m2 — to'liq
      await tx.query(
        `insert into public.inventory_count_items (company_id, inventory_count_id, material_id, unit_id, qty_input, qty_counted)
         values ($1, $2, $3, $4, 4, 0)`,
        [A.id, c, A.ids.m2, m2Id],
      )
      const sub = await scalar<Row>(tx, `select public.submit_inventory_count($1)`, [c])
      const [al] = await alertsOf(tx, 'inventarizatsiya_kamomadi', `inventory_count_id = $1`, [c])
      return { sub, d: al!.details }
    })
    expect(r.sub).toEqual({ has_shortage: true, not_counted_count: 1, movements_during_count: 0 })
    expect(r.d).toMatchObject({
      items: [],
      more_count: 0,
      not_counted: [{ material_id: A.ids.m1, material_name: 'A sement', base_unit: 'kg', expected: 100, shortage_value: 120000 }],
      not_counted_more: 0,
      total_shortage_value: 120000,
    })
  })

  it('O4 — yuborilgan hisob qatorlari qulflangan (admin, tizim ham): inventory_locked', async () => {
    const r = await as('admin', async (tx) => {
      const c = await scalar<string>(tx, `insert into public.inventory_counts (company_id, object_id) values ($1, $2) returning id`, [
        A.id,
        A.ids.obj1,
      ])
      const item = await scalar<string>(
        tx,
        `insert into public.inventory_count_items (company_id, inventory_count_id, material_id, unit_id, qty_input, qty_counted)
         values ($1, $2, $3, $4, 100, 0) returning id`,
        [A.id, c, A.ids.m1, kgId],
      )
      await tx.query(`select public.submit_inventory_count($1)`, [c])
      return {
        upd: await res(tx, `update public.inventory_count_items set qty_input = 1 where id = $1`, [item]),
        del: await res(tx, `update public.inventory_count_items set deleted_at = now() where id = $1`, [item]),
        ins: await res(
          tx,
          `insert into public.inventory_count_items (company_id, inventory_count_id, material_id, unit_id, qty_input, qty_counted)
           values ($1, $2, $3, $4, 1, 0)`,
          [A.id, c, A.ids.m2, m2Id],
        ),
        sys: await sys(tx, () => res(tx, `update public.inventory_count_items set note = 'x' where id = $1`, [item])),
      }
    })
    expect(r).toEqual({
      upd: '42501:inventory_locked',
      del: '42501:inventory_locked',
      ins: '42501:inventory_locked',
      sys: '42501:inventory_locked',
    })
  })

  it('P5 — tuzatish kamomad alertiga applied_at, applied_by_name qo`shadi (alert ochiq qoladi)', async () => {
    const r = await as('admin', async (tx) => {
      const c = await scalar<string>(tx, `insert into public.inventory_counts (company_id, object_id) values ($1, $2) returning id`, [
        A.id,
        A.ids.obj1,
      ])
      await tx.query(
        `insert into public.inventory_count_items (company_id, inventory_count_id, material_id, unit_id, qty_input, qty_counted)
         values ($1, $2, $3, $4, 90, 0)`,
        [A.id, c, A.ids.m1, kgId],
      )
      await tx.query(`select public.submit_inventory_count($1)`, [c])
      await tx.query(`select public.apply_inventory_adjustments($1)`, [c])
      const [al] = await alertsOf(tx, 'inventarizatsiya_kamomadi', `inventory_count_id = $1`, [c])
      return al!
    })
    expect(r.status).toBe('yangi')
    expect(r.details.applied_by_name).toBe('A admin')
    expect(typeof r.details.applied_at).toBe('string')
  })
})

describe('review: o`tkazmalar (Y3, Y4, P9)', () => {
  const create = (tx: Queryable, from: string, to: string, qty: string): Promise<string> =>
    scalar<string>(tx, `select public.create_transfer($1, $2, $3, $4, $5, $6, null)`, [randomUUID(), from, to, A.ids.m1, qopId, qty])
  const due = (tx: Tx, hours: number): Promise<number> =>
    sys(tx, () => scalar<number>(tx, `select private.evaluate_due_transfers(now() + make_interval(hours => $1))`, [hours]))
  const notReceived = (tx: Tx, id: string): Promise<AlertRow[]> =>
    sys(tx, () => alertsOf(tx, 'otkazma_farqi', `details ->> 'transfer_id' = $1 and details ->> 'direction' = 'not_received'`, [id]))

  it('Y3 — 47 soat: yo`q; 49 soat: bitta alert (details), takroriy — yo`q; qabul → yopiladi (transfer_received)', async () => {
    const r = await as('admin', async (tx) => {
      const id = await create(tx, A.ids.obj1!, A.ids.obj2!, '1')
      await due(tx, 47)
      const at47 = (await notReceived(tx, id)).length
      await due(tx, 49)
      await due(tx, 50)
      const at49 = await notReceived(tx, id)
      await tx.query(`select public.receive_transfer($1)`, [id])
      const after = (await notReceived(tx, id)).map((a) => [a.status, a.details.closed_reason])
      return { at47, at49, after }
    })
    expect(r.at47).toBe(0)
    expect(r.at49).toHaveLength(1)
    expect(r.at49[0]).toMatchObject({ severity: 'ogohlantirish', object_id: A.ids.obj2, material_id: A.ids.m1 })
    expect(r.at49[0]!.details).toMatchObject({
      direction: 'not_received',
      sent_qty_base: 50,
      base_unit: 'kg',
      from_object_name: 'A obj1',
      to_object_name: 'A obj2',
      hours: 49,
    })
    expect(typeof r.at49[0]!.details.sent_at).toBe('string')
    expect(r.after).toEqual([['yopildi', 'transfer_received']])
  })

  it('Y3 — bekor qilinganda yopiladi (transfer_cancelled); firma sozlamasi (24 soat); cron ishi bor', async () => {
    const r = await as('admin', async (tx) => {
      await sys(tx, () => tx.query(`update public.companies set transfer_receive_hours = 24 where id = $1`, [A.id]))
      const id = await create(tx, A.ids.obj1!, A.ids.obj2!, '1')
      await due(tx, 25)
      const open = (await notReceived(tx, id)).length
      await tx.query(`select public.cancel_transfer($1, 'x')`, [id])
      const after = (await notReceived(tx, id)).map((a) => a.details.closed_reason)
      return { open, after }
    })
    expect(r).toEqual({ open: 1, after: ['transfer_cancelled'] })
    expect(await scalar<string>(db, `select schedule from cron.job where jobname = 'terron-evaluate-transfers'`)).toBe('17 * * * *')
  })

  it('create_transfer: qabul obyekti faol bo`lmasa — transfer_object_not_found', async () => {
    const r = await as('admin', async (tx) => {
      await tx.query(`update public.objects set status = 'yakunlangan' where id = $1`, [A.ids.obj3])
      return res(tx, `select public.create_transfer($1, $2, $3, $4, $5, 1, null)`, [randomUUID(), A.ids.obj1, A.ids.obj3, A.ids.m1, qopId])
    })
    expect(r).toBe('P0002:transfer_object_not_found')
  })

  it('Y4 — o`zi yuborib o`zi qabul qilsa → ozi_qabul_qilgan (belgi), Telegram navbatiga tushmaydi', async () => {
    const r = await as('admin', async (tx) => {
      const id = await create(tx, A.ids.obj1!, A.ids.obj2!, '2')
      await tx.query(`select public.receive_transfer($1)`, [id])
      const al = await alertsOf(tx, 'ozi_qabul_qilgan', `details ->> 'transfer_id' = $1`, [id])
      const outbox = await sys(tx, () =>
        scalar<number>(tx, `select count(*)::int from public.notification_outbox where alert_id = $1`, [al[0]!.id]),
      )
      return { id, al, outbox }
    })
    expect(r.al).toHaveLength(1)
    expect(r.al[0]).toMatchObject({ severity: 'belgi', object_id: A.ids.obj2 })
    expect(r.al[0]!.movement_id).toBeTruthy()
    expect(r.al[0]!.details).toEqual({
      transfer_id: r.id,
      qty_base: 100,
      buyer_id: null,
      receiver_id: A.users.admin.profileId,
      kind: 'transfer',
    })
    expect(r.outbox).toBe(0)
  })

  it('P9 — yaratuvchi from obyektdan chiqarilgan bo`lsa bekor qila olmaydi', async () => {
    const r = await as('prorab', async (tx) => {
      const id = await create(tx, A.ids.obj1!, A.ids.obj2!, '1')
      await sys(tx, () => tx.query(`update public.object_members set deleted_at = now() where id = $1`, [A.ids.mem_prorab]))
      return res(tx, `select public.cancel_transfer($1, 'x')`, [id])
    })
    expect(r).toBe('42501:transfer_forbidden')
  })
})

describe('review: so`rov, kuchayish, hisobot, isrof (Y5, O1, O2, O3, O7, P4)', () => {
  const request = (tx: Queryable, qty: string): Promise<string> =>
    scalar<string>(
      tx,
      `insert into public.material_requests (company_id, object_id, material_id, unit_id, qty_input, unit_input, qty_base)
       values ($1, $2, $3, $4, $5, '-', 0) returning id`,
      [A.id, A.ids.obj1, A.ids.m1, kgId, qty],
    )

  it('Y5 — "xarid qilindi" orqali bo`lib so`rash endi alert beradi (yetkazilgan hisobga olinadi)', async () => {
    const r = await as('admin', async (tx) => {
      await tx.query(`update public.material_requests set status = 'rad' where id = $1`, [A.ids.mr_obj1])
      const a = await request(tx, '800') // 1000 − max(0, 100) − 0 = 900 → ok
      await tx.query(`update public.material_requests set status = 'xarid_qilindi' where id = $1`, [a])
      await kirim(tx, A.ids.obj1!, '800') // yetkazilgan 900
      const b = await request(tx, '101') // 1000 − 900 − 0 = 100 → ortiq
      const al = await alertsOf(tx, 'smetadan_ortiq_sorov', `request_id = any($1::uuid[])`, [[a, b]])
      return al.map((x) => [x.request_id === b, x.details.delivered_qty_base, x.details.available_qty_base, x.details.over_qty_base])
    })
    expect(r).toEqual([[true, 900, 100, 1]])
  })

  it('O7 — evaluate_request obyekt+material bo`yicha advisory lock oladi', async () => {
    const src = await scalar<string>(db, `select prosrc from pg_proc where oid = 'private.evaluate_request(uuid)'::regprocedure`)
    expect(src).toContain(`pg_advisory_xact_lock(hashtext('terron.request:'`)
  })

  it('O2 — taminotchi tasdiqlay / rad eta olmaydi', async () => {
    const r = await as('taminotchi', async (tx) => [
      await res(tx, `update public.material_requests set status = 'tasdiqlandi' where id = $1`, [A.ids.mr_obj1]),
      await res(tx, `update public.material_requests set status = 'rad' where id = $1`, [A.ids.mr_obj1]),
    ])
    expect(r).toEqual(['42501:request_status_transition', '42501:request_status_transition'])
  })

  it('O1 — kuchayish: jiddiy (1), 50 % (2), 100 % (3) — har biri bir marta outbox`ga', async () => {
    const r = await as('admin', async (tx) => {
      const mv = await chiqim(tx, A.ids.obj1!, '1100') // 10 % — ogohlantirish
      const set = (q: string): Promise<unknown> => tx.query(`update public.movements set qty_input = $2 where id = $1`, [mv, q])
      await set('1300') // 30 % → jiddiy (1)
      await set('1310') // o'zgarish, daraja o'sha
      await set('1600') // 60 % (2)
      await set('2100') // 110 % (3)
      await set('1300') // pastga
      await set('2200') // yana 120 % — 3 allaqachon bor
      const [al] = await alertsOf(tx, 'normadan_oshish')
      return sys(tx, () =>
        rows<{ escalation: number; p: Row }>(
          tx,
          `select escalation, payload as p from public.notification_outbox where alert_id = $1 order by escalation`,
          [al!.id],
        ),
      )
    })
    expect(r.map((x) => [x.escalation, x.p.escalation ?? null, x.p.severity])).toEqual([
      [0, null, 'ogohlantirish'],
      [1, 1, 'jiddiy'],
      [2, 2, 'jiddiy'],
      [3, 3, 'jiddiy'],
    ])
    expect((r[2]!.p.details as Row).over_pct).toBe(60)
  })

  it('O3 — kunlik hisobot: transfers_pending_count, chiqim_without_estimate_count', async () => {
    const r = await as('admin', async (tx) => {
      await scalar(tx, `select public.create_transfer($1, $2, $3, $4, $5, 1, null)`, [randomUUID(), A.ids.obj1, A.ids.obj2, A.ids.m1, qopId])
      await chiqim(tx, A.ids.obj3!, '1') // smetasiz obyekt
      await chiqim(tx, A.ids.obj1!, '1') // smetali
      return sys(tx, () =>
        scalar<Row>(tx, `select private.daily_report_stats($1, now() - interval '1 hour', now() + interval '1 hour')`, [A.id]),
      )
    })
    // fixture: tr_1to2, tr_2to3 (yuborildi) + yangi
    expect(r).toMatchObject({ transfers_pending_count: 3, chiqim_without_estimate_count: 1, chiqim_count: 2 })
  })

  it('P4 — waste_pct o`zgarsa → smeta_ozgarishi (waste_changed)', async () => {
    const r = await as('admin', async (tx) => {
      await setWaste(tx, '7.5')
      await tx.query(`update public.materials set name = name where id = $1`, [A.ids.m1]) // waste o'zgarmadi
      return alertsOf(tx, 'smeta_ozgarishi')
    })
    expect(r).toHaveLength(1)
    expect(r[0]).toMatchObject({ severity: 'ogohlantirish', object_id: null, material_id: A.ids.m1 })
    expect(r[0]!.details).toEqual({
      kind: 'waste_changed',
      material_id: A.ids.m1,
      material_name: 'A sement',
      before: 0,
      after: 7.5,
      actor_name: 'A admin',
    })
  })
})
