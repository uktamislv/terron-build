import { toRepoError } from './errors'
import { softDeleteById } from './rowUpdate'
import { getSupabase } from './supabaseClient'
import type { ObjectRow, ObjectStatus } from './types'

const OBJECT_COLUMNS = 'id, company_id, name, address, status, created_by, created_at, updated_at, deleted_at'

export interface NewObject {
  companyId: string
  name: string
  address?: string | null
  status?: ObjectStatus
}

export interface ObjectPatch {
  name?: string
  address?: string | null
  status?: ObjectStatus
}

function cleanAddress(address: string | null | undefined): string | null {
  const value = address?.trim()
  return value ? value : null
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
