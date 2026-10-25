// Batch 11 — 20261107000001_handoff.sql: bug_reports (RLS, cheklov, holat — faqat admin,
// created_by serverdan, audit, soft delete), notification_outbox kind 'bug_report' va
// qabul qiluvchilar (firma admin(lar)i + barcha super_admin), skrinshot yo'li va
// storage siyosatlari. Shartnoma: docs/handoff-design.md (1-bo'lim, payload).
import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { asAnon, asService, asUser, createDb, one, rows, scalar, type Db, type Queryable, type Row, type Tx } from './_harness'
import { buildTwoCompanies, type CompanyFixture } from './_fixtures'

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

// ----------------------------------------------------------------------------
// Yordamchilar
// ----------------------------------------------------------------------------
type Role = keyof CompanyFixture['users']

/** `OK:<qatorlar>` yoki `<errcode>:<hint>` (savepoint bilan — tx davom etadi). */
async function res(tx: Queryable, sql: string, params: unknown[] = []): Promise<string> {
  await tx.exec('savepoint b11_try')
  try {
    const r = await tx.query(sql, params)
    await tx.exec('release savepoint b11_try')
    return `OK:${r.affectedRows || r.rows.length}`
  } catch (e) {
    await tx.exec('rollback to savepoint b11_try')
    const err = e as { code?: string; hint?: string }
    return `${err.code ?? '?'}:${err.hint ?? ''}`
  }
}

/** Shu tranzaksiya ichida tizim (postgres) sifatida — RLS'siz. */
async function sys<T>(tx: Tx, fn: () => Promise<T>): Promise<T> {
  await tx.exec('reset role')
  try {
    return await fn()
  } finally {
    await tx.exec('set local role authenticated')
  }
}

/** Triggerlarsiz (vaqt ustunlarini orqaga surish uchun). */
async function raw(tx: Tx, sql: string, params: unknown[] = []): Promise<void> {
  await sys(tx, async () => {
    await tx.exec('set local session_replication_role = replica')
    await tx.query(sql, params)
    await tx.exec('set local session_replication_role = origin')
  })
}

/** sys() ichida (rol allaqachon postgres): triggerlarsiz yozish. */
async function rawIn(tx: Tx, sql: string, params: unknown[] = []): Promise<void> {
  await tx.exec('set local session_replication_role = replica')
  await tx.query(sql, params)
  await tx.exec('set local session_replication_role = origin')
}

/** Shu tranzaksiyada boshqa foydalanuvchiga o'tish (auth.uid() = claim.sub). */
async function switchTo(tx: Tx, role: Role, co: CompanyFixture = A): Promise<void> {
  await tx.query(`select set_config('request.jwt.claim.sub', $1, true)`, [co.users[role].authUid])
}

const as = <T>(role: Role, fn: (tx: Tx) => Promise<T>, co: CompanyFixture = A, device: 'veb' | 'mobil' = 'mobil'): Promise<T> =>
  asUser(db, co.users[role].authUid, fn, { device })

const P = (role: Role, co: CompanyFixture = A): string => co.users[role].profileId

/** Xabar qo'shadi (joriy foydalanuvchi nomidan), id qaytaradi. */
async function report(tx: Queryable, co: CompanyFixture, extra: Row = {}): Promise<string> {
  const vals: Row = { company_id: co.id, message: 'Saqlash tugmasi ishlamadi', screen: '/tg/movement', ...extra }
  const cols = Object.keys(vals)
  return scalar<string>(
    tx,
    `insert into public.bug_reports (${cols.join(', ')}) values (${cols.map((_, i) => `$${i + 1}`).join(', ')}) returning id`,
    Object.values(vals),
  )
}

const bugPath = (co: string): string => `${co}/bug/2026/11/${randomUUID()}.jpg`
const opsPath = (co: string): string => `${co}/2026/11/${randomUUID()}.jpg`

/** Joriy foydalanuvchi nomidan storage'ga rasm yuklash (owner_id = auth.uid()). */
const upload = (tx: Queryable, name: string): Promise<string> =>
  res(tx, `insert into storage.objects (bucket_id, name, owner, owner_id) values ('photos', $1, auth.uid(), auth.uid()::text)`, [name])

const visiblePhotos = (tx: Queryable, names: string[]): Promise<string[]> =>
  rows<{ name: string }>(tx, `select name from storage.objects where name = any($1) order by name`, [names]).then((r) =>
    r.map((x) => x.name),
  )

