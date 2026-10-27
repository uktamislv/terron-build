// Batch 9 — 20261102000001_reports.sql: dashboard_summary, dashboard_daily,
// spend_breakdown, norm_overview (security invoker — RLS amal qiladi).
//
// Alohida "R" firma (aniq sanali ma'lumot, 2026-01) + fixture'dagi B firma (boshqa firma).
// Toshkent = UTC+5: 18:59:59Z → shu kun 23:59:59, 19:00:00Z → keyingi kun 00:00.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  addObjectMember,
  asAnon,
  asUser,
  createCompany,
  createDb,
  createMaterial,
  createObject,
  createUser,
  insertRow,
  rows,
  scalar,
  type Db,
  type Queryable,
  type Row,
  type TestUser,
  type UserRole,
} from './_harness'
import { buildCompany, type CompanyFixture } from './_fixtures'

let db: Db
let B: CompanyFixture

const R = {
  id: '',
  users: {} as Record<UserRole, TestUser>,
  o1: '',
  o2: '',
  o3: '',
  mA: '',
  mB: '',
  s1: '',
}

const RPC_SIGS = [
  'public.dashboard_summary(date, date, uuid)',
  'public.dashboard_daily(date, date, uuid)',
  'public.spend_breakdown(date, date, uuid, text)',
  'public.norm_overview(uuid)',
] as const

async function ins(table: string, values: Row): Promise<string> {
  return (await insertRow<{ id: string }>(db, table, values)).id
}

const baseUnit = (mat: string): Promise<string> =>
  scalar<string>(db, `select id from public.material_units where material_id = $1 and factor = 1 and deleted_at is null`, [
    mat,
  ])

async function movement(type: string, obj: string, mat: string, qty: string, at: string, extra: Row = {}): Promise<string> {
  return ins('movements', {
    company_id: R.id,
    type,
    object_id: obj,
    material_id: mat,
    unit_id: await baseUnit(mat),
    qty_input: qty,
    unit_input: '-',
    qty_base: 0,
    occurred_at: at,
    ...extra,
  })
}

async function purchase(
  co: string,
  buyer: string,
  obj: string,
  mat: string,
  total: string,
  at: string,
  supplier: string | null,
): Promise<string> {
  return ins('purchases', {
    company_id: co,
    buyer_id: buyer,
    object_id: obj,
    material_id: mat,
    supplier_id: supplier,
    unit_id: await baseUnit(mat),
    qty_input: 10,
    unit_input: '-',
    qty_base: 0,
    unit_price: 0,
    price_per_base: 0,
    total_amount: total,
    purchased_at: at,
  })
}

/** alerts — triggerlarsiz (created_at aniq beriladi; bildirishnoma/audit kerak emas). */
async function alert(v: {
  type: string
  severity: string
  status: string
  obj: string | null
  at: string
  deleted?: boolean
}): Promise<void> {
  await db.exec(`set session_replication_role = replica`)
  try {
    await db.query(
      `insert into public.alerts (company_id, type, severity, status, object_id, created_at, updated_at, deleted_at)
       values ($1, $2::public.alert_type, $3::public.alert_severity, $4::public.alert_status, $5, $6, $6,
               case when $7 then $6::timestamptz end)`,
      [R.id, v.type, v.severity, v.status, v.obj, v.at, v.deleted ?? false],
    )
  } finally {
    await db.exec(`set session_replication_role = origin`)
  }
}

