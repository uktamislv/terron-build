// Audit tuzatishlari, 3-tur — 20261112000001_audit3_fixes.sql (shartnoma: docs/audit-fixes.md → "3-tur").
// Har band (D1–D18, D17 dan tashqari — o`tkazib yuborilgan): musbat / manfiy holat, rol va firma izolyatsiyasi.
import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { asService, asUser, createDb, one, rows, scalar, type Db, type Queryable, type Row, type Tx, type UserRole } from './_harness'
import { raw, res, switchUid, sys, system } from './_tx'
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

const P = (role: UserRole, co: CompanyFixture = A): string => co.users[role].profileId
const as = <T>(role: UserRole, fn: (tx: Tx) => Promise<T>, co: CompanyFixture = A): Promise<T> =>
  asUser(db, co.users[role].authUid, fn)
const to = (tx: Tx, role: UserRole, co: CompanyFixture = A): Promise<void> => switchUid(tx, co.users[role].authUid)
const ago = (days: number): string => new Date(Date.now() - days * 86400e3).toISOString()

const TEMPLATE = ['Armatura', 'Beton', "G'isht", 'Kafel', 'Qum', 'Sement M400', 'Sement M500', "Shag'al"]

let matSeq = 0
/** Yangi material (asosiy birlik kg) — id va asosiy birlik qatori. */
async function newMat(q: Queryable = db, co = A.id): Promise<{ id: string; unit: string }> {
  const id = await scalar<string>(q, `insert into public.materials (company_id, name, base_unit) values ($1, $2, 'kg') returning id`, [
    co,
    `A3 material ${++matSeq} ${randomUUID().slice(0, 6)}`,
  ])
  const unit = await scalar<string>(q, `select id from public.material_units where material_id = $1 and factor = 1`, [id])
  return { id, unit }
}

async function purchase(
  q: Queryable,
  buyer: string,
  o: { obj: string; mat: { id: string; unit: string }; qty: string; total: string; at?: string; extra?: Row },
): Promise<string> {
  const extra = o.extra ?? {}
  const cols = Object.keys(extra)
  return scalar<string>(
    q,
    `insert into public.purchases (company_id, buyer_id, object_id, material_id, unit_id, qty_input, unit_input, qty_base,
        unit_price, price_per_base, total_amount, purchased_at${cols.map((c) => `, ${c}`).join('')})
     values ($1, $2, $3, $4, $5, $6, '-', 0, 0, 0, $7, coalesce($8::timestamptz, now())${cols.map((_, i) => `, $${i + 9}`).join('')})
     returning id`,
    [A.id, buyer, o.obj, o.mat.id, o.mat.unit, o.qty, o.total, o.at ?? null, ...Object.values(extra)],
  )
}

async function kirim(q: Queryable, obj: string, mat: { id: string; unit: string }, qty: string, at?: string, extra: Row = {}): Promise<string> {
  const cols = Object.keys(extra)
  return scalar<string>(
    q,
    `insert into public.movements (company_id, type, object_id, material_id, unit_id, qty_input, unit_input, qty_base, occurred_at${cols.map((c) => `, ${c}`).join('')})
     values ($1, 'kirim', $2, $3, $4, $5, '-', 0, coalesce($6::timestamptz, now())${cols.map((_, i) => `, $${i + 7}`).join('')}) returning id`,
    [A.id, obj, mat.id, mat.unit, qty, at ?? null, ...Object.values(extra)],
  )
}

interface AlertRow {
  id: string
  status: string
  severity: string
  details: Row
  material_id: string | null
}
const alertsQ = (q: Queryable, type: string, where = 'true', params: unknown[] = [], co = A.id): Promise<AlertRow[]> =>
  rows<AlertRow>(
    q,
    `select id, status::text, severity::text, details, material_id
       from public.alerts where company_id = '${co}' and type::text = '${type}' and (${where})
      order by created_at, id`,
    params,
  )

// ============================================================================
// D1 / D2 — yangi firma: shablon, create_company
// ============================================================================
describe('D1: yangi firma — materiallar shabloni', () => {
  it('INSERT companies → 8 ta shablon materiali (birlik va muqobil nomlari bilan); qayta qo`llash idempotent', async () => {
    const r = await asService(db, async (tx) => {
      const id = await scalar<string>(tx, `insert into public.companies (name) values ('D1 firma') returning id`)
      const names = (await rows<{ name: string }>(tx, `select name from public.materials where company_id = $1 and deleted_at is null order by name`, [id])).map(
        (x) => x.name,
      )
      const units = await scalar<number>(tx, `select count(*)::int from public.material_units where company_id = $1`, [id])
      const aliases = await scalar<number>(tx, `select count(*)::int from public.material_aliases where company_id = $1`, [id])
      await tx.query(`select private.apply_material_template($1)`, [id])
      const again = await scalar<number>(tx, `select count(*)::int from public.materials where company_id = $1`, [id])
      return { names, units: units > 8, aliases: aliases >= 8, again }
    })
    expect(r).toEqual({ names: TEMPLATE, units: true, aliases: true, again: 8 })
  })
})

