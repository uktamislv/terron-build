// Xarajatlar va "smetaga kirmaydi" materiallar — 20261111000001_expenses.sql
// (shartnoma: docs/expenses-design.md; baza tomoni — docs/db-design.md → "Xarajatlar").
// Har qoida: musbat / manfiy holat; RLS — har rol va firma izolyatsiyasi; soft delete ↔ tiklash;
// podotchet balansi; oylik limit alerti hayot sikli; chek QR (xarid + xarajat) bitta; outside_estimate.
import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { asService, asUser, createDb, one, rows, scalar, type Db, type Row, type Tx, type UserRole } from './_harness'
import { raw, res, switchUid, sys, system } from './_tx'
import { buildTwoCompanies, ROLES, type CompanyFixture } from './_fixtures'

let db: Db
let A: CompanyFixture
let B: CompanyFixture
/** A firma xarajat turlari: nom → id. */
let CAT: Record<string, string> = {}

beforeAll(async () => {
  db = await createDb()
  ;({ A, B } = await buildTwoCompanies(db))
  CAT = Object.fromEntries(
    (await rows<{ name: string; id: string }>(db, `select name, id from public.expense_categories where company_id = $1`, [A.id])).map(
      (r) => [r.name, r.id],
    ),
  )
})
afterAll(async () => {
  await db?.close()
})

const P = (role: UserRole, co: CompanyFixture = A): string => co.users[role].profileId
const as = <T>(role: UserRole, fn: (tx: Tx) => Promise<T>, co: CompanyFixture = A): Promise<T> =>
  asUser(db, co.users[role].authUid, fn)
const to = (tx: Tx, role: UserRole, co: CompanyFixture = A): Promise<void> => switchUid(tx, co.users[role].authUid)
const photoPath = (co = A.id): string => `${co}/2026/10/${randomUUID()}.jpg`
const sha = (c: string): string => c.repeat(64)

/** Joriy foydalanuvchi nomidan xarajat (RLS bilan); id qaytaradi. */
async function addExpense(tx: Tx, v: Row & { payer_id: string }): Promise<string> {
  const row: Row = { company_id: A.id, category_id: CAT['Oziq-ovqat'], amount: 10_000, ...v }
  const cols = Object.keys(row)
  return scalar<string>(
    tx,
    `insert into public.expenses (${cols.join(', ')}) values (${cols.map((_, i) => `$${i + 1}`).join(', ')}) returning id`,
    Object.values(row),
  )
}
/** Xarajat qo'shish natijasi (`OK:1` yoki `code:hint`). */
function tryExpense(tx: Tx, v: Row): Promise<string> {
  const row: Row = { company_id: A.id, category_id: CAT['Oziq-ovqat'], amount: 10_000, ...v }
  const cols = Object.keys(row)
  return res(tx, `insert into public.expenses (${cols.join(', ')}) values (${cols.map((_, i) => `$${i + 1}`).join(', ')})`, Object.values(row))
}
/** Superuser sifatida storage obyekti (rasm yuklangan). */
async function upload(tx: Tx, path: string, ownerUid: string): Promise<void> {
  await sys(tx, async () => {
    await tx.query(`insert into storage.objects (bucket_id, name, owner_id) values ('photos', $1, $2)`, [path, ownerUid])
  })
}
const alertsOf = (tx: Tx, type: string, recordId?: string): Promise<Row[]> =>
  sys(tx, () =>
    rows(
      tx,
      `select id, type::text, severity::text, status::text, object_id, material_id, purchase_id, details
         from public.alerts
        where company_id = $1 and type::text = $2 and ($3::text is null or details ->> 'record_id' = $3)
        order by created_at, id`,
      [A.id, type, recordId ?? null],
    ),
  )

// ============================================================================
// Sxema
// ============================================================================
describe('sxema', () => {
  it('jadvallar: RLS enable + force, triggerlar, enum, standart turlar', async () => {
    for (const t of ['expense_categories', 'expenses']) {
      expect(await one(db, `select relrowsecurity, relforcerowsecurity from pg_class where oid = ('public.' || $1)::regclass`, [t])).toEqual({
        relrowsecurity: true,
        relforcerowsecurity: true,
      })
    }
    const tg = (await rows<{ tgname: string }>(db, `select tgname from pg_trigger where tgrelid = 'public.expenses'::regclass and not tgisinternal order by 1`)).map(
      (r) => r.tgname,
    )
    expect(tg).toEqual([
      'a_before_insert', 'a_before_update', 'a_block_delete', 'a_block_truncate',
      'b_expenses_guard', 'b_op_date', 'b_payer_guard', 'b_photo_hash_client', 'b_photo_path', 'c_expenses_auto',
      'z_audit', 'zz_deleted_alert', 'zz_expense_rules_ins', 'zz_expense_rules_upd', 'zz_other_payer_ins',
      'zz_other_payer_upd', 'zz_photo_hash_ins', 'zz_photo_hash_upd', 'zz_posted_change',
    ])
    expect(await scalar<string[]>(db, `select enum_range(null::public.alert_type)::text[]`)).toContain('xarajat_limiti')
    expect(Object.keys(CAT).sort()).toEqual(
      ['Asbob-uskuna ijarasi', 'Boshqa', 'Kommunal xizmatlar', 'Oziq-ovqat', 'Transport va yetkazish', "Yoqilg'i"].sort(),
    )
    expect(await scalar<boolean>(db, `select outside_estimate from public.materials where id = $1`, [A.ids.m1])).toBe(false)
    // pul / miqdor — numeric
    const types = await rows(
      db,
      `select column_name, data_type from information_schema.columns
        where table_schema = 'public' and table_name in ('expenses', 'expense_categories')
          and data_type in ('real', 'double precision')`,
    )
    expect(types).toEqual([])
  })

  it('yangi firma — standart 6 tur (trigger), takroriy chaqiruv idempotent', async () => {
    const r = await as('super_admin', async (tx) =>
      sys(tx, async () => {
        const id = await scalar<string>(tx, `insert into public.companies (name) values ('Yangi firma X') returning id`)
        const n1 = await scalar<number>(tx, `select count(*)::int from public.expense_categories where company_id = $1`, [id])
        const again = await scalar<number>(tx, `select private.seed_expense_categories($1)`, [id])
        return { n1, again }
      }),
    )
    expect(r).toEqual({ n1: 6, again: 0 })
  })

  it('anon va authenticated: DELETE yo`q; service_role DELETE — trigger bloklaydi', async () => {
    for (const t of ['public.expenses', 'public.expense_categories']) {
      expect(await scalar<boolean>(db, `select has_table_privilege('anon', $1, 'select')`, [t])).toBe(false)
      expect(await scalar<boolean>(db, `select has_table_privilege('authenticated', $1, 'delete')`, [t])).toBe(false)
    }
    const r = await asService(db, (tx) => res(tx, `delete from public.expenses where id = $1`, [A.ids.ex_hay_obj1]))
    expect(r).toBe('42501:soft_delete_only')
  })
})

