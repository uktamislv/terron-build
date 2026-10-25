// Batch 6 — 20261030000001_notifications.sql: notification_outbox, alerts → outbox
// trigger, pg_net uyg'otish, daily_report_stats (oraliq [kecha 20:00, bugun 20:00) Toshkent), enqueue_daily_reports,
// svc_* RPC'lar (claim / recipients / complete), RLS, grantlar, pg_cron ishlari.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  asAnon,
  asService,
  asUser,
  createCompany,
  createDb,
  createMaterial,
  createObject,
  createUser,
  insertRow,
  one,
  rows,
  scalar,
  tryQuery,
  type Db,
  type Queryable,
  type Row,
  type Tx,
} from './_harness'
import { buildTwoCompanies, type CompanyFixture } from './_fixtures'

let db: Db
let A: CompanyFixture
let B: CompanyFixture

const DISPATCH_URL = 'https://srriiiugmxgrdnuvhgix.supabase.co/functions/v1/tg-dispatch'

beforeAll(async () => {
  db = await createDb()
  ;({ A, B } = await buildTwoCompanies(db))
})
afterAll(async () => {
  await db?.close()
})

/** Superuser tranzaksiyasi, oxirida rollback. */
async function inTx<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    const r = await fn(tx)
    await tx.rollback()
    return r
  })
}

/** `OK` yoki xato kodi (savepoint bilan — tx davom etadi). */
async function code(q: Queryable, sql: string, params?: unknown[]): Promise<string> {
  const r = await tryQuery(q, sql, params)
  return r.ok ? 'OK' : (r.code ?? '?')
}

const outboxFor = (q: Queryable, alertId: string): Promise<Row[]> =>
  rows(q, `select * from public.notification_outbox where alert_id = $1`, [alertId])

const insertAlert = async (
  q: Queryable,
  co: CompanyFixture,
  type: string,
  severity = 'ogohlantirish',
  details: Row = {},
): Promise<string> =>
  scalar<string>(
    q,
    `insert into public.alerts (company_id, type, severity, object_id, material_id, details)
     values ($1, $2::public.alert_type, $3::public.alert_severity, $4, $5, $6) returning id`,
    [co.id, type, severity, co.ids.obj1, co.ids.m1, JSON.stringify(details)],
  )

const vaultSecret = (q: Queryable = db): Promise<string> =>
  scalar<string>(q, `select decrypted_secret from vault.decrypted_secrets where name = 'tg_dispatch_secret'`)

// ============================================================================
// Sozlamalar va Vault
// ============================================================================
describe('sozlamalar', () => {
  it('Vault siri yaratilgan: 64 hex belgi, bitta', async () => {
    const r = await rows<{ n: number }>(db, `select count(*)::int as n from vault.secrets where name = 'tg_dispatch_secret'`)
    expect(r[0]?.n).toBe(1)
    expect(await vaultSecret()).toMatch(/^[0-9a-f]{64}$/)
  })

  it('private.app_settings: dispatch_url', async () => {
    expect(await scalar(db, `select value from private.app_settings where key = 'dispatch_url'`)).toBe(DISPATCH_URL)
  })

  it('app_settings va Vault — authenticated / service_role / anon o`qiy olmaydi', async () => {
    for (const run of [
      <T>(fn: (tx: Tx) => Promise<T>) => asUser(db, A.users.admin.authUid, fn),
      <T>(fn: (tx: Tx) => Promise<T>) => asService(db, fn),
      <T>(fn: (tx: Tx) => Promise<T>) => asAnon(db, fn),
    ]) {
      expect(await run((tx) => code(tx, `select * from private.app_settings`))).toBe('42501')
      expect(await run((tx) => code(tx, `select * from vault.decrypted_secrets`))).toBe('42501')
    }
  })
})

