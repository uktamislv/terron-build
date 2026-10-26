// Batch 3 — katalog yaxlitligi (20261027000001_catalog_guards.sql):
// asosiy birlik, koeffitsient o'zgarishi, UPDATE'da qayta hisoblash, nom ↔ alias,
// materialni o'chirish / nofaol qilish, katalog RLS, invariantlar.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  applyMigrations,
  asUser,
  createCompany,
  createDb,
  insertRow,
  listMigrations,
  one,
  rows,
  scalar,
  type Db,
  type Queryable,
  type Tx,
} from './_harness'
import { buildCompany, type CompanyFixture } from './_fixtures'

let db: Db
let A: CompanyFixture
let admin: string
let me: string

beforeAll(async () => {
  db = await createDb()
  A = await buildCompany(db, 'A')
  admin = A.users.admin.authUid
  me = A.users.admin.profileId
})
afterAll(async () => {
  await db?.close()
})

/**
 * So'rov natijasi: `OK:<qatorlar soni>` yoki `<errcode>:<hint>` (savepoint bilan — tx davom etadi).
 */
async function res(tx: Queryable, sql: string, params: unknown[] = []): Promise<string> {
  await tx.exec('savepoint cg_try')
  try {
    const r = await tx.query(sql, params)
    await tx.exec('release savepoint cg_try')
    return `OK:${r.affectedRows ?? r.rows.length}`
  } catch (e) {
    await tx.exec('rollback to savepoint cg_try')
    const err = e as { code?: string; hint?: string }
    return `${err.code ?? '?'}:${err.hint ?? ''}`
  }
}

const asAdmin = <T>(fn: (tx: Tx) => Promise<T>): Promise<T> => asUser(db, admin, fn)

/** Batch 7: smeta qatorlari faqat RPC ichida yoziladi — testda RPC holatini taqlid qilamiz. */
const ESTIMATE_RPC = `select set_config('terron.estimate_rpc', 'on', true)`

let n = 0
/** Yangi material (admin nomidan, tx ichida); id. */
async function newMaterial(tx: Tx, name = `Mat ${++n}`, baseUnit = 'kg'): Promise<string> {
  return scalar<string>(
    tx,
    `insert into public.materials (company_id, name, base_unit, created_by) values ($1, $2, $3, $4) returning id`,
    [A.id, name, baseUnit, me],
  )
}
async function newUnit(tx: Tx, material: string, unit: string, factor: number, variant: string | null = null): Promise<string> {
  return scalar<string>(
    tx,
    `insert into public.material_units (company_id, material_id, unit, factor, variant, created_by)
     values ($1, $2, $3, $4, $5, $6) returning id`,
    [A.id, material, unit, factor, variant, me],
  )
}
const baseUnitId = (tx: Queryable, material: string): Promise<string> =>
  scalar<string>(
    tx,
    `select id from public.material_units where material_id = $1 and factor = 1 and variant is null and deleted_at is null`,
    [material],
  )
/** Harakat qo'shadi; `softDelete` — qo'shib, darhol soft delete (RLS o'chirilgan qator qo'shishga yo'l qo'ymaydi). */
async function movement(
  tx: Queryable,
  material: string,
  type: 'kirim' | 'chiqim',
  qty: number,
  softDelete = false,
): Promise<string> {
  const r = await res(
    tx,
    `insert into public.movements (company_id, type, object_id, material_id, qty_input, unit_input, qty_base, created_by)
     values ($1, $2, $3, $4, $5, (select base_unit from public.materials where id = $4), 0, $6)`,
    [A.id, type, A.ids.obj1, material, qty, me],
  )
  if (r !== 'OK:1' || !softDelete) return r
  return res(
    tx,
    `update public.movements set deleted_at = now()
      where material_id = $1 and deleted_at is null and created_at = now()`,
    [material],
  )
}

// ============================================================================
// 1. Asosiy birlik
// ============================================================================
describe('1. asosiy birlik (materials.base_unit)', () => {
  it('ishlatilgan material (m1) — base_unit o`zgarmaydi', async () => {
    const r = await asAdmin((tx) => res(tx, `update public.materials set base_unit = 'tonna' where id = $1`, [A.ids.m1]))
    expect(r).toBe('P0001:catalog_base_unit_in_use')
  })

  it('ishlatilmagan material (m2) — base_unit o`zgaradi, factor = 1 qatori sinxron', async () => {
    const r = await asAdmin(async (tx) => {
      const before = await baseUnitId(tx, A.ids.m2!)
      const upd = await res(tx, `update public.materials set base_unit = 'tonna' where id = $1`, [A.ids.m2])
      const units = await rows<{ id: string; unit: string; factor: string }>(
        tx,
        `select id, unit, factor::text from public.material_units where material_id = $1 and deleted_at is null`,
        [A.ids.m2],
      )
      return { upd, same: units.length === 1 && units[0]!.id === before, units: units.map((u) => [u.unit, u.factor]) }
    })
    expect(r).toEqual({ upd: 'OK:1', same: true, units: [['tonna', '1.0000000000']] })
  })

  it('sinxron o`zgarish audit_log ga yoziladi', async () => {
    const r = await asAdmin(async (tx) => {
      const id = await baseUnitId(tx, A.ids.m2!)
      await tx.query(`update public.materials set base_unit = 'tonna' where id = $1`, [A.ids.m2])
      return scalar<number>(
        tx,
        `select count(*)::int from public.audit_log where table_name = 'material_units' and record_id = $1
           and action = 'UPDATE' and new_data ->> 'unit' = 'tonna'`,
        [id],
      )
    })
    expect(r).toBe(1)
  })

  it('base_unit — nomi boshqa (variantsiz) birlik bilan bir xil → conflict', async () => {
    const r = await asAdmin(async (tx) => {
      const m = await newMaterial(tx)
      await newUnit(tx, m, 'qop', 50)
      return res(tx, `update public.materials set base_unit = 'qop' where id = $1`, [m])
    })
    expect(r).toBe('P0001:catalog_base_unit_conflict')
  })

  it.each([
    ['o`chirilgan harakat', 'movement'],
    ['smeta qatori', 'estimate'],
    ['inventarizatsiya qatori', 'inventory'],
  ])('faqat %s bo`lsa ham — base_unit o`zgarmaydi', async (_l, kind) => {
    const r = await asAdmin(async (tx) => {
      const m = await newMaterial(tx)
      if (kind === 'movement') {
        expect(await movement(tx, m, 'kirim', 1, true)).toBe('OK:1')
      } else if (kind === 'estimate') {
        await tx.query(ESTIMATE_RPC)
        await tx.query(
          `insert into public.estimate_items (company_id, estimate_id, item_type, name, material_id, qty, created_by)
           values ($1, $2, 'material', 'X', $3, 1, $4)`,
          [A.id, A.ids.est_obj1, m, me],
        )
      } else {
        await tx.query(
          `insert into public.inventory_count_items (company_id, inventory_count_id, material_id, qty_counted, created_by)
           values ($1, $2, $3, 1, $4)`,
          [A.id, A.ids.ic_obj1, m, me],
        )
      }
      return res(tx, `update public.materials set base_unit = 'tonna' where id = $1`, [m])
    })
    expect(r).toBe('P0001:catalog_base_unit_in_use')
  })

  it('asosiy birlik qatori: soft delete / factor / unit / variant — taqiqlangan', async () => {
    const r = await asAdmin(async (tx) => {
      const id = await baseUnitId(tx, A.ids.m2!)
      const out: Record<string, string> = {}
      for (const [k, set] of [
        ['deleted', 'deleted_at = now()'],
        ['factor', 'factor = 2'],
        ['unit', `unit = 'litr'`],
        ['variant', `variant = 'x'`],
        ['material', `material_id = '${A.ids.m1}'`],
      ] as const) {
        out[k] = await res(tx, `update public.material_units set ${set} where id = $1`, [id])
      }
      out.note = await res(tx, `update public.material_units set updated_at = now() where id = $1`, [id])
      return out
    })
    const locked = 'P0001:catalog_base_unit_locked'
    expect(r).toEqual({ deleted: locked, factor: locked, unit: locked, variant: locked, material: locked, note: 'OK:1' })
  })

  it('variantli factor = 1 qatori asosiy emas — o`chirsa bo`ladi', async () => {
    const r = await asAdmin(async (tx) => {
      const m = await newMaterial(tx)
      const v = await newUnit(tx, m, 'kg', 1, 'qadoq')
      return res(tx, `update public.material_units set deleted_at = now() where id = $1`, [v])
    })
    expect(r).toBe('OK:1')
  })
})

