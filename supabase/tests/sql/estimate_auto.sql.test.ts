// 20261104000001_estimate_auto.sql: material_aliases.lang 'code',
// estimate_create_materials(), remember_estimate_aliases().
import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { asAnon, asUser, createDb, one, rows, scalar, type Db, type Queryable, type TestUser } from './_harness'
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

/** Xato: `code|hint|message|detail` yoki `OK`. */
async function errInfo(tx: Queryable, sql: string, params: unknown[] = []): Promise<string> {
  await tx.exec('savepoint ea_msg')
  try {
    await tx.query(sql, params)
    await tx.exec('release savepoint ea_msg')
    return 'OK'
  } catch (e) {
    await tx.exec('rollback to savepoint ea_msg')
    const err = e as { code?: string; hint?: string; message?: string; detail?: string }
    return `${err.code ?? '?'}|${err.hint ?? ''}|${err.message ?? ''}|${err.detail ?? ''}`
  }
}

interface Created {
  key: string
  material_id: string
  created: boolean
}

interface MatItem {
  key?: unknown
  name?: unknown
  base_unit?: unknown
  category?: unknown
  code?: unknown
  alias?: unknown
  units?: unknown
}

const CREATE_SQL = `select public.estimate_create_materials($1::jsonb) as r`
const REMEMBER_SQL = `select public.remember_estimate_aliases($1::jsonb) as n`

async function create(tx: Queryable, items: MatItem[]): Promise<Created[]> {
  const r = await one<{ r: Created[] }>(tx, CREATE_SQL, [JSON.stringify(items)])
  return r.r
}
const errCreate = (tx: Queryable, items: unknown): Promise<string> => errInfo(tx, CREATE_SQL, [JSON.stringify(items)])

async function remember(tx: Queryable, items: unknown[]): Promise<number> {
  return scalar<number>(tx, REMEMBER_SQL, [JSON.stringify(items)])
}
const errRemember = (tx: Queryable, items: unknown): Promise<string> =>
  errInfo(tx, REMEMBER_SQL, [JSON.stringify(items)])

let seq = 0
const uniq = (p: string): string => `${p} ${++seq}-${Math.random().toString(36).slice(2, 7)}`

const admin = (): TestUser => A.users.admin

function aliasesOf(tx: Queryable, material: string): Promise<{ alias: string; lang: string }[]> {
  return rows(
    tx,
    `select alias, lang from public.material_aliases where material_id = $1 and deleted_at is null order by lang, alias`,
    [material],
  )
}

function unitsOf(tx: Queryable, material: string): Promise<{ unit: string; factor: string; variant: string | null }[]> {
  return rows(
    tx,
    `select mu.unit, mu.factor::text as factor, mu.variant from public.material_units mu
      where mu.material_id = $1 and mu.deleted_at is null order by mu.factor, mu.unit, mu.variant nulls first`,
    [material],
  )
}

const countMaterials = (tx: Queryable, company: string): Promise<number> =>
  scalar<number>(tx, `select count(*)::int from public.materials where company_id = $1`, [company])

// ============================================================================
// material_aliases.lang = 'code'
// ============================================================================
describe("material_aliases.lang — 'code'", () => {
  it("'code' ruxsat, boshqa qiymat — 23514", async () => {
    await asUser(db, admin().authUid, async (tx) => {
      const ok = await errInfo(
        tx,
        `insert into public.material_aliases (company_id, material_id, alias, lang, created_by) values ($1, $2, $3, 'code', $4)`,
        [A.id, A.ids.m1, uniq('101-'), admin().profileId],
      )
      expect(ok).toBe('OK')
      const bad = await errInfo(
        tx,
        `insert into public.material_aliases (company_id, material_id, alias, lang, created_by) values ($1, $2, $3, 'en', $4)`,
        [A.id, A.ids.m1, uniq('x'), admin().profileId],
      )
      expect(bad.split('|')[0]).toBe('23514')
    })
  })
})

