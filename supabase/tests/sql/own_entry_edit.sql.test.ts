// O'z yozuvini tahrirlash: prorab, omborchi, haydovchi, taminotchi o'zi kiritgan (created_by = o'zi)
// harakat / xarid / o'tkazmani to'g'ridan-to'g'ri UPDATE yoki soft delete qila olmaydi — faqat
// correct_entry / cancel_own_entry orqali, 30 daqiqa ichida va roli ruxsat etgan jadvalda.
// Boshqa muallifning yozuvida — hech qanday yo'l bilan. Har holat alohida tranzaksiyada (rollback).
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { asUser, createDb, scalar, type Db, type Tx, type UserRole } from './_harness'
import { raw, res, sys, system } from './_tx'
import { buildTwoCompanies, type CompanyFixture } from './_fixtures'

let db: Db
let A: CompanyFixture

beforeAll(async () => {
  db = await createDb()
  ;({ A } = await buildTwoCompanies(db))
})
afterAll(async () => {
  await db?.close()
})

type Table = 'movements' | 'purchases' | 'transfers'
const WORKERS = ['prorab', 'omborchi', 'haydovchi', 'taminotchi'] as const
type Worker = (typeof WORKERS)[number]
const TABLES: Table[] = ['movements', 'purchases', 'transfers']
const P = (role: UserRole): string => A.users[role].profileId

/** Tizim nomidan (auth.uid() yo'q — created_by saqlanadi) obj1 da yozuv; muallif — `author`. */
async function seed(tx: Tx, table: Table, author: UserRole, buyer: UserRole = author): Promise<string> {
  return system(tx, () => {
    switch (table) {
      case 'movements':
        return scalar<string>(
          tx,
          `insert into public.movements (company_id, type, object_id, material_id, qty_input, unit_input, qty_base, note, created_by)
           values ($1, 'kirim', $2, $3, 3, 'kg', 3, 'asl', $4) returning id`,
          [A.id, A.ids.obj1, A.ids.m1, P(author)],
        )
      case 'purchases':
        return scalar<string>(
          tx,
          `insert into public.purchases (company_id, buyer_id, object_id, material_id, qty_input, unit_input, qty_base,
             unit_price, total_amount, note, created_by)
           values ($1, $2, $3, $4, 3, 'kg', 3, 100, 300, 'asl', $5) returning id`,
          [A.id, P(buyer), A.ids.obj1, A.ids.m1, P(author)],
        )
      case 'transfers':
        return scalar<string>(
          tx,
          `insert into public.transfers (company_id, from_object_id, to_object_id, material_id, qty_input, unit_input, qty_base,
             note, created_by)
           values ($1, $2, $3, $4, 1, 'kg', 1, 'asl', $5) returning id`,
          [A.id, A.ids.obj1, A.ids.obj2, A.ids.m1, P(author)],
        )
    }
  })
}

/** Qatorning hozirgi holati (RLS'siz). */
const state = (tx: Tx, table: Table, id: string): Promise<string> =>
  sys(tx, () =>
    scalar<string>(tx, `select coalesce(note, '') || '|' || (deleted_at is not null)::text || '|' || qty_input::text from public.${table} where id = $1`, [
      id,
    ]),
  )

/** Ruxsat berilmagan (0 qator yoki 42501) — '' ; aks holda natija. */
const blocked = (r: string): boolean => r === 'OK:0' || r.startsWith('42501:')