// ============================================================================
// 2. Koeffitsient o'zgarishi
// ============================================================================
describe('2. birlik koeffitsienti (material_units)', () => {
  it('ishlatilgan birlik (u1 — xarid va so`rovda): factor / unit / variant o`zgarmaydi', async () => {
    const r = await asAdmin(async (tx) => ({
      factor: await res(tx, `update public.material_units set factor = 40 where id = $1`, [A.ids.u1]),
      unit: await res(tx, `update public.material_units set unit = 'qop50' where id = $1`, [A.ids.u1]),
      variant: await res(tx, `update public.material_units set variant = 'M400' where id = $1`, [A.ids.u1]),
    }))
    const inUse = 'P0001:catalog_unit_in_use'
    expect(r).toEqual({ factor: inUse, unit: inUse, variant: inUse })
  })

  it('ishlatilmagan birlik — factor, unit, variant o`zgaradi', async () => {
    const r = await asAdmin(async (tx) => {
      const id = await newUnit(tx, A.ids.m1!, 'tonna', 1000)
      return [
        await res(tx, `update public.material_units set factor = 1001 where id = $1`, [id]),
        await res(tx, `update public.material_units set unit = 't' where id = $1`, [id]),
        await res(tx, `update public.material_units set variant = 'yangi' where id = $1`, [id]),
      ]
    })
    expect(r).toEqual(['OK:1', 'OK:1', 'OK:1'])
  })

  it('faqat o`chirilgan yozuvda ishlatilgan birlik ham o`zgarmaydi (tiklanganda qty_base buzilmasin)', async () => {
    const r = await asAdmin(async (tx) => {
      const id = await newUnit(tx, A.ids.m1!, 'paket', 25)
      const mv = await scalar<string>(
        tx,
        `insert into public.movements (company_id, type, object_id, material_id, unit_id, qty_input, unit_input, qty_base, created_by)
         values ($1, 'kirim', $2, $3, $4, 1, 'x', 0, $5) returning id`,
        [A.id, A.ids.obj1, A.ids.m1, id, me],
      )
      await tx.query(`update public.movements set deleted_at = now() where id = $1`, [mv])
      return res(tx, `update public.material_units set factor = 30 where id = $1`, [id])
    })
    expect(r).toBe('P0001:catalog_unit_in_use')
  })

  it('ishlatilgan birlikni soft delete — ruxsat; keyin yangi yozuv u bilan → 23503', async () => {
    const r = await asAdmin(async (tx) => ({
      del: await res(tx, `update public.material_units set deleted_at = now() where id = $1`, [A.ids.u1]),
      ins: await res(
        tx,
        `insert into public.movements (company_id, type, object_id, material_id, unit_id, qty_input, unit_input, qty_base, created_by)
         values ($1, 'kirim', $2, $3, $4, 1, 'qop', 0, $5)`,
        [A.id, A.ids.obj1, A.ids.m1, A.ids.u1, me],
      ),
    }))
    expect(r).toEqual({ del: 'OK:1', ins: '23503:ops_unit_not_found' })
  })

  it('yangi birlik qo`shib, eskisini o`chirish — tavsiya etilgan yo`l', async () => {
    const r = await asAdmin(async (tx) => {
      const del = await res(tx, `update public.material_units set deleted_at = now() where id = $1`, [A.ids.u1])
      const id = await newUnit(tx, A.ids.m1!, 'qop', 40)
      const q = await scalar<string>(
        tx,
        `insert into public.movements (company_id, type, object_id, material_id, unit_id, qty_input, unit_input, qty_base, created_by)
         values ($1, 'kirim', $2, $3, $4, 2, 'x', 0, $5) returning qty_base::text`,
        [A.id, A.ids.obj1, A.ids.m1, id, me],
      )
      const old = await scalar<string>(tx, `select qty_base::text from public.purchases where id = $1`, [A.ids.p_pro_obj1])
      return { del, q, old }
    })
    expect(r).toEqual({ del: 'OK:1', q: '80.000000', old: '500.000000' })
  })
})

