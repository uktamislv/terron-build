import { normalizePhone } from '@shared/phone'
import type { Role } from '@/domain/roles'
import { RepoError, toRepoError } from './errors'
import { getSupabase } from './supabaseClient'
import type { Profile } from './types'

// telegram_chat_id ataylab o'qilmaydi — UI'ga kerak emas.
export const PROFILE_COLUMNS =
  'id, company_id, auth_user_id, login_kind, role, full_name, phone, telegram_user_id, is_active, created_by, created_at, updated_at, deleted_at'

// profiles da 23505 — firma ichida telefon band; 23514 — telefon formati (E.164 check)
const PROFILE_ERRORS = { '23505': 'phone_taken', '23514': 'phone_format' } as const

export interface NewProfile {
  companyId: string
  role: Role
  fullName: string
  phone: string
  isActive?: boolean
}

/**
 * Faqat authenticated'ga grant qilingan ustunlar. `auth_user_id`, `telegram_user_id`,
 * `telegram_chat_id` hech qachon yuborilmaydi — ularni faqat Edge Function yozadi.
 */
export interface ProfilePatch {
  role?: Role
  fullName?: string
  phone?: string
  isActive?: boolean
}

function requirePhone(input: string): string {
  const phone = normalizePhone(input)
  if (!phone) throw new RepoError('phone_format')
  return phone
}

/** Firma foydalanuvchilari (o'chirilmaganlar), ism bo'yicha. */
export async function listProfiles(): Promise<Profile[]> {
  const { data, error } = await getSupabase()
    .from('profiles')
    .select(PROFILE_COLUMNS)
    .is('deleted_at', null)
    .order('full_name')
  if (error) throw toRepoError(error, PROFILE_ERRORS)
  return (data ?? []) as Profile[]
}

export async function createProfile(input: NewProfile): Promise<Profile> {
  const row = {
    company_id: input.companyId,
    role: input.role,
    full_name: input.fullName.trim(),
    phone: requirePhone(input.phone),
    is_active: input.isActive ?? true,
  }
  const { data, error } = await getSupabase().from('profiles').insert(row).select(PROFILE_COLUMNS).single()
  if (error) throw toRepoError(error, PROFILE_ERRORS)
  return data as Profile
}

export function profilePatchToRow(patch: ProfilePatch): Record<string, unknown> {
  const row: Record<string, unknown> = {}
  if (patch.role !== undefined) row.role = patch.role
  if (patch.fullName !== undefined) row.full_name = patch.fullName.trim()
  if (patch.phone !== undefined) row.phone = requirePhone(patch.phone)
  if (patch.isActive !== undefined) row.is_active = patch.isActive
  return row
}

export async function updateProfile(id: string, patch: ProfilePatch): Promise<Profile> {
  const row = profilePatchToRow(patch)
  const { data, error } = await getSupabase()
    .from('profiles')
    .update(row)
    .eq('id', id)
    .select(PROFILE_COLUMNS)
    .single()
  if (error) throw toRepoError(error, PROFILE_ERRORS)
  return data as Profile
}

export function setProfileActive(id: string, isActive: boolean): Promise<Profile> {
  return updateProfile(id, { isActive })
}

/** Soft delete — yozuv tarixda qoladi va tiklanadi. */
export async function softDeleteProfile(id: string): Promise<void> {
  const { error } = await getSupabase()
    .from('profiles')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', id)
  if (error) throw toRepoError(error, PROFILE_ERRORS)
}