// ============================================================================
// Sxema
// ============================================================================
describe('sxema', () => {
  it('ustunlar, RLS enable + force, kompozit FK, standart triggerlar', async () => {
    const cols = await rows<{ column_name: string; data_type: string; is_nullable: string }>(
      db,
      `select column_name, data_type, is_nullable from information_schema.columns
        where table_schema = 'public' and table_name = 'bug_reports' order by ordinal_position`,
    )
    expect(cols.map((c) => c.column_name)).toEqual([
      'id', 'company_id', 'message', 'screen', 'client', 'app_version', 'photo_path', 'status',
      'created_by', 'created_at', 'updated_at', 'deleted_at',
    ])
    expect(cols.filter((c) => c.is_nullable === 'NO').map((c) => c.column_name)).toEqual([
      'id', 'company_id', 'message', 'status', 'created_at', 'updated_at',
    ])
    const rls = await one(db, `select relrowsecurity, relforcerowsecurity from pg_class where oid = 'public.bug_reports'::regclass`)
    expect(rls).toEqual({ relrowsecurity: true, relforcerowsecurity: true })
    const fk = await scalar<string>(
      db,
      `select pg_get_constraintdef(oid) from pg_constraint where conname = 'bug_reports_created_by_fkey'`,
    )
    expect(fk).toBe('FOREIGN KEY (company_id, created_by) REFERENCES profiles(company_id, id)')
    const tg = await rows<{ tgname: string }>(
      db,
      `select tgname from pg_trigger where tgrelid = 'public.bug_reports'::regclass and not tgisinternal order by 1`,
    )
    expect(tg.map((x) => x.tgname).sort()).toEqual([
      'a_before_insert', 'a_before_update', 'a_block_delete', 'a_block_truncate',
      'b_bug_reports_guard', 'z_audit', 'zz_notify',
    ])
  })

  it('grantlar: authenticated — select, insert (faqat ruxsat etilgan ustunlar), update (status, deleted_at); anon — hech narsa', async () => {
    const priv = async (role: string, p: string, col?: string): Promise<boolean> =>
      col
        ? scalar<boolean>(db, `select has_column_privilege($1, 'public.bug_reports', $3, $2)`, [role, p, col])
        : scalar<boolean>(db, `select has_table_privilege($1, 'public.bug_reports', $2)`, [role, p])
    expect(await priv('authenticated', 'SELECT')).toBe(true)
    expect(await priv('authenticated', 'DELETE')).toBe(false)
    expect(await priv('authenticated', 'TRUNCATE')).toBe(false)
    for (const c of ['id', 'company_id', 'message', 'screen', 'client', 'app_version', 'photo_path']) {
      expect(await priv('authenticated', 'INSERT', c), c).toBe(true)
    }
    for (const c of ['created_by', 'status', 'deleted_at', 'created_at']) {
      expect(await priv('authenticated', 'INSERT', c), c).toBe(false)
    }
    expect(await priv('authenticated', 'UPDATE', 'status')).toBe(true)
    expect(await priv('authenticated', 'UPDATE', 'deleted_at')).toBe(true)
    for (const c of ['message', 'screen', 'photo_path', 'created_by', 'company_id']) {
      expect(await priv('authenticated', 'UPDATE', c), c).toBe(false)
    }
    for (const p of ['SELECT', 'INSERT', 'UPDATE', 'DELETE']) {
      expect(await priv('anon', p), p).toBe(false)
    }
    for (const f of ['private.tg_bug_reports_guard()', 'private.tg_bug_reports_notify()']) {
      expect(await scalar<boolean>(db, `select has_function_privilege('authenticated', $1, 'execute')`, [f])).toBe(false)
    }
    expect(await scalar<boolean>(db, `select has_function_privilege('authenticated', 'public.svc_outbox_recipients(uuid)', 'execute')`)).toBe(false)
    expect(await scalar<boolean>(db, `select has_function_privilege('service_role', 'public.svc_outbox_recipients(uuid)', 'execute')`)).toBe(true)
  })

  it('storage.objects da hali ham faqat photos_insert va photos_select', async () => {
    const r = await rows(db, `select policyname from pg_policies where schemaname = 'storage' and tablename = 'objects' order by 1`)
    expect(r).toEqual([{ policyname: 'photos_insert' }, { policyname: 'photos_select' }])
  })
})

