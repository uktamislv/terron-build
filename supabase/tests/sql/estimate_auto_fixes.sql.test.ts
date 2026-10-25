// 20261105000001_estimate_auto_fixes.sql:
//   1. remember_estimate_aliases(p_estimate_id, p_items) — smetaga bog'langan
//      (muallif, 24 soat, qator code/name mosligi);
//   2. estimate_items.line_sum — import_estimate, estimate_totals, import_hash;
//   3. estimate_create_materials qulf kaliti = private.lock_catalog_names.
import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { asUser, createDb, one, rows, scalar, type Db, type Queryable, type Tx } from './_harness'
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

async function errInfo(tx: Queryable, sql: string, params: unknown[] = []): Promise<string> {
  await tx.exec('savepoint ef_msg')
  try {
    await tx.query(sql, params)
    await tx.exec('release savepoint ef_msg')
    return 'OK'
  } catch (e) {
    await tx.exec('rollback to savepoint ef_msg')
    const err = e as { code?: string; hint?: string; message?: string; detail?: string }
    return `${err.code ?? '?'}|${err.hint ?? ''}|${err.message ?? ''}|${err.detail ?? ''}`
  }
}
const head2 = (s: string): string => s.split('|').slice(0, 2).join('|')

let seq = 0
const uniq = (p: string): string => `${p} ${++seq}-${Math.random().toString(36).slice(2, 7)}`

const baseUnit = (tx: Queryable, material: string): Promise<string> =>
  scalar<string>(
    tx,
    `select mu.id from public.material_units mu join public.materials m on m.id = mu.material_id
      where mu.material_id = $1 and mu.unit = m.base_unit and mu.factor = 1 and mu.variant is null and mu.deleted_at is null`,
    [material],
  )

interface Row {
  item_type?: 'material' | 'ish'
  material_id?: string
  name: string
  code?: string | null
  qty?: unknown
  unit_price?: unknown
  line_sum?: unknown
}

const IMPORT_SQL = `select public.import_estimate($1, $2, 'Smeta', 'smeta.xlsx', null, $3::jsonb) as id`

async function items(tx: Queryable, r: Row[]): Promise<Record<string, unknown>[]> {
  const out: Record<string, unknown>[] = []
  for (const [i, x] of r.entries()) {
    const type = x.item_type ?? 'material'
    const it: Record<string, unknown> = { item_type: type, name: x.name, qty: x.qty ?? '1', row_number: i + 1 }
    if (type === 'material') {
      it.material_id = x.material_id
      it.unit_id = await baseUnit(tx, x.material_id!)
    }
    if (x.code !== undefined) it.code = x.code
    if (x.unit_price !== undefined) it.unit_price = x.unit_price
    if (x.line_sum !== undefined) it.line_sum = x.line_sum
    out.push(it)
  }
  return out
}

async function importEst(tx: Queryable, r: Row[], obj = A.ids.obj3!, id = randomUUID()): Promise<string> {
  return scalar<string>(tx, IMPORT_SQL, [id, obj, JSON.stringify(await items(tx, r))])
}

const REMEMBER_SQL = `select public.remember_estimate_aliases($1::uuid, $2::jsonb) as n`
const remember = (tx: Queryable, est: string, it: unknown[]): Promise<number> =>
  scalar<number>(tx, REMEMBER_SQL, [est, JSON.stringify(it)])
const errRemember = (tx: Queryable, est: string, it: unknown): Promise<string> =>
  errInfo(tx, REMEMBER_SQL, [est, JSON.stringify(it)])

/** Tranzaksiya ichida superuser sifatida triggerlarsiz (created_at ni o'zgartirish uchun). */
async function asSuperNoTriggers(tx: Tx, sql: string, params: unknown[]): Promise<void> {
  await tx.exec('reset role')
  await tx.exec(`set local session_replication_role = replica`)
  await tx.query(sql, params)
  await tx.exec(`set local session_replication_role = origin`)
  await tx.exec('set local role authenticated')
}

const aliasCount = (tx: Queryable, texts: string[]): Promise<number> =>
  scalar<number>(tx, `select count(*)::int from public.material_aliases where alias = any ($1) and deleted_at is null`, [texts])

