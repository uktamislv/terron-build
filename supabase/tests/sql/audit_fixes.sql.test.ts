// Audit tuzatishlari — 20261108000001_audit_fixes.sql (shartnoma: docs/audit-fixes.md).
// Audit PGlite repro'lari (S1–S7) — regressiya testlari sifatida; har bandga musbat va
// manfiy holatlar, rol tekshiruvi va firma izolyatsiyasi.
import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  asUser,
  createDb,
  createMaterial,
  insertRow,
  one,
  rows,
  scalar,
  type Db,
  type Queryable,
  type Row,
  type Tx,
} from './_harness'
import { buildTwoCompanies, type CompanyFixture } from './_fixtures'

let db: Db
let A: CompanyFixture
let B: CompanyFixture
let kgId: string

beforeAll(async () => {
  db = await createDb()
  ;({ A, B } = await buildTwoCompanies(db))
  kgId = await scalar<string>(db, `select id from public.material_units where material_id = $1 and unit = 'kg'`, [A.ids.m1])
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
  await tx.exec('savepoint af_try')
  try {
    const r = await tx.query(sql, params)
    await tx.exec('release savepoint af_try')
    return `OK:${r.affectedRows || r.rows.length}`
  } catch (e) {
    await tx.exec('rollback to savepoint af_try')
    const err = e as { code?: string; hint?: string }
    return `${err.code ?? '?'}:${err.hint ?? ''}`
  }
}

/** Shu tranzaksiyada postgres sifatida (RLS'siz); JWT claims saqlanadi (auth.uid() — foydalanuvchi). */
async function sys<T>(tx: Tx, fn: () => Promise<T>): Promise<T> {
  await tx.exec('reset role')
  try {
    return await fn()
  } finally {
    await tx.exec('set local role authenticated')
  }
}

/** Haqiqiy tizim konteksti: postgres va claims'siz (auth.uid() = null), keyin qaytariladi. */
async function system<T>(tx: Tx, fn: () => Promise<T>): Promise<T> {
  const saved = await one<{ c: string; s: string }>(
    tx,
    `select coalesce(current_setting('request.jwt.claims', true), '') c, coalesce(current_setting('request.jwt.claim.sub', true), '') s`,
  )
  await tx.exec('reset role')
  await tx.query(`select set_config('request.jwt.claims', '', true), set_config('request.jwt.claim.sub', '', true)`)
  try {
    return await fn()
  } finally {
    await tx.query(`select set_config('request.jwt.claims', $1, true), set_config('request.jwt.claim.sub', $2, true)`, [saved.c, saved.s])
    await tx.exec('set local role authenticated')
  }
}

/** service_role sifatida (claims saqlanadi — svc RPC'lar auth.uid ga qaramaydi). */
async function svc<T>(tx: Tx, fn: () => Promise<T>): Promise<T> {
  await tx.exec('set local role service_role')
  try {
    return await fn()
  } finally {
    await tx.exec('set local role authenticated')
  }
}

/** Triggerlarsiz (vaqt ustunlarini orqaga surish). */
async function raw(tx: Tx, sql: string, params: unknown[] = []): Promise<void> {
  await sys(tx, async () => {
    await tx.exec('set local session_replication_role = replica')
    await tx.query(sql, params)
    await tx.exec('set local session_replication_role = origin')
  })
}

/** Boshqa foydalanuvchiga o'tish (shu tranzaksiyada). */
async function switchTo(tx: Tx, role: Role, co: CompanyFixture = A): Promise<void> {
  const uid = co.users[role].authUid
  await tx.query(
    `select set_config('request.jwt.claims', $1, true), set_config('request.jwt.claim.sub', $2, true)`,
    [JSON.stringify({ sub: uid, role: 'authenticated', aud: 'authenticated' }), uid],
  )
}

const as = <T>(role: Role, fn: (tx: Tx) => Promise<T>, co: CompanyFixture = A): Promise<T> =>
  asUser(db, co.users[role].authUid, fn)

const P = (role: Role, co: CompanyFixture = A): string => co.users[role].profileId

let matSeq = 0
/** Yangi material (asosiy birlik kg) — testlar bir-birining qoldig'iga ta'sir qilmasin. */
async function newMat(q: Queryable = db): Promise<{ id: string; unit: string }> {
  const name = `AF material ${++matSeq} ${randomUUID().slice(0, 6)}`
  const id = q === db
    ? await createMaterial(db, { companyId: A.id, name, baseUnit: 'kg' })
    : await scalar<string>(q, `insert into public.materials (company_id, name, base_unit) values ($1, $2, 'kg') returning id`, [A.id, name])
  const unit = await scalar<string>(q, `select id from public.material_units where material_id = $1 and factor = 1`, [id])
  return { id, unit }
}

async function mv(
  tx: Queryable,
  type: 'kirim' | 'chiqim',
  obj: string,
  mat: { id: string; unit: string },
  qty: string,
  o: { at?: string; extra?: Row } = {},
): Promise<string> {
  const extra = o.extra ?? {}
  const cols = Object.keys(extra)
  return scalar<string>(
    tx,
    `insert into public.movements (company_id, type, object_id, material_id, unit_id, qty_input, unit_input, qty_base, occurred_at${cols.map((c) => `, ${c}`).join('')})
     values ($1, $2, $3, $4, $5, $6, '-', 0, coalesce($7::timestamptz, now())${cols.map((_, i) => `, $${i + 8}`).join('')}) returning id`,
    [A.id, type, obj, mat.id, mat.unit, qty, o.at ?? null, ...Object.values(extra)],
  )
}

async function purchase(
  tx: Queryable,
  buyer: string,
  o: { obj: string; mat: { id: string; unit: string }; qty: string; total: string; at?: string; extra?: Row },
): Promise<string> {
  const extra = o.extra ?? {}
  const cols = Object.keys(extra)
  return scalar<string>(
    tx,
    `insert into public.purchases (company_id, buyer_id, object_id, material_id, unit_id, qty_input, unit_input, qty_base,
        unit_price, price_per_base, total_amount, purchased_at${cols.map((c) => `, ${c}`).join('')})
     values ($1, $2, $3, $4, $5, $6, '-', 0, 0, 0, $7, coalesce($8::timestamptz, now())${cols.map((_, i) => `, $${i + 9}`).join('')})
     returning id`,
    [A.id, buyer, o.obj, o.mat.id, o.mat.unit, o.qty, o.total, o.at ?? null, ...Object.values(extra)],
  )
}

interface AlertRow {
  id: string
  type: string
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
      `select id, type::text, status::text, severity::text, details, object_id, material_id, movement_id, purchase_id, request_id
         from public.alerts where company_id = '${co}' and type::text = '${type}' and (${where})
        order by created_at, (select min(l.id) from public.audit_log l where l.record_id = alerts.id), id`,
      params,
    ),
  )

const stockOf = (tx: Tx, obj: string, mat: string): Promise<string> =>
  sys(tx, () => scalar<string>(tx, `select private.object_stock($1, $2, $3)::text`, [A.id, obj, mat]))

const outboxOf = (tx: Tx, where: string, params: unknown[] = []): Promise<Row[]> =>
  sys(tx, () => rows(tx, `select id, kind, ref_id, profile_id, alert_id, status, payload, next_attempt_at, attempts, last_error
                           from public.notification_outbox where ${where} order by created_at, id`, params))

const recipients = (tx: Tx, outboxId: string): Promise<string[]> =>
  svc(tx, async () =>
    (await rows<{ role: string; profile_id: string }>(tx, `select profile_id, role from public.svc_outbox_recipients($1) order by role, profile_id`, [outboxId]))
      .map((r) => r.role),
  )

const photoPath = (co = A.id): string => `${co}/2026/10/${randomUUID()}.jpg`
const sha = (c: string): string => c.repeat(64)

// ============================================================================
// A1 — Qoida 1: bitta bog'lanmagan kirim bitta xaridni qoplaydi (FIFO)
// ============================================================================
describe('A1: xarid ≠ qabul — FIFO taqsimlash', () => {
  it('S1: P1=100, P2=100, bitta bog`lanmagan kirim 100 → faqat P2 da xarid_qabul_farqi; ikkinchi kirim P2 ni yopadi', async () => {
    const r = await as('admin', async (tx) => {
      const mat = await newMat(tx)
      const o = A.ids.obj3!
      const p1 = await purchase(tx, P('taminotchi'), { obj: o, mat, qty: '100', total: '1000000', at: new Date(Date.now() - 30 * 3600e3).toISOString() })
      const p2 = await purchase(tx, P('haydovchi'), { obj: o, mat, qty: '100', total: '1000000', at: new Date(Date.now() - 30 * 3600e3 + 60e3).toISOString() })
      const k1 = await mv(tx, 'kirim', o, mat, '100', { at: new Date(Date.now() - 29 * 3600e3).toISOString() })
      await sys(tx, () => tx.query(`select private.evaluate_due_purchases(now())`))
      const after1 = await alertsOf(tx, 'xarid_qabul_farqi', `object_id = '${o}' and material_id = '${mat.id}'`)
      const cand = await alertsOf(tx, 'kirim_manbasiz', `movement_id = $1`, [k1])
      await mv(tx, 'kirim', o, mat, '100', { at: new Date(Date.now() - 28 * 3600e3).toISOString() })
      const after2 = await alertsOf(tx, 'xarid_qabul_farqi', `object_id = '${o}' and material_id = '${mat.id}'`)
      const alloc1 = await sys(tx, () => rows(tx, `select movement_id from private.receipt_candidates($1)`, [p1]))
      return { p1, p2, k1, after1, cand, after2, alloc1 }
    })
    expect(r.after1).toHaveLength(1)
    expect(r.after1[0]).toMatchObject({ purchase_id: r.p2, status: 'yangi' })
    expect(r.cand).toHaveLength(1)
    expect(r.cand[0]).toMatchObject({ purchase_id: r.p1 })
    expect(r.cand[0]!.details).toMatchObject({ candidate_purchase_id: r.p1 })
    // ikkinchi kirim P2 ga tushadi → covered
    expect(r.after2).toHaveLength(1)
    expect(r.after2[0]).toMatchObject({ purchase_id: r.p2, status: 'yopildi' })
    expect(r.after2[0]!.details).toMatchObject({ closed_reason: 'covered_by_unlinked' })
    expect(r.alloc1).toEqual([{ movement_id: r.k1 }])
  })

  it('bog`langan kirim xaridning farqini kamaytiradi — FIFO keyingi xaridga beradi; 72 soatdan keyingi kirim nomzod emas', async () => {
    const r = await as('admin', async (tx) => {
      const mat = await newMat(tx)
      const o = A.ids.obj3!
      const t0 = Date.now() - 50 * 3600e3
      const p1 = await purchase(tx, P('taminotchi'), { obj: o, mat, qty: '100', total: '1000', at: new Date(t0).toISOString() })
      const p2 = await purchase(tx, P('taminotchi'), { obj: o, mat, qty: '50', total: '500', at: new Date(t0 + 60e3).toISOString() })
      // P1 to'liq bog'langan kirim bilan qabul qilingan
      await mv(tx, 'kirim', o, mat, '100', { at: new Date(t0 + 3600e3).toISOString(), extra: { purchase_id: p1 } })
      const k = await mv(tx, 'kirim', o, mat, '50', { at: new Date(t0 + 2 * 3600e3).toISOString() })
      const p3 = await purchase(tx, P('taminotchi'), { obj: o, mat, qty: '10', total: '100', at: new Date(t0 - 100 * 3600e3).toISOString() })
      return {
        k,
        c1: await sys(tx, () => rows(tx, `select movement_id from private.receipt_candidates($1)`, [p1])),
        c2: await sys(tx, () => rows(tx, `select movement_id from private.receipt_candidates($1)`, [p2])),
        c3: await sys(tx, () => rows(tx, `select movement_id from private.receipt_candidates($1)`, [p3])),
      }
    })
    expect(r.c1).toEqual([])
    expect(r.c2).toEqual([{ movement_id: r.k }])
    expect(r.c3).toEqual([])
  })
})

