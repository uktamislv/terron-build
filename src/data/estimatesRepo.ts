import { mul, round, type Dec } from '@/domain/decimal'
import { companyScopeArg } from './companyScope'
import { toRepoError } from './errors'
import { inChunks } from './fetchAll'
import { getSupabase } from './supabaseClient'
import type { Estimate, EstimateItem, EstimateItemType } from './types'

// numeric ustunlar `::text` — aniqlik yo'qolmasin. Material nomi FK nomi bilan embed qilinadi.
const ESTIMATE_COLUMNS =
  'id, company_id, object_id, version, title, estimate_date, source_file_name, is_current, created_by, created_at, updated_at'
const ITEM_COLUMNS =
  'id, estimate_id, item_type, name, material_id, unit, unit_id, qty::text, unit_price::text, line_sum::text, norm_qty_base::text, ' +
  'sort_order, code, row_number, material:materials!estimate_items_material_fkey(name, base_unit)'

/** PostgREST bitta javobda ko'pi bilan shuncha qator qaytaradi (Supabase `max_rows`). */
const PAGE = 1000

/** RPC `import_estimate` qatori — `docs/estimate-design.md`. Miqdor va narx satr (float emas). */
export interface ImportEstimateItem {
  item_type: EstimateItemType
  name: string
  material_id: string | null
  unit: string | null
  unit_id: string | null
  qty: Dec
  unit_price: Dec | null
  code: string | null
  row_number: number | null
  sort_order: number
  /** Qator summasi (2 xona, satr) — berilsa bazada jami shu (resurs smetasi agregati). */
  line_sum?: Dec
}

export interface ImportEstimateInput {
  /** Klientda yaratilgan id — qayta urinishda ikkinchi versiya yaratilmaydi. */
  id: string
  objectId: string
  title: string
  sourceFileName: string | null
  /** `yyyy-mm-dd` yoki null. */
  estimateDate: string | null
  items: ImportEstimateItem[]
}

type RawItem = Omit<EstimateItem, 'material_name' | 'base_unit'> & {
  material: { name: string; base_unit: string } | null
}

/**
 * Qator summasi: `line_sum` (bo'lsa — bazadagi haqiqiy jami), aks holda round(qty × narx, 2); narx yo'q — 0.
 * `estimate_totals.total_sum` bilan bir xil formula.
 */
export function itemSum(qty: Dec, price: Dec | null, lineSum: Dec | null = null): Dec {
  if (lineSum !== null) return lineSum
  return price === null ? '0' : round(mul(qty, price), 2)
}

/** 1000 tadan bo'lib o'qish (1000+ qatorli smeta). */
async function fetchAll<T>(
  build: (from: number, to: number) => PromiseLike<{ data: unknown; error: unknown }>,
): Promise<T[]> {
  const out: T[] = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await build(from, from + PAGE - 1)
    if (error) throw toRepoError(error)
    const rows = (data ?? []) as T[]
    out.push(...rows)
    if (rows.length < PAGE) return out
  }
}

/** Obyekt smetasi versiyalari (yangisi birinchi) — `estimate_totals` view'dan qatorlar soni va jami summa. */
export async function listEstimates(objectId: string): Promise<Estimate[]> {
  const { data, error } = await getSupabase()
    .from('estimates')
    .select(ESTIMATE_COLUMNS)
    .eq('object_id', objectId)
    .is('deleted_at', null)
    .order('version', { ascending: false })
  if (error) throw toRepoError(error)
  const estimates = (data ?? []) as Omit<Estimate, 'item_count' | 'material_count' | 'total_sum'>[]
  if (estimates.length === 0) return []
const totals = await inChunks(
    estimates.map((e) => e.id),
    async (chunk) => {
      const { data, error: totalsError } = await getSupabase()
        .from('estimate_totals')
        .select('estimate_id, row_count, material_count, total_sum::text')
        .in('estimate_id', chunk)
      if (totalsError) throw toRepoError(totalsError)
      return data ?? []
    },
  )
  const byId = new Map(
    (totals as { estimate_id: string; row_count: number; material_count: number; total_sum: Dec | null }[]).map(
      (r) => [r.estimate_id, r],
    ),
  )
  return estimates.map((e) => {
    const tot = byId.get(e.id)
    return {
      ...e,
      item_count: Number(tot?.row_count ?? 0),
      material_count: Number(tot?.material_count ?? 0),
      total_sum: tot?.total_sum ?? '0',
    }
  })
}

