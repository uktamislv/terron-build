// restore_record round-trip: private.history_tables() dagi HAR BIR jadval uchun
// admin soft delete → restore_record → qator yana ko'rinadi (deleted_at null) → audit_log da
// SOFT_DELETE va RESTORE yozuvlari (aktyor — admin, qurilma — veb).
// Ro'yxat bazadan olinadi — yangi jadval oq ro'yxatga qo'shilsa, fixture'da qatori bo'lmasa test yiqiladi.
// (RESTORABLE_TABLES ↔ history_tables() tengligi — src/data/dbContract.test.ts.)
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { asUser, createDb, rows, scalar, type Db } from './_harness'
import { res, switchUid } from './_tx'
import { buildTwoCompanies, type CompanyFixture } from './_fixtures'

let db: Db
let A: CompanyFixture
let tables: string[] = []

beforeAll(async () => {
  db = await createDb()
  ;({ A } = await buildTwoCompanies(db))
  tables = await scalar<string[]>(db, `select private.history_tables()`)
})
afterAll(async () => {
  await db?.close()
})

/** Oq ro'yxatdagi jadval → o'chirib-tiklanadigan fixture qatori (bog'lanishsiz, admin o'chira oladigan). */
function target(table: string): string {
  const ids = A.ids
  const map: Record<string, string | undefined> = {
    profiles: A.users.tekshiruvchi.profileId,
    objects: ids.obj3,
    object_members: ids.mem_haydovchi,
    materials: ids.m2,
    material_units: ids.u1,
    material_aliases: ids.al1,
    suppliers: ids.s1,
    cash_advances: ids.ca_prorab,
    purchases: ids.p_hay_obj2,
    movements: ids.mv_obj2,
    material_requests: ids.mr_obj2,
    inventory_counts: ids.ic_obj2,
    inventory_count_items: ids.ici_obj2,
    estimates: ids.est_obj2,
    estimate_items: ids.ei_obj2,
    estimate_import_templates: ids.tpl1,
  }
  const id = map[table]
  if (!id) throw new Error(`restore_roundtrip: ${table} uchun fixture qatori yo'q — target() ga qo'shing`)
  return id
}

/**
 * Tiklash triggerlari ataylab o'zgartiradigan ustunlar:
 *   profiles — O2 (20261103000001_history.sql): bog'lanishlar uziladi, is_active = false, login_kind = 'none';
 *   inventory_count_items — counted_at = now() (tiklangan sanash qatori yangi sanalgan hisoblanadi).
 */
const RESTORE_SIDE_EFFECTS: Record<string, string[]> = {
  profiles: ['auth_user_id', 'telegram_user_id', 'telegram_chat_id', 'login_kind', 'is_active'],
  inventory_count_items: ['counted_at'],
}

describe('restore_record — oq ro`yxatdagi har jadval', () => {
  it('oq ro`yxat bo`sh emas va har jadvalda fixture qatori bor', () => {
    expect(tables.length).toBeGreaterThan(0)
    for (const t of tables) expect(() => target(t), t).not.toThrow()
  })

  it.each([
    'profiles',
    'objects',
    'object_members',
    'materials',
    'material_units',
    'material_aliases',
    'suppliers',
    'cash_advances',
    'purchases',
    'movements',
    'material_requests',
    'inventory_counts',
    'inventory_count_items',
    'estimates',
    'estimate_items',
    'estimate_import_templates',
  ])('%s: o`chirish → tiklash → ko`rinadi → audit RESTORE', async (t) => {
    expect(tables, `${t} history_tables() da yo'q`).toContain(t)
    const id = target(t)
    const admin = A.users.admin
    const r = await asUser(db, admin.authUid, async (tx) => {
      const del = await res(tx, `update public.${t} set deleted_at = now() where id = $1 and deleted_at is null`, [id])
      const hiddenFromProrab = await (async () => {
        await switchUid(tx, A.users.prorab.authUid)
        const n = (await rows(tx, `select 1 from public.${t} where id = $1 and deleted_at is not null`, [id])).length
        await switchUid(tx, admin.authUid)
        return n
      })()
      const restore = await res(tx, `select public.restore_record($1, $2::uuid)`, [t, id])
      const live = await rows<{ deleted_at: string | null }>(tx, `select deleted_at from public.${t} where id = $1`, [id])
      const audit = await rows<{ action: string; actor_profile_id: string | null; device: string | null; changed_fields: string[] | null }>(
        tx,
        `select action, actor_profile_id, device, changed_fields from public.audit_log
          where table_name = $1 and record_id = $2 and action in ('SOFT_DELETE', 'RESTORE') order by id`,
        [t, id],
      )
      const again = await res(tx, `select public.restore_record($1, $2::uuid)`, [t, id])
      return { del, hiddenFromProrab, restore, live, audit, again }
    })
    expect(r.del).toBe('OK:1')
    expect(r.hiddenFromProrab).toBe(0)
    expect(r.restore).toBe('OK:1')
    expect(r.live).toEqual([{ deleted_at: null }])
    expect(r.audit.map((a) => [a.action, a.actor_profile_id, a.device])).toEqual([
      ['SOFT_DELETE', admin.profileId, 'veb'],
      ['RESTORE', admin.profileId, 'veb'],
    ])
    expect(r.audit[0]!.changed_fields).toEqual(['deleted_at'])
    // Tiklashda deleted_at va hujjatlashgan yon o'zgarishlar (RESTORE_SIDE_EFFECTS) — boshqa hech narsa
    const restored = r.audit[1]!.changed_fields ?? []
    expect(restored).toContain('deleted_at')
    expect(restored.filter((f) => f !== 'deleted_at' && !(RESTORE_SIDE_EFFECTS[t] ?? []).includes(f)), 'kutilmagan ustunlar').toEqual([])
    // Takroriy tiklash — o'chirilmagan
    expect(r.again).toBe('55000:restore_not_deleted')
  })

  it('test ro`yxati history_tables() bilan aynan bir xil (jadval qo`shilsa — test ham)', () => {
    expect([...tables].sort()).toEqual(
      [
        'profiles',
        'objects',
        'object_members',
        'materials',
        'material_units',
        'material_aliases',
        'suppliers',
        'cash_advances',
        'purchases',
        'movements',
        'material_requests',
        'inventory_counts',
        'inventory_count_items',
        'estimates',
        'estimate_items',
        'estimate_import_templates',
      ].sort(),
    )
  })
})
