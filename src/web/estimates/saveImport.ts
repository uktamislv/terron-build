// Import saqlash ketma-ketligi: yangi materiallar → birliklar → muqobil nomlar → smeta (RPC) → shablon.
// Har bir qadam idempotent: `progress` da yaratilganlar eslab qolinadi, qayta urinishda takrorlanmaydi;
// "allaqachon bor" xatosida katalog qayta o'qilib, mavjud yozuv ishlatiladi.
import { errorCodeOf, type RepoErrorCode } from '@/data/errors'
import { importEstimate } from '@/data/estimatesRepo'
import { saveTemplate } from '@/data/estimateTemplatesRepo'
import { addMaterialAlias } from '@/data/materialAliasesRepo'
import { createMaterial, getMaterial, listMaterials } from '@/data/materialsRepo'
import { addMaterialUnit } from '@/data/materialUnitsRepo'
import type { Material } from '@/data/types'
import { normalizeAlias } from '@/domain/aliases'
import { cmp } from '@/domain/decimal'
import { findUnit } from '@/domain/units'
import { toUnitDef } from '../materials/materialFilter'
import { aliasLangOf, baseUnitIdOf, toImportItems, type Plan } from './wizardModel'

export type SaveStep = 'materials' | 'units' | 'aliases' | 'estimate' | 'template'

export interface SaveProgress {
  materials: Record<string, { id: string; baseUnitId: string }>
  units: Record<string, string>
  aliases: Record<string, true>
  estimateId: string | null
}

export function emptyProgress(): SaveProgress {
  return { materials: {}, units: {}, aliases: {}, estimateId: null }
}

export interface SaveInput {
  plan: Plan
  companyId: string
  /** Klient id — `import_estimate` idempotentligi uchun (usta ochilganda bir marta yaratiladi). */
  estimateId: string
  objectId: string
  title: string
  sourceFileName: string | null
  estimateDate: string | null
  template: { signature: string; mapping: Record<string, number>; sheetName: string | null; headerRow: number | null; name: string } | null
}

const NAME_TAKEN: readonly RepoErrorCode[] = ['material_name_taken', 'catalog_name_duplicate', 'catalog_name_alias_conflict', 'duplicate']
const UNIT_TAKEN: readonly RepoErrorCode[] = ['unit_taken', 'catalog_unit_duplicate', 'duplicate']
const ALIAS_TAKEN: readonly RepoErrorCode[] = ['alias_taken', 'catalog_alias_duplicate', 'catalog_name_alias_conflict', 'duplicate']

async function findMaterialByName(name: string, baseUnit: string): Promise<Material | null> {
  const n = normalizeAlias(name)
  const list = await listMaterials()
  return (
    list.find((m) => normalizeAlias(m.name) === n && normalizeAlias(m.base_unit) === normalizeAlias(baseUnit)) ?? null
  )
}

/** Smetani saqlaydi; `progress` joyida to'ldiriladi. Natija — saqlangan smeta id. */
export async function saveImport(
  input: SaveInput,
  progress: SaveProgress,
  onStep: (step: SaveStep) => void = () => undefined,
): Promise<string> {
  const { plan, companyId } = input

  onStep('materials')
  for (const nm of plan.newMaterials) {
    if (progress.materials[nm.key]) continue
    let material: Material
    try {
      material = await createMaterial({ companyId, name: nm.name, baseUnit: nm.baseUnit })
    } catch (err) {
      if (!NAME_TAKEN.includes(errorCodeOf(err))) throw err
      const existing = await findMaterialByName(nm.name, nm.baseUnit)
      if (!existing) throw err
      material = existing
    }
    const baseUnitId = baseUnitIdOf(material)
    if (!baseUnitId) throw new Error('asosiy birlik topilmadi')
    progress.materials[nm.key] = { id: material.id, baseUnitId }
  }

  const materialIdOf = (key: string): string => {
    if (!key.startsWith('new:')) return key
    const m = progress.materials[key]
    if (!m) throw new Error(`material yaratilmagan: ${key}`)
    return m.id
  }

  onStep('units')
  for (const nu of plan.newUnits) {
    if (progress.units[nu.questionKey]) continue
    const materialId = materialIdOf(nu.materialKey)
    try {
      const unit = await addMaterialUnit({ companyId, materialId, unit: nu.unit, factor: nu.factor, variant: nu.variant })
      progress.units[nu.questionKey] = unit.id
    } catch (err) {
      if (!UNIT_TAKEN.includes(errorCodeOf(err))) throw err
      const material = await getMaterial(materialId)
      const found = findUnit(material.units.map(toUnitDef), nu.unit, nu.variant || null)
      // Shu nomli birlik boshqa koeffitsient bilan bor — jim almashtirmaymiz
      if (!found || cmp(found.factor, nu.factor) !== 0) throw err
      progress.units[nu.questionKey] = found.id
    }
  }

  onStep('aliases')
  for (const a of plan.aliases) {
    const key = `${a.materialKey}|${normalizeAlias(a.alias)}`
    if (progress.aliases[key]) continue
    try {
      await addMaterialAlias({ companyId, materialId: materialIdOf(a.materialKey), alias: a.alias, lang: aliasLangOf(a.alias) })
    } catch (err) {
      // Nom band (boshqa material yoki allaqachon saqlangan) — smetani to'xtatmaydi
      if (!ALIAS_TAKEN.includes(errorCodeOf(err))) throw err
    }
    progress.aliases[key] = true
  }

  onStep('estimate')
  if (!progress.estimateId) {
    progress.estimateId = await importEstimate({
      id: input.estimateId,
      objectId: input.objectId,
      title: input.title,
      sourceFileName: input.sourceFileName,
      estimateDate: input.estimateDate,
      items: toImportItems(plan, { materials: progress.materials, units: progress.units }),
    })
  }

  onStep('template')
  if (input.template) {
    try {
      await saveTemplate({
        companyId,
        name: input.template.name,
        headerSignature: input.template.signature,
        mapping: input.template.mapping,
        sheetName: input.template.sheetName,
        headerRow: input.template.headerRow,
      })
    } catch {
      // Shablon — qulaylik; smeta allaqachon saqlangan
    }
  }
  return progress.estimateId
}
