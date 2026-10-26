// Soft delete matritsasi: har biznes jadvali × har rol. Fixture qatorlari o'chirilganda (deleted_at)
// — o'chirilganni ko'rish huquqi bo'lmagan rollardan yashirinadi, huquqi borlar (admin / direktor,
// jadvalga qarab buxgalter / taminotchi / tekshiruvchi — RLS siyosatidagi `deleted_at is null or
// has_role(...)`) esa uni o'chirilmagan holatda qanday ko'rgan bo'lsa, shunday ko'rishda davom etadi.
// Har jadval alohida tranzaksiyada (rollback) — fixture o'zgarmaydi.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { asUser, createDb, rows, type Db, type Tx, type UserRole } from './_harness'
import { raw, switchUid } from './_tx'
import { BUSINESS_TABLES, buildTwoCompanies, ROLES, type BusinessTable, type CompanyFixture } from './_fixtures'

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

const ADMINS: UserRole[] = ['super_admin', 'admin']
const DEFAULT_DELETED: UserRole[] = [...ADMINS, 'direktor']

/**
 * O'chirilgan qatorni ko'ra oladigan rollar (RLS select siyosati). Ro'yxatda bo'lmagan rol
 * o'chirilgan qatorni hech qachon ko'rmasligi kerak.
 */
const DELETED_VIEWERS: Record<BusinessTable, UserRole[]> = {
  // O'chirilgan firma — faqat tizim egasi (alohida test: firma ichidagilar uchun firma "yo'q")
  companies: ['super_admin'],
  // O'chirilgan profil — admin / super_admin (direktor faqat o'zini ko'radi, o'zi o'chirilgan emas)
  profiles: ADMINS,
  objects: DEFAULT_DELETED,
  object_members: DEFAULT_DELETED,
  materials: DEFAULT_DELETED,
  material_units: DEFAULT_DELETED,
  material_aliases: DEFAULT_DELETED,
  suppliers: DEFAULT_DELETED,
  cash_advances: [...DEFAULT_DELETED, 'buxgalter'],
  purchases: DEFAULT_DELETED,
  transfers: DEFAULT_DELETED,
  inventory_counts: [...DEFAULT_DELETED, 'tekshiruvchi'],
  inventory_count_items: [...DEFAULT_DELETED, 'tekshiruvchi'],
  estimates: [...DEFAULT_DELETED, 'buxgalter'],
  estimate_items: [...DEFAULT_DELETED, 'buxgalter'],
  estimate_import_templates: [...DEFAULT_DELETED, 'buxgalter'],
  material_requests: [...DEFAULT_DELETED, 'taminotchi'],
  movements: DEFAULT_DELETED,
  alerts: DEFAULT_DELETED,
}

/**
 * "Mening yozuvlarim": muallif o'zi kiritgan o'chirilgan harakat / xaridni ko'radi
 * (movements_select_own_deleted, purchases_select_own_deleted; tekshiruvchidan tashqari).
 */
const OWN_DELETED_TABLES: readonly BusinessTable[] = ['movements', 'purchases']

/** Jadval bo'yicha o'chiriladigan fixture qatorlari (A firma). */
function targets(t: BusinessTable): Record<string, string> {
  const ids = A.ids
  const pick = (...labels: string[]): Record<string, string> => Object.fromEntries(labels.map((l) => [l, ids[l]!]))
  switch (t) {
    case 'companies':
      throw new Error('companies — alohida test')
    case 'profiles':
      return { haydovchi: A.users.haydovchi.profileId, buxgalter: A.users.buxgalter.profileId }
    case 'objects':
      return pick('obj1', 'obj2')
    case 'object_members':
      return pick('mem_prorab', 'mem_omborchi', 'mem_haydovchi')
    case 'materials':
      return pick('m1', 'm2')
    case 'material_units':
      return pick('u1')
    case 'material_aliases':
      return pick('al1')
    case 'suppliers':
      return pick('s1')
    case 'cash_advances':
      return pick('ca_haydovchi', 'ca_prorab')
    case 'purchases':
      return pick('p_hay_obj2', 'p_tam_obj1', 'p_pro_obj1')
    case 'transfers':
      return pick('tr_1to2', 'tr_2to3')
    case 'inventory_counts':
      return pick('ic_obj1', 'ic_obj2')
    case 'inventory_count_items':
      return pick('ici_obj1', 'ici_obj2')
    case 'estimates':
      return pick('est_obj1', 'est_obj2')
    case 'estimate_items':
      return pick('ei_obj1', 'ei_obj2')
    case 'estimate_import_templates':
      return pick('tpl1')
    case 'material_requests':
      return pick('mr_obj1', 'mr_obj2')
    case 'movements':
      return pick('mv_obj1', 'mv_obj2')
    case 'alerts':
      return pick('alert1')
  }
}