// ============================================================================
// 3. Operatsiya UPDATE da qayta hisoblash (b_compute_qty)
// ============================================================================
describe('3. eski yozuvni yangilash (o`chirilgan birlik bilan)', () => {
  it('birlik o`chirilgandan keyin: xarid note / soft delete / tiklash — qty_base o`zgarmaydi', async () => {
    const r = await asAdmin(async (tx) => {
      await tx.query(`update public.material_units set deleted_at = now() where id = $1`, [A.ids.u1])
      const p = A.ids.p_pro_obj1
      // Batch 5: bog'langan kirimi bor xarid o'chirilmaydi (purchase_has_receipts) — avval kirim
      await tx.query(`update public.movements set deleted_at = now() where id = $1`, [A.ids.mv_obj1])
      const out = {
        note: await res(tx, `update public.purchases set note = 'tuzatish' where id = $1`, [p]),
        del: await res(tx, `update public.purchases set deleted_at = now() where id = $1`, [p]),
        restore: await res(tx, `update public.purchases set deleted_at = null where id = $1`, [p]),
        req: await res(tx, `update public.material_requests set deleted_at = now() where id = $1`, [A.ids.mr_obj1]),
        row: await one(
          tx,
          `select qty_base::text, unit_input, unit_price::text from public.purchases where id = $1`,
          [p],
        ),
      }
      return out
    })
    expect(r).toEqual({
      note: 'OK:1',
      del: 'OK:1',
      restore: 'OK:1',
      req: 'OK:1',
      row: { qty_base: '500.000000', unit_input: 'qop', unit_price: '60000.00' },
    })
  })

  it('o`chirilgan birlikka yangi qatorda o`tkazish (unit_id o`zgarsa) — 23503', async () => {
    const r = await asAdmin(async (tx) => {
      const id = await newUnit(tx, A.ids.m1!, 'paket', 25)
      await tx.query(`update public.material_units set deleted_at = now() where id = $1`, [id])
      return res(tx, `update public.purchases set unit_id = $2 where id = $1`, [A.ids.p_pro_obj1, id])
    })
    expect(r).toBe('23503:ops_unit_not_found')
  })
})

// ============================================================================
// 4. Material nomi ↔ alias
// ============================================================================
describe('4. material nomi va muqobil nom to`qnashuvi', () => {
  const conflict = 'P0001:catalog_name_alias_conflict'
  // m1 alias'i: 'A Цемент'; m2 nomi: 'A qum'

  it('yangi material nomi = boshqa material alias`i (katta-kichik harf farqi bilan) → conflict', async () => {
    const r = await asAdmin((tx) =>
      res(tx, `insert into public.materials (company_id, name, base_unit, created_by) values ($1, 'a цемент', 'kg', $2)`, [A.id, me]),
    )
    expect(r).toBe(conflict)
  })

  it('materialni boshqa alias nomiga qayta nomlash → conflict; boshqa nomga — OK', async () => {
    const r = await asAdmin(async (tx) => [
      await res(tx, `update public.materials set name = 'A ЦЕМЕНТ' where id = $1`, [A.ids.m2]),
      await res(tx, `update public.materials set name = 'A qum yuvilgan' where id = $1`, [A.ids.m2]),
    ])
    expect(r).toEqual([conflict, 'OK:1'])
  })

  it('alias = boshqa material nomi → conflict (insert va update)', async () => {
    const r = await asAdmin(async (tx) => [
      await res(
        tx,
        `insert into public.material_aliases (company_id, material_id, alias, created_by) values ($1, $2, 'A QUM', $3)`,
        [A.id, A.ids.m1, me],
      ),
      await res(tx, `update public.material_aliases set alias = 'a qum' where id = $1`, [A.ids.al1]),
    ])
    expect(r).toEqual([conflict, conflict])
  })

  it('alias = o`z materiali nomi — ruxsat', async () => {
    const r = await asAdmin((tx) =>
      res(
        tx,
        `insert into public.material_aliases (company_id, material_id, alias, created_by) values ($1, $2, 'A SEMENT', $3)`,
        [A.id, A.ids.m1, me],
      ),
    )
    expect(r).toBe('OK:1')
  })

  it('o`chirilgan alias / o`chirilgan material to`qnashmaydi; tiklashda tekshiriladi', async () => {
    const r = await asAdmin(async (tx) => {
      // o'chirilgan material X ning alias'i 'Foo' — yangi 'foo' materialga xalaqit bermaydi
      const x = await newMaterial(tx, 'X material')
      await tx.query(
        `insert into public.material_aliases (company_id, material_id, alias, created_by) values ($1, $2, 'Foo', $3)`,
        [A.id, x, me],
      )
      const delX = await res(tx, `update public.materials set deleted_at = now() where id = $1`, [x])
      const foo = await res(tx, `insert into public.materials (company_id, name, base_unit, created_by) values ($1, 'foo', 'kg', $2)`, [A.id, me])
      // X ni tiklash — uning alias'i endi 'foo' material nomi bilan to'qnashadi
      const restoreX = await res(tx, `update public.materials set deleted_at = null where id = $1`, [x])

      // o'chirilgan alias 'Bar' (m1) — 'bar' material yaratiladi; alias tiklansa → conflict
      const bar = await scalar<string>(
        tx,
        `insert into public.material_aliases (company_id, material_id, alias, created_by) values ($1, $2, 'Bar', $3) returning id`,
        [A.id, A.ids.m1, me],
      )
      await tx.query(`update public.material_aliases set deleted_at = now() where id = $1`, [bar])
      const barMat = await res(tx, `insert into public.materials (company_id, name, base_unit, created_by) values ($1, 'bar', 'kg', $2)`, [A.id, me])
      const restoreBar = await res(tx, `update public.material_aliases set deleted_at = null where id = $1`, [bar])
      return { delX, foo, restoreX, barMat, restoreBar }
    })
    expect(r).toEqual({ delX: 'OK:1', foo: 'OK:1', restoreX: conflict, barMat: 'OK:1', restoreBar: conflict })
  })

  it('alias`ning boshqa maydonini o`zgartirish (lang) — tekshiruvsiz OK', async () => {
    const r = await asAdmin((tx) => res(tx, `update public.material_aliases set lang = 'uz' where id = $1`, [A.ids.al1]))
    expect(r).toBe('OK:1')
  })
})

