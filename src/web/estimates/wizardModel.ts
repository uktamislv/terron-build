// Smeta import ustasi modeli — sof funksiyalar (React'siz, repo'siz). Hisoblar `src/domain` da.
import type { ImportEstimateItem } from '@/data/estimatesRepo'
import { isBaseUnit } from '@/data/materialsRepo'
import type { EstimateItem, Material } from '@/data/types'
import { matchMaterialByName, normalizeAlias } from '@/domain/aliases'
import { add, cmp, div, isZero, mul, parseDec, round, type Dec } from '@/domain/decimal'
import { diffKey, ESTIMATE_FIELDS, type ColumnMapping, type DiffItem } from '@/domain/estimate'
import type { ParsedRow } from '@/domain/estimate'
import { findUnit, toBaseQty, unitLabel, validateFactor, validateQtyInput } from '@/domain/units'
import { TIME_ZONE } from '@/lib/format'
import { isNameTaken, toUnitDef } from '../materials/materialFilter'

export const PAGE_SIZE = 100
/** Qisman moslik takliflari soni. */
export const SUGGESTION_COUNT = 3

// ---------------------------------------------------------------------------
// Qatorlar
// ---------------------------------------------------------------------------

/** Xato qatorni qo'lda tuzatish (matn ko'rinishida — forma qiymatlari). */
export interface RowFix {
  name: string
  unit: string
  qty: string
  price: string
}

export interface WizardItem {
  rowNumber: number
  name: string
  unit: string
  qty: Dec
  /** Narx; ustun bo'lmasa — summa / miqdor (2 xona). */
  price: Dec | null
  sum: Dec | null
  type: 'ish' | 'material' | null
  code: string
  sumMismatch: boolean
}

export function fixFromRow(row: ParsedRow): RowFix {
  return { name: row.name, unit: row.unit, qty: row.qty ?? '', price: row.price ?? '' }
}

/** Tuzatish to'g'rimi: nom, birlik, miqdor > 0, narx ixtiyoriy (≥ 0). */
export function validateFix(fix: RowFix): { name: string; unit: string; qty: Dec; price: Dec | null } | null {
  const name = fix.name.trim()
  const unit = fix.unit.trim()
  const qty = validateQtyInput(fix.qty)
  if (!name || !unit || !qty.ok) return null
  let price: Dec | null = null
  if (fix.price.trim() !== '') {
    price = parseDec(fix.price)
    if (price === null || cmp(price, '0') < 0) return null
  }
  return { name, unit, qty: qty.value, price }
}

function derivePrice(qty: Dec, price: Dec | null, sum: Dec | null): Dec | null {
  if (price !== null) return price
  if (sum !== null && !isZero(qty) && cmp(sum, '0') >= 0) return div(sum, qty, 2)
  return null
}

/** Qator o'tkazib yuborilganmi: aniq tanlov, aks holda yashirin qator — ha. */
export function isRowSkipped(
  rowNumber: number,
  skipped: Readonly<Record<number, boolean>>,
  hidden: ReadonlySet<number>,
): boolean {
  return skipped[rowNumber] ?? hidden.has(rowNumber)
}

export interface RowsResult {
  items: WizardItem[]
  /** Avtomatik o'tkazilganlar (bo'lim, jami, bo'sh). */
  autoSkipped: number
  /** Foydalanuvchi o'tkazib yuborgan xato qatorlar. */
  userSkipped: number
  /** Hali hal qilinmagan xato qatorlar. */
  openInvalid: number
  invalidTotal: number
}

