// Batch 10 — 20261103000001_history.sql: audit_feed, deleted_records, restore_record,
// private.audit_record_label (hammasi security invoker — RLS amal qiladi).
//
// Fixture: H firma (tekshiriladigan) + B firma (boshqa firma). Fixture qatorlari
// superuser sifatida yaratilgan (audit: device = 'tizim', aktyor yo'q). Foydalanuvchi
// amallari asUser ichida (standart — rollback); beforeAll'dagi o'chirishlar — commit.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  asAnon,
  asService,
  asUser,
  createDb,
  createUser,
  insertRow,
  rows,
  scalar,
  type Db,
  type Queryable,
  type Row,
  type Tx,
} from './_harness'
import { buildCompany, type CompanyFixture } from './_fixtures'

let db: Db
let H: CompanyFixture
let B: CompanyFixture
let today = ''
const del: Record<string, string> = {}

/** `OK:<qatorlar>` yoki `<errcode>:<hint>` (savepoint bilan — tx davom etadi). */
async function res(tx: Queryable, sql: string, params: unknown[] = []): Promise<string> {
  await tx.exec('savepoint h_try')
  try {
    const r = await tx.query(sql, params)
    await tx.exec('release savepoint h_try')
    return `OK:${r.rows.length}`
  } catch (e) {
    await tx.exec('rollback to savepoint h_try')
    const err = e as { code?: string; hint?: string }
    return `${err.code ?? '?'}:${err.hint ?? ''}`
  }
}

const as = <T>(co: CompanyFixture, role: keyof CompanyFixture['users'], fn: (tx: Tx) => Promise<T>, opts = {}): Promise<T> =>
  asUser(db, co.users[role].authUid, fn, opts)

interface FeedRow extends Row {
  id: number
  table_name: string
  record_id: string
  action: string
  actor_name: string | null
  device: string | null
  changed_fields: string[] | null
  record_label: string | null
}

const feed = (tx: Queryable, args: Partial<{
  from: string
  to: string
  table: string
  action: string
  actor: string
  device: string
  record: string
  before: number
  limit: number
}> = {}): Promise<FeedRow[]> =>
  rows<FeedRow>(
    tx,
    `select * from public.audit_feed($1::date, $2::date, $3, $4, $5::uuid, $6, $7::uuid, $8::bigint, $9::int)`,
    [
      args.from ?? today,
      args.to ?? today,
      args.table ?? null,
      args.action ?? null,
      args.actor ?? null,
      args.device ?? null,
      args.record ?? null,
      args.before ?? null,
      args.limit ?? 50,
    ],
  )

interface DelRow extends Row {
  table_name: string
  record_id: string
  record_label: string | null
  deleted_by_name: string | null
}

const deleted = (tx: Queryable, table: string | null = null, limit = 100, offset = 0): Promise<DelRow[]> =>
  rows<DelRow>(tx, `select * from public.deleted_records($1::date, $2::date, $3, $4, $5)`, [today, today, table, limit, offset])

const restore = (tx: Queryable, table: string | null, id: string | null): Promise<string> =>
  res(tx, `select public.restore_record($1, $2::uuid)`, [table, id])

const label = async (table: string, id: string): Promise<string | null> =>
  as(H, 'admin', async (tx) => {
    const r = await feed(tx, { table, record: id, limit: 1 })
    return r[0]?.record_label ?? null
  })

beforeAll(async () => {
  db = await createDb()
  H = await buildCompany(db, 'H')
  B = await buildCompany(db, 'B')
  today = await scalar<string>(db, `select (now() at time zone 'Asia/Tashkent')::date::text`)

  // O'chiriladigan qatorlar (superuser yaratadi, admin o'chiradi — commit)
  del.supplier = (await insertRow<{ id: string }>(db, 'suppliers', { company_id: H.id, name: 'H eski sotuvchi' })).id
  del.movement = (
    await insertRow<{ id: string }>(db, 'movements', {
      company_id: H.id,
      type: 'kirim',
      object_id: H.ids.obj2,
      material_id: H.ids.m1,
      qty_input: 7,
      unit_input: 'kg',
      qty_base: 7,
    })
  ).id
  del.unit = (
    await insertRow<{ id: string }>(db, 'material_units', { company_id: H.id, material_id: H.ids.m1, unit: 'tonna', factor: 1000 })
  ).id
  await as(
    H,
    'admin',
    async (tx) => {
      await tx.query(`update public.suppliers set deleted_at = now() where id = $1`, [del.supplier])
      await tx.query(`update public.movements set deleted_at = now() where id = $1`, [del.movement])
      await tx.query(`update public.material_units set deleted_at = now() where id = $1`, [del.unit])
    },
    { commit: true },
  )

  // B firmada o'chirilgan qator (H admini ko'rmasligi kerak)
  del.bSupplier = (await insertRow<{ id: string }>(db, 'suppliers', { company_id: B.id, name: 'B eski sotuvchi' })).id
  await as(B, 'admin', (tx) => tx.query(`update public.suppliers set deleted_at = now() where id = $1`, [del.bSupplier]), {
    commit: true,
  })

  // O'tkazma harakati (bekor qilingan o'tkazmadagi kabi o'chirilgan) — superuser
  del.trMovement = (
    await insertRow<{ id: string }>(db, 'movements', {
      company_id: H.id,
      type: 'transfer_out',
      object_id: H.ids.obj1,
      material_id: H.ids.m1,
      transfer_id: H.ids.tr_1to2,
      qty_input: 1,
      unit_input: 'kg',
      qty_base: 1,
    })
  ).id
  await db.query(`update public.movements set deleted_at = now() where id = $1`, [del.trMovement])
})

afterAll(async () => {
  await db?.close()
})

