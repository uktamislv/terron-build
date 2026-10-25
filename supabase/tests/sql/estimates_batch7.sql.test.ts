// Batch 7 — 20261031000001_estimates.sql: estimate_items (unit_id, code, row_number,
// norm_qty_base bazada), estimate_import_templates, import_estimate(), set_current_estimate().
import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { asAnon, asService, asUser, createDb, one, rows, scalar, type Db, type Queryable, type TestUser } from './_harness'
import { buildTwoCompanies, type CompanyFixture } from './_fixtures'

let db: Db
let A: CompanyFixture
let B: CompanyFixture
/** A firma: m1 (sement, kg) birliklari */
let kgId: string
let qopId: string
/** A firma: m2 (qum, m³) asosiy birligi */
let m3Id: string

beforeAll(async () => {
  db = await createDb()
  ;({ A, B } = await buildTwoCompanies(db))
  kgId = await unitOf(A.ids.m1!, 'kg')
  qopId = A.ids.u1!
  m3Id = await unitOf(A.ids.m2!, 'm³')
})
afterAll(async () => {
  await db?.close()
})

// ----------------------------------------------------------------------------
// Yordamchilar
// ----------------------------------------------------------------------------

function unitOf(material: string, unit: string): Promise<string> {
  return scalar<string>(db, `select id from public.material_units where material_id = $1 and unit = $2`, [
    material,
    unit,
  ])
}

/** `OK:<qatorlar>` yoki `<errcode>:<hint>` (savepoint bilan — tx davom etadi). */
async function res(tx: Queryable, sql: string, params: unknown[] = []): Promise<string> {
  await tx.exec('savepoint e7_try')
  try {
    const r = await tx.query(sql, params)
    await tx.exec('release savepoint e7_try')
    return `OK:${r.affectedRows || r.rows.length}`
  } catch (e) {
    await tx.exec('rollback to savepoint e7_try')
    const err = e as { code?: string; hint?: string }
    return `${err.code ?? '?'}:${err.hint ?? ''}`
  }
}

/** Xato: `code|hint|message|detail` yoki `OK`. */
async function errInfo(tx: Queryable, sql: string, params: unknown[] = []): Promise<string> {
  await tx.exec('savepoint e7_msg')
  try {
    await tx.query(sql, params)
    await tx.exec('release savepoint e7_msg')
    return 'OK'
  } catch (e) {
    await tx.exec('rollback to savepoint e7_msg')
    const err = e as { code?: string; hint?: string; message?: string; detail?: string }
    return `${err.code ?? '?'}|${err.hint ?? ''}|${err.message ?? ''}|${err.detail ?? ''}`
  }
}

interface Item {
  item_type?: unknown
  name?: unknown
  material_id?: unknown
  unit?: unknown
  unit_id?: unknown
  qty?: unknown
  unit_price?: unknown
  code?: unknown
  row_number?: unknown
  sort_order?: unknown
  norm_qty_base?: unknown
}

const IMPORT_SQL = `select public.import_estimate($1, $2, $3, $4, $5, $6::jsonb) as id`

function importArgs(id: string, obj: string, items: unknown, title = 'Smeta'): unknown[] {
  return [id, obj, title, 'smeta.xlsx', '2026-10-25', JSON.stringify(items)]
}

/** Muvaffaqiyatli import — id qaytaradi (xato bo'lsa tashlaydi). */
async function doImport(tx: Queryable, obj: string, items: Item[], id = randomUUID(), title = 'Smeta'): Promise<string> {
  const r = await one<{ id: string }>(tx, IMPORT_SQL, importArgs(id, obj, items, title))
  return r.id
}

const tryImport = (tx: Queryable, obj: string, items: unknown, id = randomUUID()): Promise<string> =>
  res(tx, IMPORT_SQL, importArgs(id, obj, items))

const errImport = (tx: Queryable, obj: string, items: unknown, id = randomUUID()): Promise<string> =>
  errInfo(tx, IMPORT_SQL, importArgs(id, obj, items))

const sement = (extra: Item = {}): Item => ({
  item_type: 'material',
  name: 'Цемент М400',
  material_id: A.ids.m1,
  unit: 'мешок',
  unit_id: qopId,
  qty: '3',
  unit_price: '60000',
  code: 'ФССЦ-01',
  row_number: 12,
  sort_order: 1,
  ...extra,
})
const ish = (extra: Item = {}): Item => ({
  item_type: 'ish',
  name: 'Suvoq ishlari',
  unit: 'm²',
  qty: 120.5,
  unit_price: 15000,
  row_number: 13,
  sort_order: 2,
  ...extra,
})

const admin = (): TestUser => A.users.admin

/** RPC ichidagi holat (terron.estimate_rpc = on) — trigger mantiqini alohida sinash uchun. */
const rpcOn = (tx: Queryable): Promise<unknown> => tx.query(`select set_config('terron.estimate_rpc', 'on', true)`)
const rpcOff = (tx: Queryable): Promise<unknown> => tx.query(`select set_config('terron.estimate_rpc', 'off', true)`)