// ============================================================================
// A2 — manfiy_qoldiq har qanday kamaytiruvchi o'zgarishda
// ============================================================================
describe('A2: manfiy_qoldiq', () => {
  it('S2: kirim o`chirilsa qoldiq −100 → manfiy_qoldiq (movement_type kirim, movement_deleted)', async () => {
    const r = await as('admin', async (tx) => {
      const mat = await newMat(tx)
      const k = await mv(tx, 'kirim', A.ids.obj3!, mat, '100')
      await mv(tx, 'chiqim', A.ids.obj3!, mat, '100')
      await tx.query(`update public.movements set deleted_at = now() where id = $1`, [k])
      return { k, stock: await stockOf(tx, A.ids.obj3!, mat.id), a: await alertsOf(tx, 'manfiy_qoldiq', `material_id = '${mat.id}'`) }
    })
    expect(r.stock).toBe('-100.000000')
    expect(r.a).toHaveLength(1)
    expect(r.a[0]).toMatchObject({ status: 'yangi', movement_id: r.k })
    expect(r.a[0]!.details).toMatchObject({ stock_after: -100, movement_type: 'kirim', movement_deleted: true })
  })

  it('kirim miqdori kamaytirilsa (admin) — alert; transfer_in o`chirilsa (tizim) — alert', async () => {
    const r = await as('admin', async (tx) => {
      const mat = await newMat(tx)
      const k = await mv(tx, 'kirim', A.ids.obj3!, mat, '100')
      await mv(tx, 'chiqim', A.ids.obj3!, mat, '80')
      await tx.query(`update public.movements set qty_input = 50 where id = $1`, [k])
      const a1 = await alertsOf(tx, 'manfiy_qoldiq', `material_id = '${mat.id}'`)

      const mat2 = await newMat(tx)
      await mv(tx, 'kirim', A.ids.obj1!, mat2, '60')
      const tid = randomUUID()
      await tx.query(`select public.create_transfer($1, $2, $3, $4, $5, 50, null)`, [tid, A.ids.obj1, A.ids.obj3, mat2.id, mat2.unit])
      await tx.query(`select public.receive_transfer($1, null, null)`, [tid])
      await mv(tx, 'chiqim', A.ids.obj3!, mat2, '50')
      const tin = await scalar<string>(tx, `select id from public.movements where transfer_id = $1 and type = 'transfer_in'`, [tid])
      await system(tx, () => tx.query(`update public.movements set deleted_at = now() where id = $1`, [tin]))
      const a2 = await alertsOf(tx, 'manfiy_qoldiq', `material_id = '${mat2.id}'`)
      return { a1, a2, tin }
    })
    expect(r.a1).toHaveLength(1)
    expect(r.a1[0]!.details).toMatchObject({ stock_after: -30, movement_type: 'kirim', movement_deleted: false })
    expect(r.a2).toHaveLength(1)
    expect(r.a2[0]).toMatchObject({ movement_id: r.tin, object_id: A.ids.obj3 })
    expect(r.a2[0]!.details).toMatchObject({ stock_after: -50, movement_type: 'transfer_in', movement_deleted: true })
  })

  it('24 soat ichida qayta manfiy — o`sha alert qayta ochiladi (audit2 L3); qo`lda yopilgandan keyin qoldiqni OSHIRGAN kirim yangi alert yaratmaydi', async () => {
    const r = await as('admin', async (tx) => {
      const mat = await newMat(tx)
      const o = A.ids.obj3!
      const k1 = await mv(tx, 'kirim', o, mat, '100')
      await mv(tx, 'chiqim', o, mat, '100')
      await tx.query(`update public.movements set deleted_at = now() where id = $1`, [k1]) // −100 → alert
      const k2 = await mv(tx, 'kirim', o, mat, '200') // +100 → stock_restored
      await tx.query(`update public.movements set deleted_at = now() where id = $1`, [k2]) // −100 → bostiriladi
      const sup = await alertsOf(tx, 'manfiy_qoldiq', `material_id = '${mat.id}'`)

      const mat2 = await newMat(tx)
      const k3 = await mv(tx, 'kirim', o, mat2, '10')
      await mv(tx, 'chiqim', o, mat2, '110')
      const open = (await alertsOf(tx, 'manfiy_qoldiq', `material_id = '${mat2.id}'`))[0]!
      await tx.query(`update public.alerts set status = 'yopildi', close_note = 'Tekshirildi' where id = $1`, [open.id])
      await mv(tx, 'kirim', o, mat2, '50') // −100 → −50: kamaymadi
      const afterManual = await alertsOf(tx, 'manfiy_qoldiq', `material_id = '${mat2.id}'`)
      return { sup, afterManual, k3 }
    })
    expect(r.sup).toHaveLength(1)
    // audit2 L3: yopilgan alert qayta ochiladi (yangi Telegram xabarisiz)
    expect(r.sup[0]).toMatchObject({ status: 'yangi' })
    expect(r.sup[0]!.details).toMatchObject({ stock_after: -100, movement_type: 'kirim', reopen_count: 1 })
    expect(r.sup[0]!.details.reopened_at).toBeTruthy()
    expect(r.afterManual).toHaveLength(1)
    expect(r.afterManual[0]!.status).toBe('yopildi')
  })
})

// ============================================================================
// A3 — inventarizatsiya: kutilgan qoldiq sanalgan vaqtdagi
// ============================================================================
describe('A3: inventarizatsiya kutilgan qoldig`i', () => {
  it('S5: sanalgandan keyingi chiqim kamomad emas; tuzatish 0; qoldiq 70; harakat ogohlantirishi (movements_during_count)', async () => {
    const mat = await newMat()
    // qoldig'i bo'lmagan yangi obyekt — sanalmagan materiallar aralashmasin
    const o = (await insertRow<{ id: string }>(db, 'objects', { company_id: A.id, name: 'AF inventar 1' })).id
    await db.query(
      `insert into public.movements (company_id, type, object_id, material_id, unit_id, qty_input, unit_input, qty_base)
       values ($1, 'kirim', $2, $3, $4, 100, 'x', 0)`, [A.id, o, mat.id, mat.unit])
    const ic = await scalar<string>(db, `insert into public.inventory_counts (company_id, object_id, created_by) values ($1, $2, $3) returning id`, [A.id, o, P('tekshiruvchi')])
    await db.query(`insert into public.inventory_count_items (company_id, inventory_count_id, material_id, qty_counted, created_by)
                    values ($1, $2, $3, 100, $4)`, [A.id, ic, mat.id, P('tekshiruvchi')])
    // sanalgandan keyin 30 chiqim
    await db.query(
      `insert into public.movements (company_id, type, object_id, material_id, unit_id, qty_input, unit_input, qty_base, occurred_at)
       values ($1, 'chiqim', $2, $3, $4, 30, 'x', 0, now() + interval '1 minute')`, [A.id, o, mat.id, mat.unit])
    const sub = await asUser(db, A.users.tekshiruvchi.authUid, (tx) => scalar<Row>(tx, `select public.submit_inventory_count($1)`, [ic]), { commit: true })
    const r = await as('admin', async (tx) => ({
      n: await scalar<number>(tx, `select public.apply_inventory_adjustments($1)`, [ic]),
      st: await stockOf(tx, o, mat.id),
      expected: await sys(tx, () => scalar<string>(tx, `select qty_expected::text from public.inventory_count_items where inventory_count_id = $1`, [ic])),
      al: await alertsOf(tx, 'inventarizatsiya_kamomadi', `inventory_count_id = $1`, [ic]),
    }))
    expect(sub).toEqual({ ok: true }) // audit2 S6: tekshiruvchiga natija ko'rsatilmaydi
    expect(r).toEqual({ n: 0, st: '70.000000', expected: '100.000000', al: [] })
  })

  it('kamomad bo`lsa — alert details.movements_during_count (material bo`yicha son); counted_at tekshiruvchi uchun o`zgarmaydi', async () => {
    const r = await as('tekshiruvchi', async (tx) => {
      const mat = await sys(tx, () => newMat(tx))
      const o = await system(tx, () => scalar<string>(tx, `insert into public.objects (company_id, name) values ($1, 'AF inventar 2') returning id`, [A.id]))
      await system(tx, () => mv(tx, 'kirim', o, mat, '50', { at: new Date(Date.now() - 3600e3).toISOString() }))
      const ic = await scalar<string>(tx, `insert into public.inventory_counts (company_id, object_id) values ($1, $2) returning id`, [A.id, o])
      const it1 = await scalar<string>(tx, `insert into public.inventory_count_items (company_id, inventory_count_id, material_id, qty_counted)
                                             values ($1, $2, $3, 40) returning id`, [A.id, ic, mat.id])
      const forged = await res(tx, `update public.inventory_count_items set counted_at = '2000-01-01' where id = $1`, [it1])
      const cAt = await scalar<boolean>(tx, `select counted_at > now() - interval '1 minute' from public.inventory_count_items where id = $1`, [it1])
      const sub = await scalar<Row>(tx, `select public.submit_inventory_count($1)`, [ic])
      return { forged, cAt, sub, al: await alertsOf(tx, 'inventarizatsiya_kamomadi', `inventory_count_id = $1`, [ic]), mat: mat.id }
    })
    expect(r.forged).toBe('OK:1')
    expect(r.cAt).toBe(true)
    expect(r.sub).toEqual({ ok: true }) // audit2 S6
    expect(r.al).toHaveLength(1)
    expect(r.al[0]!.details).toMatchObject({ movements_during_count: [], movements_during_count_total: 0 })
  })
})