// ============================================================================
// RLS — har rol, firma izolyatsiyasi
// ============================================================================
describe('RLS', () => {
  it('ko`rish: har rol — xarajatlar va turlar; boshqa firma — hech narsa', async () => {
    const out: Record<string, { ex: string[]; cats: number; otherCo: number }> = {}
    for (const role of ROLES) {
      out[role] = await as(role, async (tx) => {
        const seen = new Set((await rows<{ id: string }>(tx, `select id from public.expenses where company_id = $1`, [A.id])).map((x) => x.id))
        return {
          ex: ['ex_hay_obj1', 'ex_tam_none', 'ex_pro_obj2'].filter((l) => seen.has(A.ids[l]!)),
          cats: await scalar<number>(tx, `select count(*)::int from public.expense_categories where company_id = $1`, [A.id]),
          otherCo:
            (await scalar<number>(tx, `select count(*)::int from public.expenses where company_id = $1`, [B.id])) +
            (await scalar<number>(tx, `select count(*)::int from public.expense_categories where company_id = $1`, [B.id])),
        }
      })
    }
    const all = ['ex_hay_obj1', 'ex_tam_none', 'ex_pro_obj2']
    expect(out).toEqual({
      super_admin: { ex: all, cats: 6, otherCo: 9 },
      admin: { ex: all, cats: 6, otherCo: 0 },
      direktor: { ex: all, cats: 6, otherCo: 0 },
      buxgalter: { ex: all, cats: 6, otherCo: 0 },
      taminotchi: { ex: all, cats: 6, otherCo: 0 },
      prorab: { ex: ['ex_pro_obj2'], cats: 6, otherCo: 0 },
      omborchi: { ex: [], cats: 6, otherCo: 0 },
      haydovchi: { ex: ['ex_hay_obj1'], cats: 6, otherCo: 0 },
      tekshiruvchi: { ex: [], cats: 0, otherCo: 0 },
    })
  })

  it('qo`shish: rollar; payer_id = o`zi (admin — boshqa); obyekt — a`zo yoki null', async () => {
    const out: Record<string, Record<string, string>> = {}
    for (const role of ROLES) {
      out[role] = await as(role, async (tx) => ({
        own_obj1: await tryExpense(tx, { payer_id: P(role), object_id: A.ids.obj1, created_by: P(role) }),
        own_none: await tryExpense(tx, { payer_id: P(role), created_by: P(role) }),
        own_obj2: await tryExpense(tx, { payer_id: P(role), object_id: A.ids.obj2, created_by: P(role) }),
        other_payer: await tryExpense(tx, { payer_id: P('haydovchi'), created_by: P(role) }),
        other_co: await res(
          tx,
          `insert into public.expenses (company_id, category_id, amount, payer_id, created_by) values ($1, $2, 1, $3, $3)`,
          [B.id, B.ids.ec1, P(role)],
        ),
      }))
    }
    const ok = { own_obj1: 'OK:1', own_none: 'OK:1', own_obj2: 'OK:1', other_payer: 'OK:1', other_co: '42501:' }
    const no = { own_obj1: '42501:', own_none: '42501:', own_obj2: '42501:', other_payer: '42501:', other_co: '42501:' }
    const self = { own_obj1: 'OK:1', own_none: 'OK:1', own_obj2: 'OK:1', other_payer: '42501:', other_co: '42501:' }
    const member = { own_obj1: 'OK:1', own_none: 'OK:1', own_obj2: '42501:', other_payer: '42501:', other_co: '42501:' }
    expect(out).toEqual({
      // super_admin boshqa firmaga ham yoza oladi, lekin to'lovchi o'z firmasi profili bo'lishi shart (kompozit FK)
      super_admin: { ...ok, other_co: '23503:' },
      admin: ok,
      direktor: no,
      buxgalter: self,
      taminotchi: self,
      prorab: member,
      omborchi: no,
      // to'lovchi = haydovchi — o'zi
      haydovchi: { ...member, other_payer: 'OK:1' },
      tekshiruvchi: no,
    })
  })

  it('boshqa firma turi / obyekti / to`lovchisi — kompozit FK (23503)', async () => {
    const r = await as('admin', async (tx) => ({
      cat: await tryExpense(tx, { payer_id: P('admin'), category_id: B.ids.ec1, created_by: P('admin') }),
      obj: await tryExpense(tx, { payer_id: P('admin'), object_id: B.ids.obj1, created_by: P('admin') }),
      payer: await tryExpense(tx, { payer_id: P('haydovchi', B), created_by: P('admin') }),
    }))
    expect(r).toEqual({ cat: '23503:', obj: '42501:', payer: '23503:' })
  })

  it('o`zgartirish: faqat admin; turlar: faqat admin; boshqa firma — 0 qator', async () => {
    const out: Record<string, [string, string, string]> = {}
    for (const role of ROLES) {
      out[role] = await as(role, async (tx) => [
        await res(tx, `update public.expenses set note = 'x' where id = $1`, [A.ids.ex_hay_obj1]),
        await res(tx, `update public.expense_categories set sort_order = 9 where id = $1`, [A.ids.ec1]),
        await res(tx, `update public.expenses set note = 'x' where id = $1`, [B.ids.ex_hay_obj1]),
      ])
    }
    for (const role of ROLES) {
      const admin = role === 'admin' || role === 'super_admin'
      expect(out[role]![0], role).toBe(admin ? 'OK:1' : 'OK:0')
      expect(out[role]![1], role).toBe(admin ? 'OK:1' : 'OK:0')
      expect(out[role]![2], role).toBe(role === 'super_admin' ? 'OK:1' : 'OK:0')
    }
  })

  it('turlar: nom dublikati, nofaol / o`chirilgan turga yangi xarajat yo`q', async () => {
    const r = await as('admin', async (tx) => {
      const dup = await res(tx, `insert into public.expense_categories (company_id, name, created_by) values ($1, '  oziq-OVQAT ', $2)`, [A.id, P('admin')])
      const long = await res(tx, `insert into public.expense_categories (company_id, name, created_by) values ($1, $2, $3)`, [A.id, 'x'.repeat(81), P('admin')])
      const lim = await res(tx, `insert into public.expense_categories (company_id, name, monthly_limit, created_by) values ($1, 'L', 0, $2)`, [A.id, P('admin')])
      await tx.query(`update public.expense_categories set is_active = false where id = $1`, [CAT['Boshqa']])
      const inactive = await tryExpense(tx, { payer_id: P('admin'), category_id: CAT['Boshqa'], created_by: P('admin') })
      await tx.query(`update public.expense_categories set deleted_at = now() where id = $1`, [CAT['Kommunal xizmatlar']])
      const deleted = await tryExpense(tx, { payer_id: P('admin'), category_id: CAT['Kommunal xizmatlar'], created_by: P('admin') })
      // mavjud xarajat tahriri (tur o'zgarmagan) — nofaol turda ham ruxsat
      await tx.query(`update public.expense_categories set is_active = false where id = $1`, [A.ids.ec1])
      const edit = await res(tx, `update public.expenses set note = 'ok' where id = $1`, [A.ids.ex_hay_obj1])
      return { dup, long, lim, inactive, deleted, edit }
    })
    expect(r).toEqual({
      dup: '23505:expense_category_duplicate',
      long: '23514:',
      lim: '23514:',
      inactive: 'P0001:expense_category_inactive',
      deleted: 'P0001:expense_category_inactive',
      edit: 'OK:1',
    })
  })
})