// ============================================================================
// RLS va server qiymatlari
// ============================================================================
describe('RLS: qo`shish va o`qish', () => {
  it('har faol rol o`z firmasiga qo`shadi; created_by / status / company_id — serverdan', async () => {
    for (const role of ['prorab', 'omborchi', 'haydovchi', 'tekshiruvchi', 'direktor', 'buxgalter', 'taminotchi', 'admin', 'super_admin'] as Role[]) {
      const r = await as(role, async (tx) => {
        const id = await report(tx, A)
        return one(tx, `select created_by, status, company_id from public.bug_reports where id = $1`, [id])
      })
      expect(r, role).toEqual({ created_by: P(role), status: 'yangi', company_id: A.id })
    }
    // company_id berilmasa — o'z firmasi
    const noCo = await as('prorab', async (tx) => {
      const id = await scalar<string>(tx, `insert into public.bug_reports (message) values ('Firmasiz') returning id`)
      return scalar<string>(tx, `select company_id from public.bug_reports where id = $1`, [id])
    })
    expect(noCo).toBe(A.id)
  })

  it('created_by / status / deleted_at ni klient yubora olmaydi (42501); boshqa firmaga — RLS 42501; anon — 42501', async () => {
    const r = await as('prorab', async (tx) => ({
      by: await res(tx, `insert into public.bug_reports (company_id, message, created_by) values ($1, 'x', $2)`, [A.id, P('admin')]),
      st: await res(tx, `insert into public.bug_reports (company_id, message, status) values ($1, 'x', 'hal_qilindi')`, [A.id]),
      del: await res(tx, `insert into public.bug_reports (company_id, message, deleted_at) values ($1, 'x', now())`, [A.id]),
      other: await res(tx, `insert into public.bug_reports (company_id, message) values ($1, 'x')`, [B.id]),
    }))
    expect(r).toEqual({ by: '42501:', st: '42501:', del: '42501:', other: '42501:' })
    // super_admin ham faqat o'z firmasiga
    expect(await as('super_admin', (tx) => res(tx, `insert into public.bug_reports (company_id, message) values ($1, 'x')`, [B.id]))).toBe(
      '42501:',
    )
    expect(await asAnon(db, (tx) => res(tx, `insert into public.bug_reports (company_id, message) values ($1, 'x')`, [A.id]))).toBe(
      '42501:',
    )
  })

  it('nofaol profil xabar yoza olmaydi', async () => {
    const r = await as('prorab', async (tx) => {
      await sys(tx, () => tx.query(`update public.profiles set is_active = false where id = $1`, [P('prorab')]))
      return res(tx, `insert into public.bug_reports (company_id, message) values ($1, 'x')`, [A.id])
    })
    expect(r).toBe('42501:')
  })

  it('o`qish: o`zi — o`zinikini; boshqa xodim — yo`q; admin — firmaning hammasi; super_admin — hamma firma; boshqa firma — hech narsa', async () => {
    const r = await as('prorab', async (tx) => {
      const mine = await report(tx, A)
      await switchTo(tx, 'haydovchi')
      const hay = await report(tx, A)
      await switchTo(tx, 'admin', B)
      const bRep = await report(tx, B)
      const ids = [mine, hay, bRep]
      const seen = async (role: Role, co: CompanyFixture = A): Promise<string[]> => {
        await switchTo(tx, role, co)
        const x = await rows<{ id: string }>(tx, `select id from public.bug_reports where id = any($1)`, [ids])
        return x.map((y) => (y.id === mine ? 'mine' : y.id === hay ? 'hay' : 'B')).sort()
      }
      return {
        prorab: await seen('prorab'),
        haydovchi: await seen('haydovchi'),
        omborchi: await seen('omborchi'),
        direktor: await seen('direktor'),
        buxgalter: await seen('buxgalter'),
        adminA: await seen('admin'),
        adminB: await seen('admin', B),
        prorabB: await seen('prorab', B),
        superA: await seen('super_admin'),
      }
    })
    expect(r).toEqual({
      prorab: ['mine'],
      haydovchi: ['hay'],
      omborchi: [],
      direktor: [],
      buxgalter: [],
      adminA: ['hay', 'mine'],
      adminB: ['B'],
      prorabB: [],
      superA: ['B', 'hay', 'mine'],
    })
  })

  it('matn: btrim, bo`sh yoki > 2000 — bug_report_invalid; screen/client/app_version kesiladi', async () => {
    const r = await as('prorab', async (tx) => {
      const id = await report(tx, A, {
        message: '  Rasm yuklanmadi  ',
        screen: `/tg/${'x'.repeat(300)}`,
        client: 'c'.repeat(700),
        app_version: 'v'.repeat(80),
      })
      const row = await one<{ message: string; screen: string; client: string; app_version: string }>(
        tx,
        `select message, screen, client, app_version from public.bug_reports where id = $1`,
        [id],
      )
      return {
        message: row.message,
        lens: [row.screen.length, row.client.length, row.app_version.length],
        blank: await res(tx, `insert into public.bug_reports (company_id, message) values ($1, '   ')`, [A.id]),
        long: await res(tx, `insert into public.bug_reports (company_id, message) values ($1, $2)`, [A.id, 'a'.repeat(2001)]),
        max: await res(tx, `insert into public.bug_reports (company_id, message) values ($1, $2)`, [A.id, 'a'.repeat(2000)]),
        emptyScreen: await scalar(tx, `select screen from public.bug_reports where id = $1`, [await report(tx, A, { screen: '  ' })]),
      }
    })
    expect(r).toEqual({
      message: 'Rasm yuklanmadi',
      lens: [200, 500, 50],
      blank: '23514:bug_report_invalid',
      long: '23514:bug_report_invalid',
      max: 'OK:1',
      emptyScreen: null,
    })
  })

  it('audit: INSERT yozuvi (aktyor, qurilma); DELETE — authenticated va service_role uchun grant yo`q (42501)', async () => {
    const r = await as('prorab', async (tx) => {
      const id = await report(tx, A)
      const audit = await sys(tx, () =>
        one(tx, `select action, actor_profile_id, device, company_id from public.audit_log where table_name = 'bug_reports' and record_id = $1`, [id]),
      )
      const del = await res(tx, `delete from public.bug_reports where id = $1`, [id])
      return { audit, del, id }
    })
    expect(r.audit).toEqual({ action: 'INSERT', actor_profile_id: P('prorab'), device: 'mobil', company_id: A.id })
    expect(r.del).toBe('42501:')
    const svc = await asService(db, async (tx) => {
      const id = await scalar<string>(tx, `insert into public.bug_reports (company_id, message) values ($1, 'svc') returning id`, [A.id])
      return res(tx, `delete from public.bug_reports where id = $1`, [id])
    })
    expect(svc).toBe('42501:')
  })
})