// ============================================================================
// 1. remember_estimate_aliases — smetaga bog'langan
// ============================================================================
describe('remember_estimate_aliases — smeta', () => {
  it('smeta yo`q / boshqa firmaniki / o`chirilgan — P0002 estimate_not_found', async () => {
    const bEst = await asUser(
      db,
      B.users.buxgalter.authUid,
      (tx) => importEst(tx, [{ material_id: B.ids.m1!, name: 'B sement', code: 'B-1' }], B.ids.obj3!),
      { commit: true },
    )
    await asUser(db, A.users.admin.authUid, async (tx) => {
      expect(head2(await errRemember(tx, randomUUID(), []))).toBe('P0002|estimate_not_found')
      expect(head2(await errRemember(tx, bEst, [{ material_id: B.ids.m1, code: 'B-1' }]))).toBe('P0002|estimate_not_found')
      const est = await importEst(tx, [{ material_id: A.ids.m1!, name: 'Sement', code: uniq('D-') }])
      await tx.query(`update public.estimates set deleted_at = now() where id = $1`, [est])
      expect(head2(await errRemember(tx, est, []))).toBe('P0002|estimate_not_found')
    })
  })

  it('buxgalter — faqat o`zi yuklagan smeta; admin va super_admin — firmaning istalgan smetasi', async () => {
    const code = uniq('OWN-')
    const adminEst = await asUser(
      db,
      A.users.admin.authUid,
      (tx) => importEst(tx, [{ material_id: A.ids.m1!, name: 'Sement', code }]),
      { commit: true },
    )
    const e = await asUser(db, A.users.buxgalter.authUid, (tx) => errRemember(tx, adminEst, [{ material_id: A.ids.m1, code }]))
    expect(e).toBe("22023|estimate_aliases_invalid|Muqobil nomlarni faqat o'zingiz yuklagan smetadan saqlash mumkin|")

    const code2 = uniq('BUX-')
    const buxEst = await asUser(
      db,
      A.users.buxgalter.authUid,
      (tx) => importEst(tx, [{ material_id: A.ids.m1!, name: 'Sement', code: code2 }]),
      { commit: true },
    )
    for (const role of ['admin', 'super_admin'] as const) {
      const n = await asUser(db, A.users[role].authUid, (tx) => remember(tx, buxEst, [{ material_id: A.ids.m1, code: code2 }]))
      expect(n, role).toBe(1)
    }
  })

  it('24 soatdan eski smeta — estimate_aliases_invalid (admin uchun ham); 23 soatlik — OK', async () => {
    for (const role of ['buxgalter', 'admin'] as const) {
      await asUser(db, A.users[role].authUid, async (tx) => {
        const code = uniq('OLD-')
        const est = await importEst(tx, [{ material_id: A.ids.m1!, name: 'Sement', code }])
        await asSuperNoTriggers(tx, `update public.estimates set created_at = now() - interval '25 hours' where id = $1`, [est])
        expect(await errRemember(tx, est, [{ material_id: A.ids.m1, code }]), role).toBe(
          "22023|estimate_aliases_invalid|Smeta 24 soatdan oldin yuklangan — muqobil nomlarni saqlab bo'lmaydi|",
        )
        await asSuperNoTriggers(tx, `update public.estimates set created_at = now() - interval '23 hours' where id = $1`, [est])
        expect(await remember(tx, est, [{ material_id: A.ids.m1, code }])).toBe(1)
      })
    }
  })

  it('o`g`irlash urinishi: smetada yo`q material ("Цемент М500" → qum) — rad, hech narsa yozilmaydi', async () => {
    await asUser(db, A.users.buxgalter.authUid, async (tx) => {
      const est = await importEst(tx, [{ material_id: A.ids.m1!, name: 'Цемент М500', code: '101-0500' }])
      const e = await errRemember(tx, est, [
        { material_id: A.ids.m1, code: '101-0500' }, // to'g'ri
        { material_id: A.ids.m2, name: 'Цемент М500' }, // m2 smetada yo'q
      ])
      expect(e).toBe("22023|estimate_aliases_invalid|Qator 2: material bu smetada yo'q|2")
      expect(await aliasCount(tx, ['101-0500', 'Цемент М500'])).toBe(0)
    })
  })

  it('ish qatori material hisoblanmaydi', async () => {
    await asUser(db, A.users.buxgalter.authUid, async (tx) => {
      const est = await importEst(tx, [
        { item_type: 'ish', name: 'A qum' },
        { material_id: A.ids.m1!, name: 'Sement' },
      ])
      expect(await errRemember(tx, est, [{ material_id: A.ids.m2, name: 'A qum' }])).toBe(
        "22023|estimate_aliases_invalid|Qator 1: material bu smetada yo'q|1",
      )
    })
  })

  it('code / name — shu material qatorlaridan biriga mos bo`lishi shart; boshqa material qatoriniki — rad', async () => {
    await asUser(db, A.users.buxgalter.authUid, async (tx) => {
      const c1 = uniq('M1-')
      const c2 = uniq('M2-')
      const n2 = uniq('Песок')
      const est = await importEst(tx, [
        { material_id: A.ids.m1!, name: 'Цемент', code: c1 },
        { material_id: A.ids.m2!, name: n2, code: c2 },
      ])
      expect(await errRemember(tx, est, [{ material_id: A.ids.m1, code: c2 }])).toBe(
        "22023|estimate_aliases_invalid|Qator 1: shifr smetadagi shu material qatoriga mos emas|1",
      )
      expect(await errRemember(tx, est, [{ material_id: A.ids.m1, name: n2 }])).toBe(
        "22023|estimate_aliases_invalid|Qator 1: nom smetadagi shu material qatoriga mos emas|1",
      )
      expect(await errRemember(tx, est, [{ material_id: A.ids.m1, code: c1, name: 'Ixtiyoriy matn' }])).toBe(
        "22023|estimate_aliases_invalid|Qator 1: nom smetadagi shu material qatoriga mos emas|1",
      )
      expect(await aliasCount(tx, [c1, c2, n2])).toBe(0)
      // to'g'ri juftliklar — OK; code/name null — o'tkaziladi
      expect(await remember(tx, est, [{ material_id: A.ids.m1, code: c1 }, { material_id: A.ids.m2, code: c2, name: n2 }, { material_id: A.ids.m2 }])).toBe(3)
    })
  })

  it('solishtirish: btrim + bo`sh joylar siqiladi (NBSP ham); registr farqi — mos emas; saqlangan matn siqilgan', async () => {
    await asUser(db, A.users.buxgalter.authUid, async (tx) => {
      const tag = uniq('t')
      const name = `Раствор  цементный${String.fromCharCode(0xa0)}М100 ${tag}`
      const est = await importEst(tx, [{ material_id: A.ids.m1!, name, code: ` С101-${tag}  ` }])
      expect(await errRemember(tx, est, [{ material_id: A.ids.m1, name: `раствор цементный м100 ${tag}` }])).toBe(
        "22023|estimate_aliases_invalid|Qator 1: nom smetadagi shu material qatoriga mos emas|1",
      )
      expect(
        await remember(tx, est, [{ material_id: A.ids.m1, code: `С101-${tag}`, name: `  Раствор цементный   М100 ${tag} ` }]),
      ).toBe(2)
      const r = await rows<{ alias: string; lang: string }>(
        tx,
        `select alias, lang from public.material_aliases where alias like '%' || $1 order by lang`,
        [tag],
      )
      expect(r).toEqual([
        { alias: `С101-${tag}`, lang: 'code' },
        { alias: `Раствор цементный М100 ${tag}`, lang: 'ru' },
      ])
    })
  })

  it('o`chirilgan smeta qatori hisobga olinmaydi', async () => {
    await asUser(db, A.users.admin.authUid, async (tx) => {
      const code = uniq('DELROW-')
      const est = await importEst(tx, [
        { material_id: A.ids.m1!, name: 'Sement', code },
        { material_id: A.ids.m2!, name: 'Qum' },
      ])
      await tx.query(`update public.estimate_items set deleted_at = now() where estimate_id = $1 and code = $2`, [est, code])
      expect(await errRemember(tx, est, [{ material_id: A.ids.m1, code }])).toBe(
        "22023|estimate_aliases_invalid|Qator 1: material bu smetada yo'q|1",
      )
    })
  })

  it('private.squash_spaces — authenticated uchun execute yo`q', async () => {
    const r = await one<{ auth: boolean; anon: boolean }>(
      db,
      `select has_function_privilege('authenticated', 'private.squash_spaces(text)', 'execute') as auth,
              has_function_privilege('anon', 'private.squash_spaces(text)', 'execute') as anon`,
    )
    expect(r).toEqual({ auth: false, anon: false })
  })
})