// ============================================================================
// A4 — RPC'siz o'tkazma / inventarizatsiya harakatlari yo'q
// ============================================================================
describe('A4: transfer_* / inventory_adjust faqat RPC orqali', () => {
  it('S4: admin to`g`ridan-to`g`ri transfer_in qo`sha olmaydi (qoldiq o`zgarmaydi); inventory_adjust — ham', async () => {
    const r = await as('admin', async (tx) => {
      const tid = randomUUID()
      await tx.query(`select public.create_transfer($1, $2, $3, $4, $5, 10, null)`, [tid, A.ids.obj1, A.ids.obj2, A.ids.m1, kgId])
      await tx.query(`select public.receive_transfer($1, null, null)`, [tid])
      const before = await stockOf(tx, A.ids.obj2!, A.ids.m1!)
      const tin = await res(tx, `insert into public.movements (company_id, type, object_id, material_id, unit_id, qty_input, unit_input, qty_base, transfer_id, created_by)
                                 values ($1, 'transfer_in', $2, $3, $4, 10, 'kg', 0, $5, $6)`, [A.id, A.ids.obj2, A.ids.m1, kgId, tid, P('admin')])
      const adj = await res(tx, `insert into public.movements (company_id, type, object_id, material_id, unit_id, qty_input, unit_input, qty_base, inventory_count_id, created_by)
                                 values ($1, 'inventory_adjust', $2, $3, $4, -1, 'kg', 0, $5, $6)`, [A.id, A.ids.obj1, A.ids.m1, kgId, A.ids.ic_obj1, P('admin')])
      const after = await stockOf(tx, A.ids.obj2!, A.ids.m1!)
      return { tin, adj, before, after }
    })
    expect(r).toMatchObject({ tin: '42501:movement_rpc_only', adj: '42501:movement_rpc_only' })
    expect(r.after).toBe(r.before)
  })

  it('o`tkazma harakati: izoh — OK; miqdor / o`chirish — movement_rpc_only; tiklash — restore_transfer_movement (tizim ham)', async () => {
    const r = await as('admin', async (tx) => {
      const tid = randomUUID()
      await tx.query(`select public.create_transfer($1, $2, $3, $4, $5, 5, null)`, [tid, A.ids.obj1, A.ids.obj2, A.ids.m1, kgId])
      const out = await scalar<string>(tx, `select id from public.movements where transfer_id = $1`, [tid])
      const note = await res(tx, `update public.movements set note = 'izoh' where id = $1`, [out])
      const qty = await res(tx, `update public.movements set qty_input = 6 where id = $1`, [out])
      const del = await res(tx, `update public.movements set deleted_at = now() where id = $1`, [out])
      await system(tx, () => tx.query(`update public.movements set deleted_at = now() where id = $1`, [out]))
      const restore = await res(tx, `update public.movements set deleted_at = null where id = $1`, [out])
      const sysRestore = await system(tx, () => res(tx, `update public.movements set deleted_at = null where id = $1`, [out]))
      const viaRpc = await res(tx, `select public.restore_record('movements', $1)`, [out])
      return { note, qty, del, restore, sysRestore, viaRpc }
    })
    expect(r).toEqual({
      note: 'OK:1',
      qty: '42501:movement_rpc_only',
      del: '42501:movement_rpc_only',
      restore: '55000:restore_transfer_movement',
      sysRestore: '55000:restore_transfer_movement',
      viaRpc: '55000:restore_transfer_movement',
    })
  })

  it('prorab inventory_adjust / transfer_out qo`sha olmaydi; tizim (seed) — qo`sha oladi', async () => {
    const r = await as('prorab', async (tx) => ({
      adj: await res(tx, `insert into public.movements (company_id, type, object_id, material_id, unit_id, qty_input, unit_input, qty_base, inventory_count_id)
                          values ($1, 'inventory_adjust', $2, $3, $4, -1, 'kg', 0, $5)`, [A.id, A.ids.obj1, A.ids.m1, kgId, A.ids.ic_obj1]),
      tout: await res(tx, `insert into public.movements (company_id, type, object_id, material_id, unit_id, qty_input, unit_input, qty_base, transfer_id)
                           values ($1, 'transfer_out', $2, $3, $4, 1, 'kg', 0, $5)`, [A.id, A.ids.obj1, A.ids.m1, kgId, A.ids.tr_1to2]),
      seed: await system(tx, () =>
        res(tx, `insert into public.movements (company_id, type, object_id, material_id, unit_id, qty_input, unit_input, qty_base, transfer_id)
                 values ($1, 'transfer_out', $2, $3, $4, 1, 'kg', 0, $5)`, [A.id, A.ids.obj1, A.ids.m1, kgId, A.ids.tr_1to2])),
    }))
    expect(r.adj).toMatch(/^42501:/)
    expect(r.tout).toMatch(/^42501:/)
    expect(r.seed).toBe('OK:1')
  })

  it('movements_insert siyosati: faqat kirim / chiqim; tg_movements_rpc_guard — terron.stock qulfi', async () => {
    const pol = await scalar<string>(db, `select pg_get_expr(polwithcheck, polrelid) from pg_policy where polname = 'movements_insert'`)
    expect(pol).toMatch(/kirim.*chiqim/)
    const src = await scalar<string>(db, `select prosrc from pg_proc where proname = 'tg_movements_rpc_guard'`)
    expect(src).toContain('terron.stock:')
  })
})

// ============================================================================
// A5 + B14 — receive_transfer
// ============================================================================
describe('A5 / B14: receive_transfer', () => {
  it('S3: birlik o`chirilgan bo`lsa ham qabul — asosiy birlikda (factor 1, qty_input = qty_base)', async () => {
    const r = await as('admin', async (tx) => {
      const tid = randomUUID()
      await tx.query(`select public.create_transfer($1, $2, $3, $4, $5, 1, null)`, [tid, A.ids.obj1, A.ids.obj2, A.ids.m1, A.ids.u1])
      await tx.query(`update public.material_units set deleted_at = now() where id = $1`, [A.ids.u1])
      const rec = await res(tx, `select public.receive_transfer($1, null, null)`, [tid])
      const mvIn = await one(tx, `select unit_input, qty_input::text, qty_base::text from public.movements where transfer_id = $1 and type = 'transfer_in'`, [tid])
      return { rec, mvIn }
    })
    expect(r).toEqual({ rec: 'OK:1', mvIn: { unit_input: 'kg', qty_input: '50.000000', qty_base: '50.000000' } })
  })

  it('B14: yuborilgandan ko`p — prorab rad; admin izohsiz rad; admin izoh bilan — OK (over); teng miqdor — prorab OK', async () => {
    const r = await as('admin', async (tx) => {
      const t1 = randomUUID()
      const t2 = randomUUID()
      await tx.query(`select public.create_transfer($1, $2, $3, $4, $5, 10, null)`, [t1, A.ids.obj2, A.ids.obj1, A.ids.m1, kgId])
      await tx.query(`select public.create_transfer($1, $2, $3, $4, $5, 10, null)`, [t2, A.ids.obj2, A.ids.obj1, A.ids.m1, kgId])
      await switchTo(tx, 'prorab')
      const proOver = await res(tx, `select public.receive_transfer($1, '15', 'ko''p')`, [t1])
      const proEq = await res(tx, `select public.receive_transfer($1, '10', null)`, [t2])
      await switchTo(tx, 'admin')
      const adminNoNote = await res(tx, `select public.receive_transfer($1, '15', null)`, [t1])
      const adminNote = await res(tx, `select public.receive_transfer($1, '15', 'Qo''shimcha yuk')`, [t1])
      const al = await alertsOf(tx, 'otkazma_farqi', `details ->> 'transfer_id' = $1`, [t1])
      return { proOver, proEq, adminNoNote, adminNote, al }
    })
    expect(r).toMatchObject({
      proOver: '22023:transfer_over_receipt',
      proEq: 'OK:1',
      adminNoNote: '22023:transfer_over_receipt',
      adminNote: 'OK:1',
    })
    expect(r.al).toHaveLength(1)
    expect(r.al[0]!.details).toMatchObject({ direction: 'over', diff_qty_base: 5 })
  })
})

// ============================================================================
// A6 — podotchet sanasi
// ============================================================================
describe('A6: cash_advances.issued_at', () => {
  it('S6: buxgalter issued_at ni o`zgartira olmaydi (cash_amount_locked); izoh — OK; muddati alerti joyida qoladi', async () => {
    const r = await as('buxgalter', async (tx) => {
      const ca = await system(tx, () =>
        scalar<string>(tx, `insert into public.cash_advances (company_id, recipient_id, amount, issued_at) values ($1, $2, 5000000, now() - interval '30 days') returning id`,
          [A.id, P('taminotchi')]))
      await sys(tx, () => tx.query(`select private.evaluate_cash_advances(now())`))
      const upd = await res(tx, `update public.cash_advances set issued_at = now() + interval '1 year' where id = $1`, [ca])
      const note = await res(tx, `update public.cash_advances set note = 'izoh' where id = $1`, [ca])
      await sys(tx, () => tx.query(`select private.evaluate_cash_advances(now())`))
      const al = await alertsOf(tx, 'podotchet_muddati', `details ->> 'profile_id' = $1`, [P('taminotchi')])
      return { upd, note, al }
    })
    expect(r.upd).toBe('P0001:cash_amount_locked')
    expect(r.note).toBe('OK:1')
    expect(r.al).toHaveLength(1)
    expect(r.al[0]!.status).toBe('yangi')
  })

  it('INSERT oynasi: buxgalter o`tgan sana — ops_occurred_at_range; admin — OK + belgi; qaytarish — belgi; oddiy berish / tizim — belgi yo`q', async () => {
    const r = await as('buxgalter', async (tx) => {
      const old = new Date(Date.now() - 10 * 86400e3).toISOString()
      const bux = await res(tx, `insert into public.cash_advances (company_id, recipient_id, amount, issued_at) values ($1, $2, 1000, $3)`, [A.id, P('haydovchi'), old])
      const ret = await scalar<string>(tx, `insert into public.cash_advances (company_id, recipient_id, amount, kind) values ($1, $2, 1000, 'qaytarildi') returning id`, [A.id, P('haydovchi')])
      const plain = await scalar<string>(tx, `insert into public.cash_advances (company_id, recipient_id, amount) values ($1, $2, 1000) returning id`, [A.id, P('haydovchi')])
      await switchTo(tx, 'admin')
      const adm = await scalar<string>(tx, `insert into public.cash_advances (company_id, recipient_id, amount, issued_at) values ($1, $2, 1000, $3) returning id`, [A.id, P('haydovchi'), old])
      const sysRow = await system(tx, () =>
        scalar<string>(tx, `insert into public.cash_advances (company_id, recipient_id, amount, issued_at, kind) values ($1, $2, 1000, $3, 'qaytarildi') returning id`, [A.id, P('haydovchi'), old]))
      const flags = await alertsOf(tx, 'podotchet_belgisi')
      return { bux, ret, plain, adm, sysRow, flags }
    })
    expect(r.bux).toBe('23514:ops_occurred_at_range')
    const byRec = Object.fromEntries(r.flags.map((f) => [f.details.record_id as string, f]))
    expect(byRec[r.ret]).toMatchObject({ severity: 'belgi', details: { reasons: ['qaytarildi'], cash_kind: 'qaytarildi', amount: 1000 } })
    expect(byRec[r.adm]!.details).toMatchObject({ reasons: ['issued_at_outside_window'], actor_profile_id: P('admin') })
    expect(byRec[r.plain]).toBeUndefined()
    expect(byRec[r.sysRow]).toBeUndefined()
  })
})

