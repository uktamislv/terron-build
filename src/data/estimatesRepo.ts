import { mul, round, type Dec } from '@/domain/decimal'
import { toRepoError } from './errors'
import { inChunks } from './fetchAll'
import { getSupabase } from './supabaseClient'
import type { Estimate, EstimateItem, EstimateItemType } from './types'

// numeric ustunlar `::text` — aniqlik yo'qolmasin. Material nomi FK nomi bilan embed qilinadi.
const ESTIMATE_COLUMNS =
  'id, company_id, object_id, version, title, estimate_date, source_file_name, is_current, created_by, created_at, updated_at'
const ITEM_COLUMNS =
  'id, estimate_id, item_type, name, material_id, unit, unit_id, qty::text, unit_price::text, norm_qty_base::text, ' +
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

/** Qator summasi: round(qty × narx, 2); narx yo'q — 0. */
export function itemSum(qty: Dec, price: Dec | null): Dec {
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
