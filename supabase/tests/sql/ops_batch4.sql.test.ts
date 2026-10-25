// Batch 4 — 20261028000001_ops.sql: Storage (photos bucket va siyosatlari),
// rasm yo'li trigger'i, operatsiya sanasi cheklovi, public.my_material_usage().
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  asAnon,
  asService,
  asUser,
  createDb,
  createMaterial,
  MIGRATIONS_DIR,
  rows,
  scalar,
  type Db,
  type Queryable,
  type TestUser,
  type Tx,
  type UserRole,
} from './_harness'
import { buildCompany, buildTwoCompanies, type CompanyFixture } from './_fixtures'

let db: Db
let A: CompanyFixture
let B: CompanyFixture
/** my_material_usage uchun alohida firma (yozuvlar commit qilinadi). */
let C: CompanyFixture

beforeAll(async () => {
  db = await createDb()
  ;({ A, B } = await buildTwoCompanies(db))
  C = await buildCompany(db, 'C')
  // Boshqa bucket (siyosat faqat 'photos' uchun)
  await db.query(`insert into storage.buckets (id, name, public) values ('other', 'other', false)`)
})
afterAll(async () => {
  await db?.close()
})

/** `OK:<qatorlar soni>` yoki `<errcode>:<hint>` (savepoint bilan — tx davom etadi). */
async function res(tx: Queryable, sql: string, params: unknown[] = []): Promise<string> {
  await tx.exec('savepoint ops_try')
  try {
    const r = await tx.query(sql, params)
    await tx.exec('release savepoint ops_try')
    return `OK:${r.affectedRows ?? r.rows.length}`
  } catch (e) {
    await tx.exec('rollback to savepoint ops_try')
    const err = e as { code?: string; hint?: string }
    return `${err.code ?? '?'}:${err.hint ?? ''}`
  }
}

/** Superuser tranzaksiyasi, oxirida rollback. */
async function inTx<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    const r = await fn(tx)
    await tx.rollback()
    return r
  })
}

/** To'g'ri formatdagi rasm yo'li: {company}/{yyyy}/{mm}/{uuid}.{ext} */
const photoPath = (company: string, ext = 'jpg'): string => `${company}/2026/10/${randomUUID()}.${ext}`

/**
 * Storage'ga rasm "yuklaydi" (superuser, commit): owner_id = foydalanuvchi auth id
 * (haqiqiy Storage API shunday qo'yadi). `age` — created_at necha oldin (masalan '25 hours').
 */
async function uploaded(
  owner: TestUser | null,
  company: string,
  opts: { ext?: string; age?: string; bucket?: string } = {},
): Promise<string> {
  const name = photoPath(company, opts.ext)
  await db.query(
    `insert into storage.objects (bucket_id, name, owner, owner_id, created_at)
     values ($1, $2, $3::uuid, $3::text, now() - $4::interval)`,
    [opts.bucket ?? 'photos', name, owner?.authUid ?? null, opts.age ?? '0 seconds'],
  )
  return name
}

/** Superuser tranzaksiyasi ichida foydalanuvchiga o'tish (`reset role` — qaytish). */
async function become(tx: Tx, u: TestUser): Promise<void> {
  await tx.exec(`set local role authenticated`)
  await tx.query(`select set_config('request.jwt.claims', $1, true), set_config('request.jwt.claim.sub', $2, true)`, [
    JSON.stringify({ sub: u.authUid, role: 'authenticated' }),
    u.authUid,
  ])
}
async function unbecome(tx: Tx): Promise<void> {
  await tx.exec(`reset role`)
  await tx.query(`select set_config('request.jwt.claims', '', true), set_config('request.jwt.claim.sub', '', true)`)
}

