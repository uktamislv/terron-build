// Audit tuzatishlari, 2-tur — 20261109000001_audit2_fixes.sql (shartnoma: docs/audit-fixes.md → "2-tur").
// Xavfsizlik (S1–S14), ekspluatatsiya, mahsulot va mantiq (L1–L13) bandlari; audit repro'lari
// (F1–F6, C1) — regressiya testlari. Har bandga musbat/manfiy holat, rol va firma izolyatsiyasi.
import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  asUser,
  createDb,
  createUser,
  one,
  rows,
  scalar,
  type Db,
  type Queryable,
  type Row,
  type Tx,
} from './_harness'
import { buildTwoCompanies, type CompanyFixture } from './_fixtures'

let db: Db
let A: CompanyFixture
let B: CompanyFixture
let kgId: string

beforeAll(async () => {
  db = await createDb()
  ;({ A, B } = await buildTwoCompanies(db))
  kgId = await scalar<string>(db, `select id from public.material_units where material_id = $1 and unit = 'kg'`, [A.ids.m1])
})
afterAll(async () => {
  await db?.close()
})

// ----------------------------------------------------------------------------
// Yordamchilar (audit_fixes.sql.test.ts bilan bir xil uslub)
// ----------------------------------------------------------------------------
type Role = keyof CompanyFixture['users']

/** `OK:<qatorlar>` yoki `<errcode>:<hint>` (savepoint bilan — tx davom etadi). */
async function res(tx: Queryable, sql: string, params: unknown[] = []): Promise<string> {
  await tx.exec('savepoint a2_try')
  try {
    const r = await tx.query(sql, params)
    await tx.exec('release savepoint a2_try')
    return `OK:${r.affectedRows || r.rows.length}`
  } catch (e) {
    await tx.exec('rollback to savepoint a2_try')
    const err = e as { code?: string; hint?: string }
    return `${err.code ?? '?'}:${err.hint ?? ''}`
  }
}

/** Xato obyekti (detail bilan). */
async function errOf(tx: Queryable, sql: string, params: unknown[] = []): Promise<{ code?: string; hint?: string; detail?: string } | null> {
  await tx.exec('savepoint a2_err')
  try {
    await tx.query(sql, params)
    await tx.exec('release savepoint a2_err')
    return null
  } catch (e) {
    await tx.exec('rollback to savepoint a2_err')
    return e as { code?: string; hint?: string; detail?: string }
  }
}

/** Shu tranzaksiyada postgres sifatida (RLS'siz); JWT claims saqlanadi. */
async function sys<T>(tx: Tx, fn: () => Promise<T>): Promise<T> {
  await tx.exec('reset role')
  try {
    return await fn()
  } finally {
    await tx.exec('set local role authenticated')
  }
}

/** Tizim konteksti: postgres va claims'siz (auth.uid() = null). */
async function system<T>(tx: Tx, fn: () => Promise<T>): Promise<T> {
  const saved = await one<{ c: string; s: string }>(
    tx,
    `select coalesce(current_setting('request.jwt.claims', true), '') c, coalesce(current_setting('request.jwt.claim.sub', true), '') s`,
  )
  await tx.exec('reset role')
  await tx.query(`select set_config('request.jwt.claims', '', true), set_config('request.jwt.claim.sub', '', true)`)
  try {
    return await fn()
  } finally {
    await tx.query(`select set_config('request.jwt.claims', $1, true), set_config('request.jwt.claim.sub', $2, true)`, [saved.c, saved.s])
    await tx.exec('set local role authenticated')
  }
}

async function svc<T>(tx: Tx, fn: () => Promise<T>): Promise<T> {
  await tx.exec('set local role service_role')
  try {
    return await fn()
  } finally {
    await tx.exec('set local role authenticated')
  }
}

async function raw(tx: Tx, sql: string, params: unknown[] = []): Promise<void> {
  await sys(tx, async () => {
    await tx.exec('set local session_replication_role = replica')
    await tx.query(sql, params)
    await tx.exec('set local session_replication_role = origin')
  })
}

async function switchTo(tx: Tx, role: Role, co: CompanyFixture = A): Promise<void> {
  await switchUid(tx, co.users[role].authUid)
}
async function switchUid(tx: Tx, uid: string): Promise<void> {
  await tx.query(
    `select set_config('request.jwt.claims', $1, true), set_config('request.jwt.claim.sub', $2, true)`,
    [JSON.stringify({ sub: uid, role: 'authenticated', aud: 'authenticated' }), uid],
  )
}

const as = <T>(role: Role, fn: (tx: Tx) => Promise<T>, co: CompanyFixture = A): Promise<T> =>
  asUser(db, co.users[role].authUid, fn)

const P = (role: Role, co: CompanyFixture = A): string => co.users[role].profileId

let matSeq = 0
async function newMat(q: Queryable = db): Promise<{ id: string; unit: string }> {
  const id = await scalar<string>(q, `insert into public.materials (company_id, name, base_unit) values ($1, $2, 'kg') returning id`, [
    A.id,
    `A2 material ${++matSeq} ${randomUUID().slice(0, 6)}`,
  ])
  const unit = await scalar<string>(q, `select id from public.material_units where material_id = $1 and factor = 1`, [id])
  return { id, unit }
}

async function mv(
  tx: Queryable,
  type: 'kirim' | 'chiqim',
  obj: string,
  mat: { id: string; unit: string },
  qty: string,
  o: { at?: string; extra?: Row } = {},
): Promise<string> {
  const extra = o.extra ?? {}
  const cols = Object.keys(extra)
  return scalar<string>(
    tx,
    `insert into public.movements (company_id, type, object_id, material_id, unit_id, qty_input, unit_input, qty_base, occurred_at${cols.map((c) => `, ${c}`).join('')})
     values ($1, $2, $3, $4, $5, $6, '-', 0, coalesce($7::timestamptz, now())${cols.map((_, i) => `, $${i + 8}`).join('')}) returning id`,
    [A.id, type, obj, mat.id, mat.unit, qty, o.at ?? null, ...Object.values(extra)],
  )
}

async function purchase(
  tx: Queryable,
  buyer: string,
  o: { obj: string; mat: { id: string; unit: string }; qty: string; total: string; at?: string; extra?: Row },
): Promise<string> {
  const extra = o.extra ?? {}
  const cols = Object.keys(extra)
  return scalar<string>(
    tx,
    `insert into public.purchases (company_id, buyer_id, object_id, material_id, unit_id, qty_input, unit_input, qty_base,
        unit_price, price_per_base, total_amount, purchased_at${cols.map((c) => `, ${c}`).join('')})
     values ($1, $2, $3, $4, $5, $6, '-', 0, 0, 0, $7, coalesce($8::timestamptz, now())${cols.map((_, i) => `, $${i + 9}`).join('')})
     returning id`,
    [A.id, buyer, o.obj, o.mat.id, o.mat.unit, o.qty, o.total, o.at ?? null, ...Object.values(extra)],
  )
}

interface AlertRow {
  id: string
  type: string
  status: string
  severity: string
  details: Row
  object_id: string | null
  material_id: string | null
  movement_id: string | null
  purchase_id: string | null
  request_id: string | null
}

const alertsQ = (q: Queryable, type: string, where = 'true', params: unknown[] = [], co = A.id): Promise<AlertRow[]> =>
  rows<AlertRow>(
    q,
    `select id, type::text, status::text, severity::text, details, object_id, material_id, movement_id, purchase_id, request_id
       from public.alerts where company_id = '${co}' and type::text = '${type}' and (${where})
      order by created_at, (select min(l.id) from public.audit_log l where l.record_id = alerts.id), id`,
    params,
  )
const alertsOf = (tx: Tx, type: string, where = 'true', params: unknown[] = [], co = A.id): Promise<AlertRow[]> =>
  sys(tx, () => alertsQ(tx, type, where, params, co))

const outboxOf = (tx: Tx, where: string, params: unknown[] = []): Promise<Row[]> =>
  sys(tx, () => rows(tx, `select id, kind, ref_id, profile_id, alert_id, status, payload, next_attempt_at
                           from public.notification_outbox where ${where} order by created_at, id`, params))

const recipients = (tx: Tx, outboxId: string): Promise<string[]> =>
  svc(tx, async () =>
    (await rows<{ role: string }>(tx, `select role from public.svc_outbox_recipients($1) order by role, profile_id`, [outboxId])).map((r) => r.role),
  )

async function chats(tx: Tx): Promise<void> {
  await sys(tx, async () => {
    const set = [['admin', 9701], ['taminotchi', 9702], ['prorab', 9703], ['omborchi', 9704], ['haydovchi', 9705], ['direktor', 9706], ['tekshiruvchi', 9707]] as const
    for (const [role, chat] of set) {
      await tx.query(`update public.profiles set telegram_chat_id = $2 where id = $1`, [P(role), chat])
    }
  })
}

const photoPath = (co = A.id): string => `${co}/2026/10/${randomUUID()}.jpg`
const sha = (c: string): string => c.repeat(64)
const ago = (h: number): string => new Date(Date.now() - h * 3600e3).toISOString()

/** Tinch oyna — hozirgi Toshkent vaqti atrofida (±1 soat). */
async function quietNow(tx: Tx): Promise<void> {
  await system(tx, () =>
    tx.query(`update public.companies
                 set quiet_hours_start = ((now() at time zone 'Asia/Tashkent') - interval '1 hour')::time,
                     quiet_hours_end   = ((now() at time zone 'Asia/Tashkent') + interval '1 hour')::time
               where id = $1`, [A.id]))
}

