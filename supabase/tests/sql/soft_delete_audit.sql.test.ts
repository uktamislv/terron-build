// Soft delete, tiklash, o'zgarmas ustunlar va audit_log.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { asService, asUser, createDb, one, rows, scalar, tryQuery, type Db, type Tx } from './_harness'
import { BUSINESS_TABLES, buildTwoCompanies, targetId, tryExec, type CompanyFixture } from './_fixtures'

let db: Db
let A: CompanyFixture

beforeAll(async () => {
  db = await createDb()
  A = (await buildTwoCompanies(db)).A
})
afterAll(async () => {
  await db?.close()
})

interface AuditRow {
  action: string
  table_name: string
  record_id: string
  company_id: string
  actor_profile_id: string | null
  actor_auth_uid: string | null
  device: string | null
  changed_fields: string[] | null
  old_data: Record<string, unknown> | null
  new_data: Record<string, unknown> | null
}

const auditFor = (id: string): Promise<AuditRow[]> =>
  rows<AuditRow>(db, `select * from public.audit_log where record_id = $1 order by id`, [id])

/** admin nomidan (commit) yangi supplier — har test o'z qatori bilan. */
async function newSupplier(name: string, device: string | null = 'veb'): Promise<string> {
  return asUser(
    db,
    A.users.admin.authUid,
    (tx) =>
      tx
        .query<{ id: string }>(`insert into public.suppliers (company_id, name) values ($1, $2) returning id`, [A.id, name])
        .then((r) => r.rows[0]!.id),
    { commit: true, device },
  )
}

describe('DELETE taqiqlangan', () => {
  it.each([...BUSINESS_TABLES])('%s: authenticated (admin) — 42501', async (t) => {
    const r = await asUser(db, A.users.admin.authUid, (tx) =>
      tryExec(tx, `delete from public.${t} where id = $1`, [targetId(A, t)]),
    )
    expect(r.ok ? r.affected : r.code).toBe('42501')
  })

  it.each([...BUSINESS_TABLES])('%s: service_role — 42501 (trigger)', async (t) => {
    const r = await asService(db, (tx) => tryExec(tx, `delete from public.${t} where id = $1`, [targetId(A, t)]))
    expect(r.ok ? r.affected : r.code).toBe('42501')
    if (!r.ok) expect(r.msg).toMatch(/soft delete only/)
  })

  it('superuser (migratsiya egasi) ham DELETE qila olmaydi', async () => {
    const r = await tryQuery(db, `delete from public.materials where id = $1`, [A.ids.m1])
    expect(r.ok ? 'OK' : r.code).toBe('42501')
  })
})

