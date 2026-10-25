import { addMaterialAlias, softDeleteMaterialAlias } from './materialAliasesRepo'
import { createMaterial, listMaterials, softDeleteMaterial, updateMaterial } from './materialsRepo'
import { addMaterialUnit, softDeleteMaterialUnit } from './materialUnitsRepo'
import { removeObjectMember } from './objectMembersRepo'
import { softDeleteObject } from './objectsRepo'
import { softDeleteProfile } from './profilesRepo'

type Call = [string, ...unknown[]]

const fake = vi.hoisted(() => ({ calls: [] as [string, ...unknown[]][], results: [] as unknown[] }))

/** Zanjirli PostgREST so'rovining soxtasi: chaqiruvlarni yozadi, await qilinganda navbatdagi natijani qaytaradi. */
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
      return fakeQuery(fake.calls, () => fake.results.shift())
    },
  }),
}))

beforeEach(() => {
  fake.calls.length = 0
  fake.results.length = 0
})

const unitRow = (id: string, unit: string, factor: string, extra: Record<string, unknown> = {}) => ({
  id,
  company_id: 'c',
  material_id: 'm1',
  unit,
  factor,
  variant: null,
  created_at: '2026-10-01T00:00:00Z',
  updated_at: '2026-10-01T00:00:00Z',
  deleted_at: null,
  ...extra,
})

const materialRow = (extra: Record<string, unknown> = {}) => ({
  id: 'm1',
  company_id: 'c',
  name: 'Qum',
  base_unit: 'm³',
  category: null,
  waste_pct: '0',
  is_active: true,
  created_by: null,
  created_at: '',
  updated_at: '',
  units: [],
  aliases: [],
  ...extra,
})

const firstArg = (method: string) => fake.calls.find((c) => c[0] === method)?.[1]

describe('materialsRepo.listMaterials', () => {
  it('bitta so‘rov: embed aniq FK bilan, numeric ::text, o‘chirilganlar filtrlanadi', async () => {
    fake.results.push({ data: [], error: null })
    await listMaterials()
    expect(fake.calls[0]).toEqual(['from', 'materials'])
    expect(fake.calls.filter((c) => c[0] === 'from')).toHaveLength(1)
    const select = String(firstArg('select'))
    expect(select).toContain('waste_pct::text')
    expect(select).toContain('factor::text')
    expect(select).toContain('units:material_units!material_units_material_fkey(')
    expect(select).toContain('aliases:material_aliases!material_aliases_material_fkey(')
    const isCalls = fake.calls.filter((c) => c[0] === 'is').map((c) => c[1])
    expect(isCalls).toEqual(['deleted_at', 'units.deleted_at', 'aliases.deleted_at'])
  })

  it('koeffitsient satr bo‘lib qoladi; asosiy birlik birinchi; o‘chirilgan qator tashlanadi', async () => {
    fake.results.push({
      data: [
        materialRow({
          waste_pct: '2.50',
          units: [
            unitRow('u2', 'tonna', '0.6667000000', { created_at: '2026-09-01T00:00:00Z' }),
            unitRow('u1', 'm³', '1.0000000000', { created_at: '2026-10-05T00:00:00Z' }),
            unitRow('u3', 'kamaz', '10', { deleted_at: '2026-10-02T00:00:00Z' }),
          ],
          aliases: [
            { id: 'a1', company_id: 'c', material_id: 'm1', alias: 'Песок', lang: 'ru', created_at: '', updated_at: '', deleted_at: null },
          ],
        }),
      ],
      error: null,
    })
    const [m] = await listMaterials()
    expect(m?.units.map((u) => u.id)).toEqual(['u1', 'u2'])
    expect(m?.units[1]?.factor).toBe('0.6667000000')
    expect(m?.units[0]).not.toHaveProperty('deleted_at')
    expect(m?.waste_pct).toBe('2.50')
    expect(m?.aliases.map((a) => a.alias)).toEqual(['Песок'])
  })
})