beforeAll(async () => {
  db = await createDb()
  B = await buildCompany(db, 'B')

  R.id = await createCompany(db, { name: 'R firma' })
  let n = 0
  for (const role of ['admin', 'direktor', 'buxgalter', 'taminotchi', 'prorab', 'omborchi', 'haydovchi', 'tekshiruvchi'] as UserRole[]) {
    R.users[role] = await createUser(db, {
      companyId: R.id,
      role,
      phone: `+99897${String(1_000_000 + ++n).slice(-7)}`,
      fullName: `R ${role}`,
    })
  }
  R.o1 = await createObject(db, { companyId: R.id, name: 'R obj1' })
  R.o2 = await createObject(db, { companyId: R.id, name: 'R obj2' })
  R.o3 = await createObject(db, { companyId: R.id, name: 'R obj3' })
  for (const role of ['prorab', 'omborchi'] as UserRole[]) {
    await addObjectMember(db, { companyId: R.id, objectId: R.o1, profileId: R.users[role].profileId })
  }
  R.mA = await createMaterial(db, { companyId: R.id, name: 'R sement', baseUnit: 'kg', extra: { waste_pct: 5 } })
  R.mB = await createMaterial(db, { companyId: R.id, name: 'R qum', baseUnit: 'm³' })
  R.s1 = await ins('suppliers', { company_id: R.id, name: 'R sotuvchi' })
  const P = (r: UserRole): string => R.users[r].profileId

  // --- xaridlar ---
  const p1 = await purchase(R.id, P('haydovchi'), R.o1, R.mA, '600000', '2026-01-10T03:00:00Z', R.s1)
  await purchase(R.id, P('taminotchi'), R.o2, R.mA, '250000.50', '2026-01-11T12:00:00Z', null)
  await purchase(R.id, P('prorab'), R.o1, R.mB, '100000', '2026-01-12T18:59:59Z', R.s1)
  await purchase(R.id, P('taminotchi'), R.o2, R.mB, '999', '2026-01-12T19:00:00Z', R.s1) // 13-yanvar
  const p5 = await purchase(R.id, P('taminotchi'), R.o1, R.mA, '5000', '2026-01-11T08:00:00Z', R.s1)
  await db.query(`update public.purchases set deleted_at = now() where id = $1`, [p5])

  // --- harakatlar ---
  await movement('kirim', R.o1, R.mA, '1', '2026-01-09T18:59:59Z') // 9-yanvar 23:59:59
  await movement('kirim', R.o1, R.mA, '500', '2026-01-09T19:00:00Z', { purchase_id: p1 }) // 10-yanvar 00:00
  await movement('chiqim', R.o1, R.mA, '10', '2026-01-10T10:00:00Z')
  await movement('kirim', R.o2, R.mA, '5', '2026-01-12T05:00:00Z')
  await movement('chiqim', R.o2, R.mA, '1', '2026-01-12T18:59:59Z')
  await movement('kirim', R.o2, R.mA, '1', '2026-01-12T19:00:00Z') // 13-yanvar
  const mvDel = await movement('kirim', R.o1, R.mA, '3', '2026-01-11T09:00:00Z')
  await db.query(`update public.movements set deleted_at = now() where id = $1`, [mvDel])

  // --- podotchet ---
  await ins('cash_advances', { company_id: R.id, recipient_id: P('haydovchi'), amount: '1000000', issued_at: '2026-01-10T00:00:00Z' })
  await ins('cash_advances', { company_id: R.id, recipient_id: P('prorab'), amount: '300000', issued_at: '2026-01-09T18:00:00Z' })
  const caDel = await ins('cash_advances', {
    company_id: R.id,
    recipient_id: P('taminotchi'),
    amount: '50000',
    issued_at: '2026-01-11T00:00:00Z',
  })
  await db.query(`update public.cash_advances set deleted_at = now() where id = $1`, [caDel])

  // --- o'tkazmalar (o1→o2 va o2→o3 kutilmoqda; qabul qilingan; o'chirilgan) ---
  const tr = async (from: string, to: string, status: string, deleted = false): Promise<void> => {
    const id = await ins('transfers', {
      company_id: R.id,
      from_object_id: from,
      to_object_id: to,
      material_id: R.mA,
      unit_id: await baseUnit(R.mA),
      qty_input: 1,
      unit_input: 'kg',
      qty_base: 1,
      status,
    })
    if (deleted) await db.query(`update public.transfers set deleted_at = now() where id = $1`, [id])
  }
  await tr(R.o1, R.o2, 'yuborildi')
  await tr(R.o2, R.o3, 'yuborildi')
  await tr(R.o2, R.o1, 'qabul_qilindi')
  await tr(R.o1, R.o3, 'yuborildi', true)

  // --- so'rovlar ---
  const rq = async (obj: string, status: string, deleted = false): Promise<void> => {
    const id = await ins('material_requests', {
      company_id: R.id,
      object_id: obj,
      material_id: R.mA,
      unit_id: await baseUnit(R.mA),
      qty_input: 1,
      unit_input: 'kg',
      qty_base: 1,
      status,
    })
    if (deleted) await db.query(`update public.material_requests set deleted_at = now() where id = $1`, [id])
  }
  await rq(R.o1, 'kutilmoqda')
  await rq(R.o2, 'kutilmoqda')
  await rq(R.o1, 'tasdiqlandi')
  await rq(R.o2, 'kutilmoqda', true)

  // --- smeta (o1, mA norma 100 kg, isrof 5 % → ruxsat 105) ---
  const est = await ins('estimates', { company_id: R.id, object_id: R.o1, version: 1, title: 'Smeta', is_current: true })
  await ins('estimate_items', {
    company_id: R.id,
    estimate_id: est,
    item_type: 'material',
    name: 'Sement',
    material_id: R.mA,
    unit: 'kg',
    qty: 100,
  })

  // --- qabul holati uchun hozirga nisbatan xaridlar (summa 0 — balans o'zgarmaydi) ---
  const rel = (iv: string): Promise<string> => scalar<string>(db, `select (now() - $1::interval)::text`, [iv])
  await purchase(R.id, P('haydovchi'), R.o1, R.mA, '0', await rel('2 days'), null) // qabul qilinmagan
  const pRecv = await purchase(R.id, P('haydovchi'), R.o1, R.mA, '0', await rel('3 days'), null)
  await movement('kirim', R.o1, R.mA, '1', await rel('3 days'), { purchase_id: pRecv }) // qabul qilingan
  const pRecvDel = await purchase(R.id, P('taminotchi'), R.o2, R.mA, '0', await rel('4 days'), null)
  const mvRecvDel = await movement('kirim', R.o2, R.mA, '1', await rel('4 days'), { purchase_id: pRecvDel })
  await db.query(`update public.movements set deleted_at = now() where id = $1`, [mvRecvDel]) // kirim o'chirilgan → qabul qilinmagan
  await purchase(R.id, P('taminotchi'), R.o2, R.mA, '0', await rel('2 hours'), null) // 24 soatdan yangi
  await purchase(R.id, P('taminotchi'), R.o2, R.mA, '0', await rel('91 days'), null) // 90 kundan eski

  // Qoida triggerlari yaratgan alertlar (created_at = hozir) testni chalg'itmasin.
  await db.query(`update public.alerts set deleted_at = now() where company_id = $1 and deleted_at is null`, [R.id])

  // --- alertlar (aniq sanali) ---
  await alert({ type: 'narx_ogishi', severity: 'jiddiy', status: 'yangi', obj: R.o1, at: '2026-01-10T05:00:00Z' })
  await alert({ type: 'normadan_oshish', severity: 'ogohlantirish', status: 'korildi', obj: R.o2, at: '2026-01-05T05:00:00Z' })
  await alert({ type: 'xarid_qabul_farqi', severity: 'ogohlantirish', status: 'yopildi', obj: R.o1, at: '2026-01-11T05:00:00Z' })
  await alert({ type: 'ozi_qabul_qilgan', severity: 'belgi', status: 'yangi', obj: R.o1, at: '2026-01-11T06:00:00Z' })
  await alert({ type: 'narx_ogishi', severity: 'jiddiy', status: 'yangi', obj: R.o1, at: '2026-01-11T07:00:00Z', deleted: true })
  await alert({ type: 'normadan_oshish', severity: 'ogohlantirish', status: 'yopildi', obj: R.o1, at: '2026-01-11T08:00:00Z' })

  // --- B firma: shu sanada xarid (R hisobotiga tushmasligi kerak) ---
  await purchase(B.id, B.users.taminotchi.profileId, B.ids.obj1!, B.ids.m1!, '777', '2026-01-10T06:00:00Z', null)
}, 300_000)