describe('to`g`ridan-to`g`ri UPDATE / soft delete — o`z yozuvida ham, boshqanikida ham yo`q', () => {
  const cases = WORKERS.flatMap((role) => TABLES.map((t) => [role, t] as const))
  it.each(cases)('%s → %s', async (role, table) => {
    const r = await asUser(db, A.users[role].authUid, async (tx) => {
      const own = await seed(tx, table, role)
      const other = await seed(tx, table, 'admin', role)
      const out: Record<string, string> = {}
      for (const [label, id] of [
        ['own', own],
        ['other', other],
      ] as const) {
        out[`${label}.update`] = await res(tx, `update public.${table} set note = 'buzildi' where id = $1`, [id])
        out[`${label}.qty`] = await res(tx, `update public.${table} set qty_input = 99 where id = $1`, [id])
        out[`${label}.delete`] = await res(tx, `update public.${table} set deleted_at = now() where id = $1`, [id])
        out[`${label}.state`] = await state(tx, table, id)
      }
      return out
    })
    for (const label of ['own', 'other']) {
      for (const op of ['update', 'qty', 'delete']) expect(blocked(r[`${label}.${op}`]!), `${label}.${op}: ${r[`${label}.${op}`]}`).toBe(true)
      // Qator o'zgarmagan
      expect(r[`${label}.state`]).toBe(table === 'transfers' ? 'asl|false|1.000000' : 'asl|false|3.000000')
    }
  })
})

/** correct_entry / cancel_own_entry o'z yozuvida (30 daqiqa ichida) ruxsat etilgan rollar. */
const RPC_ALLOWED: Record<Table, readonly Worker[]> = {
  // harakat — prorab, omborchi (a'zo obyekt)
  movements: ['prorab', 'omborchi'],
  // xarid — taminotchi (istalgan obyekt), prorab / haydovchi (a'zo obyekt)
  purchases: ['prorab', 'haydovchi', 'taminotchi'],
  // o'tkazma — bu RPC'lar qo'llamaydi (o'tkazma faqat cancel_transfer / receive_transfer)
  transfers: [],
}

describe('correct_entry / cancel_own_entry — faqat o`z yozuvi, 30 daqiqa, rol ruxsati', () => {
  const cases = WORKERS.flatMap((role) => TABLES.map((t) => [role, t] as const))

  it.each(cases)('%s → %s', async (role, table) => {
    const r = await asUser(db, A.users[role].authUid, async (tx) => {
      const own = await seed(tx, table, role)
      const other = await seed(tx, table, 'admin', role)
      const late = await seed(tx, table, role)
      await raw(tx, `update public.${table} set created_at = now() - interval '31 minutes' where id = $1`, [late])
      const ownCancel = await seed(tx, table, role)
      return {
        correctOwn: await res(tx, `select public.correct_entry($1, $2, 2, p_reason => 'test')`, [table, own]),
        ownAfter: await state(tx, table, own),
        correctOther: await res(tx, `select public.correct_entry($1, $2, 2, p_reason => 'test')`, [table, other]),
        correctLate: await res(tx, `select public.correct_entry($1, $2, 2, p_reason => 'test')`, [table, late]),
        cancelOwn: await res(tx, `select public.cancel_own_entry($1, $2, 'xato')`, [table, ownCancel]),
        cancelOwnAfter: await state(tx, table, ownCancel),
        cancelOther: await res(tx, `select public.cancel_own_entry($1, $2, 'xato')`, [table, other]),
        cancelLate: await res(tx, `select public.cancel_own_entry($1, $2, 'xato')`, [table, late]),
        otherAfter: await state(tx, table, other),
        lateAfter: await state(tx, table, late),
      }
    })
    const one = table === 'transfers' ? '1.000000' : '3.000000'
    if (table === 'transfers') {
      // RPC'lar o'tkazmani umuman qabul qilmaydi
      expect(r).toMatchObject({
        correctOwn: '22023:correct_invalid',
        correctOther: '22023:correct_invalid',
        correctLate: '22023:correct_invalid',
        cancelOwn: '22023:correct_invalid',
        cancelOther: '22023:correct_invalid',
        cancelLate: '22023:correct_invalid',
      })
    } else if (RPC_ALLOWED[table].includes(role)) {
      expect(r).toMatchObject({
        correctOwn: 'OK:1',
        ownAfter: 'asl|false|2.000000',
        correctOther: '42501:correct_forbidden',
        correctLate: '55000:correct_window_passed',
        cancelOwn: 'OK:1',
        cancelOwnAfter: `asl|true|${one}`,
        cancelOther: '42501:correct_forbidden',
        cancelLate: '55000:correct_window_passed',
      })
    } else {
      expect(r).toMatchObject({
        correctOwn: '42501:correct_forbidden',
        ownAfter: `asl|false|${one}`,
        correctOther: '42501:correct_forbidden',
        cancelOwn: '42501:correct_forbidden',
        cancelOwnAfter: `asl|false|${one}`,
        cancelOther: '42501:correct_forbidden',
      })
      // Muddati o'tgani ham — rad (forbidden yoki window — ikkalasi ham "yo'q")
      expect(['42501:correct_forbidden', '55000:correct_window_passed']).toContain(r.correctLate)
      expect(['42501:correct_forbidden', '55000:correct_window_passed']).toContain(r.cancelLate)
    }
    // Boshqa muallifniki va muddati o'tgani o'zgarmagan
    expect(r.otherAfter).toBe(`asl|false|${one}`)
    expect(r.lateAfter).toBe(`asl|false|${one}`)
  })

  it('a`zo bo`lmagan obyektdagi o`z yozuvi (prorab, obj2) — correct_forbidden', async () => {
    const r = await asUser(db, A.users.prorab.authUid, async (tx) => {
      const id = await system(tx, () =>
        scalar<string>(
          tx,
          `insert into public.movements (company_id, type, object_id, material_id, qty_input, unit_input, qty_base, created_by)
           values ($1, 'kirim', $2, $3, 3, 'kg', 3, $4) returning id`,
          [A.id, A.ids.obj2, A.ids.m1, P('prorab')],
        ),
      )
      return [
        await res(tx, `select public.correct_entry('movements', $1, 2)`, [id]),
        await res(tx, `select public.cancel_own_entry('movements', $1, 'x')`, [id]),
      ]
    })
    expect(r).toEqual(['42501:correct_forbidden', '42501:correct_forbidden'])
  })
})