// ============================================================================
// S1 — rasm xeshi navbati
// ============================================================================
describe('S1: rasm xeshi navbati (klientga bog`liq emas)', () => {
  it('rasmli harakat → navbat + photo-hash uyg`otiladi (x-photo-secret, mode sweep, tranzaksiyada bir marta)', async () => {
    const r = await as('admin', async (tx) => {
      const mat = await newMat(tx)
      const m1 = await mv(tx, 'kirim', A.ids.obj3!, mat, '1', { extra: { photo_path: photoPath() } })
      const m2 = await mv(tx, 'kirim', A.ids.obj3!, mat, '2', { extra: { photo_path: photoPath() } })
      const noPhoto = await mv(tx, 'kirim', A.ids.obj3!, mat, '3')
      return sys(tx, async () => ({
        jobs: await rows(tx, `select record_id, table_name, status, attempts from private.photo_hash_queue
                               where record_id = any($1) order by record_id`, [[m1, m2, noPhoto]]),
        http: await rows<{ url: string; headers: Row; body: Row }>(tx, `select url, headers, body from net.http_request_queue
                               where url like '%/photo-hash' order by id desc limit 5`),
        secret: await scalar<string>(tx, `select decrypted_secret from vault.decrypted_secrets where name = 'photo_hash_secret'`),
        cron: await scalar<string>(tx, `select schedule || ' ' || command from cron.job where jobname = 'terron-photo-hash-sweep'`),
        m1, m2,
      }))
    })
    expect(r.jobs).toHaveLength(2)
    expect(r.jobs.every((j) => j.status === 'pending' && j.table_name === 'movements' && j.attempts === 0)).toBe(true)
    // tranzaksiyada bitta uyg'otish
    expect(r.http).toHaveLength(1)
    expect(r.http[0]!.body).toEqual({ mode: 'sweep' })
    expect(r.http[0]!.headers).toMatchObject({ 'x-photo-secret': r.secret })
    expect(r.secret).toMatch(/^[0-9a-f]{64}$/)
    expect(r.cron).toBe('*/5 * * * * select private.photo_hash_sweep()')
  })

  it('claim → complete(sha) → xesh yoziladi, ish done; xato → pending (backoff), final → failed; authenticated — 42501', async () => {
    const r = await as('admin', async (tx) => {
      const mat = await newMat(tx)
      const k = await mv(tx, 'kirim', A.ids.obj3!, mat, '1', { extra: { photo_path: photoPath() } })
      const k2 = await mv(tx, 'kirim', A.ids.obj3!, mat, '2', { extra: { photo_path: photoPath() } })
      const userClaim = await res(tx, `select * from public.svc_claim_photo_hash_jobs(10)`)
      const userQueue = await res(tx, `select * from private.photo_hash_queue`)
      const claimed = await svc(tx, () => rows<{ job_id: string; record_id: string; photo_path: string; attempts: number }>(tx,
        `select * from public.svc_claim_photo_hash_jobs(100)`))
      const j1 = claimed.find((c) => c.record_id === k)!
      const j2 = claimed.find((c) => c.record_id === k2)!
      const done = await svc(tx, () => scalar<string>(tx, `select public.svc_complete_photo_hash_job($1, $2)`, [j1.job_id, sha('a')]))
      const hash = await scalar<string>(tx, `select photo_sha256 from public.movements where id = $1`, [k])
      const retry = await svc(tx, () => scalar<string>(tx, `select public.svc_complete_photo_hash_job($1, null, 'storage 500')`, [j2.job_id]))
      const retryRow = await sys(tx, () => one(tx, `select status, last_error, next_attempt_at > now() as later from private.photo_hash_queue where id = $1`, [j2.job_id]))
      await sys(tx, () => tx.query(`update private.photo_hash_queue set status = 'sending' where id = $1`, [j2.job_id]))
      const final = await svc(tx, () => scalar<string>(tx, `select public.svc_complete_photo_hash_job($1, null, 'not_found', true)`, [j2.job_id]))
      const again = await svc(tx, () => scalar<string>(tx, `select public.svc_complete_photo_hash_job($1, $2)`, [j1.job_id, sha('b')]))
      return { userClaim, userQueue, j1, done, hash, retry, retryRow, final, again }
    })
    expect(r.userClaim).toBe('42501:')
    expect(r.userQueue).toBe('42501:')
    expect(r.j1.attempts).toBe(1)
    expect(r.done).toBe('done')
    expect(r.hash).toBe(sha('a'))
    expect(r.retry).toBe('pending')
    expect(r.retryRow).toEqual({ status: 'pending', last_error: 'storage 500', later: true })
    expect(r.final).toBe('failed')
    expect(r.again).toBe('done') // yakunlangan ish qayta yozilmaydi
  })

  it('p_expected_path: yo`l o`zgargan bo`lsa xesh yozilmaydi (false); eski ish stale, yangi yo`lga yangi ish; 3 argumentli chaqiruv ishlaydi', async () => {
    const r = await as('admin', async (tx) => {
      const mat = await newMat(tx)
      const p1 = photoPath()
      const p2 = photoPath()
      const k = await mv(tx, 'kirim', A.ids.obj3!, mat, '1', { extra: { photo_path: p1 } })
      await tx.query(`update public.movements set photo_path = $2 where id = $1`, [k, p2])
      const wrong = await svc(tx, () => scalar<boolean>(tx, `select public.svc_set_photo_hash('movements', $1, $2, $3)`, [k, sha('c'), p1]))
      const hashAfterWrong = await scalar<string | null>(tx, `select photo_sha256 from public.movements where id = $1`, [k])
      const claimed = await svc(tx, () => rows<{ photo_path: string; record_id: string }>(tx, `select * from public.svc_claim_photo_hash_jobs(100)`))
      const states = await sys(tx, () => rows(tx, `select photo_path, status from private.photo_hash_queue where record_id = $1 order by created_at, photo_path`, [k]))
      const legacy = await svc(tx, () => scalar<boolean>(tx, `select public.svc_set_photo_hash('movements', $1, $2)`, [k, sha('d')]))
      const right = await svc(tx, () => scalar<boolean>(tx, `select public.svc_set_photo_hash('movements', $1, $2, $3)`, [k, sha('e'), p2]))
      const jobsDone = await sys(tx, () => scalar<number>(tx, `select count(*)::int from private.photo_hash_queue where record_id = $1 and status in ('pending', 'sending')`, [k]))
      return { p1, p2, wrong, hashAfterWrong, claimedMine: claimed.filter((c) => c.record_id === k).map((c) => c.photo_path), states, legacy, right, jobsDone }
    })
    expect(r.wrong).toBe(false)
    expect(r.hashAfterWrong).toBeNull()
    expect(r.claimedMine).toEqual([r.p2])
    expect(r.states).toEqual(expect.arrayContaining([{ photo_path: r.p1, status: 'stale' }]))
    expect(r.legacy).toBe(true)
    expect(r.right).toBe(true)
    expect(r.jobsDone).toBe(0)
  })

  it('xarid cheki ham navbatga tushadi; photo_hash_sweep — muddati kelgan ishlar soni; boshqa firma yozuvi — o`z firma ustuni bilan', async () => {
    const r = await as('admin', async (tx) => {
      const mat = await newMat(tx)
      const p = await purchase(tx, P('admin'), { obj: A.ids.obj3!, mat, qty: '1', total: '100', extra: { receipt_photo_path: photoPath() } })
      const job = await sys(tx, () => one(tx, `select company_id, table_name, status from private.photo_hash_queue where record_id = $1`, [p]))
      const n = await sys(tx, () => scalar<number>(tx, `select private.photo_hash_sweep()`))
      await switchTo(tx, 'admin', B)
      const bMat = await sys(tx, () => scalar<string>(tx, `insert into public.materials (company_id, name, base_unit) values ($1, 'B rasm', 'kg') returning id`, [B.id]))
      const bUnit = await sys(tx, () => scalar<string>(tx, `select id from public.material_units where material_id = $1`, [bMat]))
      const bk = await scalar<string>(tx, `insert into public.movements (company_id, type, object_id, material_id, unit_id, qty_input, unit_input, qty_base, photo_path)
        values ($1, 'kirim', $2, $3, $4, 1, '-', 0, $5) returning id`, [B.id, B.ids.obj3, bMat, bUnit, photoPath(B.id)])
      const bJob = await sys(tx, () => scalar<string>(tx, `select company_id from private.photo_hash_queue where record_id = $1`, [bk]))
      return { job, n, bJob }
    })
    expect(r.job).toEqual({ company_id: A.id, table_name: 'purchases', status: 'pending' })
    expect(r.n).toBeGreaterThanOrEqual(1)
    expect(r.bJob).toBe(B.id)
  })
})

// ============================================================================
// S2 — boshqa xaridor nomidan xarid
// ============================================================================
describe('S2: boshqa odam nomidan xarid', () => {
  it('admin haydovchi nomidan → xarid_boshqa_nomidan (ogohlantirish, Telegram) + haydovchiga purchase_on_your_name', async () => {
    const r = await as('admin', async (tx) => {
      await chats(tx)
      const mat = await newMat(tx)
      const p = await purchase(tx, P('haydovchi'), { obj: A.ids.obj1!, mat, qty: '2', total: '250000' })
      const a = await alertsOf(tx, 'xarid_boshqa_nomidan', `purchase_id = $1`, [p])
      const ob = await outboxOf(tx, `kind = 'purchase_on_your_name' and ref_id = $1`, [p])
      const alertOb = await outboxOf(tx, `kind = 'alert' and alert_id = $1`, [a[0]!.id])
      const own = await purchase(tx, P('admin'), { obj: A.ids.obj1!, mat, qty: '1', total: '1' })
      const ownAlerts = await alertsOf(tx, 'xarid_boshqa_nomidan', `purchase_id = $1`, [own])
      return { p, mat: mat.id, a, ob, alertOb, rec: await recipients(tx, ob[0]!.id as string), alertRec: await recipients(tx, alertOb[0]!.id as string), ownAlerts }
    })
    expect(r.a).toHaveLength(1)
    expect(r.a[0]).toMatchObject({ severity: 'ogohlantirish', status: 'yangi' })
    expect(r.a[0]!.details).toMatchObject({
      buyer_id: P('haydovchi'), buyer_name: 'A haydovchi', actor_profile_id: P('admin'), actor_name: 'A admin',
      amount: 250000, object_id: A.ids.obj1, material_id: r.mat, via: 'insert',
    })
    expect(r.ob).toHaveLength(1)
    expect(r.ob[0]).toMatchObject({ profile_id: P('haydovchi') })
    expect(Object.keys(r.ob[0]!.payload as Row).sort()).toEqual([
      'actor_name', 'alert_id', 'base_unit', 'buyer_id', 'buyer_name', 'company_name', 'material_id', 'material_name',
      'object_id', 'object_name', 'payment_source', 'purchase_id', 'purchased_at', 'qty_base', 'qty_input', 'total_amount', 'unit_input',
    ])
    expect(r.rec).toEqual(['haydovchi'])
    expect(r.alertRec).toEqual(['admin', 'direktor'])
    expect(r.ownAlerts).toEqual([])
  })

  it('xaridor: nofaol / o`chirilgan / omborchi — purchase_buyer_invalid; buyer_id o`zgartirilsa — alert (via update); haydovchi boshqaning nomidan — RLS 42501', async () => {
    const r = await as('admin', async (tx) => {
      const mat = await newMat(tx)
      await sys(tx, () => tx.query(`update public.profiles set is_active = false where id = $1`, [P('taminotchi')]))
      const inactive = await res(tx, `insert into public.purchases (company_id, buyer_id, object_id, material_id, unit_id, qty_input, unit_input, qty_base, unit_price, price_per_base, total_amount)
        values ($1, $2, $3, $4, $5, 1, '-', 0, 0, 0, 10)`, [A.id, P('taminotchi'), A.ids.obj3, mat.id, mat.unit])
      await sys(tx, () => tx.query(`update public.profiles set is_active = true where id = $1`, [P('taminotchi')]))
      const wrongRole = await res(tx, `insert into public.purchases (company_id, buyer_id, object_id, material_id, unit_id, qty_input, unit_input, qty_base, unit_price, price_per_base, total_amount)
        values ($1, $2, $3, $4, $5, 1, '-', 0, 0, 0, 10)`, [A.id, P('omborchi'), A.ids.obj3, mat.id, mat.unit])
      const p = await purchase(tx, P('admin'), { obj: A.ids.obj3!, mat, qty: '1', total: '10' })
      await tx.query(`update public.purchases set buyer_id = $2 where id = $1`, [p, P('prorab')])
      const upd = await alertsOf(tx, 'xarid_boshqa_nomidan', `purchase_id = $1`, [p])
      await switchTo(tx, 'haydovchi')
      const hay = await res(tx, `insert into public.purchases (company_id, buyer_id, object_id, material_id, unit_id, qty_input, unit_input, qty_base, unit_price, price_per_base, total_amount)
        values ($1, $2, $3, $4, $5, 1, '-', 0, 0, 0, 10)`, [A.id, P('prorab'), A.ids.obj1, mat.id, mat.unit])
      return { inactive, wrongRole, upd, hay }
    })
    expect(r.inactive).toBe('23514:purchase_buyer_invalid')
    expect(r.wrongRole).toBe('23514:purchase_buyer_invalid')
    expect(r.upd).toHaveLength(1)
    expect(r.upd[0]!.details).toMatchObject({ buyer_id: P('prorab'), via: 'update' })
    expect(r.hay).toBe('42501:')
  })
})