async function visible(tx: Tx, t: BusinessTable, rowsById: Record<string, string>): Promise<Record<UserRole, string[]>> {
  const out = {} as Record<UserRole, string[]>
  const ids = Object.values(rowsById)
  for (const role of ROLES) {
    await switchUid(tx, A.users[role].authUid)
    const seen = new Set((await rows<{ id: string }>(tx, `select id from public.${t} where id = any($1::uuid[])`, [ids])).map((r) => r.id))
    out[role] = Object.entries(rowsById)
      .filter(([, id]) => seen.has(id))
      .map(([label]) => label)
  }
  return out
}

describe('soft delete — o`chirilgan qator kimga ko`rinadi (jadval × rol)', () => {
  it.each(BUSINESS_TABLES.filter((t) => t !== 'companies'))('%s', async (t) => {
    const target = targets(t)
    // Tranzaksiyadan oldin (db ga tranzaksiya ichidan murojaat — PGlite'da kutib qoladi)
    const authors = Object.fromEntries(
      (await rows<{ id: string; created_by: string | null }>(db, `select id, created_by from public.${t} where id = any($1::uuid[])`, [
        Object.values(target),
      ])).map((x) => [x.id, x.created_by]),
    )
    const r = await asUser(db, A.users.admin.authUid, async (tx) => {
      const live = await visible(tx, t, target)
      // Faqat deleted_at — kaskad / qo'riqchi triggerlarsiz (ko'rinish RLS'ga bog'liq)
      await raw(tx, `update public.${t} set deleted_at = now() where id = any($1::uuid[])`, [Object.values(target)])
      const dead = await visible(tx, t, target)
      return { live, dead }
    })
    // Fixture: kamida bitta rol o'chirilmagan qatorni ko'radi (aks holda test hech narsani tekshirmaydi)
    expect(Object.values(r.live).some((l) => l.length > 0)).toBe(true)
    const own = (role: UserRole, label: string): boolean =>
      OWN_DELETED_TABLES.includes(t) && role !== 'tekshiruvchi' && authors[target[label]!] === A.users[role].profileId
    const expected = Object.fromEntries(
      ROLES.map((role) => [
        role,
        Object.keys(target).filter((label) => (DELETED_VIEWERS[t].includes(role) && r.live[role].includes(label)) || own(role, label)),
      ]),
    )
    expect(r.dead).toEqual(expected)
  })

  it('companies: o`chirilgan firma (B) — faqat super_admin ko`radi; B ichidagilar firmani ham, ma`lumotni ham ko`rmaydi', async () => {
    const r = await asUser(db, A.users.super_admin.authUid, async (tx) => {
      await raw(tx, `update public.companies set deleted_at = now() where id = $1`, [B.id])
      const superSees = (await rows(tx, `select 1 from public.companies where id = $1`, [B.id])).length
      const inside: Record<string, number> = {}
      for (const role of ROLES.filter((x) => x !== 'super_admin')) {
        await switchUid(tx, B.users[role].authUid)
        inside[role] =
          (await rows(tx, `select 1 from public.companies where id = $1`, [B.id])).length +
          (await rows(tx, `select 1 from public.objects where company_id = $1`, [B.id])).length
      }
      return { superSees, inside }
    })
    expect(r.superSees).toBe(1)
    expect(r.inside).toEqual(Object.fromEntries(ROLES.filter((x) => x !== 'super_admin').map((x) => [x, 0])))
  })

  it('admin, direktor o`chirilgan movements/purchases ni ko`radi; boshqa ko`rgan rollar — yo`q', async () => {
    const r = await asUser(db, A.users.admin.authUid, async (tx) => {
      await raw(tx, `update public.movements set deleted_at = now() where id = $1`, [A.ids.mv_obj1])
      await raw(tx, `update public.purchases set deleted_at = now() where id = $1`, [A.ids.p_hay_obj2])
      const out: Record<string, [number, number]> = {}
      for (const role of ['admin', 'direktor', 'prorab', 'omborchi', 'haydovchi'] as const) {
        await switchUid(tx, A.users[role].authUid)
        out[role] = [
          (await rows(tx, `select 1 from public.movements where id = $1`, [A.ids.mv_obj1])).length,
          (await rows(tx, `select 1 from public.purchases where id = $1`, [A.ids.p_hay_obj2])).length,
        ]
      }
      return out
    })
    // mv_obj1 — muallifsiz: obj1 a'zolari (prorab, omborchi) o'chirilgach ko'rmaydi;
    // p_hay_obj2 — haydovchining o'z xaridi: "Mening yozuvlarim" uchun o'chirilgani ham ko'rinadi
    expect(r).toEqual({ admin: [1, 1], direktor: [1, 1], prorab: [0, 0], omborchi: [0, 0], haydovchi: [0, 1] })
  })
})
