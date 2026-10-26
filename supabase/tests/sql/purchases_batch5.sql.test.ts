// Batch 5 — 20261029000001_purchases.sql: cash_balances, cash_advances.issued_at,
// suppliers (RLS va dublikat), purchase_receipts, open_purchases(), farq qoidalari 1–3,
// idempotentlik (klient id).
import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  asAnon,
  asService,
  asUser,
  createDb,
  one,
  rows,
  scalar,
  type Db,
  type Queryable,
  type Row,
  type TestUser,
  type Tx,
  type UserRole,
} from './_harness'
import { buildTwoCompanies, type CompanyFixture } from './_fixtures'

let db: Db
let A: CompanyFixture
let B: CompanyFixture

beforeAll(async () => {
  db = await createDb()
  ;({ A, B } = await buildTwoCompanies(db))
})
afterAll(async () => {
  await db?.close()
})

// ----------------------------------------------------------------------------
// Yordamchilar
// ----------------------------------------------------------------------------

/** `OK:<qatorlar soni>` yoki `<errcode>:<hint>` (savepoint bilan — tx davom etadi). */
async function res(tx: Queryable, sql: string, params: unknown[] = []): Promise<string> {
  await tx.exec('savepoint p5_try')
  try {
    const r = await tx.query(sql, params)
    await tx.exec('release savepoint p5_try')
    return `OK:${r.affectedRows ?? r.rows.length}`
  } catch (e) {
    await tx.exec('rollback to savepoint p5_try')
    const err = e as { code?: string; hint?: string }
    return `${err.code ?? '?'}:${err.hint ?? ''}`
  }
}

/** Xato xabari (savepoint bilan). */
async function errMsg(tx: Queryable, sql: string, params: unknown[] = []): Promise<string> {
  await tx.exec('savepoint p5_msg')
  try {
    await tx.query(sql, params)
    await tx.exec('release savepoint p5_msg')
    return 'OK'
  } catch (e) {
    await tx.exec('rollback to savepoint p5_msg')
    const err = e as { code?: string; message?: string }
    return `${err.code ?? '?'}|${err.message ?? ''}`
  }
}

/** Superuser tranzaksiyasi, oxirida rollback. */
async function inTx<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    const r = await fn(tx)
    await tx.rollback()
    return r
  })
}

/** Superuser tranzaksiyasi ichida foydalanuvchiga o'tish (`unbecome` — qaytish). */
async function become(tx: Tx, u: TestUser, device: 'veb' | 'mobil' = 'veb'): Promise<void> {
  await tx.exec(`set local role authenticated`)
  await tx.query(
    `select set_config('request.jwt.claims', $1, true), set_config('request.jwt.claim.sub', $2, true),
            set_config('request.headers', $3, true)`,
    [JSON.stringify({ sub: u.authUid, role: 'authenticated' }), u.authUid, JSON.stringify({ 'x-client-device': device })],
  )
}
async function unbecome(tx: Tx): Promise<void> {
  await tx.exec(`reset role`)
  await tx.query(
    `select set_config('request.jwt.claims', '', true), set_config('request.jwt.claim.sub', '', true),
            set_config('request.headers', '', true)`,
  )
}

/** Yangi material (asosiy birlik kg) — shu tranzaksiyada. */
const newMaterial = (q: Queryable, co: CompanyFixture): Promise<string> =>
  scalar<string>(q, `insert into public.materials (company_id, name, base_unit) values ($1, $2, 'kg') returning id`, [
    co.id,
    `Mat ${randomUUID()}`,
  ])

interface PurchaseIn {
  co: CompanyFixture
  material: string
  qty: number | string
  total: number | string
  /** purchased_at = now() + at (masalan '-2 days'). */
  at?: string
  buyer?: string
  object?: string
  /** superuser uchun; foydalanuvchi sessiyasida bermang (trigger qo'yadi). */
  createdBy?: string | null
  id?: string
}

/** Xarid (kg). Superuser yoki joriy foydalanuvchi sifatida. */
const purchase = (q: Queryable, p: PurchaseIn): Promise<string> =>
  scalar<string>(
    q,
    `insert into public.purchases (id, company_id, buyer_id, object_id, material_id, qty_input, unit_input,
       total_amount, purchased_at, created_by)
     values (coalesce($9::uuid, gen_random_uuid()), $1, $2, $3, $4, $5, 'kg', $6, now() + $7::interval, $8)
     returning id`,
    [
      p.co.id,
      p.buyer ?? p.co.users.prorab.profileId,
      p.object ?? p.co.ids.obj1,
      p.material,
      p.qty,
      p.total,
      p.at ?? '0 seconds',
      p.createdBy ?? null,
      p.id ?? null,
    ],
  )

/** Bog'langan kirim (kg). */
const kirim = (
  q: Queryable,
  co: CompanyFixture,
  purchaseId: string | null,
  material: string,
  qty: number | string,
  opts: { object?: string; createdBy?: string | null } = {},
): Promise<string> =>
  scalar<string>(
    q,
    `insert into public.movements (company_id, type, object_id, material_id, qty_input, unit_input, qty_base,
       purchase_id, created_by)
     values ($1, 'kirim', $2, $3, $4, 'kg', 0, $5, $6) returning id`,
    [co.id, opts.object ?? co.ids.obj1, material, qty, purchaseId, opts.createdBy ?? null],
  )

interface AlertRow {
  type: string
  status: string
  severity: string
  details: Record<string, unknown>
  closed_by: string | null
  movement_id: string | null
  purchase_id: string | null
  company_id: string
  created_by: string | null
}

/** Xarid alertlari (superuser sessiyasida chaqiring). */
const alertsOf = (q: Queryable, purchaseId: string, type?: string): Promise<AlertRow[]> =>
  rows<AlertRow>(
    q,
    `select type::text, status::text, severity::text, details, closed_by, movement_id, purchase_id, company_id, created_by
       from public.alerts
      where purchase_id = $1 and ($2::text is null or type::text = $2)
      order by (status = 'yopildi') desc, created_at, id`,
    [purchaseId, type ?? null],
  )

const evalReceipt = (q: Queryable, purchaseId: string, nowExpr = 'now()'): Promise<unknown> =>
  q.query(`select private.evaluate_purchase_receipt($1, ${nowExpr})`, [purchaseId])

// ============================================================================
// 1. cash_balances
// ============================================================================
describe('cash_balances', () => {
  const balances = (u: TestUser): Promise<Row[]> =>
    asUser(db, u.authUid, (tx) =>
      rows(
        tx,
        `select company_id, profile_id, issued_total::text as issued, spent_total::text as spent,
                balance::text as balance, last_issued_at is not null as has_issued, last_spent_at is not null as has_spent
           from public.cash_balances order by company_id, profile_id`,
      ),
    )

  const P = (co: CompanyFixture, r: UserRole): string => co.users[r].profileId
  const expected = (co: CompanyFixture): Row[] =>
    [
      { profile_id: P(co, 'haydovchi'), issued: '1000000.00', spent: '600000.00', balance: '400000.00', has_issued: true, has_spent: true },
      { profile_id: P(co, 'prorab'), issued: '500000.00', spent: '600000.00', balance: '-100000.00', has_issued: true, has_spent: true },
      { profile_id: P(co, 'taminotchi'), issued: '0.00', spent: '600000.00', balance: '-600000.00', has_issued: false, has_spent: true },
    ]
      .map((r) => ({ company_id: co.id, ...r }))
      .sort((a, b) => (a.profile_id < b.profile_id ? -1 : 1))

  it('admin, direktor, buxgalter — firmadagi hamma (manfiy balans ham); B firma ko`rinmaydi', async () => {
    for (const role of ['admin', 'direktor', 'buxgalter'] as const) {
      expect(await balances(A.users[role])).toEqual(expected(A))
    }
  })

  it('super_admin — barcha firmalar', async () => {
    const all = [...expected(A), ...expected(B)].sort((a, b) =>
      `${a.company_id}${a.profile_id}` < `${b.company_id}${b.profile_id}` ? -1 : 1,
    )
    expect(await balances(A.users.super_admin)).toEqual(all)
  })

  it('haydovchi, prorab — faqat o`zi; taminotchi barcha xaridlarni ko`rsa ham faqat o`zi', async () => {
    const own = (r: UserRole): Row[] => expected(A).filter((x) => x.profile_id === P(A, r))
    expect({
      haydovchi: await balances(A.users.haydovchi),
      prorab: await balances(A.users.prorab),
      taminotchi: await balances(A.users.taminotchi),
      omborchi: await balances(A.users.omborchi),
      tekshiruvchi: await balances(A.users.tekshiruvchi),
    }).toEqual({
      haydovchi: own('haydovchi'),
      prorab: own('prorab'),
      taminotchi: own('taminotchi'),
      omborchi: [],
      tekshiruvchi: [],
    })
  })

  it('taminotchi purchases`da boshqalar xaridini ko`radi, lekin ular uchun balans qatori yo`q', async () => {
    const r = await asUser(db, A.users.taminotchi.authUid, async (tx) => ({
      purchases: await scalar<number>(tx, `select count(*)::int from public.purchases where buyer_id <> private.my_profile_id()`),
      balances: await scalar<number>(tx, `select count(*)::int from public.cash_balances where profile_id <> private.my_profile_id()`),
    }))
    expect(r).toEqual({ purchases: 2, balances: 0 })
  })

  it('o`chirilgan podotchet va xarid hisobga olinmaydi; yangi pul berilsa qo`shiladi', async () => {
    const r = await inTx(async (tx) => {
      await tx.query(`update public.cash_advances set deleted_at = now() where id = $1`, [A.ids.ca_haydovchi])
      await tx.query(`update public.purchases set deleted_at = now() where id = $1`, [A.ids.p_tam_obj1])
      await tx.query(`insert into public.cash_advances (company_id, recipient_id, amount) values ($1, $2, 250000.50)`, [
        A.id,
        P(A, 'prorab'),
      ])
      await become(tx, A.users.admin)
      return rows(
        tx,
        `select profile_id, issued_total::text as issued, spent_total::text as spent, balance::text as balance
           from public.cash_balances where profile_id in ($1, $2, $3) order by issued_total`,
        [P(A, 'haydovchi'), P(A, 'prorab'), P(A, 'taminotchi')],
      )
    })
    // taminotchi: yagona xaridi o'chirildi → qator yo'q
    expect(r).toEqual([
      { profile_id: P(A, 'haydovchi'), issued: '0.00', spent: '600000.00', balance: '-600000.00' },
      { profile_id: P(A, 'prorab'), issued: '750000.50', spent: '600000.00', balance: '150000.50' },
    ])
  })

  it('view: security_invoker; anon — privilege yo`q; service_role — hammasi', async () => {
    const opts = await scalar<string[]>(
      db,
      `select reloptions from pg_class where oid = 'public.cash_balances'::regclass`,
    )
    expect(opts).toContain('security_invoker=true')
    expect(await scalar<boolean>(db, `select has_table_privilege('anon', 'public.cash_balances', 'select')`)).toBe(false)
    expect(await asAnon(db, (tx) => res(tx, `select * from public.cash_balances`))).toBe('42501:')
    expect(await asService(db, (tx) => scalar<number>(tx, `select count(*)::int from public.cash_balances`))).toBe(6)
  })
})