// ============================================================================
// 1. Storage
// ============================================================================
describe('storage: photos bucket', () => {
  it('bucket: private, 5 MB, jpeg/png/webp', async () => {
    const r = await rows(
      db,
      `select id, name, public, file_size_limit::int as lim, allowed_mime_types as mimes from storage.buckets where id = 'photos'`,
    )
    expect(r).toEqual([
      { id: 'photos', name: 'photos', public: false, lim: 5242880, mimes: ['image/jpeg', 'image/png', 'image/webp'] },
    ])
  })

  it('siyosatlar: faqat photos_insert va photos_select (update/delete yo`q), authenticated uchun', async () => {
    const r = await rows<{ policyname: string; cmd: string; roles: string[] }>(
      db,
      `select policyname, cmd, roles::text[] as roles from pg_policies
        where schemaname = 'storage' and tablename = 'objects' order by 1`,
    )
    expect(r).toEqual([
      { policyname: 'photos_insert', cmd: 'INSERT', roles: ['authenticated'] },
      { policyname: 'photos_select', cmd: 'SELECT', roles: ['authenticated'] },
    ])
  })

  const upload = (u: TestUser, name: string, bucket = 'photos'): Promise<string> =>
    asUser(db, u.authUid, (tx) =>
      res(tx, `insert into storage.objects (bucket_id, name, owner, owner_id) values ($1, $2, auth.uid(), auth.uid()::text)`, [
        bucket,
        name,
      ]),
    )

  it('bucket qayta sozlanadi: on conflict do update (public = false, limit, mime)', async () => {
    const sql = readFileSync(join(MIGRATIONS_DIR, '20261028000001_ops.sql'), 'utf8')
    const stmt = /insert into storage\.buckets[\s\S]*?;/.exec(sql)?.[0]
    expect(stmt).toBeDefined()
    const r = await inTx(async (tx) => {
      await tx.query(
        `update storage.buckets set public = true, file_size_limit = 1, allowed_mime_types = '{image/gif}' where id = 'photos'`,
      )
      await tx.exec(stmt!)
      return rows(
        tx,
        `select public, file_size_limit::int as lim, allowed_mime_types as mimes from storage.buckets where id = 'photos'`,
      )
    })
    expect(r).toEqual([{ public: false, lim: 5242880, mimes: ['image/jpeg', 'image/png', 'image/webp'] }])
  })

  it('rollar: kirim/chiqim yoki xarid kiritadiganlar o`z firma papkasiga yuklaydi; boshqalar — rad', async () => {
    const roles: UserRole[] = [
      'super_admin',
      'admin',
      'direktor',
      'buxgalter',
      'taminotchi',
      'prorab',
      'omborchi',
      'haydovchi',
      'tekshiruvchi',
    ]
    const out: Record<string, string> = {}
    for (const role of roles) out[role] = await upload(A.users[role], photoPath(A.id))
    expect(out).toEqual({
      super_admin: 'OK:1',
      admin: 'OK:1',
      direktor: '42501:',
      buxgalter: '42501:',
      taminotchi: 'OK:1',
      prorab: 'OK:1',
      omborchi: 'OK:1',
      haydovchi: 'OK:1',
      tekshiruvchi: '42501:',
    })
  })

  it('boshqa firma papkasiga yuklash — rad (prorab, admin, super_admin)', async () => {
    expect({
      prorab: await upload(A.users.prorab, photoPath(B.id)),
      admin: await upload(A.users.admin, photoPath(B.id)),
      super_admin: await upload(A.users.super_admin, photoPath(B.id)),
    }).toEqual({ prorab: '42501:', admin: '42501:', super_admin: '42501:' })
  })

  it('noto`g`ri yo`l formati yoki boshqa bucket — rad', async () => {
    const me = A.users.prorab
    expect({
      flat: await upload(me, `${A.id}/rasm.jpg`),
      noMonth: await upload(me, `${A.id}/2026/${randomUUID()}.jpg`),
      gif: await upload(me, photoPath(A.id, 'gif')),
      upperExt: await upload(me, photoPath(A.id, 'JPG')),
      nested: await upload(me, `${A.id}/2026/10/x/${randomUUID()}.jpg`),
      otherBucket: await upload(me, photoPath(A.id), 'other'),
      png: await upload(me, photoPath(A.id, 'png')),
      webp: await upload(me, photoPath(A.id, 'webp')),
    }).toEqual({
      flat: '42501:',
      noMonth: '42501:',
      gif: '42501:',
      upperExt: '42501:',
      nested: '42501:',
      otherBucket: '42501:',
      png: 'OK:1',
      webp: 'OK:1',
    })
  })

  describe('ko`rish, o`zgartirish, o`chirish', () => {
    let aPhoto: string
    let bPhoto: string
    beforeAll(async () => {
      aPhoto = photoPath(A.id)
      bPhoto = photoPath(B.id)
      await db.query(`insert into storage.objects (bucket_id, name) values ('photos', $1), ('photos', $2)`, [aPhoto, bPhoto])
    })

    const seen = (u: TestUser): Promise<string[]> =>
      asUser(db, u.authUid, (tx) =>
        rows<{ name: string }>(tx, `select name from storage.objects where name = any($1) order by name`, [[aPhoto, bPhoto]]),
      ).then((r) => r.map((x) => (x.name === aPhoto ? 'A' : 'B')))

    it('firma bo`yicha rollar o`z firmasi rasmlarini ko`radi; obyekt rollari biriktirilmagan begona rasmni ko`rmaydi; super_admin — hammasini', async () => {
      expect({
        a_prorab: await seen(A.users.prorab),
        a_direktor: await seen(A.users.direktor),
        a_tekshiruvchi: await seen(A.users.tekshiruvchi),
        a_haydovchi: await seen(A.users.haydovchi),
        b_admin: await seen(B.users.admin),
        a_super_admin: await seen(A.users.super_admin),
      }).toEqual({
        a_prorab: [],
        a_direktor: ['A'],
        a_tekshiruvchi: ['A'],
        a_haydovchi: [],
        b_admin: ['B'],
        a_super_admin: [aPhoto < bPhoto ? 'A' : 'B', aPhoto < bPhoto ? 'B' : 'A'],
      })
    })

    it('anon: hech narsa ko`rmaydi va yuklay olmaydi', async () => {
      const r = await asAnon(db, async (tx) => ({
        seen: await scalar<number>(tx, `select count(*)::int from storage.objects where bucket_id = 'photos'`),
        upload: await res(tx, `insert into storage.objects (bucket_id, name) values ('photos', $1)`, [photoPath(A.id)]),
      }))
      expect(r).toEqual({ seen: 0, upload: '42501:' })
    })

    it('UPDATE va DELETE — hech kimga (admin, super_admin ham): 0 qator, rasm joyida', async () => {
      const out: Record<string, string[]> = {}
      for (const role of ['admin', 'prorab', 'super_admin'] as const) {
        out[role] = await asUser(db, A.users[role].authUid, async (tx) => [
          await res(tx, `update storage.objects set name = $2 where name = $1`, [aPhoto, photoPath(A.id)]),
          await res(tx, `update storage.objects set metadata = '{"x":1}' where name = $1`, [aPhoto]),
          await res(tx, `delete from storage.objects where name = $1`, [aPhoto]),
        ])
      }
      expect(out).toEqual({
        admin: ['OK:0', 'OK:0', 'OK:0'],
        prorab: ['OK:0', 'OK:0', 'OK:0'],
        super_admin: ['OK:0', 'OK:0', 'OK:0'],
      })
      expect(await scalar<number>(db, `select count(*)::int from storage.objects where name = $1 and metadata is null`, [aPhoto])).toBe(1)
    })
  })

  // B firma yozuvlari (B boshqa testlarda faqat "begona firma" sifatida ishlatiladi).
  describe('obyekt darajasida ko`rish (prorab, omborchi, haydovchi)', () => {
    let onObj1: string // B mv_obj1 (obj1 — prorab/omborchi/haydovchi a'zo)
    let onObj2: string // B mv_obj2 (obj2 — a'zo emas)
    let hayReceipt: string // B p_hay_obj2 (haydovchi xaridi, obj2)
    let proOwn: string // prorab yuklagan, hali biriktirilmagan
    let loose: string // hech kimniki, biriktirilmagan
    beforeAll(async () => {
      onObj1 = await uploaded(null, B.id)
      onObj2 = await uploaded(null, B.id)
      hayReceipt = await uploaded(null, B.id)
      proOwn = await uploaded(B.users.prorab, B.id)
      loose = await uploaded(null, B.id)
      await db.query(`update public.movements set photo_path = $2 where id = $1`, [B.ids.mv_obj1, onObj1])
      await db.query(`update public.movements set photo_path = $2 where id = $1`, [B.ids.mv_obj2, onObj2])
      await db.query(`update public.purchases set receipt_photo_path = $2 where id = $1`, [B.ids.p_hay_obj2, hayReceipt])
    })

    const seen = async (u: TestUser): Promise<string[]> => {
      const labels: Record<string, string> = { [onObj1]: 'obj1', [onObj2]: 'obj2', [hayReceipt]: 'hayReceipt', [proOwn]: 'proOwn', [loose]: 'loose' }
      const r = await asUser(db, u.authUid, (tx) =>
        rows<{ name: string }>(tx, `select name from storage.objects where name = any($1)`, [Object.keys(labels)]),
      )
      return r.map((x) => labels[x.name]!).sort()
    }

    it('prorab: a`zo obyekt rasmi va o`zi yuklagani — ha; a`zo bo`lmagan obyekt va begona — yo`q', async () => {
      expect(await seen(B.users.prorab)).toEqual(['obj1', 'proOwn'])
    })
    it('omborchi: faqat a`zo obyekt rasmi', async () => {
      expect(await seen(B.users.omborchi)).toEqual(['obj1'])
    })
    it('haydovchi: faqat o`z xaridi cheki (harakatlarni ko`rmaydi)', async () => {
      expect(await seen(B.users.haydovchi)).toEqual(['hayReceipt'])
    })
    it('direktor va taminotchi (firma bo`yicha) — hammasi; A firma prorabi — hech narsa', async () => {
      const all = ['hayReceipt', 'loose', 'obj1', 'obj2', 'proOwn']
      expect({
        direktor: await seen(B.users.direktor),
        taminotchi: await seen(B.users.taminotchi),
        a_prorab: await seen(A.users.prorab),
      }).toEqual({ direktor: all, taminotchi: all, a_prorab: [] })
    })
  })
})