// ============================================================================
describe('ruxsatlar va metama`lumot', () => {
  const SIGS = [
    'public.audit_feed(date, date, text, text, uuid, text, uuid, bigint, integer, uuid)', // audit3 tekshiruvi: + p_company_id
    'public.deleted_records(date, date, text, integer, integer, uuid)',
    'public.restore_record(text, uuid)',
    'private.audit_record_label(text, uuid, jsonb, jsonb)',
  ]

  it('security invoker, search_path = "", anon/public yo`q, authenticated bor; restore — volatile', async () => {
    const r = await rows<Row>(
      db,
      `select n.nspname || '.' || p.proname as fn, p.prosecdef as definer, p.provolatile as vol, p.proconfig as cfg,
              has_function_privilege('anon', p.oid, 'execute') as anon,
              has_function_privilege('authenticated', p.oid, 'execute') as auth,
              exists (select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                       where a.grantee = 0 and a.privilege_type = 'EXECUTE') as pub
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where p.oid = any ($1::regprocedure[]) order by 1`,
      [SIGS],
    )
    expect(r).toEqual(
      SIGS.map((s) => s.replace(/\(.*$/, '')).sort().map((fn) => ({
        fn,
        definer: false,
        vol: fn === 'public.restore_record' ? 'v' : 's',
        cfg: ['search_path=""'],
        anon: false,
        auth: true,
        pub: false,
      })),
    )
  })

  it('anon chaqira olmaydi', async () => {
    const r = await asAnon(db, (tx) => res(tx, `select * from public.audit_feed($1::date, $1::date)`, [today]))
    expect(r).toBe('42501:')
  })

  it('shartnomadagi audit_log indekslari bor', async () => {
    const r = await rows<{ indexdef: string }>(
      db,
      `select indexdef from pg_indexes where schemaname = 'public' and tablename = 'audit_log'
          and indexname in ('audit_log_company_id_idx', 'audit_log_company_record_idx', 'audit_log_company_actor_idx')
        order by indexname`,
    )
    expect(r.map((x) => x.indexdef.replace(/^.*USING btree /, ''))).toEqual([
      '(company_id, actor_profile_id, id DESC)',
      '(company_id, id DESC)',
      '(company_id, table_name, record_id, id DESC)',
    ])
  })
})

// ============================================================================
describe('audit_feed', () => {
  it('admin: o`z amali — actor_name, device, changed_fields, record_label', async () => {
    const r = await as(H, 'admin', async (tx) => {
      await tx.query(`update public.materials set name = 'H sement M400' where id = $1`, [H.ids.m1])
      return feed(tx, { table: 'materials', record: H.ids.m1, action: 'UPDATE' })
    })
    expect(r).toHaveLength(1)
    expect(r[0]).toMatchObject({
      table_name: 'materials',
      action: 'UPDATE',
      actor_name: 'H admin',
      device: 'veb',
      changed_fields: ['name'],
      record_label: 'H sement M400',
    })
  })

  it('filtrlar: amal, qurilma, kim, jadval, yozuv', async () => {
    const r = await as(
      H,
      'admin',
      async (tx) => {
        const s = await rows<{ id: string }>(
          tx,
          `insert into public.suppliers (company_id, name, created_by) values ($1, 'H mobil sotuvchi', $2) returning id`,
          [H.id, H.users.admin.profileId],
        )
        const id = s[0]!.id
        await tx.query(`update public.suppliers set deleted_at = now() where id = $1`, [id])
        return {
          all: (await feed(tx, { record: id })).map((x) => x.action),
          mobil: (await feed(tx, { record: id, device: 'mobil' })).length,
          veb: (await feed(tx, { record: id, device: 'veb' })).length,
          softDel: (await feed(tx, { record: id, action: 'SOFT_DELETE' })).map((x) => x.action),
          byActor: (await feed(tx, { record: id, actor: H.users.admin.profileId })).length,
          byOther: (await feed(tx, { record: id, actor: H.users.direktor.profileId })).length,
          byTable: (await feed(tx, { record: id, table: 'materials' })).length,
          tizim: (await feed(tx, { table: 'suppliers', record: H.ids.s1, device: 'tizim' })).length,
        }
      },
      { device: 'mobil' },
    )
    expect(r).toEqual({
      all: ['SOFT_DELETE', 'INSERT'],
      mobil: 2,
      veb: 0,
      softDel: ['SOFT_DELETE'],
      byActor: 2,
      byOther: 0,
      byTable: 0,
      tizim: 1,
    })
  })

  it('keyset: id < p_before_id, eng yangisi birinchi, takrorlanmaydi', async () => {
    const r = await as(H, 'admin', async (tx) => {
      for (let i = 1; i <= 5; i++) {
        await tx.query(`insert into public.suppliers (company_id, name, created_by) values ($1, $2, $3)`, [
          H.id,
          `H keyset ${i}`,
          H.users.admin.profileId,
        ])
      }
      const args = { table: 'suppliers', action: 'INSERT', actor: H.users.admin.profileId, limit: 2 }
      const p1 = await feed(tx, args)
      const p2 = await feed(tx, { ...args, before: p1[1]!.id })
      const p3 = await feed(tx, { ...args, before: p2[1]!.id })
      return [p1, p2, p3].map((p) => p.map((x) => ({ id: Number(x.id), label: x.record_label })))
    })
    const ids = r.flat().map((x) => x.id)
    expect(ids).toEqual([...ids].sort((a, b) => b - a))
    expect(new Set(ids).size).toBe(5)
    expect(r.map((p) => p.length)).toEqual([2, 2, 1])
    expect(r.flat().map((x) => x.label)).toEqual(['H keyset 5', 'H keyset 4', 'H keyset 3', 'H keyset 2', 'H keyset 1'])
  })

  it('p_limit 1..200, davr ≤ 366 kun (365 farq — OK), teskari davr — xato', async () => {
    const r = await as(H, 'admin', async (tx) => {
      const q = (from: string, to: string, limit: number): Promise<string> =>
        res(tx, `select * from public.audit_feed($1::date, $2::date, p_limit => $3)`, [from, to, limit])
      return {
        l0: await q(today, today, 0),
        l1: await q(today, today, 1),
        l200: await q(today, today, 200),
        l201: await q(today, today, 201),
        d365: await q('2025-01-01', '2026-01-01', 10),
        d366: await q('2025-01-01', '2026-01-02', 10),
        rev: await q('2026-01-02', '2026-01-01', 10),
        nul: await res(tx, `select * from public.audit_feed(null, $1::date)`, [today]),
      }
    })
    expect(r).toEqual({
      l0: '22023:history_limit_invalid',
      l1: 'OK:1',
      l200: expect.stringMatching(/^OK:/),
      l201: '22023:history_limit_invalid',
      d365: 'OK:0',
      d366: '22023:report_period_invalid',
      rev: '22023:report_period_invalid',
      nul: '22023:report_period_invalid',
    })
  })

  it('davr chegarasi: ertangi kun — 0 qator; bugun — bor', async () => {
    const r = await as(H, 'admin', async (tx) => {
      const tomorrow = await scalar<string>(tx, `select ($1::date + 1)::text`, [today])
      const yesterday = await scalar<string>(tx, `select ($1::date - 1)::text`, [today])
      return {
        tomorrow: (await feed(tx, { from: tomorrow, to: tomorrow })).length,
        yesterday: (await feed(tx, { from: yesterday, to: yesterday })).length,
        today: (await feed(tx, { record: H.ids.m1 })).length > 0,
      }
    })
    expect(r).toEqual({ tomorrow: 0, yesterday: 0, today: true })
  })

  it('RLS: prorab, omborchi, buxgalter, haydovchi, tekshiruvchi, taminotchi — 0 qator; direktor — bor', async () => {
    const out: Record<string, number> = {}
    for (const role of ['prorab', 'omborchi', 'buxgalter', 'haydovchi', 'tekshiruvchi', 'taminotchi', 'direktor'] as const) {
      out[role] = await as(H, role, async (tx) => (await feed(tx, { limit: 200 })).length)
    }
    expect(out).toMatchObject({ prorab: 0, omborchi: 0, buxgalter: 0, haydovchi: 0, tekshiruvchi: 0, taminotchi: 0 })
    expect(out.direktor).toBeGreaterThan(0)
  })

  it('boshqa firma: B admini H yozuvlarini ko`rmaydi, H admini — B nikini', async () => {
    const b = await as(B, 'admin', async (tx) => ({
      hRecord: (await feed(tx, { record: H.ids.m1 })).length,
      hLabels: (await feed(tx, { limit: 200 })).filter((x) => (x.record_label ?? '').startsWith('H ')).length,
    }))
    const h = await as(H, 'admin', async (tx) => (await feed(tx, { record: B.ids.m1 })).length)
    expect({ ...b, h }).toEqual({ hRecord: 0, hLabels: 0, h: 0 })
  })

  it('record_label — turli jadvallar', async () => {
    const r = {
      movements: await label('movements', H.ids.mv_obj1!),
      purchases: await label('purchases', H.ids.p_pro_obj1!),
      cash_advances: await label('cash_advances', H.ids.ca_haydovchi!),
      object_members: await label('object_members', H.ids.mem_prorab!),
      material_units: await label('material_units', H.ids.u1!),
      material_aliases: await label('material_aliases', H.ids.al1!),
      suppliers: await label('suppliers', H.ids.s1!),
      objects: await label('objects', H.ids.obj1!),
      profiles: await label('profiles', H.users.haydovchi.profileId),
      transfers: await label('transfers', H.ids.tr_1to2!),
      material_requests: await label('material_requests', H.ids.mr_obj1!),
      inventory_counts: await label('inventory_counts', H.ids.ic_obj1!),
      inventory_count_items: await label('inventory_count_items', H.ids.ici_obj1!),
      estimates: await label('estimates', H.ids.est_obj1!),
      estimate_items: await label('estimate_items', H.ids.ei_obj1!),
      estimate_import_templates: await label('estimate_import_templates', H.ids.tpl1!),
      companies: await label('companies', H.id),
      alerts: await label('alerts', H.ids.alert1!),
    }
    expect(r).toEqual({
      movements: 'H sement · 100 kg kirim',
      purchases: "H sement · 600 000 so'm · H sotuvchi",
      cash_advances: "H haydovchi · 1 000 000 so'm",
      object_members: 'H prorab · H obj1',
      material_units: 'H sement · qop',
      material_aliases: 'H Цемент → H sement',
      suppliers: 'H sotuvchi',
      objects: 'H obj1',
      profiles: 'H haydovchi',
      transfers: 'H sement · 1 kg · H obj1 → H obj2',
      material_requests: 'H sement · 2 qop · H obj1',
      inventory_counts: 'Inventarizatsiya · H obj1',
      inventory_count_items: 'H sement · 5 kg',
      estimates: 'H obj1 · Smeta · v1',
      estimate_items: 'Sement',
      estimate_import_templates: 'H shablon',
      companies: 'H',
      alerts: 'narx_ogishi · H obj1 · H sement',
    })
  })

  it('record_label: boshqa firma ma`lumoti — null; o`z firmasi qatorida begona material id — nom chiqmaydi', async () => {
    const r = await as(H, 'admin', async (tx) => {
      const lbl = (table: string, data: unknown): Promise<string | null> =>
        scalar<string | null>(tx, `select private.audit_record_label($1, gen_random_uuid(), $2::jsonb, null)`, [
          table,
          JSON.stringify(data),
        ])
      return {
        bMovement: await lbl('movements', {
          company_id: B.id,
          material_id: B.ids.m1,
          type: 'kirim',
          qty_input: 5,
          unit_input: 'kg',
        }),
        bMaterial: await lbl('materials', { company_id: B.id, name: 'B sement' }),
        bCompany: await lbl('companies', { id: B.id, name: 'B' }),
        mixed: await lbl('movements', {
          company_id: H.id,
          material_id: B.ids.m1,
          object_id: B.ids.obj1,
          type: 'kirim',
          qty_input: 5,
          unit_input: 'kg',
        }),
        mixedPurchase: await lbl('purchases', {
          company_id: H.id,
          material_id: B.ids.m1,
          supplier_id: B.ids.s1,
          total_amount: 1234567.5,
        }),
        noData: await scalar<string | null>(tx, `select private.audit_record_label('movements', gen_random_uuid(), null, null)`),
      }
    })
    expect(r).toEqual({
      bMovement: null,
      bMaterial: null,
      bCompany: null,
      mixed: '5 kg kirim',
      mixedPurchase: "1 234 567,5 so'm",
      noData: null,
    })
  })

  it('auth hodisasi: record_label — maqsad profil ismi (RLS bo`yicha)', async () => {
    await db.query(`select private.log_auth_event($1, null, $2, 'SET_LOGIN', '{}'::jsonb)`, [H.id, H.users.prorab.profileId])
    const r = await as(H, 'admin', async (tx) => feed(tx, { table: 'auth', action: 'SET_LOGIN' }))
    expect(r.map((x) => [x.record_label, x.device])).toEqual([['H prorab', 'tizim']])
  })
})

// ============================================================================
describe('deleted_records', () => {
  it('admin: jadvallar bo`yicha, deleted_by_name, yorliq; o`tkazma harakati chiqmaydi', async () => {
    const r = await as(H, 'admin', (tx) => deleted(tx))
    const byId = Object.fromEntries(r.map((x) => [x.record_id, x]))
    expect(byId[del.supplier!]).toMatchObject({ table_name: 'suppliers', record_label: 'H eski sotuvchi', deleted_by_name: 'H admin' })
    expect(byId[del.movement!]).toMatchObject({ table_name: 'movements', record_label: 'H sement · 7 kg kirim', deleted_by_name: 'H admin' })
    expect(byId[del.unit!]).toMatchObject({ table_name: 'material_units', record_label: 'H sement · tonna', deleted_by_name: 'H admin' })
    expect(byId[del.trMovement!]).toBeUndefined()
    expect(byId[del.bSupplier!]).toBeUndefined()
  })

  it('jadval filtri, limit/offset, noto`g`ri jadval', async () => {
    const r = await as(H, 'admin', async (tx) => ({
      suppliers: (await deleted(tx, 'suppliers')).map((x) => x.record_id),
      page1: (await deleted(tx, null, 1, 0)).length,
      page2: (await deleted(tx, null, 1, 1)).length,
      audit: await res(tx, `select * from public.deleted_records($1::date, $1::date, 'audit_log')`, [today]),
      transfers: await res(tx, `select * from public.deleted_records($1::date, $1::date, 'transfers')`, [today]),
      limit: await res(tx, `select * from public.deleted_records($1::date, $1::date, null, 201)`, [today]),
      offset: await res(tx, `select * from public.deleted_records($1::date, $1::date, null, 10, -1)`, [today]),
    }))
    expect(r).toEqual({
      suppliers: [del.supplier],
      page1: 1,
      page2: 1,
      audit: '22023:restore_table_invalid',
      transfers: '22023:restore_table_invalid',
      limit: '22023:history_limit_invalid',
      offset: '22023:history_limit_invalid',
    })
  })

  it('direktor ko`radi (deleted_by_name bilan); prorab va buxgalter — 0; B admini — H qatorlari yo`q', async () => {
    const dir = await as(H, 'direktor', (tx) => deleted(tx, 'suppliers'))
    const pro = await as(H, 'prorab', (tx) => deleted(tx))
    const bux = await as(H, 'buxgalter', (tx) => deleted(tx))
    const b = await as(B, 'admin', (tx) => deleted(tx))
    expect(dir.map((x) => [x.record_id, x.deleted_by_name])).toEqual([[del.supplier, 'H admin']])
    expect({ pro: pro.length, bux: bux.length }).toEqual({ pro: 0, bux: 0 })
    expect(b.map((x) => x.record_id)).toEqual([del.bSupplier])
  })
})

// ============================================================================
describe('restore_record', () => {
  it('admin tiklaydi — deleted_at null, audit`da RESTORE (admin, veb)', async () => {
    const r = await as(H, 'admin', async (tx) => ({
      res: await restore(tx, 'suppliers', del.supplier!),
      deletedAt: await scalar(tx, `select deleted_at from public.suppliers where id = $1`, [del.supplier]),
      audit: (await feed(tx, { record: del.supplier!, action: 'RESTORE' })).map((x) => [x.actor_name, x.device]),
      gone: (await deleted(tx, 'suppliers')).length,
    }))
    expect(r).toEqual({ res: 'OK:1', deletedAt: null, audit: [['H admin', 'veb']], gone: 0 })
  })

  it('harakat va birlik ham tiklanadi', async () => {
    const r = await as(H, 'admin', async (tx) => [
      await restore(tx, 'movements', del.movement!),
      await restore(tx, 'material_units', del.unit!),
    ])
    expect(r).toEqual(['OK:1', 'OK:1'])
  })

  it('direktor, buxgalter, prorab — restore_admin_only', async () => {
    const out: string[] = []
    for (const role of ['direktor', 'buxgalter', 'prorab'] as const) {
      out.push(await as(H, role, (tx) => restore(tx, 'suppliers', del.supplier!)))
    }
    expect(out).toEqual(Array(3).fill('42501:restore_admin_only'))
  })

  it('noto`g`ri jadval va SQL injection urinishlari — restore_table_invalid', async () => {
    const bad = [
      'movements; drop table x',
      '"movements"',
      'public.movements',
      'Movements',
      'movements ',
      '',
      'audit_log',
      'notification_outbox',
      'alerts',
      'transfers',
      'companies',
      'pg_authid',
    ]
    const r = await as(H, 'admin', async (tx) => {
      const out: string[] = []
      for (const t of bad) out.push(await restore(tx, t, del.supplier!))
      out.push(await restore(tx, null, del.supplier!))
      return out
    })
    expect(r).toEqual(Array(bad.length + 1).fill('22023:restore_table_invalid'))
  })

  it('o`chirilmagan — restore_not_deleted; mavjud emas / boshqa firma — restore_not_found', async () => {
    const r = await as(H, 'admin', async (tx) => ({
      notDeleted: await restore(tx, 'materials', H.ids.m1!),
      random: await restore(tx, 'suppliers', '00000000-0000-4000-8000-000000000001'),
      nullId: await restore(tx, 'suppliers', null),
      otherCo: await restore(tx, 'suppliers', del.bSupplier!),
      otherCoLive: await restore(tx, 'materials', B.ids.m1!),
    }))
    expect(r).toEqual({
      notDeleted: '55000:restore_not_deleted',
      random: 'P0002:restore_not_found',
      nullId: 'P0002:restore_not_found',
      otherCo: 'P0002:restore_not_found',
      otherCoLive: 'P0002:restore_not_found',
    })
    const still = await scalar(db, `select deleted_at is not null from public.suppliers where id = $1`, [del.bSupplier])
    expect(still).toBe(true)
  })

  it('o`tkazma harakati — restore_transfer_movement', async () => {
    const r = await as(H, 'admin', (tx) => restore(tx, 'movements', del.trMovement!))
    expect(r).toBe('55000:restore_transfer_movement')
  })

  it('alias to`qnashuvi — catalog_alias_duplicate (to`g`ridan-to`g`ri va material kaskadi orqali)', async () => {
    const r = await as(H, 'admin', async (tx) => {
      const me = H.users.admin.profileId
      // (a) alias o'chirilib, shu nom boshqa materialga berilgan
      await tx.query(`update public.material_aliases set deleted_at = now() where id = $1`, [H.ids.al1])
      await tx.query(`insert into public.material_aliases (company_id, material_id, alias, created_by) values ($1, $2, 'H Цемент', $3)`, [
        H.id,
        H.ids.m2,
        me,
      ])
      const direct = await restore(tx, 'material_aliases', H.ids.al1!)
      // (b) material o'chirilsa alias kaskad bilan o'chadi; tiklashda to'qnashadi
      const g = await rows<{ id: string }>(
        tx,
        `insert into public.materials (company_id, name, base_unit, created_by) values ($1, 'H gips', 'kg', $2) returning id`,
        [H.id, me],
      )
      const gips = g[0]!.id
      await tx.query(`insert into public.material_aliases (company_id, material_id, alias, created_by) values ($1, $2, 'H Гипс', $3)`, [
        H.id,
        gips,
        me,
      ])
      await tx.query(`update public.materials set deleted_at = now() where id = $1`, [gips])
      await tx.query(`insert into public.material_aliases (company_id, material_id, alias, created_by) values ($1, $2, 'H Гипс', $3)`, [
        H.id,
        H.ids.m2,
        me,
      ])
      const cascade = await restore(tx, 'materials', gips)
      const gipsDeleted = await scalar(tx, `select deleted_at is not null from public.materials where id = $1`, [gips])
      return { direct, cascade, gipsDeleted }
    })
    expect(r).toEqual({
      direct: '23505:catalog_alias_duplicate',
      cascade: '23505:catalog_alias_duplicate',
      gipsDeleted: true,
    })
  })

  it('birlik to`qnashuvi — catalog_unit_duplicate; material nomi — catalog_name_duplicate', async () => {
    const r = await as(H, 'admin', async (tx) => {
      const me = H.users.admin.profileId
      await tx.query(`insert into public.material_units (company_id, material_id, unit, factor, created_by) values ($1, $2, 'tonna', 1000, $3)`, [
        H.id,
        H.ids.m1,
        me,
      ])
      const unit = await restore(tx, 'material_units', del.unit!)
      await tx.query(`update public.materials set deleted_at = now() where id = $1`, [H.ids.m2])
      await tx.query(`insert into public.materials (company_id, name, base_unit, created_by) values ($1, 'H qum', 'm³', $2)`, [H.id, me])
      const name = await restore(tx, 'materials', H.ids.m2!)
      return { unit, name }
    })
    expect(r).toEqual({ unit: '23505:catalog_unit_duplicate', name: '23505:catalog_name_duplicate' })
  })

  it('P1 — smeta: boshqa joriy versiya bor — joriy EMAS holda tiklanadi; bo`lmasa — joriy qoladi', async () => {
    const r = await as(H, 'admin', async (tx) => {
      await tx.query(`update public.estimates set deleted_at = now() where id = $1`, [H.ids.est_obj1])
      await tx.query(`select set_config('terron.estimate_rpc', 'on', true)`)
      await tx.query(
        `insert into public.estimates (company_id, object_id, version, title, is_current, created_by)
         values ($1, $2, 2, 'Smeta 2', true, $3)`,
        [H.id, H.ids.obj1, H.users.admin.profileId],
      )
      await tx.query(`select set_config('terron.estimate_rpc', 'off', true)`)
      const res1 = await restore(tx, 'estimates', H.ids.est_obj1!)
      const st = await rows(
        tx,
        `select version, is_current, deleted_at is null as live from public.estimates where object_id = $1 order by version`,
        [H.ids.obj1],
      )
      await tx.query(`update public.estimates set deleted_at = now() where id = $1`, [H.ids.est_obj2])
      const res2 = await restore(tx, 'estimates', H.ids.est_obj2!)
      const cur2 = await scalar(tx, `select is_current from public.estimates where id = $1`, [H.ids.est_obj2])
      const guc = await scalar(tx, `select coalesce(current_setting('terron.estimate_rpc', true), '')`)
      return { res1, st, res2, cur2, guc }
    })
    expect(r).toEqual({
      res1: 'OK:1',
      st: [
        { version: 1, is_current: false, live: true },
        { version: 2, is_current: true, live: true },
      ],
      res2: 'OK:1',
      cur2: true,
      guc: 'off',
    })
  })

  it('hint`siz unique to`qnashuv (profil telefoni) — restore_conflict', async () => {
    const r = await as(H, 'admin', async (tx) => {
      const me = H.users.admin.profileId
      const p = await rows<{ id: string }>(
        tx,
        `insert into public.profiles (company_id, role, full_name, phone, created_by)
         values ($1, 'prorab', 'H eski prorab', '+998901112233', $2) returning id`,
        [H.id, me],
      )
      await tx.query(`update public.profiles set deleted_at = now() where id = $1`, [p[0]!.id])
      await tx.query(
        `insert into public.profiles (company_id, role, full_name, phone, created_by)
         values ($1, 'prorab', 'H yangi prorab', '+998901112233', $2)`,
        [H.id, me],
      )
      return restore(tx, 'profiles', p[0]!.id)
    })
    expect(r).toBe('23505:restore_conflict')
  })
})

// ============================================================================
// Review tuzatishlari
// ============================================================================
const ADMIN = (): string => H.users.admin.profileId

async function insId(tx: Queryable, sql: string, params: unknown[]): Promise<string> {
  const r = await rows<{ id: string }>(tx, `${sql} returning id`, params)
  return r[0]!.id
}

const purchaseSql = `insert into public.purchases
  (company_id, buyer_id, object_id, material_id, qty_input, unit_input, qty_base, unit_price, total_amount, purchased_at, created_by)
  values ($1, $2, $3, $4, $5, 'kg', 0, 0, $6, $7::timestamptz, $2)`
const movementSql = `insert into public.movements
  (company_id, type, object_id, material_id, qty_input, unit_input, qty_base, occurred_at, purchase_id, created_by)
  values ($1, $2::public.movement_type, $3, $4, $5, 'kg', 0, $6::timestamptz, $7, $8)`

/** Alertlar (admin RLS) — tur bo'yicha holatlar. */
const alertsOf = (tx: Queryable, where: string, params: unknown[]): Promise<Row[]> =>
  rows(tx, `select type::text as type, status::text as status, severity::text as severity, details
              from public.alerts where ${where} order by created_at, type`, params)

describe('O1 — o`chirilgan xaridga bog`langan yozuvni tiklash', () => {
  it('kirim va so`rov: bog`langan xarid o`chirilgan → purchase_not_open; xarid tiklangach — OK', async () => {
    const r = await as(H, 'admin', async (tx) => {
      const p = await insId(tx, purchaseSql, [H.id, ADMIN(), H.ids.obj2, H.ids.m1, 10, 12000, new Date().toISOString()])
      const k = await insId(tx, movementSql, [H.id, 'kirim', H.ids.obj2, H.ids.m1, 10, new Date().toISOString(), p, ADMIN()])
      const rq = await insId(
        tx,
        `insert into public.material_requests (company_id, object_id, material_id, qty_input, unit_input, qty_base, status, purchase_id, created_by)
         values ($1, $2, $3, 10, 'kg', 0, 'xarid_qilindi', $4, $5)`,
        [H.id, H.ids.obj2, H.ids.m1, p, ADMIN()],
      )
      await tx.query(`update public.material_requests set deleted_at = now() where id = $1`, [rq])
      await tx.query(`update public.movements set deleted_at = now() where id = $1`, [k])
      await tx.query(`update public.purchases set deleted_at = now() where id = $1`, [p])
      return {
        kirim: await restore(tx, 'movements', k),
        request: await restore(tx, 'material_requests', rq),
        // to'g'ridan-to'g'ri UPDATE ham (RPC'siz yo'l)
        direct: await res(tx, `update public.movements set deleted_at = null where id = $1`, [k]),
        purchase: await restore(tx, 'purchases', p),
        kirimAfter: await restore(tx, 'movements', k),
        requestAfter: await restore(tx, 'material_requests', rq),
      }
    })
    expect(r).toEqual({
      kirim: '23503:purchase_not_open',
      request: '23503:purchase_not_open',
      direct: '23503:purchase_not_open',
      purchase: 'OK:1',
      kirimAfter: 'OK:1',
      requestAfter: 'OK:1',
    })
  })
})

describe('O2 — profil tiklanishi', () => {
  let linked = ''
  beforeAll(async () => {
    const u = await createUser(db, { companyId: H.id, role: 'prorab', phone: '+998905556677', fullName: 'H bog`langan' })
    linked = u.profileId
    await db.query(
      `update public.profiles set telegram_user_id = 777001, telegram_chat_id = 777001, login_kind = 'tg' where id = $1`,
      [linked],
    )
  })

  const state = (tx: Queryable): Promise<Row> =>
    rows(
      tx,
      `select auth_user_id is null as no_auth, telegram_user_id, telegram_chat_id, login_kind, is_active, deleted_at is null as live
         from public.profiles where id = $1`,
      [linked],
    ).then((x) => x[0]!)

  it('admin tiklaydi: bog`lanishlar null, login_kind none, is_active false; audit`da RESTORE', async () => {
    const r = await as(H, 'admin', async (tx) => {
      await tx.query(`update public.profiles set deleted_at = now() where id = $1`, [linked])
      const res1 = await restore(tx, 'profiles', linked)
      return {
        res1,
        st: await state(tx),
        audit: (await feed(tx, { record: linked, action: 'RESTORE' })).map((x) => x.changed_fields?.slice().sort()),
        // ustun grantlari o'zgarmagan: admin bog'lanish ustunlariga yoza olmaydi
        grant: await res(tx, `update public.profiles set telegram_user_id = 1 where id = $1`, [linked]),
      }
    })
    expect(r).toEqual({
      res1: 'OK:1',
      st: { no_auth: true, telegram_user_id: null, telegram_chat_id: null, login_kind: 'none', is_active: false, live: true },
      audit: [['auth_user_id', 'deleted_at', 'is_active', 'login_kind', 'telegram_chat_id', 'telegram_user_id']],
      grant: '42501:',
    })
  })

  it('service_role tiklasa ham bog`lanish uziladi; oddiy UPDATE (tiklash emas) — tegmaydi', async () => {
    const r = await asService(db, async (tx) => {
      const untouched = await state(tx)
      await tx.query(`update public.profiles set deleted_at = now() where id = $1`, [linked])
      await tx.query(`update public.profiles set deleted_at = null where id = $1`, [linked])
      return { untouched, after: await state(tx) }
    })
    expect(r).toEqual({
      untouched: { no_auth: false, telegram_user_id: 777001, telegram_chat_id: 777001, login_kind: 'tg', is_active: true, live: true },
      after: { no_auth: true, telegram_user_id: null, telegram_chat_id: null, login_kind: 'none', is_active: false, live: true },
    })
  })
})

describe('O3 / P7 — tiklash signali va qoida zanjirlari', () => {
  it('xarid tiklanganda: qoida 1–3 qayta baholanadi, yozuv_ochirildi yopiladi, yozuv_tiklandi yaratiladi (+ bot navbati)', async () => {
    const r = await as(H, 'admin', async (tx) => {
      const now = new Date()
      const twoDays = new Date(now.getTime() - 2 * 86400_000).toISOString()
      // Pa: narx yuqori (10 000/kg, fixture o'rtachasi 1 200/kg) — qoida 3; admin kirimi — qoida 2
      const pa = await insId(tx, purchaseSql, [H.id, ADMIN(), H.ids.obj2, H.ids.m1, 10, 100000, now.toISOString()])
      await insId(tx, movementSql, [H.id, 'kirim', H.ids.obj2, H.ids.m1, 10, now.toISOString(), null, ADMIN()])
      // Pb: 2 kun oldin, qabul yo'q — qoida 1 (under)
      const pb = await insId(tx, purchaseSql, [H.id, ADMIN(), H.ids.obj3, H.ids.m1, 10, 12000, twoDays])
      const before = await alertsOf(tx, `purchase_id = $1 and status in ('yangi', 'korildi')`, [pa])

      await tx.query(`update public.purchases set deleted_at = now() where id = any ($1::uuid[])`, [[pa, pb]])
      const afterDel = await alertsOf(tx, `purchase_id = any ($1::uuid[]) and status in ('yangi', 'korildi')`, [[pa, pb]])

      const ra = await restore(tx, 'purchases', pa)
      const rb = await restore(tx, 'purchases', pb)
      const openA = await alertsOf(tx, `purchase_id = $1 and status in ('yangi', 'korildi')`, [pa])
      const openB = await alertsOf(tx, `purchase_id = $1 and status in ('yangi', 'korildi')`, [pb])
      const closedDel = await alertsOf(tx, `type = 'yozuv_ochirildi' and details ->> 'record_id' = $1`, [pa])
      const expSev = await scalar<string>(
        tx,
        `select case when ($1::timestamptz at time zone 'Asia/Tashkent')::date
                          < date_trunc('month', now() at time zone 'Asia/Tashkent')::date
                     then 'jiddiy' else 'ogohlantirish' end`,
        [twoDays],
      )
      await tx.exec('reset role')
      const outbox = await scalar<number>(
        tx,
        `select count(*)::int from public.notification_outbox o
           join public.alerts a on a.id = o.alert_id
          where a.type::text = 'yozuv_tiklandi' and a.purchase_id = any ($1::uuid[])`,
        [[pa, pb]],
      )
      const stats = await scalar<Row>(tx, `select private.daily_report_stats($1, now() - interval '1 day', now() + interval '1 day')`, [H.id])
      return { before, afterDel, ra, rb, openA, openB, closedDel, expSev, outbox, stats }
    })
    const types = (x: Row[]): string[] => x.map((a) => a.type as string).sort()
    expect(types(r.before)).toEqual(['narx_ogishi', 'ozi_qabul_qilgan'])
    expect(types(r.afterDel)).toEqual(['yozuv_ochirildi', 'yozuv_ochirildi'])
    expect({ ra: r.ra, rb: r.rb }).toEqual({ ra: 'OK:1', rb: 'OK:1' })
    expect(types(r.openA)).toEqual(['narx_ogishi', 'ozi_qabul_qilgan', 'yozuv_tiklandi'])
    // audit3 D6: tiklash — zanjir rejimi, yangi xarid_qabul_farqi ni soatlik cron yaratadi (kutish kiritilgan vaqtdan)
    expect(types(r.openB)).toEqual(['yozuv_tiklandi'])
    expect(r.closedDel).toEqual([
      expect.objectContaining({ status: 'yopildi', details: expect.objectContaining({ closed_reason: 'restored', auto_closed: true }) }),
    ])
    const tA = r.openA.find((a) => a.type === 'yozuv_tiklandi')!
    const tB = r.openB.find((a) => a.type === 'yozuv_tiklandi')!
    expect(tA).toMatchObject({ severity: 'ogohlantirish' })
    expect(tA.details).toEqual({
      table: 'purchases',
      record_id: expect.any(String),
      actor_profile_id: ADMIN(),
      actor_name: 'H admin',
      material_name: 'H sement',
      amount: 100000,
      qty_base: 10,
      base_unit: 'kg',
      buyer_name: 'H admin',
      recipient_name: null,
      movement_type: null,
      occurred_at: expect.any(String),
      deleted_at_before: expect.any(String),
      days_since: 0,
    })
    expect(tB).toMatchObject({ severity: r.expSev })
    expect(r.outbox).toBe(2)
    expect(r.stats).toMatchObject({ restored_count: 2 })
  })

  it('podotchet: o`chirilganiga ≥ 7 kun → jiddiy; yozuv sanasi o`tgan oyda → jiddiy; recipient_name, amount', async () => {
    const ca = (await insertRow<{ id: string }>(db, 'cash_advances', {
      company_id: H.id,
      recipient_id: H.users.haydovchi.profileId,
      amount: '250000',
    })).id
    await db.exec(`set session_replication_role = replica`)
    try {
      await db.query(`update public.cash_advances set deleted_at = now() - interval '10 days' where id = $1`, [ca])
    } finally {
      await db.exec(`set session_replication_role = origin`)
    }
    const r = await as(H, 'admin', async (tx) => {
      const old = await restore(tx, 'cash_advances', ca)
      const oldMonth = await insId(
        tx,
        `insert into public.cash_advances (company_id, recipient_id, amount, issued_at, created_by)
         values ($1, $2, 1000, now() - interval '45 days', $3)`,
        [H.id, H.users.haydovchi.profileId, ADMIN()],
      )
      await tx.query(`update public.cash_advances set deleted_at = now() where id = $1`, [oldMonth])
      const om = await restore(tx, 'cash_advances', oldMonth)
      const mv = await insId(tx, movementSql, [H.id, 'kirim', H.ids.obj2, H.ids.m1, 3, new Date().toISOString(), null, ADMIN()])
      await tx.query(`update public.movements set deleted_at = now() where id = $1`, [mv])
      const rm = await restore(tx, 'movements', mv)
      const t = (id: string): Promise<Row[]> =>
        alertsOf(tx, `type::text = 'yozuv_tiklandi' and details ->> 'record_id' = $1`, [id])
      return { old, om, rm, a1: await t(ca), a2: await t(oldMonth), a3: await t(mv) }
    })
    expect({ old: r.old, om: r.om, rm: r.rm }).toEqual({ old: 'OK:1', om: 'OK:1', rm: 'OK:1' })
    expect(r.a1).toEqual([
      expect.objectContaining({
        severity: 'jiddiy',
        details: expect.objectContaining({
          table: 'cash_advances',
          days_since: 10,
          amount: 250000,
          recipient_name: 'H haydovchi',
          buyer_name: null,
          qty_base: null,
          material_name: null,
        }),
      }),
    ])
    expect(r.a2).toEqual([expect.objectContaining({ severity: 'jiddiy', details: expect.objectContaining({ days_since: 0 }) })])
    expect(r.a3).toEqual([
      expect.objectContaining({
        severity: 'ogohlantirish',
        details: expect.objectContaining({ table: 'movements', movement_type: 'kirim', qty_base: 3, base_unit: 'kg', amount: null }),
      }),
    ])
  })

  it('chiqim tiklanganda norma qayta baholanadi (normadan_oshish qaytadi)', async () => {
    const r = await as(H, 'admin', async (tx) => {
      const ch = await insId(tx, movementSql, [H.id, 'chiqim', H.ids.obj1, H.ids.m1, 5000, new Date().toISOString(), null, ADMIN()])
      const open = (): Promise<number> =>
        scalar<number>(
          tx,
          `select count(*)::int from public.alerts where type::text = 'normadan_oshish' and object_id = $1
              and material_id = $2 and status in ('yangi', 'korildi')`,
          [H.ids.obj1, H.ids.m1],
        )
      const a = await open()
      await tx.query(`update public.movements set deleted_at = now() where id = $1`, [ch])
      const b = await open()
      const res1 = await restore(tx, 'movements', ch)
      return { a, b, res1, c: await open() }
    })
    expect(r).toEqual({ a: 1, b: 0, res1: 'OK:1', c: 1 })
  })

  it('podotchet oluvchisi nofaol — cash_recipient_role', async () => {
    const r = await as(H, 'admin', async (tx) => {
      await tx.query(`update public.cash_advances set deleted_at = now() where id = $1`, [H.ids.ca_haydovchi])
      await tx.query(`update public.profiles set is_active = false where id = $1`, [H.users.haydovchi.profileId])
      return restore(tx, 'cash_advances', H.ids.ca_haydovchi!)
    })
    expect(r).toBe('P0001:cash_recipient_role')
  })
})

describe('P2 — eski inventarizatsiyani qo`llash', () => {
  it('submitted_at: insert/submit da serverda, foydalanuvchi o`zgartira olmaydi', async () => {
    const r = await as(H, 'tekshiruvchi', async (tx) => {
      const c = await insId(tx, `insert into public.inventory_counts (company_id, object_id, created_by) values ($1, $2, $3)`, [
        H.id,
        H.ids.obj3,
        H.users.tekshiruvchi.profileId,
      ])
      await tx.query(`update public.inventory_counts set submitted_at = now() - interval '30 days' where id = $1`, [c])
      const draft = await scalar(tx, `select submitted_at from public.inventory_counts where id = $1`, [c])
      await tx.query(`select public.submit_inventory_count($1)`, [c])
      const sub = await scalar<boolean>(tx, `select submitted_at = now() from public.inventory_counts where id = $1`, [c])
      return { draft, sub }
    })
    expect(r).toEqual({ draft: null, sub: true })
  })

  it('7 kundan eski — inventory_apply_expired; 6 kunlik — qo`llanadi', async () => {
    const mk = async (days: number): Promise<string> => {
      const id = (await insertRow<{ id: string }>(db, 'inventory_counts', {
        company_id: H.id,
        object_id: H.ids.obj3,
        status: 'submitted',
      })).id
      await db.exec(`set session_replication_role = replica`)
      try {
        await db.query(`update public.inventory_counts set submitted_at = now() - make_interval(days => $2) where id = $1`, [id, days])
      } finally {
        await db.exec(`set session_replication_role = origin`)
      }
      return id
    }
    const old = await mk(8)
    const fresh = await mk(6)
    const r = await as(H, 'admin', async (tx) => ({
      old: await res(tx, `select public.apply_inventory_adjustments($1)`, [old]),
      fresh: await res(tx, `select public.apply_inventory_adjustments($1)`, [fresh]),
    }))
    expect(r).toEqual({ old: '55000:inventory_apply_expired', fresh: 'OK:1' })
  })
})

describe('O4 — audit_feed samaradorligi (2 firma × 20 000 audit qatori)', () => {
  const REC = '00000000-0000-4000-8000-0000000000aa'
  beforeAll(async () => {
    for (const co of [H.id, B.id]) {
      await db.query(
        `insert into public.audit_log (company_id, table_name, record_id, action, new_data, device, created_at)
         select $1::uuid, 'movements', case when g % 1000 = 0 then $2::uuid else gen_random_uuid() end, 'UPDATE',
                jsonb_build_object('company_id', $1::uuid), 'veb',
                '2025-01-01T00:00:00Z'::timestamptz + make_interval(mins => g)
           from generate_series(1, 20000) g`,
        [co, REC],
      )
    }
    await db.exec(`analyze public.audit_log`)
  })

  const plan = (tx: Queryable, extra: string, params: unknown[]): Promise<string> =>
    rows<{ 'QUERY PLAN': string }>(
      tx,
      `explain select a.id from public.audit_log a  -- audit_feed dinamik SQL'i bilan bir xil
        where a.created_at >= '2025-01-01T00:00:00Z' and a.created_at < '2025-02-01T00:00:00Z'
          and a.company_id >= $1 and a.company_id <= $1 ${extra}
        order by a.company_id, a.id desc limit 50`,
      params,
    ).then((x) => x.map((l) => l['QUERY PLAN']).join('\n'))

  it('firma bo`yicha — company indeksidan, seq scan yo`q; yozuv bo`yicha — (company_id, record_id, id) indeksi', async () => {
    const r = await as(H, 'admin', async (tx) => ({
      all: await plan(tx, '', [H.id]),
      rec: await plan(tx, 'and a.record_id = $2', [H.id, REC]),
      feed: (await feed(tx, { from: '2025-01-01', to: '2025-01-31', limit: 50 })).length,
      feedRec: (await feed(tx, { from: '2025-01-01', to: '2025-01-31', record: REC, limit: 200 })).map((x) => x.record_id),
    }))
    expect(r.all).toMatch(/Index Scan using audit_log_company_id_idx on audit_log/)
    expect(r.all).not.toMatch(/Seq Scan on audit_log/)
    expect(r.rec).toMatch(/Index Scan using audit_log_company_record_id_idx on audit_log/)
    expect(r.feed).toBe(50)
    expect(r.feedRec).toEqual(Array(20).fill(REC))
  })
})