// ============================================================================
// 2. estimate_items.line_sum
// ============================================================================
describe('estimate_items.line_sum', () => {
  it('import: son yoki satr, 2 xonaga yaxlitlanadi; yo`q — null', async () => {
    await asUser(db, A.users.admin.authUid, async (tx) => {
      const est = await importEst(tx, [
        { material_id: A.ids.m1!, name: 'a', qty: '3', unit_price: '33.33', line_sum: 100 },
        { material_id: A.ids.m1!, name: 'b', qty: '3', unit_price: '33.33', line_sum: '99.995' },
        { material_id: A.ids.m1!, name: 'c', qty: '3', unit_price: '33.33' },
        { item_type: 'ish', name: 'd', qty: '1', line_sum: ' 12.5 ' },
      ])
      const r = await rows<{ name: string; line_sum: string | null }>(
        tx,
        `select name, line_sum::text as line_sum from public.estimate_items where estimate_id = $1 order by name`,
        [est],
      )
      expect(r).toEqual([
        { name: 'a', line_sum: '100.00' },
        { name: 'b', line_sum: '100.00' },
        { name: 'c', line_sum: null },
        { name: 'd', line_sum: '12.50' },
      ])
    })
  })

  it('xato: raqam emas / manfiy / juda katta — estimate_item_invalid, qator raqami bilan', async () => {
    const cases: [unknown, string][] = [
      ['abc', 'summa raqam emas'],
      [-1, "summa manfiy bo'lishi mumkin emas"],
      ['-0.01', "summa manfiy bo'lishi mumkin emas"],
      ['1e16', 'summa juda katta'],
      ['9999999999999999.995', 'summa juda katta'],
    ]
    await asUser(db, A.users.admin.authUid, async (tx) => {
      for (const [v, reason] of cases) {
        const e = await errInfo(tx, IMPORT_SQL, [
          randomUUID(),
          A.ids.obj3,
          JSON.stringify(await items(tx, [{ material_id: A.ids.m1!, name: 'x', line_sum: v }])),
        ])
        expect(e, String(v)).toBe(`22023|estimate_item_invalid|Qator 1: ${reason}|1`)
      }
      // chegara: 9999999999999999.99 — OK
      const ok = await importEst(tx, [{ material_id: A.ids.m1!, name: 'max', line_sum: '9999999999999999.99' }])
      expect(await scalar<string>(tx, `select line_sum::text from public.estimate_items where estimate_id = $1`, [ok])).toBe(
        '9999999999999999.99',
      )
    })
  })

  it('jadval CHECK: line_sum >= 0 (superuser to`g`ridan-to`g`ri INSERT)', async () => {
    const e = await db.transaction(async (tx) => {
      const r = await errInfo(
        tx,
        `insert into public.estimate_items (company_id, estimate_id, item_type, name, qty, line_sum) values ($1, $2, 'ish', 'x', 1, -1)`,
        [A.id, A.ids.est_obj1],
      )
      await tx.rollback()
      return r
    })
    expect(e).toMatch(/^23514\|.*estimate_items_line_sum_check/)
  })

  it('estimate_totals: line_sum bo`lsa — u, bo`lmasa — round(qty × narx, 2); ikkalasi ham yo`q — 0', async () => {
    await asUser(db, A.users.admin.authUid, async (tx) => {
      const est = await importEst(tx, [
        { material_id: A.ids.m1!, name: 'agregat', qty: '3', unit_price: '33.33', line_sum: '100' }, // 99.99 emas
        { material_id: A.ids.m1!, name: 'oddiy', qty: '2.5', unit_price: '10.02' }, // round(25.05, 2) = 25.05
        { material_id: A.ids.m1!, name: 'narxsiz', qty: '7' },
        { item_type: 'ish', name: 'ish', qty: '1', line_sum: '0.5' },
      ])
      expect(await scalar<string>(tx, `select total_sum::text from public.estimate_totals where estimate_id = $1`, [est])).toBe('125.55')
    })
  })

  it('line_sum`siz smeta — total avvalgidek (Σ round(qty × narx, 2))', async () => {
    await asUser(db, A.users.admin.authUid, async (tx) => {
      const est = await importEst(tx, [
        { material_id: A.ids.m1!, name: 'a', qty: '3', unit_price: '33.33' },
        { material_id: A.ids.m1!, name: 'b', qty: '0.333', unit_price: '0.5' },
      ])
      const t = await scalar<string>(tx, `select total_sum::text from public.estimate_totals where estimate_id = $1`, [est])
      const old = await scalar<string>(
        tx,
        `select coalesce(sum(round(qty * unit_price, 2)), 0)::numeric(20,2)::text from public.estimate_items where estimate_id = $1`,
        [est],
      )
      expect(t).toBe(old)
      expect(t).toBe('100.16')
    })
  })

  it('import_hash line_sum ni o`z ichiga oladi: shu id + boshqa line_sum — estimate_id_reused; aynan o`sha payload — o`sha id', async () => {
    await asUser(db, A.users.admin.authUid, async (tx) => {
      const id = randomUUID()
      const withSum = JSON.stringify(await items(tx, [{ material_id: A.ids.m1!, name: 'h', qty: '3', unit_price: '33.33', line_sum: '100' }]))
      const otherSum = JSON.stringify(await items(tx, [{ material_id: A.ids.m1!, name: 'h', qty: '3', unit_price: '33.33', line_sum: '99.99' }]))
      const noSum = JSON.stringify(await items(tx, [{ material_id: A.ids.m1!, name: 'h', qty: '3', unit_price: '33.33' }]))
      expect(await scalar<string>(tx, IMPORT_SQL, [id, A.ids.obj3, withSum])).toBe(id)
      expect(await scalar<string>(tx, IMPORT_SQL, [id, A.ids.obj3, withSum])).toBe(id)
      expect(head2(await errInfo(tx, IMPORT_SQL, [id, A.ids.obj3, otherSum]))).toBe('23505|estimate_id_reused')
      expect(head2(await errInfo(tx, IMPORT_SQL, [id, A.ids.obj3, noSum]))).toBe('23505|estimate_id_reused')
      expect(await scalar<number>(tx, `select count(*)::int from public.estimates where id = $1`, [id])).toBe(1)
    })
  })

  it('import_estimate: imzo, security invoker, search_path, grantlar o`zgarmagan', async () => {
    const f = await one<{ definer: boolean; cfg: string[]; anon: boolean; auth: boolean }>(
      db,
      `select p.prosecdef as definer, p.proconfig as cfg,
              has_function_privilege('anon', p.oid, 'execute') as anon,
              has_function_privilege('authenticated', p.oid, 'execute') as auth
         from pg_proc p where p.oid = 'public.import_estimate(uuid, uuid, text, text, date, jsonb)'::regprocedure`,
    )
    expect(f).toEqual({ definer: false, cfg: ['search_path=""'], anon: false, auth: true })
  })
})