// ============================================================================
// 5. Materialni o'chirish va nofaol qilish
// ============================================================================
describe('5. materialni o`chirish / nofaol qilish', () => {
  it('qoldig`i bor material (m1) — soft delete taqiqlangan', async () => {
    const r = await asAdmin((tx) => res(tx, `update public.materials set deleted_at = now() where id = $1`, [A.ids.m1]))
    expect(r).toBe('P0001:catalog_material_has_stock')
  })

  it('xato matni obyekt nomini aytadi (o`zbekcha)', async () => {
    const msg = await asAdmin(async (tx) => {
      await tx.exec('savepoint s')
      try {
        await tx.query(`update public.materials set deleted_at = now() where id = $1`, [A.ids.m1])
        return 'OK'
      } catch (e) {
        await tx.exec('rollback to savepoint s')
        return (e as Error).message
      }
    })
    expect(msg).toContain('A obj1')
    expect(msg).toContain("qoldig'i bor")
  })

  it('qoldig`i 0 (kirim = chiqim) yoki harakatsiz material — o`chiriladi', async () => {
    const r = await asAdmin(async (tx) => {
      const m = await newMaterial(tx)
      await movement(tx, m, 'kirim', 10)
      await movement(tx, m, 'chiqim', 10)
      return [
        await res(tx, `update public.materials set deleted_at = now() where id = $1`, [m]),
        await res(tx, `update public.materials set deleted_at = now() where id = $1`, [A.ids.m2]),
      ]
    })
    expect(r).toEqual(['OK:1', 'OK:1'])
  })

  it('manfiy qoldiq ham nol emas — o`chirilmaydi', async () => {
    const r = await asAdmin(async (tx) => {
      const m = await newMaterial(tx)
      await movement(tx, m, 'chiqim', 3)
      return res(tx, `update public.materials set deleted_at = now() where id = $1`, [m])
    })
    expect(r).toBe('P0001:catalog_material_has_stock')
  })

  it('o`chirilgan harakatlar qoldiqqa kirmaydi', async () => {
    const r = await asAdmin(async (tx) => {
      const m = await newMaterial(tx)
      await movement(tx, m, 'kirim', 5, true)
      return res(tx, `update public.materials set deleted_at = now() where id = $1`, [m])
    })
    expect(r).toBe('OK:1')
  })

  it('nofaol qilish — qoldiq bo`lsa ham ruxsat', async () => {
    const r = await asAdmin((tx) => res(tx, `update public.materials set is_active = false where id = $1`, [A.ids.m1]))
    expect(r).toBe('OK:1')
  })

  it('nofaol material: kirim/chiqim, xarid, o`tkazma, so`rov — taqiqlangan; inventarizatsiya, smeta — ruxsat', async () => {
    const r = await asAdmin(async (tx) => {
      await tx.query(`update public.materials set is_active = false where id = $1`, [A.ids.m1])
      await tx.query(ESTIMATE_RPC)
      const ic = await scalar<string>(
        tx,
        `insert into public.inventory_counts (company_id, object_id, created_by) values ($1, $2, $3) returning id`,
        [A.id, A.ids.obj3, me],
      )
      return {
        kirim: await movement(tx, A.ids.m1!, 'kirim', 1),
        chiqim: await movement(tx, A.ids.m1!, 'chiqim', 1),
        purchase: await res(
          tx,
          `insert into public.purchases (company_id, buyer_id, object_id, material_id, qty_input, unit_input, qty_base,
             unit_price, total_amount, created_by)
           values ($1, $2, $3, $4, 1, 'kg', 1, 1, 1, $2)`,
          [A.id, me, A.ids.obj1, A.ids.m1],
        ),
        transfer: await res(
          tx,
          `insert into public.transfers (company_id, from_object_id, to_object_id, material_id, qty_input, unit_input, qty_base, created_by)
           values ($1, $2, $3, $4, 1, 'kg', 1, $5)`,
          [A.id, A.ids.obj1, A.ids.obj2, A.ids.m1, me],
        ),
        request: await res(
          tx,
          `insert into public.material_requests (company_id, object_id, material_id, qty_input, unit_input, qty_base, created_by)
           values ($1, $2, $3, 1, 'kg', 1, $4)`,
          [A.id, A.ids.obj1, A.ids.m1, me],
        ),
        transferOut: await res(
          tx,
          `insert into public.movements (company_id, type, object_id, material_id, qty_input, unit_input, qty_base, transfer_id, created_by)
           values ($1, 'transfer_out', $2, $3, 1, 'kg', 1, $4, $5)`,
          [A.id, A.ids.obj1, A.ids.m1, A.ids.tr_1to2, me],
        ),
        inventory: await res(
          tx,
          `insert into public.inventory_count_items (company_id, inventory_count_id, material_id, qty_counted, created_by)
           values ($1, $2, $3, 1, $4)`,
          [A.id, ic, A.ids.m1, me],
        ),
        estimate: await res(
          tx,
          `insert into public.estimate_items (company_id, estimate_id, item_type, name, material_id, qty, created_by)
           values ($1, $2, 'material', 'S', $3, 1, $4)`,
          [A.id, A.ids.est_obj1, A.ids.m1, me],
        ),
        // eski yozuvni tahrirlash (material o'zgarmasa) — ruxsat
        oldNote: await res(tx, `update public.movements set note = 'x' where id = $1`, [A.ids.mv_obj1]),
      }
    })
    const inactive = 'P0001:catalog_material_inactive'
    expect(r).toEqual({
      kirim: inactive,
      chiqim: inactive,
      purchase: inactive,
      transfer: inactive,
      request: inactive,
      transferOut: '42501:movement_rpc_only', // audit_fixes A4: o'tkazma harakati faqat RPC orqali
      inventory: 'OK:1',
      estimate: 'OK:1',
      oldNote: 'OK:1',
    })
  })

  it('mavjud yozuvning material_id sini nofaol materialga o`zgartirish — taqiqlangan', async () => {
    const r = await asAdmin(async (tx) => {
      await tx.query(`update public.materials set is_active = false where id = $1`, [A.ids.m2])
      const u = await baseUnitId(tx, A.ids.m2!)
      return res(tx, `update public.material_requests set material_id = $2, unit_id = $3 where id = $1`, [
        A.ids.mr_obj2,
        A.ids.m2,
        u,
      ])
    })
    expect(r).toBe('P0001:catalog_material_inactive')
  })

  it('prorab: nofaol materialga kirim → catalog_material_inactive', async () => {
    await db.query(`update public.materials set is_active = false where id = $1`, [A.ids.m1])
    try {
      const r = await asUser(db, A.users.prorab.authUid, (tx) =>
        res(
          tx,
          `insert into public.movements (company_id, type, object_id, material_id, qty_input, unit_input, qty_base, created_by)
           values ($1, 'kirim', $2, $3, 1, 'kg', 1, $4)`,
          [A.id, A.ids.obj1, A.ids.m1, A.users.prorab.profileId],
        ),
      )
      expect(r).toBe('P0001:catalog_material_inactive')
    } finally {
      await db.query(`update public.materials set is_active = true where id = $1`, [A.ids.m1])
    }
  })

  it('o`chirilgan material: hech qanday yangi yozuv (smeta, inventarizatsiya, harakat)', async () => {
    const r = await asAdmin(async (tx) => {
      const m = await newMaterial(tx)
      await tx.query(`update public.materials set deleted_at = now() where id = $1`, [m])
      await tx.query(ESTIMATE_RPC)
      return {
        estimate: await res(
          tx,
          `insert into public.estimate_items (company_id, estimate_id, item_type, name, material_id, qty, created_by)
           values ($1, $2, 'material', 'S', $3, 1, $4)`,
          [A.id, A.ids.est_obj1, m, me],
        ),
        inventory: await res(
          tx,
          `insert into public.inventory_count_items (company_id, inventory_count_id, material_id, qty_counted, created_by)
           values ($1, $2, $3, 1, $4)`,
          [A.id, A.ids.ic_obj2, m, me],
        ),
        kirim: await movement(tx, m, 'kirim', 1),
        // ish turi (materialsiz) smeta qatori — ta'sir qilmaydi
        work: await res(
          tx,
          `insert into public.estimate_items (company_id, estimate_id, item_type, name, qty, created_by)
           values ($1, $2, 'ish', 'Suvoq', 1, $3)`,
          [A.id, A.ids.est_obj1, me],
        ),
      }
    })
    const deleted = 'P0001:catalog_material_deleted'
    expect(r).toEqual({ estimate: deleted, inventory: deleted, kirim: deleted, work: 'OK:1' })
  })

  it('materialni tiklash (admin) — ruxsat', async () => {
    const r = await asAdmin(async (tx) => {
      const m = await newMaterial(tx)
      await tx.query(`update public.materials set deleted_at = now() where id = $1`, [m])
      return res(tx, `update public.materials set deleted_at = null where id = $1`, [m])
    })
    expect(r).toBe('OK:1')
  })
})