// ============================================================================
// A7 — qoida 6 qayta baholash
// ============================================================================
describe('A7: smetadan_ortiq_sorov qayta baholanadi', () => {
  const request = (tx: Queryable, qty: string): Promise<string> =>
    scalar<string>(tx, `insert into public.material_requests (company_id, object_id, material_id, unit_id, qty_input, unit_input, qty_base)
                        values ($1, $2, $3, $4, $5, '-', 0) returning id`, [A.id, A.ids.obj1, A.ids.m1, kgId, qty])

  it('qo`shni so`rov rad etilsa — boshqa ochiq so`rov alerti yopiladi (within_threshold)', async () => {
    const r = await as('prorab', async (tx) => {
      const rq = await request(tx, '850') // available = 1000 − 100 − 100 = 800
      const before = await alertsOf(tx, 'smetadan_ortiq_sorov', `request_id = $1`, [rq])
      await switchTo(tx, 'admin')
      await tx.query(`update public.material_requests set status = 'rad', decision_note = 'kerak emas' where id = $1`, [A.ids.mr_obj1])
      const after = await alertsOf(tx, 'smetadan_ortiq_sorov', `request_id = $1`, [rq])
      return { before, after }
    })
    expect(r.before).toHaveLength(1)
    expect(r.before[0]!.status).toBe('yangi')
    expect(r.after[0]).toMatchObject({ status: 'yopildi', details: { closed_reason: 'within_threshold', other_open_qty_base: 0 } })
  })

  it('joriy smeta o`chirilsa (evaluate_object_norms) — ochiq so`rov alerti no_current_estimate bilan yopiladi', async () => {
    const r = await as('prorab', async (tx) => {
      const rq = await request(tx, '850')
      await switchTo(tx, 'admin')
      await tx.query(`update public.estimates set deleted_at = now() where id = $1`, [A.ids.est_obj1])
      return alertsOf(tx, 'smetadan_ortiq_sorov', `request_id = $1`, [rq])
    })
    expect(r).toHaveLength(1)
    expect(r[0]).toMatchObject({ status: 'yopildi', details: { closed_reason: 'no_current_estimate' } })
  })
})

// ============================================================================
// A8 — meta kalitlar (Telegram "Ko'rildi", eslatma) qayta baholashda saqlanadi
// ============================================================================
describe('A8: alert meta saqlanadi (qoida 3, 4, 6)', () => {
  const META = { seen_by_name: 'Admin', seen_via: 'telegram', reminded_at: '2026-10-20T00:00:00Z' }

  it('S7: narx_ogishi — xarid summasi o`zgarsa details yangilanadi, meta qoladi', async () => {
    const r = await as('admin', async (tx) => {
      const mat = await newMat(tx)
      for (const d of [10, 9]) {
        await purchase(tx, P('taminotchi'), { obj: A.ids.obj3!, mat, qty: '10', total: '100000', at: new Date(Date.now() - d * 86400e3).toISOString() })
      }
      const p = await purchase(tx, P('taminotchi'), { obj: A.ids.obj3!, mat, qty: '10', total: '200000' })
      const a = (await alertsOf(tx, 'narx_ogishi', `purchase_id = $1`, [p]))[0]!
      await sys(tx, () => tx.query(`update public.alerts set status = 'korildi', details = details || $2::jsonb where id = $1`, [a.id, JSON.stringify(META)]))
      await tx.query(`update public.purchases set total_amount = 210000 where id = $1`, [p])
      return (await alertsOf(tx, 'narx_ogishi', `id = $1`, [a.id]))[0]!.details
    })
    expect(r).toMatchObject({ ...META, price: 21000, diff_n: 110 })
  })

  it('normadan_oshish va smetadan_ortiq_sorov — meta qoladi', async () => {
    const r = await as('admin', async (tx) => {
      await mv(tx, 'chiqim', A.ids.obj1!, { id: A.ids.m1!, unit: kgId }, '1200') // ruxsat 1000 → oshdi
      const n = (await alertsOf(tx, 'normadan_oshish', `object_id = '${A.ids.obj1}' and status <> 'yopildi'`))[0]!
      await sys(tx, () => tx.query(`update public.alerts set details = details || $2::jsonb where id = $1`, [n.id, JSON.stringify(META)]))
      await mv(tx, 'chiqim', A.ids.obj1!, { id: A.ids.m1!, unit: kgId }, '10')
      const nd = (await alertsOf(tx, 'normadan_oshish', `id = $1`, [n.id]))[0]!.details

      const rq = await scalar<string>(tx, `insert into public.material_requests (company_id, object_id, material_id, unit_id, qty_input, unit_input, qty_base)
                                            values ($1, $2, $3, $4, 500, '-', 0) returning id`, [A.id, A.ids.obj1, A.ids.m1, kgId])
      const q = (await alertsOf(tx, 'smetadan_ortiq_sorov', `request_id = $1`, [rq]))[0]!
      await sys(tx, () => tx.query(`update public.alerts set details = details || $2::jsonb where id = $1`, [q.id, JSON.stringify(META)]))
      await tx.query(`update public.material_requests set qty_input = 600 where id = $1`, [rq])
      const qd = (await alertsOf(tx, 'smetadan_ortiq_sorov', `id = $1`, [q.id]))[0]!.details
      return { nd, qd }
    })
    expect(r.nd).toMatchObject({ ...META, consumed_qty_base: 1210 })
    expect(r.qd).toMatchObject({ ...META, requested_qty_base: 600 })
  })
})

// ============================================================================
// A9, A10, A11, B2 (manual_closed_count), C — kunlik hisobot va dashboard
// ============================================================================
describe('Kunlik hisobot va dashboard (A9, A10, A11)', () => {
  const stats = (tx: Tx): Promise<Row> =>
    sys(tx, () => scalar<Row>(tx, `select private.daily_report_stats($1, now() - interval '1 hour', now() + interval '1 hour')`, [A.id]))

  it('backdated_count: oraliqda yaratilgan, sanasi oraliqdan oldingi harakat va xaridlar', async () => {
    const r = await as('admin', async (tx) => {
      const before = (await stats(tx)).backdated_count as number
      const mat = await newMat(tx)
      const old = new Date(Date.now() - 2 * 86400e3).toISOString()
      await mv(tx, 'kirim', A.ids.obj3!, mat, '1', { at: old })
      await purchase(tx, P('admin'), { obj: A.ids.obj3!, mat, qty: '1', total: '10', at: old })
      await mv(tx, 'kirim', A.ids.obj3!, mat, '1') // bugungi — hisoblanmaydi
      return { before, after: (await stats(tx)).backdated_count as number }
    })
    expect(r.after - r.before).toBe(2)
  })

  it('alerts_new: daily_report va dashboard bitta yordamchidan (private.alerts_new_count); pul — musbat/manfiy alohida', async () => {
    const r = await as('admin', async (tx) => {
      await system(tx, async () => {
        await tx.query(`insert into public.alerts (company_id, type, severity) values ($1, 'narx_ogishi', 'ogohlantirish')`, [A.id])
        await tx.query(`insert into public.alerts (company_id, type, severity) values ($1, 'ozi_qabul_qilgan', 'belgi')`, [A.id])
      })
      const helper = await sys(tx, () =>
        scalar<number>(tx, `select private.alerts_new_count($1, now() - interval '1 hour', now() + interval '1 hour')`, [A.id]))
      const s = await stats(tx)
      const today = await scalar<string>(tx, `select (now() at time zone 'Asia/Tashkent')::date::text`)
      const helperDay = await scalar<number>(tx, `select private.alerts_new_count($1, ($2::date)::timestamp at time zone 'Asia/Tashkent', ($2::date + 1)::timestamp at time zone 'Asia/Tashkent')`, [A.id, today])
      const d = await scalar<Row>(tx, `select public.dashboard_summary($1::date, $1::date)`, [today])
      return { helper, s, d, helperDay }
    })
    expect(r.s.alerts_new).toBe(r.helper)
    expect(r.d.alerts_new_in_period).toBe(r.helperDay)
    expect(Number(r.d.cash_outstanding_sum) - Number(r.d.cash_owed_to_staff_sum)).toBeCloseTo(Number(r.d.cash_on_hand_total), 2)
    expect(Number(r.s.cash_outstanding_sum) - Number(r.s.cash_owed_to_staff_sum)).toBeCloseTo(Number(r.d.cash_on_hand_total), 2)
    expect(r.s).toMatchObject({ manual_closed_count: 0, stuck_pending_count: expect.any(Number), failed_7d_count: expect.any(Number) })
  })
})

// ============================================================================
// A13 — miqdor / narx chegaralari
// ============================================================================
describe('A13: barqaror hint`lar', () => {
  it('qty_too_small, qty_too_large, price_too_large', async () => {
    const r = await as('admin', async (tx) => {
      const mat = await newMat(tx)
      const tiny = await scalar<string>(tx, `insert into public.material_units (company_id, material_id, unit, factor) values ($1, $2, 'gramm', 0.0000001) returning id`, [A.id, mat.id])
      return {
        small: await res(tx, `insert into public.movements (company_id, type, object_id, material_id, unit_id, qty_input, unit_input, qty_base) values ($1, 'kirim', $2, $3, $4, 1, '-', 0)`, [A.id, A.ids.obj3, mat.id, tiny]),
        zero: await res(tx, `insert into public.movements (company_id, type, object_id, material_id, unit_id, qty_input, unit_input, qty_base) values ($1, 'kirim', $2, $3, $4, 0, '-', 0)`, [A.id, A.ids.obj3, mat.id, mat.unit]),
        large: await res(tx, `insert into public.movements (company_id, type, object_id, material_id, unit_id, qty_input, unit_input, qty_base) values ($1, 'kirim', $2, $3, $4, 10000000000000, '-', 0)`, [A.id, A.ids.obj3, A.ids.m1, A.ids.u1]),
        price: await res(tx, `insert into public.purchases (company_id, buyer_id, object_id, material_id, unit_id, qty_input, unit_input, qty_base, unit_price, price_per_base, total_amount)
                              values ($1, $2, $3, $4, $5, 0.000001, '-', 0, 0, 0, 1000000000)`, [A.id, P('admin'), A.ids.obj3, mat.id, mat.unit]),
        ok: await res(tx, `insert into public.movements (company_id, type, object_id, material_id, unit_id, qty_input, unit_input, qty_base) values ($1, 'kirim', $2, $3, $4, 1, '-', 0)`, [A.id, A.ids.obj3, mat.id, mat.unit]),
      }
    })
    expect(r).toEqual({
      small: '23514:qty_too_small',
      zero: '23514:qty_too_small',
      large: '22003:qty_too_large',
      price: '22003:price_too_large',
      ok: 'OK:1',
    })
  })
})

// ============================================================================
// A14 — set_current_estimate qulfdan keyin qayta o'qiydi
// ============================================================================
describe('A14: set_current_estimate', () => {
  it('qulfdan keyin `for update` bilan qayta tekshiradi; o`chirilgan smeta — estimate_not_found', async () => {
    const src = await scalar<string>(db, `select prosrc from pg_proc where proname = 'set_current_estimate'`)
    expect(src).toMatch(/pg_advisory_xact_lock[\s\S]*for update/)
    const r = await as('admin', async (tx) => {
      await tx.query(`update public.estimates set deleted_at = now() where id = $1`, [A.ids.est_obj2])
      return res(tx, `select public.set_current_estimate($1)`, [A.ids.est_obj2])
    })
    expect(r).toBe('P0002:estimate_not_found')
  })
})

