// @vitest-environment node
import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
  MAX_PHOTO_BYTES,
  handlePhotoHash,
  photoPathAllowed,
  sha256Hex,
  type DownloadResult,
  type PhotoCaller,
  type PhotoHashDeps,
  type PhotoRow,
  type SetHashResult,
} from './logic.ts'

const AUTH = 'Bearer user.jwt'
const CO = '11111111-1111-4111-8111-111111111111'
const OTHER_CO = '22222222-2222-4222-8222-222222222222'
const ID = '33333333-3333-4333-8333-333333333333'
const PATH = `${CO}/2026/10/44444444-4444-4444-8444-444444444444.jpg`
const BYTES = new TextEncoder().encode('fake jpeg bytes')
const SHA = createHash('sha256').update(BYTES).digest('hex')

const author: PhotoCaller = { id: 'p-author', company_id: CO, role: 'prorab' }

function fake(
  opts: {
    authId?: string | null
    caller?: PhotoCaller | null
    row?: PhotoRow | null
    download?: DownloadResult
    set?: SetHashResult
    duplicate?: boolean | 'throw'
    throwOnLoad?: boolean
  } = {},
) {
  const calls = { load: [] as unknown[], download: [] as string[], set: [] as unknown[], dup: [] as unknown[], logs: [] as unknown[] }
  const deps: PhotoHashDeps = {
    getAuthUserIdFromJwt: async () => ('authId' in opts ? (opts.authId ?? null) : 'auth-1'),
    getActiveProfile: async () => ('caller' in opts ? (opts.caller ?? null) : author),
    loadRow: async (table, id) => {
      calls.load.push({ table, id })
      if (opts.throwOnLoad) throw new Error('db down')
      return 'row' in opts ? (opts.row ?? null) : { company_id: CO, created_by: 'p-author', path: PATH, deleted: false }
    },
    downloadPhoto: async (path) => {
      calls.download.push(path)
      return opts.download ?? { ok: true, bytes: BYTES }
    },
    setPhotoHash: async (table, id, sha) => {
      calls.set.push({ table, id, sha })
      return opts.set ?? { ok: true, stored: true }
    },
    hasDuplicate: async (companyId, table, id, sha) => {
      calls.dup.push({ companyId, table, id, sha })
      if (opts.duplicate === 'throw') throw new Error('count down')
      return opts.duplicate ?? false
    },
    log: (...a) => calls.logs.push(a),
  }
  return { deps, calls }
}

const body = (over: Record<string, unknown> = {}) => ({ table: 'movements', id: ID, ...over })

