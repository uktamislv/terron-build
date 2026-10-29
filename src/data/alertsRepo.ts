import { RepoError, toRepoError } from './errors'
import { chunkOpts, fetchAll, type ChunkOpts } from './fetchAll'
import { updateById } from './rowUpdate'
import { scopeCompany } from './companyScope'
import { getSupabase } from './supabaseClient'
import type { Alert, AlertSeverity, AlertStatus, AlertType } from './types'

const ALERT_SELECT =
  'id, company_id, type, status, severity, object_id, material_id, purchase_id, movement_id, details, ' +
  'closed_by, closed_at, close_note, created_at, deleted_at, ' +
  'object:objects!alerts_object_fkey(name), ' +
  'material:materials!alerts_material_fkey(name, base_unit)'

export const ALERTS_PAGE_SIZE = 50

export interface AlertFilters {
  /** Berilmasa — barcha holatlar. */
  statuses?: AlertStatus[]
  type?: AlertType
  severity?: AlertSeverity
  objectId?: string
  purchaseId?: string
  inventoryCountId?: string
}

type RawAlert = Omit<Alert, 'object_name' | 'material_name' | 'base_unit'> & {
  object: { name: string } | null
  material: { name: string; base_unit: string } | null
}

function normalize(raw: RawAlert): Alert {
  const { object, material, ...rest } = raw
  return {
    ...rest,
    details: rest.details && typeof rest.details === 'object' ? rest.details : {},
    object_name: object?.name ?? null,
    material_name: material?.name ?? null,
    base_unit: material?.base_unit ?? null,
  }
}

/** Ogohlantirishlar (admin, direktor, buxgalter ko'radi — RLS), yangisi birinchi. */
export async function listAlerts(filters: AlertFilters = {}, page = 0): Promise<{ rows: Alert[]; total: number }> {
  const start = page * ALERTS_PAGE_SIZE
  const r = await loadAlerts(filters, start, start + ALERTS_PAGE_SIZE - 1)
  return { rows: r.rows, total: r.total ?? 0 }
}

/** Oxirgi `limit` ta ogohlantirish (bosh sahifa, Mini App direktor ekrani). */
export async function listRecentAlerts(filters: AlertFilters = {}, limit = 5): Promise<Alert[]> {
  const { rows } = await loadAlerts(filters, 0, limit - 1)
  return rows
}

/** Eksport: joriy filtr bo'yicha barcha ogohlantirishlar (1000 tadan, ≤ 50 000). */
export function listAllAlerts(filters: AlertFilters = {}, signal?: AbortSignal): Promise<Alert[]> {
  return fetchAll((req) => loadAlerts(filters, req.from, req.to, chunkOpts(req)), { signal })
}

async function loadAlerts(
  filters: AlertFilters,
  from: number,
  to: number,
  opts: ChunkOpts = { count: true },
): Promise<{ rows: Alert[]; total: number | null }> {
  let q = scopeCompany(getSupabase().from('alerts').select(ALERT_SELECT, opts.count ? { count: 'exact' } : undefined).is('deleted_at', null))
  if (filters.statuses && filters.statuses.length > 0) q = q.in('status', filters.statuses)
  if (filters.type) q = q.eq('type', filters.type)
  if (filters.severity) q = q.eq('severity', filters.severity)
  if (filters.objectId) q = q.eq('object_id', filters.objectId)
  if (filters.purchaseId) q = q.eq('purchase_id', filters.purchaseId)
  if (filters.inventoryCountId) q = q.eq('inventory_count_id', filters.inventoryCountId)
  if (opts.before) q = q.lte('created_at', opts.before)
  let ranged = q.order('created_at', { ascending: false }).order('id').range(from, to)
  if (opts.signal) ranged = ranged.abortSignal(opts.signal)
  const { data, error, count } = await ranged
  if (error) throw toRepoError(error)
  return { rows: ((data ?? []) as unknown as RawAlert[]).map(normalize), total: count ?? null }
}

/** "Ko'rildi" — faqat admin (RLS). */
export function markAlertSeen(id: string): Promise<void> {
  return updateById('alerts', id, { status: 'korildi' })
}

export const CLOSE_NOTE_MAX = 500

/**
 * "Yopish" — faqat admin; sabab majburiy (baza `alert_close_note_required`). `closed_by` / `closed_at`
 * ni baza trigger'i yozadi.
 */
export function closeAlert(id: string, note: string): Promise<void> {
  const clean = note.trim().slice(0, CLOSE_NOTE_MAX)
  if (!clean) return Promise.reject(new RepoError('alert_close_note_required'))
  return updateById('alerts', id, { status: 'yopildi', close_note: clean })
}

/**
 * Prorab/omborchi a'zo obyektlarining ogohlantirishlari (docs/audit-fixes.md D3, faqat o'qish).
 * RLS faqat shu turlarni ko'rsatadi; boshqa rollar uchun ham xavfsiz.
 */
export const SITE_ALERT_TYPES: readonly AlertType[] = [
  'normadan_oshish',
  'manfiy_qoldiq',
  'otkazma_farqi',
  'smetadan_ortiq_sorov',
  'smetasiz_chiqim',
]

export async function listSiteAlerts(limit = 10): Promise<Alert[]> {
  const { data, error } = await getSupabase()
    .from('alerts')
    .select(ALERT_SELECT)
    .in('type', SITE_ALERT_TYPES as AlertType[])
    .in('status', ['yangi', 'korildi'])
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) throw toRepoError(error)
  return ((data ?? []) as unknown as RawAlert[]).map(normalize)
}

/**
 * Bitta ogohlantirish (Batch 12, J: Telegram "Ochish" tugmasi → Mini App `?alert=<id>`).
 * RLS ko'rsatmasa yoki o'chirilgan bo'lsa — null.
 */
export async function getAlertById(id: string): Promise<Alert | null> {
  const { data, error } = await getSupabase().from('alerts').select(ALERT_SELECT).eq('id', id).is('deleted_at', null).maybeSingle()
  if (error) throw toRepoError(error)
  return data ? normalize(data as unknown as RawAlert) : null
}