// ============================================================================
// alerts → outbox
// ============================================================================
describe('alerts INSERT → outbox', () => {
  const IMMEDIATE = [
    'xarid_qabul_farqi',
    'narx_ogishi',
    'yozuv_ochirildi',
    'normadan_oshish',
    'inventarizatsiya_kamomadi',
    'smetadan_ortiq_sorov',
  ]

  it.each(IMMEDIATE)('%s → bitta pending qator', async (type) => {
    const r = await inTx(async (tx) => {
      const id = await insertAlert(tx, A, type)
      return outboxFor(tx, id)
    })
    expect(r).toHaveLength(1)
    expect(r[0]).toMatchObject({ company_id: A.id, kind: 'alert', status: 'pending', attempts: 0, sent_count: 0 })
  })

  it('payload: tur, daraja, obyekt/material nomi, asosiy birlik, details, created_at', async () => {
    const r = await inTx(async (tx) => {
      const id = await insertAlert(tx, A, 'narx_ogishi', 'ogohlantirish', { price: 1450, avg_n: 1300 })
      const a = await one<{ created_at: Date }>(tx, `select created_at from public.alerts where id = $1`, [id])
      const o = await one<{ payload: Row }>(tx, `select payload from public.notification_outbox where alert_id = $1`, [id])
      return { id, a, payload: o.payload }
    })
    expect(r.payload).toMatchObject({
      alert_id: r.id,
      type: 'narx_ogishi',
      severity: 'ogohlantirish',
      object_name: 'A obj1',
      material_name: 'A sement',
      base_unit: 'kg',
      details: { price: 1450, avg_n: 1300 },
    })
    expect(new Date(r.payload.created_at as string).getTime()).toBe(r.a.created_at.getTime())
  })

  it('obyekt/materialsiz alert — nomlar null', async () => {
    const p = await inTx(async (tx) => {
      const id = await scalar<string>(
        tx,
        `insert into public.alerts (company_id, type) values ($1, 'normadan_oshish') returning id`,
        [A.id],
      )
      return scalar<Row>(tx, `select payload from public.notification_outbox where alert_id = $1`, [id])
    })
    expect(p).toMatchObject({ object_name: null, material_name: null, base_unit: null })
  })

  it('belgi darajasi va ozi_qabul_qilgan — navbatga tushmaydi', async () => {
    const r = await inTx(async (tx) => {
      const a = await insertAlert(tx, A, 'narx_ogishi', 'belgi')
      const b = await insertAlert(tx, A, 'ozi_qabul_qilgan', 'belgi')
      const c = await insertAlert(tx, A, 'ozi_qabul_qilgan', 'ogohlantirish')
      return [(await outboxFor(tx, a)).length, (await outboxFor(tx, b)).length, (await outboxFor(tx, c)).length]
    })
    expect(r).toEqual([0, 0, 0])
  })

  it('alert UPDATE (details, status) — yangi qator yo`q', async () => {
    const r = await inTx(async (tx) => {
      const id = await insertAlert(tx, A, 'xarid_qabul_farqi')
      const before = await scalar<number>(tx, `select count(*)::int from public.notification_outbox`)
      await tx.query(`update public.alerts set details = '{"x":1}'::jsonb where id = $1`, [id])
      await tx.query(`update public.alerts set status = 'yopildi' where id = $1`, [id])
      const after = await scalar<number>(tx, `select count(*)::int from public.notification_outbox`)
      return { before, after, mine: (await outboxFor(tx, id)).length }
    })
    expect(r.after).toBe(r.before)
    expect(r.mine).toBe(1)
  })

  it('haqiqiy oqim: xarid soft delete → yozuv_ochirildi alert → outbox', async () => {
    const r = await inTx(async (tx) => {
      const pid = await scalar<string>(
        tx,
        `insert into public.purchases (company_id, buyer_id, object_id, material_id, qty_input, unit_input, qty_base,
           unit_price, total_amount)
         values ($1, $2, $3, $4, 1, 'm³', 1, 0, 100000) returning id`,
        [A.id, A.users.taminotchi.profileId, A.ids.obj2, A.ids.m2],
      )
      await tx.query(`update public.purchases set deleted_at = now() where id = $1`, [pid])
      return rows<{ payload: Row }>(
        tx,
        `select o.payload from public.notification_outbox o
           join public.alerts a on a.id = o.alert_id
          where a.type = 'yozuv_ochirildi' and a.purchase_id = $1`,
        [pid],
      )
    })
    expect(r).toHaveLength(1)
    expect(r[0]?.payload).toMatchObject({ type: 'yozuv_ochirildi', material_name: 'A qum', base_unit: 'm³' })
  })

  it('pg_net: dispatch_url ga POST, Content-Type va x-dispatch-secret (Vault) sarlavhalari, body {}', async () => {
    const r = await inTx(async (tx) => {
      const before = await scalar<number>(tx, `select coalesce(max(id), 0)::int from net.http_request_queue`)
      await insertAlert(tx, A, 'xarid_qabul_farqi')
      return rows<{ method: string; url: string; headers: Row; body: Row; timeout_milliseconds: number }>(
        tx,
        `select method, url, headers, body, timeout_milliseconds from net.http_request_queue where id > $1`,
        [before],
      )
    })
    expect(r).toHaveLength(1)
    expect(r[0]).toMatchObject({ method: 'POST', url: DISPATCH_URL, body: {}, timeout_milliseconds: 5000 })
    expect(r[0]?.headers).toEqual({ 'Content-Type': 'application/json', 'x-dispatch-secret': await vaultSecret() })
  })

  it('bitta tranzaksiyada bir nechta alert — bitta uyg`otish', async () => {
    const r = await inTx(async (tx) => {
      const before = await scalar<number>(tx, `select coalesce(max(id), 0)::int from net.http_request_queue`)
      await insertAlert(tx, A, 'xarid_qabul_farqi')
      await insertAlert(tx, A, 'narx_ogishi')
      await insertAlert(tx, B, 'normadan_oshish')
      return scalar<number>(tx, `select count(*)::int from net.http_request_queue where id > $1`, [before])
    })
    expect(r).toBe(1)
  })

  it('belgi alert — uyg`otish yo`q', async () => {
    const r = await inTx(async (tx) => {
      const before = await scalar<number>(tx, `select coalesce(max(id), 0)::int from net.http_request_queue`)
      await insertAlert(tx, A, 'ozi_qabul_qilgan', 'belgi')
      return scalar<number>(tx, `select count(*)::int from net.http_request_queue where id > $1`, [before])
    })
    expect(r).toBe(0)
  })

  it('pg_net xatosi alert INSERT ni buzmaydi (qator navbatda qoladi)', async () => {
    const r = await inTx(async (tx) => {
      await tx.exec(`
        create or replace function net.http_post(
          url text, body jsonb default '{}'::jsonb, params jsonb default '{}'::jsonb,
          headers jsonb default '{}'::jsonb, timeout_milliseconds integer default 5000
        ) returns bigint language plpgsql as $f$ begin raise exception 'pg_net down'; end $f$`)
      const id = await insertAlert(tx, A, 'narx_ogishi')
      return (await outboxFor(tx, id)).length
    })
    expect(r).toBe(1)
  })

  it('dispatch_url yo`q — alert INSERT baribir o`tadi, HTTP yo`q', async () => {
    const r = await inTx(async (tx) => {
      await tx.exec(`delete from private.app_settings where key = 'dispatch_url'`)
      const before = await scalar<number>(tx, `select coalesce(max(id), 0)::int from net.http_request_queue`)
      const id = await insertAlert(tx, A, 'narx_ogishi')
      return {
        outbox: (await outboxFor(tx, id)).length,
        http: await scalar<number>(tx, `select count(*)::int from net.http_request_queue where id > $1`, [before]),
      }
    })
    expect(r).toEqual({ outbox: 1, http: 0 })
  })

  it('alert rollback bo`lsa — outbox ham, HTTP ham yo`q', async () => {
    const before = await scalar<number>(db, `select count(*)::int from net.http_request_queue`)
    const n = await scalar<number>(db, `select count(*)::int from public.notification_outbox`)
    await inTx((tx) => insertAlert(tx, A, 'narx_ogishi'))
    expect(await scalar<number>(db, `select count(*)::int from net.http_request_queue`)).toBe(before)
    expect(await scalar<number>(db, `select count(*)::int from public.notification_outbox`)).toBe(n)
  })
})