afterAll(async () => {
  await db?.close()
})

// ----------------------------------------------------------------------------
// Yordamchilar
// ----------------------------------------------------------------------------

const userOf = (who: UserRole | TestUser): TestUser => (typeof who === 'string' ? R.users[who] : who)

const call = <T = Row>(who: UserRole | TestUser, sql: string, params: unknown[] = []): Promise<T[]> =>
  asUser(db, userOf(who).authUid, (tx) => rows<T>(tx, sql, params))

// 20261111000001_expenses: bu fixture'da xarajat yo'q — xarajat kalitlari nol, spend_total_sum = purchases_sum
// (tekshirilib, solishtirishdan olib tashlanadi; xarajatlar — expenses.sql.test.ts).
const summary = async (who: UserRole | TestUser, from: string, to: string, obj: string | null = null): Promise<Row> => {
  const s = (await call<{ s: Row }>(who, `select public.dashboard_summary($1, $2, $3) as s`, [from, to, obj]))[0]!.s
  const { expense_count, expense_sum, expense_by_category, spend_total_sum, ...rest } = s
  expect({ expense_count, expense_sum, expense_by_category, spend_total_sum }).toEqual({
    expense_count: 0, expense_sum: '0.00', expense_by_category: [], spend_total_sum: s.purchases_sum,
  })
  return rest
}

const daily = (who: UserRole | TestUser, from: string, to: string, obj: string | null = null): Promise<Row[]> =>
  call(
    who,
    `select to_char(day, 'YYYY-MM-DD') as day, kirim_count, chiqim_count, purchases_sum, alerts_count
       from public.dashboard_daily($1, $2, $3)`,
    [from, to, obj],
  )