// ============================================================================
// S3 / L1 — receipt_verified
// ============================================================================
describe('S3 / L1: chek tasdig`i va rasm talabi', () => {
  it('F5: bir qatorli 10 000 so`mlik chek 50 mln xaridni tasdiqlamaydi — photo_required', async () => {
    const r = await as('taminotchi', async (tx) => {
      const mat = await sys(tx, () => newMat(tx))
      await sys(tx, async () => {
        await tx.query(`update public.companies set photo_required_amount = 5000000 where id = $1`, [A.id])
        await tx.query(`insert into public.receipt_lookups (company_id, fiscal_sign, payload, total, receipt_at) values ($1, 'A2FS1', $2, 10000, now())`,
          [A.id, JSON.stringify({ items: [{ name: 'mix', sum: 10000 }] })])
      })
      const ins = `insert into public.purchases (company_id, buyer_id, object_id, material_id, unit_id, qty_input, unit_input, qty_base, total_amount, unit_price, price_per_base, receipt_fiscal_sign)
                   values ($1, $2, $3, $4, $5, 100, '-', 0, $6, 0, 0, 'A2FS1')`
      const big = await res(tx, ins, [A.id, P('taminotchi'), A.ids.obj1, mat.id, mat.unit, 50000000])
      const exact = await res(tx, ins, [A.id, P('taminotchi'), A.ids.obj1, mat.id, mat.unit, 10000])
      const v = await scalar<boolean>(tx, `select receipt_verified from public.purchases where receipt_fiscal_sign = 'A2FS1'`)
      return { big, exact, v }
    })
    expect(r).toEqual({ big: '23514:photo_required', exact: 'OK:1', v: true })
  })

  it('receipt_total null — tasdiqlangan bo`lsa ham rasm talabidan ozod qilmaydi', async () => {
    const r = await as('taminotchi', async (tx) => {
      const mat = await sys(tx, () => newMat(tx))
      await sys(tx, async () => {
        await tx.query(`update public.companies set photo_required_amount = 1000 where id = $1`, [A.id])
        await tx.query(`insert into public.receipt_lookups (company_id, fiscal_sign, payload, total, receipt_at) values ($1, 'A2FS2', $2, null, now())`,
          [A.id, JSON.stringify({ items: [{ name: 'a', sum: '5000' }] })])
      })
      return res(tx, `insert into public.purchases (company_id, buyer_id, object_id, material_id, unit_id, qty_input, unit_input, qty_base, total_amount, unit_price, price_per_base, receipt_fiscal_sign)
                      values ($1, $2, $3, $4, $5, 1, '-', 0, 5000, 0, 0, 'A2FS2')`, [A.id, P('taminotchi'), A.ids.obj1, mat.id, mat.unit])
    })
    expect(r).toBe('23514:photo_required')
  })
})

// ============================================================================
// S4 / L13 — tinch soatlar
// ============================================================================
describe('S4 / L13: tinch soatlar', () => {
  it('oyna ≤ 12 soat (23514); 12 soat — OK; quiet_window_minutes', async () => {
    const r = await as('admin', async (tx) => ({
      long: await res(tx, `update public.companies set quiet_hours_start = '20:00', quiet_hours_end = '08:01' where id = $1`, [A.id]),
      ok: await res(tx, `update public.companies set quiet_hours_start = '20:00', quiet_hours_end = '08:00' where id = $1`, [A.id]),
      day: await res(tx, `update public.companies set quiet_hours_start = '06:00', quiet_hours_end = '19:00' where id = $1`, [A.id]),
      w: await scalar<number[]>(tx, `select array[private.quiet_window_minutes('22:00', '07:00'), private.quiet_window_minutes('13:00', '14:30')]`),
    }))
    expect(r).toEqual({ long: '23514:', ok: 'OK:1', day: '23514:', w: [540, 90] })
  })

  it('sozlama/login/yozuv/boshqa nomidan alertlari ushlanmaydi; oddiy alert va ish oqimi — ushlanadi; login_changed, purchase_on_your_name — yo`q', async () => {
    const r = await as('admin', async (tx) => {
      await quietNow(tx)
      const ids = await system(tx, async () => {
        const ins = (type: string): Promise<string> =>
          scalar<string>(tx, `insert into public.alerts (company_id, type, severity) values ($1, $2::public.alert_type, 'ogohlantirish') returning id`, [A.id, type])
        const wf = (kind: string, prof: string | null): Promise<string> =>
          scalar<string>(tx, `insert into public.notification_outbox (company_id, kind, ref_id, profile_id, payload) values ($1, $2, $3, $4, '{}') returning id`,
            [A.id, kind, randomUUID(), prof])
        return {
          narx: await ins('narx_ogishi'),
          sozlama: await ins('sozlama_ozgardi'),
          login: await ins('login_ozgardi'),
          yozuv: await ins('yozuv_ozgartirildi'),
          boshqa: await ins('xarid_boshqa_nomidan'),
          wfReq: await wf('request_created', null),
          wfTr: await wf('transfer_cancelled', null),
          wfInv: await wf('inventory_applied', P('tekshiruvchi')),
          wfLogin: await wf('login_changed', P('prorab')),
          wfBuyer: await wf('purchase_on_your_name', P('haydovchi')),
        }
      })
      const alertOb = async (id: string): Promise<string> => scalar<string>(tx, `select id from public.notification_outbox where alert_id = $1`, [id])
      const ob: Record<string, string> = {}
      await sys(tx, async () => {
        for (const k of ['narx', 'sozlama', 'login', 'yozuv', 'boshqa'] as const) ob[k] = await alertOb(ids[k])
      })
      for (const k of ['wfReq', 'wfTr', 'wfInv', 'wfLogin', 'wfBuyer'] as const) ob[k] = ids[k]
      const claimed = await svc(tx, () => rows<{ id: string }>(tx, `select id from public.svc_claim_notifications(100)`))
      const got = Object.entries(ob).filter(([, v]) => claimed.some((c) => c.id === v)).map(([k]) => k).sort()
      return got
    })
    expect(r).toEqual(['boshqa', 'login', 'sozlama', 'wfBuyer', 'wfLogin', 'yozuv'])
  })
})

// ============================================================================
// S5 — yozuv_ozgartirildi qamrovi, merge_suppliers (L5)
// ============================================================================
describe('S5: yozuv_ozgartirildi — yangi ustunlar', () => {
  it('harakat: photo_path, geo; xarid: supplier_id, request_id, payment_source, geo — ogohlantirish', async () => {
    const r = await as('admin', async (tx) => {
      const mat = await newMat(tx)
      const k = await mv(tx, 'kirim', A.ids.obj3!, mat, '1', { extra: { photo_path: photoPath() } })
      await tx.query(`update public.movements set photo_path = null, geo_status = 'denied' where id = $1`, [k])
      const p = await purchase(tx, P('admin'), { obj: A.ids.obj3!, mat, qty: '1', total: '10' })
      await tx.query(`update public.purchases set supplier_id = $2, payment_source = 'podotchet', geo_status = 'unavailable' where id = $1`, [p, A.ids.s1])
      return {
        m: (await alertsOf(tx, 'yozuv_ozgartirildi', `movement_id = $1`, [k]))[0]!.details,
        p: (await alertsOf(tx, 'yozuv_ozgartirildi', `purchase_id = $1`, [p]))[0]!.details,
      }
    })
    expect(r.m).toMatchObject({ changed: ['geo_status', 'photo_path'], after: { photo_path: null, geo_status: 'denied' } })
    expect(r.p).toMatchObject({ changed: ['geo_status', 'payment_source', 'supplier_id'], before: { payment_source: 'firma' }, after: { payment_source: 'podotchet' } })
  })
})

describe('S5 / L5: merge_suppliers', () => {
  it('F6: STIR avval to`ldiriladi — sotuvchi_stir_farqi ochiq qoladi; merged_into; o`chirilgan xaridlar ham; bitta sotuvchi_birlashtirildi belgisi', async () => {
    const r = await as('admin', async (tx) => {
      const mat = await newMat(tx)
      const keep = await scalar<string>(tx, `insert into public.suppliers (company_id, name) values ($1, 'A2 Keep') returning id`, [A.id])
      const merge = await scalar<string>(tx, `insert into public.suppliers (company_id, name, tin) values ($1, 'A2 Merge', '123456780') returning id`, [A.id])
      const p = await system(tx, () => purchase(tx, P('taminotchi'), { obj: A.ids.obj1!, mat, qty: '10', total: '1000', extra: { supplier_id: merge, seller_tin: '999999990' } }))
      const dead = await purchase(tx, P('admin'), { obj: A.ids.obj3!, mat, qty: '1', total: '5', extra: { supplier_id: merge } })
      await tx.query(`update public.purchases set deleted_at = now() where id = $1`, [dead])
      const before = await alertsOf(tx, 'sotuvchi_stir_farqi', `purchase_id = $1`, [p])
      const n = await scalar<number>(tx, `select public.merge_suppliers($1, $2)`, [keep, merge])
      const after = await alertsOf(tx, 'sotuvchi_stir_farqi', `purchase_id = $1`, [p])
      const bel = await alertsOf(tx, 'sotuvchi_birlashtirildi', `details ->> 'merged_supplier_id' = $1`, [merge])
      return {
        p, dead, n, before, after, bel,
        keep: await one(tx, `select tin from public.suppliers where id = $1`, [keep]),
        merged: await sys(tx, () => one(tx, `select merged_into, deleted_at is not null as del from public.suppliers where id = $1`, [merge])),
        moved: await sys(tx, () => scalar<number>(tx, `select count(*)::int from public.purchases where id = any($1) and supplier_id = $2`, [[p, dead], keep])),
        changes: await alertsOf(tx, 'yozuv_ozgartirildi', `purchase_id = any($1)`, [[p, dead]]),
        keepId: keep,
      }
    })
    expect(r.before[0]).toMatchObject({ status: 'yangi' })
    expect(r.n).toBe(1)
    expect(r.after[0]).toMatchObject({ status: 'yangi', details: { supplier_tin: '123456780', supplier_name: 'A2 Keep' } })
    expect(r.keep).toEqual({ tin: '123456780' })
    expect(r.merged).toEqual({ merged_into: r.keepId, del: true })
    expect(r.moved).toBe(2)
    expect(r.changes).toEqual([])
    expect(r.bel).toHaveLength(1)
    expect(r.bel[0]).toMatchObject({ severity: 'belgi' })
    expect(r.bel[0]!.details).toMatchObject({ moved_count: 1, moved_deleted_count: 1, filled: ['tin'], actor_profile_id: P('admin') })
    expect((r.bel[0]!.details.moved_purchase_ids as string[]).sort()).toEqual([r.p, r.dead].sort())
  })

  it('F6b: tarixiy xaridning receipt_verified, receipt_total, seller_tin birlashtirishda o`zgarmaydi', async () => {
    const r = await as('admin', async (tx) => {
      const mat = await newMat(tx)
      const s1 = await scalar<string>(tx, `insert into public.suppliers (company_id, name) values ($1, 'A2 S-a') returning id`, [A.id])
      const s2 = await scalar<string>(tx, `insert into public.suppliers (company_id, name) values ($1, 'A2 S-b') returning id`, [A.id])
      await sys(tx, () => tx.query(`insert into public.receipt_lookups (company_id, fiscal_sign, payload, total, receipt_at) values ($1, 'A2FS9', '{}', 1000, now() - interval '10 days')`, [A.id]))
      const p = await system(tx, () => purchase(tx, P('taminotchi'), { obj: A.ids.obj1!, mat, qty: '10', total: '1000',
        extra: { supplier_id: s2, receipt_fiscal_sign: 'A2FS9', receipt_verified: true, seller_tin: '111222333' } }))
      const q = `select receipt_verified, receipt_total::text, seller_tin from public.purchases where id = $1`
      const before = await one(tx, q, [p])
      await tx.query(`select public.merge_suppliers($1, $2)`, [s1, s2])
      return { before, after: await one(tx, q, [p]) }
    })
    expect(r.before).toEqual({ receipt_verified: true, receipt_total: '1000.00', seller_tin: '111222333' })
    expect(r.after).toEqual(r.before)
  })

  it('sotuvchi STIR o`zgarsa — uning xaridlari STIR farqi qayta baholanadi (mos kelsa yopiladi)', async () => {
    const r = await as('admin', async (tx) => {
      const mat = await newMat(tx)
      const s = await scalar<string>(tx, `insert into public.suppliers (company_id, name, tin) values ($1, 'A2 TIN', '555000111') returning id`, [A.id])
      const p = await system(tx, () => purchase(tx, P('taminotchi'), { obj: A.ids.obj1!, mat, qty: '1', total: '10', extra: { supplier_id: s, seller_tin: '555000222' } }))
      const open = await alertsOf(tx, 'sotuvchi_stir_farqi', `purchase_id = $1`, [p])
      await tx.query(`update public.suppliers set tin = '555000222' where id = $1`, [s])
      return { open, after: await alertsOf(tx, 'sotuvchi_stir_farqi', `purchase_id = $1`, [p]) }
    })
    expect(r.open[0]!.status).toBe('yangi')
    expect(r.after[0]).toMatchObject({ status: 'yopildi', details: { closed_reason: 'not_applicable' } })
  })
})