describe('photo-hash', () => {
  it('muallif: xesh hisoblanadi, RPC chaqiriladi, 200 { sha256, duplicate }', async () => {
    const f = fake()
    const r = await handlePhotoHash(AUTH, body(), f.deps)
    expect(r).toEqual({ status: 200, body: { sha256: SHA, duplicate: false } })
    expect(f.calls.download).toEqual([PATH])
    expect(f.calls.set).toEqual([{ table: 'movements', id: ID, sha: SHA }])
    expect(f.calls.dup).toEqual([{ companyId: CO, table: 'movements', id: ID, sha: SHA }])
  })

  it('purchases, takroriy rasm → duplicate: true', async () => {
    const f = fake({ duplicate: true })
    const r = await handlePhotoHash(AUTH, body({ table: 'purchases', id: ID.toUpperCase() }), f.deps)
    expect(r).toEqual({ status: 200, body: { sha256: SHA, duplicate: true } })
    expect(f.calls.load).toEqual([{ table: 'purchases', id: ID }])
  })

  it('admin (muallif emas) — ruxsat; boshqa rol (muallif emas) — 403', async () => {
    const admin = fake({ caller: { id: 'p-admin', company_id: CO, role: 'admin' } })
    expect((await handlePhotoHash(AUTH, body(), admin.deps)).status).toBe(200)
    const other = fake({ caller: { id: 'p-other', company_id: CO, role: 'omborchi' } })
    expect(await handlePhotoHash(AUTH, body(), other.deps)).toEqual({ status: 403, body: { error: 'forbidden' } })
    expect(other.calls.download).toEqual([])
  })

  it('boshqa firma yozuvi → 403 (admin ham); super_admin — ruxsat', async () => {
    const row = { company_id: OTHER_CO, created_by: 'x', path: `${OTHER_CO}/2026/10/44444444-4444-4444-8444-444444444444.png`, deleted: false }
    expect((await handlePhotoHash(AUTH, body(), fake({ row, caller: { id: 'a', company_id: CO, role: 'admin' } }).deps)).status).toBe(403)
    expect((await handlePhotoHash(AUTH, body(), fake({ row, caller: { id: 's', company_id: CO, role: 'super_admin' } }).deps)).status).toBe(200)
  })

  it('JWT yo‘q / anon → 401; faol profil yo‘q → 403', async () => {
    expect((await handlePhotoHash(null, body(), fake().deps)).status).toBe(401)
    expect((await handlePhotoHash(AUTH, body(), fake({ authId: null }).deps)).status).toBe(401)
    expect((await handlePhotoHash(AUTH, body(), fake({ caller: null }).deps)).status).toBe(403)
  })

  it.each([
    [null],
    [{}],
    [{ table: 'profiles', id: ID }],
    [{ table: 'movements', id: 'x' }],
    [{ table: 'movements' }],
  ])('yaroqsiz body → 400 invalid_request (%j), baza chaqirilmaydi', async (b) => {
    const f = fake()
    expect(await handlePhotoHash(AUTH, b, f.deps)).toEqual({ status: 400, body: { error: 'invalid_request' } })
    expect(f.calls.load).toEqual([])
  })

  it('yozuv yo‘q / o‘chirilgan → 404 not_found', async () => {
    expect(await handlePhotoHash(AUTH, body(), fake({ row: null }).deps)).toEqual({ status: 404, body: { error: 'not_found' } })
    expect((await handlePhotoHash(AUTH, body(), fake({ row: { company_id: CO, created_by: 'p-author', path: PATH, deleted: true } }).deps)).status).toBe(404)
  })

  it('rasm yo‘q → 404 photo_not_found; fayl topilmadi → 404 photo_not_found', async () => {
    const noPhoto = fake({ row: { company_id: CO, created_by: 'p-author', path: null, deleted: false } })
    expect(await handlePhotoHash(AUTH, body(), noPhoto.deps)).toEqual({ status: 404, body: { error: 'photo_not_found' } })
    const missing = fake({ download: { ok: false, reason: 'not_found' } })
    expect((await handlePhotoHash(AUTH, body(), missing.deps)).body).toEqual({ error: 'photo_not_found' })
  })

  it('yo‘l boshqa firma papkasida / noto‘g‘ri format → 400 photo_path_invalid, o‘qilmaydi', async () => {
    for (const path of [`${OTHER_CO}/2026/10/44444444-4444-4444-8444-444444444444.jpg`, `${CO}/../x.jpg`, `${CO}/2026/10/a.gif`]) {
      const f = fake({ row: { company_id: CO, created_by: 'p-author', path, deleted: false } })
      expect(await handlePhotoHash(AUTH, body(), f.deps)).toEqual({ status: 400, body: { error: 'photo_path_invalid' } })
      expect(f.calls.download).toEqual([])
    }
  })

  it('> 5 MB → 400 photo_too_large (deps xabari yoki baytlar soni)', async () => {
    expect((await handlePhotoHash(AUTH, body(), fake({ download: { ok: false, reason: 'too_large' } }).deps)).body).toEqual({
      error: 'photo_too_large',
    })
    const big = fake({ download: { ok: true, bytes: new Uint8Array(MAX_PHOTO_BYTES + 1) } })
    expect((await handlePhotoHash(AUTH, body(), big.deps)).body).toEqual({ error: 'photo_too_large' })
    expect(big.calls.set).toEqual([])
  })

  it('RPC rad etdi → 400 photo_hash_invalid; stored = false → 404', async () => {
    expect((await handlePhotoHash(AUTH, body(), fake({ set: { ok: false, reason: 'invalid' } }).deps)).body).toEqual({
      error: 'photo_hash_invalid',
    })
    expect((await handlePhotoHash(AUTH, body(), fake({ set: { ok: true, stored: false } }).deps)).status).toBe(404)
  })

  it('takroriylik tekshiruvi xatosi — baribir 200 (duplicate: false); ichki xato → 500', async () => {
    expect((await handlePhotoHash(AUTH, body(), fake({ duplicate: 'throw' }).deps)).body).toEqual({ sha256: SHA, duplicate: false })
    expect(await handlePhotoHash(AUTH, body(), fake({ throwOnLoad: true }).deps)).toEqual({ status: 500, body: { error: 'internal' } })
  })

  it('sha256Hex — node:crypto bilan bir xil; photoPathAllowed registrga sezgir emas (firma id)', async () => {
    expect(await sha256Hex(BYTES)).toBe(SHA)
    expect(await sha256Hex(new Uint8Array())).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855')
    expect(photoPathAllowed(PATH, CO.toUpperCase())).toBe(true)
  })
})
