// Firma ajratish: A firma foydalanuvchilari B firma ma'lumotini ko'rmaydi,
// unga yoza olmaydi va kompozit FK orqali B qatorlariga bog'lana olmaydi.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { asUser, createDb, scalar, tryQuery, type Db } from './_harness'
import {
  ALL_RELATIONS,
  BUSINESS_TABLES,
  buildTwoCompanies,
  companyCol,
  insertCase,
  ROLES,
  targetId,
  tryExec,
  type TwoCompanies,
} from './_fixtures'

let db: Db
let F: TwoCompanies

beforeAll(async () => {
  db = await createDb()
  F = await buildTwoCompanies(db)
})
afterAll(async () => {
  await db?.close()
})

const NON_SUPER = ROLES.filter((r) => r !== 'super_admin')

// Batch 5: alerts'da authenticated faqat status va close_note ni o'zgartiradi (ustun grant).
const setClause = (t: string): string => (t === 'alerts' ? 'status = status' : 'updated_at = now()')

describe('A firma foydalanuvchisi B firma qatorlarini ko`rmaydi', () => {
  it.each(NON_SUPER)('%s: hech bir jadval/view da B qatori yo`q', async (role) => {
    const seen = await asUser(db, F.A.users[role].authUid, async (tx) => {
      const out: Record<string, number> = {}
      for (const t of ALL_RELATIONS) {
        out[t] = await scalar<number>(
          tx,
          `select count(*)::int from public.${t} where ${companyCol(t)} = $1`,
          [F.B.id],
        )
      }
      return out
    })
    expect(seen).toEqual(Object.fromEntries(ALL_RELATIONS.map((t) => [t, 0])))
  })

  it('super_admin (A) ikkala firmani ko`radi', async () => {
    const seen = await asUser(db, F.A.users.super_admin.authUid, async (tx) => {
      const out: Record<string, boolean> = {}
      for (const t of ALL_RELATIONS) {
        const n = await scalar<number>(tx, `select count(*)::int from public.${t} where ${companyCol(t)} = $1`, [F.B.id])
        out[t] = n > 0
      }
      return out
    })
    expect(seen).toEqual(Object.fromEntries(ALL_RELATIONS.map((t) => [t, true])))
  })
})

describe('A firma foydalanuvchisi B firmaga yoza olmaydi', () => {
  it.each(NON_SUPER)('%s: B firmaga insert (company_id = B) — 42501', async (role) => {
    const me = F.A.users[role]
    const res = await asUser(db, me.authUid, async (tx) => {
      const out: Record<string, string | null> = {}
      for (const t of BUSINESS_TABLES) {
        if (t === 'companies') continue // company_id ustuni yo'q; companies insert alohida (rol matritsasi)
        const c = insertCase(t, F.B, me.profileId)
        const r = await tryQuery(tx, c.sql, c.params)
        out[t] = r.ok ? 'OK' : r.code
      }
      return out
    })
    const expected = Object.fromEntries(BUSINESS_TABLES.filter((t) => t !== 'companies').map((t) => [t, '42501']))
    expect(res).toEqual(expected)
  })

  it.each(NON_SUPER)('%s: B qatorini update — 0 qator', async (role) => {
    const res = await asUser(db, F.A.users[role].authUid, async (tx) => {
      const out: Record<string, number | string> = {}
      for (const t of BUSINESS_TABLES) {
        const r = await tryExec(tx, `update public.${t} set ${setClause(t)} where id = $1`, [targetId(F.B, t)])
        out[t] = r.ok ? r.affected : `err ${r.code}`
      }
      return out
    })
    expect(res).toEqual(Object.fromEntries(BUSINESS_TABLES.map((t) => [t, 0])))
  })

  it.each(NON_SUPER)('%s: o`z qatorini B firmaga ko`chira olmaydi (company_id = B)', async (role) => {
    const res = await asUser(db, F.A.users[role].authUid, async (tx) => {
      const out: Record<string, boolean> = {}
      for (const t of BUSINESS_TABLES) {
        if (t === 'companies') continue
        const r = await tryExec(tx, `update public.${t} set company_id = $2 where id = $1`, [targetId(F.A, t), F.B.id])
        out[t] = r.ok && r.affected > 0
      }
      return out
    })
    expect(Object.values(res).every((v) => v === false)).toBe(true)
  })
})

