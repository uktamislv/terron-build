// Rol matritsasi (docs/db-design.md → "Kirish matritsasi" va "aniqliklar"):
// har jadval × har rol uchun ko'rish / qo'shish / o'zgartirish. Bitta firma (A)
// ichida; B firma faqat "ortiqcha ko'rmaslik" uchun fonda turadi.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { asUser, createDb, rows, scalar, tryQuery, type Db, type UserRole } from './_harness'
import {
  BUSINESS_TABLES,
  buildTwoCompanies,
  insertCase,
  ROLES,
  targetId,
  tryExec,
  type BusinessTable,
  type CompanyFixture,
  type TwoCompanies,
} from './_fixtures'

let db: Db
let F: TwoCompanies
let A: CompanyFixture

beforeAll(async () => {
  db = await createDb()
  F = await buildTwoCompanies(db)
  A = F.A
})
afterAll(async () => {
  await db?.close()
})

const ALL = ROLES
const COMPANY_WIDE: UserRole[] = ['super_admin', 'admin', 'direktor', 'buxgalter', 'taminotchi', 'tekshiruvchi']
const ADMINS: UserRole[] = ['super_admin', 'admin']

// ----------------------------------------------------------------------------
// Ko'rish: jadval → yorliqli qatorlar → rolga ko'ra ko'rinadigan yorliqlar
// ----------------------------------------------------------------------------

/** Jadval bo'yicha A firmaning fixture yorliqlari (o'chirilmagan). */
const LABELS: Partial<Record<BusinessTable, string[]>> = {
  objects: ['obj1', 'obj2', 'obj3'],
  object_members: ['mem_prorab', 'mem_omborchi', 'mem_haydovchi'],
  materials: ['m1', 'm2'],
  material_units: ['u1'],
  material_aliases: ['al1'],
  suppliers: ['s1'],
  cash_advances: ['ca_haydovchi', 'ca_prorab'],
  purchases: ['p_hay_obj2', 'p_tam_obj1', 'p_pro_obj1'],
  transfers: ['tr_1to2', 'tr_2to3'],
  inventory_counts: ['ic_obj1', 'ic_obj2'],
  inventory_count_items: ['ici_obj1', 'ici_obj2'],
  estimates: ['est_obj1', 'est_obj2'],
  estimate_items: ['ei_obj1', 'ei_obj2'],
  estimate_import_templates: ['tpl1'],
  material_requests: ['mr_obj1', 'mr_obj2'],
  movements: ['mv_obj1', 'mv_obj2'],
  alerts: ['alert1'],
}

type VisRule = (role: UserRole) => string[]
const all = (t: BusinessTable): string[] => LABELS[t] ?? []
const byRole =
  (t: BusinessTable, spec: Partial<Record<UserRole, string[]>>, fallback: string[] = all(t)): VisRule =>
  (role) =>
    spec[role] ?? fallback

const NOTHING_FOR = (roles: UserRole[]): Partial<Record<UserRole, string[]>> =>
  Object.fromEntries(roles.map((r) => [r, []]))