// ============================================================================
// S6 — ko'r-ko'rona sanash
// ============================================================================
describe('S6: ko`r-ko`rona sanash', () => {
  it('tekshiruvchi faqat o`z hisoblari va qatorlarini ko`radi; submit — {ok:true}; admin — to`liq natija', async () => {
    const t2 = await createUser(db, { companyId: A.id, role: 'tekshiruvchi', fullName: 'A tekshiruvchi 2' })
    const r = await asUser(db, t2.authUid, async (tx) => {
      const own = await scalar<string>(tx, `insert into public.inventory_counts (company_id, object_id) values ($1, $2) returning id`, [A.id, A.ids.obj3])
      await tx.query(`insert into public.inventory_count_items (company_id, inventory_count_id, material_id, unit_id, qty_input, qty_counted)
                      values ($1, $2, $3, $4, 1, 0)`, [A.id, own, A.ids.m1, kgId])
      const counts = await rows<{ id: string }>(tx, `select id from public.inventory_counts`)
      const items = await scalar<number>(tx, `select count(*)::int from public.inventory_count_items where inventory_count_id = $1`, [A.ids.ic_obj1])
      const sub = await scalar<Row>(tx, `select public.submit_inventory_count($1)`, [own])
      await switchTo(tx, 'tekshiruvchi')
      const first = await rows<{ id: string }>(tx, `select id from public.inventory_counts where id = $1`, [own])
      await switchTo(tx, 'admin')
      const c2 = await scalar<string>(tx, `insert into public.inventory_counts (company_id, object_id) values ($1, $2) returning id`, [A.id, A.ids.obj3])
      await tx.query(`insert into public.inventory_count_items (company_id, inventory_count_id, material_id, unit_id, qty_input, qty_counted)
                      values ($1, $2, $3, $4, 1, 0)`, [A.id, c2, A.ids.m1, kgId])
      const adminSub = await scalar<Row>(tx, `select public.submit_inventory_count($1)`, [c2])
      return { own, counts: counts.map((c) => c.id), items, sub, first, adminSub }
    })
    expect(r.counts).toEqual([r.own])
    expect(r.items).toBe(0)
    expect(r.sub).toEqual({ ok: true })
    expect(r.first).toEqual([])
    expect(Object.keys(r.adminSub).sort()).toEqual(['has_shortage', 'movements_during_count', 'not_counted_count'])
  })

  it('inventory_candidate_materials: tekshiruvchiga faol katalog (qoldiq yo`q obyektda ham), nofaol material yo`q', async () => {
    const r = await as('tekshiruvchi', async (tx) => {
      const off = await sys(tx, () => scalar<string>(tx, `insert into public.materials (company_id, name, base_unit, is_active) values ($1, 'A2 nofaol', 'kg', false) returning id`, [A.id]))
      const list = await rows<{ material_id: string }>(tx, `select * from public.inventory_candidate_materials($1)`, [A.ids.obj3])
      const active = await sys(tx, () => scalar<number>(tx, `select count(*)::int from public.materials where company_id = $1 and is_active and deleted_at is null`, [A.id]))
      return { n: list.length, active, hasOff: list.some((x) => x.material_id === off) }
    })
    expect(r.n).toBe(r.active)
    expect(r.hasOff).toBe(false)
  })
})

describe('S6: tekshiruvchi qoldiq, harakat, xarid va pulni ko`rmaydi', () => {
  it('jadval va view lar — 0 qator; stock_forecast — stock_forbidden; dashboard — nollar; my_material_usage — bo`sh; definer RPC — to`liq qoldiq', async () => {
    const r = await as('tekshiruvchi', async (tx) => {
      // tekshiruvchi nomidan o'chirilgan harakat (own_deleted siyosati) va chek keshi
      await system(tx, async () => {
        const mat = await newMat(tx)
        const k = await mv(tx, 'kirim', A.ids.obj1!, mat, '5', { extra: { created_by: P('tekshiruvchi') } })
        await tx.query(`update public.movements set deleted_at = now() where id = $1`, [k])
        await tx.query(`select public.svc_upsert_receipt_lookup($1, null, 'A2BLIND1', null, null, '{}', 100, null, null, now())`, [A.id])
      })
      const n = (sql: string, p: unknown[] = []): Promise<number> => scalar<number>(tx, sql, p)
      const out = {
        movements: await n(`select count(*)::int from public.movements`),
        stock: await n(`select count(*)::int from public.stock_balances`),
        purchases: await n(`select count(*)::int from public.purchases`),
        cash: await n(`select count(*)::int from public.cash_advances`),
        cashBal: await n(`select count(*)::int from public.cash_balances`),
        receipts: await n(`select count(*)::int from public.purchase_receipts`),
        lookups: await n(`select count(*)::int from public.receipt_lookups`),
        norm: await n(`select count(*)::int from public.norm_usage`),
        forecast: await res(tx, `select * from public.stock_forecast($1)`, [A.ids.obj1]),
        usage: await n(`select count(*)::int from public.my_material_usage(30)`),
        lowStock: await res(tx, `select private.low_stock_count($1)`, [A.id]),
        dash: await scalar<Row>(tx, `select public.dashboard_summary(current_date - 30, current_date)`),
        sub: '',
      }
      // definer RPC ichida to'liq qoldiq: sanalmagan m1 (qoldiq ≠ 0) alertda bor
      const c = await scalar<string>(tx, `insert into public.inventory_counts (company_id, object_id) values ($1, $2) returning id`, [A.id, A.ids.obj1])
      await tx.query(`insert into public.inventory_count_items (company_id, inventory_count_id, material_id, unit_id, qty_input, qty_counted)
                      values ($1, $2, $3, (select id from public.material_units where material_id = $3 and factor = 1), 1, 0)`, [A.id, c, A.ids.m2])
      await tx.query(`select public.submit_inventory_count($1)`, [c])
      out.sub = await sys(tx, () => scalar<string>(tx, `select (details -> 'not_counted' -> 0 ->> 'material_id') from public.alerts where inventory_count_id = $1`, [c]))
      return out
    })
    expect(r).toMatchObject({
      movements: 0, stock: 0, purchases: 0, cash: 0, cashBal: 0, receipts: 0, lookups: 0, norm: 0,
      forecast: '42501:stock_forbidden', usage: 0, lowStock: '42501:',
    })
    expect(r.dash).toMatchObject({ kirim_count: 0, purchases_count: 0, cash_on_hand_total: '0.00', objects_over_norm_count: 0, telegram_blocked_count: null })
    expect(r.sub).toBe(A.ids.m1)
    const admin = await as('admin', async (tx) => ({
      stock: await scalar<number>(tx, `select count(*)::int from public.stock_balances`),
      forecast: await res(tx, `select * from public.stock_forecast($1)`, [A.ids.obj1]),
    }))
    expect(admin.stock).toBeGreaterThan(0)
    expect(admin.forecast).toMatch(/^OK:/)
  })
})

describe('svc_photo_hash_secret', () => {
  it('service_role — Vault photo_hash_secret; authenticated — 42501', async () => {
    const r = await as('admin', async (tx) => ({
      svc: await svc(tx, () => scalar<string>(tx, `select public.svc_photo_hash_secret()`)),
      vault: await sys(tx, () => scalar<string>(tx, `select decrypted_secret from vault.decrypted_secrets where name = 'photo_hash_secret'`)),
      user: await res(tx, `select public.svc_photo_hash_secret()`),
    }))
    expect(r.svc).toBe(r.vault)
    expect(r.svc).toMatch(/^[0-9a-f]{64}$/)
    expect(r.user).toBe('42501:')
  })
})

// ============================================================================
// S7 — admin / direktor profillari
// ============================================================================
describe('S7: admin va direktor profillari', () => {
  it('admin: direktor/admin yarata olmaydi, rol bera olmaydi, ismini o`zgartira olmaydi; prorab — OK; super_admin — OK', async () => {
    const r = await as('admin', async (tx) => {
      const ins = (role: string): Promise<string> =>
        res(tx, `insert into public.profiles (company_id, role, full_name, phone) values ($1, $2::public.user_role, 'Yangi', $3)`,
          [A.id, role, `+99891${String(Math.floor(Math.random() * 1e7)).padStart(7, '0')}`])
      const out = {
        newDir: await ins('direktor'),
        newAdmin: await ins('admin'),
        newProrab: await ins('prorab'),
        toAdmin: await res(tx, `update public.profiles set role = 'admin' where id = $1`, [P('buxgalter')]),
        renameDir: await res(tx, `update public.profiles set full_name = 'X' where id = $1`, [P('direktor')]),
        renameSelf: await res(tx, `update public.profiles set full_name = 'X' where id = $1`, [P('admin')]),
        renameProrab: await res(tx, `update public.profiles set full_name = 'Prorab X' where id = $1`, [P('prorab')]),
        saDir: '',
        saRename: '',
      }
      await switchTo(tx, 'super_admin')
      out.saDir = await ins('direktor')
      out.saRename = await res(tx, `update public.profiles set full_name = 'Direktor Y' where id = $1`, [P('direktor')])
      return out
    })
    expect(r).toEqual({
      newDir: '42501:profile_protected',
      newAdmin: '42501:profile_protected',
      newProrab: 'OK:1',
      toAdmin: '42501:profile_protected',
      renameDir: '42501:profile_protected',
      renameSelf: '42501:profile_protected',
      renameProrab: 'OK:1',
      saDir: 'OK:1',
      saRename: 'OK:1',
    })
  })

  it('svc_alert_login_set(p_first_login): birinchi login — login_ozgardi (first_login), egasiga login_changed; 2 argumentli chaqiruv ishlaydi', async () => {
    const r = await as('admin', async (tx) => {
      const id1 = await svc(tx, () => scalar<string>(tx, `select public.svc_alert_login_set($1, $2, true)`, [P('direktor'), P('admin')]))
      const id2 = await svc(tx, () => scalar<string>(tx, `select public.svc_alert_login_set($1, $2)`, [P('direktor'), P('admin')]))
      const user = await res(tx, `select public.svc_alert_login_set($1, $2, true)`, [P('direktor'), P('admin')])
      return {
        a1: (await alertsOf(tx, 'login_ozgardi', `id = $1`, [id1]))[0]!.details,
        a2: (await alertsOf(tx, 'login_ozgardi', `id = $1`, [id2]))[0]!.details,
        ob: await outboxOf(tx, `kind = 'login_changed' and ref_id = $1`, [id1]),
        user,
      }
    })
    expect(r.a1).toMatchObject({ first_login: true, target_role: 'direktor', actor_profile_id: P('admin') })
    expect(r.a2).toMatchObject({ first_login: false })
    expect(r.ob[0]).toMatchObject({ profile_id: P('direktor'), payload: { first_login: true } })
    expect(r.user).toBe('42501:')
  })
})