// ============================================================================
// estimate_create_materials
// ============================================================================
describe('estimate_create_materials — ruxsat', () => {
  it('admin va super_admin — OK; boshqa rollar — 42501 estimate_materials_forbidden', async () => {
    for (const role of ['admin', 'super_admin'] as const) {
      const r = await asUser(db, A.users[role].authUid, (tx) =>
        create(tx, [{ key: 'k', name: uniq('Mat'), base_unit: 'kg' }]),
      )
      expect(r).toHaveLength(1)
      expect(r[0]!.created).toBe(true)
    }
    for (const role of ['direktor', 'buxgalter', 'taminotchi', 'prorab', 'omborchi', 'haydovchi', 'tekshiruvchi'] as const) {
      const e = await asUser(db, A.users[role].authUid, (tx) =>
        errCreate(tx, [{ key: 'k', name: uniq('Mat'), base_unit: 'kg' }]),
      )
      expect(e.split('|').slice(0, 2).join('|'), role).toBe('42501|estimate_materials_forbidden')
    }
  })

  it('profilsiz foydalanuvchi — auth_required; anon — execute yo`q', async () => {
    const e = await asUser(db, randomUUID(), (tx) => errCreate(tx, [{ key: 'k', name: 'X', base_unit: 'kg' }]))
    expect(e.split('|').slice(0, 2).join('|')).toBe('42501|auth_required')
    const a = await asAnon(db, (tx) => errCreate(tx, [{ key: 'k', name: 'X', base_unit: 'kg' }]))
    expect(a.split('|')[0]).toBe('42501')
  })

  it('security invoker, search_path bo`sh; anon execute yo`q, authenticated bor', async () => {
    const f = await one<{ definer: boolean; cfg: string[]; anon: boolean; auth: boolean }>(
      db,
      `select p.prosecdef as definer, p.proconfig as cfg,
              has_function_privilege('anon', p.oid, 'execute') as anon,
              has_function_privilege('authenticated', p.oid, 'execute') as auth
         from pg_proc p where p.oid = 'public.estimate_create_materials(jsonb)'::regprocedure`,
    )
    expect(f).toEqual({ definer: false, cfg: ['search_path=""'], anon: false, auth: true })
  })
})

describe('estimate_create_materials — yaratish', () => {
  it('material, asosiy birlik (trigger), qo`shimcha birliklar, shifr va ru alias', async () => {
    await asUser(db, admin().authUid, async (tx) => {
      const name = uniq('Kabel VVG')
      const code = uniq('С101-')
      const ru = uniq('Кабель ВВГ')
      const r = await create(tx, [
        {
          key: 'row-7',
          name,
          base_unit: 'm',
          category: 'elektr',
          code,
          alias: ru,
          units: [
            { unit: 'km', factor: '1000', variant: null },
            { unit: 'baraban', factor: 250.5, variant: 'katta' },
            { unit: 'm', factor: 1 }, // asosiy birlik takrori — o'tkaziladi
            { unit: 'KM', factor: '999' }, // norm_name bo'yicha takror — o'tkaziladi
          ],
        },
      ])
      expect(r).toEqual([{ key: 'row-7', material_id: expect.any(String), created: true }])
      const id = r[0]!.material_id
      const m = await one(tx, `select name, base_unit, category, company_id, created_by from public.materials where id = $1`, [id])
      expect(m).toEqual({ name, base_unit: 'm', category: 'elektr', company_id: A.id, created_by: admin().profileId })
      expect(await unitsOf(tx, id)).toEqual([
        { unit: 'm', factor: '1.0000000000', variant: null },
        { unit: 'baraban', factor: '250.5000000000', variant: 'katta' },
        { unit: 'km', factor: '1000.0000000000', variant: null },
      ])
      expect(await aliasesOf(tx, id)).toEqual([
        { alias: code, lang: 'code' },
        { alias: ru, lang: 'ru' },
      ])
    })
  })

  it('kirish tartibida natija; alias nom bilan bir xil (katta-kichik harf) — saqlanmaydi', async () => {
    await asUser(db, admin().authUid, async (tx) => {
      const n1 = uniq('Bolt')
      const n2 = uniq('Gayka')
      const r = await create(tx, [
        { key: 'b', name: n1, base_unit: 'dona', alias: n1.toUpperCase() },
        { key: 'a', name: n2, base_unit: 'dona' },
      ])
      expect(r.map((x) => x.key)).toEqual(['b', 'a'])
      expect(r.every((x) => x.created)).toBe(true)
      expect(await aliasesOf(tx, r[0]!.material_id)).toEqual([])
    })
  })

  it('idempotent: qayta chaqiruv — o`sha id lar, created = false, dublikat yo`q', async () => {
    await asUser(db, admin().authUid, async (tx) => {
      const items: MatItem[] = [
        { key: '1', name: uniq('Profil'), base_unit: 'm', code: uniq('K-'), units: [{ unit: 'dona', factor: 3 }] },
        { key: '2', name: uniq('Shpaklyovka'), base_unit: 'kg', alias: uniq('Шпаклевка') },
      ]
      const first = await create(tx, items)
      const before = await countMaterials(tx, A.id)
      const aliasesBefore = await scalar<number>(tx, `select count(*)::int from public.material_aliases where company_id = $1`, [A.id])
      const second = await create(tx, items)
      expect(second).toEqual(first.map((x) => ({ ...x, created: false })))
      expect(await countMaterials(tx, A.id)).toBe(before)
      expect(await scalar<number>(tx, `select count(*)::int from public.material_aliases where company_id = $1`, [A.id])).toBe(
        aliasesBefore,
      )
    })
  })

  it('bir chaqiruvda takroriy nom — ikkinchisi birinchisini qaytaradi', async () => {
    await asUser(db, admin().authUid, async (tx) => {
      const n = uniq('Mix')
      const r = await create(tx, [
        { key: 'x', name: n, base_unit: 'kg' },
        { key: 'y', name: `  ${n.toUpperCase()}  `, base_unit: 'kg' },
      ])
      expect(r[0]!.created).toBe(true)
      expect(r[1]).toEqual({ key: 'y', material_id: r[0]!.material_id, created: false })
    })
  })
})

