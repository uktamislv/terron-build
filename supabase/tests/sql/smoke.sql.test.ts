import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  applyMigrations,
  applySeed,
  asAnon,
  asService,
  asUser,
  createDb,
  listMigrations,
  one,
  scalar,
  SEED_FILE,
  tryQuery,
  type Db,
} from './_harness'
import { existsSync } from 'node:fs'

// 1) Harness o'zi: Supabase muhiti taqlidi to'g'ri ishlaydimi (migratsiyalarsiz).
describe('harness: Supabase muhiti', () => {
  let db: Db

  beforeAll(async () => {
    db = await createDb({ migrations: false })
    await db.exec(`
      create table public.harness_probe (id int primary key, owner uuid);
      alter table public.harness_probe enable row level security;
      alter table public.harness_probe force row level security;
      create policy probe_select on public.harness_probe for select to authenticated
        using (owner = (select auth.uid()));
      insert into public.harness_probe values
        (1, '00000000-0000-0000-0000-00000000000a'),
        (2, '00000000-0000-0000-0000-00000000000b');
    `)
  })
  afterAll(async () => {
    await db?.close()
  })

  it('asUser: authenticated roli, auth.uid(), jwt va device sarlavhasi', async () => {
    const uid = '00000000-0000-0000-0000-00000000000a'
    const r = await asUser(db, uid, (tx) =>
      one(
        tx,
        `select current_user as who, auth.uid() as uid, auth.role() as role,
                auth.jwt() ->> 'sub' as sub,
                current_setting('request.headers', true)::json ->> 'x-client-device' as device`,
      ),
    )
    expect(r).toEqual({ who: 'authenticated', uid, role: 'authenticated', sub: uid, device: 'veb' })

    const mobil = await asUser(
      db,
      uid,
      (tx) => scalar(tx, `select current_setting('request.headers', true)::json ->> 'x-client-device'`),
      { device: 'mobil' },
    )
    expect(mobil).toBe('mobil')
  })

  it('RLS va force row level security ishlaydi; rol tranzaksiyadan keyin tiklanadi', async () => {
    const seen = await asUser(db, '00000000-0000-0000-0000-00000000000a', (tx) =>
      scalar<number>(tx, 'select count(*)::int from public.harness_probe'),
    )
    expect(seen).toBe(1)
    const ins = await asUser(db, '00000000-0000-0000-0000-00000000000a', (tx) =>
      tryQuery(tx, `insert into public.harness_probe values (3, auth.uid())`),
    )
    expect(ins.ok).toBe(false)
    if (!ins.ok) expect(ins.code).toBe('42501')
    expect(await scalar(db, 'select current_user')).toBe('postgres')
  })

  it('anon: siyosat yo`q → 0 qator; service_role RLS`ni chetlab o`tadi, device yo`q', async () => {
    expect(await asAnon(db, (tx) => scalar<number>(tx, 'select count(*)::int from public.harness_probe'))).toBe(0)
    const svc = await asService(db, (tx) =>
      one(
        tx,
        `select count(*)::int as n, auth.uid() as uid, auth.role() as role,
                current_setting('request.headers', true)::json ->> 'x-client-device' as device
           from public.harness_probe`,
      ),
    )
    expect(svc).toEqual({ n: 2, uid: null, role: 'service_role', device: null })
  })

  it('standart — rollback; commit: true — saqlanadi', async () => {
    await asService(db, (tx) => tx.query(`insert into public.harness_probe values (10, null)`))
    expect(await scalar<number>(db, 'select count(*)::int from public.harness_probe where id = 10')).toBe(0)
    await asService(db, (tx) => tx.query(`insert into public.harness_probe values (11, null)`), { commit: true })
    expect(await scalar<number>(db, 'select count(*)::int from public.harness_probe where id = 11')).toBe(1)
  })

  it('tryQuery tranzaksiya ichida xatodan keyin davom etadi (savepoint)', async () => {
    const after = await asService(db, async (tx) => {
      const bad = await tryQuery(tx, 'select 1/0')
      expect(bad.ok).toBe(false)
      return scalar<number>(tx, 'select 42')
    })
    expect(after).toBe(42)
  })

  it('pgcrypto (extensions sxemasi) va stub sxemalar mavjud', async () => {
    expect(await scalar<number>(db, 'select length(extensions.gen_random_bytes(8))')).toBe(8)
    expect(await scalar<number>(db, `select cron.schedule('t', '0 15 * * *', 'select 1')`)).toBeGreaterThan(0)
    expect(await scalar<number>(db, `select net.http_post('https://example.test')`)).toBeGreaterThan(0)
    expect(await scalar(db, `select storage.foldername('a/b/c.jpg')`)).toEqual(['a', 'b'])
  })
})

// 2) Migratsiyalar (papka bo'sh bo'lsa ham o'tadi).
describe('migratsiyalar', () => {
  const files = listMigrations()
  let db: Db

  beforeAll(async () => {
    db = await createDb({ migrations: false })
  })
  afterAll(async () => {
    await db?.close()
  })

  it(`barcha migratsiyalar xatosiz qo'llanadi (${files.length} ta)`, async () => {
    await expect(applyMigrations(db, files)).resolves.toBeUndefined()
  })

  it.runIf(existsSync(SEED_FILE))('seed.sql xatosiz qo`llanadi', async () => {
    await expect(applySeed(db)).resolves.toBe(true)
  })
})