// ============================================================================
// import_estimate
// ============================================================================
describe('import_estimate', () => {
  it('versiya 1 → 2, is_current almashadi, qatorlar sort_order bilan', async () => {
    const r = await asUser(db, admin().authUid, async (tx) => {
      const v1 = await doImport(tx, A.ids.obj3!, [sement(), ish()], randomUUID(), 'Birinchi')
      const v2 = await doImport(tx, A.ids.obj3!, [ish({ sort_order: 1, row_number: 5 })], randomUUID(), 'Ikkinchi')
      const est = await rows(
        tx,
        `select id, version, is_current, title, source_file_name, to_char(estimate_date, 'DD.MM.YYYY') as d, created_by
           from public.estimates where object_id = $1 order by version`,
        [A.ids.obj3],
      )
      const items = await rows(
        tx,
        `select item_type, name, unit, code, row_number, sort_order, qty::text, unit_price::text, norm_qty_base::text
           from public.estimate_items where estimate_id = $1 order by sort_order`,
        [v1],
      )
      return { v1, v2, est, items }
    })
    expect(r.est).toEqual([
      {
        id: r.v1,
        version: 1,
        is_current: false,
        title: 'Birinchi',
        source_file_name: 'smeta.xlsx',
        d: '25.10.2026',
        created_by: admin().profileId,
      },
      {
        id: r.v2,
        version: 2,
        is_current: true,
        title: 'Ikkinchi',
        source_file_name: 'smeta.xlsx',
        d: '25.10.2026',
        created_by: admin().profileId,
      },
    ])
    expect(r.items).toEqual([
      {
        item_type: 'material',
        name: 'Цемент М400',
        unit: 'мешок',
        code: 'ФССЦ-01',
        row_number: 12,
        sort_order: 1,
        qty: '3.000000',
        unit_price: '60000.00',
        norm_qty_base: '150.000000',
      },
      {
        item_type: 'ish',
        name: 'Suvoq ishlari',
        unit: 'm²',
        code: null,
        row_number: 13,
        sort_order: 2,
        qty: '120.500000',
        unit_price: '15000.00',
        norm_qty_base: null,
      },
    ])
  })

  it('mavjud versiyadan keyin: fixture v1 (obj1) → yangi import v2, eski joriy emas', async () => {
    const r = await asUser(db, admin().authUid, async (tx) => {
      const id = await doImport(tx, A.ids.obj1!, [ish()])
      return rows(tx, `select id, version, is_current from public.estimates where object_id = $1 order by version`, [
        A.ids.obj1,
      ]).then((x) => x.map((e) => [e.id === id ? 'new' : e.id === A.ids.est_obj1 ? 'old' : '?', e.version, e.is_current]))
    })
    expect(r).toEqual([
      ['old', 1, false],
      ['new', 2, true],
    ])
  })

  it('versiya o`chirilgan versiyalardan keyin ham o`sadi (raqam qayta ishlatilmaydi)', async () => {
    const r = await asUser(db, admin().authUid, async (tx) => {
      const v1 = await doImport(tx, A.ids.obj3!, [ish()])
      await tx.query(`update public.estimates set deleted_at = now() where id = $1`, [v1])
      const v2 = await doImport(tx, A.ids.obj3!, [ish()])
      return scalar<number>(tx, `select version from public.estimates where id = $1`, [v2])
    })
    expect(r).toBe(2)
  })

  it('idempotent: shu p_id bilan ikkinchi chaqiruv — o`sha id, yangi qator yo`q', async () => {
    const r = await asUser(db, admin().authUid, async (tx) => {
      const id = randomUUID()
      const a = await doImport(tx, A.ids.obj3!, [sement(), ish()], id)
      const b = await doImport(tx, A.ids.obj3!, [sement(), ish()], id)
      return {
        same: a === id && b === id,
        reused: await tryImport(tx, A.ids.obj3!, [ish(), ish(), ish()], id),
        titleChanged: await res(tx, IMPORT_SQL, importArgs(id, A.ids.obj3!, [sement(), ish()], 'Boshqa nom')),
        hash: await scalar<boolean>(tx, `select import_hash ~ '^[0-9a-f]{64}$' from public.estimates where id = $1`, [id]),
        estimates: await scalar<number>(tx, `select count(*)::int from public.estimates where object_id = $1`, [A.ids.obj3]),
        items: await scalar<number>(tx, `select count(*)::int from public.estimate_items where estimate_id = $1`, [id]),
        otherObject: await tryImport(tx, A.ids.obj2!, [ish()], id),
      }
    })
    expect(r).toEqual({
      same: true,
      reused: '23505:estimate_id_reused',
      titleChanged: '23505:estimate_id_reused',
      hash: true,
      estimates: 1,
      items: 2,
      otherObject: '23505:estimate_id_conflict',
    })
  })

  it('norm_qty_base bazada: klient qiymati e`tiborsiz; kasr factor; raqam satr va son ko`rinishida', async () => {
    const r = await asUser(db, admin().authUid, async (tx) => {
      const half = await scalar<string>(
        tx,
        `insert into public.material_units (company_id, material_id, unit, factor, created_by)
         values ($1, $2, 'yarim', 0.3333333333, $3) returning id`,
        [A.id, A.ids.m1, admin().profileId],
      )
      const id = await doImport(tx, A.ids.obj3!, [
        sement({ qty: ' 2.5 ', norm_qty_base: 999999, sort_order: 1 }),
        sement({ unit_id: kgId, unit: null, qty: 1000, norm_qty_base: 1, sort_order: 2 }),
        sement({ unit_id: half, qty: '3', sort_order: 3 }),
      ])
      return rows(
        tx,
        `select unit, norm_qty_base::text as n from public.estimate_items where estimate_id = $1 order by sort_order`,
        [id],
      )
    })
    expect(r).toEqual([
      { unit: 'мешок', n: '125.000000' },
      { unit: 'kg', n: '1000.000000' },
      { unit: 'мешок', n: '1.000000' },
    ])
  })

  it('boshqa materialning birligi → estimate_item_invalid, xabarda Excel qator raqami', async () => {
    const r = await asUser(db, admin().authUid, (tx) =>
      errImport(tx, A.ids.obj3!, [ish({ row_number: 6 }), sement({ unit_id: m3Id, row_number: 7 })]),
    )
    expect(r).toBe('22023|estimate_item_invalid|Qator 7: birlik bu materialga tegishli emas|7')
  })

  it('o`chirilgan birlik → xato', async () => {
    const r = await asUser(db, admin().authUid, async (tx) => {
      const u = await scalar<string>(
        tx,
        `insert into public.material_units (company_id, material_id, unit, factor, created_by)
         values ($1, $2, 'tonna', 1000, $3) returning id`,
        [A.id, A.ids.m1, admin().profileId],
      )
      await tx.query(`update public.material_units set deleted_at = now() where id = $1`, [u])
      return errImport(tx, A.ids.obj3!, [sement({ unit_id: u, row_number: 4 })])
    })
    expect(r).toBe('22023|estimate_item_invalid|Qator 4: birlik topilmadi yoki o\'chirilgan|4')
  })

  it.each<[string, Item, string]>([
    ['material_id yo`q', { material_id: null }, 'material tanlanmagan'],
    ['unit_id yo`q', { unit_id: null }, 'birlik tanlanmagan'],
    ['material_id uuid emas', { material_id: 'abc' }, 'material topilmadi'],
    ['B firma materiali', { material_id: '__B_m1__' }, 'material topilmadi'],
    ['qty = 0', { qty: 0 }, 'miqdor 0 dan katta bo\'lishi kerak'],
    ['qty < 0', { qty: '-1' }, 'miqdor 0 dan katta bo\'lishi kerak'],
    ['qty raqam emas', { qty: '12abc' }, 'miqdor raqam emas'],
    ['qty yo`q', { qty: null }, 'miqdor ko\'rsatilmagan'],
    ['narx manfiy', { unit_price: -5 }, 'narx manfiy bo\'lishi mumkin emas'],
    ['narx raqam emas', { unit_price: 'x' }, 'narx raqam emas'],
    ['turi noto`g`ri', { item_type: 'xizmat' }, 'turi «ish» yoki «material» bo\'lishi kerak'],
    ['nom bo`sh', { name: '  ' }, 'nomi bo\'sh'],
    ['qator raqami 0', { row_number: 0 }, 'qator raqami noto\'g\'ri'],
  ])('material qatori: %s → estimate_item_invalid', async (_l, patch, msg) => {
    const p = { ...patch }
    if (p.material_id === '__B_m1__') p.material_id = B.ids.m1
    const r = await asUser(db, admin().authUid, (tx) => errImport(tx, A.ids.obj3!, [sement({ ...p, row_number: p.row_number ?? 9 })]))
    const rn = p.row_number === 0 ? '#1' : '9'
    expect(r).toBe(`22023|estimate_item_invalid|Qator ${rn}: ${msg}|${rn.replace('#', '')}`)
  })

  it('ish qatori: materialsiz — OK; material yoki birlik bilan — xato', async () => {
    const r = await asUser(db, admin().authUid, async (tx) => ({
      ok: await tryImport(tx, A.ids.obj3!, [ish({ unit: null, unit_price: null, code: null, row_number: null })]),
      mat: await errImport(tx, A.ids.obj3!, [ish({ material_id: A.ids.m1, row_number: 3 })]),
      unit: await errImport(tx, A.ids.obj3!, [ish({ unit_id: kgId, row_number: 3 })]),
    }))
    expect(r.ok).toBe('OK:1')
    expect(r.mat).toBe('22023|estimate_item_invalid|Qator 3: ish qatorida material va birlik bo\'lmaydi|3')
    expect(r.unit).toBe(r.mat)
  })

  it('xato qator — hech narsa yozilmaydi (bitta tranzaksiya), birinchi xato qator ko`rsatiladi', async () => {
    const r = await asUser(db, admin().authUid, async (tx) => {
      const before = await scalar<number>(tx, `select count(*)::int from public.estimates`)
      const e = await errImport(tx, A.ids.obj3!, [
        ish({ row_number: 2 }),
        sement({ qty: 0, row_number: 3 }),
        sement({ unit_id: null, row_number: 4 }),
      ])
      const after = await scalar<number>(tx, `select count(*)::int from public.estimates`)
      return { e, diff: after - before }
    })
    expect(r).toEqual({ e: '22023|estimate_item_invalid|Qator 3: miqdor 0 dan katta bo\'lishi kerak|3', diff: 0 })
  })

  it('5000 qator — OK; 5001 qator → estimate_too_many_rows', async () => {
    const many = (n: number): Item[] =>
      Array.from({ length: n }, (_, i) => ({ item_type: 'ish', name: `Ish ${i + 1}`, qty: 1, row_number: i + 2 }))
    const r = await asUser(db, admin().authUid, async (tx) => {
      const ok = await doImport(tx, A.ids.obj3!, many(5000))
      return {
        n: await scalar<number>(tx, `select count(*)::int from public.estimate_items where estimate_id = $1`, [ok]),
        over: await tryImport(tx, A.ids.obj3!, many(5001)),
      }
    })
    expect(r).toEqual({ n: 5000, over: '22023:estimate_too_many_rows' })
  })

  it('sarlavha xatolari: bo`sh ro`yxat, massiv emas, nom bo`sh → estimate_invalid', async () => {
    const r = await asUser(db, admin().authUid, async (tx) => ({
      empty: await tryImport(tx, A.ids.obj3!, []),
      object: await tryImport(tx, A.ids.obj3!, { a: 1 }),
      title: await res(tx, IMPORT_SQL, importArgs(randomUUID(), A.ids.obj3!, [ish()], '   ')),
      nullId: await res(tx, IMPORT_SQL, [null, A.ids.obj3, 'S', null, null, '[]']),
      notObjectRow: await errImport(tx, A.ids.obj3!, [42]),
    }))
    expect(r).toEqual({
      empty: '22023:estimate_invalid',
      object: '22023:estimate_invalid',
      title: '22023:estimate_invalid',
      nullId: '22023:estimate_invalid',
      notObjectRow: '22023|estimate_item_invalid|Qator #1: qator noto\'g\'ri formatda|1',
    })
  })

  it('boshqa firma obyekti → estimate_object_not_found (RLS ko`rsatmaydi); o`chirilgan obyekt ham', async () => {
    const r = await asUser(db, admin().authUid, async (tx) => {
      const other = await tryImport(tx, B.ids.obj3!, [ish()])
      await tx.query(`update public.objects set deleted_at = now() where id = $1`, [A.ids.obj3])
      const deleted = await tryImport(tx, A.ids.obj3!, [ish()])
      return { other, deleted }
    })
    expect(r).toEqual({ other: 'P0002:estimate_object_not_found', deleted: 'P0002:estimate_object_not_found' })
    expect(await scalar<number>(db, `select count(*)::int from public.estimates where company_id = $1`, [B.id])).toBe(2)
  })

  it.each([
    ['admin', 'OK:1'],
    ['buxgalter', 'OK:1'],
    ['super_admin', 'OK:1'],
    ['direktor', '42501:estimate_import_forbidden'],
    ['prorab', '42501:estimate_import_forbidden'],
    ['taminotchi', '42501:estimate_import_forbidden'],
    ['omborchi', '42501:estimate_import_forbidden'],
  ] as const)('%s → %s', async (role, expected) => {
    const r = await asUser(db, A.users[role].authUid, (tx) => tryImport(tx, A.ids.obj1!, [sement(), ish()]))
    expect(r).toBe(expected)
  })

  it('anon execute qila olmaydi; authenticated — ha', async () => {
    const r = await asAnon(db, (tx) => tryImport(tx, A.ids.obj1!, [ish()]))
    expect(r).toBe('42501:')
    const g = await one(
      db,
      `select has_function_privilege('anon', 'public.import_estimate(uuid, uuid, text, text, date, jsonb)', 'execute') as anon,
              has_function_privilege('authenticated', 'public.import_estimate(uuid, uuid, text, text, date, jsonb)', 'execute') as auth,
              has_function_privilege('anon', 'public.set_current_estimate(uuid)', 'execute') as anon2,
              has_function_privilege('authenticated', 'public.set_current_estimate(uuid)', 'execute') as auth2,
              (select prosecdef from pg_proc where oid = 'public.import_estimate(uuid, uuid, text, text, date, jsonb)'::regprocedure) as definer,
              (select proconfig from pg_proc where oid = 'public.import_estimate(uuid, uuid, text, text, date, jsonb)'::regprocedure) as cfg`,
    )
    expect(g).toEqual({ anon: false, auth: true, anon2: false, auth2: true, definer: false, cfg: ['search_path=""'] })
  })

  it('audit: smeta va qatorlar audit_log ga yoziladi (veb)', async () => {
    const r = await asUser(db, admin().authUid, async (tx) => {
      const id = await doImport(tx, A.ids.obj3!, [sement(), ish()])
      return rows(
        tx,
        `select table_name, action, device, count(*)::int as n from public.audit_log
          where record_id = $1 or record_id in (select id from public.estimate_items where estimate_id = $1)
          group by 1, 2, 3 order by 1`,
        [id],
      )
    })
    expect(r).toEqual([
      { table_name: 'estimate_items', action: 'INSERT', device: 'veb', n: 2 },
      { table_name: 'estimates', action: 'INSERT', device: 'veb', n: 1 },
    ])
  })
})