// ============================================================================
// 2. cash_advances.issued_at va idempotentlik
// ============================================================================
describe('cash_advances.issued_at', () => {
  // audit_fixes A6: buxgalter uchun issued_at oynasi [now − 3 kun, now + 5 daqiqa]; admin — istalgan.
  it('null → now(); o`tgan sana — buxgalter: rad (ops_occurred_at_range), admin: ruxsat; UPDATE`da null → eski qiymat', async () => {
    const past = await asUser(db, A.users.admin.authUid, (tx) =>
      one(
        tx,
        `insert into public.cash_advances (company_id, recipient_id, amount, issued_at) values ($1, $2, 1000, '2020-01-15T10:00:00Z')
         returning issued_at::text as at`,
        [A.id, A.users.haydovchi.profileId],
      ),
    )
    const r = await asUser(db, A.users.buxgalter.authUid, async (tx) => {
      const nowRow = await one(
        tx,
        `insert into public.cash_advances (company_id, recipient_id, amount, issued_at) values ($1, $2, 1000, null)
         returning id, issued_at = now() as is_now`,
        [A.id, A.users.haydovchi.profileId],
      )
      const pastBux = await res(
        tx,
        `insert into public.cash_advances (company_id, recipient_id, amount, issued_at) values ($1, $2, 1000, '2020-01-15T10:00:00Z')`,
        [A.id, A.users.haydovchi.profileId],
      )
      expect(pastBux).toBe('23514:ops_occurred_at_range')
      const upd = await one(
        tx,
        `update public.cash_advances set issued_at = null, note = 'x' where id = $1 returning issued_at = now() as is_now`,
        [nowRow.id],
      )
      return { is_now: nowRow.is_now, past: past.at, upd: upd.is_now }
    })
    expect(r).toEqual({ is_now: true, past: '2020-01-15 10:00:00+00', upd: true })
  })
})

describe('idempotentlik: klient id', () => {
  it('purchases: haydovchi o`z id`si bilan qo`shadi; takror — 23505 purchases_pkey', async () => {
    const id = randomUUID()
    const r = await asUser(db, A.users.haydovchi.authUid, async (tx) => {
      const first = await purchase(tx, { co: A, material: A.ids.m1!, qty: 1, total: 1000, buyer: A.users.haydovchi.profileId, id })
      const second = await errMsg(
        tx,
        `insert into public.purchases (id, company_id, buyer_id, object_id, material_id, qty_input, unit_input, total_amount)
         values ($1, $2, $3, $4, $5, 1, 'kg', 1000)`,
        [id, A.id, A.users.haydovchi.profileId, A.ids.obj1, A.ids.m1],
      )
      return { first, second }
    })
    expect(r.first).toBe(id)
    expect(r.second).toMatch(/^23505\|.*purchases_pkey/)
  })

  it('cash_advances: buxgalter o`z id`si bilan qo`shadi; takror — 23505 cash_advances_pkey', async () => {
    const id = randomUUID()
    const sql = `insert into public.cash_advances (id, company_id, recipient_id, amount) values ($1, $2, $3, 1000)`
    const r = await asUser(db, A.users.buxgalter.authUid, async (tx) => ({
      first: await res(tx, sql, [id, A.id, A.users.haydovchi.profileId]),
      second: await errMsg(tx, sql, [id, A.id, A.users.haydovchi.profileId]),
    }))
    expect(r.first).toBe('OK:1')
    expect(r.second).toMatch(/^23505\|.*cash_advances_pkey/)
  })
})

// ============================================================================
// 3. suppliers
// ============================================================================
describe('suppliers', () => {
  const insertAs = (u: TestUser, name: string, co = A): Promise<string> =>
    asUser(db, u.authUid, (tx) =>
      res(tx, `insert into public.suppliers (company_id, name) values ($1, $2) returning id`, [co.id, name]),
    )

  it('qo`shish: super_admin, admin, taminotchi, haydovchi, prorab — ha; qolganlar — 42501', async () => {
    const out: Record<string, string> = {}
    for (const role of Object.keys(A.users) as UserRole[]) out[role] = await insertAs(A.users[role], `Yangi ${role}`)
    expect(out).toEqual({
      super_admin: 'OK:1',
      admin: 'OK:1',
      direktor: '42501:',
      buxgalter: '42501:',
      taminotchi: 'OK:1',
      prorab: 'OK:1',
      omborchi: '42501:',
      haydovchi: 'OK:1',
      tekshiruvchi: '42501:',
    })
  })

  it('boshqa firmaga qo`shish — rad; created_by soxtalashtirish — rad', async () => {
    expect(await insertAs(A.users.haydovchi, 'Begona', B)).toBe('42501:')
    const forged = await asUser(db, A.users.haydovchi.authUid, (tx) =>
      res(tx, `insert into public.suppliers (company_id, name, created_by) values ($1, 'Soxta', $2)`, [
        A.id,
        A.users.admin.profileId,
      ]),
    )
    expect(forged).toBe('42501:')
  })

  it('o`zgartirish va soft delete — faqat admin (boshqalarda 0 qator)', async () => {
    const out: Record<string, string[]> = {}
    for (const role of ['admin', 'taminotchi', 'haydovchi', 'prorab'] as const) {
      out[role] = await asUser(db, A.users[role].authUid, async (tx) => [
        await res(tx, `update public.suppliers set phone = '+998901112233' where id = $1`, [A.ids.s1]),
        await res(tx, `update public.suppliers set deleted_at = now() where id = $1`, [A.ids.s1]),
      ])
    }
    expect(out).toEqual({
      admin: ['OK:1', 'OK:1'],
      taminotchi: ['OK:0', 'OK:0'],
      haydovchi: ['OK:0', 'OK:0'],
      prorab: ['OK:0', 'OK:0'],
    })
  })

  it('dublikat (norm_name: katta-kichik harf, bo`shliqlar) — 23505 supplier_duplicate', async () => {
    expect({
      exact: await insertAs(A.users.haydovchi, 'A sotuvchi'),
      upper: await insertAs(A.users.taminotchi, '  A   SOTUVCHI '),
      nbsp: await insertAs(A.users.admin, 'a sotuvchi'),
      otherCompany: await insertAs(B.users.admin, 'A sotuvchi', B),
    }).toEqual({
      exact: '23505:supplier_duplicate',
      upper: '23505:supplier_duplicate',
      nbsp: '23505:supplier_duplicate',
      otherCompany: 'OK:1',
    })
  })

  it('qayta nomlash dublikatga — rad; o`chirilgan nom bo`shaydi; tiklashda to`qnashuv — rad', async () => {
    const r = await asUser(db, A.users.admin.authUid, async (tx) => {
      const other = await scalar<string>(tx, `insert into public.suppliers (company_id, name) values ($1, 'Boshqa') returning id`, [A.id])
      const rename = await res(tx, `update public.suppliers set name = 'a sotuvchi' where id = $1`, [other])
      const del = await res(tx, `update public.suppliers set deleted_at = now() where id = $1`, [A.ids.s1])
      const reuse = await res(tx, `insert into public.suppliers (company_id, name) values ($1, 'A Sotuvchi')`, [A.id])
      const restore = await res(tx, `update public.suppliers set deleted_at = null where id = $1`, [A.ids.s1])
      return { rename, del, reuse, restore }
    })
    expect(r).toEqual({ rename: '23505:supplier_duplicate', del: 'OK:1', reuse: 'OK:1', restore: '23505:supplier_duplicate' })
  })

  it('zaxira unique indeks (company_id, norm_name(name)) o`chirilmaganlar orasida', async () => {
    const def = await scalar<string>(db, `select indexdef from pg_indexes where indexname = 'suppliers_company_name_key'`)
    expect(def).toMatch(/UNIQUE/)
    expect(def).toMatch(/norm_name\(name\)/)
    expect(def).toMatch(/deleted_at IS NULL/)
  })
})