// ============================================================================
// 3. qulf kaliti
// ============================================================================
describe('qulf kaliti — estimate_create_materials = private.lock_catalog_names', () => {
  const HELD = `select (l.classid::bigint << 32) | l.objid::bigint as key
                  from pg_locks l
                 where l.locktype = 'advisory' and l.objsubid = 1 and l.pid = pg_backend_pid() and l.granted`
  const EXPECTED = `select hashtextextended('terron.catalog_names:' || $1::text, 0)::text as k`

  it('ikkalasi aynan bir xil advisory kalitni oladi', async () => {
    const expected = await scalar<string>(db, EXPECTED, [A.id])

    const viaHelper = await db.transaction(async (tx) => {
      await tx.query(`select private.lock_catalog_names($1)`, [A.id])
      const r = await rows<{ key: string }>(tx, `select key::text from (${HELD}) x`)
      await tx.rollback()
      return r.map((x) => x.key)
    })

    const viaRpc = await asUser(db, A.users.admin.authUid, async (tx) => {
      await tx.query(`select public.estimate_create_materials($1::jsonb)`, [
        JSON.stringify([{ key: 'k', name: uniq('Lock'), base_unit: 'kg' }]),
      ])
      const r = await rows<{ key: string }>(tx, `select key::text from (${HELD}) x`)
      return r.map((x) => x.key)
    })

    expect(viaHelper).toEqual([expected])
    expect(viaRpc).toContain(expected)
  })

  it('manba matnida ham bir xil prefiks', async () => {
    const r = await rows<{ fn: string; has: boolean }>(
      db,
      `select p.oid::regprocedure::text as fn, position('terron.catalog_names:' in p.prosrc) > 0 as has
         from pg_proc p
        where p.oid in ('private.lock_catalog_names(uuid)'::regprocedure, 'public.estimate_create_materials(jsonb)'::regprocedure)
        order by 1`,
    )
    expect(r.every((x) => x.has)).toBe(true)
    expect(r).toHaveLength(2)
  })
})