// ============================================================================
// daily_report_stats
// ============================================================================
describe('daily_report_stats', () => {
  let E: string
  let eObj: string
  let eMat: string
  let eBuyer: string

  beforeAll(async () => {
    E = await createCompany(db, { name: 'E firma' })
    eObj = await createObject(db, { companyId: E, name: 'E obj' })
    eMat = await createMaterial(db, { companyId: E, name: 'E sement', baseUnit: 'kg' })
    eBuyer = (await createUser(db, { companyId: E, role: 'taminotchi', phone: '+998977000001' })).profileId
    const mv = (type: string, at: string, deleted = false): Promise<unknown> =>
      insertRow<{ id: string }>(db, 'movements', {
        company_id: E,
        type,
        object_id: eObj,
        material_id: eMat,
        qty_input: 1,
        unit_input: 'kg',
        qty_base: 1,
        occurred_at: at,
      }).then(async (r) => {
        if (deleted) await db.query(`update public.movements set deleted_at = now() where id = $1`, [r.id])
      })
    // 2026-10-20 hisoboti = [19.10 20:00, 20.10 20:00) Toshkent = [19.10 15:00 UTC, 20.10 15:00 UTC)
    await mv('kirim', '2026-10-19T14:59:00Z') // Toshkent 19.10 19:59 → 19-oktabr hisoboti
    await mv('kirim', '2026-10-19T15:00:00Z') // 20:00 → 20
    await mv('kirim', '2026-10-19T15:01:00Z') // 20:01 → 20
    await mv('kirim', '2026-10-20T10:00:00Z', true) // 20, o'chirilgan
    await mv('chiqim', '2026-10-20T14:59:00Z') // 20.10 19:59 → 20
    await mv('chiqim', '2026-10-20T15:00:00Z') // 20.10 20:00 → 21
    await mv('chiqim', '2026-10-20T15:01:00Z') // 20:01 → 21
    const pu = (at: string, total: number, deleted = false): Promise<unknown> =>
      insertRow<{ id: string }>(db, 'purchases', {
        company_id: E,
        buyer_id: eBuyer,
        object_id: eObj,
        material_id: eMat,
        qty_input: 10,
        unit_input: 'kg',
        qty_base: 10,
        unit_price: 0,
        total_amount: total,
        purchased_at: at,
      }).then(async (r) => {
        if (deleted) await db.query(`update public.purchases set deleted_at = now() where id = $1`, [r.id])
      })
    await pu('2026-10-19T15:01:00Z', 1000.5)
    await pu('2026-10-20T12:00:00Z', 2000)
    await pu('2026-10-20T13:00:00Z', 5000, true)
    await pu('2026-10-20T15:00:00Z', 7000)
  })

  const stats = (co: string, date: string): Promise<Row> =>
    scalar<Row>(
      db,
      `select private.daily_report_stats($1, (($2::date + time '20:00') at time zone 'Asia/Tashkent') - interval '24 hours',
                                             ($2::date + time '20:00') at time zone 'Asia/Tashkent')`,
      [co, date],
    )

  it('oraliq chegaralari (Toshkent 19:59 / 20:00 / 20:01), o`chirilganlar hisoblanmaydi, summa — matn', async () => {
    expect(await stats(E, '2026-10-20')).toEqual({
      date: '2026-10-20',
      period_start: '2026-10-19T15:00:00Z',
      period_end: '2026-10-20T15:00:00Z',
      failed_count: 0,
      company_name: 'E firma',
      kirim_count: 2,
      chiqim_count: 1,
      purchases_count: 2,
      purchases_sum: '3000.50',
      requests_count: 0,
      alerts_new: 0,
      alerts_by_type: {},
      self_received_count: 0,
      deleted_count: 0,
      // Batch 8 (O3)
      transfers_pending_count: 0,
      chiqim_without_estimate_count: 1, // E firma obyektida smeta yo'q
    })
  })

  it('qo`shni kunlar', async () => {
    expect(await stats(E, '2026-10-19')).toMatchObject({ kirim_count: 1, chiqim_count: 0, purchases_count: 0, purchases_sum: '0.00' })
    expect(await stats(E, '2026-10-21')).toMatchObject({ kirim_count: 0, chiqim_count: 2, purchases_count: 1, purchases_sum: '7000.00' })
  })

  it('boshqa firma ma`lumoti aralashmaydi', async () => {
    const s = await stats(B.id, '2026-10-20')
    expect(s).toMatchObject({ company_name: 'B', kirim_count: 0, chiqim_count: 0, purchases_count: 0 })
  })

  it('alertlar (bugun): yangi farqlar turlar bo`yicha, belgi va o`chirish alohida, o`chirilgan alert yo`q; so`rovlar', async () => {
    const r = await inTx(async (tx) => {
      const F = await scalar<string>(tx, `insert into public.companies (name) values ('F firma') returning id`)
      const ins = (type: string, severity = 'ogohlantirish'): Promise<string> =>
        scalar<string>(
          tx,
          `insert into public.alerts (company_id, type, severity) values ($1, $2::public.alert_type, $3::public.alert_severity)
           returning id`,
          [F, type, severity],
        )
      await ins('narx_ogishi')
      await ins('narx_ogishi')
      await ins('xarid_qabul_farqi', 'jiddiy')
      await ins('ozi_qabul_qilgan', 'belgi')
      await ins('yozuv_ochirildi')
      const del = await ins('normadan_oshish')
      await tx.query(`update public.alerts set deleted_at = now() where id = $1`, [del])
      const obj = await scalar<string>(tx, `insert into public.objects (company_id, name) values ($1, 'F obj') returning id`, [F])
      const mat = await scalar<string>(
        tx,
        `insert into public.materials (company_id, name, base_unit) values ($1, 'F sement', 'kg') returning id`,
        [F],
      )
      await tx.query(
        `insert into public.material_requests (company_id, object_id, material_id, qty_input, unit_input, qty_base)
         values ($1, $2, $3, 2, 'kg', 2)`,
        [F, obj, mat],
      )
      // failed_count: oraliqda 'failed' bo'lgan outbox qatorlari (sent — hisoblanmaydi)
      await tx.query(
        `insert into public.notification_outbox (company_id, kind, report_date, status)
         values ($1, 'daily_report', '2001-01-01', 'failed'), ($1, 'daily_report', '2001-01-02', 'sent')`,
        [F],
      )
      return scalar<Row>(
        tx,
        `select private.daily_report_stats($1, now() - interval '1 hour', now() + interval '1 hour')`,
        [F],
      )
    })
    expect(r).toMatchObject({
      company_name: 'F firma',
      requests_count: 1,
      alerts_new: 3,
      alerts_by_type: { narx_ogishi: 2, xarid_qabul_farqi: 1 },
      self_received_count: 1,
      deleted_count: 1,
      failed_count: 1,
    })
  })
})