// ============================================================================
// Cheklov: 10 daqiqada ≤ 5 ta
// ============================================================================
describe('cheklov (bug_report_rate_limited)', () => {
  it('6-xabar — 23514; boshqa foydalanuvchi — ruxsat; 10 daqiqadan keyin — yana ruxsat', async () => {
    const r = await as('prorab', async (tx) => {
      const ok: string[] = []
      for (let i = 0; i < 5; i++) {
        ok.push(await res(tx, `insert into public.bug_reports (company_id, message) values ($1, $2)`, [A.id, `xabar ${i}`]))
      }
      const sixth = await res(tx, `insert into public.bug_reports (company_id, message) values ($1, 'oltinchi')`, [A.id])
      await switchTo(tx, 'omborchi')
      const other = await res(tx, `insert into public.bug_reports (company_id, message) values ($1, 'boshqa odam')`, [A.id])
      await switchTo(tx, 'prorab')
      // o'chirilganlari ham hisoblanadi (admin o'chirsa ham limit ochilmaydi)
      await sys(tx, () => tx.query(`update public.bug_reports set deleted_at = now() where created_by = $1`, [P('prorab')]))
      const afterDelete = await res(tx, `insert into public.bug_reports (company_id, message) values ($1, 'yana')`, [A.id])
      // 11 daqiqa oldinga surish
      await raw(tx, `update public.bug_reports set created_at = created_at - interval '11 minutes' where created_by = $1`, [P('prorab')])
      const later = await res(tx, `insert into public.bug_reports (company_id, message) values ($1, 'keyinroq')`, [A.id])
      return { ok, sixth, other, afterDelete, later }
    })
    expect(r).toEqual({
      ok: ['OK:1', 'OK:1', 'OK:1', 'OK:1', 'OK:1'],
      sixth: '23514:bug_report_rate_limited',
      other: 'OK:1',
      afterDelete: '23514:bug_report_rate_limited',
      later: 'OK:1',
    })
  })

  it('5-xabarni shu id bilan qayta yuborish — cheklov emas, 23505 (pkey): klient "saqlangan" deb biladi', async () => {
    const r = await as('prorab', async (tx) => {
      const ids = [randomUUID(), randomUUID(), randomUUID(), randomUUID(), randomUUID()]
      for (const id of ids) {
        await tx.query(`insert into public.bug_reports (id, company_id, message) values ($1, $2, 'x')`, [id, A.id])
      }
      await tx.exec('savepoint pk')
      let constraint = ''
      let code = ''
      try {
        await tx.query(`insert into public.bug_reports (id, company_id, message) values ($1, $2, 'x')`, [ids[4], A.id])
      } catch (e) {
        const err = e as { code?: string; constraint?: string }
        code = err.code ?? ''
        constraint = err.constraint ?? ''
      }
      await tx.exec('rollback to savepoint pk')
      const fresh = await res(tx, `insert into public.bug_reports (id, company_id, message) values ($1, $2, 'x')`, [randomUUID(), A.id])
      return { code, constraint, fresh }
    })
    expect(r).toEqual({ code: '23505', constraint: 'bug_reports_pkey', fresh: '23514:bug_report_rate_limited' })
  })

  it('service_role uchun cheklov yo`q', async () => {
    const r = await asService(db, async (tx) => {
      const out: string[] = []
      for (let i = 0; i < 7; i++) {
        out.push(await res(tx, `insert into public.bug_reports (company_id, message, created_by) values ($1, $2, $3)`, [A.id, `svc ${i}`, P('prorab')]))
      }
      return out
    })
    expect(r.every((x) => x === 'OK:1')).toBe(true)
  })
})

