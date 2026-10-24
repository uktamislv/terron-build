// Rol oshirish va kirish huquqisiz holatlar: super_admin'ga ko'tarilish,
// o'z rolini/firmasini o'zgartirish, created_by soxtalashtirish, nofaol /
// o'chirilgan / profilsiz foydalanuvchi, anon, private funksiyalar.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  asAnon,
  asService,
  asUser,
  createAuthUser,
  createDb,
  createUser,
  scalar,
  tryQuery,
  type Db,
  type TestUser,
} from './_harness'
import {
  ALL_RELATIONS,
  BUSINESS_TABLES,
  buildTwoCompanies,
  insertCase,
  ROLES,
  tryExec,
  type TwoCompanies,
} from './_fixtures'

let db: Db
let F: TwoCompanies
let inactiveAdmin: TestUser
let deletedAdmin: TestUser
let orphanUid: string

beforeAll(async () => {
  db = await createDb()
  F = await buildTwoCompanies(db)
  inactiveAdmin = await createUser(db, {
    companyId: F.A.id,
    role: 'admin',
    phone: '+998970000001',
    extra: { is_active: false },
  })
  deletedAdmin = await createUser(db, {
    companyId: F.A.id,
    role: 'admin',
    phone: '+998970000002',
    extra: { deleted_at: new Date().toISOString() },
  })
  orphanUid = await createAuthUser(db)
})
afterAll(async () => {
  await db?.close()
})

describe('super_admin ga ko`tarilish', () => {
  it('admin o`zini super_admin qila olmaydi', async () => {
    const me = F.A.users.admin
    const r = await asUser(db, me.authUid, (tx) =>
      tryExec(tx, `update public.profiles set role = 'super_admin' where id = $1`, [me.profileId]),
    )
    expect(r.ok ? r.affected : r.code).toBe('42501')
  })

  it('admin boshqa profilni super_admin qila olmaydi', async () => {
    const r = await asUser(db, F.A.users.admin.authUid, (tx) =>
      tryExec(tx, `update public.profiles set role = 'super_admin' where id = $1`, [F.A.users.direktor.profileId]),
    )
    expect(r.ok ? r.affected : r.code).toBe('42501')
  })

  it('admin super_admin rolli profil yarata olmaydi', async () => {
    const me = F.A.users.admin
    const r = await asUser(db, me.authUid, (tx) =>
      tryQuery(
        tx,
        `insert into public.profiles (company_id, role, full_name, phone, created_by)
         values ($1, 'super_admin', 'X', '+998971111111', $2)`,
        [F.A.id, me.profileId],
      ),
    )
    expect(r.ok ? 'OK' : r.code).toBe('42501')
  })

  it('admin super_admin profilini o`zgartira olmaydi (0 qator)', async () => {
    const r = await asUser(db, F.A.users.admin.authUid, (tx) =>
      tryExec(tx, `update public.profiles set full_name = 'X' where id = $1`, [F.A.users.super_admin.profileId]),
    )
    expect(r.ok ? r.affected : r.code).toBe(0)
  })

  it('admin profilni boshqa firmaga ko`chira olmaydi (trigger)', async () => {
    const r = await asUser(db, F.A.users.admin.authUid, (tx) =>
      tryExec(tx, `update public.profiles set company_id = $2 where id = $1`, [F.A.users.prorab.profileId, F.B.id]),
    )
    expect(r.ok ? r.affected : r.code).toBe('42501')
  })

  it('admin companies.is_active / deleted_at ni o`zgartira olmaydi', async () => {
    const r = await asUser(db, F.A.users.admin.authUid, async (tx) => {
      const a = await tryExec(tx, `update public.companies set is_active = false where id = $1`, [F.A.id])
      const b = await tryExec(tx, `update public.companies set deleted_at = now() where id = $1`, [F.A.id])
      const c = await tryExec(tx, `update public.companies set price_deviation_pct = 10 where id = $1`, [F.A.id])
      return [a.ok ? a.affected : a.code, b.ok ? b.affected : b.code, c.ok ? c.affected : c.code]
    })
    expect(r).toEqual(['42501', '42501', 1])
  })
})

describe('oddiy foydalanuvchi o`z profilini o`zgartira olmaydi', () => {
  const nonAdmin = ROLES.filter((r) => r !== 'super_admin' && r !== 'admin')
  it.each(nonAdmin)('%s: role, company_id, is_active — 0 qator', async (role) => {
    const me = F.A.users[role]
    const r = await asUser(db, me.authUid, async (tx) => {
      const out: unknown[] = []
      for (const sql of [
        `update public.profiles set role = 'admin' where id = $1`,
        `update public.profiles set role = 'super_admin' where id = $1`,
        `update public.profiles set company_id = '${F.B.id}' where id = $1`,
        `update public.profiles set full_name = 'Men' where id = $1`,
      ]) {
        const x = await tryExec(tx, sql, [me.profileId])
        out.push(x.ok ? x.affected : x.code)
      }
      return out
    })
    // company_id — authenticated uchun ustun darajasida UPDATE grant yo'q → 42501 (RLS'gacha yetmaydi)
    expect(r).toEqual([0, 0, '42501', 0])
  })
})