// ============================================================================
// enqueue_daily_reports
// ============================================================================
describe('enqueue_daily_reports', () => {
  it('har faol firma uchun bitta qator; takroriy chaqiruv — 0; faol bo`lmagan / o`chirilgan firma yo`q', async () => {
    const r = await inTx(async (tx) => {
      const inactive = await scalar<string>(tx, `insert into public.companies (name, is_active) values ('Nofaol', false) returning id`)
      const deleted = await scalar<string>(tx, `insert into public.companies (name) values ('O''chirilgan') returning id`)
      await tx.query(`update public.companies set deleted_at = now() where id = $1`, [deleted])
      const active = await scalar<number>(
        tx,
        `select count(*)::int from public.companies where is_active and deleted_at is null`,
      )
      const httpBefore = await scalar<number>(tx, `select coalesce(max(id), 0)::int from net.http_request_queue`)
      const first = await scalar<number>(tx, `select private.enqueue_daily_reports('2026-10-20'::date)`)
      const http1 = await scalar<number>(tx, `select count(*)::int from net.http_request_queue where id > $1`, [httpBefore])
      const second = await scalar<number>(tx, `select private.enqueue_daily_reports('2026-10-20'::date)`)
      const perCompany = await rows<{ company_id: string; n: number }>(
        tx,
        `select company_id, count(*)::int as n from public.notification_outbox
          where kind = 'daily_report' and report_date = '2026-10-20' group by company_id`,
      )
      const aRow = await one<{ payload: Row; status: string; alert_id: string | null }>(
        tx,
        `select payload, status, alert_id from public.notification_outbox
          where kind = 'daily_report' and report_date = '2026-10-20' and company_id = $1`,
        [A.id],
      )
      const expected = await scalar<Row>(
        tx,
        `select private.daily_report_stats($1, '2026-10-19 15:00Z'::timestamptz, '2026-10-20 15:00Z'::timestamptz)`,
        [A.id],
      )
      return { active, first, second, http1, perCompany, aRow, expected, inactive, deleted }
    })
    expect(r.first).toBe(r.active)
    expect(r.second).toBe(0)
    expect(r.http1).toBe(1)
    expect(r.perCompany.every((x) => x.n === 1)).toBe(true)
    const ids = r.perCompany.map((x) => x.company_id)
    expect(ids).toContain(A.id)
    expect(ids).toContain(B.id)
    expect(ids).not.toContain(r.inactive)
    expect(ids).not.toContain(r.deleted)
    expect(r.aRow).toMatchObject({ status: 'pending', alert_id: null })
    expect(r.aRow.payload).toEqual(r.expected)
  })

  it('standart sana — Toshkent bugungi kuni', async () => {
    const r = await inTx(async (tx) => {
      await tx.query(`select private.enqueue_daily_reports()`)
      return scalar<boolean>(
        tx,
        `select bool_and(report_date = (now() at time zone 'Asia/Tashkent')::date)
           from public.notification_outbox where kind = 'daily_report'`,
      )
    })
    expect(r).toBe(true)
  })

  it('jadval cheklovlari: alert qatori alert_id siz / hisobot report_date siz — 23514; takroriy hisobot — 23505', async () => {
    const r = await inTx(async (tx) => [
      await code(tx, `insert into public.notification_outbox (company_id, kind) values ($1, 'alert')`, [A.id]),
      await code(tx, `insert into public.notification_outbox (company_id, kind) values ($1, 'daily_report')`, [A.id]),
      await code(
        tx,
        `insert into public.notification_outbox (company_id, kind, report_date) values ($1, 'daily_report', '2026-01-01'),
                                                                                      ($1, 'daily_report', '2026-01-01')`,
        [A.id],
      ),
      // boshqa firma alerti (navbatsiz — belgi) → kompozit FK
      await code(tx, `insert into public.notification_outbox (company_id, kind, alert_id) values ($1, 'alert', $2)`, [
        A.id,
        await insertAlert(tx, B, 'narx_ogishi', 'belgi'),
      ]),
    ])
    expect(r).toEqual(['23514', '23514', '23505', '23503'])
  })
})