const VISIBILITY: Partial<Record<BusinessTable, VisRule>> = {
  objects: byRole('objects', { prorab: ['obj1'], omborchi: ['obj1'], haydovchi: ['obj1'] }),
  object_members: byRole('object_members', {
    prorab: ['mem_prorab'],
    omborchi: ['mem_omborchi'],
    haydovchi: ['mem_haydovchi'],
  }),
  materials: () => all('materials'),
  material_units: () => all('material_units'),
  material_aliases: () => all('material_aliases'),
  suppliers: () => all('suppliers'),
  cash_advances: byRole('cash_advances', {
    taminotchi: [],
    tekshiruvchi: [],
    omborchi: [],
    prorab: ['ca_prorab'],
    haydovchi: ['ca_haydovchi'],
  }),
  purchases: byRole('purchases', {
    prorab: ['p_tam_obj1', 'p_pro_obj1'],
    omborchi: ['p_tam_obj1', 'p_pro_obj1'],
    haydovchi: ['p_hay_obj2'],
    // Batch 8 (Y1): tekshiruvchi xarid va harakatlarni ko'rmaydi (ko'r-ko'rona sanash)
    tekshiruvchi: [],
  }),
  movements: byRole('movements', { prorab: ['mv_obj1'], omborchi: ['mv_obj1'], haydovchi: [], tekshiruvchi: [] }),
  transfers: byRole('transfers', { prorab: ['tr_1to2'], omborchi: ['tr_1to2'], haydovchi: [] }),
  inventory_counts: byRole('inventory_counts', { prorab: ['ic_obj1'], omborchi: ['ic_obj1'], haydovchi: [] }),
  inventory_count_items: byRole('inventory_count_items', {
    prorab: ['ici_obj1'],
    omborchi: ['ici_obj1'],
    haydovchi: [],
  }),
  estimates: byRole('estimates', { prorab: ['est_obj1'], omborchi: [], haydovchi: [] }),
  estimate_items: byRole('estimate_items', { prorab: ['ei_obj1'], omborchi: [], haydovchi: [] }),
  // Batch 7: shablonlarni firma a'zolari ko'radi
  estimate_import_templates: () => all('estimate_import_templates'),
  material_requests: byRole('material_requests', { prorab: ['mr_obj1'], omborchi: [], haydovchi: [] }),
  alerts: byRole('alerts', NOTHING_FOR(['taminotchi', 'tekshiruvchi', 'prorab', 'omborchi', 'haydovchi'])),
}

const VIS_TABLES = Object.keys(VISIBILITY) as BusinessTable[]

// Batch 5: alerts'da authenticated faqat status va close_note ni o'zgartiradi (ustun grant).
const setClause = (t: string): string => (t === 'alerts' ? 'status = status' : 'updated_at = now()')

describe('ko`rish (SELECT) — yorliqli qatorlar', () => {
  it.each(ALL)('%s', async (role) => {
    const actual = await asUser(db, A.users[role].authUid, async (tx) => {
      const out: Record<string, string[]> = {}
      for (const t of VIS_TABLES) {
        const seen = new Set(
          (await rows<{ id: string }>(tx, `select id from public.${t} where company_id = $1`, [A.id])).map((r) => r.id),
        )
        out[t] = all(t).filter((label) => seen.has(A.ids[label]!))
      }
      return out
    })
    const expected = Object.fromEntries(VIS_TABLES.map((t) => [t, VISIBILITY[t]!(role)]))
    expect(actual).toEqual(expected)
  })

  it.each(ALL)('%s: companies — o`z firmasi; profiles — barcha firma a`zolari', async (role) => {
    const r = await asUser(db, A.users[role].authUid, async (tx) => ({
      company: await scalar<number>(tx, `select count(*)::int from public.companies where id = $1`, [A.id]),
      profiles: await scalar<number>(tx, `select count(*)::int from public.profiles where company_id = $1`, [A.id]),
    }))
    expect(r).toEqual({ company: 1, profiles: ROLES.length })
  })

  it.each(ALL)('%s: stock_balances — faqat ko`ra oladigan obyektlar', async (role) => {
    const objs = await asUser(db, A.users[role].authUid, (tx) =>
      rows<{ object_id: string }>(tx, `select object_id from public.stock_balances where company_id = $1`, [A.id]),
    )
    const labels = ['obj1', 'obj2'].filter((l) => objs.some((o) => o.object_id === A.ids[l]))
    // Batch 8 (Y1): tekshiruvchi kutilgan qoldiqni ko'rmaydi
    const expected =
      role === 'tekshiruvchi' || role === 'haydovchi' ? [] : COMPANY_WIDE.includes(role) ? ['obj1', 'obj2'] : ['obj1']
    expect(labels).toEqual(expected)
  })

  it.each(ALL)('%s: audit_log — faqat admin, direktor (va super_admin)', async (role) => {
    const n = await asUser(db, A.users[role].authUid, (tx) =>
      scalar<number>(tx, `select count(*)::int from public.audit_log where company_id = $1`, [A.id]),
    )
    expect(n > 0).toBe(['super_admin', 'admin', 'direktor'].includes(role))
  })
})