// ============================================================================
// 4. purchase_receipts va open_purchases
// ============================================================================
describe('purchase_receipts', () => {
  it('bog`langan o`chirilmagan kirimlar yig`indisi, qolgan, soni', async () => {
    const r = await asUser(db, A.users.admin.authUid, (tx) =>
      one(
        tx,
        `select qty_base::text as q, received_qty_base::text as rcv, remaining_qty_base::text as rem, receipt_count::int as n,
                last_received_at is not null as has_last
           from public.purchase_receipts where purchase_id = $1`,
        [A.ids.p_pro_obj1],
      ),
    )
    expect(r).toEqual({ q: '500.000000', rcv: '100.000000', rem: '400.000000', n: 1, has_last: true })
  })

  it('haydovchi harakatlarni ko`rmasa ham o`z xaridi qabulini ko`radi; boshqalarnikini — yo`q', async () => {
    const r = await inTx(async (tx) => {
      await kirim(tx, A, A.ids.p_hay_obj2!, A.ids.m1!, 200, { object: A.ids.obj2 })
      await kirim(tx, A, A.ids.p_hay_obj2!, A.ids.m1!, 50, { object: A.ids.obj2 })
      const deleted = await kirim(tx, A, A.ids.p_hay_obj2!, A.ids.m1!, 1000, { object: A.ids.obj2 })
      await tx.query(`update public.movements set deleted_at = now() where id = $1`, [deleted])
      await become(tx, A.users.haydovchi)
      return {
        movements: await scalar<number>(tx, `select count(*)::int from public.movements`),
        receipts: await rows(
          tx,
          `select purchase_id, received_qty_base::text as rcv, remaining_qty_base::text as rem, receipt_count::int as n
             from public.purchase_receipts`,
        ),
      }
    })
    expect(r).toEqual({
      movements: 0,
      receipts: [{ purchase_id: A.ids.p_hay_obj2, rcv: '250.000000', rem: '250.000000', n: 2 }],
    })
  })

  it('ortiqcha qabul — remaining manfiy; o`chirilgan xarid view`da yo`q', async () => {
    const r = await inTx(async (tx) => {
      await kirim(tx, A, A.ids.p_pro_obj1!, A.ids.m1!, 450)
      await tx.query(`update public.purchases set deleted_at = now() where id = $1`, [A.ids.p_tam_obj1])
      await become(tx, A.users.admin)
      return rows(
        tx,
        `select purchase_id, remaining_qty_base::text as rem from public.purchase_receipts
          where purchase_id in ($1, $2)`,
        [A.ids.p_pro_obj1, A.ids.p_tam_obj1],
      )
    })
    expect(r).toEqual([{ purchase_id: A.ids.p_pro_obj1, rem: '-50.000000' }])
  })

  it('B firma foydalanuvchisi A xaridlarini ko`rmaydi; anon — privilege yo`q', async () => {
    const n = await asUser(db, B.users.admin.authUid, (tx) =>
      scalar<number>(tx, `select count(*)::int from public.purchase_receipts where company_id = $1`, [A.id]),
    )
    expect(n).toBe(0)
    expect(await asAnon(db, (tx) => res(tx, `select * from public.purchase_receipts`))).toBe('42501:')
  })
})

describe('open_purchases', () => {
  const open = (u: TestUser, obj: string, mat: string): Promise<Row[]> =>
    asUser(db, u.authUid, (tx) =>
      rows(
        tx,
        `select id, buyer_id, buyer_name, qty_base::text as q, received_qty_base::text as rcv,
                remaining_qty_base::text as rem, unit_input, unit_variant, qty_input::text as qi
           from public.open_purchases($1, $2)`,
        [obj, mat],
      ),
    )

  it('prorab: obyekt va material bo`yicha, remaining > 0, eng yangisi birinchi, xaridor ismi bilan', async () => {
    const r = await open(A.users.prorab, A.ids.obj1!, A.ids.m1!)
    // p_tam_obj1 va p_pro_obj1 — ikkalasi obj1; fixture'da p_pro_obj1 keyinroq yaratilgan
    expect(r).toEqual([
      {
        id: A.ids.p_pro_obj1,
        buyer_id: A.users.prorab.profileId,
        buyer_name: 'A prorab',
        q: '500.000000',
        rcv: '100.000000',
        rem: '400.000000',
        unit_input: 'qop',
        unit_variant: null,
        qi: '10.000000',
      },
      {
        id: A.ids.p_tam_obj1,
        buyer_id: A.users.taminotchi.profileId,
        buyer_name: 'A taminotchi',
        q: '500.000000',
        rcv: '0.000000',
        rem: '500.000000',
        unit_input: 'qop',
        unit_variant: null,
        qi: '10.000000',
      },
    ])
  })

  it('14 kundan eski, to`liq qabul qilingan va o`chirilgan xaridlar chiqmaydi', async () => {
    const r = await inTx(async (tx) => {
      const m = await newMaterial(tx, A)
      const fresh = await purchase(tx, { co: A, material: m, qty: 10, total: 100, at: '-13 days -23 hours' })
      const old = await purchase(tx, { co: A, material: m, qty: 10, total: 100, at: '-14 days -1 minute' })
      const full = await purchase(tx, { co: A, material: m, qty: 10, total: 100, at: '-1 day' })
      const over = await purchase(tx, { co: A, material: m, qty: 10, total: 100, at: '-2 days' })
      const del = await purchase(tx, { co: A, material: m, qty: 10, total: 100, at: '-3 days' })
      await kirim(tx, A, full, m, 10)
      await kirim(tx, A, over, m, 12)
      await tx.query(`update public.purchases set deleted_at = now() where id = $1`, [del])
      await become(tx, A.users.omborchi)
      const ids = await rows<{ id: string }>(tx, `select id from public.open_purchases($1, $2)`, [A.ids.obj1, m])
      return { ids: ids.map((x) => x.id), fresh, old }
    })
    expect(r.ids).toEqual([r.fresh])
  })

  it('RLS: omborchi a`zo bo`lmagan obyekt, haydovchi (boshqalar xaridi), B firma — bo`sh', async () => {
    expect({
      omborchiObj2: await open(A.users.omborchi, A.ids.obj2!, A.ids.m1!),
      haydovchiObj1: await open(A.users.haydovchi, A.ids.obj1!, A.ids.m1!),
      bAdmin: await open(B.users.admin, A.ids.obj1!, A.ids.m1!),
      omborchiObj1: (await open(A.users.omborchi, A.ids.obj1!, A.ids.m1!)).length,
    }).toEqual({ omborchiObj2: [], haydovchiObj1: [], bAdmin: [], omborchiObj1: 2 })
  })

  it('funksiya: security invoker, stable, search_path; anon — execute yo`q', async () => {
    const f = await one(
      db,
      `select p.prosecdef, p.provolatile, p.proconfig from pg_proc p
        where p.oid = 'public.open_purchases(uuid, uuid)'::regprocedure`,
    )
    expect(f).toEqual({ prosecdef: false, provolatile: 's', proconfig: ['search_path=""'] })
    expect(await asAnon(db, (tx) => res(tx, `select * from public.open_purchases($1, $2)`, [A.ids.obj1, A.ids.m1]))).toBe(
      '42501:',
    )
  })
})