describe('estimate_create_materials — mavjudni topish', () => {
  it('shifr alias bo`yicha (nom boshqa bo`lsa ham)', async () => {
    await asUser(db, admin().authUid, async (tx) => {
      const code = uniq('101-0123')
      const [c] = await create(tx, [{ key: '1', name: uniq('Asl nom'), base_unit: 'kg', code }])
      const [r] = await create(tx, [{ key: '2', name: uniq('Butunlay boshqa nom'), base_unit: 't', code: `  ${code.toLowerCase()} ` }])
      expect(r).toEqual({ key: '2', material_id: c!.material_id, created: false })
    })
  })

  it('nom bo`yicha (norm_name) — shifr alias qo`shiladi, birliklar qo`shilmaydi', async () => {
    await asUser(db, admin().authUid, async (tx) => {
      const code = uniq('C-')
      const [r] = await create(tx, [
        { key: 'k', name: '  a   SEMENT ', base_unit: 'kg', code, units: [{ unit: 'vagon', factor: 60000 }] },
      ])
      expect(r).toEqual({ key: 'k', material_id: A.ids.m1, created: false })
      expect(await aliasesOf(tx, A.ids.m1!)).toContainEqual({ alias: code, lang: 'code' })
      expect((await unitsOf(tx, A.ids.m1!)).map((u) => u.unit)).not.toContain('vagon')
    })
  })

  it('alias bo`yicha: nom = mavjud alias; muqobil nom = mavjud alias yoki material nomi', async () => {
    await asUser(db, admin().authUid, async (tx) => {
      // fixture: m1 alias "A Цемент"
      const [r1] = await create(tx, [{ key: '1', name: 'a цемент', base_unit: 'kg' }])
      expect(r1).toEqual({ key: '1', material_id: A.ids.m1, created: false })
      const [r2] = await create(tx, [{ key: '2', name: uniq('Yangi nom'), base_unit: 'kg', alias: 'A ЦЕМЕНТ' }])
      expect(r2).toEqual({ key: '2', material_id: A.ids.m1, created: false })
      const [r3] = await create(tx, [{ key: '3', name: uniq('Yana nom'), base_unit: 'm³', alias: 'A qum' }])
      expect(r3).toEqual({ key: '3', material_id: A.ids.m2, created: false })
    })
  })

  it('o`chirilgan material topilmaydi — yangisi yaratiladi', async () => {
    await asUser(db, admin().authUid, async (tx) => {
      const n = uniq('Eski')
      const [c] = await create(tx, [{ key: '1', name: n, base_unit: 'kg' }])
      await tx.query(`update public.materials set deleted_at = now() where id = $1`, [c!.material_id])
      const [r] = await create(tx, [{ key: '2', name: n, base_unit: 'kg' }])
      expect(r!.created).toBe(true)
      expect(r!.material_id).not.toBe(c!.material_id)
    })
  })

  it('alias o`g`irlanmaydi: band shifr / muqobil nom — jimgina o`tkaziladi', async () => {
    await asUser(db, admin().authUid, async (tx) => {
      // shifr = m2 nomi ("A qum") — band; shifr = boshqa materialning ru alias'i — band
      const [r1] = await create(tx, [{ key: '1', name: uniq('Toza material'), base_unit: 'kg', code: 'A qum' }])
      expect(r1!.created).toBe(true)
      expect(await aliasesOf(tx, r1!.material_id)).toEqual([])
      const ru = uniq('Ruscha')
      const [owner] = await create(tx, [{ key: 'o', name: uniq('Egasi'), base_unit: 'kg', alias: ru }])
      const [r2] = await create(tx, [{ key: '2', name: uniq('Boshqa'), base_unit: 'kg', code: ru }])
      expect(r2!.created).toBe(true)
      expect(await aliasesOf(tx, r2!.material_id)).toEqual([])
      expect(await aliasesOf(tx, owner!.material_id)).toEqual([{ alias: ru, lang: 'ru' }])
      // m1 ning alias'i joyida
      expect(await aliasesOf(tx, A.ids.m1!)).toContainEqual({ alias: 'A Цемент', lang: 'ru' })
    })
  })
})