// ----------------------------------------------------------------------------
// Qo'shish va o'zgartirish
// ----------------------------------------------------------------------------

const CAN_INSERT: Record<BusinessTable, UserRole[]> = {
  companies: ['super_admin'],
  profiles: ADMINS,
  objects: ADMINS,
  object_members: ADMINS,
  materials: ADMINS,
  material_units: ADMINS,
  material_aliases: ADMINS,
  // Batch 5: xarid kiritadigan rollar yangi sotuvchi qo'shadi (o'zgartirish — admin)
  suppliers: [...ADMINS, 'taminotchi', 'haydovchi', 'prorab'],
  cash_advances: [...ADMINS, 'buxgalter'],
  // buyer_id = o'zi, obj1 (prorab a'zo)
  purchases: [...ADMINS, 'taminotchi', 'haydovchi', 'prorab'],
  movements: [...ADMINS, 'prorab', 'omborchi'],
  inventory_counts: [...ADMINS, 'tekshiruvchi'],
  // ic_obj1 — tekshiruvchi yaratgan, draft
  inventory_count_items: [...ADMINS, 'tekshiruvchi'],
  // Batch 7: smeta va qatorlar faqat RPC (import_estimate) orqali — to'g'ridan-to'g'ri INSERT hech kimga
  estimates: [],
  estimate_items: [],
  estimate_import_templates: [...ADMINS, 'buxgalter'],
  material_requests: [...ADMINS, 'prorab'],
  // Batch 8: o'tkazma faqat RPC (create_transfer) orqali — to'g'ridan-to'g'ri INSERT hech kimga
  transfers: [],
  alerts: [],
}

const CAN_UPDATE: Record<BusinessTable, UserRole[]> = {
  companies: ADMINS,
  profiles: ADMINS,
  objects: ADMINS,
  object_members: ADMINS,
  materials: ADMINS,
  material_units: ADMINS,
  material_aliases: ADMINS,
  suppliers: ADMINS,
  cash_advances: [...ADMINS, 'buxgalter'],
  purchases: ADMINS,
  movements: ADMINS,
  // ic_obj1 / ici_obj1 — tekshiruvchi yaratgan, draft
  inventory_counts: [...ADMINS, 'tekshiruvchi'],
  inventory_count_items: [...ADMINS, 'tekshiruvchi'],
  estimates: [...ADMINS, 'buxgalter'],
  estimate_items: [...ADMINS, 'buxgalter'],
  estimate_import_templates: [...ADMINS, 'buxgalter'],
  material_requests: [...ADMINS, 'taminotchi'],
  // Batch 8: o'tkazma faqat RPC (receive_transfer / cancel_transfer) orqali o'zgaradi
  transfers: [],
  alerts: ADMINS,
}

describe('qo`shish (INSERT) — o`z firmasiga', () => {
  it.each(ALL)('%s', async (role) => {
    const me = A.users[role]
    const actual = await asUser(db, me.authUid, async (tx) => {
      const out: Record<string, boolean> = {}
      for (const t of BUSINESS_TABLES) {
        const c = insertCase(t, A, me.profileId)
        const r = await tryQuery(tx, c.sql, c.params)
        if (!r.ok && r.code !== '42501') throw new Error(`${role} → ${t}: kutilmagan xato ${r.code}: ${r.msg}`)
        out[t] = r.ok
      }
      return out
    })
    const expected = Object.fromEntries(BUSINESS_TABLES.map((t) => [t, CAN_INSERT[t].includes(role)]))
    expect(actual).toEqual(expected)
  })
})