// ============================================================================
// Ko'rish (Batch 1 matritsasi): prorab — a'zo obyekt smetasi
// ============================================================================
describe('import qilingan smetani ko`rish', () => {
  let onObj1: string
  let onObj2: string
  beforeAll(async () => {
    onObj1 = await asUser(db, admin().authUid, (tx) => doImport(tx, A.ids.obj1!, [sement(), ish()]), { commit: true })
    onObj2 = await asUser(db, admin().authUid, (tx) => doImport(tx, A.ids.obj2!, [sement()]), { commit: true })
  })

  const seen = (u: TestUser): Promise<{ est: string[]; items: number }> =>
    asUser(db, u.authUid, async (tx) => ({
      est: (
        await rows<{ id: string }>(tx, `select id from public.estimates where id = any($1) order by version`, [
          [onObj1, onObj2],
        ])
      ).map((x) => (x.id === onObj1 ? 'obj1' : 'obj2')),
      items: await scalar<number>(tx, `select count(*)::int from public.estimate_items where estimate_id = any($1)`, [
        [onObj1, onObj2],
      ]),
    }))

  it('prorab: faqat a`zo obyekt (obj1) smetasi va qatorlari', async () => {
    const r = await seen(A.users.prorab)
    expect(r.est).toEqual(['obj1'])
    expect(r.items).toBe(2)
  })
  it('direktor, buxgalter: hammasi; omborchi, haydovchi: hech narsa; B admin: hech narsa', async () => {
    expect(await seen(A.users.direktor)).toMatchObject({ items: 3 })
    expect((await seen(A.users.buxgalter)).est.sort()).toEqual(['obj1', 'obj2'])
    expect(await seen(A.users.omborchi)).toEqual({ est: [], items: 0 })
    expect(await seen(A.users.haydovchi)).toEqual({ est: [], items: 0 })
    expect(await seen(B.users.admin)).toEqual({ est: [], items: 0 })
  })
})