// ============================================================================
// svc_claim_notifications / svc_complete_notification
// ============================================================================
describe('claim va complete', () => {
  /** Superuser tx: mavjud navbatni "yuborilgan" qilib, test qatorlarini qo'shadi. */
  async function scenario<T>(fn: (tx: Tx, mk: (opts?: Row) => Promise<string>) => Promise<T>): Promise<T> {
    return inTx(async (tx) => {
      await tx.exec(`update public.notification_outbox set status = 'sent' where status in ('pending', 'sending')`)
      let day = 0
      const mk = async (opts: Row = {}): Promise<string> => {
        day++
        const id = await scalar<string>(
          tx,
          `insert into public.notification_outbox (company_id, kind, report_date, payload)
           values ($1, 'daily_report', date '2025-01-01' + $2::int, '{}') returning id`,
          [A.id, day],
        )
        const sets = Object.keys(opts)
        if (sets.length > 0) {
          // updated_at ni ham qo'lda qo'yish uchun triggerlarsiz
          await tx.exec(`set local session_replication_role = replica`)
          for (const k of sets) {
            await tx.query(`update public.notification_outbox set ${k} = $2 where id = $1`, [id, opts[k]])
          }
          await tx.exec(`set local session_replication_role = origin`)
        }
        return id
      }
      return fn(tx, mk)
    })
  }

  const asSvc = async <T>(tx: Tx, fn: () => Promise<T>): Promise<T> => {
    await tx.exec(`set local role service_role`)
    try {
      return await fn()
    } finally {
      await tx.exec(`reset role`)
    }
  }

  const get = (tx: Tx, id: string): Promise<Row> =>
    one(
      tx,
      `select status, attempts, sent_count, last_error, sent_at is not null as has_sent_at,
              extract(epoch from (next_attempt_at - now()))::int as delay_sec
         from public.notification_outbox where id = $1`,
      [id],
    )

  it('claim: vaqti kelgan pending (eng eskisi birinchi), limit; kelajakdagi va yakunlanganlar olinmaydi', async () => {
    const r = await scenario(async (tx, mk) => {
      const old = await mk({ next_attempt_at: '2020-01-01T00:00:00Z' })
      const mid = await mk({ next_attempt_at: '2021-01-01T00:00:00Z' })
      const late = await mk({ next_attempt_at: '2022-01-01T00:00:00Z' })
      const future = await mk({ next_attempt_at: '2999-01-01T00:00:00Z' })
      const failed = await mk({ status: 'failed' })
      const claimed = await asSvc(tx, () =>
        rows<{ id: string; status: string; attempts: number }>(tx, `select * from public.svc_claim_notifications(2)`),
      )
      const rest = await asSvc(tx, () => rows<{ id: string }>(tx, `select * from public.svc_claim_notifications(20)`))
      return {
        claimed: claimed.map((x) => [x.id, x.status, x.attempts]),
        rest: rest.map((x) => x.id),
        ids: { old, mid, late, future, failed },
      }
    })
    expect(r.claimed).toEqual([
      [r.ids.old, 'sending', 1],
      [r.ids.mid, 'sending', 1],
    ])
    expect(r.rest).toEqual([r.ids.late])
  })

  it('claim: 10 daqiqadan ko`p "sending" da qolganlar qayta olinadi; urinishi tugaganlari — failed', async () => {
    const r = await scenario(async (tx, mk) => {
      const fresh = await mk({ status: 'sending', attempts: 1, updated_at: new Date(Date.now() - 5 * 60_000).toISOString() })
      const stale = await mk({ status: 'sending', attempts: 2, updated_at: new Date(Date.now() - 11 * 60_000).toISOString() })
      const dead = await mk({ status: 'sending', attempts: 6, updated_at: new Date(Date.now() - 11 * 60_000).toISOString() })
      const claimed = await asSvc(tx, () =>
        rows<{ id: string; attempts: number }>(tx, `select id, attempts from public.svc_claim_notifications(20)`),
      )
      return { claimed, stale, fresh: await get(tx, fresh), dead: await get(tx, dead) }
    })
    expect(r.claimed).toEqual([{ id: r.stale, attempts: 3 }])
    expect(r.fresh).toMatchObject({ status: 'sending', attempts: 1 })
    expect(r.dead).toMatchObject({ status: 'failed', last_error: 'stuck_in_sending' })
  })

  it('complete ok → sent, sent_count, sent_at; qisman xato last_error da', async () => {
    const r = await scenario(async (tx, mk) => {
      const id = await mk()
      await asSvc(tx, () => tx.query(`select public.svc_claim_notifications(20)`))
      const st = await asSvc(tx, () =>
        scalar(tx, `select public.svc_complete_notification($1, true, '{1002,1001}'::bigint[], 'chat 1: 400 Bad Request')`, [id]),
      )
      return { st, row: await get(tx, id) }
    })
    expect(r.st).toBe('sent')
    expect(r.row).toMatchObject({
      status: 'sent',
      attempts: 1,
      sent_count: 2,
      has_sent_at: true,
      last_error: 'chat 1: 400 Bad Request',
    })
  })

  it('complete xato → pending, kechikish 2^attempts daqiqa; 6-urinishdan keyin failed', async () => {
    const r = await scenario(async (tx, mk) => {
      const id = await mk()
      const delays: unknown[] = []
      for (let i = 1; i <= 6; i++) {
        await tx.query(`update public.notification_outbox set next_attempt_at = now() - interval '1 second' where id = $1`, [id])
        const claimed = await asSvc(tx, () => rows(tx, `select id from public.svc_claim_notifications(20)`))
        expect(claimed).toHaveLength(1)
        const st = await asSvc(tx, () => scalar(tx, `select public.svc_complete_notification($1, false, '{}'::bigint[], 'boom')`, [id]))
        const row = await get(tx, id)
        delays.push([st, row.attempts, st === 'pending' ? row.delay_sec : null])
      }
      return { delays, row: await get(tx, id) }
    })
    expect(r.delays).toEqual([
      ['pending', 1, 120],
      ['pending', 2, 240],
      ['pending', 3, 480],
      ['pending', 4, 960],
      ['pending', 5, 1920],
      ['failed', 6, null],
    ])
    expect(r.row).toMatchObject({ status: 'failed', last_error: 'boom' })
  })

  it('complete 429 (retry_after) → pending, urinish hisoblanmaydi, kechikish = retry_after', async () => {
    const r = await scenario(async (tx, mk) => {
      const id = await mk()
      await asSvc(tx, () => tx.query(`select public.svc_claim_notifications(20)`))
      const st = await asSvc(tx, () =>
        scalar(tx, `select public.svc_complete_notification($1, false, '{}'::bigint[], null, 30)`, [id]),
      )
      return { st, row: await get(tx, id) }
    })
    expect(r.st).toBe('pending')
    expect(r.row).toMatchObject({ status: 'pending', attempts: 0, delay_sec: 30, last_error: 'rate_limited' })
  })

  it('complete: "sending" bo`lmagan qatorga ta`sir qilmaydi; yo`q id → null; xato matni 1000 belgigacha', async () => {
    const r = await scenario(async (tx, mk) => {
      const pending = await mk()
      const st = await asSvc(tx, () => scalar(tx, `select public.svc_complete_notification($1, true, '{}'::bigint[], null)`, [pending]))
      const missing = await asSvc(tx, () =>
        scalar(tx, `select public.svc_complete_notification(gen_random_uuid(), true, '{}'::bigint[], null)`),
      )
      const pendingRow = await get(tx, pending)
      await tx.query(`update public.notification_outbox set next_attempt_at = '2999-01-01' where id = $1`, [pending])
      const long = await mk()
      await asSvc(tx, () => tx.query(`select public.svc_claim_notifications(20)`))
      await asSvc(tx, () => tx.query(`select public.svc_complete_notification($1, false, '{}'::bigint[], $2)`, [long, 'x'.repeat(5000)]))
      const len = await scalar<number>(tx, `select char_length(last_error) from public.notification_outbox where id = $1`, [long])
      return { st, row: pendingRow, missing, len }
    })
    expect(r.st).toBe('pending')
    expect(r.row).toMatchObject({ status: 'pending', attempts: 0 })
    expect(r.missing).toBeNull()
    expect(r.len).toBe(1000)
  })

  it('delivered_chat_ids: har urinishda birlashtiriladi (takrorsiz), sent_count = soni; 429 da ham saqlanadi', async () => {
    const r = await scenario(async (tx, mk) => {
      const id = await mk()
      const claim = async (): Promise<void> => {
        await tx.query(`update public.notification_outbox set next_attempt_at = now() - interval '1 second' where id = $1`, [id])
        await asSvc(tx, () => tx.query(`select public.svc_claim_notifications(20)`))
      }
      await claim()
      const st1 = await asSvc(tx, () =>
        scalar(tx, `select public.svc_complete_notification($1, false, '{1001}'::bigint[], 'p2: telegram 429', 17)`, [id]),
      )
      const after1 = await one(tx, `select delivered_chat_ids, sent_count, attempts from public.notification_outbox where id = $1`, [id])
      await claim()
      const st2 = await asSvc(tx, () =>
        scalar(tx, `select public.svc_complete_notification($1, true, '{1002,1001}'::bigint[], null)`, [id]),
      )
      const after2 = await one(
        tx,
        `select status, delivered_chat_ids, sent_count, last_error from public.notification_outbox where id = $1`,
        [id],
      )
      return { st1, after1, st2, after2 }
    })
    expect(r.st1).toBe('pending')
    expect(r.after1).toEqual({ delivered_chat_ids: [1001], sent_count: 1, attempts: 0 })
    expect(r.st2).toBe('sent')
    expect(r.after2).toEqual({ status: 'sent', delivered_chat_ids: [1001, 1002], sent_count: 2, last_error: null })
  })

  it('p_final → darhol failed (1-urinishda ham), xato matni saqlanadi', async () => {
    const r = await scenario(async (tx, mk) => {
      const id = await mk()
      await asSvc(tx, () => tx.query(`select public.svc_claim_notifications(20)`))
      const st = await asSvc(tx, () =>
        scalar(tx, `select public.svc_complete_notification($1, false, '{}'::bigint[], 'telegram 401 Unauthorized', null, true)`, [id]),
      )
      return { st, row: await get(tx, id) }
    })
    expect(r.st).toBe('failed')
    expect(r.row).toMatchObject({ status: 'failed', attempts: 1, last_error: 'telegram 401 Unauthorized' })
  })

  it('wake_dispatch_if_due: navbat bo`sh — HTTP yo`q; vaqti kelgan qator — bitta HTTP', async () => {
    const r = await scenario(async (tx, mk) => {
      const q = `select count(*)::int from net.http_request_queue where id > $1`
      const before = await scalar<number>(tx, `select coalesce(max(id), 0)::int from net.http_request_queue`)
      await mk({ next_attempt_at: '2999-01-01T00:00:00Z' })
      await tx.query(`select private.wake_dispatch_if_due()`)
      const none = await scalar<number>(tx, q, [before])
      await mk()
      await tx.query(`select private.wake_dispatch_if_due()`)
      return { none, one: await scalar<number>(tx, q, [before]) }
    })
    expect(r).toEqual({ none: 0, one: 1 })
  })
})