// ============================================================================
// Holat — faqat admin
// ============================================================================
describe('holatni o`zgartirish', () => {
  it('muallif va boshqa rollar — 0 qator; admin — ruxsat; boshqa firma admini — 0; super_admin — ruxsat', async () => {
    const r = await as('prorab', async (tx) => {
      const id = await report(tx, A)
      const st = (): Promise<string> => scalar<string>(tx, `select status from public.bug_reports where id = $1`, [id]).then(String)
      const upd = (s: string): Promise<string> => res(tx, `update public.bug_reports set status = $2 where id = $1`, [id, s])
      const own = await upd('hal_qilindi')
      const ownMsg = await res(tx, `update public.bug_reports set message = 'o''zgardi' where id = $1`, [id])
      await switchTo(tx, 'direktor')
      const dir = await upd('korildi')
      await switchTo(tx, 'admin', B)
      const adminB = await upd('korildi')
      await switchTo(tx, 'admin')
      const admin = await upd('korildi')
      const afterAdmin = await sys(tx, st)
      const bad = await upd('yopildi')
      const adminMsg = await res(tx, `update public.bug_reports set message = 'x' where id = $1`, [id])
      await switchTo(tx, 'super_admin', B)
      const superB = await upd('hal_qilindi')
      const final = await sys(tx, st)
      const audit = await sys(tx, () =>
        rows(
          tx,
          `select action, changed_fields, actor_profile_id from public.audit_log
            where table_name = 'bug_reports' and record_id = $1 order by id`,
          [id],
        ),
      )
      return { own, ownMsg, dir, adminB, admin, afterAdmin, bad, adminMsg, superB, final, audit }
    })
    expect(r).toMatchObject({
      own: 'OK:0',
      ownMsg: '42501:',
      dir: 'OK:0',
      adminB: 'OK:0',
      admin: 'OK:1',
      afterAdmin: 'korildi',
      bad: '23514:',
      adminMsg: '42501:',
      superB: 'OK:1',
      final: 'hal_qilindi',
    })
    expect(r.audit).toEqual([
      { action: 'INSERT', changed_fields: null, actor_profile_id: P('prorab') },
      { action: 'UPDATE', changed_fields: ['status'], actor_profile_id: P('admin') },
      { action: 'UPDATE', changed_fields: ['status'], actor_profile_id: P('super_admin', B) },
    ])
  })

  it('soft delete — admin; muallif o`chirilganini ko`rmaydi, admin ko`radi; tiklash — admin', async () => {
    const r = await as('prorab', async (tx) => {
      const id = await report(tx, A)
      const own = await res(tx, `update public.bug_reports set deleted_at = now() where id = $1`, [id])
      await switchTo(tx, 'admin')
      const del = await res(tx, `update public.bug_reports set deleted_at = now() where id = $1`, [id])
      const adminSees = await scalar<number>(tx, `select count(*)::int from public.bug_reports where id = $1`, [id])
      await switchTo(tx, 'prorab')
      const ownSees = await scalar<number>(tx, `select count(*)::int from public.bug_reports where id = $1`, [id])
      await switchTo(tx, 'admin')
      const restore = await res(tx, `update public.bug_reports set deleted_at = null where id = $1`, [id])
      const action = await sys(tx, () =>
        scalar<string>(tx, `select string_agg(action, ',' order by id) from public.audit_log where record_id = $1`, [id]),
      )
      return { own, del, adminSees, ownSees, restore, action }
    })
    expect(r).toEqual({ own: 'OK:0', del: 'OK:1', adminSees: 1, ownSees: 0, restore: 'OK:1', action: 'INSERT,SOFT_DELETE,RESTORE' })
  })
})