// ============================================================================
// 6. Katalog RLS — faqat admin / super_admin yozadi
// ============================================================================
describe('6. katalog RLS (manage_catalog = admin, super_admin)', () => {
  const others = ['direktor', 'buxgalter', 'taminotchi', 'prorab', 'omborchi', 'haydovchi', 'tekshiruvchi'] as const

  it.each(others)('%s: materials / material_units / material_aliases ni o`zgartira olmaydi', async (role) => {
    const r = await asUser(db, A.users[role].authUid, async (tx) => [
      await res(tx, `update public.materials set base_unit = 'x' where id = $1`, [A.ids.m2]),
      await res(tx, `update public.material_units set factor = 3 where id = $1`, [A.ids.u1]),
      await res(tx, `update public.material_aliases set alias = 'z' where id = $1`, [A.ids.al1]),
    ])
    expect(r).toEqual(['OK:0', 'OK:0', 'OK:0'])
  })

  it('katalog UPDATE/INSERT siyosatlari faqat super_admin va admin rollarini tilga oladi', async () => {
    const r = await rows<{ tablename: string; cmd: string; expr: string }>(
      db,
      `select tablename, cmd, coalesce(with_check, qual) as expr from pg_policies
        where schemaname = 'public' and tablename in ('materials', 'material_units', 'material_aliases', 'suppliers')
          and cmd in ('INSERT', 'UPDATE')
          -- Batch 5: suppliers INSERT xarid kiritadigan rollarga kengaydi (purchases_batch5 testi)
          and not (tablename = 'suppliers' and cmd = 'INSERT')
        order by 1, 2`,
    )
    expect(r).toHaveLength(7)
    for (const p of r) {
      expect(p.expr).toMatch(/has_role\(VARIADIC ARRAY\['super_admin'::user_role, 'admin'::user_role\]\)/)
    }
  })
})

// ============================================================================
// Invariantlar
// ============================================================================
describe('invariantlar (yangi funksiyalar)', () => {
  const fns = [
    'material_is_referenced',
    'unit_is_referenced',
    'lock_catalog_names',
    'tg_materials_guard',
    'tg_materials_base_unit_sync',
    'tg_materials_aliases_cascade',
    'tg_material_units_guard',
    'tg_material_aliases_guard',
    'tg_ops_material_guard',
  ]

  it('hammasi private sxemada, search_path = "", anon/authenticated execute yo`q', async () => {
    const r = await rows<{ proname: string; nsp: string; sp: boolean; anon: boolean; auth: boolean; pub: boolean }>(
      db,
      `select p.proname, n.nspname as nsp,
              'search_path=""' = any (coalesce(p.proconfig, '{}')) as sp,
              has_function_privilege('anon', p.oid, 'execute') as anon,
              has_function_privilege('authenticated', p.oid, 'execute') as auth,
              exists (select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                       where a.grantee = 0 and a.privilege_type = 'EXECUTE') as pub
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where p.proname = any ($1) order by 1`,
      [fns],
    )
    expect(r.map((x) => x.proname).sort()).toEqual([...fns].sort())
    for (const f of r) expect(f).toMatchObject({ nsp: 'private', sp: true, anon: false, auth: false, pub: false })
  })

  it('triggerlar o`rnatilgan', async () => {
    const r = await rows<{ t: string }>(
      db,
      `select c.relname || '.' || tg.tgname as t from pg_trigger tg join pg_class c on c.oid = tg.tgrelid
        where not tg.tgisinternal and tg.tgname in ('b_materials_guard', 'c_base_unit_sync', 'b_material_units_guard',
              'b_material_aliases_guard', 'b_check_material', 'c_aliases_cascade') order by 1`,
    )
    expect(r.map((x) => x.t)).toEqual([
      'estimate_items.b_check_material',
      'inventory_count_items.b_check_material',
      'material_aliases.b_material_aliases_guard',
      'material_requests.b_check_material',
      'material_units.b_material_units_guard',
      'materials.b_materials_guard',
      'materials.c_aliases_cascade',
      'materials.c_base_unit_sync',
      'movements.b_check_material',
      'purchases.b_check_material',
      'transfers.b_check_material',
    ])
  })
})

// ============================================================================
// Reviewer topilmalari (Batch 3)
// ============================================================================

/** Superuser tranzaksiyasi, oxirida rollback. */
async function inTx<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    const r = await fn(tx)
    await tx.rollback()
    return r
  })
}

/** Xato xabari (yoki 'OK'), savepoint bilan. */
async function errMsg(tx: Tx, sql: string, params: unknown[] = []): Promise<string> {
  await tx.exec('savepoint cg_msg')
  try {
    await tx.query(sql, params)
    await tx.exec('release savepoint cg_msg')
    return 'OK'
  } catch (e) {
    await tx.exec('rollback to savepoint cg_msg')
    return (e as Error).message
  }
}

