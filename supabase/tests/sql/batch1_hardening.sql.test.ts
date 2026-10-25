// Batch 1 — reviewer topilmalaridan keyingi kuchaytirishlar:
// profiles bog'lanish ustunlari, sxema invariantlari, TRUNCATE, miqdorni bazada
// hisoblash, movements bog'lanishlari, material_requests holatlari,
// inventarizatsiyani yuborish, faol bo'lmagan firma, haydovchi xaridi, alerts yopish.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  asAnon,
  asService,
  asUser,
  createAuthUser,
  createDb,
  createUser,
  one,
  rows,
  scalar,
  tryQuery,
  type Db,
  type Row,
  type TestUser,
  type Tx,
} from './_harness'
import {
  ALL_RELATIONS,
  BUSINESS_TABLES,
  SYSTEM_TABLES,
  buildCompany,
  buildTwoCompanies,
  companyCol,
  insertCase,
  tryExec,
  type CompanyFixture,
} from './_fixtures'

let db: Db
let A: CompanyFixture
let B: CompanyFixture
/** is_active = false firma */
let C: CompanyFixture
/** o'chirilgan (deleted_at) firma */
let D: CompanyFixture
/** A firmadagi ikkinchi tekshiruvchi */
let tek2: TestUser

beforeAll(async () => {
  db = await createDb()
  ;({ A, B } = await buildTwoCompanies(db))
  C = await buildCompany(db, 'C')
  D = await buildCompany(db, 'D')
  await db.query(`update public.companies set is_active = false where id = $1`, [C.id])
  await db.query(`update public.companies set deleted_at = now() where id = $1`, [D.id])
  await db.query(`select private.apply_material_template($1)`, [A.id])
  tek2 = await createUser(db, { companyId: A.id, role: 'tekshiruvchi', phone: '+998950000001' })
})
afterAll(async () => {
  await db?.close()
})

/** Superuser sifatida tranzaksiya, oxirida rollback. */
async function inTx<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    const r = await fn(tx)
    await tx.rollback()
    return r
  })
}

const code = (r: { ok: boolean; code?: string | null; affected?: number }): unknown =>
  r.ok ? ('affected' in r ? r.affected : 'OK') : r.code

/** A firma shablon materiali bo'yicha birlik id. */
const unitId = (material: string, unit: string, variant: string | null = null, co = A.id): Promise<string> =>
  scalar<string>(
    db,
    `select u.id from public.material_units u join public.materials m on m.id = u.material_id
      where m.company_id = $1 and m.name = $2 and u.unit = $3 and coalesce(u.variant, '') = coalesce($4, '')
        and u.deleted_at is null`,
    [co, material, unit, variant],
  )
const materialId = (name: string, co = A.id): Promise<string> =>
  scalar<string>(db, `select id from public.materials where company_id = $1 and name = $2`, [co, name])