// ============================================================================
// estimate_items: to'g'ridan-to'g'ri yozish (trigger zaxira himoyasi)
// ============================================================================
describe('estimate_items trigger (b_compute_norm) — RPC holati taqlidi (GUC)', () => {
  const insertItem = (tx: Queryable, cols: Record<string, unknown>): Promise<string> => {
    const all = { company_id: A.id, estimate_id: A.ids.est_obj1, created_by: admin().profileId, ...cols }
    const keys = Object.keys(all)
    return res(
      tx,
      `insert into public.estimate_items (${keys.join(', ')}) values (${keys.map((_, i) => `$${i + 1}`).join(', ')})`,
      Object.values(all),
    )
  }

  it('klient norm_qty_base e`tiborsiz; unit_id bo`lmasa — matn yoki asosiy birlik', async () => {
    const r = await asUser(db, admin().authUid, async (tx) => {
      await rpcOn(tx)
      const base = { item_type: 'material', name: 'S', material_id: A.ids.m1, qty: 4, norm_qty_base: 1 }
      await insertItem(tx, { ...base, unit_id: qopId, sort_order: 101 })
      await insertItem(tx, { ...base, unit: ' QOP ', sort_order: 102 })
      await insertItem(tx, { ...base, sort_order: 103 })
      return rows(
        tx,
        `select unit, unit_id, norm_qty_base::text as n from public.estimate_items
          where estimate_id = $1 and sort_order > 100 order by sort_order`,
        [A.ids.est_obj1],
      )
    })
    expect(r).toEqual([
      { unit: 'qop', unit_id: qopId, n: '200.000000' },
      { unit: 'QOP', unit_id: qopId, n: '200.000000' },
      { unit: 'kg', unit_id: kgId, n: '4.000000' },
    ])
  })

  it('UPDATE: qty o`zgarsa norm_qty_base qayta hisoblanadi; norm_qty_base ni qo`lda o`zgartirib bo`lmaydi', async () => {
    const r = await asUser(db, admin().authUid, async (tx) => {
      await rpcOn(tx)
      await tx.query(`update public.estimate_items set qty = 7, unit_id = $2 where id = $1`, [A.ids.ei_obj1, qopId])
      await tx.query(`update public.estimate_items set norm_qty_base = 1 where id = $1`, [A.ids.ei_obj1])
      return scalar<string>(tx, `select norm_qty_base::text from public.estimate_items where id = $1`, [A.ids.ei_obj1])
    })
    expect(r).toBe('350.000000')
  })

  it('xatolar: boshqa material birligi, o`chirilgan birlik, ish + material, material + birliksiz, noma`lum matn', async () => {
    const r = await asUser(db, admin().authUid, async (tx) => {
      const del = await scalar<string>(
        tx,
        `insert into public.material_units (company_id, material_id, unit, factor, created_by)
         values ($1, $2, 'tonna', 1000, $3) returning id`,
        [A.id, A.ids.m1, admin().profileId],
      )
      await tx.query(`update public.material_units set deleted_at = now() where id = $1`, [del])
      await rpcOn(tx)
      const m = { item_type: 'material', name: 'S', material_id: A.ids.m1, qty: 1 }
      return {
        mismatch: await insertItem(tx, { ...m, unit_id: m3Id }),
        deleted: await insertItem(tx, { ...m, unit_id: del }),
        unknownText: await insertItem(tx, { ...m, unit: 'yashik' }),
        ishMat: await insertItem(tx, { item_type: 'ish', name: 'I', qty: 1, material_id: A.ids.m1 }),
        ishUnit: await insertItem(tx, { item_type: 'ish', name: 'I', qty: 1, unit_id: kgId }),
        noMat: await insertItem(tx, { item_type: 'material', name: 'S', qty: 1 }),
        ishNorm: await insertItem(tx, { item_type: 'ish', name: 'I', qty: 1, norm_qty_base: 5 }),
      }
    })
    expect(r).toEqual({
      mismatch: '23503:ops_unit_material_mismatch',
      deleted: '23503:ops_unit_not_found',
      unknownText: '23503:ops_unit_not_found',
      ishMat: '23514:estimate_item_invalid',
      ishUnit: '23514:estimate_item_invalid',
      noMat: '23514:estimate_item_invalid',
      ishNorm: 'OK:1',
    })
  })

  it('eski qator: birligi keyin o`chirilsa — qator tahrirlanadi va soft delete qilinadi', async () => {
    const r = await asUser(db, admin().authUid, async (tx) => {
      const u = await scalar<string>(
        tx,
        `insert into public.material_units (company_id, material_id, unit, factor, created_by)
         values ($1, $2, 'tonna', 1000, $3) returning id`,
        [A.id, A.ids.m1, admin().profileId],
      )
      await rpcOn(tx)
      const item = await scalar<string>(
        tx,
        `insert into public.estimate_items (company_id, estimate_id, item_type, name, material_id, unit_id, qty, created_by)
         values ($1, $2, 'material', 'S', $3, $4, 2, $5) returning id`,
        [A.id, A.ids.est_obj1, A.ids.m1, u, admin().profileId],
      )
      await tx.query(`update public.material_units set deleted_at = now() where id = $1`, [u])
      const nameRpc = await res(tx, `update public.estimate_items set name = 'S2' where id = $1`, [item])
      await rpcOff(tx)
      return {
        nameRpc,
        nameDirect: await res(tx, `update public.estimate_items set name = 'S3' where id = $1`, [item]),
        del: await res(tx, `update public.estimate_items set deleted_at = now() where id = $1`, [item]),
      }
    })
    expect(r).toEqual({ nameRpc: 'OK:1', nameDirect: '42501:estimate_direct_edit', del: 'OK:1' })
  })

  it('smetada ishlatilgan birlikning factor`i o`zgarmaydi (catalog_unit_in_use)', async () => {
    const r = await asUser(db, admin().authUid, async (tx) => {
      const u = await scalar<string>(
        tx,
        `insert into public.material_units (company_id, material_id, unit, factor, created_by)
         values ($1, $2, 'paket', 25, $3) returning id`,
        [A.id, A.ids.m1, admin().profileId],
      )
      const before = await res(tx, `update public.material_units set factor = 26 where id = $1`, [u])
      await doImport(tx, A.ids.obj3!, [sement({ unit_id: u })])
      const after = await res(tx, `update public.material_units set factor = 27 where id = $1`, [u])
      return { before, after }
    })
    expect(r).toEqual({ before: 'OK:1', after: 'P0001:catalog_unit_in_use' })
  })

  it('sxema: yangi ustunlar, FK, indekslar, trigger', async () => {
    const cols = await rows<{ c: string }>(
      db,
      `select column_name || ':' || data_type as c from information_schema.columns
        where table_schema = 'public' and table_name = 'estimate_items' and column_name in ('unit_id', 'code', 'row_number')
        order by 1`,
    )
    expect(cols.map((x) => x.c)).toEqual(['code:text', 'row_number:integer', 'unit_id:uuid'])
    const fk = await scalar<string>(
      db,
      `select pg_get_constraintdef(oid) from pg_constraint where conname = 'estimate_items_unit_fkey'`,
    )
    expect(fk).toBe('FOREIGN KEY (company_id, unit_id) REFERENCES material_units(company_id, id)')
    const idx = await rows<{ indexname: string }>(
      db,
      `select indexname from pg_indexes where schemaname = 'public'
          and indexname in ('estimate_items_company_estimate_idx', 'estimate_items_company_material_idx',
                            'estimate_items_company_unit_idx', 'estimates_company_object_current_idx',
                            'estimate_import_templates_signature_key')
        order by 1`,
    )
    expect(idx).toHaveLength(5)
    const tg = await rows<{ tgname: string }>(
      db,
      `select tgname from pg_trigger where tgrelid = 'public.estimate_items'::regclass and not tgisinternal order by 1`,
    )
    expect(tg.map((x) => x.tgname)).toEqual(
      expect.arrayContaining(['b_check_material', 'b_compute_norm', 'z_audit']),
    )
    // b_check_material → b_compute_norm (alifbo tartibi)
    expect('b_check_material' < 'b_compute_norm').toBe(true)
  })
})