// ============================================================================
// 5. Qoida 1 — xarid ≠ qabul (A firma chegarasi: 2 %)
// ============================================================================
describe('qoida 1: xarid ≠ qabul', () => {
  it('ortiqcha qabul — darhol alert; chegaradan oshgani sari details yangilanadi, alert bitta', async () => {
    const r = await inTx(async (tx) => {
      const m = await newMaterial(tx, A)
      const p = await purchase(tx, { co: A, material: m, qty: 100, total: 100000 })
      const k1 = await kirim(tx, A, p, m, 102) // 2.00 % = chegara → yo'q
      const atLimit = await alertsOf(tx, p, 'xarid_qabul_farqi')
      await tx.query(`update public.movements set qty_input = 105 where id = $1`, [k1]) // 5 % → ogohlantirish
      const first = await alertsOf(tx, p, 'xarid_qabul_farqi')
      const k2 = await kirim(tx, A, p, m, 1) // 106 → 6 % = 3 × 2 → jiddiy
      const second = await alertsOf(tx, p, 'xarid_qabul_farqi')
      return { atLimit, first, second, k1, k2, m }
    })
    expect(r.atLimit).toEqual([])
    expect(r.first).toHaveLength(1)
    expect(r.first[0]).toMatchObject({
      status: 'yangi',
      severity: 'ogohlantirish',
      company_id: A.id,
      movement_id: r.k1,
      details: {
        purchased_qty_base: 100,
        received_qty_base: 105,
        diff_pct: 5,
        threshold_pct: 2,
        direction: 'over',
        receipt_count: 1,
      },
    })
    expect(r.second).toHaveLength(1)
    expect(r.second[0]).toMatchObject({
      status: 'yangi',
      severity: 'jiddiy',
      details: { received_qty_base: 106, diff_pct: 6, receipt_count: 2 },
    })
  })

  it('formula: round(abs(received − purchased) * 100 / purchased, 2) — kasr miqdorlarda', async () => {
    const r = await inTx(async (tx) => {
      const m = await newMaterial(tx, A)
      const p = await purchase(tx, { co: A, material: m, qty: '3', total: 1000 })
      await kirim(tx, A, p, m, '3.1')
      const a = await alertsOf(tx, p, 'xarid_qabul_farqi')
      const expected = await scalar<string>(
        tx,
        `select round(abs(3.1::numeric(20,6) - 3::numeric(20,6)) * 100 / 3::numeric(20,6), 2)::text`,
      )
      const raw = await scalar<string>(
        tx,
        `select details ->> 'diff_pct' from public.alerts where purchase_id = $1 and type = 'xarid_qabul_farqi'`,
        [p],
      )
      return { a, expected, raw }
    })
    expect(r.expected).toBe('3.33')
    expect(r.raw).toBe('3.33')
    expect(r.a[0]).toMatchObject({ severity: 'ogohlantirish' })
  })

  it('kam qabul: 24 soatgacha yo`q (pending), 24 soatdan keyin — bor (p_now)', async () => {
    const r = await inTx(async (tx) => {
      const m = await newMaterial(tx, A)
      const p = await purchase(tx, { co: A, material: m, qty: 100, total: 100000 })
      await kirim(tx, A, p, m, 90)
      const immediately = await alertsOf(tx, p, 'xarid_qabul_farqi')
      await evalReceipt(tx, p, `now() + interval '23 hours 59 minutes'`)
      const before = await alertsOf(tx, p, 'xarid_qabul_farqi')
      await evalReceipt(tx, p, `now() + interval '24 hours'`)
      const after = await alertsOf(tx, p, 'xarid_qabul_farqi')
      await evalReceipt(tx, p, `now() + interval '3 days'`)
      const again = await alertsOf(tx, p, 'xarid_qabul_farqi')
      return { immediately, before, after, again }
    })
    expect(r.immediately).toEqual([])
    expect(r.before).toEqual([])
    expect(r.after).toHaveLength(1)
    expect(r.after[0]).toMatchObject({
      status: 'yangi',
      severity: 'jiddiy',
      details: { direction: 'under', diff_pct: 10, received_qty_base: 90 },
    })
    expect(r.again).toHaveLength(1)
  })

  it('eski xarid (24 soatdan oldin) — kam qabul kirim saqlanganda darhol', async () => {
    const r = await inTx(async (tx) => {
      const m = await newMaterial(tx, A)
      const p = await purchase(tx, { co: A, material: m, qty: 100, total: 100000, at: '-2 days' })
      await kirim(tx, A, p, m, 97)
      return alertsOf(tx, p, 'xarid_qabul_farqi')
    })
    expect(r).toHaveLength(1)
    expect(r[0]).toMatchObject({ severity: 'ogohlantirish', details: { direction: 'under', diff_pct: 3 } })
  })

  it('farq chegaradan tushsa — avtomatik yopiladi (closed_by null, auto_closed); yana oshsa — yangi alert', async () => {
    const r = await inTx(async (tx) => {
      const m = await newMaterial(tx, A)
      const p = await purchase(tx, { co: A, material: m, qty: 100, total: 100000 })
      const k = await kirim(tx, A, p, m, 110)
      await tx.query(`update public.movements set qty_input = 101 where id = $1`, [k])
      const closed = await alertsOf(tx, p, 'xarid_qabul_farqi')
      const closedAt = await scalar<boolean>(
        tx,
        `select closed_at is not null from public.alerts where purchase_id = $1 and type = 'xarid_qabul_farqi'`,
        [p],
      )
      await tx.query(`update public.movements set qty_input = 120 where id = $1`, [k])
      const reopened = await alertsOf(tx, p, 'xarid_qabul_farqi')
      return { closed, closedAt, reopened }
    })
    expect(r.closed).toHaveLength(1)
    expect(r.closed[0]).toMatchObject({
      status: 'yopildi',
      closed_by: null,
      details: { auto_closed: true, closed_reason: 'within_threshold', received_qty_base: 101, diff_pct: 1 },
    })
    expect(r.closedAt).toBe(true)
    expect(r.reopened.map((a) => a.status)).toEqual(['yopildi', 'yangi'])
    expect(r.reopened[1]).toMatchObject({ severity: 'jiddiy', details: { diff_pct: 20 } })
  })

  it('admin qo`lda yopgan alert: raqamlar o`zgarmasa qayta ochilmaydi (cron), o`zgarsa — yangi', async () => {
    const r = await inTx(async (tx) => {
      const m = await newMaterial(tx, A)
      const p = await purchase(tx, { co: A, material: m, qty: 100, total: 100000, at: '-2 days' })
      await kirim(tx, A, p, m, 50)
      await become(tx, A.users.admin)
      await tx.query(`update public.alerts set status = 'yopildi', close_note = 'Tekshirildi' where purchase_id = $1`, [p])
      await unbecome(tx)
      const manual = await alertsOf(tx, p, 'xarid_qabul_farqi')
      await evalReceipt(tx, p)
      await evalReceipt(tx, p, `now() + interval '1 day'`)
      const afterCron = await alertsOf(tx, p, 'xarid_qabul_farqi')
      await kirim(tx, A, p, m, 10)
      const afterChange = await alertsOf(tx, p, 'xarid_qabul_farqi')
      return { manual, afterCron, afterChange }
    })
    expect(r.manual).toHaveLength(1)
    expect(r.manual[0]).toMatchObject({ status: 'yopildi', closed_by: A.users.admin.profileId })
    expect(r.afterCron).toHaveLength(1)
    expect(r.afterChange.map((a) => a.status)).toEqual(['yopildi', 'yangi'])
    expect(r.afterChange[1]).toMatchObject({ details: { received_qty_base: 60, diff_pct: 40 } })
  })

  it('kirim o`chirilsa / boshqa xaridga ko`chirilsa — ikkala xarid qayta baholanadi', async () => {
    const r = await inTx(async (tx) => {
      const m = await newMaterial(tx, A)
      const p1 = await purchase(tx, { co: A, material: m, qty: 100, total: 100000, at: '-2 days' })
      const p2 = await purchase(tx, { co: A, material: m, qty: 10, total: 10000, at: '-2 days' })
      await kirim(tx, A, p1, m, 100)
      const extra = await kirim(tx, A, p1, m, 10) // p1: 110 → ortiqcha
      const p1Over = await alertsOf(tx, p1, 'xarid_qabul_farqi')
      await tx.query(`update public.movements set purchase_id = $2 where id = $1`, [extra, p2]) // p1: 100, p2: 10
      const moved = { p1: await alertsOf(tx, p1, 'xarid_qabul_farqi'), p2: await alertsOf(tx, p2, 'xarid_qabul_farqi') }
      await tx.query(`update public.movements set deleted_at = now() where id = $1`, [extra]) // p2: 0 → kam (2 kun)
      const deleted = await alertsOf(tx, p2, 'xarid_qabul_farqi')
      return { p1Over, moved, deleted }
    })
    expect(r.p1Over.map((a) => a.status)).toEqual(['yangi'])
    expect(r.moved.p1.map((a) => a.status)).toEqual(['yopildi'])
    expect(r.moved.p2).toEqual([])
    expect(r.deleted).toHaveLength(1)
    expect(r.deleted[0]).toMatchObject({ status: 'yangi', severity: 'jiddiy', details: { direction: 'under', diff_pct: 100 } })
  })

  it('ochiq ortiqcha alert, keyin kirim o`chirilib kam (24 soat o`tmagan) — alert ochiq qoladi, yangilanadi', async () => {
    const r = await inTx(async (tx) => {
      const m = await newMaterial(tx, A)
      const p = await purchase(tx, { co: A, material: m, qty: 100, total: 100000 })
      await kirim(tx, A, p, m, 60)
      const k = await kirim(tx, A, p, m, 50)
      await tx.query(`update public.movements set deleted_at = now() where id = $1`, [k])
      return alertsOf(tx, p, 'xarid_qabul_farqi')
    })
    expect(r).toHaveLength(1)
    expect(r[0]).toMatchObject({ status: 'yangi', details: { direction: 'under', received_qty_base: 60 } })
  })

  it('xarid miqdori o`zgarsa qayta baholanadi', async () => {
    const r = await inTx(async (tx) => {
      const m = await newMaterial(tx, A)
      const p = await purchase(tx, { co: A, material: m, qty: 100, total: 100000 })
      await kirim(tx, A, p, m, 100)
      await tx.query(`update public.purchases set qty_input = 90 where id = $1`, [p]) // 100 / 90 → ortiqcha
      return alertsOf(tx, p, 'xarid_qabul_farqi')
    })
    expect(r).toHaveLength(1)
    expect(r[0]).toMatchObject({ status: 'yangi', details: { purchased_qty_base: 90, diff_pct: 11.11 } })
  })

  it('xarid o`chirilsa — ochiq alertlar yopiladi (closed_by_actor), o`chirish alerti yaratiladi', async () => {
    const r = await inTx(async (tx) => {
      const m = await newMaterial(tx, A)
      const p = await purchase(tx, { co: A, material: m, qty: 100, total: 100000, at: '-2 days' })
      await evalReceipt(tx, p) // kirim yo'q, 2 kun → kam qabul
      const before = await alertsOf(tx, p, 'xarid_qabul_farqi')
      await become(tx, A.users.admin)
      await tx.query(`update public.purchases set deleted_at = now() where id = $1`, [p])
      await unbecome(tx)
      return { before, after: await alertsOf(tx, p) }
    })
    expect(r.before).toEqual([expect.objectContaining({ status: 'yangi', details: expect.objectContaining({ diff_pct: 100 }) })])
    const receipt = r.after.find((a) => a.type === 'xarid_qabul_farqi')
    expect(receipt).toMatchObject({
      status: 'yopildi',
      closed_by: null,
      details: { auto_closed: true, closed_reason: 'purchase_deleted', closed_by_actor: A.users.admin.profileId },
    })
    const del = r.after.find((a) => a.type === 'yozuv_ochirildi')
    expect(del).toMatchObject({ status: 'yangi', severity: 'ogohlantirish', created_by: A.users.admin.profileId })
  })

  it('firma chegarasi o`z firmasidan olinadi (B = 10 %); alert firma`si — xarid firmasi', async () => {
    const r = await inTx(async (tx) => {
      await tx.query(`update public.companies set receipt_mismatch_pct = 10 where id = $1`, [B.id])
      const ma = await newMaterial(tx, A)
      const mb = await newMaterial(tx, B)
      const pa = await purchase(tx, { co: A, material: ma, qty: 100, total: 100000 })
      const pb = await purchase(tx, { co: B, material: mb, qty: 100, total: 100000 })
      await kirim(tx, A, pa, ma, 105)
      await kirim(tx, B, pb, mb, 105)
      return { a: await alertsOf(tx, pa), b: await alertsOf(tx, pb) }
    })
    expect(r.a).toHaveLength(1)
    expect(r.a[0]!.company_id).toBe(A.id)
    expect(r.b).toEqual([])
  })

  it('aktyor: alert created_by va audit — kirimni kiritgan foydalanuvchi, device sarlavhadan', async () => {
    const r = await inTx(async (tx) => {
      const m = await newMaterial(tx, A)
      const p = await purchase(tx, { co: A, material: m, qty: 10, total: 10000, buyer: A.users.taminotchi.profileId })
      await become(tx, A.users.omborchi, 'mobil')
      const k = await kirim(tx, A, p, m, 20)
      const seen = await scalar<number>(tx, `select count(*)::int from public.alerts`) // omborchi alertlarni ko'rmaydi
      await unbecome(tx)
      const a = await one<{ id: string; created_by: string }>(
        tx,
        `select id, created_by from public.alerts where purchase_id = $1 and type = 'xarid_qabul_farqi'`,
        [p],
      )
      const audit = await one(
        tx,
        `select action, actor_profile_id, device from public.audit_log where table_name = 'alerts' and record_id = $1`,
        [a.id],
      )
      return { k, seen, createdBy: a.created_by, audit }
    })
    expect(r.seen).toBe(0)
    expect(r.createdBy).toBe(A.users.omborchi.profileId)
    expect(r.audit).toEqual({ action: 'INSERT', actor_profile_id: A.users.omborchi.profileId, device: 'mobil' })
  })
})

