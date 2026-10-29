import { toRepoError } from './errors'
import { softDeleteById } from './rowUpdate'
import { scopeCompany } from './companyScope'
import { getSupabase } from './supabaseClient'
import type { ObjectMember } from './types'

const MEMBER_COLUMNS = 'id, company_id, object_id, profile_id, created_by, created_at, updated_at, deleted_at'
const MEMBER_ERRORS = { '23505': 'already_member' } as const

/** Faol biriktirishlar (RLS: firma rollari — hammasi, boshqalar — o'z qatorlari). */
export async function listObjectMembers(): Promise<ObjectMember[]> {
  const { data, error } = await scopeCompany(getSupabase().from('object_members').select(MEMBER_COLUMNS).is('deleted_at', null))
  if (error) throw toRepoError(error, MEMBER_ERRORS)
  return (data ?? []) as ObjectMember[]
}

export async function addObjectMember(companyId: string, objectId: string, profileId: string): Promise<ObjectMember> {
  const { data, error } = await getSupabase()
    .from('object_members')
    .insert({ company_id: companyId, object_id: objectId, profile_id: profileId })
    .select(MEMBER_COLUMNS)
    .single()
  if (error) throw toRepoError(error, MEMBER_ERRORS)
  return data as ObjectMember
}

/** Olib tashlash = soft delete. */
export function removeObjectMember(memberId: string): Promise<void> {
  return softDeleteById('object_members', memberId, MEMBER_ERRORS)
}

/** Joriy va kerakli obyektlar orasidagi farq: nima qo'shiladi, nima olib tashlanadi. */
export function diffMemberships(
  current: readonly ObjectMember[],
  profileId: string,
  wantedObjectIds: readonly string[],
): { add: string[]; remove: ObjectMember[] } {
  const mine = current.filter((m) => m.profile_id === profileId && m.deleted_at === null)
  const wanted = new Set(wantedObjectIds)
  const have = new Set(mine.map((m) => m.object_id))
  return {
    add: [...wanted].filter((id) => !have.has(id)),
    remove: mine.filter((m) => !wanted.has(m.object_id)),
  }
}

/** Foydalanuvchining obyektlarini berilgan ro'yxatga moslashtiradi. */
export async function syncProfileObjects(
  companyId: string,
  profileId: string,
  wantedObjectIds: readonly string[],
  current: readonly ObjectMember[],
): Promise<void> {
  const { add, remove } = diffMemberships(current, profileId, wantedObjectIds)
  for (const m of remove) await removeObjectMember(m.id)
  for (const objectId of add) await addObjectMember(companyId, objectId, profileId)
}