// ============================================================================
// 2. Rasm yo'li trigger'i (movements.photo_path, purchases.receipt_photo_path)
// ============================================================================
describe('rasm yo`li: format va firma papkasi', () => {
  const kirim = (tx: Queryable, me: TestUser, path: string | null): Promise<string> =>
    res(
      tx,
      `insert into public.movements (company_id, type, object_id, material_id, qty_input, unit_input, qty_base, created_by, photo_path)
       values ($1, 'kirim', $2, $3, 1, 'kg', 0, $4, $5)`,
      [A.id, A.ids.obj1, A.ids.m1, me.profileId, path],
    )
  const xarid = (tx: Queryable, me: TestUser, path: string | null): Promise<string> =>
    res(
      tx,
      `insert into public.purchases (company_id, buyer_id, object_id, material_id, qty_input, unit_input, qty_base,
         unit_price, total_amount, created_by, receipt_photo_path)
       values ($1, $2, $3, $4, 1, 'kg', 1, 100, 100, $2, $5)`,
      [A.id, me.profileId, A.ids.obj1, A.ids.m1, path],
    )

  it('movements: o`z firma papkasi — OK; boshqa firma — ops_photo_path_company; format — ops_photo_path_format', async () => {
    const me = A.users.prorab
    const ok = await uploaded(me, A.id)
    const png = await uploaded(me, A.id, { ext: 'png' })
    const r = await asUser(db, me.authUid, async (tx) => ({
      ok: await kirim(tx, me, ok),
      png: await kirim(tx, me, png),
      none: await kirim(tx, me, null),
      other: await kirim(tx, me, photoPath(B.id)),
      flat: await kirim(tx, me, 'a/b.jpg'),
      noExt: await kirim(tx, me, `${A.id}/2026/10/${randomUUID()}`),
      gif: await kirim(tx, me, photoPath(A.id, 'gif')),
      upper: await kirim(tx, me, photoPath(A.id.toUpperCase())),
      leadingSlash: await kirim(tx, me, `/${photoPath(A.id)}`),
    }))
    expect(r).toEqual({
      ok: 'OK:1',
      png: 'OK:1',
      none: 'OK:1',
      other: '23514:ops_photo_path_company',
      flat: '23514:ops_photo_path_format',
      noExt: '23514:ops_photo_path_format',
      gif: '23514:ops_photo_path_format',
      upper: '23514:ops_photo_path_format',
      leadingSlash: '23514:ops_photo_path_format',
    })
  })

  it('bo`sh satr → null', async () => {
    const me = A.users.prorab
    const r = await asUser(db, me.authUid, (tx) =>
      rows(
        tx,
        `insert into public.movements (company_id, type, object_id, material_id, qty_input, unit_input, qty_base, created_by, photo_path)
         values ($1, 'kirim', $2, $3, 1, 'kg', 0, $4, '  ') returning photo_path`,
        [A.id, A.ids.obj1, A.ids.m1, me.profileId],
      ),
    )
    expect(r).toEqual([{ photo_path: null }])
  })

  it('purchases.receipt_photo_path: o`z firmasi — OK; boshqa firma / format — rad', async () => {
    const me = A.users.haydovchi
    const ok = await uploaded(me, A.id, { ext: 'webp' })
    const r = await asUser(db, me.authUid, async (tx) => ({
      ok: await xarid(tx, me, ok),
      other: await xarid(tx, me, photoPath(B.id)),
      bad: await xarid(tx, me, 'chek.jpg'),
    }))
    expect(r).toEqual({ ok: 'OK:1', other: '23514:ops_photo_path_company', bad: '23514:ops_photo_path_format' })
  })

  it('UPDATE: admin boshqa firma papkasini qo`ya olmaydi; to`g`ri yo`l — OK; service_role uchun ham tekshiriladi', async () => {
    const admin = await asUser(db, A.users.admin.authUid, async (tx) => ({
      other: await res(tx, `update public.movements set photo_path = $2 where id = $1`, [A.ids.mv_obj1, photoPath(B.id)]),
      ok: await res(tx, `update public.movements set photo_path = $2 where id = $1`, [A.ids.mv_obj1, photoPath(A.id)]),
      receipt: await res(tx, `update public.purchases set receipt_photo_path = $2 where id = $1`, [
        A.ids.p_pro_obj1,
        photoPath(B.id),
      ]),
    }))
    const svc = await asService(db, (tx) =>
      res(tx, `update public.movements set photo_path = $2 where id = $1`, [A.ids.mv_obj1, photoPath(B.id)]),
    )
    expect({ ...admin, svc }).toEqual({
      other: '23514:ops_photo_path_company',
      ok: 'OK:1',
      receipt: '23514:ops_photo_path_company',
      svc: '23514:ops_photo_path_company',
    })
  })

  it('UPDATE: yo`l o`zgarmasa (masalan izoh) qayta tekshirilmaydi', async () => {
    const r = await inTx(async (tx) => {
      // eski (noto'g'ri) qiymatni triggersiz qo'yamiz — masalan Batch 4 dan oldingi yozuv
      await tx.exec(`set local session_replication_role = replica`)
      await tx.query(`update public.movements set photo_path = 'eski/rasm.jpg' where id = $1`, [A.ids.mv_obj1])
      await tx.exec(`set local session_replication_role = origin`)
      return {
        note: await res(tx, `update public.movements set note = 'izoh' where id = $1`, [A.ids.mv_obj1]),
        change: await res(tx, `update public.movements set photo_path = 'yangi/rasm.jpg' where id = $1`, [A.ids.mv_obj1]),
      }
    })
    expect(r).toEqual({ note: 'OK:1', change: '23514:ops_photo_path_format' })
  })
})