describe('created_by ni soxtalashtirish', () => {
  it.each(ROLES)('%s: created_by = boshqa profil bilan insert — 42501', async (role) => {
    const me = F.A.users[role]
    const other = role === 'direktor' ? F.A.users.admin.profileId : F.A.users.direktor.profileId
    const r = await asUser(db, me.authUid, async (tx) => {
      const out: Record<string, string | null> = {}
      for (const t of BUSINESS_TABLES) {
        const c = insertCase(t, F.A, me.profileId)
        // created_by — oxirgi `$n` emas, shuning uchun parametr qiymatini almashtiramiz
        const params = c.params.map((p) => (p === me.profileId ? other : p))
        // purchases: buyer_id ham o'sha parametr — ikkalasi ham "boshqa" bo'ladi (baribir rad etilishi kerak)
        const res = await tryQuery(tx, c.sql, params)
        out[t] = res.ok ? 'OK' : res.code
      }
      return out
    })
    expect(r).toEqual(Object.fromEntries(BUSINESS_TABLES.map((t) => [t, '42501'])))
  })

  it('created_by bo`sh qoldirilsa — trigger joriy profilni qo`yadi va insert o`tadi', async () => {
    const me = F.A.users.admin
    const createdBy = await asUser(db, me.authUid, async (tx) => {
      await tx.query(`insert into public.suppliers (company_id, name) values ($1, 'Avto created_by')`, [F.A.id])
      return scalar<string>(tx, `select created_by from public.suppliers where name = 'Avto created_by'`)
    })
    expect(createdBy).toBe(me.profileId)
  })
})

describe('profilsiz, nofaol va o`chirilgan foydalanuvchilar hech narsa ko`rmaydi', () => {
  const who = (): Array<[string, string]> => [
    ['nofaol profil', inactiveAdmin.authUid],
    ['o`chirilgan profil', deletedAdmin.authUid],
    ['auth bor, profil yo`q', orphanUid],
  ]
  for (const label of ['nofaol profil', 'o`chirilgan profil', 'auth bor, profil yo`q']) {
    it(`${label}: barcha jadvallarda 0 qator`, async () => {
      const uid = who().find(([l]) => l === label)![1]
      const r = await asUser(db, uid, async (tx) => {
        const out: Record<string, number> = {}
        for (const t of ALL_RELATIONS) out[t] = await scalar<number>(tx, `select count(*)::int from public.${t}`)
        return out
      })
      expect(r).toEqual(Object.fromEntries(ALL_RELATIONS.map((t) => [t, 0])))
    })

    it(`${label}: hech narsa qo'sha / o'zgartira olmaydi`, async () => {
      const uid = who().find(([l]) => l === label)![1]
      const profileId =
        label === 'nofaol profil' ? inactiveAdmin.profileId : label === 'o`chirilgan profil' ? deletedAdmin.profileId : null
      const r = await asUser(db, uid, async (tx) => {
        let okIns = 0
        let okUpd = 0
        for (const t of BUSINESS_TABLES) {
          const c = insertCase(t, F.A, profileId ?? F.A.users.admin.profileId)
          if ((await tryQuery(tx, c.sql, c.params)).ok) okIns++
          const u = await tryExec(tx, `update public.${t} set updated_at = now()`)
          if (u.ok && u.affected > 0) okUpd++
        }
        return { okIns, okUpd }
      })
      expect(r).toEqual({ okIns: 0, okUpd: 0 })
    })
  }
})

describe('anon', () => {
  it.each([...ALL_RELATIONS])('%s: select — ruxsat yo`q', async (t) => {
    const r = await asAnon(db, (tx) => tryQuery(tx, `select count(*) from public.${t}`))
    expect(r.ok ? 'OK' : r.code).toBe('42501')
  })

  it.each([...BUSINESS_TABLES])('%s: insert / update — ruxsat yo`q', async (t) => {
    const c = insertCase(t, F.A, F.A.users.admin.profileId)
    const r = await asAnon(db, async (tx) => {
      const ins = await tryQuery(tx, c.sql, c.params)
      const upd = await tryExec(tx, `update public.${t} set updated_at = now()`)
      return [ins.ok ? 'OK' : ins.code, upd.ok ? upd.affected : upd.code]
    })
    expect(r).toEqual(['42501', '42501'])
  })

  it.each([
    'private.my_profile_id()',
    'private.my_company_id()',
    'private.my_role()',
    'private.is_super_admin()',
    'private.is_company_wide()',
    `private.has_role('admin')`,
    `private.can_access_company('00000000-0000-0000-0000-000000000000')`,
    `private.can_access_object('00000000-0000-0000-0000-000000000000')`,
    'private.my_object_ids()',
    `private.apply_material_template('00000000-0000-0000-0000-000000000000')`,
  ])('anon %s chaqira olmaydi', async (fn) => {
    const r = await asAnon(db, (tx) => tryQuery(tx, `select ${fn}`))
    expect(r.ok ? 'OK' : r.code).toBe('42501')
  })
})

describe('apply_material_template', () => {
  it.each(['admin', 'super_admin', 'direktor'] as const)('authenticated (%s) chaqira olmaydi', async (role) => {
    const r = await asUser(db, F.A.users[role].authUid, (tx) =>
      tryQuery(tx, `select private.apply_material_template($1)`, [F.A.id]),
    )
    expect(r.ok ? 'OK' : r.code).toBe('42501')
  })

  it.each([
    `private.template_material($1, 'X', 'kg', null)`,
    `private.template_unit($1, $1, 'x', 1)`,
    `private.template_alias($1, $1, 'x')`,
  ])('authenticated %s ichki shablon funksiyasini chaqira olmaydi', async (fn) => {
    const r = await asUser(db, F.A.users.super_admin.authUid, (tx) => tryQuery(tx, `select ${fn}`, [F.A.id]))
    expect(r.ok ? 'OK' : r.code).toBe('42501')
  })

  it('service_role chaqira oladi', async () => {
    const r = await asService(db, (tx) => tryQuery(tx, `select private.apply_material_template($1)`, [F.A.id]))
    expect(r.ok).toBe(true)
  })
})