const spend = (who: UserRole | TestUser, group: string | null, obj: string | null = null): Promise<Row[]> =>
  call(who, `select key, label, purchases_sum, purchases_count from public.spend_breakdown($1, $2, $3, $4)`, [
    '2026-01-10',
    '2026-01-12',
    obj,
    group,
  ])

/** `<errcode>:<hint>` yoki `OK`. */
async function err(who: UserRole | TestUser, sql: string, params: unknown[]): Promise<string> {
  return asUser(db, userOf(who).authUid, async (tx: Queryable) => {
    try {
      await tx.query(sql, params)
      return 'OK'
    } catch (e) {
      const x = e as { code?: string; hint?: string }
      return `${x.code ?? '?'}:${x.hint ?? ''}`
    }
  })
}

const ZERO_SUMMARY = {
  kirim_count: 0,
  chiqim_count: 0,
  purchases_count: 0,
  purchases_sum: '0.00',
  cash_issued_sum: '0.00',
  cash_returned_sum: '0.00', // Batch 12
  cash_on_hand_total: '0.00',
  cash_outstanding_sum: '0.00', // audit_fixes A10
  cash_owed_to_staff_sum: '0.00',
  alerts_open: 0,
  alerts_serious_open: 0,
  alerts_new_in_period: 0,
  unreceived_purchases_count: 0,
  pending_transfers_count: 0,
  pending_requests_count: 0,
  objects_over_norm_count: 0,
  telegram_blocked_count: null, // audit2 S13: faqat admin/direktor/super_admin (o'z firmasi)
  telegram_me_blocked: false,
}