// ============================================================================
// To'lov manbai, orqa sana, rasm, chek
// ============================================================================
describe('to`lov manbai va sana', () => {
  it('payment_source: podotchet berilgan — podotchet, berilmagan — firma; klient qiymati e`tiborsiz; admin/buxgalter tanlaydi', async () => {
    const src = (tx: Tx, id: string): Promise<string> => sys(tx, () => scalar<string>(tx, `select payment_source from public.expenses where id = $1`, [id]))
    const r = {
      hay: await as('haydovchi', async (tx) => src(tx, await addExpense(tx, { payer_id: P('haydovchi'), payment_source: 'firma', created_by: P('haydovchi') }))),
      tam: await as('taminotchi', async (tx) => src(tx, await addExpense(tx, { payer_id: P('taminotchi'), payment_source: 'podotchet', created_by: P('taminotchi') }))),
      adminFor: await as('admin', async (tx) => src(tx, await addExpense(tx, { payer_id: P('haydovchi'), created_by: P('admin') }))),
      adminChoice: await as('admin', async (tx) => src(tx, await addExpense(tx, { payer_id: P('haydovchi'), payment_source: 'firma', created_by: P('admin') }))),
      bux: await as('buxgalter', async (tx) => src(tx, await addExpense(tx, { payer_id: P('buxgalter'), payment_source: 'podotchet', created_by: P('buxgalter') }))),
    }
    expect(r).toEqual({ hay: 'podotchet', tam: 'firma', adminFor: 'podotchet', adminChoice: 'firma', bux: 'podotchet' })
  })

  it('orqa sana: admin emas — 3 kun (ops_occurred_at_range, detail bilan), admin — cheklovsiz', async () => {
    const r = {
      hay: await as('haydovchi', (tx) =>
        tryExpense(tx, { payer_id: P('haydovchi'), spent_at: new Date(Date.now() - 4 * 86400_000).toISOString(), created_by: P('haydovchi') }),
      ),
      hayOk: await as('haydovchi', (tx) =>
        tryExpense(tx, { payer_id: P('haydovchi'), spent_at: new Date(Date.now() - 2 * 86400_000).toISOString(), created_by: P('haydovchi') }),
      ),
      future: await as('taminotchi', (tx) =>
        tryExpense(tx, { payer_id: P('taminotchi'), spent_at: new Date(Date.now() + 3600_000).toISOString(), created_by: P('taminotchi') }),
      ),
      admin: await as('admin', (tx) =>
        tryExpense(tx, { payer_id: P('admin'), spent_at: new Date(Date.now() - 40 * 86400_000).toISOString(), created_by: P('admin') }),
      ),
    }
    expect(r).toEqual({ hay: '23514:ops_occurred_at_range', hayOk: 'OK:1', future: '23514:ops_occurred_at_range', admin: 'OK:1' })
  })

  it('to`lovchi (admin boshqa nomidan): faqat faol xarajat kiritadigan rol (expense_payer_invalid)', async () => {
    const r = await as('admin', async (tx) => {
      const dir = await tryExpense(tx, { payer_id: P('direktor'), created_by: P('admin') })
      const omb = await tryExpense(tx, { payer_id: P('omborchi'), created_by: P('admin') })
      const bux = await tryExpense(tx, { payer_id: P('buxgalter'), created_by: P('admin') })
      await raw(tx, `update public.profiles set is_active = false where id = $1`, [P('taminotchi')])
      const inactive = await tryExpense(tx, { payer_id: P('taminotchi'), created_by: P('admin') })
      return { dir, omb, bux, inactive }
    })
    expect(r).toEqual({
      dir: '23514:expense_payer_invalid',
      omb: '23514:expense_payer_invalid',
      bux: 'OK:1',
      inactive: '23514:expense_payer_invalid',
    })
  })
})