describe('D2: create_company (super_admin)', () => {
  const call = `select public.create_company($1, $2, $3) as r`

  it('super_admin emas — company_create_forbidden; anon — execute yo`q', async () => {
    for (const role of ['admin', 'direktor', 'buxgalter', 'prorab'] as UserRole[]) {
      expect(await as(role, (tx) => res(tx, call, ['X', 'Ism', '+998901112233']))).toBe('42501:company_create_forbidden')
    }
    expect(await scalar<boolean>(db, `select has_function_privilege('anon', 'public.create_company(text, text, text)', 'execute')`)).toBe(false)
  })

  it('kiritish tekshiruvi: bo`sh nom, bo`sh ism, noto`g`ri telefon', async () => {
    const r = await as('super_admin', async (tx) => ({
      name: await res(tx, call, ['  ', 'Ism', '+998901112233']),
      admin: await res(tx, call, ['Firma', ' ', '+998901112233']),
      phone: await res(tx, call, ['Firma', 'Ism', '12345']),
    }))
    expect(r).toEqual({ name: '22023:company_name_invalid', admin: '22023:profile_name_invalid', phone: '22023:phone_invalid' })
  })

  it('yangi firma: materiallar + 6 xarajat turi + admin profili (E.164); admin boshqa firmani ko`rmaydi', async () => {
    const r = await as('super_admin', async (tx) => {
      const out = await scalar<{ company_id: string; admin_profile_id: string }>(tx, call, ['  Yangi qurilish MChJ ', ' Ali Valiyev ', '90 111-22-33'])
      const co = out.company_id
      const company = await one(tx, `select name, is_active from public.companies where id = $1`, [co])
      const prof = await sys(tx, () =>
        one(tx, `select company_id, role::text, full_name, phone, auth_user_id, created_by from public.profiles where id = $1`, [out.admin_profile_id]),
      )
      const mats = await sys(tx, () => scalar<number>(tx, `select count(*)::int from public.materials where company_id = $1`, [co]))
      const cats = await sys(tx, () => scalar<number>(tx, `select count(*)::int from public.expense_categories where company_id = $1`, [co]))
      const createdBy = await sys(tx, () => scalar<string>(tx, `select created_by from public.companies where id = $1`, [co]))

      // Yangi admin: auth akkaunt bog'lanadi → faqat o'z firmasi
      const uid = await sys(tx, async () => {
        const u = await scalar<string>(tx, `insert into auth.users (email) values ('d2-admin@test.local') returning id`)
        await tx.query(`update public.profiles set auth_user_id = $1, login_kind = 'web' where id = $2`, [u, out.admin_profile_id])
        return u
      })
      await switchUid(tx, uid)
      const seen = {
        ownMats: await scalar<number>(tx, `select count(*)::int from public.materials`),
        otherMats: await scalar<number>(tx, `select count(*)::int from public.materials where company_id in ($1, $2)`, [A.id, B.id]),
        otherPurchases: await scalar<number>(tx, `select count(*)::int from public.purchases`),
        companies: (await rows<{ id: string }>(tx, `select id from public.companies`)).map((x) => x.id),
        profiles: await scalar<number>(tx, `select count(*)::int from public.profiles`),
        cats: await scalar<number>(tx, `select count(*)::int from public.expense_categories`),
      }
      return { company, prof, mats, cats, createdBy, seen, co }
    })
    expect(r.company).toEqual({ name: 'Yangi qurilish MChJ', is_active: true })
    expect(r.prof).toEqual({
      company_id: r.co,
      role: 'admin',
      full_name: 'Ali Valiyev',
      phone: '+998901112233',
      auth_user_id: null,
      created_by: P('super_admin'),
    })
    expect(r.createdBy).toBe(P('super_admin'))
    expect(r.mats).toBe(8)
    expect(r.cats).toBe(6)
    expect(r.seen).toEqual({ ownMats: 8, otherMats: 0, otherPurchases: 0, companies: [r.co], profiles: 1, cats: 6 })
  })

  it('super_admin firmalar ro`yxatini ko`radi, nomi va is_active ni o`zgartiradi; admin is_active ni o`zgartira olmaydi', async () => {
    const r = await as('super_admin', async (tx) => {
      const listed = (await rows<{ id: string }>(tx, `select id from public.companies where id in ($1, $2)`, [A.id, B.id])).length
      const upd = await res(tx, `update public.companies set name = 'B yangi nom', is_active = false where id = $1`, [B.id])
      const after = await one(tx, `select name, is_active from public.companies where id = $1`, [B.id])
      await to(tx, 'admin')
      const adm = await res(tx, `update public.companies set is_active = false where id = $1`, [A.id])
      return { listed, upd, after, adm }
    })
    expect(r).toEqual({
      listed: 2,
      upd: 'OK:1',
      after: { name: 'B yangi nom', is_active: false },
      adm: '42501:company_status_super_admin_only',
    })
  })

  it('docs/deploy-supabase.md "Birinchi admin" SQL bloki (SQL Editor — postgres, JWT yo`q) ishlaydi', async () => {
    const r = await as('admin', (tx) =>
      system(tx, async () => {
        // SQL Editor: JWT sozlamalari umuman yo'q (harness rol claim'ini ham tozalaymiz)
        await tx.query(`select set_config('request.jwt.claim.role', '', true)`)
        await tx.query(`insert into auth.users (email) values ('first-admin@example.com')`)
        await tx.exec(`
          do $$
          declare
            r jsonb;
          begin
            r := public.create_company('Firma nomi', 'Ism Familiya', '+998901234567');
            update public.profiles
               set auth_user_id = (select id from auth.users where email = 'first-admin@example.com'),
                   login_kind   = 'web'
             where id = (r ->> 'admin_profile_id')::uuid;
            raise notice '%', r;
          end $$;`)
        return one(
          tx,
          `select p.role::text, p.login_kind, p.auth_user_id is not null as linked,
                  (select count(*)::int from public.materials m where m.company_id = p.company_id) as mats
             from public.profiles p join public.companies c on c.id = p.company_id
            where c.name = 'Firma nomi'`,
        )
      }),
    )
    expect(r).toEqual({ role: 'admin', login_kind: 'web', linked: true, mats: 8 })
  })

  it('normalize_phone — _shared/phone.ts bilan bir xil', async () => {
    const cases: [string, string | null][] = [
      ['+998901234567', '+998901234567'],
      ['998901234567', '+998901234567'],
      ['901234567', '+998901234567'],
      ['8 90 123 45 67', '+998901234567'],
      ['(90) 123-45-67', '+998901234567'],
      ['00998901234567', '+998901234567'],
      ['+79991234567', '+79991234567'],
      ['+99890123456', null],
      ['12345', null],
      ['90a1234567', null],
      ['', null],
    ]
    for (const [input, want] of cases) {
      expect(await scalar(db, `select private.normalize_phone($1)`, [input]), input).toBe(want)
    }
  })
})