// ============================================================================
// estimate_import_templates
// ============================================================================
describe('estimate_import_templates', () => {
  const insTpl = (tx: Queryable, u: TestUser, sig: string, co = A.id): Promise<string> =>
    res(
      tx,
      `insert into public.estimate_import_templates (company_id, name, header_signature, mapping, sheet_name, header_row, created_by)
       values ($1, 'Shablon', $2, '{"name": 1, "unit": 2, "qty": 3}'::jsonb, 'Лист1', 4, $3)`,
      [co, sig, u.profileId],
    )

  it('unique (firma, header_signature) o`chirilmaganlar orasida; boshqa firmada — mumkin', async () => {
    const r = await asUser(db, admin().authUid, async (tx) => {
      const first = await insTpl(tx, admin(), 'a|b|c')
      const dup = await insTpl(tx, admin(), 'a|b|c')
      await tx.query(`update public.estimate_import_templates set deleted_at = now() where header_signature = 'a|b|c'`)
      const afterDelete = await insTpl(tx, admin(), 'a|b|c')
      return { first, dup, afterDelete }
    })
    expect(r).toEqual({ first: 'OK:1', dup: '23505:', afterDelete: 'OK:1' })
    // fixture: A va B firmada bir xil imzo ('nomi|birlik|miqdori')
    expect(
      await scalar<number>(
        db,
        `select count(*)::int from public.estimate_import_templates where header_signature = 'nomi|birlik|miqdori'`,
      ),
    ).toBe(2)
  })

  it('yozish: admin, buxgalter; prorab, direktor — yo`q; boshqa firmaga — yo`q', async () => {
    const out: Record<string, string> = {}
    for (const role of ['admin', 'buxgalter', 'super_admin', 'direktor', 'prorab', 'taminotchi'] as const) {
      const u = A.users[role]
      out[role] = await asUser(db, u.authUid, async (tx) => {
        const ins = await insTpl(tx, u, `sig-${role}`)
        const upd = await res(tx, `update public.estimate_import_templates set last_used_at = now() where id = $1`, [
          A.ids.tpl1,
        ])
        return `${ins} ${upd}`
      })
    }
    out.crossFirm = await asUser(db, admin().authUid, async (tx) => {
      const ins = await insTpl(tx, admin(), 'cross', B.id)
      const upd = await res(tx, `update public.estimate_import_templates set name = 'x' where id = $1`, [B.ids.tpl1])
      return `${ins} ${upd}`
    })
    expect(out).toEqual({
      admin: 'OK:1 OK:1',
      buxgalter: 'OK:1 OK:1',
      super_admin: 'OK:1 OK:1',
      direktor: '42501: OK:0',
      prorab: '42501: OK:0',
      taminotchi: '42501: OK:0',
      crossFirm: '42501: OK:0',
    })
  })

  it('ko`rish: firma a`zolari (prorab ham); B firma shablonlari ko`rinmaydi', async () => {
    const n = await asUser(db, A.users.prorab.authUid, (tx) =>
      rows<{ id: string }>(tx, `select id from public.estimate_import_templates`),
    )
    expect(n.map((x) => x.id)).toEqual([A.ids.tpl1])
  })

  it('DELETE taqiqlangan (soft_delete_only); mapping obyekt bo`lishi shart', async () => {
    const r = await asUser(db, admin().authUid, async (tx) => ({
      del: await res(tx, `delete from public.estimate_import_templates where id = $1`, [A.ids.tpl1]),
      badMapping: await res(
        tx,
        `insert into public.estimate_import_templates (company_id, name, header_signature, mapping, created_by)
         values ($1, 'S', 'zz', '[1,2]'::jsonb, $2)`,
        [A.id, admin().profileId],
      ),
    }))
    expect(r.del).toBe('42501:')
    expect(r.badMapping).toBe('23514:')
  })
})