describe('rasm va chek', () => {
  it('rasm majburiy: firma summasi chegarasi va tur bayrog`i; rasm bilan — ruxsat; o`zi yuklamagan rasm — yo`q', async () => {
    const r = await as('haydovchi', async (tx) => {
      await raw(tx, `update public.companies set photo_required_amount = 500000 where id = $1`, [A.id])
      const big = await tryExpense(tx, { payer_id: P('haydovchi'), amount: 500_000, created_by: P('haydovchi') })
      const small = await tryExpense(tx, { payer_id: P('haydovchi'), amount: 499_999.99, created_by: P('haydovchi') })
      await raw(tx, `update public.expense_categories set photo_required = true where id = $1`, [CAT["Yoqilg'i"]])
      const flag = await tryExpense(tx, { payer_id: P('haydovchi'), amount: 100, category_id: CAT["Yoqilg'i"], created_by: P('haydovchi') })
      const path = photoPath()
      await upload(tx, path, A.users.haydovchi.authUid)
      const withPhoto = await tryExpense(tx, {
        payer_id: P('haydovchi'), amount: 600_000, receipt_photo_path: path, created_by: P('haydovchi'),
      })
      const foreign = photoPath()
      await upload(tx, foreign, A.users.prorab.authUid)
      const notOwned = await tryExpense(tx, {
        payer_id: P('haydovchi'), amount: 600_000, receipt_photo_path: foreign, created_by: P('haydovchi'),
      })
      const otherCo = await tryExpense(tx, {
        payer_id: P('haydovchi'), amount: 1, receipt_photo_path: photoPath(B.id), created_by: P('haydovchi'),
      })
      // summa oshirilsa (rasmsiz) — UPDATE ham tekshiriladi
      await to(tx, 'admin')
      const id = await addExpense(tx, { payer_id: P('admin'), amount: 100, created_by: P('admin') })
      const raise = await res(tx, `update public.expenses set amount = 700000 where id = $1`, [id])
      return { big, small, flag, withPhoto, notOwned, otherCo, raise }
    })
    expect(r).toEqual({
      big: '23514:photo_required',
      small: 'OK:1',
      flag: '23514:photo_required',
      withPhoto: 'OK:1',
      notOwned: '42501:ops_photo_not_owned',
      otherCo: '23514:ops_photo_path_company',
      raise: '23514:photo_required',
    })
  })

  it('bitta rasm — bitta tirik yozuv (xarid, harakat, xarajat bo`ylab); o`chirilgach bo`shaydi', async () => {
    const r = await as('admin', async (tx) => {
      const path = photoPath()
      await sys(tx, () =>
        tx.query(
          `insert into public.purchases (company_id, buyer_id, object_id, material_id, qty_input, unit_input, total_amount, receipt_photo_path, created_by)
           values ($1, $2, $3, $4, 1, 'kg', 1000, $5, $2)`,
          [A.id, P('admin'), A.ids.obj1, A.ids.m1, path],
        ),
      )
      const reused = await tryExpense(tx, { payer_id: P('admin'), receipt_photo_path: path, created_by: P('admin') })
      const p2 = photoPath()
      const id = await addExpense(tx, { payer_id: P('admin'), receipt_photo_path: p2, created_by: P('admin') })
      const purchaseReuse = await res(
        tx,
        `insert into public.purchases (company_id, buyer_id, object_id, material_id, qty_input, unit_input, total_amount, receipt_photo_path, created_by)
         values ($1, $2, $3, $4, 1, 'kg', 1000, $5, $2)`,
        [A.id, P('admin'), A.ids.obj1, A.ids.m1, p2],
      )
      await tx.query(`update public.expenses set deleted_at = now() where id = $1`, [id])
      const afterDelete = await tryExpense(tx, { payer_id: P('admin'), receipt_photo_path: p2, created_by: P('admin') })
      // photo-hash navbati: expenses ishi
      const queued = await sys(tx, () =>
        scalar<number>(tx, `select count(*)::int from private.photo_hash_queue where table_name = 'expenses' and photo_path = $1 and status = 'pending'`, [p2]),
      )
      return { reused, purchaseReuse, afterDelete, queued }
    })
    expect(r).toEqual({ reused: '23505:ops_photo_reused', purchaseReuse: '23505:ops_photo_reused', afterDelete: 'OK:1', queued: 2 }) // har yozuv uchun bitta ish
  })

  it('klient xeshi e`tiborsiz; svc_set_photo_hash(expenses) yozadi; rasm takrori (xarid bilan) — takroriy_yozuv photo', async () => {
    const r = await as('admin', async (tx) => {
      const p1 = photoPath()
      const id = await addExpense(tx, { payer_id: P('admin'), receipt_photo_path: p1, receipt_photo_sha256: sha('a'), created_by: P('admin') })
      const clientSha = await scalar(tx, `select receipt_photo_sha256 from public.expenses where id = $1`, [id])
      const purchase = await sys(tx, () =>
        scalar<string>(
          tx,
          `insert into public.purchases (company_id, buyer_id, object_id, material_id, qty_input, unit_input, total_amount, receipt_photo_path, created_by)
           values ($1, $2, $3, $4, 1, 'kg', 1000, $5, $2) returning id`,
          [A.id, P('admin'), A.ids.obj1, A.ids.m1, photoPath()],
        ),
      )
      const set = await asServiceIn(tx, async () => {
        const a = await scalar<boolean>(tx, `select public.svc_set_photo_hash('purchases', $1, $2)`, [purchase, sha('b')])
        const b = await scalar<boolean>(tx, `select public.svc_set_photo_hash('expenses', $1, $2, $3)`, [id, sha('b'), p1])
        const wrongPath = await scalar<boolean>(tx, `select public.svc_set_photo_hash('expenses', $1, $2, $3)`, [id, sha('c'), 'x'])
        return { a, b, wrongPath }
      })
      const dup = await alertsOf(tx, 'takroriy_yozuv', id)
      const job = await sys(tx, () => scalar<string>(tx, `select status from private.photo_hash_queue where table_name = 'expenses' and record_id = $1`, [id]))
      return { clientSha, set, dup: dup.map((a) => [a.severity, (a.details as Row).kind, (a.details as Row).first_table]), job }
    })
    expect(r).toEqual({
      clientSha: null,
      set: { a: true, b: true, wrongPath: false },
      dup: [['ogohlantirish', 'photo', 'purchases']],
      job: 'done',
    })
  })

  it('chek QR: fiskal belgi xaridlar va xarajatlar bo`yicha bitta (receipt_already_used, ikki tomondan, tiklashda ham)', async () => {
    const r = await as('admin', async (tx) => {
      const purchase = (sign: string): Promise<string> =>
        res(
          tx,
          `insert into public.purchases (company_id, buyer_id, object_id, material_id, qty_input, unit_input, total_amount, receipt_fiscal_sign, created_by)
           values ($1, $2, $3, $4, 1, 'kg', 1000, $5, $2)`,
          [A.id, P('admin'), A.ids.obj1, A.ids.m1, sign],
        )
      const p1 = await purchase('QRX1')
      const e1 = await tryExpense(tx, { payer_id: P('admin'), receipt_fiscal_sign: ' QRX1 ', created_by: P('admin') })
      const eId = await addExpense(tx, { payer_id: P('admin'), receipt_fiscal_sign: 'QRX2', created_by: P('admin') })
      const p2 = await purchase('QRX2')
      const e2 = await tryExpense(tx, { payer_id: P('admin'), receipt_fiscal_sign: 'QRX2', created_by: P('admin') })
      // o'chirilgan xarajat cheki bo'shaydi; tiklashda yana tekshiriladi
      await tx.query(`update public.expenses set deleted_at = now() where id = $1`, [eId])
      const p3 = await purchase('QRX2')
      const restore = await res(tx, `select public.restore_record('expenses', $1)`, [eId])
      return { p1, e1, p2, e2, p3, restore }
    })
    expect(r).toEqual({
      p1: 'OK:1',
      e1: '23505:receipt_already_used',
      p2: '23505:receipt_already_used',
      e2: '23505:receipt_already_used',
      p3: 'OK:1',
      restore: '23505:receipt_already_used',
    })
  })

  it('chek keshi: receipt_verified, receipt_total, seller_tin serverdan; tasdiqlangan bir qatorli chek rasmdan ozod; chek_farqi', async () => {
    const r = await as('haydovchi', async (tx) => {
      await raw(tx, `update public.companies set photo_required_amount = 100000 where id = $1`, [A.id])
      await sys(tx, async () => {
        await tx.query(
          `insert into public.receipt_lookups (company_id, fiscal_sign, payload, total, seller_tin, receipt_at)
           values ($1, 'EXQR1', '{"items":[{"name":"Non","sum":150000}]}', 150000, '123456789', now()),
                  ($1, 'EXQR2', '{"items":[{"name":"A","sum":100},{"name":"B","sum":200}]}', 300, null, now())`,
          [A.id],
        )
      })
      // klient yuborgan tasdiq / summa / STIR e'tiborsiz
      const id = await addExpense(tx, {
        payer_id: P('haydovchi'), amount: 150_000, receipt_fiscal_sign: 'EXQR1',
        receipt_verified: false, receipt_total: 1, seller_tin: '999999999', created_by: P('haydovchi'),
      })
      const row = await one(tx, `select receipt_verified, receipt_total::text, seller_tin from public.expenses where id = $1`, [id])
      // summa farqli (rasm bilan) — tasdiqlanmaydi, chek_farqi
      const path = photoPath()
      await upload(tx, path, A.users.haydovchi.authUid)
      await raw(tx, `update public.expenses set deleted_at = now() where id = $1`, [id])
      const id2 = await addExpense(tx, {
        payer_id: P('haydovchi'), amount: 140_000, receipt_fiscal_sign: 'EXQR1', receipt_photo_path: path, created_by: P('haydovchi'),
      })
      const row2 = await one(tx, `select receipt_verified, receipt_total::text from public.expenses where id = $1`, [id2])
      const diff = await alertsOf(tx, 'chek_farqi', id2)
      // admin summani tuzatsa — alert yopiladi
      await to(tx, 'admin')
      await tx.query(`update public.expenses set amount = 150000 where id = $1`, [id2])
      const closed = await alertsOf(tx, 'chek_farqi', id2)
      // ko'p qatorli chek: tasdiqlangan bo'lsa ham rasm talab qilinadi (chegaradan katta bo'lsa)
      await to(tx, 'haydovchi')
      const multi = await tryExpense(tx, { payer_id: P('haydovchi'), amount: 300, receipt_fiscal_sign: 'EXQR2', created_by: P('haydovchi') })
      return { row, row2, diff, closed, multi }
    })
    expect(r.row).toEqual({ receipt_verified: true, receipt_total: '150000.00', seller_tin: '123456789' })
    expect(r.row2).toEqual({ receipt_verified: false, receipt_total: '150000.00' })
    expect(r.diff).toHaveLength(1)
    expect(r.diff[0]).toMatchObject({ severity: 'ogohlantirish', status: 'yangi', purchase_id: null, object_id: null })
    expect(r.diff[0]!.details).toMatchObject({ table: 'expenses', receipt_total: 150000, total_amount: 140000, diff: -10000 })
    expect(r.closed[0]).toMatchObject({ status: 'yopildi' })
    expect((r.closed[0]!.details as Row).closed_reason).toBe('within_threshold')
    expect(r.multi).toBe('OK:1')
  })

  it('sotuvchi STIR farqi (belgi); sotuvchi STIR o`zgarsa — qayta baholanadi', async () => {
    const r = await as('admin', async (tx) => {
      await sys(tx, async () => {
        await tx.query(`update public.suppliers set tin = '111111111' where id = $1`, [A.ids.s1])
        await tx.query(
          `insert into public.receipt_lookups (company_id, fiscal_sign, payload, total, seller_tin, receipt_at)
           values ($1, 'EXTIN1', '{}', 5000, '222222222', now())`,
          [A.id],
        )
      })
      const id = await addExpense(tx, { payer_id: P('admin'), amount: 5000, supplier_id: A.ids.s1, receipt_fiscal_sign: 'EXTIN1', created_by: P('admin') })
      const open = await alertsOf(tx, 'sotuvchi_stir_farqi', id)
      await tx.query(`update public.suppliers set tin = '222222222' where id = $1`, [A.ids.s1])
      const after = await alertsOf(tx, 'sotuvchi_stir_farqi', id)
      return { open, after }
    })
    expect(r.open.map((a) => [a.severity, a.status])).toEqual([['belgi', 'yangi']])
    expect(r.open[0]!.details).toMatchObject({ table: 'expenses', seller_tin: '222222222', supplier_tin: '111111111' })
    expect(r.after.map((a) => [a.status, (a.details as Row).closed_reason])).toEqual([['yopildi', 'not_applicable']])
  })
})

/** Shu tranzaksiyada service_role sifatida (claims'siz). */
async function asServiceIn<T>(tx: Tx, fn: () => Promise<T>): Promise<T> {
  return system(tx, async () => {
    await tx.exec('set local role service_role')
    try {
      return await fn()
    } finally {
      await tx.exec('reset role')
    }
  })
}

