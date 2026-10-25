// Batch 2 — 20261026000001_auth.sql: profiles.login_kind, auth audit hodisalari,
// email bo'yicha auth user qidirish. Funksiyalar faqat service_role uchun.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  asAnon,
  asService,
  asUser,
  createAuthUser,
  createDb,
  one,
  rows,
  scalar,
  tryQuery,
  type Db,
} from './_harness'
import { buildTwoCompanies, tryExec, type CompanyFixture } from './_fixtures'

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

const code = (r: { ok: boolean; code?: string | null; affected?: number }): unknown =>
  r.ok ? ('affected' in r ? r.affected : 'OK') : r.code

describe('profiles.login_kind', () => {
  it('standart qiymat none; authenticated ustunni ko`radi', async () => {
    const r = await asUser(db, A.users.prorab.authUid, (tx) =>
      one<{ login_kind: string }>(tx, `select login_kind from public.profiles where id = $1`, [A.users.prorab.profileId]),
    )
    expect(r.login_kind).toBe('none')
  })

  it('admin login_kind ni update qila olmaydi (42501)', async () => {
    const r = await asUser(db, A.users.admin.authUid, (tx) =>
      tryExec(tx, `update public.profiles set login_kind = 'web' where id = $1`, [A.users.prorab.profileId]),
    )
    expect(code(r)).toBe('42501')
  })

  it('super_admin ham login_kind ni yoza olmaydi (42501)', async () => {
    const r = await asUser(db, A.users.super_admin.authUid, (tx) =>
      tryExec(tx, `update public.profiles set login_kind = 'tg' where id = $1`, [A.users.prorab.profileId]),
    )
    expect(code(r)).toBe('42501')
  })

  it('admin login_kind bilan profil qo`sha olmaydi (42501)', async () => {
    const me = A.users.admin
    const r = await asUser(db, me.authUid, (tx) =>
      tryQuery(
        tx,
        `insert into public.profiles (company_id, role, full_name, phone, created_by, login_kind)
         values ($1, 'prorab', 'Yangi', '+998951111199', $2, 'web')`,
        [A.id, me.profileId],
      ),
    )
    expect(code(r)).toBe('42501')
  })

  it('service_role login_kind ni yoza oladi', async () => {
    const r = await asService(db, async (tx) => {
      const upd = await tryExec(tx, `update public.profiles set login_kind = 'web' where id = $1`, [
        A.users.prorab.profileId,
      ])
      const v = await scalar(tx, `select login_kind from public.profiles where id = $1`, [A.users.prorab.profileId])
      return [code(upd), v]
    })
    expect(r).toEqual([1, 'web'])
  })

  it('noto`g`ri qiymat → 23514', async () => {
    const r = await asService(db, (tx) =>
      tryExec(tx, `update public.profiles set login_kind = 'sms' where id = $1`, [A.users.prorab.profileId]),
    )
    expect(code(r)).toBe('23514')
  })

  it('auth user yo`q profilda tg/web bo`lmaydi: insert → 23514, update → trigger none qiladi', async () => {
    const r = await asService(db, async (tx) => {
      const ins = await tryQuery(
        tx,
        `insert into public.profiles (company_id, role, full_name, phone, login_kind)
         values ($1, 'prorab', 'X', '+998951111196', 'web')`,
        [A.id],
      )
      const id = await scalar<string>(
        tx,
        `insert into public.profiles (company_id, role, full_name, phone) values ($1, 'prorab', 'X', '+998951111198') returning id`,
        [A.id],
      )
      await tx.query(`update public.profiles set login_kind = 'tg' where id = $1`, [id])
      return [code(ins), await scalar(tx, `select login_kind from public.profiles where id = $1`, [id])]
    })
    expect(r).toEqual(['23514', 'none'])
  })

  it('admin telefonni o`zgartirsa → auth_user_id null va login_kind none', async () => {
    const id = A.users.omborchi.profileId
    const authBefore = A.users.omborchi.authUid
    await db.query(`update public.profiles set login_kind = 'web' where id = $1`, [id])
    try {
      const after = await asUser(db, A.users.admin.authUid, async (tx) => {
        await tx.query(`update public.profiles set phone = '+998951234500' where id = $1`, [id])
        return one(tx, `select auth_user_id, login_kind from public.profiles where id = $1`, [id])
      })
      expect(after).toEqual({ auth_user_id: null, login_kind: 'none' })
    } finally {
      // asUser rollback qiladi — superuser o'zgarishini qaytaramiz
      await db.query(`update public.profiles set login_kind = 'none' where id = $1`, [id])
      expect(await scalar(db, `select auth_user_id from public.profiles where id = $1`, [id])).toBe(authBefore)
    }
  })

  it('ism o`zgarsa login_kind saqlanadi', async () => {
    const id = A.users.omborchi.profileId
    await db.query(`update public.profiles set login_kind = 'tg' where id = $1`, [id])
    try {
      const v = await asUser(db, A.users.admin.authUid, async (tx) => {
        await tx.query(`update public.profiles set full_name = 'Yangi ism' where id = $1`, [id])
        return scalar(tx, `select login_kind from public.profiles where id = $1`, [id])
      })
      expect(v).toBe('tg')
    } finally {
      await db.query(`update public.profiles set login_kind = 'none' where id = $1`, [id])
    }
  })

  it('auth user o`chirilsa (on delete set null) → login_kind none', async () => {
    await db.transaction(async (tx) => {
      const auth = await scalar<string>(tx, `insert into auth.users (email) values ('del@test.local') returning id`)
      const id = await scalar<string>(
        tx,
        `insert into public.profiles (company_id, role, full_name, phone, auth_user_id, login_kind)
         values ($1, 'prorab', 'Del', '+998951111197', $2, 'web') returning id`,
        [A.id, auth],
      )
      await tx.query(`delete from auth.users where id = $1`, [auth])
      const r = await one(tx, `select auth_user_id, login_kind from public.profiles where id = $1`, [id])
      expect(r).toEqual({ auth_user_id: null, login_kind: 'none' })
      await tx.rollback()
    })
  })
})