describe('materialsRepo yozish', () => {
  it('createMaterial: trim, vergulli isrof → nuqta, keyin to‘liq qayta o‘qiladi', async () => {
    fake.results.push({ data: { id: 'm1' }, error: null })
    fake.results.push({ data: materialRow({ name: 'Sement', base_unit: 'kg' }), error: null })
    const m = await createMaterial({ companyId: 'c', name: ' Sement ', baseUnit: 'kg', category: ' ', wastePct: '1,5' })
    expect(m.name).toBe('Sement')
    expect(firstArg('insert')).toEqual({
      company_id: 'c',
      name: 'Sement',
      base_unit: 'kg',
      category: null,
      waste_pct: '1.5',
    })
  })

  it('updateMaterial: faqat berilgan maydonlar; qator qaytishi tekshiriladi', async () => {
    fake.results.push({ data: { id: 'm1' }, error: null })
    await updateMaterial('m1', { isActive: false })
    expect(firstArg('update')).toEqual({ is_active: false })
    expect(fake.calls.map((c) => c[0])).toEqual(['from', 'update', 'eq', 'select', 'single'])
    expect(firstArg('select')).toBe('id')
  })

  it('updateMaterial: qator yangilanmasa (PGRST116) → not_found', async () => {
    fake.results.push({ data: null, error: { code: 'PGRST116', message: 'JSON object requested, 0 rows' } })
    await expect(updateMaterial('m1', { name: 'X' })).rejects.toMatchObject({ code: 'not_found' })
  })

  it('nom band (23505) → material_name_taken', async () => {
    fake.results.push({ data: null, error: { code: '23505', message: 'duplicate key' } })
    await expect(createMaterial({ companyId: 'c', name: 'Qum', baseUnit: 'm³' })).rejects.toMatchObject({
      code: 'material_name_taken',
    })
  })

  it('addMaterialUnit: koeffitsient satr sifatida yuboriladi, bo‘sh variant → null', async () => {
    fake.results.push({ data: unitRow('u9', 'qop', '50'), error: null })
    await addMaterialUnit({ companyId: 'c', materialId: 'm1', unit: ' qop ', factor: '50', variant: '  ' })
    expect(firstArg('insert')).toEqual({ company_id: 'c', material_id: 'm1', unit: 'qop', factor: '50', variant: null })
    expect(String(firstArg('select'))).toContain('factor::text')
  })

  it('birlik band → unit_taken; muqobil nom band → alias_taken', async () => {
    fake.results.push({ data: null, error: { code: '23505', message: 'x' } })
    await expect(addMaterialUnit({ companyId: 'c', materialId: 'm1', unit: 'qop', factor: '50' })).rejects.toMatchObject({
      code: 'unit_taken',
    })
    fake.results.push({ data: null, error: { code: '23505', message: 'x' } })
    await expect(addMaterialAlias({ companyId: 'c', materialId: 'm1', alias: 'Песок', lang: 'ru' })).rejects.toMatchObject({
      code: 'alias_taken',
    })
  })
})

describe('soft delete — barcha repo’lar: deleted_at yuboriladi, qator qaytmasa not_found', () => {
  const cases: [string, string, (id: string) => Promise<void>][] = [
    ['materials', 'softDeleteMaterial', softDeleteMaterial],
    ['material_units', 'softDeleteMaterialUnit', softDeleteMaterialUnit],
    ['material_aliases', 'softDeleteMaterialAlias', softDeleteMaterialAlias],
    ['profiles', 'softDeleteProfile', softDeleteProfile],
    ['objects', 'softDeleteObject', softDeleteObject],
    ['object_members', 'removeObjectMember', removeObjectMember],
  ]

  it.each(cases)('%s (%s): update + select(id).single()', async (table, _name, fn) => {
    fake.results.push({ data: { id: 'x1' }, error: null })
    await fn('x1')
    expect(fake.calls[0]).toEqual(['from', table])
    const update = firstArg('update') as { deleted_at: unknown }
    expect(typeof update.deleted_at).toBe('string')
    expect(fake.calls.find((c) => c[0] === 'eq')).toEqual(['eq', 'id', 'x1'])
    expect(firstArg('select')).toBe('id')
    expect(fake.calls.some((c) => c[0] === 'single')).toBe(true)
  })

  it.each(cases)('%s (%s): 0 qator → not_found', async (_table, _name, fn) => {
    fake.results.push({ data: null, error: { code: 'PGRST116', message: '0 rows' } })
    await expect(fn('x1')).rejects.toMatchObject({ code: 'not_found' })
  })
})