/** Saqlanadigan qatorlar: `item` + tuzatilgan xato qatorlar; o'tkazilganlar chiqariladi. */
export function collectItems(
  parsed: readonly ParsedRow[],
  fixes: Readonly<Record<number, RowFix>>,
  skipped: Readonly<Record<number, boolean>>,
  /** Excel'da yashirin qatorlar — standart o'tkazib yuboriladi (foydalanuvchi qaytarishi mumkin). */
  hidden: ReadonlySet<number> = new Set(),
): RowsResult {
  const items: WizardItem[] = []
  let autoSkipped = 0
  let userSkipped = 0
  let openInvalid = 0
  let invalidTotal = 0
  for (const r of parsed) {
    if (r.kind === 'section' || r.kind === 'total' || r.kind === 'empty') {
      autoSkipped++
      continue
    }
    if (r.kind === 'invalid') invalidTotal++
    if (isRowSkipped(r.rowNumber, skipped, hidden)) {
      userSkipped++
      continue
    }
    if (r.kind === 'item' && r.qty !== null) {
      items.push({
        rowNumber: r.rowNumber,
        name: r.name,
        unit: r.unit,
        qty: r.qty,
        price: derivePrice(r.qty, r.price, r.sum),
        sum: r.sum,
        type: r.type,
        code: r.code,
        sumMismatch: r.errors.includes('sum_mismatch'),
      })
      continue
    }
    const fix = fixes[r.rowNumber]
    const ok = fix ? validateFix(fix) : null
    if (!ok) {
      openInvalid++
      continue
    }
    items.push({
      rowNumber: r.rowNumber,
      name: ok.name,
      unit: ok.unit,
      qty: ok.qty,
      price: derivePrice(ok.qty, ok.price, ok.price === null ? r.sum : null),
      sum: ok.price === null ? r.sum : null,
      type: r.type,
      code: r.code,
      sumMismatch: false,
    })
  }
  return { items, autoSkipped, userSkipped, openInvalid, invalidTotal }
}

/** Bitta ustun ikki maydonga tanlangan. */
export function duplicateColumns(m: Partial<Record<string, number>>): boolean {
  const used = Object.values(m).filter((v): v is number => v !== undefined)
  return new Set(used).size !== used.length
}

// ---------------------------------------------------------------------------
// Katalogga moslash
// ---------------------------------------------------------------------------

/** Bir xil nom (normalizeAlias) — bitta qaror. */
export interface NameGroup {
  key: string
  name: string
  unit: string
  type: 'ish' | 'material' | null
  count: number
}

export function groupKeyOf(name: string): string {
  return normalizeAlias(name)
}

export function groupNames(items: readonly WizardItem[]): NameGroup[] {
  const map = new Map<string, NameGroup>()
  for (const it of items) {
    const key = groupKeyOf(it.name)
    const g = map.get(key)
    if (g) g.count++
    else map.set(key, { key, name: it.name, unit: it.unit, type: it.type, count: 1 })
  }
  return [...map.values()]
}

export type Decision =
  | { kind: 'material'; materialId: string; saveAlias: boolean }
  | { kind: 'ish' }
  | { kind: 'new'; name: string; baseUnit: string; saveAlias: boolean }

export interface MatchInfo {
  exactId: string | null
  suggestions: { id: string; score: number }[]
}

export type CatalogEntry = { id: string; name: string; aliases: string[] }

export function catalogOf(materials: readonly Material[]): CatalogEntry[] {
  return materials.filter((m) => m.is_active).map((m) => ({ id: m.id, name: m.name, aliases: m.aliases.map((a) => a.alias) }))
}

export function matchGroup(name: string, catalog: readonly CatalogEntry[]): MatchInfo {
  const all = matchMaterialByName(name, [...catalog])
  const exact = all.find((m) => m.score >= 1)
  return {
    exactId: exact?.id ?? null,
    suggestions: all.filter((m) => m.score < 1).slice(0, SUGGESTION_COUNT),
  }
}

/** Avtomatik qaror: "ish" turi — Ish; aniq moslik — material (muqobil nom shart emas). */
export function defaultDecision(group: NameGroup, info: MatchInfo): Decision | null {
  if (group.type === 'ish') return { kind: 'ish' }
  if (info.exactId) return { kind: 'material', materialId: info.exactId, saveAlias: false }
  return null
}

/** Smetadagi nom materialning nomi ham, muqobil nomi ham emas — muqobil nom sifatida saqlashga arziydi. */
export function aliasWorthSaving(smetaName: string, material: Pick<Material, 'name' | 'aliases'>): boolean {
  const n = normalizeAlias(smetaName)
  if (!n) return false
  return normalizeAlias(material.name) !== n && !material.aliases.some((a) => normalizeAlias(a.alias) === n)
}

export function effectiveDecision(
  group: NameGroup,
  decisions: Readonly<Record<string, Decision>>,
  info: MatchInfo,
): Decision | null {
  return decisions[group.key] ?? defaultDecision(group, info)
}

/** Material kaliti: mavjud — id; yangi — `new:<guruh>`. */
export function materialKeyOf(groupKey: string, d: Decision): string | null {
  if (d.kind === 'material') return d.materialId
  if (d.kind === 'new') return `new:${groupKey}`
  return null
}

// ---------------------------------------------------------------------------
// Birlik savollari
// ---------------------------------------------------------------------------