/** Bitta versiya qatorlari (tartib bo'yicha), material nomi va asosiy birligi bilan. */
export async function listEstimateItems(estimateId: string): Promise<EstimateItem[]> {
  const raw = await fetchAll<RawItem>((from, to) =>
    getSupabase()
      .from('estimate_items')
      .select(ITEM_COLUMNS)
      .eq('estimate_id', estimateId)
      .is('deleted_at', null)
      .order('sort_order')
      .order('id')
      .range(from, to),
  )
  return raw.map(({ material, ...rest }) => ({
    ...rest,
    material_name: material?.name ?? null,
    base_unit: material?.base_unit ?? null,
  }))
}

/**
 * RPC `import_estimate`: bitta tranzaksiyada yangi versiya (joriy) va qatorlar.
 * `norm_qty_base` yuborilmaydi — bazada hisoblanadi. Shu `id` bilan smeta bo'lsa — o'sha id qaytadi.
 */
export async function importEstimate(input: ImportEstimateInput): Promise<string> {
  const { data, error } = await getSupabase().rpc('import_estimate', {
    p_id: input.id,
    p_object_id: input.objectId,
    p_title: input.title.trim(),
    p_source_file_name: input.sourceFileName,
    p_estimate_date: input.estimateDate,
    p_items: input.items,
  })
  if (error) throw toRepoError(error)
  return (data as string | null) ?? input.id
}

/** Versiyani obyektning joriy smetasi qiladi (qolganlari joriy emas). */
export async function setCurrentEstimate(estimateId: string): Promise<void> {
  const { error } = await getSupabase().rpc('set_current_estimate', { p_estimate_id: estimateId })
  if (error) throw toRepoError(error)
}

// ---------------------------------------------------------------------------
// Resurs smetasi: katalogga ommaviy qo'shish va shifrlarni eslab qolish
// (docs/estimate-design.md → "Resurs smetasi — avtomatik moslash").

/** RPC `estimate_create_materials` bitta chaqiruvda ko'pi bilan shuncha material qabul qiladi. */
export const CREATE_MATERIALS_CHUNK = 2000
/** RPC `remember_estimate_aliases` chegarasi. */
export const REMEMBER_ALIASES_CHUNK = 5000

export interface EstimateMaterialUnitInput {
  unit: string
  /** 1 `unit` = factor asosiy birlik (satr, float emas). */
  factor: Dec
  variant: string | null
}

export interface EstimateMaterialInput {
  /** Klient kaliti — javobda qaytadi (≤ 200). */
  key: string
  name: string
  base_unit: string
  category?: string | null
  code: string | null
  /** Smetadagi asl nom (≤ 200). */
  alias: string | null
  units: EstimateMaterialUnitInput[] | null
}

export interface EstimateMaterialResult {
  key: string
  material_id: string
  /** false — katalogda allaqachon bor edi (shifr / nom / muqobil nom bo'yicha topildi). */
  created: boolean
}

/**
 * Smetadagi moslanmagan materiallarni katalogga qo'shadi (yoki mavjudini topadi) — RPC
 * `estimate_create_materials`, 2000 tadan bo'lib. Natija kirish tartibida.
 */
export async function createEstimateMaterials(items: readonly EstimateMaterialInput[]): Promise<EstimateMaterialResult[]> {
  const out: EstimateMaterialResult[] = []
  for (let i = 0; i < items.length; i += CREATE_MATERIALS_CHUNK) {
    const chunk = items.slice(i, i + CREATE_MATERIALS_CHUNK)
    const { data, error } = await getSupabase().rpc('estimate_create_materials', { p_items: chunk, ...companyScopeArg() })
    if (error) throw toRepoError(error)
    const rows = (data ?? []) as { key: string | number; material_id: string; created: boolean }[]
    for (const r of rows) out.push({ key: String(r.key), material_id: r.material_id, created: Boolean(r.created) })
  }
  return out
}

export interface EstimateAliasInput {
  material_id: string
  /** Smeta shifri (≤ 100) → `lang = 'code'`. */
  code: string | null
  /** Smetadagi asl nom (≤ 1000) → `lang = 'ru'`. */
  name: string | null
}

/**
 * Saqlangan smetadagi shifr va asl nomlarni katalogga muqobil nom sifatida eslab qoladi — RPC
 * `remember_estimate_aliases` (band matnlar o'tkaziladi). `estimateId` — hozirgina saqlangan smeta: elementlar
 * shu smetadan bo'lishi shart (server tekshiradi). Natija — qo'shilgan alias'lar soni.
 */
export async function rememberEstimateAliases(estimateId: string, items: readonly EstimateAliasInput[]): Promise<number> {
  let added = 0
  for (let i = 0; i < items.length; i += REMEMBER_ALIASES_CHUNK) {
    const chunk = items.slice(i, i + REMEMBER_ALIASES_CHUNK)
    const { data, error } = await getSupabase().rpc('remember_estimate_aliases', { p_estimate_id: estimateId, p_items: chunk })
    if (error) throw toRepoError(error)
    added += Number(data ?? 0)
  }
  return added
}