// ============================================================================
// dashboard_summary
// ============================================================================
describe('dashboard_summary', () => {
  const ADMIN_FULL = {
    kirim_count: 2,
    chiqim_count: 2,
    purchases_count: 3,
    purchases_sum: '950000.50',
    cash_issued_sum: '1000000.00',
    cash_returned_sum: '0.00', // Batch 12
    // haydovchi 1 000 000 − 600 000; prorab 300 000 − 100 000; taminotchi −250 000.50 − 999
    cash_on_hand_total: '349000.50',
    // audit_fixes A10: musbat va manfiy balanslar alohida
    cash_outstanding_sum: '600000.00',
    cash_owed_to_staff_sum: '250999.50',
    alerts_open: 2,
    alerts_serious_open: 1,
    alerts_new_in_period: 3, // a1, a3 (yopilgan), a6 (yopilgan); belgi va o`chirilgan yo`q
    telegram_blocked_count: 0, // audit2 S13
    telegram_me_blocked: false,
    unreceived_purchases_count: 2, // haydovchi 2 kun (o1); taminotchi 4 kun (o2, kirimi o'chirilgan)
    pending_transfers_count: 2,
    pending_requests_count: 2,
    objects_over_norm_count: 0, // o1: sarf 10 ≤ ruxsat 105; o2 smetasiz
  }

  it('admin: davr 10–12 yanvar — to`liq hisob (o`chirilganlar, belgi va boshqa firma yo`q)', async () => {
    expect(await summary('admin', '2026-01-10', '2026-01-12')).toEqual(ADMIN_FULL)
  })

  it('direktor va buxgalter — admin bilan bir xil', async () => {
    expect(await summary('direktor', '2026-01-10', '2026-01-12')).toEqual(ADMIN_FULL)
    expect(await summary('buxgalter', '2026-01-10', '2026-01-12')).toEqual({ ...ADMIN_FULL, telegram_blocked_count: null }) // audit2 S13: buxgalterga yo'q
  })

  it('obyekt filtri (o1): obyektga bog`langanlari toraydi, podotchet obyektsiz', async () => {
    expect(await summary('admin', '2026-01-10', '2026-01-12', R.o1)).toEqual({
      ...ADMIN_FULL,
      kirim_count: 1,
      chiqim_count: 1,
      purchases_count: 2,
      purchases_sum: '700000.00',
      alerts_open: 1,
      alerts_serious_open: 1,
      alerts_new_in_period: 3,
      unreceived_purchases_count: 1,
      pending_transfers_count: 1,
      pending_requests_count: 1,
      objects_over_norm_count: 0,
    })
  })

  it('Toshkent kun chegarasi: 18:59:59Z — shu kun, 19:00:00Z — keyingi kun', async () => {
    const d9 = await summary('admin', '2026-01-09', '2026-01-09')
    const d10 = await summary('admin', '2026-01-10', '2026-01-10')
    const d13 = await summary('admin', '2026-01-13', '2026-01-13')
    expect([d9.kirim_count, d10.kirim_count, d10.chiqim_count]).toEqual([1, 1, 1])
    expect([d9.cash_issued_sum, d10.cash_issued_sum]).toEqual(['300000.00', '1000000.00'])
    expect([d13.kirim_count, d13.purchases_count, d13.purchases_sum]).toEqual([1, 1, '999.00'])
  })

  it('prorab: faqat a`zo obyekt (o1) + o`z xaridi, obyekt alertlari (D3), o`z podotcheti', async () => {
    expect(await summary('prorab', '2026-01-10', '2026-01-12')).toEqual({
      ...ZERO_SUMMARY,
      kirim_count: 1,
      chiqim_count: 1,
      purchases_count: 2,
      purchases_sum: '700000.00',
      cash_on_hand_total: '200000.00',
      cash_outstanding_sum: '200000.00',
      // audit_fixes D3: prorab o'z obyektining normadan_oshish alertini ko'radi (a6)
      alerts_new_in_period: 1,
      unreceived_purchases_count: 1,
      pending_transfers_count: 1,
      pending_requests_count: 1,
    })
  })

  it('prorab: a`zo bo`lmagan obyekt (o2) — hammasi nol', async () => {
    expect(await summary('prorab', '2026-01-10', '2026-01-12', R.o2)).toEqual(ZERO_SUMMARY)
  })

  it('tekshiruvchi: harakat va xaridlar 0, alertlar 0', async () => {
    const s = await summary('tekshiruvchi', '2026-01-10', '2026-01-12')
    expect(s).toMatchObject({
      kirim_count: 0,
      chiqim_count: 0,
      purchases_count: 0,
      purchases_sum: '0.00',
      cash_issued_sum: '0.00',
      cash_returned_sum: '0.00', // Batch 12
      cash_on_hand_total: '0.00',
      alerts_open: 0,
      alerts_new_in_period: 0,
      unreceived_purchases_count: 0,
      objects_over_norm_count: 0,
    })
  })

  it('haydovchi: harakatlar 0, faqat o`z xaridi va qo`lidagi puli', async () => {
    expect(await summary('haydovchi', '2026-01-10', '2026-01-12')).toMatchObject({
      kirim_count: 0,
      chiqim_count: 0,
      purchases_count: 1,
      purchases_sum: '600000.00',
      cash_issued_sum: '1000000.00',
      cash_returned_sum: '0.00', // Batch 12
      cash_on_hand_total: '400000.00',
      alerts_open: 0,
      // harakatlarni ko'rmasa ham: 2 kunlik — qabul qilinmagan, 3 kunlik — qabul qilingan
      unreceived_purchases_count: 1,
    })
  })

  it('unreceived: obyekt filtri (o1 → 1, o2 → 1), 24 soat va 90 kun chegaralari', async () => {
    const o1 = await summary('admin', '2026-01-10', '2026-01-12', R.o1)
    const o2 = await summary('admin', '2026-01-10', '2026-01-12', R.o2)
    expect([o1.unreceived_purchases_count, o2.unreceived_purchases_count]).toEqual([1, 1])
  })

  it('purchase_has_receipt: definer, boshqa firma uchun null, anon execute yo`q', async () => {
    const pid = await scalar<string>(
      db,
      `select p.id from public.purchases p where p.company_id = $1 and p.purchased_at > now() - interval '3 days 1 hour'
          and p.purchased_at < now() - interval '2 days 1 hour'`,
      [R.id],
    )
    const sql = `select private.purchase_has_receipt($1, $2) as r`
    expect((await call<{ r: boolean | null }>('haydovchi', sql, [R.id, pid]))[0]!.r).toBe(true)
    expect((await call<{ r: boolean | null }>(B.users.admin, sql, [R.id, pid]))[0]!.r).toBe(null)
    expect(
      await scalar<boolean>(db, `select has_function_privilege('anon', 'private.purchase_has_receipt(uuid, uuid)', 'execute')`),
    ).toBe(false)
  })

  it('objects_over_norm_count — norm_usage: oshish va smetada yo`q material; RLS', async () => {
    const r = await asUser(db, R.users.admin.authUid, async (tx) => {
      const unit = await scalar<string>(tx, `select id from public.material_units where material_id = $1 and factor = 1`, [R.mB])
      // o1 da smetada yo'q mB ga sarf (norm = 0, sarf > 0)
      await tx.query(
        `insert into public.movements (company_id, type, object_id, material_id, unit_id, qty_input, unit_input, qty_base)
         values ($1, 'chiqim', $2, $3, $4, 1, '-', 0)`,
        [R.id, R.o1, R.mB, unit],
      )
      const all = await rows<{ s: Row }>(tx, `select public.dashboard_summary('2026-01-10', '2026-01-12') as s`)
      const o2 = await rows<{ s: Row }>(tx, `select public.dashboard_summary('2026-01-10', '2026-01-12', $1) as s`, [R.o2])
      // prorab (o1 a'zo) va tekshiruvchi — shu tranzaksiyada
      const as = async (u: TestUser): Promise<unknown> => {
        await tx.query(`select set_config('request.jwt.claim.sub', $1, true)`, [u.authUid])
        return (await rows<{ s: Row }>(tx, `select public.dashboard_summary('2026-01-10', '2026-01-12') as s`))[0]!.s
          .objects_over_norm_count
      }
      return [
        all[0]!.s.objects_over_norm_count,
        o2[0]!.s.objects_over_norm_count,
        await as(R.users.prorab),
        await as(R.users.tekshiruvchi),
        await as(R.users.omborchi),
      ]
    })
    expect(r).toEqual([1, 0, 1, 0, 0])
  })

  it('objects_over_norm_count — sarf ruxsatdan oshsa (smetadagi material)', async () => {
    const r = await asUser(db, R.users.admin.authUid, async (tx) => {
      const unit = await scalar<string>(tx, `select id from public.material_units where material_id = $1 and factor = 1`, [R.mA])
      await tx.query(
        `insert into public.movements (company_id, type, object_id, material_id, unit_id, qty_input, unit_input, qty_base)
         values ($1, 'chiqim', $2, $3, $4, 96, '-', 0)`, // 10 + 96 = 106 > 105
        [R.id, R.o1, R.mA, unit],
      )
      return (await rows<{ s: Row }>(tx, `select public.dashboard_summary('2026-01-10', '2026-01-12', $1) as s`, [R.o1]))[0]!.s
        .objects_over_norm_count
    })
    expect(r).toBe(1)
  })

  it('boshqa firma: B admin R ma`lumotini ko`rmaydi; R obyekti bilan — nol', async () => {
    expect(await summary(B.users.admin, '2026-01-10', '2026-01-12', R.o1)).toEqual(ZERO_SUMMARY)
    const own = await summary(B.users.admin, '2026-01-10', '2026-01-12')
    expect([own.purchases_count, own.purchases_sum, own.kirim_count]).toEqual([1, '777.00', 0])
    const rAdmin = await summary('admin', '2026-01-10', '2026-01-10')
    expect(rAdmin.purchases_sum).toBe('600000.00')
  })

  it('mavjud bo`lmagan obyekt id — nol', async () => {
    expect(await summary('admin', '2026-01-10', '2026-01-12', '00000000-0000-0000-0000-000000000001')).toEqual(
      ZERO_SUMMARY,
    )
  })
})

