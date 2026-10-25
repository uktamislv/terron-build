import { toRepoError } from './errors'
import { updateById } from './rowUpdate'
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
  let q = getSupabase().from('alerts').select(ALERT_SELECT, { count: 'exact' }).is('deleted_at', null)
  if (filters.statuses && filters.statuses.length > 0) q = q.in('status', filters.statuses)
  if (filters.type) q = q.eq('type', filters.type)
  if (filters.severity) q = q.eq('severity', filters.severity)
  if (filters.objectId) q = q.eq('object_id', filters.objectId)
  if (filters.purchaseId) q = q.eq('purchase_id', filters.purchaseId)
  const start = page * ALERTS_PAGE_SIZE
  const { data, error, count } = await q
    .order('created_at', { ascending: false })
    .range(start, start + ALERTS_PAGE_SIZE - 1)
  if (error) throw toRepoError(error)
  return { rows: ((data ?? []) as unknown as RawAlert[]).map(normalize), total: count ?? 0 }
}

/** "Ko'rildi" — faqat admin (RLS). */
export function markAlertSeen(id: string): Promise<void> {
  return updateById('alerts', id, { status: 'korildi' })
}

export const CLOSE_NOTE_MAX = 500

/** "Yopish" — faqat admin; ixtiyoriy sabab. `closed_by` / `closed_at` ni baza trigger'i yozadi. */
export function closeAlert(id: string, note?: string | null): Promise<void> {
  const clean = note?.trim().slice(0, CLOSE_NOTE_MAX)
  return updateById('alerts', id, { status: 'yopildi', close_note: clean ? clean : null })
}
