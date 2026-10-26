// saveImport — to'qnashuv yo'llari: material nomi band → mavjudini ishlatish; birlik boshqa
// koeffitsient bilan band → xato; muqobil nom band → jim o'tkaziladi; progress'dan davom etish
// (takrorsiz); qayta urinish idempotent; super_admin (bir nechta firma materiallarini ko'radi) —
// mavjud material faqat o'z firmasidan olinadi.
import { RepoError } from '@/data/errors'
import type { Material, MaterialUnit } from '@/data/types'
import { emptyProgress, saveImport, type SaveInput } from './saveImport'
import type { Plan } from './wizardModel'

const repo = vi.hoisted(() => ({
  createMaterial: vi.fn(),
  getMaterial: vi.fn(),
  listMaterials: vi.fn(),
  addMaterialUnit: vi.fn(),
  addMaterialAlias: vi.fn(),
  importEstimate: vi.fn(),
  saveTemplate: vi.fn(),
}))

vi.mock('@/data/materialsRepo', async (orig) => ({
  ...(await orig<typeof import('@/data/materialsRepo')>()),
  createMaterial: repo.createMaterial,
  getMaterial: repo.getMaterial,
  listMaterials: repo.listMaterials,
}))
vi.mock('@/data/materialUnitsRepo', () => ({ addMaterialUnit: repo.addMaterialUnit }))
vi.mock('@/data/materialAliasesRepo', () => ({ addMaterialAlias: repo.addMaterialAlias }))
vi.mock('@/data/estimatesRepo', () => ({ importEstimate: repo.importEstimate }))
vi.mock('@/data/estimateTemplatesRepo', () => ({ saveTemplate: repo.saveTemplate }))

const CO = 'co-A'
const OTHER_CO = 'co-B'

function unit(id: string, materialId: string, u: string, factor: string, company = CO, variant: string | null = null): MaterialUnit {
  return { id, company_id: company, material_id: materialId, unit: u, factor, variant, created_at: '', updated_at: '' }
}

function material(id: string, name: string, baseUnit: string, company = CO, extra: MaterialUnit[] = []): Material {
  return {
    id,
    company_id: company,
    name,
    base_unit: baseUnit,
    category: null,
    waste_pct: '0',
    is_active: true,
    created_by: null,
    created_at: '',
    updated_at: '',
    units: [unit(`${id}-base`, id, baseUnit, '1', company), ...extra],
    aliases: [],
  }
}

function plan(p: Partial<Pick<Plan, 'newMaterials' | 'newUnits' | 'aliases'>>): Plan {
  return { rows: [], newMaterials: [], newUnits: [], aliases: [], ...p } as unknown as Plan
}

function input(pl: Plan, template: SaveInput['template'] = null): SaveInput {
  return {
    plan: pl,
    companyId: CO,
    estimateId: 'est-1',
    objectId: 'obj-1',
    title: 'Smeta',
    sourceFileName: null,
    estimateDate: null,
    template,
  }
}

const SEMENT = { key: 'new:sement', name: 'Sement M500', baseUnit: 'kg' }
const QOP = { questionKey: 'q1', materialKey: 'new:sement', materialName: 'Sement M500', unit: 'qop', factor: '50', variant: '' }

beforeEach(() => {
  for (const f of Object.values(repo)) f.mockReset()
  repo.importEstimate.mockResolvedValue('est-1')
  repo.saveTemplate.mockResolvedValue(undefined)
})

describe('materiallar', () => {
  it('material_name_taken → katalogdagi mavjud material ishlatiladi (nom va birlik normallashtirilgan)', async () => {
    repo.createMaterial.mockRejectedValue(new RepoError('material_name_taken'))
    repo.listMaterials.mockResolvedValue([material('m-old', '  sement m500 ', 'KG')])
    const progress = emptyProgress()
    await saveImport(input(plan({ newMaterials: [SEMENT] })), progress)
    expect(progress.materials['new:sement']).toEqual({ id: 'm-old', baseUnitId: 'm-old-base' })
  })

  it('nom band, lekin katalogda topilmadi (boshqa asosiy birlik) — asl xato qayta otiladi', async () => {
    const err = new RepoError('material_name_taken')
    repo.createMaterial.mockRejectedValue(err)
    repo.listMaterials.mockResolvedValue([material('m-old', 'Sement M500', 'qop')])
    await expect(saveImport(input(plan({ newMaterials: [SEMENT] })), emptyProgress())).rejects.toBe(err)
    expect(repo.importEstimate).not.toHaveBeenCalled()
  })

  it('boshqa xato (masalan ruxsat) — to`xtaydi, katalog qidirilmaydi', async () => {
    repo.createMaterial.mockRejectedValue(new RepoError('forbidden'))
    await expect(saveImport(input(plan({ newMaterials: [SEMENT] })), emptyProgress())).rejects.toBeInstanceOf(RepoError)
    expect(repo.listMaterials).not.toHaveBeenCalled()
  })

  it('super_admin: listMaterials boshqa firma materialini ham qaytaradi — faqat o`z firmasi (companyId) olinadi', async () => {
    repo.createMaterial.mockRejectedValue(new RepoError('material_name_taken'))
    // Boshqa firmaning aynan shu nomli materiali ro'yxatda birinchi
    repo.listMaterials.mockResolvedValue([material('m-foreign', 'Sement M500', 'kg', OTHER_CO), material('m-own', 'Sement M500', 'kg')])
    const progress = emptyProgress()
    await saveImport(input(plan({ newMaterials: [SEMENT] })), progress)
    expect(progress.materials['new:sement']?.id).toBe('m-own')
  })

  it('super_admin: o`z firmasida yo`q (faqat boshqa firmada) — asl xato, begona material ishlatilmaydi', async () => {
    const err = new RepoError('material_name_taken')
    repo.createMaterial.mockRejectedValue(err)
    repo.listMaterials.mockResolvedValue([material('m-foreign', 'Sement M500', 'kg', OTHER_CO)])
    await expect(saveImport(input(plan({ newMaterials: [SEMENT] })), emptyProgress())).rejects.toBe(err)
  })
})