// ============================================================================
// S8 — check_purchase_price chastota cheklovi
// ============================================================================
describe('S8: check_purchase_price — 10 daqiqada 30', () => {
  it('31-chaqiruv — rate_limited (54000); boshqa profil — ta`sirsiz; 10 daqiqadan eski chaqiruvlar hisoblanmaydi', async () => {
    const r = await as('taminotchi', async (tx) => {
      const call = (): Promise<string> => res(tx, `select public.check_purchase_price($1, 100)`, [A.ids.m1])
      const ok: string[] = []
      for (let i = 0; i < 30; i++) ok.push(await call())
      const over = await call()
      await switchTo(tx, 'haydovchi')
      const other = await call()
      await switchTo(tx, 'taminotchi')
      await sys(tx, () => tx.query(`update private.rate_limits set hits = array(select h - interval '11 minutes' from unnest(hits) h) where profile_id = $1`, [P('taminotchi')]))
      const later = await call()
      return { okAll: ok.every((x) => x === 'OK:1'), over, other, later }
    })
    expect(r).toEqual({ okAll: true, over: '54000:rate_limited', other: 'OK:1', later: 'OK:1' })
  })
})

// ============================================================================
// S9 — close_note
// ============================================================================
describe('S9: close_note', () => {
  it('yopilgan alert izohi o`zgarmaydi; tizim yopganiga ham izoh yozib bo`lmaydi; yopilgan holatda bo`sh izoh — rad', async () => {
    const r = await as('admin', async (tx) => {
      const a = await system(tx, () => scalar<string>(tx, `insert into public.alerts (company_id, type) values ($1, 'narx_ogishi') returning id`, [A.id]))
      const close = await res(tx, `update public.alerts set status = 'yopildi', close_note = 'Tekshirildi' where id = $1`, [a])
      const change = await res(tx, `update public.alerts set close_note = 'Boshqa' where id = $1`, [a])
      const clear = await res(tx, `update public.alerts set close_note = null where id = $1`, [a])
      const reopen = await res(tx, `update public.alerts set status = 'korildi' where id = $1`, [a])
      const sysClosed = await system(tx, async () => {
        const id = await scalar<string>(tx, `insert into public.alerts (company_id, type) values ($1, 'narx_ogishi') returning id`, [A.id])
        await tx.query(`update public.alerts set status = 'yopildi' where id = $1`, [id])
        return id
      })
      const annotate = await res(tx, `update public.alerts set close_note = 'izoh' where id = $1`, [sysClosed])
      const reclose = await res(tx, `update public.alerts set status = 'yopildi' where id = $1`, [sysClosed])
      return { close, change, clear, reopen, annotate, reclose, note: await scalar<string>(tx, `select close_note from public.alerts where id = $1`, [a]) }
    })
    expect(r).toEqual({
      close: 'OK:1',
      change: '55000:alert_close_note_locked',
      clear: '55000:alert_close_note_locked',
      reopen: 'OK:1',
      annotate: '55000:alert_close_note_locked',
      reclose: '23514:alert_close_note_required',
      note: 'Tekshirildi',
    })
  })
})

// ============================================================================
// S12 — profile_directory
// ============================================================================
describe('S12: profile_directory', () => {
  it('deleted_at va is_available (faol va o`chirilmagan)', async () => {
    const r = await as('prorab', async (tx) => {
      await sys(tx, async () => {
        await tx.query(`update public.profiles set is_active = false where id = $1`, [P('omborchi')])
        await tx.query(`update public.profiles set deleted_at = now() where id = $1`, [P('haydovchi')])
      })
      return rows(tx, `select role::text, is_active, deleted_at is not null as del, is_available from public.profile_directory
                        where id = any($1) order by role`, [[P('omborchi'), P('haydovchi'), P('direktor')]])
    })
    expect(r).toEqual([
      { role: 'direktor', is_active: true, del: false, is_available: true },
      { role: 'haydovchi', is_active: true, del: true, is_available: false },
      { role: 'omborchi', is_active: false, del: false, is_available: false },
    ])
  })
})

// ============================================================================
// S13 / Ops — bloklangan chat
// ============================================================================
describe('S13: bloklangan chat', () => {
  it('dashboard: direktor — telegram_blocked_count va telegram_me_blocked; prorab — soni null', async () => {
    const r = await as('direktor', async (tx) => {
      await sys(tx, async () => {
        await tx.query(`update public.profiles set telegram_chat_id = 9801 where id = any($1)`, [[P('direktor'), P('prorab')]])
        await tx.query(`update public.profiles set telegram_blocked_at = now() where id = any($1)`, [[P('direktor'), P('prorab')]])
      })
      const d = await scalar<Row>(tx, `select public.dashboard_summary(current_date, current_date)`)
      await switchTo(tx, 'prorab')
      const p = await scalar<Row>(tx, `select public.dashboard_summary(current_date, current_date)`)
      return { d: [d.telegram_blocked_count, d.telegram_me_blocked], p: [p.telegram_blocked_count, p.telegram_me_blocked] }
    })
    expect(r).toEqual({ d: [2, true], p: [null, true] })
  })

  it('reset_chat_blocked: admin — OK; prorab — chat_reset_forbidden; boshqa firma — profile_not_found; svc_touch_chat — service_role', async () => {
    const r = await as('admin', async (tx) => {
      await sys(tx, async () => {
        await tx.query(`update public.profiles set telegram_chat_id = 9802 where id = any($1)`, [[P('direktor'), P('omborchi')]])
        await tx.query(`update public.profiles set telegram_blocked_at = now() where id = any($1)`, [[P('direktor'), P('omborchi')]])
      })
      const ok = await scalar<boolean>(tx, `select public.reset_chat_blocked($1)`, [P('direktor')])
      const again = await scalar<boolean>(tx, `select public.reset_chat_blocked($1)`, [P('direktor')])
      const foreign = await res(tx, `select public.reset_chat_blocked($1)`, [P('direktor', B)])
      const userTouch = await res(tx, `select public.svc_touch_chat(9802)`)
      await switchTo(tx, 'prorab')
      const forbidden = await res(tx, `select public.reset_chat_blocked($1)`, [P('omborchi')])
      const touched = await svc(tx, () => scalar<number>(tx, `select public.svc_touch_chat(9802)`))
      const left = await sys(tx, () => scalar<number>(tx, `select count(*)::int from public.profiles where telegram_chat_id = 9802 and telegram_blocked_at is not null`))
      return { ok, again, foreign, userTouch, forbidden, touched, left }
    })
    expect(r).toEqual({
      ok: true, again: false, foreign: 'P0002:profile_not_found', userTouch: '42501:',
      forbidden: '42501:chat_reset_forbidden', touched: 1, left: 0,
    })
  })
})

// ============================================================================
// S14 — sayt alertlari
// ============================================================================
describe('S14: omborchi smetadan_ortiq_sorov ni ko`rmaydi', () => {
  it('prorab — ko`radi; omborchi — normadan_oshish ha, smetadan_ortiq_sorov yo`q', async () => {
    const r = await as('admin', async (tx) => {
      const ids = await system(tx, async () => ({
        req: await scalar<string>(tx, `insert into public.alerts (company_id, type, object_id) values ($1, 'smetadan_ortiq_sorov', $2) returning id`, [A.id, A.ids.obj1]),
        norm: await scalar<string>(tx, `insert into public.alerts (company_id, type, object_id) values ($1, 'normadan_oshish', $2) returning id`, [A.id, A.ids.obj1]),
      }))
      const seen = async (role: Role): Promise<string[]> => {
        await switchTo(tx, role)
        const x = await rows<{ id: string }>(tx, `select id from public.alerts where id = any($1)`, [Object.values(ids)])
        return Object.entries(ids).filter(([, v]) => x.some((y) => y.id === v)).map(([k]) => k).sort()
      }
      return { prorab: await seen('prorab'), omborchi: await seen('omborchi') }
    })
    expect(r).toEqual({ prorab: ['norm', 'req'], omborchi: ['norm'] })
  })
})

// ============================================================================
// Ops — indekslar
// ============================================================================
describe('Ops: outbox indekslari', () => {
  it('(company_id, status, updated_at) bor; notification_outbox_ref_idx olib tashlangan', async () => {
    const idx = await rows<{ indexname: string; indexdef: string }>(db, `select indexname, indexdef from pg_indexes
      where tablename = 'notification_outbox' and indexname in ('notification_outbox_company_status_idx', 'notification_outbox_ref_idx')`)
    expect(idx.map((i) => i.indexname)).toEqual(['notification_outbox_company_status_idx'])
    expect(idx[0]!.indexdef).toContain('(company_id, status, updated_at)')
  })
})

// ============================================================================
// Mahsulot — haydovchi va so'rovlar, yangi ish oqimi turlari
// ============================================================================
describe('Haydovchi va tasdiqlangan so`rovlar', () => {
  it('haydovchi a`zo obyektning tasdiqlangan so`rovini ko`radi (kutilmoqda, boshqa obyekt, boshqa firma — yo`q), o`zgartira olmaydi', async () => {
    const r = await as('admin', async (tx) => {
      await tx.query(`update public.material_requests set status = 'tasdiqlandi' where id = any($1)`, [[A.ids.mr_obj1, A.ids.mr_obj2]])
      const pending = await scalar<string>(tx, `insert into public.material_requests (company_id, object_id, material_id, unit_id, qty_input, unit_input, qty_base)
        values ($1, $2, $3, $4, 1, '-', 0) returning id`, [A.id, A.ids.obj1, A.ids.m1, kgId])
      await switchTo(tx, 'haydovchi')
      const seen = await rows<{ id: string }>(tx, `select id from public.material_requests order by id`)
      const upd = await res(tx, `update public.material_requests set note = 'x' where id = $1`, [A.ids.mr_obj1])
      await switchTo(tx, 'haydovchi', B)
      const foreign = await scalar<number>(tx, `select count(*)::int from public.material_requests where company_id = $1`, [A.id])
      return { seen: seen.map((s) => s.id), pending, upd, foreign }
    })
    expect(r.seen).toEqual([A.ids.mr_obj1])
    expect(r.upd).toBe('OK:0')
    expect(r.foreign).toBe(0)
  })
})