describe('o`zgartirish (UPDATE) — o`z firmasidagi namunaviy qator', () => {
  it.each(ALL)('%s', async (role) => {
    const actual = await asUser(db, A.users[role].authUid, async (tx) => {
      const out: Record<string, boolean> = {}
      for (const t of BUSINESS_TABLES) {
        const r = await tryExec(tx, `update public.${t} set ${setClause(t)} where id = $1`, [targetId(A, t)])
        if (!r.ok && r.code !== '42501') throw new Error(`${role} → ${t}: kutilmagan xato ${r.code}: ${r.msg}`)
        out[t] = r.ok && r.affected === 1
      }
      return out
    })
    const expected = Object.fromEntries(BUSINESS_TABLES.map((t) => [t, CAN_UPDATE[t].includes(role)]))
    expect(actual).toEqual(expected)
  })

  it.each(ALL)('%s: audit_log ni o`zgartira olmaydi', async (role) => {
    const r = await asUser(db, A.users[role].authUid, (tx) =>
      tryExec(tx, `update public.audit_log set table_name = 'x' where company_id = $1`, [A.id]),
    )
    expect(r.ok ? 'OK' : r.code).toBe('42501')
  })
})

// ----------------------------------------------------------------------------
// Aniq holatlar
// ----------------------------------------------------------------------------