describe('kompozit FK: A yozuvi B materiali/obyekti/profiliga bog`lanmaydi (23503)', () => {
  // admin (A) nomidan: RLS o'tadi (company_id = A), FK yiqitadi.
  const cases: Array<[string, () => { sql: string; params: unknown[] }]> = [
    [
      'movements → B material',
      () => ({
        sql: `insert into public.movements (company_id, type, object_id, material_id, qty_input, unit_input, qty_base, created_by)
              values ($1, 'kirim', $2, $3, 1, 'kg', 1, $4)`,
        params: [F.A.id, F.A.ids.obj1, F.B.ids.m1, F.A.users.admin.profileId],
      }),
    ],
    [
      'movements → B obyekt',
      () => ({
        sql: `insert into public.movements (company_id, type, object_id, material_id, qty_input, unit_input, qty_base, created_by)
              values ($1, 'kirim', $2, $3, 1, 'kg', 1, $4)`,
        params: [F.A.id, F.B.ids.obj1, F.A.ids.m1, F.A.users.admin.profileId],
      }),
    ],
    [
      'movements → B xarid',
      () => ({
        sql: `insert into public.movements (company_id, type, object_id, material_id, qty_input, unit_input, qty_base,
                purchase_id, created_by)
              values ($1, 'kirim', $2, $3, 1, 'kg', 1, $4, $5)`,
        params: [F.A.id, F.A.ids.obj1, F.A.ids.m1, F.B.ids.p_pro_obj1, F.A.users.admin.profileId],
      }),
    ],
    [
      'cash_advances → B profil',
      () => ({
        sql: `insert into public.cash_advances (company_id, recipient_id, amount, created_by) values ($1, $2, 1, $3)`,
        params: [F.A.id, F.B.users.haydovchi.profileId, F.A.users.admin.profileId],
      }),
    ],
    [
      'purchases → B xaridor (buyer_id)',
      () => ({
        sql: `insert into public.purchases (company_id, buyer_id, object_id, material_id, qty_input, unit_input, qty_base,
                unit_price, total_amount, created_by)
              values ($1, $2, $3, $4, 1, 'kg', 1, 1, 1, $5)`,
        params: [F.A.id, F.B.users.haydovchi.profileId, F.A.ids.obj1, F.A.ids.m1, F.A.users.admin.profileId],
      }),
    ],
    [
      'object_members → B profil',
      () => ({
        sql: `insert into public.object_members (company_id, object_id, profile_id, created_by) values ($1, $2, $3, $4)`,
        params: [F.A.id, F.A.ids.obj2, F.B.users.prorab.profileId, F.A.users.admin.profileId],
      }),
    ],
    [
      'object_members → B obyekt',
      () => ({
        sql: `insert into public.object_members (company_id, object_id, profile_id, created_by) values ($1, $2, $3, $4)`,
        params: [F.A.id, F.B.ids.obj2, F.A.users.direktor.profileId, F.A.users.admin.profileId],
      }),
    ],
    [
      'material_units → B material',
      () => ({
        sql: `insert into public.material_units (company_id, material_id, unit, factor, created_by) values ($1, $2, 'x', 1, $3)`,
        params: [F.A.id, F.B.ids.m1, F.A.users.admin.profileId],
      }),
    ],
    [
      'transfers → B obyektga',
      () => ({
        sql: `insert into public.transfers (company_id, from_object_id, to_object_id, material_id, qty_input, unit_input,
                qty_base, created_by)
              values ($1, $2, $3, $4, 1, 'kg', 1, $5)`,
        params: [F.A.id, F.A.ids.obj1, F.B.ids.obj1, F.A.ids.m1, F.A.users.admin.profileId],
      }),
    ],
    [
      'estimate_items → B smeta',
      () => ({
        sql: `insert into public.estimate_items (company_id, estimate_id, item_type, name, created_by)
              values ($1, $2, 'ish', 'x', $3)`,
        params: [F.A.id, F.B.ids.est_obj1, F.A.users.admin.profileId],
      }),
    ],
  ]

  it.each(cases)('%s', async (_label, make) => {
    const c = make()
    const r = await asUser(db, F.A.users.admin.authUid, (tx) => tryQuery(tx, c.sql, c.params))
    expect(r.ok ? 'OK' : r.code).toBe('23503')
  })

  it('UPDATE ham: A harakatining material_id sini B materialiga o`zgartirib bo`lmaydi', async () => {
    const r = await asUser(db, F.A.users.admin.authUid, (tx) =>
      tryExec(tx, `update public.movements set material_id = $2 where id = $1`, [F.A.ids.mv_obj1, F.B.ids.m1]),
    )
    expect(r.ok ? 'OK' : r.code).toBe('23503')
  })

  it('super_admin ham kompozit FK ni chetlab o`tolmaydi', async () => {
    const r = await asUser(db, F.A.users.super_admin.authUid, (tx) =>
      tryQuery(
        tx,
        `insert into public.movements (company_id, type, object_id, material_id, qty_input, unit_input, qty_base, created_by)
         values ($1, 'kirim', $2, $3, 1, 'kg', 1, $4)`,
        [F.B.id, F.B.ids.obj1, F.A.ids.m1, F.A.users.super_admin.profileId],
      ),
    )
    expect(r.ok ? 'OK' : r.code).toBe('23503')
  })
})