// ============================================================================
// D3 — rasm: ko'r sanovchi
// ============================================================================
describe('D3: photos_select — tekshiruvchi', () => {
  it('prorab yuklagan rasm: tekshiruvchi ko`rmaydi; direktor, admin, prorab ko`radi; o`z rasmi va skrinshoti — ko`radi', async () => {
    const r = await as('tekshiruvchi', async (tx) => {
      const other = `${A.id}/2026/10/${randomUUID()}.jpg`
      const own = `${A.id}/2026/10/${randomUUID()}.jpg`
      const bug = `${A.id}/bug/2026/10/${randomUUID()}.jpg`
      await sys(tx, async () => {
        await tx.query(`insert into storage.objects (bucket_id, name, owner_id) values ('photos', $1, $2)`, [other, A.users.prorab.authUid])
        await tx.query(`insert into storage.objects (bucket_id, name, owner_id) values ('photos', $1, $2), ('photos', $3, $2)`, [
          own,
          A.users.tekshiruvchi.authUid,
          bug,
        ])
      })
      const sees = (p: string): Promise<number> => scalar<number>(tx, `select count(*)::int from storage.objects where name = $1`, [p])
      const out: Record<string, number> = { blindOther: await sees(other), blindOwn: await sees(own), blindBug: await sees(bug) }
      for (const role of ['direktor', 'admin', 'prorab', 'buxgalter'] as UserRole[]) {
        await to(tx, role)
        out[role] = await sees(other)
      }
      return out
    })
    expect(r).toEqual({ blindOther: 0, blindOwn: 1, blindBug: 1, direktor: 1, admin: 1, prorab: 1, buxgalter: 1 })
  })
})

// ============================================================================
// D4 — nazorat bayroqlari
// ============================================================================
describe('D4: nazorat bayroqlari o`zgarsa — sozlama_ozgardi', () => {
  it('materials.outside_estimate / photo_required — bitta alert, before/after va aktyor; nom o`zgarsa — yo`q', async () => {
    const r = await as('admin', async (tx) => {
      const mat = await sys(tx, () => newMat(tx))
      await tx.query(`update public.materials set name = name || ' x' where id = $1`, [mat.id])
      const none = await sys(tx, () => alertsQ(tx, 'sozlama_ozgardi', `material_id = $1`, [mat.id]))
      await tx.query(`update public.materials set outside_estimate = true, photo_required = true where id = $1`, [mat.id])
      const a = await sys(tx, () => alertsQ(tx, 'sozlama_ozgardi', `material_id = $1`, [mat.id]))
      return { none: none.length, a, mat: mat.id }
    })
    expect(r.none).toBe(0)
    expect(r.a).toHaveLength(1)
    expect(r.a[0]).toMatchObject({ severity: 'ogohlantirish', status: 'yangi', material_id: r.mat })
    expect(r.a[0]!.details).toMatchObject({
      kind: 'material_control',
      target_id: r.mat,
      actor_profile_id: P('admin'),
      actor_name: expect.any(String),
      changes: [
        { key: 'material_outside_estimate', before: false, after: true },
        { key: 'material_photo_required', before: false, after: true },
      ],
    })
  })

  it('expense_categories.monthly_limit / photo_required / is_active — alert; tizim kontekstida — yo`q', async () => {
    const r = await as('admin', async (tx) => {
      const cat = await sys(tx, () =>
        scalar<string>(tx, `select id from public.expense_categories where company_id = $1 and name = 'Boshqa'`, [A.id]),
      )
      await tx.query(`update public.expense_categories set monthly_limit = 500000 where id = $1`, [cat])
      await tx.query(`update public.expense_categories set photo_required = true, is_active = false where id = $1`, [cat])
      await tx.query(`update public.expense_categories set sort_order = sort_order + 1 where id = $1`, [cat])
      await system(tx, () => tx.query(`update public.expense_categories set monthly_limit = 700000 where id = $1`, [cat]))
      const a = await sys(tx, () => alertsQ(tx, 'sozlama_ozgardi', `details ->> 'target_id' = $1`, [cat]))
      // bitta tranzaksiyada created_at bir xil — kalit bo'yicha tartib
      const changes = a.map((x) => x.details.changes as { key: string }[])
      return { a: changes.sort((p, q) => p[0]!.key.localeCompare(q[0]!.key)) }
    })
    expect(r.a).toEqual([
      [
        { key: 'category_is_active', before: true, after: false },
        { key: 'category_photo_required', before: false, after: true },
      ],
      [{ key: 'category_monthly_limit', before: null, after: 500000 }],
    ])
  })
})