// ============================================================================
// svc_notification_recipients, svc_dispatch_secret
// ============================================================================
describe('qabul qiluvchilar va sir', () => {
  it('faqat faol, o`chirilmagan direktor va admin, chat bog`langan; firma faol', async () => {
    const r = await inTx(async (tx) => {
      const set = (profile: string, chat: number): Promise<unknown> =>
        tx.query(`update public.profiles set telegram_chat_id = $2 where id = $1`, [profile, chat])
      await set(A.users.direktor.profileId, 1001)
      await set(A.users.admin.profileId, 1002)
      await set(A.users.prorab.profileId, 1003)
      await set(A.users.buxgalter.profileId, 1004)
      await set(B.users.direktor.profileId, 2001)
      const inactive = await scalar<string>(
        tx,
        `insert into public.profiles (company_id, role, full_name, phone, telegram_chat_id, is_active)
         values ($1, 'admin', 'Nofaol admin', '+998977100001', 1005, false) returning id`,
        [A.id],
      )
      const deleted = await scalar<string>(
        tx,
        `insert into public.profiles (company_id, role, full_name, phone, telegram_chat_id)
         values ($1, 'direktor', 'O''chirilgan direktor', '+998977100002', 1006) returning id`,
        [A.id],
      )
      await tx.query(`update public.profiles set deleted_at = now() where id = $1`, [deleted])
      void inactive
      await tx.exec(`set local role service_role`)
      const list = await rows<{ profile_id: string; chat_id: string | number; role: string }>(
        tx,
        `select * from public.svc_notification_recipients($1) order by chat_id`,
        [A.id],
      )
      await tx.exec(`reset role`)
      await tx.query(`update public.companies set is_active = false where id = $1`, [A.id])
      await tx.exec(`set local role service_role`)
      const off = await rows(tx, `select * from public.svc_notification_recipients($1)`, [A.id])
      await tx.exec(`reset role`)
      return { list, off }
    })
    expect(r.list.map((x) => [x.profile_id, Number(x.chat_id), x.role])).toEqual([
      [A.users.direktor.profileId, 1001, 'direktor'],
      [A.users.admin.profileId, 1002, 'admin'],
    ])
    expect(r.off).toEqual([])
  })

  it('svc_dispatch_secret (service_role) = Vault siri', async () => {
    const s = await asService(db, (tx) => scalar<string>(tx, `select public.svc_dispatch_secret()`))
    expect(s).toBe(await vaultSecret())
  })
})