// ============================================================================
// Takroriy yozuv
// ============================================================================
describe('takroriy yozuv', () => {
  it('shu odam, tur, obyekt, summa — oyna ichida belgi; boshqa obyekt/summa yoki oynadan tashqari — yo`q; tuzatilsa yopiladi', async () => {
    const r = await as('taminotchi', async (tx) => {
      const me = P('taminotchi')
      const first = await addExpense(tx, { payer_id: me, amount: 33_000, created_by: me })
      const dup = await addExpense(tx, { payer_id: me, amount: 33_000, created_by: me })
      const otherObj = await addExpense(tx, { payer_id: me, amount: 33_000, object_id: A.ids.obj1, created_by: me })
      const otherAmount = await addExpense(tx, { payer_id: me, amount: 33_001, created_by: me })
      const otherCat = await addExpense(tx, { payer_id: me, amount: 33_000, category_id: CAT['Boshqa'], created_by: me })
      const got = async (id: string): Promise<string[]> =>
        (await alertsOf(tx, 'takroriy_yozuv', id)).map((a) => `${a.severity}:${(a.details as Row).kind}:${a.status}`)
      const before = {
        first: await got(first), dup: await got(dup), otherObj: await got(otherObj),
        otherAmount: await got(otherAmount), otherCat: await got(otherCat),
      }
      const det = (await alertsOf(tx, 'takroriy_yozuv', dup))[0]!.details as Row
      // muallif summani tuzatdi — mos kelmaydi → yopiladi
      const corr = await res(tx, `select public.correct_entry('expenses', $1, p_total_amount => 34000)`, [dup])
      const afterCorr = await got(dup)
      // oynadan tashqari
      await raw(tx, `update public.expenses set created_at = created_at - interval '1 hour' where id = $1`, [first])
      const late = await addExpense(tx, { payer_id: me, amount: 99_999, created_by: me })
      await raw(tx, `update public.expenses set created_at = created_at - interval '2 hours' where id = $1`, [late])
      const late2 = await addExpense(tx, { payer_id: me, amount: 99_999, created_by: me })
      return { before, det, corr, afterCorr, late2: await got(late2) }
    })
    expect(r.before).toEqual({ first: [], dup: ['belgi:record:yangi'], otherObj: [], otherAmount: [], otherCat: [] })
    expect(r.det).toMatchObject({ table: 'expenses', total_amount: 33000, window_minutes: 10 })
    expect(r.corr).toBe('OK:1')
    expect(r.afterCorr).toEqual(['belgi:record:yopildi'])
    expect(r.late2).toEqual([])
  })
})

// ============================================================================
// Boshqa nomidan, o'zgartirish / o'chirish / tiklash alertlari
// ============================================================================
describe('boshqa nomidan va yozuv alertlari', () => {
  it('admin boshqa odam nomidan: xarid_boshqa_nomidan (table = expenses) + expense_on_your_name (faqat to`lovchiga)', async () => {
    const r = await as('admin', async (tx) => {
      const id = await addExpense(tx, { payer_id: P('haydovchi'), amount: 25_000, object_id: A.ids.obj1, note: ' Tushlik ', created_by: P('admin') })
      const al = await alertsOf(tx, 'xarid_boshqa_nomidan', id)
      return sys(tx, async () => {
        await tx.query(`update public.profiles set telegram_chat_id = 7001 where id = $1`, [P('haydovchi')])
        await tx.query(`update public.profiles set telegram_chat_id = 7002 where id = $1`, [P('admin')])
        await tx.query(`update public.profiles set telegram_chat_id = 7003, notify_workflow = false where id = $1`, [P('direktor')])
        const ob = await rows<{ id: string; kind: string; profile_id: string; ref_id: string; payload: Row }>(
          tx,
          `select id, kind, profile_id, ref_id, payload from public.notification_outbox where kind = 'expense_on_your_name' and ref_id = $1`,
          [id],
        )
        const rec = await rows(tx, `select chat_id::int, role from public.svc_outbox_recipients($1)`, [ob[0]!.id])
        const alertOb = await rows<{ payload: Row }>(tx, `select payload from public.notification_outbox where kind = 'alert' and alert_id = $1`, [al[0]!.id])
        const note = await scalar(tx, `select note from public.expenses where id = $1`, [id])
        return { al, ob, rec, alertOb, note }
      })
    })
    expect(r.al).toHaveLength(1)
    expect(r.al[0]).toMatchObject({ severity: 'ogohlantirish', object_id: A.ids.obj1, purchase_id: null, material_id: null })
    expect(r.al[0]!.details).toMatchObject({
      table: 'expenses', expense_id: r.ob[0]!.ref_id, payer_id: P('haydovchi'), payer_name: 'A haydovchi',
      buyer_id: P('haydovchi'), actor_profile_id: P('admin'), amount: 25000, category_name: 'Oziq-ovqat',
      payment_source: 'podotchet', via: 'insert',
    })
    expect(r.ob).toHaveLength(1)
    expect(r.ob[0]).toMatchObject({ profile_id: P('haydovchi') })
    expect(Object.keys(r.ob[0]!.payload).sort()).toEqual(
      ['actor_name', 'alert_id', 'amount', 'category_id', 'category_name', 'company_name', 'expense_id', 'note', 'object_id',
       'object_name', 'payer_id', 'payer_name', 'payment_source', 'spent_at'].sort(),
    )
    expect(r.ob[0]!.payload).toMatchObject({ amount: 25000, payer_name: 'A haydovchi', actor_name: 'A admin', note: 'Tushlik', object_name: 'A obj1' })
    expect(r.rec).toEqual([{ chat_id: 7001, role: 'haydovchi' }])
    expect(r.alertOb).toHaveLength(1)
    expect(r.note).toBe('Tushlik')
  })

  it('o`z nomidan — alert / xabar yo`q', async () => {
    const r = await as('admin', async (tx) => {
      const id = await addExpense(tx, { payer_id: P('admin'), created_by: P('admin') })
      return { al: (await alertsOf(tx, 'xarid_boshqa_nomidan', id)).length }
    })
    expect(r).toEqual({ al: 0 })
  })

  it('admin to`g`ridan-to`g`ri o`zgartirsa — yozuv_ozgartirildi; muallif correct_entry — yozuv_tuzatildi (belgi)', async () => {
    const r = await as('haydovchi', async (tx) => {
      const id = await addExpense(tx, { payer_id: P('haydovchi'), amount: 12_000, object_id: A.ids.obj1, created_by: P('haydovchi') })
      const corr = await res(tx, `select public.correct_entry('expenses', $1, p_total_amount => 13000, p_note => 'yangi', p_reason => 'xato')`, [id])
      const bad = {
        qty: await res(tx, `select public.correct_entry('expenses', $1, p_qty_input => 1)`, [id]),
        zero: await res(tx, `select public.correct_entry('expenses', $1, p_total_amount => 0)`, [id]),
        obj2: await res(tx, `select public.correct_entry('expenses', $1, p_object_id => $2)`, [id, A.ids.obj2]),
      }
      const tuz = await alertsOf(tx, 'yozuv_tuzatildi', id)
      await to(tx, 'admin')
      await tx.query(`update public.expenses set amount = 14000, category_id = $2 where id = $1`, [id, CAT['Transport va yetkazish']])
      const ozg = await alertsOf(tx, 'yozuv_ozgartirildi', id)
      // 30 daqiqadan keyin muallif tuzata olmaydi; boshqa odam — umuman
      await raw(tx, `update public.expenses set created_at = now() - interval '31 minutes' where id = $1`, [id])
      await to(tx, 'haydovchi')
      const late = await res(tx, `select public.correct_entry('expenses', $1, p_total_amount => 15000)`, [id])
      await to(tx, 'taminotchi')
      const other = await res(tx, `select public.correct_entry('expenses', $1, p_total_amount => 15000)`, [id])
      const row = await sys(tx, () => one(tx, `select amount::text, note from public.expenses where id = $1`, [id]))
      return { corr, bad, tuz, ozg, late, other, row }
    })
    expect(r.corr).toBe('OK:1')
    expect(r.bad).toEqual({ qty: '22023:correct_invalid', zero: '22023:correct_invalid', obj2: '42501:correct_forbidden' })
    expect(r.tuz.map((a) => a.severity)).toEqual(['belgi'])
    expect(r.tuz[0]!.details).toMatchObject({
      table: 'expenses', changed: ['amount'], before: { amount: 12000 }, after: { amount: 13000 },
      via: 'correct_entry', reason: 'xato', category_name: 'Oziq-ovqat',
    })
    expect(r.ozg).toHaveLength(1)
    expect(r.ozg[0]).toMatchObject({ severity: 'ogohlantirish', object_id: A.ids.obj1 })
    expect(r.ozg[0]!.details).toMatchObject({ via: 'direct', changed: ['amount', 'category_id'], category_name: 'Transport va yetkazish' })
    expect(r).toMatchObject({ late: '55000:correct_window_passed', other: '42501:correct_forbidden', row: { amount: '14000.00', note: 'yangi' } })
  })

  it('cancel_own_entry: muallif 30 daqiqa ichida (yozuv_tuzatildi, yozuv_ochirildi emas); sababsiz — correct_invalid', async () => {
    const r = await as('prorab', async (tx) => {
      const id = await addExpense(tx, { payer_id: P('prorab'), amount: 8_000, object_id: A.ids.obj1, created_by: P('prorab') })
      const noReason = await res(tx, `select public.cancel_own_entry('expenses', $1, ' ')`, [id])
      const ok = await res(tx, `select public.cancel_own_entry('expenses', $1, 'adashdim')`, [id])
      const ownDeleted = await scalar<number>(tx, `select count(*)::int from public.expenses where id = $1 and deleted_at is not null`, [id])
      return {
        noReason, ok, ownDeleted,
        tuz: (await alertsOf(tx, 'yozuv_tuzatildi', id)).map((a) => [(a.details as Row).via, (a.details as Row).amount, (a.details as Row).reason]),
        och: (await alertsOf(tx, 'yozuv_ochirildi', id)).length,
      }
    })
    expect(r).toEqual({
      noReason: '22023:correct_invalid', ok: 'OK:1', ownDeleted: 1,
      tuz: [['cancel_own_entry', 8000, 'adashdim']], och: 0,
    })
  })

  it('soft delete → yozuv_ochirildi; restore_record → yozuv_tiklandi, ochirildi yopiladi; tarix va deleted_records', async () => {
    const r = await as('admin', async (tx) => {
      const id = await addExpense(tx, { payer_id: P('haydovchi'), amount: 41_000, object_id: A.ids.obj1, created_by: P('admin') })
      await tx.query(`update public.expenses set deleted_at = now() where id = $1`, [id])
      const och = await alertsOf(tx, 'yozuv_ochirildi', id)
      const today = await scalar<string>(tx, `select (now() at time zone 'Asia/Tashkent')::date::text`)
      const deleted = await rows(tx, `select table_name, record_label, deleted_by_name from public.deleted_records($1, $1, 'expenses') where record_id = $2`, [today, id])
      const seen: Record<string, number> = {}
      for (const role of ['direktor', 'buxgalter', 'haydovchi'] as const) {
        await to(tx, role)
        seen[role] = (await rows(tx, `select 1 from public.expenses where id = $1`, [id])).length
      }
      const nonAdmin = await res(tx, `select public.restore_record('expenses', $1)`, [id])
      await to(tx, 'admin')
      const restore = await res(tx, `select public.restore_record('expenses', $1)`, [id])
      const tik = await alertsOf(tx, 'yozuv_tiklandi', id)
      const ochAfter = await alertsOf(tx, 'yozuv_ochirildi', id)
      const audit = (await rows<{ action: string }>(tx, `select action from public.audit_log where table_name = 'expenses' and record_id = $1 order by id`, [id])).map(
        (a) => a.action,
      )
      const catDel = await res(tx, `update public.expense_categories set deleted_at = now() where id = $1`, [CAT['Boshqa']])
      const catRestore = await res(tx, `select public.restore_record('expense_categories', $1)`, [CAT['Boshqa']])
      return { och, deleted, seen, nonAdmin, restore, tik, ochAfter, audit, catDel, catRestore }
    })
    expect(r.och).toHaveLength(1)
    expect(r.och[0]!.details).toMatchObject({ table: 'expenses', amount: 41000, payer_name: 'A haydovchi', category_name: 'Oziq-ovqat' })
    expect(r.deleted).toEqual([{ table_name: 'expenses', record_label: "Oziq-ovqat · 41 000 so'm · A obj1", deleted_by_name: 'A admin' }])
    expect(r.seen).toEqual({ direktor: 1, buxgalter: 0, haydovchi: 0 })
    expect(r.nonAdmin).toBe('42501:restore_admin_only')
    expect(r.restore).toBe('OK:1')
    expect(r.tik.map((a) => a.severity)).toEqual(['ogohlantirish'])
    expect(r.tik[0]!.details).toMatchObject({ table: 'expenses', amount: 41000 })
    expect(r.ochAfter[0]).toMatchObject({ status: 'yopildi' })
    expect(r.audit).toEqual(['INSERT', 'SOFT_DELETE', 'RESTORE'])
    expect(r).toMatchObject({ catDel: 'OK:1', catRestore: 'OK:1' })
  })
})