// ============================================================================
// 2b. Rasm egaligi (ops_photo_not_owned) va qayta ishlatish (ops_photo_reused)
// ============================================================================
describe('rasm: faqat o`zi yuklagan, 24 soat ichida, bitta yozuvga', () => {
  const NOT_OWNED = '42501:ops_photo_not_owned'
  const REUSED = '23505:ops_photo_reused'
  const kirim = (tx: Queryable, me: TestUser, path: string): Promise<string> =>
    res(
      tx,
      `insert into public.movements (company_id, type, object_id, material_id, qty_input, unit_input, qty_base, created_by, photo_path)
       values ($1, 'kirim', $2, $3, 1, 'kg', 0, $4, $5)`,
      [A.id, A.ids.obj1, A.ids.m1, me.profileId, path],
    )
  const xarid = (tx: Queryable, me: TestUser, path: string): Promise<string> =>
    res(
      tx,
      `insert into public.purchases (company_id, buyer_id, object_id, material_id, qty_input, unit_input, qty_base,
         unit_price, total_amount, created_by, receipt_photo_path)
       values ($1, $2, $3, $4, 1, 'kg', 1, 100, 100, $2, $5)`,
      [A.id, me.profileId, A.ids.obj1, A.ids.m1, path],
    )

  it('prorab: boshqa birov yuklagani, mavjud bo`lmagan yo`l, 25 soat oldingi, boshqa bucket — rad; 23 soat — OK', async () => {
    const me = A.users.prorab
    const others = await uploaded(A.users.omborchi, A.id)
    const nobody = await uploaded(null, A.id)
    const old = await uploaded(me, A.id, { age: '25 hours' })
    const fresh = await uploaded(me, A.id, { age: '23 hours' })
    const otherBucket = await uploaded(me, A.id, { bucket: 'other' })
    const r = await asUser(db, me.authUid, async (tx) => ({
      others: await kirim(tx, me, others),
      nobody: await kirim(tx, me, nobody),
      missing: await kirim(tx, me, photoPath(A.id)),
      old: await kirim(tx, me, old),
      otherBucket: await kirim(tx, me, otherBucket),
      fresh: await kirim(tx, me, fresh),
    }))
    expect(r).toEqual({
      others: NOT_OWNED,
      nobody: NOT_OWNED,
      missing: NOT_OWNED,
      old: NOT_OWNED,
      otherBucket: NOT_OWNED,
      fresh: 'OK:1',
    })
  })

  it('bitta rasm ikkinchi yozuvga (harakat yoki xarid) — rad', async () => {
    const me = A.users.prorab
    const p = await uploaded(me, A.id)
    const r = await asUser(db, me.authUid, async (tx) => ({
      first: await kirim(tx, me, p),
      secondMovement: await kirim(tx, me, p),
      purchase: await xarid(tx, me, p),
    }))
    expect(r).toEqual({ first: 'OK:1', secondMovement: REUSED, purchase: REUSED })
  })

  it('xarid chekini harakatga ham biriktirib bo`lmaydi', async () => {
    const me = A.users.prorab
    const p = await uploaded(me, A.id)
    const r = await asUser(db, me.authUid, async (tx) => ({
      purchase: await xarid(tx, me, p),
      movement: await kirim(tx, me, p),
    }))
    expect(r).toEqual({ purchase: 'OK:1', movement: REUSED })
  })

  it('admin: mavjud bo`lmagan / begona rasm — ruxsat; lekin qayta ishlatish — rad; o`chirilgan yozuv rasmi — bo`sh, tiklash — rad', async () => {
    const admin = A.users.admin
    const others = await uploaded(A.users.prorab, A.id)
    const r = await asUser(db, admin.authUid, async (tx) => {
      const missing = await kirim(tx, admin, photoPath(A.id))
      const first = await scalar<string>(
        tx,
        `insert into public.movements (company_id, type, object_id, material_id, qty_input, unit_input, qty_base, created_by, photo_path)
         values ($1, 'kirim', $2, $3, 1, 'kg', 0, $4, $5) returning id`,
        [A.id, A.ids.obj1, A.ids.m1, admin.profileId, others],
      )
      const reuse = await kirim(tx, admin, others)
      await tx.query(`update public.movements set deleted_at = now() where id = $1`, [first])
      const afterDelete = await kirim(tx, admin, others)
      const restore = await res(tx, `update public.movements set deleted_at = null where id = $1`, [first])
      return { missing, reuse, afterDelete, restore }
    })
    expect(r).toEqual({ missing: 'OK:1', reuse: REUSED, afterDelete: 'OK:1', restore: REUSED })
  })

  it('service_role: egalik tekshirilmaydi', async () => {
    const r = await asService(db, (tx) =>
      res(
        tx,
        `insert into public.movements (company_id, type, object_id, material_id, qty_input, unit_input, qty_base, photo_path)
         values ($1, 'kirim', $2, $3, 1, 'kg', 0, $4)`,
        [A.id, A.ids.obj1, A.ids.m1, photoPath(A.id)],
      ),
    )
    expect(r).toBe('OK:1')
  })
})