// ============================================================================
// set_current_estimate
// ============================================================================
describe('set_current_estimate', () => {
  it('eski versiyani joriy qilish; boshqa versiyalar joriy emas', async () => {
    const r = await asUser(db, A.users.buxgalter.authUid, async (tx) => {
      const v1 = await doImport(tx, A.ids.obj3!, [ish()])
      const v2 = await doImport(tx, A.ids.obj3!, [ish()])
      await tx.query(`select public.set_current_estimate($1)`, [v1])
      const after = await rows(tx, `select version, is_current from public.estimates where object_id = $1 order by version`, [
        A.ids.obj3,
      ])
      // takror — o'zgarishsiz
      await tx.query(`select public.set_current_estimate($1)`, [v1])
      await tx.query(`select public.set_current_estimate($1)`, [v2])
      const back = await rows(tx, `select version, is_current from public.estimates where object_id = $1 order by version`, [
        A.ids.obj3,
      ])
      return { after, back }
    })
    expect(r.after).toEqual([
      { version: 1, is_current: true },
      { version: 2, is_current: false },
    ])
    expect(r.back).toEqual([
      { version: 1, is_current: false },
      { version: 2, is_current: true },
    ])
  })

  it('ruxsat va topilmaslik', async () => {
    const r = {
      prorab: await asUser(db, A.users.prorab.authUid, (tx) =>
        res(tx, `select public.set_current_estimate($1)`, [A.ids.est_obj1]),
      ),
      direktor: await asUser(db, A.users.direktor.authUid, (tx) =>
        res(tx, `select public.set_current_estimate($1)`, [A.ids.est_obj1]),
      ),
      crossFirm: await asUser(db, admin().authUid, (tx) =>
        res(tx, `select public.set_current_estimate($1)`, [B.ids.est_obj1]),
      ),
      missing: await asUser(db, admin().authUid, (tx) =>
        res(tx, `select public.set_current_estimate($1)`, [randomUUID()]),
      ),
      deleted: await asUser(db, admin().authUid, async (tx) => {
        await tx.query(`update public.estimates set deleted_at = now(), is_current = false where id = $1`, [A.ids.est_obj2])
        return res(tx, `select public.set_current_estimate($1)`, [A.ids.est_obj2])
      }),
    }
    expect(r).toEqual({
      prorab: '42501:estimate_import_forbidden',
      direktor: '42501:estimate_import_forbidden',
      crossFirm: 'P0002:estimate_not_found',
      missing: 'P0002:estimate_not_found',
      deleted: 'P0002:estimate_not_found',
    })
  })
})

// ============================================================================
// Reviewer (Batch 7): RPC'siz tahrirlash taqiqlangan — estimate_direct_edit
// ============================================================================
describe('RPC`siz tahrirlash (estimate_direct_edit)', () => {
  it('admin: qator qty PATCH, qator INSERT, object_id/version ko`chirish, is_current, smeta INSERT — rad', async () => {
    const r = await asUser(db, admin().authUid, async (tx) => ({
      patchQty: await res(tx, `update public.estimate_items set qty = 99999 where id = $1`, [A.ids.ei_obj1]),
      patchUnit: await res(tx, `update public.estimate_items set unit_id = $2 where id = $1`, [A.ids.ei_obj1, qopId]),
      insertItem: await res(
        tx,
        `insert into public.estimate_items (company_id, estimate_id, item_type, name, qty, created_by)
         values ($1, $2, 'ish', 'X', 1, $3)`,
        [A.id, A.ids.est_obj1, admin().profileId],
      ),
      moveObject: await res(tx, `update public.estimates set object_id = $2 where id = $1`, [A.ids.est_obj1, A.ids.obj3]),
      version: await res(tx, `update public.estimates set version = 7 where id = $1`, [A.ids.est_obj1]),
      isCurrent: await res(tx, `update public.estimates set is_current = not is_current where id = $1`, [A.ids.est_obj1]),
      insertEstimate: await res(
        tx,
        `insert into public.estimates (company_id, object_id, version, title, created_by) values ($1, $2, 50, 'S', $3)`,
        [A.id, A.ids.obj3, admin().profileId],
      ),
      hash: await res(tx, `update public.estimates set import_hash = repeat('a', 64) where id = $1`, [A.ids.est_obj1]),
    }))
    const denied = '42501:estimate_direct_edit'
    expect(r).toEqual({
      patchQty: denied,
      patchUnit: denied,
      insertItem: denied,
      moveObject: denied,
      version: denied,
      isCurrent: denied,
      insertEstimate: denied,
      hash: denied,
    })
  })

  it('ruxsat: smeta nomi, qator va smetani soft delete, admin tiklaydi', async () => {
    const r = await asUser(db, admin().authUid, async (tx) => ({
      title: await res(tx, `update public.estimates set title = 'Yangi nom' where id = $1`, [A.ids.est_obj2]),
      delItem: await res(tx, `update public.estimate_items set deleted_at = now() where id = $1`, [A.ids.ei_obj1]),
      restoreItem: await res(tx, `update public.estimate_items set deleted_at = null where id = $1`, [A.ids.ei_obj1]),
      touch: await res(tx, `update public.estimate_items set updated_at = now() where id = $1`, [A.ids.ei_obj1]),
    }))
    expect(r).toEqual({ title: 'OK:1', delItem: 'OK:1', restoreItem: 'OK:1', touch: 'OK:1' })
  })

  it('buxgalter qatorni tiklay olmaydi (faqat admin)', async () => {
    const r = await asUser(db, A.users.buxgalter.authUid, async (tx) => {
      await tx.query(`update public.estimate_items set deleted_at = now() where id = $1`, [A.ids.ei_obj1])
      return res(tx, `update public.estimate_items set deleted_at = null where id = $1`, [A.ids.ei_obj1])
    })
    expect(r).toBe('42501:restore_admin_only')
  })

  it('tizim (service_role) qator qo`sha oladi; obyekt/versiya baribir o`zgarmaydi', async () => {
    const r = await asService(db, async (tx) => ({
      insert: await res(
        tx,
        `insert into public.estimate_items (company_id, estimate_id, item_type, name, qty) values ($1, $2, 'ish', 'T', 1)`,
        [A.id, A.ids.est_obj1],
      ),
      moveObject: await res(tx, `update public.estimates set object_id = $2 where id = $1`, [A.ids.est_obj1, A.ids.obj3]),
    }))
    expect(r).toEqual({ insert: 'OK:1', moveObject: '42501:estimate_direct_edit' })
  })

  it('RPC holatida ham begona firma qatori — RLS`dan oldin rad (estimate_direct_edit)', async () => {
    const r = await asUser(db, admin().authUid, async (tx) => {
      await rpcOn(tx)
      return res(
        tx,
        `insert into public.estimate_items (company_id, estimate_id, item_type, name, qty, created_by)
         values ($1, $2, 'ish', 'X', 1, $3)`,
        [B.id, B.ids.est_obj1, admin().profileId],
      )
    })
    expect(r).toBe('42501:estimate_direct_edit')
  })

  it('private.estimate_alert RPC`siz chaqirilmaydi', async () => {
    const r = await asUser(db, admin().authUid, (tx) =>
      res(tx, `select private.estimate_alert('norm_increase', $1, $1)`, [A.ids.est_obj1]),
    )
    expect(r).toBe('42501:estimate_direct_edit')
  })

  it('tiklash: obyektda boshqa joriy versiya bo`lsa → estimate_restore_conflict; is_current = false bilan — OK', async () => {
    const r = await asUser(db, admin().authUid, async (tx) => {
      await rpcOn(tx)
      // o'chirilgan, lekin is_current = true qolgan versiya (obj1 da boshqa joriy versiya bor)
      const old = await scalar<string>(
        tx,
        `insert into public.estimates (company_id, object_id, version, title, is_current, created_by)
         values ($1, $2, 40, 'Eski', false, $3) returning id`,
        [A.id, A.ids.obj1, admin().profileId],
      )
      await tx.query(`update public.estimates set deleted_at = now() where id = $1`, [old])
      await tx.query(`update public.estimates set is_current = true where id = $1`, [old])
      await rpcOff(tx)
      return {
        restore: await res(tx, `update public.estimates set deleted_at = null where id = $1`, [old]),
        restoreNotCurrent: await res(
          tx,
          `update public.estimates set deleted_at = null, is_current = false where id = $1`,
          [old],
        ),
      }
    })
    expect(r).toEqual({ restore: '23505:estimate_restore_conflict', restoreNotCurrent: 'OK:1' })
  })
})