// ============================================================================
// 1. profiles: auth / Telegram bog'lanish ustunlari
// ============================================================================
describe('profiles bog`lanish ustunlari', () => {
  const LINK_COLS = ['auth_user_id', 'telegram_user_id', 'telegram_chat_id'] as const

  it.each(LINK_COLS)('admin %s bilan profil qo`sha olmaydi (42501)', async (col) => {
    const me = A.users.admin
    const r = await asUser(db, me.authUid, (tx) =>
      tryQuery(
        tx,
        `insert into public.profiles (company_id, role, full_name, phone, created_by, ${col})
         values ($1, 'prorab', 'Yangi', '+998951111111', $2, ${col === 'auth_user_id' ? 'null' : '1'})`,
        [A.id, me.profileId],
      ),
    )
    expect(code(r)).toBe('42501')
  })

  it.each(LINK_COLS)('admin va oddiy rol %s ni update qila olmaydi (42501)', async (col) => {
    const out: unknown[] = []
    for (const [who, target] of [
      [A.users.admin, A.users.haydovchi.profileId],
      [A.users.prorab, A.users.prorab.profileId],
      [A.users.super_admin, A.users.haydovchi.profileId],
    ] as const) {
      const r = await asUser(db, who.authUid, (tx) =>
        tryExec(tx, `update public.profiles set ${col} = ${col === 'auth_user_id' ? 'null' : '1'} where id = $1`, [target]),
      )
      out.push(code(r))
    }
    expect(out).toEqual(['42501', '42501', '42501'])
  })

  it('service_role bog`lanish ustunlarini yoza oladi (insert va update)', async () => {
    const auth = await createAuthUser(db)
    const r = await asService(db, async (tx) => {
      const ins = await tryQuery(
        tx,
        `insert into public.profiles (company_id, role, full_name, phone, auth_user_id, telegram_user_id, telegram_chat_id)
         values ($1, 'prorab', 'TG', '+998951111112', $2, 5001, 6001)`,
        [A.id, auth],
      )
      const upd = await tryExec(
        tx,
        `update public.profiles set telegram_user_id = 5002, telegram_chat_id = 6002 where id = $1`,
        [A.users.haydovchi.profileId],
      )
      return [code(ins), code(upd)]
    })
    expect(r).toEqual(['OK', 1])
  })

  /** Bog'langan profil (auth + telegram) — superuser sifatida, tranzaksiya ichida. */
  async function linkedProfile(tx: Tx): Promise<string> {
    await tx.query(`update public.profiles set telegram_user_id = 9001, telegram_chat_id = 9002 where id = $1`, [
      A.users.omborchi.profileId,
    ])
    return A.users.omborchi.profileId
  }

  it('admin telefonni o`zgartirsa — uchala bog`lanish null bo`ladi', async () => {
    // asUser tranzaksiyasi ichida superuser sifatida bog'lab bo'lmaydi — commit, finally'da qaytariladi
    const id = A.users.omborchi.profileId
    await db.query(`update public.profiles set telegram_user_id = 9001, telegram_chat_id = 9002 where id = $1`, [id])
    try {
      const after = await asUser(db, A.users.admin.authUid, async (tx) => {
        await tx.query(`update public.profiles set phone = '+998951234567' where id = $1`, [id])
        return one(tx, `select auth_user_id, telegram_user_id, telegram_chat_id from public.profiles where id = $1`, [id])
      })
      expect(after).toEqual({ auth_user_id: null, telegram_user_id: null, telegram_chat_id: null })
    } finally {
      await db.query(`update public.profiles set telegram_user_id = null, telegram_chat_id = null where id = $1`, [id])
    }
  })

  it('admin telefonni o`zgartirmasa (masalan ism) — bog`lanish saqlanadi', async () => {
    const id = A.users.omborchi.profileId
    await db.query(`update public.profiles set telegram_user_id = 9001 where id = $1`, [id])
    try {
      const after = await asUser(db, A.users.admin.authUid, async (tx) => {
        await tx.query(`update public.profiles set full_name = 'Yangi ism' where id = $1`, [id])
        return one(tx, `select auth_user_id, telegram_user_id::text as tg from public.profiles where id = $1`, [id])
      })
      expect(after).toEqual({ auth_user_id: A.users.omborchi.authUid, tg: '9001' })
    } finally {
      await db.query(`update public.profiles set telegram_user_id = null where id = $1`, [id])
    }
  })

  it('service_role telefon + bog`lanishni bitta UPDATE`da o`zgartirsa — yangi bog`lanish saqlanadi', async () => {
    const newAuth = await createAuthUser(db)
    const r = await inTx(async (tx) => {
      const id = await linkedProfile(tx)
      await tx.exec('set local role service_role')
      await tx.query(
        `update public.profiles set phone = '+998951234568', auth_user_id = $2, telegram_user_id = 9101, telegram_chat_id = 9102
          where id = $1`,
        [id, newAuth],
      )
      return one(tx, `select auth_user_id, telegram_user_id::text as tg, telegram_chat_id::text as chat from public.profiles where id = $1`, [
        id,
      ])
    })
    expect(r).toEqual({ auth_user_id: newAuth, tg: '9101', chat: '9102' })
  })

  it('service_role faqat telefonni o`zgartirsa — o`zgartirilmagan bog`lanishlar null', async () => {
    const r = await inTx(async (tx) => {
      const id = await linkedProfile(tx)
      await tx.exec('set local role service_role')
      await tx.query(`update public.profiles set phone = '+998951234569', telegram_user_id = 9201 where id = $1`, [id])
      return one(tx, `select auth_user_id, telegram_user_id::text as tg, telegram_chat_id from public.profiles where id = $1`, [id])
    })
    expect(r).toEqual({ auth_user_id: null, tg: '9201', telegram_chat_id: null })
  })

  it('telegram_user_id va auth_user_id global unique (firmalar o`rtasida ham), o`chirilganlar hisobga olinmaydi', async () => {
    const r = await inTx(async (tx) => {
      await tx.query(`update public.profiles set telegram_user_id = 4242 where id = $1`, [A.users.prorab.profileId])
      const tgDup = await tryQuery(tx, `update public.profiles set telegram_user_id = 4242 where id = $1`, [
        B.users.prorab.profileId,
      ])
      const authDup = await tryQuery(tx, `update public.profiles set auth_user_id = $2 where id = $1`, [
        B.users.direktor.profileId,
        A.users.direktor.authUid,
      ])
      // A profilini o'chirsak — B ga o'sha qiymatlarni berish mumkin
      await tx.query(`update public.profiles set deleted_at = now() where id = any($1)`, [
        [A.users.prorab.profileId, A.users.direktor.profileId],
      ])
      const tgAfter = await tryQuery(tx, `update public.profiles set telegram_user_id = 4242 where id = $1`, [
        B.users.prorab.profileId,
      ])
      const authAfter = await tryQuery(tx, `update public.profiles set auth_user_id = $2 where id = $1`, [
        B.users.direktor.profileId,
        A.users.direktor.authUid,
      ])
      return [code(tgDup), code(authDup), code(tgAfter), code(authAfter)]
    })
    expect(r).toEqual(['23505', '23505', 'OK', 'OK'])
  })
})