export type UnitAnswer = { kind: 'existing'; unitId: string } | { kind: 'new'; unit: string; factor: string; variant: string }

/** Yangi materialning asosiy birligi (hali id yo'q). */
export const NEW_BASE_UNIT = 'base'

export interface UnitOption {
  id: string
  label: string
  factor: Dec
}

export interface UnitQuestion {
  key: string
  materialKey: string
  materialName: string
  baseUnit: string
  unitText: string
  options: UnitOption[]
}

export function unitQuestionKey(materialKey: string, unitText: string): string {
  return `${materialKey}|${normalizeAlias(unitText)}`
}

interface MaterialView {
  key: string
  name: string
  baseUnit: string
  options: UnitOption[]
  isNew: boolean
}

function materialView(groupKey: string, d: Decision, byId: ReadonlyMap<string, Material>): MaterialView | null {
  if (d.kind === 'material') {
    const m = byId.get(d.materialId)
    if (!m) return null
    return {
      key: m.id,
      name: m.name,
      baseUnit: m.base_unit,
      options: m.units.map((u) => ({ id: u.id, label: unitLabel(u), factor: u.factor })),
      isNew: false,
    }
  }
  if (d.kind === 'new') {
    return {
      key: `new:${groupKey}`,
      name: d.name.trim(),
      baseUnit: d.baseUnit.trim(),
      options: [{ id: NEW_BASE_UNIT, label: d.baseUnit.trim(), factor: '1' }],
      isNew: true,
    }
  }
  return null
}

/** Katalogdan avtomatik topilgan birlik (savolsiz) yoki null. */
function autoUnit(view: MaterialView, unitText: string, byId: ReadonlyMap<string, Material>): UnitOption | null {
  if (view.isNew) {
    return normalizeAlias(unitText) === normalizeAlias(view.baseUnit) ? (view.options[0] ?? null) : null
  }
  const m = byId.get(view.key)
  if (!m) return null
  const u = findUnit(m.units.map(toUnitDef), unitText)
  return u ? { id: u.id, label: unitLabel(u), factor: u.factor } : null
}

/** Javob to'g'rimi (mavjud birlik ro'yxatda; yangi — nom va koeffitsient). */
export function answerValid(q: Pick<UnitQuestion, 'options'>, a: UnitAnswer | undefined): boolean {
  if (!a) return false
  if (a.kind === 'existing') return q.options.some((o) => o.id === a.unitId)
  return a.unit.trim() !== '' && validateFactor(a.factor).ok
}

// ---------------------------------------------------------------------------
// Reja (tekshirish va saqlash)
// ---------------------------------------------------------------------------

export type ReviewWarning = 'sum_mismatch' | 'duplicate_material'

export type UnitRef =
  | { kind: 'unit'; unitId: string }
  | { kind: 'newMaterialBase'; materialKey: string }
  | { kind: 'newUnit'; questionKey: string }

export interface PlanRow {
  item: WizardItem
  groupKey: string
  itemType: 'ish' | 'material'
  materialKey: string | null
  materialName: string | null
  baseUnit: string | null
  unitRef: UnitRef | null
  unitText: string
  factor: Dec | null
  qtyBase: Dec | null
  sum: Dec
  warnings: ReviewWarning[]
}

export interface NewMaterialPlan {
  key: string
  name: string
  baseUnit: string
}

export interface NewUnitPlan {
  questionKey: string
  materialKey: string
  materialName: string
  unit: string
  factor: Dec
  variant: string
}

export interface AliasPlan {
  materialKey: string
  materialName: string
  alias: string
}

export interface Plan {
  rows: PlanRow[]
  groups: NameGroup[]
  unresolvedGroups: number
  questions: UnitQuestion[]
  unresolvedQuestions: number
  newMaterials: NewMaterialPlan[]
  newUnits: NewUnitPlan[]
  aliases: AliasPlan[]
  total: Dec
  /** Fayldagi jami: Σ summa ustuni (bo'lmasa qty × fayldagi narx), 2 xonaga. */
  fileTotal: Dec
  warningCount: number
}

export interface PlanInput {
  items: readonly WizardItem[]
  materials: readonly Material[]
  decisions: Readonly<Record<string, Decision>>
  answers: Readonly<Record<string, UnitAnswer>>
  /** Yangi material/birlik/muqobil nom yaratish huquqi (admin). Yo'q bo'lsa — rejaga kirmaydi. */
  canCatalog: boolean
}