// ============================================================================
// dashboard_daily
// ============================================================================
describe('dashboard_daily', () => {
  it('admin: har kun (bo`sh kun ham), Toshkent kunlari', async () => {
    expect(await daily('admin', '2026-01-09', '2026-01-14')).toEqual([
      { day: '2026-01-09', kirim_count: 1, chiqim_count: 0, purchases_sum: '0.00', alerts_count: 0 },
      { day: '2026-01-10', kirim_count: 1, chiqim_count: 1, purchases_sum: '600000.00', alerts_count: 1 },
      { day: '2026-01-11', kirim_count: 0, chiqim_count: 0, purchases_sum: '250000.50', alerts_count: 2 },
      { day: '2026-01-12', kirim_count: 1, chiqim_count: 1, purchases_sum: '100000.00', alerts_count: 0 },
      { day: '2026-01-13', kirim_count: 1, chiqim_count: 0, purchases_sum: '999.00', alerts_count: 0 },
      { day: '2026-01-14', kirim_count: 0, chiqim_count: 0, purchases_sum: '0.00', alerts_count: 0 },
    ])
  })

  it('bitta kun — bitta qator; obyekt filtri (o2)', async () => {
    expect(await daily('admin', '2026-01-12', '2026-01-12', R.o2)).toEqual([
      { day: '2026-01-12', kirim_count: 1, chiqim_count: 1, purchases_sum: '0.00', alerts_count: 0 },
    ])
  })

  it('prorab: o1 va o`z xaridi; tekshiruvchi: hammasi nol', async () => {
    const p = await daily('prorab', '2026-01-10', '2026-01-12')
    expect(p.map((r) => [r.kirim_count, r.chiqim_count, r.purchases_sum, r.alerts_count])).toEqual([
      [1, 1, '600000.00', 0],
      [0, 0, '0.00', 1], // audit_fixes D3: a6 (normadan_oshish, o1)
      [0, 0, '100000.00', 0],
    ])
    const t = await daily('tekshiruvchi', '2026-01-10', '2026-01-12')
    expect(t.every((r) => r.kirim_count === 0 && r.chiqim_count === 0 && r.purchases_sum === '0.00')).toBe(true)
    expect(t).toHaveLength(3)
  })

  it('ko`rinmaydigan obyekt — kunlar nol bilan; B admin R ni ko`rmaydi', async () => {
    const p = await daily('prorab', '2026-01-10', '2026-01-12', R.o2)
    expect(p).toHaveLength(3)
    expect(p.every((r) => r.kirim_count === 0 && r.purchases_sum === '0.00')).toBe(true)
    const b = await daily(B.users.admin, '2026-01-10', '2026-01-12')
    expect(b.map((r) => r.purchases_sum)).toEqual(['777.00', '0.00', '0.00'])
    expect(b.every((r) => r.kirim_count === 0)).toBe(true)
  })

  it('366 kun (ikkala chegara kiradi, 366 qator) ruxsat', async () => {
    const r = await daily('admin', '2026-01-01', '2027-01-01')
    expect(r).toHaveLength(366)
    expect(r[0]!.day).toBe('2026-01-01')
    expect(r[365]!.day).toBe('2027-01-01')
  })
})