// ============================================================================
// 2. Sxema invariantlari (kelajakdagi migratsiyalarni ham qo'riqlaydi)
// ============================================================================
describe('sxema invariantlari', () => {
  const publicTables = (): Promise<string[]> =>
    rows<{ t: string }>(
      db,
      `select c.relname as t from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relkind in ('r', 'p') order by 1`,
    ).then((r) => r.map((x) => x.t))

  it('jadval ro`yxati fixture`dagi bilan mos (yangi jadval qo`shilsa — testlarni yangilang)', async () => {
    expect(await publicTables()).toEqual([...BUSINESS_TABLES, ...SYSTEM_TABLES, 'audit_log'].sort())
  })

  it('har public jadvalda RLS yoqilgan va majburiy (force)', async () => {
    const r = await rows(
      db,
      `select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relkind in ('r', 'p')
          and not (c.relrowsecurity and c.relforcerowsecurity)`,
    )
    expect(r).toEqual([])
  })

  it('anon: public dagi hech bir jadval/view/sequence da privilege yo`q', async () => {
    const r = await rows(
      db,
      `select c.relname, p.priv
         from pg_class c join pg_namespace n on n.oid = c.relnamespace
         cross join unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) as p(priv)
        where n.nspname = 'public' and c.relkind in ('r', 'p', 'v', 'm', 'f')
          and has_table_privilege('anon', c.oid, p.priv)
       union all
       select c.relname, 'USAGE' from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and case when c.relkind = 'S' then has_sequence_privilege('anon', c.oid, 'USAGE') else false end`,
    )
    expect(r).toEqual([])
  })

  it('authenticated: DELETE / TRUNCATE / REFERENCES / TRIGGER yo`q', async () => {
    const r = await rows(
      db,
      `select c.relname, p.priv
         from pg_class c join pg_namespace n on n.oid = c.relnamespace
         cross join unnest(array['DELETE','TRUNCATE','REFERENCES','TRIGGER']) as p(priv)
        where n.nspname = 'public' and c.relkind in ('r', 'p', 'v', 'm', 'f')
          and has_table_privilege('authenticated', c.oid, p.priv)`,
    )
    expect(r).toEqual([])
  })

  it('service_role: TRUNCATE / REFERENCES / TRIGGER yo`q; audit_log da faqat SELECT', async () => {
    const r = await rows(
      db,
      `select c.relname, p.priv
         from pg_class c join pg_namespace n on n.oid = c.relnamespace
         cross join unnest(array['TRUNCATE','REFERENCES','TRIGGER','INSERT','UPDATE','DELETE']) as p(priv)
        where n.nspname = 'public' and c.relkind in ('r', 'p')
          and has_table_privilege('service_role', c.oid, p.priv)
          and (p.priv in ('TRUNCATE','REFERENCES','TRIGGER') or c.relname = 'audit_log')`,
    )
    expect(r).toEqual([])
  })

  it('har biznes jadvalda company_id, created_by, created_at, updated_at, deleted_at', async () => {
    const r = await rows<{ t: string; col: string }>(
      db,
      `select c.relname as t, req.col
         from pg_class c join pg_namespace n on n.oid = c.relnamespace
         cross join unnest(array['company_id','created_by','created_at','updated_at','deleted_at']) as req(col)
        where n.nspname = 'public' and c.relkind in ('r', 'p') and c.relname <> 'audit_log'
          and c.relname <> all ($1::text[])
          and not (c.relname = 'companies' and req.col = 'company_id')
          and not exists (select 1 from pg_attribute a
                           where a.attrelid = c.oid and a.attname = req.col and not a.attisdropped)`,
      [[...SYSTEM_TABLES]],
    )
    expect(r).toEqual([])
  })

  it('tizim jadvallarida company_id, created_at, updated_at; a_block_delete, a_block_truncate; audit trigger yo`q', async () => {
    const cols = await rows(
      db,
      `select t, req.col
         from unnest($1::text[]) as t
         cross join unnest(array['company_id','created_at','updated_at']) as req(col)
        where not exists (select 1 from pg_attribute a
                           where a.attrelid = ('public.' || t)::regclass and a.attname = req.col and not a.attisdropped)`,
      [[...SYSTEM_TABLES]],
    )
    expect(cols).toEqual([])
    for (const t of SYSTEM_TABLES) {
      const tg = await rows<{ tgname: string }>(
        db,
        `select tgname from pg_trigger where tgrelid = ('public.' || $1)::regclass and not tgisinternal and tgenabled <> 'D'`,
        [t],
      )
      const names = tg.map((x) => x.tgname)
      expect(names).toEqual(expect.arrayContaining(['a_block_delete', 'a_block_truncate']))
      expect(names).not.toContain('z_audit')
    }
  })

  it('har biznes jadvalda a_block_delete, a_block_truncate, a_before_insert, a_before_update, z_audit', async () => {
    const r = await rows(
      db,
      `select c.relname, req.tg
         from pg_class c join pg_namespace n on n.oid = c.relnamespace
         cross join unnest(array['a_block_delete','a_block_truncate','a_before_insert','a_before_update','z_audit']) as req(tg)
        where n.nspname = 'public' and c.relkind in ('r', 'p') and c.relname <> 'audit_log'
          and c.relname <> all ($1::text[])
          and not exists (select 1 from pg_trigger g
                           where g.tgrelid = c.oid and g.tgname = req.tg and not g.tgisinternal and g.tgenabled <> 'D')`,
      [[...SYSTEM_TABLES]],
    )
    expect(r).toEqual([])
  })

  it('audit_log: a_block_truncate va audit_log_immutable bor; audit trigger yo`q', async () => {
    const r = await rows<{ tgname: string }>(
      db,
      `select tgname from pg_trigger where tgrelid = 'public.audit_log'::regclass and not tgisinternal and tgenabled <> 'D'
        order by 1`,
    )
    expect(r.map((x) => x.tgname)).toEqual(['a_block_truncate', 'audit_log_immutable'])
  })

  it('public funksiyalar (extension`ga tegishli bo`lmagan) anon uchun execute emas', async () => {
    const r = await rows<{ proname: string; anon: boolean }>(
      db,
      `select p.proname, has_function_privilege('anon', p.oid, 'execute') as anon
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public'
          and not exists (select 1 from pg_depend d where d.classid = 'pg_proc'::regclass and d.objid = p.oid and d.deptype = 'e')
        order by 1`,
    )
    expect(r.length).toBeGreaterThan(0) // kamida submit_inventory_count
    expect(r.filter((x) => x.anon)).toEqual([])
  })

  it('private funksiyalar anon uchun execute emas (sxemaga usage ham yo`q)', async () => {
    const r = await rows(
      db,
      `select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'private' and has_function_privilege('anon', p.oid, 'execute')`,
    )
    expect(r).toEqual([])
    expect(await scalar<boolean>(db, `select has_schema_privilege('anon', 'private', 'usage')`)).toBe(false)
  })

  it('public va private dagi barcha security definer funksiyalarda search_path belgilangan', async () => {
    const r = await rows(
      db,
      `select n.nspname, p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname in ('public', 'private') and p.prosecdef
          and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%')`,
    )
    expect(r).toEqual([])
    const n = await scalar<number>(
      db,
      `select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname in ('public', 'private') and p.prosecdef`,
    )
    expect(n).toBeGreaterThan(5)
  })

  it('public / private da float turdagi ustun yo`q', async () => {
    const r = await rows(
      db,
      `select c.relname, a.attname from pg_attribute a
         join pg_class c on c.oid = a.attrelid join pg_namespace n on n.oid = c.relnamespace
        where n.nspname in ('public', 'private') and a.attnum > 0 and not a.attisdropped
          and a.atttypid in ('real'::regtype, 'double precision'::regtype)`,
    )
    expect(r).toEqual([])
  })

  it('migratsiyadan keyin yaratilgan yangi jadval/sequence anon va authenticated ga ochilmaydi', async () => {
    const r = await inTx(async (tx) => {
      await tx.exec(`create table public.zz_future_probe (id bigint generated always as identity primary key, x int)`)
      return one(
        tx,
        `select
           has_table_privilege('anon', 'public.zz_future_probe', 'select') as anon_sel,
           has_table_privilege('anon', 'public.zz_future_probe', 'insert') as anon_ins,
           has_table_privilege('authenticated', 'public.zz_future_probe', 'select') as auth_sel,
           has_table_privilege('authenticated', 'public.zz_future_probe', 'insert') as auth_ins,
           has_table_privilege('authenticated', 'public.zz_future_probe', 'delete') as auth_del,
           has_sequence_privilege('anon', pg_get_serial_sequence('public.zz_future_probe', 'id'), 'usage') as anon_seq,
           has_sequence_privilege('authenticated', pg_get_serial_sequence('public.zz_future_probe', 'id'), 'usage') as auth_seq`,
      )
    })
    expect(r).toEqual({
      anon_sel: false,
      anon_ins: false,
      auth_sel: false,
      auth_ins: false,
      auth_del: false,
      anon_seq: false,
      auth_seq: false,
    })
  })
})