// ============================================================================
// B1 + D1 — joylashtirilgan yozuv o'zgarishi va correct_entry
// ============================================================================
describe('B1: yozuv_ozgartirildi', () => {
  it('admin harakat miqdorini o`zgartirsa — ogohlantirish (before/after, aktyor) + Telegram navbati; izoh — yo`q; tizim — yo`q', async () => {
    const r = await as('admin', async (tx) => {
      const mat = await newMat(tx)
      const k = await mv(tx, 'kirim', A.ids.obj3!, mat, '10')
      await tx.query(`update public.movements set qty_input = 12 where id = $1`, [k])
      await tx.query(`update public.movements set note = 'izoh' where id = $1`, [k])
      await system(tx, () => tx.query(`update public.movements set qty_input = 13 where id = $1`, [k]))
      const a = await alertsOf(tx, 'yozuv_ozgartirildi', `movement_id = $1`, [k])
      return { k, a, ob: a[0] ? await outboxOf(tx, `alert_id = $1`, [a[0].id]) : [] }
    })
    expect(r.a).toHaveLength(1)
    expect(r.a[0]).toMatchObject({ severity: 'ogohlantirish', status: 'yangi' })
    expect(r.a[0]!.details).toMatchObject({
      table: 'movements',
      record_id: r.k,
      changed: ['qty_base', 'qty_input'],
      before: { qty_input: 10, qty_base: 10, unit_input: 'kg' },
      after: { qty_input: 12, qty_base: 12, unit_input: 'kg' },
      via: 'direct',
      actor_profile_id: P('admin'),
      movement_type: 'kirim',
    })
    expect(r.ob).toHaveLength(1)
  })

  it('xarid summasi o`zgarsa — total_amount, unit_price, price_per_base', async () => {
    const r = await as('admin', async (tx) => {
      const mat = await newMat(tx)
      const p = await purchase(tx, P('taminotchi'), { obj: A.ids.obj3!, mat, qty: '10', total: '1000' })
      await tx.query(`update public.purchases set total_amount = 1500 where id = $1`, [p])
      return alertsOf(tx, 'yozuv_ozgartirildi', `purchase_id = $1`, [p])
    })
    expect(r).toHaveLength(1)
    expect(r[0]!.details).toMatchObject({
      table: 'purchases',
      changed: ['price_per_base', 'total_amount', 'unit_price'],
      before: { total_amount: 1000 },
      after: { total_amount: 1500 },
    })
  })
})

describe('D1: correct_entry', () => {
  it('muallif 30 daqiqa ichida — OK, yozuv_tuzatildi (belgi), audit UPDATE; omborchi — correct_forbidden; muddat o`tgan — correct_window_passed', async () => {
    const r = await as('prorab', async (tx) => {
      const mat = await sys(tx, () => newMat(tx))
      const k = await mv(tx, 'kirim', A.ids.obj1!, mat, '10')
      const ok = await res(tx, `select public.correct_entry('movements', $1, 12, null, null, 'Tuzatildi')`, [k])
      const row = await one(tx, `select qty_base::text, note from public.movements where id = $1`, [k])
      const belgi = await alertsOf(tx, 'yozuv_tuzatildi', `movement_id = $1`, [k])
      const changed = await alertsOf(tx, 'yozuv_ozgartirildi', `movement_id = $1`, [k])
      const audit = await sys(tx, () =>
        scalar<number>(tx, `select count(*)::int from public.audit_log where record_id = $1 and action = 'UPDATE' and actor_profile_id = $2`, [k, P('prorab')]))
      await switchTo(tx, 'omborchi')
      const other = await res(tx, `select public.correct_entry('movements', $1, 13, null, null, null)`, [k])
      await switchTo(tx, 'prorab')
      await raw(tx, `update public.movements set created_at = now() - interval '31 minutes' where id = $1`, [k])
      const late = await res(tx, `select public.correct_entry('movements', $1, 14, null, null, null)`, [k])
      return { ok, row, belgi, changed, audit, other, late }
    })
    expect(r.ok).toBe('OK:1')
    expect(r.row).toEqual({ qty_base: '12.000000', note: 'Tuzatildi' })
    expect(r.belgi).toHaveLength(1)
    expect(r.belgi[0]).toMatchObject({ severity: 'belgi', details: { via: 'correct_entry', before: { qty_input: 10 }, after: { qty_input: 12 } } })
    expect(r.changed).toEqual([])
    expect(r.audit).toBe(1)
    expect(r.other).toBe('42501:correct_forbidden')
    expect(r.late).toBe('55000:correct_window_passed')
  })

  it('bog`langan yozuv — correct_linked; admin istalgan vaqtda — yozuv_ozgartirildi; noto`g`ri kirish — correct_invalid; boshqa firma — correct_not_found', async () => {
    const r = await as('taminotchi', async (tx) => {
      const mat = await sys(tx, () => newMat(tx))
      const p = await purchase(tx, P('taminotchi'), { obj: A.ids.obj3!, mat, qty: '10', total: '1000' })
      const pOk = await res(tx, `select public.correct_entry('purchases', $1, null, null, 1100, null)`, [p])
      const total = await scalar<string>(tx, `select total_amount::text from public.purchases where id = $1`, [p])
      await switchTo(tx, 'admin')
      await mv(tx, 'kirim', A.ids.obj3!, mat, '10', { extra: { purchase_id: p } })
      await switchTo(tx, 'taminotchi')
      const pLinked = await res(tx, `select public.correct_entry('purchases', $1, null, null, 1200, null)`, [p])
      await switchTo(tx, 'admin')
      const kLinked = await res(tx, `select public.correct_entry('movements', $1, 1, null, null, null)`, [A.ids.mv_obj1])
      const bad1 = await res(tx, `select public.correct_entry('x', $1, 1, null, null, null)`, [A.ids.mv_obj1])
      const bad2 = await res(tx, `select public.correct_entry('movements', $1, 0, null, null, null)`, [A.ids.mv_obj1])
      const bad3 = await res(tx, `select public.correct_entry('movements', $1, 1, null, 5, null)`, [A.ids.mv_obj1])
      await switchTo(tx, 'admin')
      const old = await mv(tx, 'chiqim', A.ids.obj3!, mat, '1')
      await raw(tx, `update public.movements set created_at = now() - interval '10 days' where id = $1`, [old])
      const admin = await res(tx, `select public.correct_entry('movements', $1, 2, null, null, null)`, [old])
      const adminAlert = await alertsOf(tx, 'yozuv_ozgartirildi', `movement_id = $1`, [old])
      await switchTo(tx, 'admin', B)
      const foreign = await res(tx, `select public.correct_entry('movements', $1, 2, null, null, null)`, [old])
      return { pOk, total, pLinked, kLinked, bad1, bad2, bad3, admin, adminAlert, foreign }
    })
    expect(r).toMatchObject({
      pOk: 'OK:1',
      total: '1100.00',
      pLinked: '55000:correct_linked',
      kLinked: 'OK:1', // audit2: xaridga bog'langan kirimni tuzatish mumkin
      bad1: '22023:correct_invalid',
      bad2: '22023:correct_invalid',
      bad3: '22023:correct_invalid',
      admin: 'OK:1',
      foreign: 'P0002:correct_not_found',
    })
    expect(r.adminAlert).toHaveLength(1)
    expect(r.adminAlert[0]!.details).toMatchObject({ via: 'correct_entry', actor_profile_id: P('admin') })
  })
})

// ============================================================================
// B2 — sozlamalar, chegaralar, yopish izohi, himoyalangan profillar
// ============================================================================
describe('B2: sozlamalar va boshqaruv', () => {
  it('sozlama o`zgarsa — sozlama_ozgardi (before/after, Telegram); faqat nom — yo`q; tizim — yo`q', async () => {
    const r = await as('admin', async (tx) => {
      await tx.query(`update public.companies set price_deviation_pct = 10, quiet_hours_start = '23:00' where id = $1`, [A.id])
      await tx.query(`update public.companies set name = 'A firma (yangi)' where id = $1`, [A.id])
      await system(tx, () => tx.query(`update public.companies set cash_max_days = 20 where id = $1`, [A.id]))
      const a = await alertsOf(tx, 'sozlama_ozgardi')
      return { a, ob: a[0] ? await outboxOf(tx, `alert_id = $1`, [a[0].id]) : [] }
    })
    expect(r.a).toHaveLength(1)
    expect(r.a[0]).toMatchObject({ severity: 'ogohlantirish' })
    expect(r.a[0]!.details).toMatchObject({
      changes: [
        { key: 'price_deviation_pct', before: 8, after: 10 },
        { key: 'quiet_hours_start', before: '22:00:00', after: '23:00:00' },
      ],
      actor_profile_id: P('admin'),
    })
    expect(r.ob).toHaveLength(1)
  })

  it('chegaralar: price_deviation ≤ 50, receipt_mismatch ≤ 50, request_overbuy ≤ 200, duplicate_window ≥ 1, alert_remind ≤ 168', async () => {
    const r = await as('admin', async (tx) => {
      const set = (sql: string): Promise<string> => res(tx, `update public.companies set ${sql} where id = $1`, [A.id])
      return {
        pd: await set('price_deviation_pct = 51'),
        pdOk: await set('price_deviation_pct = 50'),
        rm: await set('receipt_mismatch_pct = 50.01'),
        ro: await set('request_overbuy_pct = 201'),
        roOk: await set('request_overbuy_pct = 200'),
        dw: await set('duplicate_window_minutes = 0'),
        ar: await set('alert_remind_hours = 169'),
        arOk: await set('alert_remind_hours = 168'),
      }
    })
    expect(r).toEqual({ pd: '23514:', pdOk: 'OK:1', rm: '23514:', ro: '23514:', roOk: 'OK:1', dw: '23514:', ar: '23514:', arOk: 'OK:1' })
  })

  it('alertni yopishda close_note majburiy; qo`lda yopish — manual_closed_count; tizim yopishi — tekshirilmaydi', async () => {
    const r = await as('admin', async (tx) => {
      const noNote = await res(tx, `update public.alerts set status = 'yopildi' where id = $1`, [A.ids.alert1])
      const blank = await res(tx, `update public.alerts set status = 'yopildi', close_note = '   ' where id = $1`, [A.ids.alert1])
      const ok = await res(tx, `update public.alerts set status = 'yopildi', close_note = ' Tekshirildi ' where id = $1`, [A.ids.alert1])
      const row = await sys(tx, () => one(tx, `select close_note, details from public.alerts where id = $1`, [A.ids.alert1]))
      const sysClose = await system(tx, async () => {
        const id = await scalar<string>(tx, `insert into public.alerts (company_id, type) values ($1, 'narx_ogishi') returning id`, [A.id])
        return res(tx, `update public.alerts set status = 'yopildi' where id = $1`, [id])
      })
      const s = await sys(tx, () => scalar<Row>(tx, `select private.daily_report_stats($1, now() - interval '1 hour', now() + interval '1 hour')`, [A.id]))
      return { noNote, blank, ok, row, sysClose, manual: s.manual_closed_count }
    })
    expect(r.noNote).toBe('23514:alert_close_note_required')
    expect(r.blank).toBe('23514:alert_close_note_required')
    expect(r.ok).toBe('OK:1')
    expect(r.row.close_note).toBe('Tekshirildi')
    expect(r.row.details).toMatchObject({ manual_closed_by: P('admin') })
    expect(r.sysClose).toBe('OK:1')
    expect(r.manual).toBe(1)
  })

  it('admin: direktor / admin profilining role, phone, is_active, deleted_at — profile_protected; ismi — OK; prorab — OK; super_admin — OK', async () => {
    const r = await as('admin', async (tx) => {
      const dir = P('direktor')
      const out = {
        role: await res(tx, `update public.profiles set role = 'prorab' where id = $1`, [dir]),
        phone: await res(tx, `update public.profiles set phone = '+998900000001' where id = $1`, [dir]),
        active: await res(tx, `update public.profiles set is_active = false where id = $1`, [dir]),
        del: await res(tx, `update public.profiles set deleted_at = now() where id = $1`, [dir]),
        selfActive: await res(tx, `update public.profiles set is_active = false where id = $1`, [P('admin')]),
        name: await res(tx, `update public.profiles set full_name = 'Direktor (yangi)' where id = $1`, [dir]),
        prorabPhone: await res(tx, `update public.profiles set phone = '+998900000002' where id = $1`, [P('prorab')]),
        promote: await res(tx, `update public.profiles set role = 'direktor' where id = $1`, [P('buxgalter')]),
        sa: '',
      }
      await switchTo(tx, 'super_admin')
      out.sa = await res(tx, `update public.profiles set role = 'admin' where id = $1`, [dir])
      return out
    })
    expect(r).toEqual({
      role: '42501:profile_protected',
      phone: '42501:profile_protected',
      active: '42501:profile_protected',
      del: '42501:profile_protected',
      selfActive: '42501:profile_protected',
      name: '42501:profile_protected', // audit2 S7
      prorabPhone: 'OK:1',
      promote: '42501:profile_protected', // audit2 S7
      sa: 'OK:1',
    })
  })
})