// ============================================================================
// 2c. Muallif o'z o'chirilgan yozuvlarini ko'radi
// ============================================================================
describe('o`z o`chirilgan harakat va xaridlari', () => {
  it('prorab o`z o`chirilganini ko`radi; boshqaning o`chirilgani va boshqa firma — yo`q', async () => {
    const r = await inTx(async (tx) => {
      const mv = (co: CompanyFixture, by: TestUser, obj: string): Promise<string> =>
        scalar<string>(
          tx,
          `insert into public.movements (company_id, type, object_id, material_id, qty_input, unit_input, qty_base, created_by)
           values ($1, 'kirim', $2, $3, 1, 'kg', 0, $4) returning id`,
          [co.id, obj, co.ids.m1, by.profileId],
        )
      const own = await mv(A, A.users.prorab, A.ids.obj1!)
      const ownObj2 = await mv(A, A.users.prorab, A.ids.obj2!) // a'zo bo'lmagan obyekt
      const ownLive = await mv(A, A.users.prorab, A.ids.obj2!) // o'chirilmaydi
      const omb = await mv(A, A.users.omborchi, A.ids.obj1!)
      const bPro = await mv(B, B.users.prorab, B.ids.obj1!)
      await tx.query(`update public.movements set deleted_at = now() where id = any($1)`, [[own, ownObj2, omb, bPro]])
      const labels: Record<string, string> = { [own]: 'own', [ownObj2]: 'ownObj2', [ownLive]: 'ownLive', [omb]: 'omb', [bPro]: 'bPro' }
      const see = async (u: TestUser): Promise<string[]> => {
        await become(tx, u)
        const x = await rows<{ id: string }>(tx, `select id from public.movements where id = any($1)`, [Object.keys(labels)])
        await unbecome(tx)
        return x.map((y) => labels[y.id]!).sort()
      }
      return {
        a_prorab: await see(A.users.prorab),
        a_omborchi: await see(A.users.omborchi),
        b_prorab: await see(B.users.prorab),
        a_haydovchi: await see(A.users.haydovchi),
      }
    })
    expect(r).toEqual({
      // ownLive (a'zo bo'lmagan obyekt, tirik) — avvalgidek ko'rinmaydi
      a_prorab: ['own', 'ownObj2'],
      a_omborchi: ['omb'],
      b_prorab: ['bPro'],
      a_haydovchi: [],
    })
  })

  it('haydovchi o`z o`chirilgan xaridini ko`radi; prorabning o`chirilgan xaridini — yo`q', async () => {
    const r = await inTx(async (tx) => {
      await tx.query(`update public.purchases set deleted_at = now() where id = any($1)`, [[A.ids.p_hay_obj2, A.ids.p_pro_obj1]])
      const labels: Record<string, string> = { [A.ids.p_hay_obj2!]: 'hay', [A.ids.p_pro_obj1!]: 'pro' }
      const see = async (u: TestUser): Promise<string[]> => {
        await become(tx, u)
        const x = await rows<{ id: string }>(tx, `select id from public.purchases where id = any($1)`, [Object.keys(labels)])
        await unbecome(tx)
        return x.map((y) => labels[y.id]!).sort()
      }
      return {
        haydovchi: await see(A.users.haydovchi),
        prorab: await see(A.users.prorab),
        omborchi: await see(A.users.omborchi),
        b_haydovchi: await see(B.users.haydovchi),
      }
    })
    expect(r).toEqual({ haydovchi: ['hay'], prorab: ['pro'], omborchi: [], b_haydovchi: [] })
  })
})