// ============================================================================
// Pul (podotchet)
// ============================================================================
describe('podotchet', () => {
  it('podotchet xarajat qo`limdagi puldan ayiriladi (cash_balances, cash_position, kunlik hisobot); firma — yo`q; o`chirilsa qaytadi', async () => {
    const r = await as('haydovchi', async (tx) => {
      const bal = (): Promise<Row> =>
        one(tx, `select spent_total::text, balance::text from public.cash_balances where profile_id = $1`, [P('haydovchi')])
      const pos = (): Promise<Row> =>
        sys(tx, () => one(tx, `select spent_total::text, balance::text from private.cash_position($1, $2)`, [A.id, P('haydovchi')]))
      const b0 = await bal()
      const id = await addExpense(tx, { payer_id: P('haydovchi'), amount: 300_000, created_by: P('haydovchi') })
      const b1 = await bal()
      const p1 = await pos()
      await to(tx, 'admin')
      await addExpense(tx, { payer_id: P('haydovchi'), amount: 77_000, payment_source: 'firma', created_by: P('admin') })
      await to(tx, 'haydovchi')
      const b2 = await bal()
      const daily = await sys(tx, () =>
        scalar<Row>(tx, `select private.daily_report_stats($1, now() - interval '1 day', now() + interval '1 minute')`, [A.id]),
      )
      await to(tx, 'admin')
      await tx.query(`update public.expenses set deleted_at = now() where id = $1`, [id])
      await to(tx, 'haydovchi')
      const b3 = await bal()
      return { b0, b1, p1, b2, b3, daily }
    })
    // fixture: 1 000 000 berilgan; p_hay_obj2 (600 000) — podotchet
    expect(r.b0).toEqual({ spent_total: '600000.00', balance: '400000.00' })
    expect(r.b1).toEqual({ spent_total: '900000.00', balance: '100000.00' })
    expect(r.p1).toEqual({ spent_total: '900000.00', balance: '100000.00' })
    expect(r.b2).toEqual(r.b1)
    expect(r.b3).toEqual(r.b0)
    expect(r.daily).toMatchObject({ expenses_count: 5, expense_limit_alerts: 0 })
    // fixture 210 000 + 300 000 + 77 000
    expect(r.daily.expenses_sum).toBe('587000.00')
  })

  it('haftalik hisob va muddat: podotchet xarajat sarflangan hisoblanadi', async () => {
    const r = await as('admin', async (tx) => {
      await addExpense(tx, { payer_id: P('haydovchi'), amount: 400_000, created_by: P('admin') })
      return system(tx, async () => {
        await tx.query(`update public.profiles set telegram_chat_id = 8101 where id = $1`, [P('haydovchi')])
        const tomorrow = await scalar<string>(tx, `select ((now() at time zone 'Asia/Tashkent')::date + 1)::text`)
        await tx.query(`select private.enqueue_cash_statements($1::date)`, [tomorrow])
        return scalar<Row>(tx, `select payload from public.notification_outbox where kind = 'cash_statement' and profile_id = $1`, [P('haydovchi')])
      })
    })
    expect(r).toMatchObject({ balance: '0.00', spent_total: '1000000.00', expenses_week: '400000.00' })
  })
})