// ============================================================================
// Reviewer: qo'shimcha tekshiruvlar (qty yaxlitlash, asosiy birlikda chegara, sana)
// ============================================================================
describe('import_estimate — qo`shimcha tekshiruvlar', () => {
  it('round(qty, 6) = 0 → xato; qty × factor ≥ 1e14 → xato', async () => {
    const r = await asUser(db, admin().authUid, async (tx) => {
      const t = await scalar<string>(
        tx,
        `insert into public.material_units (company_id, material_id, unit, factor, created_by)
         values ($1, $2, 'tonna', 1000, $3) returning id`,
        [A.id, A.ids.m1, admin().profileId],
      )
      return {
        tiny: await errImport(tx, A.ids.obj3!, [sement({ qty: '0.0000001', row_number: 5 })]),
        huge: await errImport(tx, A.ids.obj3!, [sement({ unit_id: t, qty: '100000000000', row_number: 6 })]),
        okBig: await tryImport(tx, A.ids.obj3!, [sement({ unit_id: t, qty: '99999999999', row_number: 6 })]),
      }
    })
    expect(r).toEqual({
      tiny: "22023|estimate_item_invalid|Qator 5: miqdor 0 dan katta bo'lishi kerak|5",
      huge: '22023|estimate_item_invalid|Qator 6: asosiy birlikdagi miqdor juda katta|6',
      okBig: 'OK:1',
    })
  })

  it('estimate_date: 2000-01-01 .. bugun + 1 yil', async () => {
    const call = (tx: Queryable, d: string | null): Promise<string> =>
      res(tx, IMPORT_SQL, [randomUUID(), A.ids.obj3, 'S', null, d, JSON.stringify([ish()])])
    const r = await asUser(db, admin().authUid, async (tx) => ({
      before2000: await call(tx, '1999-12-31'),
      y2000: await call(tx, '2000-01-01'),
      today: await call(tx, new Date().toISOString().slice(0, 10)),
      farFuture: await call(tx, '2100-01-01'),
      none: await call(tx, null),
    }))
    expect(r).toEqual({
      before2000: '22023:estimate_invalid',
      y2000: 'OK:1',
      today: 'OK:1',
      farFuture: '22023:estimate_invalid',
      none: 'OK:1',
    })
  })
})

