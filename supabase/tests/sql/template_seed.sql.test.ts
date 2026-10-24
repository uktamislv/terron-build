// Seed va materiallar shabloni: qo'llanadi, idempotent, kutilgan koeffitsientlar.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { applySeed, asService, createCompany, createDb, one, rows, scalar, tryQuery, type Db } from './_harness'

const SEED_COMPANY = '5eed0000-0000-4000-8000-000000000001'

let db: Db

beforeAll(async () => {
  db = await createDb({ seed: true })
})
afterAll(async () => {
  await db?.close()
})

interface Counts {
  companies: number
  objects: number
  materials: number
  units: number
  aliases: number
}

const counts = (company = SEED_COMPANY): Promise<Counts> =>
  one<Counts>(
    db,
    `select
       (select count(*)::int from public.companies where id = $1) as companies,
       (select count(*)::int from public.objects where company_id = $1) as objects,
       (select count(*)::int from public.materials where company_id = $1) as materials,
       (select count(*)::int from public.material_units where company_id = $1) as units,
       (select count(*)::int from public.material_aliases where company_id = $1) as aliases`,
    [company],
  )

/** Shablondagi birliklar soni: G'isht 5, Sement 3+3, Qum 2, Shag'al 2, Armatura 7, Beton 1, Kafel 3. */
const EXPECTED: Counts = { companies: 1, objects: 3, materials: 8, units: 26, aliases: 9 }

const factor = (material: string, unit: string, variant: string | null = null): Promise<string> =>
  scalar<string>(
    db,
    `select u.factor::text from public.material_units u
       join public.materials m on m.id = u.material_id
      where m.company_id = $1 and m.name = $2 and u.unit = $3
        and coalesce(u.variant, '') = coalesce($4, '') and u.deleted_at is null`,
    [SEED_COMPANY, material, unit, variant],
  )

describe('seed', () => {
  it('namuna firma, 3 obyekt, shablon materiallari', async () => {
    expect(await counts()).toEqual(EXPECTED)
  })

  it('materiallar va asosiy birliklar', async () => {
    const r = await rows<{ name: string; base_unit: string }>(
      db,
      `select name, base_unit from public.materials where company_id = $1 order by name`,
      [SEED_COMPANY],
    )
    expect(Object.fromEntries(r.map((x) => [x.name, x.base_unit]))).toEqual({
      Armatura: 'kg',
      Beton: 'm³',
      "G'isht": 'dona',
      Kafel: 'm²',
      Qum: 'm³',
      'Sement M400': 'kg',
      'Sement M500': 'kg',
      "Shag'al": 'm³',
    })
  })

  it('har material asosiy birligi factor = 1 qator sifatida bor', async () => {
    const missing = await rows(
      db,
      `select m.name from public.materials m
        where m.company_id = $1
          and not exists (select 1 from public.material_units u
                           where u.material_id = m.id and u.unit = m.base_unit and u.factor = 1 and u.variant is null)`,
      [SEED_COMPANY],
    )
    expect(missing).toEqual([])
  })

  it.each([
    ['Sement M400', 'qop', null, 50],
    ['Sement M500', 'qop', null, 50],
    ['Sement M500', 'tonna', null, 1000],
    ['Armatura', 'metr', 'Ø12', 0.888],
    ['Armatura', 'metr', 'Ø8', 0.395],
    ['Armatura', 'tonna', null, 1000],
    ["G'isht", 'm² devor', "bir g'isht · 250 mm", 102],
    ["G'isht", 'm² devor', "yarim g'isht · 120 mm", 51],
    ["G'isht", 'poddon', null, 300],
    ['Qum', 'tonna', null, 0.6667],
    ["Shag'al", 'tonna', null, 0.7143],
    ['Kafel', 'dona', '60×60 sm', 0.36],
  ] as const)('%s: 1 %s (%s) = %s', async (material, unit, variant, expected) => {
    expect(Number(await factor(material, unit, variant))).toBe(expected)
  })

  it('ruscha muqobil nomlar', async () => {
    const r = await rows<{ alias: string; name: string; lang: string }>(
      db,
      `select a.alias, m.name, a.lang from public.material_aliases a join public.materials m on m.id = a.material_id
        where a.company_id = $1 order by a.alias`,
      [SEED_COMPANY],
    )
    expect(r.every((x) => x.lang === 'ru')).toBe(true)
    expect(Object.fromEntries(r.map((x) => [x.alias, x.name]))).toMatchObject({
      'Цемент М500': 'Sement M500',
      'Цемент М400': 'Sement M400',
      Кирпич: "G'isht",
      Плитка: 'Kafel',
      Кафель: 'Kafel',
    })
  })

  it('seed qayta qo`llansa dublikat yo`q', async () => {
    await applySeed(db)
    expect(await counts()).toEqual(EXPECTED)
  })
})

describe('apply_material_template', () => {
  it('ikki marta chaqirilsa — dublikat yo`q (service_role)', async () => {
    await asService(db, (tx) => tx.query(`select private.apply_material_template($1)`, [SEED_COMPANY]), { commit: true })
    await asService(db, (tx) => tx.query(`select private.apply_material_template($1)`, [SEED_COMPANY]), { commit: true })
    expect(await counts()).toEqual(EXPECTED)
  })

  it('o`chirilgan material bo`lsa — yangisi yaratiladi, faol nusxa bitta', async () => {
    const r = await db.transaction(async (tx) => {
      await tx.query(`update public.materials set deleted_at = now() where company_id = $1 and name = 'Beton'`, [SEED_COMPANY])
      await tx.query(`select private.apply_material_template($1)`, [SEED_COMPANY])
      const n = await scalar<number>(
        tx,
        `select count(*)::int from public.materials where company_id = $1 and name = 'Beton' and deleted_at is null`,
        [SEED_COMPANY],
      )
      await tx.rollback()
      return n
    })
    expect(r).toBe(1)
  })

  it('yangi firmaga qo`llanadi; firmalar o`rtasida aralashmaydi', async () => {
    const other = await createCompany(db, { name: 'Ikkinchi firma' })
    await asService(db, (tx) => tx.query(`select private.apply_material_template($1)`, [other]), { commit: true })
    const c = await counts(other)
    expect({ materials: c.materials, units: c.units, aliases: c.aliases }).toEqual({
      materials: EXPECTED.materials,
      units: EXPECTED.units,
      aliases: EXPECTED.aliases,
    })
    expect(await counts()).toEqual(EXPECTED)
    // birliklar o'z firmasining materialiga bog'langan
    const cross = await scalar<number>(
      db,
      `select count(*)::int from public.material_units u join public.materials m on m.id = u.material_id
        where u.company_id <> m.company_id`,
    )
    expect(cross).toBe(0)
  })

  it('mavjud bo`lmagan firma → P0002', async () => {
    const r = await asService(db, (tx) =>
      tryQuery(tx, `select private.apply_material_template('00000000-0000-0000-0000-000000000000')`),
    )
    expect(r.ok ? 'OK' : r.code).toBe('P0002')
  })
})
