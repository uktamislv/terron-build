// Qoldiq view'i (stock_balances) va CHECK / UNIQUE cheklovlari, numeric aniqligi.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  createCompany,
  createDb,
  createMaterial,
  createObject,
  insertRow,
  rows,
  scalar,
  tryQuery,
  type Db,
} from './_harness'

let db: Db
let co: string
let obj1: string
let obj2: string
let mat: string
/** inventory_adjust bog'lanadigan inventarizatsiya (movements_links_check). */
let ic: string

beforeAll(async () => {
  db = await createDb()
  co = await createCompany(db)
  obj1 = await createObject(db, { companyId: co })
  obj2 = await createObject(db, { companyId: co })
  mat = await createMaterial(db, { companyId: co })
  ic = (await insertRow<{ id: string }>(db, 'inventory_counts', { company_id: co, object_id: obj1 })).id
})
afterAll(async () => {
  await db?.close()
})

async function transfer(from: string, to: string): Promise<string> {
  const r = await insertRow<{ id: string }>(db, 'transfers', {
    company_id: co,
    from_object_id: from,
    to_object_id: to,
    material_id: mat,
    qty_input: 1,
    unit_input: 'kg',
    qty_base: 1,
  })
  return r.id
}

// qty_base ni trigger hisoblaydi (qty_input * factor); $6 — klient qiymati, e'tiborga olinmaydi.
const movSql = `insert into public.movements (company_id, type, object_id, material_id, qty_input, unit_input, qty_base,
                  transfer_id, deleted_at, inventory_count_id)
                values ($1, $2, $3, $4, $5, 'kg', $6, $7, $8, $9)`

/** Tranzaksiya ichida (rollback) harakatlar qo'shib, qoldiqni o'qiydi. */
async function balanceAfter(
  movs: Array<{ type: string; qty: string; obj?: string; deleted?: boolean; withTransfer?: boolean }>,
  material = mat,
): Promise<Record<string, string>> {
  const tr = await transfer(obj1, obj2)
  return db.transaction(async (tx) => {
    for (const m of movs) {
      await tx.query(movSql, [
        co,
        m.type,
        m.obj ?? obj1,
        material,
        m.qty,
        m.qty,
        m.type.startsWith('transfer') ? tr : null,
        m.deleted ? new Date().toISOString() : null,
        m.type === 'inventory_adjust' ? ic : null,
      ])
    }
    const r = await rows<{ object_id: string; qty: string }>(
      tx,
      `select object_id, qty_base::text as qty from public.stock_balances where company_id = $1 and material_id = $2`,
      [co, material],
    )
    await tx.rollback()
    return Object.fromEntries(r.map((x) => [x.object_id === obj1 ? 'obj1' : 'obj2', x.qty]))
  })
}

describe('stock_balances', () => {
  it('kirim − chiqim + transfer_in − transfer_out + inventory_adjust', async () => {
    const b = await balanceAfter([
      { type: 'kirim', qty: '100' },
      { type: 'chiqim', qty: '30' },
      { type: 'transfer_in', qty: '10' },
      { type: 'transfer_out', qty: '5' },
      { type: 'inventory_adjust', qty: '-2.5' },
      { type: 'inventory_adjust', qty: '0.25' },
    ])
    expect(b).toEqual({ obj1: '72.750000' })
  })

  it('o`chirilgan harakatlar hisobga olinmaydi', async () => {
    const b = await balanceAfter([
      { type: 'kirim', qty: '100' },
      { type: 'chiqim', qty: '60', deleted: true },
      { type: 'kirim', qty: '1000', deleted: true },
    ])
    expect(b).toEqual({ obj1: '100.000000' })
  })

  it('manfiy qoldiq ham to`g`ri ko`rsatiladi', async () => {
    const b = await balanceAfter([
      { type: 'kirim', qty: '5' },
      { type: 'chiqim', qty: '8' },
    ])
    expect(b).toEqual({ obj1: '-3.000000' })
  })

  it('obyektlar alohida hisoblanadi', async () => {
    const b = await balanceAfter([
      { type: 'kirim', qty: '10' },
      { type: 'transfer_out', qty: '4' },
      { type: 'transfer_in', qty: '4', obj: obj2 },
    ])
    expect(b).toEqual({ obj1: '6.000000', obj2: '4.000000' })
  })

  it('numeric aniqligi: 0.1 + 0.2 = 0.3 (yaxlitlash xatosi yo`q)', async () => {
    const b = await balanceAfter([
      { type: 'kirim', qty: '0.1' },
      { type: 'kirim', qty: '0.2' },
      { type: 'chiqim', qty: '0.3' },
      { type: 'kirim', qty: '0.3' },
    ])
    expect(b).toEqual({ obj1: '0.300000' })
  })

  it('security_invoker = true', async () => {
    const opts = await scalar<string[] | null>(
      db,
      `select reloptions from pg_class where oid = 'public.stock_balances'::regclass`,
    )
    expect(opts).toContain('security_invoker=true')
  })
})