describe('birliklar', () => {
  it('unit_taken, katalogda bir xil koeffitsient ("50" = "50.0000000000") — mavjudi ishlatiladi', async () => {
    repo.createMaterial.mockResolvedValue(material('m1', 'Sement M500', 'kg'))
    repo.addMaterialUnit.mockRejectedValue(new RepoError('unit_taken'))
    repo.getMaterial.mockResolvedValue(material('m1', 'Sement M500', 'kg', CO, [unit('u-qop', 'm1', 'qop', '50.0000000000')]))
    const progress = emptyProgress()
    await saveImport(input(plan({ newMaterials: [SEMENT], newUnits: [QOP] })), progress)
    expect(progress.units).toEqual({ q1: 'u-qop' })
    expect(repo.getMaterial).toHaveBeenCalledWith('m1')
  })

  it('shu nomli birlik BOSHQA koeffitsient bilan — xato (jim almashtirilmaydi), smeta saqlanmaydi', async () => {
    const err = new RepoError('catalog_unit_duplicate')
    repo.createMaterial.mockResolvedValue(material('m1', 'Sement M500', 'kg'))
    repo.addMaterialUnit.mockRejectedValue(err)
    repo.getMaterial.mockResolvedValue(material('m1', 'Sement M500', 'kg', CO, [unit('u-qop', 'm1', 'qop', '25')]))
    const progress = emptyProgress()
    await expect(saveImport(input(plan({ newMaterials: [SEMENT], newUnits: [QOP] })), progress)).rejects.toBe(err)
    expect(progress.units).toEqual({})
    expect(repo.importEstimate).not.toHaveBeenCalled()
  })

  it('unit_taken, lekin katalogda topilmadi — xato', async () => {
    const err = new RepoError('unit_taken')
    repo.createMaterial.mockResolvedValue(material('m1', 'Sement M500', 'kg'))
    repo.addMaterialUnit.mockRejectedValue(err)
    repo.getMaterial.mockResolvedValue(material('m1', 'Sement M500', 'kg'))
    await expect(saveImport(input(plan({ newMaterials: [SEMENT], newUnits: [QOP] })), emptyProgress())).rejects.toBe(err)
  })
})

describe('muqobil nomlar', () => {
  it('alias_taken / catalog_alias_duplicate — jim o`tkaziladi, smeta saqlanadi; boshqa xato — to`xtaydi', async () => {
    repo.addMaterialAlias.mockRejectedValueOnce(new RepoError('alias_taken')).mockRejectedValueOnce(new RepoError('catalog_alias_duplicate'))
    const progress = emptyProgress()
    const id = await saveImport(
      input(
        plan({
          aliases: [
            { materialKey: 'm-exist', materialName: 'Sement', alias: 'Цемент М500' },
            { materialKey: 'm-exist', materialName: 'Sement', alias: 'Portlandsement' },
          ],
        }),
      ),
      progress,
    )
    expect(id).toBe('est-1')
    expect(Object.keys(progress.aliases)).toHaveLength(2)
    expect(repo.addMaterialAlias.mock.calls.map((c) => (c[0] as { lang: string }).lang)).toEqual(['ru', 'uz'])

    repo.addMaterialAlias.mockReset()
    repo.addMaterialAlias.mockRejectedValue(new RepoError('forbidden'))
    await expect(
      saveImport(input(plan({ aliases: [{ materialKey: 'm-exist', materialName: 'S', alias: 'X' }] })), emptyProgress()),
    ).rejects.toBeInstanceOf(RepoError)
  })
})