// ============================================================================
// D5 — haftalik podotchet hisoboti
// ============================================================================
describe('D5: enqueue_cash_statements — faqat podotchet xaridlar', () => {
  it('firma to`lagan xarid — sarflandiga kirmaydi va o`zi hisobot sababi emas', async () => {
    const r = await as('admin', (tx) =>
      system(tx, async () => {
        const mk = (name: string, chat: number): Promise<string> =>
          scalar<string>(
            tx,
            `insert into public.profiles (company_id, role, full_name, phone, telegram_chat_id) values ($1, 'haydovchi', $2, $3, $4) returning id`,
            [A.id, name, `+99897${String(1_000_000 + chat).slice(-7)}`, chat],
          )
        const firmaOnly = await mk('D5 firma', 5001)
        const mixed = await mk('D5 aralash', 5002)
        await tx.query(`insert into public.cash_advances (company_id, recipient_id, amount) values ($1, $2, 300000)`, [A.id, mixed])
        await tx.query(`insert into public.object_members (company_id, object_id, profile_id) values ($1, $2, $3), ($1, $2, $4)`, [
          A.id,
          A.ids.obj1,
          firmaOnly,
          mixed,
        ])
        const mat = await newMat(tx)
        await purchase(tx, firmaOnly, { obj: A.ids.obj1!, mat, qty: '1', total: '200000', extra: { payment_source: 'firma' } })
        await purchase(tx, mixed, { obj: A.ids.obj1!, mat, qty: '1', total: '400000', extra: { payment_source: 'firma' } })
        await purchase(tx, mixed, { obj: A.ids.obj1!, mat, qty: '1', total: '50000', extra: { payment_source: 'podotchet' } })
        await tx.query(`select private.enqueue_cash_statements(((now() at time zone 'Asia/Tashkent')::date + 1))`)
        const out = await rows<{ profile_id: string; payload: Row }>(
          tx,
          `select profile_id, payload from public.notification_outbox where kind = 'cash_statement' and profile_id = any($1)`,
          [[firmaOnly, mixed]],
        )
        return { out, firmaOnly, mixed }
      }),
    )
    expect(r.out.map((x) => x.profile_id)).toEqual([r.mixed])
    expect(r.out[0]!.payload).toMatchObject({ spent_week: '50000.00', issued_week: '300000.00', balance: '250000.00' })
  })
})