// ============================================================================
// 6. Qoida 2 — o'zi qabul qilgan
// ============================================================================
describe('qoida 2: o`zi qabul qilgan', () => {
  it('xaridor o`zi kirim qilsa — belgi (har juftlik uchun bitta); boshqa odam — yo`q', async () => {
    const r = await inTx(async (tx) => {
      const m = await newMaterial(tx, A)
      await become(tx, A.users.prorab, 'mobil')
      const p = await purchase(tx, { co: A, material: m, qty: 100, total: 100000 })
      const k1 = await kirim(tx, A, p, m, 50)
      const k2 = await kirim(tx, A, p, m, 50)
      await unbecome(tx)
      await tx.query(`update public.movements set qty_input = 49 where id = $1`, [k1]) // qayta baholash
      const other = await kirim(tx, A, p, m, 1, { createdBy: A.users.omborchi.profileId })
      const alerts = await alertsOf(tx, p, 'ozi_qabul_qilgan')
      return { alerts, k1, k2, other }
    })
    expect(r.alerts).toHaveLength(2)
    expect(r.alerts.map((a) => a.movement_id).sort()).toEqual([r.k1, r.k2].sort())
    expect(r.alerts[0]).toMatchObject({
      status: 'yangi',
      severity: 'belgi',
      created_by: A.users.prorab.profileId,
      details: { buyer_id: A.users.prorab.profileId, receiver_id: A.users.prorab.profileId },
    })
  })

  it('kirim o`chirilsa — belgi avtomatik yopiladi; tiklansa — qayta ochiladi', async () => {
    const r = await inTx(async (tx) => {
      const m = await newMaterial(tx, A)
      const me = A.users.prorab.profileId
      const p = await purchase(tx, { co: A, material: m, qty: 10, total: 1000, createdBy: me })
      const k = await kirim(tx, A, p, m, 10, { createdBy: me })
      await tx.query(`update public.movements set deleted_at = now() where id = $1`, [k])
      const closed = await alertsOf(tx, p, 'ozi_qabul_qilgan')
      await tx.query(`update public.movements set deleted_at = null where id = $1`, [k])
      const restored = await alertsOf(tx, p, 'ozi_qabul_qilgan')
      return { closed, restored }
    })
    expect(r.closed).toEqual([
      expect.objectContaining({ status: 'yopildi', closed_by: null, details: expect.objectContaining({ auto_closed: true }) }),
    ])
    expect(r.restored).toHaveLength(1)
    expect(r.restored[0]).toMatchObject({ status: 'yangi', closed_by: null })
  })

  it('admin qo`lda yopgan belgi qayta ochilmaydi; xaridor o`zgarsa (admin) — belgi yopiladi', async () => {
    const r = await inTx(async (tx) => {
      const m = await newMaterial(tx, A)
      const me = A.users.prorab.profileId
      const p = await purchase(tx, { co: A, material: m, qty: 10, total: 1000, createdBy: me })
      const k = await kirim(tx, A, p, m, 10, { createdBy: me })
      await tx.query(`update public.alerts set status = 'yopildi', close_note = 'Tekshirildi' where purchase_id = $1 and type = 'ozi_qabul_qilgan'`, [p])
      await tx.query(`update public.movements set qty_input = 9 where id = $1`, [k])
      const manual = await alertsOf(tx, p, 'ozi_qabul_qilgan')

      const p2 = await purchase(tx, { co: A, material: m, qty: 10, total: 1000, createdBy: me })
      await kirim(tx, A, p2, m, 10, { createdBy: me })
      await tx.query(`update public.purchases set buyer_id = $2 where id = $1`, [p2, A.users.taminotchi.profileId])
      const buyerChanged = await alertsOf(tx, p2, 'ozi_qabul_qilgan')
      return { manual, buyerChanged }
    })
    expect(r.manual.map((a) => a.status)).toEqual(['yopildi'])
    expect(r.buyerChanged).toEqual([
      expect.objectContaining({ status: 'yopildi', details: expect.objectContaining({ closed_reason: 'not_applicable' }) }),
    ])
  })
})