// ============================================================================
// B3 — svc_alert_login_set
// ============================================================================
describe('B3: svc_alert_login_set', () => {
  it('login_ozgardi (direktor/admin) + egasiga login_changed; boshqa firma aktyori — null; noma`lum profil — P0002; authenticated — 42501', async () => {
    const r = await as('admin', async (tx) => {
      await sys(tx, async () => {
        await tx.query(`update public.profiles set telegram_chat_id = 9301 where id = $1`, [P('prorab')])
        await tx.query(`update public.profiles set telegram_chat_id = 9302 where id = $1`, [P('direktor')])
      })
      const id = await svc(tx, () => scalar<string>(tx, `select public.svc_alert_login_set($1, $2)`, [P('prorab'), P('admin')]))
      const id2 = await svc(tx, () => scalar<string>(tx, `select public.svc_alert_login_set($1, $2)`, [P('prorab'), P('admin', B)]))
      const missing = await svc(tx, () => res(tx, `select public.svc_alert_login_set($1, $2)`, [randomUUID(), P('admin')]))
      const user = await res(tx, `select public.svc_alert_login_set($1, $2)`, [P('prorab'), P('admin')])
      const a = await alertsOf(tx, 'login_ozgardi', `id = $1`, [id])
      const a2 = await alertsOf(tx, 'login_ozgardi', `id = $1`, [id2])
      const ob = await outboxOf(tx, `kind = 'login_changed' and ref_id = $1`, [id])
      const alertOb = await outboxOf(tx, `kind = 'alert' and alert_id = $1`, [id])
      return {
        a, a2, ob, missing, user,
        rec: await recipients(tx, ob[0]!.id as string),
        alertRec: await recipients(tx, alertOb[0]!.id as string),
      }
    })
    expect(r.a[0]).toMatchObject({ severity: 'ogohlantirish', details: { target_profile_id: P('prorab'), target_role: 'prorab', actor_profile_id: P('admin') } })
    expect(r.a2[0]!.details).toMatchObject({ actor_profile_id: null, actor_name: null })
    expect(r.ob).toHaveLength(1)
    expect(r.ob[0]).toMatchObject({ profile_id: P('prorab'), payload: { profile_id: P('prorab'), alert_id: r.a[0]!.id } })
    expect(r.rec).toEqual(['prorab'])
    expect(r.alertRec).toEqual(['direktor'])
    expect(r.missing).toBe('P0002:login_target_not_found')
    expect(r.user).toBe('42501:')
  })
})

// ============================================================================
// B5 — svc_set_photo_hash
// ============================================================================
describe('B5: svc_set_photo_hash', () => {
  it('oq ro`yxat (photo_hash_invalid), authenticated — 42501; klient xeshi UPDATE`da ham e`tiborsiz', async () => {
    const r = await as('admin', async (tx) => {
      const mat = await newMat(tx)
      const k = await mv(tx, 'kirim', A.ids.obj3!, mat, '1', { extra: { photo_path: photoPath() } })
      const badTable = await svc(tx, () => res(tx, `select public.svc_set_photo_hash('alerts', $1, $2)`, [k, sha('c')]))
      const user = await res(tx, `select public.svc_set_photo_hash('movements', $1, $2)`, [k, sha('c')])
      await svc(tx, () => tx.query(`select public.svc_set_photo_hash('movements', $1, $2)`, [k, sha('c')]))
      await tx.query(`update public.movements set photo_sha256 = $2 where id = $1`, [k, sha('d')])
      const kept = await scalar<string>(tx, `select photo_sha256 from public.movements where id = $1`, [k])
      return { badTable, user, kept }
    })
    expect(r).toEqual({ badTable: '22023:photo_hash_invalid', user: '42501:', kept: sha('c') })
  })
})

// ============================================================================
// B6 — receipt_verified, sotuvchi STIR
// ============================================================================
describe('B6: chek tasdig`i', () => {
  it('summa ±1, qator summasi, bitta qator — tasdiqlanadi; sana > 3 kun yoki mos qator yo`q — yo`q; ko`p qatorli chek rasmni bekor qilmaydi', async () => {
    const r = await as('taminotchi', async (tx) => {
      const me = P('taminotchi')
      const mat = await sys(tx, () => newMat(tx))
      const lookup = (sign: string, payload: unknown, total: number | null, at: string): Promise<unknown> =>
        sys(tx, () => tx.query(`select public.svc_upsert_receipt_lookup($1, null, $2, null, null, $3::jsonb, $4, null, null, $5::timestamptz)`,
          [A.id, sign, JSON.stringify(payload), total, at]))
      const now = new Date().toISOString()
      const old = new Date(Date.now() - 5 * 86400e3).toISOString()
      await lookup('900000000001', { items: [] }, 5000.5, now)
      await lookup('900000000002', { items: [{ name: 'a', sum: '3000' }, { name: 'b', sum: '2000' }] }, 5000, now)
      await lookup('900000000003', { items: [{ name: 'a', sum: '999' }] }, 9999, now)
      await lookup('900000000004', { items: [] }, 5000, old)
      await lookup('900000000005', { items: [{ name: 'a', sum: '1' }, { name: 'b', sum: '2' }] }, 5000, now)
      const p = async (sign: string, total: string): Promise<string> =>
        purchase(tx, me, { obj: A.ids.obj2!, mat, qty: '1', total, extra: { receipt_fiscal_sign: sign } })
      const v = async (id: string): Promise<boolean> => scalar<boolean>(tx, `select receipt_verified from public.purchases where id = $1`, [id])
      const total = await v(await p('900000000001', '5000'))
      const line = await v(await p('900000000002', '3000'))
      const single = await v(await p('900000000003', '7000'))
      const late = await v(await p('900000000004', '5000'))
      const noMatch = await v(await p('900000000005', '4000'))
      // rasm chegarasi: ko'p qatorli tasdiqlangan chek — rasm baribir majburiy; bir qatorli — ozod
      await sys(tx, () => tx.query(`update public.companies set photo_required_amount = 1000 where id = $1`, [A.id]))
      await lookup('900000000006', { items: [{ name: 'a', sum: '3000' }, { name: 'b', sum: '2000' }] }, 5000, now)
      await lookup('900000000007', { items: [{ name: 'a', sum: '3000' }] }, 3000, now)
      const multiNoPhoto = await res(tx, `insert into public.purchases (company_id, buyer_id, object_id, material_id, unit_id, qty_input, unit_input, qty_base, unit_price, price_per_base, total_amount, created_by, receipt_fiscal_sign)
        values ($1, $2, $3, $4, $5, 1, '-', 0, 0, 0, 3000, $2, '900000000006')`, [A.id, me, A.ids.obj2, mat.id, mat.unit])
      const singleNoPhoto = await res(tx, `insert into public.purchases (company_id, buyer_id, object_id, material_id, unit_id, qty_input, unit_input, qty_base, unit_price, price_per_base, total_amount, created_by, receipt_fiscal_sign)
        values ($1, $2, $3, $4, $5, 1, '-', 0, 0, 0, 3000, $2, '900000000007')`, [A.id, me, A.ids.obj2, mat.id, mat.unit])
      return { total, line, single, late, noMatch, multiNoPhoto, singleNoPhoto }
    })
    expect(r).toEqual({
      total: true,
      line: true,
      single: false, // audit2 L1: bitta qatorning o'zi tasdiqlamaydi
      late: false,
      noMatch: false,
      multiNoPhoto: '23514:photo_required',
      singleNoPhoto: 'OK:1',
    })
  })

  it('chekdagi STIR tanlangan sotuvchinikidan farq qilsa — sotuvchi_stir_farqi (belgi); mos — yo`q; tuzatilsa — yopiladi', async () => {
    const r = await as('taminotchi', async (tx) => {
      const me = P('taminotchi')
      const mat = await sys(tx, () => newMat(tx))
      await sys(tx, async () => {
        await tx.query(`update public.suppliers set tin = '123456789' where id = $1`, [A.ids.s1])
        await tx.query(`select public.svc_upsert_receipt_lookup($1, null, '910000000001', null, null, '{}', 100, '987654321', 'Boshqa', now())`, [A.id])
        await tx.query(`select public.svc_upsert_receipt_lookup($1, null, '910000000002', null, null, '{}', 100, '123456789', 'Shu', now())`, [A.id])
      })
      const bad = await purchase(tx, me, { obj: A.ids.obj2!, mat, qty: '1', total: '100', extra: { receipt_fiscal_sign: '910000000001', supplier_id: A.ids.s1 } })
      const good = await purchase(tx, me, { obj: A.ids.obj2!, mat, qty: '1', total: '100', extra: { receipt_fiscal_sign: '910000000002', supplier_id: A.ids.s1 } })
      const a1 = await alertsOf(tx, 'sotuvchi_stir_farqi', `purchase_id = $1`, [bad])
      const a2 = await alertsOf(tx, 'sotuvchi_stir_farqi', `purchase_id = $1`, [good])
      await switchTo(tx, 'admin')
      await tx.query(`update public.purchases set supplier_id = null where id = $1`, [bad])
      const a3 = await alertsOf(tx, 'sotuvchi_stir_farqi', `purchase_id = $1`, [bad])
      return { a1, a2, a3 }
    })
    expect(r.a1).toHaveLength(1)
    expect(r.a1[0]).toMatchObject({ severity: 'belgi', details: { seller_tin: '987654321', supplier_tin: '123456789' } })
    expect(r.a2).toEqual([])
    expect(r.a3[0]).toMatchObject({ status: 'yopildi', details: { closed_reason: 'not_applicable' } })
  })
})