describe('Yangi ish oqimi xabarlari', () => {
  it('transfer_cancelled → qabul obyekti xodimlari (bekor qiluvchidan tashqari); transfer_received → yuboruvchi', async () => {
    const r = await as('admin', async (tx) => {
      await chats(tx)
      const t1 = randomUUID()
      await tx.query(`select public.create_transfer($1, $2, $3, $4, $5, 2, 'devor')`, [t1, A.ids.obj2, A.ids.obj1, A.ids.m1, kgId])
      await tx.query(`select public.cancel_transfer($1, 'xato')`, [t1])
      const cancelled = await outboxOf(tx, `kind = 'transfer_cancelled' and ref_id = $1`, [t1])
      const t2 = randomUUID()
      await tx.query(`select public.create_transfer($1, $2, $3, $4, $5, 1, null)`, [t2, A.ids.obj2, A.ids.obj1, A.ids.m1, kgId])
      await switchTo(tx, 'prorab')
      await tx.query(`select public.receive_transfer($1, null, null)`, [t2])
      const received = await outboxOf(tx, `kind = 'transfer_received' and ref_id = $1`, [t2])
      return {
        t1, t2, cancelled, received,
        rc: await recipients(tx, cancelled[0]!.id as string),
        rr: await recipients(tx, received[0]!.id as string),
      }
    })
    expect(r.cancelled[0]!.payload).toMatchObject({
      transfer_id: r.t1, status: 'bekor', to_object_id: A.ids.obj1, cancel_reason: 'xato', cancelled_by_id: P('admin'), cancelled_by_name: 'A admin',
    })
    expect(r.rc).toEqual(['omborchi', 'prorab'])
    expect(r.received[0]).toMatchObject({ profile_id: P('admin'), payload: { transfer_id: r.t2, status: 'qabul_qilindi', received_qty_base: 1, received_by_name: 'A prorab' } })
    expect(r.rr).toEqual(['admin'])
  })

  it('purchase_deleted → purchase_for_object olganlarga; purchase_for_object yo`q bo`lsa — yo`q (L12: tizim / orqa sanali)', async () => {
    const r = await as('haydovchi', async (tx) => {
      await chats(tx)
      const mat = { id: A.ids.m1!, unit: kgId }
      const p = await purchase(tx, P('haydovchi'), { obj: A.ids.obj1!, mat, qty: '3', total: '30000' })
      const back = await purchase(tx, P('haydovchi'), { obj: A.ids.obj1!, mat, qty: '1', total: '100', at: ago(30) })
      const sysP = await system(tx, () => purchase(tx, P('haydovchi'), { obj: A.ids.obj1!, mat, qty: '1', total: '100' }))
      await switchTo(tx, 'admin')
      await tx.query(`update public.purchases set deleted_at = now() where id = any($1)`, [[p, sysP]])
      const del = await outboxOf(tx, `kind = 'purchase_deleted' and ref_id = $1`, [p])
      return {
        p, del,
        rec: await recipients(tx, del[0]!.id as string),
        pfo: await outboxOf(tx, `kind = 'purchase_for_object' and ref_id = any($1)`, [[p, back, sysP]]),
        sysDel: await outboxOf(tx, `kind = 'purchase_deleted' and ref_id = $1`, [sysP]),
      }
    })
    expect(r.del[0]!.payload).toMatchObject({ purchase_id: r.p, object_id: A.ids.obj1, buyer_id: P('haydovchi'), deleted_by_name: 'A admin' })
    expect(r.rec).toEqual(['omborchi', 'prorab'])
    expect(r.pfo.map((x) => x.ref_id)).toEqual([r.p])
    expect(r.sysDel).toEqual([])
  })

  it('inventory_applied → hisob muallifiga (miqdorlarsiz); notify_workflow = false — chiqadi', async () => {
    const r = await as('tekshiruvchi', async (tx) => {
      await chats(tx)
      const c = await scalar<string>(tx, `insert into public.inventory_counts (company_id, object_id) values ($1, $2) returning id`, [A.id, A.ids.obj1])
      await tx.query(`insert into public.inventory_count_items (company_id, inventory_count_id, material_id, unit_id, qty_input, qty_counted)
                      values ($1, $2, $3, $4, 1, 0)`, [A.id, c, A.ids.m1, kgId])
      await tx.query(`select public.submit_inventory_count($1)`, [c])
      await switchTo(tx, 'admin')
      await tx.query(`select public.apply_inventory_adjustments($1)`, [c])
      const ob = await outboxOf(tx, `kind = 'inventory_applied' and ref_id = $1`, [c])
      const rec = await recipients(tx, ob[0]!.id as string)
      await sys(tx, () => tx.query(`update public.profiles set notify_workflow = false where id = $1`, [P('tekshiruvchi')]))
      return { c, ob, rec, muted: await recipients(tx, ob[0]!.id as string) }
    })
    expect(r.ob[0]).toMatchObject({ profile_id: P('tekshiruvchi') })
    expect(Object.keys(r.ob[0]!.payload as Row).sort()).toEqual([
      'adjusted_count', 'applied_at', 'applied_by_name', 'company_name', 'count_id', 'counted_at', 'items_count', 'object_id', 'object_name', 'submitted_at',
    ])
    expect(r.ob[0]!.payload).toMatchObject({ count_id: r.c, items_count: 1, adjusted_count: 1, applied_by_name: 'A admin' })
    expect(r.rec).toEqual(['tekshiruvchi'])
    expect(r.muted).toEqual([])
  })
})

// ============================================================================
// correct_entry / cancel_own_entry (L9, L10)
// ============================================================================
describe('correct_entry (audit2)', () => {
  it('xaridga bog`langan kirim tuzatiladi → qoida 1 qayta ishlaydi; material/obyekt almashtirish — correct_linked', async () => {
    const r = await as('admin', async (tx) => {
      const mat = await newMat(tx)
      const p = await purchase(tx, P('taminotchi'), { obj: A.ids.obj1!, mat, qty: '100', total: '1000', at: ago(30) })
      // audit3 D6: kutish greatest(purchased_at, created_at) + 24 soat — xarid haqiqatan 30 soat oldin kiritilgan
      await raw(tx, `update public.purchases set created_at = purchased_at where id = $1`, [p])
      await switchTo(tx, 'omborchi')
      const k = await mv(tx, 'kirim', A.ids.obj1!, mat, '100', { extra: { purchase_id: p } })
      const before = await alertsOf(tx, 'xarid_qabul_farqi', `purchase_id = $1`, [p])
      const ok = await res(tx, `select public.correct_entry('movements', $1, 50, null, null, null, 'Ortiqcha yozilgan')`, [k])
      const after = await alertsOf(tx, 'xarid_qabul_farqi', `purchase_id = $1`, [p])
      const mat2 = await sys(tx, () => newMat(tx))
      const linked = await res(tx, `select public.correct_entry('movements', $1, null, $2, null, null, null, $3)`, [k, mat2.unit, mat2.id])
      const tz = await alertsOf(tx, 'yozuv_tuzatildi', `movement_id = $1`, [k])
      return { before, ok, after, linked, tz }
    })
    expect(r.before).toEqual([])
    expect(r.ok).toBe('OK:1')
    expect(r.after).toHaveLength(1)
    expect(r.after[0]).toMatchObject({ status: 'yangi', details: { received_qty_base: 50, purchased_qty_base: 100 } })
    expect(r.linked).toBe('55000:correct_linked')
    expect(r.tz[0]!.details).toMatchObject({ reason: 'Ortiqcha yozilgan', via: 'correct_entry' })
  })

  it('material / obyekt almashtirish: muallif — OK (birlik majburiy, materialniki); a`zo bo`lmagan obyekt — correct_forbidden; admin boshqaning yozuvida — correct_forbidden', async () => {
    const r = await as('prorab', async (tx) => {
      const mat = await sys(tx, () => newMat(tx))
      const mat2 = await sys(tx, () => newMat(tx))
      const k = await mv(tx, 'chiqim', A.ids.obj1!, mat, '5')
      const noUnit = await res(tx, `select public.correct_entry('movements', $1, p_material_id => $2)`, [k, mat2.id])
      const wrongUnit = await res(tx, `select public.correct_entry('movements', $1, p_unit_id => $2, p_material_id => $3)`, [k, mat.unit, mat2.id])
      const ok = await res(tx, `select public.correct_entry('movements', $1, p_unit_id => $2, p_material_id => $3, p_reason => 'Boshqa material')`, [k, mat2.unit, mat2.id])
      const row = await one(tx, `select material_id, unit_id from public.movements where id = $1`, [k])
      const obj = await res(tx, `select public.correct_entry('movements', $1, p_object_id => $2)`, [k, A.ids.obj2])
      const tz = await alertsOf(tx, 'yozuv_tuzatildi', `movement_id = $1`, [k])
      await switchTo(tx, 'admin')
      const adminMove = await res(tx, `select public.correct_entry('movements', $1, p_object_id => $2)`, [k, A.ids.obj3])
      const adminQty = await res(tx, `select public.correct_entry('movements', $1, 6)`, [k])
      return { noUnit, wrongUnit, ok, row, mat2, obj, tz, adminMove, adminQty }
    })
    expect(r.noUnit).toBe('22023:correct_invalid')
    expect(r.wrongUnit).toBe('22023:correct_invalid')
    expect(r.ok).toBe('OK:1')
    expect(r.row).toEqual({ material_id: r.mat2.id, unit_id: r.mat2.unit })
    expect(r.obj).toBe('42501:correct_forbidden')
    expect(r.tz[0]!.details).toMatchObject({ changed: ['material_id', 'unit_id'], reason: 'Boshqa material' })
    expect(r.adminMove).toBe('42501:correct_forbidden')
    expect(r.adminQty).toBe('OK:1')
  })

  it('L9: p_reason alohida — izoh o`zgarmaydi; 6 argumentli chaqiruv izohni yangilaydi', async () => {
    const r = await as('omborchi', async (tx) => {
      const mat = await sys(tx, () => newMat(tx))
      const k = await mv(tx, 'chiqim', A.ids.obj1!, mat, '10', { extra: { note: '3-qavat' } })
      await tx.query(`select public.correct_entry('movements', $1, 11, null, null, null, 'sabab')`, [k])
      const kept = await scalar<string>(tx, `select note from public.movements where id = $1`, [k])
      await tx.query(`select public.correct_entry('movements', $1, 12, null, null, '4-qavat')`, [k])
      const changed = await scalar<string>(tx, `select note from public.movements where id = $1`, [k])
      const tz = await alertsOf(tx, 'yozuv_tuzatildi', `movement_id = $1`, [k])
      return { kept, changed, reasons: tz.map((a) => a.details.reason) }
    })
    expect(r).toEqual({ kept: '3-qavat', changed: '4-qavat', reasons: ['sabab', null] })
  })

  it('L10 (C1): tuzatishdan keyin takroriy yozuv qayta baholanadi — yangi moslik alert, moslik yo`qolsa yopiladi', async () => {
    const r = await as('omborchi', async (tx) => {
      const mat = await sys(tx, () => newMat(tx))
      const dupQ = `material_id = '${mat.id}'`
      await mv(tx, 'chiqim', A.ids.obj1!, mat, '10')
      const k2 = await mv(tx, 'chiqim', A.ids.obj1!, mat, '7')
      const d0 = await alertsOf(tx, 'takroriy_yozuv', dupQ)
      await tx.query(`select public.correct_entry('movements', $1, 10, null, null, null, 'xato')`, [k2])
      const d1 = await alertsOf(tx, 'takroriy_yozuv', dupQ)
      await tx.query(`select public.correct_entry('movements', $1, 9, null, null, null, 'yana xato')`, [k2])
      const d2 = await alertsOf(tx, 'takroriy_yozuv', dupQ)
      await tx.query(`select public.correct_entry('movements', $1, 10, null, null, null, 'qaytdi')`, [k2])
      const d3 = await alertsOf(tx, 'takroriy_yozuv', dupQ)
      return { k2, d0, d1: d1.map((a) => [a.status, a.details.record_id]), d2: d2.map((a) => a.status), d3: d3.map((a) => a.status) }
    })
    expect(r.d0).toEqual([])
    expect(r.d1).toEqual([['yangi', r.k2]])
    expect(r.d2).toEqual(['yopildi'])
    expect(r.d3).toEqual(['yangi'])
  })

  it('xarid: takroriy yozuv ham qayta baholanadi', async () => {
    const r = await as('taminotchi', async (tx) => {
      const mat = await sys(tx, () => newMat(tx))
      await purchase(tx, P('taminotchi'), { obj: A.ids.obj3!, mat, qty: '1', total: '100' })
      const p2 = await purchase(tx, P('taminotchi'), { obj: A.ids.obj3!, mat, qty: '1', total: '100' })
      const d0 = await alertsOf(tx, 'takroriy_yozuv', `purchase_id = $1`, [p2])
      await tx.query(`select public.correct_entry('purchases', $1, null, null, 150, null, 'summa')`, [p2])
      return { d0: d0.map((a) => a.status), d1: (await alertsOf(tx, 'takroriy_yozuv', `purchase_id = $1`, [p2])).map((a) => a.status) }
    })
    expect(r).toEqual({ d0: ['yangi'], d1: ['yopildi'] })
  })
})

