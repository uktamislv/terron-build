import { createMovement, listMovements } from './movementsRepo'
import { photoPath } from './photosRepo'

type Call = [string, ...unknown[]]

const fake = vi.hoisted(() => ({
  calls: [] as [string, ...unknown[]][],
  results: [] as unknown[],
  /** `profile_directory` qatorlari (ismlar ikkinchi so'rovda). */
  people: [] as { id: string; company_id?: string; full_name: string; role: string; is_active?: boolean }[],
}))

function fakeQuery(calls: Call[], result: () => unknown): unknown {
  const q: unknown = new Proxy(
    {},
    {
      get(_target, prop: string) {
        if (prop === 'then') {
          return (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
            Promise.resolve(result()).then(resolve, reject)
        }
        return (...args: unknown[]) => {
          calls.push([prop, ...args])
          return q
        }
      },
    },
  )
  return q
}

vi.mock('./supabaseClient', () => ({
  isSupabaseConfigured: () => true,
  getSupabase: () => ({
    from: (table: string) => {
      fake.calls.push(['from', table])
      if (table === 'profile_directory') return fakeQuery(fake.calls, () => ({ data: fake.people, error: null }))
      return fakeQuery(fake.calls, () => fake.results.shift())
    },
  }),
}))

beforeEach(() => {
  fake.calls.length = 0
  fake.results.length = 0
  fake.people.length = 0
})

const arg = (method: string) => fake.calls.find((c) => c[0] === method)?.[1]

const raw = {
  id: 'mv1',
  type: 'kirim',
  qty_input: '3',
  qty_base: '150',
  object: { name: 'Obyekt A' },
  material: { name: 'Sement', base_unit: 'kg' },
  creator: { full_name: 'Ali' },
}

describe('movementsRepo', () => {
  it('createMovement: qty satr, qty_base va occurred_at yuborilmaydi; javob nomlar bilan', async () => {
    fake.results.push({ data: raw, error: null })
    const saved = await createMovement({
      id: 'd1',
      companyId: 'c',
      type: 'kirim',
      objectId: 'o',
      materialId: 'm',
      unitId: 'u',
      qtyInput: '3',
      note: '  ',
    })
    const row = arg('insert') as Record<string, unknown>
    expect(row).toEqual({
      id: 'd1',
      company_id: 'c',
      type: 'kirim',
      object_id: 'o',
      material_id: 'm',
      unit_id: 'u',
      qty_input: '3',
      note: null,
      photo_path: null,
    })
    expect(String(arg('select'))).toContain('qty_base::text')
    expect(saved).toMatchObject({ qty_base: '150', object_name: 'Obyekt A', material_name: 'Sement', base_unit: 'kg' })
  })

  it('createMovement: qayta urinishda 23505 (shu id saqlangan) — saqlangan qator qaytadi', async () => {
    fake.results.push({ data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint "movements_pkey"', hint: null } })
    fake.results.push({ data: { ...raw, object_id: 'o', material_id: 'm', unit_id: 'u', qty_input: '3.000000' }, error: null })
    const saved = await createMovement({ id: 'd1', companyId: 'c', type: 'kirim', objectId: 'o', materialId: 'm', unitId: 'u', qtyInput: '3' })
    expect(saved.id).toBe('mv1')
    expect(fake.calls.filter((c) => c[0] === 'eq')).toEqual([['eq', 'id', 'd1']])
  })

  it('createMovement: 23505, lekin saqlangan qator BOSHQA yozuv (miqdor yoki tur farq qiladi) — draft_conflict', async () => {
    const input = { id: 'd1', companyId: 'c', type: 'kirim' as const, objectId: 'o', materialId: 'm', unitId: 'u', qtyInput: '4' }
    const same = { ...raw, object_id: 'o', material_id: 'm', unit_id: 'u' }
    fake.results.push({ data: null, error: { code: '23505', message: 'dup "movements_pkey"', hint: null } })
    fake.results.push({ data: same, error: null })
    await expect(createMovement(input)).rejects.toMatchObject({ code: 'draft_conflict' })
    fake.results.push({ data: null, error: { code: '23505', message: 'dup "movements_pkey"', hint: null } })
    fake.results.push({ data: { ...same, type: 'chiqim' }, error: null })
    await expect(createMovement({ ...input, qtyInput: '3' })).rejects.toMatchObject({ code: 'draft_conflict' })
  })

  it('createMovement: 23505 va qator topilmasa — duplicate xatosi', async () => {
    fake.results.push({ data: null, error: { code: '23505', message: 'dup "movements_pkey"', hint: null } })
    fake.results.push({ data: null, error: { code: 'PGRST116', message: 'none' } })
    await expect(
      createMovement({ id: 'd1', companyId: 'c', type: 'kirim', objectId: 'o', materialId: 'm', unitId: 'u', qtyInput: '3' }),
    ).rejects.toMatchObject({ code: 'duplicate' })
  })

  it('createMovement: hint bilan 23505 (ops_photo_reused) yoki boshqa unique — qayta o‘qilmaydi, xato', async () => {
    fake.results.push({ data: null, error: { code: '23505', message: 'Rasm band', hint: 'ops_photo_reused' } })
    const input = { id: 'd1', companyId: 'c', type: 'kirim' as const, objectId: 'o', materialId: 'm', unitId: 'u', qtyInput: '3' }
    await expect(createMovement(input)).rejects.toMatchObject({ code: 'ops_photo_reused' })
    fake.results.push({ data: null, error: { code: '23505', message: 'violates "other_key"', hint: null } })
    await expect(createMovement(input)).rejects.toMatchObject({ code: 'duplicate' })
    expect(fake.calls.filter((c) => c[0] === 'eq')).toEqual([])
  })

  it('listMovements: filtrlar, occurred_at desc, 50 lik sahifa, count exact', async () => {
    fake.results.push({ data: [raw], error: null, count: 120 })
    const page = await listMovements({ objectId: 'o', type: 'chiqim', from: 'A', to: 'B' }, 2)
    expect(page.total).toBe(120)
    expect(fake.calls.find((c) => c[0] === 'select')?.[2]).toEqual({ count: 'exact' })
    expect(fake.calls.filter((c) => c[0] === 'eq').map((c) => c.slice(1))).toEqual([
      ['object_id', 'o'],
      ['type', 'chiqim'],
    ])
    expect(arg('is')).toBe('deleted_at')
    expect(fake.calls.find((c) => c[0] === 'gte')).toEqual(['gte', 'occurred_at', 'A'])
    expect(fake.calls.find((c) => c[0] === 'lt')).toEqual(['lt', 'occurred_at', 'B'])
    expect(fake.calls.find((c) => c[0] === 'order')).toEqual(['order', 'occurred_at', { ascending: false }])
    expect(fake.calls.find((c) => c[0] === 'range')).toEqual(['range', 100, 149])
  })
})

describe('photoPath', () => {
  it('{company_id}/{yyyy}/{mm}/{uuid}.jpg — kichik harf, Toshkent oyi', () => {
    const company = '00000000-0000-0000-0000-00000000C001'
    const p = photoPath(company, 'image/jpeg', new Date('2026-10-31T20:00:00Z'))
    expect(p).toMatch(/^[0-9a-f-]{36}\/[0-9]{4}\/[0-9]{2}\/[0-9a-f-]{36}\.(jpg|jpeg|png|webp)$/)
    expect(p.startsWith('00000000-0000-0000-0000-00000000c001/2026/11/')).toBe(true)
  })
})

describe('photosRepo xatolari', () => {
  it('Storage xatolari aniq kodlarga', async () => {
    const { toPhotoError } = await import('./photosRepo')
    expect(toPhotoError({ statusCode: '413', message: 'Payload too large' }).code).toBe('photo_too_large')
    expect(toPhotoError({ message: 'The object exceeded the maximum allowed size' }).code).toBe('photo_too_large')
    expect(toPhotoError({ statusCode: '415', message: 'x' }).code).toBe('photo_type')
    expect(toPhotoError({ message: 'mime type image/heic is not supported' }).code).toBe('photo_type')
    expect(toPhotoError({ statusCode: '403', message: 'new row violates row-level security policy' }).code).toBe('forbidden')
    expect(toPhotoError(new TypeError('Failed to fetch')).code).toBe('photo_upload_failed')
  })

  it('ruxsat etilmagan tur yuklanmaydi', async () => {
    const { uploadPhoto } = await import('./photosRepo')
    await expect(uploadPhoto(new Blob(['x'], { type: 'image/heic' }), 'c')).rejects.toMatchObject({ code: 'photo_type' })
  })

  it('isPhotoError: rasm kodlari va ops_photo_* hint’lari', async () => {
    const { isPhotoError } = await import('./photosRepo')
    const { toRepoError, RepoError } = await import('./errors')
    expect(isPhotoError(new RepoError('photo_upload_failed'))).toBe(true)
    expect(isPhotoError(toRepoError({ code: '23514', hint: 'ops_photo_reused' }))).toBe(true)
    expect(isPhotoError(toRepoError({ code: '42501', hint: 'ops_photo_not_owned' }))).toBe(true)
    expect(isPhotoError(new RepoError('network'))).toBe(false)
  })
})