// ============================================================================
// D6 — qoida 1: kutish, tiklash, severity
// ============================================================================
describe('D6: qoida 1 — greatest(purchased_at, created_at) + 24 soat', () => {
  it('orqa sanali xarid (3 kun oldin, hozir kiritilgan) — cron darhol alert bermaydi; 24 soatdan keyin beradi', async () => {
    const r = await as('admin', (tx) =>
      system(tx, async () => {
        const mat = await newMat(tx)
        const p = await purchase(tx, P('haydovchi'), { obj: A.ids.obj3!, mat, qty: '100', total: '1000', at: ago(3) })
        await tx.query(`select private.evaluate_due_purchases(now())`)
        const now = await alertsQ(tx, 'xarid_qabul_farqi', `purchase_id = $1`, [p])
        await tx.query(`select private.evaluate_due_purchases(now() + interval '25 hours')`)
        const later = await alertsQ(tx, 'xarid_qabul_farqi', `purchase_id = $1`, [p])
        return { now: now.length, later: later.map((a) => a.status) }
      }),
    )
    expect(r).toEqual({ now: 0, later: ['yangi'] })
  })

  it('o`chirilgan eski xaridni tiklash — darhol alert yo`q (zanjir rejimi); soatlik cron yaratadi', async () => {
    const r = await as('admin', async (tx) => {
      const p = await system(tx, async () => {
        const mat = await newMat(tx)
        return purchase(tx, P('haydovchi'), { obj: A.ids.obj3!, mat, qty: '100', total: '1000', at: ago(5) })
      })
      await raw(tx, `update public.purchases set created_at = now() - interval '5 days', deleted_at = now() where id = $1`, [p])
      await tx.query(`update public.purchases set deleted_at = null where id = $1`, [p])
      const restored = await sys(tx, () => alertsQ(tx, 'xarid_qabul_farqi', `purchase_id = $1`, [p]))
      await system(tx, () => tx.query(`select private.evaluate_due_purchases(now())`))
      const cron = await sys(tx, () => alertsQ(tx, 'xarid_qabul_farqi', `purchase_id = $1`, [p]))
      return { restored: restored.length, cron: cron.map((a) => a.status) }
    })
    expect(r).toEqual({ restored: 0, cron: ['yangi'] })
  })

  it('chegara 0 — farq 1 % "ogohlantirish" (jiddiy emas); chegara 2 — farq 10 % "jiddiy"', async () => {
    const run = (pct: number, recv: string): Promise<string[]> =>
      as('admin', async (tx) => {
        const p = await system(tx, async () => {
          await tx.query(`update public.companies set receipt_mismatch_pct = $2 where id = $1`, [A.id, pct])
          const mat = await newMat(tx)
          const p = await purchase(tx, P('haydovchi'), { obj: A.ids.obj3!, mat, qty: '100', total: '1000', at: ago(3) })
          await kirim(tx, A.ids.obj3!, mat, recv, ago(2.9), { purchase_id: p })
          return p
        })
        await raw(tx, `update public.purchases set created_at = now() - interval '3 days' where id = $1`, [p])
        return system(tx, async () => {
          await tx.query(`select private.evaluate_due_purchases(now())`)
          return (await alertsQ(tx, 'xarid_qabul_farqi', `purchase_id = $1`, [p])).map((a) => a.severity)
        })
      })
    expect(await run(0, '99')).toEqual(['ogohlantirish'])
    expect(await run(2, '90')).toEqual(['jiddiy'])
  })
})

// ============================================================================
// D7 — cash_balances: ko'r sanovchi
// ============================================================================
describe('D7: cash_balances — tekshiruvchi hech narsa ko`rmaydi (o`z qatori ham)', () => {
  it('tekshiruvchiga pul berilgan bo`lsa ham — 0 qator; haydovchi o`zini ko`radi', async () => {
    const r = await as('tekshiruvchi', async (tx) => {
      await sys(tx, () =>
        tx.query(`insert into public.cash_advances (company_id, recipient_id, amount) values ($1, $2, 1000)`, [A.id, P('tekshiruvchi')]),
      )
      const blind = await scalar<number>(tx, `select count(*)::int from public.cash_balances`)
      await to(tx, 'haydovchi')
      const own = (await rows<{ profile_id: string }>(tx, `select profile_id from public.cash_balances`)).map((x) => x.profile_id)
      return { blind, own }
    })
    expect(r).toEqual({ blind: 0, own: [P('haydovchi')] })
  })
})

// ============================================================================
// D8 — chek summasi / STIR keshsiz
// ============================================================================
describe('D8: fiskal belgi keshda yo`q — receipt_total va seller_tin null', () => {
  it('xarid va xarajat (foydalanuvchi sessiyasi); kesh bor bo`lsa — keshdan', async () => {
    const r = await as('taminotchi', async (tx) => {
      const mat = await sys(tx, () => newMat(tx))
      const p = await purchase(tx, P('taminotchi'), {
        obj: A.ids.obj1!,
        mat,
        qty: '1',
        total: '1000',
        extra: { receipt_fiscal_sign: 'D8NOPE1', receipt_total: 1000, seller_tin: '123456789' },
      })
      const e = await scalar<string>(
        tx,
        `insert into public.expenses (company_id, category_id, amount, payer_id, receipt_fiscal_sign, receipt_total, seller_tin)
         values ($1, $2, 1000, $3, 'D8NOPE2', 1000, '123456789') returning id`,
        [A.id, A.ids.ec1, P('taminotchi')],
      )
      await sys(tx, () =>
        tx.query(`insert into public.receipt_lookups (company_id, fiscal_sign, payload, total, seller_tin, receipt_at) values ($1, 'D8OK', '{}', 1000, '305000111', now())`, [
          A.id,
        ]),
      )
      const ok = await purchase(tx, P('taminotchi'), {
        obj: A.ids.obj1!,
        mat,
        qty: '1',
        total: '1000',
        extra: { receipt_fiscal_sign: 'D8OK', receipt_total: 5, seller_tin: '999999999' },
      })
      const q = (t: string, id: string): Promise<Row> =>
        sys(tx, () => one(tx, `select receipt_total::text, seller_tin, receipt_verified from public.${t} where id = $1`, [id]))
      return { p: await q('purchases', p), e: await q('expenses', e), ok: await q('purchases', ok) }
    })
    expect(r.p).toEqual({ receipt_total: null, seller_tin: null, receipt_verified: false })
    expect(r.e).toEqual({ receipt_total: null, seller_tin: null, receipt_verified: false })
    expect(r.ok).toEqual({ receipt_total: '1000.00', seller_tin: '305000111', receipt_verified: true })
  })
})