// ============================================================================
// spend_breakdown
// ============================================================================
describe('spend_breakdown', () => {
  it('material', async () => {
    expect(await spend('admin', 'material')).toEqual([
      { key: R.mA, label: 'R sement', purchases_sum: '850000.50', purchases_count: 2 },
      { key: R.mB, label: 'R qum', purchases_sum: '100000.00', purchases_count: 1 },
    ])
  })

  it('object', async () => {
    expect(await spend('admin', 'object')).toEqual([
      { key: R.o1, label: 'R obj1', purchases_sum: '700000.00', purchases_count: 2 },
      { key: R.o2, label: 'R obj2', purchases_sum: '250000.50', purchases_count: 1 },
    ])
  })

  it('buyer', async () => {
    expect(await spend('admin', 'buyer')).toEqual([
      { key: R.users.haydovchi.profileId, label: 'R haydovchi', purchases_sum: '600000.00', purchases_count: 1 },
      { key: R.users.taminotchi.profileId, label: 'R taminotchi', purchases_sum: '250000.50', purchases_count: 1 },
      { key: R.users.prorab.profileId, label: 'R prorab', purchases_sum: '100000.00', purchases_count: 1 },
    ])
  })

  it('supplier (sotuvchisiz — key/label null)', async () => {
    expect(await spend('admin', 'supplier')).toEqual([
      { key: R.s1, label: 'R sotuvchi', purchases_sum: '700000.00', purchases_count: 2 },
      { key: null, label: null, purchases_sum: '250000.50', purchases_count: 1 },
    ])
  })

  it('standart p_group = material', async () => {
    const r = await call(
      'admin',
      `select key, purchases_sum from public.spend_breakdown('2026-01-10', '2026-01-12')`,
    )
    expect(r).toEqual([
      { key: R.mA, purchases_sum: '850000.50' },
      { key: R.mB, purchases_sum: '100000.00' },
    ])
  })

  it('obyekt filtri va RLS: prorab — o1 + o`z xaridi; o2 — bo`sh; tekshiruvchi — bo`sh; B — R yo`q', async () => {
    expect(await spend('admin', 'material', R.o2)).toEqual([
      { key: R.mA, label: 'R sement', purchases_sum: '250000.50', purchases_count: 1 },
    ])
    expect(await spend('prorab', 'object')).toEqual([
      { key: R.o1, label: 'R obj1', purchases_sum: '700000.00', purchases_count: 2 },
    ])
    expect(await spend('prorab', 'object', R.o2)).toEqual([])
    expect(await spend('tekshiruvchi', 'material')).toEqual([])
    expect(await spend(B.users.admin, 'material', R.o1)).toEqual([])
    const b = await spend(B.users.admin, 'material')
    expect(b.map((x) => x.purchases_sum)).toEqual(['777.00'])
  })

  it('noto`g`ri p_group — 22023 report_group_invalid', async () => {
    for (const g of ['foo', '', null, 'MATERIAL']) {
      expect(
        await err('admin', `select * from public.spend_breakdown('2026-01-10', '2026-01-12', null, $1)`, [g]),
      ).toBe('22023:report_group_invalid')
    }
  })
})