// ============================================================================
// 3. Operatsiya sanasi
// ============================================================================
describe('operatsiya sanasi: [now() − 3 kun, now() + 5 daqiqa] (admin bo`lmaganlar)', () => {
  const RANGE = '23514:ops_occurred_at_range'

  const kirim = (u: TestUser, at: string): Promise<string> =>
    asUser(db, u.authUid, (tx) =>
      res(
        tx,
        `insert into public.movements (company_id, type, object_id, material_id, qty_input, unit_input, qty_base, created_by, occurred_at)
         values ($1, 'kirim', $2, $3, 1, 'kg', 0, $4, ${at})`,
        [A.id, A.ids.obj1, A.ids.m1, u.profileId],
      ),
    )

  it('movements: prorab 4 kun oldin — rad; 2 kun oldin — OK; +10 daqiqa — rad; +2 daqiqa — OK', async () => {
    const me = A.users.prorab
    expect({
      d4: await kirim(me, `now() - interval '4 days'`),
      d3plus: await kirim(me, `now() - interval '3 days 1 minute'`),
      d2: await kirim(me, `now() - interval '2 days'`),
      edge: await kirim(me, `now() - interval '3 days'`),
      f10: await kirim(me, `now() + interval '10 minutes'`),
      f2: await kirim(me, `now() + interval '2 minutes'`),
    }).toEqual({ d4: RANGE, d3plus: RANGE, d2: 'OK:1', edge: 'OK:1', f10: RANGE, f2: 'OK:1' })
  })

  it('omborchi ham cheklangan; admin va super_admin — 30 kun oldin va kelajak OK', async () => {
    expect({
      omborchi: await kirim(A.users.omborchi, `now() - interval '5 days'`),
      admin: await kirim(A.users.admin, `now() - interval '30 days'`),
      adminFuture: await kirim(A.users.admin, `now() + interval '1 day'`),
      super_admin: await kirim(A.users.super_admin, `now() - interval '30 days'`),
    }).toEqual({ omborchi: RANGE, admin: 'OK:1', adminFuture: 'OK:1', super_admin: 'OK:1' })
  })

  it('null → now() (berilmasa ham now())', async () => {
    const me = A.users.prorab
    const r = await asUser(db, me.authUid, async (tx) => {
      const explicitNull = await scalar<boolean>(
        tx,
        `insert into public.movements (company_id, type, object_id, material_id, qty_input, unit_input, qty_base, created_by, occurred_at)
         values ($1, 'kirim', $2, $3, 1, 'kg', 0, $4, null) returning occurred_at = now()`,
        [A.id, A.ids.obj1, A.ids.m1, me.profileId],
      )
      const omitted = await scalar<boolean>(
        tx,
        `insert into public.movements (company_id, type, object_id, material_id, qty_input, unit_input, qty_base, created_by)
         values ($1, 'kirim', $2, $3, 1, 'kg', 0, $4) returning occurred_at = now()`,
        [A.id, A.ids.obj1, A.ids.m1, me.profileId],
      )
      return { explicitNull, omitted }
    })
    expect(r).toEqual({ explicitNull: true, omitted: true })
  })

  it('purchases.purchased_at: haydovchi 4 kun oldin — rad, 1 kun oldin — OK; null → now()', async () => {
    const me = A.users.haydovchi
    const xarid = (tx: Queryable, at: string): Promise<string> =>
      res(
        tx,
        `insert into public.purchases (company_id, buyer_id, object_id, material_id, qty_input, unit_input, qty_base,
           unit_price, total_amount, created_by, purchased_at)
         values ($1, $2, $3, $4, 1, 'kg', 1, 100, 100, $2, ${at})`,
        [A.id, me.profileId, A.ids.obj1, A.ids.m1],
      )
    const r = await asUser(db, me.authUid, async (tx) => ({
      d4: await xarid(tx, `now() - interval '4 days'`),
      d1: await xarid(tx, `now() - interval '1 day'`),
      nul: await xarid(tx, `null`),
      nulIsNow: await scalar<number>(
        tx,
        `select count(*)::int from public.purchases where buyer_id = $1 and purchased_at = now() and created_at = now()`,
        [me.profileId],
      ),
    }))
    expect(r).toEqual({ d4: RANGE, d1: 'OK:1', nul: 'OK:1', nulIsNow: 1 })
  })

  it('inventory_counts.counted_at: tekshiruvchi 10 kun oldin — rad; hozir — OK', async () => {
    const me = A.users.tekshiruvchi
    const r = await asUser(db, me.authUid, async (tx) => ({
      old: await res(
        tx,
        `insert into public.inventory_counts (company_id, object_id, created_by, counted_at) values ($1, $2, $3, now() - interval '10 days')`,
        [A.id, A.ids.obj1, me.profileId],
      ),
      now: await res(tx, `insert into public.inventory_counts (company_id, object_id, created_by) values ($1, $2, $3)`, [
        A.id,
        A.ids.obj1,
        me.profileId,
      ]),
    }))
    expect(r).toEqual({ old: RANGE, now: 'OK:1' })
  })

  it('service_role (tizim) — cheklovsiz', async () => {
    const r = await asService(db, (tx) =>
      res(
        tx,
        `insert into public.movements (company_id, type, object_id, material_id, qty_input, unit_input, qty_base, occurred_at)
         values ($1, 'kirim', $2, $3, 1, 'kg', 0, now() - interval '60 days')`,
        [A.id, A.ids.obj1, A.ids.m1],
      ),
    )
    expect(r).toBe('OK:1')
  })

  it('UPDATE: admin sanani 30 kun orqaga o`zgartiradi; null → eski qiymat', async () => {
    const r = await asUser(db, A.users.admin.authUid, async (tx) => {
      const back = await res(tx, `update public.movements set occurred_at = now() - interval '30 days' where id = $1`, [
        A.ids.mv_obj1,
      ])
      const before = await scalar<string>(tx, `select occurred_at::text from public.movements where id = $1`, [A.ids.mv_obj1])
      const nul = await res(tx, `update public.movements set occurred_at = null where id = $1`, [A.ids.mv_obj1])
      const after = await scalar<string>(tx, `select occurred_at::text from public.movements where id = $1`, [A.ids.mv_obj1])
      return { back, nul, same: before === after }
    })
    expect(r).toEqual({ back: 'OK:1', nul: 'OK:1', same: true })
  })

  it('UPDATE: tekshiruvchi draft hisobining sanasini 10 kun orqaga surolmaydi; sana o`zgarmasa (izoh) — OK', async () => {
    const me = A.users.tekshiruvchi
    const r = await inTx(async (tx) => {
      // eski sana (tizim qo'ygan) — o'zgarmasa qayta tekshirilmaydi
      await tx.query(`update public.inventory_counts set counted_at = now() - interval '20 days' where id = $1`, [A.ids.ic_obj1])
      await tx.exec(`set local role authenticated`)
      await tx.query(`select set_config('request.jwt.claims', $1, true), set_config('request.jwt.claim.sub', $2, true)`, [
        JSON.stringify({ sub: me.authUid, role: 'authenticated' }),
        me.authUid,
      ])
      return {
        note: await res(tx, `update public.inventory_counts set note = 'x' where id = $1`, [A.ids.ic_obj1]),
        back: await res(tx, `update public.inventory_counts set counted_at = now() - interval '10 days' where id = $1`, [
          A.ids.ic_obj1,
        ]),
      }
    })
    expect(r).toEqual({ note: 'OK:1', back: RANGE })
  })
})