describe('R1. b_compute_qty: material → birlik FOR SHARE, trigger tartibi', () => {
  it('funksiya avval materials, keyin material_units ni FOR SHARE bilan o`qiydi', async () => {
    const src = await scalar<string>(db, `select prosrc from pg_proc where oid = 'private.tg_compute_qty()'::regprocedure`)
    const mat = src.search(/from public\.materials m[\s\S]*?for share/)
    const unit = src.search(/select mu\.material_id, mu\.unit, mu\.variant, mu\.factor[\s\S]*?for share/)
    expect(mat).toBeGreaterThan(-1)
    expect(unit).toBeGreaterThan(mat)
  })

  it.each(['movements', 'purchases', 'transfers', 'material_requests'])(
    '%s: b_check_material b_compute_qty dan oldin ishlaydi',
    async (t) => {
      const r = await rows<{ tgname: string }>(
        db,
        `select tgname from pg_trigger where tgrelid = $1::regclass and tgname in ('b_check_material', 'b_compute_qty')
          order by tgname`,
        [`public.${t}`],
      )
      expect(r.map((x) => x.tgname)).toEqual(['b_check_material', 'b_compute_qty'])
    },
  )

  it('unit_id siz — unit_input norm_name bo`yicha topiladi ("  QOP ")', async () => {
    const r = await asAdmin((tx) =>
      one(
        tx,
        `insert into public.movements (company_id, type, object_id, material_id, qty_input, unit_input, qty_base, created_by)
         values ($1, 'kirim', $2, $3, 2, '  QOP ', 0, $4) returning unit_id, unit_input, qty_base::text`,
        [A.id, A.ids.obj1, A.ids.m1, me],
      ),
    )
    expect(r).toEqual({ unit_id: A.ids.u1, unit_input: 'qop', qty_base: '100.000000' })
  })
})

describe('R2. o`chirilgan materialning yozuvlari muzlatiladi', () => {
  let x: string
  let kirim: string
  let chiqim: string
  let ic: string

  beforeAll(async () => {
    x = (await insertRow<{ id: string }>(db, 'materials', { company_id: A.id, name: 'R2 material', base_unit: 'kg' })).id
    const mv = async (type: string, qty: number): Promise<string> =>
      (
        await insertRow<{ id: string }>(db, 'movements', {
          company_id: A.id,
          type,
          object_id: A.ids.obj1,
          material_id: x,
          qty_input: qty,
          unit_input: 'kg',
          qty_base: qty,
        })
      ).id
    kirim = await mv('kirim', 5)
    chiqim = await mv('chiqim', 5)
    ic = (await insertRow<{ id: string }>(db, 'inventory_counts', { company_id: A.id, object_id: A.ids.obj3 })).id
    await insertRow(db, 'inventory_count_items', {
      company_id: A.id,
      inventory_count_id: ic,
      material_id: x,
      qty_counted: 0,
    })
    await db.query(`update public.materials set deleted_at = now() where id = $1`, [x])
  })

  it('soft delete / miqdor / tur / obyekt / material — taqiqlangan; izoh, rasm — ruxsat', async () => {
    const r = await asAdmin(async (tx) => {
      const upd = (id: string, set: string): Promise<string> =>
        res(tx, `update public.movements set ${set} where id = $1`, [id])
      const kgOther = await baseUnitId(tx, A.ids.m1!)
      return {
        softDelete: await upd(chiqim, 'deleted_at = now()'),
        qty: await upd(kirim, 'qty_input = 50'),
        type: await upd(kirim, `type = 'chiqim'`),
        object: await upd(kirim, `object_id = '${A.ids.obj2}'`),
        material: await upd(kirim, `material_id = '${A.ids.m1}', unit_id = '${kgOther}'`),
        note: await upd(kirim, `note = 'izoh'`),
        // Batch 4: yo'l formati va firma papkasi trigger bilan tekshiriladi
        photo: await upd(kirim, `photo_path = '${A.id}/2026/10/0b7c2a8e-5f3d-4c1a-9e2b-6d8f0a1b2c3d.jpg'`),
        stock: await scalar<number>(
          tx,
          `select count(*)::int from public.stock_balances where material_id = $1 and qty_base <> 0`,
          [x],
        ),
      }
    })
    const del = 'P0001:catalog_material_deleted'
    expect(r).toEqual({
      softDelete: del,
      qty: del,
      type: del,
      object: del,
      material: del,
      note: 'OK:1',
      photo: 'OK:1',
      stock: 0,
    })
  })

  it('superuser / service uchun ham (ma`lumot yaxlitligi)', async () => {
    const r = await inTx((tx) => res(tx, `update public.movements set deleted_at = now() where id = $1`, [chiqim]))
    expect(r).toBe('P0001:catalog_material_deleted')
  })

  it('submit_inventory_count: o`chirilgan material qatori bo`lsa ham ishlaydi (qty_expected — hisoblanadigan ustun)', async () => {
    const r = await asAdmin(async (tx) => {
      await tx.query(`select public.submit_inventory_count($1)`, [ic])
      return scalar<string>(tx, `select status::text from public.inventory_counts where id = $1`, [ic])
    })
    expect(r).toBe('submitted')
  })

  it('material tiklangandan keyin — yozuvlar yana tahrirlanadi', async () => {
    const r = await asAdmin(async (tx) => {
      await tx.query(`update public.materials set deleted_at = null where id = $1`, [x])
      return res(tx, `update public.movements set deleted_at = now() where id = $1`, [chiqim])
    })
    expect(r).toBe('OK:1')
  })
})