describe('soft delete va tiklash', () => {
  it('admin soft delete qiladi: prorab ko`rmaydi, admin va direktor ko`radi; admin tiklaydi', async () => {
    const id = await newSupplier('O`chiriladigan')
    await asUser(db, A.users.admin.authUid, (tx) => tx.query(`update public.suppliers set deleted_at = now() where id = $1`, [id]), {
      commit: true,
    })
    const visible = async (role: 'prorab' | 'admin' | 'direktor' | 'buxgalter'): Promise<number> =>
      asUser(db, A.users[role].authUid, (tx) => scalar<number>(tx, `select count(*)::int from public.suppliers where id = $1`, [id]))
    expect({
      prorab: await visible('prorab'),
      buxgalter: await visible('buxgalter'),
      admin: await visible('admin'),
      direktor: await visible('direktor'),
    }).toEqual({ prorab: 0, buxgalter: 0, admin: 1, direktor: 1 })

    const restored = await asUser(
      db,
      A.users.admin.authUid,
      (tx) => tryExec(tx, `update public.suppliers set deleted_at = null where id = $1`, [id]),
      { commit: true },
    )
    expect(restored.ok ? restored.affected : restored.code).toBe(1)
    expect(await visible('prorab')).toBe(1)

    const actions = (await auditFor(id)).map((a) => a.action)
    expect(actions).toEqual(['INSERT', 'SOFT_DELETE', 'RESTORE'])
  })

  it('tiklashni faqat admin qiladi: buxgalter (cash_advances ni o`zgartira oladi) tiklay olmaydi', async () => {
    const id = await scalar<string>(
      db,
      `insert into public.cash_advances (company_id, recipient_id, amount) values ($1, $2, 1000) returning id`,
      [A.id, A.users.haydovchi.profileId],
    )
    // buxgalter soft delete qila oladi
    const del = await asUser(
      db,
      A.users.buxgalter.authUid,
      (tx) => tryExec(tx, `update public.cash_advances set deleted_at = now() where id = $1`, [id]),
      { commit: true },
    )
    expect(del.ok ? del.affected : del.code).toBe(1)
    // lekin tiklay olmaydi
    const res = await asUser(db, A.users.buxgalter.authUid, (tx) =>
      tryExec(tx, `update public.cash_advances set deleted_at = null where id = $1`, [id]),
    )
    expect(res.ok ? res.affected : res.code).toBe('42501')
    // admin tiklaydi
    const adm = await asUser(db, A.users.admin.authUid, (tx) =>
      tryExec(tx, `update public.cash_advances set deleted_at = null where id = $1`, [id]),
    )
    expect(adm.ok ? adm.affected : adm.code).toBe(1)
  })

  it('o`chirilgan movements qatorini prorab ko`rmaydi, direktor ko`radi', async () => {
    const id = await scalar<string>(
      db,
      `insert into public.movements (company_id, type, object_id, material_id, qty_input, unit_input, qty_base, deleted_at)
       values ($1, 'chiqim', $2, $3, 1, 'kg', 1, now()) returning id`,
      [A.id, A.ids.obj1, A.ids.m1],
    )
    const see = async (role: 'prorab' | 'omborchi' | 'direktor' | 'admin'): Promise<number> =>
      asUser(db, A.users[role].authUid, (tx) => scalar<number>(tx, `select count(*)::int from public.movements where id = $1`, [id]))
    expect([await see('prorab'), await see('omborchi'), await see('direktor'), await see('admin')]).toEqual([0, 0, 1, 1])
  })
})

describe('o`zgarmas ustunlar (UPDATE trigger)', () => {
  const cols: Array<[string, string]> = [
    ['company_id', `company_id = gen_random_uuid()`],
    ['created_by', `created_by = '${'00000000-0000-0000-0000-000000000000'}'`],
    ['created_at', `created_at = now() - interval '1 day'`],
    ['id', `id = gen_random_uuid()`],
  ]
  it.each(cols)('%s — admin o`zgartira olmaydi', async (_c, set) => {
    const r = await asUser(db, A.users.admin.authUid, (tx) =>
      tryExec(tx, `update public.materials set ${set} where id = $1`, [A.ids.m1]),
    )
    expect(r.ok ? r.affected : r.code).toBe('42501')
  })
  it.each(cols)('%s — service_role ham o`zgartira olmaydi', async (_c, set) => {
    const r = await asService(db, (tx) => tryExec(tx, `update public.materials set ${set} where id = $1`, [A.ids.m1]))
    expect(r.ok ? r.affected : r.code).toBe('42501')
  })

  it('created_by, created_at insert`da server qiymati: created_at soxta qiymat bilan bo`lmaydi', async () => {
    const r = await asUser(db, A.users.admin.authUid, (tx) =>
      one<{ old: boolean }>(
        tx,
        `insert into public.suppliers (company_id, name, created_at, updated_at)
         values ($1, 'Vaqt', '2000-01-01', '2000-01-01') returning created_at < '2001-01-01' as old`,
        [A.id],
      ),
    )
    expect(r.old).toBe(false)
  })
})