describe('estimate_create_materials — firma izolyatsiyasi', () => {
  it('boshqa firma materiali / alias / shifri ko`rinmaydi — o`z firmasida yangisi yaratiladi', async () => {
    const code = uniq('B-CODE')
    await asUser(
      db,
      B.users.admin.authUid,
      (tx) => create(tx, [{ key: '1', name: 'B maxsus', base_unit: 'kg', code }]),
      { commit: true },
    )
    await asUser(db, admin().authUid, async (tx) => {
      const r = await create(tx, [
        { key: '1', name: 'B sement', base_unit: 'kg' },
        { key: '2', name: 'B Цемент', base_unit: 'kg' },
        { key: '3', name: uniq('Shifrli'), base_unit: 'kg', code },
      ])
      expect(r.every((x) => x.created)).toBe(true)
      const companies = await rows<{ company_id: string }>(
        tx,
        `select company_id from public.materials where id = any ($1::uuid[])`,
        [r.map((x) => x.material_id)],
      )
      expect(companies.every((x) => x.company_id === A.id)).toBe(true)
      // shifr A firmasida bo'sh — A materialiga qo'shildi
      expect(await aliasesOf(tx, r[2]!.material_id)).toEqual([{ alias: code, lang: 'code' }])
    })
  })
})

describe('estimate_create_materials — tekshiruv', () => {
  it('xato qator — 22023 estimate_materials_invalid, `Qator n: ...`, detail = n; hech narsa yozilmaydi', async () => {
    await asUser(db, admin().authUid, async (tx) => {
      const before = await countMaterials(tx, A.id)
      const good = uniq('Yaxshi')
      const e = await errCreate(tx, [
        { key: '1', name: good, base_unit: 'kg' },
        { key: '2', name: uniq('Yomon'), base_unit: 'kg', units: [{ unit: 'qop', factor: '0' }] },
      ])
      expect(e).toBe(
        '22023|estimate_materials_invalid|Qator 2: «qop» koeffitsienti 0 dan katta bo\'lishi kerak|2',
      )
      expect(await countMaterials(tx, A.id)).toBe(before)
      expect(await scalar<number>(tx, `select count(*)::int from public.materials where name = $1`, [good])).toBe(0)
    })
  })

  it('sabablar: format, key, nom, birlik, uzunliklar, birliklar', async () => {
    const cases: [unknown, string][] = [
      ['x', "qator noto'g'ri formatda"],
      [{ name: 'A', base_unit: 'kg' }, "kalit (key) ko'rsatilmagan"],
      [{ key: '  ', name: 'A', base_unit: 'kg' }, "kalit (key) ko'rsatilmagan"],
      [{ key: { a: 1 }, name: 'A', base_unit: 'kg' }, "kalit (key) ko'rsatilmagan"],
      [{ key: 'k', name: '  ', base_unit: 'kg' }, "nomi bo'sh"],
      [{ key: 'k', name: 'x'.repeat(201), base_unit: 'kg' }, 'nomi juda uzun (200 belgigacha)'],
      [{ key: 'k', name: 'A' }, "asosiy birlik ko'rsatilmagan"],
      [{ key: 'k', name: 'A', base_unit: 'x'.repeat(51) }, 'asosiy birlik juda uzun (50 belgigacha)'],
      [{ key: 'k', name: 'A', base_unit: 'kg', code: 'x'.repeat(101) }, 'shifr juda uzun (100 belgigacha)'],
      [{ key: 'k', name: 'A', base_unit: 'kg', alias: 'x'.repeat(201) }, 'muqobil nom juda uzun (200 belgigacha)'],
      [{ key: 'k', name: 'A', base_unit: 'kg', units: {} }, "birliklar ro'yxat bo'lishi kerak"],
      [{ key: 'k', name: 'A', base_unit: 'kg', units: [1] }, "birlik noto'g'ri formatda"],
      [{ key: 'k', name: 'A', base_unit: 'kg', units: [{ factor: 2 }] }, "birlik nomi bo'sh"],
      [{ key: 'k', name: 'A', base_unit: 'kg', units: [{ unit: 'qop' }] }, "«qop» koeffitsienti ko'rsatilmagan"],
      [{ key: 'k', name: 'A', base_unit: 'kg', units: [{ unit: 'qop', factor: 'abc' }] }, '«qop» koeffitsienti raqam emas'],
      [{ key: 'k', name: 'A', base_unit: 'kg', units: [{ unit: 'qop', factor: -1 }] }, "«qop» koeffitsienti 0 dan katta bo'lishi kerak"],
      [{ key: 'k', name: 'A', base_unit: 'kg', units: [{ unit: 'qop', factor: '1e10' }] }, '«qop» koeffitsienti juda katta'],
    ]
    await asUser(db, admin().authUid, async (tx) => {
      for (const [item, reason] of cases) {
        const e = await errCreate(tx, [item])
        expect(e, JSON.stringify(item)).toBe(`22023|estimate_materials_invalid|Qator 1: ${reason}|1`)
      }
    })
  })

  it('massiv emas / bo`sh / 2000 dan ko`p — estimate_materials_invalid; 2000 tasi tekshiruvdan o`tadi', async () => {
    await asUser(db, admin().authUid, async (tx) => {
      for (const bad of [{}, [], null]) {
        expect((await errCreate(tx, bad)).split('|').slice(0, 2).join('|')).toBe('22023|estimate_materials_invalid')
      }
      const many = (n: number): MatItem[] => Array.from({ length: n }, (_, i) => ({ key: `${i}`, name: `Limit ${i}`, base_unit: 'kg' }))
      const over = await errCreate(tx, many(2001))
      expect(over).toMatch(/^22023\|estimate_materials_invalid\|Materiallar juda ko'p: 2001 \(ko'pi bilan 2000\)/)
      // 2000 ta — limitdan o'tadi; oxirgi qator xato → tekshiruv butun ro'yxatni ko'radi, hech narsa yozilmaydi
      const items = many(2000)
      items[1999] = { key: 'last', name: '', base_unit: 'kg' }
      const before = await countMaterials(tx, A.id)
      expect(await errCreate(tx, items)).toBe("22023|estimate_materials_invalid|Qator 2000: nomi bo'sh|2000")
      expect(await countMaterials(tx, A.id)).toBe(before)
    })
  })

  it('audit: yaratilgan material, birlik va alias — actor admin, device veb', async () => {
    await asUser(db, admin().authUid, async (tx) => {
      const [r] = await create(tx, [{ key: '1', name: uniq('Audit'), base_unit: 'kg', code: uniq('AU-') }])
      const a = await rows<{ table_name: string; actor_profile_id: string; device: string }>(
        tx,
        `select table_name, actor_profile_id, device from public.audit_log
          where (table_name = 'materials' and record_id = $1)
             or (table_name in ('material_units', 'material_aliases') and new_data ->> 'material_id' = $1::text)
          order by table_name`,
        [r!.material_id],
      )
      expect(a.map((x) => x.table_name)).toEqual(['material_aliases', 'material_units', 'materials'])
      expect(a.every((x) => x.actor_profile_id === admin().profileId && x.device === 'veb')).toBe(true)
    })
  })
})