describe('R3. norm_name va normallashtirilgan unique indekslar', () => {
  it.each([
    ['  Sement\t\tM400 ', 'sement m400'],
    ['a b c d', 'a b c d'],
    ['\r\nЦЕМЕНТ  М500\n', 'цемент м500'],
    ['Ёлка ёж', 'елка еж'],
    ['   ', ''],
  ])('norm_name(%j) = %j', async (input, out) => {
    expect(await scalar(db, `select private.norm_name($1)`, [input])).toBe(out)
  })

  it('norm_name(null) = null; immutable, search_path = "", anon execute yo`q', async () => {
    expect(await scalar(db, `select private.norm_name(null)`)).toBeNull()
    const f = await one<{ v: string; sp: boolean; anon: boolean }>(
      db,
      `select provolatile::text as v, 'search_path=""' = any (proconfig) as sp,
              has_function_privilege('anon', oid, 'execute') as anon
         from pg_proc where oid = 'private.norm_name(text)'::regprocedure`,
    )
    expect(f).toEqual({ v: 'i', sp: true, anon: false })
  })

  it('unique indekslar norm_name bo`yicha', async () => {
    const r = await rows<{ indexname: string; d: string }>(
      db,
      `select indexname, indexdef as d from pg_indexes where schemaname = 'public' and indexname in
         ('materials_company_name_key', 'material_aliases_company_alias_key', 'material_units_material_unit_variant_key')
        order by 1`,
    )
    expect(r).toHaveLength(3)
    for (const i of r) {
      expect(i.d).toContain('private.norm_name(')
      expect(i.d).toContain('WHERE (deleted_at IS NULL)')
      expect(i.d).toContain('UNIQUE')
    }
  })

  it('material nomi: bo`sh joy / ё farqi — dublikat (23505 catalog_name_duplicate)', async () => {
    const r = await asAdmin(async (tx) => {
      await newMaterial(tx, 'Qora ёlka')
      return [
        await res(tx, `insert into public.materials (company_id, name, base_unit, created_by) values ($1, ' qora  ЕLKA ', 'kg', $2)`, [A.id, me]),
        await res(tx, `update public.materials set name = 'QORA ELKA BOSHQA' where id = $1`, [A.ids.m2]),
      ]
    })
    expect(r).toEqual(['23505:catalog_name_duplicate', 'OK:1'])
  })

  it('alias: bo`sh joy farqi — dublikat; ё/е farqi bilan material nomiga to`qnashuv', async () => {
    const r = await asAdmin(async (tx) => {
      await newMaterial(tx, 'Ёрма')
      return {
        dup: await res(
          tx,
          `insert into public.material_aliases (company_id, material_id, alias, created_by) values ($1, $2, '  a   цемент', $3)`,
          [A.id, A.ids.m2, me],
        ),
        nameConflict: await res(
          tx,
          `insert into public.material_aliases (company_id, material_id, alias, created_by) values ($1, $2, 'ерма', $3)`,
          [A.id, A.ids.m1, me],
        ),
        materialVsAlias: await res(
          tx,
          `insert into public.materials (company_id, name, base_unit, created_by) values ($1, E'A\\tЦемент', 'kg', $2)`,
          [A.id, me],
        ),
      }
    })
    expect(r).toEqual({
      dup: '23505:catalog_alias_duplicate',
      nameConflict: 'P0001:catalog_name_alias_conflict',
      materialVsAlias: 'P0001:catalog_name_alias_conflict',
    })
  })

  it('migratsiya: normallashtirilgan dublikat bo`lsa — aniq xato bilan to`xtaydi', async () => {
    const old = await createDb({ migrationsBefore: '20261027000001' })
    try {
      const co = await createCompany(old)
      await insertRow(old, 'materials', { company_id: co, name: 'Qum', base_unit: 'm³' })
      await insertRow(old, 'materials', { company_id: co, name: 'qum ', base_unit: 'm³' })
      const rest = listMigrations().filter((f) => f >= '20261027000001')
      await expect(applyMigrations(old, rest)).rejects.toThrow(/normallashtirilgan nomi bir xil materiallar bor/)
    } finally {
      await old.close()
    }
  })
})

describe('R4. material o`chirilganda / tiklanganda alias`lar', () => {
  it('o`chirishda faol alias`lar aynan shu deleted_at bilan; tiklashda faqat ular', async () => {
    const y = (await insertRow<{ id: string }>(db, 'materials', { company_id: A.id, name: 'R4 material', base_unit: 'kg' })).id
    const a1 = (await insertRow<{ id: string }>(db, 'material_aliases', { company_id: A.id, material_id: y, alias: 'R4 bir' })).id
    const a2 = (await insertRow<{ id: string }>(db, 'material_aliases', { company_id: A.id, material_id: y, alias: 'R4 ikki' })).id
    // a2 — oldin, alohida tranzaksiyada qo'lda o'chirilgan. Vaqt aniq oldinroq: Windows/PGlite'da ikki
    // tranzaksiyaning now() qiymati teng chiqib, test tasodifan yiqilardi. tg_before_update null → qiymat
    // o'tishida now() qo'yadi, shuning uchun avval o'chirib, keyin vaqtni superuser sifatida suramiz.
    await db.query(`update public.material_aliases set deleted_at = now() where id = $1`, [a2])
    await db.query(`alter table public.material_aliases disable trigger user`)
    await db.query(`update public.material_aliases set deleted_at = deleted_at - interval '1 minute' where id = $1`, [a2])
    await db.query(`alter table public.material_aliases enable trigger user`)

    const r = await asAdmin(async (tx) => {
      await tx.query(`update public.materials set deleted_at = now() where id = $1`, [y])
      const afterDel = await one<{ same: boolean; a2kept: boolean }>(
        tx,
        `select (select deleted_at from public.material_aliases where id = $2) = m.deleted_at as same,
                (select deleted_at from public.material_aliases where id = $3) < m.deleted_at as a2kept
           from public.materials m where m.id = $1`,
        [y, a1, a2],
      )
      await tx.query(`update public.materials set deleted_at = null where id = $1`, [y])
      const afterRestore = await rows<{ alias: string; live: boolean }>(
        tx,
        `select alias, deleted_at is null as live from public.material_aliases where material_id = $1 order by alias`,
        [y],
      )
      return { afterDel, afterRestore }
    })
    expect(r).toEqual({
      afterDel: { same: true, a2kept: true },
      afterRestore: [
        { alias: 'R4 bir', live: true },
        { alias: 'R4 ikki', live: false },
      ],
    })
  })

  it('tiklashda alias boshqa materialda band bo`lsa — 23505 catalog_alias_duplicate', async () => {
    const r = await asAdmin(async (tx) => {
      const y = await newMaterial(tx, 'R4 ikkinchi')
      await tx.query(
        `insert into public.material_aliases (company_id, material_id, alias, created_by) values ($1, $2, 'Zed', $3)`,
        [A.id, y, me],
      )
      await tx.query(`update public.materials set deleted_at = now() where id = $1`, [y])
      await tx.query(
        `insert into public.material_aliases (company_id, material_id, alias, created_by) values ($1, $2, ' zed', $3)`,
        [A.id, A.ids.m2, me],
      )
      return res(tx, `update public.materials set deleted_at = null where id = $1`, [y])
    })
    expect(r).toBe('23505:catalog_alias_duplicate')
  })
})

describe('R5. birlik nomi unique (norm_name)', () => {
  it('" QOP" (m1 da qop bor) va variant bo`sh joy farqi — 23505 catalog_unit_duplicate', async () => {
    const r = await asAdmin(async (tx) => {
      const m = await newMaterial(tx)
      await newUnit(tx, m, 'metr', 0.395, 'Ø8')
      return [
        await res(
          tx,
          `insert into public.material_units (company_id, material_id, unit, factor, created_by) values ($1, $2, ' QOP', 50, $3)`,
          [A.id, A.ids.m1, me],
        ),
        await res(
          tx,
          `insert into public.material_units (company_id, material_id, unit, factor, variant, created_by)
           values ($1, $2, 'Metr', 0.4, ' Ø8 ', $3)`,
          [A.id, m, me],
        ),
        await res(
          tx,
          `insert into public.material_units (company_id, material_id, unit, factor, variant, created_by)
           values ($1, $2, 'metr', 0.617, 'Ø10', $3)`,
          [A.id, m, me],
        ),
      ]
    })
    expect(r).toEqual(['23505:catalog_unit_duplicate', '23505:catalog_unit_duplicate', 'OK:1'])
  })
})