// ============================================================================
// Bildirishnoma
// ============================================================================
describe('notification_outbox: bug_report', () => {
  it('payload (xabar 500 belgigacha kesiladi) va qabul qiluvchilar: firma admini + barcha super_admin', async () => {
    const long = `${'Ж'.repeat(499)}ab`
    const r = await as('prorab', async (tx) => {
      const id = await report(tx, A, { message: long, client: 'tg 8.0 · android', app_version: '0.11.0' })
      const short = await report(tx, A, { message: 'Qisqa', screen: null })
      return sys(tx, async () => {
        await tx.query(`update public.profiles set telegram_chat_id = 5001 where id = $1`, [P('admin')])
        await tx.query(`update public.profiles set telegram_chat_id = 5002 where id = $1`, [P('super_admin')])
        await tx.query(`update public.profiles set telegram_chat_id = 5003 where id = $1`, [P('super_admin', B)])
        await tx.query(`update public.profiles set telegram_chat_id = 5004 where id = $1`, [P('admin', B)])
        await tx.query(`update public.profiles set telegram_chat_id = 5005 where id = $1`, [P('direktor')])
        await tx.query(`update public.profiles set telegram_chat_id = 5006 where id = $1`, [P('prorab')])
        const ob = await rows<{ id: string; kind: string; bug_report_id: string; alert_id: string | null; payload: Row; status: string }>(
          tx,
          `select id, kind, bug_report_id, alert_id, payload, status from public.notification_outbox
            where kind = 'bug_report' and bug_report_id = any($1) order by char_length(payload ->> 'message') desc`,
          [[id, short]],
        )
        const rec = await rows(tx, `select chat_id::int, role from public.svc_outbox_recipients($1) order by chat_id`, [ob[0]!.id])
        // super_admin B nofaol bo'lsa — yo'q
        await rawIn(tx, `update public.profiles set is_active = false where id = $1`, [P('super_admin', B)])
        const rec2 = await rows(tx, `select chat_id::int from public.svc_outbox_recipients($1) order by chat_id`, [ob[0]!.id])
        await rawIn(tx, `update public.profiles set is_active = true where id = $1`, [P('super_admin', B)])
        // B firma nofaol bo'lsa — uning super_admini ham yo'q
        await rawIn(tx, `update public.companies set is_active = false where id = $1`, [B.id])
        const rec3 = await rows(tx, `select chat_id::int from public.svc_outbox_recipients($1) order by chat_id`, [ob[0]!.id])
        await rawIn(tx, `update public.companies set is_active = true where id = $1`, [B.id])
        // Regressiya: oddiy alert — direktor va admin (shu firma), super_admin yo'q
        const alertOb = await scalar<string>(
          tx,
          `insert into public.notification_outbox (company_id, kind, alert_id, escalation, payload)
           values ($1, 'alert', $2, 9, '{}') returning id`,
          [A.id, A.ids.alert1],
        )
        const recAlert = await rows(tx, `select chat_id::int, role from public.svc_outbox_recipients($1) order by chat_id`, [alertOb])
        return { id, short, ob, rec, rec2, rec3, recAlert }
      })
    })
    expect(r.ob).toHaveLength(2)
    const [main, small] = r.ob
    expect(main).toMatchObject({ kind: 'bug_report', bug_report_id: r.id, alert_id: null, status: 'pending' })
    expect(Object.keys(main!.payload).sort()).toEqual(
      [
        'app_version', 'bug_report_id', 'client', 'company_id', 'company_name', 'created_at', 'has_photo', 'message',
        'message_truncated', 'reporter_id', 'reporter_name', 'reporter_role', 'screen',
      ].sort(),
    )
    expect(main!.payload).toMatchObject({
      bug_report_id: r.id,
      company_id: A.id,
      company_name: 'A',
      reporter_id: P('prorab'),
      reporter_name: 'A prorab',
      reporter_role: 'prorab',
      screen: '/tg/movement',
      message: long.slice(0, 500),
      message_truncated: true,
      client: 'tg 8.0 · android',
      app_version: '0.11.0',
      has_photo: false,
    })
    expect((main!.payload.message as string).length).toBe(500)
    expect(small!.payload).toMatchObject({ message: 'Qisqa', message_truncated: false, screen: null, client: null, app_version: null })
    expect(r.rec).toEqual([
      { chat_id: 5001, role: 'admin' },
      { chat_id: 5002, role: 'super_admin' },
      { chat_id: 5003, role: 'super_admin' },
    ])
    expect(r.rec2).toEqual([{ chat_id: 5001 }, { chat_id: 5002 }])
    expect(r.rec3).toEqual([{ chat_id: 5001 }, { chat_id: 5002 }])
    expect(r.recAlert).toEqual([
      { chat_id: 5001, role: 'admin' },
      { chat_id: 5005, role: 'direktor' },
    ])
  })

  it('outbox ni authenticated o`qiy olmaydi (admin — o`z firmasi); kind/ref check — bug_report_id siz bug_report yo`q', async () => {
    const r = await as('prorab', async (tx) => {
      const id = await report(tx, A)
      const prorab = await scalar<number>(tx, `select count(*)::int from public.notification_outbox where bug_report_id = $1`, [id])
      await switchTo(tx, 'admin')
      const admin = await scalar<number>(tx, `select count(*)::int from public.notification_outbox where bug_report_id = $1`, [id])
      await switchTo(tx, 'admin', B)
      const adminB = await scalar<number>(tx, `select count(*)::int from public.notification_outbox where bug_report_id = $1`, [id])
      const bad = await sys(tx, () =>
        res(tx, `insert into public.notification_outbox (company_id, kind, payload) values ($1, 'bug_report', '{}')`, [A.id]),
      )
      const bad2 = await sys(tx, () =>
        res(tx, `insert into public.notification_outbox (company_id, kind, report_date, bug_report_id, payload)
                 values ($1, 'daily_report', '2026-11-07', $2, '{}')`, [A.id, id]),
      )
      return { prorab, admin, adminB, bad, bad2 }
    })
    expect(r).toEqual({ prorab: 0, admin: 1, adminB: 0, bad: '23514:', bad2: '23514:' })
  })
})