// ============================================================================
// RLS va grantlar
// ============================================================================
describe('RLS va grantlar', () => {
  const visible = (authUid: string): Promise<{ total: number; foreign: number }> =>
    asUser(db, authUid, (tx) =>
      one<{ total: number; foreign: number }>(
        tx,
        `select count(*)::int as total, count(*) filter (where company_id <> $1)::int as foreign
           from public.notification_outbox`,
        [A.id],
      ),
    )

  it('admin o`z firmasini o`qiydi; prorab, direktor, buxgalter — hech narsa', async () => {
    const admin = await visible(A.users.admin.authUid)
    expect(admin.total).toBeGreaterThan(0)
    expect(admin.foreign).toBe(0)
    for (const role of ['prorab', 'direktor', 'buxgalter', 'omborchi', 'haydovchi'] as const) {
      expect((await visible(A.users[role].authUid)).total).toBe(0)
    }
  })

  it('B admini A qatorlarini ko`rmaydi; super_admin hammasini ko`radi', async () => {
    const bAdmin = await asUser(db, B.users.admin.authUid, (tx) =>
      scalar<number>(tx, `select count(*)::int from public.notification_outbox where company_id = $1`, [A.id]),
    )
    expect(bAdmin).toBe(0)
    const sa = await asUser(db, A.users.super_admin.authUid, (tx) =>
      scalar<number>(tx, `select count(distinct company_id)::int from public.notification_outbox`),
    )
    expect(sa).toBeGreaterThanOrEqual(2)
  })

  it('authenticated (admin ham) yoza olmaydi: INSERT / UPDATE / DELETE — 42501', async () => {
    const r = await asUser(db, A.users.admin.authUid, async (tx) => [
      await code(tx, `insert into public.notification_outbox (company_id, kind, report_date) values ($1, 'daily_report', '2020-01-01')`, [
        A.id,
      ]),
      await code(tx, `update public.notification_outbox set status = 'sent'`),
      await code(tx, `delete from public.notification_outbox`),
    ])
    expect(r).toEqual(['42501', '42501', '42501'])
  })

  it('service_role ham to`g`ridan-to`g`ri yoza olmaydi (faqat RPC); superuser DELETE — 42501', async () => {
    const r = await asService(db, async (tx) => [
      await code(tx, `update public.notification_outbox set status = 'sent'`),
      await code(tx, `delete from public.notification_outbox`),
    ])
    expect(r).toEqual(['42501', '42501'])
    expect(await code(db, `delete from public.notification_outbox`)).toBe('42501')
  })

  it('svc_* — anon va authenticated chaqira olmaydi', async () => {
    const calls = [
      `select public.svc_dispatch_secret()`,
      `select * from public.svc_claim_notifications(1)`,
      `select * from public.svc_notification_recipients('${A.id}')`,
      `select public.svc_complete_notification(gen_random_uuid(), true, '{}'::bigint[], null)`,
    ]
    for (const sql of calls) {
      expect(await asUser(db, A.users.admin.authUid, (tx) => code(tx, sql))).toBe('42501')
      expect(await asUser(db, A.users.super_admin.authUid, (tx) => code(tx, sql))).toBe('42501')
      expect(await asAnon(db, (tx) => code(tx, sql))).toBe('42501')
    }
  })

  it('private funksiyalar — authenticated va service_role uchun execute yo`q', async () => {
    const r = await rows<{ proname: string; auth: boolean; svc: boolean }>(
      db,
      `select p.proname,
              has_function_privilege('authenticated', p.oid, 'execute') as auth,
              has_function_privilege('service_role', p.oid, 'execute') as svc
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'private'
          and p.proname in ('wake_dispatch', 'wake_dispatch_if_due', 'tg_alerts_notify', 'daily_report_stats',
                            'enqueue_daily_reports', 'tg_outbox_touch')
        order by 1`,
    )
    expect(r).toHaveLength(6)
    expect(r.filter((x) => x.auth || x.svc)).toEqual([])
  })

  it('svc_* — service_role execute bor', async () => {
    const r = await rows<{ proname: string; svc: boolean }>(
      db,
      `select p.proname, has_function_privilege('service_role', p.oid, 'execute') as svc
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public'
          and p.proname in ('svc_dispatch_secret', 'svc_claim_notifications', 'svc_notification_recipients',
                            'svc_complete_notification')`,
    )
    expect(r).toHaveLength(4)
    expect(r.every((x) => x.svc)).toBe(true)
  })
})