// ============================================================================
// norm_overview
// ============================================================================
describe('norm_overview', () => {
  const ROW = {
    object_id: '',
    object_name: 'R obj1',
    material_id: '',
    material_name: 'R sement',
    base_unit: 'kg',
    norm_qty_base: '100.000000',
    allowed_qty_base: '105.000000',
    consumed_qty_base: '10.000000',
    usage_pct: '9.5',
    outside_estimate: false, // 20261111000001
  }
  const q = (who: UserRole | TestUser, obj: string | null = null): Promise<Row[]> =>
    call(who, `select * from public.norm_overview($1)`, [obj])

  it('admin: joriy smetali obyekt (o1), norma, isrof bilan ruxsat, sarf, %', async () => {
    expect(await q('admin')).toEqual([{ ...ROW, object_id: R.o1, material_id: R.mA }])
    expect(await q('admin', R.o1)).toEqual([{ ...ROW, object_id: R.o1, material_id: R.mA }])
    expect(await q('admin', R.o2)).toEqual([])
  })

  it('prorab — o1; omborchi, haydovchi, tekshiruvchi — bo`sh; B admin — R yo`q', async () => {
    expect(await q('prorab')).toHaveLength(1)
    expect(await q('omborchi')).toEqual([])
    expect(await q('haydovchi')).toEqual([])
    expect(await q('tekshiruvchi')).toEqual([])
    expect(await q(B.users.admin, R.o1)).toEqual([])
    const b = await q(B.users.admin)
    expect(b.some((r) => r.object_id === R.o1)).toBe(false)
    expect(b.length).toBeGreaterThan(0)
  })

  it('o`chirilgan obyekt chiqmaydi', async () => {
    const r = await asUser(db, R.users.admin.authUid, async (tx) => {
      await tx.query(`update public.objects set deleted_at = now() where id = $1`, [R.o1])
      return rows(tx, `select * from public.norm_overview()`)
    })
    expect(r).toEqual([])
  })
})

// ============================================================================
// Davr tekshiruvi, ruxsatlar, atributlar
// ============================================================================
describe('davr va ruxsatlar', () => {
  const BAD: [string | null, string | null][] = [
    ['2026-01-12', '2026-01-10'],
    ['2026-01-01', '2027-01-02'], // 367 kun
    [null, '2026-01-10'],
    ['2026-01-10', null],
  ]

  it.each(BAD)('noto`g`ri davr %s..%s — 22023 report_period_invalid (uchala RPC)', async (from, to) => {
    const out = [
      await err('admin', `select public.dashboard_summary($1, $2)`, [from, to]),
      await err('admin', `select * from public.dashboard_daily($1, $2)`, [from, to]),
      await err('admin', `select * from public.spend_breakdown($1, $2, null, 'object')`, [from, to]),
    ]
    expect(out).toEqual(Array(3).fill('22023:report_period_invalid'))
  })

  it('p_to − p_from = 365 (366 kun) — ruxsat', async () => {
    expect(await err('admin', `select public.dashboard_summary('2026-01-01', '2027-01-01')`, [])).toBe('OK')
  })

  it('anon: execute yo`q (privilege va chaqiruv 42501)', async () => {
    for (const sig of RPC_SIGS) {
      expect(await scalar<boolean>(db, `select has_function_privilege('anon', $1, 'execute')`, [sig])).toBe(false)
      expect(await scalar<boolean>(db, `select has_function_privilege('authenticated', $1, 'execute')`, [sig])).toBe(true)
    }
    const r = await asAnon(db, async (tx) => {
      try {
        await tx.query(`select public.dashboard_summary('2026-01-10', '2026-01-12')`)
        return 'OK'
      } catch (e) {
        return (e as { code?: string }).code
      }
    })
    expect(r).toBe('42501')
  })

  it('security invoker, stable, search_path = \'\'', async () => {
    const r = await rows<{ proname: string; prosecdef: boolean; provolatile: string; cfg: string[] }>(
      db,
      `select p.proname, p.prosecdef, p.provolatile, p.proconfig as cfg
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public'
          and p.proname in ('dashboard_summary', 'dashboard_daily', 'spend_breakdown', 'norm_overview')
        order by p.proname`,
    )
    expect(r).toHaveLength(4)
    for (const x of r) {
      expect([x.proname, x.prosecdef, x.provolatile, x.cfg]).toEqual([x.proname, false, 's', ['search_path=""']])
    }
  })
})