// ============================================================================
// D9 — xarajat_limiti: qisman indeks predikati
// ============================================================================
describe('D9: xarajat_limiti so`rovlari qisman indeks predikatini o`z ichiga oladi', () => {
  it('evaluate_expense_limit (2 joy) va tg_expense_categories_limit', async () => {
    const def = (sig: string): Promise<string> => scalar<string>(db, `select pg_get_functiondef($1::regprocedure)`, [sig])
    const eel = await def('private.evaluate_expense_limit(uuid, uuid, date)')
    const tecl = await def('private.tg_expense_categories_limit()')
    expect(eel.match(/a\.details \? 'category_id'/g)).toHaveLength(2)
    expect(tecl).toContain(`a.details ? 'category_id'`)
  })

  it('limit alerti hayot sikli o`zgarmagan: oshsa ochiladi, limit oshirilsa yopiladi', async () => {
    const r = await as('admin', async (tx) => {
      const cat = await sys(tx, () => scalar<string>(tx, `select id from public.expense_categories where company_id = $1 and name = 'Transport va yetkazish'`, [A.id]))
      await tx.query(`update public.expense_categories set monthly_limit = 1000 where id = $1`, [cat])
      await tx.query(`insert into public.expenses (company_id, category_id, amount, payer_id) values ($1, $2, 5000, $3)`, [A.id, cat, P('admin')])
      const open = await sys(tx, () => alertsQ(tx, 'xarajat_limiti', `details ->> 'category_id' = $1`, [cat]))
      await tx.query(`update public.expense_categories set monthly_limit = 100000 where id = $1`, [cat])
      const closed = await sys(tx, () => alertsQ(tx, 'xarajat_limiti', `details ->> 'category_id' = $1`, [cat]))
      return { open: open.map((a) => a.status), closed: closed.map((a) => a.status) }
    })
    expect(r).toEqual({ open: ['yangi'], closed: ['yopildi'] })
  })
})

// ============================================================================
// D10 — kunlik hisobot: firma bo'yicha izolyatsiya
// ============================================================================
describe('D10: enqueue_daily_reports — bitta firma xatosi boshqalarni to`xtatmaydi', () => {
  it('B firmada statistika xatosi — A uchun qator qo`shiladi', async () => {
    const r = await as('admin', (tx) =>
      system(tx, async () => {
        await tx.exec(`alter function private.daily_report_stats(uuid, timestamptz, timestamptz) rename to daily_report_stats_d10`)
        await tx.query(
          `create function private.daily_report_stats(p_company_id uuid, p_from timestamptz, p_to timestamptz) returns jsonb
             language plpgsql as $f$
           begin
             if p_company_id = '${B.id}' then raise exception 'test xatosi'; end if;
             return private.daily_report_stats_d10(p_company_id, p_from, p_to);
           end $f$`,
        )
        const n = await scalar<number>(tx, `select private.enqueue_daily_reports('2030-01-01'::date)`)
        const cos = (
          await rows<{ company_id: string }>(tx, `select company_id from public.notification_outbox where kind = 'daily_report' and report_date = '2030-01-01'`)
        ).map((x) => x.company_id)
        return { n: n >= 1, a: cos.includes(A.id), b: cos.includes(B.id) }
      }),
    )
    expect(r).toEqual({ n: true, a: true, b: false })
  })
})

// ============================================================================
// D11 — xarajat to'lovchisi almashsa
// ============================================================================
describe('D11: admin to`lovchini almashtirsa — payment_source qayta aniqlanadi', () => {
  it('taminotchi (pul berilmagan) → haydovchi (podotchet) → podotchet; qaytib → firma; manba boshqa qiymatga o`zgartirilsa — o`sha', async () => {
    const r = await as('admin', async (tx) => {
      const e = await scalar<string>(
        tx,
        `insert into public.expenses (company_id, category_id, amount, payer_id, payment_source) values ($1, $2, 1000, $3, 'firma') returning id`,
        [A.id, A.ids.ec1, P('taminotchi')],
      )
      const src = (): Promise<string> => scalar<string>(tx, `select payment_source::text from public.expenses where id = $1`, [e])
      const s0 = await src()
      await tx.query(`update public.expenses set payer_id = $2 where id = $1`, [e, P('haydovchi')])
      const s1 = await src()
      await tx.query(`update public.expenses set payer_id = $2 where id = $1`, [e, P('taminotchi')])
      const s2 = await src()
      await tx.query(`update public.expenses set payer_id = $2 where id = $1`, [e, P('haydovchi')])
      const s3 = await src()
      // podotchet → prorab (unga ham pul berilgan) + manba aniq 'firma' — o'sha saqlanadi
      await tx.query(`update public.expenses set payer_id = $2, payment_source = 'firma' where id = $1`, [e, P('prorab')])
      const s4 = await src()
      return [s0, s1, s2, s3, s4]
    })
    expect(r).toEqual(['firma', 'podotchet', 'firma', 'podotchet', 'firma'])
  })
})