// ============================================================================
// 3. TRUNCATE
// ============================================================================
describe('TRUNCATE taqiqlangan', () => {
  const TABLES = [...BUSINESS_TABLES, ...SYSTEM_TABLES, 'audit_log'] as const
  it.each(TABLES)('%s: superuser (cascade bilan ham) — 42501', async (t) => {
    const r = await tryQuery(db, `truncate public.${t} cascade`)
    expect(code(r)).toBe('42501')
  })
  it.each(TABLES)('%s: service_role — 42501', async (t) => {
    const r = await asService(db, (tx) => tryQuery(tx, `truncate public.${t}`))
    expect(code(r)).toBe('42501')
  })
  it('truncate urinishlaridan keyin ma`lumot joyida', async () => {
    expect(await scalar<number>(db, `select count(*)::int from public.audit_log`)).toBeGreaterThan(0)
    expect(await scalar<number>(db, `select count(*)::int from public.movements`)).toBeGreaterThan(0)
  })
})

// ============================================================================
// 4. Miqdor (va narx) bazada hisoblanadi
// ============================================================================
describe('miqdor bazada hisoblanadi', () => {
  it('xarid: 3 qop sement → 150 kg; klient qty_base/unit_price/price_per_base ustiga yoziladi; narx aniqligi', async () => {
    const me = A.users.admin
    const mat = await materialId('Sement M400')
    const unit = await unitId('Sement M400', 'qop')
    const r = await asUser(db, me.authUid, (tx) =>
      one(
        tx,
        `insert into public.purchases (company_id, buyer_id, object_id, material_id, unit_id, qty_input, unit_input,
           qty_base, total_amount, unit_price, price_per_base, created_by)
         values ($1, $2, $3, $4, $5, 3, 'soxta', 999, 100000, 1, 1, $2)
         returning qty_base::text, unit_input, unit_variant, unit_price::text, price_per_base::text, total_amount::text`,
        [A.id, me.profileId, A.ids.obj1, mat, unit],
      ),
    )
    expect(r).toEqual({
      qty_base: '150.000000',
      unit_input: 'qop',
      unit_variant: null,
      unit_price: '33333.33',
      price_per_base: '666.6667',
      total_amount: '100000.00',
    })
  })

  it('variantli birlik: 1 m² devor (bir g`isht · 250 mm) → 102 dona', async () => {
    const mat = await materialId("G'isht")
    const unit = await unitId("G'isht", 'm² devor', "bir g'isht · 250 mm")
    const r = await asUser(db, A.users.prorab.authUid, (tx) =>
      one(
        tx,
        `insert into public.movements (company_id, type, object_id, material_id, unit_id, qty_input, unit_input, qty_base, created_by)
         values ($1, 'kirim', $2, $3, $4, 1, 'x', 1, $5)
         returning qty_base::text, unit_input, unit_variant`,
        [A.id, A.ids.obj1, mat, unit, A.users.prorab.profileId],
      ),
    )
    expect(r).toEqual({ qty_base: '102.000000', unit_input: 'm² devor', unit_variant: "bir g'isht · 250 mm" })
  })

  it('tonna: 1.5 t qum → 1.00005 m³ (round(..., 6))', async () => {
    const mat = await materialId('Qum')
    const unit = await unitId('Qum', 'tonna')
    const r = await inTx((tx) =>
      scalar<string>(
        tx,
        `insert into public.movements (company_id, type, object_id, material_id, unit_id, qty_input, unit_input, qty_base)
         values ($1, 'kirim', $2, $3, $4, 1.5, 'x', 1) returning qty_base::text`,
        [A.id, A.ids.obj1, mat, unit],
      ),
    )
    expect(r).toBe('1.000050')
  })

  it('transfers va material_requests ham hisoblanadi (2 qop → 100 kg)', async () => {
    const mat = await materialId('Sement M500')
    const unit = await unitId('Sement M500', 'qop')
    const r = await inTx(async (tx) => {
      const t = await scalar<string>(
        tx,
        `insert into public.transfers (company_id, from_object_id, to_object_id, material_id, unit_id, qty_input, unit_input, qty_base)
         values ($1, $2, $3, $4, $5, 2, 'x', 1) returning qty_base::text`,
        [A.id, A.ids.obj1, A.ids.obj2, mat, unit],
      )
      const q = await scalar<string>(
        tx,
        `insert into public.material_requests (company_id, object_id, material_id, unit_id, qty_input, unit_input, qty_base)
         values ($1, $2, $3, $4, 2, 'x', 1) returning qty_base::text`,
        [A.id, A.ids.obj1, mat, unit],
      )
      return [t, q]
    })
    expect(r).toEqual(['100.000000', '100.000000'])
  })

  it('unit_id siz: unit_input bo`yicha variantsiz birlik topiladi', async () => {
    const mat = await materialId('Sement M400')
    const r = await inTx((tx) =>
      one(
        tx,
        `insert into public.movements (company_id, type, object_id, material_id, qty_input, unit_input, qty_base)
         values ($1, 'kirim', $2, $3, 4, 'qop', 1) returning qty_base::text, unit_id`,
        [A.id, A.ids.obj1, mat],
      ),
    )
    expect(r).toEqual({ qty_base: '200.000000', unit_id: await unitId('Sement M400', 'qop') })
  })

  it('unit_id siz: faqat variantli birlik bo`lsa (m² devor) → 23503', async () => {
    const mat = await materialId("G'isht")
    const r = await inTx((tx) =>
      tryQuery(
        tx,
        `insert into public.movements (company_id, type, object_id, material_id, qty_input, unit_input, qty_base)
         values ($1, 'kirim', $2, $3, 1, 'm² devor', 1)`,
        [A.id, A.ids.obj1, mat],
      ),
    )
    expect(code(r)).toBe('23503')
  })

  it('boshqa materialning birligi → 23503', async () => {
    const qum = await materialId('Qum')
    const qop = await unitId('Sement M400', 'qop')
    const r = await inTx(async (tx) =>
      tryQuery(
        tx,
        `insert into public.movements (company_id, type, object_id, material_id, unit_id, qty_input, unit_input, qty_base)
         values ($1, 'kirim', $2, $3, $4, 1, 'qop', 1)`,
        [A.id, A.ids.obj1, qum, qop],
      ),
    )
    expect(code(r)).toBe('23503')
  })

  it('boshqa firmaning birligi → 23503', async () => {
    const r = await inTx(async (tx) =>
      tryQuery(
        tx,
        `insert into public.movements (company_id, type, object_id, material_id, unit_id, qty_input, unit_input, qty_base)
         values ($1, 'kirim', $2, $3, $4, 1, 'qop', 1)`,
        [A.id, A.ids.obj1, A.ids.m1, B.ids.u1],
      ),
    )
    expect(code(r)).toBe('23503')
  })

  it('o`chirilgan birlik: yangi yozuvda → 23503; eski yozuvni (birlik o`zgarmasa) update qilish mumkin', async () => {
    const r = await inTx(async (tx) => {
      // mv_obj1 — m1, 'kg' (asosiy birlik). Uni va u1 (qop) ni o'chiramiz.
      await tx.query(`update public.material_units set deleted_at = now() where id = $1`, [A.ids.u1])
      const fresh = await tryQuery(
        tx,
        `insert into public.movements (company_id, type, object_id, material_id, unit_id, qty_input, unit_input, qty_base)
         values ($1, 'kirim', $2, $3, $4, 1, 'qop', 1)`,
        [A.id, A.ids.obj1, A.ids.m1, A.ids.u1],
      )
      const byText = await tryQuery(
        tx,
        `insert into public.movements (company_id, type, object_id, material_id, qty_input, unit_input, qty_base)
         values ($1, 'kirim', $2, $3, 1, 'qop', 1)`,
        [A.id, A.ids.obj1, A.ids.m1],
      )
      // p_pro_obj1 — u1 (qop) bilan yaratilgan; birlik o'chirilgan, lekin xaridni tahrirlash mumkin
      const old = await tryQuery(
        tx,
        `update public.purchases set qty_input = 2 where id = $1 returning qty_base::text`,
        [A.ids.p_pro_obj1],
      )
      return [code(fresh), code(byText), old.ok ? old.rows[0] : old.code]
    })
    expect(r).toEqual(['23503', '23503', { qty_base: '100.000000' }])
  })

  it('inventory_adjust: manfiy ishora saqlanadi (−2 qop → −100 kg)', async () => {
    const r = await inTx((tx) =>
      one(
        tx,
        `insert into public.movements (company_id, type, object_id, material_id, unit_id, qty_input, unit_input, qty_base,
           inventory_count_id)
         values ($1, 'inventory_adjust', $2, $3, $4, -2, 'x', 5, $5) returning qty_input::text, qty_base::text`,
        [A.id, A.ids.obj1, A.ids.m1, A.ids.u1, A.ids.ic_obj1],
      ),
    )
    expect(r).toEqual({ qty_input: '-2.000000', qty_base: '-100.000000' })
  })

  it('juda kichik miqdor 0 ga yaxlitlansa → CHECK 23514', async () => {
    const kafel = await materialId('Kafel')
    const dona = await unitId('Kafel', 'dona', '30×30 sm')
    const r = await inTx(async (tx) =>
      tryQuery(
        tx,
        `insert into public.movements (company_id, type, object_id, material_id, unit_id, qty_input, unit_input, qty_base)
         values ($1, 'kirim', $2, $3, $4, 0.000001, 'x', 1)`,
        [A.id, A.ids.obj1, kafel, dona],
      ),
    )
    expect(code(r)).toBe('23514')
  })

  it('UPDATE`da qayta hisoblanadi: qty_input o`zgarsa qty_base ham, klient qty_base e`tiborsiz', async () => {
    const r = await inTx((tx) =>
      scalar<string>(tx, `update public.movements set qty_input = 3, qty_base = 1 where id = $1 returning qty_base::text`, [
        A.ids.mv_obj1,
      ]),
    )
    expect(r).toBe('3.000000')
  })

  it('yangi material yaratilganda asosiy birlik (factor = 1) avtomatik qo`shiladi', async () => {
    const me = A.users.admin
    const r = await asUser(db, me.authUid, async (tx) => {
      const id = await scalar<string>(
        tx,
        `insert into public.materials (company_id, name, base_unit, created_by) values ($1, 'Gips', 'kg', $2) returning id`,
        [A.id, me.profileId],
      )
      return rows(tx, `select unit, factor::text, variant from public.material_units where material_id = $1`, [id])
    })
    expect(r).toEqual([{ unit: 'kg', factor: '1.0000000000', variant: null }])
  })
})

