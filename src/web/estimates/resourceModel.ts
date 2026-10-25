// Resurs smetasi (ЛРВ) importi — usta modeli, sof funksiyalar (React'siz, repo'siz).
// Ajratish va agregatsiya `src/domain/estimate/resource.ts` da; bu yerda faqat ustaga ulash:
// moslash (shifr → nom), asosiy materiallar ulushi, katalogga qo'shish va alias payload'lari,
// birliklarni avtomatik aniqlash. docs/estimate-design.md → "Resurs smetasi — avtomatik moslash".
import type { EstimateAliasInput, EstimateMaterialInput } from '@/data/estimatesRepo'
import type { Material } from '@/data/types'
import { normalizeAlias } from '@/domain/aliases'
import { add, cmp, div, isNegative, isZero, mul, round, type Dec } from '@/domain/decimal'
import {
  guessUnit,
  materialNameFromEstimate,
  type AggregatedMaterial,
  type ResourceKind,
  type ResourceParseResult,
} from '@/domain/estimate'
import type { Decision, PlanRow, UnitAnswer, UnitQuestion, WizardItem } from './wizardModel'

export const SHARE_OPTIONS = ['80', '90', '95', '100'] as const
export type SharePct = (typeof SHARE_OPTIONS)[number]
/**
 * 95 %: yaratish baribir bitta tugma, katalog qamrovi kengroq bo'lsa norma oshishi ogohlantirishlari
 * ko'proq material uchun ishlaydi.
 */
export const DEFAULT_SHARE: SharePct = '95'
/** Resurs rejimida katalog ro'yxati sahifasi (har kartochkada butun katalog tanlovi bor). */
export const RESOURCE_PAGE_SIZE = 20

const NAME_MAX = 200
const BASE_UNIT_MAX = 50
const CODE_MAX = 100
const ALIAS_MAX = 200
const REMEMBER_NAME_MAX = 1000

/** Belgilar (code point) bo'yicha qisqartirish — bazadagi `length()` bilan bir xil. */
export function clip(s: string, max: number): string {
  const chars = Array.from(s)
  return chars.length <= max ? s : chars.slice(0, max).join('')
}

// ---------------------------------------------------------------------------
// Xulosa (banner)

export interface ResourceSummary {
  works: number
  byKind: Record<ResourceKind, number>
  totals: {
    labor: Dec | null
    machine: Dec | null
    material: Dec | null
    equipment: Dec | null
    /** Turi aniqlanmagan qatorlar yig'indisi (fayl jamilarida bunday tur yo'q). */
    unknown: Dec | null
    grand: Dec | null
  }
  /** Avtomatik o'tkaziladigan mehnat va texnika qatorlari. */
  laborMachineRows: number
  /** O'qib bo'lmagan (xato) qatorlar — o'tkazildi. */
  invalidRows: number
}

function rowSum(r: ResourceParseResult['resources'][number]): Dec {
  return r.sum ?? (r.price !== null ? round(mul(r.qty, r.price), 2) : '0')
}

/** Fayldagi jami qatorlari (bo'lsa), aks holda resurs qatorlari yig'indisi. */
export function resourceSummary(parsed: ResourceParseResult): ResourceSummary {
  const byKind: Record<ResourceKind, number> = { labor: 0, machine: 0, material: 0, equipment: 0, unknown: 0 }
  const sums: Record<ResourceKind, Dec> = { labor: '0', machine: '0', material: '0', equipment: '0', unknown: '0' }
  let all: Dec = '0'
  for (const r of parsed.resources) {
    byKind[r.kind]++
    const s = rowSum(r)
    sums[r.kind] = add(sums[r.kind], s)
    all = add(all, s)
  }
  const ft = parsed.totals
  const fileEquipment =
    ft.equipment === null && ft.cable === null ? null : add(ft.equipment ?? '0', ft.cable ?? '0')
  const pick = (file: Dec | null, kind: ResourceKind): Dec | null => file ?? (byKind[kind] > 0 ? sums[kind] : null)
  return {
    works: parsed.works.length,
    byKind,
    totals: {
      labor: pick(ft.labor, 'labor'),
      machine: pick(ft.machine, 'machine'),
      material: pick(ft.material, 'material'),
      equipment: pick(fileEquipment, 'equipment'),
      unknown: pick(null, 'unknown'),
      grand: ft.grand ?? (parsed.resources.length > 0 ? all : null),
    },
    laborMachineRows: byKind.labor + byKind.machine,
    invalidRows: parsed.skipped.filter((r) => r.reason === 'invalid').length,
  }
}