/** Qator summasi (bazadagi kabi): round(qty × narx, 2); narx yo'q — 0. */
export function lineSum(qty: Dec, price: Dec | null): Dec {
  return price === null ? '0' : round(mul(qty, round(price, 2)), 2)
}

export function buildPlan(input: PlanInput): Plan {
  const { items, materials, decisions, answers, canCatalog } = input
  const byId = new Map(materials.map((m) => [m.id, m]))
  const catalog = catalogOf(materials)
  const groups = groupNames(items)
  const decided = new Map<string, Decision>()
  let unresolvedGroups = 0
  for (const g of groups) {
    let d = effectiveDecision(g, decisions, matchGroup(g.name, catalog))
    // Katalog huquqi bo'lmasa — yangi material va muqobil nom yo'q
    if (d && !canCatalog) {
      if (d.kind === 'new') d = null
      else if (d.kind === 'material' && d.saveAlias) d = { ...d, saveAlias: false }
    }
    if (d && d.kind === 'material' && !byId.has(d.materialId)) d = null
    if (d) decided.set(g.key, d)
    else unresolvedGroups++
  }

  const questions = new Map<string, UnitQuestion>()
  const rows: PlanRow[] = []
  const materialCount = new Map<string, number>()
  let total: Dec = '0'
  let fileTotal: Dec = '0'

  for (const item of items) {
    const groupKey = groupKeyOf(item.name)
    const d = decided.get(groupKey)
    const sum = lineSum(item.qty, item.price)
    total = add(total, sum)
    fileTotal = add(fileTotal, item.sum ?? (item.price === null ? '0' : mul(item.qty, item.price)))
    const row: PlanRow = {
      item,
      groupKey,
      itemType: d && d.kind !== 'ish' ? 'material' : 'ish',
      materialKey: null,
      materialName: null,
      baseUnit: null,
      unitRef: null,
      unitText: item.unit,
      factor: null,
      qtyBase: null,
      sum,
      warnings: item.sumMismatch ? ['sum_mismatch'] : [],
    }
    const view = d ? materialView(groupKey, d, byId) : null
    if (view) {
      row.materialKey = view.key
      row.materialName = view.name
      row.baseUnit = view.baseUnit
      materialCount.set(view.key, (materialCount.get(view.key) ?? 0) + 1)
      const auto = autoUnit(view, item.unit, byId)
      if (auto) {
        row.unitRef = auto.id === NEW_BASE_UNIT ? { kind: 'newMaterialBase', materialKey: view.key } : { kind: 'unit', unitId: auto.id }
        row.unitText = auto.label
        row.factor = auto.factor
      } else {
        const qKey = unitQuestionKey(view.key, item.unit)
        if (!questions.has(qKey)) {
          questions.set(qKey, {
            key: qKey,
            materialKey: view.key,
            materialName: view.name,
            baseUnit: view.baseUnit,
            unitText: item.unit,
            options: view.options,
          })
        }
        const q = questions.get(qKey)
        const a = answers[qKey]
        if (q && a && answerValid(q, a)) {
          if (a.kind === 'existing') {
            const opt = q.options.find((o) => o.id === a.unitId)
            row.unitRef =
              a.unitId === NEW_BASE_UNIT ? { kind: 'newMaterialBase', materialKey: view.key } : { kind: 'unit', unitId: a.unitId }
            row.unitText = opt?.label ?? item.unit
            row.factor = opt?.factor ?? null
          } else if (canCatalog) {
            const f = validateFactor(a.factor)
            row.unitRef = { kind: 'newUnit', questionKey: qKey }
            row.unitText = unitLabel({ unit: a.unit, variant: a.variant || null })
            row.factor = f.ok ? f.value : null
          }
        }
      }
      if (row.factor !== null) row.qtyBase = toBaseQty(item.qty, row.factor)
    }
    rows.push(row)
  }

  for (const row of rows) {
    if (row.materialKey && (materialCount.get(row.materialKey) ?? 0) > 1) row.warnings.push('duplicate_material')
  }

  const qList = [...questions.values()]
  const unresolvedQuestions = qList.filter((q) => {
    const a = answers[q.key]
    if (!answerValid(q, a)) return true
    return a?.kind === 'new' && !canCatalog
  }).length

  // Yangi materiallar va birliklar — faqat ishlatilganlari
  const newMaterials: NewMaterialPlan[] = []
  const aliases: AliasPlan[] = []
  for (const g of groups) {
    const d = decided.get(g.key)
    if (!d) continue
    if (d.kind === 'new') {
      newMaterials.push({ key: `new:${g.key}`, name: d.name.trim(), baseUnit: d.baseUnit.trim() })
      if (d.saveAlias && normalizeAlias(d.name) !== g.key) {
        aliases.push({ materialKey: `new:${g.key}`, materialName: d.name.trim(), alias: g.name })
      }
    } else if (d.kind === 'material' && d.saveAlias) {
      const m = byId.get(d.materialId)
      if (m && aliasWorthSaving(g.name, m)) aliases.push({ materialKey: m.id, materialName: m.name, alias: g.name })
    }
  }
  const usedQuestions = new Set(rows.flatMap((r) => (r.unitRef?.kind === 'newUnit' ? [r.unitRef.questionKey] : [])))
  const newUnits: NewUnitPlan[] = []
  for (const q of qList) {
    const a = answers[q.key]
    if (!usedQuestions.has(q.key) || a?.kind !== 'new') continue
    const f = validateFactor(a.factor)
    if (!f.ok) continue
    newUnits.push({
      questionKey: q.key,
      materialKey: q.materialKey,
      materialName: q.materialName,
      unit: a.unit.trim(),
      factor: f.value,
      variant: a.variant.trim(),
    })
  }

  return {
    rows,
    groups,
    unresolvedGroups,
    questions: qList,
    unresolvedQuestions,
    newMaterials,
    newUnits,
    aliases,
    total,
    fileTotal: round(fileTotal, 2),
    warningCount: rows.filter((r) => r.warnings.length > 0).length,
  }
}