describe('obyekt bo`yicha cheklovlar (a`zo bo`lmagan obyekt — obj2)', () => {
  const cases: Array<[UserRole, BusinessTable]> = [
    ['prorab', 'movements'],
    ['omborchi', 'movements'],
    ['prorab', 'purchases'],
    ['prorab', 'material_requests'],
    ['prorab', 'transfers'],
  ]
  it.each(cases)('%s → %s (obj2) — 42501', async (role, table) => {
    const me = A.users[role]
    const c = insertCase(table, A, me.profileId, A.ids.obj2)
    const r = await asUser(db, me.authUid, (tx) => tryQuery(tx, c.sql, c.params))
    expect(r.ok ? 'OK' : r.code).toBe('42501')
  })

  it('prorab/omborchi faqat kirim/chiqim qo`sha oladi (inventory_adjust — yo`q)', async () => {
    for (const role of ['prorab', 'omborchi'] as const) {
      const me = A.users[role]
      const r = await asUser(db, me.authUid, async (tx) => {
        const chiqim = await tryQuery(
          tx,
          `insert into public.movements (company_id, type, object_id, material_id, qty_input, unit_input, qty_base, created_by)
           values ($1, 'chiqim', $2, $3, 1, 'kg', 1, $4)`,
          [A.id, A.ids.obj1, A.ids.m1, me.profileId],
        )
        const adj = await tryQuery(
          tx,
          `insert into public.movements (company_id, type, object_id, material_id, qty_input, unit_input, qty_base, created_by)
           values ($1, 'inventory_adjust', $2, $3, -1, 'kg', -1, $4)`,
          [A.id, A.ids.obj1, A.ids.m1, me.profileId],
        )
        return [chiqim.ok, adj.ok ? 'OK' : adj.code]
      })
      expect(r, role).toEqual([true, '42501'])
    }
  })

  it('haydovchi/taminotchi boshqa odam nomidan (buyer_id) xarid qo`sha olmaydi', async () => {
    for (const role of ['haydovchi', 'taminotchi', 'prorab'] as const) {
      const me = A.users[role]
      const r = await asUser(db, me.authUid, (tx) =>
        tryQuery(
          tx,
          `insert into public.purchases (company_id, buyer_id, object_id, material_id, qty_input, unit_input,
             qty_base, unit_price, total_amount, created_by)
           values ($1, $2, $3, $4, 1, 'kg', 1, 1, 1, $5)`,
          [A.id, A.users.direktor.profileId, A.ids.obj1, A.ids.m1, me.profileId],
        ),
      )
      expect(r.ok ? 'OK' : r.code, role).toBe('42501')
    }
  })

  it('admin boshqa odam nomidan xarid qo`sha oladi', async () => {
    const me = A.users.admin
    const r = await asUser(db, me.authUid, (tx) =>
      tryQuery(
        tx,
        `insert into public.purchases (company_id, buyer_id, object_id, material_id, qty_input, unit_input,
           qty_base, unit_price, total_amount, created_by)
         values ($1, $2, $3, $4, 1, 'kg', 1, 1, 1, $5)`,
        [A.id, A.users.haydovchi.profileId, A.ids.obj2, A.ids.m1, me.profileId],
      ),
    )
    expect(r.ok).toBe(true)
  })

  it('prorab so`rovni faqat status = kutilmoqda bilan, transferni faqat yuborildi bilan qo`shadi', async () => {
    const me = A.users.prorab
    const r = await asUser(db, me.authUid, async (tx) => {
      const req = await tryQuery(
        tx,
        `insert into public.material_requests (company_id, object_id, material_id, qty_input, unit_input, qty_base,
           status, created_by)
         values ($1, $2, $3, 1, 'kg', 1, 'tasdiqlandi', $4)`,
        [A.id, A.ids.obj1, A.ids.m1, me.profileId],
      )
      const tr = await tryQuery(
        tx,
        `insert into public.transfers (company_id, from_object_id, to_object_id, material_id, qty_input, unit_input,
           qty_base, status, created_by)
         values ($1, $2, $3, $4, 1, 'kg', 1, 'qabul_qilindi', $5)`,
        [A.id, A.ids.obj1, A.ids.obj3, A.ids.m1, me.profileId],
      )
      return [req.ok ? 'OK' : req.code, tr.ok ? 'OK' : tr.code]
    })
    expect(r).toEqual(['42501', '42501'])
  })

  it('tekshiruvchi boshqa tekshiruvchining yoki yuborilgan (submitted) inventarizatsiyasiga yoza olmaydi', async () => {
    // Qo`shimcha qatorlar superuser sifatida (yorliqsiz — ko`rish testlariga ta`sir qilmaydi)
    const otherCount = await scalar<string>(
      db,
      `insert into public.inventory_counts (company_id, object_id, created_by) values ($1, $2, $3) returning id`,
      [A.id, A.ids.obj2, A.users.admin.profileId],
    )
    const submitted = await scalar<string>(
      db,
      `insert into public.inventory_counts (company_id, object_id, status, created_by)
       values ($1, $2, 'submitted', $3) returning id`,
      [A.id, A.ids.obj3, A.users.tekshiruvchi.profileId],
    )
    const me = A.users.tekshiruvchi
    const r = await asUser(db, me.authUid, async (tx) => {
      const out: Record<string, unknown> = {}
      for (const [label, id] of [
        ['boshqaniki', otherCount],
        ['submitted', submitted],
      ] as const) {
        const item = await tryQuery(
          tx,
          `insert into public.inventory_count_items (company_id, inventory_count_id, material_id, qty_counted, created_by)
           values ($1, $2, $3, 1, $4)`,
          [A.id, id, A.ids.m1, me.profileId],
        )
        const upd = await tryExec(tx, `update public.inventory_counts set note = 'x' where id = $1`, [id])
        out[label] = [item.ok ? 'OK' : item.code, upd.ok ? upd.affected : upd.code]
      }
      return out
    })
    expect(r).toEqual({ boshqaniki: ['42501', 0], submitted: ['42501', 0] })
  })
})

describe('direktor — faqat ko`radi', () => {
  it('hech bir jadvalga qo`sha olmaydi va hech narsani o`zgartira olmaydi', async () => {
    const me = A.users.direktor
    const r = await asUser(db, me.authUid, async (tx) => {
      let inserted = 0
      let updated = 0
      for (const t of BUSINESS_TABLES) {
        const c = insertCase(t, A, me.profileId)
        if ((await tryQuery(tx, c.sql, c.params)).ok) inserted++
        const u = await tryExec(tx, `update public.${t} set updated_at = now() where ${t === 'companies' ? 'id' : 'company_id'} = $1`, [A.id])
        if (u.ok && u.affected > 0) updated++
      }
      return { inserted, updated }
    })
    expect(r).toEqual({ inserted: 0, updated: 0 })
  })
})

describe('alerts — hech kim insert qila olmaydi', () => {
  it.each(ALL)('%s', async (role) => {
    const me = A.users[role]
    const c = insertCase('alerts', A, me.profileId)
    const r = await asUser(db, me.authUid, (tx) => tryQuery(tx, c.sql, c.params))
    expect(r.ok ? 'OK' : r.code).toBe('42501')
  })
})