// ---------------------------------------------------------------------------
// Usta qatorlari

/** Har bir agregatlangan material — alohida guruh (bir nomli, turli shifrli materiallar aralashmasin). */
export function resourceGroupKey(agg: Pick<AggregatedMaterial, 'key'>): string {
  return `r:${agg.key}`
}

/**
 * Agregatlangan materiallar → usta qatorlari. Jami miqdori 0 yoki manfiy (chegirma ishlari
 * hammasini qoplagan) — saqlab bo'lmaydi (`qty > 0`), `dropped` ga.
 */
export function resourceItems(
  aggregated: readonly AggregatedMaterial[],
  rowOffset: number,
): { items: WizardItem[]; kept: AggregatedMaterial[]; dropped: AggregatedMaterial[] } {
  const items: WizardItem[] = []
  const kept: AggregatedMaterial[] = []
  const dropped: AggregatedMaterial[] = []
  for (const a of aggregated) {
    if (cmp(round(a.qty, 6), '0') <= 0) {
      dropped.push(a)
      continue
    }
    kept.push(a)
    items.push({
      key: resourceGroupKey(a),
      rowNumber: (a.rowNumbers[0] ?? 0) + rowOffset,
      name: a.name,
      unit: a.unit,
      qty: a.qty,
      price: a.avgPrice !== null && !isNegative(a.avgPrice) ? a.avgPrice : null,
      sum: a.sum,
      lineSum: round(a.sum, 2),
      type: null,
      code: a.code,
      sumMismatch: false,
    })
  }
  return { items, kept, dropped }
}

// ---------------------------------------------------------------------------
// Asosiy materiallar ulushi

/** Tanlangan materiallar soni va ularning musbat summadagi ulushi (%, 1 xona). */
export function shareStats(items: readonly AggregatedMaterial[], main: ReadonlySet<string>): { count: number; pct: Dec } {
  let total: Dec = '0'
  let selected: Dec = '0'
  let count = 0
  for (const it of items) {
    if (main.has(it.key)) count++
    if (isNegative(it.sum) || isZero(it.sum)) continue
    total = add(total, it.sum)
    if (main.has(it.key)) selected = add(selected, it.sum)
  }
  return { count, pct: isZero(total) ? '0' : div(mul(selected, '100'), total, 1) }
}

// ---------------------------------------------------------------------------
// Moslash

export type MatchSource = 'created' | 'code' | 'name' | 'new' | 'minor' | 'unknown'

export interface ResourceMatch {
  groupKey: string
  item: AggregatedMaterial
  source: MatchSource
  materialId: string | null
  /** Moslangan material nofaol (server RPC ham nofaollarni topadi). */
  inactive: boolean
}

/** Faollar birinchi — kalit to'qnashsa faol material ustun. */
function activeFirst(materials: readonly Material[]): Material[] {
  return [...materials.filter((m) => m.is_active), ...materials.filter((m) => !m.is_active)]
}

/** `lang = 'code'` alias'lar (faol va nofaol materiallar): normallashgan shifr → material id. */
export function codeIndex(materials: readonly Material[]): Map<string, string> {
  const map = new Map<string, string>()
  for (const m of activeFirst(materials)) {
    for (const a of m.aliases) {
      if (a.lang !== 'code') continue
      const k = normalizeAlias(a.alias)
      if (k && !map.has(k)) map.set(k, m.id)
    }
  }
  return map
}

/**
 * Aniq nom indeksi: normallashgan nom va muqobil nomlar → material id (faollar birinchi, katalog
 * tartibida) — `matchMaterialByName` dagi score 1 kabi, lekin har qator uchun katalogni aylanmaydi.
 * Nofaol materiallar ham kiradi (`estimate_create_materials` ularni ham topadi).
 */
export function exactNameIndex(materials: readonly Material[]): Map<string, string> {
  const map = new Map<string, string>()
  for (const m of activeFirst(materials)) {
    for (const n of [m.name, ...m.aliases.filter((a) => a.lang !== 'code').map((a) => a.alias)]) {
      const k = normalizeAlias(n)
      if (k && !map.has(k)) map.set(k, m.id)
    }
  }
  return map
}

/**
 * Turi aniqlanmagan resurslar agregatlari (barcha qatorlari `unknown`) — material ekani noma'lum,
 * moslanmasa "Ish" bo'lib saqlanadi (jami saqlanadi, foydalanuvchi qayta tasniflashi mumkin).
 */