// ============================================================================
// B11, B13 — smeta alerti firma tekshiruvi, ko'r-ko'rona sanash
// ============================================================================
describe('B11 / B13', () => {
  it('B11: estimate_alert boshqa firma smetasi uchun — estimate_direct_edit; o`z firmasi, o`chirilmagan smeta — alert yo`q', async () => {
    const foreign = await as('admin', (tx) => res(tx, `select private.estimate_alert('current_deleted', $1, null)`, [A.ids.est_obj1]), B)
    const own = await as('admin', async (tx) => {
      await tx.query(`select private.estimate_alert('current_deleted', $1, null)`, [A.ids.est_obj1])
      return (await alertsOf(tx, 'smeta_ozgarishi')).length
    })
    expect(foreign).toBe('42501:estimate_direct_edit')
    expect(own).toBe(0)
  })

  it('B13: tekshiruvchi o`tkazma, so`rov, smeta va smeta qatorlarini ko`rmaydi; inventarizatsiya hisoblari (holati bilan) — ko`radi (D6)', async () => {
    const r = await as('tekshiruvchi', async (tx) => ({
      transfers: await scalar<number>(tx, `select count(*)::int from public.transfers`),
      requests: await scalar<number>(tx, `select count(*)::int from public.material_requests`),
      estimates: await scalar<number>(tx, `select count(*)::int from public.estimates`),
      items: await scalar<number>(tx, `select count(*)::int from public.estimate_items`),
      counts: await rows(tx, `select id, status::text from public.inventory_counts where created_by = $1 and id = any($2) order by id`,
        [P('tekshiruvchi'), [A.ids.ic_obj1, A.ids.ic_obj2]]),
    }))
    expect(r).toMatchObject({ transfers: 0, requests: 0, estimates: 0, items: 0 })
    expect(r.counts).toHaveLength(2)
    expect(r.counts.every((c) => c.status === 'draft')).toBe(true)
  })
})

// ============================================================================
// Profillar — telefon va Telegram id faqat admin'ga
// ============================================================================
describe('profillar: profile_directory', () => {
  it('prorab boshqa profil telefonini ko`rmaydi; o`zini to`liq ko`radi; directory — ism/rol; boshqa firma — yo`q', async () => {
    const r = await as('prorab', async (tx) => ({
      others: await scalar<number>(tx, `select count(*)::int from public.profiles where id <> $1`, [P('prorab')]),
      me: await one(tx, `select phone, role::text from public.profiles where id = $1`, [P('prorab')]),
      dirCols: Object.keys(await one(tx, `select * from public.profile_directory where id = $1`, [P('direktor')])).sort(),
      dirName: await scalar<string>(tx, `select full_name from public.profile_directory where id = $1`, [P('direktor')]),
      foreign: await scalar<number>(tx, `select count(*)::int from public.profile_directory where company_id = $1`, [B.id]),
      buyer: await scalar<string | null>(tx, `select buyer_name from public.open_purchases($1, $2) where id = $3`, [A.ids.obj1, A.ids.m1, A.ids.p_tam_obj1]),
    }))
    expect(r.others).toBe(0)
    expect(r.me.role).toBe('prorab')
    expect(r.dirCols).toEqual(['company_id', 'deleted_at', 'full_name', 'id', 'is_active', 'is_available', 'role'])
    expect(r.dirName).toBe('A direktor')
    expect(r.foreign).toBe(0)
    expect(r.buyer).toBe('A taminotchi')
  })

  it('admin — telefon va telegram_blocked_at ko`rinadi; o`z notify_workflow — OK; boshqa ustun — 0 qator', async () => {
    const admin = await as('admin', (tx) => one(tx, `select phone, telegram_blocked_at from public.profiles where id = $1`, [P('prorab')]))
    expect(admin.phone).toMatch(/^\+998/)
    const r = await as('prorab', async (tx) => ({
      mute: await res(tx, `update public.profiles set notify_workflow = false where id = $1`, [P('prorab')]),
      same: await res(tx, `update public.profiles set notify_workflow = false where id = $1`, [P('prorab')]),
      name: await res(tx, `update public.profiles set full_name = 'X', notify_workflow = true where id = $1`, [P('prorab')]),
      other: await res(tx, `update public.profiles set notify_workflow = false where id = $1`, [P('omborchi')]),
      value: await scalar<boolean>(tx, `select notify_workflow from public.profiles where id = $1`, [P('prorab')]),
    }))
    expect(r).toEqual({ mute: 'OK:1', same: 'OK:0', name: 'OK:0', other: 'OK:0', value: false })
  })
})

// ============================================================================
// C — bildirishnoma ekspluatatsiyasi
// ============================================================================
describe('C: tinch soatlar, eskirgan qatorlar, bloklangan chatlar, health', () => {
  it('quiet_until: oyna ichida — tugash vaqti (Toshkent), tashqarida / sozlamasiz — null', async () => {
    const q = (at: string, s: string | null = '22:00', e: string | null = '07:00'): Promise<string | null> =>
      scalar<string | null>(db, `select to_char(private.quiet_until($1::time, $2::time, $3::timestamptz) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI')`, [s, e, at])
    expect(await q('2026-10-26T18:00:00Z')).toBe('2026-10-27T02:00') // 23:00 Toshkent → 07:00 ertasi
    expect(await q('2026-10-26T01:00:00Z')).toBe('2026-10-26T02:00') // 06:00 → 07:00
    expect(await q('2026-10-26T10:00:00Z')).toBeNull() // 15:00
    expect(await q('2026-10-26T18:00:00Z', null, '07:00')).toBeNull()
    expect(await q('2026-10-26T08:30:00Z', '13:00', '14:00')).toBe('2026-10-26T09:00') // 13:30 → 14:00
  })

  it('tinch oynada ogohlantirish kechiktiriladi, jiddiy — olinadi; 36 soatdan eski hisobot — expired', async () => {
    const r = await as('admin', async (tx) => {
      return system(tx, async () => {
        await tx.query(`update public.companies
                           set quiet_hours_start = ((now() at time zone 'Asia/Tashkent') - interval '1 hour')::time,
                               quiet_hours_end   = ((now() at time zone 'Asia/Tashkent') + interval '1 hour')::time
                         where id = $1`, [A.id])
        const soft = await scalar<string>(tx, `insert into public.alerts (company_id, type, severity) values ($1, 'narx_ogishi', 'ogohlantirish') returning id`, [A.id])
        const hard = await scalar<string>(tx, `insert into public.alerts (company_id, type, severity) values ($1, 'narx_ogishi', 'jiddiy') returning id`, [A.id])
        const stale = await scalar<string>(tx, `insert into public.notification_outbox (company_id, kind, report_date, created_at) values ($1, 'daily_report', '2026-01-01', now() - interval '37 hours') returning id`, [A.id])
        await tx.exec('set local role service_role')
        const claimed = await rows<{ alert_id: string | null; id: string }>(tx, `select id, alert_id from public.svc_claim_notifications(100)`)
        await tx.exec('reset role')
        const softRow = await one(tx, `select status, next_attempt_at > now() as deferred from public.notification_outbox where alert_id = $1`, [soft])
        const staleRow = await one(tx, `select status, last_error from public.notification_outbox where id = $1`, [stale])
        return { claimedHard: claimed.some((c) => c.alert_id === hard), claimedSoft: claimed.some((c) => c.alert_id === soft), softRow, staleRow }
      })
    })
    expect(r).toEqual({
      claimedHard: true,
      claimedSoft: false,
      softRow: { status: 'pending', deferred: true },
      staleRow: { status: 'failed', last_error: 'expired' },
    })
  })

  it('bloklangan chat: qabul qiluvchilardan chiqadi; complete(p_blocked_chat_ids) belgilaydi; eski 6 argumentli chaqiruv; retry_after urinishni qaytaradi', async () => {
    const r = await as('admin', async (tx) => {
      await sys(tx, async () => {
        await tx.query(`update public.profiles set telegram_chat_id = 9401 where id = $1`, [P('admin')])
        await tx.query(`update public.profiles set telegram_chat_id = 9402 where id = $1`, [P('direktor')])
      })
      const alert = await system(tx, () => scalar<string>(tx, `insert into public.alerts (company_id, type, severity) values ($1, 'narx_ogishi', 'jiddiy') returning id`, [A.id]))
      const ob = (await outboxOf(tx, `alert_id = $1`, [alert]))[0]!.id as string
      const before = await recipients(tx, ob)
      const marked = await svc(tx, () => scalar<number>(tx, `select public.svc_mark_chat_blocked(9402, true)`))
      const blocked = await recipients(tx, ob)
      const unmarked = await svc(tx, () => scalar<number>(tx, `select public.svc_mark_chat_blocked(9402, false)`))
      const userCall = await res(tx, `select public.svc_mark_chat_blocked(9402, true)`)

      // claim → complete (retry_after) → attempts qaytadi; keyin p_blocked_chat_ids bilan
      const claimed = await svc(tx, async () => {
        return rows<{ id: string; attempts: number }>(tx, `select id, attempts from public.svc_claim_notifications(100)`)
      })
      const mine = claimed.find((c) => c.id === ob)!
      const retry = await svc(tx, () => scalar<string>(tx, `select public.svc_complete_notification($1, false, '{}', 'revoked', 600, false)`, [ob]))
      const attemptsAfterRetry = await sys(tx, () => scalar<number>(tx, `select attempts from public.notification_outbox where id = $1`, [ob]))
      await sys(tx, () => tx.query(`update public.notification_outbox set status = 'sending' where id = $1`, [ob]))
      const done = await svc(tx, () =>
        scalar<string>(tx, `select public.svc_complete_notification(p_id => $1, p_ok => true, p_delivered => array[9401]::bigint[], p_blocked_chat_ids => array[9402]::bigint[])`, [ob]))
      const blockedAt = await scalar<boolean>(tx, `select telegram_blocked_at is not null from public.profiles where id = $1`, [P('direktor')])
      return { before, marked, blocked, unmarked, userCall, claimedAttempts: mine?.attempts, retry, attemptsAfterRetry, done, blockedAt }
    })
    expect(r.before).toEqual(['admin', 'direktor'])
    expect(r.marked).toBe(1)
    expect(r.blocked).toEqual(['admin'])
    expect(r.unmarked).toBe(1)
    expect(r.userCall).toBe('42501:')
    expect(r.claimedAttempts).toBe(1)
    expect(r.retry).toBe('pending')
    expect(r.attemptsAfterRetry).toBe(0)
    expect(r.done).toBe('sent')
    expect(r.blockedAt).toBe(true)
  })

  it('notification_health: admin — kalitlar; prorab — notification_health_forbidden; cron purge ishi va indekslar', async () => {
    const h = await as('admin', (tx) => scalar<Row>(tx, `select public.notification_health()`))
    expect(Object.keys(h).sort()).toEqual(['blocked_profiles', 'failed_7d_count', 'last_errors', 'last_sent_at', 'stuck_pending_count'])
    expect(await as('prorab', (tx) => res(tx, `select public.notification_health()`))).toBe('42501:notification_health_forbidden')
    expect(await scalar<string>(db, `select command from cron.job where jobname = 'terron-cron-purge'`)).toContain('cron.job_run_details')
    const idx = await rows<{ indexname: string }>(db, `select indexname from pg_indexes where indexname in
      ('material_requests_company_created_idx', 'transfers_company_created_idx', 'inventory_counts_company_created_idx') order by 1`)
    expect(idx.map((i) => i.indexname)).toEqual([
      'inventory_counts_company_created_idx', 'material_requests_company_created_idx', 'transfers_company_created_idx',
    ])
  })
})