// ============================================================================
// Skrinshot (photo_path) va storage
// ============================================================================
describe('rasm yo`li', () => {
  it('o`zi yuklagan bug/ rasm — ruxsat; format, boshqa firma, begona, eski, takroriy — rad', async () => {
    const r = await as('prorab', async (tx) => {
      const mine = bugPath(A.id)
      const up = await upload(tx, mine)
      const ok = await res(tx, `insert into public.bug_reports (company_id, message, photo_path) values ($1, 'rasm bilan', $2)`, [A.id, mine])
      const reused = await res(tx, `insert into public.bug_reports (company_id, message, photo_path) values ($1, 'yana', $2)`, [A.id, mine])
      // operatsiya rasmi yo'li (bug/ siz) — format xatosi
      const ops = opsPath(A.id)
      await upload(tx, ops)
      const fmt = await res(tx, `insert into public.bug_reports (company_id, message, photo_path) values ($1, 'x', $2)`, [A.id, ops])
      // boshqa firma papkasi
      const other = bugPath(B.id)
      const upOther = await upload(tx, other)
      const co = await res(tx, `insert into public.bug_reports (company_id, message, photo_path) values ($1, 'x', $2)`, [A.id, other])
      // storage'da yo'q
      const missing = await res(tx, `insert into public.bug_reports (company_id, message, photo_path) values ($1, 'x', $2)`, [A.id, bugPath(A.id)])
      // boshqa odam yuklagan (admin ham begona rasmni biriktira olmaydi)
      await switchTo(tx, 'omborchi')
      const foreign = bugPath(A.id)
      await upload(tx, foreign)
      await switchTo(tx, 'admin')
      const notOwned = await res(tx, `insert into public.bug_reports (company_id, message, photo_path) values ($1, 'x', $2)`, [A.id, foreign])
      // 24 soatdan eski
      await switchTo(tx, 'prorab')
      const old = bugPath(A.id)
      await upload(tx, old)
      await raw(tx, `update storage.objects set created_at = now() - interval '25 hours' where name = $1`, [old])
      const tooOld = await res(tx, `insert into public.bug_reports (company_id, message, photo_path) values ($1, 'x', $2)`, [A.id, old])
      // bo'sh satr → null
      const blankId = await report(tx, A, { photo_path: '  ' })
      const blank = await scalar(tx, `select photo_path from public.bug_reports where id = $1`, [blankId])
      // has_photo payloadda
      const hasPhoto = await sys(tx, () =>
        scalar<boolean>(
          tx,
          `select (payload ->> 'has_photo')::boolean from public.notification_outbox o
             join public.bug_reports b on b.id = o.bug_report_id where b.photo_path = $1`,
          [mine],
        ),
      )
      return { up, ok, reused, fmt, upOther, co, missing, notOwned, tooOld, blank, hasPhoto }
    })
    expect(r).toEqual({
      up: 'OK:1',
      ok: 'OK:1',
      reused: '23505:ops_photo_reused',
      fmt: '23514:ops_photo_path_format',
      upOther: '42501:', // storage: boshqa firma papkasiga yuklab bo'lmaydi
      co: '23514:ops_photo_path_company',
      missing: '42501:ops_photo_not_owned',
      notOwned: '42501:ops_photo_not_owned',
      tooOld: '42501:ops_photo_not_owned',
      blank: null,
      hasPhoto: true,
    })
  })

  it('o`chirilgan xabarning rasmi bo`shaydi; tiklashda takroriy — ops_photo_reused', async () => {
    const r = await as('prorab', async (tx) => {
      const p = bugPath(A.id)
      await upload(tx, p)
      const first = await report(tx, A, { photo_path: p })
      await switchTo(tx, 'admin')
      await tx.query(`update public.bug_reports set deleted_at = now() where id = $1`, [first])
      await switchTo(tx, 'prorab')
      const second = await res(tx, `insert into public.bug_reports (company_id, message, photo_path) values ($1, 'qayta', $2)`, [A.id, p])
      await switchTo(tx, 'admin')
      const restore = await res(tx, `update public.bug_reports set deleted_at = null where id = $1`, [first])
      return { second, restore }
    })
    expect(r).toEqual({ second: 'OK:1', restore: '23505:ops_photo_reused' })
  })

  it('storage: istalgan faol rol bug/ ga yuklaydi, operatsiya papkasiga — faqat avvalgi rollar', async () => {
    const out: Record<string, [string, string]> = {}
    for (const role of ['direktor', 'buxgalter', 'tekshiruvchi', 'prorab', 'haydovchi'] as Role[]) {
      out[role] = await as(role, async (tx) => [await upload(tx, bugPath(A.id)), await upload(tx, opsPath(A.id))])
    }
    expect(out).toEqual({
      direktor: ['OK:1', '42501:'],
      buxgalter: ['OK:1', '42501:'],
      tekshiruvchi: ['OK:1', '42501:'],
      prorab: ['OK:1', 'OK:1'],
      haydovchi: ['OK:1', 'OK:1'],
    })
    // noto'g'ri format (bug ichida qo'shimcha papka) va anon
    expect(await as('direktor', (tx) => upload(tx, `${A.id}/bug/x/2026/11/${randomUUID()}.jpg`))).toBe('42501:')
    expect(await asAnon(db, (tx) => upload(tx, bugPath(A.id)))).toBe('42501:')
  })

  it('storage: bug/ rasmini yuklagan odam, firma admini va super_admin ko`radi; firma bo`yicha boshqa rollar — yo`q', async () => {
    const r = await as('prorab', async (tx) => {
      const shot = bugPath(A.id)
      const ops = opsPath(A.id)
      await upload(tx, shot)
      await upload(tx, ops)
      const names = [shot, ops]
      const view = async (role: Role, co: CompanyFixture = A): Promise<string[]> => {
        await switchTo(tx, role, co)
        return (await visiblePhotos(tx, names)).map((n) => (n === shot ? 'shot' : 'ops')).sort()
      }
      return {
        prorab: await view('prorab'),
        omborchi: await view('omborchi'),
        direktor: await view('direktor'),
        buxgalter: await view('buxgalter'),
        admin: await view('admin'),
        adminB: await view('admin', B),
        superB: await view('super_admin', B),
      }
    })
    expect(r).toEqual({
      prorab: ['ops', 'shot'].sort(),
      omborchi: [],
      direktor: ['ops'],
      buxgalter: ['ops'],
      admin: ['ops', 'shot'].sort(),
      adminB: [],
      superB: ['ops', 'shot'].sort(),
    })
  })
})