export function unknownKeysOf(
  aggregated: readonly AggregatedMaterial[],
  resources: ResourceParseResult['resources'],
): Set<string> {
  const kindByRow = new Map(resources.map((r) => [r.rowNumber, r.kind]))
  return new Set(aggregated.filter((a) => a.rowNumbers.every((n) => kindByRow.get(n) === 'unknown')).map((a) => a.key))
}

/**
 * Tartib: shu importda katalogga qo'shilgan → shifr alias'i → aniq nom / muqobil nom → moslanmagan:
 * turi noma'lum — `unknown` ("Ish"), asosiy to'plamda — `new` (katalogga qo'shiladi), qolgani `minor` ("Ish").
 */
export function classifyResources(
  items: readonly AggregatedMaterial[],
  materials: readonly Material[],
  main: ReadonlySet<string>,
  created: Readonly<Record<string, string>>,
  unknownKeys: ReadonlySet<string> = new Set(),
): ResourceMatch[] {
  const byId = new Map(materials.map((m) => [m.id, m]))
  const codes = codeIndex(materials)
  const names = exactNameIndex(materials)
  const matched = (groupKey: string, item: AggregatedMaterial, source: MatchSource, id: string): ResourceMatch => ({
    groupKey,
    item,
    source,
    materialId: id,
    inactive: byId.get(id)?.is_active === false,
  })
  return items.map((item) => {
    const groupKey = resourceGroupKey(item)
    const c = created[item.key]
    if (c && byId.has(c)) return matched(groupKey, item, 'created', c)
    const byCode = item.code ? codes.get(normalizeAlias(item.code)) : undefined
    if (byCode) return matched(groupKey, item, 'code', byCode)
    const byName = names.get(normalizeAlias(item.name))
    if (byName) return matched(groupKey, item, 'name', byName)
    const source: MatchSource = unknownKeys.has(item.key) ? 'unknown' : main.has(item.key) ? 'new' : 'minor'
    return { groupKey, item, source, materialId: null, inactive: false }
  })
}

export interface MatchCounts {
  code: number
  name: number
  created: number
  new: number
  minor: number
  unknown: number
  /** Moslanganlardan nofaol materialga tushganlari. */
  inactive: number
}

export function matchCounts(matches: readonly ResourceMatch[]): MatchCounts {
  const c: MatchCounts = { code: 0, name: 0, created: 0, new: 0, minor: 0, unknown: 0, inactive: 0 }
  for (const m of matches) {
    c[m.source]++
    if (m.inactive) c.inactive++
  }
  return c
}

/** Avtomatik qarorlar: moslanganlar — material, kam summali va turi noma'lum moslanmaganlar — "Ish". `new` — qarorsiz. */
export function autoDecisions(matches: readonly ResourceMatch[]): Record<string, Decision> {
  const out: Record<string, Decision> = {}
  for (const m of matches) {
    if (m.materialId) out[m.groupKey] = { kind: 'material', materialId: m.materialId, saveAlias: false }
    else if (m.source === 'minor' || m.source === 'unknown') out[m.groupKey] = { kind: 'ish' }
  }
  return out
}

// ---------------------------------------------------------------------------
// Katalogga qo'shish (RPC `estimate_create_materials`)

/**
 * Moslanmagan materiallar → RPC payload. `key` — ro'yxatdagi o'rni (javobni qaytarib bog'lash
 * uchun; agregat kaliti 200 belgidan uzun bo'lishi mumkin). Nom — `materialNameFromEstimate`,
 * asosiy birlik va qo'shimcha birlik — `guessUnit` ("100ШТ" → dona + "100 dona" × 100).
 */
export function createMaterialsPayload(items: readonly AggregatedMaterial[]): EstimateMaterialInput[] {
  return items.map((it, i) => {
    const original = it.name.replace(/\s+/g, ' ').trim()
    const guess = guessUnit(it.unit)
    const code = it.code.trim()
    return {
      key: String(i),
      name: clip(materialNameFromEstimate(original) || original, NAME_MAX),
      base_unit: guess ? guess.baseUnit : clip(it.unit.trim().toLowerCase(), BASE_UNIT_MAX),
      code: code && Array.from(code).length <= CODE_MAX ? code : null,
      alias: original ? clip(original, ALIAS_MAX) : null,
      units: guess && guess.factor !== '1' ? [{ unit: guess.unitLabel, factor: guess.factor, variant: null }] : null,
    }
  })
}