// ============================================================================
// pg_cron
// ============================================================================
describe('pg_net sxemasi', () => {
  it('net jadvallari (so`rovlar navbati — sarlavhada sir) anon / authenticated ga yopiq', async () => {
    const r = await rows(
      db,
      `select c.relname, r.role
         from pg_class c join pg_namespace n on n.oid = c.relnamespace
         cross join unnest(array['anon', 'authenticated']) as r(role)
        where n.nspname = 'net' and c.relkind in ('r', 'v', 'S')
          and (case when c.relkind = 'S' then has_sequence_privilege(r.role, c.oid, 'usage')
                    else has_table_privilege(r.role, c.oid, 'select') end)`,
    )
    expect(r).toEqual([])
    expect(await asUser(db, A.users.admin.authUid, (tx) => code(tx, `select * from net.http_request_queue`))).toBe('42501')
  })
})

describe('pg_cron', () => {
  it('terron-dispatch (har daqiqa) va terron-daily-report (15:00 UTC = 20:00 Toshkent)', async () => {
    const r = await rows(
      db,
      `select jobname, schedule, command from cron.job
        where jobname in ('terron-dispatch', 'terron-daily-report') order by jobname`,
    )
    expect(r).toEqual([
      { jobname: 'terron-daily-report', schedule: '0 15 * * *', command: 'select private.enqueue_daily_reports()' },
      { jobname: 'terron-dispatch', schedule: '* * * * *', command: 'select private.wake_dispatch_if_due()' },
    ])
  })

  it('Batch 5 ishi saqlangan', async () => {
    expect(await scalar<number>(db, `select count(*)::int from cron.job where jobname = 'terron-evaluate-purchases'`)).toBe(1)
  })
})