describe('pul va miqdor: numeric, float yo`q', () => {
  it('public sxemada real / double precision ustun yo`q', async () => {
    const r = await rows(
      db,
      `select table_name, column_name from information_schema.columns
        where table_schema = 'public' and data_type in ('real', 'double precision')`,
    )
    expect(r).toEqual([])
  })

  it('pul yig`indisi aniq: 0.10 + 0.20 so`m = 0.30', async () => {
    const sum = await db.transaction(async (tx) => {
      const buyer = await scalar<string>(
        tx,
        `insert into public.profiles (company_id, role, full_name, phone) values ($1, 'haydovchi', 'H', '+998900000999') returning id`,
        [co],
      )
      for (const amount of ['0.10', '0.20']) {
        await tx.query(
          `insert into public.purchases (company_id, buyer_id, object_id, material_id, qty_input, unit_input, qty_base,
             unit_price, total_amount)
           values ($1, $2, $3, $4, 1, 'kg', 1, $5, $5)`,
          [co, buyer, obj1, mat, amount],
        )
      }
      const s = await scalar<string>(tx, `select (sum(total_amount) = 0.3)::text || ':' || sum(total_amount)::text from public.purchases where buyer_id = $1`, [buyer])
      await tx.rollback()
      return s
    })
    expect(sum).toBe('true:0.30')
  })

  it('pul 2 xonagacha yaxlitlanadi (numeric(18,2))', async () => {
    const v = await scalar<string>(db, `select 1234.565::numeric(18,2)::text`)
    expect(v).toBe('1234.57')
  })
})