// ============================================================================
// Oylik limit
// ============================================================================
describe('oylik limit — xarajat_limiti', () => {
  it('hayot sikli: oshish → alert; yana xarajat → details; o`chirish → yopiladi; limit o`zgarishi; qo`lda yopish; null; tur o`chirildi', async () => {
    const r = await as('admin', async (tx) => {
      const cat = CAT['Transport va yetkazish']!
      const month = await scalar<string>(tx, `select to_char(now() at time zone 'Asia/Tashkent', 'YYYY-MM')`)
      const lim = async (): Promise<Row[]> =>
        sys(tx, () =>
          rows(
            tx,
            `select id, status::text, severity::text, details from public.alerts
              where company_id = $1 and type::text = 'xarajat_limiti' and details ->> 'category_id' = $2 order by created_at, id`,
            [A.id, cat],
          ),
        )
      const ex = (amount: number): Promise<string> => addExpense(tx, { payer_id: P('admin'), amount, category_id: cat, created_by: P('admin') })
      await tx.query(`update public.expense_categories set monthly_limit = 100000 where id = $1`, [cat])
      await ex(60_000)
      const s0 = await lim()
      const e2 = await ex(50_000)
      const s1 = await lim()
      const e3 = await ex(5_000)
      const s2 = await lim()
      const tgOutbox = await sys(tx, () =>
        scalar<number>(tx, `select count(*)::int from public.notification_outbox where kind = 'alert' and alert_id = $1`, [s1[0]!.id]),
      )
      await tx.query(`update public.expenses set deleted_at = now() where id = $1`, [e2])
      const s3 = await lim()
      await tx.query(`update public.expenses set deleted_at = null where id = $1`, [e2])
      const s4 = await lim()
      await tx.query(`update public.expense_categories set monthly_limit = 200000 where id = $1`, [cat])
      const s5 = await lim()
      await tx.query(`update public.expense_categories set monthly_limit = 90000 where id = $1`, [cat])
      const s6 = await lim()
      const openId = s6.find((a) => a.status === 'yangi')!.id as string
      await tx.query(`update public.alerts set status = 'yopildi', close_note = 'ruxsat berildi' where id = $1`, [openId])
      await tx.query(`update public.expenses set amount = 4000 where id = $1`, [e3])
      const s7 = await lim()
      await ex(1_000)
      await ex(20_000)
      const s8 = await lim()
      await tx.query(`update public.expense_categories set monthly_limit = null where id = $1`, [cat])
      const s9 = await lim()
      await tx.query(`update public.expense_categories set monthly_limit = 50000 where id = $1`, [cat])
      await tx.query(`update public.expense_categories set deleted_at = now() where id = $1`, [cat])
      const s10 = await lim()
      // bir tranzaksiyada created_at bir xil — tartib emas, to'plam solishtiriladi
      const st = (s: Row[]): string[] => s.map((a) => `${a.status}:${(a.details as Row).closed_reason ?? ''}`).sort()
      return { month, s0, s1, s2, tgOutbox, s3: st(s3), s4: st(s4), s5: st(s5), s6: st(s6), s7: st(s7), s8: st(s8), s9: st(s9), s10: st(s10), s8d: s8.find((a) => a.status === 'yangi')!.details }
    })
    expect(r.s0).toEqual([])
    expect(r.s1).toHaveLength(1)
    expect(r.s1[0]).toMatchObject({ status: 'yangi', severity: 'ogohlantirish' })
    expect(r.s1[0]!.details).toMatchObject({
      category_name: 'Transport va yetkazish', month: r.month, limit: 100000, spent: 110000, over: 10000,
      over_pct: 10, expense_count: 2,
    })
    expect(r.s2).toHaveLength(1)
    expect(r.s2[0]!.details).toMatchObject({ spent: 115000, over: 15000, expense_count: 3 })
    expect(r.tgOutbox).toBe(1)
    expect(r.s3).toEqual(['yopildi:within_threshold'])
    expect(r.s4).toEqual(['yangi:', 'yopildi:within_threshold'])
    expect(r.s5).toEqual(['yopildi:within_threshold', 'yopildi:within_threshold'])
    expect(r.s6).toEqual(['yangi:', 'yopildi:within_threshold', 'yopildi:within_threshold'])
    // qo'lda yopilgan: spent kamaydi — qayta ochilmaydi
    expect(r.s7).toEqual(['yopildi:', 'yopildi:within_threshold', 'yopildi:within_threshold'])
    // spent yopilgandagidan oshdi — yangi alert
    expect(r.s8).toEqual(['yangi:', 'yopildi:', 'yopildi:within_threshold', 'yopildi:within_threshold'])
    expect(r.s8d).toMatchObject({ spent: 135000, limit: 90000 })
    expect(r.s9).toEqual(['yopildi:', 'yopildi:not_applicable', 'yopildi:within_threshold', 'yopildi:within_threshold'])
    expect(r.s10).toEqual([
      'yopildi:', 'yopildi:category_deleted', 'yopildi:not_applicable', 'yopildi:within_threshold', 'yopildi:within_threshold',
    ])
  })

  it('boshqa oy va boshqa tur alohida; limitsiz tur — alert yo`q', async () => {
    const r = await as('admin', async (tx) => {
      const cat = CAT['Asbob-uskuna ijarasi']!
      await tx.query(`update public.expense_categories set monthly_limit = 1000 where id = $1`, [cat])
      await addExpense(tx, { payer_id: P('admin'), amount: 900, category_id: cat, created_by: P('admin') })
      // o'tgan oy (admin orqa sana kirita oladi)
      await addExpense(tx, {
        payer_id: P('admin'), amount: 900, category_id: cat, created_by: P('admin'),
        spent_at: await scalar<string>(tx, `select (date_trunc('month', now() at time zone 'Asia/Tashkent') - interval '1 day')::timestamp at time zone 'Asia/Tashkent'`),
      })
      await addExpense(tx, { payer_id: P('admin'), amount: 5_000_000, category_id: CAT['Kommunal xizmatlar'], created_by: P('admin') })
      return sys(tx, () => scalar<number>(tx, `select count(*)::int from public.alerts where company_id = $1 and type::text = 'xarajat_limiti'`, [A.id]))
    })
    expect(r).toBe(0)
  })
})