// ============================================================================
// D12 — takroriy yozuv: muallif qulfi
// ============================================================================
describe('D12: evaluate_duplicate — muallif bo`yicha advisory qulf', () => {
  it('qulf qidiruvdan oldin olinadi; takroriy yozuv hali ham aniqlanadi', async () => {
    const def = await scalar<string>(db, `select pg_get_functiondef('private.evaluate_duplicate(text, uuid)'::regprocedure)`)
    const lock = def.indexOf(`private.alert_lock('takroriy_yozuv:by:'`)
    expect(lock).toBeGreaterThan(0)
    expect(lock).toBeLessThan(def.indexOf('into v_first') /* audit3 tekshiruvi: select m.id, m.created_at into v_first */)
    const r = await as('omborchi', async (tx) => {
      const mat = await sys(tx, () => newMat(tx))
      await kirim(tx, A.ids.obj1!, mat, '7')
      const second = await kirim(tx, A.ids.obj1!, mat, '7')
      return (await sys(tx, () => alertsQ(tx, 'takroriy_yozuv', `details ->> 'record_id' = $1`, [second]))).length
    })
    expect(r).toBe(1)
  })
})

// ============================================================================
// D13 / D14 — narx og'ishi
// ============================================================================
describe('D13: price_check — 0 so`mlik xaridlar o`rtachaga kirmaydi', () => {
  it('ikki 0 so`mlik + ikki 100 so`m/kg xarid → o`rtacha 100 (50 emas)', async () => {
    const r = await as('admin', (tx) =>
      system(tx, async () => {
        const mat = await newMat(tx)
        for (const [total, at] of [
          ['0', ago(4)],
          ['0', ago(3)],
          ['10000', ago(2)],
          ['10000', ago(1)],
        ] as const) {
          await purchase(tx, P('taminotchi'), { obj: A.ids.obj1!, mat, qty: '100', total, at })
        }
        return one(tx, `select avg_n::text, avg_90::text, direction from private.price_check($1, $2, 100, now(), 'infinity', null)`, [A.id, mat.id])
      }),
    )
    expect(r).toEqual({ avg_n: '100.0000', avg_90: '100.0000', direction: 'ok' })
  })
})

describe('D14: check_purchase_price(p_purchased_at)', () => {
  it('orqa sana — shu sanagacha bo`lgan xaridlar bilan; 2 argumentli chaqiruv ishlaydi', async () => {
    const r = await as('taminotchi', async (tx) => {
      const mat = await system(tx, async () => {
        const m = await newMat(tx)
        for (const [total, at] of [
          ['10000', ago(20)],
          ['10000', ago(19)],
          ['100000', ago(2)],
          ['100000', ago(1)],
        ] as const) {
          await purchase(tx, P('taminotchi'), { obj: A.ids.obj1!, mat: m, qty: '100', total, at })
        }
        return m
      })
      return {
        past: await scalar<string>(tx, `select public.check_purchase_price($1, 110, $2)`, [mat.id, ago(10)]),
        named: await scalar<string>(tx, `select public.check_purchase_price(p_material_id => $1, p_price_per_base => 110, p_purchased_at => $2)`, [
          mat.id,
          ago(10),
        ]),
        now: await scalar<string>(tx, `select public.check_purchase_price($1, 110)`, [mat.id]),
      }
    })
    expect(r).toEqual({ past: 'high', named: 'high', now: 'low' })
  })
})

// ============================================================================
// D15 / D16 — qabul qilinmagan xaridlar
// ============================================================================
describe('D15: purchase_receipts.unlinked_qty_base', () => {
  it('bog`lanmagan kirim 72 soat ichida — nomzod miqdor; to`liq qabul qilingan xaridda 0', async () => {
    const r = await as('admin', async (tx) => {
      const { p, full } = await system(tx, async () => {
        const mat = await newMat(tx)
        const p = await purchase(tx, P('haydovchi'), { obj: A.ids.obj3!, mat, qty: '100', total: '1000', at: ago(1) })
        await kirim(tx, A.ids.obj3!, mat, '60', ago(0.5))
        const mat2 = await newMat(tx)
        const full = await purchase(tx, P('haydovchi'), { obj: A.ids.obj3!, mat: mat2, qty: '10', total: '1000', at: ago(1) })
        await kirim(tx, A.ids.obj3!, mat2, '10', ago(0.5), { purchase_id: full })
        return { p, full }
      })
      const q = (id: string): Promise<Row> =>
        one(tx, `select received_qty_base::text, remaining_qty_base::text, unlinked_qty_base::text from public.purchase_receipts where purchase_id = $1`, [id])
      return { p: await q(p), full: await q(full) }
    })
    expect(r.p).toEqual({ received_qty_base: '0.000000', remaining_qty_base: '100.000000', unlinked_qty_base: '60.000000' })
    expect(r.full).toEqual({ received_qty_base: '10.000000', remaining_qty_base: '0.000000', unlinked_qty_base: '0.000000' })
  })
})