describe('CHECK cheklovlari', () => {
  const movement = (type: string, qtyInput: string, qtyBase: string, link: 'TR' | 'IC' | null = null) => ({
    sql: movSql,
    params: (tr: string) => [co, type, obj1, mat, qtyInput, qtyBase, link === 'TR' ? tr : null, null, link === 'IC' ? ic : null],
  })
  const cases: Array<[string, ReturnType<typeof movement>, string]> = [
    // qty_base endi server hisoblaydi (qty_input * factor) — nol miqdor qty_input orqali
    ['kirim qty_input = 0', movement('kirim', '0', '1'), '23514'],
    ['kirim qty_input < 0', movement('kirim', '-1', '-1'), '23514'],
    ['chiqim qty_input = 0', movement('chiqim', '0', '1'), '23514'],
    ['inventory_adjust = 0', movement('inventory_adjust', '0', '0', 'IC'), '23514'],
    // ishoralar endi har doim mos (qty_base = qty_input * factor); o'rniga bog'lanish qoidasi
    ['inventory_adjust inventory_count_id siz', movement('inventory_adjust', '-1', '-1'), '23514'],
    ['transfer_in transfer_id siz', movement('transfer_in', '1', '1'), '23514'],
  ]
  it.each(cases)('movements: %s → %s', async (_l, c, code) => {
    const tr = await transfer(obj1, obj2)
    const r = await tryQuery(db, c.sql, c.params(tr))
    expect(r.ok ? 'OK' : r.code).toBe(code)
  })

  it('movements: inventory_adjust manfiy (kamomad) — ruxsat', async () => {
    const r = await db.transaction(async (tx) => {
      const x = await tryQuery(tx, movSql, [co, 'inventory_adjust', obj1, mat, '-2', '-2', null, null, ic])
      await tx.rollback()
      return x
    })
    expect(r.ok).toBe(true)
  })

  it('transfers: from = to → 23514', async () => {
    const r = await tryQuery(
      db,
      `insert into public.transfers (company_id, from_object_id, to_object_id, material_id, qty_input, unit_input, qty_base)
       values ($1, $2, $2, $3, 1, 'kg', 1)`,
      [co, obj1, mat],
    )
    expect(r.ok ? 'OK' : r.code).toBe('23514')
  })

  it.each(['998901234567', '+99890', '+99890123456789012', '+99890 123 45 67', '+9989O1234567'])(
    'profiles: telefon %s — E.164 emas → 23514',
    async (phone) => {
      const r = await tryQuery(
        db,
        `insert into public.profiles (company_id, role, full_name, phone) values ($1, 'prorab', 'T', $2)`,
        [co, phone],
      )
      expect(r.ok ? 'OK' : r.code).toBe('23514')
    },
  )

  it('profiles: +998901234567 — to`g`ri', async () => {
    const r = await db.transaction(async (tx) => {
      const x = await tryQuery(
        tx,
        `insert into public.profiles (company_id, role, full_name, phone) values ($1, 'prorab', 'T', '+998901234567')`,
        [co],
      )
      await tx.rollback()
      return x
    })
    expect(r.ok).toBe(true)
  })

  it.each(['0', '-1'])('material_units: factor = %s → 23514', async (factor) => {
    const r = await tryQuery(
      db,
      `insert into public.material_units (company_id, material_id, unit, factor) values ($1, $2, 'x', $3)`,
      [co, mat, factor],
    )
    expect(r.ok ? 'OK' : r.code).toBe('23514')
  })

  it('cash_advances: amount = 0 → 23514; purchases: qty_input = 0 → 23514', async () => {
    const buyer = await scalar<string>(
      db,
      `insert into public.profiles (company_id, role, full_name, phone) values ($1, 'haydovchi', 'H', '+998900000777') returning id`,
      [co],
    )
    const a = await tryQuery(db, `insert into public.cash_advances (company_id, recipient_id, amount) values ($1, $2, 0)`, [co, buyer])
    const p = await tryQuery(
      db,
      `insert into public.purchases (company_id, buyer_id, object_id, material_id, qty_input, unit_input, qty_base,
         unit_price, total_amount) values ($1, $2, $3, $4, 0, 'kg', 0, 1, 1)`,
      [co, buyer, obj1, mat],
    )
    expect([a.ok ? 'OK' : a.code, p.ok ? 'OK' : p.code]).toEqual(['23514', '23514'])
  })
})

describe('UNIQUE cheklovlari', () => {
  it('estimates: obyektda bitta is_current (o`chirilmaganlar orasida)', async () => {
    const r = await db.transaction(async (tx) => {
      const ins = (version: number, current: boolean, deleted = false) =>
        tryQuery(
          tx,
          `insert into public.estimates (company_id, object_id, version, title, is_current, deleted_at)
           values ($1, $2, $3, 'S', $4, $5)`,
          [co, obj2, version, current, deleted ? new Date().toISOString() : null],
        )
      const first = await ins(1, true)
      const second = await ins(2, true)
      const notCurrent = await ins(3, false)
      const deletedCurrent = await ins(4, true, true)
      const dupVersion = await ins(3, false)
      await tx.rollback()
      return [first, second, notCurrent, deletedCurrent, dupVersion].map((x) => (x.ok ? 'OK' : x.code))
    })
    expect(r).toEqual(['OK', '23505', 'OK', 'OK', '23505'])
  })

  it('materials: firma ichida nom katta-kichik harfsiz unique', async () => {
    const r = await db.transaction(async (tx) => {
      await tx.query(`insert into public.materials (company_id, name, base_unit) values ($1, 'Gips', 'kg')`, [co])
      const x = await tryQuery(tx, `insert into public.materials (company_id, name, base_unit) values ($1, 'GIPS', 'kg')`, [co])
      await tx.rollback()
      return x.ok ? 'OK' : x.code
    })
    expect(r).toBe('23505')
  })

  it('profiles: firma ichida telefon unique', async () => {
    const r = await db.transaction(async (tx) => {
      const q = `insert into public.profiles (company_id, role, full_name, phone) values ($1, 'prorab', 'T', '+998911112233')`
      await tx.query(q, [co])
      const x = await tryQuery(tx, q, [co])
      await tx.rollback()
      return x.ok ? 'OK' : x.code
    })
    expect(r).toBe('23505')
  })
})