// ============================================================================
// 7. Qoida 3 — narx og'ishi (A firma: 8 %, oyna 5, 90 kun; past: <= −50 %)
// ============================================================================
describe('qoida 3: narx og`ishi', () => {
  /** Oldingi xaridlar (kg narxi, 10 kg), har biri bir kun oldinroq; keyin joriy xarid (−1 soat). */
  async function scenario(
    tx: Tx,
    previous: number[],
    current: number,
    opts: { co?: CompanyFixture } = {},
  ): Promise<{ m: string; p: string; prev: string[] }> {
    const co = opts.co ?? A
    const m = await newMaterial(tx, co)
    const prev: string[] = []
    for (let i = 0; i < previous.length; i++) {
      prev.push(
        await purchase(tx, {
          co,
          material: m,
          qty: 10,
          total: (previous[i]! * 10).toFixed(2),
          at: `-${previous.length - i + 1} days`,
        }),
      )
    }
    const p = await purchase(tx, { co, material: m, qty: 10, total: (current * 10).toFixed(2), at: '-1 hour' })
    return { m, p, prev }
  }
  const price = (q: Queryable, p: string): Promise<AlertRow[]> => alertsOf(q, p, 'narx_ogishi')

  it('oldingi xarid 1 ta — tekshirilmaydi; 2 ta — tekshiriladi (details)', async () => {
    const r = await inTx(async (tx) => {
      const one1 = await scenario(tx, [1000], 5000)
      const two = await scenario(tx, [1000, 1000], 1200)
      return { one: await price(tx, one1.p), two: await price(tx, two.p) }
    })
    expect(r.one).toEqual([])
    expect(r.two).toHaveLength(1)
    expect(r.two[0]).toMatchObject({
      status: 'yangi',
      severity: 'ogohlantirish',
      details: {
        avg_n: 1000,
        diff_n: 20,
        avg_90: 1000,
        diff_90: 20,
        price: 1200,
        direction: 'high',
        window_size: 5,
        threshold_pct: 8,
      },
    })
  })

  it('chegaralar: +8.00 % — yo`q; +8.01 % — high; −40 % — yo`q; −50 % — low; −49.99 % — yo`q; −60 % — low', async () => {
    const r = await inTx(async (tx) => {
      const out: Record<string, string> = {}
      const cases: [string, number][] = [
        ['p8', 1080],
        ['p801', 1080.1],
        ['m40', 600],
        ['m50', 500],
        ['m4999', 500.1],
        ['m60', 400],
      ]
      for (const [label, cur] of cases) {
        const a = await price(tx, (await scenario(tx, [1000, 1000], cur)).p)
        out[label] = a.length === 0 ? '-' : `${String(a[0]!.details.direction)} ${String(a[0]!.details.diff_n)}`
      }
      return out
    })
    expect(r).toEqual({ p8: '-', p801: 'high 8.01', m40: '-', m50: 'low -50', m4999: '-', m60: 'low -60' })
  })

  it('miqdorga tortilgan o`rtacha: mayda qimmat xarid o`rtachani buzmaydi', async () => {
    const r = await inTx(async (tx) => {
      const m = await newMaterial(tx, A)
      await purchase(tx, { co: A, material: m, qty: 100, total: 100000, at: '-3 days' }) // 1000/kg
      await purchase(tx, { co: A, material: m, qty: 1, total: 5000, at: '-2 days' }) // 5000/kg, 1 kg
      const p = await purchase(tx, { co: A, material: m, qty: 10, total: 12000, at: '-1 hour' }) // 1200/kg
      return price(tx, p)
    })
    // (100000 + 5000) / 101 = 1039.6040; oddiy o'rtacha (3000) bo'lganda — "low" chiqardi
    expect(r).toHaveLength(1)
    expect(r[0]!.details).toMatchObject({ avg_n: 1039.604, diff_n: 15.43, avg_90: 1039.604, direction: 'high' })
  })

  it('bosqichma-bosqich +2.6 %: oyna (2) ushlamaydi, 90 kunlik o`rtacha ushlaydi', async () => {
    const r = await inTx(async (tx) => {
      await tx.query(`update public.companies set price_avg_window = 2 where id = $1`, [A.id])
      const m = await newMaterial(tx, A)
      const ids: string[] = []
      const steps = 12
      for (let k = 0; k < steps; k++) {
        const pr = 1000 * Math.pow(1.026, k)
        ids.push(await purchase(tx, { co: A, material: m, qty: 10, total: (pr * 10).toFixed(2), at: `-${steps - k} days` }))
      }
      return rows<{ details: Record<string, number | string> }>(
        tx,
        `select details from public.alerts where purchase_id = any($1) and type = 'narx_ogishi'`,
        [ids],
      )
    })
    expect(r.length).toBeGreaterThan(0)
    for (const a of r) {
      expect(a.details.direction).toBe('high')
      expect(Number(a.details.diff_n)).toBeLessThanOrEqual(8)
      expect(Number(a.details.diff_90)).toBeGreaterThan(8)
    }
  })

  it('oyna: oxirgi price_avg_window ta; 90 kundan eski xarid avg_90 ga kirmaydi; o`chirilganlar hisobga olinmaydi', async () => {
    const r = await inTx(async (tx) => {
      const run = async (): Promise<AlertRow[]> => {
        const m = await newMaterial(tx, A)
        await purchase(tx, { co: A, material: m, qty: 10, total: 5000, at: '-100 days' }) // 500/kg
        await purchase(tx, { co: A, material: m, qty: 10, total: 10000, at: '-3 days' })
        await purchase(tx, { co: A, material: m, qty: 10, total: 10000, at: '-2 days' })
        return price(tx, await purchase(tx, { co: A, material: m, qty: 10, total: 10500, at: '-1 hour' }))
      }
      await tx.query(`update public.companies set price_avg_window = 2 where id = $1`, [A.id])
      const w2 = await run() // avg_n 1000 (5 %), avg_90 1000 (5 %) → yo'q
      await tx.query(`update public.companies set price_avg_window = 3 where id = $1`, [A.id])
      const w3 = await run() // avg_n 833.3333 (26 %) → high, avg_90 1000

      const m = await newMaterial(tx, A)
      const old = await purchase(tx, { co: A, material: m, qty: 10, total: 5000, at: '-5 days' })
      await purchase(tx, { co: A, material: m, qty: 10, total: 10000, at: '-4 days' })
      await purchase(tx, { co: A, material: m, qty: 10, total: 10000, at: '-3 days' })
      await tx.query(`update public.purchases set deleted_at = now() where id = $1`, [old])
      const del = await price(tx, await purchase(tx, { co: A, material: m, qty: 10, total: 10500, at: '-1 hour' }))
      return { w2, w3, del }
    })
    expect(r.w2).toEqual([])
    expect(r.w3).toHaveLength(1)
    expect(r.w3[0]!.details).toMatchObject({ avg_n: 833.3333, diff_n: 26, avg_90: 1000, diff_90: 5, window_size: 3 })
    expect(r.del).toEqual([])
  })

  it('keyin kiritilgan, lekin purchased_at bo`yicha eskiroq xarid — oldingilar qatorida (qayta baholashda)', async () => {
    const r = await inTx(async (tx) => {
      const m = await newMaterial(tx, A)
      await purchase(tx, { co: A, material: m, qty: 10, total: 10000, at: '-2 days' })
      const late = await purchase(tx, { co: A, material: m, qty: 10, total: 30000, at: '-1 hour' })
      await purchase(tx, { co: A, material: m, qty: 10, total: 10000, at: '-3 days' })
      const before = await price(tx, late)
      await tx.query(`update public.purchases set total_amount = 30010 where id = $1`, [late])
      return { before, after: await price(tx, late) }
    })
    expect(r.before).toEqual([]) // INSERT paytida faqat 1 ta oldingi
    expect(r.after).toHaveLength(1)
    expect(r.after[0]!.details).toMatchObject({ avg_n: 1000, direction: 'high' })
  })

  it('o`rtacha 0 — tekshirilmaydi', async () => {
    const r = await inTx(async (tx) => price(tx, (await scenario(tx, [0, 0], 100)).p))
    expect(r).toEqual([])
  })

  it('narx tushirilsa — avtomatik yopiladi; oshirilsa — yangi; bitta ochiq alert', async () => {
    const r = await inTx(async (tx) => {
      const { p } = await scenario(tx, [1000, 1000], 1500)
      await tx.query(`update public.purchases set total_amount = 16000 where id = $1`, [p])
      const updated = await price(tx, p)
      await tx.query(`update public.purchases set total_amount = 10000 where id = $1`, [p])
      const closed = await price(tx, p)
      await tx.query(`update public.purchases set total_amount = 20000 where id = $1`, [p])
      const again = await price(tx, p)
      return { updated, closed, again }
    })
    expect(r.updated).toHaveLength(1)
    expect(r.updated[0]).toMatchObject({ status: 'yangi', details: { price: 1600, diff_n: 60 } })
    expect(r.closed).toEqual([
      expect.objectContaining({ status: 'yopildi', closed_by: null, details: expect.objectContaining({ auto_closed: true }) }),
    ])
    expect(r.again.map((a) => a.status)).toEqual(['yopildi', 'yangi'])
  })

  it('xarid o`chirilsa — yopiladi; boshqa firma xaridlari aralashmaydi', async () => {
    const r = await inTx(async (tx) => {
      const { p } = await scenario(tx, [1000, 1000], 2000)
      await tx.query(`update public.purchases set deleted_at = now() where id = $1`, [p])
      const deleted = await price(tx, p)
      const b = await scenario(tx, [5000, 5000], 5000, { co: B })
      return { deleted, b: await price(tx, b.p) }
    })
    expect(r.deleted).toEqual([
      expect.objectContaining({ status: 'yopildi', details: expect.objectContaining({ closed_reason: 'purchase_deleted' }) }),
    ])
    expect(r.b).toEqual([])
  })

  it('haydovchi xaridi (foydalanuvchi sessiyasi) — alert, aktyor haydovchi', async () => {
    const r = await inTx(async (tx) => {
      const m = await newMaterial(tx, A)
      await purchase(tx, { co: A, material: m, qty: 10, total: 10000, at: '-2 days' })
      await purchase(tx, { co: A, material: m, qty: 10, total: 10000, at: '-1 day' })
      await become(tx, A.users.haydovchi, 'mobil')
      const p = await purchase(tx, { co: A, material: m, qty: 10, total: 12000, buyer: A.users.haydovchi.profileId })
      await unbecome(tx)
      return price(tx, p)
    })
    expect(r).toHaveLength(1)
    expect(r[0]).toMatchObject({ type: 'narx_ogishi', created_by: A.users.haydovchi.profileId })
  })
})

describe('check_purchase_price RPC', () => {
  it('ok / high / low — faqat matn; raqam qaytmaydi', async () => {
    const r = await inTx(async (tx) => {
      const m = await newMaterial(tx, A)
      await purchase(tx, { co: A, material: m, qty: 10, total: 10000, at: '-3 days' })
      await purchase(tx, { co: A, material: m, qty: 10, total: 10000, at: '-2 days' })
      const single = await newMaterial(tx, A)
      await purchase(tx, { co: A, material: single, qty: 10, total: 10000, at: '-2 days' })
      // haydovchi boshqalar xaridini ko'rmaydi — baribir firmaning butun oynasi ishlatiladi
      await become(tx, A.users.haydovchi, 'mobil')
      const c = (mat: string, p: number | string): Promise<unknown> =>
        scalar(tx, `select public.check_purchase_price($1, $2)`, [mat, p])
      return {
        same: await c(m, 1000),
        exact: await c(m, 1080),
        high: await c(m, 1080.1),
        low: await c(m, 500),
        notLow: await c(m, 500.1),
        single: await c(single, 99999),
        unknown: await c(randomUUID(), 1),
      }
    })
    expect(r).toEqual({ same: 'ok', exact: 'ok', high: 'high', low: 'low', notLow: 'ok', single: 'ok', unknown: 'ok' })
  })

  it('boshqa firma materiali — har doim ok (B ma`lumoti ishlatilmaydi)', async () => {
    const r = await inTx(async (tx) => {
      const mb = await newMaterial(tx, B)
      await purchase(tx, { co: B, material: mb, qty: 10, total: 10000, at: '-3 days' })
      await purchase(tx, { co: B, material: mb, qty: 10, total: 10000, at: '-2 days' })
      await become(tx, A.users.admin)
      const a = await scalar(tx, `select public.check_purchase_price($1, 1000000)`, [mb])
      await unbecome(tx)
      await become(tx, B.users.admin)
      const b = await scalar(tx, `select public.check_purchase_price($1, 1000000)`, [mb])
      return { a, b }
    })
    expect(r).toEqual({ a: 'ok', b: 'high' })
  })

  it('imzo: text qaytaradi (to`plam emas), security definer, stable, search_path; anon — yo`q', async () => {
    const f = await one(
      db,
      `select p.prorettype::regtype::text as ret, p.proretset, p.prosecdef, p.provolatile, p.proconfig
         from pg_proc p where p.oid = 'public.check_purchase_price(uuid, numeric)'::regprocedure`,
    )
    expect(f).toEqual({ ret: 'text', proretset: false, prosecdef: true, provolatile: 's', proconfig: ['search_path=""'] })
    expect(await asAnon(db, (tx) => res(tx, `select public.check_purchase_price($1, 1)`, [A.ids.m1]))).toBe('42501:')
  })
})