// ============================================================================
// 5. movements bog'lanishlari
// ============================================================================
describe('movements bog`lanishlari', () => {
  const ins = (type: string, links: { purchase?: string; transfer?: string; ic?: string }, obj?: string, mat?: string) =>
    inTx((tx) =>
      tryQuery(
        tx,
        `insert into public.movements (company_id, type, object_id, material_id, qty_input, unit_input, qty_base,
           purchase_id, transfer_id, inventory_count_id)
         values ($1, $2, $3, $4, 1, $8, 1, $5, $6, $7)`,
        [A.id, type, obj ?? A.ids.obj1, mat ?? A.ids.m1, links.purchase ?? null, links.transfer ?? null, links.ic ?? null, mat === A.ids.m2 ? 'm³' : 'kg'],
      ),
    )

  const cases: Array<[string, string, { purchase?: string; transfer?: string; ic?: string }, string]> = []
  beforeAll(() => {
    const p = A.ids.p_pro_obj1! // m1, obj1
    const tr = A.ids.tr_1to2!
    const ic = A.ids.ic_obj1!
    cases.push(
      ['kirim + purchase (mos)', 'kirim', { purchase: p }, 'OK'],
      ['kirim (bog`lanishsiz)', 'kirim', {}, 'OK'],
      ['kirim + transfer', 'kirim', { transfer: tr }, '23514'],
      ['kirim + inventory', 'kirim', { ic }, '23514'],
      ['chiqim (bog`lanishsiz)', 'chiqim', {}, 'OK'],
      ['chiqim + purchase', 'chiqim', { purchase: p }, '23514'],
      ['chiqim + transfer', 'chiqim', { transfer: tr }, '23514'],
      ['chiqim + inventory', 'chiqim', { ic }, '23514'],
      ['transfer_out + transfer', 'transfer_out', { transfer: tr }, 'OK'],
      ['transfer_out (transfer_id siz)', 'transfer_out', {}, '23514'],
      ['transfer_out + transfer + purchase', 'transfer_out', { transfer: tr, purchase: p }, '23514'],
      ['transfer_in + transfer', 'transfer_in', { transfer: tr }, 'OK'],
      ['transfer_in + transfer + inventory', 'transfer_in', { transfer: tr, ic }, '23514'],
      ['inventory_adjust + inventory', 'inventory_adjust', { ic }, 'OK'],
      ['inventory_adjust (inventory_count_id siz)', 'inventory_adjust', {}, '23514'],
      ['inventory_adjust + inventory + transfer', 'inventory_adjust', { ic, transfer: tr }, '23514'],
    )
  })

  it('har tur uchun bog`lanish qoidasi (movements_links_check)', async () => {
    const out: Record<string, unknown> = {}
    const expected: Record<string, string> = {}
    for (const [label, type, links, exp] of cases) {
      out[label] = code(await ins(type, links))
      expected[label] = exp
    }
    expect(out).toEqual(expected)
  })

  it('boshqa obyektdagi xaridga bog`lash → 23514', async () => {
    expect(code(await ins('kirim', { purchase: A.ids.p_pro_obj1 }, A.ids.obj2))).toBe('23514')
  })

  it('boshqa material xaridiga bog`lash → 23514', async () => {
    expect(code(await ins('kirim', { purchase: A.ids.p_pro_obj1 }, A.ids.obj1, A.ids.m2))).toBe('23514')
  })

  it('o`chirilgan xaridga bog`lash → 23503', async () => {
    const r = await inTx(async (tx) => {
      await tx.query(`update public.purchases set deleted_at = now() where id = $1`, [A.ids.p_tam_obj1])
      return tryQuery(
        tx,
        `insert into public.movements (company_id, type, object_id, material_id, qty_input, unit_input, qty_base, purchase_id)
         values ($1, 'kirim', $2, $3, 1, 'kg', 1, $4)`,
        [A.id, A.ids.obj1, A.ids.m1, A.ids.p_tam_obj1],
      )
    })
    expect(code(r)).toBe('23503')
  })

  it('boshqa firma xaridiga bog`lash → 23503', async () => {
    expect(code(await ins('kirim', { purchase: B.ids.p_pro_obj1 }))).toBe('23503')
  })

  it('UPDATE: mavjud harakatni boshqa obyektga ko`chirish (xarid bog`langan) → 23514', async () => {
    const r = await inTx((tx) => tryQuery(tx, `update public.movements set object_id = $2 where id = $1`, [A.ids.mv_obj1, A.ids.obj2]))
    expect(code(r)).toBe('23514')
  })
})