describe('cancel_own_entry', () => {
  it('muallif 30 daqiqa ichida — soft delete, yozuv_tuzatildi (belgi, sabab), yozuv_ochirildi yo`q; boshqa — forbidden; kech — window; sababsiz — invalid', async () => {
    const r = await as('omborchi', async (tx) => {
      const mat = await sys(tx, () => newMat(tx))
      const k = await mv(tx, 'kirim', A.ids.obj1!, mat, '5')
      const noReason = await res(tx, `select public.cancel_own_entry('movements', $1, '  ')`, [k])
      await switchTo(tx, 'prorab')
      const other = await res(tx, `select public.cancel_own_entry('movements', $1, 'x')`, [k])
      await switchTo(tx, 'omborchi')
      const ok = await res(tx, `select public.cancel_own_entry('movements', $1, 'Noto''g''ri material')`, [k])
      const del = await sys(tx, () => scalar<boolean>(tx, `select deleted_at is not null from public.movements where id = $1`, [k]))
      const tz = await alertsOf(tx, 'yozuv_tuzatildi', `movement_id = $1`, [k])
      const och = await alertsOf(tx, 'yozuv_ochirildi', `movement_id = $1`, [k])
      const k2 = await mv(tx, 'kirim', A.ids.obj1!, mat, '5')
      await raw(tx, `update public.movements set created_at = now() - interval '31 minutes' where id = $1`, [k2])
      const late = await res(tx, `select public.cancel_own_entry('movements', $1, 'kech')`, [k2])
      const again = await res(tx, `select public.cancel_own_entry('movements', $1, 'yana')`, [k])
      return { noReason, other, ok, del, tz, och, late, again }
    })
    expect(r).toMatchObject({
      noReason: '22023:correct_invalid', other: '42501:correct_forbidden', ok: 'OK:1', del: true,
      och: [], late: '55000:correct_window_passed', again: 'P0002:correct_not_found',
    })
    expect(r.tz).toHaveLength(1)
    expect(r.tz[0]).toMatchObject({ severity: 'belgi', details: { via: 'cancel_own_entry', reason: "Noto'g'ri material", actor_profile_id: P('omborchi') } })
  })

  it('xarid: bog`langan kirimi bor — correct_linked; o`tkazma harakati — correct_linked; boshqa firma — not_found', async () => {
    const r = await as('taminotchi', async (tx) => {
      const mat = await sys(tx, () => newMat(tx))
      const p = await purchase(tx, P('taminotchi'), { obj: A.ids.obj1!, mat, qty: '5', total: '50' })
      await system(tx, () => mv(tx, 'kirim', A.ids.obj1!, mat, '5', { extra: { purchase_id: p } }))
      const linked = await res(tx, `select public.cancel_own_entry('purchases', $1, 'x')`, [p])
      await switchTo(tx, 'admin')
      const tid = randomUUID()
      await tx.query(`select public.create_transfer($1, $2, $3, $4, $5, 1, null)`, [tid, A.ids.obj1, A.ids.obj2, A.ids.m1, kgId])
      const tOut = await sys(tx, () => scalar<string>(tx, `select id from public.movements where transfer_id = $1`, [tid]))
      const tr = await res(tx, `select public.cancel_own_entry('movements', $1, 'x')`, [tOut])
      await switchTo(tx, 'admin', B)
      const foreign = await res(tx, `select public.cancel_own_entry('purchases', $1, 'x')`, [p])
      return { linked, tr, foreign }
    })
    expect(r).toEqual({ linked: '55000:correct_linked', tr: '55000:correct_linked', foreign: 'P0002:correct_not_found' })
  })
})

describe('Podotchet sanasi — detail', () => {
  it('buxgalter 5 kun oldingi sana — ops_occurred_at_range, detail = ruxsat etilgan eng erta vaqt (UTC ISO)', async () => {
    const e = await as('buxgalter', (tx) =>
      errOf(tx, `insert into public.cash_advances (company_id, recipient_id, amount, issued_at) values ($1, $2, 1000, now() - interval '5 days')`,
        [A.id, P('haydovchi')]))
    expect(e).toMatchObject({ code: '23514', hint: 'ops_occurred_at_range' })
    expect(e!.detail).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/)
    const min = new Date(e!.detail!).getTime()
    expect(Math.abs(min - (Date.now() - 3 * 86400e3))).toBeLessThan(5 * 60e3)
  })
})

// ============================================================================
// L2 / L4 — FIFO zanjiri (repro F1, F2, F3 — avtokommit, alohida tranzaksiyalar)
// ============================================================================
describe('L2 / L4: qoida 1 zanjiri', () => {
  const sysPur = async (buyer: string, obj: string, mat: { id: string; unit: string }, qty: number, at: string): Promise<string> =>
    purchase(db, buyer, { obj, mat, qty: String(qty), total: '1000000', at })
  /** audit3 D6: xarid o'z vaqtida kiritilgan (created_at = purchased_at), triggerlarsiz. */
  const aged = (ids: string[]): Promise<void> =>
    db.transaction(async (tx) => {
      await tx.exec('set local session_replication_role = replica')
      await tx.query(`update public.purchases set created_at = purchased_at where id = any($1)`, [ids])
    })
  const sum = (a: AlertRow[]): string[] => a.map((x) => `${x.type}/${x.status}`)

  it('F1: orqa sanali ikkinchi xarid avval kiritilgan xaridni qoplagan kirimni "o`g`irlamaydi"', async () => {
    const mat = await newMat()
    const o = A.ids.obj3!
    const real = await sysPur(P('haydovchi'), o, mat, 100, ago(30))
    await aged([real])
    await mv(db, 'kirim', o, mat, '100', { at: ago(29) })
    await db.query(`select private.evaluate_due_purchases(now())`)
    const fake = await sysPur(P('haydovchi'), o, mat, 100, ago(31))
    // orqa sanali "fake" hozir kiritilgan — alert kiritilgandan 24 soat o'tib (audit3 D6)
    await db.query(`select private.evaluate_due_purchases(now())`)
    expect(sum(await alertsQ(db, 'xarid_qabul_farqi', `purchase_id = $1`, [fake]))).toEqual([])
    await db.query(`select private.evaluate_due_purchases(now() + interval '25 hours')`)
    expect(sum(await alertsQ(db, 'xarid_qabul_farqi', `purchase_id = $1`, [real]))).toEqual([])
    expect(sum(await alertsQ(db, 'xarid_qabul_farqi', `purchase_id = $1`, [fake]))).toEqual(['xarid_qabul_farqi/yangi'])
    const alloc = await rows(db, `select movement_id from private.receipt_candidates($1)`, [fake])
    expect(alloc).toEqual([])
  })

  it('F2: oldingi xarid o`chirilsa keyingisining alerti yopiladi; tiklansa — cron qayta ochadi', async () => {
    const mat = await newMat()
    const o = A.ids.obj3!
    const p1 = await sysPur(P('haydovchi'), o, mat, 100, ago(30))
    const p2 = await sysPur(P('taminotchi'), o, mat, 100, ago(29.9))
    await aged([p1, p2])
    await mv(db, 'kirim', o, mat, '100', { at: ago(29) })
    await db.query(`select private.evaluate_due_purchases(now())`)
    const q = (id: string): Promise<AlertRow[]> => alertsQ(db, 'xarid_qabul_farqi', `purchase_id = $1`, [id])
    expect(sum(await q(p2))).toEqual(['xarid_qabul_farqi/yangi'])
    await db.query(`update public.purchases set deleted_at = now() where id = $1`, [p1])
    const afterDel = await q(p2)
    expect(sum(afterDel)).toEqual(['xarid_qabul_farqi/yopildi'])
    expect(afterDel[0]!.details).toMatchObject({ closed_reason: 'covered_by_unlinked' })
    await db.query(`update public.purchases set deleted_at = null where id = $1`, [p1])
    expect(sum(await q(p1))).toEqual([])
    await db.query(`select private.evaluate_due_purchases(now())`)
    expect(sum(await q(p1))).toEqual([])
    expect(sum(await q(p2))).toEqual(['xarid_qabul_farqi/yopildi', 'xarid_qabul_farqi/yangi'])
  })

  it('F3 (L4): bitta 200 lik kirim ikki 100 lik xaridni qoplaydi — jiddiy alert yo`q; kirim qisman taqsimlanadi', async () => {
    const mat = await newMat()
    const o = A.ids.obj3!
    const p1 = await sysPur(P('haydovchi'), o, mat, 100, ago(30))
    const p2 = await sysPur(P('taminotchi'), o, mat, 100, ago(29.9))
    const k = await mv(db, 'kirim', o, mat, '200', { at: ago(29) })
    await db.query(`select private.evaluate_due_purchases(now())`)
    expect(await alertsQ(db, 'xarid_qabul_farqi', `purchase_id = any($1)`, [[p1, p2]])).toEqual([])
    const c1 = await rows(db, `select movement_id, qty_base::text from private.receipt_candidates($1)`, [p1])
    const c2 = await rows(db, `select movement_id, qty_base::text from private.receipt_candidates($1)`, [p2])
    expect(c1).toEqual([{ movement_id: k, qty_base: '100.000000' }])
    expect(c2).toEqual([{ movement_id: k, qty_base: '100.000000' }])
  })

  it('L2: orqa sanali xarid (created_at − purchased_at > 24 soat) oddiy xariddan keyin taqsimlanadi', async () => {
    const r = await as('admin', async (tx) => {
      const mat = await newMat(tx)
      const o = A.ids.obj3!
      const back = await purchase(tx, P('taminotchi'), { obj: o, mat, qty: '50', total: '1', at: ago(40) })
      const fresh = await purchase(tx, P('haydovchi'), { obj: o, mat, qty: '50', total: '1', at: ago(20) })
      await raw(tx, `update public.purchases set created_at = purchased_at where id = $1`, [fresh])
      const k = await mv(tx, 'kirim', o, mat, '50', { at: ago(19) })
      return {
        k,
        b: await sys(tx, () => rows(tx, `select movement_id from private.receipt_candidates($1)`, [back])),
        f: await sys(tx, () => rows(tx, `select movement_id from private.receipt_candidates($1)`, [fresh])),
      }
    })
    expect(r.f).toEqual([{ movement_id: r.k }])
    expect(r.b).toEqual([])
  })

  it('L11: qulf tartibi — evaluate_kirim_source receipt_alloc ni alert_lock dan oldin oladi; evaluate_purchase_receipt xarid qatorini qulflamaydi', async () => {
    const ks = await scalar<string>(db, `select pg_get_functiondef('private.evaluate_kirim_source(uuid)'::regprocedure)`)
    expect(ks.indexOf('lock_receipt_alloc')).toBeGreaterThan(0)
    expect(ks.indexOf('lock_receipt_alloc')).toBeLessThan(ks.indexOf('alert_lock'))
    const ep = await scalar<string>(db, `select pg_get_functiondef('private.evaluate_purchase_receipt(uuid, timestamptz)'::regprocedure)`)
    expect(ep).not.toMatch(/for no key update/)
  })
})