describe('D16: open_purchases_for_my_objects()', () => {
  const q = `select purchase_id, object_id, object_name, material_name, base_unit, qty_base::text, received_qty_base::text,
                    remaining_qty_base::text, buyer_name from public.open_purchases_for_my_objects()`

  it('prorab — faqat a`zo obyekt (obj1); admin — firma; tekshiruvchi, haydovchi, direktor — bo`sh; B admin — A ni ko`rmaydi', async () => {
    const ids = (x: Row[]): string[] => x.map((y) => y.purchase_id as string).sort()
    const fixture = [A.ids.p_hay_obj2!, A.ids.p_tam_obj1!, A.ids.p_pro_obj1!]
    const mine = async (role: UserRole, co = A): Promise<string[]> =>
      as(role, async (tx) => ids(await rows(tx, q)).filter((id) => fixture.includes(id)), co)
    expect(await mine('prorab')).toEqual([A.ids.p_tam_obj1!, A.ids.p_pro_obj1!].sort())
    expect(await mine('omborchi')).toEqual([A.ids.p_tam_obj1!, A.ids.p_pro_obj1!].sort())
    expect(await mine('admin')).toEqual([...fixture].sort())
    expect(await mine('tekshiruvchi')).toEqual([])
    expect(await mine('haydovchi')).toEqual([])
    expect(await mine('direktor')).toEqual([])
    expect(await as('admin', async (tx) => (await rows(tx, q)).length, B)).toBeGreaterThan(0)
    expect(await mine('admin', B)).toEqual([])
    expect(await as('tekshiruvchi', async (tx) => (await rows(tx, q)).length)).toBe(0)
  })

  it('ustunlar: qolgan miqdor, nomlar; to`liq qabul qilingan xarid ro`yxatda yo`q', async () => {
    const r = await as('prorab', async (tx) => {
      const row = await one(tx, `${q} where purchase_id = $1`, [A.ids.p_pro_obj1])
      await sys(tx, () =>
        tx.query(
          `insert into public.movements (company_id, type, object_id, material_id, qty_input, unit_input, qty_base, purchase_id)
           values ($1, 'kirim', $2, $3, 400, 'kg', 400, $4)`,
          [A.id, A.ids.obj1, A.ids.m1, A.ids.p_pro_obj1],
        ),
      )
      const after = await rows(tx, `${q} where purchase_id = $1`, [A.ids.p_pro_obj1])
      return { row, after: after.length }
    })
    expect(r.row).toMatchObject({
      object_id: A.ids.obj1,
      object_name: expect.stringContaining('obj1'),
      material_name: expect.stringContaining('sement'),
      base_unit: 'kg',
      qty_base: '500.000000',
      received_qty_base: '100.000000',
      remaining_qty_base: '400.000000',
      buyer_name: expect.stringContaining('prorab'),
    })
    expect(r.after).toBe(0)
  })

  it('anon — execute yo`q', async () => {
    expect(await scalar<boolean>(db, `select has_function_privilege('anon', 'public.open_purchases_for_my_objects()', 'execute')`)).toBe(false)
  })
})

// ============================================================================
// D18 — telefon boshqa firmada
// ============================================================================
describe('D18: svc_phone_in_other_company', () => {
  it('service_role: boshqa firmadagi telefon — true; o`z firmasi / yo`q raqam — false; authenticated — ruxsat yo`q', async () => {
    const phone = await scalar<string>(db, `select phone from public.profiles where id = $1`, [P('prorab')])
    const r = await asService(db, async (tx) => ({
      other: await scalar<boolean>(tx, `select public.svc_phone_in_other_company($1, $2)`, [B.id, phone]),
      otherLocal: await scalar<boolean>(tx, `select public.svc_phone_in_other_company($1, $2)`, [B.id, phone.slice(4)]),
      own: await scalar<boolean>(tx, `select public.svc_phone_in_other_company($1, $2)`, [A.id, phone]),
      none: await scalar<boolean>(tx, `select public.svc_phone_in_other_company($1, '+998990000001')`, [A.id]),
    }))
    expect(r).toEqual({ other: true, otherLocal: phone.startsWith('+998'), own: false, none: false })
    expect(await as('admin', (tx) => res(tx, `select public.svc_phone_in_other_company($1, $2)`, [B.id, phone]))).toBe('42501:')
  })

  it('o`chirilgan profil: auth akkaunti bog`langan bo`lsa — hisobga olinadi, bog`lanmagan bo`lsa — yo`q', async () => {
    const r = await as('admin', (tx) =>
      sys(tx, async () => {
        const phone = await scalar<string>(tx, `select phone from public.profiles where id = $1`, [P('direktor')])
        await tx.query(`update public.profiles set deleted_at = now() where id = $1`, [P('direktor')])
        const linked = await scalar<boolean>(tx, `select public.svc_phone_in_other_company($1, $2)`, [B.id, phone])
        await tx.query(`update public.profiles set auth_user_id = null, login_kind = 'none' where id = $1`, [P('direktor')])
        const unlinked = await scalar<boolean>(tx, `select public.svc_phone_in_other_company($1, $2)`, [B.id, phone])
        return { linked, unlinked }
      }),
    )
    expect(r).toEqual({ linked: true, unlinked: false })
  })
})