// ============================================================================
// 6. material_requests: taminotchi cheklovlari va status o'tishlari
// ============================================================================
describe('material_requests', () => {
  const asTam = <T>(fn: (tx: Tx) => Promise<T>): Promise<T> => asUser(db, A.users.taminotchi.authUid, fn)
  const asAdmin = <T>(fn: (tx: Tx) => Promise<T>): Promise<T> => asUser(db, A.users.admin.authUid, fn)
  const upd = (tx: Tx, set: string, params: unknown[] = []) =>
    tryExec(tx, `update public.material_requests set ${set} where id = $1`, [A.ids.mr_obj1, ...params])

  it('taminotchi qty_input / material_id / object_id / soft delete ni o`zgartira olmaydi', async () => {
    const m2Base = await scalar<string>(
      db,
      `select id from public.material_units where material_id = $1 and factor = 1 and variant is null`,
      [A.ids.m2],
    )
    const r = await asTam(async (tx) => ({
      qty: code(await upd(tx, 'qty_input = 5')),
      material: code(await upd(tx, 'material_id = $2, unit_id = $3', [A.ids.m2, m2Base])),
      object: code(await upd(tx, 'object_id = $2', [A.ids.obj2])),
      deleted: code(await upd(tx, 'deleted_at = now()')),
      note: code(await upd(tx, `note = 'ok'`)),
    }))
    expect(r).toEqual({ qty: '42501', material: '42501', object: '42501', deleted: '42501', note: 1 })
  })

  it('taminotchi: kutilmoqda → xarid_qilindi va rad → tasdiqlandi → 42501', async () => {
    const r = await asTam(async (tx) => [
      code(await upd(tx, `status = 'xarid_qilindi'`)),
      code(await upd(tx, `status = 'rad'`)),
      code(await upd(tx, `status = 'tasdiqlandi'`)),
      code(await upd(tx, `status = 'kutilmoqda'`)),
    ])
    expect(r).toEqual(['42501', 1, '42501', '42501'])
  })

  it('taminotchi: kutilmoqda → tasdiqlandi → xarid_qilindi; decided_by/decided_at serverda (klient qiymati e`tiborsiz)', async () => {
    const r = await asTam(async (tx) => {
      const a = await upd(tx, `status = 'tasdiqlandi', decided_by = $2, decided_at = '2000-01-01'`, [A.users.direktor.profileId])
      const s1 = await one<{ decided_by: string; recent: boolean }>(
        tx,
        `select decided_by, decided_at > now() - interval '1 minute' as recent from public.material_requests where id = $1`,
        [A.ids.mr_obj1],
      )
      // faqat note — decided_* saqlanadi (klient boshqasini yuborsa ham)
      const b = await upd(tx, `note = 'x', decided_by = $2`, [A.users.direktor.profileId])
      const s2 = await scalar<string>(tx, `select decided_by from public.material_requests where id = $1`, [A.ids.mr_obj1])
      const c = await upd(tx, `status = 'xarid_qilindi'`)
      return { a: code(a), s1, b: code(b), s2, c: code(c) }
    })
    expect(r).toEqual({
      a: 1,
      s1: { decided_by: A.users.taminotchi.profileId, recent: true },
      b: 1,
      s2: A.users.taminotchi.profileId,
      c: 1,
    })
  })

  it('admin istalgan o`tishni qiladi va miqdorni o`zgartiradi', async () => {
    const r = await asAdmin(async (tx) => [
      code(await upd(tx, `status = 'xarid_qilindi'`)),
      code(await upd(tx, `status = 'rad'`)),
      code(await upd(tx, `status = 'tasdiqlandi'`)),
      code(await upd(tx, `status = 'kutilmoqda'`)),
      code(await upd(tx, `qty_input = 7`)),
      await scalar<string>(tx, `select decided_by from public.material_requests where id = $1`, [A.ids.mr_obj1]),
    ])
    expect(r).toEqual([1, 1, 1, 1, 1, A.users.admin.profileId])
  })

  it('INSERT: kutilmoqda → decided_* null (klient yuborsa ham); admin tasdiqlangan holda qo`shsa → decided_by = admin', async () => {
    const me = A.users.admin
    const r = await asAdmin(async (tx) => {
      const a = await one(
        tx,
        `insert into public.material_requests (company_id, object_id, material_id, qty_input, unit_input, qty_base,
           decided_by, decided_at, created_by)
         values ($1, $2, $3, 1, 'kg', 1, $4, now(), $5) returning decided_by, decided_at`,
        [A.id, A.ids.obj1, A.ids.m1, A.users.direktor.profileId, me.profileId],
      )
      const b = await one(
        tx,
        `insert into public.material_requests (company_id, object_id, material_id, qty_input, unit_input, qty_base,
           status, created_by)
         values ($1, $2, $3, 1, 'kg', 1, 'tasdiqlandi', $4) returning decided_by, decided_at is not null as has_at`,
        [A.id, A.ids.obj1, A.ids.m1, me.profileId],
      )
      return { a, b }
    })
    expect(r).toEqual({
      a: { decided_by: null, decided_at: null },
      b: { decided_by: me.profileId, has_at: true },
    })
  })
})