// ---------------------------------------------------------------------------
// Saqlash uchun qatorlar va farq
// ---------------------------------------------------------------------------

export interface CreatedIds {
  /** `new:<guruh>` → yaratilgan material id va uning asosiy birligi id'si. */
  materials: Readonly<Record<string, { id: string; baseUnitId: string }>>
  /** Savol kaliti → yaratilgan (yoki topilgan) birlik id. */
  units: Readonly<Record<string, string>>
}

function resolveMaterialId(key: string, created: CreatedIds): string {
  if (!key.startsWith('new:')) return key
  const m = created.materials[key]
  if (!m) throw new Error(`material yaratilmagan: ${key}`)
  return m.id
}

function resolveUnitId(ref: UnitRef, created: CreatedIds): string {
  if (ref.kind === 'unit') return ref.unitId
  if (ref.kind === 'newMaterialBase') {
    const m = created.materials[ref.materialKey]
    if (!m) throw new Error(`material yaratilmagan: ${ref.materialKey}`)
    return m.baseUnitId
  }
  const u = created.units[ref.questionKey]
  if (!u) throw new Error(`birlik yaratilmagan: ${ref.questionKey}`)
  return u
}

/** RPC `import_estimate` uchun `p_items` (qty va narx — satr). */
export function toImportItems(plan: Pick<Plan, 'rows'>, created: CreatedIds): ImportEstimateItem[] {
  return plan.rows.map((r, index) => {
    if (r.itemType === 'material' && (r.materialKey === null || r.unitRef === null)) {
      // Birligi hal qilinmagan material jimgina "ish" bo'lib ketmasin
      throw new Error(`birlik hal qilinmagan: ${r.item.rowNumber}-qator`)
    }
    const isMaterial = r.itemType === 'material'
    return {
      item_type: isMaterial ? 'material' : 'ish',
      name: r.item.name,
      material_id: isMaterial && r.materialKey ? resolveMaterialId(r.materialKey, created) : null,
      unit: r.item.unit,
      unit_id: isMaterial && r.unitRef ? resolveUnitId(r.unitRef, created) : null,
      qty: r.item.qty,
      unit_price: r.item.price === null ? null : round(r.item.price, 2),
      code: r.item.code || null,
      row_number: r.item.rowNumber,
      sort_order: index + 1,
    }
  })
}

/** Reja → farq qatorlari (yangi materiallar vaqtinchalik kalit bilan). */
export function planToDiffItems(plan: Pick<Plan, 'rows'>): DiffItem[] {
  return plan.rows.map((r) => ({
    key: diffKey({ itemType: r.itemType, materialId: r.materialKey, name: r.item.name, unit: r.item.unit }),
    name: r.materialName ?? r.item.name,
    materialId: r.materialKey,
    qtyBase: r.qtyBase,
    qty: r.item.qty,
    unit: r.item.unit,
    price: r.item.price,
  }))
}