// ============================================================================
// Hisobotlar
// ============================================================================
describe('hisobotlar', () => {
  it('dashboard_summary: expense_*, spend_total_sum; obyekt filtri; tekshiruvchi — nollar', async () => {
    const today = await scalar<string>(db, `select (now() at time zone 'Asia/Tashkent')::date::text`)
    const r = await as('direktor', async (tx) => ({
      all: await scalar<Row>(tx, `select public.dashboard_summary($1, $1)`, [today]),
      obj1: await scalar<Row>(tx, `select public.dashboard_summary($1, $1, $2)`, [today, A.ids.obj1]),
    }))
    expect(r.all).toMatchObject({ expense_count: 3, expense_sum: '210000.00', purchases_sum: '1800000.00', spend_total_sum: '2010000.00' })
    expect(r.all.expense_by_category).toEqual([{ category_id: A.ids.ec1, category_name: 'Oziq-ovqat', sum: '210000.00', count: 3 }])
    expect(r.obj1).toMatchObject({ expense_count: 1, expense_sum: '50000.00' })
    const blind = await as('tekshiruvchi', (tx) => scalar<Row>(tx, `select public.dashboard_summary($1, $1)`, [today]))
    expect(blind).toMatchObject({ expense_count: 0, expense_sum: '0.00', expense_by_category: [], spend_total_sum: '0.00' })
  })

  it('spend_breakdown: category, object (material / boshqa), buyer (to`lovchi); noto`g`ri guruh', async () => {
    const today = await scalar<string>(db, `select (now() at time zone 'Asia/Tashkent')::date::text`)
    const r = await as('admin', async (tx) => ({
      cat: await rows(tx, `select key, label, purchases_sum, purchases_count, expenses_sum, expenses_count, total_sum from public.spend_breakdown($1, $1, null, 'category')`, [today]),
      obj: await rows(tx, `select key, purchases_sum, expenses_sum, total_sum from public.spend_breakdown($1, $1, null, 'object')`, [today]),
      mat: await rows(tx, `select expenses_count from public.spend_breakdown($1, $1, null, 'material')`, [today]),
      bad: await res(tx, `select * from public.spend_breakdown($1, $1, null, 'x')`, [today]),
    }))
    expect(r.cat).toEqual([
      { key: A.ids.ec1, label: 'Oziq-ovqat', purchases_sum: '0.00', purchases_count: 0, expenses_sum: '210000.00', expenses_count: 3, total_sum: '210000.00' },
    ])
    expect(r.obj).toEqual([
      { key: A.ids.obj1, purchases_sum: '1200000.00', expenses_sum: '50000.00', total_sum: '1250000.00' },
      { key: A.ids.obj2, purchases_sum: '600000.00', expenses_sum: '90000.00', total_sum: '690000.00' },
      { key: null, purchases_sum: '0.00', expenses_sum: '70000.00', total_sum: '70000.00' },
    ])
    expect(r.mat.every((x) => x.expenses_count === 0)).toBe(true)
    expect(r.bad).toBe('22023:report_group_invalid')
  })

  it('my_expense_category_usage: o`zi kiritganlari, ko`p ishlatilgan birinchi', async () => {
    const r = await as('taminotchi', async (tx) => {
      await addExpense(tx, { payer_id: P('taminotchi'), category_id: CAT['Boshqa'], created_by: P('taminotchi') })
      await addExpense(tx, { payer_id: P('taminotchi'), category_id: CAT['Boshqa'], amount: 2, created_by: P('taminotchi') })
      return rows(tx, `select category_id, use_count::int from public.my_expense_category_usage(30)`)
    })
    expect(r).toEqual([
      { category_id: CAT['Boshqa'], use_count: 2 },
      { category_id: A.ids.ec1, use_count: 1 },
    ])
  })

  it('merge_suppliers: xarajatlar ham ko`chiriladi', async () => {
    const r = await as('admin', async (tx) => {
      const s2 = await scalar<string>(tx, `insert into public.suppliers (company_id, name, created_by) values ($1, 'Ikkinchi', $2) returning id`, [A.id, P('admin')])
      const id = await addExpense(tx, { payer_id: P('admin'), supplier_id: s2, created_by: P('admin') })
      await tx.query(`select public.merge_suppliers($1, $2)`, [A.ids.s1, s2])
      const al = await sys(tx, () =>
        scalar<Row>(tx, `select details from public.alerts where company_id = $1 and type::text = 'sotuvchi_birlashtirildi' order by created_at desc limit 1`, [A.id]),
      )
      return { sup: await scalar(tx, `select supplier_id from public.expenses where id = $1`, [id]), moved: al.moved_expense_count }
    })
    expect(r).toEqual({ sup: A.ids.s1, moved: 1 })
  })
})

// ============================================================================
// "Smetaga kirmaydi" materiallar
// ============================================================================
describe('outside_estimate', () => {
  const chiqim = (tx: Tx, obj: string, qty: number): Promise<string> =>
    scalar<string>(
      tx,
      `insert into public.movements (company_id, type, object_id, material_id, qty_input, unit_input, created_by)
       values ($1, 'chiqim', $2, $3, $4, 'm³', $5) returning id`,
      [A.id, obj, A.ids.m2, qty, P('admin')],
    )
  const open = (tx: Tx, type: string, obj: string): Promise<Row[]> =>
    sys(tx, () =>
      rows(
        tx,
        `select status::text, details ->> 'closed_reason' as reason from public.alerts
          where company_id = $1 and type::text = $2 and object_id = $3 and (material_id = $4 or material_id is null)
          order by created_at`,
        [A.id, type, obj, A.ids.m2],
      ),
    )

  it('oddiy material: qoida 4 (not_in_estimate), 6 va smetasiz_chiqim ishlaydi (nazorat)', async () => {
    const r = await as('admin', async (tx) => {
      await chiqim(tx, A.ids.obj1!, 1)
      await chiqim(tx, A.ids.obj3!, 1)
      await tx.query(
        `insert into public.material_requests (company_id, object_id, material_id, qty_input, unit_input, created_by) values ($1, $2, $3, 5, 'm³', $4)`,
        [A.id, A.ids.obj1, A.ids.m2, P('admin')],
      )
      return {
        norm: (await open(tx, 'normadan_oshish', A.ids.obj1!)).length,
        req: (await open(tx, 'smetadan_ortiq_sorov', A.ids.obj1!)).length,
        noEst: (await open(tx, 'smetasiz_chiqim', A.ids.obj3!)).length,
      }
    })
    expect(r).toEqual({ norm: 1, req: 1, noEst: 1 })
  })

  it('smetaga kirmaydi: alert yo`q; belgi qo`yilsa ochiqlari outside_estimate bilan yopiladi; norm_overview, kunlik hisobot', async () => {
    const r = await as('admin', async (tx) => {
      await chiqim(tx, A.ids.obj1!, 1)
      await tx.query(
        `insert into public.material_requests (company_id, object_id, material_id, qty_input, unit_input, created_by) values ($1, $2, $3, 5, 'm³', $4)`,
        [A.id, A.ids.obj1, A.ids.m2, P('admin')],
      )
      const before = { norm: await open(tx, 'normadan_oshish', A.ids.obj1!), req: await open(tx, 'smetadan_ortiq_sorov', A.ids.obj1!) }
      await tx.query(`update public.materials set outside_estimate = true where id = $1`, [A.ids.m2])
      const after = { norm: await open(tx, 'normadan_oshish', A.ids.obj1!), req: await open(tx, 'smetadan_ortiq_sorov', A.ids.obj1!) }
      await chiqim(tx, A.ids.obj1!, 2)
      await chiqim(tx, A.ids.obj3!, 1)
      await tx.query(
        `insert into public.material_requests (company_id, object_id, material_id, qty_input, unit_input, created_by) values ($1, $2, $3, 7, 'm³', $4)`,
        [A.id, A.ids.obj1, A.ids.m2, P('admin')],
      )
      const later = {
        norm: await open(tx, 'normadan_oshish', A.ids.obj1!),
        req: await open(tx, 'smetadan_ortiq_sorov', A.ids.obj1!),
        noEst: await open(tx, 'smetasiz_chiqim', A.ids.obj3!),
      }
      const overview = await rows(tx, `select material_id, consumed_qty_base, outside_estimate from public.norm_overview($1) where material_id = $2`, [A.ids.obj1, A.ids.m2])
      const daily = await sys(tx, () =>
        scalar<Row>(tx, `select private.daily_report_stats($1, now() - interval '1 day', now() + interval '1 minute')`, [A.id]),
      )
      const today = await scalar<string>(tx, `select (now() at time zone 'Asia/Tashkent')::date::text`)
      const dash = await scalar<Row>(tx, `select public.dashboard_summary($1, $1, $2)`, [today, A.ids.obj1])
      // belgi olib tashlansa — oddiy qoidalar qaytadi
      await tx.query(`update public.materials set outside_estimate = false where id = $1`, [A.ids.m2])
      const back = (await open(tx, 'normadan_oshish', A.ids.obj1!)).filter((a) => a.status === 'yangi').length
      return { before, after, later, overview, noEstCount: daily.chiqim_without_estimate_count, over: dash.objects_over_norm_count, back }
    })
    expect(r.before.norm.map((a) => a.status)).toEqual(['yangi'])
    expect(r.before.req.map((a) => a.status)).toEqual(['yangi'])
    expect(r.after.norm).toEqual([{ status: 'yopildi', reason: 'outside_estimate' }])
    expect(r.after.req).toEqual([{ status: 'yopildi', reason: 'outside_estimate' }])
    expect(r.later.norm).toEqual(r.after.norm)
    expect(r.later.req).toEqual(r.after.req)
    expect(r.later.noEst).toEqual([])
    expect(r.overview).toEqual([{ material_id: A.ids.m2, consumed_qty_base: '3.000000', outside_estimate: true }])
    expect(r.noEstCount).toBe(0)
    expect(r.over).toBe(0)
    expect(r.back).toBe(1)
  })
})