// ============================================================================
// 7. Inventarizatsiya
// ============================================================================
describe('inventarizatsiya', () => {
  const tek = (): TestUser => A.users.tekshiruvchi

  it('tekshiruvchi status = submitted bilan qo`sha olmaydi', async () => {
    const r = await asUser(db, tek().authUid, (tx) =>
      tryQuery(
        tx,
        `insert into public.inventory_counts (company_id, object_id, status, created_by) values ($1, $2, 'submitted', $3)`,
        [A.id, A.ids.obj1, tek().profileId],
      ),
    )
    expect(code(r)).toBe('42501')
  })

  it.each(['tekshiruvchi', 'admin', 'super_admin'] as const)('%s statusni to`g`ridan-to`g`ri o`zgartira olmaydi', async (role) => {
    const r = await asUser(db, A.users[role].authUid, (tx) =>
      tryExec(tx, `update public.inventory_counts set status = 'submitted' where id = $1`, [A.ids.ic_obj1]),
    )
    expect(code(r)).toBe('42501')
  })

  it('tekshiruvchi qty_expected ni yoza olmaydi (insert → null, update → eski)', async () => {
    const r = await asUser(db, tek().authUid, async (tx) => {
      const ins = await scalar<string | null>(
        tx,
        `insert into public.inventory_count_items (company_id, inventory_count_id, material_id, qty_counted, qty_expected, created_by)
         values ($1, $2, $3, 1, 999, $4) returning qty_expected`,
        [A.id, A.ids.ic_obj1, A.ids.m2, tek().profileId],
      )
      const upd = await scalar<string | null>(
        tx,
        `update public.inventory_count_items set qty_expected = 999, qty_counted = 6 where id = $1 returning qty_expected`,
        [A.ids.ici_obj1],
      )
      return [ins, upd]
    })
    expect(r).toEqual([null, null])
  })

  it('submit_inventory_count: o`z draft hisobi → submitted, qty_expected stock_balances dan (yo`q material → 0)', async () => {
    const r = await asUser(db, tek().authUid, async (tx) => {
      await tx.query(
        `insert into public.inventory_count_items (company_id, inventory_count_id, material_id, qty_counted, created_by)
         values ($1, $2, $3, 0, $4)`,
        [A.id, A.ids.ic_obj1, A.ids.m2, tek().profileId],
      )
      const sub = await tryQuery(tx, `select public.submit_inventory_count($1)`, [A.ids.ic_obj1])
      const items = await rows<{ material_id: string; qty_expected: string }>(
        tx,
        `select material_id, qty_expected::text from public.inventory_count_items where inventory_count_id = $1`,
        [A.ids.ic_obj1],
      )
      const status = await scalar<string>(tx, `select status from public.inventory_counts where id = $1`, [A.ids.ic_obj1])
      const again = await tryQuery(tx, `select public.submit_inventory_count($1)`, [A.ids.ic_obj1])
      return {
        sub: code(sub),
        items: Object.fromEntries(items.map((i) => [i.material_id === A.ids.m1 ? 'm1' : 'm2', i.qty_expected])),
        status,
        again: code(again),
      }
    })
    // obj1 da m1: mv_obj1 kirim 100 kg
    expect(r).toEqual({ sub: 'OK', items: { m1: '100.000000', m2: '0.000000' }, status: 'submitted', again: '55000' })
  })

  it('submit_inventory_count: admin (o`z firmasi) — OK', async () => {
    const r = await asUser(db, A.users.admin.authUid, (tx) => tryQuery(tx, `select public.submit_inventory_count($1)`, [A.ids.ic_obj1]))
    expect(code(r)).toBe('OK')
  })

  it('submit_inventory_count: prorab, boshqa tekshiruvchi, boshqa firma admini — rad', async () => {
    const call = (uid: string) =>
      asUser(db, uid, (tx) => tryQuery(tx, `select public.submit_inventory_count($1)`, [A.ids.ic_obj1])).then(code)
    expect({
      prorab: await call(A.users.prorab.authUid),
      tekshiruvchi2: await call(tek2.authUid),
      direktor: await call(A.users.direktor.authUid),
      b_admin: await call(B.users.admin.authUid),
    }).toEqual({ prorab: '42501', tekshiruvchi2: '42501', direktor: '42501', b_admin: 'P0002' })
  })

  it('submit_inventory_count: anon execute yo`q', async () => {
    const r = await asAnon(db, (tx) => tryQuery(tx, `select public.submit_inventory_count($1)`, [A.ids.ic_obj1]))
    expect(code(r)).toBe('42501')
    expect(await scalar<boolean>(db, `select has_function_privilege('anon', 'public.submit_inventory_count(uuid)', 'execute')`)).toBe(
      false,
    )
  })

  it('submit_inventory_count: mavjud bo`lmagan hisob → P0002', async () => {
    const r = await asUser(db, A.users.admin.authUid, (tx) =>
      tryQuery(tx, `select public.submit_inventory_count(gen_random_uuid())`),
    )
    expect(code(r)).toBe('P0002')
  })
})