// ---------------------------------------------------------------------------
// Birliklar

/** Asosiy birlik taqqoslash kaliti ("М3", "m3", "m³" → "m³"). */
function baseKey(unit: string): string {
  const g = guessUnit(unit)
  if (g && g.factor === '1') return g.baseUnit
  return normalizeAlias(unit).replace(/\s/g, '')
}

/** `from` asosiy birlikdagi 1 → `to` asosiy birlikda nechta (bir xil — 1; t ↔ kg). */
function baseConversion(from: string, to: string): Dec | null {
  const a = baseKey(from)
  const b = baseKey(to)
  if (a === b) return '1'
  if (a === 't' && b === 'kg') return '1000'
  if (a === 'kg' && b === 't') return '0.001'
  return null
}

/**
 * Birlik savollariga avtomatik javob: smetadagi birlik `guessUnit` bilan aniqlanadi va material
 * birliklari orasidan shu koeffitsientli variantsiz birlik tanlanadi; bo'lmasa (katalog huquqi bo'lsa)
 * yangi birlik ("100 dona" × 100). Aniqlab bo'lmaganlar — javobsiz (foydalanuvchidan so'raladi).
 * Shu nomli (normallashgan, variantsiz) birlik boshqa koeffitsient bilan bor bo'lsa — yangi birlik
 * taklif qilinmaydi (javobsiz, so'raladi). `buildPlan` ning `autoAnswer` i sifatida ishlatiladi.
 */
export function autoUnitAnswer(q: UnitQuestion, m: Material | undefined, canCatalog: boolean): UnitAnswer | null {
  if (!m) return null
  const guess = guessUnit(q.unitText)
  if (!guess) return null
  const conv = baseConversion(guess.baseUnit, m.base_unit)
  if (conv === null) return null
  const factor = round(mul(guess.factor, conv), 10)
  if (isZero(factor)) return null
  const plain = (u: Material['units'][number]) => u.variant === null || u.variant.trim() === ''
  const unit = m.units.find((u) => plain(u) && cmp(u.factor, factor) === 0)
  if (unit && q.options.some((o) => o.id === unit.id)) return { kind: 'existing', unitId: unit.id }
  if (!canCatalog) return null
  const label = `${factor} ${m.base_unit}`
  if (m.units.some((u) => plain(u) && normalizeAlias(u.unit) === normalizeAlias(label))) return null
  return { kind: 'new', unit: label, factor, variant: '' }
}

/** Ro'yxat uchun `autoUnitAnswer` (javobi bor savollar). */
export function autoUnitAnswers(
  questions: readonly UnitQuestion[],
  materials: readonly Material[],
  canCatalog: boolean,
): Record<string, UnitAnswer> {
  const byId = new Map(materials.map((m) => [m.id, m]))
  const out: Record<string, UnitAnswer> = {}
  for (const q of questions) {
    const a = autoUnitAnswer(q, byId.get(q.materialKey), canCatalog)
    if (a) out[q.key] = a
  }
  return out
}

// ---------------------------------------------------------------------------
// Saqlangandan keyin: shifr va asl nomlarni eslab qolish (RPC `remember_estimate_aliases`)

export function rememberPayload(
  rows: readonly Pick<PlanRow, 'itemType' | 'materialKey' | 'item'>[],
  createdMaterials: Readonly<Record<string, { id: string }>>,
): EstimateAliasInput[] {
  const out: EstimateAliasInput[] = []
  const seen = new Set<string>()
  for (const r of rows) {
    if (r.itemType !== 'material' || !r.materialKey) continue
    const id = r.materialKey.startsWith('new:') ? createdMaterials[r.materialKey]?.id : r.materialKey
    if (!id) continue
    // Server `import_estimate` ga yuborilgan nom va shifr bilan AYNAN solishtiradi (faqat bo'sh joylar
    // siqiladi) — shuning uchun asl qiymat yuboriladi; chegaradan uzunlari umuman yuborilmaydi.
    const code = r.item.code.trim() !== '' && Array.from(r.item.code).length <= CODE_MAX ? r.item.code : null
    const name = r.item.name.trim() !== '' && Array.from(r.item.name).length <= REMEMBER_NAME_MAX ? r.item.name : null
    if (code === null && name === null) continue
    const k = `${id}|${code ?? ''}|${name ?? ''}`
    if (seen.has(k)) continue
    seen.add(k)
    out.push({ material_id: id, code, name })
  }
  return out
}