// ============================================================================
// D2 — ish oqimi bildirishnomalari
// ============================================================================
describe('D2: ish oqimi xabarlari', () => {
  async function chats(tx: Tx): Promise<void> {
    await sys(tx, async () => {
      const set = [['admin', 9501], ['taminotchi', 9502], ['prorab', 9503], ['omborchi', 9504], ['haydovchi', 9505], ['direktor', 9506]] as const
      for (const [role, chat] of set) {
        await tx.query(`update public.profiles set telegram_chat_id = $2 where id = $1`, [P(role), chat])
      }
    })
  }

  it('so`rov: yaratildi → admin; tasdiqlandi → muallif (request_decided) + taminotchi (request_approved); notify_workflow = false — chiqadi', async () => {
    const r = await as('prorab', async (tx) => {
      await chats(tx)
      const rq = await scalar<string>(tx, `insert into public.material_requests (company_id, object_id, material_id, unit_id, qty_input, unit_input, qty_base, note)
                                            values ($1, $2, $3, $4, 5, '-', 0, 'tezroq') returning id`, [A.id, A.ids.obj1, A.ids.m1, A.ids.u1])
      const created = await outboxOf(tx, `kind = 'request_created' and ref_id = $1`, [rq])
      await switchTo(tx, 'admin')
      await tx.query(`update public.material_requests set status = 'tasdiqlandi', decision_note = 'OK' where id = $1`, [rq])
      const decided = await outboxOf(tx, `kind = 'request_decided' and ref_id = $1`, [rq])
      const approved = await outboxOf(tx, `kind = 'request_approved' and ref_id = $1`, [rq])
      const rc = await recipients(tx, created[0]!.id as string)
      const rd = await recipients(tx, decided[0]!.id as string)
      const ra = await recipients(tx, approved[0]!.id as string)
      await sys(tx, () => tx.query(`update public.profiles set notify_workflow = false where id = $1`, [P('taminotchi')]))
      const raMuted = await recipients(tx, approved[0]!.id as string)
      return { created, decided, approved, rc, rd, ra, raMuted }
    })
    expect(r.created).toHaveLength(1)
    expect(r.created[0]!.payload).toMatchObject({ status: 'kutilmoqda', qty_input: 5, unit_input: 'qop', qty_base: 250, base_unit: 'kg', note: 'tezroq', created_by_name: 'A prorab' })
    expect(r.decided[0]).toMatchObject({ profile_id: P('prorab'), payload: { status: 'tasdiqlandi', decision_note: 'OK', decided_by_name: 'A admin' } })
    expect(r.approved).toHaveLength(1)
    // audit2: request_approved — obyektning haydovchi a'zolariga ham
    expect(r).toMatchObject({ rc: ['admin'], rd: ['prorab'], ra: ['haydovchi', 'taminotchi'], raMuted: ['haydovchi'] })
  })

  it('o`tkazma → qabul obyektining prorab/omborchisi; xarid → obyekt prorab/omborchisi (xaridordan tashqari); rad — faqat request_decided', async () => {
    const r = await as('admin', async (tx) => {
      await chats(tx)
      const tid = randomUUID()
      await tx.query(`select public.create_transfer($1, $2, $3, $4, $5, 5, 'devor')`, [tid, A.ids.obj2, A.ids.obj1, A.ids.m1, kgId])
      const ts = await outboxOf(tx, `kind = 'transfer_sent' and ref_id = $1`, [tid])
      await switchTo(tx, 'haydovchi')
      const mat = { id: A.ids.m1!, unit: kgId }
      const p = await purchase(tx, P('haydovchi'), { obj: A.ids.obj1!, mat, qty: '3', total: '30000' })
      const pf = await outboxOf(tx, `kind = 'purchase_for_object' and ref_id = $1`, [p])
      await switchTo(tx, 'admin')
      await tx.query(`update public.material_requests set status = 'rad' where id = $1`, [A.ids.mr_obj1])
      const rad = await outboxOf(tx, `kind in ('request_decided', 'request_approved') and ref_id = $1`, [A.ids.mr_obj1])
      return { ts, tsRec: await recipients(tx, ts[0]!.id as string), pf, pfRec: await recipients(tx, pf[0]!.id as string), rad }
    })
    expect(r.ts[0]!.payload).toMatchObject({ transfer_id: expect.any(String), to_object_id: A.ids.obj1, from_object_name: 'A obj2', qty_base: 5, note: 'devor', sent_by_name: 'A admin' })
    expect(r.tsRec).toEqual(['omborchi', 'prorab'])
    expect(r.pf[0]!.payload).toMatchObject({ object_id: A.ids.obj1, buyer_id: P('haydovchi'), buyer_name: 'A haydovchi', qty_base: 3 })
    expect(r.pfRec).toEqual(['omborchi', 'prorab'])
    expect(r.rad.map((x) => x.kind)).toEqual(['request_decided'])
  })
})

// ============================================================================
// D3 — obyekt alertlari prorab / omborchiga
// ============================================================================
describe('D3: sayt alertlari', () => {
  it('prorab/omborchi a`zo obyektning ruxsat etilgan turlarini ko`radi (o`zgartira olmaydi); firibgarlik turlari va boshqa obyekt — yo`q', async () => {
    const r = await as('admin', async (tx) => {
      const ids = await system(tx, async () => ({
        norm1: await scalar<string>(tx, `insert into public.alerts (company_id, type, object_id) values ($1, 'normadan_oshish', $2) returning id`, [A.id, A.ids.obj1]),
        neg1: await scalar<string>(tx, `insert into public.alerts (company_id, type, object_id) values ($1, 'manfiy_qoldiq', $2) returning id`, [A.id, A.ids.obj1]),
        price1: await scalar<string>(tx, `insert into public.alerts (company_id, type, object_id) values ($1, 'narx_ogishi', $2) returning id`, [A.id, A.ids.obj1]),
        norm2: await scalar<string>(tx, `insert into public.alerts (company_id, type, object_id) values ($1, 'normadan_oshish', $2) returning id`, [A.id, A.ids.obj2]),
      }))
      const seen = async (role: Role, co = A): Promise<string[]> => {
        await switchTo(tx, role, co)
        const x = await rows<{ id: string }>(tx, `select id from public.alerts where id = any($1)`, [Object.values(ids)])
        return Object.entries(ids).filter(([, v]) => x.some((y) => y.id === v)).map(([k]) => k).sort()
      }
      const out = {
        prorab: await seen('prorab'),
        omborchi: await seen('omborchi'),
        haydovchi: await seen('haydovchi'),
        foreign: await seen('prorab', B),
        upd: '',
      }
      await switchTo(tx, 'prorab')
      out.upd = await res(tx, `update public.alerts set status = 'korildi' where id = $1`, [ids.norm1])
      return out
    })
    expect(r).toEqual({ prorab: ['neg1', 'norm1'], omborchi: ['neg1', 'norm1'], haydovchi: [], foreign: [], upd: 'OK:0' })
  })
})

// ============================================================================
// D4, D5 — sotuvchilarni birlashtirish, o'tkazmani bekor qilish
// ============================================================================
describe('D4: merge_suppliers', () => {
  it('admin: xaridlar o`tadi, ikkinchisi o`chiriladi, bo`sh STIR ko`chiriladi; boshqa rol / firma / bir xil id — rad', async () => {
    const r = await as('admin', async (tx) => {
      const s2 = await scalar<string>(tx, `insert into public.suppliers (company_id, name, tin, phone) values ($1, 'Dublikat', '555666777', '+998901112233') returning id`, [A.id])
      const mat = await newMat(tx)
      const p = await purchase(tx, P('admin'), { obj: A.ids.obj3!, mat, qty: '1', total: '10', extra: { supplier_id: s2 } })
      const same = await res(tx, `select public.merge_suppliers($1, $1)`, [A.ids.s1])
      const foreign = await res(tx, `select public.merge_suppliers($1, $2)`, [A.ids.s1, B.ids.s1])
      await switchTo(tx, 'taminotchi')
      const forbidden = await res(tx, `select public.merge_suppliers($1, $2)`, [A.ids.s1, s2])
      await switchTo(tx, 'admin')
      const n = await scalar<number>(tx, `select public.merge_suppliers($1, $2)`, [A.ids.s1, s2])
      return {
        same, foreign, forbidden, n,
        moved: await scalar<string>(tx, `select supplier_id from public.purchases where id = $1`, [p]),
        merged: await scalar<boolean>(tx, `select deleted_at is not null from public.suppliers where id = $1`, [s2]),
        keep: await one(tx, `select tin, phone from public.suppliers where id = $1`, [A.ids.s1]),
        changeAlert: await alertsOf(tx, 'yozuv_ozgartirildi', `purchase_id = $1`, [p]),
      }
    })
    expect(r).toMatchObject({
      same: '22023:supplier_merge_invalid',
      foreign: 'P0002:supplier_not_found',
      forbidden: '42501:supplier_merge_forbidden',
      n: 1,
      moved: A.ids.s1,
      merged: true,
      keep: { tin: '555666777', phone: '+998901112233' },
      changeAlert: [],
    })
  })
})

describe('D5: yuboruvchi o`tkazmani bekor qiladi', () => {
  it('prorab (yuboruvchi, yuborildi holatida) — OK; omborchi — transfer_forbidden', async () => {
    const r = await as('prorab', async (tx) => {
      const tid = randomUUID()
      await tx.query(`select public.create_transfer($1, $2, $3, $4, $5, 1, null)`, [tid, A.ids.obj1, A.ids.obj2, A.ids.m1, kgId])
      await switchTo(tx, 'omborchi')
      const omb = await res(tx, `select public.cancel_transfer($1, 'x')`, [tid])
      await switchTo(tx, 'prorab')
      const own = await res(tx, `select public.cancel_transfer($1, 'Xato')`, [tid])
      return { omb, own, status: await sys(tx, () => scalar<string>(tx, `select status::text from public.transfers where id = $1`, [tid])) }
    })
    expect(r).toEqual({ omb: '42501:transfer_forbidden', own: 'OK:1', status: 'bekor' })
  })
})

// ============================================================================
// Firma izolyatsiyasi — yangi alert turlari va RPC'lar
// ============================================================================
describe('firma izolyatsiyasi', () => {
  it('B admin A ning yangi alertlarini, outbox ish oqimi qatorlarini va health ma`lumotini ko`rmaydi', async () => {
    const r = await as('admin', async (tx) => {
      await system(tx, async () => {
        await tx.query(`insert into public.alerts (company_id, type, severity, details) values ($1, 'yozuv_ozgartirildi', 'ogohlantirish', '{}')`, [A.id])
        await tx.query(`insert into public.notification_outbox (company_id, kind, ref_id, payload) values ($1, 'request_created', $2, '{}')`, [A.id, randomUUID()])
      })
      await switchTo(tx, 'admin', B)
      return {
        alerts: await scalar<number>(tx, `select count(*)::int from public.alerts where company_id = $1`, [A.id]),
        outbox: await scalar<number>(tx, `select count(*)::int from public.notification_outbox where company_id = $1`, [A.id]),
        merge: await res(tx, `select public.merge_suppliers($1, $2)`, [B.ids.s1, A.ids.s1]),
      }
    })
    expect(r).toEqual({ alerts: 0, outbox: 0, merge: 'P0002:supplier_not_found' })
  })
})