// ============================================================================
// Reviewer: smeta_ozgarishi alertlari
// ============================================================================
describe('smeta_ozgarishi alertlari', () => {
  const kg = (qty: number | string, extra: Item = {}): Item =>
    sement({ unit_id: kgId, unit: 'kg', qty, unit_price: 1000, ...extra })

  type AlertRow = { severity: string; details: Record<string, unknown> }
  const alerts = (tx: Queryable, obj = A.ids.obj3!): Promise<AlertRow[]> =>
    rows<AlertRow>(
      tx,
      `select severity, details from public.alerts where type = 'smeta_ozgarishi' and object_id = $1
        order by created_at, details ->> 'kind'`,
      [obj],
    )

  it('birinchi import — alert yo`q; 9% oshish — yo`q; 11% — bor (ogohlantirish) va outbox`ga tushadi', async () => {
    const r = await asUser(db, admin().authUid, async (tx) => {
      await doImport(tx, A.ids.obj3!, [kg(100)])
      const afterFirst = (await alerts(tx)).length
      await doImport(tx, A.ids.obj3!, [kg(109)])
      const after9 = (await alerts(tx)).length
      const v3 = await doImport(tx, A.ids.obj3!, [kg('121.0')])
      const list = await alerts(tx)
      const outbox = await rows(
        tx,
        `select o.payload ->> 'type' as type, o.payload ->> 'object_name' as object_name,
                o.payload ->> 'material_name' as material_name, o.status
           from public.notification_outbox o join public.alerts a on a.id = o.alert_id
          where a.type = 'smeta_ozgarishi' and a.object_id = $1`,
        [A.ids.obj3],
      )
      return { afterFirst, after9, v3, list, outbox }
    })
    expect(r.afterFirst).toBe(0)
    expect(r.after9).toBe(0)
    expect(r.list).toEqual([
      {
        severity: 'ogohlantirish',
        details: {
          kind: 'norm_increase',
          estimate_id: r.v3,
          version: 3,
          prev_version: 2,
          materials: [
            {
              material_id: A.ids.m1,
              material_name: 'A sement',
              base_unit: 'kg',
              before: 109,
              after: 121,
              diff_pct: 11.01,
              consumed: 0,
              exceeded_before: false,
            },
          ],
          more_count: 0,
          actor_name: 'A admin',
        },
      },
    ])
    expect(r.outbox).toEqual([
      { type: 'smeta_ozgarishi', object_name: 'A obj3', material_name: null, status: 'pending' },
    ])
  })

  it('chiqim eski normadan oshgan material normasi oshirilsa → jiddiy, exceeded_before; yangi material ham ro`yxatda', async () => {
    const r = await asUser(db, admin().authUid, async (tx) => {
      await doImport(tx, A.ids.obj3!, [kg(100)])
      for (const [type, qty] of [
        ['kirim', 300],
        ['chiqim', 150],
        ['chiqim', 1000],
      ] as const) {
        const mv = await scalar<string>(
          tx,
          `insert into public.movements (company_id, type, object_id, material_id, unit_id, qty_input, unit_input, qty_base, created_by)
           values ($1, $2, $3, $4, $5, $6, 'kg', $6, $7) returning id`,
          [A.id, type, A.ids.obj3, A.ids.m1, kgId, qty, admin().profileId],
        )
        // o'chirilgan chiqim hisoblanmaydi
        if (qty === 1000) await tx.query(`update public.movements set deleted_at = now() where id = $1`, [mv])
      }
      const v2 = await doImport(tx, A.ids.obj3!, [
        kg(200),
        { item_type: 'material', name: 'Qum', material_id: A.ids.m2, unit_id: m3Id, qty: 5, row_number: 20 },
      ])
      return { v2, list: await alerts(tx) }
    })
    expect(r.list).toHaveLength(1)
    expect(r.list[0]!.severity).toBe('jiddiy')
    expect(r.list[0]!.details).toMatchObject({ kind: 'norm_increase', estimate_id: r.v2, version: 2, prev_version: 1 })
    expect(r.list[0]!.details.materials).toEqual([
      {
        material_id: A.ids.m1,
        material_name: 'A sement',
        base_unit: 'kg',
        before: 100,
        after: 200,
        diff_pct: 100,
        consumed: 150,
        exceeded_before: true,
      },
      {
        material_id: A.ids.m2,
        material_name: 'A qum',
        base_unit: 'm³',
        before: 0,
        after: 5,
        diff_pct: null,
        consumed: 0,
        exceeded_before: false,
      },
    ])
  })

  it('firma sozlamasi estimate_increase_pct = 20 → 11% oshish alert bermaydi; kamayish — hech qachon', async () => {
    const r = await asUser(db, admin().authUid, async (tx) => {
      await tx.query(`update public.companies set estimate_increase_pct = 20 where id = $1`, [A.id])
      await doImport(tx, A.ids.obj3!, [kg(100)])
      await doImport(tx, A.ids.obj3!, [kg(111)])
      await doImport(tx, A.ids.obj3!, [kg(50)])
      return (await alerts(tx)).length
    })
    expect(r).toBe(0)
  })

  it('eski versiyani joriy qilish → old_version_restored; yangisiga qaytish → alert yo`q', async () => {
    const r = await asUser(db, A.users.buxgalter.authUid, async (tx) => {
      const v1 = await doImport(tx, A.ids.obj3!, [ish()])
      const v2 = await doImport(tx, A.ids.obj3!, [ish()])
      await tx.query(`select public.set_current_estimate($1)`, [v1])
      await tx.query(`select public.set_current_estimate($1)`, [v2])
      return { v1, list: await alerts(tx) }
    })
    expect(r.list).toEqual([
      {
        severity: 'ogohlantirish',
        details: { kind: 'old_version_restored', estimate_id: r.v1, version: 1, prev_version: 2, actor_name: 'A buxgalter' },
      },
    ])
  })

  it('joriy versiyani soft delete → current_deleted; joriy bo`lmaganini — alert yo`q', async () => {
    const r = await asUser(db, admin().authUid, async (tx) => {
      const v1 = await doImport(tx, A.ids.obj3!, [ish()])
      const v2 = await doImport(tx, A.ids.obj3!, [ish()])
      await tx.query(`update public.estimates set deleted_at = now() where id = $1`, [v1])
      await tx.query(`update public.estimates set deleted_at = now() where id = $1`, [v2])
      return { v2, list: await alerts(tx) }
    })
    expect(r.list).toEqual([
      {
        severity: 'ogohlantirish',
        details: { kind: 'current_deleted', estimate_id: r.v2, version: 2, actor_name: 'A admin' },
      },
    ])
  })

  it('companies.estimate_increase_pct: standart 10, manfiy — rad', async () => {
    expect(await scalar<string>(db, `select estimate_increase_pct::text from public.companies where id = $1`, [A.id])).toBe(
      '10.00',
    )
    const r = await asUser(db, admin().authUid, (tx) =>
      res(tx, `update public.companies set estimate_increase_pct = -1 where id = $1`, [A.id]),
    )
    expect(r).toBe('23514:')
  })
})

// ============================================================================
// Reviewer: public.estimate_totals
// ============================================================================
describe('estimate_totals view', () => {
  it('qatorlar soni, materiallar soni, jami summa (o`chirilgan qatorlarsiz)', async () => {
    const r = await asUser(db, admin().authUid, async (tx) => {
      const id = await doImport(tx, A.ids.obj3!, [sement(), sement({ unit_price: null }), ish()])
      const before = await one(
        tx,
        `select row_count, material_count, total_sum::text as total_sum, object_id from public.estimate_totals
          where estimate_id = $1`,
        [id],
      )
      await tx.query(`update public.estimate_items set deleted_at = now() where estimate_id = $1 and item_type = 'ish'`, [
        id,
      ])
      const after = await one(
        tx,
        `select row_count, material_count, total_sum::text as total_sum from public.estimate_totals where estimate_id = $1`,
        [id],
      )
      return { before, after }
    })
    // 3 × 60 000 + 120.5 × 15 000 = 180 000 + 1 807 500
    expect(r.before).toEqual({ row_count: 3, material_count: 1, total_sum: '1987500.00', object_id: A.ids.obj3 })
    expect(r.after).toEqual({ row_count: 2, material_count: 1, total_sum: '180000.00' })
  })

  it('security_invoker: prorab faqat a`zo obyekt smetalarini ko`radi; anon — yo`q', async () => {
    const objs = await asUser(db, A.users.prorab.authUid, (tx) =>
      rows<{ object_id: string }>(tx, `select distinct object_id from public.estimate_totals`),
    )
    expect(objs.map((o) => o.object_id)).toEqual([A.ids.obj1])
    const anon = await asAnon(db, (tx) => res(tx, `select * from public.estimate_totals`))
    expect(anon).toBe('42501:')
  })
})