// ============================================================================
// remember_estimate_aliases
// ============================================================================
describe('remember_estimate_aliases', () => {
  it('ruxsat: admin, buxgalter, super_admin — OK; boshqalar — estimate_import_forbidden; profilsiz — auth_required', async () => {
    for (const role of ['admin', 'buxgalter', 'super_admin'] as const) {
      const n = await asUser(db, A.users[role].authUid, (tx) =>
        remember(tx, [{ material_id: A.ids.m2, code: uniq('R-'), name: uniq('Песок мытый') }]),
      )
      expect(n, role).toBe(2)
    }
    for (const role of ['direktor', 'taminotchi', 'prorab', 'omborchi', 'haydovchi', 'tekshiruvchi'] as const) {
      const e = await asUser(db, A.users[role].authUid, (tx) => errRemember(tx, [{ material_id: A.ids.m2, code: 'x' }]))
      expect(e.split('|').slice(0, 2).join('|'), role).toBe('42501|estimate_import_forbidden')
    }
    const e = await asUser(db, randomUUID(), (tx) => errRemember(tx, [{ material_id: A.ids.m2, code: 'x' }]))
    expect(e.split('|').slice(0, 2).join('|')).toBe('42501|auth_required')
    const a = await asAnon(db, (tx) => errRemember(tx, [{ material_id: A.ids.m2, code: 'x' }]))
    expect(a.split('|')[0]).toBe('42501')
  })

  it('security definer, search_path bo`sh; anon execute yo`q, authenticated bor', async () => {
    const f = await one<{ definer: boolean; cfg: string[]; anon: boolean; auth: boolean }>(
      db,
      `select p.prosecdef as definer, p.proconfig as cfg,
              has_function_privilege('anon', p.oid, 'execute') as anon,
              has_function_privilege('authenticated', p.oid, 'execute') as auth
         from pg_proc p where p.oid = 'public.remember_estimate_aliases(jsonb)'::regprocedure`,
    )
    expect(f).toEqual({ definer: true, cfg: ['search_path=""'], anon: false, auth: true })
  })

  it('buxgalter: code va ru alias yoziladi (created_by = buxgalter); audit actor — buxgalter', async () => {
    const bux = A.users.buxgalter
    const code = uniq('ФССЦ-')
    const name = uniq('Песок речной')
    const ids = await asUser(
      db,
      bux.authUid,
      async (tx) => {
        expect(await remember(tx, [{ material_id: A.ids.m2, code, name }])).toBe(2)
        const r = await rows<{ id: string; alias: string; lang: string; created_by: string }>(
          tx,
          `select id, alias, lang, created_by from public.material_aliases where alias = any ($1) order by lang`,
          [[code, name]],
        )
        expect(r.map((x) => [x.alias, x.lang, x.created_by])).toEqual([
          [code, 'code', bux.profileId],
          [name, 'ru', bux.profileId],
        ])
        return r.map((x) => x.id)
      },
      { commit: true },
    )
    // audit_log — superuser sifatida (buxgalter RLS'idan qat'i nazar)
    const a = await rows<{ actor_profile_id: string; actor_auth_uid: string; device: string; action: string }>(
      db,
      `select actor_profile_id, actor_auth_uid, device, action from public.audit_log
        where table_name = 'material_aliases' and record_id = any ($1::uuid[])`,
      [ids],
    )
    expect(a).toHaveLength(2)
    for (const x of a) {
      expect(x).toEqual({ actor_profile_id: bux.profileId, actor_auth_uid: bux.authUid, device: 'veb', action: 'INSERT' })
    }
  })

  it('o`g`irlamaydi / ustidan yozmaydi: band alias, material nomi, o`z nomi — o`tkaziladi; takror — 0', async () => {
    await asUser(db, A.users.buxgalter.authUid, async (tx) => {
      const n = await remember(tx, [
        { material_id: A.ids.m2, name: 'A Цемент' }, // m1 alias'i
        { material_id: A.ids.m2, code: 'A sement' }, // m1 nomi
        { material_id: A.ids.m2, name: 'a QUM' }, // o'z nomi
        { material_id: A.ids.m2 }, // bo'sh
      ])
      expect(n).toBe(0)
      expect(await scalar<string>(tx, `select material_id from public.material_aliases where alias = 'A Цемент' and deleted_at is null`)).toBe(
        A.ids.m1,
      )
      const code = uniq('DUP-')
      expect(await remember(tx, [{ material_id: A.ids.m1, code }, { material_id: A.ids.m2, code }])).toBe(1)
      expect(await remember(tx, [{ material_id: A.ids.m1, code }])).toBe(0)
      expect(await scalar<string>(tx, `select material_id from public.material_aliases where alias = $1`, [code])).toBe(A.ids.m1)
    })
  })

  it('boshqa firma materiali / o`chirilgan / noto`g`ri id — 22023 estimate_aliases_invalid; hech narsa yozilmaydi', async () => {
    await asUser(db, A.users.admin.authUid, async (tx) => {
      const code = uniq('X-')
      const e = await errRemember(tx, [
        { material_id: A.ids.m1, code },
        { material_id: B.ids.m1, code: uniq('Y-') },
      ])
      expect(e).toBe("22023|estimate_aliases_invalid|Qator 2: material topilmadi yoki o'chirilgan|2")
      expect(await scalar<number>(tx, `select count(*)::int from public.material_aliases where alias = $1`, [code])).toBe(0)

      const [c] = await create(tx, [{ key: '1', name: uniq('Del'), base_unit: 'kg' }])
      await tx.query(`update public.materials set deleted_at = now() where id = $1`, [c!.material_id])
      expect(await errRemember(tx, [{ material_id: c!.material_id, code: 'z' }])).toBe(
        "22023|estimate_aliases_invalid|Qator 1: material topilmadi yoki o'chirilgan|1",
      )
      expect(await errRemember(tx, [{ material_id: 'not-a-uuid' }])).toBe(
        "22023|estimate_aliases_invalid|Qator 1: material topilmadi yoki o'chirilgan|1",
      )
      expect(await errRemember(tx, [{ code: 'z' }])).toBe("22023|estimate_aliases_invalid|Qator 1: material ko'rsatilmagan|1")
      expect(await errRemember(tx, ['x'])).toBe("22023|estimate_aliases_invalid|Qator 1: qator noto'g'ri formatda|1")
      expect(await errRemember(tx, [{ material_id: A.ids.m1, code: 'x'.repeat(101) }])).toBe(
        '22023|estimate_aliases_invalid|Qator 1: shifr juda uzun (100 belgigacha)|1',
      )
    })
  })

  it('B firma alias`i A firmada to`sqinlik qilmaydi (firma bo`yicha unikal)', async () => {
    const code = uniq('SHARED-')
    await asUser(db, B.users.admin.authUid, (tx) => remember(tx, [{ material_id: B.ids.m1, code }]), { commit: true })
    const n = await asUser(db, A.users.buxgalter.authUid, (tx) => remember(tx, [{ material_id: A.ids.m1, code }]))
    expect(n).toBe(1)
  })

  it('bo`sh massiv — 0; massiv emas / 5000 dan ko`p — estimate_aliases_invalid', async () => {
    await asUser(db, A.users.buxgalter.authUid, async (tx) => {
      expect(await remember(tx, [])).toBe(0)
      expect((await errRemember(tx, { a: 1 })).split('|').slice(0, 2).join('|')).toBe('22023|estimate_aliases_invalid')
      const many = Array.from({ length: 5001 }, () => ({ material_id: A.ids.m1 }))
      expect(await errRemember(tx, many)).toMatch(/^22023\|estimate_aliases_invalid\|Qatorlar juda ko'p: 5001/)
    })
  })

  it('remember dan keyin estimate_create_materials shifr bo`yicha topadi', async () => {
    await asUser(db, A.users.admin.authUid, async (tx) => {
      const code = uniq('LRV-')
      expect(await remember(tx, [{ material_id: A.ids.m2, code }])).toBe(1)
      const [r] = await create(tx, [{ key: 'q', name: uniq('Песок любой'), base_unit: 'm³', code }])
      expect(r).toEqual({ key: 'q', material_id: A.ids.m2, created: false })
    })
  })
})