describe('NULL muallif (tizim yaratgan yozuv) — rol tekshiruvi chetlab o`tilmaydi', () => {
  it('cancel_transfer: created_by = NULL o`tkazmani admin bo`lmagan hech kim bekor qila olmaydi', async () => {
    const out: Record<string, string> = {}
    for (const role of ['prorab', 'omborchi', 'haydovchi', 'taminotchi', 'tekshiruvchi', 'buxgalter', 'direktor', 'admin'] as const) {
      out[role] = await asUser(db, A.users[role].authUid, (tx) => res(tx, `select public.cancel_transfer($1, 'x')`, [A.ids.tr_1to2]))
    }
    const forbidden = '42501:transfer_forbidden'
    expect(out).toEqual({
      prorab: forbidden,
      omborchi: forbidden,
      haydovchi: forbidden,
      taminotchi: forbidden,
      tekshiruvchi: forbidden,
      buxgalter: forbidden,
      direktor: forbidden,
      admin: 'OK:1',
    })
  })

  it('submit_inventory_count: tekshiruvchi created_by = NULL sanashni yubora olmaydi; o`zinikini — yuboradi', async () => {
    const r = await asUser(db, A.users.tekshiruvchi.authUid, async (tx) => {
      const orphan = await system(tx, () =>
        scalar<string>(tx, `insert into public.inventory_counts (company_id, object_id) values ($1, $2) returning id`, [A.id, A.ids.obj3]),
      )
      return {
        orphan: await res(tx, `select public.submit_inventory_count($1)`, [orphan]),
        own: await res(tx, `select public.submit_inventory_count($1)`, [A.ids.ic_obj1]),
      }
    })
    expect(r).toEqual({ orphan: '42501:inventory_submit_forbidden', own: 'OK:1' })
  })
})