// ============================================================================
// L3 — manfiy_qoldiq qayta ochiladi (F4)
// ============================================================================
describe('L3: manfiy_qoldiq', () => {
  it('F4: 24 soat ichida qayta manfiy — o`sha alert qayta ochiladi (reopened_at), yangi Telegram xabari yo`q', async () => {
    const r = await as('admin', async (tx) => {
      const mat = await newMat(tx)
      const o = A.ids.obj2!
      const q = `material_id = '${mat.id}'`
      await mv(tx, 'kirim', o, mat, '10')
      await mv(tx, 'chiqim', o, mat, '15')
      const a1 = await alertsOf(tx, 'manfiy_qoldiq', q)
      await mv(tx, 'kirim', o, mat, '10')
      const a2 = await alertsOf(tx, 'manfiy_qoldiq', q)
      await mv(tx, 'chiqim', o, mat, '10')
      const a3 = await alertsOf(tx, 'manfiy_qoldiq', q)
      for (let i = 0; i < 3; i++) await mv(tx, 'chiqim', o, mat, '1')
      const a4 = await alertsOf(tx, 'manfiy_qoldiq', q)
      const ob = await outboxOf(tx, `alert_id = $1`, [a1[0]!.id])
      return { a1: a1.map((a) => a.status), a2: a2.map((a) => a.status), a3, a4, ob: ob.length }
    })
    expect(r.a1).toEqual(['yangi'])
    expect(r.a2).toEqual(['yopildi'])
    expect(r.a3.map((a) => a.status)).toEqual(['yangi'])
    expect(r.a3[0]!.details).toMatchObject({ stock_after: -5, reopen_count: 1 })
    expect(r.a3[0]!.details.reopened_at).toBeTruthy()
    expect(r.a3[0]!.details).not.toHaveProperty('closed_reason')
    expect(r.a4.map((a) => a.status)).toEqual(['yangi'])
    expect(r.a4[0]!.details).toMatchObject({ stock_after: -8 })
    expect(r.ob).toBe(1)
  })
})

// ============================================================================
// L6 — payment_source
// ============================================================================
describe('L6: to`lov manbasi (podotchet / firma)', () => {
  it('podotchet berilmagan xaridor — firma (qo`limdagi pulga kirmaydi); berilgan — podotchet; klient "firma" yuborsa ham qoida', async () => {
    const r = await as('taminotchi', async (tx) => {
      const mat = await sys(tx, () => newMat(tx))
      const spent = async (role: Role): Promise<number> =>
        Number(await sys(tx, () => scalar<string>(tx, `select spent_total::text from private.cash_position($1, $2)`, [A.id, P(role)])))
      const owed = async (): Promise<number> =>
        Number((await sys(tx, () => scalar<Row>(tx, `select private.daily_report_stats($1, now() - interval '1 hour', now() + interval '1 hour')`, [A.id]))).cash_owed_to_staff_sum)
      const t0 = await spent('taminotchi')
      const h0 = await spent('haydovchi')
      const o0 = await owed()
      const tam = await purchase(tx, P('taminotchi'), { obj: A.ids.obj3!, mat, qty: '1', total: '700000' })
      await switchTo(tx, 'haydovchi')
      const hay = await purchase(tx, P('haydovchi'), { obj: A.ids.obj1!, mat, qty: '1', total: '100', extra: { payment_source: 'firma' } })
      await switchTo(tx, 'admin')
      const adm = await purchase(tx, P('haydovchi'), { obj: A.ids.obj1!, mat, qty: '1', total: '200', extra: { payment_source: 'firma' } })
      const sysP = await system(tx, () => purchase(tx, P('taminotchi'), { obj: A.ids.obj3!, mat, qty: '1', total: '1' }))
      const src = await rows<{ id: string; payment_source: string }>(tx, `select id, payment_source from public.purchases where id = any($1)`, [[tam, hay, adm, sysP]])
      const by = (id: string): string | undefined => src.find((s) => s.id === id)?.payment_source
      const viewDiff = Number(await sys(tx, () => scalar<string>(tx, `select spent_total::text from public.cash_balances where profile_id = $1`, [P('haydovchi')]))) - h0
      return {
        tam: by(tam), hay: by(hay), adm: by(adm), sysP: by(sysP),
        tamDiff: (await spent('taminotchi')) - t0, hayDiff: (await spent('haydovchi')) - h0, viewDiff, owedDiff: (await owed()) - o0,
      }
    })
    expect(r).toMatchObject({ tam: 'firma', hay: 'podotchet', adm: 'firma', sysP: 'podotchet' })
    // taminotchi: 700 000 lik firma xaridi kirmaydi, tizim xaridi (1) — podotchet
    expect(r.tamDiff).toBeCloseTo(1, 2)
    // haydovchi: 100 (podotchet, klient "firma" yuborgan bo'lsa ham), admin "firma" deb kiritgan 200 — kirmaydi
    expect(r.hayDiff).toBeCloseTo(100, 2)
    expect(r.viewDiff).toBeCloseTo(100, 2)
    // kunlik hisobot: xodimlardan qarz faqat podotchet xaridlardan — taminotchi +1, haydovchi +100
    // (bu faylda oldingi testlar haydovchi balansini manfiyga tushirgan); firma xaridlari (700 000, 200) yo'q
    expect(r.owedDiff).toBeCloseTo(101, 2)
  })
})

// ============================================================================
// L8 — qoida 6 dayjesti
// ============================================================================
describe('L8: qoida 6 — bitta dayjest', () => {
  it('qayta baholashda bir nechta smetadan_ortiq_sorov — bitta alerts_digest (alohida alert xabarlari yo`q)', async () => {
    const r = await as('admin', async (tx) => {
      await chats(tx)
      const r1 = await scalar<string>(tx, `insert into public.material_requests (company_id, object_id, material_id, unit_id, qty_input, unit_input, qty_base)
        values ($1, $2, $3, $4, 50, '-', 0) returning id`, [A.id, A.ids.obj1, A.ids.m1, kgId])
      const before = await alertsOf(tx, 'smetadan_ortiq_sorov', `object_id = $1`, [A.ids.obj1])
      await mv(tx, 'chiqim', A.ids.obj1!, { id: A.ids.m1!, unit: kgId }, '1500')
      await tx.exec('set constraints all immediate')
      const al = await alertsOf(tx, 'smetadan_ortiq_sorov', `object_id = $1 and status = 'yangi'`, [A.ids.obj1])
      const perAlert = await outboxOf(tx, `kind = 'alert' and alert_id = any($1)`, [al.map((a) => a.id)])
      const digest = await outboxOf(tx, `kind = 'alerts_digest' and company_id = $1`, [A.id])
      return { r1, before, al, perAlert, digest, rec: digest[0] ? await recipients(tx, digest[0].id as string) : [] }
    })
    expect(r.before).toEqual([])
    expect(r.al.length).toBeGreaterThanOrEqual(2)
    expect(r.perAlert).toEqual([])
    expect(r.digest).toHaveLength(1)
    const pl = r.digest[0]!.payload as Row
    expect(pl).toMatchObject({ alert_type: 'smetadan_ortiq_sorov', count: r.al.length, company_name: 'A', more_count: 0 })
    expect((pl.alert_ids as string[]).sort()).toEqual(r.al.map((a) => a.id).sort())
    expect(Object.keys((pl.items as Row[])[0]!).sort()).toEqual([
      'alert_id', 'base_unit', 'material_id', 'material_name', 'object_id', 'object_name', 'over_qty_base', 'request_id',
    ])
    expect(r.rec).toEqual(['admin', 'direktor'])
  })

  it('bitta alert — oddiy alert xabari; so`rov kiritilganda (qayta baholash emas) — darhol', async () => {
    const r = await as('admin', async (tx) => {
      await mv(tx, 'chiqim', A.ids.obj1!, { id: A.ids.m1!, unit: kgId }, '1500')
      await tx.exec('set constraints all immediate')
      const al = await alertsOf(tx, 'smetadan_ortiq_sorov', `object_id = $1 and status = 'yangi'`, [A.ids.obj1])
      const ob = await outboxOf(tx, `kind = 'alert' and alert_id = any($1)`, [al.map((a) => a.id)])
      const r2 = await scalar<string>(tx, `insert into public.material_requests (company_id, object_id, material_id, unit_id, qty_input, unit_input, qty_base)
        values ($1, $2, $3, $4, 5, '-', 0) returning id`, [A.id, A.ids.obj1, A.ids.m1, kgId])
      const a2 = await alertsOf(tx, 'smetadan_ortiq_sorov', `request_id = $1`, [r2])
      const ob2 = await outboxOf(tx, `kind = 'alert' and alert_id = $1`, [a2[0]!.id])
      const dg = await outboxOf(tx, `kind = 'alerts_digest' and company_id = $1`, [A.id])
      return { n: al.length, ob: ob.length, ob2: ob2.length, dg: dg.length }
    })
    expect(r).toEqual({ n: 1, ob: 1, ob2: 1, dg: 0 })
  })
})

// ============================================================================
// Firma izolyatsiyasi
// ============================================================================
describe('firma izolyatsiyasi (audit2)', () => {
  it('B admin: A ning yangi alert turlari, birlashtirish, tuzatish va chat RPC lari — yo`q', async () => {
    const r = await as('admin', async (tx) => {
      const mat = await newMat(tx)
      const p = await purchase(tx, P('haydovchi'), { obj: A.ids.obj1!, mat, qty: '1', total: '10' })
      const k = await mv(tx, 'kirim', A.ids.obj3!, mat, '1')
      await switchTo(tx, 'admin', B)
      return {
        alerts: await scalar<number>(tx, `select count(*)::int from public.alerts where company_id = $1 and type::text in ('xarid_boshqa_nomidan', 'sotuvchi_birlashtirildi')`, [A.id]),
        outbox: await scalar<number>(tx, `select count(*)::int from public.notification_outbox where ref_id = $1`, [p]),
        correct: await res(tx, `select public.correct_entry('movements', $1, 2)`, [k]),
        cancel: await res(tx, `select public.cancel_own_entry('movements', $1, 'x')`, [k]),
        reset: await res(tx, `select public.reset_chat_blocked($1)`, [P('prorab')]),
        dir: await scalar<number>(tx, `select count(*)::int from public.profile_directory where company_id = $1`, [A.id]),
        counts: await scalar<number>(tx, `select count(*)::int from public.inventory_counts where company_id = $1`, [A.id]),
      }
    })
    expect(r).toEqual({
      alerts: 0, outbox: 0, correct: 'P0002:correct_not_found', cancel: 'P0002:correct_not_found',
      reset: 'P0002:profile_not_found', dir: 0, counts: 0,
    })
  })

  it('B tekshiruvchi A ning hisoblarini, B haydovchi A so`rovlarini ko`rmaydi; anon — yangi RPC lar yo`q', async () => {
    const t = await as('tekshiruvchi', (tx) => scalar<number>(tx, `select count(*)::int from public.inventory_counts where company_id = $1`, [A.id]), B)
    expect(t).toBe(0)
    const anon = await asUser(db, randomUUID(), async (tx) => ({
      reset: await res(tx, `select public.reset_chat_blocked($1)`, [P('prorab')]),
      cancel: await res(tx, `select public.cancel_own_entry('movements', $1, 'x')`, [A.ids.mv_obj2]),
    }))
    expect(anon).toEqual({ reset: '42501:auth_required', cancel: '42501:auth_required' })
  })
})