describe('audit_log', () => {
  it('INSERT: actor_profile_id, actor_auth_uid, device = veb, company_id', async () => {
    const id = await newSupplier('Audit veb', 'veb')
    const [a] = await auditFor(id)
    expect(a).toMatchObject({
      action: 'INSERT',
      table_name: 'suppliers',
      company_id: A.id,
      actor_profile_id: A.users.admin.profileId,
      actor_auth_uid: A.users.admin.authUid,
      device: 'veb',
      old_data: null,
    })
    expect(a!.new_data).toMatchObject({ id, name: 'Audit veb' })
  })

  it('UPDATE: device = mobil, changed_fields, old/new', async () => {
    const id = await newSupplier('Audit mobil')
    await asUser(
      db,
      A.users.admin.authUid,
      (tx) => tx.query(`update public.suppliers set name = 'Yangi nom', note = 'izoh' where id = $1`, [id]),
      { commit: true, device: 'mobil' },
    )
    const a = (await auditFor(id)).at(-1)!
    expect(a).toMatchObject({ action: 'UPDATE', device: 'mobil', changed_fields: ['name', 'note'] })
    expect(a.old_data).toMatchObject({ name: 'Audit mobil' })
    expect(a.new_data).toMatchObject({ name: 'Yangi nom', note: 'izoh' })
  })

  it('noto`g`ri device sarlavhasi → null; sarlavha yo`q → null', async () => {
    const bad = await newSupplier('Audit bad', 'desktop')
    const none = await newSupplier('Audit none', null)
    expect([(await auditFor(bad))[0]!.device, (await auditFor(none))[0]!.device]).toEqual([null, null])
  })

  it('service_role → device = tizim, actor null', async () => {
    const id = await newSupplier('Audit tizim')
    await asService(db, (tx) => tx.query(`update public.suppliers set note = 'tizim' where id = $1`, [id]), { commit: true })
    const a = (await auditFor(id)).at(-1)!
    expect(a).toMatchObject({ action: 'UPDATE', device: 'tizim', actor_profile_id: null, actor_auth_uid: null })
  })

  it('faqat updated_at o`zgargan UPDATE yozilmaydi', async () => {
    const id = await newSupplier('Audit noop')
    await asUser(db, A.users.admin.authUid, (tx) => tx.query(`update public.suppliers set updated_at = now() where id = $1`, [id]), {
      commit: true,
    })
    expect((await auditFor(id)).map((a) => a.action)).toEqual(['INSERT'])
  })

  it('SOFT_DELETE va RESTORE changed_fields = [deleted_at]', async () => {
    const id = await newSupplier('Audit sd')
    for (const v of ['now()', 'null']) {
      await asUser(db, A.users.admin.authUid, (tx) => tx.query(`update public.suppliers set deleted_at = ${v} where id = $1`, [id]), {
        commit: true,
      })
    }
    const a = await auditFor(id)
    expect(a.map((x) => [x.action, x.changed_fields])).toEqual([
      ['INSERT', null],
      ['SOFT_DELETE', ['deleted_at']],
      ['RESTORE', ['deleted_at']],
    ])
  })

  it('companies auditida company_id = firma id', async () => {
    await asUser(db, A.users.admin.authUid, (tx) => tx.query(`update public.companies set name = 'A yangi' where id = $1`, [A.id]), {
      commit: true,
    })
    const a = (await auditFor(A.id)).at(-1)!
    expect(a).toMatchObject({ action: 'UPDATE', table_name: 'companies', company_id: A.id, changed_fields: ['name'] })
  })

  it('seed/superuser (auth.uid() yo`q) → device = tizim', async () => {
    const [a] = await auditFor(A.ids.m1!)
    expect(a).toMatchObject({ action: 'INSERT', device: 'tizim', actor_profile_id: null })
  })

  it('audit_log ni hech kim o`zgartira / o`chira olmaydi', async () => {
    const sqls = [
      `update public.audit_log set action = 'INSERT' where company_id = '${A.id}'`,
      `delete from public.audit_log where company_id = '${A.id}'`,
      `insert into public.audit_log (company_id, table_name, record_id, action) values ('${A.id}', 'x', gen_random_uuid(), 'INSERT')`,
      `truncate public.audit_log`,
    ]
    const out: Record<string, unknown[]> = {}
    const attempt = async (tx: Tx): Promise<unknown[]> => {
      const res: unknown[] = []
      for (const sql of sqls) {
        const r = await tryExec(tx, sql)
        res.push(r.ok ? r.affected : r.code)
      }
      return res
    }
    out.admin = await asUser(db, A.users.admin.authUid, attempt)
    out.service_role = await asService(db, attempt)
    // superuser (postgres): UPDATE/DELETE trigger bilan bloklangan
    const su: unknown[] = []
    for (const sql of sqls.slice(0, 2)) {
      const r = await tryQuery(db, sql)
      su.push(r.ok ? 'OK' : r.code)
    }
    out.superuser = su
    expect(out).toEqual({
      admin: ['42501', '42501', '42501', '42501'],
      service_role: ['42501', '42501', '42501', '42501'],
      superuser: ['42501', '42501'],
    })
  })
})