describe('R6. o`chirilgan materialga birlik / alias', () => {
  it('insert va material_id ni o`chirilgan materialga o`zgartirish — catalog_material_deleted', async () => {
    const r = await asAdmin(async (tx) => {
      const x = await newMaterial(tx)
      await tx.query(`update public.materials set deleted_at = now() where id = $1`, [x])
      const u = await newUnit(tx, A.ids.m2!, 'qop', 0.03)
      return {
        unitIns: await res(
          tx,
          `insert into public.material_units (company_id, material_id, unit, factor, created_by) values ($1, $2, 'qop', 50, $3)`,
          [A.id, x, me],
        ),
        unitMove: await res(tx, `update public.material_units set material_id = $2 where id = $1`, [u, x]),
        aliasIns: await res(
          tx,
          `insert into public.material_aliases (company_id, material_id, alias, created_by) values ($1, $2, 'R6 alias', $3)`,
          [A.id, x, me],
        ),
        aliasMove: await res(tx, `update public.material_aliases set material_id = $2 where id = $1`, [A.ids.al1, x]),
      }
    })
    const del = 'P0001:catalog_material_deleted'
    expect(r).toEqual({ unitIns: del, unitMove: del, aliasIns: del, aliasMove: del })
  })
})

describe('R7. deleted_at — server vaqti', () => {
  it('klient yuborgan deleted_at e`tiborga olinmaydi; qo`yilgan qiymat o`zgarmaydi', async () => {
    const r = await asAdmin(async (tx) => {
      const s = await scalar<string>(
        tx,
        `insert into public.suppliers (company_id, name, created_by) values ($1, 'R7', $2) returning id`,
        [A.id, me],
      )
      await tx.query(`update public.suppliers set deleted_at = '2000-01-01' where id = $1`, [s])
      const first = await one<{ now: boolean; t: string }>(
        tx,
        `select deleted_at = now() as now, deleted_at::text as t from public.suppliers where id = $1`,
        [s],
      )
      await tx.query(`update public.suppliers set deleted_at = '2010-01-01' where id = $1`, [s])
      const second = await scalar<string>(tx, `select deleted_at::text from public.suppliers where id = $1`, [s])
      return { now: first.now, unchanged: second === first.t }
    })
    expect(r).toEqual({ now: true, unchanged: true })
  })

  it('superuser / service uchun ham', async () => {
    const r = await inTx(async (tx) => {
      await tx.query(`update public.suppliers set deleted_at = '2000-01-01' where id = $1`, [A.ids.s1])
      return scalar<boolean>(tx, `select deleted_at = now() from public.suppliers where id = $1`, [A.ids.s1])
    })
    expect(r).toBe(true)
  })
})

describe('R8. Batch 1 xabarlari: o`zbekcha, UUID`siz, hint bilan', () => {
  const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i
  const movIns = `insert into public.movements (company_id, type, object_id, material_id, qty_input, unit_input, qty_base`

  it('superuser: DELETE, xarid bog`lanishi, birlik, o`zgarmas ustun', async () => {
    const r = await inTx(async (tx) => ({
      del: await res(tx, `delete from public.suppliers where id = $1`, [A.ids.s1]),
      mismatch: await res(tx, `${movIns}, purchase_id) values ($1, 'kirim', $2, $3, 1, 'kg', 1, $4)`, [
        A.id,
        A.ids.obj2,
        A.ids.m1,
        A.ids.p_pro_obj1,
      ]),
      noPurchase: await res(tx, `${movIns}, purchase_id) values ($1, 'kirim', $2, $3, 1, 'kg', 1, gen_random_uuid())`, [
        A.id,
        A.ids.obj1,
        A.ids.m1,
      ]),
      unitOther: await res(tx, `${movIns}, unit_id) values ($1, 'kirim', $2, $3, 1, 'kg', 1, $4)`, [
        A.id,
        A.ids.obj1,
        A.ids.m2,
        A.ids.u1,
      ]),
      immutable: await res(tx, `update public.suppliers set created_at = now() - interval '1 day' where id = $1`, [A.ids.s1]),
      msgs: [
        await errMsg(tx, `delete from public.suppliers where id = $1`, [A.ids.s1]),
        await errMsg(tx, `${movIns}, purchase_id) values ($1, 'kirim', $2, $3, 1, 'kg', 1, $4)`, [
          A.id,
          A.ids.obj2,
          A.ids.m1,
          A.ids.p_pro_obj1,
        ]),
        await errMsg(tx, `${movIns}, unit_id) values ($1, 'kirim', $2, $3, 1, 'kg', 1, gen_random_uuid())`, [
          A.id,
          A.ids.obj1,
          A.ids.m1,
        ]),
      ],
    }))
    expect(r).toMatchObject({
      del: '42501:soft_delete_only',
      mismatch: '23514:ops_purchase_mismatch',
      noPurchase: '23503:purchase_not_open', // Batch 5: hint ops_purchase_not_found → purchase_not_open
      unitOther: '23503:ops_unit_material_mismatch',
      immutable: '42501:immutable_column',
    })
    expect(r.msgs).toHaveLength(3)
    for (const m of r.msgs) {
      expect(m).not.toBe('OK')
      expect(m).not.toMatch(UUID)
    }
  })

  it('rollar: tiklash, so`rov holati, inventarizatsiya', async () => {
    const bux = await asUser(db, A.users.buxgalter.authUid, async (tx) => {
      await tx.query(`update public.cash_advances set deleted_at = now() where id = $1`, [A.ids.ca_prorab])
      return res(tx, `update public.cash_advances set deleted_at = null where id = $1`, [A.ids.ca_prorab])
    })
    const tam = await asUser(db, A.users.taminotchi.authUid, async (tx) => ({
      fields: await res(tx, `update public.material_requests set qty_input = 9 where id = $1`, [A.ids.mr_obj1]),
      status: await res(tx, `update public.material_requests set status = 'xarid_qilindi' where id = $1`, [A.ids.mr_obj1]),
    }))
    const tek = await asUser(db, A.users.tekshiruvchi.authUid, async (tx) => {
      const direct = await res(tx, `update public.inventory_counts set status = 'submitted' where id = $1`, [A.ids.ic_obj1])
      await tx.query(`select public.submit_inventory_count($1)`, [A.ids.ic_obj1])
      const twice = await res(tx, `select public.submit_inventory_count($1)`, [A.ids.ic_obj1])
      const missing = await res(tx, `select public.submit_inventory_count(gen_random_uuid())`)
      return { direct, twice, missing }
    })
    expect({ bux, tam, tek }).toEqual({
      bux: '42501:restore_admin_only',
      tam: { fields: '42501:request_fields_locked', status: '42501:request_status_transition' },
      tek: {
        direct: '42501:inventory_status_direct',
        twice: '55000:inventory_already_submitted',
        missing: 'P0002:inventory_not_found',
      },
    })
  })
})