/** Saqlangan versiya qatorlari → farq qatorlari. */
export function estimateItemsToDiff(items: readonly EstimateItem[]): DiffItem[] {
  return items.map((it) => ({
    key: diffKey({ itemType: it.item_type, materialId: it.material_id, name: it.name, unit: it.unit ?? '' }),
    name: it.material_name ?? it.name,
    materialId: it.material_id,
    qtyBase: it.norm_qty_base,
    qty: it.qty,
    unit: it.unit ?? '',
    price: it.unit_price,
  }))
}

/** Yangi material yaratilgach asosiy birlik qatori. */
export function baseUnitIdOf(m: Material): string | null {
  return m.units.find((u) => isBaseUnit(m, u))?.id ?? null
}

/** Kirill harfi bor — ruscha muqobil nom. */
export function aliasLangOf(alias: string): 'ru' | 'uz' {
  return /[Ѐ-ӿ]/.test(alias) ? 'ru' : 'uz'
}

/** Excel ustun harfi: 0 → A, 26 → AA. */
export function columnLetter(index: number): string {
  let n = index + 1
  let s = ''
  while (n > 0) {
    const r = (n - 1) % 26
    s = String.fromCharCode(65 + r) + s
    n = Math.floor((n - 1) / 26)
  }
  return s
}

/** Fayl nomidan smeta nomi: kengaytmasiz. */
export function titleFromFileName(name: string): string {
  return name.replace(/\.(xlsx|xls|csv)$/i, '').trim()
}

export type NewMaterialProblem = 'name' | 'taken' | 'base'

/** Yangi material qarori to'g'rimi: nom bor va katalogda band emas, asosiy birlik bor. */
export function newMaterialProblem(d: Decision, materials: readonly Material[]): NewMaterialProblem | null {
  if (d.kind !== 'new') return null
  if (!d.name.trim()) return 'name'
  if (isNameTaken(materials, d.name)) return 'taken'
  if (!d.baseUnit.trim()) return 'base'
  return null
}

/** Saqlangan shablon moslashi → faqat ma'lum maydonlar va ustun chegarasidagi butun indekslar. */
export function sanitizeMapping(raw: Readonly<Record<string, unknown>>, columns: number): ColumnMapping {
  const out: ColumnMapping = {}
  for (const f of ESTIMATE_FIELDS) {
    const v = raw[f]
    if (typeof v === 'number' && Number.isInteger(v) && v >= 0 && v < columns) out[f] = v
  }
  return out
}

/** Shablon uchun: `undefined` qiymatlarsiz oddiy obyekt. */
export function mappingRecord(m: ColumnMapping): Record<string, number> {
  const out: Record<string, number> = {}
  for (const f of ESTIMATE_FIELDS) {
    const v = m[f]
    if (v !== undefined) out[f] = v
  }
  return out
}

/** RPC chegarasi: bitta smetada ko'pi bilan shuncha qator. */
export const MAX_IMPORT_ROWS = 5000

export const MIN_ESTIMATE_DATE = '2000-01-01'

/** Bugungi sana (Asia/Tashkent) `yyyy-mm-dd`. */
export function todayIso(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now)
}

/** Smeta sanasi: bo'sh yoki 2000-01-01 .. bugun + 1 yil. */
export function estimateDateValid(iso: string, now: Date = new Date()): boolean {
  if (!iso) return true
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return false
  const today = todayIso(now)
  const max = `${Number(today.slice(0, 4)) + 1}${today.slice(4)}`
  return iso >= MIN_ESTIMATE_DATE && iso <= max
}

/** Fayldagi jami va saqlanadigan jami farq qiladimi (narx 2 xonaga yaxlitlangani uchun). */
export function totalsDiffer(plan: Pick<Plan, 'total' | 'fileTotal'>): boolean {
  return cmp(plan.total, plan.fileTotal) !== 0
}

/** parseRows natijasidagi qator raqamlarini Excel raqamiga siljitadi (`!ref` boshlanishi). */
export function shiftRowNumbers(rows: readonly ParsedRow[], offset: number): ParsedRow[] {
  return offset === 0 ? [...rows] : rows.map((r) => ({ ...r, rowNumber: r.rowNumber + offset }))
}

/** Import ustasi bosqichlari (tartib muhim). */
export const STEPS = ['file', 'sheet', 'columns', 'rows', 'catalog', 'units', 'review', 'save'] as const
export type StepKey = (typeof STEPS)[number]