// ============================================================================
// 7a. Soatlik tekshiruv (kirimsiz xaridlar) va 2-qoida evristikasi
// ============================================================================
describe('evaluate_due_purchases (pg_cron)', () => {
  it('kirimsiz xarid 24 soatdan keyin — alert; ok, 60 kundan eski, qo`lda yopilgan — o`tkaziladi', async () => {
    const r = await inTx(async (tx) => {
      const m = await newMaterial(tx, A)
      const due = await purchase(tx, { co: A, material: m, qty: 100, total: 100000, at: '-25 hours' })
      const fresh = await purchase(tx, { co: A, material: m, qty: 100, total: 100000, at: '-23 hours' })
      const ok = await purchase(tx, { co: A, material: m, qty: 100, total: 100000, at: '-25 hours' })
      await kirim(tx, A, ok, m, 100)
      await purchase(tx, { co: A, material: m, qty: 100, total: 100000, at: '-61 days' })
      const manual = await purchase(tx, { co: A, material: m, qty: 100, total: 100000, at: '-30 hours' })
      await kirim(tx, A, manual, m, 50) // eski xarid → darhol alert
      await tx.query(`update public.alerts set status = 'yopildi', close_note = 'Tekshirildi' where purchase_id = $1`, [manual])
      const before = await alertsOf(tx, due, 'xarid_qabul_farqi')
      const n1 = await scalar<number>(tx, `select private.evaluate_due_purchases()`)
      const after = await alertsOf(tx, due, 'xarid_qabul_farqi')
      const n2 = await scalar<number>(tx, `select private.evaluate_due_purchases()`)
      return {
        before,
        n1,
        after,
        n2,
        fresh: await alertsOf(tx, fresh, 'xarid_qabul_farqi'),
        manual: (await alertsOf(tx, manual, 'xarid_qabul_farqi')).map((a) => a.status),
      }
    })
    expect(r.before).toEqual([])
    expect(r.n1).toBe(1)
    expect(r.after).toEqual([
      expect.objectContaining({
        status: 'yangi',
        severity: 'jiddiy',
        created_by: null,
        details: expect.objectContaining({ direction: 'under', received_qty_base: 0, diff_pct: 100, receipt_count: 0 }),
      }),
    ])
    expect(r.n2).toBe(0) // ochiq alert raqamlari o'zgarmagan
    expect(r.fresh).toEqual([])
    expect(r.manual).toEqual(['yopildi'])
  })

  it('pg_cron ishi: har soat (7-daqiqa), evaluate_due_purchases; funksiya — hech kimga execute yo`q', async () => {
    const job = await rows(db, `select schedule, command from cron.job where jobname = 'terron-evaluate-purchases'`)
    expect(job).toEqual([{ schedule: '7 * * * *', command: 'select private.evaluate_due_purchases()' }])
    expect(
      await asUser(db, A.users.admin.authUid, (tx) => res(tx, `select private.evaluate_due_purchases()`)),
    ).toBe('42501:')
    expect(await asService(db, (tx) => res(tx, `select private.evaluate_due_purchases()`))).toBe('42501:')
  })
})

describe('qoida 2: bog`lanmagan kirim (evristika ±48 soat)', () => {
  const byMovement = (q: Queryable, mv: string): Promise<AlertRow[]> =>
    rows<AlertRow>(
      q,
      `select type::text, status::text, severity::text, details, closed_by, movement_id, purchase_id, company_id, created_by
         from public.alerts where movement_id = $1 and type = 'ozi_qabul_qilgan' order by created_at, id`,
      [mv],
    )

  it('xaridor o`zi xarid qilgan obyekt+materialga bog`lanmagan kirim — belgi (linked = false); boshqa odam — yo`q', async () => {
    const r = await inTx(async (tx) => {
      const m = await newMaterial(tx, A)
      await become(tx, A.users.prorab, 'mobil')
      const p = await purchase(tx, { co: A, material: m, qty: 10, total: 1000 })
      const own = await kirim(tx, A, null, m, 10)
      await unbecome(tx)
      const other = await kirim(tx, A, null, m, 10, { createdBy: A.users.omborchi.profileId })
      const ownAlerts = await byMovement(tx, own)
      // keyin bog'lansa — o'sha juftlik, linked = true
      await tx.query(`update public.movements set purchase_id = $2 where id = $1`, [own, p])
      return { p, ownAlerts, linked: await byMovement(tx, own), other: await byMovement(tx, other) }
    })
    expect(r.ownAlerts).toEqual([
      expect.objectContaining({
        status: 'yangi',
        severity: 'belgi',
        purchase_id: r.p,
        details: expect.objectContaining({ linked: false, buyer_id: A.users.prorab.profileId }),
      }),
    ])
    expect(r.linked).toEqual([
      expect.objectContaining({ status: 'yangi', purchase_id: r.p, details: expect.objectContaining({ linked: true }) }),
    ])
    expect(r.other).toEqual([])
  })

  it('xarid 48 soatdan oldin — yo`q; kirim avval, xarid keyin — xarid saqlanganda belgi', async () => {
    const r = await inTx(async (tx) => {
      const m1 = await newMaterial(tx, A)
      await purchase(tx, { co: A, material: m1, qty: 10, total: 1000, at: '-49 hours', createdBy: A.users.prorab.profileId })
      const m2 = await newMaterial(tx, A)
      await become(tx, A.users.prorab)
      const far = await kirim(tx, A, null, m1, 10)
      const first = await kirim(tx, A, null, m2, 10)
      const p = await purchase(tx, { co: A, material: m2, qty: 10, total: 1000 })
      await unbecome(tx)
      return { far: await byMovement(tx, far), first: await byMovement(tx, first), p }
    })
    expect(r.far).toEqual([])
    expect(r.first).toEqual([
      expect.objectContaining({ purchase_id: r.p, details: expect.objectContaining({ linked: false }) }),
    ])
  })
})

// ============================================================================
// 8. Xavfsizlik
// ============================================================================
describe('xavfsizlik', () => {
  it('authenticated (admin ham) alert yarata olmaydi', async () => {
    const out: Record<string, string> = {}
    for (const role of ['admin', 'super_admin', 'prorab'] as const) {
      out[role] = await asUser(db, A.users[role].authUid, (tx) =>
        res(tx, `insert into public.alerts (company_id, type, purchase_id) values ($1, 'xarid_qabul_farqi', $2)`, [
          A.id,
          A.ids.p_pro_obj1,
        ]),
      )
    }
    expect(out).toEqual({ admin: '42501:', super_admin: '42501:', prorab: '42501:' })
  })

  it('authenticated qoida funksiyalarini chaqira olmaydi', async () => {
    const calls = [
      `select private.evaluate_purchase_receipt('${A.ids.p_pro_obj1}', now())`,
      `select private.evaluate_self_receipt('${A.ids.mv_obj1}')`,
      `select private.evaluate_purchase_price('${A.ids.p_pro_obj1}')`,
      `select private.close_purchase_alerts('${A.id}', '${A.ids.p_pro_obj1}', null, 'x')`,
    ]
    const out = await asUser(db, A.users.admin.authUid, async (tx) => {
      const r: string[] = []
      for (const c of calls) r.push(await res(tx, c))
      return r
    })
    expect(out).toEqual(['42501:', '42501:', '42501:', '42501:'])
  })

  it('qoida funksiyalari: security definer, search_path = ``', async () => {
    const r = await rows(
      db,
      `select p.proname, p.prosecdef, p.proconfig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'private'
          and p.proname in ('evaluate_purchase_receipt', 'evaluate_self_receipt', 'evaluate_purchase_price',
                            'close_purchase_alerts', 'tg_purchases_alerts', 'tg_movements_alerts', 'purchase_receipt_stats')
        order by 1`,
    )
    expect(r).toHaveLength(7)
    for (const f of r) expect(f).toMatchObject({ prosecdef: true, proconfig: ['search_path=""'] })
  })

  it('admin alertni qo`lda yopsa closed_by = admin (tizim emas)', async () => {
    const r = await asUser(db, A.users.admin.authUid, (tx) =>
      one(tx, `update public.alerts set status = 'yopildi', close_note = 'Tekshirildi' where id = $1 returning closed_by`, [A.ids.alert1]),
    )
    expect(r).toEqual({ closed_by: A.users.admin.profileId })
  })

  it('fixture: oddiy xarid/kirimlar alert yaratmagan (B firma — faqat fixture alerti)', async () => {
    // Batch 12: fixture'dagi bog'lanmagan kirim (mv_obj2, ochiq xarid bor) — kirim_manbasiz belgisi
    const n = await scalar<number>(
      db,
      `select count(*)::int from public.alerts where company_id = $1 and type::text <> 'kirim_manbasiz'`,
      [B.id],
    )
    expect(n).toBe(1)
  })
})

// ============================================================================
// 9. Reviewer topilmalari: O1, O2, O6, P5, P7, P9
// ============================================================================
describe('O1/P5: bog`langan kirimi bor xarid', () => {
  it('soft delete, obyekt yoki materialni o`zgartirish — purchase_has_receipts; kirim o`chirilgach — mumkin', async () => {
    const r = await inTx(async (tx) => {
      const m = await newMaterial(tx, A)
      const m2 = await newMaterial(tx, A)
      const p = await purchase(tx, { co: A, material: m, qty: 10, total: 1000 })
      const k = await kirim(tx, A, p, m, 10)
      await become(tx, A.users.admin)
      const out = {
        del: await res(tx, `update public.purchases set deleted_at = now() where id = $1`, [p]),
        object: await res(tx, `update public.purchases set object_id = $2 where id = $1`, [p, A.ids.obj2]),
        material: await res(
          tx,
          `update public.purchases set material_id = $2,
             unit_id = (select id from public.material_units where material_id = $2 and factor = 1) where id = $1`,
          [p, m2],
        ),
        note: await res(tx, `update public.purchases set note = 'x' where id = $1`, [p]),
        kirimDel: await res(tx, `update public.movements set deleted_at = now() where id = $1`, [k]),
        delAfter: await res(tx, `update public.purchases set deleted_at = now() where id = $1`, [p]),
      }
      return out
    })
    expect(r).toEqual({
      del: 'P0001:purchase_has_receipts',
      object: 'P0001:purchase_has_receipts',
      material: 'P0001:purchase_has_receipts',
      note: 'OK:1',
      kirimDel: 'OK:1',
      delAfter: 'OK:1',
    })
  })
})

