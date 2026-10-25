import { toRepoError } from './errors'
import { softDeleteById } from './rowUpdate'
import { getSupabase } from './supabaseClient'
import type { ObjectRow, ObjectStatus } from './types'

const OBJECT_COLUMNS = 'id, company_id, name, address, status, lat::text, lng::text, radius_m, created_by, created_at, updated_at, deleted_at'

export interface NewObject {
  companyId: string
  name: string
  address?: string | null
  status?: ObjectStatus
  /** Batch 12 (D): Dec satr yoki null. */
  lat?: string | null
  lng?: string | null
  radiusM?: number | null
}

export interface ObjectPatch {
  name?: string
  address?: string | null
  status?: ObjectStatus
  lat?: string | null
  lng?: string | null
  radiusM?: number | null
}

function cleanAddress(address: string | null | undefined): string | null {
  const value = address?.trim()
  return value ? value : null
}

function geoPatch(p: { lat?: string | null; lng?: string | null; radiusM?: number | null }): Record<string, unknown> {
  const row: Record<string, unknown> = {}
  if (p.lat !== undefined) row.lat = p.lat
  if (p.lng !== undefined) row.lng = p.lng
  // radius_m NOT NULL default 300 — null yuborilmaydi
  if (p.radiusM !== undefined && p.radiusM !== null) row.radius_m = p.radiusM
  return row
}

/**
 * Mini App: "Shu yerni obyekt joyi qilish" (faqat admin — RLS). Koordinata Dec satr.
 */
export function setObjectLocation(id: string, lat: string, lng: string): Promise<ObjectRow> {
  return updateObject(id, { lat, lng })
}

/** Ko'rinadigan obyektlar (RLS: firma rollari — hammasi, boshqalar — a'zo bo'lganlari). */
export async function listObjects(): Promise<ObjectRow[]> {
  const { data, error } = await getSupabase()
    .from('objects')
    .select(OBJECT_COLUMNS)
    .is('deleted_at', null)
    .order('name')
  if (error) throw toRepoError(error)
  return (data ?? []) as ObjectRow[]
}

export async function createObject(input: NewObject): Promise<ObjectRow> {
  const row = {
    company_id: input.companyId,
    name: input.name.trim(),
    address: cleanAddress(input.address),
    status: input.status ?? 'faol',
    ...geoPatch(input),
  }
  const { data, error } = await getSupabase().from('objects').insert(row).select(OBJECT_COLUMNS).single()
  if (error) throw toRepoError(error)
  return data as ObjectRow
}

export async function updateObject(id: string, patch: ObjectPatch): Promise<ObjectRow> {
  const row: Record<string, unknown> = {}
  if (patch.name !== undefined) row.name = patch.name.trim()
  if (patch.address !== undefined) row.address = cleanAddress(patch.address)
  if (patch.status !== undefined) row.status = patch.status
  Object.assign(row, geoPatch(patch))
  const { data, error } = await getSupabase()
    .from('objects')
    .update(row)
    .eq('id', id)
    .select(OBJECT_COLUMNS)
    .single()
  if (error) throw toRepoError(error)
  return data as ObjectRow
}

export function softDeleteObject(id: string): Promise<void> {
  return softDeleteById('objects', id)
}