// ============================================================================
// 8. Firma faol emas / o'chirilgan
// ============================================================================
describe('faol bo`lmagan yoki o`chirilgan firma', () => {
  const firms = (): Array<[string, CompanyFixture]> => [
    ['is_active = false', C],
    ['deleted_at', D],
  ]
  for (const label of ['is_active = false', 'deleted_at']) {
    it(`${label}: admin va prorab hech narsa ko'rmaydi`, async () => {
      const F = firms().find(([l]) => l === label)![1]
      const out: Record<string, number> = {}
      for (const role of ['admin', 'prorab', 'direktor'] as const) {
        out[role] = await asUser(db, F.users[role].authUid, async (tx) => {
          let n = 0
          for (const t of ALL_RELATIONS) n += await scalar<number>(tx, `select count(*)::int from public.${t}`)
          return n
        })
      }
      expect(out).toEqual({ admin: 0, prorab: 0, direktor: 0 })
    })

    it(`${label}: admin hech narsa qo'sha / o'zgartira olmaydi`, async () => {
      const F = firms().find(([l]) => l === label)![1]
      const me = F.users.admin
      const r = await asUser(db, me.authUid, async (tx) => {
        let ins = 0
        let upd = 0
        for (const t of BUSINESS_TABLES) {
          const c = insertCase(t, F, me.profileId)
          if ((await tryQuery(tx, c.sql, c.params)).ok) ins++
          const u = await tryExec(tx, `update public.${t} set updated_at = now()`)
          if (u.ok && u.affected > 0) upd++
        }
        return { ins, upd }
      })
      expect(r).toEqual({ ins: 0, upd: 0 })
    })

    it(`${label}: super_admin (faol firmada) baribir ko'radi`, async () => {
      const F = firms().find(([l]) => l === label)![1]
      const seen = await asUser(db, A.users.super_admin.authUid, async (tx) => {
        const out: Record<string, boolean> = {}
        for (const t of ALL_RELATIONS) {
          out[t] = (await scalar<number>(tx, `select count(*)::int from public.${t} where ${companyCol(t)} = $1`, [F.id])) > 0
        }
        return out
      })
      expect(seen).toEqual(Object.fromEntries(ALL_RELATIONS.map((t) => [t, true])))
    })
  }
})

// ============================================================================
// 9. haydovchi xaridi faqat a'zo obyektga
// ============================================================================
describe('haydovchi xaridi', () => {
  it.each([
    ['obj1 (a`zo)', 'obj1', 'OK'],
    ['obj2 (a`zo emas)', 'obj2', '42501'],
    ['obj3 (a`zo emas)', 'obj3', '42501'],
  ])('%s → %s', async (_l, obj, expected) => {
    const me = A.users.haydovchi
    const c = insertCase('purchases', A, me.profileId, A.ids[obj])
    const r = await asUser(db, me.authUid, (tx) => tryQuery(tx, c.sql, c.params))
    expect(code(r)).toBe(expected)
  })

  it('taminotchi (firma bo`yicha rol) a`zo bo`lmagan obyektga ham xarid qo`sha oladi', async () => {
    const me = A.users.taminotchi
    const c = insertCase('purchases', A, me.profileId, A.ids.obj3)
    const r = await asUser(db, me.authUid, (tx) => tryQuery(tx, c.sql, c.params))
    expect(code(r)).toBe('OK')
  })
})

// ============================================================================
// 10. alerts: closed_by / closed_at serverda
// ============================================================================
describe('alerts yopish', () => {
  it('yopildi → closed_by = joriy profil, closed_at = now (klient qiymati e`tiborsiz); yopildi dan chiqsa null', async () => {
    const me = A.users.admin
    const r = await asUser(db, me.authUid, async (tx) => {
      const q = (sql: string, params: unknown[] = []): Promise<Row> =>
        one(
          tx,
          `update public.alerts set ${sql} where id = $1
           returning closed_by, closed_at > now() - interval '1 minute' as recent`,
          [A.ids.alert1, ...params],
        )
      // Batch 5: authenticated faqat status va close_note ni o'zgartiradi (ustun grant) —
      // closed_by / closed_at / details ni yuborish — 42501.
      const forged = await tryQuery(
        tx,
        `update public.alerts set status = 'yopildi', closed_by = $2, closed_at = '2000-01-01' where id = $1`,
        [A.ids.alert1, A.users.direktor.profileId],
      )
      const details = await tryQuery(tx, `update public.alerts set details = '{"x":1}' where id = $1`, [A.ids.alert1])
      const closed = await q(`status = 'yopildi'`)
      const touched = await q(`close_note = 'tekshirildi'`)
      const reopened = await q(`status = 'korildi'`)
      return {
        forged: forged.ok ? 'OK' : forged.code,
        details: details.ok ? 'OK' : details.code,
        closed,
        touched,
        reopened,
      }
    })
    expect(r).toEqual({
      forged: '42501',
      details: '42501',
      closed: { closed_by: me.profileId, recent: true },
      touched: { closed_by: me.profileId, recent: true },
      reopened: { closed_by: null, recent: null },
    })
  })

  it('service_role yopilgan alert qo`shsa — closed_by null, closed_at qo`yiladi', async () => {
    const r = await asService(db, (tx) =>
      one(
        tx,
        `insert into public.alerts (company_id, type, status, closed_by, closed_at)
         values ($1, 'narx_ogishi', 'yopildi', $2, '2000-01-01')
         returning closed_by, closed_at > now() - interval '1 minute' as recent`,
        [A.id, A.users.direktor.profileId],
      ),
    )
    expect(r).toEqual({ closed_by: null, recent: true })
  })

  it('service_role yangi (yopilmagan) alert qo`shsa closed_* null', async () => {
    const r = await asService(db, (tx) =>
      one(
        tx,
        `insert into public.alerts (company_id, type, closed_by, closed_at) values ($1, 'narx_ogishi', $2, now())
         returning closed_by, closed_at`,
        [A.id, A.users.direktor.profileId],
      ),
    )
    expect(r).toEqual({ closed_by: null, closed_at: null })
  })
})