describe('yozuv_ochirildi alerti', () => {
  const delAlerts = (q: Queryable, recordId: string): Promise<AlertRow[]> =>
    rows<AlertRow>(
      q,
      `select type::text, status::text, severity::text, details, closed_by, movement_id, purchase_id, company_id, created_by
         from public.alerts where type::text = 'yozuv_ochirildi' and details ->> 'record_id' = $1::text
        order by (status = 'yopildi') desc, created_at, id`,
      [recordId],
    )

  it('enum qiymati mavjud', async () => {
    expect(
      await scalar<boolean>(db, `select 'yozuv_ochirildi' = any(enum_range(null::public.alert_type)::text[])`),
    ).toBe(true)
  })

  it('cash_advances: buxgalter o`chirsa — alert (summa, aktyor); admin tiklasa — avtomatik yopiladi', async () => {
    const r = await inTx(async (tx) => {
      await become(tx, A.users.buxgalter, 'veb')
      await tx.query(`update public.cash_advances set deleted_at = now() where id = $1`, [A.ids.ca_haydovchi])
      await unbecome(tx)
      const deleted = await delAlerts(tx, A.ids.ca_haydovchi!)
      await become(tx, A.users.admin)
      await tx.query(`update public.cash_advances set deleted_at = null where id = $1`, [A.ids.ca_haydovchi])
      await unbecome(tx)
      return { deleted, restored: await delAlerts(tx, A.ids.ca_haydovchi!) }
    })
    expect(r.deleted).toEqual([
      expect.objectContaining({
        status: 'yangi',
        severity: 'ogohlantirish',
        company_id: A.id,
        created_by: A.users.buxgalter.profileId,
        details: expect.objectContaining({
          table: 'cash_advances',
          record_id: A.ids.ca_haydovchi,
          actor_profile_id: A.users.buxgalter.profileId,
          amount: 1000000,
          recipient_id: A.users.haydovchi.profileId,
        }),
      }),
    ])
    expect(r.restored).toEqual([
      expect.objectContaining({
        status: 'yopildi',
        closed_by: null,
        details: expect.objectContaining({
          auto_closed: true,
          closed_reason: 'restored',
          closed_by_actor: A.users.admin.profileId,
        }),
      }),
    ])
  })

  it('movements va purchases: alert bog`lanishlar bilan (movement_id / purchase_id, obyekt, material, miqdor)', async () => {
    const r = await inTx(async (tx) => {
      const m = await newMaterial(tx, A)
      const p = await purchase(tx, { co: A, material: m, qty: 10, total: 1000 })
      const k = await kirim(tx, A, null, m, 7)
      await tx.query(`update public.movements set deleted_at = now() where id = $1`, [k])
      await tx.query(`update public.purchases set deleted_at = now() where id = $1`, [p])
      return { k, p, m, mv: await delAlerts(tx, k), pu: await delAlerts(tx, p) }
    })
    expect(r.mv).toEqual([
      expect.objectContaining({
        movement_id: r.k,
        purchase_id: null,
        created_by: null,
        details: expect.objectContaining({
          table: 'movements',
          qty_base: 7,
          material_id: r.m,
          object_id: A.ids.obj1,
          actor_profile_id: null,
        }),
      }),
    ])
    expect(r.pu).toEqual([
      expect.objectContaining({
        purchase_id: r.p,
        status: 'yangi',
        details: expect.objectContaining({ table: 'purchases', amount: 1000, qty_base: 10 }),
      }),
    ])
  })
})

describe('O2: cash_advances', () => {
  it('amount va recipient_id o`zgarmaydi (hamma uchun); note va soft delete — mumkin', async () => {
    const r = await asUser(db, A.users.buxgalter.authUid, async (tx) => ({
      amount: await res(tx, `update public.cash_advances set amount = 1 where id = $1`, [A.ids.ca_haydovchi]),
      recipient: await res(tx, `update public.cash_advances set recipient_id = $2 where id = $1`, [
        A.ids.ca_haydovchi,
        A.users.prorab.profileId,
      ]),
      note: await res(tx, `update public.cash_advances set note = 'izoh' where id = $1`, [A.ids.ca_haydovchi]),
      del: await res(tx, `update public.cash_advances set deleted_at = now() where id = $1`, [A.ids.ca_haydovchi]),
    }))
    expect(r).toEqual({
      amount: 'P0001:cash_amount_locked',
      recipient: 'P0001:cash_amount_locked',
      note: 'OK:1',
      del: 'OK:1',
    })
    const svc = await asService(db, (tx) =>
      res(tx, `update public.cash_advances set amount = 5 where id = $1`, [A.ids.ca_haydovchi]),
    )
    expect(svc).toBe('P0001:cash_amount_locked')
  })

  it('oluvchi: xarid kiritadigan faol xodim (haydovchi, taminotchi, prorab, admin)', async () => {
    const ins = (tx: Queryable, to: string): Promise<string> =>
      res(tx, `insert into public.cash_advances (company_id, recipient_id, amount) values ($1, $2, 1000)`, [A.id, to])
    const r = await inTx(async (tx) => {
      await become(tx, A.users.buxgalter)
      const out: Record<string, string> = {}
      for (const role of ['haydovchi', 'taminotchi', 'prorab', 'admin', 'direktor', 'buxgalter', 'omborchi', 'tekshiruvchi'] as const) {
        out[role] = await ins(tx, A.users[role].profileId)
      }
      await unbecome(tx)
      await tx.query(`update public.profiles set is_active = false where id = $1`, [A.users.haydovchi.profileId])
      await become(tx, A.users.buxgalter)
      out.inactive = await ins(tx, A.users.haydovchi.profileId)
      return out
    })
    expect(r).toEqual({
      haydovchi: 'OK:1',
      taminotchi: 'OK:1',
      prorab: 'OK:1',
      admin: 'OK:1',
      direktor: 'P0001:cash_recipient_role',
      buxgalter: 'P0001:cash_recipient_role',
      omborchi: 'P0001:cash_recipient_role',
      tekshiruvchi: 'P0001:cash_recipient_role',
      inactive: 'P0001:cash_recipient_role',
    })
  })
})

describe('O6: suppliers', () => {
  const ins = (u: TestUser, cols: string, vals: unknown[]): Promise<string> =>
    asUser(db, u.authUid, (tx) =>
      res(tx, `insert into public.suppliers (company_id, ${cols}) values ($1, ${vals.map((_, i) => `$${i + 2}`).join(', ')})`, [
        A.id,
        ...vals,
      ]),
    )

  it('nom 120 belgigacha', async () => {
    expect({
      n120: await ins(A.users.admin, 'name', ['x'.repeat(120)]),
      n121: await ins(A.users.admin, 'name', ['y'.repeat(121)]),
    }).toEqual({ n120: 'OK:1', n121: '23514:' })
  })

  it('admin bo`lmaganlar faqat nom bilan qo`shadi (phone/note — rad)', async () => {
    expect({
      hayPhone: await ins(A.users.haydovchi, 'name, phone', ['Telefonli', '+998901234567']),
      tamNote: await ins(A.users.taminotchi, 'name, note', ['Izohli', 'izoh']),
      proName: await ins(A.users.prorab, 'name', ['Faqat nom']),
      adminPhone: await ins(A.users.admin, 'name, phone, note', ['Admin sotuvchi', '+998901234567', 'izoh']),
    }).toEqual({ hayPhone: '42501:', tamNote: '42501:', proName: 'OK:1', adminPhone: 'OK:1' })
  })
})

describe('P7: alerts ustun huquqlari', () => {
  it('authenticated faqat status va close_note; details / deleted_at / bog`lanish — 42501; close_note ≤ 500', async () => {
    const r = await asUser(db, A.users.admin.authUid, async (tx) => ({
      status: await res(tx, `update public.alerts set status = 'korildi' where id = $1`, [A.ids.alert1]),
      note: await res(tx, `update public.alerts set status = 'yopildi', close_note = 'Tekshirildi' where id = $1`, [
        A.ids.alert1,
      ]),
      long: await res(tx, `update public.alerts set close_note = $2 where id = $1`, [A.ids.alert1, 'z'.repeat(501)]),
      details: await res(tx, `update public.alerts set details = '{}' where id = $1`, [A.ids.alert1]),
      deleted: await res(tx, `update public.alerts set deleted_at = now() where id = $1`, [A.ids.alert1]),
      purchase: await res(tx, `update public.alerts set purchase_id = null where id = $1`, [A.ids.alert1]),
      severity: await res(tx, `update public.alerts set severity = 'belgi' where id = $1`, [A.ids.alert1]),
    }))
    expect(r).toEqual({
      status: 'OK:1',
      note: 'OK:1',
      long: '23514:',
      details: '42501:',
      deleted: '42501:',
      purchase: '42501:',
      severity: '42501:',
    })
  })

  it('ustun grantlari: update faqat (status, close_note)', async () => {
    const cols = await rows<{ c: string }>(
      db,
      `select column_name as c from information_schema.column_privileges
        where table_schema = 'public' and table_name = 'alerts' and grantee = 'authenticated'
          and privilege_type = 'UPDATE' order by 1`,
    )
    expect(cols.map((x) => x.c)).toEqual(['close_note', 'status'])
  })
})

describe('P9: yopiq xaridga bog`lash', () => {
  it('o`chirilgan yoki mavjud bo`lmagan xarid — 23503 purchase_not_open', async () => {
    const r = await inTx(async (tx) => {
      const m = await newMaterial(tx, A)
      const p = await purchase(tx, { co: A, material: m, qty: 10, total: 1000 })
      await tx.query(`update public.purchases set deleted_at = now() where id = $1`, [p])
      return {
        deleted: await res(
          tx,
          `insert into public.movements (company_id, type, object_id, material_id, qty_input, unit_input, qty_base, purchase_id)
           values ($1, 'kirim', $2, $3, 1, 'kg', 1, $4)`,
          [A.id, A.ids.obj1, m, p],
        ),
        missing: await res(
          tx,
          `insert into public.movements (company_id, type, object_id, material_id, qty_input, unit_input, qty_base, purchase_id)
           values ($1, 'kirim', $2, $3, 1, 'kg', 1, gen_random_uuid())`,
          [A.id, A.ids.obj1, m],
        ),
      }
    })
    expect(r).toEqual({ deleted: '23503:purchase_not_open', missing: '23503:purchase_not_open' })
  })
})