describe('davom etish va qayta urinish', () => {
  const full = (): Plan =>
    plan({
      newMaterials: [SEMENT, { key: 'new:qum', name: 'Qum', baseUnit: 'm³' }],
      newUnits: [QOP],
      aliases: [{ materialKey: 'new:sement', materialName: 'Sement M500', alias: 'Цемент' }],
    })

  it('birinchi urinish smetada yiqildi → qayta urinishda material/birlik/alias takrorlanmaydi', async () => {
    repo.createMaterial.mockImplementation(async (m: { name: string; baseUnit: string }) =>
      material(m.name === 'Qum' ? 'm-qum' : 'm-sem', m.name, m.baseUnit),
    )
    repo.addMaterialUnit.mockResolvedValue(unit('u-qop', 'm-sem', 'qop', '50'))
    repo.addMaterialAlias.mockResolvedValue({})
    repo.importEstimate.mockRejectedValueOnce(new Error('tarmoq')).mockResolvedValueOnce('est-1')
    const progress = emptyProgress()
    const pl = full()
    await expect(saveImport(input(pl), progress)).rejects.toThrow('tarmoq')
    expect(progress.estimateId).toBeNull()
    expect(progress.materials).toEqual({
      'new:sement': { id: 'm-sem', baseUnitId: 'm-sem-base' },
      'new:qum': { id: 'm-qum', baseUnitId: 'm-qum-base' },
    })

    const steps: string[] = []
    expect(await saveImport(input(pl), progress, (s) => steps.push(s))).toBe('est-1')
    expect(repo.createMaterial).toHaveBeenCalledTimes(2)
    expect(repo.addMaterialUnit).toHaveBeenCalledTimes(1)
    expect(repo.addMaterialAlias).toHaveBeenCalledTimes(1)
    expect(repo.importEstimate).toHaveBeenCalledTimes(2)
    // Ikkala chaqiruvda bir xil klient id — server tomonida idempotent
    expect(repo.importEstimate.mock.calls.map((c) => (c[0] as { id: string }).id)).toEqual(['est-1', 'est-1'])
    expect(steps).toEqual(['materials', 'units', 'aliases', 'estimate', 'template'])
  })

  it('yarim yo`lda (ikkinchi material) yiqilsa — birinchisi eslab qolinadi, qayta urinishda faqat ikkinchisi yaratiladi', async () => {
    repo.createMaterial
      .mockResolvedValueOnce(material('m-sem', 'Sement M500', 'kg'))
      .mockRejectedValueOnce(new Error('tarmoq'))
      .mockResolvedValueOnce(material('m-qum', 'Qum', 'm³'))
    repo.addMaterialUnit.mockResolvedValue(unit('u-qop', 'm-sem', 'qop', '50'))
    repo.addMaterialAlias.mockResolvedValue({})
    const progress = emptyProgress()
    await expect(saveImport(input(full()), progress)).rejects.toThrow('tarmoq')
    expect(Object.keys(progress.materials)).toEqual(['new:sement'])
    await saveImport(input(full()), progress)
    expect(repo.createMaterial.mock.calls.map((c) => (c[0] as { name: string }).name)).toEqual(['Sement M500', 'Qum', 'Qum'])
    expect(repo.addMaterialUnit.mock.calls[0]?.[0]).toMatchObject({ materialId: 'm-sem', unit: 'qop', factor: '50', companyId: CO })
  })

  it('to`liq saqlangandan keyin qayta chaqiruv — hech narsa qayta yaratilmaydi, o`sha smeta id', async () => {
    repo.createMaterial.mockImplementation(async (m: { name: string; baseUnit: string }) => material(`id-${m.name}`, m.name, m.baseUnit))
    repo.addMaterialUnit.mockResolvedValue(unit('u-qop', 'id-Sement M500', 'qop', '50'))
    repo.addMaterialAlias.mockResolvedValue({})
    const progress = emptyProgress()
    const first = await saveImport(input(full()), progress)
    const second = await saveImport(input(full()), progress)
    expect(second).toBe(first)
    expect(repo.createMaterial).toHaveBeenCalledTimes(2)
    expect(repo.addMaterialUnit).toHaveBeenCalledTimes(1)
    expect(repo.addMaterialAlias).toHaveBeenCalledTimes(1)
    expect(repo.importEstimate).toHaveBeenCalledTimes(1)
  })

  it('shablon xatosi smetani bekor qilmaydi', async () => {
    repo.saveTemplate.mockRejectedValue(new Error('x'))
    const id = await saveImport(
      input(plan({}), { signature: 'a|b', mapping: { name: 0 }, sheetName: null, headerRow: 0, name: 'Shablon' }),
      emptyProgress(),
    )
    expect(id).toBe('est-1')
    expect(repo.saveTemplate).toHaveBeenCalledWith(expect.objectContaining({ companyId: CO, headerSignature: 'a|b' }))
  })
})