// ============================================================================
// 4. public.my_material_usage(p_days)
// ============================================================================
describe('my_material_usage', () => {
  let m3: string
  let mvOld: string
  beforeAll(async () => {
    const pro = C.users.prorab.profileId
    const omb = C.users.omborchi.profileId
    m3 = await createMaterial(db, { companyId: C.id, name: 'C shag`al', baseUnit: 'kg' })
    // Har INSERT alohida tranzaksiya → created_at har xil (tartibni tekshirish uchun).
    const mv = async (material: string, by: string, unit: string): Promise<string> =>
      scalar<string>(
        db,
        `insert into public.movements (company_id, type, object_id, material_id, qty_input, unit_input, qty_base, created_by)
         values ($1, 'kirim', $2, $3, 1, $4, 0, $5) returning id`,
        [C.id, C.ids.obj1, material, unit, by],
      )
    // Fixture: p_pro_obj1 — prorab xaridi (m1), eng birinchi.
    mvOld = await mv(C.ids.m1!, pro, 'kg') // m1 — 2-chi
    await mv(C.ids.m2!, pro, 'm³') // m2 — 1 ta
    const deleted = await mv(C.ids.m2!, pro, 'm³') // o'chiriladi — hisoblanmaydi
    await db.query(`update public.movements set deleted_at = now() where id = $1`, [deleted])
    await mv(C.ids.m1!, omb, 'kg') // boshqa foydalanuvchi — hisoblanmaydi
    await mv(m3, pro, 'kg') // m3 — 1 ta, m2 dan keyin
  })

  type Usage = { material_id: string; use_count: number; recent: boolean }
  const usage = (tx: Queryable, days?: number): Promise<Usage[]> =>
    rows<Usage>(
      tx,
      `select material_id, use_count::int as use_count, last_used_at > now() - interval '1 hour' as recent
         from public.my_material_usage(${days === undefined ? '' : '$1'})`,
      days === undefined ? [] : [days],
    )

  it('faqat o`z yozuvlari (harakat + xarid), o`chirilganlar yo`q; tartib: soni, keyin oxirgi ishlatilgan', async () => {
    const r = await asUser(db, C.users.prorab.authUid, (tx) => usage(tx))
    expect(r).toEqual([
      { material_id: C.ids.m1, use_count: 2, recent: true },
      { material_id: m3, use_count: 1, recent: true },
      { material_id: C.ids.m2, use_count: 1, recent: true },
    ])
  })

  it('boshqa foydalanuvchi (omborchi) — faqat o`zinikini; direktor — bo`sh', async () => {
    expect({
      omborchi: await asUser(db, C.users.omborchi.authUid, (tx) => usage(tx)),
      direktor: await asUser(db, C.users.direktor.authUid, (tx) => usage(tx)),
    }).toEqual({
      omborchi: [{ material_id: C.ids.m1, use_count: 1, recent: true }],
      direktor: [],
    })
  })

  it('boshqa firma (B prorab) C firma materiallarini ko`rmaydi', async () => {
    const r = await asUser(db, B.users.prorab.authUid, (tx) => usage(tx))
    expect(r).toEqual([{ material_id: B.ids.m1, use_count: 1, recent: true }])
  })

  it('p_days oynasi: 40 kun oldingi yozuv 30 kunda yo`q, 60 kunda bor', async () => {
    const me = C.users.prorab
    const r = await inTx(async (tx) => {
      await tx.exec(`set local session_replication_role = replica`)
      await tx.query(`update public.movements set created_at = now() - interval '40 days' where id = $1`, [mvOld])
      await tx.exec(`set local session_replication_role = origin`)
      await tx.exec(`set local role authenticated`)
      await tx.query(`select set_config('request.jwt.claims', $1, true), set_config('request.jwt.claim.sub', $2, true)`, [
        JSON.stringify({ sub: me.authUid, role: 'authenticated' }),
        me.authUid,
      ])
      const m1 = async (days: number): Promise<number | undefined> =>
        (await usage(tx, days)).find((x) => x.material_id === C.ids.m1)?.use_count
      return { d30: await m1(30), d60: await m1(60), d1: await m1(1) }
    })
    expect(r).toEqual({ d30: 1, d60: 2, d1: 1 })
  })

  it('p_days 1..365 dan tashqari yoki null → 22023 ops_usage_days_range', async () => {
    const r = await asUser(db, C.users.prorab.authUid, async (tx) => ({
      zero: await res(tx, `select * from public.my_material_usage(0)`),
      big: await res(tx, `select * from public.my_material_usage(366)`),
      nul: await res(tx, `select * from public.my_material_usage(null)`),
      max: await scalar<number>(tx, `select count(*)::int from public.my_material_usage(365)`),
    }))
    expect(r).toEqual({
      zero: '22023:ops_usage_days_range',
      big: '22023:ops_usage_days_range',
      nul: '22023:ops_usage_days_range',
      max: 3,
    })
  })

  it('anon execute yo`q; authenticated bor; security invoker, stable, search_path belgilangan', async () => {
    const anon = await asAnon(db, (tx) => res(tx, `select * from public.my_material_usage()`))
    const meta = await rows(
      db,
      `select p.prosecdef as definer, p.provolatile as vol, p.proconfig as cfg,
              has_function_privilege('anon', p.oid, 'execute') as anon,
              has_function_privilege('authenticated', p.oid, 'execute') as auth
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname = 'my_material_usage'`,
    )
    expect({ anon, meta }).toEqual({
      anon: '42501:',
      meta: [{ definer: false, vol: 's', cfg: ['search_path=""'], anon: false, auth: true }],
    })
  })
})