describe('auth audit: svc_log_auth_event / log_auth_event', () => {
  const FNS = [
    `select public.svc_log_auth_event($1, $2, $2, 'SET_LOGIN', '{}'::jsonb)`,
    `select private.log_auth_event($1, $2, $2, 'SET_LOGIN', '{}'::jsonb)`,
    `select public.svc_auth_user_id_by_email('a@b.c')`,
    `select private.auth_user_id_by_email('a@b.c')`,
  ]

  it.each(FNS)('authenticated (admin) chaqira olmaydi: %s', async (sql) => {
    const params = sql.includes('$1') ? [A.id, A.users.admin.profileId] : []
    const r = await asUser(db, A.users.admin.authUid, (tx) => tryQuery(tx, sql, params))
    expect(code(r)).toBe('42501')
  })

  it.each(FNS)('authenticated (super_admin) ham chaqira olmaydi: %s', async (sql) => {
    const params = sql.includes('$1') ? [A.id, A.users.super_admin.profileId] : []
    const r = await asUser(db, A.users.super_admin.authUid, (tx) => tryQuery(tx, sql, params))
    expect(code(r)).toBe('42501')
  })

  it.each(FNS)('anon chaqira olmaydi: %s', async (sql) => {
    const params = sql.includes('$1') ? [A.id, A.users.admin.profileId] : []
    const r = await asAnon(db, (tx) => tryQuery(tx, sql, params))
    expect(code(r)).toBe('42501')
  })

  it('execute grantlari: faqat service_role', async () => {
    const r = await rows<{ fn: string; anon: boolean; auth: boolean; svc: boolean; pub: boolean }>(
      db,
      `select p.oid::regprocedure::text as fn,
              has_function_privilege('anon', p.oid, 'execute') as anon,
              has_function_privilege('authenticated', p.oid, 'execute') as auth,
              has_function_privilege('service_role', p.oid, 'execute') as svc,
              exists (select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                       where a.grantee = 0 and a.privilege_type = 'EXECUTE') as pub
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where (n.nspname, p.proname) in (('public', 'svc_log_auth_event'), ('public', 'svc_auth_user_id_by_email'),
                                         ('private', 'log_auth_event'), ('private', 'auth_user_id_by_email'))
        order by 1`,
    )
    expect(r).toHaveLength(4)
    for (const x of r) expect({ fn: x.fn, anon: x.anon, auth: x.auth, svc: x.svc, pub: x.pub }).toEqual({
      fn: x.fn,
      anon: false,
      auth: false,
      svc: true,
      pub: false,
    })
  })

  it('service_role yozadi: table_name auth, record_id maqsad, device tizim, parol olib tashlanadi', async () => {
    const r = await asService(db, async (tx) => {
      const id = await scalar<number>(
        tx,
        `select public.svc_log_auth_event($1, $2, $3, 'SET_LOGIN', $4::jsonb)`,
        [
          A.id,
          A.users.admin.profileId,
          A.users.prorab.profileId,
          JSON.stringify({ login: '+998901234567', created: true, password: 'Sir-12345678', new_password: 'x' }),
        ],
      )
      return one(
        tx,
        `select company_id, table_name, record_id, action, new_data, actor_profile_id, actor_auth_uid, device
           from public.audit_log where id = $1`,
        [id],
      )
    })
    expect(r).toEqual({
      company_id: A.id,
      table_name: 'auth',
      record_id: A.users.prorab.profileId,
      action: 'SET_LOGIN',
      new_data: { login: '+998901234567', created: true },
      actor_profile_id: A.users.admin.profileId,
      actor_auth_uid: null,
      device: 'tizim',
    })
  })

  it.each(['TG_LINK', 'TG_AUTH_USER_CREATED'])('%s qabul qilinadi', async (action) => {
    const r = await asService(db, (tx) =>
      tryQuery(tx, `select public.svc_log_auth_event($1, $2, $2, $3, '{}'::jsonb)`, [
        B.id,
        B.users.prorab.profileId,
        action,
      ]),
    )
    expect(code(r)).toBe('OK')
  })

  it('noma`lum action → 22023; company_id null → 22004', async () => {
    const r = await asService(db, async (tx) => [
      code(
        await tryQuery(tx, `select public.svc_log_auth_event($1, null, $2, 'INSERT', '{}'::jsonb)`, [
          A.id,
          A.users.prorab.profileId,
        ]),
      ),
      code(
        await tryQuery(tx, `select public.svc_log_auth_event(null, null, $1, 'SET_LOGIN', '{}'::jsonb)`, [
          A.users.prorab.profileId,
        ]),
      ),
    ])
    expect(r).toEqual(['22023', '22004'])
  })

  it('service_role audit_log ga to`g`ridan-to`g`ri yoza olmaydi (o`zgarmagan)', async () => {
    const r = await asService(db, (tx) =>
      tryQuery(
        tx,
        `insert into public.audit_log (company_id, table_name, record_id, action) values ($1, 'auth', $1, 'SET_LOGIN')`,
        [A.id],
      ),
    )
    expect(code(r)).toBe('42501')
  })

  it('admin o`z firmasidagi auth hodisasini ko`radi, boshqa firmanikini yo`q', async () => {
    await asService(
      db,
      (tx) =>
        tx.query(`select public.svc_log_auth_event($1, null, $2, 'TG_LINK', '{"telegram_user_id": 1}'::jsonb)`, [
          B.id,
          B.users.haydovchi.profileId,
        ]),
      { commit: true },
    )
    const [mine, other] = await asUser(db, A.users.admin.authUid, async (tx) => [
      await scalar<number>(tx, `select count(*)::int from public.audit_log where table_name = 'auth' and company_id = $1`, [A.id]),
      await scalar<number>(tx, `select count(*)::int from public.audit_log where table_name = 'auth' and company_id = $1`, [B.id]),
    ])
    expect(mine).toBeGreaterThanOrEqual(0)
    expect(other).toBe(0)
    const bAdmin = await asUser(db, B.users.admin.authUid, (tx) =>
      scalar<number>(tx, `select count(*)::int from public.audit_log where table_name = 'auth' and record_id = $1`, [
        B.users.haydovchi.profileId,
      ]),
    )
    expect(bAdmin).toBe(1)
  })
})

describe('svc_auth_user_id_by_email', () => {
  it('email bo`yicha (katta-kichik harf, bo`sh joy farqsiz); yo`q bo`lsa null', async () => {
    const id = await createAuthUser(db, { email: 'tg777@tg.terron-build.invalid' })
    const r = await asService(db, async (tx) => [
      await scalar(tx, `select public.svc_auth_user_id_by_email($1)`, ['  TG777@tg.Terron-Build.INVALID ']),
      await scalar(tx, `select public.svc_auth_user_id_by_email($1)`, ['nobody@tg.terron-build.invalid']),
    ])
    expect(r).toEqual([id, null])
  })
})
